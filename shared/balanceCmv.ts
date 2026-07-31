/**
 * Costo de Mercadería (CMV) aplicado al Balance Financiero.
 *
 * Por qué existe: el balance se arma con lo PAGADO en el período. Si en un mes no se le paga a los
 * proveedores, el gasto de mercadería baja y la rentabilidad sale inflada aunque la mercadería se
 * haya consumido igual. En modo CMV los grupos marcados como mercadería dejan de computar en la
 * utilidad y su lugar lo toma el CMV calculado: un criterio devengado, independiente de si se pagó.
 *
 * Regla del importe: se toma el CMV% del cálculo guardado, TAL CUAL quedó guardado, y se lo lleva a
 * pesos contra la FACTURACIÓN DEL BALANCE de ese local ("pasar el % a económico"), no el CMV en
 * pesos original. Así todas las líneas del estado de resultados quedan sobre el mismo denominador.
 *
 * Sobre el IVA: `computeCmv` calcula el % contra `ventaNeta = ivaIncluded ? bruto : bruto / 1.21`,
 * así que un CMV guardado sin "IVA incluido" tiene el % medido contra una base más chica. Aun así
 * el balance usa ese porcentaje sin convertirlo: es el CMV% que el usuario calculó y validó para el
 * local, y es el que quiere ver aplicado sobre la facturación (decisión explícita, 31-jul-2026).
 * Los cálculos hechos sin IVA quedan igualmente identificados en la fila, como referencia.
 */

import { pickCmvForMonth, type CmvPeriodLike, type CmvMonthMatch } from "./cmvMonthMatch";

export interface CmvCalculationLike extends CmvPeriodLike {
  cmv?: string | number | null;
  ventaNeta?: string | number | null;
  cmvPct?: string | number | null;
  salesSource?: string | null;
  ivaIncluded?: boolean | null;
}

export interface CmvBalanceRow {
  localId: number;
  /** CMV% tal cual se guardó. Es el que se aplica sobre la facturación del balance. */
  pct: number;
  /** true si ese CMV se calculó sin IVA incluido (informativo: no cambia el importe). */
  computedWithoutIva: boolean;
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

/** CMV% que se asienta en el balance: el guardado, sin convertir. */
export function balanceCmvPct(cmv: CmvCalculationLike): number {
  return toNum(cmv.cmvPct);
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
    const pct = balanceCmvPct(c);
    rows.push({
      localId,
      pct,
      computedWithoutIva: !c.ivaIncluded,
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
