# Roadmap y mapa del sistema Data Flow

**Última actualización:** 2026-05-07  
**Alcance:** producto completo según código en repo (`client/`, `server/`, `shared/schema.ts`). Este archivo sustituye la versión que cubría solo extractos; conviene **mantenerlo al día** tras cambios de alcance.

**Otros documentos del repo:** `ANALISIS_EXHAUSTIVO_DATA_FLOW.md`, `PLAN_DE_ACCION_DATA_FLOW.md`, `AVANCES_PARA_SOCIOS.md`, `docs/NETLIFY-TURSO.md`, `docs/WORKFLOW.md` (complementarios; pueden quedar desfasados respecto al código).

---

## 1. Cómo usar y mantener este roadmap

- Tras **features o fixes relevantes**: actualizar la sección del **módulo** tocado + §12 “Cambios recientes”.
- Si aparece un **bug recurrente**: §11 “Riesgos / deuda” con fecha y workaround.
- El **histórico de negocio** anterior a lo que el código muestra hoy no está en el repo: no inventar fechas; marcar como *inferido* o *pendiente validar con equipo*.

---

## 2. Stack técnico

| Capa | Tecnología |
|------|------------|
| Frontend | React (Vite), Wouter, TanStack Query, UI (Radix/shadcn) |
| Backend | Express; registro de rutas en `server/routes.ts` |
| Datos | Drizzle ORM; esquema en `shared/schema.ts` (SQLite/Turso en prod) |
| Auth | Sesiones + usuario (`users`, `user_credentials`); multi-tenant por `clientId` |
| Deploy | Netlify + función serverless API (ver `docs/NETLIFY-TURSO.md`) |

---

## 3. Navegación del producto (UI)

Rutas definidas en `client/src/App.tsx`. Menú lateral en `client/src/components/app-sidebar.tsx` (secciones **Catálogos**, **Facturación**, **Costos y Recetas**, **Financiero**, **Operaciones**, **Configuración**).

| Ruta | Página | Rol resumido |
|------|--------|----------------|
| `/` | Home | Entrada |
| `/proveedores` | Proveedores | ABM proveedores; import/export Excel |
| `/rubros`, `/sub-rubros` | Rubros / Sub-rubros | Clasificación de compras; import/export |
| `/locales` | Locales | Sucursales / puntos de operación |
| `/impuestos` | Impuestos | Catálogo; seed Argentina |
| `/unidades` | Unidades | Unidades de medida |
| `/insumos` | Insumos | Materias primas; vínculo precios por proveedor; import/export |
| `/facturas`, `/facturas/nueva`, `/facturas/:id` | Facturas | Compras a proveedores; ítems e impuestos |
| `/cuentas-corrientes` | Cuentas corrientes | Estado proveedores (saldo, facturas, pagos) |
| `/pagos` | Pagos | Registro de pagos y aplicaciones |
| `/categorias-recetas`, `/subcategorias-recetas` | Categorías carta | Árbol para recetas |
| `/recetas`, `/recetas/nueva`, `/recetas/:id` | Carta (recetas) | Platos/productos con ingredientes y costos |
| `/sub-recetas` | Sub-recetas | Recetas tipo intermedio para reutilizar |
| `/historial-costos` | Historial costos | Evolución de costos calculados |
| `/extractos` | Extractos bancarios | Import Excel bancos, categorización, lotes |
| `/categorias-movimientos` | Categorías mov. | Clasificación financiera de transacciones |
| `/grupos-financieros` | Grupos financieros | Agrupadores para reporting |
| `/balance` | Balances financieros | Vista de balances (mensualidades vía API) |
| `/dashboard` | Dashboard | Estadísticas agregadas |
| `/stock` | Control stock | Niveles, movimientos, ajustes |
| `/auditorias` | Auditorías | Plantillas y auditorías operativas |
| `/empleados` | Empleados | Fichas de personal |
| `/asistencia` | Asistencia | Registro asistencia |
| `/liquidaciones` | Liquidaciones | Nómina / liquidaciones |
| `/permisos` | Permisos | Roles y permisos por módulo |
| `/notificaciones` | Notificaciones | Centro de avisos |
| `/sociedades` | Sociedades | Razones sociales (business names) |
| `/equipo` | Equipo | Usuarios del cliente; invitaciones (`/join`) |

