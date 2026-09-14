/**
 * Métricas de insumos: Compras (lo que entró por factura) y Consumo (lo que salió por receta).
 *
 * Vive aparte de `storage.ts` — que ya es enorme — y recibe `db` por import, igual que el resto
 * de la capa de datos. `storage` expone estos métodos delegando acá.
 */
import { db } from "./db";
import { eq, and, desc, gte, lte, isNull, isNotNull, inArray, or } from "drizzle-orm";
import {
  supplies,
  invoices,
  invoiceItems,
  suppliers,
  locals,
  unitsOfMeasure,
  recipes,
  recipeIngredients,
  dataliveProductos,
  productRecipeMappings,
  productCosts,
} from "@shared/schema";
import { formatInvoiceVoucherDisplay } from "@shared/invoiceDisplay";
import { scoreSupplyMatch } from "@shared/bulkInvoiceImportHelpers";
import {
  explodeRecipes,
  type RecipeIngredientNode,
  type SupplyPurchaseDetailRow,
  type SupplyPurchaseRow,
  type SupplyPurchasesResult,
  type SupplyConsumptionDetailRow,
  type SupplyConsumptionRow,
  type SupplyConsumptionResult,
} from "@shared/supplyMetrics";

export type ProductSource = "fudo" | "datalive" | "shares";

/** Productos vendidos del período, agregados por nombre. Lo provee `storage`. */
export type SoldProductsFn = (
  clientId: number,
  opts: { source: ProductSource; dateFrom?: string; dateTo?: string; localIds?: number[] },
) => Promise<Array<{ producto: string; categoria: string | null; cantidad: number }>>;

/** Insumos que alguna vez se le compraron a un proveedor (histórico completo, no del período). */
async function getSupplyIdsBySupplier(clientId: number, supplierId: number): Promise<Set<number>> {
  const rows = await db
    .select({ supplyId: invoiceItems.supplyId })
    .from(invoiceItems)
    .innerJoin(invoices, eq(invoiceItems.invoiceId, invoices.id))
    .where(
      and(
        eq(invoices.clientId, clientId),
        eq(invoices.supplierId, supplierId),
        isNotNull(invoiceItems.supplyId),
      ),
    );
  const out = new Set<number>();
  for (const r of rows) if (r.supplyId != null) out.add(r.supplyId);
  return out;
}

/**
 * Compras de insumos: lo que entró por factura, en cantidad y en plata (neto de IVA).
 *
 * Las anuladas quedan afuera y las notas de crédito restan, para que "cantidad comprada" sea lo
 * que realmente entró y no la suma de los papeles emitidos.
 */
