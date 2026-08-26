import { useQuery } from "@tanstack/react-query";
import {
  DEFAULT_SALES_SOURCE_PREFERENCES,
  SALES_SOURCES,
  SALES_SOURCE_LABELS,
  enabledSalesSources,
  normalizeSalesSourcePreferences,
  type SalesSourceKey,
  type SalesSourcePreferences,
} from "@shared/salesSources";

export const SALES_SOURCES_QUERY_KEY = "/api/preferences/sales-sources";

/**
 * Punto 6 (ago-26): que sistemas de venta tiene habilitados la empresa.
 *
 * Mientras carga se devuelven los tres habilitados (el default historico), para que
 * ninguna pantalla parpadee ocultando opciones que despues vuelven a aparecer.
 *
 * `options` sirve directo para pintar selectores de origen.
 */
export function useSalesSources() {
  const { data, isLoading } = useQuery<SalesSourcePreferences>({
    queryKey: [SALES_SOURCES_QUERY_KEY],
    staleTime: 5 * 60_000,
  });

  const preferences = data
    ? normalizeSalesSourcePreferences(data)
    : { ...DEFAULT_SALES_SOURCE_PREFERENCES };

  const enabled = enabledSalesSources(preferences);

  return {
    isLoading,
    preferences,
    /** Claves habilitadas, en orden fijo: fudo, shares, datalive. */
    enabled,
    isEnabled: (source: string): boolean =>
      (SALES_SOURCES as readonly string[]).includes(source)
        ? preferences[source as SalesSourceKey]
        : true,
    options: enabled.map((key) => ({ value: key, label: SALES_SOURCE_LABELS[key] })),
  };
}
