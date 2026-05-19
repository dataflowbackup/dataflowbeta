/**
 * Import masivo de facturas desde Excel del parser OCR + mapping manual de insumos (solo admins).
 * No altera rutas existentes de facturas/pagos para usuarios comunes.
 */
import type { Express } from "express";
import multer from "multer";
import * as XLSX from "xlsx";
import { storage } from "./storage";
import { computeInvoiceTaxes } from "@shared/invoiceTaxComputation";
import {
  digitsOnly,
  formatCuitAr,
  mapIvaTextToInvoiceCondition,
  mapTipoComprobanteToCode,
  normalizeInvoiceNumber,
  normalizeInvoiceSalePoint,
  parseEsDateToIso,
  parseMoneyAr,
  scoreSupplyMatch,
  stripDiacriticsLower,
} from "@shared/bulkInvoiceImportHelpers";
import { isAuthenticated as isAuthenticatedOIDC } from "./replitAuth";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 55 * 1024 * 1024 },
});

function isAuthenticated(req: any, res: any, next: any) {
  const session = req.session as any;
  if (session?.userId) return next();
  return isAuthenticatedOIDC(req, res, next);
}

async function getClientId(req: any): Promise<number> {
  const session = req.session as any;
  if (session?.userId) {
    const client = await storage.getClientByUserId(session.userId);
    if (!client) throw new Error("Client not found");
    return client.id;
  }
  const user = req.user as any;
  if (!user?.claims?.sub) throw new Error("User not authenticated");
  let client = await storage.getClientByUserId(user.claims.sub);
  if (!client && user.claims.email) {
    const dbUser = await storage.getUserByEmail(user.claims.email);
    if (dbUser) client = await storage.getClientByUserId(dbUser.id);
  }
  if (!client) throw new Error("Client not found");
  return client.id;
}

async function getAuthenticatedUserId(req: any): Promise<string | undefined> {
  const session = req.session as any;
  if (session?.userId) return String(session.userId);
  const user = req.user as any;
  if (!user?.claims?.sub) return undefined;
  let dbUser = await storage.getUser(user.claims.sub);
  if (!dbUser && user.claims.email) {
    dbUser = await storage.getUserByEmail(user.claims.email);
  }
  return dbUser?.id;
}

type BulkAccessDenied = {
  allowed: false;
  status: number;
  message: string;
};

type BulkAccessAllowed = {
  allowed: true;
  mode: "email_allowlist" | "role_socio_admin";
  hint?: string;
};

async function resolveBulkInvoiceAccess(req: any): Promise<BulkAccessAllowed | BulkAccessDenied> {
  const userId = await getAuthenticatedUserId(req);
  if (!userId) {
    return { allowed: false, status: 401, message: "Tenés que iniciar sesión." };
  }

  let clientId: number;
  try {
    clientId = await getClientId(req);
  } catch {
    return { allowed: false, status: 400, message: "No encontramos la empresa asociada a tu usuario." };
  }

  let email: string | undefined;
  const session = req.session as any;
  if (session?.userId) {
    const u = await storage.getUser(session.userId);
    email = u?.email?.toLowerCase();
  }
  if (!email) {
    const user = req.user as any;
    email = user?.claims?.email?.toLowerCase?.();
  }

  const allowlist = (process.env.BULK_INVOICE_ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  if (allowlist.length > 0) {
    if (!email || !allowlist.includes(email)) {
      return {
        allowed: false,
        status: 403,
        message:
          "En este servidor la importación masiva está limitada a una lista de correos. Tu cuenta no está en esa lista (pedí que agreguen tu email en Netlify → Environment variables → BULK_INVOICE_ADMIN_EMAILS).",
      };
    }
    return {
      allowed: true,
      mode: "email_allowlist",
      hint: "Lista restrictiva de correos activa en el servidor.",
    };
  }

  const roleRaw = await storage.getUserRoleInClient(userId, clientId);
  const role = String(roleRaw ?? "").trim().toLowerCase();
  const privilegedRoles = new Set(["socio", "admin", "manager"]);

  if (!privilegedRoles.has(role)) {
    return {
      allowed: false,
      status: 403,
      message:
        "Solo perfil Socio, Administrador o Gerente puede usar esta herramienta. Entrá a Equipo y pedí que te asignen ese rol, o que otro usuario autorizado haga la importación.",
    };
  }

  return {
    allowed: true,
    mode: "role_socio_admin",
    hint: "Activado por tu rol en la empresa. Opcional en Netlify: BULK_INVOICE_ADMIN_EMAILS para acotar solo a ciertos correos.",
  };
}

async function requireBulkInvoiceAdmin(req: any, res: any, next: any) {
  try {
    const r = await resolveBulkInvoiceAccess(req);
    if (!r.allowed) {
      return res.status(r.status).json({ message: r.message });
    }
    next();
  } catch (e: any) {
    return res.status(500).json({ message: e?.message ?? "Error auth admin import" });
  }
}

function matrixFromSheet(sheet: XLSX.WorkSheet): string[][] {
  return XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: "" }) as string[][];
}

