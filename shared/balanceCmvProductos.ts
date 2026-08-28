/**
 * CMV Productos aplicado al Estado de Resultado Económico.
 *
 * Hermano de `balanceCmv.ts`, para el otro camino del costo: mientras aquel sale de
 * stock inicial + compras − stock final, éste sale de Σ (cantidad vendida × costo del producto).
 *
 * Usa EL MISMO criterio de importe que el CMV por stock (decisión del 28-ago-2026): se toma el
 * CMV% guardado y se lo lleva a pesos contra la facturación del balance de ese local, no los pesos
 * originales del cálculo. Es lo único que hace que la resta entre los dos CMV signifique algo: si
 * uno fuera "% aplicado" y el otro "pesos crudos", la diferencia mezclaría dos denominadores y no
 * mediría desvío de costeo sino desvío de bases.
 *
 * La COBERTURA manda. Un CMV Productos con 51% de las unidades sin costo asignado tiene un % bajo
 * por construcción, y su diferencia contra el CMV real parecería un desvío enorme cuando en verdad
 * son costos sin cargar. Por eso la cobertura viaja en cada fila y se reporta aparte: sin eso, la
 * comparación miente.
 */

import { pickCmvForMonth, type CmvPeriodLike, type CmvMonthMatch } from "./cmvMonthMatch";

/** Cobertura mínima para tratar un CMV Productos como comparable sin advertencia. */
export const CMV_PRODUCTOS_MIN_COVERAGE = 95;

export interface CmvProductoCalculationLike extends CmvPeriodLike {
  source?: string | null;
  cmvPct?: string | number | null;
  cmvTeorico?: string | number | null;
  ventaReal?: string | number | null;
  coberturaPct?: string | number | null;
  unidades?: number | null;
  unidadesConCosto?: number | null;
  ivaIncluded?: boolean | null;
}

export interface CmvProductoBalanceRow {
  localId: number;
  /** CMV% teórico tal cual se guardó; es el que se aplica sobre la facturación del balance. */
  pct: number;
  /** Ventas del balance de ese local en el mes. */
  ventas: number;
  /** Costo teórico en pesos que entra al balance: pct × ventas del balance. */
  cmvAmount: number;
  /** % de las unidades vendidas que tenían costo asignado. null = el cálculo no lo guardó. */
  coberturaPct: number | null;
  /** true si la cobertura no llega al mínimo: el % está subvaluado y la comparación no es limpia. */
  lowCoverage: boolean;
  /** Pesos y venta base del cálculo original (informativos: son de otra base). */
  cmvTeoricoReal: number;
  ventaBase: number;
  source: string;
  calcId: number | null;
  periodFrom: string;
  periodTo: string;
}

export interface CmvProductoBalanceMissing {
  localId: number;
  ventas: number;
  nearby: CmvProductoCalculationLike[];
}

export interface CmvProductoBalanceResult {
  rows: CmvProductoBalanceRow[];
  missing: CmvProductoBalanceMissing[];
  totalCmv: number;
  ventasConCmv: number;
  ventasSinCmv: number;
  hasMissing: boolean;
  /** Locales cuyo CMV Productos tiene cobertura baja: su aporte al total está subvaluado. */
  lowCoverageRows: CmvProductoBalanceRow[];
}

const toNum = (v: unknown): number => {
  const n = parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
};

const toNumOrNull = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
};

/**
 * Resuelve el CMV Productos del mes para cada local y lo pasa a pesos contra las ventas del
 * balance. Igual que con el CMV por stock, los locales sin cálculo NO se completan con otro
 * criterio: quedan en `missing` para que el hueco se vea.
 */
