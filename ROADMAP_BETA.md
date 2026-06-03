# ROADMAP_BETA — Cierre del Módulo Financiero de DataFlow

> **Estado:** Plan de acción técnico. **No contiene código de módulos**: define estructura de datos, archivos afectados, salvaguardas financieras y acople al RBAC existente.
> **Fecha:** 2026-06-03
> **Regla de despliegue:** Ningún cambio aprobado se sube a producción hasta que se haga el commit a GitHub. Cada fase termina con commit revisable.

---

## 0. Contexto e infraestructura confirmada (auditoría de reconocimiento)

### 0.1 Base de datos real

| Aspecto | Hallazgo |
|---|---|
| **Motor en producción** | **libSQL / Turso** (dialecto **SQLite**), conectado vía `@libsql/client/web` — `server/db.ts:74-86` |
| **ORM** | Drizzle ORM + `drizzle-zod`; migraciones con `drizzle-kit push` (`drizzle.config.turso.ts`, `drizzle.config.local.ts`) |
| **Schema** | Todo `shared/schema.ts` usa `sqliteTable`. Hay una capa de compatibilidad en la cabecera (`schema.ts:13-30`): `pgTable→sqliteTable`, `decimal→real`, `boolean→integer{mode:boolean}`, `timestamp→integer{mode:timestamp_ms}`, `jsonb→text{mode:json}`, `serial→integer autoincrement`, `date→text`. **El código "parece Postgres" pero físicamente es SQLite.** |
| **Fallback multi-driver** | `db.ts` también soporta Postgres TCP (`pg`, Railway) y Neon serverless, según `DATABASE_URL`/`DB_PROVIDER`. Local: SQLite `file:` o Postgres. |
| **Multi-tenant** | Raíz `clients`. Casi toda tabla lleva `clientId` con `onDelete: cascade`. Aislamiento en runtime con `getClientId(req)` — `server/routes.ts:166`. |

**Regla dura para tablas nuevas:** declararlas en `shared/schema.ts` con los **helpers existentes** (`real` para importes, `integer{mode:timestamp_ms}` para fechas/horas, `text` para fechas calendario `YYYY-MM-DD`, `serial` para PK, `clientId` + cascade). **Prohibido** usar tipos Postgres nativos (`numeric`, `jsonb` real, `serial` PG). Importes monetarios siempre `real` (= `decimal` aliasado), coherente con `transactions.amount`, `invoices.total`, etc.

### 0.2 Sistema RBAC confirmado (3 capas)

| Capa | Estado | Ubicación |
|---|---|---|
| **1. Autenticación** | ✅ Operativa | `isAuthenticated` = sesión propia (passport-local) + fallback OIDC Replit — `server/routes.ts:278` |
| **2. Rol por tenant** | ✅ Operativa | `userClients.role`; gate `assertTeamPrivileged()` restringe a `socio/admin/manager` — `routes.ts:205-230` |
| **3. Permisos granulares (módulo × ver/crear/editar/borrar)** | ⚠️ **Definidos y administrables por UI, pero el backend NO los valida** | Tablas `permissions`/`rolePermissions`; seed `routes.ts:3332-3386`; UI `client/src/pages/permissions.tsx` |

- **Roles** (`TEAM_ROLES`, `routes.ts:249`): `socio`, `admin`, `manager`, `encargado`, `employee`, `viewer`.
- **Privilegiados** (gestión de equipo): `socio`, `admin`, `manager`.
- **Brecha crítica:** hoy un endpoint financiero solo exige `isAuthenticated` + `clientId`; **no existe `requirePermission`**. El frontend tampoco filtra menú por permiso.
- **Decisión tomada:** la Fase 0 construye el middleware `requirePermission` faltante y siembra los permisos nuevos, gateando por rol. Cierra la brecha de raíz.

### 0.3 El bug del balance (confirmado en código)

- `getBalanceSpreadsheet()` (`server/storage.ts:~2455-2476`) suma/resta **solo** por `transactions.type` (`income`/`expense`); `transfer` se ignora.
- `transactionCategories` **ya tiene** `isSpecial` y `specialType` (`schema.ts:628-630`) **pero NUNCA se setean en el seed ni se leen en ningún cálculo** (verificado: 0 usos en `server/` y `shared/`).
- El seed crea **"Inicio de Mes" con `type:"income"`** (`server/seedFinancialData.ts:7,59`) → se computa como Venta y **infla el resultado**. Igual con Retiros / Préstamos / Otros Ingresos.
- **Decisión tomada:** activar los campos `isSpecial`/`specialType` ya existentes (sin migración de schema) y filtrarlos en el balance.

---

## 1. Principios transversales (aplican a TODAS las fases)