**Nota:** En sidebar, `SHOW_OPERACIONES_SIDEBAR = false` oculta la sección **Operaciones** hasta activarla en código (stock/auditorías/empleados/asistencia/liquidaciones siguen existiendo por URL si se conocen).

---

## 4. Modelo multi-tenant y acceso

- **`clients`**: empresa / organización.
- **`user_clients`**: usuario ↔ cliente con rol string legacy.
- **`roles`**, **`permissions`**, **`role_permissions`**: permisos granulares por código (`audits.view`, etc.); seed en rutas.
- **`user_localAssignments`**: alcance por local (donde aplica).
- **`client_invitations`**, flujo **`/join`**: invitaciones al equipo.
- API **`/api/auth/user`**, **`/api/auth/organization`**, equipo **`/api/team/users`**, **`/api/team/reassign`**.

---

## 5. Módulos funcionales (contraste con código)

### 5.1 Catálogos de compras

- **Proveedores** (`suppliers`): CRUD; Excel import/export.
- **Rubros / Sub-rubros**: jerarquía para clasificar; import/export.
- **Locales**: sedes; opcional vínculo razón social (`businessNames`).
- **Impuestos**: CRUD; **`/api/taxes/seed-argentina`**.
- **Unidades de medida**: CRUD.

**Relaciones:** proveedor ↔ rubros permitidos (`supplier_rubros`); insumo ↔ proveedores y precios (`supply_suppliers`).

### 5.2 Insumos (`supplies`)

- CRUD, último costo, costo unitario para recetas, import/export Excel.
- **`/api/supplies/:id/usages`**: dónde se usa el insumo (recetas, etc.).
- Cambios de costo disparan **recálculo de recetas** (ver §5.5).

### 5.3 Facturación de compras

- **Facturas** (`invoices`, `invoice_items`, `invoice_taxes`): alta, lectura, borrado, **`reverse`** (NC/anulación lógica).
- **Pagos** (`payments`, `payment_allocations`): pagos a proveedores y distribución.
- **Cuentas corrientes**: agregación **`/api/supplier-accounts`** y export.

### 5.4 Carta, recetas y costos (“fórmulas internas”)

- **Categorías y subcategorías** de recetas (árbol carta).
- **Recetas** (`recipes`): tipo plato vs sub-receta (`recipeType`), `usefulYield`, costo total, foto (`/api/recipes/:id/photo`).
- **Ingredientes** (`recipe_ingredients`): cantidad total; **insumo** (`supplyId`) **o** **sub-receta** (`subRecipeId`) — composición anidada.
- **Motor de costos** en `server/storage.ts`: `recalculateAllRecipeCostsForClient`, `collectRecipeIdsForSupplyCostChange`:
  - Costo unitario insumo: prioriza costo de última compra agregada, luego `lastCost`, luego `unitCost` (CPP).
  - Sub-recetas: recursivo; costo unitario según costo total y rendimiento útil.
  - Propaga cambios hacia **recetas padre** que usan una sub-receta afectada.
- **Historial de costos** (`cost_history`): registro de snapshots para consulta en UI.
- **Export** de recetas y estadísticas (`/api/recipes/export`, `/api/recipes/stats`).
- **Category groups** (`category_groups`): agrupación para reporting de carta.

### 5.5 Financiero (más allá de extractos)

- **Grupos financieros** (`financial_groups`): CRUD + seed.
- **Categorías de transacciones** (`transaction_categories`): ingreso/gasto/ambos; uso en extractos.
- **Bancos del cliente** (`client_banks`): catálogo de entidades para cuentas.
- **Cuentas bancarias / cajas** (`bank_accounts`): con `bankId` de parser, razón social, local; purge de importaciones.
- **Transacciones** (`transactions`): movimientos manuales e importados; categoría, local, cuenta, contrapartes, splits (`parent_transaction_id`).
- ** counterparties + identifiers**: agenda para matcheo / CRM liviano.
- **Balances mensuales** (`monthly_balances`): API `GET /api/monthly-balances`.
- **Vistas guardadas** extractos: `financial_saved_views` per usuario.
- **Seed financiero**: `POST /api/financial-groups/seed` y datos semilla vía `seedFinancialDataForClient` (según ruta).

