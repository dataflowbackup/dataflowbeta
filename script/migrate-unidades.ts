/**
 * Migración de unidades de medida: Gramos→Kilogramos, Mililitros→Litros, y catálogo cerrado a 3.
 *
 * ARRANCA EN SIMULACRO. Sin `--apply` no escribe una sola fila: corre todo el cálculo, compara el
 * antes y el después y te dice si algo se movería.
 *
 *   npx tsx script/migrate-unidades.ts                          # simulacro contra Turso (no escribe)
 *   npx tsx script/migrate-unidades.ts --db=ensayo.db --apply   # ENSAYO: aplica y verifica sobre
 *                                                              # una copia restaurada del backup
 *   npx tsx script/migrate-unidades.ts --apply                  # aplica contra PRODUCCIÓN
 *
 * EL INVARIANTE: la plata no se mueve y el costo de las recetas no cambia. Por cada insumo que
 * pasa de gramos a kilos, las CANTIDADES se dividen por 1.000 y los COSTOS UNITARIOS se
 * multiplican por 1.000. Los importes guardados (subtotal de factura, total de la receta, total
 * valorizado, valorizado del decomiso) NO SE TOCAN: son la verdad contra la que se verifica.
 *
 *   340 ml × $2,81 el ml  =  0,34 lt × $2.810 el litro  =  $955,37
 *
 * Decisiones tomadas con el usuario (21-sep-2026):
 *  - Aplica a las 6 empresas. Jockey Club ya está en Kg/Lt: solo se le corrige la abreviatura.
 *  - Los 13 insumos mal etiquetados (cargados por envase con etiqueta de g/ml) quedan SIN unidad
 *    y sin re-escalar: sus cantidades no son gramos, dividirlas empeoraría el dato.
 *  - Los insumos sin unidad se quedan sin unidad.
 *  - Las sub-recetas que rinden en GR/ML pasan a Kg/Lt, y las cantidades con que las recetas madre
 *    las usan se dividen por 1.000 (la escala qty/rendimiento no cambia, así que el costo tampoco).
 *  - Las líneas de factura sueltas cargadas en otra escala se dividen igual que el resto: quedan
 *    igual de mal que hoy, pero la plata no se mueve. Su limpieza es un trabajo aparte.
 */
import dotenv from "dotenv";
import path from "node:path";
import { createClient, type Client } from "@libsql/client";

const root = process.cwd();
dotenv.config({ path: path.join(root, ".env") });
dotenv.config({ path: path.join(root, "env.turso"), override: true });

const APPLY = process.argv.includes("--apply");
/** `--db=archivo.db` corre contra una base SQLite local: es el ensayo sobre una copia. */
const dbArg = process.argv.find((a) => a.startsWith("--db="))?.slice(5);

const url = dbArg ? `file:${path.resolve(root, dbArg)}` : (process.env.DATABASE_URL ?? "");
if (!url) throw new Error("Falta DATABASE_URL");
if (!dbArg && !url.startsWith("libsql://")) {
  console.error(`ABORTADO: DATABASE_URL no es Turso y no se pidió --db=. Valor: ${url.slice(0, 30)}...`);
  process.exit(1);
}

const db: Client = createClient(
  dbArg ? { url } : { url, authToken: process.env.TURSO_AUTH_TOKEN },
);

// ── Configuración de la migración ────────────────────────────────────────────

/** El catálogo definitivo. Nada fuera de esto queda activo. */
const CANONICAS = [
  { key: "kg", name: "Kilogramos", abbr: "Kg" },
  { key: "lt", name: "Litros", abbr: "Lt" },
  { key: "und", name: "Unidad", abbr: "Und" },
] as const;
type CanonKey = (typeof CANONICAS)[number]["key"];

/** Cómo se reconoce una unidad existente. Ojo: "Kilogramos" CONTIENE "gramos". */
function clasificarUnidad(name: string, abbr: string): { canon: CanonKey | null; factor: number } {
  const n = name.trim().toLowerCase();
  const a = abbr.trim().toLowerCase();
  if (n === "kilogramos" || n === "kilogramo" || a === "kg") return { canon: "kg", factor: 1 };
  if (n === "litros" || n === "litro" || a === "lt" || a === "l") return { canon: "lt", factor: 1 };
  if (n === "unidad" || n === "unidades" || a === "und" || a === "un" || a === "undida") return { canon: "und", factor: 1 };
  // Las dos que se re-escalan.
  if (n === "gramos" || n === "gramo" || a === "gr" || a === "g") return { canon: "kg", factor: 1000 };
  if (n === "mililitros" || n === "mililitro" || a === "ml") return { canon: "lt", factor: 1000 };
  return { canon: null, factor: 1 };
}

