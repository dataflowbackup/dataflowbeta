/**
 * Punto 7 (ago-26): los filtros no se pierden al ir y volver.
 *
 * Regla acordada con el usuario:
 * - Filtras en una pantalla, entras a ver un detalle o pasas a otra pantalla DEL MISMO
 *   modulo y volves: los filtros siguen puestos.
 * - Cambias de MODULO (Financiero -> Facturas y Ctas Ctes, por ejemplo): se limpian todos.
 * - Un F5 no los pierde, pero cerrar la pestana si (viven en sessionStorage).
 *
 * "Modulo" = las secciones del menu lateral. El mapa vive en `nav-modules.ts`.
 *
 * El scope se sincroniza durante el RENDER del guard (no en un efecto) para que la
 * limpieza ocurra antes de que las paginas hijas lean su estado inicial.
 */

const STORAGE_KEY = "dataflow.filters.v1";
const SCOPE_KEY = "dataflow.filters.scope.v1";

type Snapshot = Record<string, unknown>;

function readSession<T>(key: string, fallback: T): T {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    // Pestana privada, storage bloqueado o JSON corrupto: se sigue en memoria.
    return fallback;
  }
}

function writeSession(key: string, value: unknown) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* si no se puede persistir, los filtros igual viven en memoria */
  }
}

let snapshot: Snapshot = readSession<Snapshot>(STORAGE_KEY, {});
let currentScope: string | null = readSession<string | null>(SCOPE_KEY, null);

/** Suscriptores por clave, para que un reset se refleje en las pantallas montadas. */
const listeners = new Map<string, Set<() => void>>();

function notify(key: string) {
  listeners.get(key)?.forEach((fn) => fn());
}

function notifyAll() {
  // Diferido: `syncFilterScope` se llama DURANTE el render del guard, y avisar ahi
  // mismo significaria actualizar componentes en pleno render. Los suscriptores que
  // importan (los de la pantalla nueva) leen el store al montarse, ya limpio.
  queueMicrotask(() => {
    listeners.forEach((set) => set.forEach((fn) => fn()));
  });
}

export function subscribeFilterValue(key: string, listener: () => void): () => void {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(listener);
  return () => {
    set!.delete(listener);
    if (set!.size === 0) listeners.delete(key);
  };
}

export function getFilterValue<T>(key: string, fallback: T): T {
  return key in snapshot ? (snapshot[key] as T) : fallback;
}

export function setFilterValue(key: string, value: unknown) {
  snapshot[key] = value;
  writeSession(STORAGE_KEY, snapshot);
  notify(key);
}

/**
 * Cambia el modulo activo. Si es distinto del anterior, tira TODOS los filtros
 * guardados. Devuelve true si hubo limpieza.
 */
export function syncFilterScope(scope: string): boolean {
  if (currentScope === scope) return false;
  currentScope = scope;
  snapshot = {};
  writeSession(STORAGE_KEY, snapshot);
  writeSession(SCOPE_KEY, scope);
  notifyAll();
  return true;
}

/** Solo para tests/depuracion. */
export function __resetFilterScopeForTests() {
  snapshot = {};
  currentScope = null;
  listeners.clear();
}