### 1.1 Salvaguardas de la lógica financiera actual
1. **No tocar la fórmula base del balance** salvo para *excluir* los movimientos especiales. El net sigue siendo `income − expense`.
2. **Criterio de IVA por sub-módulo, documentado y constante** (ver §11): CMC y CMV cruzan contra venta **sin IVA** (`venta / 1.21`); PAP cruza contra venta **con IVA**. Nunca mezclar criterios dentro de un mismo reporte.
3. **Idempotencia y reversibilidad:** toda nueva carga (stock, factura, importación) debe poder revertirse sin corromper saldos (seguir el patrón `reversedAt`/`status` de `invoices`).
4. **Test de no-regresión del balance** (§13) corre antes y después de cada fase: con un dataset fijo, el balance neto no debe cambiar excepto por la corrección intencional de Fase 1.
5. **Multi-tenant siempre:** toda query nueva filtra por `clientId` resuelto con `getClientId(req)`. Toda tabla nueva lleva `clientId` + cascade.

### 1.2 Acople al RBAC (patrón obligatorio para todo endpoint nuevo)
- Backend: `app.METHOD(path, isAuthenticated, requirePermission("<code>", "<accion>"), handler)`.
- `requirePermission(code, action)` (a construir en Fase 0) resuelve rol del usuario en el cliente (`storage.getUserRoleInClient`), busca en `rolePermissions` el flag correspondiente (`canView`/`canCreate`/`canEdit`/`canDelete`) y responde 403 si falta. `socio` siempre pasa (override).
- Frontend: hook `usePermissions()` (a construir en Fase 0) para ocultar pantallas/botones del sidebar y de cada página según el permiso.

### 1.3 Convenciones de datos
- Importes: `real` (decimal), redondeo a 2 decimales en la capa de cálculo (reusar `roundMoney2` de `shared/invoiceTaxComputation.ts`).
- Cantidades/costos unitarios: `real` con 4 decimales (coherente con `supplies.unitCost`).
- Fechas calendario: `text` `YYYY-MM-DD` (como `invoices.invoiceDate`, `transactions.transactionDate`).
- Timestamps de auditoría: `integer{mode:timestamp_ms}` con `defaultNow()`.

---

## 2. FASE 0 — Fundaciones transversales (habilitadora, sin features visibles)

**Objetivo:** dejar listas las dos piezas que el resto de las fases necesitan: enforcement de RBAC y red de seguridad financiera. **Bloqueante de las demás fases.**

### 2.1 Middleware `requirePermission` (cierra la brecha de seguridad)
- **Archivos afectados:**
  - `server/routes.ts` — definir `requirePermission(code, action)` junto a `assertTeamPrivileged` (~línea 205) y la lista `FINANCIAL_PERMISSIONS`.
  - `server/storage.ts` — agregar `getEffectivePermission(clientId, role, code)` que lee `rolePermissions` (reusa `getRolePermissions`, `storage.ts:2546-2588`).
- **Lógica:** `socio` → siempre permitido. Resto → consulta `rolePermissions` por `(clientId, role, permissionId)`; si no hay fila o el flag es `false` → 403. Cachear permisos por request para no consultar N veces.
- **Sin cambio de schema** (las tablas `permissions`/`rolePermissions` ya existen).
- **Salvaguarda:** aplicar `requirePermission` **primero a los endpoints nuevos** (Fases 4-8) y recién después, en una sub-tarea aparte y con feature-flag, a los endpoints financieros existentes, para no romper accesos vigentes.

### 2.2 Catálogo de permisos nuevos (seed)
- **Archivo afectado:** `server/routes.ts:3332-3386` (bloque `defaultPermissions`).
- **Permisos a agregar** (módulo → code):
  - `finance.cmc` → `cmc.view`
  - `finance.cmv` → `cmv.view`
  - `finance.pap` → `pap.view`
  - `finance.stock_valuation` → `stock_valuation.view`, `stock_valuation.create`, `stock_valuation.delete`
  - `finance.breakeven` → `breakeven.view`, `breakeven.create`
  - `finance.config` → `financial_groups.edit` (renombrar grupos/categorías — Fase 3)
  - `bank.generic` → `bank.import` ya existe; agregar `bank.config` para alta de banco genérico
- **Frontend:** sumar etiquetas en `MODULE_LABELS` de `permissions.tsx`.

### 2.3 Hook `usePermissions` + filtrado de sidebar
- **Archivos afectados:** `client/src/hooks/` (nuevo `usePermissions.ts`), `client/src/components/app-sidebar.tsx` (filtrar ítems por permiso), endpoint nuevo `GET /api/me/permissions` en `routes.ts` que devuelve los flags del rol del usuario actual.