/**
 * Insumos que NO se convierten: sus cantidades son envases (botellas, bidones, bolsas), no
 * gramos ni mililitros. Quedan sin unidad y con sus números intactos. Salieron de
 * `script/audit-unidades.ts` y los revisó el usuario uno por uno.
 */
const SIN_UNIDAD: Array<{ id: number; nombre: string }> = [
  { id: 1093, nombre: "Agua - Fornaro" },
  { id: 184, nombre: "Aji molido" },
  { id: 1, nombre: "AAAA (PRUEBA)" },
  { id: 548, nombre: "Almíbar Martín - Fornaro" },
  { id: 699, nombre: "Almíbar Trigal - Fornaro" },
  { id: 706, nombre: "Brahama" },
  { id: 1046, nombre: "CREMA HELADA VAINILLA (POUCH X 20 LT)" },
  { id: 636, nombre: "Desengrasante Alcalino Dispeko" },
  { id: 629, nombre: "Desinfectante Perfumado Dispeko" },
  { id: 640, nombre: "Desodorante de Ambientes - Dispeko" },
  { id: 398, nombre: "Harina" },
  { id: 637, nombre: "Hipoclorico de Socio- Agua LavandinaDispeko" },
  { id: 909, nombre: "Acedera Sanguinea" },
];
const SIN_UNIDAD_IDS = new Set(SIN_UNIDAD.map((s) => s.id));

// ── Utilidades ───────────────────────────────────────────────────────────────

const money = (n: number) => `$ ${new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}`;
const num = (n: number, d = 2) => new Intl.NumberFormat("es-AR", { minimumFractionDigits: d, maximumFractionDigits: d }).format(n);
/** Costos. Se MULTIPLICAN por 1.000, así que 4 decimales nunca pierden nada. */
const costo4 = (v: number) => v.toFixed(4);
/**
 * Cantidades. Se DIVIDEN por 1.000, así que 4 decimales no alcanzan: 0,25 gramos son 0,00025 kg
 * y redondear ahí mueve el costo de la receta. Se guardan con hasta 8 decimales y sin ceros de
 * relleno. La más chica de la base es 0,03 g → 0,00003 kg, así que sobra margen.
 */
const cantidad8 = (v: number) => {
  const r = Number(v.toFixed(8));
  // String() pasaría a notación exponencial por debajo de 1e-6, que SQL no entiende.
  return r !== 0 && Math.abs(r) < 1e-6 ? r.toFixed(8) : String(r);
};
const toNum = (v: unknown) => {
  const x = parseFloat(String(v ?? "0"));
  return Number.isFinite(x) ? x : 0;
};

/** Sentencias acumuladas. En simulacro se cuentan y se tiran; con --apply se ejecutan. */
const pendientes: Array<{ sql: string; args: any[] }> = [];
const enqueue = (sql: string, args: any[] = []) => pendientes.push({ sql, args });

async function ejecutarPendientes() {
  const LOTE = 100;
  for (let i = 0; i < pendientes.length; i += LOTE) {
    await db.batch(pendientes.slice(i, i + LOTE), "write");
    process.stdout.write(`\r   escribiendo… ${Math.min(i + LOTE, pendientes.length)}/${pendientes.length}`);
  }
  process.stdout.write("\n");
}

// ── Fotos del "antes" y del "después" para verificar el invariante ───────────

interface Foto {
  facturas: number;
  recetasTotal: number;
  valorizaciones: number;
  decomisos: number;
  /** Costo RECALCULADO de cada receta: Σ(cantidad × costo unitario del insumo). El que no debe moverse. */
  costoPorReceta: Map<number, number>;
}

