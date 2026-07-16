/**
 * Elección del CMV que se asienta en el balance de un mes.
 *
 * Se toma el CMV cuyo período MÁS SE PARECE al mes calendario, no el más reciente que lo roce:
 * con "el más reciente solapado", un CMV semanal (29/6 → 5/7) le ganaba a uno mensual y se
 * mostraba como si fuera el CMV del mes.
 *
 * Regla: cada extremo del período debe caer dentro de CMV_TOLERANCE_DAYS del inicio y del fin
 * del mes. Así "1 al 30" y "1 al 1 del mes siguiente" cuentan como mes completo, mientras que
 * quincenas, semanales y períodos de dos meses quedan afuera. Entre los que pasan gana el más
 * parecido (menor desvío total) y, a igualdad, el más nuevo.
 */

/** Días que puede desviarse cada extremo de un CMV respecto del mes para asentarlo en el balance. */
export const CMV_TOLERANCE_DAYS = 3;

export interface CmvPeriodLike {
  id?: number | null;
  localId?: number | null;
  periodFrom?: string | Date | null;
  periodTo?: string | Date | null;
}

export interface CmvMonthMatch<T extends CmvPeriodLike> {
  /** El CMV que representa el mes, o null si ninguno lo cubre. */
  matched: T | null;
  /** CMV que se solapan con el mes pero no lo representan (para explicar por qué no se asienta). */
  nearby: T[];
}

const DAY_MS = 86400000;

function parseDay(v: string | Date | null | undefined): number {
  if (v == null) return NaN;
  const s = v instanceof Date ? v.toISOString() : String(v);
  return Date.parse(`${s.slice(0, 10)}T00:00:00Z`);
}

function daysApart(a: number, b: number): number {
  return Math.abs(Math.round((a - b) / DAY_MS));
}

/**
 * @param year  año del balance
 * @param month mes del balance (1-12)
 */
export function pickCmvForMonth<T extends CmvPeriodLike>(
  cmvList: T[],
  localId: number,
  year: number,
  month: number,
  toleranceDays: number = CMV_TOLERANCE_DAYS,
): CmvMonthMatch<T> {
  if (!Number.isFinite(year) || !Number.isFinite(month)) return { matched: null, nearby: [] };

  const mm = String(month).padStart(2, "0");
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const firstMs = Date.parse(`${year}-${mm}-01T00:00:00Z`);
  const lastMs = Date.parse(`${year}-${mm}-${String(lastDay).padStart(2, "0")}T00:00:00Z`);

  const scored: Array<{ c: T; score: number }> = [];
  const nearby: T[] = [];

  for (const c of cmvList) {
    if (c.localId !== localId) continue;
    const fromMs = parseDay(c.periodFrom);
    const toMs = parseDay(c.periodTo);
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) continue;

    const dFrom = daysApart(fromMs, firstMs);
    const dTo = daysApart(toMs, lastMs);
    if (dFrom <= toleranceDays && dTo <= toleranceDays) {
      scored.push({ c, score: dFrom + dTo });
    } else if (fromMs <= lastMs && toMs >= firstMs) {
      nearby.push(c);
    }
  }

  if (scored.length === 0) return { matched: null, nearby };
  scored.sort((a, b) => a.score - b.score || (b.c.id ?? 0) - (a.c.id ?? 0));
  return { matched: scored[0].c, nearby };
}
