/**
 * Desvío de mercadería: junta los seis componentes de la ecuación desde la base.
 *
 * El período NO es un rango libre: va de un inventario al siguiente del mismo local, porque es
 * el único corte donde la ecuación cierra. Ver `shared/deviationEngine.ts` para la cuenta.
 */
import { db } from "./db";
import { eq, and, desc, asc, gte, lte, isNull, isNotNull, inArray, or } from "drizzle-orm";
import {
  supplies,
  invoices,
  invoiceItems,
  locals,
  unitsOfMeasure,
  recipes,
  recipeIngredients,
  stockValuations,
  stockValuationItems,
  stockValuationSubRecipeItems,
  merchandiseTransfers,
  merchandiseTransferItems,
  decomisos,
} from "@shared/schema";
import {
  explodeRecipes,
  subRecipeScale,
  type RecipeIngredientNode,
} from "@shared/supplyMetrics";
import {
  computeDeviationRows,
  summarizeDeviation,
  type DeviationInput,
  type DeviationPeriod,
  type DeviationResult,
} from "@shared/deviationEngine";
import { getSupplyConsumption, type ProductSource, type SoldProductsFn } from "./supplyMetricsQueries";

/** Suma un día a una fecha "YYYY-MM-DD" sin pasar por Date (evita corrimientos de zona horaria). */
function nextDay(iso: string): string {
  const [y, m, d] = iso.split("-").map((n) => parseInt(n, 10));
  const dt = new Date(Date.UTC(y, m - 1, d + 1));
  return dt.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86400000);
}

/**
 * Pares de inventarios consecutivos por local: cada par es un período medible.
 *
 * Sólo inventarios activos y CON local — uno sin local no sirve para medir desvío, porque no se
 * puede saber contra qué compras y qué ventas compararlo.
 */
export async function listDeviationPeriods(
  clientId: number,
  localId?: number,
): Promise<DeviationPeriod[]> {
  const conds = [
    eq(stockValuations.clientId, clientId),
    isNotNull(stockValuations.localId),
    or(isNull(stockValuations.status), eq(stockValuations.status, "active")),
  ];
  if (localId != null) conds.push(eq(stockValuations.localId, localId));

  const rows = await db
    .select({
      id: stockValuations.id,
      localId: stockValuations.localId,
      localName: locals.name,
      valuationDate: stockValuations.valuationDate,
    })
    .from(stockValuations)
    .leftJoin(locals, eq(stockValuations.localId, locals.id))
    .where(and(...conds))
    .orderBy(asc(stockValuations.localId), asc(stockValuations.valuationDate), asc(stockValuations.id));

  const byLocal = new Map<number, typeof rows>();
  for (const r of rows) {
    if (r.localId == null) continue;
    const list = byLocal.get(r.localId) ?? [];
    list.push(r);
    byLocal.set(r.localId, list);
  }

  const periods: DeviationPeriod[] = [];
  for (const list of Array.from(byLocal.values())) {
    for (let i = 1; i < list.length; i++) {
      const open = list[i - 1];
      const close = list[i];
      const openingDate = String(open.valuationDate);
      const closingDate = String(close.valuationDate);
      // Dos inventarios el mismo día no delimitan un período.
      if (openingDate === closingDate) continue;
      periods.push({
        localId: open.localId,
        localName: open.localName ?? null,
        openingValuationId: open.id,
        openingDate,
        closingValuationId: close.id,
        closingDate,
        days: daysBetween(openingDate, closingDate),
      });
    }
  }

  periods.sort((a, b) => (b.closingDate < a.closingDate ? -1 : b.closingDate > a.closingDate ? 1 : 0));
  return periods;
}

export interface DeviationOverviewRow {
  localId: number;
  localName: string | null;
  period: DeviationPeriod;
  measuredAmount: number;
  assumedAmount: number;
  totalAmount: number;
  consumptionAmount: number;
  purchasesAmount: number;
  decomisosAmount: number;
  deviationOverConsumptionPct: number | null;
  coveragePct: number | null;
  offendersCount: number;
  worstSupplyName: string | null;
  worstSupplyAmount: number | null;
}

