## Flujo de trabajo estándar (DataFlow)

Este documento define **cómo trabajamos siempre** para evitar desalineación entre cambios, base de datos y deploy.

### Principios
- **Un push a `main` es el gatillo del deploy** (Netlify).
- Evitamos “arreglos a mano” en producción: si un cambio requiere DB o config, queda automatizado o documentado.
- No tocamos infraestructura (Netlify/Turso) salvo que el cambio lo requiera.

### Después de cada modificación de código (siempre)
- **Build local**: `npm run build`
- **Commit + push**: el push dispara el deploy en Netlify.

### Cuando hay cambios de esquema (DB)
- El deploy en Netlify ejecuta automáticamente:
  - `npm run db:push:turso`
  - y luego `npm run build`

Eso garantiza que el ambiente cloud (Turso) quede con el esquema actualizado **antes** de publicar el frontend/backend serverless.

### Variables requeridas en Netlify (Producción)
- `DB_PROVIDER=turso`
- `DATABASE_URL=libsql://...`
- `TURSO_AUTH_TOKEN=...`
- `SESSION_SECRET=...`
- `NODE_ENV=production`

### Checklist rápido antes de dar por cerrado un cambio
- El deploy de Netlify pasa (build + functions).
- Se prueba en vivo el flujo afectado (p.ej. importar extracto, login, etc.).
- Se validan casos borde relevantes (p.ej. validación de saldos entre extractos).