export async function getSupplyPurchases(
  clientId: number,
  opts: { supplyId?: number; localId?: number; supplierId?: number; dateFrom?: string; dateTo?: string },
): Promise<SupplyPurchasesResult> {
  const conds = [
    eq(invoices.clientId, clientId),
    isNotNull(invoiceItems.supplyId),
    or(isNull(invoices.status), eq(invoices.status, "active")),
  ];
  if (opts.supplyId != null) conds.push(eq(invoiceItems.supplyId, opts.supplyId));
  if (opts.localId != null) conds.push(eq(invoices.localId, opts.localId));
  if (opts.supplierId != null) conds.push(eq(invoices.supplierId, opts.supplierId));
  if (opts.dateFrom) conds.push(gte(invoices.invoiceDate, opts.dateFrom));
  if (opts.dateTo) conds.push(lte(invoices.invoiceDate, opts.dateTo));

  const rows = await db
    .select({
      itemId: invoiceItems.id,
      supplyId: invoiceItems.supplyId,
      supplyName: supplies.name,
      unit: unitsOfMeasure.abbreviation,
      quantity: invoiceItems.quantity,
      subtotal: invoiceItems.subtotal,
      description: invoiceItems.description,
      invoiceId: invoices.id,
      invoiceType: invoices.invoiceType,
      invoiceSalePoint: invoices.invoiceSalePoint,
      invoiceNumber: invoices.invoiceNumber,
      invoiceDate: invoices.invoiceDate,
      supplierId: invoices.supplierId,
      supplierName: suppliers.tradeName,
      localId: invoices.localId,
      localName: locals.name,
    })
    .from(invoiceItems)
    .innerJoin(invoices, eq(invoiceItems.invoiceId, invoices.id))
    .leftJoin(supplies, eq(invoiceItems.supplyId, supplies.id))
    .leftJoin(unitsOfMeasure, eq(supplies.unitOfMeasureId, unitsOfMeasure.id))
    .leftJoin(suppliers, eq(invoices.supplierId, suppliers.id))
    .leftJoin(locals, eq(invoices.localId, locals.id))
    .where(and(...conds))
    .orderBy(desc(invoices.invoiceDate), desc(invoiceItems.id));

  const detail: SupplyPurchaseDetailRow[] = [];
  const bySupply = new Map<number, SupplyPurchaseRow>();
  const invoiceIds = new Set<number>();
  let totalQuantity = 0;
  let totalAmount = 0;

  for (const r of rows) {
    const supplyId = r.supplyId;
    if (supplyId == null) continue;

    const isCreditNote = String(r.invoiceType ?? "").startsWith("NC-");
    const sign = isCreditNote ? -1 : 1;
    const quantity = (parseFloat(String(r.quantity ?? 0)) || 0) * sign;
    const amount = (parseFloat(String(r.subtotal ?? 0)) || 0) * sign;

    invoiceIds.add(r.invoiceId);
    totalQuantity += quantity;
    totalAmount += amount;

    detail.push({
      id: r.itemId,
      supplyId,
      supplyName: r.supplyName ?? "(insumo eliminado)",
      unit: r.unit ?? null,
      quantity,
      amount,
      avgUnitPrice: quantity !== 0 ? amount / quantity : null,
      invoiceId: r.invoiceId,
      invoiceDisplay: formatInvoiceVoucherDisplay({
        invoiceSalePoint: r.invoiceSalePoint,
        invoiceNumber: r.invoiceNumber,
      }),
      invoiceType: r.invoiceType ?? "",
      invoiceDate: String(r.invoiceDate ?? ""),
      supplierId: r.supplierId ?? null,
      supplierName: r.supplierName ?? null,
      localId: r.localId ?? null,
      localName: r.localName ?? null,
      description: r.description ?? null,
      isCreditNote,
    });

    const cur = bySupply.get(supplyId);
    if (cur) {
      cur.quantity += quantity;
      cur.amount += amount;
    } else {
      bySupply.set(supplyId, {
        id: supplyId,
        supplyId,
        supplyName: r.supplyName ?? "(insumo eliminado)",
        unit: r.unit ?? null,
        quantity,
        amount,
        avgUnitPrice: null,
      });
    }
  }

  // Precio unitario promedio PONDERADO por cantidad: el promedio simple miente cuando las
  // compras son de tamaños muy distintos.
  const aggregated = Array.from(bySupply.values()).map((r) => ({
    ...r,
    avgUnitPrice: r.quantity !== 0 ? r.amount / r.quantity : null,
  }));
  aggregated.sort((a, b) => b.amount - a.amount);

  return {
    rows: aggregated,
    detail,
    totalQuantity,
    totalAmount,
    invoiceCount: invoiceIds.size,
    supplyCount: aggregated.length,
  };
}

/** Costo unitario vigente de cada insumo, con la MISMA prioridad que usa el costeo de recetas. */
async function getCurrentSupplyUnitCosts(clientId: number): Promise<Map<number, number>> {
  const supplyRows = await db
    .select({ id: supplies.id, lastCost: supplies.lastCost, unitCost: supplies.unitCost })
    .from(supplies)
    .where(eq(supplies.clientId, clientId));

  const latestRows = await db
    .select({ supplyId: invoiceItems.supplyId, unitPrice: invoiceItems.unitPrice })
    .from(invoiceItems)
    .innerJoin(invoices, eq(invoiceItems.invoiceId, invoices.id))
    .where(and(eq(invoices.clientId, clientId), isNotNull(invoiceItems.supplyId)))
    .orderBy(desc(invoices.invoiceDate), desc(invoiceItems.id));

  const latestBySupply = new Map<number, number>();
  for (const r of latestRows) {
    if (r.supplyId == null || latestBySupply.has(r.supplyId)) continue;
    latestBySupply.set(r.supplyId, parseFloat(String(r.unitPrice ?? 0)) || 0);
  }

  const out = new Map<number, number>();
  for (const s of supplyRows) {
    const latest = latestBySupply.get(s.id) || 0;
    const lastCost = parseFloat(String(s.lastCost ?? 0)) || 0;
    const cpp = parseFloat(String(s.unitCost ?? 0)) || 0;
    out.set(s.id, latest > 0 ? latest : lastCost > 0 ? lastCost : cpp);
  }
  return out;
}