/**
 * Panorama global: el ÚLTIMO período cerrado de cada local, para compararlos entre sí.
 *
 * Cada local se calcula por separado porque cada uno tiene su propio calendario de inventarios:
 * no hay un "período" común a todos.
 */
export async function computeDeviationOverview(
  clientId: number,
  getSoldProducts: SoldProductsFn,
  opts: { source: ProductSource; tolerancePct?: number },
): Promise<DeviationOverviewRow[]> {
  const periods = await listDeviationPeriods(clientId);

  const latestByLocal = new Map<number, DeviationPeriod>();
  for (const p of periods) {
    if (p.localId == null) continue;
    const cur = latestByLocal.get(p.localId);
    if (!cur || p.closingDate > cur.closingDate) latestByLocal.set(p.localId, p);
  }

  const out: DeviationOverviewRow[] = [];
  for (const [localId, period] of Array.from(latestByLocal.entries())) {
    const result = await computeDeviation(clientId, getSoldProducts, {
      localId,
      openingValuationId: period.openingValuationId,
      closingValuationId: period.closingValuationId,
      source: opts.source,
      tolerancePct: opts.tolerancePct ?? 0,
    });
    const worst = result.summary.worstOffenders[0] ?? null;
    out.push({
      localId,
      localName: period.localName,
      period,
      measuredAmount: result.summary.measuredAmount,
      assumedAmount: result.summary.assumedAmount,
      totalAmount: result.summary.totalAmount,
      consumptionAmount: result.summary.consumptionAmount,
      purchasesAmount: result.summary.purchasesAmount,
      decomisosAmount: result.summary.decomisosAmount,
      deviationOverConsumptionPct: result.summary.deviationOverConsumptionPct,
      coveragePct: result.coveragePct,
      offendersCount: result.summary.worstOffenders.length,
      worstSupplyName: worst?.supplyName ?? null,
      worstSupplyAmount: worst?.deviationAmount ?? null,
    });
  }

  // El local con el desvío más grande en plata, primero.
  out.sort((a, b) => Math.abs(b.measuredAmount) - Math.abs(a.measuredAmount));
  return out;
}

/** Recetas explotadas: cuánto insumo lleva la receta COMPLETA (no por unidad de rendimiento). */
async function getExplodedRecipesForClient(clientId: number) {
  const recipeRows = await db
    .select({ id: recipes.id, name: recipes.name, usefulYield: recipes.usefulYield })
    .from(recipes)
    .where(eq(recipes.clientId, clientId));

  const recipeIds = recipeRows.map((r) => r.id);
  const ingredientsByRecipe = new Map<number, RecipeIngredientNode[]>();
  for (const id of recipeIds) ingredientsByRecipe.set(id, []);

  if (recipeIds.length > 0) {
    const ingRows = await db
      .select({
        recipeId: recipeIngredients.recipeId,
        supplyId: recipeIngredients.supplyId,
        subRecipeId: recipeIngredients.subRecipeId,
        quantityTotal: recipeIngredients.quantityTotal,
        quantityWithWaste: recipeIngredients.quantityWithWaste,
      })
      .from(recipeIngredients)
      .where(inArray(recipeIngredients.recipeId, recipeIds));
    for (const r of ingRows) {
      const qt = parseFloat(String(r.quantityTotal ?? 0)) || 0;
      ingredientsByRecipe.get(r.recipeId)?.push({
        supplyId: r.supplyId ?? null,
        subRecipeId: r.subRecipeId ?? null,
        quantityTotal: qt,
        quantityWithWaste: parseFloat(String(r.quantityWithWaste ?? 0)) || qt,
      });
    }
  }

  const usefulYieldByRecipe = new Map<number, number | null>(
    recipeRows.map(
      (r) => [r.id, r.usefulYield != null ? parseFloat(String(r.usefulYield)) : null] as [number, number | null],
    ),
  );
  const { byRecipe } = explodeRecipes(ingredientsByRecipe, usefulYieldByRecipe);
  return {
    byRecipe,
    usefulYieldByRecipe,
    nameById: new Map(recipeRows.map((r) => [r.id, r.name])),
  };
}

/**
 * El stock contado de un inventario, ya con las sub-recetas convertidas a insumos.
 *
 * Contar 5 litros de demiglace suma el caldo y la manteca que lo componen: así no hay doble
 * conteo con los insumos sueltos, y el desvío se mide siempre a nivel insumo.
 */
