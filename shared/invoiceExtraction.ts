/**
 * Factura Digital — contrato de lectura de un comprobante con IA (ago-2026).
 *
 * El esquema replica el que ya venía usando `docs/Parser Facturas y Documentacion/factura_parser.py`
 * sobre ~400 facturas reales: es el mismo recorte de datos, pero acá va como **structured output**,
 * así la respuesta no necesita parseo de texto libre ni tolerancia a markdown.
 *
 * Regla que ordena todo el módulo: **la IA lee, el código valida.** Nada de lo que devuelve el
 * modelo entra a la base sin pasar por `validateExtraction`, y el total nunca se toma por válido
 * solo porque el modelo lo leyó: tiene que cerrar contra la suma de sus partes.
 */

import * as z from "zod/v4";
import {
  digitsOnly,
  normalizeInvoiceNumber,
  normalizeInvoiceSalePoint,
  parseEsDateToIso,
  mapIvaTextToInvoiceCondition,
  mapTipoComprobanteToCode,
  stripDiacriticsLower,
} from "./bulkInvoiceImportHelpers";

// ─── Esquema que se le pide al modelo ────────────────────────────────────────

const nullableString = z.string().nullable();
const nullableNumber = z.number().nullable();

export const extractedInvoiceSchema = z.object({
  cabecera: z.object({
    punto_venta: nullableString,
    numero_comprobante: nullableString,
    fecha_emision: nullableString,
    tipo_comprobante: nullableString,
    proveedor_nombre_comercial: nullableString,
    razon_social: nullableString,
    cuit: nullableString,
    condicion_iva_proveedor: nullableString,
    receptor_razon_social: nullableString,
    receptor_cuit: nullableString,
  }),
  items: z.array(
    z.object({
      descripcion: z.string(),
      cantidad: nullableNumber,
      unidad_medida: nullableString,
      precio_unitario: nullableNumber,
      subtotal: nullableNumber,
    }),
  ),
  impuestos: z.array(
    z.object({
      nombre: z.string(),
      base_imponible: nullableNumber,
      porcentaje: nullableNumber,
      importe: nullableNumber,
    }),
  ),
  totales: z.object({
    subtotal_neto: nullableNumber,
    descuento_importe: nullableNumber,
    total_impuestos: nullableNumber,
    total_factura: nullableNumber,
  }),
  /** Qué no pudo leer con claridad. Es la señal más útil para saber dónde mirar en la revisión. */
  notas: nullableString,
  /** Autoevaluación del modelo sobre la legibilidad del comprobante. */
  legibilidad: z.enum(["buena", "regular", "mala"]),
});

export type ExtractedInvoice = z.infer<typeof extractedInvoiceSchema>;

/**
 * Instrucciones de lectura. Heredadas del parser Python que ya funcionaba, con dos agregados:
 * no inventar (preferir null a adivinar) y autoevaluar la legibilidad.
 */
export const INVOICE_EXTRACTION_PROMPT = `Sos un asistente que lee facturas argentinas y extrae sus datos.

Reglas:
- Si un dato no está visible o no existe, devolvé null. NUNCA lo inventes ni lo deduzcas.
- Los importes van como número, con punto decimal.
- \`precio_unitario\` y \`subtotal\` de cada ítem son importes NETOS SIN IVA.
- El punto de venta suele estar antes del guión del número (0001-00000123 → punto de venta 0001).
- Extraé TODOS los ítems del comprobante, sin omitir ninguno ni agrupar.
- En \`impuestos\` va cada IVA y cada percepción por separado, tal como figuran discriminados.
- En \`notas\` escribí qué no pudiste leer con claridad o cualquier cosa rara del comprobante.
- \`legibilidad\`: "buena" si se lee todo sin esfuerzo, "regular" si tuviste que interpretar algo,
  "mala" si hay partes que directamente no se leen.

La factura la revisa una persona antes de guardarse, así que es mucho mejor devolver null en un
campo dudoso que arriesgar un valor incorrecto: un null se ve y se corrige, un número equivocado
se cuela.`;

// ─── Normalización al modelo de DataFlow ─────────────────────────────────────