/** Recetas explotadas a insumos, con sub-recetas resueltas en cascada. */
async function getExplodedRecipes(clientId: number) {
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
      const list = ingredientsByRecipe.get(r.recipeId);
      if (!list) continue;
      const quantityTotal = parseFloat(String(r.quantityTotal ?? 0)) || 0;
      list.push({
        supplyId: r.supplyId ?? null,
        subRecipeId: r.subRecipeId ?? null,
        quantityTotal,
        quantityWithWaste: parseFloat(String(r.quantityWithWaste ?? 0)) || quantityTotal,
      });
    }
  }

  const usefulYieldByRecipe = new Map<number, number | null>(
    recipeRows.map((r) => [r.id, r.usefulYield != null ? parseFloat(String(r.usefulYield)) : null] as [number, number | null]),
  );
  const { byRecipe, cyclicRecipeIds } = explodeRecipes(ingredientsByRecipe, usefulYieldByRecipe);
  const nameById = new Map(recipeRows.map((r) => [r.id, r.name]));
  return { byRecipe, cyclicRecipeIds, nameById };
}

/**
 * Cuántos registros de Datalive se solapan sólo EN PARTE con el rango pedido.
 *
 * Datalive guarda período (desde/hasta), no día: esos registros quedan afuera enteros porque
 * prorratear por días sería inventar datos. Se cuentan para poder avisarlo en pantalla.
 */
async function countPartialDatalivePeriods(
  clientId: number,
  opts: { dateFrom?: string; dateTo?: string; localIds?: number[] },
): Promise<number> {
  if (!opts.dateFrom && !opts.dateTo) return 0;
  const conds = [eq(dataliveProductos.clientId, clientId)];
  if (opts.localIds && opts.localIds.length > 0) conds.push(inArray(dataliveProductos.localId, opts.localIds));
  const rows = await db
    .select({ desde: dataliveProductos.fechaDesde, hasta: dataliveProductos.fechaHasta })
    .from(dataliveProductos)
    .where(and(...conds));

  const from = opts.dateFrom ?? "";
  const to = opts.dateTo ?? "9999-12-31";
  let partial = 0;
  for (const r of rows) {
    const desde = String(r.desde ?? "");
    const hasta = String(r.hasta ?? "");
    if (!desde || !hasta) continue;
    const contained = desde >= from && hasta <= to;
    const overlaps = desde <= to && hasta >= from;
    if (overlaps && !contained) partial++;
  }
  return partial;
}

/** El puente producto vendido → receta: `product_costs` manda, y si no hay se cae al mapeo del Dashboard. */
async function getRecipeByProductName(clientId: number, source: ProductSource): Promise<Map<string, number>> {
  const recipeByName = new Map<string, number>();

  const costRows = await db
    .select()
    .from(productCosts)
    .where(and(eq(productCosts.clientId, clientId), eq(productCosts.source, source)));
  for (const c of costRows) {
    if (c.recipeId != null && c.costMode !== "manual") recipeByName.set(c.productName, c.recipeId);
  }

  const mappingRows = await db
    .select()
    .from(productRecipeMappings)
    .where(and(eq(productRecipeMappings.clientId, clientId), eq(productRecipeMappings.source, source)));
  for (const m of mappingRows) {
    if (!recipeByName.has(m.productName)) recipeByName.set(m.productName, m.recipeId);
  }

  return recipeByName;
}

