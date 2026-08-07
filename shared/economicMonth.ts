/**
 * Mes Económico (ago-2026).
 *
 * El Balance Financiero mide el flujo de dinero: agrupa por la fecha de acreditación. El Balance
 * Económico mide rentabilidad devengada: agrupa por el mes en que el hecho económico OCURRIÓ, que
 * no siempre es el mes en que la plata se movió (un sueldo de junio pagado el 3 de julio es un
 * gasto económico de junio).
 *
 * Cómo se guarda: `transactions.economic_month` = "YYYY-MM", y **NULL significa "usá el mes de la
 * fecha de acreditación"**. Solo se escribe cuando el usuario lo corrige a mano. Eso evita tener
 * que backfillear decenas de miles de filas en producción, y hace que "este movimiento fue
 * corregido" sea exactamente `economic_month IS NOT NULL` — sin ningún flag extra.
 *
 * Lleva el año además del mes porque el mes económico puede caer en otro año que el de la
 * acreditación (acreditado el 03/01/2026 → económico 2025-12).
 */

export const MONTH_NAMES_ES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
] as const;

/** "YYYY-MM" válido y con mes entre 01 y 12. */
export function isEconomicMonth(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = value.match(/^(\d{4})-(\d{2})$/);
  if (!m) return false;
  const month = parseInt(m[2], 10);
  return month >= 1 && month <= 12;
}

/** Mes "YYYY-MM" de una fecha de acreditación ("YYYY-MM-DD" o Date). */
export function monthOfDate(date: string | Date | null | undefined): string | null {
  if (date == null) return null;
  if (date instanceof Date) {
    if (isNaN(date.getTime())) return null;
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  }
  const s = String(date);
  return /^\d{4}-\d{2}/.test(s) ? s.slice(0, 7) : null;
}

export interface EconomicMonthSource {
  transactionDate: string | Date | null | undefined;
  economicMonth?: string | null;
}

/**
 * El mes económico EFECTIVO de un movimiento: el corregido a mano, o el de su fecha de
 * acreditación. Es la única función que debe usarse para agrupar; nunca leer `economicMonth` suelto,
 * porque NULL no significa "sin mes" sino "el de la acreditación".
 */
export function resolveEconomicMonth(tx: EconomicMonthSource): string | null {
  if (isEconomicMonth(tx.economicMonth)) return tx.economicMonth;
  return monthOfDate(tx.transactionDate);
}

/** true si el mes económico fue corregido a mano y además quedó distinto al de la acreditación. */
export function isEconomicMonthOverridden(tx: EconomicMonthSource): boolean {
  if (!isEconomicMonth(tx.economicMonth)) return false;
  return tx.economicMonth !== monthOfDate(tx.transactionDate);
}

/** "2026-06" → "Junio". Devuelve "" si no es un mes válido. */
export function economicMonthLabel(month: string | null | undefined): string {
  if (!isEconomicMonth(month)) return "";
  return MONTH_NAMES_ES[parseInt(month.slice(5, 7), 10) - 1] ?? "";
}

/** "2026-06" → "Junio 2026". Se usa donde el año importa (tooltips, filtros, PDF). */
export function economicMonthLabelWithYear(month: string | null | undefined): string {
  if (!isEconomicMonth(month)) return "";
  return `${economicMonthLabel(month)} ${month.slice(0, 4)}`;
}

/** Partes numéricas de un "YYYY-MM". */
export function economicMonthParts(month: string | null | undefined): { year: number; month: number } | null {
  if (!isEconomicMonth(month)) return null;
  return { year: parseInt(month.slice(0, 4), 10), month: parseInt(month.slice(5, 7), 10) };
}

/** Construye "YYYY-MM" a partir de año y mes (1-12). */
export function buildEconomicMonth(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/**
 * Meses "YYYY-MM" desde `from` hasta `to`, inclusive. Se usa para armar las opciones del filtro
 * y del selector sin depender de qué meses existan cargados.
 */
export function economicMonthRange(from: string, to: string): string[] {
  const a = economicMonthParts(from);
  const b = economicMonthParts(to);
  if (!a || !b) return [];
  const out: string[] = [];
  let y = a.year;
  let m = a.month;
  // Tope defensivo: 50 años. Evita un bucle infinito si llegan valores dados vuelta.
  for (let guard = 0; guard < 600; guard++) {
    const cur = buildEconomicMonth(y, m);
    out.push(cur);
    if (y > b.year || (y === b.year && m >= b.month)) break;
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}
