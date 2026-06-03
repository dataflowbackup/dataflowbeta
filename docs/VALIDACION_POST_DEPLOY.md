# Plan de validación post-deploy — Cierre módulo financiero (ROADMAP_BETA)

> Fecha: 2026-06-03. Sitio: https://playful-liger-bf4118.netlify.app
> Cada push a `main` deployó automáticamente (Netlify + `db:push:turso` en el build).

---

## 0. Estado REAL de producción ahora mismo (leer primero)

| Cosa | Estado en prod | Nota |
|---|---|---|
| **Código (las 8 fases)** | ✅ **Vivo** | Deployado en cada push |
| **Schema Turso** (column_mapping + 4 tablas nuevas) | ✅ **Aplicado** | El build corre `db:push:turso` (aditivo, sin pérdida de datos) |
| **Fix del balance (Otros Mov. fuera del neto)** | ⏳ **DORMIDO** | Se activa por `specialType`; en prod las categorías aún NO están marcadas → el balance se ve **igual que antes** (Inicio de mes/Otros Ingresos/Retiros todavía suman). **Esto es esperado, no es un bug.** |
| **5 grupos padre (Préstamos/Alivios propios)** | ⏳ **No creados aún** | Se crean al correr la migración |
| **Permisos nuevos** (cmc/pap/cmv/stock_valuation/breakeven/bank.config) | ⏳ **No sembrados** | El `socio` ve y usa todo igual (override); otros roles necesitan Seed + asignación |

**Conclusión:** lo nuevo ya es usable por el **socio**. Lo que falta es ACTIVAR (3 pasos en §3) los cambios que tocan datos. Hasta entonces, lo viejo funciona idéntico.

---

## 1. Regresión — que NO se haya roto lo que andaba (probar como socio)

- [ ] Login entra normal.
- [ ] **Extractos**: la lista de transacciones carga; importar un extracto Galicia/MP/BBVA funciona como antes (los parsers dedicados no cambiaron).
- [ ] **Efectivo**: carga y muestra saldos.
- [ ] **Balances Financieros**: abre y muestra Ventas/Gastos/Utilidad. **Los números deben verse IGUAL que antes del deploy** (el fix está dormido). Si cuadran como siempre → OK.
- [ ] **Facturas / Cuentas Corrientes / Pagos**: listan y se puede crear/ver una factura.
- [ ] **Insumos / Recetas / Historial Costos**: cargan.
- [ ] **Categorías de Movimientos**: lista OK. La columna ahora dice "Especial" (antes "EE.RR."); el dropdown tiene tipos nuevos "(Otros Mov.)". Editar una categoría NO de sistema funciona.
- [ ] **Grupos Financieros**: lista OK. Ahora el botón "Editar" está habilitado en grupos de sistema (solo deja cambiar el nombre).
- [ ] **Permisos / Equipo / Sociedades / Notificaciones**: cargan.
- [ ] **Stock / Auditorías / Empleados**: cargan.

> Cualquier pantalla que tire error 500 o quede en blanco → anotar cuál y avisame.

---

## 2. Funcionalidad nueva — que los avances estén (probar como socio)

En el menú lateral, sección **Financiero**, deben aparecer 5 ítems nuevos:

- [ ] **CMC**: elegir rango de fechas → muestra costo de compras (sin IVA) por Rubro → Sub-Rubro; toggle $ / %. (% sale "—" si no hay ventas cargadas — normal.)
- [ ] **PAP**: muestra "Entregado" (facturas c/IVA) y "Pagado" por proveedor, con saldo.
- [ ] **Valorizar Stock**:
  - [ ] "Exportar planilla" baja un Excel con los insumos.
  - [ ] Cargar cantidades a mano → total en vivo → "Guardar".
  - [ ] "Importar Excel" (la planilla completada) carga cantidades.
  - [ ] La valorización guardada aparece en la lista; "Reversar" la marca reversada.
- [ ] **CMV**: requiere 2 valorizaciones (crearlas en "Valorizar Stock"); elegir inicial/final + fechas → muestra stock ini + compras − stock fin = CMV y CMV%.
- [ ] **Punto de Equilibrio**: elegir un producto (receta) → autocompleta precio/costo sin IVA; cargar gastos fijos por categoría → muestra PE en unidades y facturación; "Guardar".
- [ ] **Extractos → "Mapear banco"**: abre el wizard de banco genérico (subir muestra, asignar columnas, guardar mapeo).

---

## 3. Activación de lo que toca datos (HACER EN ORDEN, con OK del usuario)

> Estos 3 pasos activan el fix del balance, los 5 grupos padre y el acceso por rol. Todo es idempotente y reversible.

### Paso 1 — Sembrar permisos nuevos
- En **Permisos**, apretar el botón de inicializar/seed de permisos (idempotente: solo agrega los que faltan, no pisa nada).
- Resultado: aparecen los módulos nuevos (CMC, PAP, CMV, Valorización, Punto de Equilibrio, Config bancos) para asignar.

### Paso 2 — Asignar permisos por rol
- En **Permisos**, para cada rol (admin/manager/encargado/…) tildar qué módulos nuevos puede ver, según la matriz del ROADMAP_BETA §12.
- (El `socio` ya tiene todo por override.)

### Paso 3 — Migración de "Otros Movimientos" (la que activa el fix del balance)
- Correr **una vez** contra producción:
  ```
  npx tsx script/backfill-special-categories.ts
  ```
  (con `--dry-run` primero para ver el conteo sin escribir).
- Qué hace, por cada empresa: crea los grupos padre **Préstamos** y **Alivios**, mueve el capital de préstamo desde "Otros Ingresos" a "Préstamos", y marca isSpecial/specialType en los grupos Otros Movimientos. **No** toca el interés de préstamo (sigue siendo gasto real). Idempotente.
- **Backup previo recomendado:** `npx tsx script/backup-turso.ts` antes de correrlo.

### Verificación post-activación (Balance)
- [ ] En **Balances Financieros**, ahora la **Utilidad** EXCLUYE Inicio de mes / Otros Ingresos / Préstamos / Retiros.
- [ ] Aparece abajo el bloque **"Otros Movimientos"** con cada grupo y el **"Movimiento neto del período (caja)"** = Utilidad + Otros Movimientos.
- [ ] Los **saldos** de cuentas/extractos NO cambian (siguen incluyendo todo).
- [ ] En **Grupos Financieros** aparecen "Préstamos" y "Alivios".

> Referencia del impacto esperado: en el cliente Quadrifoglio, la utilidad 2026 bajaba de ~+17,77M a -369k al excluir ~18,1M de Inicio de mes/Otros Ingresos (corrección buscada).

---

## 4. Rollback (si algo sale mal)

- **Código:** cada fase es un commit independiente en `main`; se puede `git revert <hash>` y volver a pushear.
- **Migración de datos:** reversible — poner `isSpecial=false`/`specialType=null` en las categorías y volver a mover las de préstamo a "Otros Ingresos". Los grupos Préstamos/Alivios quedan vacíos (no molestan) o se desactivan.
- **Schema:** las columnas/tablas nuevas son aditivas; no hace falta revertirlas (no afectan lo viejo).
