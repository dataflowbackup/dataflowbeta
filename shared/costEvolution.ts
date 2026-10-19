/**
 * Evolución de Costos (oct-2026) — cómo se movieron los precios de los insumos y, por arrastre,
 * el costo de las sub-recetas y los platos.
 *
 * La fuente es la línea de factura (`invoice_items`) fechada por la FECHA DE LA FACTURA, que es la
 * misma que usa el costeo de recetas para tomar el "último precio". `cost_history` no sirve para
 * esto: está fechado por el momento de la carga, y una factura de mayo cargada en julio aparece
 * como un precio de julio.
 *
 * Las sub-recetas y los platos NO tienen historial guardado. Se RECONSTRUYEN: el costo en una fecha
 * es la composición ACTUAL de la receta valorizada con el último precio de cada insumo a esa fecha.
 * Así la curva mide solo el efecto precio, sin que la mezclen cambios de gramaje (decisión del
 * usuario, 19-oct-2026).
 *
 * Todo es puro (sin base de datos) para que el servidor lo calcule y un script lo pueda verificar.
 */
import { explodeRecipes, type RecipeIngredientNode } from "./supplyMetrics";
import { computeRecipeMetrics } from "./recipePricing";

// ==========================================
// Entradas
// ==========================================

export type CostEvolutionGranularity = "month" | "week";

/** Una línea de factura con insumo, ya filtrada a facturas activas y sin notas de crédito. */
export interface CostPurchase {
  itemId: number;
  supplyId: number;
  /** Fecha de la factura, "YYYY-MM-DD". */
  date: string;
  unitPrice: number;
  quantity: number;
  amount: number;
  supplierId: number | null;
  supplierName: string | null;
  localId: number | null;
  localName: string | null;
  invoiceId: number;
  invoiceDisplay: string;
}

export interface CostSupplyMeta {
  id: number;
  name: string;
  unit: string | null;
  rubroId: number | null;
  rubroName: string | null;
  subRubroId: number | null;
  subRubroName: string | null;
  /** Costo de respaldo para insumos sin ninguna compra (último costo / CPP), igual que el costeo. */
  fallbackCost: number;
}

export interface CostRecipeMeta {
  id: number;
  name: string;
  recipeType: string;
  categoryId: number | null;
  categoryName: string | null;
  subcategoryId: number | null;
  subcategoryName: string | null;
  usefulYield: number | null;
  yieldUnit: string | null;
  /** Precio cobrado (con IVA). */
  grossPrice: number;
  removeIva: boolean;
  cmvIdeal: number | null;
  /** `recipes.total_cost` tal como lo dejó el costeo: para avisar si la reconstrucción no coincide. */
  storedTotalCost: number;
  active: boolean;
}

export interface CostEvolutionInput {
  purchases: CostPurchase[];
  supplies: CostSupplyMeta[];
  recipes: CostRecipeMeta[];
  ingredientsByRecipe: Map<number, RecipeIngredientNode[]>;
  dateFrom: string;
  dateTo: string;
  granularity: CostEvolutionGranularity;
  /** Si los precios sospechosos entran en los cálculos. Por defecto quedan afuera. */
  includeSuspicious: boolean;
  /** Filtros de la vista de insumos. El local se aplica antes, en la consulta. */
  supplierId?: number;
  rubroId?: number;
  subRubroId?: number;
  /** CMV % contra el que se marcan los platos que no tienen CMV ideal propio. */
  cmvObjetivo: number;
}

// ==========================================
// Salidas
// ==========================================

export interface CostBucket {
  key: string;
  label: string;
  start: string;
  end: string;
}

export interface SupplierPriceRow {
  supplierId: number | null;
  supplierName: string;
  purchases: number;
  quantity: number;
  amount: number;
  avgPrice: number | null;
  lastPrice: number;
  lastDate: string;
  minPrice: number;
  maxPrice: number;
}

export interface SupplyUsageRow {
  recipeId: number;
  recipeName: string;
  recipeType: string;
  /** Cantidad del insumo por unidad de la receta, sub-recetas explotadas. */
  quantity: number;
  /** Cuánto de la receta, en $, es este insumo hoy. */
  costNow: number;
  sharePct: number | null;
}

