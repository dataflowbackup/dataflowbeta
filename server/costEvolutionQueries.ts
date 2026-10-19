/**
 * Evolución de Costos — lectura de la base. El cálculo vive en `shared/costEvolution.ts`.
 *
 * Solo lee: facturas activas (las anuladas no son un precio) y sin notas de crédito (una NC
 * devuelve plata, no dice cuánto cuesta el insumo).
 */
import { db } from "./db";
import { eq, and, isNull, isNotNull, or, inArray } from "drizzle-orm";
import {
  supplies,
  invoices,
  invoiceItems,
  suppliers,
  locals,
  unitsOfMeasure,
  rubros,
  subRubros,
  recipes,
  recipeIngredients,
  recipeCategories,
  recipeSubcategories,
} from "@shared/schema";
import { formatInvoiceVoucherDisplay } from "@shared/invoiceDisplay";
import { recipeGrossPrice, recipeRemovesIva } from "@shared/recipePricing";
import type { RecipeIngredientNode } from "@shared/supplyMetrics";
import {
  computeCostEvolution,
  detectSuspicious,
  type CostEvolutionGranularity,
  type CostEvolutionResult,
  type CostPurchase,
  type CostRecipeMeta,
  type CostSupplyMeta,
} from "@shared/costEvolution";

const num = (v: unknown) => parseFloat(String(v ?? 0)) || 0;

export interface CostEvolutionOptions {
  dateFrom: string;
  dateTo: string;
  granularity: CostEvolutionGranularity;
  includeSuspicious: boolean;
  localId?: number;
  supplierId?: number;
  rubroId?: number;
  subRubroId?: number;
  cmvObjetivo: number;
}