function findRowWithCell(matrix: string[][], substring: string): number {
  const needle = substring.toLowerCase();
  for (let r = 0; r < matrix.length; r++) {
    const row = matrix[r] ?? [];
    if (row.some((c) => String(c).toLowerCase().includes(needle))) return r;
  }
  return -1;
}

function rowToObj(headers: string[], row: string[]): Record<string, string> {
  const o: Record<string, string> = {};
  headers.forEach((h, i) => {
    o[String(h).trim()] = row[i] != null ? String(row[i]).trim() : "";
  });
  return o;
}

async function findSupplierByFlexibleCuit(clientId: number, rawCuit: string) {
  const d = digitsOnly(rawCuit);
  if (d.length < 11) return undefined;
  const formatted = formatCuitAr(d);
  let s = await storage.getSupplierByCuit(clientId, formatted);
  if (s) return s;
  s = await storage.getSupplierByCuit(clientId, d);
  if (s) return s;
  const all = await storage.getSuppliers(clientId);
  return all.find((x) => digitsOnly(x.cuit ?? "") === d);
}

async function resolveFelisaLocalId(clientId: number): Promise<number> {
  const locals = await storage.getLocals(clientId);
  const felisa = locals.find((l) => stripDiacriticsLower(l.name).trim() === "felisa");
  const fuzzy =
    felisa ?? locals.find((l) => stripDiacriticsLower(l.name).includes("felisa"));
  if (!fuzzy) throw new Error('No existe local con nombre "FELISA" para este cliente');
  return fuzzy.id;
}

function pickIvaTaxId(clientTaxes: { id: number; percentage: string; type: string | null }[], pctHint: number): number | undefined {
  const pool = clientTaxes.filter((t) => String(t.type ?? "").toLowerCase() === "iva");
  if (!pool.length) return undefined;
  let best: { id: number; diff: number } | undefined;
  for (const t of pool) {
    const p = parseFloat(String(t.percentage)) || 0;
    const diff = Math.abs(p - pctHint);
    if (!best || diff < best.diff) best = { id: t.id, diff };
  }
  if (best && best.diff <= 1.5) return best.id;
  const twentyOne = pool.find((t) => Math.abs((parseFloat(String(t.percentage)) || 0) - 21) < 0.01);
  return twentyOne?.id ?? pool[0]?.id;
}

/** Columna Dataflow ya normalizada o texto OCR libre. */
function normalizeIvaForInvoice(raw: string | undefined): string {
  const t = String(raw ?? "").trim().toLowerCase();
  if (["responsable_inscripto", "monotributista", "exento", "consumidor_final"].includes(t)) return t;
  return mapIvaTextToInvoiceCondition(raw);
}

const AUTO_THRESHOLD = 0.88;

export type SupplySuggestionRow = {
  descriptionOcr: string;
  suggestedSupplyId?: number;
  suggestedSupplyName: string;
  score: number;
  status: "auto" | "review";
};