export interface SupplyEvolutionRow {
  supplyId: number;
  name: string;
  unit: string | null;
  rubroId: number | null;
  rubroName: string | null;
  subRubroName: string | null;
  basePrice: number | null;
  baseDate: string | null;
  /** true si el precio inicial es de una compra anterior al período (la comparación es completa). */
  baseFromBefore: boolean;
  lastPrice: number | null;
  lastDate: string | null;
  variationPct: number | null;
  minPrice: number | null;
  maxPrice: number | null;
  /** Salto más grande entre dos compras seguidas, en %. Es el "pico". */
  maxJumpPct: number | null;
  maxJumpDate: string | null;
  purchases: number;
  quantity: number;
  amount: number;
  /** Lo que se pagó de más (o de menos) contra el precio inicial: Σ (precio − inicial) × cantidad. */
  overcost: number;
  /** Precio promedio ponderado por período (null si no hubo compra en ese período). */
  series: Array<number | null>;
  suspiciousCount: number;
  usedInRecipes: number;
}

export interface RecipeDriverRow {
  supplyId: number;
  name: string;
  unit: string | null;
  quantity: number;
  priceBase: number;
  priceNow: number;
  variationPct: number | null;
  /** Cuánto de la suba de la receta explica este insumo, en $. */
  deltaCost: number;
}

export interface RecipeEvolutionRow {
  recipeId: number;
  name: string;
  recipeType: string;
  categoryName: string | null;
  subcategoryName: string | null;
  usefulYield: number | null;
  yieldUnit: string | null;
  costBase: number;
  costNow: number;
  /** Por unidad de rendimiento (sub-recetas con rendimiento cargado); si no, igual al total. */
  unitCostBase: number;
  unitCostNow: number;
  variationPct: number | null;
  series: number[];
  /** Insumo que más explica la suba (o la baja). */
  mainDriver: string | null;
  drivers: RecipeDriverRow[];
  /** Costo guardado en Carta. Si difiere >1% de `costNow` se avisa en pantalla. */
  storedTotalCost: number;
  storedDiffers: boolean;
  /** Platos: precio y CMV contra el mismo precio al inicio y hoy. */
  grossPrice: number | null;
  cmvBasePct: number | null;
  cmvNowPct: number | null;
  cmvTargetPct: number | null;
  cmvTargetIsOwn: boolean;
  overTarget: boolean;
  /** Insumos sin ningún precio conocido: la receta los costea en $0. */
  supplyWithoutPrice: number;
}

export interface SuspiciousPurchaseRow extends CostPurchase {
  supplyName: string;
  unit: string | null;
  medianPrice: number;
  /** Veces que el precio se aleja de la mediana del insumo (siempre ≥ 1). */
  factor: number;
  inPeriod: boolean;
}

export interface IndexPoint {
  key: string;
  label: string;
  general: number | null;
  [rubro: string]: number | string | null;
}

export interface CostEvolutionResult {
  period: { from: string; to: string; granularity: CostEvolutionGranularity };
  buckets: CostBucket[];
  includeSuspicious: boolean;
  totals: {
    /** Variación de la canasta ponderada por lo comprado (Laspeyres), en %. */
    basketVariationPct: number | null;
    suppliesWithPurchases: number;
    up: number;
    down: number;
    flat: number;
    amount: number;
    overcost: number;
    suspiciousInPeriod: number;
    platosOverTarget: number;
    platosWithPrice: number;
  };
  /** Índice base 100 general y de los rubros que más pesan. */
  index: IndexPoint[];
  indexRubros: string[];
  supplies: SupplyEvolutionRow[];
  subRecipes: RecipeEvolutionRow[];
  platos: RecipeEvolutionRow[];
  suspicious: SuspiciousPurchaseRow[];
  /** Detalle por proveedor y uso en recetas, por insumo (para la ficha). */
  suppliersBySupply: Record<number, SupplierPriceRow[]>;
  usageBySupply: Record<number, SupplyUsageRow[]>;
  cyclicRecipeIds: number[];
}

// ==========================================
// Fechas (strings "YYYY-MM-DD", aritmética en UTC para no correr días)
// ==========================================

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function toDate(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split("-").map((n) => parseInt(n, 10));
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
}

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const d = toDate(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return toIso(d);
}

