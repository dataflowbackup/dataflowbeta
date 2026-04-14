import { existsSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import "../server/env.ts";

/**
 * Diagnóstico rápido cuando `npm run dev` o el login local fallan.
 * No imprime secretos completos.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const url = process.env.DATABASE_URL || "";
const dbProvider = (process.env.DB_PROVIDER || "").trim();

function main(): void {
  console.log("--- DataFlow: check local ---\n");
  console.log("Raíz del repo (referencia):", root);
  console.log("NODE_ENV:", process.env.NODE_ENV || "(vacío)");
  console.log("PORT:", process.env.PORT || "(default 5000)");
  console.log("DB_PROVIDER:", dbProvider || "(vacío)");
  console.log(
    "DATABASE_URL:",
    url ? maskUrl(url) : "FALTA — sin esto el servidor no arranca",
  );

  if (!url) {
    console.log(
      "\nCreá `.env.local` en la raíz con al menos DATABASE_URL (ver .env.example).",
    );
    process.exit(1);
  }

  if (url.startsWith("file:")) {
    const rel = url.replace(/^file:\.?\//, "").replace(/^file:/, "");
    const abs = path.isAbsolute(rel) ? rel : path.resolve(root, rel);
    console.log("\nArchivo SQLite esperado:", abs);
    if (!existsSync(abs)) {
      console.log(
        "→ El archivo NO existe. Creá la carpeta `data` y el esquema con:\n   npm run db:push:local",
      );
      try {
        mkdirSync(path.dirname(abs), { recursive: true });
        console.log("(carpeta contenedora creada si faltaba)");
      } catch {
        /* ignore */
      }
      process.exit(1);
    }
    const st = statSync(abs);
    console.log("→ Tamaño:", st.size, "bytes");
    if (st.size === 0) {
      console.log("→ Vacío. Corré: npm run db:push:local");
      process.exit(1);
    }
  }

  if (url.startsWith("postgres://") || url.startsWith("postgresql://")) {
    console.log(
      "\nModo Postgres local: el servicio tiene que estar levantado en esa URL.",
    );
  }

  if (url.startsWith("libsql://")) {
    console.log(
      "\nModo Turso: estás apuntando a la NUBE también desde tu PC (válido, pero no es “solo local”).",
    );
    if (!process.env.TURSO_AUTH_TOKEN) {
      console.log("→ Falta TURSO_AUTH_TOKEN en entorno.");
      process.exit(1);
    }
  }

  console.log(
    "\nSi el login falla con SQLite nuevo: registrá un usuario o corré seed:bootstrap.",
  );
  console.log("Si la tabla users no existe: npm run db:push:local\n");
}

function maskUrl(u: string): string {
  if (u.startsWith("file:")) return u;
  try {
    const x = new URL(u);
    if (x.password) x.password = "***";
    return x.toString();
  } catch {
    return u.slice(0, 24) + "…";
  }
}

main();
