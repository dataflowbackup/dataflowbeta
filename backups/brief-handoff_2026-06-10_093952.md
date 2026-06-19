# Brief de continuidad — Integración Datalive → Dataflow

## Contexto
Tengo locales gastronómicos. Uso **Datalive** como CRM de ventas: es un panel web, **no tiene API oficial**, pero **exporta reportes a CSV** por local. Quiero automatizar el traspaso de esas ventas a **Dataflow**, mi sistema financiero propio (ESTE repo): panel web, servidor **Netlify**, base de datos **Turso**. Hoy cargo los datos a mano, registro por registro, y quiero dejar de hacerlo. Tengo acceso total a Dataflow.

## Objetivo de esta sesión
Construir en este repo (Dataflow = destino) el "buzón" de ingesta que falta: un endpoint que reciba ventas por POST y las inserte en Turso, sin duplicar.

## Arquitectura acordada (circuito completo)
1. **Origen — Datalive:** exporta CSV por local.
2. **ETL (script Python, corre en mi PC, YA está armado, fuera de este repo):** lee el CSV, normaliza formato argentino (coma decimal, fecha dd/mm/aaaa), genera un `registro_id` único por venta (hash de local + fecha + comprobante + concepto + monto) para idempotencia, y hace POST por lotes al endpoint de Dataflow.
3. **Destino — Dataflow (ESTE repo, lo que hay que construir):** endpoint de ingesta + tabla en Turso.

## Qué construir en este repo
1. **Tabla `ventas` en Turso**, con `registro_id` como PRIMARY KEY (idempotencia a nivel base):
```sql
CREATE TABLE IF NOT EXISTS ventas (
  registro_id   TEXT PRIMARY KEY,
  fecha         TEXT NOT NULL,
  comprobante   TEXT,
  medio_pago    TEXT,
  concepto      TEXT,
  cantidad      REAL,
  monto         REAL,
  local_id      TEXT NOT NULL,
  local_nombre  TEXT,
  creado_en     TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ventas_fecha ON ventas(fecha);
CREATE INDEX IF NOT EXISTS idx_ventas_local ON ventas(local_id);
```
2. **Netlify Function `ingesta-ventas`** que:
   - Acepta solo POST.
   - Valida `Authorization: Bearer <INGESTA_TOKEN>` (variable de entorno).
   - Inserta con `INSERT OR IGNORE` usando `@libsql/client`.
   - Devuelve `{recibidos, insertados, duplicados_ignorados}`.
3. Instalar la dependencia `@libsql/client`.
4. Variables de entorno: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `INGESTA_TOKEN`.
5. (Opcional) redirect `/api/ingesta-ventas` → la función.

## Contrato del payload (el endpoint TIENE que aceptar exactamente esto)
```json
{
  "registros": [
    {
      "registro_id": "string",
      "fecha": "YYYY-MM-DD",
      "comprobante": "string",
      "medio_pago": "string",
      "concepto": "string",
      "cantidad": 0,
      "monto": 0,
      "local_id": "string",
      "local_nombre": "string"
    }
  ]
}
```

## Cómo quiero trabajar
- Primero revisá la estructura actual del repo y decime cómo encaja esto con lo que ya hay (dónde van las functions, cómo manejo hoy Turso y las env vars), ANTES de crear archivos.
- Implementá la función respetando las convenciones del proyecto.
- No toques credenciales ni hagas deploy sin confirmarme.
- Te adjunto archivos de referencia ya armados: `ingesta-ventas.mjs`, `schema.sql`, `DEPLOY.md`, y el `pipeline.py` del lado ETL para que veas qué manda.

## Fuera de alcance por ahora (fase 2)
Automatizar la descarga del CSV de Datalive con Playwright. Hoy enfocate solo en el endpoint de ingesta + la tabla.
