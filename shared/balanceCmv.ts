/**
 * Costo de Mercadería (CMV) aplicado al Balance Financiero.
 *
 * Por qué existe: el balance se arma con lo PAGADO en el período. Si en un mes no se le paga a los
 * proveedores, el gasto de mercadería baja y la rentabilidad sale inflada aunque la mercadería se
 * haya consumido igual. En modo CMV los grupos marcados como mercadería dejan de computar en la
 * utilidad y su lugar lo toma el CMV calculado: un criterio devengado, independiente de si se pagó.
 *
 * Regla del importe: se toma el CMV% del cálculo guardado y se lo lleva a pesos contra la
 * FACTURACIÓN DEL BALANCE de ese local ("pasar el % a económico"), no el CMV en pesos original.
 * Así todas las líneas del estado de resultados quedan sobre el mismo denominador.
 *
 * Bases de IVA: `computeCmv` calcula el % contra `ventaNeta = ivaIncluded ? bruto : bruto / 1.21`.
 * Las ventas del balance vienen de extractos, o sea brutas. Un CMV guardado SIN "IVA incluido"
 * tiene el % medido contra una base más chica, así que su porcentaje es ~21% más alto y sumarlo
 * crudo al resto inflaría el costo. Se normaliza a base bruta antes de usarlo (y se marca la fila).
 */

import { pickCmvForMonth, type CmvPeriodLike, type CmvMonthMatch } from "./cmvMonthMatch";

/** Mismo 21% que usa `computeCmv` para pasar de venta bruta a venta neta. */
export const IVA_FACTOR = 1.21;

export interface CmvCalculationLike extends CmvPeriodLike {
  cmv?: string | number | null;
  ventaNeta?: string | number | null;
  cmvPct?: string | number | null;
  salesSource?: string | null;
  ivaIncluded?: boolean | null;
}

export interface CmvBalanceRow {
  localId: number;
  /** CMV% ya normalizado a base bruta (comparable con las ventas del balance). */
  pct: number;
  /** % tal cual quedó guardado (para explicar el ajuste cuando hubo que normalizar). */
  rawPct: number;
  /** true si el CMV se guardó sin IVA incluido y hubo que llevar el % a base bruta. */
  ivaAdjusted: boolean;
  /** Ventas del balance de ese local en el mes. */
  ventas: number;
  /** Costo de mercadería en pesos que entra al balance: pct × ventas del balance. */
  cmvAmount: number;
  /** CMV en pesos del cálculo original y su venta base (informativos: son de otra fuente de ventas). */
  cmvReal: number;
  ventaBase: number;
  salesSource: string;
  cmvId: number | null;
  periodFrom: string;
  periodTo: string;
}

export interface CmvBalanceMissing {
  localId: number;
  /** Ventas del balance de ese local: quedan en el total sin costo de mercadería que las respalde. */
  ventas: number;
  /** CMV que tocan el mes pero no lo representan (para explicar por qué no se asienta). */
  nearby: CmvCalculationLike[];
}

export interface CmvBalanceResult {
  rows: CmvBalanceRow[];
  missing: CmvBalanceMissing[];
  /** Suma de los CMV en pesos de los locales que sí tienen cálculo. */
  totalCmv: number;
  /** Ventas del balance respaldadas por un CMV. */
  ventasConCmv: number;
  /** Ventas del balance de los locales SIN CMV: la porción del total que queda sin costo. */
  ventasSinCmv: number;
  /** true si algún local de la selección no tiene CMV del mes: el total no es confiable. */
  hasMissing: boolean;
}

const toNum = (v: unknown): number => {
  const n = parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
};

/**
 * CMV% llevado a base de venta BRUTA, que es la de las ventas del balance.
 * Guardado con IVA incluido → ya está sobre el bruto. Guardado sin IVA → el denominador era
 * bruto/1.21, así que el % se divide por 1.21 para volver a la misma base.
 */
export function normalizedCmvPct(cmv: CmvCalculationLike): { pct: number; rawPct: number; adjusted: boolean } {
  const rawPct = toNum(cmv.cmvPct);
  const adjusted = !cmv.ivaIncluded;
  return { pct: adjusted ? rawPct / IVA_FACTOR : rawPct, rawPct, adjusted };
}

/**
 * Resuelve el CMV del mes para cada local de la selección y lo pasa a pesos contra las ventas
 * del balance de ese local. Los locales sin CMV NO se completan con lo pagado: quedan afuera y
 * se reportan en `missing` (decisión del usuario: mostrar el hueco, no taparlo con otro criterio).
 *
 * @param ventasByLocal ventas del balance del mes, por localId
 */
export function buildCmvForBalance(
  cmvList: CmvCalculationLike[],
  localIds: number[],
  year: number,
  month: number,
  ventasByLocal: Record<number, number>,
): CmvBalanceResult {
  const rows: CmvBalanceRow[] = [];
  const missing: CmvBalanceMissing[] = [];

  for (const localId of localIds) {
    const ventas = ventasByLocal[localId] ?? 0;
    const match: CmvMonthMatch<CmvCalculationLike> = pickCmvForMonth(cmvList, localId, year, month);

    if (!match.matched) {
      missing.push({ localId, ventas, nearby: match.nearby });
      continue;
    }

    const c = match.matched;
    const { pct, rawPct, adjusted } = normalizedCmvPct(c);
    rows.push({
      localId,
      pct,
      rawPct,
      ivaAdjusted: adjusted,
      ventas,
      cmvAmount: (pct / 100) * ventas,
      cmvReal: toNum(c.cmv),
      ventaBase: toNum(c.ventaNeta),
      salesSource: String(c.salesSource ?? "extractos"),
      cmvId: c.id ?? null,
      periodFrom: String(c.periodFrom ?? "").slice(0, 10),
      periodTo: String(c.periodTo ?? "").slice(0, 10),
    });
  }

  const totalCmv = rows.reduce((s, r) => s + r.cmvAmount, 0);
  const ventasConCmv = rows.reduce((s, r) => s + r.ventas, 0);
  const ventasSinCmv = missing.reduce((s, m) => s + m.ventas, 0);

  return { rows, missing, totalCmv, ventasConCmv, ventasSinCmv, hasMissing: missing.length > 0 };
}