/**
 * Consumo teórico de insumos: producto vendido × receta mapeada × ingredientes.
 *
 * Usa `quantityTotal` (la cantidad de la receta), que es la que usa el costeo, para que el consumo
 * valorizado cierre exacto contra el CMV Productos. La merma viaja al lado como dato informativo.
 * El costo es el vigente del insumo, mismo criterio que el costeo de recetas.
 */
export async function getSupplyConsumption(
  clientId: number,
  getSoldProducts: SoldProductsFn,
  opts: {
    source: ProductSource;
    supplyId?: number;
    localId?: number;
    supplierId?: number;
    dateFrom?: string;
    dateTo?: string;
  },
): Promise<SupplyConsumptionResult> {
  const localIds = opts.localId != null ? [opts.localId] : undefined;

  const sold = await getSoldProducts(clientId, {
    source: opts.source,
    dateFrom: opts.dateFrom,
    dateTo: opts.dateTo,
    localIds,
  });

  const recipeByName = await getRecipeByProductName(clientId, opts.source);
  const { byRecipe, cyclicRecipeIds, nameById } = await getExplodedRecipes(clientId);
  const unitCosts = await getCurrentSupplyUnitCosts(clientId);

  const supplyRows = await db
    .select({ id: supplies.id, name: supplies.name, unit: unitsOfMeasure.abbreviation })
    .from(supplies)
    .leftJoin(unitsOfMeasure, eq(supplies.unitOfMeasureId, unitsOfMeasure.id))
    .where(eq(supplies.clientId, clientId));
  const supplyById = new Map(supplyRows.map((s) => [s.id, s]));

  const supplierSupplyIds =
    opts.supplierId != null ? await getSupplyIdsBySupplier(clientId, opts.supplierId) : null;
  const keepSupply = (supplyId: number) => {
    if (opts.supplyId != null && supplyId !== opts.supplyId) return false;
    if (supplierSupplyIds && !supplierSupplyIds.has(supplyId)) return false;
    return true;
  };

  const detail: SupplyConsumptionDetailRow[] = [];
  const bySupply = new Map<number, SupplyConsumptionRow>();
  const unmapped: Array<{ producto: string; cantidad: number }> = [];
  let unitsSold = 0;
  let unitsWithRecipe = 0;
  let detailId = 0;

  for (const s of sold) {
    const cantidad = s.cantidad ?? 0;
    unitsSold += cantidad;

    const recipeId = recipeByName.get(s.producto);
    if (recipeId == null || !byRecipe.has(recipeId)) {
      unmapped.push({ producto: s.producto, cantidad });
      continue;
    }
    unitsWithRecipe += cantidad;

    for (const ing of byRecipe.get(recipeId) ?? []) {
      if (!keepSupply(ing.supplyId)) continue;

      const quantity = ing.quantityTotal * cantidad;
      const quantityWithWaste = ing.quantityWithWaste * cantidad;
      const unitCost = unitCosts.get(ing.supplyId) ?? 0;
      const amount = quantity * unitCost;
      const supply = supplyById.get(ing.supplyId);
      const supplyName = supply?.name ?? "(insumo eliminado)";
      const unit = supply?.unit ?? null;

      detail.push({
        id: ++detailId,
        supplyId: ing.supplyId,
        supplyName,
        unit,
        quantity,
        quantityWithWaste,
        unitCost,
        amount,
        producto: s.producto,
        recipeId,
        recipeName: nameById.get(recipeId) ?? "",
        unitsSold: cantidad,
        quantityPerUnit: ing.quantityTotal,
      });

      const cur = bySupply.get(ing.supplyId);
      if (cur) {
        cur.quantity += quantity;
        cur.quantityWithWaste += quantityWithWaste;
        cur.amount += amount;
      } else {
        bySupply.set(ing.supplyId, {
          id: ing.supplyId,
          supplyId: ing.supplyId,
          supplyName,
          unit,
          quantity,
          quantityWithWaste,
          unitCost,
          amount,
        });
      }
    }
  }

  const aggregated = Array.from(bySupply.values()).sort((a, b) => b.amount - a.amount);
  unmapped.sort((a, b) => b.cantidad - a.cantidad);

  return {
    rows: aggregated,
    detail,
    totalQuantity: aggregated.reduce((acc, r) => acc + r.quantity, 0),
    totalAmount: aggregated.reduce((acc, r) => acc + r.amount, 0),
    supplyCount: aggregated.length,
    unitsSold,
    unitsWithRecipe,
    coveragePct: unitsSold > 0 ? (unitsWithRecipe / unitsSold) * 100 : null,
    topUnmapped: unmapped.slice(0, 10),
    unmappedCount: unmapped.length,
    cyclicRecipeIds,
    partialPeriodsExcluded:
      opts.source === "datalive"
        ? await countPartialDatalivePeriods(clientId, {
            dateFrom: opts.dateFrom,
            dateTo: opts.dateTo,
            localIds,
          })
        : 0,
  };
}

