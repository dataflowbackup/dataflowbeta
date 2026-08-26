import { useCallback, useSyncExternalStore } from "react";
import {
  getFilterValue,
  setFilterValue,
  subscribeFilterValue,
} from "@/lib/filter-scope";

/**
 * Punto 7 (ago-26): reemplazo de `useState` para valores de FILTRO.
 *
 * Se usa igual que useState:
 *   const [localId, setLocalId] = usePersistentFilter("extractos.localId", "all");
 *
 * La diferencia es que el valor sobrevive a salir de la pantalla y volver, y a un F5,
 * mientras el usuario siga dentro del mismo modulo. Al cambiar de modulo se limpia todo
 * y el filtro vuelve a su valor por defecto (ver `lib/filter-scope.ts`).
 *
 * La clave tiene que ser unica por pantalla; se usa el prefijo de la pantalla
 * ("extractos.", "facturas.", etc.) para que no choquen entre si.
 *
 * Solo para valores serializables a JSON (strings, numeros, booleanos, arrays y objetos
 * planos). Para un Set o un Map hay que guardar su version en array.
 */
export function usePersistentFilter<T>(
  key: string,
  defaultValue: T,
): [T, (next: T | ((prev: T) => T)) => void] {
  const subscribe = useCallback(
    (listener: () => void) => subscribeFilterValue(key, listener),
    [key],
  );

  const getSnapshot = useCallback(
    () => getFilterValue<T>(key, defaultValue),
    // defaultValue se toma solo cuando no hay nada guardado; no hace falta re-suscribir
    // si cambia de identidad entre renders (arrays/objetos literales).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );

  const value = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const setValue = useCallback(
    (next: T | ((prev: T) => T)) => {
      const resolved =
        typeof next === "function"
          ? (next as (prev: T) => T)(getFilterValue<T>(key, defaultValue))
          : next;
      setFilterValue(key, resolved);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );

  return [value, setValue];
}