function mondayOf(iso: string): string {
  const d = toDate(iso);
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + (day === 0 ? -6 : 1 - day));
  return toIso(d);
}

/** Períodos del gráfico. El primero y el último se recortan al rango pedido. */
export function buildBuckets(from: string, to: string, granularity: CostEvolutionGranularity): CostBucket[] {
  const out: CostBucket[] = [];
  if (!from || !to || from > to) return out;

  if (granularity === "week") {
    let start = mondayOf(from);
    while (start <= to && out.length < 400) {
      const end = addDays(start, 6);
      const [, m, d] = start.split("-");
      out.push({
        key: start,
        label: `${d}/${m}`,
        start: start < from ? from : start,
        end: end > to ? to : end,
      });
      start = addDays(start, 7);
    }
    return out;
  }

  let y = parseInt(from.slice(0, 4), 10);
  let m = parseInt(from.slice(5, 7), 10);
  while (out.length < 400) {
    const start = `${y}-${String(m).padStart(2, "0")}-01`;
    if (start > to) break;
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const end = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    out.push({
      key: start.slice(0, 7),
      label: `${MONTHS[m - 1]} ${String(y).slice(2)}`,
      start: start < from ? from : start,
      end: end > to ? to : end,
    });
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

// ==========================================
// Precios sospechosos
// ==========================================

/** Un precio que se aleja más de 3 veces de la mediana del insumo no es inflación: es un error de carga. */
export const SUSPICIOUS_FACTOR = 3;
/** Con menos compras no hay mediana confiable para decidir cuál de los precios está mal. */
const SUSPICIOUS_MIN_PURCHASES = 3;
/** Entre dos únicas compras, a partir de esta distancia es un error de escala y no un aumento. */
const SCALE_JUMP_FACTOR = 20;

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Marca las compras cuyo precio se aleja de la mediana del insumo. La mediana se toma sobre TODO el
 * historial (no solo el período), así un período corto no esconde un error.
 */
export function detectSuspicious(purchases: CostPurchase[]): Map<number, { medianPrice: number; factor: number }> {
  const bySupply = new Map<number, CostPurchase[]>();
  for (const p of purchases) {
    if (!(p.unitPrice > 0)) continue;
    const list = bySupply.get(p.supplyId);
    if (list) list.push(p);
    else bySupply.set(p.supplyId, [p]);
  }
  const out = new Map<number, { medianPrice: number; factor: number }>();
  for (const list of Array.from(bySupply.values())) {
    if (list.length < SUSPICIOUS_MIN_PURCHASES) {
      // Con una o dos compras no se sabe cuál está mal, pero un salto de escala (×20 o más: kilo
      // contra gramo, caja contra unidad) no es un precio comparable. Se marcan las dos.
      if (list.length === 2) {
        const [a, b] = list;
        const factor = Math.max(a.unitPrice, b.unitPrice) / Math.min(a.unitPrice, b.unitPrice);
        if (factor >= SCALE_JUMP_FACTOR) {
          const med = (a.unitPrice + b.unitPrice) / 2;
          out.set(a.itemId, { medianPrice: med, factor });
          out.set(b.itemId, { medianPrice: med, factor });
        }
      }
      continue;
    }
    const med = median(list.map((p) => p.unitPrice));
    if (!(med > 0)) continue;
    for (const p of list) {
      const factor = Math.max(p.unitPrice / med, med / p.unitPrice);
      if (factor > SUSPICIOUS_FACTOR) out.set(p.itemId, { medianPrice: med, factor });
    }
  }
  return out;
}

// ==========================================
// Cálculo principal
// ==========================================

const round = (n: number, d = 4) => {
  const f = 10 ** d;
  return Math.round(n * f) / f;
};

const pct = (now: number | null, base: number | null) =>
  now != null && base != null && base > 0 ? (now / base - 1) * 100 : null;

/** Orden cronológico estable: fecha y, dentro del día, el orden de carga. */
const byDate = (a: CostPurchase, b: CostPurchase) =>
  a.date < b.date ? -1 : a.date > b.date ? 1 : a.itemId - b.itemId;

/**
 * Último precio conocido de un insumo a una fecha. Sin compras previas toma la primera conocida
 * (si no, la receta arrancaría en $0 y la "suba" sería infinita), y sin ninguna, el de respaldo.
 */
function priceAt(list: CostPurchase[] | undefined, date: string, fallback: number): number {
  if (!list || list.length === 0) return fallback;
  let found: number | null = null;
  for (const p of list) {
    if (p.date <= date) found = p.unitPrice;
    else break;
  }
  return found ?? list[0].unitPrice;
}

export function computeCostEvolution(input: CostEvolutionInput): CostEvolutionResult {
  const { dateFrom, dateTo } = input;
  const buckets = buildBuckets(dateFrom, dateTo, input.granularity);
  const supplyById = new Map(input.supplies.map((s) => [s.id, s]));

  // ── Sospechosos ──
  const suspiciousMap = detectSuspicious(input.purchases);
  const suspicious: SuspiciousPurchaseRow[] = [];
  for (const p of input.purchases) {
    const s = suspiciousMap.get(p.itemId);
    if (!s) continue;
    const meta = supplyById.get(p.supplyId);
    suspicious.push({
      ...p,
      supplyName: meta?.name ?? "(insumo eliminado)",
      unit: meta?.unit ?? null,
      medianPrice: s.medianPrice,
      factor: s.factor,
      inPeriod: p.date >= dateFrom && p.date <= dateTo,
    });
  }
  suspicious.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.factor - a.factor));

  const valid = input.purchases
    .filter((p) => p.unitPrice > 0 && (input.includeSuspicious || !suspiciousMap.has(p.itemId)))
    .sort(byDate);

  // Todas las compras válidas por insumo (todos los proveedores): base de la reconstrucción.
  const allBySupply = new Map<number, CostPurchase[]>();
  for (const p of valid) {
    const list = allBySupply.get(p.supplyId);
    if (list) list.push(p);
    else allBySupply.set(p.supplyId, [p]);
  }

  // ── Recetas explotadas (para el uso de cada insumo y la reconstrucción) ──
  const usefulYieldByRecipe = new Map<number, number | null>(input.recipes.map((r) => [r.id, r.usefulYield]));
  const { byRecipe, cyclicRecipeIds } = explodeRecipes(input.ingredientsByRecipe, usefulYieldByRecipe);
  const recipeById = new Map(input.recipes.map((r) => [r.id, r]));
  const fallbackOf = (supplyId: number) => supplyById.get(supplyId)?.fallbackCost ?? 0;
  const nowPrice = (supplyId: number) => priceAt(allBySupply.get(supplyId), dateTo, fallbackOf(supplyId));
  const basePriceAt = (supplyId: number) =>
    priceAt(allBySupply.get(supplyId), addDays(dateFrom, -1), fallbackOf(supplyId));

  const usageBySupply: Record<number, SupplyUsageRow[]> = {};
  const recipeCostNow = new Map<number, number>();
  for (const [recipeId, lines] of Array.from(byRecipe.entries())) {
    const total = lines.reduce((acc, l) => acc + l.quantityTotal * nowPrice(l.supplyId), 0);
    recipeCostNow.set(recipeId, total);
  }
  for (const [recipeId, lines] of Array.from(byRecipe.entries())) {
    const r = recipeById.get(recipeId);
    if (!r || !r.active) continue;
    const total = recipeCostNow.get(recipeId) ?? 0;
    for (const l of lines) {
      const costNow = l.quantityTotal * nowPrice(l.supplyId);
      (usageBySupply[l.supplyId] ??= []).push({
        recipeId,
        recipeName: r.name,
        recipeType: r.recipeType,
        quantity: round(l.quantityTotal, 6),
        costNow: round(costNow, 2),
        sharePct: total > 0 ? round((costNow / total) * 100, 2) : null,
      });
    }
  }
  for (const list of Object.values(usageBySupply)) list.sort((a, b) => (b.sharePct ?? 0) - (a.sharePct ?? 0));

  // ── Insumos ──
  const supplyPasses = (s: CostSupplyMeta | undefined) => {
    if (!s) return false;
    if (input.rubroId != null && s.rubroId !== input.rubroId) return false;
    if (input.subRubroId != null && s.subRubroId !== input.subRubroId) return false;
    return true;
  };

  // Para la vista de insumos el proveedor sí filtra: "cómo me subió X este proveedor".
  const viewBySupply = new Map<number, CostPurchase[]>();
  for (const p of valid) {
    if (input.supplierId != null && p.supplierId !== input.supplierId) continue;
    if (!supplyPasses(supplyById.get(p.supplyId))) continue;
    const list = viewBySupply.get(p.supplyId);
    if (list) list.push(p);
    else viewBySupply.set(p.supplyId, [p]);
  }

  const suppliersBySupply: Record<number, SupplierPriceRow[]> = {};
  const supplyRows: SupplyEvolutionRow[] = [];
  const bucketOf = (date: string) => buckets.findIndex((b) => date >= b.start && date <= b.end);

  for (const [supplyId, list] of Array.from(viewBySupply.entries())) {
    const meta = supplyById.get(supplyId);
    if (!meta) continue;
    const before = list.filter((p) => p.date < dateFrom);
    const inPeriod = list.filter((p) => p.date >= dateFrom && p.date <= dateTo);
    if (inPeriod.length === 0) continue;

    const baseP = before.length > 0 ? before[before.length - 1] : inPeriod[0];
    const lastP = inPeriod[inPeriod.length - 1];
    const basePrice = baseP.unitPrice;

    let quantity = 0;
    let amount = 0;
    let overcost = 0;
    let minPrice = Infinity;
    let maxPrice = -Infinity;
    let maxJumpPct: number | null = null;
    let maxJumpDate: string | null = null;
    let prev = before.length > 0 ? before[before.length - 1].unitPrice : null;
    const sums = buckets.map(() => ({ q: 0, a: 0 }));

    for (const p of inPeriod) {
      quantity += p.quantity;
      amount += p.amount;
      overcost += (p.unitPrice - basePrice) * p.quantity;
      minPrice = Math.min(minPrice, p.unitPrice);
      maxPrice = Math.max(maxPrice, p.unitPrice);
      if (prev != null && prev > 0) {
        const jump = (p.unitPrice / prev - 1) * 100;
        if (maxJumpPct == null || Math.abs(jump) > Math.abs(maxJumpPct)) {
          maxJumpPct = jump;
          maxJumpDate = p.date;
        }
      }
      prev = p.unitPrice;
      const bi = bucketOf(p.date);
      if (bi >= 0) {
        sums[bi].q += p.quantity;
        sums[bi].a += p.amount;
      }
    }

    const susp = suspicious.filter((s) => s.supplyId === supplyId && s.inPeriod).length;
    supplyRows.push({
      supplyId,
      name: meta.name,
      unit: meta.unit,
      rubroId: meta.rubroId,
      rubroName: meta.rubroName,
      subRubroName: meta.subRubroName,
      basePrice: round(basePrice),
      baseDate: baseP.date,
      baseFromBefore: before.length > 0,
      lastPrice: round(lastP.unitPrice),
      lastDate: lastP.date,
      variationPct: pct(lastP.unitPrice, basePrice),
      minPrice: round(minPrice),
      maxPrice: round(maxPrice),
      maxJumpPct,
      maxJumpDate,
      purchases: inPeriod.length,
      quantity: round(quantity, 6),
      amount: round(amount, 2),
      overcost: round(overcost, 2),
      // Promedio ponderado del período: cantidad × precio, no el promedio simple.
      series: sums.map((s) => (s.q > 0 ? round(s.a / s.q) : null)),
      suspiciousCount: susp,
      usedInRecipes: usageBySupply[supplyId]?.length ?? 0,
    });

    // Proveedores del insumo (en el período, con el filtro de proveedor ya aplicado arriba).
    const bySupplier = new Map<string, SupplierPriceRow>();
    for (const p of inPeriod) {
      const k = String(p.supplierId ?? "none");
      const cur = bySupplier.get(k);
      if (cur) {
        cur.purchases++;
        cur.quantity += p.quantity;
        cur.amount += p.amount;
        cur.lastPrice = p.unitPrice;
        cur.lastDate = p.date;
        cur.minPrice = Math.min(cur.minPrice, p.unitPrice);
        cur.maxPrice = Math.max(cur.maxPrice, p.unitPrice);
      } else {
        bySupplier.set(k, {
          supplierId: p.supplierId,
          supplierName: p.supplierName ?? "(sin proveedor)",
          purchases: 1,
          quantity: p.quantity,
          amount: p.amount,
          avgPrice: null,
          lastPrice: p.unitPrice,
          lastDate: p.date,
          minPrice: p.unitPrice,
          maxPrice: p.unitPrice,
        });
      }
    }
    suppliersBySupply[supplyId] = Array.from(bySupplier.values())
      .map((r) => ({ ...r, avgPrice: r.quantity > 0 ? round(r.amount / r.quantity) : null }))
      .sort((a, b) => (a.avgPrice ?? Infinity) - (b.avgPrice ?? Infinity));
  }
  supplyRows.sort((a, b) => (b.variationPct ?? -Infinity) - (a.variationPct ?? -Infinity));

  // ── Índice base 100 (Laspeyres: pesa cada insumo por lo que se le compró en el período) ──
  const weighted = supplyRows.filter((r) => r.basePrice != null && r.basePrice > 0 && r.amount > 0);
  const totalAmount = weighted.reduce((acc, r) => acc + r.amount, 0);

  const priceEndOfBucket = (supplyId: number, end: string, base: number) => {
    const list = viewBySupply.get(supplyId) ?? [];
    let found: number | null = null;
    for (const p of list) {
      if (p.date <= end) found = p.unitPrice;
      else break;
    }
    // Antes de la primera compra del período, el insumo vale su precio inicial.
    return found ?? base;
  };

  const rubroAmount = new Map<string, number>();
  for (const r of weighted) {
    const k = r.rubroName ?? "Sin rubro";
    rubroAmount.set(k, (rubroAmount.get(k) ?? 0) + r.amount);
  }
  const indexRubros = Array.from(rubroAmount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k]) => k);

  const index: IndexPoint[] = buckets.map((b) => {
    const point: IndexPoint = { key: b.key, label: b.label, general: null };
    if (totalAmount > 0) {
      let acc = 0;
      const byRubro = new Map<string, { acc: number; w: number }>();
      for (const r of weighted) {
        const rel = priceEndOfBucket(r.supplyId, b.end, r.basePrice!) / r.basePrice!;
        acc += (r.amount / totalAmount) * rel;
        const k = r.rubroName ?? "Sin rubro";
        if (indexRubros.includes(k)) {
          const cur = byRubro.get(k) ?? { acc: 0, w: 0 };
          cur.acc += r.amount * rel;
          cur.w += r.amount;
          byRubro.set(k, cur);
        }
      }
      point.general = round(acc * 100, 2);
      for (const k of indexRubros) {
        const v = byRubro.get(k);
        point[k] = v && v.w > 0 ? round((v.acc / v.w) * 100, 2) : null;
      }
    }
    return point;
  });

  const lastIndex = index.length > 0 ? index[index.length - 1].general : null;

  // ── Sub-recetas y platos (reconstruidos) ──
  const subRecipes: RecipeEvolutionRow[] = [];
  const platos: RecipeEvolutionRow[] = [];

  for (const r of input.recipes) {
    if (!r.active) continue;
    const lines = byRecipe.get(r.id) ?? [];
    if (lines.length === 0) continue;

    const costAt = (date: string) =>
      lines.reduce((acc, l) => acc + l.quantityTotal * priceAt(allBySupply.get(l.supplyId), date, fallbackOf(l.supplyId)), 0);

    const costBase = lines.reduce((acc, l) => acc + l.quantityTotal * basePriceAt(l.supplyId), 0);
    const costNow = recipeCostNow.get(r.id) ?? 0;
    const series = buckets.map((b) => round(costAt(b.end), 2));
    const y = r.usefulYield != null && r.usefulYield > 0 ? r.usefulYield : null;
    const isSub = r.recipeType !== "plato";

    const drivers: RecipeDriverRow[] = lines
      .map((l) => {
        const meta = supplyById.get(l.supplyId);
        const priceBase = basePriceAt(l.supplyId);
        const priceNow = nowPrice(l.supplyId);
        return {
          supplyId: l.supplyId,
          name: meta?.name ?? "(insumo eliminado)",
          unit: meta?.unit ?? null,
          quantity: round(l.quantityTotal, 6),
          priceBase: round(priceBase),
          priceNow: round(priceNow),
          variationPct: pct(priceNow, priceBase),
          deltaCost: round(l.quantityTotal * (priceNow - priceBase), 2),
        };
      })
      .sort((a, b) => Math.abs(b.deltaCost) - Math.abs(a.deltaCost));

    const delta = costNow - costBase;
    const main = drivers.find((d) => Math.abs(d.deltaCost) > 0.005 && Math.sign(d.deltaCost) === Math.sign(delta));

    let grossPrice: number | null = null;
    let cmvBasePct: number | null = null;
    let cmvNowPct: number | null = null;
    let cmvTargetPct: number | null = null;
    let overTarget = false;
    if (!isSub && r.grossPrice > 0) {
      grossPrice = r.grossPrice;
      cmvBasePct = computeRecipeMetrics({ grossPrice, totalCost: costBase, removeIva: r.removeIva }).cmvPercentage;
      cmvNowPct = computeRecipeMetrics({ grossPrice, totalCost: costNow, removeIva: r.removeIva }).cmvPercentage;
      cmvTargetPct = r.cmvIdeal != null && r.cmvIdeal > 0 ? r.cmvIdeal : input.cmvObjetivo;
      overTarget = cmvNowPct > cmvTargetPct;
    }

    const row: RecipeEvolutionRow = {
      recipeId: r.id,
      name: r.name,
      recipeType: r.recipeType,
      categoryName: r.categoryName,
      subcategoryName: r.subcategoryName,
      usefulYield: r.usefulYield,
      yieldUnit: r.yieldUnit,
      costBase: round(costBase, 2),
      costNow: round(costNow, 2),
      unitCostBase: round(isSub && y ? costBase / y : costBase, 2),
      unitCostNow: round(isSub && y ? costNow / y : costNow, 2),
      variationPct: pct(costNow, costBase),
      series,
      mainDriver: main?.name ?? null,
      drivers,
      storedTotalCost: round(r.storedTotalCost, 2),
      storedDiffers:
        r.storedTotalCost > 0 ? Math.abs(costNow - r.storedTotalCost) / r.storedTotalCost > 0.01 : costNow > 0.005,
      grossPrice,
      cmvBasePct: cmvBasePct != null ? round(cmvBasePct, 2) : null,
      cmvNowPct: cmvNowPct != null ? round(cmvNowPct, 2) : null,
      cmvTargetPct,
      cmvTargetIsOwn: r.cmvIdeal != null && r.cmvIdeal > 0,
      overTarget,
      supplyWithoutPrice: lines.filter((l) => !allBySupply.has(l.supplyId) && fallbackOf(l.supplyId) <= 0).length,
    };
    (isSub ? subRecipes : platos).push(row);
  }

  const byVariation = (a: RecipeEvolutionRow, b: RecipeEvolutionRow) =>
    (b.variationPct ?? -Infinity) - (a.variationPct ?? -Infinity);
  subRecipes.sort(byVariation);
  platos.sort(byVariation);

  const withVar = supplyRows.filter((r) => r.variationPct != null);
  const FLAT = 0.5; // ±0,5% es "sin cambio": redondeos de factura

  return {
    period: { from: dateFrom, to: dateTo, granularity: input.granularity },
    buckets,
    includeSuspicious: input.includeSuspicious,
    totals: {
      basketVariationPct: lastIndex != null ? round(lastIndex - 100, 2) : null,
      suppliesWithPurchases: supplyRows.length,
      up: withVar.filter((r) => r.variationPct! > FLAT).length,
      down: withVar.filter((r) => r.variationPct! < -FLAT).length,
      flat: withVar.filter((r) => Math.abs(r.variationPct!) <= FLAT).length,
      amount: round(supplyRows.reduce((acc, r) => acc + r.amount, 0), 2),
      overcost: round(supplyRows.reduce((acc, r) => acc + r.overcost, 0), 2),
      suspiciousInPeriod: suspicious.filter((s) => s.inPeriod).length,
      platosOverTarget: platos.filter((p) => p.overTarget).length,
      platosWithPrice: platos.filter((p) => p.grossPrice != null).length,
    },
    index,
    indexRubros,
    supplies: supplyRows,
    subRecipes,
    platos,
    suspicious,
    suppliersBySupply,
    usageBySupply,
    cyclicRecipeIds,
  };
}
