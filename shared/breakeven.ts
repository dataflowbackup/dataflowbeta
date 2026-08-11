/**
 * Punto de Equilibrio — fórmulas compartidas entre el browser y el servidor.
 *
 * La misma cuenta se hacía por triplicado (pantalla, validación de la ruta y storage) y cualquier
 * cambio tenía que replicarse en los tres. Vive acá para que no se separen.
 *
 * Todo se calcula SIN IVA, salvo la base "con_iva", que reconstruye el precio bruto porque hay
 * comisiones (Mercado Pago, tarjetas) que se cobran sobre el total facturado.
 */

/** Sobre qué importe se aplica el % de un costo variable. */
export type VariableCostBase = "costo" | "sin_iva" | "con_iva";

export interface AppliedVariableCost {
  label?: string | null;
  pct: number;
  base: VariableCostBase;
  /** Alícuota de IVA. Solo se usa con base "con_iva". */
  ivaRate?: number | null;
}

export const VARIABLE_COST_BASE_LABELS: Record<VariableCostBase, string> = {
  costo: "Sobre el costo del producto",
  sin_iva: "Sobre el precio de venta SIN IVA",
  con_iva: "Sobre el precio de venta CON IVA",
};

/** Importe sobre el que se aplica el % de un costo variable, para un producto dado. */
export function variableCostBaseAmount(
  item: Pick<AppliedVariableCost, "base" | "ivaRate">,
  priceNoIva: number,
  costNoIva: number,
): number {
  switch (item.base) {
    case "costo":
      return costNoIva;
    case "con_iva":
      return priceNoIva * (1 + (Number(item.ivaRate) || 0) / 100);
    default:
      return priceNoIva;
  }
}

/** Cuánto cuesta un costo variable puntual, en pesos por unidad vendida. */
export function variableCostAmount(
  item: AppliedVariableCost,
  priceNoIva: number,
  costNoIva: number,
): number {
  return variableCostBaseAmount(item, priceNoIva, costNoIva) * ((Number(item.pct) || 0) / 100);
}

/** Suma de todos los costos variables en % , en pesos por unidad vendida. */
export function totalVariableCostPerUnit(
  items: AppliedVariableCost[],
  priceNoIva: number,
  costNoIva: number,
): number {
  if (!Array.isArray(items)) return 0;
  return items.reduce((acc, item) => acc + variableCostAmount(item, priceNoIva, costNoIva), 0);
}

export interface BreakevenResult {
  /** Costos variables en % , en $ por unidad. */
  variablePerUnit: number;
  /** Precio − costo − costos variables, en $ por unidad. */
  contributionMargin: number;
  /** Margen de contribución como % del precio de venta. */
  contributionPct: number;
  /** Unidades para no ganar ni perder. null si el margen no es positivo (el PE no existe). */
  units: number | null;
  /** Facturación en el punto de equilibrio. null si no hay PE. */
  revenue: number | null;
}

/**
 * PE = costos fijos / margen de contribución.
 *
 * Con margen ≤ 0 cada unidad vendida agranda la pérdida, así que no hay punto de equilibrio: se
 * devuelve null en vez de 0, que se leería como "no necesitás vender nada".
 */
export function computeBreakeven(input: {
  priceNoIva: number;
  costNoIva: number;
  totalFixedCosts: number;
  variableCosts: AppliedVariableCost[];
}): BreakevenResult {
  const price = Number(input.priceNoIva) || 0;
  const cost = Number(input.costNoIva) || 0;
  const fixed = Number(input.totalFixedCosts) || 0;
  const variablePerUnit = totalVariableCostPerUnit(input.variableCosts, price, cost);
  const contributionMargin = price - cost - variablePerUnit;
  const hasBreakeven = contributionMargin > 0;
  const units = hasBreakeven ? fixed / contributionMargin : null;
  return {
    variablePerUnit,
    contributionMargin,
    contributionPct: price > 0 ? (contributionMargin / price) * 100 : 0,
    units,
    revenue: units != null ? units * price : null,
  };
}

/**
 * Ganancia al vender una cantidad dada. Cubiertos los costos fijos, cada unidad extra deja el
 * margen de contribución entero — que es exactamente lo que se quiere poder simular.
 */
export function profitAtUnits(units: number, contributionMargin: number, totalFixedCosts: number): number {
  return (Number(units) || 0) * contributionMargin - (Number(totalFixedCosts) || 0);
}