async function computeSupplySuggestionsFromParserExcel(
  parserBuffer: Buffer,
  clientId: number,
): Promise<SupplySuggestionRow[]> {
  const wb = XLSX.read(parserBuffer, { type: "buffer" });
  const sh = wb.Sheets["Items de Facturas"];
  if (!sh) throw new Error('No se encontró la hoja "Items de Facturas"');

  const matrix = matrixFromSheet(sh);
  const hdrIdx = findRowWithCell(matrix, "Descripción");
  if (hdrIdx < 0) throw new Error("No se encontraron cabeceras de ítems");
  const headers = matrix[hdrIdx].map((h) => String(h).trim());
  const descCol = headers.findIndex(
    (h) => h.toLowerCase().includes("descripción") || h.toLowerCase().includes("descripcion"),
  );
  if (descCol < 0) throw new Error("Columna de descripción no encontrada");

  const descriptions = new Set<string>();
  for (let r = hdrIdx + 1; r < matrix.length; r++) {
    const row = matrix[r] ?? [];
    const d = String(row[descCol] ?? "").trim();
    if (d) descriptions.add(d);
  }

  const supplies = await storage.getSupplies(clientId);
  const active = supplies.filter((s: { active?: boolean }) => s.active !== false);

  return [...descriptions].sort().map((desc) => {
    let bestId: number | undefined;
    let bestName = "";
    let bestScore = 0;
    for (const s of active) {
      const sc = scoreSupplyMatch(desc, s.name);
      if (sc > bestScore) {
        bestScore = sc;
        bestId = s.id;
        bestName = s.name;
      }
    }
    const status: "auto" | "review" = bestScore >= AUTO_THRESHOLD ? "auto" : "review";
    return {
      descriptionOcr: desc,
      suggestedSupplyId: bestId,
      suggestedSupplyName: bestName || "",
      score: Math.round(bestScore * 10000) / 10000,
      status,
    };
  });
}

/** Lee la planilla "Revision_insumos" generada por precheck (formato=xlsx). */
function parseRevisionInsumosMapping(revisionBuffer: Buffer): Record<string, number> {
  const wb = XLSX.read(revisionBuffer, { type: "buffer" });
  const sh = wb.Sheets["Revision_insumos"] ?? wb.Sheets[wb.SheetNames[0]];
  if (!sh) throw new Error("Planilla de revisión vacía");

  const matrix = matrixFromSheet(sh);
  const hdrIdx = findRowWithCell(matrix, "Descripción");
  if (hdrIdx < 0) throw new Error('No se encontró la fila de cabeceras en "Revision_insumos"');

  const headers = matrix[hdrIdx].map((h) => String(h).trim());
  const idxDesc = headers.findIndex((h) => h.toLowerCase().includes("descripción"));
  const idxEstado = headers.findIndex((h) => h.toLowerCase() === "estado");
  const idxSug = headers.findIndex(
    (h) =>
      h.toLowerCase().includes("id") &&
      h.toLowerCase().includes("sugerido") &&
      !h.toLowerCase().includes("definitivo"),
  );
  const idxDef = headers.findIndex(
    (h) => h.toLowerCase().includes("id") && h.toLowerCase().includes("definitivo"),
  );

  if (idxDesc < 0 || idxEstado < 0 || idxSug < 0 || idxDef < 0) {
    throw new Error(
      "Columnas esperadas: Descripción, Estado, ID insumo sugerido, ID insumo definitivo (sin cambiar nombres de encabezado)",
    );
  }

  const mapping: Record<string, number> = {};
  for (let r = hdrIdx + 1; r < matrix.length; r++) {
    const row = matrix[r] ?? [];
    const desc = String(row[idxDesc] ?? "").trim();
    if (!desc) continue;

    const estado = String(row[idxEstado] ?? "").trim().toLowerCase();
    const defRaw = String(row[idxDef] ?? "").trim().replace(/\s/g, "");
    const sugRaw = String(row[idxSug] ?? "").trim().replace(/\s/g, "");

    const defNum = parseInt(defRaw, 10);
    const sugNum = parseInt(sugRaw, 10);

    let id: number | undefined;
    if (Number.isFinite(defNum) && defNum > 0) id = defNum;
    else if (estado === "auto" && Number.isFinite(sugNum) && sugNum > 0) id = sugNum;

    if (id) mapping[desc] = id;
  }

  return mapping;
}

