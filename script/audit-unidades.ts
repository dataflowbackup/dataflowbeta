/**
 * Auditoría de unidades de medida — SOLO LECTURA, no escribe una sola fila.
 *
 * Antes de convertir Gramos→Kilogramos y Mililitros→Litros hay que saber qué insumos están
 * REALMENTE cargados en gramos/ml y cuáles no. A los que no, un ÷1.000 a ciegas les multiplica
 * el error por mil.
 *
 * Clasifica cada insumo en g/ml en cuatro cajones:
 *
 *   A. ENVASE   — sus cantidades no son gramos ni ml, son botellas/paquetes (la mediana de lo
 *                 comprado es menor a 50). Convertirlo a Kg/Lt lo empeora: va a "Unidad".
 *   B. LÍNEAS   — el insumo está bien cargado, pero tiene facturas sueltas en otra escala
 *                 (una en litros entre diez en ml). Se corrige esa línea, no el insumo.
 *   C. SIN DATO — nunca se compró por factura; no hay con qué juzgarlo.
 *   D. OK       — se convierte ÷1.000 sin preguntar.
 *
 * Ordena lo que hay que revisar por impacto: primero lo que está metido en recetas.
 *
 * Uso: npx tsx script/audit-unidades.ts
 */
import dotenv from "dotenv";
import path from "node:path";
import { createClient } from "@libsql/client";

dotenv.config({ path: path.join(process.cwd(), ".env") });
dotenv.config({ path: path.join(process.cwd(), "env.turso"), override: true });

const url = process.env.DATABASE_URL;
if (!url) throw new Error("Falta DATABASE_URL");
const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });

/** Comprar menos de 50 g o 50 ml en una factura de proveedor no existe: eso es un envase. */
const MEDIANA_ENVASE = 50;
/** Una línea que se aparta x100 de la mediana del insumo está cargada en otra escala. */
const SALTO_LINEA = 100;

const money = (n: number) => `$ ${new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}`;
const num = (n: number, d = 2) => new Intl.NumberFormat("es-AR", { minimumFractionDigits: d, maximumFractionDigits: d }).format(n);

const mediana = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const clientes = await client.execute("select id, name from clients order by id");
const nombreCliente = new Map(clientes.rows.map((r) => [Number(r.id), String(r.name)]));

// Ojo con el LIKE: "Kilogramos" contiene "gramo". Se matchea por nombre exacto y abreviatura,
// que es lo que distingue Gramos de Kilogramos.
const insumos = await client.execute(`
  select s.id, s.client_id, s.name, u.name as unidad, u.abbreviation as abrev,
         cast(s.unit_cost as real) as unit_cost
    from supplies s
    join units_of_measure u on u.id = s.unit_of_measure_id
   where lower(trim(u.name)) in ('gramos', 'gramo', 'mililitros', 'mililitro')
      or lower(trim(u.abbreviation)) in ('gr', 'g', 'ml')
   order by s.client_id, s.name
`);
const ids = insumos.rows.map((r) => Number(r.id));

// Todas las líneas de factura de esos insumos, en una sola consulta.
const lineasRows = await client.execute(`
  select ii.supply_id, ii.id as linea_id, i.invoice_date as fecha, sup.trade_name as proveedor,
         cast(ii.quantity as real) as qty, cast(ii.unit_price as real) as pu, cast(ii.subtotal as real) as sub
    from invoice_items ii
    join invoices i on i.id = ii.invoice_id
    left join suppliers sup on sup.id = i.supplier_id
   where ii.supply_id in (${ids.join(",")})
   order by i.invoice_date desc
`);
const lineasPorInsumo = new Map<number, Array<{ lineaId: number; fecha: string; proveedor: string; qty: number; pu: number; sub: number }>>();
for (const l of lineasRows.rows) {
  const sid = Number(l.supply_id);
  if (!lineasPorInsumo.has(sid)) lineasPorInsumo.set(sid, []);
  lineasPorInsumo.get(sid)!.push({
    lineaId: Number(l.linea_id),
    fecha: String(l.fecha ?? "").slice(0, 10),
    proveedor: String(l.proveedor ?? "-"),
    qty: Number(l.qty) || 0,
    pu: Number(l.pu) || 0,
    sub: Number(l.sub) || 0,
  });
}