### 2.4 Red de seguridad financiera (tests de no-regresión)
- **Archivos nuevos:** `script/test-balance-regression.ts` (snapshot del balance con dataset fijo). Se corre manualmente (`tsx`) antes/después de cada fase.

**RBAC de esta fase:** administración de permisos = `socio`/`admin` (capa 2 ya vigente).

---

## 3. FASE 1 — Saneamiento del Balance: "Otros Movimientos" (CRÍTICA) — Requerimiento #1

**Objetivo:** que **Inicio de mes, Retiros, Préstamos, Alivios, Otros Ingresos** queden **asentados** pero **no afecten** el balance neto. **Sin migración de schema** (usa `isSpecial`/`specialType` ya existentes).

### 3.1 Estructura de datos (reutilización, 0 columnas nuevas)
- `transactionCategories.isSpecial` (bool) → marca "movimiento que no impacta resultado".
- `transactionCategories.specialType` (varchar 50) → tipificación, valores canónicos propuestos:
  - `opening_balance` (Inicio de mes)
  - `owner_withdrawal` (Retiros socios)
  - `loan` (Préstamos)
  - `cash_relief` (Alivios)
  - `other_income` (Otros Ingresos que no son venta)
  - `internal_transfer` (transferencias entre cuentas — ya cubierto por `type:"transfer"`, se unifica acá)

### 3.2 Archivos afectados
| Archivo | Cambio |
|---|---|
| `server/seedFinancialData.ts` | Marcar `isSpecial:true` + `specialType` correcto en las categorías: "Inicio de mes" (`opening_balance`), grupo "Retiros Socios" (`owner_withdrawal`), "Préstamos" y subcats de "Otros Ingresos" (`loan`/`other_income`). Crear migración de datos para clientes existentes (UPDATE por nombre/grupo). |
| `server/storage.ts` (`getBalanceSpreadsheet`, ~2455-2476) | Excluir del net las transacciones cuya categoría tenga `isSpecial=true`. **Pero seguir mostrándolas** en una sección "Otros Movimientos" del detalle (no en Ingresos/Egresos). |
| `server/storage.ts` (`monthlyBalances` si aplica) | Recalcular opening/closing sin contar especiales. |
| `client/src/pages/balance.tsx` | Render de bloque separado "Otros Movimientos" (informativo, fuera del resultado). |
| `client/src/pages/transaction-categories.tsx` | UI para ver/editar `isSpecial` y `specialType` de cada categoría. |
| `server/routes.ts` | Endpoints de categorías deben aceptar y persistir `isSpecial`/`specialType`. |

### 3.3 Salvaguardas
- **Migración de datos idempotente** para no duplicar marcas en re-seed.
- **Test de no-regresión:** tras la fase, el balance neto **debe bajar** exactamente en el monto de los movimientos especiales que antes sumaban (verificable con dataset fijo). Documentar el delta esperado.
- El campo `transactions.type` se mantiene; la exclusión es por **categoría**, no por transacción, para que el operador no tenga que reclasificar manualmente.

**RBAC:** ver balance = `balances.view`; editar marca especial de categorías = `financial_groups.edit` (`socio`/`admin`/`manager`).

---

## 4. FASE 2 — Banco Genérico + continuidad de saldos — Requerimiento #2

**Objetivo:** importar un extracto de cualquier banco no preconfigurado, mapeando manualmente las columnas, con los mismos parámetros y la validación de continuidad de saldos ya existente.

### 4.1 Estado actual (reutilizable)
- Interfaz `BankParser { bankId, bankName, parse(rawData, options) }` — `server/bankParsers.ts:56-60`.
- Ya existe `GenericParser` registrado como `"generic"` (`bankParsers.ts`) y un `registerBankParser()`.
- Bancos: galicia, mercadopago, bbva, frances, santander, provincia, nacion, macro, generic.
- **Continuidad de saldos YA implementada:** `bankStatementImport.ts:214-238` valida `closingBalance` del último batch == `openingBalance` del nuevo (tolerancia 0.01). Reutilizar tal cual.
- Bancos por cliente en `clientBanks`; cuentas en `bankAccounts` (con `openingBalance`, `openingBalanceSetAt`).

### 4.2 Estructura de datos
**Opción recomendada: 0 tablas nuevas.** Persistir el "mapeo de columnas" del banco genérico como JSON en una columna reutilizable:
- Agregar `columnMapping` (`text{mode:json}`) a `clientBanks` — *única* columna nueva. Guarda: `{ openingBalanceCell, debitCol, creditCol, dateCol, desc1Col, desc2Col, dateFormat }`.
- Esto evita una tabla extra y mantiene el patrón actual (parsers leen `ParserOptions`).

