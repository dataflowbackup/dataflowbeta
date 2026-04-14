# Postgres local (opcional) — sin Docker

El modo habitual de desarrollo en este repo es **SQLite en archivo** (`file:./data/dev.db`): **no hace falta Docker ni Postgres** para levantar `npm run dev`.

Los archivos **`dataflow_db_backup.sql`** / **`dataflow-database.sql`** son volcados de **PostgreSQL**. No se pueden importar tal cual dentro de SQLite. Si necesitás **exactamente esos datos** en tu máquina:

1. Instalá **PostgreSQL para Windows** desde [postgresql.org/download](https://www.postgresql.org/download/windows/) (una sola vez, instalador nativo).
2. Creá una base vacía (ej. `dataflow_local`).
3. Restaurá el backup (ajustá usuario/host):

   ```powershell
   psql "postgresql://TU_USUARIO:TU_CLAVE@localhost:5432/dataflow_local" -f dataflow_db_backup.sql
   ```

   Si falla por la línea `\restrict` al inicio del `.sql`, borrá solo esa línea y guardá.

4. En **`.env.local`**:

   ```env
   NODE_ENV=development
   DATABASE_URL=postgresql://TU_USUARIO:TU_CLAVE@localhost:5432/dataflow_local
   PORT=3000
   SESSION_SECRET=...
   ```

   Sin `DB_PROVIDER=sqlite` — con URL `postgres://` la app usa el driver `pg`.

**Producción (Turso en Netlify)** sigue independiente: no tocás eso para desarrollo local.
