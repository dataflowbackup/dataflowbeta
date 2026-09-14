/**
 * Métricas de insumos: compras (lo que entró por factura) y consumo (lo que salió por receta).
 *
 * Las dos mitades se miden en la MISMA unidad del insumo: el sistema no convierte unidades
 * (`units_of_measure` no tiene factor), así que la cantidad de la factura y la de la receta
 * ya son comparables. Por eso "comprado − consumido" es un número con sentido.
 */

/** Una línea de `recipe_ingredients` reducida a lo que hace falta para explotar la receta. */
export interface RecipeIngredientNode {
  supplyId: number | null;
  subRecipeId: number | null;
  /** Cantidad de la receta. Es la que usa el costeo, así que es la que manda en el consumo. */
  quantityTotal: number;
  /** Cantidad con merma incluida. Informativa: se muestra al lado, no reemplaza a la anterior. */
  quantityWithWaste: number;
}

/** Cuánto de un insumo consume UNA unidad de una receta, ya explotadas las sub-recetas. */
export interface ExplodedSupplyQty {
  supplyId: number;
  quantityTotal: number;
  quantityWithWaste: number;
}

/**
 * Escala de una sub-receta: cuántas veces entra su lista de ingredientes por cada unidad
 * que la receta padre le pide. Misma semántica que el costeo (`computeUnitCostForRecipe`):
 * con rendimiento cargado se prorratea, sin rendimiento la sub-receta entra entera.
 */
export function subRecipeScale(quantityTotal: number, usefulYield: number | null | undefined): number {
  const y = Number(usefulYield ?? 0);
  return y > 0 ? quantityTotal / y : quantityTotal;
}

/**
 * Costo de UNA unidad de rendimiento de una sub-receta. Misma regla que el costeo: sin
 * rendimiento cargado, la sub-receta entera cuenta como una unidad.
 */
export function subRecipeUnitCost(totalCost: number, usefulYield: number | null | undefined): number {
  const y = Number(usefulYield ?? 0);
  return y > 0 ? totalCost / y : totalCost;
}

/**
 * Explota cada receta hasta sus insumos, resolviendo sub-recetas en cascada.
 *
 * Devuelve, por receta, cuánto de cada insumo consume UNA unidad vendida. Las recetas que se
 * referencian entre sí (ciclo) se cortan: la rama que vuelve sobre una receta ya abierta se
 * descarta y se reporta, en vez de colgar el cálculo.
 */
export function explodeRecipes(
  ingredientsByRecipe: Map<number, RecipeIngredientNode[]>,
  usefulYieldByRecipe: Map<number, number | null>,
): { byRecipe: Map<number, ExplodedSupplyQty[]>; cyclicRecipeIds: number[] } {
  const memo = new Map<number, Map<number, ExplodedSupplyQty>>();
  const cyclic = new Set<number>();

  const walk = (recipeId: number, open: Set<number>): Map<number, ExplodedSupplyQty> => {
    const cached = memo.get(recipeId);
    if (cached) return cached;

    if (open.has(recipeId)) {
      cyclic.add(recipeId);
      return new Map();
    }
    open.add(recipeId);

    const acc = new Map<number, ExplodedSupplyQty>();
    const add = (supplyId: number, quantityTotal: number, quantityWithWaste: number) => {
      const cur = acc.get(supplyId);
      if (cur) {
        cur.quantityTotal += quantityTotal;
        cur.quantityWithWaste += quantityWithWaste;
      } else {
        acc.set(supplyId, { supplyId, quantityTotal, quantityWithWaste });
      }
    };

    for (const ing of ingredientsByRecipe.get(recipeId) ?? []) {
      if (ing.supplyId != null) {
        add(ing.supplyId, ing.quantityTotal, ing.quantityWithWaste);
        continue;
      }
      if (ing.subRecipeId == null) continue;

      const sub = walk(ing.subRecipeId, open);
      const scaleTotal = subRecipeScale(ing.quantityTotal, usefulYieldByRecipe.get(ing.subRecipeId));
      // La merma del padre escala la rama entera; la del hijo ya viene adentro de `sub`.
      const scaleWaste = subRecipeScale(ing.quantityWithWaste, usefulYieldByRecipe.get(ing.subRecipeId));
      for (const s of Array.from(sub.values())) {
        add(s.supplyId, s.quantityTotal * scaleTotal, s.quantityWithWaste * scaleWaste);
      }
    }

    open.delete(recipeId);
    memo.set(recipeId, acc);
    return acc;
  };

  const byRecipe = new Map<number, ExplodedSupplyQty[]>();
  for (const recipeId of Array.from(ingredientsByRecipe.keys())) {
    byRecipe.set(recipeId, Array.from(walk(recipeId, new Set()).values()));
  }

  return { byRecipe, cyclicRecipeIds: Array.from(cyclic) };
}

// ==========================================
// Formas de respuesta de los endpoints
// ==========================================

export interface SupplyPurchaseRow {
  /** Clave de fila para la tabla: id del ítem en el detalle, id del insumo en el ranking. */
  id: number;
  supplyId: number;
  supplyName: string;
  unit: string | null;
  quantity: number;
  amount: number;
  /** Ponderado por cantidad, no el promedio simple de los precios unitarios. */
  avgUnitPrice: number | null;
}

/** Una línea de factura, para el detalle cuando hay un insumo elegido. */
export interface SupplyPurchaseDetailRow extends SupplyPurchaseRow {
  invoiceId: number;
  invoiceDisplay: string;
  invoiceType: string;
  invoiceDate: string;
  supplierId: number | null;
  supplierName: string | null;
  localId: number | null;
  localName: string | null;
  description: string | null;
  isCreditNote: boolean;
}

export interface SupplyPurchasesResult {
  rows: SupplyPurchaseRow[];
  detail: SupplyPurchaseDetailRow[];
  totalQuantity: number;
  totalAmount: number;
  invoiceCount: number;
  supplyCount: number;
}

export interface SupplyConsumptionRow {
  id: number;
  supplyId: number;
  supplyName: string;
  unit: string | null;
  quantity: number;
  quantityWithWaste: number;
  unitCost: number;
  amount: number;
}

/** Qué producto vendido generó el consumo, para el detalle. */
export interface SupplyConsumptionDetailRow extends SupplyConsumptionRow {
  producto: string;
  recipeId: number;
  recipeName: string;
  unitsSold: number;
  quantityPerUnit: number;
}

export interface SupplyConsumptionResult {
  rows: SupplyConsumptionRow[];
  detail: SupplyConsumptionDetailRow[];
  totalQuantity: number;
  totalAmount: number;
  supplyCount: number;
  /** Unidades vendidas en el período y cuántas de ellas tenían receta mapeada. */
  unitsSold: number;
  unitsWithRecipe: number;
  coveragePct: number | null;
  /** Productos vendidos sin receta, ordenados por volumen: lo que falta mapear. */
  topUnmapped: Array<{ producto: string; cantidad: number }>;
  unmappedCount: number;
  cyclicRecipeIds: number[];
  /**
   * Datalive guarda período (desde/hasta), no día: los archivos que se solapan sólo en parte
   * con el filtro quedan afuera enteros. Se avisa para no leer un número incompleto como total.
   */
  partialPeriodsExcluded: number;
}