async function getCountedStock(
  valuationId: number,
  exploded: Awaited<ReturnType<typeof getExplodedRecipesForClient>>,
): Promise<{
  bySupply: Map<number, number>;
  subRecipes: Array<{ subRecipeId: number; name: string; quantity: number }>;
}> {
  const bySupply = new Map<number, number>();

  const items = await db
    .select({ supplyId: stockValuationItems.supplyId, quantity: stockValuationItems.quantity })
    .from(stockValuationItems)
    .where(eq(stockValuationItems.valuationId, valuationId));
  for (const it of items) {
    if (it.supplyId == null) continue;
    bySupply.set(it.supplyId, (bySupply.get(it.supplyId) ?? 0) + (parseFloat(String(it.quantity ?? 0)) || 0));
  }

  const subItems = await db
    .select({
      subRecipeId: stockValuationSubRecipeItems.subRecipeId,
      quantity: stockValuationSubRecipeItems.quantity,
    })
    .from(stockValuationSubRecipeItems)
    .where(eq(stockValuationSubRecipeItems.valuationId, valuationId));

  const subRecipes: Array<{ subRecipeId: number; name: string; quantity: number }> = [];
  for (const it of subItems) {
    const qty = parseFloat(String(it.quantity ?? 0)) || 0;
    subRecipes.push({
      subRecipeId: it.subRecipeId,
      name: exploded.nameById.get(it.subRecipeId) ?? "",
      quantity: qty,
    });
    // La cantidad contada está en unidades de rendimiento; la explosión es de la receta entera.
    const scale = subRecipeScale(qty, exploded.usefulYieldByRecipe.get(it.subRecipeId));
    for (const ing of exploded.byRecipe.get(it.subRecipeId) ?? []) {
      bySupply.set(ing.supplyId, (bySupply.get(ing.supplyId) ?? 0) + ing.quantityTotal * scale);
    }
  }

  return { bySupply, subRecipes };
}

/** Compras del local en el período. Anuladas afuera, notas de crédito restando. */
async function getPurchasesBySupply(
  clientId: number,
  localId: number,
  from: string,
  to: string,
): Promise<Map<number, number>> {
  const rows = await db
    .select({
      supplyId: invoiceItems.supplyId,
      quantity: invoiceItems.quantity,
      invoiceType: invoices.invoiceType,
    })
    .from(invoiceItems)
    .innerJoin(invoices, eq(invoiceItems.invoiceId, invoices.id))
    .where(
      and(
        eq(invoices.clientId, clientId),
        eq(invoices.localId, localId),
        isNotNull(invoiceItems.supplyId),
        or(isNull(invoices.status), eq(invoices.status, "active")),
        gte(invoices.invoiceDate, from),
        lte(invoices.invoiceDate, to),
      ),
    );

  const out = new Map<number, number>();
  for (const r of rows) {
    if (r.supplyId == null) continue;
    const sign = String(r.invoiceType ?? "").startsWith("NC-") ? -1 : 1;
    out.set(r.supplyId, (out.get(r.supplyId) ?? 0) + (parseFloat(String(r.quantity ?? 0)) || 0) * sign);
  }
  return out;
}

/** Traslados del período: lo que entró y lo que salió del local, por separado. */
async function getTransfersBySupply(
  clientId: number,
  localId: number,
  from: string,
  to: string,
): Promise<{ inbound: Map<number, number>; outbound: Map<number, number> }> {
  const rows = await db
    .select({
      supplyId: merchandiseTransferItems.supplyId,
      quantity: merchandiseTransferItems.quantity,
      fromLocalId: merchandiseTransfers.fromLocalId,
      toLocalId: merchandiseTransfers.toLocalId,
    })
    .from(merchandiseTransferItems)
    .innerJoin(merchandiseTransfers, eq(merchandiseTransferItems.transferId, merchandiseTransfers.id))
    .where(
      and(
        eq(merchandiseTransfers.clientId, clientId),
        or(isNull(merchandiseTransfers.status), eq(merchandiseTransfers.status, "active")),
        gte(merchandiseTransfers.transferDate, from),
        lte(merchandiseTransfers.transferDate, to),
        or(eq(merchandiseTransfers.fromLocalId, localId), eq(merchandiseTransfers.toLocalId, localId)),
      ),
    );

  const inbound = new Map<number, number>();
  const outbound = new Map<number, number>();
  for (const r of rows) {
    if (r.supplyId == null) continue;
    const qty = parseFloat(String(r.quantity ?? 0)) || 0;
    if (r.toLocalId === localId) inbound.set(r.supplyId, (inbound.get(r.supplyId) ?? 0) + qty);
    if (r.fromLocalId === localId) outbound.set(r.supplyId, (outbound.get(r.supplyId) ?? 0) + qty);
  }
  return { inbound, outbound };
}