// Uso en recetas.
const recetasRows = await client.execute(`
  select ri.supply_id, r.name as receta, cast(ri.quantity_total as real) as qty, cast(ri.total_cost as real) as costo
    from recipe_ingredients ri join recipes r on r.id = ri.recipe_id
   where ri.supply_id in (${ids.join(",")})
   order by cast(ri.total_cost as real) desc
`);
const recetasPorInsumo = new Map<number, Array<{ receta: string; qty: number; costo: number }>>();
for (const r of recetasRows.rows) {
  const sid = Number(r.supply_id);
  if (!recetasPorInsumo.has(sid)) recetasPorInsumo.set(sid, []);
  recetasPorInsumo.get(sid)!.push({ receta: String(r.receta), qty: Number(r.qty) || 0, costo: Number(r.costo) || 0 });
}

type Caja = "ENVASE" | "LINEAS" | "SIN_DATO" | "OK";
interface Fila {
  id: number;
  clientId: number;
  name: string;
  unidad: string;
  abrev: string;
  unitCost: number;
  caja: Caja;
  medianaQty: number;
  lineas: number;
  lineasRaras: Array<{ lineaId: number; fecha: string; proveedor: string; qty: number; sub: number }>;
  recetas: Array<{ receta: string; qty: number; costo: number }>;
  costoEnRecetas: number;
}

const filas: Fila[] = [];

for (const r of insumos.rows) {
  const id = Number(r.id);
  const ls = lineasPorInsumo.get(id) ?? [];
  const recetas = recetasPorInsumo.get(id) ?? [];
  const qtys = ls.map((l) => l.qty).filter((q) => q > 0);
  const med = mediana(qtys);

  let caja: Caja = "OK";
  let lineasRaras: Fila["lineasRaras"] = [];

  if (qtys.length === 0) {
    caja = "SIN_DATO";
  } else if (med < MEDIANA_ENVASE) {
    caja = "ENVASE";
  } else {
    // El insumo está bien; buscamos líneas sueltas cargadas en otra escala.
    lineasRaras = ls
      .filter((l) => l.qty > 0 && (l.qty * SALTO_LINEA < med || l.qty > med * SALTO_LINEA))
      .map((l) => ({ lineaId: l.lineaId, fecha: l.fecha, proveedor: l.proveedor, qty: l.qty, sub: l.sub }));
    if (lineasRaras.length > 0) caja = "LINEAS";
  }

  filas.push({
    id,
    clientId: Number(r.client_id),
    name: String(r.name),
    unidad: String(r.unidad),
    abrev: String(r.abrev),
    unitCost: Number(r.unit_cost) || 0,
    caja,
    medianaQty: med,
    lineas: ls.length,
    lineasRaras,
    recetas,
    costoEnRecetas: recetas.reduce((s, x) => s + x.costo, 0),
  });
}

const porCaja = (c: Caja) => filas.filter((f) => f.caja === c);
// Primero lo que toca recetas, y dentro de eso lo que más plata mueve.
const porImpacto = (a: Fila, b: Fila) =>
  (b.recetas.length > 0 ? 1 : 0) - (a.recetas.length > 0 ? 1 : 0) || b.costoEnRecetas - a.costoEnRecetas;

console.log("=".repeat(104));
console.log("AUDITORÍA DE UNIDADES — insumos en Gramos / Mililitros");
console.log("=".repeat(104));
console.log(`\nTotal de insumos en g/ml: ${filas.length}`);
console.log(`  D. OK       — se convierten ÷1.000 sin revisar : ${porCaja("OK").length}`);
console.log(`  C. SIN DATO — nunca se compraron por factura   : ${porCaja("SIN_DATO").length}  (${porCaja("SIN_DATO").filter((f) => f.recetas.length > 0).length} en recetas)`);
console.log(`  B. LÍNEAS   — insumo bien, facturas sueltas mal: ${porCaja("LINEAS").length}  (${porCaja("LINEAS").reduce((s, f) => s + f.lineasRaras.length, 0)} líneas a corregir)`);
console.log(`  A. ENVASE   — mal etiquetado, van a "Unidad"   : ${porCaja("ENVASE").length}  (${porCaja("ENVASE").filter((f) => f.recetas.length > 0).length} en recetas)`);

