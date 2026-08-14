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

// ==========================================
// MEZCLA DE PRODUCTOS CON UNO LÍDER (ago-2026)
// ==========================================
/**
 * Un local no vende un solo producto: vende 10 empanadas y, cada esas 10, 2 pizzas. El líder manda
 * —todas las cantidades se expresan "cada X unidades del líder"— así que el punto de equilibrio
 * sale en unidades del LÍDER y el resto acompaña en proporción.
 *
 * Todo se reduce a una unidad de líder ficticia: facturación por unidad de líder = precio del líder
 * + la parte proporcional de cada acompañante. A partir de ahí la fórmula es la de siempre.
 */
export interface MixProduct {
  name?: string | null;
  priceNoIva: number;
  costNoIva: number;
  /** Unidades por canasta. En el líder es la cantidad de referencia (las 10 empanadas). */
  qty: number;
}

export interface MixProductLine extends MixProduct {
  priceNoIva: number;
  costNoIva: number;
  qty: number;
  /** Unidades de este producto por CADA unidad del líder (qty / cantidad del líder). */
  ratio: number;
  /** Costos variables en % , en $ por unidad de ESTE producto. */
  variablePerUnit: number;
  /** Precio − costo − costos variables, por unidad de este producto. */
  contributionPerUnit: number;
}

export interface MixBreakevenResult {
  lines: MixProductLine[];
  /** Cantidad de referencia del líder (las 10 empanadas). */
  leaderQty: number;
  /** Facturación por unidad de líder: el líder más la parte proporcional del resto. */
  revenuePerLeaderUnit: number;
  /** Costo de los productos por unidad de líder, sin los % variables. */
  productCostPerLeaderUnit: number;
  /** Costos variables en % por unidad de líder. */
  pctVariablePerLeaderUnit: number;
  /** Costo variable total (productos + %) por unidad de líder. */
  variablePerLeaderUnit: number;
  /** Margen de contribución por unidad de líder. */
  contributionMargin: number;
  contributionPct: number;
  /** Unidades DEL LÍDER para no ganar ni perder. null si el margen no es positivo. */
  units: number | null;
  revenue: number | null;
}

/** Punto de equilibrio de una mezcla. El producto en la posición 0 es el líder. */
export function computeMixBreakeven(input: {
  products: MixProduct[];
  totalFixedCosts: number;
  variableCosts: AppliedVariableCost[];
}): MixBreakevenResult {
  const fixed = Number(input.totalFixedCosts) || 0;
  const products = Array.isArray(input.products) ? input.products : [];
  const leaderQty = Number(products[0]?.qty) || 0;

  const lines: MixProductLine[] = products.map((p) => {
    const priceNoIva = Number(p.priceNoIva) || 0;
    const costNoIva = Number(p.costNoIva) || 0;
    const qty = Number(p.qty) || 0;
    const variablePerUnit = totalVariableCostPerUnit(input.variableCosts, priceNoIva, costNoIva);
    return {
      name: p.name ?? null,
      priceNoIva,
      costNoIva,
      qty,
      // Sin líder cargado la mezcla no tiene referencia: todo queda en 0 y no hay PE.
      ratio: leaderQty > 0 ? qty / leaderQty : 0,
      variablePerUnit,
      contributionPerUnit: priceNoIva - costNoIva - variablePerUnit,
    };
  });

  const weighted = (pick: (l: MixProductLine) => number) => lines.reduce((a, l) => a + l.ratio * pick(l), 0);
  const revenuePerLeaderUnit = weighted((l) => l.priceNoIva);
  const productCostPerLeaderUnit = weighted((l) => l.costNoIva);
  const pctVariablePerLeaderUnit = weighted((l) => l.variablePerUnit);
  const contributionMargin = revenuePerLeaderUnit - productCostPerLeaderUnit - pctVariablePerLeaderUnit;
  const units = contributionMargin > 0 ? fixed / contributionMargin : null;

  return {
    lines,
    leaderQty,
    revenuePerLeaderUnit,
    productCostPerLeaderUnit,
    pctVariablePerLeaderUnit,
    variablePerLeaderUnit: productCostPerLeaderUnit + pctVariablePerLeaderUnit,
    contributionMargin,
    contributionPct: revenuePerLeaderUnit > 0 ? (contributionMargin / revenuePerLeaderUnit) * 100 : 0,
    units,
    revenue: units != null ? units * revenuePerLeaderUnit : null,
  };
}

export interface MixLineAtUnits {
  name: string | null;
  qty: number;
  ratio: number;
  priceNoIva: number;
  /** Costo variable unitario completo: costo del producto + costos variables en %. */
  unitCost: number;
  /** Unidades vendidas de este producto para las unidades de líder dadas. */
  units: number;
  revenue: number;
  variableCost: number;
  contribution: number;
}

/**
 * Cuánto se vende de cada producto —y cuánto factura y cuesta cada uno— para una cantidad dada de
 * unidades del líder. La suma de `revenue` es la facturación total y la de `variableCost` es el
 * costo variable total del escenario.
 */
export function mixLinesAtLeaderUnits(lines: MixProductLine[], leaderUnits: number): MixLineAtUnits[] {
  const u = Number(leaderUnits) || 0;
  return (lines ?? []).map((l) => {
    const units = l.ratio * u;
    const unitCost = l.costNoIva + l.variablePerUnit;
    return {
      name: l.name ?? null,
      qty: l.qty,
      ratio: l.ratio,
      priceNoIva: l.priceNoIva,
      unitCost,
      units,
      revenue: units * l.priceNoIva,
      variableCost: units * unitCost,
      contribution: units * l.contributionPerUnit,
    };
  });
}

/**
 * Cuánto pesa UN costo variable en % por unidad de líder. Se necesita para abrir el desglose del
 * PDF por concepto (Mercado Pago, IIBB…) cuando el % se aplicó a varios productos con precios
 * distintos.
 */
export function mixVariableCostPerLeaderUnit(lines: MixProductLine[], item: AppliedVariableCost): number {
  return (lines ?? []).reduce(
    (acc, l) => acc + l.ratio * variableCostAmount(item, l.priceNoIva, l.costNoIva),
    0,
  );
}
