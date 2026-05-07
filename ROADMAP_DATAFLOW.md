# Roadmap y mapa del sistema Data Flow

**Última actualización:** 2026-05-07  
**Alcance:** producto completo según código en repo (`client/`, `server/`, `shared/schema.ts`). Este archivo sustituye la versión que cubría solo extractos; conviene **mantenerlo al día** tras cambios de alcance.

**Otros documentos del repo:** `ANALISIS_EXHAUSTIVO_DATA_FLOW.md`, `PLAN_DE_ACCION_DATA_FLOW.md`, `AVANCES_PARA_SOCIOS.md`, `docs/NETLIFY-TURSO.md`, `docs/WORKFLOW.md` (complementarios; pueden quedar desfasados respecto al código).

---

## 1. Cómo usar y mantener este roadmap

- Tras **features o fixes relevantes**: actualizar la sección del **módulo** tocado + §8 (historial / cambios recientes).
- Antes de **cambios riesgosos en base de datos** (Turso prod, migraciones, seeds): seguir **§12.0** (backup completo + tag Git) y anotar en §8 qué archivos generaste.
- Si aparece un **bug recurrente**: §9 “Fallas” con fecha y workaround.
- El **histórico de negocio** anterior a lo que el código muestra hoy no está en el repo: no inventar fechas; marcar como *inferido* o *pendiente validar con equipo*.
- **Turso / backups:** toda la receta (credenciales `env.turso`, dump sin CLI, frecuencia) está en **§12.3**; no depender solo de la memoria del chat.

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
- **Mercado Pago — líneas por fila Excel** (`MercadoPagoParser.parse`): hasta **tres** líneas contables por fila cuando los importes son distintos de cero: (1) **bruto** columna **H** (descripción **E**, segunda línea **P** medio de pago, fecha **A**, sucursal **X** si aplica); (2) **comisión** columna **J** como egreso con descripción fija **«Comisión Mercado Pago»**; (3) **retención IIBB** columna **M** con texto de **Q** (detalle impuestos). Si la suma algebraica de esas líneas no cierra al neto de la fila (**F − G**, acreditado menos debitado), se agrega una cuarta línea de **ajuste** para cuadrar al centavo. Los importes se omiten si el monto correspondiente es 0.
- **Mercado Pago — conciliación antes de persistir:** se compara el **«Saldo disponible total»** leído del pie del Excel con **`sumNetImportable`** (suma algebraica de ingresos y egresos de todas las líneas generadas, incluidos ajustes). Si no cuadra → respuesta `reconciliationRequired` con `sumNetImportable`, `sumGrossImportable` (sólo suma de **H** en filas con línea bruta, informativo) y hasta **10 filas** candidatas para inspección. El diálogo en `bank-statements.tsx` es **referencial** (sin overrides que cambien la suma neta: corregir el archivo y reimportar). La respuesta exitosa incluye `mpDiagnostics` (saldo del archivo, suma neta y suma de brutos) en el toast.
- **Mercado Pago — pie («Dinero disponible total»):** la lectura del total prioriza la celda de **neto acreditado (F)** cuando está disponible, para no confundir la fila de totales con el **bruto (H)**.
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
| **2026-05-07 — MP desglose ×3 + comisión fija + conciliación neta** | Parser: hasta líneas bruto (**H**), comisión (**J**, descripción fija «Comisión Mercado Pago»), IIBB (**M**/**Q**), más **ajuste** si no cierra a **F−G**. Import: conciliación `sumNetImportable` vs «Saldo disponible total»; `mpDiagnostics` con neto y brutos; panel UI referencial (sin overrides que alteren la suma neta). |
| 2026-05-07 — Iteraciones previas MP bruto en 0 | Commits `f6f833a` y `2288fe4`: primero se expusieron filas con bruto = 0 como candidatas en el panel de conciliación, luego se forzó el panel siempre que hubiera filas sospechosas y se agregó diagnóstico `mpDiagnostics` en respuesta exitosa. Reemplazados por el fallback F−G. |
| Extractos MP/Galicia | Parsers, multipart, purge por lotes, paginación GET, orden estable `fecha+id`, dedupe cliente |
| MP conciliación por suma | «Saldo disponible total» vs **suma neta** de líneas importables (± ajustes); UI referencial; `mpDiagnostics` con neto y brutos |
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
| Conciliación MP | Overrides de bruto vía multipart ya no resuelven descuadre neto (el ajuste por fila absorbe H); usar archivo corregido o investigar omisiones/duplicados |
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
- **Backups Turso / DR:** mantener viva la receta en §12; opcional: automatizar recordatorio o job (CI / calendario) para `script/backup-turso.ts` + copia de `backups/turso_*.sql` a almacenamiento externo acordado con el equipo.

---

## 11. Cómo seguir ampliando este roadmap

1. Cada nuevo **módulo** o **flujo crítico**: añadir fila en §5 + endpoint en §6 si aplica.
2. Cada **release**: párrafo en §8 con versión/fecha.
3. Mantener **una línea** en §9 cuando se cierre un bug grande (mover a "resuelto" con fecha).
4. Antes de cambios de esquema o "pruebas drásticas": ejecutar el **checklist §12.0** (incluye Turso + tag Git) y anotar una línea en §8.

---

## 12. Procedimiento de backup (DBs + git)

**Este apartado es la referencia única** para no volver a perderse con Turso, credenciales o dónde quedan los archivos. Antes de `db:push:turso`, migraciones manuales, `npm run seed:bootstrap` contra prod, o **cualquier prueba drástica**, seguir el **checklist §12.0**.

> Última ejecución documentada en roadmap: **2026-05-07** (ver §8).

### 12.0 Checklist completo (orden recomendado)

Hacer todo en la **misma sesión**, con el repo limpio (`git status` sin sorpresas salvo lo que vas a tocar):

| Paso | Qué | Dónde / comando |
|------|-----|------------------|
| 1 | **Código en punto conocido** | `git pull`, commit de trabajo en curso si aplica |
| 2 | **Tag de Git** (punto de retorno del código) | §12.4 — `git tag -a "backup-pre-<motivo>-YYYY-MM-DD"` + `git push origin --tags` |
| 3 | **Postgres local** (si usás `DATABASE_URL=postgresql://...` en `.env`) | §12.1 — `pg_dump` → `backups/dataflow_dev_*.sql` |
| 4 | **SQLite legacy** (si existe `data/dev.db` y lo usás) | §12.2 — copia física a `backups/` |
| 5 | **Turso (producción / misma DB que Netlify)** | §12.3 — `env.turso` + `npx tsx script/backup-turso.ts` |
| 6 | **Registrar en §8** | Fecha, motivo, nombres de archivos generados (1 línea basta) |

**Recordatorios críticos**

- **Turso no requiere Turso CLI** en esta máquina: el dump oficial del proyecto es `script/backup-turso.ts` + `@libsql/client/web`.
- **`env.turso` no existe en el repo:** hay que crearlo en la raíz copiando valores desde **Netlify** → Site settings → Environment variables (`DATABASE_URL` tipo `libsql://...` y `TURSO_AUTH_TOKEN`). Está en `.gitignore`; **nunca** commitear ese archivo.
- Los archivos en `backups/*.sql` y `backups/*.dump` están en **`.gitignore`**: quedan solo en tu disco / backup corporativo. Si necesitás guardarlos en otro lado (NAS, OneDrive fuera del repo), copiarlos manualmente después del paso 5.
- **Opción extra (Turso):** en el panel de Turso se puede crear un **branch / snapshot** de la base como segunda red de seguridad; no sustituye el `.sql` local si querés portabilidad, pero ayuda a restaurar en la misma plataforma.

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

### 12.3 Turso (producción) — backup SQL local

**Objetivo:** tener un archivo `.sql` reproducible con DDL + datos, misma base que usa **Netlify en prod** (no un branch de prueba).

#### 12.3.1 Preparar credenciales (una vez por máquina / cuando roten el token)

1. Netlify → tu sitio → **Site configuration** → **Environment variables**.
2. Copiar **tal cual** (sin espacios al final):
   - `DATABASE_URL` → debe empezar con `libsql://`
   - `TURSO_AUTH_TOKEN` → token JWT largo
3. En la **raíz del repo** crear el archivo **`env.turso`** (sin punto; ya está en `.gitignore`):

```env
DATABASE_URL=libsql://<host-exacto-de-netlify>.turso.io
TURSO_AUTH_TOKEN=<token-exacto-de-netlify>
DB_PROVIDER=turso
```

4. **Validar** (opcional): `npm run turso:diag` — debe conectar a la URL remota, no a `file:./data/dev.db`. Si el diagnóstico muestra SQLite local, **no** llegaste a Turso: revisá que `drizzle.config.turso.ts` cargue `env.turso` (ya está cableado en el proyecto).

#### 12.3.2 Ejecutar el dump

Desde la raíz del proyecto:

```bash
npx tsx script/backup-turso.ts
```

Salida esperada: `backups/turso_<YYYY-MM-DD_HHmmss>.sql` (varios MB si hay muchas transacciones). El script imprime conteo de tablas y filas.

#### 12.3.3 Qué contiene el archivo

- `PRAGMA` + `BEGIN/COMMIT`
- `CREATE TABLE` / `CREATE INDEX` leídos de `sqlite_master` (DDL alineado a la base real)
- `INSERT INTO ...` por cada fila (paginado internamente en lotes de 1000)

**Restauración:** no está automatizada en repo; en un incidente se puede crear una base nueva en Turso / LibSQL y ejecutar el SQL con un cliente compatible, o adaptar un script one-off. Guardar el `.sql` en medio confiable (fuera del repo si la política lo exige).

#### 12.3.4 Problemas frecuentes

| Síntoma | Causa probable | Qué hacer |
|---------|----------------|-----------|
| `401` / conexión rechazada | Token viejo o URL de **otra** base | Regenerar token en Turso para **esa** DB; pegar de nuevo en `env.turso` y Netlify si hace falta |
| Dump vacío o pocas tablas | Apuntás a un branch distinto a prod | Verificar en Netlify qué `DATABASE_URL` usa el sitio en producción y que `env.turso` coincida |
| Script no encuentra credenciales | Falta `env.turso` o está mal nombrado | Debe llamarse exactamente `env.turso` en la raíz (no solo `.env`) |

#### 12.3.5 Frecuencia sugerida (agenda)

| Momento | Acción |
|---------|--------|
| Antes de `db:push:turso`, migraciones manuales o seeds en prod | Dump Turso (§12.3.2) + tag Git (§12.4) |
| Antes de releases grandes / refactors BD | Igual |
| Rutina (opcional) | Semanal o mensual — según criterio del equipo — y copiar `backups/turso_*.sql` a almacenamiento externo si hace falta |

### 12.4 Git tag de seguridad

```powershell
$d = Get-Date -Format "yyyy-MM-dd"
git tag -a "backup-pre-<motivo>-$d" -m "Snapshot antes de <motivo>"
git push origin --tags
```

Para restaurar el código a ese punto: `git reset --hard <tag>`.

---

*Documento generado a partir del análisis del repositorio; las fechas de negocio anteriores al código disponible deben completarse por el equipo.*