/** Compras de insumos (todas las fechas: el precio inicial puede ser anterior al período). */
async function loadPurchases(clientId: number, opts: { localId?: number; supplyId?: number }): Promise<CostPurchase[]> {
  const conds = [
    eq(invoices.clientId, clientId),
    isNotNull(invoiceItems.supplyId),
    or(isNull(invoices.status), eq(invoices.status, "active")),
  ];
  // El local filtra en la fuente: los precios de otro local no existen para este análisis.
  if (opts.localId != null) conds.push(eq(invoices.localId, opts.localId));
  if (opts.supplyId != null) conds.push(eq(invoiceItems.supplyId, opts.supplyId));

  const itemRows = await db
    .select({
      itemId: invoiceItems.id,
      supplyId: invoiceItems.supplyId,
      quantity: invoiceItems.quantity,
      unitPrice: invoiceItems.unitPrice,
      subtotal: invoiceItems.subtotal,
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
    .leftJoin(suppliers, eq(invoices.supplierId, suppliers.id))
    .leftJoin(locals, eq(invoices.localId, locals.id))
    .where(and(...conds));

  const purchases: CostPurchase[] = [];
  for (const r of itemRows) {
    if (r.supplyId == null) continue;
    if (String(r.invoiceType ?? "").startsWith("NC-")) continue;
    const quantity = num(r.quantity);
    const subtotal = num(r.subtotal);
    const unitPrice = num(r.unitPrice) > 0 ? num(r.unitPrice) : quantity > 0 ? subtotal / quantity : 0;
    purchases.push({
      itemId: r.itemId,
      supplyId: r.supplyId,
      date: String(r.invoiceDate ?? "").slice(0, 10),
      unitPrice,
      quantity,
      amount: subtotal,
      supplierId: r.supplierId ?? null,
      supplierName: r.supplierName ?? null,
      localId: r.localId ?? null,
      localName: r.localName ?? null,
      invoiceId: r.invoiceId,
      invoiceDisplay: formatInvoiceVoucherDisplay({
        invoiceSalePoint: r.invoiceSalePoint,
        invoiceNumber: r.invoiceNumber,
      }),
    });
  }
  return purchases;
}

export async function getCostEvolution(clientId: number, opts: CostEvolutionOptions): Promise<CostEvolutionResult> {
  const purchases = await loadPurchases(clientId, { localId: opts.localId });

  const supplyRows = await db
    .select({
      id: supplies.id,
      name: supplies.name,
      unit: unitsOfMeasure.abbreviation,
      rubroId: supplies.rubroId,
      rubroName: rubros.name,
      subRubroId: supplies.subRubroId,
      subRubroName: subRubros.name,
      lastCost: supplies.lastCost,
      unitCost: supplies.unitCost,
    })
    .from(supplies)
    .leftJoin(unitsOfMeasure, eq(supplies.unitOfMeasureId, unitsOfMeasure.id))
    .leftJoin(rubros, eq(supplies.rubroId, rubros.id))
    .leftJoin(subRubros, eq(supplies.subRubroId, subRubros.id))
    .where(eq(supplies.clientId, clientId));

  const supplyMeta: CostSupplyMeta[] = supplyRows.map((s) => ({
    id: s.id,
    name: s.name,
    unit: s.unit ?? null,
    rubroId: s.rubroId ?? null,
    rubroName: s.rubroName ?? null,
    subRubroId: s.subRubroId ?? null,
    subRubroName: s.subRubroName ?? null,
    // Misma prioridad que el costeo cuando no hay ninguna factura: último costo y si no, CPP.
    fallbackCost: num(s.lastCost) > 0 ? num(s.lastCost) : num(s.unitCost),
  }));

  const recipeRows = await db
    .select({
      recipe: recipes,
      categoryName: recipeCategories.name,
      subcategoryName: recipeSubcategories.name,
    })
    .from(recipes)
    .leftJoin(recipeCategories, eq(recipes.categoryId, recipeCategories.id))
    .leftJoin(recipeSubcategories, eq(recipes.subcategoryId, recipeSubcategories.id))
    .where(eq(recipes.clientId, clientId));

  const recipeMeta: CostRecipeMeta[] = recipeRows.map(({ recipe: r, categoryName, subcategoryName }) => ({
    id: r.id,
    name: r.name,
    recipeType: r.recipeType ?? "plato",
    categoryId: r.categoryId ?? null,
    categoryName: categoryName ?? null,
    subcategoryId: r.subcategoryId ?? null,
    subcategoryName: subcategoryName ?? null,
    usefulYield: r.usefulYield != null ? num(r.usefulYield) : null,
    yieldUnit: r.yieldUnit ?? null,
    grossPrice: recipeGrossPrice(r),
    removeIva: recipeRemovesIva(r),
    cmvIdeal: r.cmvIdeal != null ? num(r.cmvIdeal) : null,
    storedTotalCost: num(r.totalCost),
    active: r.active !== false,
  }));

  const ingredientsByRecipe = new Map<number, RecipeIngredientNode[]>();
  for (const r of recipeMeta) ingredientsByRecipe.set(r.id, []);
  const recipeIds = recipeMeta.map((r) => r.id);
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
      const quantityTotal = num(r.quantityTotal);
      list.push({
        supplyId: r.supplyId ?? null,
        subRecipeId: r.subRecipeId ?? null,
        quantityTotal,
        quantityWithWaste: num(r.quantityWithWaste) || quantityTotal,
      });
    }
  }

  return computeCostEvolution({
    purchases,
    supplies: supplyMeta,
    recipes: recipeMeta,
    ingredientsByRecipe,
    dateFrom: opts.dateFrom,
    dateTo: opts.dateTo,
    granularity: opts.granularity,
    includeSuspicious: opts.includeSuspicious,
    supplierId: opts.supplierId,
    rubroId: opts.rubroId,
    subRubroId: opts.subRubroId,
    cmvObjetivo: opts.cmvObjetivo,
  });
}

/**
 * Compras de UN insumo en el período, para la ficha. Va aparte porque el detalle de todos los
 * insumos juntos pesaba más de 1,5 MB. La marca de sospechoso se calcula contra el historial
 * completo del insumo, igual que en el tablero.
 */
export async function getCostEvolutionPurchases(
  clientId: number,
  opts: { supplyId: number; dateFrom: string; dateTo: string; localId?: number; supplierId?: number },
): Promise<Array<CostPurchase & { suspicious: boolean }>> {
  const all = await loadPurchases(clientId, { localId: opts.localId, supplyId: opts.supplyId });
  const suspicious = detectSuspicious(all);
  return all
    .filter(
      (p) =>
        p.date >= opts.dateFrom &&
        p.date <= opts.dateTo &&
        (opts.supplierId == null || p.supplierId === opts.supplierId),
    )
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.itemId - a.itemId))
    .map((p) => ({ ...p, suspicious: suspicious.has(p.itemId) }));
}