/** Decomisos del local en el período. */
async function getDecomisosBySupply(
  clientId: number,
  localId: number,
  from: string,
  to: string,
): Promise<Map<number, number>> {
  const rows = await db
    .select({ supplyId: decomisos.supplyId, cantidad: decomisos.cantidad })
    .from(decomisos)
    .where(
      and(
        eq(decomisos.clientId, clientId),
        eq(decomisos.localId, localId),
        isNotNull(decomisos.supplyId),
        gte(decomisos.fecha, from),
        lte(decomisos.fecha, to),
      ),
    );

  const out = new Map<number, number>();
  for (const r of rows) {
    if (r.supplyId == null) continue;
    out.set(r.supplyId, (out.get(r.supplyId) ?? 0) + (parseFloat(String(r.cantidad ?? 0)) || 0));
  }
  return out;
}

/** Costo de reposición congelado en el inventario de cierre; si no está, el último costo conocido. */
async function getReplacementCosts(clientId: number, closingValuationId: number): Promise<Map<number, number>> {
  const out = new Map<number, number>();

  const supplyRows = await db
    .select({ id: supplies.id, lastCost: supplies.lastCost, unitCost: supplies.unitCost })
    .from(supplies)
    .where(eq(supplies.clientId, clientId));
  for (const s of supplyRows) {
    const last = parseFloat(String(s.lastCost ?? 0)) || 0;
    out.set(s.id, last > 0 ? last : parseFloat(String(s.unitCost ?? 0)) || 0);
  }

  // El costo del conteo de cierre manda: es el que el usuario vio al valorizar ese inventario.
  const items = await db
    .select({
      supplyId: stockValuationItems.supplyId,
      cost: stockValuationItems.replacementUnitCost,
    })
    .from(stockValuationItems)
    .where(eq(stockValuationItems.valuationId, closingValuationId));
  for (const it of items) {
    if (it.supplyId == null) continue;
    const c = parseFloat(String(it.cost ?? 0)) || 0;
    if (c > 0) out.set(it.supplyId, c);
  }

  return out;
}

/**
 * Calcula el desvío de un período (par de inventarios) para un local.
 *
 * `tolerancePct` sólo define qué entra en "lo que hay que mirar": los totales se calculan
 * siempre sobre todos los insumos.
 */
