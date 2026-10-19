/**
 * Eventos — lectura y escritura. El cálculo vive en `shared/eventPricing.ts`.
 *
 * Una propuesta no toca ninguna otra tabla: ni recetas, ni movimientos, ni informes.
 */
import { db } from "./db";
import { eq, and, gte, lte, isNotNull, desc } from "drizzle-orm";
import { events, transactions, transactionCategories, financialGroups, locals, type EventRow } from "@shared/schema";
import { resolveEconomicMonth } from "@shared/economicMonth";
import {
  computeEventTotals,
  type EventDirectCost,
  type EventFixedCost,
  type EventItem,
  type EventIvaMode,
  type EventStatus,
  type EventTax,
} from "@shared/eventPricing";
import { OTROS_MOVIMIENTOS_SPECIAL_TYPES } from "./storage";

export class EventError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

const num = (v: unknown) => parseFloat(String(v ?? 0)) || 0;
const arr = <T>(v: unknown): T[] => {
  if (Array.isArray(v)) return v as T[];
  if (typeof v === "string") {
    try {
      const p = JSON.parse(v);
      return Array.isArray(p) ? p : [];
    } catch {
      return [];
    }
  }
  return [];
};

export interface EventPayload {
  name: string;
  localId?: number | null;
  customerName?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  eventDate?: string | null;
  eventTime?: string | null;
  location?: string | null;
  guests?: number | null;
  brandName?: string | null;
  validUntil?: string | null;
  paymentTerms?: string | null;
  clientNotes?: string | null;
  internalNotes?: string | null;
  ivaMode: EventIvaMode;
  ivaRate: number;
  discountType: "pct" | "amount";
  discountValue: number;
  items: EventItem[];
  directCosts: EventDirectCost[];
  fixedCosts: EventFixedCost[];
  taxes: EventTax[];
}

export type EventWithData = Omit<EventRow, "items" | "directCosts" | "fixedCosts" | "taxes" | "totals"> & {
  items: EventItem[];
  directCosts: EventDirectCost[];
  fixedCosts: EventFixedCost[];
  taxes: EventTax[];
  totals: ReturnType<typeof computeEventTotals> | null;
};

function hydrate(r: EventRow): EventWithData {
  const totals = typeof r.totals === "string" ? safeJson(r.totals) : (r.totals as any);
  return {
    ...r,
    items: arr<EventItem>(r.items),
    directCosts: arr<EventDirectCost>(r.directCosts),
    fixedCosts: arr<EventFixedCost>(r.fixedCosts),
    taxes: arr<EventTax>(r.taxes),
    totals: totals ?? null,
  };
}

function safeJson(s: string) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function values(p: EventPayload) {
  const totals = computeEventTotals({
    ivaMode: p.ivaMode,
    ivaRate: p.ivaRate,
    discountType: p.discountType,
    discountValue: p.discountValue,
    guests: p.guests ?? null,
    items: p.items,
    directCosts: p.directCosts,
    fixedCosts: p.fixedCosts,
    taxes: p.taxes,
  });
  return {
    name: p.name.trim(),
    localId: p.localId ?? null,
    customerName: p.customerName ?? null,
    contactName: p.contactName ?? null,
    contactPhone: p.contactPhone ?? null,
    contactEmail: p.contactEmail ?? null,
    eventDate: p.eventDate || null,
    eventTime: p.eventTime ?? null,
    location: p.location ?? null,
    guests: p.guests ?? null,
    brandName: p.brandName ?? null,
    validUntil: p.validUntil || null,
    paymentTerms: p.paymentTerms ?? null,
    clientNotes: p.clientNotes ?? null,
    internalNotes: p.internalNotes ?? null,
    ivaMode: p.ivaMode,
    ivaRate: String(p.ivaRate),
    discountType: p.discountType,
    discountValue: String(p.discountValue),
    items: p.items,
    directCosts: p.directCosts,
    fixedCosts: p.fixedCosts,
    taxes: p.taxes,
    totals,
  };
}

async function assertLocal(clientId: number, localId: number | null | undefined) {
  if (localId == null) return;
  const [l] = await db.select({ id: locals.id }).from(locals).where(and(eq(locals.id, localId), eq(locals.clientId, clientId)));
  if (!l) throw new EventError("El local no existe");
}