export interface InvoiceDraftItem {
  description: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  unit: string | null;
  /** Insumo sugerido y de dónde salió la sugerencia. */
  supplyId: number | null;
  supplyName: string | null;
  matchSource: "memoria" | "parecido" | null;
  matchScore: number | null;
}

export interface InvoiceDraftTax {
  name: string;
  percentage: number | null;
  baseAmount: number | null;
  amount: number;
  /** Impuesto del catálogo con el que se corresponde, si se pudo identificar. */
  taxId: number | null;
}

export interface InvoiceDraft {
  salePoint: string;
  invoiceNumber: string;
  invoiceDate: string | null;
  invoiceType: string;
  ivaCondition: string;
  supplierCuit: string;
  supplierName: string;
  /** Proveedor del catálogo resuelto por CUIT. null = hay que elegirlo o darlo de alta. */
  supplierId: number | null;
  items: InvoiceDraftItem[];
  taxes: InvoiceDraftTax[];
  subtotal: number;
  discount: number;
  taxTotal: number;
  total: number;
  notes: string | null;
  legibilidad: "buena" | "regular" | "mala";
}

const n = (v: number | null | undefined): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Clave con la que se busca y se guarda la memoria descripción → insumo. */
export function normalizeItemDescription(raw: string): string {
  return stripDiacriticsLower(String(raw ?? ""))
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .slice(0, 255);
}

/**
 * Pasa lo que leyó el modelo al borrador que consume la pantalla de revisión.
 *
 * Los ítems sin subtotal legible se completan con cantidad × precio, que es aritmética, no
 * adivinanza. Los que no tienen ni eso quedan en cero y la validación los marca.
 */
export function buildInvoiceDraft(raw: ExtractedInvoice): InvoiceDraft {
  const items: InvoiceDraftItem[] = raw.items.map((it) => {
    const quantity = n(it.cantidad) || 1;
    const unitPrice = n(it.precio_unitario);
    const subtotal = it.subtotal != null ? n(it.subtotal) : quantity * unitPrice;
    return {
      description: String(it.descripcion ?? "").trim(),
      quantity,
      unitPrice: unitPrice || (quantity > 0 ? subtotal / quantity : 0),
      subtotal,
      unit: it.unidad_medida?.trim() || null,
      supplyId: null,
      supplyName: null,
      matchSource: null,
      matchScore: null,
    };
  });

  const taxes: InvoiceDraftTax[] = raw.impuestos.map((t) => ({
    name: String(t.nombre ?? "").trim(),
    percentage: t.porcentaje != null ? n(t.porcentaje) : null,
    baseAmount: t.base_imponible != null ? n(t.base_imponible) : null,
    amount: n(t.importe),
    taxId: null,
  }));

  const itemsSum = items.reduce((s, i) => s + i.subtotal, 0);
  const taxesSum = taxes.reduce((s, t) => s + t.amount, 0);

  return {
    salePoint: normalizeInvoiceSalePoint(raw.cabecera.punto_venta),
    invoiceNumber: normalizeInvoiceNumber(raw.cabecera.numero_comprobante),
    invoiceDate: parseEsDateToIso(raw.cabecera.fecha_emision) ?? isoOrNull(raw.cabecera.fecha_emision),
    invoiceType: mapTipoComprobanteToCode(raw.cabecera.tipo_comprobante),
    ivaCondition: mapIvaTextToInvoiceCondition(raw.cabecera.condicion_iva_proveedor),
    supplierCuit: digitsOnly(raw.cabecera.cuit),
    supplierName:
      raw.cabecera.razon_social?.trim() || raw.cabecera.proveedor_nombre_comercial?.trim() || "",
    supplierId: null,
    items,
    taxes,
    // El neto se prefiere leído; si no vino, es la suma de los ítems.
    subtotal: raw.totales.subtotal_neto != null ? n(raw.totales.subtotal_neto) : itemsSum,
    discount: n(raw.totales.descuento_importe),
    taxTotal: raw.totales.total_impuestos != null ? n(raw.totales.total_impuestos) : taxesSum,
    total: n(raw.totales.total_factura),
    notes: raw.notas?.trim() || null,
    legibilidad: raw.legibilidad,
  };
}