### 4.3 Archivos afectados
| Archivo | Cambio |
|---|---|
| `shared/schema.ts` | Agregar `clientBanks.columnMapping` (json). Migración drizzle-kit. |
| `server/bankParsers.ts` | Extender `GenericParser` para aceptar `options.columnMapping` con: saldo inicial, débitos, créditos, descripción 1, descripción 2, fecha. |
| `server/bankStatementImport.ts` | Reusar validación de continuidad (ya existe). Asegurar que el genérico también detecta `openingBalance`/`closingBalance` para encadenar extractos. |
| `client/src/pages/bank-statements.tsx` | UI: al elegir "Banco genérico", wizard de mapeo de columnas (preview de las primeras filas del Excel + asignación de columnas). Guardar mapeo en `clientBanks`. |
| `server/routes.ts` | Endpoint para crear/editar banco genérico con su mapeo (`bank.config`). |

### 4.4 Salvaguardas
- **No degradar parsers específicos:** el genérico solo se usa cuando `bankId="generic"`. Los demás no cambian.
- **Continuidad obligatoria:** a partir del 2º extracto de una entidad, saldo inicial debe coincidir con el final del último batch (ya validado). Mostrar error claro si no coincide.
- Reusar `financialImportBatches` (guarda opening/closing/periodo por extracto).

**RBAC:** importar = `bank.import`; configurar banco genérico = `bank.config` (`socio`/`admin`/`manager`).

---

## 5. FASE 3 — Renombrar Grupos y Categorías Financieras — Requerimiento #5

**Objetivo:** permitir editar el **nombre** de grupos financieros (`financialGroups`) y categorías (`transactionCategories`) sin romper relaciones.

### 5.1 Estructura de datos
- **0 columnas nuevas.** Solo se edita `financialGroups.name` y `transactionCategories.name`. Las FKs son por `id`, así que renombrar no rompe nada.
- **Salvaguarda clave:** los grupos/categorías "de sistema" (`isSystem=true`) **se pueden renombrar pero NO borrar ni cambiar su `type`/`specialType`** (para no romper Fase 1 ni los parsers).

### 5.2 Archivos afectados
| Archivo | Cambio |
|---|---|
| `server/routes.ts` | Endpoints `PATCH /api/financial-groups/:id` y `PATCH /api/transaction-categories/:id` que permitan editar `name` (bloquear cambio de `type`/`isSystem`/`specialType` si `isSystem`). |
| `server/storage.ts` | Métodos `updateFinancialGroup`/`updateTransactionCategory` con validación de inmutabilidad de campos sensibles. |
| `client/src/pages/financial-groups.tsx`, `transaction-categories.tsx` | Botón "Editar nombre" inline. |

**RBAC:** `financial_groups.edit` (`socio`/`admin`/`manager`).

---

## 6. FASE 4 — Sub-módulo CMC (Costo de Mercadería Comprada) — Requerimiento #3

**Objetivo:** mostrar el costo de insumos adquiridos **sin impuestos**, desglosado por **Rubro padre → Sub-Rubro**, filtrable por fechas, en **$ y en % sobre venta sin IVA** (`venta / 1.21`).

### 6.1 Fuente de datos (todo ya existe — es un reporte, no requiere tablas nuevas)
- `invoiceItems.subtotal` = `quantity × unitPrice` → **base sin IVA** (el IVA va aparte en `invoiceItems.taxId` / `invoiceTaxes`). ✅ Cumple "sin impuestos".
- Encadenamiento: `invoiceItems.supplyId → supplies.subRubroId → subRubros.rubroId → rubros` (Rubro padre). `invoiceItems` también tiene `rubroId` directo como respaldo.
- Filtro de fecha: `invoices.invoiceDate`. Filtro de local: `invoices.localId`.
- Venta del período/local: tabla `sales` (sumar `sales.total` por local+fecha), luego `/1.21` para sin IVA.

### 6.2 Estructura de datos
- **Reporte calculado on-the-fly: 0 tablas nuevas** en el MVP.
- *(Opcional, fase posterior)* `financialSavedViews` ya permite guardar filtros del usuario — reutilizar para "vistas CMC guardadas".

