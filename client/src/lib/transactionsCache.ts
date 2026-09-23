import { queryClient } from "./queryClient";

/**
 * Parcheo local del cache de movimientos tras una accion masiva.
 *
 * El listado de Extractos y el de Efectivo se traen TODOS los movimientos del cliente paginando de
 * a 800 (sep-2026: 159.337 movimientos = ~200 requests encadenadas). Invalidar la query despues de
 * cada masiva obligaba a rehacer esas ~200 requests aunque el lote hubieran sido 18 movimientos:
 * la masiva respondia en milisegundos y la espera real era la recarga.
 *
 * Como el servidor ya devuelve exactamente que ids toco (`updatedIds` / `deletedIds`), alcanza con
 * parchear en memoria esas filas. No se duplica el criterio de la masiva del lado del cliente: la
 * lista de ids es la del servidor, que es la autoridad.
 *
 * Alcanza a las dos queries de movimientos (`["/api/transactions"]` y `["/api/transactions",
 * "cash"]`), igual que hacia el `invalidateQueries` que reemplaza.
 */
const TRANSACTIONS_KEY = ["/api/transactions"] as const;

type FilaConId = { id: number };

/** Aplica `patch` a las filas cuyo id esta en `ids`, en todas las listas de movimientos cacheadas. */
export function patchTransactionsInCache<T extends FilaConId>(
  ids: number[],
  patch: (fila: T) => T,
): void {
  if (ids.length === 0) return;
  const alcanzados = new Set(ids);
  queryClient.setQueriesData({ queryKey: TRANSACTIONS_KEY }, (old: unknown) => {
    if (!Array.isArray(old)) return old;
    let cambio = false;
    const next = (old as T[]).map((fila) => {
      if (fila == null || !alcanzados.has(fila.id)) return fila;
      cambio = true;
      return patch(fila);
    });
    return cambio ? next : old;
  });
}

/** Saca del cache las filas borradas. */
export function removeTransactionsFromCache(ids: number[]): void {
  if (ids.length === 0) return;
  const borrados = new Set(ids);
  queryClient.setQueriesData({ queryKey: TRANSACTIONS_KEY }, (old: unknown) => {
    if (!Array.isArray(old)) return old;
    const next = (old as FilaConId[]).filter((fila) => fila == null || !borrados.has(fila.id));
    return next.length === (old as unknown[]).length ? old : next;
  });
}

/**
 * Red de seguridad: si el servidor no mando los ids (version vieja de la funcion todavia
 * desplegada, o una respuesta inesperada), se vuelve al comportamiento anterior. Lento, pero
 * nunca deja la pantalla mostrando datos viejos.
 */
export function invalidateTransactions(): void {
  queryClient.invalidateQueries({ queryKey: TRANSACTIONS_KEY });
}

/** Los ids que devolvio el servidor, o `null` si no vinieron. */
export function idsDeLaRespuesta(respuesta: any, campo: "updatedIds" | "deletedIds"): number[] | null {
  const ids = respuesta?.[campo];
  if (!Array.isArray(ids)) return null;
  const limpios = ids.filter((n: unknown) => typeof n === "number" && Number.isFinite(n));
  return limpios.length === ids.length ? limpios : null;
}