export async function computeDeviation(
  clientId: number,
  getSoldProducts: SoldProductsFn,
  opts: {
    localId: number;
    openingValuationId: number;
    closingValuationId: number;
    source: ProductSource;
    tolerancePct?: number;
  },
): Promise<DeviationResult> {
  const valuations = await db
    .select({ id: stockValuations.id, localId: stockValuations.localId, valuationDate: stockValuations.valuationDate })
    .from(stockValuations)
    .where(
      and(
        eq(stockValuations.clientId, clientId),
        inArray(stockValuations.id, [opts.openingValuationId, opts.closingValuationId]),
      ),
    );
  const opening = valuations.find((v) => v.id === opts.openingValuationId);
  const closing = valuations.find((v) => v.id === opts.closingValuationId);
  if (!opening || !closing) throw new Error("No se encontraron los inventarios del período");

  const openingDate = String(opening.valuationDate);
  const closingDate = String(closing.valuationDate);
  if (closingDate <= openingDate) throw new Error("El inventario de cierre tiene que ser posterior al de apertura");

  // El conteo refleja el estado al CIERRE de su día: los movimientos van del día siguiente al
  // de apertura hasta el día del cierre, inclusive.
  const movementsFrom = nextDay(openingDate);
  const movementsTo = closingDate;

  const [localRow] = await db.select({ id: locals.id, name: locals.name }).from(locals).where(eq(locals.id, opts.localId));

  const exploded = await getExplodedRecipesForClient(clientId);
  const openingStock = await getCountedStock(opts.openingValuationId, exploded);
  const closingStock = await getCountedStock(opts.closingValuationId, exploded);
  const purchases = await getPurchasesBySupply(clientId, opts.localId, movementsFrom, movementsTo);
  const { inbound, outbound } = await getTransfersBySupply(clientId, opts.localId, movementsFrom, movementsTo);
  const decomisosBySupply = await getDecomisosBySupply(clientId, opts.localId, movementsFrom, movementsTo);
  const unitCosts = await getReplacementCosts(clientId, opts.closingValuationId);

  const consumptionResult = await getSupplyConsumption(clientId, getSoldProducts, {
    source: opts.source,
    localId: opts.localId,
    dateFrom: movementsFrom,
    dateTo: movementsTo,
  });
  const consumption = new Map<number, number>();
  for (const r of consumptionResult.rows) consumption.set(r.supplyId, r.quantity);

  // Universo: cualquier insumo que aparezca en alguno de los seis componentes.
  const supplyIds = new Set<number>();
  for (const m of [openingStock.bySupply, closingStock.bySupply, purchases, inbound, outbound, decomisosBySupply, consumption]) {
    for (const k of Array.from(m.keys())) supplyIds.add(k);
  }

  const metaRows = await db
    .select({ id: supplies.id, name: supplies.name, unit: unitsOfMeasure.abbreviation })
    .from(supplies)
    .leftJoin(unitsOfMeasure, eq(supplies.unitOfMeasureId, unitsOfMeasure.id))
    .where(eq(supplies.clientId, clientId));
  const meta = new Map(metaRows.map((s) => [s.id, { name: s.name, unit: s.unit ?? null }]));

  const inputs: DeviationInput[] = Array.from(supplyIds).map((supplyId) => ({
    supplyId,
    openingQty: openingStock.bySupply.has(supplyId) ? (openingStock.bySupply.get(supplyId) as number) : null,
    purchases: purchases.get(supplyId) ?? 0,
    transfersIn: inbound.get(supplyId) ?? 0,
    transfersOut: outbound.get(supplyId) ?? 0,
    consumption: consumption.get(supplyId) ?? 0,
    decomisos: decomisosBySupply.get(supplyId) ?? 0,
    closingQty: closingStock.bySupply.has(supplyId) ? (closingStock.bySupply.get(supplyId) as number) : null,
    unitCost: unitCosts.get(supplyId) ?? 0,
  }));

  const rows = computeDeviationRows(inputs, meta);
  const summary = summarizeDeviation(rows, opts.tolerancePct ?? 0);

  const subByRecipe = new Map<number, { subRecipeId: number; name: string; openingQty: number; closingQty: number }>();
  for (const s of openingStock.subRecipes) {
    subByRecipe.set(s.subRecipeId, { subRecipeId: s.subRecipeId, name: s.name, openingQty: s.quantity, closingQty: 0 });
  }
  for (const s of closingStock.subRecipes) {
    const cur = subByRecipe.get(s.subRecipeId);
    if (cur) cur.closingQty = s.quantity;
    else
      subByRecipe.set(s.subRecipeId, {
        subRecipeId: s.subRecipeId,
        name: s.name,
        openingQty: 0,
        closingQty: s.quantity,
      });
  }

  return {
    period: {
      localId: opts.localId,
      localName: localRow?.name ?? null,
      openingValuationId: opts.openingValuationId,
      openingDate,
      closingValuationId: opts.closingValuationId,
      closingDate,
      days: daysBetween(openingDate, closingDate),
    },
    movementsFrom,
    movementsTo,
    rows,
    summary,
    unitsSold: consumptionResult.unitsSold,
    unitsWithRecipe: consumptionResult.unitsWithRecipe,
    coveragePct: consumptionResult.coveragePct,
    subRecipesExploded: Array.from(subByRecipe.values()),
    source: opts.source,
  };
}