### 6.3 Archivos afectados
| Archivo | Cambio |
|---|---|
| `server/storage.ts` | `getCmcReport(clientId, { dateFrom, dateTo, localIds })` → agrega `invoiceItems` (excluyendo facturas `status!='active'`) por rubro padre y sub-rubro, suma subtotales **sin IVA**. Devuelve árbol `[{ rubroId, name, totalAmount, pct, subRubros:[...] }]`. |
| `server/storage.ts` | `getSalesNetByPeriod(clientId, { dateFrom, dateTo, localIds })` → suma `sales.total` y divide `/1.21`. (Reutilizable por CMV y PAP.) |
| `server/routes.ts` | `GET /api/finance/cmc` con `requirePermission("cmc.view","view")`. |
| `client/src/pages/` | Nueva página `cmc.tsx`: tabla expandible (Rubro padre → clic → Sub-Rubros), toggle **$ / %**, filtros fecha y local. |
| `client/src/components/app-sidebar.tsx` | Ítem "CMC" en sección Financiero (filtrado por permiso). |

### 6.4 Salvaguardas
- Excluir facturas anuladas (`invoices.status` / `reversedAt`).
- Insumos sin sub-rubro → agrupar en "Sin clasificar" (no perder importe).
- El **% siempre** se calcula contra venta **sin IVA** del **mismo local y período** seleccionados. Si no hay ventas cargadas, mostrar "—" en vez de dividir por cero.

**RBAC:** `cmc.view`. Acceso recomendado: `socio`, `admin`, `manager`, `encargado` (ver). Edición no aplica (es reporte).

---

## 7. FASE 5 — Sub-módulo PAP (Pago a Proveedores) — Requerimiento #4

**Objetivo:** mostrar **(1) total entregado** (suma de `invoices.total` **con IVA**) y **(2) total pagado** (`payments.amount`), con filtros de **período, local(es) y proveedor(es)**, en **$ y % sobre venta CON IVA**.

### 7.1 Fuente de datos (todo ya existe — reporte)
- Total entregado: `Σ invoices.total` (con IVA) filtrado por `invoiceDate`, `localId`, `supplierId`, `status='active'`.
- Total pagado: `Σ payments.amount` filtrado por `paymentDate`, `localId`, `supplierId`. (Alternativa más precisa por factura: `paymentAllocations.amount`.)
- Venta con IVA: `Σ sales.total` por local+período (**sin** dividir por 1.21).

### 7.2 Estructura de datos
- **0 tablas nuevas.** Reporte calculado.

### 7.3 Archivos afectados
| Archivo | Cambio |
|---|---|
| `server/storage.ts` | `getPapReport(clientId, { dateFrom, dateTo, localIds, supplierIds })` → `{ totalEntregado, totalPagado, salesWithIva, pctEntregado, pctPagado, bySupplier:[...] }`. |
| `server/routes.ts` | `GET /api/finance/pap` con `requirePermission("pap.view","view")`. |
| `client/src/pages/pap.tsx` (nuevo) | Filtros multi-select de local y proveedor + rango de fechas; tarjetas "Entregado" / "Pagado" con toggle **$ / %**; desglose por proveedor. |
| `client/src/components/app-sidebar.tsx` | Ítem "PAP". |

### 7.4 Salvaguardas
- **Criterio de IVA opuesto al de CMC:** PAP cruza contra venta **CON** IVA (ambos datos con IVA). Documentado en §11 y en tooltip de la pantalla.
- "Entregado" vs "Pagado" pueden cruzar períodos (una factura de marzo pagada en abril): aclarar en UI que cada métrica filtra por su propia fecha (factura vs pago).
- Excluir facturas anuladas.

**RBAC:** `pap.view`. Acceso recomendado: `socio`, `admin`, `manager` (dato sensible de caja). `encargado` opcional.

---

## 8. FASE 6 — Sub-módulo "Valorizar Stocks" — Requerimiento #6

**Objetivo:** valorizar mercadería en stock = `Σ (cantidad × costo de reposición)` donde costo de reposición = **última compra** del insumo (`supplies.lastCost`, con su unidad de medida). Total valorizado + fecha. **Carga manual + import/export Excel.**

### 8.1 Estructura de datos (2 tablas nuevas)
**Snapshot inmutable** (patrón igual a `stockAdjustments`):

```
stock_valuations (cabecera)
  id            serial PK
  clientId      integer FK clients (cascade)
  localId       integer FK locals
  valuationDate text  "YYYY-MM-DD"
  totalValued   real        -- Σ líneas
  status        varchar(20) default "active"   -- active | reversed
  notes         text
  createdBy     varchar FK users
  createdAt     timestamp_ms

stock_valuation_items (detalle)
  id                 serial PK
  valuationId        integer FK stock_valuations (cascade)
  supplyId           integer FK supplies
  unitOfMeasureId    integer FK units_of_measure
  quantity           real        -- cantidad contada
  replacementUnitCost real       -- costo reposición = supplies.lastCost al momento
  lineTotal          real        -- quantity × replacementUnitCost
```