export function buildCmvProductosForBalance(
  list: CmvProductoCalculationLike[],
  localIds: number[],
  year: number,
  month: number,
  ventasByLocal: Record<number, number>,
): CmvProductoBalanceResult {
  const rows: CmvProductoBalanceRow[] = [];
  const missing: CmvProductoBalanceMissing[] = [];

  for (const localId of localIds) {
    const ventas = ventasByLocal[localId] ?? 0;
    const match: CmvMonthMatch<CmvProductoCalculationLike> = pickCmvForMonth(list, localId, year, month);

    if (!match.matched) {
      missing.push({ localId, ventas, nearby: match.nearby });
      continue;
    }

    const c = match.matched;
    const pct = toNum(c.cmvPct);
    const coberturaPct = toNumOrNull(c.coberturaPct);
    rows.push({
      localId,
      pct,
      ventas,
      cmvAmount: (pct / 100) * ventas,
      coberturaPct,
      lowCoverage: coberturaPct != null && coberturaPct < CMV_PRODUCTOS_MIN_COVERAGE,
      cmvTeoricoReal: toNum(c.cmvTeorico),
      ventaBase: toNum(c.ventaReal),
      source: String(c.source ?? "fudo"),
      calcId: c.id ?? null,
      periodFrom: String(c.periodFrom ?? "").slice(0, 10),
      periodTo: String(c.periodTo ?? "").slice(0, 10),
    });
  }

  const totalCmv = rows.reduce((s, r) => s + r.cmvAmount, 0);
  const ventasConCmv = rows.reduce((s, r) => s + r.ventas, 0);
  const ventasSinCmv = missing.reduce((s, m) => s + m.ventas, 0);

  return {
    rows,
    missing,
    totalCmv,
    ventasConCmv,
    ventasSinCmv,
    hasMissing: missing.length > 0,
    lowCoverageRows: rows.filter((r) => r.lowCoverage),
  };
}

export interface CmvComparisonLocal {
  localId: number;
  /** CMV real % (stock) y teórico % del local. null si le falta alguno de los dos. */
  pctReal: number | null;
  pctTeorico: number | null;
  montoReal: number;
  montoTeorico: number;
  /** real − teórico. Positivo = se consumió más de lo que el costeo explica. */
  difPp: number | null;
  difMonto: number | null;
  coberturaPct: number | null;
}

export interface CmvComparison {
  /** Locales con LOS DOS cálculos: son los únicos donde la diferencia significa algo. */
  locals: CmvComparisonLocal[];
  totalReal: number;
  totalTeorico: number;
  /** Diferencia en pesos, solo sobre los locales comparables. */
  difMonto: number;
  /** Diferencia en puntos, ponderada por las ventas de los locales comparables. */
  difPp: number | null;
  /** Ventas de los locales comparables: el denominador de difPp. */
  ventasComparables: number;
  /** Locales que tienen uno de los dos CMV pero no el otro: quedan fuera de la comparación. */
  soloReal: number[];
  soloTeorico: number[];
  /** true si algún local comparado tiene cobertura baja: la diferencia está inflada. */
  hasLowCoverage: boolean;
}

/**
 * Diferencia CMV real (stock) vs CMV Productos (teórico), por local y total.
 *
 * Solo se comparan los locales que tienen LOS DOS cálculos del mes. Cruzar el CMV real de un local
 * contra el teórico de otro daría un número sin sentido, y sumar un lado sin el otro haría aparecer
 * un desvío que es en realidad un cálculo faltante.
 */
export function compareCmvVsProductos(
  realRows: Array<{ localId: number; pct: number; cmvAmount: number; ventas: number }>,
  teoricoRows: CmvProductoBalanceRow[],
): CmvComparison {
  const realByLocal = new Map(realRows.map((r) => [r.localId, r]));
  const teoByLocal = new Map(teoricoRows.map((r) => [r.localId, r]));

  const locals: CmvComparisonLocal[] = [];
  let totalReal = 0;
  let totalTeorico = 0;
  let ventasComparables = 0;
  let hasLowCoverage = false;

  for (const [localId, real] of realByLocal) {
    const teo = teoByLocal.get(localId);
    if (!teo) continue;
    totalReal += real.cmvAmount;
    totalTeorico += teo.cmvAmount;
    ventasComparables += real.ventas;
    if (teo.lowCoverage) hasLowCoverage = true;
    locals.push({
      localId,
      pctReal: real.pct,
      pctTeorico: teo.pct,
      montoReal: real.cmvAmount,
      montoTeorico: teo.cmvAmount,
      difPp: real.pct - teo.pct,
      difMonto: real.cmvAmount - teo.cmvAmount,
      coberturaPct: teo.coberturaPct,
    });
  }

  const soloReal = realRows.filter((r) => !teoByLocal.has(r.localId)).map((r) => r.localId);
  const soloTeorico = teoricoRows.filter((r) => !realByLocal.has(r.localId)).map((r) => r.localId);

  return {
    locals: locals.sort((a, b) => (b.difMonto ?? 0) - (a.difMonto ?? 0)),
    totalReal,
    totalTeorico,
    difMonto: totalReal - totalTeorico,
    // Ponderada por ventas: promediar los % de locales de tamaños distintos daría un número falso.
    difPp: ventasComparables > 0 ? ((totalReal - totalTeorico) / ventasComparables) * 100 : null,
    ventasComparables,
    soloReal,
    soloTeorico,
    hasLowCoverage,
  };
}