async function sacarFoto(): Promise<Foto> {
  const q = async (sql: string) => toNum((await db.execute(sql)).rows[0]?.v);
  const facturas = await q("select coalesce(sum(cast(subtotal as real)),0) as v from invoice_items");
  const recetasTotal = await q("select coalesce(sum(cast(total_cost as real)),0) as v from recipes");
  const valorizaciones = await q("select coalesce(sum(cast(line_total as real)),0) as v from stock_valuation_items");
  const decomisos = await q("select coalesce(sum(cast(valorizado as real)),0) as v from decomisos");

  // Costo de cada receta recalculado desde cero: insumos (cantidad × costo del insumo) +
  // sub-recetas (cantidad / rendimiento × costo de la sub-receta). Es la prueba de fuego.
  const filas = await db.execute(`
    select ri.recipe_id,
           cast(ri.quantity_total as real) as qty,
           cast(s.unit_cost as real) as supply_cost,
           cast(sub.total_cost as real) as sub_cost,
           cast(sub.useful_yield as real) as sub_yield,
           ri.sub_recipe_id
      from recipe_ingredients ri
      left join supplies s on s.id = ri.supply_id
      left join recipes sub on sub.id = ri.sub_recipe_id
  `);
  const costoPorReceta = new Map<number, number>();
  for (const r of filas.rows) {
    const recipeId = Number(r.recipe_id);
    const qty = toNum(r.qty);
    let costo = 0;
    if (r.sub_recipe_id != null) {
      const y = toNum(r.sub_yield);
      costo = (y > 0 ? qty / y : qty) * toNum(r.sub_cost);
    } else {
      costo = qty * toNum(r.supply_cost);
    }
    costoPorReceta.set(recipeId, (costoPorReceta.get(recipeId) ?? 0) + costo);
  }
  return { facturas, recetasTotal, valorizaciones, decomisos, costoPorReceta };
}

// ── Migración ────────────────────────────────────────────────────────────────

