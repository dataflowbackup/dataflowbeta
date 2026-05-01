# Roadmap y estado de Data Flow

**Última actualización:** 2026-05-01  
**Mantenimiento:** actualizar este archivo cuando cambie alcance técnico, se cierre un tema importante o aparezca un nuevo pendiente verificable. Así cualquier sesión (humana o asistente) puede retomar contexto sin depender solo del chat.

---

## 1. Propósito de este documento

- **Single source of truth** operativa sobre qué existe en el producto, qué se rompió y qué falta en los frentes que ya trabajamos.
- No reemplaza documentación de deploy (`docs/NETLIFY-TURSO.md`, etc.) ni análisis de negocio (`ANALISIS_EXHAUSTIVO_DATA_FLOW.md`, `PLAN_DE_ACCION_DATA_FLOW.md`), pero **resume la línea de trabajo del equipo** sobre todo en **Extractos bancarios / financiero**.

---

## 2. Stack y despliegue (contexto fijo)

| Capa | Tecnología |
|------|------------|
| Frontend | React (Vite), TanStack Query, UI tipo shadcn/Radix |
| Backend | Express, rutas en `server/routes.ts` |
| ORM / DB | Drizzle ORM; producción **Turso (LibSQL)** |
| Deploy | **Netlify** (build + función serverless `api`) |
| Esquema compartido | `shared/schema.ts` |

**Recordatorio:** cambios en servidor requieren deploy para verse en producción; DB schema con `db:push:turso` según flujo del proyecto.

---

## 3. Alcance del producto (visión resumida)

**Data Flow** es una aplicación de gestión financiera/operativa para la empresa. El trabajo intensivo en código tocado en sesiones recientes se centró en el módulo **Extractos bancarios**: importar Excel de distintos bancos, clasificar movimientos, vistas por cuenta/banco, extractos importados y consistencia de saldos.

Otros módulos pueden existir en el repo (facturas, recetas, locales, etc.); este roadmap **no los inventa** si no hay trabajo reciente documentado aquí.

---

## 4. Lo realizado hasta ahora (detalle por tema)

### 4.1 Extractos bancarios — UI y datos

- Página principal: `client/src/pages/bank-statements.tsx`.
- Tabla de movimientos con columnas relevantes (incl. **descripción 2** donde aplica), filtros por pestaña de banco, por cuenta/caja, por categorización (todos / sin categorizar / categorizados).
- **Paginación del listado global:** el cliente pide `/api/transactions?page=&pageSize=` en bucle hasta cubrir `total`; tamaño de página ~800. Respuesta paginada: `{ items, total, page, pageSize }`. Modo legacy `?limit=N` sigue devolviendo array plano.
- **Vista “Extractos importados”:** lista lotes con período, fecha de importación, cuenta, cantidad de movimientos, saldos inicial/final cuando existen en metadatos.
- **Acciones:** importar Excel, crear/editar cuentas bancarias/cajas, vaciar extractos por cuenta (purge), borrar lote de extracto, mapeo de sucursales/alias, categorización y clasificación masiva (según rutas existentes).

### 4.2 Importación de archivos (backend)

- **Multipart + Netlify:** uso de `pickMultipartOrQueryString` para leer `bankAccountId`, `bankId`, flags y números tanto desde body multipart como query (fallback cuando serverless no rellena `req.body` igual que en Node local).
- **Resolución de `bankId` para el parser:** orden efectivo: override explícito en multipart (≠ `generic`) → `bank_id` de la cuenta en BD → inferencia por nombre de cuenta (ej. “mercado pago” → `mercadopago`) → `generic`. Evita importar MP como parser genérico cuando la cuenta no tenía `bank_id` cargado.
- **Cliente:** al subir archivo se envía también `bankId` si la cuenta lo tiene, para alinear con el servidor.
- **Continuidad de saldos:** validación de saldo inicial vs cierre del último lote para la misma cuenta; puede omitirse con `skipContinuityCheck` cuando hay datos huérfanos o recuperación.
- **Insert batch:** transacciones en lotes (ej. 800) para imports grandes y timeouts.

