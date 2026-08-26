/**
 * Punto 7 (ago-26): a que MODULO pertenece cada ruta.
 *
 * Se usa para decidir cuando tirar los filtros guardados: se conservan mientras el
 * usuario se mueva dentro del mismo modulo y se limpian al cambiar de modulo.
 *
 * Las secciones son las mismas del menu lateral (`app-sidebar.tsx`). Si se agrega una
 * pantalla nueva al menu, hay que sumarla aca: en desarrollo, el sidebar avisa por
 * consola si encuentra una ruta del menu que no este mapeada.
 */

export const MODULE_ROUTES: Record<string, string[]> = {
  Catalogos: ["/proveedores", "/rubros", "/sub-rubros", "/locales", "/impuestos", "/unidades"],
  "Facturas y Ctas Ctes": [
    "/facturas",
    "/cuentas-corrientes",
    "/pagos",
    "/facturas/importacion-excel",
    "/facturas/nueva",
    "/facturas/traslados",
    "/facturas/nota-credito/nueva",
  ],
  "Costos y Recetas": [
    "/categorias-recetas",
    "/subcategorias-recetas",
    "/insumos",
    "/recetas",
    "/sub-recetas",
    "/historial-costos",
  ],
  Financiero: [
    "/extractos-efectivo",
    "/extractos",
    "/efectivo",
    "/categorias-movimientos",
    "/grupos-financieros",
    "/balance",
    "/balances-economicos",
    "/cmc",
    "/pap",
    "/valorizar-stock",
    "/cmv",
    "/punto-equilibrio",
    "/ventas-datalive",
    "/decomisos",
    "/ventas-fudo",
    "/ventas-shares",
    "/objetivos-mensuales",
    "/dashboard",
  ],
  Operaciones: ["/stock", "/auditorias", "/empleados", "/asistencia", "/liquidaciones"],
  Configuracion: ["/sociedades", "/equipo", "/permisos", "/notificaciones", "/preferencias"],
};

/** Modulo de una ruta suelta (Inicio, login, etc.): cambia de scope y limpia filtros. */
export const MODULE_OTHER = "__otros__";

const MODULE_BY_ROUTE: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const [moduleName, routes] of Object.entries(MODULE_ROUTES)) {
    for (const route of routes) map[route] = moduleName;
  }
  return map;
})();

/**
 * Devuelve el modulo de una ruta. Las rutas con parametro (`/facturas/123`) resuelven
 * por su prefijo, para que entrar al detalle de una factura y volver al listado no
 * cuente como cambio de modulo.
 */
export function moduleForPath(path: string): string {
  const clean = path.split("?")[0].replace(/\/+$/, "") || "/";
  if (MODULE_BY_ROUTE[clean]) return MODULE_BY_ROUTE[clean];

  // Prefijo mas largo que matchee: /facturas/123 -> /facturas
  let best: string | null = null;
  for (const route of Object.keys(MODULE_BY_ROUTE)) {
    if (clean === route || clean.startsWith(`${route}/`)) {
      if (!best || route.length > best.length) best = route;
    }
  }
  return best ? MODULE_BY_ROUTE[best] : MODULE_OTHER;
}

/** Todas las rutas mapeadas, para el chequeo de consistencia del menu en desarrollo. */
export function mappedRoutes(): Set<string> {
  return new Set(Object.keys(MODULE_BY_ROUTE));
}