function buildRevisionInsumosWorkbook(suggestions: SupplySuggestionRow[]): Buffer {
  const wb = XLSX.utils.book_new();

  const header = [
    "Descripción (texto exacto de la factura)",
    "Estado",
    "Score",
    "ID insumo sugerido",
    "Nombre insumo sugerido",
    "ID insumo definitivo",
  ];
  const rows: (string | number)[][] = [
    header,
    ...suggestions.map((s) => [
      s.descriptionOcr,
      s.status,
      s.score,
      s.suggestedSupplyId ?? "",
      s.suggestedSupplyName ?? "",
      "",
    ]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [{ wch: 52 }, { wch: 10 }, { wch: 8 }, { wch: 18 }, { wch: 42 }, { wch: 22 }];
  XLSX.utils.book_append_sheet(wb, ws, "Revision_insumos");

  const instr = [
    ["Dónde se cotejan los insumos"],
    [""],
    ["Esta hoja lista cada texto distinto que salió en las facturas (columna Descripción)."],
    ["El sistema propone un insumo (Score). Estado «auto» = alta confianza; «review» = revisar vos."],
    [""],
    ["Qué tenés que hacer vos"],
    ["• Filtrá Estado = review."],
    ["• Para cada una: poné en «ID insumo definitivo» el número de insumo correcto en Dataflow (como en el catálogo)."],
    ["• Si la sugerencia te sirve pero dice «review»: copiá el mismo valor de «ID insumo sugerido» a «ID insumo definitivo»."],
    ["• Si Estado = auto y estás de acuerdo: dejá «ID insumo definitivo» vacío."],
    ["• Si Estado = auto pero está mal: igual completá «ID insumo definitivo» con el id correcto."],
    [""],
    ["No cambies el texto de la primera columna (es la clave que usa el import)."],
    ["Guardá el archivo y subilo junto al Excel del parser en «commit» (campo revision)."],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(instr), "Instrucciones");

  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

export function registerBulkInvoiceImportRoutes(app: Express) {
  const uploadParserPlusRevision = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 55 * 1024 * 1024 },
  }).fields([
    { name: "file", maxCount: 1 },
    { name: "revision", maxCount: 1 },
  ]);

  /** Para la barra lateral / pantalla: siempre JSON 200 si hay sesión (sin tirar 403). */
  app.get("/api/admin/bulk-invoices/access", isAuthenticated, async (req, res) => {
    try {
      const r = await resolveBulkInvoiceAccess(req);
      if (!r.allowed) {
        return res.json({ allowed: false, message: r.message });
      }
      res.json({
        allowed: true,
        mode: r.mode,
        hint: r.hint,
      });
    } catch (e: any) {
      res.json({ allowed: false, message: e?.message ?? String(e) });
    }
  });

  app.post(
    "/api/admin/bulk-invoices/precheck-supplies",
    isAuthenticated,
    requireBulkInvoiceAdmin,
    upload.single("file"),
    async (req, res) => {
      try {
        if (!req.file?.buffer) return res.status(400).json({ message: "Falta archivo Excel (field file)" });
        const clientId = await getClientId(req);
        const suggestions = await computeSupplySuggestionsFromParserExcel(req.file.buffer, clientId);

        const wantXlsx = String(req.query.format ?? "").toLowerCase() === "xlsx";
        if (wantXlsx) {
          const buf = buildRevisionInsumosWorkbook(suggestions);
          res.setHeader(
            "Content-Type",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          );
          res.setHeader("Content-Disposition", 'attachment; filename="revision_insumos.xlsx"');
          return res.send(buf);
        }

        res.json({
          uniqueDescriptions: suggestions.length,
          suggestions,
          summary: {
            auto: suggestions.filter((s) => s.status === "auto").length,
            review: suggestions.filter((s) => s.status === "review").length,
          },
          hint: 'Para bajar la planilla de revisión: mismo POST con ?format=xlsx (descarga revision_insumos.xlsx)',
        });
      } catch (e: any) {
        res.status(500).json({ message: e.message ?? String(e) });
      }
    },
  );

  app.post(
    "/api/admin/bulk-invoices/commit",
    isAuthenticated,
    requireBulkInvoiceAdmin,
    uploadParserPlusRevision,
    async (req, res) => {
      try {
        const dryRun =
          String(req.query.dryRun ?? req.body?.dryRun ?? "").toLowerCase() === "true" ||
          String(req.query.dryRun ?? "").toLowerCase() === "1";

        const files = req.files as Record<string, Express.Multer.File[]> | undefined;
        const parserFile = files?.file?.[0];
        if (!parserFile?.buffer) return res.status(400).json({ message: "Falta Excel del parser (field file)" });

        let mapping: Record<string, number> = {};
        const revisionFile = files?.revision?.[0];
        if (revisionFile?.buffer) {
          try {
            mapping = parseRevisionInsumosMapping(revisionFile.buffer);
          } catch (e: any) {
            return res.status(400).json({ message: `Planilla revision: ${e.message}` });
          }
        } else {
          const rawMap = req.body?.supplyMappingJson ?? req.body?.mappingJson;
          if (typeof rawMap === "string" && rawMap.trim()) {
            try {
              mapping = JSON.parse(rawMap) as Record<string, number>;
            } catch {
              return res.status(400).json({ message: "supplyMappingJson no es JSON válido" });
            }
          } else {
            return res.status(400).json({
              message:
                "Falta la planilla de revisión de insumos (field revision = revision_insumos.xlsx). Opcional: supplyMappingJson solo si no usás Excel.",
            });
          }
        }

        const wb = XLSX.read(parserFile.buffer, { type: "buffer" });
        const shF = wb.Sheets["Facturas"];
        const shI = wb.Sheets["Items de Facturas"];
        const shT = wb.Sheets["Impuestos"];
        if (!shF || !shI) return res.status(400).json({ message: 'Faltan hojas "Facturas" o "Items de Facturas"' });

        const mf = matrixFromSheet(shF);
        const mi = matrixFromSheet(shI);
        const mt = shT ? matrixFromSheet(shT) : [];

        const hiF = findRowWithCell(mf, "Clave trabajo");
        const hiI = findRowWithCell(mi, "Clave trabajo");
        const hiT = mt.length ? findRowWithCell(mt, "Clave trabajo") : -1;

        if (hiF < 0 || hiI < 0) {
          return res.status(400).json({
            message:
              'Excel antiguo o incompleto: falta columna "Clave trabajo". Volvé a generar el archivo con factura_parser.py actualizado.',
          });
        }

        const headersF = mf[hiF].map((h) => String(h).trim());
        const headersI = mi[hiI].map((h) => String(h).trim());

        const invoicesRows: Record<string, string>[] = [];
        for (let r = hiF + 1; r < mf.length; r++) {
          const row = mf[r] ?? [];
          if (!row.some((c) => String(c).trim())) continue;
          const obj = rowToObj(headersF, row);
          if (!obj["Clave trabajo"]?.trim()) continue;
          if (obj.Error?.trim()) continue;
          invoicesRows.push(obj);
        }

        const itemsRows: Record<string, string>[] = [];
        for (let r = hiI + 1; r < mi.length; r++) {
          const row = mi[r] ?? [];
          if (!row.some((c) => String(c).trim())) continue;
          const obj = rowToObj(headersI, row);
          if (!obj["Clave trabajo"]?.trim()) continue;
          itemsRows.push(obj);
        }

        const taxesByJob = new Map<
          string,
          Array<{ name: string; pct: number; amount: number }>
        >();
        if (hiT >= 0) {
          const headersT = mt[hiT].map((h) => String(h).trim());
          const idxNombre = headersT.findIndex((h) => h.toLowerCase().includes("nombre"));
          const idxPct = headersT.findIndex((h) => h.includes("%"));
          const idxImp = headersT.findIndex((h) => h.toLowerCase().includes("importe"));
          for (let r = hiT + 1; r < mt.length; r++) {
            const row = mt[r] ?? [];
            if (!row.some((c) => String(c).trim())) continue;
            const o = rowToObj(headersT, row);
            const job = o["Clave trabajo"]?.trim();
            if (!job) continue;
            const nm = idxNombre >= 0 ? String(row[idxNombre] ?? "").trim() : "";
            const pctRaw = idxPct >= 0 ? String(row[idxPct] ?? "").trim() : "";
            const amtRaw = idxImp >= 0 ? String(row[idxImp] ?? "").trim() : "";
            const amount = parseMoneyAr(amtRaw);
            const pctNum = parseMoneyAr(pctRaw.replace("%", ""));
            const pct = Number.isFinite(pctNum) ? pctNum : NaN;
            const arr = taxesByJob.get(job) ?? [];
            arr.push({ name: nm, pct, amount });
            taxesByJob.set(job, arr);
          }
        }

        const itemsByJob = new Map<string, Record<string, string>[]>();
        for (const it of itemsRows) {
          const k = it["Clave trabajo"].trim();
          const arr = itemsByJob.get(k) ?? [];
          arr.push(it);
          itemsByJob.set(k, arr);
        }

        const clientId = await getClientId(req);
        const localId = await resolveFelisaLocalId(clientId);
        const clientTaxes = await storage.getTaxes(clientId);
        const taxesById = new Map(clientTaxes.map((t) => [t.id, t]));

        const voucherSeen = new Set<string>();
        const created: any[] = [];
        const skipped: string[] = [];
        const errors: string[] = [];

        const session = req.session as any;
        const createdBy = session?.userId ? String(session.userId) : undefined;

        for (const inv of invoicesRows) {
          const jobKey = inv["Clave trabajo"].trim();
          const estado = inv["Estado Pago"]?.trim().toUpperCase();
          const cuitRaw = inv["CUIT"] ?? "";
          const pv = normalizeInvoiceSalePoint(inv["Punto Venta"]);
          const num = normalizeInvoiceNumber(inv["Nro Comprobante"]);
          const cuitDigits = digitsOnly(cuitRaw);
          const voucherKey = `${cuitDigits}|${pv}|${num}`;

          try {
            if (!pv || !num || cuitDigits.length < 11) {
              errors.push(`${jobKey}: PV/número/CUIT inválidos`);
              continue;
            }
            if (voucherSeen.has(voucherKey)) {
              skipped.push(`${jobKey}: duplicado mismo comprobante (${voucherKey})`);
              continue;
            }
            voucherSeen.add(voucherKey);

            let supplier = await findSupplierByFlexibleCuit(clientId, cuitRaw);
            if (!supplier) {
              if (dryRun) {
                supplier = {
                  id: 0,
                  tradeName: inv["Nombre Comercial"] || inv["Razón Social"] || "Proveedor OCR",
                  paymentDays: 7,
                } as any;
              } else {
                supplier = await storage.createSupplier({
                  clientId,
                  tradeName: (inv["Nombre Comercial"] || inv["Razón Social"] || "Proveedor OCR").slice(0, 255),
                  businessName: (inv["Razón Social"] || inv["Nombre Comercial"] || "").slice(0, 255) || null,
                  cuit: formatCuitAr(cuitDigits),
                  rubroId: null,
                  ivaCondition: normalizeIvaForInvoice(
                    inv["Cond. IVA proveedor (Dataflow)"] || inv["Cond. IVA (texto OCR)"],
                  ),
                  email: "",
                  phone: "",
                  address: "",
                  paymentDays: 7,
                  active: true,
                });
              }
            }

            const invoiceDateIso =
              parseEsDateToIso(inv["Fecha Emisión"]) ??
              (() => {
                throw new Error("Fecha emisión inválida");
              })();

            const tipoCode = mapTipoComprobanteToCode(inv["Tipo Comprobante"]);
            const ivaCond = normalizeIvaForInvoice(
              inv["Cond. IVA proveedor (Dataflow)"] || inv["Cond. IVA (texto OCR)"],
            );

            const lines = itemsByJob.get(jobKey) ?? [];
            if (!lines.length) {
              errors.push(`${jobKey}: sin ítems`);
              continue;
            }

            const rawItems: Array<Record<string, unknown>> = [];
            for (const line of lines) {
              const desc = (line["Descripción Ítem"] || line["Descripción Item"] || "").trim();
              const supplyId = mapping[desc];
              if (!supplyId || !Number.isFinite(Number(supplyId))) {
                errors.push(`${jobKey}: falta mapping de insumo para "${desc.slice(0, 80)}"`);
                rawItems.length = 0;
                break;
              }
              const qty = parseMoneyAr(line["Cantidad"]);
              const unit = parseMoneyAr(line["Precio Unitario"]);
              const sub = parseMoneyAr(line["Subtotal Ítem"] || line["Subtotal Item"]);
              let quantity = qty;
              let unitPrice = unit;
              let subtotal = sub;
              if (!Number.isFinite(subtotal) || subtotal <= 0) {
                errors.push(`${jobKey}: subtotal inválido línea "${desc.slice(0, 40)}"`);
                rawItems.length = 0;
                break;
              }
              if (!Number.isFinite(quantity) || quantity <= 0) {
                quantity = 1;
                unitPrice = subtotal;
              } else if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
                unitPrice = subtotal / quantity;
              }
              rawItems.push({
                supplyId: Number(supplyId),
                description: desc,
                quantity,
                unitPrice,
                subtotal,
              });
            }
            if (!rawItems.length) continue;

            const impRows = taxesByJob.get(jobKey) ?? [];
            let taxIdPick: number | undefined;
            for (const ir of impRows) {
              const nm = stripDiacriticsLower(ir.name);
              if (nm.includes("iva") && Number.isFinite(ir.pct)) {
                taxIdPick = pickIvaTaxId(clientTaxes, ir.pct);
                break;
              }
            }
            if (!taxIdPick) taxIdPick = pickIvaTaxId(clientTaxes, 21);

            const invoiceLevelTaxes = taxIdPick ? [{ taxId: taxIdPick, baseAmount: 0, taxAmount: 0 }] : [];

            const discount = parseMoneyAr(inv["Descuento"]);
            const discountNum = Number.isFinite(discount) && discount > 0 ? discount : 0;

            const taxComputation = computeInvoiceTaxes({
              items: rawItems,
              discount: discountNum,
              invoiceLevelTaxes,
              taxesById,
            });

            const advancePayment = 0;
            const total = taxComputation.subtotalAfterDiscount + taxComputation.taxGrandTotal;
            const balance = total - advancePayment;

            const invoiceDate = new Date(invoiceDateIso);
            const paymentDays = Number(supplier.paymentDays ?? 7) || 7;
            const dueDate = new Date(invoiceDate);
            dueDate.setDate(dueDate.getDate() + paymentDays);

            if (supplier.id > 0) {
              const dup = await storage.getInvoiceByVoucherComposite(clientId, supplier.id, pv, num);
              if (dup) {
                skipped.push(`${jobKey}: ya existe factura PV ${pv} N° ${num} proveedor ${supplier.id}`);
                voucherSeen.delete(voucherKey);
                continue;
              }
            }

            if (dryRun) {
              created.push({
                jobKey,
                supplierId: supplier.id,
                voucher: `${pv}-${num}`,
                invoiceDate: invoiceDateIso,
                estadoPago: estado,
                items: rawItems.length,
                total,
              });
              continue;
            }

            const persistedTaxRows = taxComputation.rows.map((r) => ({
              taxId: r.taxId,
              baseAmount: String(r.baseAmount),
              taxAmount: String(r.taxAmount),
            }));

            const normalizedItems = rawItems.map((item) => ({ ...item }));

            const newInvoice = await storage.createInvoice(
              {
                clientId,
                localId,
                supplierId: supplier.id,
                invoiceSalePoint: pv,
                invoiceNumber: num,
                invoiceType: tipoCode,
                invoiceDate: invoiceDateIso,
                dueDate: dueDate.toISOString().split("T")[0],
                ivaCondition: ivaCond,
                expenseType: "cmv",
                discount: String(discountNum),
                advancePayment: "0",
                subtotal: String(taxComputation.itemsSubtotal),
                taxTotal: String(taxComputation.taxGrandTotal),
                total: String(total),
                balance: String(balance),
                notes: `Import OCR · ${jobKey}`,
                createdBy,
              } as any,
              normalizedItems as any,
              persistedTaxRows as any,
            );

            created.push({ invoiceId: newInvoice.id, jobKey, voucher: `${pv}-${num}` });

            if (estado === "PAGADA") {
              await storage.createPaymentWithAllocations(
                {
                  clientId,
                  localId,
                  supplierId: supplier.id,
                  bankAccountId: null,
                  paymentNumber: null,
                  paymentDate: invoiceDateIso,
                  paymentMethod: "efectivo",
                  amount: String(balance),
                  notes: `Pago automático import OCR · ${jobKey}`,
                  createdBy,
                } as any,
                [{ invoiceId: newInvoice.id, amount: balance }],
              );
            }
          } catch (e: any) {
            errors.push(`${jobKey}: ${e?.message ?? String(e)}`);
          }
        }

        res.json({
          dryRun,
          processedInvoiceRows: invoicesRows.length,
          createdCount: created.length,
          skipped,
          errors,
          created,
        });
      } catch (e: any) {
        res.status(500).json({ message: e.message ?? String(e) });
      }
    },
  );
}
