/**
 * Desvío de mercadería: la ecuación, como función pura.
 *
 *   Stock inicial + Compras + Traslados recibidos − Traslados enviados
 *     − Consumo teórico − Decomisos = Stock final TEÓRICO
 *
 *   Desvío = Stock final CONTADO − Stock final teórico
 *
 * Negativo es mercadería que se fue sin registrarse (merma, robo, porciones de más, receta mal
 * cargada). Positivo casi siempre es un problema de carga, no una buena noticia.
 *
 * Todo se mide en la unidad del insumo: el sistema no convierte unidades, así que lo que entra
 * por factura y lo que sale por receta ya son comparables.
 */

/** Lo que se pudo juntar para un insumo en un período. `null` en los conteos = no se contó. */
export interface DeviationInput {
  supplyId: number;
  openingQty: number | null;
  purchases: number;
  transfersIn: number;
  transfersOut: number;
  consumption: number;
  decomisos: number;
  closingQty: number | null;
  /** Costo de reposición para valorizar. */
  unitCost: number;
}

export interface DeviationRow {
  id: number;
  supplyId: number;
  supplyName: string;
  unit: string | null;
  openingQty: number;
  purchases: number;
  transfersIn: number;
  transfersOut: number;
  consumption: number;
  decomisos: number;
  theoreticalClosing: number;
  actualClosing: number;
  deviationQty: number;
  unitCost: number;
  deviationAmount: number;
  /**
   * Cuánto representa el desvío sobre lo que pasó por el insumo (inicial + compras + traslados
   * recibidos). Es la forma honesta de comparar un insumo caro con uno barato.
   */
  deviationPct: number | null;
  /** true sólo si el insumo se contó en LOS DOS inventarios: ahí el número es medición. */
  measured: boolean;
  missingOpening: boolean;
  missingClosing: boolean;
}

export interface DeviationSummary {
  /** Desvío de los insumos contados en ambas puntas: el número en el que se puede confiar. */
  measuredAmount: number;
  /** Desvío de los que tuvieron algún conteo faltante, donde el stock ausente se tomó como cero. */
  assumedAmount: number;
  /** measured + assumed. Es el total completo, pero mezcla medición con supuesto. */
  totalAmount: number;
  measuredCount: number;
  assumedCount: number;
  /** Desvío medido sobre el consumo teórico del período. */
  deviationOverConsumptionPct: number | null;
  consumptionAmount: number;
  purchasesAmount: number;
  decomisosAmount: number;
  /** Lo que más pesa, ya filtrado por tolerancia y ordenado por plata. */
  worstOffenders: DeviationRow[];
}

/** Redondeo a 4 decimales: evita que la coma flotante invente desvíos de 0,0000001. */
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export function computeDeviationRows(
  inputs: DeviationInput[],
  meta: Map<number, { name: string; unit: string | null }>,
): DeviationRow[] {
  const rows: DeviationRow[] = [];

  for (const i of inputs) {
    const openingQty = i.openingQty ?? 0;
    const actualClosing = i.closingQty ?? 0;

    const theoreticalClosing = round4(
      openingQty + i.purchases + i.transfersIn - i.transfersOut - i.consumption - i.decomisos,
    );
    const deviationQty = round4(actualClosing - theoreticalClosing);
    const throughput = openingQty + i.purchases + i.transfersIn;
    const info = meta.get(i.supplyId);

    rows.push({
      id: i.supplyId,
      supplyId: i.supplyId,
      supplyName: info?.name ?? "(insumo eliminado)",
      unit: info?.unit ?? null,
      openingQty: round4(openingQty),
      purchases: round4(i.purchases),
      transfersIn: round4(i.transfersIn),
      transfersOut: round4(i.transfersOut),
      consumption: round4(i.consumption),
      decomisos: round4(i.decomisos),
      theoreticalClosing,
      actualClosing: round4(actualClosing),
      deviationQty,
      unitCost: i.unitCost,
      deviationAmount: round4(deviationQty * i.unitCost),
      deviationPct: throughput > 0 ? (deviationQty / throughput) * 100 : null,
      measured: i.openingQty != null && i.closingQty != null,
      missingOpening: i.openingQty == null,
      missingClosing: i.closingQty == null,
    });
  }

  // El que más plata mueve primero, sin importar el signo: un sobrante grande también es un problema.
  rows.sort((a, b) => Math.abs(b.deviationAmount) - Math.abs(a.deviationAmount));
  return rows;
}

/**
 * Resumen del período. `tolerancePct` sólo filtra qué se muestra como "a mirar": los totales
 * siempre se calculan sobre todo, para que la plata no dependa de dónde se puso el umbral.
 */
export function summarizeDeviation(rows: DeviationRow[], tolerancePct = 0): DeviationSummary {
  let measuredAmount = 0;
  let assumedAmount = 0;
  let measuredCount = 0;
  let assumedCount = 0;
  let consumptionAmount = 0;
  let purchasesAmount = 0;
  let decomisosAmount = 0;

  for (const r of rows) {
    if (r.measured) {
      measuredAmount += r.deviationAmount;
      measuredCount++;
    } else {
      assumedAmount += r.deviationAmount;
      assumedCount++;
    }
    consumptionAmount += r.consumption * r.unitCost;
    purchasesAmount += r.purchases * r.unitCost;
    decomisosAmount += r.decomisos * r.unitCost;
  }

  const worstOffenders = rows.filter(
    (r) => r.measured && r.deviationPct != null && Math.abs(r.deviationPct) >= tolerancePct && r.deviationAmount !== 0,
  );

  return {
    measuredAmount: round4(measuredAmount),
    assumedAmount: round4(assumedAmount),
    totalAmount: round4(measuredAmount + assumedAmount),
    measuredCount,
    assumedCount,
    consumptionAmount: round4(consumptionAmount),
    purchasesAmount: round4(purchasesAmount),
    decomisosAmount: round4(decomisosAmount),
    deviationOverConsumptionPct:
      consumptionAmount > 0 ? (measuredAmount / consumptionAmount) * 100 : null,
    worstOffenders,
  };
}

/** Un período de desvío: entre dos inventarios consecutivos del mismo local. */
export interface DeviationPeriod {
  localId: number | null;
  localName: string | null;
  openingValuationId: number;
  openingDate: string;
  closingValuationId: number;
  closingDate: string;
  /** Días entre conteos: sirve para detectar saltos raros (un período de 45 días no es semanal). */
  days: number;
}

export interface DeviationResult {
  period: DeviationPeriod;
  /**
   * Movimientos contados: desde el día SIGUIENTE al inventario de apertura hasta el día del
   * inventario de cierre, inclusive. Es decir, el conteo refleja el estado al cierre de su día.
   */
  movementsFrom: string;
  movementsTo: string;
  rows: DeviationRow[];
  summary: DeviationSummary;
  /** Cobertura del mapeo producto→receta: sin esto el consumo teórico está incompleto. */
  unitsSold: number;
  unitsWithRecipe: number;
  coveragePct: number | null;
  /** Sub-recetas contadas que se explotaron a insumos, para poder explicarlo en pantalla. */
  subRecipesExploded: Array<{ subRecipeId: number; name: string; openingQty: number; closingQty: number }>;
  source: string;
}
