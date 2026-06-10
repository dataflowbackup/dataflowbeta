// Helpers de fecha "local-safe": evitan el parseo/formateo en UTC que corre las
// fechas un día (mismo problema que arreglamos en formatDate). Todo se maneja
// como "YYYY-MM-DD" interpretado en horario local.

/** Date (local) -> "YYYY-MM-DD" usando los componentes locales (no UTC). */
export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** "YYYY-MM-DD" -> Date local (medianoche local), sin pasar por UTC. */
export function fromISODate(s: string | null | undefined): Date | undefined {
  if (!s) return undefined;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return undefined;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

export type DateRangeValue = { from: string; to: string };

export interface DatePreset {
  key: string;
  label: string;
  range: () => DateRangeValue;
}

/** Presets de rango ("Hoy", "Ayer", "Últimos 7", "Últimos 30", "Este mes", "Mes pasado"). */
export function getDatePresets(today: Date = new Date()): DatePreset[] {
  // Normalizo a medianoche local.
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const startOfMonth = new Date(t.getFullYear(), t.getMonth(), 1);
  const endOfMonth = new Date(t.getFullYear(), t.getMonth() + 1, 0);
  const startLastMonth = new Date(t.getFullYear(), t.getMonth() - 1, 1);
  const endLastMonth = new Date(t.getFullYear(), t.getMonth(), 0);
  return [
    { key: "hoy", label: "Hoy", range: () => ({ from: toISODate(t), to: toISODate(t) }) },
    {
      key: "ayer",
      label: "Ayer",
      range: () => {
        const y = addDays(t, -1);
        return { from: toISODate(y), to: toISODate(y) };
      },
    },
    { key: "u7", label: "Últimos 7 días", range: () => ({ from: toISODate(addDays(t, -6)), to: toISODate(t) }) },
    { key: "u30", label: "Últimos 30 días", range: () => ({ from: toISODate(addDays(t, -29)), to: toISODate(t) }) },
    { key: "mes", label: "Este mes", range: () => ({ from: toISODate(startOfMonth), to: toISODate(endOfMonth) }) },
    { key: "mesPasado", label: "Mes pasado", range: () => ({ from: toISODate(startLastMonth), to: toISODate(endLastMonth) }) },
  ];
}