### 4.3 Parsers (`server/bankParsers.ts`)

- **Galicia, Mercado Pago, BBVA, Francés, Genérico** registrados en el mapa de parsers.
- **Mercado Pago:** columnas tipo fecha de liberación, descripción, monto bruto, comisión MP, retenciones IIBB, sucursal; neto = bruto − comisión − retenciones; filas de resumen (saldo inicial/final, dinero período anterior, etc.) se saltan.
- **BBVA:** merge multi-hoja donde aplica.
- **Bug histórico corregido:** `openingBalance` / `closingBalance` en parser MP (variables definidas).

### 4.4 Persistencia y purge

- `purgeBankAccountImportedData`: borrado por **lotes** (chunks de filas) de movimientos importados + hijos por `parent_transaction_id`, luego lotes en `financial_import_batches`, para evitar **504 Gateway Timeout** por DELETE gigante en una sola llamada.
- Ajustes LibSQL/Drizzle donde `.returning()` / `rowCount` no se comportaban como en Postgres (cuenta borrada, etc.) según trabajo previo en el hilo.

### 4.5 Conciliación Mercado Pago (regla de negocio)

**Criterio acordado:** comparar **Saldo disponible total** declarado en el archivo Excel vs **suma algebraica de todos los MONTO BRUTO** de las filas que se importan como movimientos (exacto al centavo).

**Implementación:**

- Parser MP devuelve `saldoDisponibleTotal` (búsqueda de filas por etiquetas en español e inglés, número en columna bruto o en la fila), `sumGrossImportable`, y `excelRow` por movimiento.
- Overrides opcionales: `mpGrossOverrides` JSON en multipart, clave = número de fila Excel, valor = monto bruto corregido.
- Si no cuadra: respuesta **200** con `reconciliationRequired: true`, `delta`, hasta **10 filas candidatas** (sospechosas bruto ~0 + resto por mayor |bruto|), sin persistir movimientos.
- Cliente: diálogo “Conciliar extracto Mercado Pago” con inputs por fila, estimación de suma tras corrección, **Finalizar importación** (reintenta con overrides) o **Suspender**; toasts y refs para no avisar “suspendido” al cerrar tras éxito.

**Mejoras posteriores en la detección del saldo en archivo:**

- Parseo numérico que entiende **formato argentino** en celdas de total (`4.365.492,34`).
- Más variantes de texto (“saldo disponible total”, “dinero disponible total”, inglés tipo “total available balance”, etc.).
- Si la fila de etiqueta no tiene números, intentar leer la **fila siguiente** (solo si la fila de etiqueta no tenía ningún monto).

### 4.6 Paginación estable de movimientos (bug crítico corregido)

- **Problema:** `getTransactions` ordenaba solo por `transaction_date DESC`. Miles de movimientos con la **misma fecha** (típico en imports MP) generan orden no determinístico entre empates → `OFFSET` en páginas **omite o duplica** filas → el cliente cortaba al alcanzar `total` y **faltaban movimientos** en pantalla (ej. solo se veían los de Galicia; MP en extractos sí contaba por BD pero no en la tabla/pestaña).
- **Solución:** orden **`transaction_date DESC`, `id DESC`** en `server/storage.ts`.
- **Cliente:** fusión de páginas con **Map por `id`**, criterio de parada por cantidad de **IDs únicos** ≥ `total`, y orden final consistente.

---

## 5. Lo realizado el día de hoy (2026-05-01)

1. **Roadmap:** creación de este archivo (`ROADMAP_DATAFLOW.md`) como referencia viva.
2. **Recordatorio contexto ya desplegado en días previos del mismo sprint de trabajo:**
   - Conciliación MP + UI de pausa/corrección + push a `main`.
   - Ajustes extracción “Saldo disponible total” (formato AR + etiquetas + fila siguiente).
   - Fix paginación estable + dedupe en cliente (**commit orientativo:** `b0ca6d1` y anteriores en la línea MP/paginación).

*(Si en el día se suman commits adicionales, añadir línea con hash y una frase.)*

---

## 6. Fallas e incidentes conocidos