export async function listEvents(clientId: number): Promise<EventWithData[]> {
  const rows = await db.select().from(events).where(eq(events.clientId, clientId)).orderBy(desc(events.updatedAt));
  return rows.map(hydrate);
}

export async function getEvent(clientId: number, id: number): Promise<EventWithData | undefined> {
  const [r] = await db.select().from(events).where(and(eq(events.id, id), eq(events.clientId, clientId)));
  return r ? hydrate(r) : undefined;
}

export async function createEvent(clientId: number, userId: string | null, p: EventPayload) {
  await assertLocal(clientId, p.localId);
  const [row] = await db
    .insert(events)
    .values({ clientId, ...values(p), status: "borrador", version: 1, createdBy: userId, updatedBy: userId } as any)
    .returning();
  // La primera versión es su propia raíz: así todas las versiones se agrupan por root_event_id.
  await db.update(events).set({ rootEventId: row.id } as any).where(eq(events.id, row.id));
  return (await getEvent(clientId, row.id))!;
}

export async function updateEvent(clientId: number, userId: string | null, id: number, p: EventPayload) {
  const existing = await getEvent(clientId, id);
  if (!existing) throw new EventError("Evento no encontrado", 404);
  if (existing.status !== "borrador") {
    throw new EventError("La propuesta ya fue enviada: para cambiarla, creá una nueva versión o volvela a borrador", 409);
  }
  await assertLocal(clientId, p.localId);
  await db
    .update(events)
    .set({ ...values(p), updatedBy: userId, updatedAt: new Date() } as any)
    .where(eq(events.id, id));
  return (await getEvent(clientId, id))!;
}

export async function setEventStatus(clientId: number, userId: string | null, id: number, status: EventStatus) {
  const existing = await getEvent(clientId, id);
  if (!existing) throw new EventError("Evento no encontrado", 404);
  const set: Record<string, unknown> = { status, updatedBy: userId, updatedAt: new Date() };
  // Al enviarla se congela: los costos quedan como estaban (la foto ya está en `items`).
  if (status === "enviada" && existing.status === "borrador") set.sentAt = new Date();
  if (status === "borrador") set.sentAt = null;
  await db.update(events).set(set as any).where(eq(events.id, id));
  return (await getEvent(clientId, id))!;
}

/** Copia la propuesta como versión siguiente, en borrador. La anterior queda como estaba. */
export async function newEventVersion(clientId: number, userId: string | null, id: number) {
  const src = await getEvent(clientId, id);
  if (!src) throw new EventError("Evento no encontrado", 404);
  const rootId = src.rootEventId ?? src.id;
  const siblings = await db
    .select({ version: events.version })
    .from(events)
    .where(and(eq(events.clientId, clientId), eq(events.rootEventId, rootId)));
  const nextVersion = Math.max(src.version ?? 1, ...siblings.map((s) => s.version ?? 1)) + 1;
  const { id: _id, createdAt: _c, updatedAt: _u, sentAt: _s, status: _st, version: _v, totals: _t, ...rest } = src;
  const [row] = await db
    .insert(events)
    .values({
      ...rest,
      items: src.items,
      directCosts: src.directCosts,
      fixedCosts: src.fixedCosts,
      taxes: src.taxes,
      totals: src.totals,
      status: "borrador",
      version: nextVersion,
      rootEventId: rootId,
      createdBy: userId,
      updatedBy: userId,
    } as any)
    .returning();
  return (await getEvent(clientId, row.id))!;
}

export async function duplicateEvent(clientId: number, userId: string | null, id: number) {
  const src = await getEvent(clientId, id);
  if (!src) throw new EventError("Evento no encontrado", 404);
  return createEvent(clientId, userId, {
    name: `${src.name} (copia)`,
    localId: src.localId,
    customerName: src.customerName,
    contactName: src.contactName,
    contactPhone: src.contactPhone,
    contactEmail: src.contactEmail,
    eventDate: src.eventDate,
    eventTime: src.eventTime,
    location: src.location,
    guests: src.guests,
    brandName: src.brandName,
    validUntil: src.validUntil,
    paymentTerms: src.paymentTerms,
    clientNotes: src.clientNotes,
    internalNotes: src.internalNotes,
    ivaMode: (src.ivaMode as EventIvaMode) ?? "incluido",
    ivaRate: num(src.ivaRate) || 21,
    discountType: src.discountType === "amount" ? "amount" : "pct",
    discountValue: num(src.discountValue),
    items: src.items,
    directCosts: src.directCosts,
    fixedCosts: src.fixedCosts,
    taxes: src.taxes,
  });
}

