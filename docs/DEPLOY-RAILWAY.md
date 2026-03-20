# Deploy en Railway (GitHub)

## Qué hicimos en el repo

- El proyecto **no** estaba vinculado a GitHub: el `git` que tenías apuntaba a la carpeta de usuario (`C:\Users\mbedu`), no a `dataflow_proyecto`.
- Ahora hay un repositorio **solo** dentro de `dataflow_proyecto` (carpeta `.git` ahí).

## Pasos en tu PC

1. **Desde la carpeta del proyecto** (importante, no desde `C:\Users\mbedu`):

   ```powershell
   cd "C:\Users\mbedu\OneDrive\Escritorio\dataflow_proyecto"
   git add .
   git commit -m "Initial commit: DataFlow beta"
   ```

2. En GitHub: **New repository** → nombre ej. `dataflow` → sin README si ya tenés commit local.

3. Enlazar y subir:

   ```powershell
   git branch -M main
   git remote add origin https://github.com/TU_USUARIO/TU_REPO.git
   git push -u origin main
   ```

## Pasos en Railway

1. [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub** → autorizá y elegí el repo.
2. **Add** → **Database** → **PostgreSQL** (o usá una URL externa).
3. En el servicio de la app → **Variables**:
   - `DATABASE_URL` = *Reference* a la variable que te da Postgres en Railway (o pegá la URL).
   - `SESSION_SECRET` = string larga aleatoria.
   - `NODE_ENV` = `production`
   - `PORT` = Railway suele inyectar `PORT`; si falla, fijá `3000` o el que indique Railway.
4. **Settings** → **Build**: `npm run build` (Nixpacks suele detectarlo solo).
5. **Start command**: `npm start`

**Base de datos:** Railway Postgres es conexión TCP estándar. La app usa el driver **`pg`** para esa URL. Solo si `DATABASE_URL` apunta a **Neon** (host `neon.tech` / `.neon.`) se usa el cliente serverless de Neon.

Después del primer deploy, ejecutá migraciones / schema si usás Drizzle (desde tu máquina con `DATABASE_URL` de Railway o un one-off en Railway):

```bash
npm run db:push
```

## Archivos sensibles

- `.env` está en `.gitignore` — **no** lo subas.
- Usá `.env.example` como referencia y copiá las claves en **Variables** de Railway.