### 6.1 Resueltos (histórico del trabajo en Data Flow — extractos)

| Tema | Qué pasaba | Cierre aproximado |
|------|------------|-------------------|
| Parser MP `openingBalance` no definido | Error en runtime al parsear | Corregido en parser |
| Multipart sin `bankAccountId` en serverless | Import fallaba intermitente | `pickMultipartOrQueryString` |
| Cuenta mal borrada en LibSQL | `returning()` / rowCount | Ajuste storage/rutas |
| Validación continuidad de saldos | Bloqueaba con metadatos huérfanos | `skipContinuityCheck`; purge por cuenta |
| Lista única gigante | 502 upstream | Paginación GET + merge cliente |
| Pestaña MP vacía con toast OK | `bankSource` generic / `bankId` mal resuelto | Orden de resolución `bankId` + inferencia + envío desde cliente |
| Purge manual | 504 timeout | Borrado por lotes en `purgeBankAccountImportedData` |
| Excel MP celda H errónea | Descuadre de saldo vs MP | Conciliación bruto vs saldo archivo + overrides |
| Movimientos MP no visibles con lote importado | Paginación inestable misma fecha | Orden `date + id` + dedupe en cliente |

### 6.2 Abiertos / riesgos

- **Extractos MP “reserve-release” u otros reportes:** si MP cambia layout y **no aparece** ninguna fila que coincida con los patrones de “Saldo disponible total”, el import devuelve **400** y no avanza. Requiere **nuevo patrón** o muestra de archivo real.
- **Metadatos saldo inicial/final en la lista de extractos MP:** si el parser no rellena `openingBalance`/`closingBalance` para ese formato, la tarjeta del lote no muestra esas líneas (no es que falten movimientos; es cosmetiquera/metadatos).
- **Conciliación solo MP:** otros bancos no usan la misma regla saldo vs suma brutos.
- **Tope 10 filas en UI:** si el descuadre viene de filas fuera de las 10 candidatas, el usuario puede necesitar otra pasada o ampliar heurística (pendiente de producto).
- **TypeScript:** puede haber **errores `tsc` preexistentes** en el repo no ligados a extractos; no bloquean necesariamente el build según pipeline.

---

## 7. Pendiente (backlog conocido)

| Prioridad sugerida | Ítem |
|--------------------|------|
| Media | Afilar detección de “Saldo disponible total” con **ejemplos reales** de cada tipo de export MP (panel vs API/release). |
| Media | Opcional: mostrar en UI **saldo inicial/final MP** cuando el Excel los tenga en filas de resumen ya parseadas. |
| Baja | Evaluar si hace falta **ampliar** candidatos de conciliación (>10) o segunda página de filas. |
| Baja | Revisión global **eslint/tsc** y limpieza de deuda no relacionada con extractos. |
| Proceso | **Mantener este `ROADMAP_DATAFLOW.md`** al día tras cada feature/fix relevante o reunión de alcance. |

---

## 8. Archivos clave (mapa rápido)

| Archivo | Rol |
|---------|-----|
| `client/src/pages/bank-statements.tsx` | UI extractos, import, conciliación MP, queries |
| `server/routes.ts` | POST import, GET transactions paginado, batches |
| `server/storage.ts` | `getTransactions`, `getTransactionCount`, `getImportBatches`, purge |
| `server/bankParsers.ts` | Parsers y conciliación MP (saldo, suma brutos, overrides) |
| `shared/schema.ts` | Tablas `transactions`, `bank_accounts`, `financial_import_batches`, etc. |
| `docs/NETLIFY-TURSO.md` | Deploy / DB |

---

## 9. Cómo actualizar este roadmap

1. Tras merge/deploy de un cambio importante: **1–3 bullets** en §5 (fecha) y ajustar §4 si cambia comportamiento duradero.
2. Si aparece un bug en producción: §6.2 + fecha; al cerrarlo, mover a §6.1 con breve descripción.
3. Si se redefine producto (ej. otro criterio de conciliación): editar §4.5 y §7.

---

*Documento generado para continuidad entre sesiones. El contenido refleja el estado conocido hasta la fecha indicada arriba.*