### 5.6 Extractos bancarios (detalle de evolución reciente)

> Trabajo intensivo en sesiones recientes; funcionalidad crítica para conciliación.

- Import **`POST /api/transactions/import`**: parsers Galicia, Mercado Pago, BBVA, Francés, genérico (`server/bankParsers.ts`).
- Multipart + fallback query (`pickMultipartOrQueryString`).
- Resolución **`bankId`**: override → cuenta → inferencia nombre cuenta → generic.
- **Mercado Pago — fórmula del net por fila** (`MercadoPagoParser.parse`):
  - Caso normal (H ≠ 0): `net = H − J − M` (**MONTO BRUTO − Comisión MP − Retenciones IIBB**), preservando el desglose contable que se guarda en `grossAmount`, `commission`, `taxWithholding`.
  - Caso especial (H = 0 y F o G ≠ 0): **fallback `net = F − G`** (**MONTO NETO ACREDITADO − MONTO NETO DEBITADO**). Cubre filas tipo "Devolución de dinero" / "reserve_for_dispute" / débitos por mediación donde MP no llena el bruto pero la fila SÍ mueve saldo. H, J, M se siguen guardando tal cual el Excel.
  - Caso descarte: H = F = G = 0 → fila omitida (no es un movimiento real).
- **Mercado Pago — conciliación por suma:** "Saldo disponible total" del Excel vs suma de **MONTO BRUTO** de filas importables; si no cuadra → respuesta `reconciliationRequired` + hasta **10 filas** para corregir brutos (`mpGrossOverrides`) sin persistir hasta cuadrar. La respuesta exitosa MP incluye también `mpDiagnostics` (saldo del archivo + suma de brutos) que se imprime en el toast.
- Detección de saldo en archivo: texto ES/EN, números formato AR, fila siguiente si la de etiqueta no trae monto.
- Continuidad de saldos entre extractos misma cuenta (omitible con flag).
- Listados paginados **`GET /api/transactions`** con orden estable **`fecha DESC, id DESC`** (fix movimientos "invisibles" con miles de fechas iguales).
- Purge por cuenta en lotes anti-504.
- UI: `bank-statements.tsx` — tabs banco, filtros, categorización masiva, diálogo conciliación MP.

### 5.7 Stock

- **`stock_levels`**, **`stock_movements`**, **`stock_adjustments`**: APIs bajo `/api/stock-*`.

### 5.8 RRHH

- **Empleados** (`employees`): CRUD completo.
- **Asistencias** (`attendances`): registro y edición.
- **Liquidaciones** (`payrolls` si está en schema — rutas `/api/payrolls`): generación/gestión.

### 5.9 Auditorías operativas

- **Plantillas** (`audit_templates`, `audit_template_items`): CRUD.
- **Auditorías** (`operational_audits`, `audit_results`): crear con resultados, completar, permisos `audits.*`.

### 5.10 Dashboard

- **`/api/dashboard/stats`**: agrega métricas (incl. referencias a ventas anuales en código de stats).

### 5.11 Notificaciones

- **`/api/notifications`**: listado, crear, marcar leída.

### 5.12 Permisos

- **`/api/permissions`**, **`/api/permissions/seed`**: catálogo y asignación a roles; integración con UI `/permisos`.

---

## 6. Superficie API (referencia rápida)

Casi todo el contrato REST está en **`server/routes.ts`** (miles de líneas). Listado no exhaustivo pero orientativo:

- Auth: `health`, `auth/user`, `auth/organization`
- Locales y aliases
- Proveedores, rubros, sub-rubros (import/export)
- Impuestos, unidades
- Insumos (import/export), supply-suppliers, supplier-rubros
- Facturas (stats, reverse), pagos
- Supplier-accounts (export)
- Recetas (export, stats, foto, parent-usages), cost-history, category-groups
- Financial groups (seed), client-banks, transaction-categories, bank-accounts (purge-imports)
- Financial saved views
- Transactions (paginado), import, batch delete, batch-categorize, split…
- Business names, counterparties + identifiers
- Monthly balances
- Dashboard stats
- Permissions + seed
- Notifications
- Stock levels / movements / adjustments
- Audit templates, operational audits
- Employees, attendances, payrolls
- Team users, reassign