- **Por qué snapshot:** el costo de reposición cambia con cada compra; guardar el costo usado **congela** el valor histórico y permite que CMV (Fase 7) referencie un stock valorizado puntual.

### 8.2 Archivos afectados
| Archivo | Cambio |
|---|---|
| `shared/schema.ts` | Definir las 2 tablas + insert schemas + relaciones. Migración drizzle-kit. |
| `server/storage.ts` | `createStockValuation(...)` (calcula `lineTotal` y `totalValued`, toma `supplies.lastCost`/unidad), `listStockValuations(clientId, localId)`, `getStockValuation(id)`, `reverseStockValuation(id)`. |
| `server/routes.ts` | CRUD `/api/finance/stock-valuations` con `requirePermission("stock_valuation.*")`. Endpoints export/import. |
| `server/routesBulkInvoiceImport.ts` o nuevo helper | Reusar patrón de import XLSX (ya se usa `xlsx` + `multer` en facturas y extractos). |
| `client/src/pages/stock-valuation.tsx` (nuevo) | (1) Carga manual: grilla de insumos con cantidad; (2) Botón **"Exportar planilla vacía"** (Excel con insumos del cliente + columnas a completar); (3) **"Importar Excel"** completado. Muestra total y fecha. |
| `shared/` | Helper de validación del payload XLSX (similar a `verify-supplier-xlsx-payload.ts`). |

### 8.3 Salvaguardas
- **Costo de reposición = última compra:** tomar `supplies.lastCost` (precio unitario última factura) con su `unitOfMeasureId`. Si un insumo no tiene compras (`lastCost=0`), marcarlo en el reporte para revisión (no valorizar en 0 silenciosamente).
- Snapshot **inmutable**; corrección = nueva valorización o reverso (`status='reversed'`), nunca edición destructiva.
- Import Excel: validar que los insumos existan (por id o nombre normalizado) y unidades coincidan; rechazar filas inválidas con reporte de errores (patrón de `bulk-invoice-import`).

**RBAC:** `stock_valuation.view` (ver), `stock_valuation.create` (cargar/importar), `stock_valuation.delete` (reversar). Acceso: `socio`/`admin`/`manager`/`encargado` cargar; ver igual.

---

## 9. FASE 7 — Sub-módulo CMV (Costo de Mercadería Vendida) — Requerimiento #7

**Objetivo:** `CMV = Stock inicial + Compras − Stock final`, y `CMV% = CMV / venta bruta` (venta **sin IVA** = `venta / 1.21`). El usuario elige: stock valorizado inicial y final (de los snapshots de Fase 6), compras (CMC, Fase 4), fecha y local.

### 9.1 Dependencias
- **Requiere Fase 4 (CMC)** y **Fase 6 (Valorizar Stocks)**. Es el sub-módulo que las integra.

### 9.2 Estructura de datos
- **MVP: cálculo on-the-fly (0 tablas nuevas).** Inputs: `stockValuationInicialId`, `stockValuationFinalId`, rango de fechas (para CMC de compras), `localId`.
- *(Opcional, persistencia de historial)* tabla `cmv_calculations` (clientId, localId, periodo, stockInicialId, stockFinalId, compras, cmv, cmvPct, createdBy, createdAt) si se quiere guardar resultados firmados.

### 9.3 Archivos afectados
| Archivo | Cambio |
|---|---|
| `server/storage.ts` | `computeCmv(clientId, { localId, stockInicialId, stockFinalId, dateFrom, dateTo })` → toma `totalValued` de ambos snapshots, compras = `getCmcReport(...).total` (sin IVA), venta neta = `getSalesNetByPeriod(...)`. Devuelve `{ stockInicial, compras, stockFinal, cmv, ventaNeta, cmvPct }`. |
| `server/routes.ts` | `GET /api/finance/cmv` con `requirePermission("cmv.view","view")`. |
| `client/src/pages/cmv.tsx` (nuevo) | Desplegables: stock valorizado inicial / final (lista de snapshots), rango de fechas para compras (CMC), local. Muestra fórmula desglosada en **$ y %**. |
| `app-sidebar.tsx` | Ítem "CMV". |

### 9.4 Salvaguardas
- **Coherencia de criterio:** compras y stock se toman **sin IVA** (CMC ya es sin IVA; las valorizaciones usan costo de reposición sin IVA). Venta sin IVA (`/1.21`). Documentar.
- Validar que ambos snapshots sean del **mismo local** y que `stockFinal.date > stockInicial.date`.
- Si falta algún input (snapshot o ventas), no calcular y avisar.

**RBAC:** `cmv.view`. Acceso: `socio`/`admin`/`manager`.

---

## 10. FASE 8 — Sub-módulo "Punto de Equilibrio" — Requerimiento #8

