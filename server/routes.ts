import type { Express } from "express";
import express from "express";
import { type Server } from "http";
import { storage } from "./storage";
import { setupAuth, isAuthenticated as isAuthenticatedOIDC } from "./replitAuth";
import { setupLocalAuth, isAuthenticatedLocal } from "./auth";
import multer from "multer";
import * as XLSX from "xlsx";
import { z } from "zod";
import {
  getAvailableBanks,
} from "./bankParsers";
import { seedFinancialDataForClient } from "./seedFinancialData";
import path from "path";
import { randomUUID, randomBytes } from "crypto";
import { gzipSync } from "zlib";
import { runBankStatementImport } from "./bankStatementImport";
import { processFinancialImportJobBody } from "./processFinancialImportJob";
import type {
  InsertBankAccount,
  InsertFinancialSavedView,
  InsertBusinessName,
  InsertCounterparty,
  InsertCounterpartyIdentifier,
  User,
} from "@shared/schema";
import { computeInvoiceTaxes } from "@shared/invoiceTaxComputation";
import { registerBulkInvoiceImportRoutes } from "./routesBulkInvoiceImport";
import { db } from "./db";
import { users, userCredentials, clients } from "@shared/schema";
import type { InsertTransaction } from "@shared/schema";
import { eq } from "drizzle-orm";
import { hashPassword } from "./auth";
import { isMailConfigured, sendMail, getAppPublicUrl } from "./sendMail";

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }
});

/** Campos de multipart + fallback query (Netlify/serverless a veces no rellena req.body igual que en Node local). */
function pickMultipartOrQueryString(req: any, key: string): string | undefined {
  const fromBody = req.body?.[key];
  if (fromBody !== undefined && fromBody !== null) {
    if (Array.isArray(fromBody)) return fromBody[0] != null ? String(fromBody[0]) : undefined;
    return String(fromBody);
  }
  const q = req.query?.[key];
  if (q === undefined || q === null) return undefined;
  if (Array.isArray(q)) return q[0] != null ? String(q[0]) : undefined;
  return String(q);
}

/** Overrides JSON en multipart: `{ "234": 5352.48 }` montos brutos por fila Excel (Mercado Pago). */
function parseMpGrossOverridesFromRequest(req: any): Record<string, number> {
  const raw = pickMultipartOrQueryString(req, "mpGrossOverrides");
  if (!raw?.trim()) return {};
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(o)) {
      const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
      if (Number.isFinite(n)) out[String(k)] = n;
    }
    return out;
  } catch {
    return {};
  }
}

/** Si la cuenta no tiene bank_id en BD, deducimos el parser por el nombre (evita bankSource "generic" y pestaña MP vacía). */
function inferBankIdFromAccountName(name: string | null | undefined): string | undefined {
  if (!name || typeof name !== "string") return undefined;
  const n = name.toLowerCase();
  if (n.includes("mercado pago") || n.includes("mercadopago")) return "mercadopago";
  if (n.includes("galicia")) return "galicia";
  if (n.includes("bbva")) return "bbva";
  if (n.includes("francés") || n.includes("frances")) return "frances";
  if (n.includes("santander")) return "santander";
  return undefined;
}

const updateTransactionSchema = z.object({
  categoryId: z.union([
    z.coerce.number().int().positive(),
    z.null(),
    z.literal("none"),
    z.literal(""),
  ]).optional().transform(val => {
    if (val === "none" || val === null || val === "" || val === undefined) return null;
    if (typeof val === "number" && val > 0) return val;
    return null;
  }),
  localId: z.union([
    z.coerce.number().int().positive(),
    z.null(),
  ]).optional().transform(val => {
    if (val === null || val === undefined) return val;
    if (typeof val === "number" && val > 0) return val;
    return null;
  }),
  invoiced: z.union([z.boolean(), z.coerce.boolean()]).optional(),
  cashRegisterId: z.union([
    z.coerce.number().int().positive(),
    z.null(),
    z.literal("none"),
    z.literal(""),
  ]).optional().transform(val => {
    if (val === "none" || val === null || val === "" || val === undefined) return null;
    if (typeof val === "number" && val > 0) return val;
    return null;
  }),
  transactionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  description: z.string().trim().min(1).max(2000).optional(),
  type: z.enum(["income", "expense"]).optional(),
  amount: z.coerce.number().positive().max(1e14).optional(),
}).strict();

const cashMovementRowSchema = z.object({
  transactionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().trim().min(1).max(2000),
  categoryId: z.union([z.coerce.number().int().positive(), z.null()]).optional().transform((v) => v ?? null),
  localId: z
    .union([z.coerce.number().int().positive(), z.null(), z.literal(""), z.literal("none")])
    .optional()
    .transform((v) => (v === "" || v === "none" || v === undefined || v === null ? null : v)),
  cashRegisterId: z
    .union([z.coerce.number().int().positive(), z.null(), z.literal(""), z.literal("none")])
    .optional()
    .transform((v) => (v === "" || v === "none" || v === undefined || v === null ? null : v)),
  type: z.enum(["income", "expense"]),
  amount: z.coerce.number().positive().max(1e14),
});

const cashBatchBodySchema = z
  .object({
    items: z.array(cashMovementRowSchema).min(1).max(5000),
  })
  .strict();

const createBankAccountBodySchema = z.object({
  name: z.string().min(1),
  type: z.string().max(50).optional(),
  accountType: z.string().max(20).optional(),
  accountNumber: z.string().max(100).optional(),
  localId: z.union([z.coerce.number().int().positive(), z.null()]).optional(),
    bankId: z.string().max(50).optional(),
  clientBankId: z.union([z.coerce.number().int().positive(), z.null()]).optional(),
  businessNameId: z.union([z.coerce.number().int().positive(), z.null()]).optional(),
  openingBalance: z.union([z.coerce.number(), z.null()]).optional(),
  active: z.boolean().optional(),
});

const patchBankAccountBodySchema = z
  .object({
    name: z.string().min(1).optional(),
    type: z.string().max(50).optional(),
    accountType: z.string().max(20).optional(),
    accountNumber: z.string().max(100).optional(),
    localId: z.union([z.coerce.number().int().positive(), z.null()]).optional(),
      bankId: z.string().max(50).optional(),
    clientBankId: z.union([z.coerce.number().int().positive(), z.null()]).optional(),
    businessNameId: z.union([z.coerce.number().int().positive(), z.null()]).optional(),
    openingBalance: z.union([z.coerce.number(), z.null()]).optional(),
    active: z.boolean().optional(),
  })
  .strict();

const financialSavedViewFiltersSchema = z.object({
  bankFilter: z.string(),
  accountContextFilter: z.string(),
  filterTab: z.enum(["all", "uncategorized", "categorized"]),
});

const postFinancialSavedViewSchema = z.object({
  name: z.string().min(1).max(255),
  filters: financialSavedViewFiltersSchema,
});

