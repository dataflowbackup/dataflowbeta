/**
 * Punto 6 (ago-26): que sistemas de venta usa cada EMPRESA.
 *
 * La preferencia es por cliente, no por usuario: si una empresa no usa Shares, no lo
 * usa nadie de esa empresa. Un sistema apagado desaparece del menu lateral y deja de
 * ofrecerse como origen en Dashboard, Estado de Resultado Economico, CMV, CMC y PAP.
 *
 * Apagar un sistema NO borra ni oculta los datos ya importados: solo deja de ofrecerse
 * como origen. Si se vuelve a encender, todo aparece igual que antes.
 *
 * Siempre tiene que quedar al menos un sistema encendido; de lo contrario esas pantallas
 * se quedarian sin ninguna fuente de ventas para mostrar.
 */

export const SALES_SOURCES = ["fudo", "shares", "datalive"] as const;

export type SalesSourceKey = (typeof SALES_SOURCES)[number];

/** Como se llama cada sistema en pantalla. */
export const SALES_SOURCE_LABELS: Record<SalesSourceKey, string> = {
  fudo: "Fudo",
  shares: "Shares",
  datalive: "Datalive",
};

export type SalesSourcePreferences = Record<SalesSourceKey, boolean>;

/** Sin fila de preferencias guardada valen los tres, que es el comportamiento historico. */
export const DEFAULT_SALES_SOURCE_PREFERENCES: SalesSourcePreferences = {
  fudo: true,
  shares: true,
  datalive: true,
};

/** Normaliza lo que venga de la base (o de un payload) a los tres booleanos. */
export function normalizeSalesSourcePreferences(
  raw: Partial<Record<SalesSourceKey, unknown>> | null | undefined,
): SalesSourcePreferences {
  if (!raw) return { ...DEFAULT_SALES_SOURCE_PREFERENCES };
  const normalized = {} as SalesSourcePreferences;
  for (const key of SALES_SOURCES) {
    const value = raw[key];
    normalized[key] = value === undefined || value === null
      ? DEFAULT_SALES_SOURCE_PREFERENCES[key]
      : Boolean(value);
  }
  return normalized;
}

/** Las claves habilitadas, en el orden fijo de SALES_SOURCES. */
export function enabledSalesSources(prefs: SalesSourcePreferences): SalesSourceKey[] {
  return SALES_SOURCES.filter((key) => prefs[key]);
}

/** Regla dura: no se puede dejar a la empresa sin ningun sistema de ventas. */
export function hasAtLeastOneSalesSource(prefs: SalesSourcePreferences): boolean {
  return enabledSalesSources(prefs).length > 0;
}

/**
 * Elige que origen mostrar cuando el que estaba seleccionado quedo deshabilitado.
 * Devuelve el actual si sigue habilitado; si no, el primero habilitado; si no hay
 * ninguno, el actual (caso imposible por la validacion, pero no rompe la pantalla).
 */
export function resolveSelectedSalesSource<T extends string>(
  current: T,
  enabled: readonly SalesSourceKey[],
  alwaysAllowed: readonly string[] = [],
): T {
  if (alwaysAllowed.includes(current)) return current;
  if ((enabled as readonly string[]).includes(current)) return current;
  return (enabled[0] as unknown as T) ?? current;
}
