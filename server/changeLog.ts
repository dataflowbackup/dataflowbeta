import { storage } from "./storage";

/**
 * Registro de cambios (audit_log): quien hizo que, cuando y sobre que registro.
 * Best-effort: si falla el registro NUNCA rompe la operacion que ya se hizo.
 *
 * - Altas: `after` con los datos clave del registro creado.
 * - Bajas: `before` con los datos clave del registro borrado.
 * - Modificaciones: `before` + `after` → se guardan SOLO los campos que cambiaron.
 *   Si no cambio nada, no se registra.
 * - Masivas: una sola fila con `count` (nunca una por movimiento: cuida la cuota de Turso).
 */

const IGNORED_FIELDS = new Set(["updatedAt", "createdAt"]);

export type ChangeEntry = {
  clientId: number | null | undefined;
  userId: string | null | undefined;
  action: string;
  table: string;
  recordId?: number | null;
  summary: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  /** Campos a comparar en una modificacion; por defecto, todas las claves de `after`. */
  fields?: string[];
  /** Datos extra (cantidades, filtros de una masiva) que se guardan tal cual en new_data. */
  extra?: Record<string, unknown>;
};

function normalize(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (v === undefined) return null;
  return v;
}

/** Campos que difieren entre `before` y `after`: { campo: [antes, despues] }. */
export function diffFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  fields?: string[],
): Record<string, [unknown, unknown]> {
  const keys = fields ?? Object.keys(after);
  const out: Record<string, [unknown, unknown]> = {};
  for (const k of keys) {
    if (IGNORED_FIELDS.has(k) || !(k in after)) continue;
    const a = normalize(before[k]);
    const b = normalize(after[k]);
    if (JSON.stringify(a) !== JSON.stringify(b)) out[k] = [a, b];
  }
  return out;
}

/** Se queda con un subconjunto de campos de un registro (para altas/bajas). */
export function pick(row: Record<string, unknown> | null | undefined, fields: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!row) return out;
  for (const f of fields) if (f in row) out[f] = normalize(row[f]);
  return out;
}

export async function recordChange(entry: ChangeEntry): Promise<void> {
  try {
    let oldData: unknown = null;
    let newData: unknown = null;
    if (entry.before && entry.after) {
      const changed = diffFields(entry.before, entry.after, entry.fields);
      if (Object.keys(changed).length === 0 && !entry.extra) return;
      oldData = Object.fromEntries(Object.entries(changed).map(([k, [a]]) => [k, a]));
      newData = Object.fromEntries(Object.entries(changed).map(([k, [, b]]) => [k, b]));
    } else {
      oldData = entry.before ?? null;
      newData = entry.after ?? null;
    }
    if (entry.extra) newData = { ...((newData as object) ?? {}), ...entry.extra };

    await storage.createAuditLog({
      clientId: entry.clientId ?? null,
      userId: entry.userId || null,
      action: entry.action,
      tableName: entry.table,
      recordId: entry.recordId ?? null,
      summary: entry.summary,
      oldData,
      newData,
    });
  } catch (e) {
    console.error("[change-log] no se pudo registrar:", entry.action, entry.table, e);
  }
}

/** Campos clave por entidad (lo que se guarda en altas y bajas). */
export const KEY_FIELDS = {
  invoice: ["invoiceType", "invoiceSalePoint", "invoiceNumber", "supplierId", "localId", "invoiceDate", "dueDate", "total", "balance", "status"],
  payment: ["paymentNumber", "paymentDate", "supplierId", "localId", "amount", "paymentMethod", "bankAccountId", "notes"],
  transaction: ["transactionDate", "description", "amount", "type", "bankSource", "bankAccountId", "localId", "categoryId", "cashRegisterId", "economicMonth"],
};