*(Para implementar algo nuevo, buscar primero en `routes.ts` el prefijo `/api/...`.)*

---

## 7. Entidades principales (`shared/schema.ts`)

Tablas representativas (no lista completa): `sessions`, `users`, `user_credentials`, `roles`, `clients`, `user_clients`, `client_invitations`, `business_names`, `locals`, `rubros`, `sub_rubros`, `units_of_measure`, `suppliers`, `taxes`, `supply_suppliers`, `supplier_rubros`, `supplies`, `invoices`, `invoice_items`, `invoice_taxes`, `payments`, `payment_allocations`, `recipe_categories`, `recipe_subcategories`, `recipes`, `recipe_ingredients`, `cost_history`, `category_groups`, `financial_groups`, `transaction_categories`, `client_banks`, `bank_accounts`, `counterparties`, `counterparty_identifiers`, `financial_import_batches`, `financial_saved_views`, `transactions`, `monthly_balances`, `sales`, `permissions`, `role_permissions`, `user_local_assignments`, `notifications`, `stock_movements`, `stock_levels`, `stock_adjustments`, `operational_audits`, `audit_templates`, `audit_template_items`, `audit_results`, `employees`, …

---

## 8. Historial de trabajo reciente (extractos + transversal)

**Nota:** Lo siguiente mezcla **commits conocidos del chat** y **evolución funcional**; no es historial comercial completo del negocio.

| Periodo / tema | Qué se hizo |
|----------------|-------------|
| **2026-05-07 — Parser MP fallback F−G** | Fix definitivo del descuadre de extractos `reserve-release`: cuando H (MONTO BRUTO) = 0 y F/G aportan importes, se usa `net = F − G` para no perder filas tipo "Devolución de dinero". H, J, M se guardan tal cual. Eliminado el panel intermedio "Bruto en 0" (ya no necesario). Verificado al centavo contra Excel real (3.566 movimientos, saldo $4.365.492,34). Commit: `aa82ca3`. Tag de seguridad creado: `backup-pre-pruebas-drasticas-2026-05-07`. |
| 2026-05-07 — Iteraciones previas MP bruto en 0 | Commits `f6f833a` y `2288fe4`: primero se expusieron filas con bruto = 0 como candidatas en el panel de conciliación, luego se forzó el panel siempre que hubiera filas sospechosas y se agregó diagnóstico `mpDiagnostics` en respuesta exitosa. Reemplazados por el fallback F−G. |
| Extractos MP/Galicia | Parsers, multipart, purge por lotes, paginación GET, orden estable `fecha+id`, dedupe cliente |
| MP conciliación por suma | Saldo disponible total vs suma brutos; UI pausa; overrides por fila Excel; parse AR; etiquetas ES/EN |
| Identidad movimientos | `bankId` cuenta + inferencia nombre + envío desde cliente |

### Backups y red de seguridad (2026-05-07)

Antes de iniciar pruebas drásticas se generaron:

| Origen | Archivo / referencia |
|--------|----------------------|
| Postgres local `dataflow_dev` | `backups/dataflow_dev_2026-05-07_113451.sql` (612 KB, vía `pg_dump`) |
| SQLite legacy `data/dev.db` | `backups/dev.db.backup-2026-05-07_113508.db` (369 KB) |
| Turso producción (`dataflow-db-mbeduzzi`) | `backups/turso_2026-05-07_114409.sql` (5,4 MB, 9.762 filas, 55 tablas) |
| Git tag | `backup-pre-pruebas-drasticas-2026-05-07` (apunta a commit `aa82ca3`, pusheado al remoto) |

El backup de Turso se generó con **`script/backup-turso.ts`** (ver §13). Requiere `env.turso` con `DATABASE_URL` y `TURSO_AUTH_TOKEN` (archivo en `.gitignore`).