**Objetivo:** por local, `PE = Costos fijos / (Precio de venta − Costo variable)`. Elegir producto (toma su **costo sin IVA** y **precio de venta sin IVA**) y cargar gastos fijos con el **mismo criterio de grupos/categorías financieras** existentes.

### 10.1 Fuente de datos
- Producto: tabla `recipes` ya tiene `salePrice` (sin IVA), `salePriceWithTax` (con IVA) y `totalCost` (costo). Usar `salePrice` (sin IVA) y `totalCost` (costo variable sin IVA). Alternativa: un `supply` con `unitCost`.
- Gastos fijos: referenciar `transactionCategories`/`financialGroups` (criterio pedido).

### 10.2 Estructura de datos (2 tablas nuevas)
```
breakeven_analyses (cabecera)
  id              serial PK
  clientId        integer FK clients (cascade)
  localId         integer FK locals
  name            varchar(255)
  recipeId        integer FK recipes  (nullable)
  supplyId        integer FK supplies (nullable)   -- producto alternativo
  salePriceNoIva  real        -- congelado al crear
  variableCostNoIva real      -- congelado al crear
  breakevenUnits  real        -- resultado (unidades)
  createdBy       varchar FK users
  createdAt       timestamp_ms

breakeven_fixed_costs (detalle de gastos fijos)
  id                    serial PK
  analysisId            integer FK breakeven_analyses (cascade)
  financialCategoryId   integer FK transaction_categories (nullable)
  label                 varchar(255)   -- por si carga libre
  amount                real
```

### 10.3 Archivos afectados
| Archivo | Cambio |
|---|---|
| `shared/schema.ts` | 2 tablas + insert schemas + relaciones. Migración. |
| `server/storage.ts` | `createBreakevenAnalysis(...)` (calcula `breakevenUnits = Σ fixedCosts / (salePriceNoIva − variableCostNoIva)`), `listBreakevenAnalyses`, `getBreakevenAnalysis`. |
| `server/routes.ts` | CRUD `/api/finance/breakeven` con `requirePermission("breakeven.*")`. |
| `client/src/pages/breakeven.tsx` (nuevo) | Desplegable de producto (receta/insumo) que autocompleta costo y precio **sin IVA**; grilla para cargar gastos fijos seleccionando categoría financiera; muestra PE en unidades y en $. |
| `app-sidebar.tsx` | Ítem "Punto de Equilibrio". |

### 10.4 Salvaguardas
- Guardar precio/costo **congelados** al momento del cálculo (no recalcular si cambian luego).
- Validar `salePriceNoIva − variableCostNoIva > 0` (margen de contribución positivo) antes de dividir.
- Reusar `salePrice` (sin IVA) de recetas; **no** usar `salePriceWithTax`.

**RBAC:** `breakeven.view` (ver), `breakeven.create` (crear). Acceso: `socio`/`admin`/`manager`.

---

## 11. Criterio de IVA por sub-módulo (regla de oro, no mezclar)

| Sub-módulo | Dato base | ¿Con o sin IVA? | Cruce con venta |
|---|---|---|---|
| **Balance** | `transactions.amount` | tal cual se cargó | — |
| **CMC** | `invoiceItems.subtotal` | **SIN IVA** | venta **sin IVA** (`/1.21`) |
| **PAP** | `invoices.total` / `payments.amount` | **CON IVA** | venta **CON IVA** |
| **Valorizar Stock** | `supplies.lastCost` | **SIN IVA** (costo reposición) | — |
| **CMV** | stock + compras (CMC) | **SIN IVA** | venta **sin IVA** (`/1.21`) |
| **Punto Equilibrio** | costo y precio de receta | **SIN IVA** | — |

> Implementar un helper único `salesNet = salesGross / 1.21` y `salesGross` en `server/storage.ts`, reutilizado por CMC/CMV/PAP, para que el criterio sea consistente y testeable en un solo lugar.

---

## 12. Matriz de acceso RBAC para lo nuevo

