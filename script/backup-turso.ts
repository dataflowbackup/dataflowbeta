/**
 * Backup completo de la base Turso (libsql) a un archivo SQL.
 *
 * Lee credenciales en este orden de prioridad: env.turso (preferido), .env.local, .env.
 * Genera backups/turso_<YYYY-MM-DD_HHmmss>.sql con:
 *   - DDL (CREATE TABLE / CREATE INDEX exactos según sqlite_master)
 *   - INSERT INTO por cada fila de cada tabla de usuario
 *
 * Uso:  npx tsx script/backup-turso.ts
 */
import dotenv from "dotenv";
import path from "node:path";
import fs from "node:fs";
import { createClient } from "@libsql/client/web";

dotenv.config({ path: path.join(process.cwd(), ".env") });
dotenv.config({ path: path.join(process.cwd(), "env.local"), override: true });
dotenv.config({ path: path.join(process.cwd(), ".env.local"), override: true });
dotenv.config({ path: path.join(process.cwd(), "env.turso"), override: true });

const url = process.env.DATABASE_URL;
const token = process.env.TURSO_AUTH_TOKEN;

if (!url || !url.startsWith("libsql://")) {
  console.error("ERROR: DATABASE_URL invalida o no es libsql://. Valor actual:", url ? url.slice(0, 30) + "..." : "(vacio)");
  process.exit(1);
}
if (!token) {
  console.error("ERROR: TURSO_AUTH_TOKEN vacio");
  process.exit(1);
}

const client = createClient({ url, authToken: token });

// SQLite: cómo escapar valores en INSERT.
function sqlLiteral(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "NULL";
    return String(v);
  }
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "boolean") return v ? "1" : "0";
  if (v instanceof Uint8Array || (typeof Buffer !== "undefined" && Buffer.isBuffer(v as any))) {
    const buf = Buffer.from(v as Uint8Array);
    return `X'${buf.toString("hex")}'`;
  }
  // Strings y resto
  const s = String(v).replace(/'/g, "''");
  return `'${s}'`;
}

function ts(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

async function main() {
  const startedAt = Date.now();
  console.log(`[backup-turso] Conectando a ${url.slice(0, 40)}... (token len=${token.length})`);

  // Smoke test
  const ping = await client.execute("select 1 as ok");
  if (ping.rows[0]?.ok !== 1) {
    throw new Error("Smoke test fallo (select 1 != 1)");
  }
  console.log("[backup-turso] Conexion OK");

  // Tablas y vistas/triggers/indices que no son del sistema
  const masterRes = await client.execute({
    sql: `SELECT type, name, tbl_name, sql
          FROM sqlite_master
          WHERE name NOT LIKE 'sqlite_%'
            AND name NOT LIKE '_litestream_%'
            AND name NOT LIKE 'libsql_%'
            AND sql IS NOT NULL
          ORDER BY CASE type
            WHEN 'table' THEN 1
            WHEN 'index' THEN 2
            WHEN 'view'  THEN 3
            WHEN 'trigger' THEN 4
            ELSE 5 END, name`,
  });
  const objects = masterRes.rows.map((r) => ({
    type: String(r.type ?? ""),
    name: String(r.name ?? ""),
    tblName: String(r.tbl_name ?? ""),
    sql: String(r.sql ?? ""),
  }));
  const tables = objects.filter((o) => o.type === "table");
  const indexes = objects.filter((o) => o.type === "index");
  const views = objects.filter((o) => o.type === "view");
  const triggers = objects.filter((o) => o.type === "trigger");

  console.log(`[backup-turso] Objetos: tablas=${tables.length} indices=${indexes.length} vistas=${views.length} triggers=${triggers.length}`);

  fs.mkdirSync("backups", { recursive: true });
  const outPath = path.join("backups", `turso_${ts()}.sql`);
  const out = fs.createWriteStream(outPath, { encoding: "utf8" });

  const writeLn = (s = "") => out.write(s + "\n");

  writeLn("-- =========================================================");
  writeLn(`-- DataFlow Turso backup`);
  writeLn(`-- Fecha: ${new Date().toISOString()}`);
  writeLn(`-- DB:    ${url}`);
  writeLn(`-- Generado por script/backup-turso.ts`);
  writeLn("-- =========================================================");
  writeLn("PRAGMA foreign_keys=OFF;");
  writeLn("BEGIN TRANSACTION;");
  writeLn("");

  // 1) DDL de tablas
  writeLn("-- ---------- TABLAS (DDL) ----------");
  for (const t of tables) {
    writeLn(`-- table: ${t.name}`);
    writeLn(`${t.sql};`);
  }
  writeLn("");

  // 2) Datos
  writeLn("-- ---------- DATOS ----------");
  let totalRows = 0;
  for (const t of tables) {
    process.stdout.write(`[backup-turso] Dump tabla ${t.name}...`);
    // Page por LIMIT/OFFSET para no traerlo todo en RAM si la tabla es grande.
    const PAGE = 1000;
    let offset = 0;
    let rowsTable = 0;
    let columns: string[] | null = null;
    let firstChunk = true;

    while (true) {
      const r = await client.execute({
        sql: `SELECT * FROM "${t.name}" LIMIT ${PAGE} OFFSET ${offset}`,
      });
      if (firstChunk) {
        columns = (r.columns ?? []) as string[];
      }
      if (r.rows.length === 0) break;

      for (const row of r.rows) {
        const vals = (columns ?? []).map((c) => sqlLiteral((row as any)[c]));
        writeLn(
          `INSERT INTO "${t.name}" (${(columns ?? [])
            .map((c) => `"${c}"`)
            .join(", ")}) VALUES (${vals.join(", ")});`,
        );
        rowsTable++;
      }
      offset += r.rows.length;
      firstChunk = false;
      if (r.rows.length < PAGE) break;
    }

    totalRows += rowsTable;
    process.stdout.write(` ${rowsTable} filas\n`);
    writeLn("");
  }

  // 3) Indices, vistas, triggers
  if (indexes.length > 0) {
    writeLn("-- ---------- INDICES ----------");
    for (const o of indexes) writeLn(`${o.sql};`);
    writeLn("");
  }
  if (views.length > 0) {
    writeLn("-- ---------- VISTAS ----------");
    for (const o of views) writeLn(`${o.sql};`);
    writeLn("");
  }
  if (triggers.length > 0) {
    writeLn("-- ---------- TRIGGERS ----------");
    for (const o of triggers) writeLn(`${o.sql};`);
    writeLn("");
  }

  writeLn("COMMIT;");
  writeLn("PRAGMA foreign_keys=ON;");
  writeLn(`-- Total filas: ${totalRows}`);

  await new Promise<void>((res, rej) => out.end((e?: any) => (e ? rej(e) : res())));

  const stat = fs.statSync(outPath);
  const dur = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`[backup-turso] OK -> ${outPath} (${(stat.size / 1024).toFixed(1)} KB, ${totalRows} filas, ${dur}s)`);
}

main().catch((e) => {
  console.error("[backup-turso] FALLO:", e);
  process.exit(1);
});
