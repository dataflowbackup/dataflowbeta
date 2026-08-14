/**
 * Precio de venta y métricas de una receta — fórmulas compartidas entre el browser y el servidor.
 *
 * El precio de venta se carga tal como se cobra en el mostrador. Qué se usa después como precio de
 * referencia depende de la receta (ago-2026):
 *
 *   - `removeIva = true`  (histórico y default): al precio se le quita el IVA y el CMV sale
 *     costo sin IVA / precio SIN IVA.
 *   - `removeIva = false`: no se le quita nada y el CMV sale costo sin IVA / precio CON IVA.
 *
 * Todo lo que consume la receta (CMV %, margen, markup, punto de equilibrio) usa `salePrice`, que
 * es el precio de referencia ya resuelto; `salePriceWithTax` guarda siempre el precio cobrado.
 */

/** Alícuota con la que se descuenta el IVA del precio de venta. */
export const RECIPE_IVA_RATE = 21;

const IVA_FACTOR = 1 + RECIPE_IVA_RATE / 100;

/**
 * Precio efectivamente cobrado. Las recetas viejas pueden tener sale_price_with_tax en 0 y solo el
 * neto cargado: en ese caso se reconstruye el bruto para no perder el dato.
 */
export function recipeGrossPrice(recipe: {
  salePrice?: string | number | null;
  salePriceWithTax?: string | number | null;
}): number {
  const withTax = parseFloat(String(recipe.salePriceWithTax ?? 0)) || 0;
  if (withTax > 0) return withTax;
  const net = parseFloat(String(recipe.salePrice ?? 0)) || 0;
  return net > 0 ? net * IVA_FACTOR : 0;
}

/** Precio contra el que se miden CMV, margen y markup. */
export function recipeReferencePrice(grossPrice: number, removeIva: boolean): number {
  const gross = Number(grossPrice) || 0;
  return removeIva ? gross / IVA_FACTOR : gross;
}

export interface RecipeMetrics {
  /** Precio de referencia: sin IVA o con IVA según la receta. */
  salePrice: number;
  /** Precio cobrado, siempre con IVA incluido. */
  salePriceWithTax: number;
  cmvPercentage: number;
  margin: number;
  marginPercentage: number;
  markup: number;
}

/** CMV %, margen y markup de una receta contra su precio de referencia. */
export function computeRecipeMetrics(input: {
  grossPrice: number;
  totalCost: number;
  removeIva: boolean;
}): RecipeMetrics {
  const grossPrice = Number(input.grossPrice) || 0;
  const totalCost = Number(input.totalCost) || 0;
  const salePrice = recipeReferencePrice(grossPrice, input.removeIva);
  const margin = salePrice - totalCost;
  return {
    salePrice,
    salePriceWithTax: grossPrice,
    cmvPercentage: salePrice > 0 ? (totalCost / salePrice) * 100 : 0,
    margin,
    marginPercentage: salePrice > 0 ? (margin / salePrice) * 100 : 0,
    markup: totalCost > 0 ? (margin / totalCost) * 100 : 0,
  };
}

/**
 * Lee la política de IVA de una receta. Las recetas anteriores a ago-2026 no tienen el campo y se
 * siguen leyendo como "sí, se le quita el IVA", que es como se calcularon.
 */
export function recipeRemovesIva(recipe: { removeIvaFromPrice?: boolean | null }): boolean {
  return recipe?.removeIvaFromPrice !== false;
}