| Pantalla / Endpoint | Permiso (code) | socio | admin | manager | encargado | employee | viewer |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|
| Balance (ver) | `balances.view` | ✓ | ✓ | ✓ | ✓ | ⚙ | ⚙(ver) |
| Editar especial de categorías | `financial_groups.edit` | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |
| Renombrar grupos/categorías | `financial_groups.edit` | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |
| Importar extracto | `bank.import` | ✓ | ✓ | ✓ | ⚙ | ✗ | ✗ |
| Configurar banco genérico | `bank.config` | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |
| CMC | `cmc.view` | ✓ | ✓ | ✓ | ⚙ | ✗ | ⚙ |
| PAP | `pap.view` | ✓ | ✓ | ✓ | ⚙ | ✗ | ✗ |
| Valorizar Stock (ver) | `stock_valuation.view` | ✓ | ✓ | ✓ | ✓ | ⚙ | ⚙ |
| Valorizar Stock (cargar/importar) | `stock_valuation.create` | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ |
| Valorizar Stock (reversar) | `stock_valuation.delete` | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |
| CMV | `cmv.view` | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |
| Punto de Equilibrio (ver) | `breakeven.view` | ✓ | ✓ | ✓ | ⚙ | ✗ | ✗ |
| Punto de Equilibrio (crear) | `breakeven.create` | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |

> ✓ = recomendado por defecto · ⚙ = configurable por el `socio` desde `permissions.tsx` (queda en `rolePermissions`) · ✗ = denegado por defecto. `socio` siempre tiene override en `requirePermission`.

---

## 13. Orden de ejecución y dependencias

```
Fase 0  Fundaciones (requirePermission + permisos + usePermissions + tests)   ← bloqueante
   │
   ├── Fase 1  Saneamiento Balance (Otros Movimientos)        [independiente, CRÍTICA]
   ├── Fase 2  Banco Genérico                                  [independiente]
   ├── Fase 3  Renombrar grupos/categorías                     [independiente]
   ├── Fase 4  CMC ───────────────┐
   ├── Fase 6  Valorizar Stocks ──┤
   │                              └──► Fase 7  CMV  (depende de 4 y 6)
   ├── Fase 5  PAP                                              [independiente]
   └── Fase 8  Punto de Equilibrio                             [independiente]
```

**Secuencia sugerida:** 0 → 1 → 3 → 4 → 6 → 7 → 5 → 2 → 8. (Primero saneamiento y la cadena CMC→Stock→CMV que aporta el mayor valor analítico; Banco genérico y PE pueden paralelizarse).

---

## 14. Checklist de no-regresión financiera (correr en cada fase)

- [ ] Balance neto con dataset fijo no cambia (salvo el delta intencional de Fase 1).
- [ ] Suma de `invoiceItems.subtotal` (sin IVA) por factura = `invoices.subtotal`.
- [ ] `invoices.total` = `subtotal − discount + taxTotal` (verificar con `shared/invoiceTaxComputation.ts`).
- [ ] Continuidad de saldos bancarios: `closingBalance[n] == openingBalance[n+1]` por entidad.
- [ ] `supplies.lastCost`/`unitCost` y `costHistory` no se alteran por los reportes nuevos (CMC/CMV solo leen).
- [ ] `salesNet = salesGross / 1.21` aplicado únicamente donde corresponde (§11).
- [ ] Todo endpoint nuevo responde 403 sin el permiso correcto y 200 con él.
- [ ] Toda query nueva filtra por `clientId`.
- [ ] Snapshots (stock valuation) son inmutables; el reverso no borra historial.

---

## 15. Política de despliegue

1. Cada fase se desarrolla en rama, con su checklist §14 verde.
2. **Nada llega a producción sin commit a GitHub** (Netlify/Turso despliega desde el repo).
3. Migraciones de schema: `drizzle-kit push` documentado en el PR; correr primero en local (SQLite `file:`/Postgres) y luego en Turso (`db:push:turso`).
4. Las migraciones de **datos** (Fase 1 marcar `isSpecial`, Fase 2 mapeos) deben ser idempotentes y reversibles.
5. Backup de Turso antes de cada migración (`script/backup-turso.ts`).

---

## 16. Resumen de cambios de schema (consolidado)

| Fase | Tabla | Cambio |
|---|---|---|
| 1 | `transactionCategories` | **Ninguno** (usa `isSpecial`/`specialType` existentes) + migración de datos |
| 2 | `clientBanks` | + `columnMapping` (json) |
| 4 | — | Ninguno (reporte) |
| 5 | — | Ninguno (reporte) |
| 6 | `stock_valuations`, `stock_valuation_items` | **2 tablas nuevas** |
| 7 | (`cmv_calculations` opcional) | 0 obligatorias |
| 8 | `breakeven_analyses`, `breakeven_fixed_costs` | **2 tablas nuevas** |
| 0 | `permissions`/`rolePermissions` | **Ninguno** (solo nuevas filas vía seed) |

**Total: 4 tablas nuevas obligatorias + 1 columna + reseed de permisos.** Todo en dialecto SQLite/libSQL con los helpers existentes de `shared/schema.ts`.

---

*Fin del ROADMAP_BETA. Listo para desglosar cualquier fase en tareas implementables cuando lo apruebes. No se escribió código de módulos ni se subió nada a producción.*
