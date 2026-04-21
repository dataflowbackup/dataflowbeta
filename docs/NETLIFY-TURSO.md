# Netlify + Turso + desarrollo local

Documentación de cómo quedó armado el entorno (2026), tras alinear el esquema de recetas en Turso y separar credenciales locales de producción.

## Arquitectura

| Entorno | Base de datos | Quién la usa |
|--------|----------------|--------------|
| **Desarrollo local** (`npm run dev`) | SQLite en archivo (`DATABASE_URL=file:./data/dev.db`, `DB_PROVIDER=sqlite` típico en `.env`) | Tu PC |
| **Producción (Netlify)** | **Turso** (`libsql://...`, `DB_PROVIDER=turso`, `TURSO_AUTH_TOKEN`) | Sitio desplegado y funciones serverless |
| **Push de esquema a Turso** | Misma base que Netlify | Solo cuando corrés `npm run db:push:turso` con credenciales remotas (ver `env.turso`) |

Netlify **no** lee el `env.turso` de tu disco: usa las variables configuradas en **Netlify → Site configuration → Environment variables**.

## Variables en Netlify (producción)

Valores esperados (nombres exactos):

- **`DATABASE_URL`**: URL `libsql://` de la base Turso (ej. `libsql://dataflow-db-....turso.io`).
- **`DB_PROVIDER`**: `turso`.
- **`TURSO_AUTH_TOKEN`**: token de API de Turso con permisos sobre esa base.

Con esto la app y las rutas `/api/*` se conectan a Turso en la nube.

## Desarrollo local vs push a Turso

El archivo **`.env`** suele apuntar a **`file:./data/dev.db`** para no depender de red al programar.

**Problema que ocurrió:** `npm run db:push:turso` usa `drizzle.config.turso.ts`, que al principio solo cargaba `.env` / `env.local`. Si ahí solo estaba `file:./data/dev.db`, el **push aplicaba el esquema al SQLite local**, no a Turso → Netlify seguía con tablas/columnas faltantes y devolvía **500** (ej. `no such table: recipe_subcategories`).

**Solución adoptada:**

1. Archivo **`env.turso`** en la raíz del repo (listado en **`.gitignore`**, no se sube a Git).
2. Contiene las mismas variables que Netlify: `DATABASE_URL` (libsql), `TURSO_AUTH_TOKEN`, `DB_PROVIDER=turso`.
3. **`drizzle.config.turso.ts`** carga `env.turso` **al final**, con `override: true`, para que esos valores **pisen** el `DATABASE_URL` del `.env` **solo** al ejecutar Drizzle.

Plantilla de referencia: **`env.turso.example`** (sí va al repo; sin secretos).

## Comandos útiles

```bash
# Aplicar esquema Drizzle (shared/schema.ts) a la base definida en env.turso / .env
npm run db:push:turso

# Comprobar qué URL usa el entorno y si existen tablas %recipe% (incl. recipe_subcategories)
npm run turso:diag
```

Tras un `push` correcto contra Turso, `turso:diag` debe mostrar `libsql://...` y **`recipe_subcategories existe: SI`**.

## Respaldo antes de migrar (Turso)

En el dashboard de Turso, **crear un branch** de la base antes de un `push` arriesgado es una buena red de seguridad (no reemplaza políticas de backup empresarial, pero ayuda a probar o revertir mentalmente).

## SQL manual (plan B)

Si `db:push:turso` no pudiera ejecutarse, el repo incluye **`script/turso-fix-recipe-subcategories.sql`**: crea `recipe_subcategories` y agrega `subcategory_id` en `recipes` (SQLite/Turso). Ejecutable en el **SQL editor** de Turso sobre la base correcta.

## Sitio “pausado” en Netlify

Si aparece **“Site not available — reached its usage limits”**, el sitio está **pausado por cuotas del plan Netlify** (no es error de código ni de Turso). Hay que revisar **Billing / plan** en Netlify o esperar el reinicio de límites del plan gratuito, según corresponda. Tras **pasar a plan de pago**, el sitio vuelve a estar disponible cuando Netlify reactive el deploy.

## Resumen operativo

1. **Día a día en local:** `.env` con `file:./data/dev.db` (o el que uses).
2. **Cambiar esquema en Turso (igual que producción):** mantener **`env.turso`** actualizado y correr **`npm run db:push:turso`**, luego **`npm run turso:diag`** para verificar.
3. **Producción:** variables solo en **Netlify**; redeploy si cambiás variables sensibles.
4. **Nunca commitear** `env.turso` ni tokens en el repo.

## Archivos relacionados en el repo

| Archivo | Rol |
|---------|-----|
| `drizzle.config.turso.ts` | Config Drizzle Kit + carga de `env.turso` |
| `env.turso.example` | Plantilla sin secretos |
| `script/turso-diagnostics.ts` | Diagnóstico de URL y tablas `recipe_*` |
| `script/turso-fix-recipe-subcategories.sql` | Parche SQL puntual (subcategorías) |
| `server/db.ts` | Elección de driver (sqlite / turso / postgres) según `DATABASE_URL` y `DB_PROVIDER` |
| `.env.example` | Documenta desarrollo local y mención de `env.turso` |

---

*Última actualización: alineación esquema recetas/subcategorías en Turso, `env.turso` para push seguro, y nota sobre límites Netlify.*