/** Score mínimo para ofrecer una receta sugerida. Debajo de esto se deja sin sugerir. */
const MIN_RECIPE_SUGGESTION_SCORE = 0.4;

/**
 * Productos vendidos y su receta, ordenados por volumen, con sugerencia por parecido de nombre
 * para los que todavía no tienen. Es la cola de trabajo que hace que el consumo deje de dar cero.
 */
export async function getSoldProductMappings(
  clientId: number,
  getSoldProducts: SoldProductsFn,
  opts: { source: ProductSource; dateFrom?: string; dateTo?: string; localId?: number },
) {
  const localIds = opts.localId != null ? [opts.localId] : undefined;
  const sold = await getSoldProducts(clientId, {
    source: opts.source,
    dateFrom: opts.dateFrom,
    dateTo: opts.dateTo,
    localIds,
  });

  const recipeByName = await getRecipeByProductName(clientId, opts.source);
  const recipeRows = await db
    .select({ id: recipes.id, name: recipes.name })
    .from(recipes)
    .where(and(eq(recipes.clientId, clientId), eq(recipes.active, true)));
  const recipeNameById = new Map(recipeRows.map((r) => [r.id, r.name]));

  return sold.map((s) => {
    const currentRecipeId = recipeByName.get(s.producto) ?? null;
    let suggestedRecipeId: number | null = null;
    let suggestedRecipeName: string | null = null;
    let suggestedScore = 0;

    if (currentRecipeId == null) {
      for (const r of recipeRows) {
        const score = scoreSupplyMatch(s.producto, r.name);
        if (score > suggestedScore) {
          suggestedScore = score;
          suggestedRecipeId = r.id;
          suggestedRecipeName = r.name;
        }
      }
      if (suggestedScore < MIN_RECIPE_SUGGESTION_SCORE) {
        suggestedRecipeId = null;
        suggestedRecipeName = null;
      }
    }

    return {
      producto: s.producto,
      categoria: s.categoria,
      cantidad: s.cantidad,
      currentRecipeId,
      currentRecipeName: currentRecipeId != null ? recipeNameById.get(currentRecipeId) ?? null : null,
      suggestedRecipeId,
      suggestedRecipeName,
      suggestedScore: suggestedRecipeId != null ? suggestedScore : null,
    };
  });
}

/** Guarda en lote el mapeo producto → receta. `recipeId` en null borra el mapeo existente. */
export async function saveProductRecipeMappings(
  clientId: number,
  source: ProductSource,
  entries: Array<{ productName: string; recipeId: number | null }>,
): Promise<{ saved: number; removed: number }> {
  let saved = 0;
  let removed = 0;

  for (const entry of entries) {
    const productName = String(entry.productName ?? "").trim();
    if (!productName) continue;

    const where = and(
      eq(productRecipeMappings.clientId, clientId),
      eq(productRecipeMappings.source, source),
      eq(productRecipeMappings.productName, productName),
    );

    if (entry.recipeId == null) {
      await db.delete(productRecipeMappings).where(where);
      removed++;
      continue;
    }

    const existing = await db.select({ id: productRecipeMappings.id }).from(productRecipeMappings).where(where);
    if (existing.length > 0) {
      await db
        .update(productRecipeMappings)
        .set({ recipeId: entry.recipeId })
        .where(eq(productRecipeMappings.id, existing[0].id));
    } else {
      await db.insert(productRecipeMappings).values({ clientId, source, productName, recipeId: entry.recipeId });
    }
    saved++;
  }

  return { saved, removed };
}