async function getClientId(req: any): Promise<number> {
  const session = req.session as any;
  if (session?.userId) {
    const client = await storage.getClientByUserId(session.userId);
    if (!client) throw new Error("Client not found");
    return client.id;
  }
  
  const user = req.user as any;
  if (!user?.claims?.sub) throw new Error("User not authenticated");
  
  // First try by claim sub (Replit Auth ID)
  let client = await storage.getClientByUserId(user.claims.sub);
  
  // If not found, try to find user by email and get their client
  if (!client && user.claims.email) {
    const dbUser = await storage.getUserByEmail(user.claims.email);
    if (dbUser) {
      client = await storage.getClientByUserId(dbUser.id);
    }
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

type TeamPrivileged = { ok: true; clientId: number; actorId: string } | { ok: false };

async function assertTeamPrivileged(req: any, res: any): Promise<TeamPrivileged> {
  const actorId = await getAuthenticatedUserId(req);
  if (!actorId) {
    res.status(401).json({ message: "No autenticado" });
    return { ok: false };
  }
  let clientId: number;
  try {
    clientId = await getClientId(req);
  } catch {
    res.status(400).json({ message: "No encontramos la empresa asociada a tu usuario." });
    return { ok: false };
  }
  const roleRaw = await storage.getUserRoleInClient(actorId, clientId);
  const role = String(roleRaw ?? "").trim().toLowerCase();
  const privilegedRoles = new Set(["socio", "admin", "manager"]);
  if (!privilegedRoles.has(role)) {
    res.status(403).json({
      message: "Solo Socio, Administrador o Gerente puede gestionar equipo e invitaciones por correo.",
    });
    return { ok: false };
  }
  return { ok: true, clientId, actorId };
}

type PermissionAction = "view" | "create" | "edit" | "delete";

/**
 * Middleware factory de RBAC granular. Usar SIEMPRE después de `isAuthenticated`.
 * Resuelve el rol del usuario en su empresa y valida el flag (`canView/canCreate/canEdit/canDelete`)
 * del permiso `code` contra `role_permissions`. El socio siempre pasa (override en storage).
 *
 * Pensado para endpoints NUEVOS: no se aplica a rutas existentes para no alterar accesos vigentes.
 */
function requirePermission(code: string, action: PermissionAction = "view") {
  return async (req: any, res: any, next: any) => {
    const actorId = await getAuthenticatedUserId(req);
    if (!actorId) {
      return res.status(401).json({ message: "No autenticado" });
    }
    let clientId: number;
    try {
      clientId = await getClientId(req);
    } catch {
      return res.status(400).json({ message: "No encontramos la empresa asociada a tu usuario." });
    }
    const role = String((await storage.getUserRoleInClient(actorId, clientId)) ?? "")
      .trim()
      .toLowerCase();
    let allowed = false;
    try {
      allowed = await storage.getEffectivePermission(clientId, role, code, action);
    } catch {
      return res.status(500).json({ message: "Error verificando permisos" });
    }
    if (!allowed) {
      return res.status(403).json({
        message: `No tenés permiso para esta acción (${code}:${action}).`,
      });
    }
    // Exponer el contexto resuelto para que el handler no recompute clientId/role.
    (req as any).rbac = { clientId, actorId, role };
    return next();
  };
}

function generateProvisionalPassword(): string {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(14);
  let s = "";
  for (let i = 0; i < 12; i++) {
    s += chars[bytes[i]! % chars.length];
  }
  return s;
}

const inviteTeamMemberBodySchema = z.object({
  email: z.string().email("Email inválido"),
  role: z.string().trim().max(50).optional(),
  firstName: z.string().trim().max(100).optional(),
  lastName: z.string().trim().max(100).optional(),
});

const TEAM_ROLES = new Set(["socio", "admin", "manager", "encargado", "employee", "viewer"]);

function normalizeTeamRole(raw: unknown): string {
  const r = String(raw ?? "encargado").trim().toLowerCase();
  return TEAM_ROLES.has(r) ? r : "encargado";
}

async function sendTeamWelcomeEmail(opts: {
  to: string;
  provisionalPassword: string;
  companyName?: string | null;
}): Promise<void> {
  const loginUrl = `${getAppPublicUrl()}/auth`;
  const subject = "Bienvenido a Dataflow — credenciales de acceso";
  const textLines = [
    "Hola,",
    "",
    `Te dieron acceso${opts.companyName ? ` a «${opts.companyName}»` : " a tu empresa"} en Dataflow.`,
    "",
    `Contraseña provisoria: ${opts.provisionalPassword}`,
    "Al iniciar sesión vas a tener que cambiar esta contraseña por una propia.",
    "",
    `Ingresá aquí: ${loginUrl}`,
    "",
    "Si no esperabas este correo, podés ignorar este mensaje.",
  ];
  await sendMail({ to: opts.to, subject, text: textLines.join("\n") });
}

const isAuthenticated = (req: any, res: any, next: any) => {
  const session = req.session as any;
  if (session?.userId) {
    return next();
  }
  return isAuthenticatedOIDC(req, res, next);
};

/**
 * Construye y crea una factura desde el payload crudo (ítems + taxes), computando IVA/totales.
 * Reutilizado por POST /api/invoices y por la corrección de facturas. Lanza Error con
 * `statusCode` 400 si ya existe el comprobante (mismo PV+número+proveedor).
 */
async function prepareAndCreateInvoice(clientId: number, body: any) {
  const { items: rawItems, taxes: rawInvoiceTaxes, ...invoice } = body;
  const items = Array.isArray(rawItems) ? rawItems : [];
  const invoiceLevelTaxes = Array.isArray(rawInvoiceTaxes) ? rawInvoiceTaxes : [];

  const salePoint = String(invoice.invoiceSalePoint ?? "").trim();
  const voucherNum = String(invoice.invoiceNumber ?? "").trim();
  if (salePoint && voucherNum && invoice.supplierId) {
    const existing = await storage.getInvoiceByVoucherComposite(clientId, invoice.supplierId, salePoint, voucherNum);
    if (existing) {
      const err: any = new Error("Ya existe una factura con ese punto de venta y numero para este proveedor");
      err.statusCode = 400;
      throw err;
    }
  }

  const allTaxes = await storage.getTaxes(clientId);
  const taxesById = new Map(allTaxes.map((t) => [t.id, t]));
  const taxComputation = computeInvoiceTaxes({
    items,
    discount: parseFloat(String(invoice.discount ?? 0)) || 0,
    invoiceLevelTaxes,
    taxesById,
  });

  const advancePayment = parseFloat(String(invoice.advancePayment ?? 0)) || 0;
  const total = taxComputation.subtotalAfterDiscount + taxComputation.taxGrandTotal;
  const balance = total - advancePayment;

  const invoiceDate = new Date(invoice.invoiceDate);
  const paymentDays = invoice.paymentDays || 0;
  const dueDate = new Date(invoiceDate);
  dueDate.setDate(dueDate.getDate() + paymentDays);

  const normalizedItems = items.map((item: Record<string, unknown>) => {
    const tid = item.taxId;
    let taxId: number | undefined;
    if (tid !== undefined && tid !== null && tid !== "") {
      const n = typeof tid === "number" ? tid : parseInt(String(tid), 10);
      taxId = Number.isFinite(n) && n > 0 ? n : undefined;
    }
    return { ...item, taxId };
  });

  const persistedTaxRows = taxComputation.rows.map((r) => ({
    taxId: r.taxId,
    baseAmount: String(r.baseAmount),
    taxAmount: String(r.taxAmount),
  }));

  return await storage.createInvoice(
    {
      ...invoice,
      clientId,
      invoiceSalePoint: salePoint,
      invoiceNumber: voucherNum,
      dueDate: dueDate.toISOString().split("T")[0],
      subtotal: String(taxComputation.itemsSubtotal),
      discount: String(parseFloat(String(invoice.discount ?? 0)) || 0),
      taxTotal: String(taxComputation.taxGrandTotal),
      total: String(total),
      balance: String(balance),
    },
    normalizedItems as unknown as Parameters<typeof storage.createInvoice>[1],
    persistedTaxRows as unknown as Parameters<typeof storage.createInvoice>[2],
  );
}

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

  app.get("/api/health", (_req, res) => {
    res.status(200).json({ status: "ok", timestamp: Date.now() });
  });

  await setupLocalAuth(app);
  await setupAuth(app);

  app.get("/api/auth/user", async (req, res) => {
    const session = req.session as any;
    const withFlags = async (dbUser: User) => {
      const flags = await storage.getUserCredentialsFlags(dbUser.id);
      return { ...dbUser, mustChangePassword: Boolean(flags?.mustChangePassword) };
    };

    if (session?.userId) {
      const dbUser = await storage.getUser(session.userId);
      return res.json(dbUser ? await withFlags(dbUser) : null);
    }

    const user = req.user as any;
    if (!user?.claims?.sub) {
      return res.json(null);
    }

    let dbUser = await storage.getUser(user.claims.sub);

    if (!dbUser && user.claims.email) {
      dbUser = await storage.getUserByEmail(user.claims.email);
    }

    res.json(dbUser ? await withFlags(dbUser) : null);
  });

  /** Empresa (cliente multi-tenant) asociada al usuario autenticado — para branding en UI. */
  app.get("/api/auth/organization", async (req, res) => {
    try {
      const session = req.session as any;
      if (session?.userId) {
        const client = await storage.getClientByUserId(session.userId);
        return res.json(client ? { id: client.id, name: client.name } : null);
      }
      const user = req.user as any;
      if (!user?.claims?.sub) {
        return res.json(null);
      }
      let client = await storage.getClientByUserId(user.claims.sub);
      if (!client && user.claims?.email) {
        const dbUser = await storage.getUserByEmail(user.claims.email);
        if (dbUser) {
          client = await storage.getClientByUserId(dbUser.id);
        }
      }
      res.json(client ? { id: client.id, name: client.name } : null);
    } catch {
      res.json(null);
    }
  });

  app.get("/api/locals", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.getLocals(clientId);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/locals", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.createLocal({ ...req.body, clientId });
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/locals/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.updateLocal(clientId, parseInt(req.params.id), req.body);
      if (!data) return res.status(404).json({ message: "Local not found or access denied" });
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/locals/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const deleted = await storage.deleteLocal(clientId, parseInt(req.params.id));
      if (!deleted) return res.status(404).json({ message: "Local not found or access denied" });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/local-aliases", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.getLocalAliases(clientId);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/local-aliases", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const { localId, alias, source } = req.body;
      
      if (!localId || !alias) {
        return res.status(400).json({ message: "Se requiere localId y alias" });
      }
      
      const existing = await storage.getLocalAliasByName(clientId, alias);
      if (existing) {
        return res.status(400).json({ message: "Ya existe un alias con ese nombre" });
      }
      
      const data = await storage.createLocalAlias({ 
        clientId, 
        localId, 
        alias, 
        source: source || "mercadopago" 
      });
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/local-aliases/bulk", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const { mappings } = req.body;
      
      if (!Array.isArray(mappings)) {
        return res.status(400).json({ message: "Se requiere un array de mappings" });
      }
      
      const created: any[] = [];
      const errors: string[] = [];
      
      for (const mapping of mappings) {
        const { localId, alias, source } = mapping;
        if (!localId || !alias) continue;
        
        try {
          const existing = await storage.getLocalAliasByName(clientId, alias);
          if (!existing) {
            const newAlias = await storage.createLocalAlias({ 
              clientId, 
              localId, 
              alias, 
              source: source || "mercadopago" 
            });
            created.push(newAlias);
          }
        } catch (err: any) {
          errors.push(`${alias}: ${err.message}`);
        }
      }
      
      res.json({ created: created.length, errors });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/local-aliases/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const deleted = await storage.deleteLocalAlias(clientId, parseInt(req.params.id));
      if (!deleted) return res.status(404).json({ message: "Alias not found or access denied" });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/suppliers", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.getSuppliers(clientId);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/suppliers", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const { cuit } = req.body;
      
      if (cuit) {
        const existing = await storage.getSupplierByCuit(clientId, cuit);
        if (existing) {
          return res.status(400).json({ message: "Ya existe un proveedor con ese CUIT" });
        }
      }
      
      const data = await storage.createSupplier({ ...req.body, clientId });
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/suppliers/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const supplierId = parseInt(req.params.id);
      const { cuit } = req.body;
      
      if (cuit) {
        const existing = await storage.getSupplierByCuit(clientId, cuit);
        if (existing && existing.id !== supplierId) {
          return res.status(400).json({ message: "Ya existe otro proveedor con ese CUIT" });
        }
      }
      
      const data = await storage.updateSupplier(clientId, supplierId, req.body);
      if (!data) return res.status(404).json({ message: "Supplier not found or access denied" });
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/suppliers/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const supplierId = parseInt(req.params.id);

      // Antes de borrar, verificamos si tiene facturas asociadas
      const allInvoices = await storage.getInvoices(clientId);
      const hasInvoices = allInvoices.some((inv: any) => inv.supplierId === supplierId);

      if (hasInvoices) {
        return res.status(400).json({
          message:
            "No se puede eliminar el proveedor porque tiene facturas asociadas. " +
            "Anula o reasigna primero esas facturas.",
        });
      }

      const deleted = await storage.deleteSupplier(clientId, supplierId);
      if (!deleted) return res.status(404).json({ message: "Supplier not found or access denied" });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/suppliers/export", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const suppliers = await storage.getSuppliers(clientId);
      
      const exportData = suppliers.map(s => ({
        "Nombre Comercial": s.tradeName || "",
        "Razon Social": s.businessName || "",
        "CUIT": s.cuit || "",
        "Condicion IVA": s.ivaCondition || "",
        "Email": s.email || "",
        "Telefono": s.phone || "",
        "Direccion": s.address || "",
        "Dias de Pago": s.paymentDays || 0,
        "Activo": s.active ? "Si" : "No",
      }));
      
      const worksheet = XLSX.utils.json_to_sheet(exportData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Proveedores");
      
      const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

      // JSON+base64: evita corrupción binaria en Netlify/serverless (ZIP interno del .xlsx).
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.json({
        fileName: "proveedores.xlsx",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        data: Buffer.from(buffer as Uint8Array).toString("base64"),
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/suppliers/import", isAuthenticated, upload.single("file"), async (req, res) => {
    try {
      const clientId = await getClientId(req);
      
      if (!req.file) {
        return res.status(400).json({ message: "No se proporciono archivo" });
      }
      
      let workbook: XLSX.WorkBook;
      try {
        workbook = XLSX.read(req.file.buffer, { type: "buffer" });
      } catch (err: any) {
        return res.status(400).json({
          message:
            "El archivo no es un Excel (.xlsx) válido o está corrupto. " +
            "Si lo exportaste desde Data Flow y Excel no lo abre, re-exportá desde la versión más nueva. " +
            `Detalle: ${err?.message || String(err)}`,
        });
      }
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const rawData = XLSX.utils.sheet_to_json(sheet) as any[];
      
      let imported = 0;
      let errors: string[] = [];
      
      for (const row of rawData) {
        try {
          const tradeName = row["Nombre Comercial"] || row["nombre_comercial"] || row["tradeName"];
          if (!tradeName) {
            errors.push("Fila sin nombre comercial");
            continue;
          }
          
          const supplierData = {
            clientId,
            tradeName,
            businessName: row["Razon Social"] || row["razon_social"] || row["businessName"] || null,
            cuit: row["CUIT"] || row["cuit"] || null,
            ivaCondition: row["Condicion IVA"] || row["condicion_iva"] || row["ivaCondition"] || null,
            email: row["Email"] || row["email"] || null,
            phone: row["Telefono"] || row["telefono"] || row["phone"] || null,
            address: row["Direccion"] || row["direccion"] || row["address"] || null,
            paymentDays: parseInt(row["Dias de Pago"] || row["dias_pago"] || row["paymentDays"]) || 0,
          };
          
          if (supplierData.cuit) {
            const existing = await storage.getSupplierByCuit(clientId, supplierData.cuit);
            if (existing) {
              errors.push(`CUIT ${supplierData.cuit} ya existe`);
              continue;
            }
          }
          
          await storage.createSupplier(supplierData);
          imported++;
        } catch (err: any) {
          errors.push(err.message);
        }
      }
      
      res.json({ imported, total: rawData.length, errors: errors.slice(0, 10) });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/rubros", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.getRubros(clientId);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/rubros", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.createRubro({ ...req.body, clientId });
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/rubros/export", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const rubros = await storage.getRubros(clientId);
      
      const exportData = rubros.map(r => ({
        "Nombre": r.name,
        "Descripcion": r.description || "",
      }));
      
      const worksheet = XLSX.utils.json_to_sheet(exportData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Rubros");
      
      const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

      // JSON+base64: evita corrupción binaria en Netlify/serverless (ZIP interno del .xlsx).
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.json({
        fileName: "rubros.xlsx",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        data: Buffer.from(buffer as Uint8Array).toString("base64"),
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/rubros/import", isAuthenticated, upload.single("file"), async (req, res) => {
    try {
      const clientId = await getClientId(req);
      
      if (!req.file) {
        return res.status(400).json({ message: "No se proporciono archivo" });
      }
      
      let workbook: XLSX.WorkBook;
      try {
        workbook = XLSX.read(req.file.buffer, { type: "buffer" });
      } catch (err: any) {
        return res.status(400).json({
          message:
            "El archivo no es un Excel (.xlsx) válido o está corrupto. " +
            `Detalle: ${err?.message || String(err)}`,
        });
      }
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const rawData = XLSX.utils.sheet_to_json(sheet) as any[];

      let imported = 0;
      let errors: string[] = [];

      for (const row of rawData) {
        try {
          const name = row["Nombre"] || row["nombre"] || row["name"];
          if (!name) {
            errors.push("Fila sin nombre");
            continue;
          }
          
          await storage.createRubro({
            clientId,
            name,
            description: row["Descripcion"] || row["descripcion"] || row["description"] || null,
          });
          imported++;
        } catch (err: any) {
          errors.push(err.message);
        }
      }
      
      res.json({ imported, total: rawData.length, errors: errors.slice(0, 10) });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/rubros/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.updateRubro(clientId, parseInt(req.params.id), req.body);
      if (!data) return res.status(404).json({ message: "Rubro not found or access denied" });
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/rubros/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const deleted = await storage.deleteRubro(clientId, parseInt(req.params.id));
      if (!deleted) return res.status(404).json({ message: "Rubro not found or access denied" });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Sub-Rubros endpoints
  const createSubRubroSchema = z.object({
    rubroId: z.coerce.number().int().positive("Debe seleccionar un rubro"),
    name: z.string().min(1, "El nombre es requerido"),
    description: z.string().optional(),
    active: z.boolean().optional().default(true),
  });

  const updateSubRubroSchema = z.object({
    rubroId: z.coerce.number().int().positive().optional(),
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    active: z.boolean().optional(),
  });

  app.get("/api/sub-rubros", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.getSubRubros(clientId);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/sub-rubros", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const parsed = createSubRubroSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0]?.message || "Datos invalidos" });
      }
      
      const rubros = await storage.getRubros(clientId);
      const rubroExists = rubros.some(r => r.id === parsed.data.rubroId);
      if (!rubroExists) {
        return res.status(400).json({ message: "El rubro seleccionado no existe o no tiene permisos" });
      }
      
      const data = await storage.createSubRubro({ ...parsed.data, clientId });
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/sub-rubros/by-rubro/:rubroId", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.getSubRubrosByRubro(clientId, parseInt(req.params.rubroId));
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/sub-rubros/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const parsed = updateSubRubroSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0]?.message || "Datos invalidos" });
      }
      
      if (parsed.data.rubroId) {
        const rubros = await storage.getRubros(clientId);
        const rubroExists = rubros.some(r => r.id === parsed.data.rubroId);
        if (!rubroExists) {
          return res.status(400).json({ message: "El rubro seleccionado no existe o no tiene permisos" });
        }
      }
      
      const data = await storage.updateSubRubro(clientId, parseInt(req.params.id), parsed.data);
      if (!data) return res.status(404).json({ message: "Sub-Rubro not found or access denied" });
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/sub-rubros/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const deleted = await storage.deleteSubRubro(clientId, parseInt(req.params.id));
      if (!deleted) return res.status(404).json({ message: "Sub-Rubro not found or access denied" });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/taxes", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.getTaxes(clientId);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/taxes", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.createTax({ ...req.body, clientId });
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/taxes/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.updateTax(clientId, parseInt(req.params.id), req.body);
      if (!data) return res.status(404).json({ message: "Tax not found or access denied" });
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/taxes/seed-argentina", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const existingTaxes = await storage.getTaxes(clientId);
      
      const masterTaxes = [
        { name: "IVA 21%", percentage: "21", type: "iva", active: true },
        { name: "IVA 10.5%", percentage: "10.5", type: "iva", active: true },
        { name: "IVA 27%", percentage: "27", type: "iva", active: false },
        { name: "IVA Exento", percentage: "0", type: "iva", active: false },
        { name: "IVA No Gravado", percentage: "0", type: "iva", active: false },
        { name: "Percepcion IVA", percentage: "3", type: "percepcion", active: false },
        { name: "Percepcion IIBB CABA", percentage: "3", type: "percepcion", active: false },
        { name: "Percepcion IIBB Buenos Aires", percentage: "2.5", type: "percepcion", active: false },
        { name: "Percepcion IIBB Cordoba", percentage: "2.5", type: "percepcion", active: false },
        { name: "Percepcion IIBB Santa Fe", percentage: "2.5", type: "percepcion", active: false },
        { name: "IIBB CABA", percentage: "3", type: "iibb", active: false },
        { name: "IIBB Buenos Aires", percentage: "3.5", type: "iibb", active: false },
        { name: "IIBB Cordoba", percentage: "3", type: "iibb", active: false },
        { name: "IIBB Santa Fe", percentage: "3.6", type: "iibb", active: false },
        { name: "Impuesto Interno 8%", percentage: "8", type: "interno", active: false },
        { name: "Impuesto Interno 20%", percentage: "20", type: "interno", active: false },
        { name: "Retencion Ganancias", percentage: "2", type: "retencion", active: false },
        { name: "Retencion IVA", percentage: "50", type: "retencion", active: false },
      ];

      let created = 0;
      let skipped = 0;
      for (const tax of masterTaxes) {
        const exists = existingTaxes.find(
          t => t.name.toLowerCase() === tax.name.toLowerCase()
        );
        if (!exists) {
          await storage.createTax({ ...tax, clientId });
          created++;
        } else {
          skipped++;
        }
      }
      
      res.json({ 
        message: `Catalogo importado: ${created} creados, ${skipped} ya existian`,
        created,
        skipped,
        total: masterTaxes.length,
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/taxes/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const deleted = await storage.deleteTax(clientId, parseInt(req.params.id));
      if (!deleted) return res.status(404).json({ message: "Tax not found or access denied" });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/units", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.getUnits(clientId);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/units", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.createUnit({ ...req.body, clientId });
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/units/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.updateUnit(clientId, parseInt(req.params.id), req.body);
      if (!data) return res.status(404).json({ message: "Unit not found or access denied" });
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/units/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const deleted = await storage.deleteUnit(clientId, parseInt(req.params.id));
      if (!deleted) return res.status(404).json({ message: "Unit not found or access denied" });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/supplies", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.getSupplies(clientId);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/supplies", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.createSupply({ ...req.body, clientId });
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/supplies/export", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const supplies = await storage.getSupplies(clientId);
      const rubros = await storage.getRubros(clientId);
      const units = await storage.getUnits(clientId);
      
      const rubroMap = new Map(rubros.map(r => [r.id, r.name]));
      const unitMap = new Map(units.map(u => [u.id, u.abbreviation || u.name]));
      
      const exportData = supplies.map(s => ({
        "Nombre": s.name,
        "Rubro": s.rubroId ? rubroMap.get(s.rubroId) || "" : "",
        "Unidad": s.unitOfMeasureId ? unitMap.get(s.unitOfMeasureId) || "" : "",
        "Costo Unitario": s.unitCost || "0",
        "Ultimo Costo": s.lastCost || "0",
        "Activo": s.active ? "Si" : "No",
      }));
      
      const worksheet = XLSX.utils.json_to_sheet(exportData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Insumos");
      
      const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

      // JSON+base64: evita corrupción binaria en Netlify/serverless (ZIP interno del .xlsx).
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.json({
        fileName: "insumos.xlsx",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        data: Buffer.from(buffer as Uint8Array).toString("base64"),
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/supplies/import", isAuthenticated, upload.single("file"), async (req, res) => {
    try {
      const clientId = await getClientId(req);
      
      if (!req.file) {
        return res.status(400).json({ message: "No se proporciono archivo" });
      }
      
      const rubros = await storage.getRubros(clientId);
      const units = await storage.getUnits(clientId);
      
      const rubroByName = new Map(rubros.map(r => [r.name.toLowerCase(), r.id]));
      const unitByName = new Map(units.map(u => [(u.abbreviation || u.name).toLowerCase(), u.id]));
      
      let workbook: XLSX.WorkBook;
      try {
        workbook = XLSX.read(req.file.buffer, { type: "buffer" });
      } catch (err: any) {
        return res.status(400).json({
          message:
            "El archivo no es un Excel (.xlsx) válido o está corrupto. " +
            `Detalle: ${err?.message || String(err)}`,
        });
      }
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const rawData = XLSX.utils.sheet_to_json(sheet) as any[];
      
      let imported = 0;
      let errors: string[] = [];
      
      for (const row of rawData) {
        try {
          const name = row["Nombre"] || row["nombre"] || row["name"];
          if (!name) {
            errors.push("Fila sin nombre");
            continue;
          }
          
          const rubroName = row["Rubro"] || row["rubro"];
          const unitName = row["Unidad"] || row["unidad"];
          
          const rubroId = rubroName ? rubroByName.get(rubroName.toLowerCase()) : null;
          const unitOfMeasureId = unitName ? unitByName.get(unitName.toLowerCase()) : null;
          
          const unitCost = parseFloat(row["Costo Unitario"] || row["costo_unitario"] || row["unitCost"] || "0") || 0;
          const lastCost = parseFloat(row["Ultimo Costo"] || row["ultimo_costo"] || row["lastCost"] || "0") || 0;
          
          await storage.createSupply({
            clientId,
            name,
            rubroId: rubroId || null,
            unitOfMeasureId: unitOfMeasureId || null,
            unitCost: String(unitCost),
            lastCost: String(lastCost),
          });
          imported++;
        } catch (err: any) {
          errors.push(err.message);
        }
      }
      
      res.json({ imported, total: rawData.length, errors: errors.slice(0, 10) });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/supplies/:id/usages", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const id = parseInt(req.params.id);
      if (Number.isNaN(id)) return res.status(400).json({ message: "ID invalido" });
      const detail = await storage.getSupplyUsageDetail(clientId, id);
      if (!detail) return res.status(404).json({ message: "Insumo no encontrado" });
      res.json(detail);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/supplies/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.updateSupply(clientId, parseInt(req.params.id), req.body);
      if (!data) return res.status(404).json({ message: "Supply not found or access denied" });
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/supplies/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const deleted = await storage.deleteSupply(clientId, parseInt(req.params.id));
      if (!deleted) return res.status(404).json({ message: "Supply not found or access denied" });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Supply-Supplier relationships
  app.get("/api/supply-suppliers", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.getSupplySuppliers(clientId);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/supply-suppliers/:supplyId", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.getSupplySuppliersBySupply(clientId, parseInt(req.params.supplyId));
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.put("/api/supply-suppliers/:supplyId", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const { supplierIds } = req.body;
      await storage.setSupplySuppliers(clientId, parseInt(req.params.supplyId), supplierIds || []);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/supplier-rubros", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.getSupplierRubros(clientId);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/supplier-rubros/:supplierId", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.getSupplierRubrosBySupplier(clientId, parseInt(req.params.supplierId));
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.put("/api/supplier-rubros/:supplierId", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const supplierId = parseInt(req.params.supplierId);
      const allSuppliers = await storage.getSuppliers(clientId);
      const supplier = allSuppliers.find(s => s.id === supplierId);
      if (!supplier) return res.status(404).json({ message: "Proveedor no encontrado" });
      const { rubroIds } = req.body;
      await storage.setSupplierRubros(clientId, supplierId, rubroIds || []);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/invoices", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.getInvoices(clientId);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/invoices/stats", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const invoices = await storage.getInvoices(clientId);
      
      const today = new Date();
      const thisMonth = today.getMonth();
      const thisYear = today.getFullYear();
      
      const isNCInv = (i: any) => String(i.invoiceType ?? "").startsWith("NC-");
      const total = invoices.length;
      const pending = invoices.filter(i => !isNCInv(i) && !i.paid && parseFloat(String(i.balance) || "0") > 0).length;
      const overdue = invoices.filter(i => {
        if (isNCInv(i)) return false;
        if (i.paid) return false;
        if (!i.dueDate) return false;
        return new Date(i.dueDate) < today;
      }).length;
      const thisMonthTotal = invoices
        .filter(i => {
          const d = new Date(i.invoiceDate);
          return d.getMonth() === thisMonth && d.getFullYear() === thisYear;
        })
        .reduce((sum, i) => sum + (isNCInv(i) ? -1 : 1) * parseFloat(String(i.total) || "0"), 0);
      
      res.json({ total, pending, overdue, thisMonth: thisMonthTotal });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/invoices/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.getInvoice(clientId, parseInt(req.params.id));
      if (!data) return res.status(404).json({ message: "Invoice not found or access denied" });
      const items = await storage.getInvoiceItems(data.id);
      const taxes = await storage.getInvoiceTaxes(data.id);
      res.json({ ...data, items, taxes });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/invoices", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await prepareAndCreateInvoice(clientId, req.body);
      res.json(data);
    } catch (e: any) {
      res.status(e.statusCode ?? 500).json({ message: e.message });
    }
  });

  // Corregir factura (Facturas — editar con clave). Reemplaza la factura vieja por una nueva
  // corregida, recalculando TODO lo vinculado (costos, CPP, stock, costHistory, CMC/PAP/CMV).
  // Secuencia segura: reversar (deshace costos) → liberar pagos → borrar vieja → crear nueva.
  // Si la creación falla, se restaura la vieja desde un snapshot (no se pierde el dato).
  app.post("/api/invoices/:id/correct", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const userId = (await getAuthenticatedUserId(req)) ?? "";
      const oldId = parseInt(req.params.id, 10);
      const { confirmCode, ...newBody } = req.body ?? {};

      const old = await storage.getInvoice(clientId, oldId);
      if (!old) return res.status(404).json({ message: "Factura no encontrada" });
      if (old.status === "reversed") return res.status(400).json({ message: "La factura ya fue reversada; no se puede corregir." });

      // Clave: debe coincidir el número del comprobante (igual que al eliminar un extracto).
      if (String(confirmCode ?? "").trim() !== String(old.invoiceNumber ?? "").trim()) {
        return res.status(400).json({ message: "El código no coincide con el número de la factura." });
      }

      // Snapshot para auditoría y compensación.
      const snapItems = await storage.getInvoiceItems(oldId);
      const snapTaxes = await storage.getInvoiceTaxes(oldId);

      // 1) Reversar (deshace costos/stock). Puede lanzar si falta stock para revertir → nada cambió aún.
      await storage.reverseInvoice(clientId, oldId, userId, "Corrección de factura");
      // 2) Liberar pagos asignados (quedan sin aplicar).
      const releasedPayments = await storage.releaseInvoiceAllocations(oldId);
      // 3) Borrar la factura vieja (libera el número).
      await storage.deleteInvoice(clientId, oldId);

      // 4) Crear la nueva corregida. Si falla, restaurar la vieja desde el snapshot.
      let created;
      try {
        created = await prepareAndCreateInvoice(clientId, { ...newBody, clientId });
      } catch (createErr: any) {
        try {
          const { id: _i, createdAt: _c, updatedAt: _u, status: _s, reversedAt: _ra, reversedBy: _rb, reversalReason: _rr, ...oldFields } = old as any;
          await storage.createInvoice(
            { ...oldFields, status: "active" },
            snapItems.map(({ id, invoiceId, ...rest }: any) => rest) as any,
            snapTaxes.map(({ id, invoiceId, ...rest }: any) => rest) as any,
          );
        } catch { /* compensación best-effort */ }
        return res.status(createErr.statusCode ?? 500).json({
          message: `No se pudo crear la factura corregida (se restauró la original): ${createErr.message}`,
        });
      }

      // 5) Auditoría (red de seguridad: queda quién, cuándo y la foto de la factura vieja).
      await storage.createAuditLog({
        clientId,
        userId,
        action: "correct_invoice",
        tableName: "invoices",
        recordId: created.id,
        oldData: { invoice: old, items: snapItems, taxes: snapTaxes },
        newData: created,
      });

      res.json({ invoice: created, releasedPayments });
    } catch (e: any) {
      res.status(e.statusCode ?? 500).json({ message: e.message });
    }
  });

  app.delete("/api/invoices/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const deleted = await storage.deleteInvoice(clientId, parseInt(req.params.id));
      if (!deleted) return res.status(404).json({ message: "Invoice not found or access denied" });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/invoices/:id/reverse", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const { reason } = req.body;
      const userId = (req.user as any)?.id || "system";
      
      if (!reason || reason.trim().length < 5) {
        return res.status(400).json({ message: "El motivo de reversion debe tener al menos 5 caracteres" });
      }
      
      const reversed = await storage.reverseInvoice(
        clientId, 
        parseInt(req.params.id), 
        userId, 
        reason
      );
      
      if (!reversed) {
        return res.status(400).json({ message: "No se pudo revertir la factura. Puede que ya este revertida o no exista." });
      }
      
      res.json(reversed);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/payments", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.getPayments(clientId);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/payments", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const { allocations, supplierId, localId, ...paymentData } = req.body;

      const allInvoices = await storage.getInvoices(clientId);
      const pending = allInvoices.filter(i =>
        i.supplierId === supplierId &&
        (!localId || i.localId === localId) &&
        !i.paid &&
        parseFloat(String(i.balance) || "0") > 0
      );

      const hasPending = pending.length > 0;
      const hasAllocations = allocations && Array.isArray(allocations) && allocations.length > 0;

      if (hasPending && !hasAllocations) {
        return res.status(400).json({
          message: "Debes imputar el pago a una o mas facturas pendientes de este proveedor.",
        });
      }

      if (hasAllocations) {
        const data = await storage.createPaymentWithAllocations(
          { ...paymentData, supplierId, localId, clientId },
          allocations
        );
        return res.json(data);
      } else {
        const data = await storage.createPayment({ ...paymentData, supplierId, localId, clientId });
        return res.json(data);
      }
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Edición acotada: solo datos neutros del pago (no monto, proveedor/local ni facturas).
  app.patch("/api/payments/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const id = parseInt(req.params.id, 10);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "Id inválido" });

      const bodySchema = z.object({
        paymentNumber: z.string().max(50).nullable().optional(),
        paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida").optional(),
        bankAccountId: z.coerce.number().int().positive().nullable().optional(),
        paymentMethod: z.string().min(1).max(50).optional(),
        notes: z.string().nullable().optional(),
      });
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Datos inválidos", errors: parsed.error.flatten() });

      // Si mandan banco, debe pertenecer a la empresa.
      if (parsed.data.bankAccountId != null) {
        const banks = await storage.getBankAccounts(clientId);
        if (!banks.some((b) => b.id === parsed.data.bankAccountId)) {
          return res.status(400).json({ message: "Cuenta bancaria inválida para esta empresa." });
        }
      }

      const updated = await storage.updatePayment(clientId, id, parsed.data);
      if (!updated) return res.status(404).json({ message: "Payment not found or access denied" });
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/payments/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const deleted = await storage.deletePayment(clientId, parseInt(req.params.id));
      if (!deleted) return res.status(404).json({ message: "Payment not found or access denied" });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/supplier-accounts", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const localId = req.query.localId ? parseInt(req.query.localId as string) : undefined;
      const rubroId = req.query.rubroId ? parseInt(req.query.rubroId as string) : undefined;
      
      let suppliersList = await storage.getSuppliers(clientId);
      const allInvoices = await storage.getInvoices(clientId);
      const allPayments = await storage.getPayments(clientId);
      
      if (rubroId) {
        suppliersList = suppliersList.filter(s => s.rubroId === rubroId);
      }
      
      const today = new Date();
      const isNC = (i: any) => String(i.invoiceType ?? "").startsWith("NC-");
      const accounts = suppliersList.map(s => {
        let supplierInvoices = allInvoices.filter(i => i.supplierId === s.id && i.status === 'active');
        if (localId) {
          supplierInvoices = supplierInvoices.filter(i => i.localId === localId);
        }

        const totalInvoiced = supplierInvoices.reduce((sum, i) => sum + (isNC(i) ? -1 : 1) * parseFloat(String(i.total) || "0"), 0);
        const totalDebt = supplierInvoices.reduce((sum, i) => sum + (isNC(i) ? -1 : 1) * parseFloat(String(i.balance) || "0"), 0);
        const overdueInvoices = supplierInvoices.filter(i => {
          if (isNC(i)) return false;
          if (parseFloat(String(i.balance) || "0") <= 0) return false;
          if (!i.dueDate) return false;
          return new Date(i.dueDate) < today;
        });
        const overdueDebt = overdueInvoices.reduce((sum, i) => sum + parseFloat(String(i.balance) || "0"), 0);
        
        let supplierPayments = allPayments.filter(p => p.supplierId === s.id);
        if (localId) {
          supplierPayments = supplierPayments.filter(p => p.localId === localId);
        }
        const totalPaid = supplierPayments.reduce((sum, p) => sum + parseFloat(String(p.amount) || "0"), 0);
        
        return {
          ...s,
          totalDebt,
          overdueDebt,
          invoiceCount: supplierInvoices.length,
          overdueCount: overdueInvoices.length,
          totalPaid,
          // Campo auxiliar opcional para ver diferencias entre facturado, pagos y saldo
          // que podremos usar en el futuro para mostrar creditos no aplicados.
          // appliedPaid: Math.max(0, totalInvoiced - totalDebt),
        };
      });
      
      const totalDebtAll = accounts.reduce((sum, a) => sum + a.totalDebt, 0);
      const totalOverdueAll = accounts.reduce((sum, a) => sum + a.overdueDebt, 0);
      const totalInvoicesAll = accounts.reduce((sum, a) => sum + a.invoiceCount, 0);
      const totalOverdueCountAll = accounts.reduce((sum, a) => sum + a.overdueCount, 0);
      
      res.json({
        accounts,
        stats: {
          totalDebt: totalDebtAll,
          totalOverdue: totalOverdueAll,
          totalInvoices: totalInvoicesAll,
          totalOverdueCount: totalOverdueCountAll,
        }
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/supplier-accounts/export", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const localId = req.query.localId ? parseInt(req.query.localId as string) : undefined;
      const rubroId = req.query.rubroId ? parseInt(req.query.rubroId as string) : undefined;
      const suppliersList = await storage.getSuppliers(clientId);
      const allInvoices = await storage.getInvoices(clientId);
      const allPayments = await storage.getPayments(clientId);
      const allRubros = await storage.getRubros(clientId);
      const rubroMap = new Map(allRubros.map(r => [r.id, r.name]));
      const today = new Date();
      
      const filtered = rubroId ? suppliersList.filter(s => s.rubroId === rubroId) : suppliersList;
      const isNCExp = (i: any) => String(i.invoiceType ?? "").startsWith("NC-");

      const exportData: any[] = [];
      filtered.forEach(s => {
        let supplierInvoices = allInvoices.filter(i => i.supplierId === s.id && i.status === 'active');
        if (localId) supplierInvoices = supplierInvoices.filter(i => i.localId === localId);
        let supplierPayments = allPayments.filter(p => p.supplierId === s.id);
        if (localId) supplierPayments = supplierPayments.filter(p => p.localId === localId);

        const totalDebt = supplierInvoices.reduce((sum, i) => sum + (isNCExp(i) ? -1 : 1) * parseFloat(String(i.balance) || "0"), 0);
        const totalPaid = supplierPayments.reduce((sum, p) => sum + parseFloat(String(p.amount) || "0"), 0);
        const overdueDebt = supplierInvoices.filter(i => {
          if (isNCExp(i)) return false;
          if (parseFloat(String(i.balance) || "0") <= 0) return false;
          return i.dueDate && new Date(i.dueDate) < today;
        }).reduce((sum, i) => sum + parseFloat(String(i.balance) || "0"), 0);
        
        exportData.push({
          "Proveedor": s.tradeName || s.businessName || "",
          "Razon Social": s.businessName || "",
          "CUIT": s.cuit || "",
          "Rubro": s.rubroId ? (rubroMap.get(s.rubroId) || "") : "",
          "Total Facturas": supplierInvoices.length,
          "Total Facturado $": supplierInvoices.reduce((sum, i) => sum + parseFloat(String(i.total) || "0"), 0),
          "Total Pagado $": totalPaid,
          "Deuda Total $": totalDebt,
          "Deuda Vencida $": overdueDebt,
          "Facturas Vencidas": supplierInvoices.filter(i => parseFloat(String(i.balance) || "0") > 0 && i.dueDate && new Date(i.dueDate) < today).length,
        });
      });
      
      const worksheet = XLSX.utils.json_to_sheet(exportData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Cuentas Corrientes");
      const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", "attachment; filename=cuentas_corrientes.xlsx");
      res.send(buffer);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/recipe-categories", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.getRecipeCategories(clientId);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/recipe-categories", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.createRecipeCategory({ ...req.body, clientId });
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/recipe-categories/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.updateRecipeCategory(clientId, parseInt(req.params.id), req.body);
      if (!data) return res.status(404).json({ message: "Recipe category not found or access denied" });
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/recipe-categories/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const deleted = await storage.deleteRecipeCategory(clientId, parseInt(req.params.id));
      if (!deleted) return res.status(404).json({ message: "Recipe category not found or access denied" });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/recipe-subcategories", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.getRecipeSubcategories(clientId);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/recipe-subcategories", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.createRecipeSubcategory({ ...req.body, clientId });
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/recipe-subcategories/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.updateRecipeSubcategory(
        clientId,
        parseInt(req.params.id),
        req.body,
      );
      if (!data) return res.status(404).json({ message: "Subcategoria no encontrada" });
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/recipe-subcategories/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const deleted = await storage.deleteRecipeSubcategory(clientId, parseInt(req.params.id));
      if (!deleted) {
        return res.status(400).json({
          message:
            "No se puede eliminar: hay recetas que usan esta subcategoria, o no existe.",
        });
      }
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/recipes", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const [recipes, categories, subcategories] = await Promise.all([
        storage.getRecipes(clientId),
        storage.getRecipeCategories(clientId),
        storage.getRecipeSubcategories(clientId),
      ]);

      const categoryById = new Map(categories.map((c) => [c.id, c]));
      const subById = new Map(subcategories.map((s) => [s.id, s]));
      const ingredientLists = await Promise.all(
        recipes.map((recipe) => storage.getRecipeIngredients(recipe.id)),
      );

      const data = recipes.map((recipe, index) => {
        const sub = recipe.subcategoryId ? subById.get(recipe.subcategoryId) : undefined;
        const categoryFromSub = sub?.recipeCategory ?? null;
        const category =
          categoryFromSub ||
          (recipe.categoryId ? categoryById.get(recipe.categoryId) || null : null);
        return {
          ...recipe,
          category,
          subcategory: sub ?? null,
          ingredientCount: ingredientLists[index]?.length || 0,
        };
      });

      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/recipes/export", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const recipes = await storage.getRecipes(clientId);
      const categories = await storage.getRecipeCategories(clientId);
      const subcategories = await storage.getRecipeSubcategories(clientId);
      const catMap = new Map(categories.map(c => [c.id, c.name]));
      const subMap = new Map(subcategories.map((s) => [s.id, s]));

      const platos = recipes.filter(r => r.recipeType !== 'sub');
      const activePlatos = platos.filter(r => r.active);
      const avgCmv = activePlatos.length > 0
        ? activePlatos.reduce((sum, r) => sum + parseFloat(String(r.cmvPercentage) || "0"), 0) / activePlatos.length : 0;
      const avgMargin = activePlatos.length > 0
        ? activePlatos.reduce((sum, r) => sum + parseFloat(String(r.marginPercentage) || "0"), 0) / activePlatos.length : 0;
      const avgMarkup = activePlatos.length > 0
        ? activePlatos.reduce((sum, r) => sum + parseFloat(String(r.markup) || "0"), 0) / activePlatos.length : 0;
      
      const summarySheet = XLSX.utils.json_to_sheet([{
        "Total Recetas": platos.length,
        "Activas": activePlatos.length,
        "Inactivas": platos.length - activePlatos.length,
        "CMV Promedio %": `${avgCmv.toFixed(2)}%`,
        "Margen Promedio %": `${avgMargin.toFixed(2)}%`,
        "Markup Promedio %": `${avgMarkup.toFixed(2)}%`,
      }]);
      
      const detailData = platos.map((r) => {
        const sub = r.subcategoryId ? subMap.get(r.subcategoryId) : undefined;
        const categoriaNombre =
          sub?.recipeCategory?.name ||
          (r.categoryId ? catMap.get(r.categoryId) || "" : "");
        return {
        "Categoria": categoriaNombre,
        "Subcategoria": sub?.name || "",
        "Nombre": r.name,
        "Ingredientes": (r as any).ingredientCount || 0,
        "Costo MP $ (sin IVA)": parseFloat(String(r.totalCost) || "0").toFixed(2),
        "Precio Venta $ (sin IVA)": parseFloat(String(r.salePrice) || "0").toFixed(2),
        "Precio Venta $ (con IVA)": parseFloat(String(r.salePriceWithTax) || "0").toFixed(2),
        "CMV %": `${parseFloat(String(r.cmvPercentage) || "0").toFixed(2)}%`,
        "Margen $": parseFloat(String(r.margin) || "0").toFixed(2),
        "Margen %": `${parseFloat(String(r.marginPercentage) || "0").toFixed(2)}%`,
        "Markup %": `${parseFloat(String(r.markup) || "0").toFixed(2)}%`,
        "CMV Ideal %": r.cmvIdeal ? `${parseFloat(String(r.cmvIdeal)).toFixed(2)}%` : "",
        "Dif CMV %": r.cmvIdeal ? `${(parseFloat(String(r.cmvPercentage) || "0") - parseFloat(String(r.cmvIdeal) || "0")).toFixed(2)}%` : "",
        "Estado": r.active ? "Activo" : "Inactivo",
        "Fecha Creacion": r.createdAt ? new Date(r.createdAt).toLocaleDateString("es-AR") : "",
      };
      });
      const detailSheet = XLSX.utils.json_to_sheet(detailData);
      
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, summarySheet, "Resumen Carta");
      XLSX.utils.book_append_sheet(workbook, detailSheet, "Detalle Platos");
      const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", "attachment; filename=carta_recetas.xlsx");
      res.send(buffer);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/recipes/stats", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const recipes = await storage.getRecipes(clientId);
      
      const platos = recipes.filter(r => r.recipeType !== 'sub');
      const subRecetas = recipes.filter(r => r.recipeType === 'sub');
      const activePlatos = platos.filter(r => r.active);
      const activeSubRecetas = subRecetas.filter(r => r.active);
      
      const avgCmv = activePlatos.length > 0
        ? activePlatos.reduce((sum, r) => sum + parseFloat(String(r.cmvPercentage) || "0"), 0) / activePlatos.length
        : 0;
      const avgMargin = activePlatos.length > 0
        ? activePlatos.reduce((sum, r) => sum + parseFloat(String(r.marginPercentage) || "0"), 0) / activePlatos.length
        : 0;
      const avgMarkup = activePlatos.length > 0
        ? activePlatos.reduce((sum, r) => sum + parseFloat(String(r.markup) || "0"), 0) / activePlatos.length
        : 0;
      
      res.json({
        totalRecipes: platos.length,
        activeRecipes: activePlatos.length,
        inactiveRecipes: platos.length - activePlatos.length,
        avgCmv: Math.round(avgCmv * 100) / 100,
        avgMargin: Math.round(avgMargin * 100) / 100,
        avgMarkup: Math.round(avgMarkup * 100) / 100,
        totalSubRecipes: subRecetas.length,
        activeSubRecipes: activeSubRecetas.length,
        inactiveSubRecipes: subRecetas.length - activeSubRecetas.length,
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/recipes", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const { ingredients, ...recipe } = req.body;
      const data = await storage.createRecipe({ ...recipe, clientId }, ingredients || []);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/recipes/:id/parent-usages", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const id = parseInt(req.params.id);
      if (Number.isNaN(id)) return res.status(400).json({ message: "ID invalido" });
      const detail = await storage.getSubRecipeParentUsageDetail(clientId, id);
      if (!detail) return res.status(404).json({ message: "Sub-receta no encontrada" });
      res.json(detail);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/recipes/:id/photo", isAuthenticated, upload.single("photo"), async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const recipeId = parseInt(req.params.id);
      if (!req.file) return res.status(400).json({ message: "No se proporciono imagen" });
      
      const fs = await import("fs");
      const path = await import("path");
      const uploadsDir = path.default.join(process.cwd(), "uploads");
      if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
      
      const ext = req.file.originalname.split(".").pop() || "jpg";
      const filename = `recipe_${recipeId}_${Date.now()}.${ext}`;
      const filepath = path.default.join(uploadsDir, filename);
      fs.writeFileSync(filepath, req.file.buffer);
      
      const photoUrl = `/uploads/${filename}`;
      const data = await storage.updateRecipe(clientId, recipeId, { photoUrl }, undefined);
      if (!data) return res.status(404).json({ message: "Recipe not found" });
      res.json({ photoUrl });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/recipes/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.getRecipe(clientId, parseInt(req.params.id));
      if (!data) return res.status(404).json({ message: "Recipe not found or access denied" });
      const ingredients = await storage.getRecipeIngredients(data.id);
      res.json({ ...data, ingredients });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/recipes/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const id = parseInt(req.params.id);
      const { ingredients, ...recipe } = req.body;
      if (Array.isArray(ingredients) && ingredients.some((ing: any) => Number(ing?.subRecipeId) === id)) {
        return res.status(400).json({ message: "Una sub-receta no puede incluirse a si misma como ingrediente" });
      }
      const data = await storage.updateRecipe(clientId, id, recipe, ingredients);
      if (!data) return res.status(404).json({ message: "Recipe not found or access denied" });
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/recipes/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const deleted = await storage.deleteRecipe(clientId, parseInt(req.params.id));
      if (!deleted) return res.status(404).json({ message: "Recipe not found or access denied" });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/cost-history", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.getCostHistory(clientId);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/category-groups", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.getCategoryGroups(clientId);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ==========================================
  // FINANCIAL GROUPS (Grupos Financieros)
  // ==========================================
  app.get("/api/financial-groups", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.getFinancialGroups(clientId);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/financial-groups", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.createFinancialGroup({ ...req.body, clientId });
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/financial-groups/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.updateFinancialGroup(clientId, parseInt(req.params.id), req.body);
      if (!data) return res.status(404).json({ message: "Grupo financiero no encontrado" });
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/financial-groups/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const groupId = parseInt(req.params.id);
      
      const categories = await storage.getTransactionCategories(clientId);
      const hasLinkedCategories = categories.some(c => c.financialGroupId === groupId);
      
      if (hasLinkedCategories) {
        return res.status(400).json({ 
          message: "No se puede eliminar el grupo porque tiene categorias asociadas. Reasigne las categorias primero." 
        });
      }
      
      const deleted = await storage.deleteFinancialGroup(clientId, groupId);
      if (!deleted) return res.status(404).json({ message: "Grupo financiero no encontrado" });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/financial-groups/seed", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const result = await seedFinancialDataForClient(clientId);
      res.json({ 
        success: true, 
        message: `Creados ${result.groups} grupos y ${result.categories} categorías`,
        ...result 
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ==========================================
  // CLIENT BANKS (Bancos del cliente)
  // ==========================================
  app.get("/api/client-banks", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.getClientBanks(clientId);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/client-banks", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.createClientBank({ ...req.body, clientId });
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/client-banks/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.updateClientBank(clientId, parseInt(req.params.id), req.body);
      if (!data) return res.status(404).json({ message: "Banco no encontrado" });
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/client-banks/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const deleted = await storage.deleteClientBank(clientId, parseInt(req.params.id));
      if (!deleted) return res.status(404).json({ message: "Banco no encontrado" });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Banco genérico (ROADMAP_BETA Fase 2): configurar el mapeo manual de columnas.
  // Endpoint NUEVO, gateado por RBAC granular (primer uso de requirePermission).
  app.put(
    "/api/client-banks/:id/column-mapping",
    isAuthenticated,
    requirePermission("bank.config", "edit"),
    async (req, res) => {
      try {
        const { clientId } = (req as any).rbac;
        const columnMappingSchema = z
          .object({
            headerRows: z.coerce.number().int().min(0).max(50).optional(),
            dateCol: z.coerce.number().int().min(0),
            desc1Col: z.coerce.number().int().min(0).optional(),
            desc2Col: z.coerce.number().int().min(0).optional(),
            debitCol: z.coerce.number().int().min(0).optional(),
            creditCol: z.coerce.number().int().min(0).optional(),
            amountCol: z.coerce.number().int().min(0).optional(),
          })
          .refine((m) => m.debitCol != null || m.creditCol != null || m.amountCol != null, {
            message: "Mapeá al menos débito/crédito o una columna de monto.",
          });
        const parsed = columnMappingSchema.safeParse(req.body?.columnMapping ?? req.body);
        if (!parsed.success) {
          return res.status(400).json({ message: "Mapeo inválido", errors: parsed.error.flatten() });
        }
        const data = await storage.updateClientBank(clientId, parseInt(req.params.id), {
          columnMapping: parsed.data,
        } as any);
        if (!data) return res.status(404).json({ message: "Banco no encontrado" });
        res.json(data);
      } catch (e: any) {
        res.status(500).json({ message: e.message });
      }
    },
  );

  app.get("/api/transaction-categories", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.getTransactionCategories(clientId);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/transaction-categories", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.createTransactionCategory({ ...req.body, clientId });
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/transaction-categories/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.updateTransactionCategory(clientId, parseInt(req.params.id), req.body);
      if (!data) return res.status(404).json({ message: "Transaction category not found or access denied" });
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/transaction-categories/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const deleted = await storage.deleteTransactionCategory(clientId, parseInt(req.params.id));
      if (!deleted) return res.status(404).json({ message: "Transaction category not found or access denied" });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/bank-accounts", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.getBankAccounts(clientId);
      const locs = await storage.getLocals(clientId);
      const localMap = new Map(locs.map((l) => [l.id, l]));
      res.json(
        data.map((a) => ({
          ...a,
          local:
            a.localId != null
              ? { id: a.localId, name: localMap.get(a.localId)?.name ?? "" }
              : null,
        })),
      );
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/bank-accounts", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const parsed = createBankAccountBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Datos invalidos", errors: parsed.error.errors });
      }
      const { name, type, accountType, accountNumber, localId, bankId, clientBankId, businessNameId, openingBalance, active } = parsed.data;
      if (localId != null) {
        const locs = await storage.getLocals(clientId);
        if (!locs.some((l) => l.id === localId)) {
          return res.status(400).json({ message: "Local invalido" });
        }
      }
      const created = await storage.createBankAccount({
        clientId,
        name,
        type: type ?? "bank",
        accountType: accountType ?? undefined,
        accountNumber: accountNumber ?? undefined,
        bankId: bankId ?? undefined,
        ...(clientBankId !== undefined ? { clientBankId } : {}),
        ...(businessNameId !== undefined ? { businessNameId } : {}),
        ...(openingBalance !== undefined ? { openingBalance: openingBalance == null ? null : String(openingBalance) } : {}),
        ...(localId !== undefined ? { localId } : {}),
        active: active ?? true,
      } as unknown as InsertBankAccount);
      res.status(201).json(created);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Cuenta "Genérica" fija: destino de los extractos genéricos importados al momento.
  // Idempotente (devuelve la existente si ya está, o la crea). No toca bancos configurados.
  app.post("/api/bank-accounts/ensure-generic", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const accounts = await storage.getBankAccounts(clientId);
      const existing = accounts.find((a) => String((a as any).bankId ?? "") === "generic");
      if (existing) return res.json(existing);
      const created = await storage.createBankAccount({
        clientId,
        name: "Genérica",
        bankId: "generic",
        type: "bank",
        active: true,
      } as unknown as InsertBankAccount);
      res.status(201).json(created);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/bank-accounts/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) return res.status(400).json({ message: "ID invalido" });
      const parsed = patchBankAccountBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Datos invalidos", errors: parsed.error.errors });
      }
      if (parsed.data.localId != null) {
        const locs = await storage.getLocals(clientId);
        if (!locs.some((l) => l.id === parsed.data.localId)) {
          return res.status(400).json({ message: "Local invalido" });
        }
      }
      const updated = await storage.updateBankAccount(clientId, id, parsed.data as unknown as Partial<InsertBankAccount>);
      if (!updated) return res.status(404).json({ message: "Cuenta no encontrada" });
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/bank-accounts/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) return res.status(400).json({ message: "ID invalido" });
      const ok = await storage.deleteBankAccount(clientId, id);
      if (!ok) {
        const acc = await storage.getBankAccount(clientId, id);
        if (acc) {
          return res.status(409).json({
            message: "No se puede eliminar: hay movimientos o extractos vinculados a esta cuenta",
          });
        }
        return res.status(404).json({ message: "Cuenta no encontrada" });
      }
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/bank-accounts/:id/purge-imports", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) return res.status(400).json({ message: "ID invalido" });
      const parsed = z.object({ confirm: z.literal(true) }).safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Envie confirm: true para confirmar el borrado" });
      }
      const result = await storage.purgeBankAccountImportedData(clientId, id);
      res.json({ success: true, ...result });
    } catch (e: any) {
      if (e.message === "Cuenta no encontrada") {
        return res.status(404).json({ message: e.message });
      }
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/financial-saved-views", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const session = req.session as any;
      const userId = session?.userId || (req.user as any)?.claims?.sub;
      if (!userId) return res.status(401).json({ message: "Usuario no identificado" });
      const rows = await storage.getFinancialSavedViews(clientId, userId);
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/financial-saved-views", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const session = req.session as any;
      const userId = session?.userId || (req.user as any)?.claims?.sub;
      if (!userId) return res.status(401).json({ message: "Usuario no identificado" });
      const parsed = postFinancialSavedViewSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Datos invalidos", errors: parsed.error.errors });
      }
      const row = await storage.createFinancialSavedView({
        clientId,
        userId,
        name: parsed.data.name,
        filters: parsed.data.filters,
      } as unknown as InsertFinancialSavedView);
      res.status(201).json(row);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/financial-saved-views/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const session = req.session as any;
      const userId = session?.userId || (req.user as any)?.claims?.sub;
      if (!userId) return res.status(401).json({ message: "Usuario no identificado" });
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) return res.status(400).json({ message: "ID invalido" });
      const ok = await storage.deleteFinancialSavedView(clientId, userId, id);
      if (!ok) return res.status(404).json({ message: "Vista no encontrada" });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/transactions", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const DEFAULT_PAGE_SIZE = 800;
      const MAX_PAGE_SIZE = 2000;

      const pageParsed = z.coerce.number().int().min(0).safeParse(req.query.page);
      const pageSizeParsed = z.coerce.number().int().positive().max(MAX_PAGE_SIZE).safeParse(req.query.pageSize);
      const legacyLimitParsed = z.coerce.number().int().positive().max(100000).safeParse(req.query.limit);

      const afterDateRaw = req.query.afterDate;
      const afterIdRaw = req.query.afterId;
      const afterDateProvided =
        afterDateRaw !== undefined && afterDateRaw !== null && String(afterDateRaw).trim() !== "";
      const afterIdProvided =
        afterIdRaw !== undefined && afterIdRaw !== null && String(afterIdRaw).trim() !== "";
      if (afterDateProvided !== afterIdProvided) {
        return res.status(400).json({ message: "afterDate y afterId deben enviarse juntos" });
      }
      const afterDateStr =
        typeof afterDateRaw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(String(afterDateRaw).trim())
          ? String(afterDateRaw).trim()
          : undefined;
      if (afterDateProvided && !afterDateStr) {
        return res.status(400).json({ message: "afterDate debe ser YYYY-MM-DD" });
      }
      const afterIdParsed = z.coerce.number().int().positive().safeParse(afterIdRaw);
      if (afterIdProvided && !afterIdParsed.success) {
        return res.status(400).json({ message: "afterId inválido" });
      }
      const hasCursorPair = Boolean(afterDateStr && afterIdProvided && afterIdParsed.success);

      const useLegacyFlat =
        req.query.page === undefined &&
        req.query.pageSize === undefined &&
        !hasCursorPair &&
        legacyLimitParsed.success;

      const pageSize = pageSizeParsed.success
        ? Math.min(pageSizeParsed.data, MAX_PAGE_SIZE)
        : useLegacyFlat
          ? legacyLimitParsed.data!
          : DEFAULT_PAGE_SIZE;

      const useOffsetPages =
        !useLegacyFlat &&
        !hasCursorPair &&
        req.query.page !== undefined &&
        pageParsed.success;

      const page = useOffsetPages ? pageParsed.data : 0;
      const offset = useLegacyFlat ? 0 : useOffsetPages ? page * pageSize : 0;

      const rawBankSource = req.query.bankSource;
      let bankSourceFilter: string | undefined;
      if (rawBankSource !== undefined && rawBankSource !== null && String(rawBankSource).trim() !== "") {
        const s = String(rawBankSource).trim();
        if (!/^[a-z0-9_-]{1,40}$/i.test(s)) {
          return res.status(400).json({ message: "bankSource invalido" });
        }
        bankSourceFilter = s;
      }

      const data = await storage.getTransactions(clientId, {
        limit: pageSize,
        ...(bankSourceFilter ? { bankSource: bankSourceFilter } : {}),
        ...(useLegacyFlat
          ? {}
          : hasCursorPair
            ? { cursor: { transactionDate: afterDateStr!, id: afterIdParsed.data! } }
            : useOffsetPages && offset > 0
              ? { offset }
              : {}),
      });
      const categories = await storage.getTransactionCategories(clientId);
      const allLocals = await storage.getLocals(clientId);
      const bankAccountsList = await storage.getBankAccounts(clientId);

      const catMap = new Map(categories.map(c => [c.id, c]));
      const localMap = new Map(allLocals.map(l => [l.id, l]));
      const bankMap = new Map(bankAccountsList.map(b => [b.id, b]));

      const enriched = data.map(t => ({
        ...t,
        category: t.categoryId ? catMap.get(t.categoryId) || null : null,
        local: t.localId ? localMap.get(t.localId) || null : null,
        bankAccount: t.bankAccountId ? bankMap.get(t.bankAccountId) || null : null,
      }));

      if (useLegacyFlat) {
        res.json(enriched);
        return;
      }

      const total = hasCursorPair
        ? undefined
        : await storage.getTransactionCount(clientId, bankSourceFilter ? { bankSource: bankSourceFilter } : undefined);
      res.json({
        items: enriched,
        ...(total !== undefined ? { total } : {}),
        ...(useOffsetPages ? { page } : {}),
        pageSize,
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/available-banks", isAuthenticated, async (req, res) => {
    try {
      const banks = getAvailableBanks();
      res.json(banks);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // =========================
  // Razones sociales (catálogo)
  // =========================
  app.get("/api/business-names", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const rows = await (storage as any).getBusinessNames(clientId);
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/business-names", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const parsed = z
        .object({
          name: z.string().min(1).max(255),
          cuit: z.string().max(13).optional(),
          ivaCondition: z.string().max(50).optional(),
          active: z.boolean().optional(),
        })
        .safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Datos invalidos", errors: parsed.error.errors });
      const row = await (storage as any).createBusinessName({
        clientId,
        name: parsed.data.name.trim(),
        cuit: parsed.data.cuit?.trim() ?? undefined,
        ivaCondition: parsed.data.ivaCondition ?? "responsable_inscripto",
        active: parsed.data.active ?? true,
      } as unknown as InsertBusinessName);
      res.status(201).json(row);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/business-names/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) return res.status(400).json({ message: "ID invalido" });
      const parsed = z
        .object({
          name: z.string().min(1).max(255).optional(),
          cuit: z.string().max(13).optional(),
          ivaCondition: z.string().max(50).optional(),
          active: z.boolean().optional(),
        })
        .strict()
        .safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Datos invalidos", errors: parsed.error.errors });
      const row = await (storage as any).updateBusinessName(clientId, id, {
        ...(parsed.data.name !== undefined ? { name: parsed.data.name.trim() } : {}),
        ...(parsed.data.cuit !== undefined ? { cuit: parsed.data.cuit?.trim() || null } : {}),
        ...(parsed.data.ivaCondition !== undefined ? { ivaCondition: parsed.data.ivaCondition } : {}),
        ...(parsed.data.active !== undefined ? { active: parsed.data.active } : {}),
      });
      if (!row) return res.status(404).json({ message: "Sociedad no encontrada" });
      res.json(row);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/business-names/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) return res.status(400).json({ message: "ID invalido" });
      const ok = await (storage as any).deleteBusinessName(clientId, id);
      if (!ok) return res.status(404).json({ message: "Sociedad no encontrada" });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // =========================
  // Agenda de destinatarios
  // =========================
  app.get("/api/counterparties", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const rows = await (storage as any).getCounterparties(clientId);
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/counterparties", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const parsed = z
        .object({
          type: z.string().max(20).optional(),
          displayName: z.string().min(1).max(255),
          cuit: z.string().max(13).optional(),
          notes: z.string().max(2000).optional(),
          active: z.boolean().optional(),
        })
        .safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Datos invalidos", errors: parsed.error.errors });
      const row = await (storage as any).createCounterparty({
        clientId,
        type: parsed.data.type ?? "entity",
        displayName: parsed.data.displayName.trim(),
        cuit: parsed.data.cuit?.trim() ?? undefined,
        notes: parsed.data.notes?.trim() ?? undefined,
        active: parsed.data.active ?? true,
      } as unknown as InsertCounterparty);
      res.status(201).json(row);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/counterparties/:id/identifiers", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) return res.status(400).json({ message: "ID invalido" });
      const rows = await (storage as any).getCounterpartyIdentifiers(clientId, id);
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/counterparties/:id/identifiers", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const counterpartyId = parseInt(req.params.id, 10);
      if (Number.isNaN(counterpartyId)) return res.status(400).json({ message: "ID invalido" });
      const parsed = z
        .object({ type: z.string().min(1).max(20), value: z.string().min(1).max(255) })
        .safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Datos invalidos", errors: parsed.error.errors });
      const normalizedValue = parsed.data.value.toLowerCase().replace(/\s+/g, "").trim();
      const row = await (storage as any).createCounterpartyIdentifier({
        clientId,
        counterpartyId,
        type: parsed.data.type,
        value: parsed.data.value.trim(),
        normalizedValue,
      } as unknown as InsertCounterpartyIdentifier);
      res.status(201).json(row);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/transactions/import", isAuthenticated, upload.single("file"), async (req, res) => {
    try {
      console.log("[IMPORT] Starting import request");
      const clientId = await getClientId(req);
      const session = req.session as any;
      const userId = session?.userId || (req.user as any)?.claims?.sub;
      // El banco/parser se desprende de la cuenta/caja seleccionada.
      const bankIdFromMultipart = pickMultipartOrQueryString(req, "bankId");
      const bankIdOverride =
        bankIdFromMultipart != null &&
        String(bankIdFromMultipart).trim() !== "" &&
        String(bankIdFromMultipart).trim() !== "generic"
          ? String(bankIdFromMultipart).trim()
          : undefined;

      const defaultLocalParsed = z
        .union([z.coerce.number().int().positive(), z.null(), z.literal(""), z.literal("none")])
        .safeParse(pickMultipartOrQueryString(req, "defaultLocalId"));
      const defaultLocalId =
        defaultLocalParsed.success && typeof defaultLocalParsed.data === "number"
          ? defaultLocalParsed.data
          : null;
      if (defaultLocalId != null) {
        const locs = await storage.getLocals(clientId);
        if (!locs.some((l) => l.id === defaultLocalId)) {
          return res.status(400).json({ message: "Local invalido" });
        }
      }

      const bankAccountParsed = z.coerce
        .number()
        .int()
        .positive()
        .safeParse(pickMultipartOrQueryString(req, "bankAccountId"));
      if (!bankAccountParsed.success) {
        return res.status(400).json({
          message: "Debe seleccionar una cuenta bancaria o caja para importar el extracto",
        });
      }
      const bankAccountRow = await storage.getBankAccount(clientId, bankAccountParsed.data);
      if (!bankAccountRow) {
        return res.status(400).json({ message: "La cuenta seleccionada no existe o no pertenece a su empresa" });
      }
      const bankIdFromAccount = String((bankAccountRow as any).bankId ?? "").trim();
      const bankId =
        bankIdOverride ||
        bankIdFromAccount ||
        inferBankIdFromAccountName((bankAccountRow as any).name) ||
        "generic";

      if (!req.file) {
        return res.status(400).json({ message: "No se proporciono archivo" });
      }

      const skipContinuityRaw = pickMultipartOrQueryString(req, "skipContinuityCheck");
      const skipContinuity =
        skipContinuityRaw === "1" ||
        skipContinuityRaw?.toLowerCase() === "true" ||
        skipContinuityRaw?.toLowerCase() === "on";

      // Mercado Pago: absorber la diferencia de conciliación como "Comisión Mercado Pago" y avanzar.
      const mpAbsorbRaw = pickMultipartOrQueryString(req, "mpAbsorbResidualAsCommission");
      const mpAbsorbResidual =
        mpAbsorbRaw === "1" ||
        mpAbsorbRaw?.toLowerCase() === "true" ||
        mpAbsorbRaw?.toLowerCase() === "on";

      // Mapeo de columnas ad-hoc (extracto genérico del momento): se usa solo para ESTE archivo,
      // sin guardar nada ni tocar bancos configurados. Se ignora si es inválido.
      const columnMappingRaw = pickMultipartOrQueryString(req, "columnMapping");
      let adHocColumnMapping: any = null;
      if (columnMappingRaw && String(columnMappingRaw).trim()) {
        try {
          const obj = JSON.parse(String(columnMappingRaw));
          if (obj && typeof obj === "object" && Number.isFinite(obj.dateCol)) {
            adHocColumnMapping = obj;
          }
        } catch {
          /* mapeo inválido: se ignora y se cae al comportamiento normal */
        }
      }

      /** Mercado Pago: el volumen de líneas supera el timeout síncrono de Netlify (~26s) → cola + background function. */
      if (bankId === "mercadopago") {
        const jobToken = randomUUID();
        const triggerKey = randomBytes(32).toString("hex");
        const mpOv = parseMpGrossOverridesFromRequest(req);
        await storage.createFinancialImportJob({
          jobToken,
          triggerKey,
          clientId,
          createdBy: userId ?? undefined,
          status: "pending",
          fileGzipBase64: gzipSync(req.file.buffer).toString("base64"),
          originalFileName: req.file.originalname?.slice(0, 255) ?? undefined,
          paramsJson: JSON.stringify({
            bankAccountId: bankAccountParsed.data,
            bankId,
            defaultLocalId,
            openingBalance: pickMultipartOrQueryString(req, "openingBalance") ?? "",
            closingBalance: pickMultipartOrQueryString(req, "closingBalance") ?? "",
            skipContinuityCheck: skipContinuity,
            mpGrossOverridesJson: JSON.stringify(mpOv),
            mpAbsorbResidualAsCommission: mpAbsorbResidual,
          }),
        } as any);
        console.log(`[IMPORT] MP encolado async jobToken=${jobToken}`);
        return res.json({ async: true, jobToken, triggerKey });
      }

      const out = await runBankStatementImport({
        clientId,
        userId,
        buffer: req.file.buffer,
        bankId,
        bankAccountId: bankAccountParsed.data,
        defaultLocalId,
        openingBalanceRaw: pickMultipartOrQueryString(req, "openingBalance"),
        closingBalanceRaw: pickMultipartOrQueryString(req, "closingBalance"),
        skipContinuityCheck: skipContinuity,
        mpGrossOverrides: parseMpGrossOverridesFromRequest(req),
        mpAbsorbResidualAsCommission: mpAbsorbResidual,
        columnMapping: adHocColumnMapping,
      });

      if (out.kind === "error") {
        return res.status(out.status).json(out.body);
      }
      return res.json(out.body);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/transactions/import-jobs/:jobToken", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const jobToken = String(req.params.jobToken || "").trim();
      if (!jobToken) {
        return res.status(400).json({ message: "Falta jobToken" });
      }
      const job = await storage.getFinancialImportJobForClient(clientId, jobToken);
      if (!job) {
        return res.status(404).json({ message: "Trabajo no encontrado" });
      }
      let payload: unknown = undefined;
      if (job.resultJson) {
        try {
          payload = JSON.parse(job.resultJson);
        } catch {
          payload = undefined;
        }
      }
      return res.json({
        status: job.status,
        httpStatus: job.resultHttpStatus ?? undefined,
        payload,
        errorMessage: job.errorMessage ?? undefined,
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  /** En desarrollo local (sin función Netlify en background) el mismo servidor ejecuta el job. */
  app.post("/api/transactions/import/execute-job", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const jobToken = String(req.body?.jobToken || "").trim();
      const triggerKey = String(req.body?.triggerKey || "").trim();
      if (!jobToken || !triggerKey) {
        return res.status(400).json({ message: "Faltan jobToken o triggerKey" });
      }
      const job = await storage.getFinancialImportJobForClient(clientId, jobToken);
      if (!job || job.triggerKey !== triggerKey) {
        return res.status(403).json({ message: "No autorizado" });
      }
      await processFinancialImportJobBody(jobToken, triggerKey);
      return res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/transactions/cash-batch", isAuthenticated, async (req, res) => {
    const cashParse = cashBatchBodySchema.safeParse(req.body);
    if (!cashParse.success) {
      return res.status(400).json({ message: "Datos invalidos", errors: cashParse.error.flatten() });
    }
    try {
      const clientId = await getClientId(req);
      const session = req.session as any;
      const userId = session?.userId || (req.user as any)?.claims?.sub;
      const created = await storage.insertCashMovementBatch(clientId, userId, cashParse.data.items);
      res.status(201).json({ inserted: created.length, items: created });
    } catch (e: any) {
      res.status(400).json({ message: e.message || "Error al registrar movimientos" });
    }
  });

  // ---- Cajas de efectivo (catálogo global por cliente) ----
  app.get("/api/cash-registers", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const includeInactive = req.query.includeInactive === "1" || req.query.includeInactive === "true";
      const rows = await storage.listCashRegisters(clientId, includeInactive);
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/cash-registers", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const name = String(req.body?.name ?? "").trim();
      if (!name) return res.status(400).json({ message: "El nombre de la caja es obligatorio" });
      const existing = await storage.listCashRegisters(clientId, true);
      if (existing.some((c) => c.name.trim().toLowerCase() === name.toLowerCase())) {
        return res.status(409).json({ message: "Ya existe una caja con ese nombre" });
      }
      const row = await storage.createCashRegister(clientId, name);
      res.status(201).json(row);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/cash-registers/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ message: "ID inválido" });
      const data: any = {};
      if (req.body?.name !== undefined) data.name = String(req.body.name);
      if (req.body?.active !== undefined) data.active = Boolean(req.body.active);
      if (req.body?.displayOrder !== undefined) data.displayOrder = parseInt(String(req.body.displayOrder), 10);
      const row = await storage.updateCashRegister(clientId, id, data);
      if (!row) return res.status(404).json({ message: "Caja no encontrada" });
      res.json(row);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/cash-registers/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ message: "ID inválido" });
      const removed = await storage.deleteCashRegister(clientId, id);
      // removed=false => tenía movimientos y se DESACTIVÓ en lugar de borrarse.
      res.json({ success: true, deleted: removed, deactivated: !removed });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/transactions/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      
      const parseResult = updateTransactionSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ message: "Campos invalidos", errors: parseResult.error.errors });
      }

      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) {
        return res.status(400).json({ message: "ID invalido" });
      }

      const existing = await storage.getTransactionById(clientId, id);

      if (!existing) return res.status(404).json({ message: "Transaction not found" });

      const patch = parseResult.data;
      const hasCorePatch =
        patch.transactionDate !== undefined ||
        patch.description !== undefined ||
        patch.type !== undefined ||
        patch.amount !== undefined;

      if (hasCorePatch && existing.bankSource !== "cash") {
        return res.status(403).json({
          message:
            "Solo los movimientos en efectivo se pueden editar por completo (fecha, texto, tipo e importe). En extractos bancarios solo categoría y local.",
        });
      }

      const safeUpdate: {
        categoryId?: number | null;
        localId?: number | null;
        invoiced?: boolean;
        transactionDate?: string;
        description?: string;
        type?: string;
        amount?: string;
      } = {};
      if (patch.categoryId !== undefined) {
        safeUpdate.categoryId = patch.categoryId ?? null;
      }
      if (patch.localId !== undefined) {
        safeUpdate.localId = patch.localId ?? null;
      }
      if (patch.invoiced !== undefined) {
        safeUpdate.invoiced = patch.invoiced;
      }
      if (patch.transactionDate !== undefined) {
        safeUpdate.transactionDate = patch.transactionDate;
      }
      if (patch.description !== undefined) {
        safeUpdate.description = patch.description;
      }
      if (patch.type !== undefined) {
        safeUpdate.type = patch.type;
      }
      if (patch.amount !== undefined) {
        safeUpdate.amount = String(Math.abs(patch.amount));
      }

      const cashClassifyTouch =
        existing.bankSource === "cash" &&
        (hasCorePatch || patch.categoryId !== undefined || patch.localId !== undefined);

      if (cashClassifyTouch) {
        const nextCategoryId =
          patch.categoryId !== undefined ? patch.categoryId : existing.categoryId;
        if (nextCategoryId == null) {
          return res
            .status(400)
            .json({ message: "La categoría es obligatoria en movimientos de efectivo." });
        }
        const nextTypeRaw = patch.type ?? existing.type;
        if (nextTypeRaw !== "income" && nextTypeRaw !== "expense") {
          return res.status(400).json({ message: "Tipo de movimiento inválido" });
        }
        const nextLocalId =
          patch.localId !== undefined ? patch.localId : existing.localId;
        const amt =
          patch.amount !== undefined
            ? patch.amount
            : Math.abs(parseFloat(String(existing.amount ?? "0")));
        try {
          await storage.assertCashMovementRowValid(clientId, {
            categoryId: nextCategoryId,
            localId: nextLocalId,
            type: nextTypeRaw as "income" | "expense",
            amount: amt,
          });
        } catch (err: any) {
          return res.status(400).json({ message: err?.message ?? "Validación rechazada" });
        }

        const nextDesc =
          patch.description !== undefined
            ? patch.description
            : (existing.description ?? "");
        if (!String(nextDesc).trim()) {
          return res.status(400).json({ message: "La descripción es obligatoria en efectivo." });
        }
      }
      
      if (Object.keys(safeUpdate).length === 0) {
        return res.status(400).json({ message: "No hay campos para actualizar" });
      }
      
      const updated = await storage.updateTransaction(clientId, id, safeUpdate as Partial<InsertTransaction>);
      if (!updated) return res.status(404).json({ message: "Transaction not found" });
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/transactions/import-batches", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const batches = await storage.getImportBatches(clientId);
      res.json(batches);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/transactions/batch/:batchId", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const { confirmCode } = req.body;
      if (confirmCode !== "ELIMINAR") {
        return res.status(400).json({ message: "Codigo de confirmacion incorrecto" });
      }
      const batchId = decodeURIComponent(String(req.params.batchId ?? "").trim());
      const deleted = await storage.deleteTransactionBatch(clientId, batchId);
      if (deleted === 0) return res.status(404).json({ message: "Extracto no encontrado" });
      res.json({ success: true, deleted });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/transactions/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const deleted = await storage.deleteTransaction(clientId, parseInt(req.params.id));
      if (!deleted) return res.status(404).json({ message: "Transaction not found" });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/transactions/batch-categorize", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const { transactionIds, categoryId, localId, dateFrom, dateTo, description, description2, descriptions, bankSource, mode } = req.body;

      // mode "uncategorize" = descategorización masiva (quita la categoría a los que SÍ la tienen).
      const uncategorize = mode === "uncategorize";

      if (!uncategorize && !categoryId && categoryId !== null) {
        return res.status(400).json({ message: "Se requiere categoryId" });
      }

      const allTransactions = await storage.getTransactions(clientId);
      const tenantTxIds = new Set(allTransactions.map(t => t.id));

      const matchesDateRange = (t: (typeof allTransactions)[0]) => {
        if (!dateFrom || !dateTo) return true;
        const txDate = new Date(t.transactionDate);
        const from = new Date(dateFrom);
        const to = new Date(dateTo);
        to.setHours(23, 59, 59, 999);
        return txDate >= from && txDate <= to;
      };

      // Soporte para array de descripciones (multi-select) o descripción única (legacy)
      const descFilters: string[] | null =
        Array.isArray(descriptions) && descriptions.length > 0
          ? descriptions.map((d: any) => String(d).trim()).filter(Boolean)
          : typeof description === "string" && description.trim().length > 0
          ? [description.trim()]
          : null;

      const desc2Filter =
        typeof description2 === "string" && description2.trim().length > 0 ? description2.trim() : null;

      let idsToUpdate: number[] = [];

      if (transactionIds && Array.isArray(transactionIds) && transactionIds.length > 0) {
        const requestedIds = transactionIds.map((id: any) => parseInt(id));
        idsToUpdate = requestedIds.filter(id => tenantTxIds.has(id));

        if (idsToUpdate.length !== requestedIds.length) {
          return res.status(403).json({
            message: "Algunas transacciones no pertenecen a este cliente"
          });
        }
      } else if (descFilters !== null || desc2Filter !== null) {
        idsToUpdate = allTransactions
          .filter(t => {
            // categorizar → sólo sin categoría; descategorizar → sólo con categoría.
            if (uncategorize ? !t.categoryId : Boolean(t.categoryId)) return false;
            if (!matchesDateRange(t)) return false;
            if (bankSource && t.bankSource !== bankSource) return false;
            if (descFilters !== null && !descFilters.includes(t.description ?? "")) return false;
            if (desc2Filter !== null && t.description2 !== desc2Filter) return false;
            return true;
          })
          .map(t => t.id);
      } else if (dateFrom && dateTo) {
        const from = new Date(dateFrom);
        const to = new Date(dateTo);
        to.setHours(23, 59, 59, 999);

        idsToUpdate = allTransactions
          .filter(t => {
            const txDate = new Date(t.transactionDate);
            if (bankSource && t.bankSource !== bankSource) return false;
            if (!(txDate >= from && txDate <= to)) return false;
            return uncategorize ? Boolean(t.categoryId) : !t.categoryId;
          })
          .map(t => t.id);
      }

      if (idsToUpdate.length === 0) {
        return res.status(400).json({ message: "No hay transacciones para actualizar" });
      }

      const updateData: any = uncategorize
        ? { categoryId: null }
        : { categoryId: categoryId || null };
      if (!uncategorize && localId !== undefined) updateData.localId = localId || null;
      // UPDATE en lote (un solo statement por chunk) para no desbordar el timeout con miles de filas.
      const updated = await storage.batchUpdateTransactions(clientId, idsToUpdate, updateData);

      res.json({
        success: true,
        updated,
        total: idsToUpdate.length,
        message: uncategorize
          ? `Se descategorizaron ${updated} de ${idsToUpdate.length} transacciones`
          : `Se categorizaron ${updated} de ${idsToUpdate.length} transacciones`,
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Borrado masivo (mismo criterio de selección que la clasificación masiva). Sólo EFECTIVO.
  app.post("/api/transactions/batch-delete", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const { transactionIds, dateFrom, dateTo, localId, description, descriptions, bankSource } = req.body;

      // Guard de seguridad: sólo se permite el borrado masivo de movimientos de efectivo.
      if (bankSource !== "cash") {
        return res.status(400).json({ message: "El borrado masivo sólo está disponible para efectivo" });
      }

      const allTransactions = await storage.getTransactions(clientId);
      const tenantTxIds = new Set(allTransactions.map((t) => t.id));

      const matchesDateRange = (t: (typeof allTransactions)[0]) => {
        if (!dateFrom || !dateTo) return true;
        const txDate = new Date(t.transactionDate);
        const from = new Date(dateFrom);
        const to = new Date(dateTo);
        to.setHours(23, 59, 59, 999);
        return txDate >= from && txDate <= to;
      };

      const descFilters: string[] | null =
        Array.isArray(descriptions) && descriptions.length > 0
          ? descriptions.map((d: any) => String(d).trim()).filter(Boolean)
          : typeof description === "string" && description.trim().length > 0
          ? [description.trim()]
          : null;

      const localFilter =
        localId !== undefined && localId !== null && localId !== "all" ? parseInt(String(localId), 10) : null;

      let idsToDelete: number[] = [];

      if (Array.isArray(transactionIds) && transactionIds.length > 0) {
        const requestedIds = transactionIds.map((id: any) => parseInt(id));
        idsToDelete = requestedIds.filter((id) => tenantTxIds.has(id));
        if (idsToDelete.length !== requestedIds.length) {
          return res.status(403).json({ message: "Algunas transacciones no pertenecen a este cliente" });
        }
        // Aun con ids explícitos, sólo borramos efectivo.
        const cashIds = new Set(allTransactions.filter((t) => t.bankSource === "cash").map((t) => t.id));
        idsToDelete = idsToDelete.filter((id) => cashIds.has(id));
      } else if (descFilters !== null || (dateFrom && dateTo)) {
        idsToDelete = allTransactions
          .filter((t) => {
            if (t.bankSource !== "cash") return false;
            if (!matchesDateRange(t)) return false;
            if (localFilter !== null && t.localId !== localFilter) return false;
            if (descFilters !== null && !descFilters.includes(t.description ?? "")) return false;
            return true;
          })
          .map((t) => t.id);
      }

      if (idsToDelete.length === 0) {
        return res.status(400).json({ message: "No hay movimientos para borrar con ese criterio" });
      }

      let deleted = 0;
      for (const id of idsToDelete) {
        const ok = await storage.deleteTransaction(clientId, id);
        if (ok) deleted++;
      }

      res.json({
        success: true,
        deleted,
        total: idsToDelete.length,
        message: `Se borraron ${deleted} de ${idsToDelete.length} movimientos`,
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/transactions/:id/split", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const parentId = parseInt(req.params.id);
      const { splits } = req.body;

      if (!splits || !Array.isArray(splits) || splits.length < 2) {
        return res.status(400).json({ message: "Se requieren al menos 2 splits" });
      }

      const allTransactions = await storage.getTransactions(clientId);
      const parent = allTransactions.find(t => t.id === parentId);
      
      if (!parent) {
        return res.status(404).json({ message: "Transaccion no encontrada" });
      }

      if (parent.parentTransactionId) {
        return res.status(400).json({ message: "No se puede dividir una transaccion que ya es un split" });
      }

      const totalSplit = splits.reduce((sum: number, s: any) => sum + parseFloat(s.amount), 0);
      const parentAmount = Math.abs(parseFloat(String(parent.amount)));
      
      if (Math.abs(totalSplit - parentAmount) > 0.01) {
        return res.status(400).json({ 
          message: `La suma de los splits (${totalSplit}) no coincide con el monto original (${parentAmount})`
        });
      }

      const createdSplits = [];
      for (const split of splits) {
        const newSplit = await storage.createTransaction({
          clientId,
          transactionDate: parent.transactionDate,
          description: `${parent.description} (${split.localName || 'Split'})`,
          amount: parent.type === "expense" 
            ? String(-Math.abs(parseFloat(split.amount))) 
            : String(Math.abs(parseFloat(split.amount))),
          type: parent.type,
          source: "split",
          categoryId: split.categoryId || parent.categoryId,
          localId: split.localId || null,
          parentTransactionId: parentId,
        });
        createdSplits.push(newSplit);
      }

      await storage.updateTransaction(clientId, parentId, { invoiced: true });

      res.json({ 
        success: true, 
        splits: createdSplits,
        message: `Transaccion dividida en ${createdSplits.length} partes`
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/transactions/:id/splits", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const parentId = parseInt(req.params.id);
      
      const allTransactions = await storage.getTransactions(clientId);
      const splits = allTransactions.filter(t => t.parentTransactionId === parentId);
      
      res.json(splits);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/transactions/:id/splits", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const parentId = parseInt(req.params.id);
      
      const allTransactions = await storage.getTransactions(clientId);
      const splits = allTransactions.filter(t => t.parentTransactionId === parentId);
      
      if (splits.length === 0) {
        return res.status(404).json({ message: "No hay splits para esta transaccion" });
      }

      for (const split of splits) {
        await storage.deleteTransaction(clientId, split.id);
      }

      await storage.updateTransaction(clientId, parentId, { invoiced: false });

      res.json({ 
        success: true, 
        deleted: splits.length,
        message: `Se eliminaron ${splits.length} splits`
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ---- Préstamos internos entre locales (jul-27) ----
  app.get("/api/internal-loans", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const status = req.query.status === "all" ? "all" : "active";
      const data = await storage.getInternalLoans(clientId, status);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/internal-loans", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const session = req.session as any;
      const userId = session?.userId || (req.user as any)?.claims?.sub;

      const originTransactionId = parseInt(String(req.body?.originTransactionId), 10);
      const toLocalId = parseInt(String(req.body?.toLocalId), 10);
      const cashRegisterId = parseInt(String(req.body?.cashRegisterId), 10);
      const expenseCategoryId = parseInt(String(req.body?.expenseCategoryId), 10);
      if (![originTransactionId, toLocalId, cashRegisterId, expenseCategoryId].every(Number.isFinite)) {
        return res.status(400).json({ message: "Faltan datos: movimiento de origen, local destino, caja y categoría de gasto." });
      }

      const loan = await storage.createInternalLoan(clientId, userId, {
        originTransactionId,
        toLocalId,
        cashRegisterId,
        expenseCategoryId,
      });
      res.status(201).json(loan);
    } catch (e: any) {
      res.status(400).json({ message: e.message || "No se pudo crear el préstamo interno." });
    }
  });

  app.delete("/api/internal-loans/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ message: "ID inválido" });
      await storage.reverseInternalLoan(clientId, id);
      res.json({ success: true });
    } catch (e: any) {
      res.status(400).json({ message: e.message || "No se pudo deshacer el préstamo interno." });
    }
  });

  app.get("/api/monthly-balances", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const year = parseInt(req.query.year as string) || new Date().getFullYear();
      const data = await storage.getMonthlyBalances(clientId, year);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/balance-spreadsheet", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const year = parseInt(req.query.year as string) || new Date().getFullYear();
      // Punto 19: acepta un local, varios (localIds=1,2,3) o "all".
      const parseLocals = (): number | number[] | undefined => {
        const multi = req.query.localIds as string | undefined;
        if (multi && multi !== "all") {
          const ids = multi.split(",").map((s) => parseInt(s, 10)).filter((n) => Number.isFinite(n));
          return ids.length > 0 ? ids : undefined;
        }
        const single = req.query.localId as string | undefined;
        if (single && single !== "all") {
          const n = parseInt(single, 10);
          return Number.isFinite(n) ? n : undefined;
        }
        return undefined;
      };
      const data = await storage.getBalanceSpreadsheet(clientId, year, parseLocals());
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // CMC (Costo de Mercadería Comprada) — Fase 4. Reporte gateado por RBAC granular.
  app.get("/api/finance/cmc", isAuthenticated, requirePermission("cmc.view", "view"), async (req, res) => {
    try {
      const { clientId } = (req as any).rbac;
      const dateFrom = typeof req.query.dateFrom === "string" && req.query.dateFrom ? req.query.dateFrom : undefined;
      const dateTo = typeof req.query.dateTo === "string" && req.query.dateTo ? req.query.dateTo : undefined;
      const localIdsRaw = req.query.localIds ?? req.query.localId;
      const localIds =
        typeof localIdsRaw === "string" && localIdsRaw && localIdsRaw !== "all"
          ? localIdsRaw.split(",").map((s) => parseInt(s, 10)).filter((n) => Number.isFinite(n))
          : undefined;
      const salesSource = req.query.salesSource === "datalive" ? "datalive" : req.query.salesSource === "fudo" ? "fudo" : req.query.salesSource === "shares" ? "shares" : "extractos";
      const data = await storage.getCmcReport(clientId, { dateFrom, dateTo, localIds, salesSource });

      // Ajuste por traslados: solo cuando se filtra por un único local.
      let transferAdj = 0;
      if (localIds && localIds.length === 1) {
        transferAdj = await storage.getTransferAdjustment(clientId, localIds[0], dateFrom, dateTo);
      }
      const totalAdjusted = data.total + transferAdj;
      const pctAdjusted = data.salesNet > 0 ? (totalAdjusted / data.salesNet) * 100 : null;

      res.json({ ...data, total: totalAdjusted, transferAdj, pct: pctAdjusted });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // PAP (Pago a Proveedores) — Fase 5. Reporte gateado por RBAC granular.
  app.get("/api/finance/pap", isAuthenticated, requirePermission("pap.view", "view"), async (req, res) => {
    try {
      const { clientId } = (req as any).rbac;
      const dateFrom = typeof req.query.dateFrom === "string" && req.query.dateFrom ? req.query.dateFrom : undefined;
      const dateTo = typeof req.query.dateTo === "string" && req.query.dateTo ? req.query.dateTo : undefined;
      const parseIds = (raw: unknown): number[] | undefined =>
        typeof raw === "string" && raw && raw !== "all"
          ? raw.split(",").map((s) => parseInt(s, 10)).filter((n) => Number.isFinite(n))
          : undefined;
      const localIds = parseIds(req.query.localIds ?? req.query.localId);
      const supplierIds = parseIds(req.query.supplierIds ?? req.query.supplierId);
      const salesSource = req.query.salesSource === "datalive" ? "datalive" : req.query.salesSource === "fudo" ? "fudo" : req.query.salesSource === "shares" ? "shares" : "extractos";
      const data = await storage.getPapReport(clientId, { dateFrom, dateTo, localIds, supplierIds, salesSource });
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Valorización de Stock — Fase 6 (CRUD gateado por RBAC granular).
  app.get("/api/finance/stock-valuations", isAuthenticated, requirePermission("stock_valuation.view", "view"), async (req, res) => {
    try {
      const { clientId } = (req as any).rbac;
      const localId = req.query.localId && req.query.localId !== "all" ? parseInt(req.query.localId as string, 10) : undefined;
      res.json(await storage.listStockValuations(clientId, localId));
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/finance/stock-valuations/:id", isAuthenticated, requirePermission("stock_valuation.view", "view"), async (req, res) => {
    try {
      const { clientId } = (req as any).rbac;
      const data = await storage.getStockValuation(clientId, parseInt(req.params.id, 10));
      if (!data) return res.status(404).json({ message: "Valorización no encontrada" });
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/finance/stock-valuations", isAuthenticated, requirePermission("stock_valuation.create", "create"), async (req, res) => {
    try {
      const { clientId, actorId } = (req as any).rbac;
      const bodySchema = z.object({
        localId: z.coerce.number().int().positive().nullable().optional(),
        valuationDate: z.string().min(1),
        notes: z.string().optional().nullable(),
        items: z.array(z.object({
          supplyId: z.coerce.number().int().positive(),
          quantity: z.coerce.number(),
          unitOfMeasureId: z.coerce.number().int().positive().nullable().optional(),
          replacementUnitCost: z.coerce.number().nullable().optional(),
        })).min(1, "Cargá al menos un insumo con cantidad"),
      });
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Datos inválidos", errors: parsed.error.flatten() });
      const created = await storage.createStockValuation({
        clientId,
        localId: parsed.data.localId ?? null,
        valuationDate: parsed.data.valuationDate,
        notes: parsed.data.notes ?? null,
        createdBy: actorId,
        items: parsed.data.items,
      });
      res.json(created);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Qué CMV guardados dependen de esta valorización (para avisar antes de editarla).
  app.get("/api/finance/stock-valuations/:id/cmv-usage", isAuthenticated, requirePermission("stock_valuation.view", "view"), async (req, res) => {
    try {
      const { clientId } = (req as any).rbac;
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ message: "ID inválido" });
      res.json(await storage.listCmvCalculationsByValuation(clientId, id));
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.put("/api/finance/stock-valuations/:id", isAuthenticated, requirePermission("stock_valuation.create", "create"), async (req, res) => {
    try {
      const { clientId } = (req as any).rbac;
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ message: "ID inválido" });
      const bodySchema = z.object({
        localId: z.coerce.number().int().positive().nullable().optional(),
        valuationDate: z.string().min(1),
        notes: z.string().optional().nullable(),
        items: z.array(z.object({
          supplyId: z.coerce.number().int().positive(),
          quantity: z.coerce.number(),
          unitOfMeasureId: z.coerce.number().int().positive().nullable().optional(),
        })).min(1, "Cargá al menos un insumo con cantidad"),
      });
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Datos inválidos", errors: parsed.error.flatten() });
      const result = await storage.updateStockValuation(clientId, id, {
        localId: parsed.data.localId ?? null,
        valuationDate: parsed.data.valuationDate,
        notes: parsed.data.notes ?? null,
        items: parsed.data.items,
      });
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/finance/stock-valuations/:id/reverse", isAuthenticated, requirePermission("stock_valuation.delete", "delete"), async (req, res) => {
    try {
      const { clientId } = (req as any).rbac;
      const reversed = await storage.reverseStockValuation(clientId, parseInt(req.params.id, 10));
      if (!reversed) return res.status(404).json({ message: "Valorización no encontrada" });
      res.json(reversed);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // CMV — preview de compras del período en vivo (sin necesidad de elegir stocks).
  app.get("/api/finance/cmv-compras", isAuthenticated, requirePermission("cmv.view", "view"), async (req, res) => {
    try {
      const { clientId } = (req as any).rbac;
      const localId = req.query.localId && req.query.localId !== "all" ? parseInt(req.query.localId as string, 10) : undefined;
      const dateFrom = typeof req.query.dateFrom === "string" && req.query.dateFrom ? req.query.dateFrom : undefined;
      const dateTo = typeof req.query.dateTo === "string" && req.query.dateTo ? req.query.dateTo : undefined;
      const compras = await storage.getCmcTotal(clientId, { localId, dateFrom, dateTo });
      res.json({ compras });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // CMV — preview de decomisos del período/local en vivo (desglose informativo).
  app.get("/api/finance/cmv-decomisos", isAuthenticated, requirePermission("cmv.view", "view"), async (req, res) => {
    try {
      const { clientId } = (req as any).rbac;
      const localId = req.query.localId && req.query.localId !== "all" ? parseInt(req.query.localId as string, 10) : undefined;
      const dateFrom = typeof req.query.dateFrom === "string" && req.query.dateFrom ? req.query.dateFrom : undefined;
      const dateTo = typeof req.query.dateTo === "string" && req.query.dateTo ? req.query.dateTo : undefined;
      const decomisos = await storage.getDecomisosTotal(clientId, { localId, dateFrom, dateTo });
      res.json({ decomisos });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // CMV (Costo de Mercadería Vendida) — Fase 7. Reporte gateado por RBAC granular.
  app.get("/api/finance/cmv", isAuthenticated, requirePermission("cmv.view", "view"), async (req, res) => {
    try {
      const { clientId } = (req as any).rbac;
      const stockInicialId = parseInt(req.query.stockInicialId as string, 10);
      const stockFinalId = parseInt(req.query.stockFinalId as string, 10);
      if (!Number.isFinite(stockInicialId) || !Number.isFinite(stockFinalId)) {
        return res.status(400).json({ message: "Elegí stock inicial y stock final" });
      }
      const localId = req.query.localId && req.query.localId !== "all" ? parseInt(req.query.localId as string, 10) : undefined;
      const dateFrom = typeof req.query.dateFrom === "string" && req.query.dateFrom ? req.query.dateFrom : undefined;
      const dateTo = typeof req.query.dateTo === "string" && req.query.dateTo ? req.query.dateTo : undefined;
      const salesSource = req.query.salesSource === "datalive" ? "datalive" : req.query.salesSource === "fudo" ? "fudo" : req.query.salesSource === "shares" ? "shares" : "extractos";
      const ivaIncluded = req.query.ivaIncluded === "true";
      const data = await storage.computeCmv(clientId, { localId, stockInicialId, stockFinalId, dateFrom, dateTo, salesSource, ivaIncluded });
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // CMV — guardar / listar cálculos (registro del CMV calculado).
  app.get("/api/finance/cmv-calculations", isAuthenticated, requirePermission("cmv.view", "view"), async (req, res) => {
    try {
      const { clientId } = (req as any).rbac;
      res.json(await storage.listCmvCalculations(clientId));
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/finance/cmv-calculations", isAuthenticated, requirePermission("cmv.view", "create"), async (req, res) => {
    try {
      const { clientId, actorId } = (req as any).rbac;
      const stockInicialId = parseInt(req.body?.stockInicialId, 10);
      const stockFinalId = parseInt(req.body?.stockFinalId, 10);
      if (!Number.isFinite(stockInicialId) || !Number.isFinite(stockFinalId)) {
        return res.status(400).json({ message: "Elegí stock inicial y stock final" });
      }
      const localId = req.body?.localId && req.body.localId !== "all" ? parseInt(String(req.body.localId), 10) : undefined;
      const dateFrom = typeof req.body?.dateFrom === "string" && req.body.dateFrom ? req.body.dateFrom : undefined;
      const dateTo = typeof req.body?.dateTo === "string" && req.body.dateTo ? req.body.dateTo : undefined;
      const salesSource = req.body?.salesSource === "datalive" ? "datalive" : req.body?.salesSource === "fudo" ? "fudo" : req.body?.salesSource === "shares" ? "shares" : "extractos";
      const ivaIncluded = req.body?.ivaIncluded === true;
      const saved = await storage.saveCmvCalculation(clientId, { localId, stockInicialId, stockFinalId, dateFrom, dateTo, salesSource, ivaIncluded, createdBy: actorId });
      res.json(saved);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.put("/api/finance/cmv-calculations/:id", isAuthenticated, requirePermission("cmv.view", "create"), async (req, res) => {
    try {
      const { clientId } = (req as any).rbac;
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ message: "ID inválido" });
      const stockInicialId = parseInt(req.body?.stockInicialId, 10);
      const stockFinalId = parseInt(req.body?.stockFinalId, 10);
      if (!Number.isFinite(stockInicialId) || !Number.isFinite(stockFinalId)) {
        return res.status(400).json({ message: "Elegí stock inicial y stock final" });
      }
      const localId = req.body?.localId && req.body.localId !== "all" ? parseInt(String(req.body.localId), 10) : undefined;
      const dateFrom = typeof req.body?.dateFrom === "string" && req.body.dateFrom ? req.body.dateFrom : undefined;
      const dateTo = typeof req.body?.dateTo === "string" && req.body.dateTo ? req.body.dateTo : undefined;
      const salesSource = req.body?.salesSource === "datalive" ? "datalive" : req.body?.salesSource === "fudo" ? "fudo" : req.body?.salesSource === "shares" ? "shares" : "extractos";
      const ivaIncluded = req.body?.ivaIncluded === true;
      const updated = await storage.updateCmvCalculation(clientId, id, { localId, stockInicialId, stockFinalId, dateFrom, dateTo, salesSource, ivaIncluded });
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/finance/cmv-calculations/:id", isAuthenticated, requirePermission("cmv.view", "create"), async (req, res) => {
    try {
      const { clientId } = (req as any).rbac;
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ message: "ID inválido" });
      await storage.deleteCmvCalculation(clientId, id);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Punto de Equilibrio — Fase 8 (gateado por RBAC granular).
  app.get("/api/finance/breakeven", isAuthenticated, requirePermission("breakeven.view", "view"), async (req, res) => {
    try {
      const { clientId } = (req as any).rbac;
      res.json(await storage.listBreakevenAnalyses(clientId));
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/finance/breakeven/:id", isAuthenticated, requirePermission("breakeven.view", "view"), async (req, res) => {
    try {
      const { clientId } = (req as any).rbac;
      const data = await storage.getBreakevenAnalysis(clientId, parseInt(req.params.id, 10));
      if (!data) return res.status(404).json({ message: "Análisis no encontrado" });
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/finance/breakeven", isAuthenticated, requirePermission("breakeven.create", "create"), async (req, res) => {
    try {
      const { clientId, actorId } = (req as any).rbac;
      const bodySchema = z.object({
        name: z.string().min(1, "El nombre es requerido"),
        localId: z.coerce.number().int().positive().nullable().optional(),
        recipeId: z.coerce.number().int().positive().nullable().optional(),
        salePriceNoIva: z.coerce.number(),
        variableCostNoIva: z.coerce.number(),
        commissions: z.array(z.object({
          label: z.string().optional().nullable(),
          pct: z.coerce.number(),
          base: z.enum(["con_iva", "sin_iva"]),
          ivaRate: z.coerce.number().optional(),
        })).optional().default([]),
        fixedCosts: z.array(z.object({
          transactionCategoryId: z.coerce.number().int().positive().nullable().optional(),
          label: z.string().optional().nullable(),
          amount: z.coerce.number(),
        })).default([]),
      });
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Datos inválidos", errors: parsed.error.flatten() });
      const price = parsed.data.salePriceNoIva;
      const commPerUnit = parsed.data.commissions.reduce((acc, c) => {
        const base = c.base === "con_iva" ? price * (1 + (c.ivaRate ?? 0) / 100) : price;
        return acc + base * (c.pct / 100);
      }, 0);
      if (price - parsed.data.variableCostNoIva - commPerUnit <= 0) {
        return res.status(400).json({ message: "El margen de contribución (precio − costo variable − comisiones) debe ser positivo." });
      }
      const created = await storage.createBreakevenAnalysis({
        clientId,
        localId: parsed.data.localId ?? null,
        name: parsed.data.name,
        recipeId: parsed.data.recipeId ?? null,
        salePriceNoIva: parsed.data.salePriceNoIva,
        variableCostNoIva: parsed.data.variableCostNoIva,
        commissions: parsed.data.commissions,
        createdBy: actorId,
        fixedCosts: parsed.data.fixedCosts,
      });
      res.json(created);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Ventas Datalive (fase 1) — tabla paralela de ventas brutas. El parseo del Excel se hace en
  // el browser (shared/dataliveSalesParser); acá se persiste con idempotencia por (local, día).
  app.get("/api/datalive-ventas", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const localId = req.query.localId && req.query.localId !== "all" ? parseInt(req.query.localId as string, 10) : undefined;
      res.json(await storage.listDataliveVentas(clientId, localId));
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/datalive-ventas/import", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const userId = await getAuthenticatedUserId(req);
      const bodySchema = z.object({
        localId: z.coerce.number().int().positive(),
        sourceFile: z.string().max(255).optional().nullable(),
        replaceFechas: z.array(z.string()).optional(),
        days: z
          .array(
            z.object({
              fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida"),
              ventaTotal: z.coerce.number(),
              ventaEfectivo: z.coerce.number(),
              ventaOnline: z.coerce.number(),
            }),
          )
          .min(1, "No hay días para importar"),
      });
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Datos inválidos", errors: parsed.error.flatten() });

      // El local debe pertenecer a la empresa.
      const locs = await storage.getLocals(clientId);
      if (!locs.some((l) => l.id === parsed.data.localId)) {
        return res.status(400).json({ message: "Local inválido para esta empresa." });
      }

      const result = await storage.importDataliveVentas(clientId, parsed.data.localId, parsed.data.days, {
        sourceFile: parsed.data.sourceFile ?? null,
        createdBy: userId ?? null,
        replaceFechas: parsed.data.replaceFechas ?? [],
      });
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/datalive-ventas/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const id = parseInt(req.params.id, 10);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "Id inválido" });
      const ok = await storage.deleteDataliveVenta(clientId, id);
      if (!ok) return res.status(404).json({ message: "Venta no encontrada" });
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Ventas FUDO — tabla paralela de ventas brutas. El parseo del Excel se hace en
  // el browser (shared/fudoSalesParser); acá se persiste con idempotencia por (local, día).
  app.get("/api/fudo-ventas", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const localId = req.query.localId && req.query.localId !== "all" ? parseInt(req.query.localId as string, 10) : undefined;
      res.json(await storage.listFudoVentas(clientId, localId));
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/fudo-ventas/import", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const userId = await getAuthenticatedUserId(req);
      const bodySchema = z.object({
        localId: z.coerce.number().int().positive(),
        sourceFile: z.string().max(255).optional().nullable(),
        replaceFechas: z.array(z.string()).optional(),
        days: z
          .array(
            z.object({
              fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida"),
              ventaTotal: z.coerce.number(),
              ticketCount: z.coerce.number().int().optional().default(0),
            }),
          )
          .min(1, "No hay días para importar"),
        adiciones: z
          .array(
            z.object({
              fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida"),
              producto: z.string().max(255),
              categoria: z.string().max(255).optional().default(""),
              cantidad: z.coerce.number().int(),
            }),
          )
          .optional()
          .default([]),
        pagos: z
          .array(
            z.object({
              fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida"),
              medioPago: z.string().max(100),
              importe: z.coerce.number(),
            }),
          )
          .optional()
          .default([]),
      });
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Datos inválidos", errors: parsed.error.flatten() });

      const locs = await storage.getLocals(clientId);
      if (!locs.some((l) => l.id === parsed.data.localId)) {
        return res.status(400).json({ message: "Local inválido para esta empresa." });
      }

      const result = await storage.importFudoVentas(clientId, parsed.data.localId, parsed.data.days, {
        sourceFile: parsed.data.sourceFile ?? null,
        createdBy: userId ?? null,
        replaceFechas: parsed.data.replaceFechas ?? [],
      });

      let productosResult = { insertados: 0, omitidos: 0, reemplazados: 0 };
      if (parsed.data.adiciones.length > 0) {
        productosResult = await storage.importFudoProductos(
          clientId,
          parsed.data.localId,
          parsed.data.adiciones.map((a) => ({ ...a, categoria: a.categoria ?? "" })),
          { sourceFile: parsed.data.sourceFile ?? null, createdBy: userId ?? null, replaceFechas: parsed.data.replaceFechas ?? [] },
        );
      }

      let pagosResult = { insertados: 0, reemplazados: 0 };
      if (parsed.data.pagos.length > 0) {
        pagosResult = await storage.importFudoPagos(
          clientId,
          parsed.data.localId,
          parsed.data.pagos,
          { sourceFile: parsed.data.sourceFile ?? null, createdBy: userId ?? null, replaceFechas: parsed.data.replaceFechas ?? [] },
        );
      }

      res.json({ ...result, productos: productosResult, pagos: pagosResult });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/fudo-productos/fecha", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const bodySchema = z.object({
        localId: z.coerce.number().int().positive(),
        fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      });
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Datos inválidos" });
      const count = await storage.deleteFudoProductosByFecha(clientId, parsed.data.localId, parsed.data.fecha);
      res.json({ eliminados: count });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/fudo-productos", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const localId = req.query.localId && req.query.localId !== "all" ? parseInt(req.query.localId as string, 10) : undefined;
      const fechaDesde = req.query.fechaDesde as string | undefined;
      const fechaHasta = req.query.fechaHasta as string | undefined;
      res.json(await storage.listFudoProductos(clientId, { localId, fechaDesde, fechaHasta }));
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Ventas + Productos SHARES — tercer origen. Ventas y productos vienen en archivos SEPARADOS
  // (como Datalive); el parseo del Excel se hace en el browser (shared/sharesSalesParser).
  app.get("/api/shares-ventas", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const localId = req.query.localId && req.query.localId !== "all" ? parseInt(req.query.localId as string, 10) : undefined;
      res.json(await storage.listSharesVentas(clientId, localId));
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/shares-ventas/import", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const userId = await getAuthenticatedUserId(req);
      const bodySchema = z.object({
        localId: z.coerce.number().int().positive(),
        sourceFile: z.string().max(255).optional().nullable(),
        replaceFechas: z.array(z.string()).optional(),
        days: z
          .array(
            z.object({
              fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida"),
              ventaTotal: z.coerce.number(),
              ventaEfectivo: z.coerce.number(),
              ventaTarjeta: z.coerce.number(),
              ventaEfectivoOnline: z.coerce.number(),
              ventaOperOnline: z.coerce.number(),
              ventaMercadopago: z.coerce.number(),
            }),
          )
          .min(1, "No hay días para importar"),
      });
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Datos inválidos", errors: parsed.error.flatten() });

      const locs = await storage.getLocals(clientId);
      if (!locs.some((l) => l.id === parsed.data.localId)) {
        return res.status(400).json({ message: "Local inválido para esta empresa." });
      }

      const result = await storage.importSharesVentas(clientId, parsed.data.localId, parsed.data.days, {
        sourceFile: parsed.data.sourceFile ?? null,
        createdBy: userId ?? null,
        replaceFechas: parsed.data.replaceFechas ?? [],
      });
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/shares-ventas/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const id = parseInt(req.params.id, 10);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "Id inválido" });
      const ok = await storage.deleteSharesVenta(clientId, id);
      if (!ok) return res.status(404).json({ message: "Venta no encontrada" });
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/shares-productos", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const localId = req.query.localId && req.query.localId !== "all" ? parseInt(req.query.localId as string, 10) : undefined;
      const fechaDesde = req.query.fechaDesde as string | undefined;
      const fechaHasta = req.query.fechaHasta as string | undefined;
      res.json(await storage.listSharesProductos(clientId, { localId, fechaDesde, fechaHasta }));
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/shares-productos/import", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const userId = await getAuthenticatedUserId(req);
      const bodySchema = z.object({
        localId: z.coerce.number().int().positive(),
        sourceFile: z.string().max(255).optional().nullable(),
        replaceFechas: z.array(z.string()).optional(),
        items: z
          .array(
            z.object({
              fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida"),
              producto: z.string().max(255),
              categoria: z.string().max(255).optional().default(""),
              cantidad: z.coerce.number().int(),
            }),
          )
          .min(1, "No hay productos para importar"),
      });
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Datos inválidos", errors: parsed.error.flatten() });

      const locs = await storage.getLocals(clientId);
      if (!locs.some((l) => l.id === parsed.data.localId)) {
        return res.status(400).json({ message: "Local inválido para esta empresa." });
      }

      const result = await storage.importSharesProductos(
        clientId,
        parsed.data.localId,
        parsed.data.items.map((a) => ({ ...a, categoria: a.categoria ?? "" })),
        { sourceFile: parsed.data.sourceFile ?? null, createdBy: userId ?? null, replaceFechas: parsed.data.replaceFechas ?? [] },
      );
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/shares-productos/fecha", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const bodySchema = z.object({
        localId: z.coerce.number().int().positive(),
        fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      });
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Datos inválidos" });
      const count = await storage.deleteSharesProductosByFecha(clientId, parsed.data.localId, parsed.data.fecha);
      res.json({ eliminados: count });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/datalive-productos", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const localId = req.query.localId && req.query.localId !== "all" ? parseInt(req.query.localId as string, 10) : undefined;
      const fechaDesde = req.query.fechaDesde as string | undefined;
      const fechaHasta = req.query.fechaHasta as string | undefined;
      res.json(await storage.listDataliveProductos(clientId, { localId, fechaDesde, fechaHasta }));
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/datalive-productos/import", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const userId = await getAuthenticatedUserId(req);
      const bodySchema = z.object({
        localId: z.coerce.number().int().positive(),
        fechaDesde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida"),
        fechaHasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida"),
        sourceFile: z.string().max(255).optional().nullable(),
        replace: z.boolean().optional().default(false),
        items: z
          .array(
            z.object({
              producto: z.string().max(255),
              cantidad: z.coerce.number().int(),
            }),
          )
          .min(1, "No hay productos para importar"),
      });
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Datos inválidos", errors: parsed.error.flatten() });

      const locs = await storage.getLocals(clientId);
      if (!locs.some((l) => l.id === parsed.data.localId)) {
        return res.status(400).json({ message: "Local inválido para esta empresa." });
      }

      const result = await storage.importDataliveProductos(
        clientId,
        parsed.data.localId,
        parsed.data.fechaDesde,
        parsed.data.fechaHasta,
        parsed.data.items,
        { sourceFile: parsed.data.sourceFile ?? null, createdBy: userId ?? null, replace: parsed.data.replace },
      );
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/datalive-productos/periodo", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const bodySchema = z.object({
        localId: z.coerce.number().int().positive(),
        fechaDesde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        fechaHasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      });
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Datos inválidos" });
      const count = await storage.deleteDataliveProductosByPeriodo(clientId, parsed.data.localId, parsed.data.fechaDesde, parsed.data.fechaHasta);
      res.json({ eliminados: count });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ── Decomisos (mercadería decomisada — reporte de Datalive, valorizada por local) ──
  app.get("/api/decomisos", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const localId = req.query.localId && req.query.localId !== "all" ? parseInt(req.query.localId as string, 10) : undefined;
      const fechaDesde = req.query.fechaDesde as string | undefined;
      const fechaHasta = req.query.fechaHasta as string | undefined;
      const tipo = req.query.tipo && req.query.tipo !== "all" ? (req.query.tipo as string) : undefined;
      res.json(await storage.listDecomisos(clientId, { localId, fechaDesde, fechaHasta, tipo }));
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Mapeos guardados (para pre-cargar el wizard de importación)
  app.get("/api/decomisos/mappings", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const [locales, productos] = await Promise.all([
        storage.getDecomisoLocalMappings(clientId),
        storage.getDecomisoProductMappings(clientId),
      ]);
      res.json({ locales, productos });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/decomisos/import", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const userId = await getAuthenticatedUserId(req);
      const bodySchema = z.object({
        sourceFile: z.string().max(255).optional().nullable(),
        items: z
          .array(
            z.object({
              codDecomiso: z.string().max(50),
              codProducto: z.string().max(50).default(""),
              fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida"),
              descripcion: z.string().max(255),
              sucursal: z.string().max(255).default(""),
              tipoDecomiso: z.string().max(100).default(""),
              cantidad: z.coerce.number(),
              localId: z.coerce.number().int().positive(),
              supplyId: z.coerce.number().int().positive().nullable().optional(),
            }),
          )
          .min(1, "No hay decomisos para importar"),
      });
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Datos inválidos", errors: parsed.error.flatten() });

      // Validar que locales e insumos pertenezcan a la empresa.
      const [locs, sups] = await Promise.all([storage.getLocals(clientId), storage.getSupplies(clientId)]);
      const localIds = new Set(locs.map((l) => l.id));
      const supplyIds = new Set(sups.map((s: any) => s.id));
      for (const it of parsed.data.items) {
        if (!localIds.has(it.localId)) return res.status(400).json({ message: `Local inválido para esta empresa (${it.sucursal}).` });
        if (it.supplyId != null && !supplyIds.has(it.supplyId)) return res.status(400).json({ message: `Insumo inválido para esta empresa (${it.descripcion}).` });
      }

      const items = parsed.data.items.map((it) => ({ ...it, supplyId: it.supplyId ?? null }));
      const result = await storage.importDecomisos(clientId, items, {
        sourceFile: parsed.data.sourceFile ?? null,
        createdBy: userId ?? null,
      });

      // Persistir mapeos para pre-cargar futuras importaciones.
      const localMap = new Map<string, number>();
      const prodMap = new Map<string, { descripcionOriginal: string; supplyId: number }>();
      for (const it of items) {
        if (it.sucursal) localMap.set(it.sucursal, it.localId);
        if (it.codProducto && it.supplyId != null) prodMap.set(it.codProducto, { descripcionOriginal: it.descripcion, supplyId: it.supplyId });
      }
      await storage.saveDecomisoLocalMappings(clientId, Array.from(localMap, ([sucursalOriginal, localId]) => ({ sucursalOriginal, localId })));
      await storage.saveDecomisoProductMappings(clientId, Array.from(prodMap, ([codProducto, v]) => ({ codProducto, descripcionOriginal: v.descripcionOriginal, supplyId: v.supplyId })));

      res.json(result);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Borrar todos los decomisos de un archivo importado (por sourceFile).
  // IMPORTANTE: debe ir ANTES de "/api/decomisos/:id" para no colisionar con :id.
  app.delete("/api/decomisos/by-source", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const sourceFile = (req.body?.sourceFile ?? req.query.sourceFile) as string | undefined;
      if (!sourceFile || !sourceFile.trim()) return res.status(400).json({ message: "Falta el nombre del archivo" });
      const eliminados = await storage.deleteDecomisosBySource(clientId, sourceFile);
      res.json({ eliminados });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/decomisos/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const id = parseInt(req.params.id, 10);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "Id inválido" });
      const ok = await storage.deleteDecomiso(clientId, id);
      if (!ok) return res.status(404).json({ message: "Decomiso no encontrado" });
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/fudo-ventas/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const id = parseInt(req.params.id, 10);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "Id inválido" });
      const ok = await storage.deleteFudoVenta(clientId, id);
      if (!ok) return res.status(404).json({ message: "Venta no encontrada" });
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/balance-report/export", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const year = parseInt(req.query.year as string) || new Date().getFullYear();
      const month = Math.min(12, Math.max(1, parseInt(req.query.month as string) || new Date().getMonth() + 1));
      const localId = req.query.localId && req.query.localId !== "all"
        ? parseInt(req.query.localId as string)
        : undefined;
      const format = String(req.query.format || "pdf").toLowerCase();

      const spreadsheet = await storage.getBalanceSpreadsheet(clientId, year, localId);
      const fullMonths = [
        "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
        "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
      ];
      const monthlyVentas = spreadsheet.summary.income[month] ?? 0;
      const monthlyGastos = spreadsheet.summary.expenses[month] ?? 0;
      const monthlyUtilidad = monthlyVentas - monthlyGastos;
      const prevMonth = month === 1 ? 12 : month - 1;
      const prevVentas = spreadsheet.summary.income[prevMonth] ?? 0;
      const evolucionVentas = prevVentas > 0 ? ((monthlyVentas - prevVentas) / prevVentas) * 100 : null;
      const utilidadPercent = monthlyVentas > 0 ? (monthlyUtilidad / monthlyVentas) * 100 : 0;

      const expenseGroups = spreadsheet.groups.filter((g) => g.type === "expense");
      const groupedExpenseLines = expenseGroups.map((group) => {
        const categories = group.categories.map((cat) => {
          const amount = cat.monthlyTotals[month] ?? 0;
          const percent = monthlyVentas > 0 ? (amount / monthlyVentas) * 100 : 0;
          return { name: cat.name, amount, percent };
        });

        const amountFromCategories = categories.reduce((sum, cat) => sum + cat.amount, 0);
        const amountFromGroup = group.monthlyTotals[month] ?? 0;
        const groupAmount = group.categories.length > 0 ? amountFromCategories : amountFromGroup;
        const groupPercent = monthlyVentas > 0 ? (groupAmount / monthlyVentas) * 100 : 0;

        return {
          groupName: group.name,
          groupAmount,
          groupPercent,
          categories,
        };
      });

      if (format === "pdf") {
        const { default: PDFDocument } = await import("pdfkit");
        const doc = new PDFDocument({ size: "A4", margin: 40 });

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename=balance_mensual_${year}_${String(month).padStart(2, "0")}.pdf`);
        doc.pipe(res);

        const currencyFmt = new Intl.NumberFormat("es-AR", {
          style: "currency",
          currency: "ARS",
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        });

        const rightX = 520;
        const writeRow = (label: string, value: string, options?: { bold?: boolean; color?: string }) => {
          if (options?.bold) doc.font("Helvetica-Bold");
          else doc.font("Helvetica");
          if (options?.color) doc.fillColor(options.color);
          else doc.fillColor("black");
          doc.text(label, 40, doc.y, { continued: true });
          doc.text(value, rightX, doc.y, { align: "right" });
          doc.moveDown(0.2);
        };

        doc.font("Helvetica-Bold").fontSize(13).text(`EMPRESA`, 40, 42);
        doc.font("Helvetica-Bold").fontSize(13).text(`${fullMonths[month - 1]} ${year}`, rightX - 120, 42, { width: 120, align: "right" });
        doc.moveDown(1.5);

        writeRow("Evolucion de Ventas", evolucionVentas === null ? "N/A" : `${evolucionVentas.toFixed(2)}%`);
        writeRow("Ventas", currencyFmt.format(monthlyVentas), { bold: true, color: "#0f766e" });
        doc.moveDown(0.4);

        doc.font("Helvetica-Bold").fillColor("black").text("GASTOS");
        doc.moveDown(0.3);
        for (const group of groupedExpenseLines) {
          writeRow(group.groupName, currencyFmt.format(group.groupAmount), { bold: true });
          for (const cat of group.categories) {
            writeRow(`  ${cat.name}`, currencyFmt.format(cat.amount));
          }
        }
        writeRow("GASTOS TOTALES", currencyFmt.format(monthlyGastos), { bold: true, color: "#b91c1c" });
        writeRow("Utilidad", currencyFmt.format(monthlyUtilidad), {
          bold: true,
          color: monthlyUtilidad >= 0 ? "#15803d" : "#b91c1c",
        });
        doc.moveDown(0.4);

        doc.font("Helvetica-Bold").fillColor("black").text("GASTOS / UT EN %");
        doc.moveDown(0.3);
        for (const group of groupedExpenseLines) {
          writeRow(group.groupName, `${group.groupPercent.toFixed(2)}%`, { bold: true });
          for (const cat of group.categories) {
            writeRow(`  ${cat.name}`, `${cat.percent.toFixed(2)}%`);
          }
        }
        doc.font("Helvetica-Bold").fillColor("black").text("TOTAL");
        writeRow("Utilidad", `${utilidadPercent.toFixed(2)}%`, {
          bold: true,
          color: utilidadPercent >= 0 ? "#15803d" : "#b91c1c",
        });

        doc.end();
        return;
      }

      if (format === "xlsx") {
        const rows: Array<Record<string, string | number>> = [];
        rows.push({ Concepto: "EMPRESA", Valor: `${fullMonths[month - 1]} ${year}` });
        rows.push({ Concepto: "Evolucion de Ventas", Valor: evolucionVentas === null ? "N/A" : `${evolucionVentas.toFixed(2)}%` });
        rows.push({ Concepto: "Ventas", Valor: Number(monthlyVentas.toFixed(2)) });
        rows.push({ Concepto: "", Valor: "" });
        rows.push({ Concepto: "GASTOS", Valor: "" });
        for (const group of groupedExpenseLines) {
          rows.push({ Concepto: group.groupName, Valor: Number(group.groupAmount.toFixed(2)) });
          for (const cat of group.categories) {
            rows.push({ Concepto: `  ${cat.name}`, Valor: Number(cat.amount.toFixed(2)) });
          }
        }
        rows.push({ Concepto: "GASTOS TOTALES", Valor: Number(monthlyGastos.toFixed(2)) });
        rows.push({ Concepto: "Utilidad", Valor: Number(monthlyUtilidad.toFixed(2)) });
        rows.push({ Concepto: "", Valor: "" });
        rows.push({ Concepto: "GASTOS / UT EN %", Valor: "" });
        for (const group of groupedExpenseLines) {
          rows.push({ Concepto: group.groupName, Valor: `${group.groupPercent.toFixed(2)}%` });
          for (const cat of group.categories) {
            rows.push({ Concepto: `  ${cat.name}`, Valor: `${cat.percent.toFixed(2)}%` });
          }
        }
        rows.push({ Concepto: "TOTAL", Valor: "" });
        rows.push({ Concepto: "Utilidad", Valor: `${utilidadPercent.toFixed(2)}%` });

        const worksheet = XLSX.utils.json_to_sheet(rows);
        worksheet["!cols"] = [{ wch: 46 }, { wch: 20 }];
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Balance Mensual");
        const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", `attachment; filename=balance_mensual_${year}_${String(month).padStart(2, "0")}.xlsx`);
        res.send(buffer);
        return;
      }

      return res.status(400).json({ message: "Formato no soportado. Usa format=pdf o format=xlsx" });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/dashboard/stats", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const year = parseInt(req.query.year as string) || new Date().getFullYear();
      const localId = req.query.localId as string;
      
      const invoices = await storage.getInvoices(clientId);
      const recipes = await storage.getRecipes(clientId);
      const allSales = await storage.getSales(clientId);
      
      const today = new Date();
      const oneWeekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
      const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      const startOfYear = new Date(year, 0, 1);
      const endOfYear = new Date(year, 11, 31);
      
      const filteredInvoices = invoices.filter(inv => {
        if (localId && localId !== "all" && inv.localId !== parseInt(localId)) return false;
        return true;
      });
      
      const filteredSales = allSales.filter(sale => {
        if (localId && localId !== "all" && sale.localId !== parseInt(localId)) return false;
        return true;
      });
      
      const yearlyInvoices = filteredInvoices.filter(inv => {
        const d = new Date(inv.invoiceDate);
        return d >= startOfYear && d <= endOfYear;
      });
      
      const yearlySales = filteredSales.filter(sale => {
        const d = new Date(sale.saleDate);
        return d >= startOfYear && d <= endOfYear;
      });
      
      const monthlySales = filteredSales.filter(sale => {
        const d = new Date(sale.saleDate);
        return d >= startOfMonth && d <= today;
      });
      
      const weeklySales = filteredSales.filter(sale => {
        const d = new Date(sale.saleDate);
        return d >= oneWeekAgo && d <= today;
      });
      
      const yearlyExpenses = yearlyInvoices.reduce((sum, inv) => sum + parseFloat(String(inv.total) || "0"), 0);
      const yearlySalesTotal = yearlySales.reduce((sum, sale) => sum + parseFloat(String(sale.total) || "0"), 0);
      const monthlySalesTotal = monthlySales.reduce((sum, sale) => sum + parseFloat(String(sale.total) || "0"), 0);
      const weeklySalesTotal = weeklySales.reduce((sum, sale) => sum + parseFloat(String(sale.total) || "0"), 0);
      
      const productSalesMap = new Map<string, { name: string; quantity: number; total: number }>();
      yearlySales.forEach(sale => {
        const name = sale.productName;
        const existing = productSalesMap.get(name) || { name, quantity: 0, total: 0 };
        existing.quantity += parseFloat(String(sale.quantity) || "0");
        existing.total += parseFloat(String(sale.total) || "0");
        productSalesMap.set(name, existing);
      });
      
      const topProducts = Array.from(productSalesMap.values())
        .sort((a, b) => b.total - a.total)
        .slice(0, 10);
      
      const topMarginRecipes = recipes
        .filter(r => r.active && parseFloat(String(r.margin) || "0") > 0)
        .sort((a, b) => parseFloat(String(b.margin) || "0") - parseFloat(String(a.margin) || "0"))
        .slice(0, 10)
        .map(r => ({
          name: r.name,
          margin: parseFloat(String(r.margin) || "0"),
          marginPercentage: parseFloat(String(r.salePrice) || "0") > 0 
            ? (parseFloat(String(r.margin) || "0") / parseFloat(String(r.salePrice) || "0")) * 100 
            : 0,
        }));
      
      const paymentMethodMap = new Map<string, number>();
      yearlySales.forEach(sale => {
        const method = sale.paymentMethod || "Otro";
        paymentMethodMap.set(method, (paymentMethodMap.get(method) || 0) + parseFloat(String(sale.total) || "0"));
      });
      
      const paymentMethods = Array.from(paymentMethodMap.entries())
        .map(([method, total]) => ({
          method,
          total,
          percentage: yearlySalesTotal > 0 ? (total / yearlySalesTotal) * 100 : 0,
        }))
        .sort((a, b) => b.total - a.total);
      
      const invoicedSales = yearlySales.filter(s => s.invoiced).reduce((sum, s) => sum + parseFloat(String(s.total) || "0"), 0);
      const notInvoicedSales = yearlySalesTotal - invoicedSales;
      
      res.json({
        weeklySales: weeklySalesTotal,
        monthlySales: monthlySalesTotal,
        yearlyStats: { 
          sales: yearlySalesTotal, 
          expenses: yearlyExpenses, 
          profit: yearlySalesTotal - yearlyExpenses 
        },
        topProducts: topProducts.length > 0 ? topProducts : recipes
          .filter(r => r.active && parseFloat(String(r.salePrice) || "0") > 0)
          .sort((a, b) => parseFloat(String(b.salePrice) || "0") - parseFloat(String(a.salePrice) || "0"))
          .slice(0, 10)
          .map(r => ({ name: r.name, quantity: 0, total: parseFloat(String(r.salePrice) || "0") })),
        topCategories: [],
        topMargins: topMarginRecipes,
        paymentMethods: paymentMethods.length > 0 ? paymentMethods : [
          { method: "Efectivo", total: 0, percentage: 40 },
          { method: "Transferencia", total: 0, percentage: 35 },
          { method: "Tarjeta", total: 0, percentage: 25 },
        ],
        invoicedVsNot: { invoiced: invoicedSales, notInvoiced: notInvoicedSales },
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ==========================================
  // PERMISSIONS API
  // ==========================================
  
  app.get("/api/permissions", isAuthenticated, async (req, res) => {
    try {
      const perms = await storage.getPermissions();
      res.json(perms);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Permisos efectivos del usuario actual, para gating de la UI (sidebar/botones).
  // socio => isSocio:true (allow-all en el front). El resto: mapa code -> flags.
  app.get("/api/me/permissions", isAuthenticated, async (req, res) => {
    try {
      const actorId = await getAuthenticatedUserId(req);
      if (!actorId) return res.status(401).json({ message: "No autenticado" });
      const clientId = await getClientId(req);
      const role = String((await storage.getUserRoleInClient(actorId, clientId)) ?? "")
        .trim()
        .toLowerCase();

      if (role === "socio") {
        return res.json({ role, isSocio: true, permissions: {} });
      }

      const [allPerms, rolePerms] = await Promise.all([
        storage.getPermissions(),
        storage.getRolePermissions(clientId, role),
      ]);
      const codeById = new Map(allPerms.map((p) => [p.id, p.code]));
      const permissions: Record<
        string,
        { canView: boolean; canCreate: boolean; canEdit: boolean; canDelete: boolean }
      > = {};
      for (const rp of rolePerms) {
        const code = codeById.get(rp.permissionId);
        if (!code) continue;
        permissions[code] = {
          canView: !!rp.canView,
          canCreate: !!rp.canCreate,
          canEdit: !!rp.canEdit,
          canDelete: !!rp.canDelete,
        };
      }
      res.json({ role, isSocio: false, permissions });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/permissions/seed", isAuthenticated, async (req, res) => {
    try {
      const defaultPermissions = [
        { code: "dashboard.view", name: "Ver Dashboard", module: "dashboard" },
        { code: "suppliers.view", name: "Ver Proveedores", module: "suppliers" },
        { code: "suppliers.create", name: "Crear Proveedores", module: "suppliers" },
        { code: "suppliers.edit", name: "Editar Proveedores", module: "suppliers" },
        { code: "suppliers.delete", name: "Eliminar Proveedores", module: "suppliers" },
        { code: "supplies.view", name: "Ver Insumos", module: "supplies" },
        { code: "supplies.create", name: "Crear Insumos", module: "supplies" },
        { code: "supplies.edit", name: "Editar Insumos", module: "supplies" },
        { code: "supplies.delete", name: "Eliminar Insumos", module: "supplies" },
        { code: "invoices.view", name: "Ver Facturas", module: "invoices" },
        { code: "invoices.create", name: "Crear Facturas", module: "invoices" },
        { code: "invoices.edit", name: "Editar Facturas", module: "invoices" },
        { code: "invoices.delete", name: "Eliminar Facturas", module: "invoices" },
        { code: "payments.view", name: "Ver Pagos", module: "payments" },
        { code: "payments.create", name: "Registrar Pagos", module: "payments" },
        { code: "recipes.view", name: "Ver Recetas", module: "recipes" },
        { code: "recipes.create", name: "Crear Recetas", module: "recipes" },
        { code: "recipes.edit", name: "Editar Recetas", module: "recipes" },
        { code: "recipes.delete", name: "Eliminar Recetas", module: "recipes" },
        { code: "bank.view", name: "Ver Extractos Bancarios", module: "bank" },
        { code: "bank.import", name: "Importar Extractos", module: "bank" },
        { code: "transactions.view", name: "Ver Transacciones", module: "transactions" },
        { code: "transactions.edit", name: "Categorizar Transacciones", module: "transactions" },
        { code: "balances.view", name: "Ver Balances P&G", module: "balances" },
        { code: "stock.view", name: "Ver Stock", module: "stock" },
        { code: "stock.adjust", name: "Ajustar Stock", module: "stock" },
        { code: "audits.view", name: "Ver Auditorías", module: "audits" },
        { code: "audits.create", name: "Realizar Auditorías", module: "audits" },
        { code: "employees.view", name: "Ver Empleados", module: "employees" },
        { code: "employees.manage", name: "Gestionar Empleados", module: "employees" },
        { code: "payroll.view", name: "Ver Liquidaciones", module: "payroll" },
        { code: "payroll.manage", name: "Gestionar Liquidaciones", module: "payroll" },
        { code: "settings.view", name: "Ver Configuración", module: "settings" },
        { code: "settings.manage", name: "Gestionar Configuración", module: "settings" },
        { code: "users.view", name: "Ver Usuarios", module: "users" },
        { code: "users.manage", name: "Gestionar Usuarios", module: "users" },

        // === Permisos nuevos — sub-módulos financieros (ROADMAP_BETA Fase 0 §2.2) ===
        { code: "financial_groups.edit", name: "Renombrar Grupos y Categorías", module: "financial_groups" },
        { code: "bank.config", name: "Configurar Bancos (banco genérico)", module: "bank" },
        { code: "cmc.view", name: "Ver CMC (Costo de Mercadería Comprada)", module: "cmc" },
        { code: "pap.view", name: "Ver PAP (Pago a Proveedores)", module: "pap" },
        { code: "stock_valuation.view", name: "Ver Valorización de Stock", module: "stock_valuation" },
        { code: "stock_valuation.create", name: "Cargar/Importar Valorización de Stock", module: "stock_valuation" },
        { code: "stock_valuation.delete", name: "Reversar Valorización de Stock", module: "stock_valuation" },
        { code: "cmv.view", name: "Ver CMV (Costo de Mercadería Vendida)", module: "cmv" },
        { code: "breakeven.view", name: "Ver Punto de Equilibrio", module: "breakeven" },
        { code: "breakeven.create", name: "Crear Punto de Equilibrio", module: "breakeven" },
      ];

      // Inserción idempotente y aditiva: solo se crean los `code` que aún no existen.
      // Nunca se actualiza ni se borra un permiso existente (seguro para datos de producción).
      const existing = await storage.getPermissions();
      const existingCodes = new Set(existing.map((p) => p.code));
      let created = 0;
      for (const perm of defaultPermissions) {
        if (existingCodes.has(perm.code)) continue;
        try {
          await storage.createPermission(perm);
          created++;
        } catch (e) {
          // Carrera/duplicado: ignorar (el code es UNIQUE, nunca se pisa).
        }
      }

      const allPerms = await storage.getPermissions();
      res.json({ created, total: allPerms.length, permissions: allPerms });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/role-permissions", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const role = req.query.role as string;
      const perms = await storage.getRolePermissions(clientId, role);
      res.json(perms);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/role-permissions", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const result = await storage.setRolePermission({ ...req.body, clientId });
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/role-permissions/:role/:permissionId", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const deleted = await storage.deleteRolePermission(
        clientId, 
        req.params.role, 
        parseInt(req.params.permissionId)
      );
      res.json({ success: deleted });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ==========================================
  // USER LOCAL ASSIGNMENTS API
  // ==========================================

  app.get("/api/user-local-assignments", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const userId = req.query.userId as string;
      const assignments = await storage.getUserLocalAssignments(clientId, userId);
      res.json(assignments);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/user-local-assignments", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const assignment = await storage.createUserLocalAssignment({ ...req.body, clientId });
      res.json(assignment);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/user-local-assignments/:id", isAuthenticated, async (req, res) => {
    try {
      const updated = await storage.updateUserLocalAssignment(parseInt(req.params.id), req.body);
      if (!updated) return res.status(404).json({ message: "Asignación no encontrada" });
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/user-local-assignments/:id", isAuthenticated, async (req, res) => {
    try {
      const deleted = await storage.deleteUserLocalAssignment(parseInt(req.params.id));
      res.json({ success: deleted });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ==========================================
  // NOTIFICATIONS API
  // ==========================================

  app.get("/api/notifications", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const user = req.user as any;
      const notifs = await storage.getNotifications(clientId, user?.id);
      res.json(notifs);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/notifications", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const notification = await storage.createNotification({ ...req.body, clientId });
      res.json(notification);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/notifications/:id/read", isAuthenticated, async (req, res) => {
    try {
      const updated = await storage.markNotificationRead(parseInt(req.params.id));
      if (!updated) return res.status(404).json({ message: "Notificación no encontrada" });
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ==========================================
  // STOCK API
  // ==========================================

  app.get("/api/stock-levels", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const localId = req.query.localId ? parseInt(req.query.localId as string) : undefined;
      const levels = await storage.getStockLevels(clientId, localId);
      res.json(levels);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/stock-levels", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const level = await storage.upsertStockLevel({ ...req.body, clientId });
      res.json(level);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/stock-movements", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const localId = req.query.localId ? parseInt(req.query.localId as string) : undefined;
      const movements = await storage.getStockMovements(clientId, localId);
      res.json(movements);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/stock-movements", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const user = req.user as any;
      const movement = await storage.createStockMovement({ ...req.body, clientId, createdBy: user?.id });
      res.json(movement);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/stock-adjustments", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const localId = req.query.localId ? parseInt(req.query.localId as string) : undefined;
      const adjustments = await storage.getStockAdjustments(clientId, localId);
      res.json(adjustments);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/stock-adjustments", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const user = req.user as any;
      
      const adjustment = await storage.createStockAdjustment({ 
        ...req.body, 
        clientId, 
        createdBy: user?.id 
      });
      
      // Update stock level with new actual count
      await storage.upsertStockLevel({
        clientId,
        localId: req.body.localId,
        supplyId: req.body.supplyId,
        actualStock: req.body.actualCount,
        theoreticalStock: req.body.actualCount,
        lastCountDate: new Date(),
      });
      
      res.json(adjustment);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ==========================================
  // AUDIT TEMPLATES API
  // ==========================================

  app.get("/api/audit-templates", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const templates = await storage.getAuditTemplates(clientId);
      res.json(templates);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/audit-templates/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const template = await storage.getAuditTemplate(clientId, parseInt(req.params.id));
      if (!template) return res.status(404).json({ message: "Plantilla no encontrada" });
      
      const items = await storage.getAuditTemplateItems(template.id);
      res.json({ ...template, items });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/audit-templates", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const { items, ...templateData } = req.body;
      
      const template = await storage.createAuditTemplate({ ...templateData, clientId });
      
      if (items && items.length > 0) {
        for (const item of items) {
          await storage.createAuditTemplateItem({ ...item, templateId: template.id });
        }
      }
      
      const allItems = await storage.getAuditTemplateItems(template.id);
      res.json({ ...template, items: allItems });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/audit-templates/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const updated = await storage.updateAuditTemplate(clientId, parseInt(req.params.id), req.body);
      if (!updated) return res.status(404).json({ message: "Plantilla no encontrada" });
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/audit-templates/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const deleted = await storage.deleteAuditTemplate(clientId, parseInt(req.params.id));
      res.json({ success: deleted });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ==========================================
  // OPERATIONAL AUDITS API
  // ==========================================

  app.get("/api/operational-audits", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const localId = req.query.localId ? parseInt(req.query.localId as string) : undefined;
      const audits = await storage.getOperationalAudits(clientId, localId);
      res.json(audits);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/operational-audits/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const audit = await storage.getOperationalAudit(clientId, parseInt(req.params.id));
      if (!audit) return res.status(404).json({ message: "Auditoría no encontrada" });
      
      const results = await storage.getAuditResults(audit.id);
      res.json({ ...audit, results });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/operational-audits", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const user = req.user as any;
      const { results, ...auditData } = req.body;
      
      const audit = await storage.createOperationalAudit({ 
        ...auditData, 
        clientId, 
        auditor: user?.id 
      });
      
      if (results && results.length > 0) {
        for (const result of results) {
          await storage.createAuditResult({ ...result, auditId: audit.id });
        }
      }
      
      const allResults = await storage.getAuditResults(audit.id);
      const approvedCount = allResults.filter(r => r.approved).length;
      const totalCount = allResults.length;
      const percentage = totalCount > 0 ? (approvedCount / totalCount) * 100 : 0;
      
      const updatedAudit = await storage.updateOperationalAudit(clientId, audit.id, {
        totalItems: totalCount,
        approvedItems: approvedCount,
        approvalPercentage: percentage.toString(),
      });
      
      res.json({ ...updatedAudit, results: allResults });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/operational-audits/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const updated = await storage.updateOperationalAudit(clientId, parseInt(req.params.id), req.body);
      if (!updated) return res.status(404).json({ message: "Auditoría no encontrada" });
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/operational-audits/:id/complete", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const auditId = parseInt(req.params.id);
      
      const results = await storage.getAuditResults(auditId);
      const approvedCount = results.filter(r => r.approved).length;
      const totalCount = results.length;
      const percentage = totalCount > 0 ? (approvedCount / totalCount) * 100 : 0;
      
      const updated = await storage.updateOperationalAudit(clientId, auditId, {
        status: "completed",
        completedAt: new Date(),
        totalItems: totalCount,
        approvedItems: approvedCount,
        approvalPercentage: percentage.toString(),
      });
      
      if (!updated) return res.status(404).json({ message: "Auditoría no encontrada" });
      res.json({ ...updated, results });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ==========================================
  // EMPLOYEES API (RRHH)
  // ==========================================

  app.get("/api/employees", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const localId = req.query.localId ? parseInt(req.query.localId as string) : undefined;
      const emps = await storage.getEmployees(clientId, localId);
      res.json(emps);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/employees/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const employee = await storage.getEmployee(clientId, parseInt(req.params.id));
      if (!employee) return res.status(404).json({ message: "Empleado no encontrado" });
      res.json(employee);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/employees", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const employee = await storage.createEmployee({ ...req.body, clientId });
      res.json(employee);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/employees/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const updated = await storage.updateEmployee(clientId, parseInt(req.params.id), req.body);
      if (!updated) return res.status(404).json({ message: "Empleado no encontrado" });
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/employees/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const deleted = await storage.deleteEmployee(clientId, parseInt(req.params.id));
      res.json({ success: deleted });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ==========================================
  // ATTENDANCE API
  // ==========================================

  app.get("/api/attendances", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const employeeId = req.query.employeeId ? parseInt(req.query.employeeId as string) : undefined;
      const date = req.query.date as string | undefined;
      const atts = await storage.getAttendances(clientId, employeeId, date);
      res.json(atts);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/attendances", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const attendance = await storage.createAttendance({ ...req.body, clientId });
      res.json(attendance);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/attendances/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const updated = await storage.updateAttendance(clientId, parseInt(req.params.id), req.body);
      if (!updated) return res.status(404).json({ message: "Registro no encontrado" });
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ==========================================
  // PAYROLL API
  // ==========================================

  app.get("/api/payrolls", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const employeeId = req.query.employeeId ? parseInt(req.query.employeeId as string) : undefined;
      const period = req.query.period as string | undefined;
      const pays = await storage.getPayrolls(clientId, employeeId, period);
      res.json(pays);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/payrolls", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const user = req.user as any;
      
      const baseSalary = parseFloat(req.body.baseSalary || "0");
      const overtime = parseFloat(req.body.overtime || "0");
      const bonuses = parseFloat(req.body.bonuses || "0");
      const deductions = parseFloat(req.body.deductions || "0");
      const netSalary = baseSalary + overtime + bonuses - deductions;
      
      const payroll = await storage.createPayroll({ 
        ...req.body, 
        clientId, 
        createdBy: user?.id,
        netSalary: netSalary.toString(),
      });
      res.json(payroll);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/payrolls/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      if (req.body.baseSalary !== undefined || req.body.overtime !== undefined || 
          req.body.bonuses !== undefined || req.body.deductions !== undefined) {
        const baseSalary = parseFloat(req.body.baseSalary || "0");
        const overtime = parseFloat(req.body.overtime || "0");
        const bonuses = parseFloat(req.body.bonuses || "0");
        const deductions = parseFloat(req.body.deductions || "0");
        req.body.netSalary = (baseSalary + overtime + bonuses - deductions).toString();
      }
      
      const updated = await storage.updatePayroll(clientId, parseInt(req.params.id), req.body);
      if (!updated) return res.status(404).json({ message: "Liquidación no encontrada" });
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ==========================================
  // TEAM/USER MANAGEMENT API
  // ==========================================

  app.get("/api/team/users", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const rows = await storage.getClientUsers(clientId);
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  const patchTeamMemberSchema = z
    .object({
      email: z.string().email().optional(),
      firstName: z.string().trim().max(100).optional(),
      lastName: z.string().trim().max(100).optional(),
    })
    .strict();

  app.patch("/api/team/users/:targetUserId", isAuthenticated, async (req, res) => {
    try {
      const gate = await assertTeamPrivileged(req, res);
      if (!gate.ok) return;
      const parsed = patchTeamMemberSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0]?.message || "Datos inválidos" });
      }
      const targetUserId = req.params.targetUserId;
      const body = parsed.data;
      const patch: { firstName?: string | null; lastName?: string | null; email?: string | null } = {};
      if (body.firstName !== undefined) patch.firstName = body.firstName === "" ? null : body.firstName;
      if (body.lastName !== undefined) patch.lastName = body.lastName === "" ? null : body.lastName;
      if (body.email !== undefined) patch.email = body.email.trim();
      try {
        const updated = await storage.updateClientUserProfile(gate.clientId, targetUserId, patch);
        if (!updated) return res.status(404).json({ message: "Usuario no encontrado en esta empresa" });
        res.json(updated);
      } catch (inner: any) {
        if (String(inner?.message) === "EMAIL_CONFLICT") {
          return res.status(409).json({ message: "Ese correo ya está en uso por otra cuenta" });
        }
        throw inner;
      }
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/team/users/:targetUserId/role", isAuthenticated, async (req, res) => {
    try {
      const gate = await assertTeamPrivileged(req, res);
      if (!gate.ok) return;
      const role = normalizeTeamRole(req.body?.role);
      const ok = await storage.setUserRoleInClient(gate.clientId, req.params.targetUserId, role);
      if (!ok) return res.status(404).json({ message: "Usuario no encontrado en esta empresa" });
      res.json({ success: true, role });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/team/users/:targetUserId/reset-password", isAuthenticated, async (req, res) => {
    try {
      const gate = await assertTeamPrivileged(req, res);
      if (!gate.ok) return;

      const member = await storage.getUser(req.params.targetUserId);
      if (!member?.email?.trim()) {
        return res.status(400).json({ message: "El usuario no tiene email; cargá uno para que puedan ingresar" });
      }

      const inClient = await storage.getUserRoleInClient(member.id, gate.clientId);
      if (inClient === null) {
        return res.status(404).json({ message: "Usuario no encontrado en esta empresa" });
      }

      const provisionalPassword = generateProvisionalPassword();
      const passwordHash = await hashPassword(provisionalPassword);
      await storage.setUserPasswordHash(member.id, passwordHash, true);

      const loginEmail = member.email.trim().toLowerCase();
      let mailSent = false;

      if (isMailConfigured()) {
        try {
          const [company] = await db
            .select({ name: clients.name })
            .from(clients)
            .where(eq(clients.id, gate.clientId))
            .limit(1);
          await sendTeamWelcomeEmail({
            to: loginEmail,
            provisionalPassword,
            companyName: company?.name ?? null,
          });
          mailSent = true;
        } catch (mailErr: any) {
          console.error("SMTP reset-password:", mailErr);
        }
      }

      res.json({
        success: true,
        loginEmail,
        provisionalPassword,
        mailSent,
        message: mailSent
          ? "Se envió también un correo con la nueva contraseña."
          : "Contraseña provisoria generada: copiala y pasáselo al usuario (no hay SMTP o falló el envío).",
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/team/users/:targetUserId", isAuthenticated, async (req, res) => {
    try {
      const gate = await assertTeamPrivileged(req, res);
      if (!gate.ok) return;

      const targetUserId = req.params.targetUserId;
      if (targetUserId === gate.actorId) {
        return res.status(400).json({ message: "No podés quitarte del equipo vos mismo desde acá." });
      }

      const ok = await storage.removeUserFromClient(gate.clientId, targetUserId);
      if (!ok) return res.status(404).json({ message: "Usuario no encontrado en esta empresa" });

      const remaining = await storage.countClientsForUser(targetUserId);
      if (remaining === 0) {
        await db.update(users).set({ isActive: false, updatedAt: new Date() }).where(eq(users.id, targetUserId));
      }

      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/team/reassign", isAuthenticated, async (req, res) => {
    try {
      const gate = await assertTeamPrivileged(req, res);
      if (!gate.ok) return;
      const clientId = gate.clientId;
      const { userId, role } = req.body;
      if (!userId) {
        return res.status(400).json({ message: "userId requerido" });
      }
      const normalizedRole = normalizeTeamRole(role);
      const updated = await storage.setUserRoleInClient(clientId, userId, normalizedRole);
      if (!updated) {
        return res.status(404).json({ message: "Usuario no encontrado en esta empresa" });
      }
      res.json({ success: true, message: "Rol actualizado" });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ==========================================
  // INVITATIONS API
  // ==========================================

  app.get("/api/invitations", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const invites = await storage.getClientInvitations(clientId);
      res.json(invites);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/invitations", isAuthenticated, async (req, res) => {
    try {
      const gate = await assertTeamPrivileged(req, res);
      if (!gate.ok) return;

      const parsed = inviteTeamMemberBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0]?.message || "Datos inválidos" });
      }

      const normalizedEmail = parsed.data.email.toLowerCase().trim();
      const role = normalizeTeamRole(parsed.data.role);
      const fn = parsed.data.firstName?.trim() || "";
      const ln = parsed.data.lastName?.trim() || "";
      const provisionalPassword = generateProvisionalPassword();
      const passwordHash = await hashPassword(provisionalPassword);

      const [company] = await db
        .select({ name: clients.name })
        .from(clients)
        .where(eq(clients.id, gate.clientId))
        .limit(1);

      const existing = await storage.getUserByEmail(normalizedEmail);
      let targetUserId: string;

      if (existing) {
        const already = await storage.getUserRoleInClient(existing.id, gate.clientId);
        if (already !== null) {
          return res.status(409).json({ message: "Este correo ya pertenece al equipo." });
        }
        await storage.addUserToClient(existing.id, gate.clientId, role);
        const [credRow] = await db
          .select({ id: userCredentials.id })
          .from(userCredentials)
          .where(eq(userCredentials.userId, existing.id))
          .limit(1);

        if (credRow) {
          await storage.setUserPasswordHash(existing.id, passwordHash, true);
        } else {
          await db.insert(userCredentials).values({
            userId: existing.id,
            passwordHash,
            loginType: "email",
            mustChangePassword: true,
          });
        }

        const namePatch: { firstName?: string | null; lastName?: string | null } = {};
        if (fn) namePatch.firstName = fn;
        if (ln) namePatch.lastName = ln;
        if (fn || ln) {
          await storage.updateClientUserProfile(gate.clientId, existing.id, namePatch).catch(() => undefined);
        }
        targetUserId = existing.id;
      } else {
        targetUserId = randomUUID();
        await db.insert(users).values({
          id: targetUserId,
          email: normalizedEmail,
          firstName: fn || null,
          lastName: ln || null,
          role,
          isActive: true,
          emailVerified: false,
        });
        await db.insert(userCredentials).values({
          userId: targetUserId,
          passwordHash,
          loginType: "email",
          mustChangePassword: true,
        });
        await storage.addUserToClient(targetUserId, gate.clientId, role);
      }

      let mailSent = false;
      if (isMailConfigured()) {
        try {
          await sendTeamWelcomeEmail({
            to: normalizedEmail,
            provisionalPassword,
            companyName: company?.name ?? null,
          });
          mailSent = true;
        } catch (mailErr: any) {
          console.error("SMTP invitation:", mailErr);
        }
      }

      res.json({
        success: true,
        userId: targetUserId,
        loginEmail: normalizedEmail,
        provisionalPassword,
        mailSent,
        message: mailSent
          ? "Usuario creado; también se intentó enviar el correo con la bienvenida."
          : "Usuario listo: copiá email y contraseña y pasáselo por WhatsApp/correo (sin SMTP configurado no se envía automático).",
      });
    } catch (e: any) {
      console.error("POST /api/invitations:", e);
      res.status(500).json({ message: e.message || "Error al invitar usuario" });
    }
  });

  app.post("/api/invitations/use/:code", isAuthenticated, async (req, res) => {
    try {
      const session = req.session as any;
      const oidcUser = req.user as any;
      const userId: string | undefined =
        session?.userId || oidcUser?.claims?.sub || oidcUser?.id;
      if (!userId) {
        return res.status(401).json({ message: "No autenticado" });
      }
      const result = await storage.useInvitation(req.params.code, userId);
      if (!result) {
        return res.status(400).json({ message: "Invitación inválida o expirada" });
      }
      res.json({ success: true, message: "Te uniste a la empresa exitosamente" });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/invitations/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const deleted = await storage.deleteInvitation(clientId, parseInt(req.params.id));
      if (!deleted) return res.status(404).json({ message: "Invitación no encontrada" });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/invitations/check/:code", async (req, res) => {
    try {
      const invitation = await storage.getInvitationByCode(req.params.code);
      if (!invitation || invitation.status !== "pending") {
        return res.status(404).json({ valid: false, message: "Invitación no encontrada" });
      }
      if (invitation.expiresAt && new Date(invitation.expiresAt) < new Date()) {
        return res.status(400).json({ valid: false, message: "Invitación expirada" });
      }
      res.json({ valid: true, role: invitation.role });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  registerBulkInvoiceImportRoutes(app);

  // ==========================================
  // MERCHANDISE TRANSFERS (Traslados de Mercadería)
  // ==========================================

  app.get("/api/merchandise-transfers", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.getMerchandiseTransfers(clientId);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/merchandise-transfers", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const userId = (await getAuthenticatedUserId(req)) ?? "";
      const { items, ...transferBody } = req.body;

      if (!transferBody.fromLocalId || !transferBody.toLocalId) {
        return res.status(400).json({ message: "fromLocalId y toLocalId son requeridos" });
      }
      if (transferBody.fromLocalId === transferBody.toLocalId) {
        return res.status(400).json({ message: "El local de origen y destino deben ser distintos" });
      }
      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: "Debe incluir al menos un ítem" });
      }

      const transfer = await storage.createMerchandiseTransfer(
        { ...transferBody, clientId, createdBy: userId },
        items,
      );
      res.json(transfer);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/merchandise-transfers/:id/reverse", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const ok = await storage.reverseMerchandiseTransfer(clientId, parseInt(req.params.id, 10));
      if (!ok) return res.status(404).json({ message: "Traslado no encontrado" });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ==========================================
  // MONTHLY GOALS (Objetivos mensuales)
  // ==========================================

  app.get("/api/monthly-goals", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const year = parseInt(String(req.query.year ?? new Date().getFullYear()), 10);
      const month = parseInt(String(req.query.month ?? new Date().getMonth() + 1), 10);
      const goals = await storage.getMonthlyGoals(clientId, year, month);
      res.json(goals);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get("/api/monthly-goals/all", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      res.json(await storage.listAllMonthlyGoals(clientId));
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // Mapeo producto vendido → receta (punto 18)
  app.get("/api/product-recipe-mappings", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      res.json(await storage.listProductRecipeMappings(clientId));
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.post("/api/product-recipe-mappings", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const source = String(req.body?.source ?? "").trim();
      const productName = String(req.body?.productName ?? "").trim();
      const recipeId = parseInt(String(req.body?.recipeId), 10);
      if (!source || !productName || !Number.isFinite(recipeId)) {
        return res.status(400).json({ message: "source, productName y recipeId son obligatorios" });
      }
      res.json(await storage.upsertProductRecipeMapping(clientId, source, productName, recipeId));
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.delete("/api/product-recipe-mappings/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ message: "ID inválido" });
      await storage.deleteProductRecipeMapping(clientId, id);
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.put("/api/monthly-goals", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const schema = z.object({
        localId: z.coerce.number().int().positive(),
        year: z.coerce.number().int().min(2020).max(2100),
        month: z.coerce.number().int().min(1).max(12),
        facturacionObjetivo: z.coerce.number().nullable().optional(),
        ticketsObjetivo: z.coerce.number().int().nullable().optional(),
        cmvObjetivo: z.coerce.number().nullable().optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Datos inválidos", errors: parsed.error.flatten() });
      const goal = await storage.upsertMonthlyGoal(clientId, parsed.data);
      res.json(goal);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.delete("/api/monthly-goals", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const schema = z.object({
        localId: z.coerce.number().int().positive(),
        year: z.coerce.number().int(),
        month: z.coerce.number().int(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Datos inválidos" });
      await storage.deleteMonthlyGoal(clientId, parsed.data.localId, parsed.data.year, parsed.data.month);
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // ==========================================
  // DASHBOARD API
  // ==========================================

  app.get("/api/dashboard/ventas-summary", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const year = parseInt(String(req.query.year ?? new Date().getFullYear()), 10);
      const month = parseInt(String(req.query.month ?? new Date().getMonth() + 1), 10);
      const localIds = String(req.query.localIds ?? "").split(",").map(Number).filter((n) => n > 0);
      const source = String(req.query.source ?? "fudo") as "fudo" | "datalive" | "shares";
      const data = await storage.getDashboardVentasSummary(clientId, year, month, localIds, source);
      res.json(data);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get("/api/dashboard/saldos", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const year = parseInt(String(req.query.year ?? new Date().getFullYear()), 10);
      const month = parseInt(String(req.query.month ?? new Date().getMonth() + 1), 10);
      const data = await storage.getDashboardSaldos(clientId, year, month);
      res.json(data);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get("/api/dashboard/deudas-proveedores", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.getDashboardDeudasProveedores(clientId);
      res.json(data);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get("/api/dashboard/ventas-semanales", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const weekStart = String(req.query.weekStart ?? "");
      const localIds = String(req.query.localIds ?? "").split(",").map(Number).filter((n) => n > 0);
      const source = String(req.query.source ?? "fudo") as "fudo" | "datalive" | "shares";
      if (!weekStart.match(/^\d{4}-\d{2}-\d{2}$/)) return res.status(400).json({ message: "weekStart inválido" });
      const data = await storage.getDashboardVentasSemanales(clientId, weekStart, localIds, source);
      res.json(data);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get("/api/dashboard/cmv-semanal", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const dateFrom = String(req.query.dateFrom ?? "");
      const dateTo = String(req.query.dateTo ?? "");
      const weekStart = req.query.weekStart ? String(req.query.weekStart) : undefined;
      const localIds = String(req.query.localIds ?? "").split(",").map(Number).filter((n) => n > 0);
      const data = await storage.getDashboardCmvPeriodo(clientId, dateFrom, dateTo, localIds, weekStart);
      res.json(data);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get("/api/dashboard/top-productos", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const dateFrom = String(req.query.dateFrom ?? "");
      const dateTo = String(req.query.dateTo ?? "");
      const localIds = String(req.query.localIds ?? "").split(",").map(Number).filter((n) => n > 0);
      const source = String(req.query.source ?? "fudo") as "fudo" | "datalive" | "shares";
      const data = await storage.getDashboardTopProductos(clientId, dateFrom, dateTo, localIds, source);
      res.json(data);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get("/api/dashboard/top-categorias", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const dateFrom = String(req.query.dateFrom ?? "");
      const dateTo = String(req.query.dateTo ?? "");
      const localIds = String(req.query.localIds ?? "").split(",").map(Number).filter((n) => n > 0);
      const source = String(req.query.source ?? "fudo") as "fudo" | "datalive" | "shares";
      const data = await storage.getDashboardTopCategorias(clientId, dateFrom, dateTo, localIds, source);
      res.json(data);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get("/api/dashboard/composicion-pagos", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const year = parseInt(String(req.query.year ?? new Date().getFullYear()), 10);
      const month = parseInt(String(req.query.month ?? new Date().getMonth() + 1), 10);
      const localIds = String(req.query.localIds ?? "").split(",").map(Number).filter((n) => n > 0);
      const source = String(req.query.source ?? "fudo") as "fudo" | "datalive" | "shares";
      const data = await storage.getDashboardComposicionPagos(clientId, year, month, localIds, source);
      res.json(data);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get("/api/dashboard/evolucion-mensual", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const year = parseInt(String(req.query.year ?? new Date().getFullYear()), 10);
      const localIds = String(req.query.localIds ?? "").split(",").map(Number).filter((n) => n > 0);
      const source = String(req.query.source ?? "fudo") as "fudo" | "datalive" | "shares";
      const data = await storage.getDashboardEvolucionMensual(clientId, year, localIds, source);
      res.json(data);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get("/api/dashboard/top3-balance", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const year = parseInt(String(req.query.year ?? new Date().getFullYear()), 10);
      const localId = req.query.localId ? parseInt(String(req.query.localId), 10) : undefined;
      const data = await storage.getDashboardTop3Balance(clientId, year, localId);
      res.json(data);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.use("/api", (req, res) => {
    if (req.method === "OPTIONS") {
      return res.status(204).end();
    }
    res.status(404).json({
      message: `Ruta API no encontrada: ${req.method} ${req.originalUrl}`,
    });
  });

  return httpServer;
}