export async function deleteEvent(clientId: number, id: number) {
  const existing = await getEvent(clientId, id);
  if (!existing) throw new EventError("Evento no encontrado", 404);
  await db.delete(events).where(eq(events.id, id));
}

// ==========================================
// Costos fijos: promedio mensual real
// ==========================================

export interface FixedCostAverages {
  months: string[];
  groups: Array<{
    id: number;
    name: string;
    average: number;
    categories: Array<{ id: number; name: string; average: number }>;
  }>;
}

/**
 * Promedio mensual de gastos por grupo y categoría en los últimos N meses COMPLETOS, con la misma
 * cuenta que el Estado de Resultado: mes económico, sin los movimientos padres de una división,
 * solo grupos de gasto y sin "otros movimientos" (retiros, préstamos, inicio de mes). Neto en la
 * dirección del gasto: un reintegro resta.
 */
export async function getFixedCostAverages(
  clientId: number,
  opts: { months: number; localId?: number },
): Promise<FixedCostAverages> {
  const monthsBack = Math.min(12, Math.max(1, Math.round(opts.months)));
  const now = new Date();
  const months: string[] = [];
  for (let i = monthsBack; i >= 1; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  const monthSet = new Set(months);
  // El mes económico puede correrse respecto de la fecha: se escanea un mes de margen a cada lado.
  const first = new Date(now.getFullYear(), now.getMonth() - monthsBack - 1, 1);
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  const groups = await db.select().from(financialGroups).where(eq(financialGroups.clientId, clientId));
  const cats = await db.select().from(transactionCategories).where(eq(transactionCategories.clientId, clientId));
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const catById = new Map(cats.map((c) => [c.id, c]));

  const conds = [
    eq(transactions.clientId, clientId),
    gte(transactions.transactionDate, ymd(first)),
    lte(transactions.transactionDate, ymd(last)),
    isNotNull(transactions.categoryId),
  ];
  if (opts.localId != null) conds.push(eq(transactions.localId, opts.localId));
  const rows = await db
    .select({
      id: transactions.id,
      categoryId: transactions.categoryId,
      type: transactions.type,
      amount: transactions.amount,
      transactionDate: transactions.transactionDate,
      economicMonth: transactions.economicMonth,
      parentTransactionId: transactions.parentTransactionId,
    })
    .from(transactions)
    .where(and(...conds));
  const splitParentIds = new Set(rows.filter((t) => t.parentTransactionId != null).map((t) => t.parentTransactionId as number));

  const byCat = new Map<number, number>();
  for (const tx of rows) {
    if (splitParentIds.has(tx.id)) continue;
    const month = resolveEconomicMonth(tx as any);
    if (!month || !monthSet.has(month)) continue;
    const cat = catById.get(tx.categoryId as number);
    if (!cat) continue;
    if (typeof cat.specialType === "string" && OTROS_MOVIMIENTOS_SPECIAL_TYPES.has(cat.specialType)) continue;
    const group = cat.financialGroupId != null ? groupById.get(cat.financialGroupId) : undefined;
    if (!group || String(group.type) !== "expense") continue;
    const amount = num(tx.amount);
    byCat.set(cat.id, (byCat.get(cat.id) ?? 0) + (tx.type === "expense" ? amount : -amount));
  }

  const out = new Map<number, FixedCostAverages["groups"][number]>();
  for (const [catId, total] of Array.from(byCat.entries())) {
    const cat = catById.get(catId)!;
    const group = groupById.get(cat.financialGroupId as number)!;
    const avg = total / monthsBack;
    if (Math.abs(avg) < 0.005) continue;
    const g: FixedCostAverages["groups"][number] = out.get(group.id) ?? { id: group.id, name: String(group.name), average: 0, categories: [] };
    g.average += avg;
    g.categories.push({ id: cat.id, name: String(cat.name), average: avg });
    out.set(group.id, g);
  }
  return {
    months,
    groups: Array.from(out.values())
      .map((g) => ({ ...g, categories: g.categories.sort((a, b) => b.average - a.average) }))
      .sort((a, b) => b.average - a.average),
  };
}