async function main() {
  console.log("=".repeat(96));
  console.log(`MIGRACIÓN DE UNIDADES DE MEDIDA — ${APPLY ? "APLICANDO" : "SIMULACRO (no escribe nada)"}`);
  console.log(`Base: ${dbArg ? `ENSAYO sobre copia local ${dbArg}` : `PRODUCCIÓN ${url.slice(0, 45)}…`}`);
  console.log("=".repeat(96));

  const antes = await sacarFoto();

  const clientes = (await db.execute("select id, name from clients order by id")).rows
    // Hay dos empresas llamadas "Felisa": sin el id el informe es ambiguo.
    .map((r) => ({ id: Number(r.id), name: `${String(r.name)} (#${Number(r.id)})` }));

  /** unidad vieja → unidad canónica destino + factor de re-escalado. */
  const destinoPorUnidad = new Map<number, { nuevaId: number; factor: number; canon: CanonKey }>();
  /** Unidades que quedan fuera del catálogo definitivo y hay que desactivar. */
  const aDesactivar: Array<{ id: number; name: string; cliente: string }> = [];
  let unidadesCreadas = 0;
  let abreviaturasCorregidas = 0;

  console.log("\n── 1. Catálogo de unidades por empresa ──");

  for (const cli of clientes) {
    const unidades = (await db.execute({
      sql: "select id, name, abbreviation, active from units_of_measure where client_id = ? order by id",
      args: [cli.id],
    })).rows.map((r) => ({
      id: Number(r.id),
      name: String(r.name),
      abbr: String(r.abbreviation),
      active: Number(r.active ?? 1),
    }));

    // Se elige, para cada canónica, la unidad existente que ya la representa con factor 1
    // (una "Unidad" vieja sigue siendo la Unidad; una "Gramos" NO puede ser el Kilogramos destino).
    const canonId = new Map<CanonKey, number>();
    for (const u of unidades) {
      const { canon, factor } = clasificarUnidad(u.name, u.abbr);
      if (canon && factor === 1 && !canonId.has(canon)) canonId.set(canon, u.id);
    }

    for (const c of CANONICAS) {
      const existente = canonId.get(c.key);
      if (existente == null) {
        // Se crea. En simulacro no hay id real: se usa uno negativo solo para el informe.
        const nuevoId = APPLY
          ? Number((await db.execute({
              sql: "insert into units_of_measure (client_id, name, abbreviation, active) values (?, ?, ?, 1) returning id",
              args: [cli.id, c.name, c.abbr],
            })).rows[0].id)
          : -(unidadesCreadas + 1);
        canonId.set(c.key, nuevoId);
        unidadesCreadas++;
        console.log(`   ${cli.name}: CREAR "${c.name}" (${c.abbr})`);
      } else {
        const u = unidades.find((x) => x.id === existente)!;
        if (u.name !== c.name || u.abbr !== c.abbr || u.active !== 1) {
          enqueue("update units_of_measure set name = ?, abbreviation = ?, active = 1 where id = ?", [c.name, c.abbr, u.id]);
          abreviaturasCorregidas++;
          console.log(`   ${cli.name}: NORMALIZAR #${u.id} "${u.name}" (${u.abbr}) → "${c.name}" (${c.abbr})`);
        }
      }
    }

    for (const u of unidades) {
      const { canon, factor } = clasificarUnidad(u.name, u.abbr);
      const destino = canon ? canonId.get(canon) : undefined;
      if (destino != null && destino !== u.id) {
        destinoPorUnidad.set(u.id, { nuevaId: destino, factor, canon: canon! });
        aDesactivar.push({ id: u.id, name: `${u.name} (${u.abbr})`, cliente: cli.name });
        console.log(`   ${cli.name}: #${u.id} "${u.name}" → "${CANONICAS.find((c) => c.key === canon)!.name}"${factor !== 1 ? `  ÷${factor} cantidades, ×${factor} costos` : ""}`);
      } else if (destino == null && canon == null) {
        aDesactivar.push({ id: u.id, name: `${u.name} (${u.abbr})`, cliente: cli.name });
        console.log(`   ${cli.name}: #${u.id} "${u.name}" no es ninguna de las 3 → DESACTIVAR (sus insumos quedan sin unidad)`);
      }
    }
  }

  // ── 2. Insumos ──────────────────────────────────────────────────────────────
  console.log("\n── 2. Insumos ──");

  const insumos = (await db.execute(`
    select id, client_id, name, unit_of_measure_id,
           cast(last_quantity as real) as last_qty,
           cast(last_cost as real) as last_cost,
           cast(unit_cost as real) as unit_cost
      from supplies where unit_of_measure_id is not null
  `)).rows.map((r) => ({
    id: Number(r.id),
    unitId: Number(r.unit_of_measure_id),
    name: String(r.name),
    lastQty: toNum(r.last_qty),
    lastCost: toNum(r.last_cost),
    unitCost: toNum(r.unit_cost),
  }));

  /** insumos que se re-escalan → su factor. */
  const factorPorInsumo = new Map<number, number>();
  let soloRepunta = 0;
  let sinUnidadAplicados = 0;

  for (const s of insumos) {
    const destino = destinoPorUnidad.get(s.unitId);

    if (SIN_UNIDAD_IDS.has(s.id)) {
      // Decisión del usuario: quedan sin unidad y con sus números intactos.
      enqueue("update supplies set unit_of_measure_id = null, updated_at = ? where id = ?", [new Date().toISOString(), s.id]);
      sinUnidadAplicados++;
      continue;
    }

    if (!destino) continue; // ya apunta a la canónica correcta

    if (destino.factor === 1) {
      enqueue("update supplies set unit_of_measure_id = ? where id = ?", [destino.nuevaId, s.id]);
      soloRepunta++;
      continue;
    }

    const f = destino.factor;
    factorPorInsumo.set(s.id, f);
    enqueue(
      "update supplies set unit_of_measure_id = ?, last_quantity = ?, last_cost = ?, unit_cost = ?, updated_at = ? where id = ?",
      [destino.nuevaId, cantidad8(s.lastQty / f), costo4(s.lastCost * f), costo4(s.unitCost * f), new Date().toISOString(), s.id],
    );
  }

  console.log(`   Re-escalados (÷1.000 cantidades, ×1.000 costos): ${factorPorInsumo.size}`);
  console.log(`   Solo cambian de unidad (sin re-escalar):          ${soloRepunta}`);
  console.log(`   Quedan SIN unidad (los 13 revisados):             ${sinUnidadAplicados}`);

  const ids = [...factorPorInsumo.keys()];
  const enLista = (col: string) => (ids.length > 0 ? `${col} in (${ids.join(",")})` : "1 = 0");

  // ── 3. Líneas de factura ────────────────────────────────────────────────────
  // El subtotal NO se toca: es la plata. La cantidad baja y el precio unitario sube.
  const lineas = (await db.execute(`
    select id, supply_id, cast(quantity as real) as qty, cast(unit_price as real) as pu
      from invoice_items where ${enLista("supply_id")}
  `)).rows;
  for (const l of lineas) {
    const f = factorPorInsumo.get(Number(l.supply_id))!;
    enqueue("update invoice_items set quantity = ?, unit_price = ? where id = ?", [cantidad8(toNum(l.qty) / f), costo4(toNum(l.pu) * f), Number(l.id)]);
  }
  console.log(`\n── 3. Líneas de factura: ${lineas.length}  (subtotales intactos)`);

  // ── 4. Ingredientes de receta ───────────────────────────────────────────────
  // total_cost NO se toca: es el costo del plato.
  const ings = (await db.execute(`
    select id, supply_id, cast(quantity_total as real) as qt, cast(quantity_useful as real) as qu,
           cast(quantity_with_waste as real) as qw, cast(unit_cost_at_creation as real) as uc,
           cast(current_cost as real) as cc
      from recipe_ingredients where ${enLista("supply_id")}
  `)).rows;
  for (const i of ings) {
    const f = factorPorInsumo.get(Number(i.supply_id))!;
    enqueue(
      "update recipe_ingredients set quantity_total = ?, quantity_useful = ?, quantity_with_waste = ?, unit_cost_at_creation = ?, current_cost = ? where id = ?",
      [
        cantidad8(toNum(i.qt) / f),
        i.qu == null ? null : cantidad8(toNum(i.qu) / f),
        cantidad8(toNum(i.qw) / f),
        i.uc == null ? null : costo4(toNum(i.uc) * f),
        i.cc == null ? null : costo4(toNum(i.cc) * f),
        Number(i.id),
      ],
    );
  }
  console.log(`── 4. Ingredientes de receta: ${ings.length}  (costos de receta intactos)`);

  // ── 5. Historial de costos ──────────────────────────────────────────────────
  const hist = (await db.execute(`
    select id, supply_id, cast(quantity as real) as qty, cast(unit_cost as real) as uc
      from cost_history where ${enLista("supply_id")}
  `)).rows;
  for (const h of hist) {
    const f = factorPorInsumo.get(Number(h.supply_id))!;
    enqueue("update cost_history set quantity = ?, unit_cost = ? where id = ?", [cantidad8(toNum(h.qty) / f), costo4(toNum(h.uc) * f), Number(h.id)]);
  }
  console.log(`── 5. Historial de costos: ${hist.length}  (totales intactos)`);

  // ── 6. Valorizaciones de stock ──────────────────────────────────────────────
  // Además del re-escalado, la unidad guardada en la línea apunta a la unidad vieja.
  const val = (await db.execute(`
    select id, supply_id, unit_of_measure_id, cast(quantity as real) as qty,
           cast(replacement_unit_cost as real) as ruc
      from stock_valuation_items
  `)).rows;
  let valEscaladas = 0;
  let valRepuntadas = 0;
  for (const v of val) {
    const f = factorPorInsumo.get(Number(v.supply_id));
    const uomViejo = v.unit_of_measure_id == null ? null : Number(v.unit_of_measure_id);
    const destino = uomViejo != null ? destinoPorUnidad.get(uomViejo) : undefined;
    const nuevoUom = destino ? destino.nuevaId : uomViejo;
    if (f) {
      enqueue("update stock_valuation_items set quantity = ?, replacement_unit_cost = ?, unit_of_measure_id = ? where id = ?",
        [cantidad8(toNum(v.qty) / f), costo4(toNum(v.ruc) * f), nuevoUom, Number(v.id)]);
      valEscaladas++;
    } else if (destino) {
      enqueue("update stock_valuation_items set unit_of_measure_id = ? where id = ?", [nuevoUom, Number(v.id)]);
      valRepuntadas++;
    }
  }
  console.log(`── 6. Valorizaciones de stock: ${valEscaladas} re-escaladas, ${valRepuntadas} solo cambian de unidad  (totales intactos)`);

  // ── 7. Decomisos ────────────────────────────────────────────────────────────
  const dec = (await db.execute(`
    select id, supply_id, cast(cantidad as real) as qty, cast(unit_cost as real) as uc
      from decomisos where ${enLista("supply_id")}
  `)).rows;
  for (const d of dec) {
    const f = factorPorInsumo.get(Number(d.supply_id))!;
    enqueue("update decomisos set cantidad = ?, unit_cost = ? where id = ?", [cantidad8(toNum(d.qty) / f), costo4(toNum(d.uc) * f), Number(d.id)]);
  }
  console.log(`── 7. Decomisos: ${dec.length}  (valorizados intactos)`);

  // ── 8. Sub-recetas que rinden en gramos/mililitros ──────────────────────────
  // El rendimiento pasa a Kg/Lt y, con él, las cantidades con que las recetas madre la usan.
  // La escala (cantidad ÷ rendimiento) no cambia, así que el costo de la receta madre tampoco.
  const subs = (await db.execute(`
    select id, name, yield_unit, cast(useful_yield as real) as y
      from recipes where yield_unit is not null and trim(yield_unit) <> ''
  `)).rows;
  let subsConvertidas = 0;
  let subsIngredientes = 0;
  for (const r of subs) {
    const { canon, factor } = clasificarUnidad("", String(r.yield_unit));
    if (!canon) continue;
    const nuevaAbrev = CANONICAS.find((c) => c.key === canon)!.abbr;
    if (factor === 1) {
      if (String(r.yield_unit) !== nuevaAbrev) enqueue("update recipes set yield_unit = ? where id = ?", [nuevaAbrev, Number(r.id)]);
      continue;
    }
    enqueue("update recipes set yield_unit = ?, useful_yield = ? where id = ?", [nuevaAbrev, cantidad8(toNum(r.y) / factor), Number(r.id)]);
    subsConvertidas++;

    const usos = (await db.execute({
      sql: "select id, cast(quantity_total as real) as qt, cast(quantity_with_waste as real) as qw from recipe_ingredients where sub_recipe_id = ?",
      args: [Number(r.id)],
    })).rows;
    for (const u of usos) {
      enqueue("update recipe_ingredients set quantity_total = ?, quantity_with_waste = ? where id = ?",
        [cantidad8(toNum(u.qt) / factor), cantidad8(toNum(u.qw) / factor), Number(u.id)]);
      subsIngredientes++;
    }
  }
  console.log(`── 8. Sub-recetas con rendimiento en GR/ML: ${subsConvertidas}, usadas en ${subsIngredientes} ingrediente(s)`);

  // ── 9. Desactivar lo que sobra del catálogo ─────────────────────────────────
  for (const u of aDesactivar) enqueue("update units_of_measure set active = 0 where id = ?", [u.id]);
  console.log(`\n── 9. Unidades a desactivar: ${aDesactivar.length}`);
  for (const u of aDesactivar) console.log(`   ${u.cliente}: #${u.id} ${u.name}`);

  // ── Ejecución y verificación ────────────────────────────────────────────────
  console.log(`\n${"=".repeat(96)}`);
  console.log(`Sentencias preparadas: ${pendientes.length}`);

  if (!APPLY) {
    console.log("\nSIMULACRO: no se escribió nada.");
    console.log("Para verificar el invariante hay que escribir: ensayá sobre una copia con --db=<archivo> --apply.");
    return;
  }

  await ejecutarPendientes();

  const despues = await sacarFoto();
  console.log(`\n${"=".repeat(96)}`);
  console.log("VERIFICACIÓN DEL INVARIANTE");
  console.log("=".repeat(96));

  const cmp = (label: string, a: number, b: number) => {
    const ok = Math.abs(a - b) < 0.01;
    console.log(`  ${ok ? "OK  " : "MAL "} ${label.padEnd(34)} antes ${money(a).padStart(20)}   después ${money(b).padStart(20)}`);
    return ok;
  };

  let ok = true;
  ok = cmp("Subtotales de facturas", antes.facturas, despues.facturas) && ok;
  ok = cmp("Costo total de recetas (guardado)", antes.recetasTotal, despues.recetasTotal) && ok;
  ok = cmp("Valorizaciones de stock", antes.valorizaciones, despues.valorizaciones) && ok;
  ok = cmp("Decomisos valorizados", antes.decomisos, despues.decomisos) && ok;

  // La prueba de fuego: el costo recalculado de CADA receta, una por una.
  const movidas: Array<{ id: number; antes: number; despues: number }> = [];
  for (const [id, costoAntes] of antes.costoPorReceta) {
    const costoDespues = despues.costoPorReceta.get(id) ?? 0;
    const tolerancia = Math.max(0.01, Math.abs(costoAntes) * 1e-6);
    if (Math.abs(costoAntes - costoDespues) > tolerancia) movidas.push({ id, antes: costoAntes, despues: costoDespues });
  }
  if (movidas.length === 0) {
    console.log(`  OK   Costo recalculado de las ${antes.costoPorReceta.size} recetas: ninguna se movió`);
  } else {
    ok = false;
    console.log(`  MAL  ${movidas.length} receta(s) cambiaron de costo:`);
    for (const m of movidas.slice(0, 20)) {
      console.log(`         receta #${m.id}: ${money(m.antes)} → ${money(m.despues)}  (dif ${money(m.despues - m.antes)})`);
    }
  }

  console.log(`\n${ok ? "MIGRACIÓN OK: no se movió ni un peso." : "ATENCIÓN: hay diferencias. Restaurar desde el backup."}`);
  if (!ok) process.exitCode = 1;
}

await main();