---

## 9. Fallas y limitaciones conocidas (vivo)

### Resueltas

| Fecha | Problema | Solución |
|-------|----------|----------|
| 2026-05-07 | MP `reserve-release`: filas con H=0 que aportan al saldo (ej. devolución de comisión) eran descartadas → saldo final $5.352,48 menor al real | Fallback `net = F − G` en parser cuando H=0 y F/G ≠ 0 (commit `aa82ca3`) |

### Abiertas

| Área | Problema |
|------|-----------|
| Conciliación MP | Si el Excel no trae fila reconocible para "saldo disponible total", import 400 |
| Conciliación MP | Descuadre por filas fuera de las 10 candidatas puede exigir segunda iteración manual |
| Sidebar | Sección Operaciones oculta por flag hasta activar |
| Tooling | Posibles errores TypeScript globales no resueltos |
| Docs legacy | Otros `.md` pueden contradecir el código actual |

---

## 10. Pendientes sugeridos (backlog)

- Documentar **fórmulas de dashboard** y origen de cada KPI en `dashboard/stats`.
- Inventario de **permisos** vs pantallas (matriz rol ↔ ruta).
- **Ventas** (`sales`): tabla existe; revisar flujo UI si aún no hay página dedicada.
- Ampliar **tests automáticos** en módulos críticos (costos, extractos).
- Revisar **payroll/attendance** frente a schema real en prod.

---

## 11. Cómo seguir ampliando este roadmap

1. Cada nuevo **módulo** o **flujo crítico**: añadir fila en §5 + endpoint en §6 si aplica.
2. Cada **release**: párrafo en §8 con versión/fecha.
3. Mantener **una línea** en §9 cuando se cierre un bug grande (mover a "resuelto" con fecha).
4. Antes de cambios de esquema o "pruebas drásticas": ejecutar el procedimiento de backup §12 y dejar **un git tag** apuntando al commit "punto seguro".

---

## 12. Procedimiento de backup (DBs + git)

> Última ejecución: **2026-05-07** (ver §8 para el detalle de archivos generados).

### 12.1 Postgres local de desarrollo

`pg_dump` está en `C:\Program Files\PostgreSQL\18\bin\` (también hay 15). El servidor escucha en `localhost:5433`, base `dataflow_dev`, user `postgres`.

```powershell
$ts = Get-Date -Format "yyyy-MM-dd_HHmmss"
$env:PGPASSWORD = '<password-postgres-local>'
& 'C:\Program Files\PostgreSQL\18\bin\pg_dump.exe' -h localhost -p 5433 -U postgres -d dataflow_dev -F p -f "backups/dataflow_dev_$ts.sql"
$env:PGPASSWORD = ''
```

### 12.2 SQLite legacy (`data/dev.db`)

```powershell
$ts = Get-Date -Format "yyyy-MM-dd_HHmmss"
Copy-Item "data/dev.db" "backups/dev.db.backup-$ts.db"
```

### 12.3 Turso (producción)

Requiere `env.turso` en la raíz del repo (no commiteado, está en `.gitignore`):

```env
DATABASE_URL=libsql://<host>.turso.io
TURSO_AUTH_TOKEN=<token>
DB_PROVIDER=turso
```

Las credenciales se sacan de Netlify → Site settings → Environment variables. Después:

```bash
npx tsx script/backup-turso.ts
```

Genera `backups/turso_<YYYY-MM-DD_HHmmss>.sql` con DDL completa (CREATE TABLE/INDEX desde `sqlite_master`) + INSERTs de todas las filas, en una transacción. Usa `@libsql/client/web` (sin necesidad de Turso CLI).

### 12.4 Git tag de seguridad

```powershell
$d = Get-Date -Format "yyyy-MM-dd"
git tag -a "backup-pre-<motivo>-$d" -m "Snapshot antes de <motivo>"
git push origin --tags
```

Para restaurar el código a ese punto: `git reset --hard <tag>`.

---

*Documento generado a partir del análisis del repositorio; las fechas de negocio anteriores al código disponible deben completarse por el equipo.*