// ── A. Los que están mal etiquetados ────────────────────────────────────────────
console.log("\n\n" + "█".repeat(104));
console.log("A. INSUMOS MAL ETIQUETADOS — sus cantidades son envases, no gramos/ml");
console.log("   Propuesta: pasarlos a \"Unidad\" y NO dividir por 1.000.");
console.log("█".repeat(104));

for (const f of porCaja("ENVASE").sort(porImpacto)) {
  console.log("\n" + "─".repeat(104));
  console.log(`#${f.id}  ${f.name}   [${nombreCliente.get(f.clientId) ?? f.clientId} · ${f.unidad}]`);
  console.log(`   Compra típica: ${num(f.medianaQty)} ${f.abrev}   ·   costo unitario ${money(f.unitCost)}   ·   ${f.lineas} factura(s)`);
  const ls = (lineasPorInsumo.get(f.id) ?? []).slice(0, 4);
  for (const l of ls) {
    console.log(`     ${l.fecha}  ${l.proveedor.slice(0, 22).padEnd(24)} cant ${num(l.qty).padStart(11)}  precio u. ${money(l.pu).padStart(14)}  total ${money(l.sub).padStart(14)}`);
  }
  if (f.recetas.length > 0) {
    console.log(`   ⚠ Está en ${f.recetas.length} receta(s) — hoy ya están costeando mal:`);
    for (const rec of f.recetas.slice(0, 6)) {
      console.log(`     ${rec.receta.slice(0, 44).padEnd(46)} usa ${num(rec.qty).padStart(10)} ${f.abrev}  cuesta ${money(rec.costo).padStart(14)}`);
    }
  }
}

// ── B. Líneas de factura sueltas ────────────────────────────────────────────────
console.log("\n\n" + "█".repeat(104));
console.log("B. LÍNEAS DE FACTURA CARGADAS EN OTRA ESCALA — el insumo está bien, la factura no");
console.log("   Propuesta: corregir esas líneas y después convertir el insumo normalmente.");
console.log("█".repeat(104));

for (const f of porCaja("LINEAS").sort(porImpacto)) {
  console.log("\n" + "─".repeat(104));
  console.log(`#${f.id}  ${f.name}   [${nombreCliente.get(f.clientId) ?? f.clientId} · ${f.unidad}]   compra típica ${num(f.medianaQty)} ${f.abrev}${f.recetas.length > 0 ? `   · en ${f.recetas.length} receta(s)` : ""}`);
  for (const l of f.lineasRaras) {
    const factor = f.medianaQty > 0 ? l.qty / f.medianaQty : 0;
    console.log(`     línea ${String(l.lineaId).padEnd(7)} ${l.fecha}  ${l.proveedor.slice(0, 22).padEnd(24)} cant ${num(l.qty).padStart(11)}  total ${money(l.sub).padStart(14)}   (x${num(factor, 4)} de lo normal)`);
  }
}

// ── C. Sin compras ──────────────────────────────────────────────────────────────
console.log("\n\n" + "█".repeat(104));
console.log("C. SIN COMPRAS REGISTRADAS — no hay factura con qué juzgarlos");
console.log("█".repeat(104));
const sinDatoEnRecetas = porCaja("SIN_DATO").filter((f) => f.recetas.length > 0).sort(porImpacto);
console.log(`\n${porCaja("SIN_DATO").length} insumos, de los cuales ${sinDatoEnRecetas.length} están usados en recetas:`);
for (const f of sinDatoEnRecetas) {
  console.log(
    `   #${String(f.id).padEnd(6)} ${f.name.slice(0, 36).padEnd(38)} [${f.abrev}] costo ${money(f.unitCost).padStart(13)} ` +
    `· ${f.recetas.length} receta(s) por ${money(f.costoEnRecetas)}`,
  );
}
const sinDatoSueltos = porCaja("SIN_DATO").filter((f) => f.recetas.length === 0);
if (sinDatoSueltos.length > 0) {
  console.log(`\n   Los otros ${sinDatoSueltos.length} no están en ninguna receta ni tienen compras: convertirlos es inocuo.`);
}

console.log("\n" + "=".repeat(104));
console.log("Nada de esto modificó la base: fueron todas consultas de lectura.");