/** Acepta una fecha que ya venga en ISO, por si el comprobante la trae así. */
function isoOrNull(raw: string | null | undefined): string | null {
  const s = String(raw ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

// ─── Validación: acá es donde el código no le cree a la IA ────────────────────

export type ValidationSeverity = "error" | "warning";

export interface ValidationIssue {
  field: string;
  severity: ValidationSeverity;
  message: string;
}

/** Diferencia tolerada al comparar totales: redondeos de la propia factura. */
export const TOTAL_TOLERANCE = 1;

/**
 * Chequea el borrador contra sí mismo. Un `error` bloquea el guardado; un `warning` se muestra
 * pero deja seguir. La aritmética se verifica siempre: el total leído no vale por sí solo.
 */
export function validateExtraction(draft: InvoiceDraft): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!draft.invoiceNumber) {
    issues.push({ field: "invoiceNumber", severity: "error", message: "No se pudo leer el número de comprobante." });
  }
  if (!draft.salePoint) {
    issues.push({ field: "salePoint", severity: "warning", message: "No se pudo leer el punto de venta." });
  }
  if (!draft.invoiceDate) {
    issues.push({ field: "invoiceDate", severity: "error", message: "No se pudo leer la fecha de emisión." });
  }
  if (draft.supplierId == null) {
    issues.push({
      field: "supplierId",
      severity: "error",
      message: draft.supplierCuit
        ? `El CUIT ${draft.supplierCuit} no corresponde a ningún proveedor cargado. Elegilo o dalo de alta.`
        : "No se pudo leer el CUIT del proveedor. Elegí el proveedor a mano.",
    });
  }
  if (draft.items.length === 0) {
    issues.push({ field: "items", severity: "error", message: "No se leyó ningún ítem en el comprobante." });
  }

  draft.items.forEach((it, i) => {
    if (!it.description) {
      issues.push({ field: `items.${i}.description`, severity: "error", message: `Ítem ${i + 1}: sin descripción.` });
    }
    if (it.subtotal <= 0) {
      issues.push({ field: `items.${i}.subtotal`, severity: "warning", message: `Ítem ${i + 1}: importe en cero.` });
    }
    const expected = it.quantity * it.unitPrice;
    if (it.subtotal > 0 && Math.abs(expected - it.subtotal) > Math.max(TOTAL_TOLERANCE, it.subtotal * 0.01)) {
      issues.push({
        field: `items.${i}.subtotal`,
        severity: "warning",
        message: `Ítem ${i + 1}: cantidad × precio (${expected.toFixed(2)}) no coincide con el importe leído (${it.subtotal.toFixed(2)}).`,
      });
    }
    if (it.supplyId == null) {
      issues.push({
        field: `items.${i}.supplyId`,
        severity: "error",
        message: `Ítem ${i + 1} ("${it.description}"): falta elegir el insumo.`,
      });
    }
  });

  // El chequeo que no se puede saltear: las partes tienen que dar el total.
  const itemsSum = draft.items.reduce((s, i) => s + i.subtotal, 0);
  const taxesSum = draft.taxes.reduce((s, t) => s + t.amount, 0);
  const computed = itemsSum - draft.discount + taxesSum;
  if (draft.total > 0 && Math.abs(computed - draft.total) > Math.max(TOTAL_TOLERANCE, draft.total * 0.01)) {
    issues.push({
      field: "total",
      severity: "warning",
      message: `Los ítems (${itemsSum.toFixed(2)}) − descuento (${draft.discount.toFixed(2)}) + impuestos (${taxesSum.toFixed(2)}) dan ${computed.toFixed(2)}, pero el total leído es ${draft.total.toFixed(2)}. Revisá antes de confirmar.`,
    });
  }
  if (draft.total <= 0) {
    issues.push({ field: "total", severity: "error", message: "No se pudo leer el total del comprobante." });
  }

  if (draft.legibilidad === "mala") {
    issues.push({
      field: "legibilidad",
      severity: "warning",
      message: "El comprobante se lee mal: revisá campo por campo antes de confirmar.",
    });
  }

  return issues;
}

export function hasBlockingIssues(issues: ValidationIssue[]): boolean {
  return issues.some((i) => i.severity === "error");
}
