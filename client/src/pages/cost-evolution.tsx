/**
 * Evolución de Costos (oct-2026) — reemplaza a "Historial Costos".
 *
 * Cómo se movieron los precios de compra de los insumos y, por arrastre, el costo de las
 * sub-recetas y los platos. El cálculo vive en `shared/costEvolution.ts`; esta pantalla solo
 * filtra, ordena, grafica y exporta.
 *
 * Los precios que se alejan más de 3 veces del habitual del insumo (errores de carga, compras en
 * otra escala) quedan FUERA de los cálculos por defecto y se listan con link a la factura.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { usePersistentFilter } from "@/hooks/usePersistentFilter";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DataEntryCombobox } from "@/components/data-entry-combobox";
import { DateRangePicker } from "@/components/date-range-picker";
import { formatCurrency } from "@/lib/formatters";
import { exportToExcel, exportToPdf, type ExportInput } from "@/lib/table-export";
import {
  LineChart as LineChartIcon,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  FileDown,
  FileSpreadsheet,
  ArrowUpDown,
  ExternalLink,
  Search,
} from "lucide-react";
import type { Local, Supplier, Rubro, SubRubro } from "@shared/schema";
import type {
  CostPurchase,
  CostEvolutionResult,
  RecipeEvolutionRow,
  SupplyEvolutionRow,
  SuspiciousPurchaseRow,
} from "@shared/costEvolution";

// ─── Fechas ───────────────────────────────────────────────────────────────────
// En hora local: `toISOString()` corre un día para atrás en Argentina.

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type PresetKey = "3m" | "6m" | "12m" | "anio" | "custom";

const PRESET_OPTIONS = [
  { value: "3m", label: "Últimos 3 meses" },
  { value: "6m", label: "Últimos 6 meses" },
  { value: "12m", label: "Últimos 12 meses" },
  { value: "anio", label: "Año actual" },
  { value: "custom", label: "Personalizado" },
];

function presetRange(preset: PresetKey): { from: string; to: string } | null {
  const now = new Date();
  const back = (months: number) => ymd(new Date(now.getFullYear(), now.getMonth() - (months - 1), 1));
  if (preset === "3m") return { from: back(3), to: ymd(now) };
  if (preset === "6m") return { from: back(6), to: ymd(now) };
  if (preset === "12m") return { from: back(12), to: ymd(now) };
  if (preset === "anio") return { from: `${now.getFullYear()}-01-01`, to: ymd(now) };
  return null;
}

const fmtDate = (iso: string | null | undefined) => {
  const [y, m, d] = String(iso ?? "").slice(0, 10).split("-");
  return y && m && d ? `${d}/${m}/${y}` : "—";
};
const fmtSigned = (v: number | null | undefined, d = 1) =>
  v == null ? "—" : `${v >= 0 ? "+" : ""}${new Intl.NumberFormat("es-AR", { minimumFractionDigits: d, maximumFractionDigits: d }).format(v)}%`;
const fmtPct = (v: number | null | undefined, d = 1) =>
  v == null ? "—" : `${new Intl.NumberFormat("es-AR", { minimumFractionDigits: d, maximumFractionDigits: d }).format(v)}%`;
const fmtNum = (v: number, d = 0) =>
  new Intl.NumberFormat("es-AR", { minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
const fmtQty = (v: number) => new Intl.NumberFormat("es-AR", { maximumFractionDigits: 3 }).format(v);

const money = (v: number | null | undefined) => (v == null ? "—" : formatCurrency(v));

/** Suba en rojo (encarece), baja en verde. Al revés que en ventas. */
const varTone = (v: number | null | undefined) =>
  v == null || Math.abs(v) <= 0.5
    ? "text-muted-foreground"
    : v > 0
      ? "text-destructive"
      : "text-emerald-600 dark:text-emerald-500";

const LINE_COLORS = ["#2563eb", "#d97706", "#059669", "#7c3aed", "#db2777"];

// ─── Piezas de UI ─────────────────────────────────────────────────────────────

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "warn" | "good" | "bad";
}) {
  const toneClass =
    tone === "warn"
      ? "text-amber-700 dark:text-amber-500"
      : tone === "good"
        ? "text-emerald-700 dark:text-emerald-500"
        : tone === "bad"
          ? "text-destructive"
          : "";
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`${value.length > 13 ? "text-base" : "text-xl"} font-bold font-mono ${toneClass}`}>{value}</p>
      {hint && <p className="text-[11px] text-muted-foreground pt-0.5">{hint}</p>}
    </div>
  );
}

function Variation({ value }: { value: number | null | undefined }) {
  if (value == null) return <span className="text-muted-foreground">—</span>;
  const up = value > 0.5;
  const down = value < -0.5;
  return (
    <span className={`inline-flex items-center gap-1 font-mono font-medium ${varTone(value)}`}>
      {up && <TrendingUp className="h-3.5 w-3.5" />}
      {down && <TrendingDown className="h-3.5 w-3.5" />}
      {fmtSigned(value)}
    </span>
  );
}

/** Mini gráfico en SVG: con cientos de filas, un gráfico de recharts por fila pesa demasiado. */
function Sparkline({ values }: { values: Array<number | null> }) {
  const pts = values.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v != null);
  if (pts.length < 2) return <span className="text-[10px] text-muted-foreground">—</span>;
  const W = 84;
  const H = 22;
  const min = Math.min(...pts.map((p) => p.v));
  const max = Math.max(...pts.map((p) => p.v));
  const span = max - min || 1;
  const n = Math.max(values.length - 1, 1);
  const path = pts
    .map((p, k) => `${k === 0 ? "M" : "L"}${((p.i / n) * (W - 4) + 2).toFixed(1)},${(H - 2 - ((p.v - min) / span) * (H - 4)).toFixed(1)}`)
    .join(" ");
  const first = pts[0].v;
  const last = pts[pts.length - 1].v;
  const color = last > first * 1.005 ? "hsl(var(--destructive))" : last < first * 0.995 ? "#059669" : "hsl(var(--muted-foreground))";
  return (
    <svg width={W} height={H} className="inline-block align-middle" aria-hidden>
      <path d={path} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

type SortDir = "asc" | "desc";

function useSort<K extends string>(initial: K, dir: SortDir = "desc") {
  const [key, setKey] = useState<K>(initial);
  const [direction, setDirection] = useState<SortDir>(dir);
  const toggle = (k: K) => {
    if (k === key) setDirection(direction === "desc" ? "asc" : "desc");
    else {
      setKey(k);
      setDirection("desc");
    }
  };
  return { key, direction, toggle };
}

function sortRows<T>(rows: T[], get: (r: T) => number | string | null | undefined, direction: SortDir): T[] {
  const mult = direction === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => {
    const va = get(a);
    const vb = get(b);
    // Los vacíos siempre al final, ordene como ordene.
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    if (typeof va === "string" || typeof vb === "string") return String(va).localeCompare(String(vb), "es") * mult;
    return (va - vb) * mult;
  });
}

function Th({
  label,
  sortKey,
  sort,
  align = "right",
  className = "",
}: {
  label: string;
  sortKey?: string;
  sort?: { key: string; direction: SortDir; toggle: (k: any) => void };
  align?: "left" | "right";
  className?: string;
}) {
  const active = sort && sortKey && sort.key === sortKey;
  return (
    <th className={`font-medium py-2 px-1 ${align === "left" ? "text-left" : "text-right"} ${className}`}>
      {sortKey && sort ? (
        <button
          type="button"
          onClick={() => sort.toggle(sortKey)}
          className={`inline-flex items-center gap-1 hover:text-foreground ${active ? "text-foreground" : ""}`}
        >
          {label}
          <ArrowUpDown className="h-3 w-3 opacity-60" />
        </button>
      ) : (
        label
      )}
    </th>
  );
}

const PAGE = 60;

function ShowMore({ total, shown, onMore }: { total: number; shown: number; onMore: () => void }) {
  if (shown >= total) return null;
  return (
    <div className="flex justify-center pt-3">
      <Button variant="outline" size="sm" onClick={onMore}>
        Ver más ({fmtNum(total - shown)} restantes)
      </Button>
    </div>
  );
}

// ─── Página ───────────────────────────────────────────────────────────────────

type DetailTarget =
  | { kind: "supply"; row: SupplyEvolutionRow }
  | { kind: "recipe"; row: RecipeEvolutionRow };

export default function CostEvolutionPage() {
  const [preset, setPreset] = usePersistentFilter<PresetKey>("costEvo.preset", "6m");
  const [dateFrom, setDateFrom] = usePersistentFilter("costEvo.dateFrom", presetRange("6m")!.from);
  const [dateTo, setDateTo] = usePersistentFilter("costEvo.dateTo", presetRange("6m")!.to);
  const [granularity, setGranularity] = usePersistentFilter<"month" | "week">("costEvo.granularity", "month");
  const [localId, setLocalId] = usePersistentFilter("costEvo.localId", "all");
  const [supplierId, setSupplierId] = usePersistentFilter("costEvo.supplierId", "all");
  const [rubroId, setRubroId] = usePersistentFilter("costEvo.rubroId", "all");
  const [subRubroId, setSubRubroId] = usePersistentFilter("costEvo.subRubroId", "all");
  const [includeSuspicious, setIncludeSuspicious] = usePersistentFilter("costEvo.includeSuspicious", false);
  const [cmvObjetivo, setCmvObjetivo] = usePersistentFilter("costEvo.cmvObjetivo", 35);
  const [inflacion, setInflacion] = usePersistentFilter<string>("costEvo.inflacion", "");
  const [tab, setTab] = usePersistentFilter("costEvo.tab", "insumos");
  const [rankingMode, setRankingMode] = usePersistentFilter<"pct" | "pesos">("costEvo.rankingMode", "pct");
  const [search, setSearch] = usePersistentFilter("costEvo.search", "");
  const [showRubros, setShowRubros] = usePersistentFilter("costEvo.showRubros", true);
  const [onlyOverTarget, setOnlyOverTarget] = usePersistentFilter("costEvo.onlyOverTarget", false);
  const [onlySuspInPeriod, setOnlySuspInPeriod] = usePersistentFilter("costEvo.onlySuspInPeriod", true);

  const [detail, setDetail] = useState<DetailTarget | null>(null);
  const [limits, setLimits] = useState({ insumos: PAGE, sub: PAGE, platos: PAGE, susp: PAGE });

  const { data: locals = [] } = useQuery<Local[]>({ queryKey: ["/api/locals"] });
  const { data: suppliersList = [] } = useQuery<Supplier[]>({ queryKey: ["/api/suppliers"] });
  const { data: rubrosList = [] } = useQuery<Rubro[]>({ queryKey: ["/api/rubros"] });
  const { data: subRubrosList = [] } = useQuery<SubRubro[]>({ queryKey: ["/api/sub-rubros"] });

  const applyPreset = (next: PresetKey) => {
    setPreset(next);
    const range = presetRange(next);
    if (range) {
      setDateFrom(range.from);
      setDateTo(range.to);
    }
  };

  const ready = !!(dateFrom && dateTo);
  const params = useMemo(() => {
    const p = new URLSearchParams();
    p.set("dateFrom", dateFrom);
    p.set("dateTo", dateTo);
    p.set("granularity", granularity);
    p.set("includeSuspicious", String(includeSuspicious));
    p.set("cmvObjetivo", String(cmvObjetivo || 35));
    if (localId !== "all") p.set("localId", localId);
    if (supplierId !== "all") p.set("supplierId", supplierId);
    if (rubroId !== "all") p.set("rubroId", rubroId);
    if (subRubroId !== "all") p.set("subRubroId", subRubroId);
    return p.toString();
  }, [dateFrom, dateTo, granularity, includeSuspicious, cmvObjetivo, localId, supplierId, rubroId, subRubroId]);

  const { data, isLoading, isError, error } = useQuery<CostEvolutionResult>({
    queryKey: ["/api/cost-evolution", params],
    enabled: ready,
    queryFn: async () => {
      const res = await fetch(`/api/cost-evolution?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.message || "Error al calcular");
      return res.json();
    },
  });

  const localOptions = useMemo(
    () => [{ value: "all", label: "Todos los locales" }, ...locals.map((l) => ({ value: String(l.id), label: l.name }))],
    [locals],
  );
  const supplierOptions = useMemo(
    () => [
      { value: "all", label: "Todos los proveedores" },
      ...[...suppliersList]
        .sort((a, b) => a.tradeName.localeCompare(b.tradeName, "es"))
        .map((s) => ({ value: String(s.id), label: s.tradeName })),
    ],
    [suppliersList],
  );
  const rubroOptions = useMemo(
    () => [
      { value: "all", label: "Todos los rubros" },
      ...[...rubrosList]
        .sort((a, b) => a.name.localeCompare(b.name, "es"))
        .map((r) => ({ value: String(r.id), label: r.name })),
    ],
    [rubrosList],
  );
  const subRubroOptions = useMemo(
    () => [
      { value: "all", label: "Todos los sub-rubros" },
      ...subRubrosList
        .filter((s) => rubroId === "all" || String(s.rubroId) === rubroId)
        .sort((a, b) => a.name.localeCompare(b.name, "es"))
        .map((s) => ({ value: String(s.id), label: s.name })),
    ],
    [subRubrosList, rubroId],
  );

  const inflacionNum = useMemo(() => {
    const n = parseFloat(String(inflacion).replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }, [inflacion]);

  const q = search.trim().toLowerCase();
  const matches = (...parts: Array<string | null | undefined>) =>
    !q || parts.some((p) => String(p ?? "").toLowerCase().includes(q));

  // ── Insumos ──
  const supplySort = useSort<"name" | "base" | "last" | "var" | "jump" | "purchases" | "amount" | "overcost">("var");
  const supplyRows = useMemo(() => {
    if (!data) return [];
    const rows = data.supplies.filter((r) => matches(r.name, r.rubroName, r.subRubroName));
    const get = (r: SupplyEvolutionRow) => {
      switch (supplySort.key) {
        case "name":
          return r.name;
        case "base":
          return r.basePrice;
        case "last":
          return r.lastPrice;
        case "jump":
          return r.maxJumpPct != null ? Math.abs(r.maxJumpPct) : null;
        case "purchases":
          return r.purchases;
        case "amount":
          return r.amount;
        case "overcost":
          return r.overcost;
        default:
          return r.variationPct;
      }
    };
    return sortRows(rows, get, supplySort.direction);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, q, supplySort.key, supplySort.direction]);

  // ── Sub-recetas y platos ──
  const subSort = useSort<"name" | "base" | "now" | "var">("var");
  const platoSort = useSort<"name" | "base" | "now" | "var" | "price" | "cmvBase" | "cmvNow">("var");
  const sortRecipe = (rows: RecipeEvolutionRow[], key: string, dir: SortDir, perUnit: boolean) =>
    sortRows(
      rows,
      (r) => {
        switch (key) {
          case "name":
            return r.name;
          case "base":
            return perUnit ? r.unitCostBase : r.costBase;
          case "now":
            return perUnit ? r.unitCostNow : r.costNow;
          case "price":
            return r.grossPrice;
          case "cmvBase":
            return r.cmvBasePct;
          case "cmvNow":
            return r.cmvNowPct;
          default:
            return r.variationPct;
        }
      },
      dir,
    );
  const subRows = useMemo(
    () =>
      data
        ? sortRecipe(
            data.subRecipes.filter((r) => matches(r.name, r.categoryName, r.mainDriver)),
            subSort.key,
            subSort.direction,
            true,
          )
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, q, subSort.key, subSort.direction],
  );
  const platoRows = useMemo(
    () =>
      data
        ? sortRecipe(
            data.platos.filter((r) => (!onlyOverTarget || r.overTarget) && matches(r.name, r.categoryName, r.subcategoryName, r.mainDriver)),
            platoSort.key,
            platoSort.direction,
            false,
          )
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, q, onlyOverTarget, platoSort.key, platoSort.direction],
  );

  // ── Sospechosos ──
  const suspRows = useMemo(
    () =>
      data
        ? data.suspicious.filter(
            (s) => (!onlySuspInPeriod || s.inPeriod) && matches(s.supplyName, s.supplierName, s.invoiceDisplay),
          )
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, q, onlySuspInPeriod],
  );

  // ── Ranking (gráfico de barras) ──
  const ranking = useMemo(() => {
    if (!data) return [];
    const rows =
      rankingMode === "pct"
        ? data.supplies.filter((r) => r.variationPct != null && r.variationPct > 0.5).sort((a, b) => b.variationPct! - a.variationPct!)
        : data.supplies.filter((r) => r.overcost > 0).sort((a, b) => b.overcost - a.overcost);
    return rows.slice(0, 10).map((r) => ({
      name: r.name.length > 22 ? `${r.name.slice(0, 21)}…` : r.name,
      fullName: r.name,
      value: rankingMode === "pct" ? Math.round(r.variationPct! * 10) / 10 : Math.round(r.overcost),
      row: r,
    }));
  }, [data, rankingMode]);

  // ── Exportar ──
  const filtrosTexto = (): string[] => {
    const label = (opts: { value: string; label: string }[], v: string) => opts.find((o) => o.value === v)?.label ?? v;
    const out = [
      `Período: ${fmtDate(dateFrom)} al ${fmtDate(dateTo)} · por ${granularity === "week" ? "semana" : "mes"}`,
      `Local: ${label(localOptions, localId)} · Proveedor: ${label(supplierOptions, supplierId)}`,
      `Rubro: ${label(rubroOptions, rubroId)} · Sub-rubro: ${label(subRubroOptions, subRubroId)}`,
      includeSuspicious ? "Precios sospechosos: INCLUIDOS" : "Precios sospechosos: excluidos de los cálculos",
    ];
    if (q) out.push(`Búsqueda: "${search.trim()}"`);
    return out;
  };

  const buildExport = (): ExportInput | null => {
    if (!data) return null;
    const t = data.totals;
    return {
      title: "Evolución de Costos",
      filtros: filtrosTexto(),
      resumen: [
        `Canasta: ${fmtSigned(t.basketVariationPct)}`,
        ...(inflacionNum != null ? [`Inflación ingresada: ${fmtSigned(inflacionNum)}`] : []),
        `Suben ${t.up} · bajan ${t.down} · sin cambio ${t.flat}`,
        `Comprado: ${formatCurrency(t.amount)}`,
        `Sobrecosto: ${formatCurrency(t.overcost)}`,
      ],
      fileBase: "evolucion-costos",
      sheets: [
        {
          name: "Insumos",
          rows: supplyRows,
          columns: [
            { header: "Insumo", value: (r: SupplyEvolutionRow) => r.name, width: 2.4 },
            { header: "Rubro", value: (r: SupplyEvolutionRow) => r.rubroName ?? "", width: 1.3 },
            { header: "Unidad", value: (r: SupplyEvolutionRow) => r.unit ?? "", width: 0.6 },
            { header: "Precio inicial", value: (r: SupplyEvolutionRow) => r.basePrice, money: true },
            { header: "Fecha inicial", value: (r: SupplyEvolutionRow) => fmtDate(r.baseDate), width: 0.9 },
            { header: "Precio actual", value: (r: SupplyEvolutionRow) => r.lastPrice, money: true },
            { header: "Fecha actual", value: (r: SupplyEvolutionRow) => fmtDate(r.lastDate), width: 0.9 },
            { header: "Var. %", value: (r: SupplyEvolutionRow) => (r.variationPct != null ? Math.round(r.variationPct * 10) / 10 : null), width: 0.7 },
            { header: "Mayor salto %", value: (r: SupplyEvolutionRow) => (r.maxJumpPct != null ? Math.round(r.maxJumpPct * 10) / 10 : null), width: 0.8 },
            { header: "Compras", value: (r: SupplyEvolutionRow) => r.purchases, width: 0.6 },
            { header: "Comprado $", value: (r: SupplyEvolutionRow) => r.amount, money: true },
            { header: "Sobrecosto $", value: (r: SupplyEvolutionRow) => r.overcost, money: true },
          ],
        },
        {
          name: "Sub-recetas",
          rows: subRows,
          columns: [
            { header: "Sub-receta", value: (r: RecipeEvolutionRow) => r.name, width: 2.4 },
            { header: "Rinde", value: (r: RecipeEvolutionRow) => (r.usefulYield ? `${fmtQty(r.usefulYield)} ${r.yieldUnit ?? ""}` : "—"), width: 0.8 },
            { header: "Costo inicio (x unidad)", value: (r: RecipeEvolutionRow) => r.unitCostBase, money: true },
            { header: "Costo hoy (x unidad)", value: (r: RecipeEvolutionRow) => r.unitCostNow, money: true },
            { header: "Var. %", value: (r: RecipeEvolutionRow) => (r.variationPct != null ? Math.round(r.variationPct * 10) / 10 : null), width: 0.7 },
            { header: "Principal causa", value: (r: RecipeEvolutionRow) => r.mainDriver ?? "", width: 1.8 },
          ],
        },
        {
          name: "Platos",
          rows: platoRows,
          columns: [
            { header: "Plato", value: (r: RecipeEvolutionRow) => r.name, width: 2.4 },
            { header: "Categoría", value: (r: RecipeEvolutionRow) => r.categoryName ?? "", width: 1.2 },
            { header: "Costo inicio", value: (r: RecipeEvolutionRow) => r.costBase, money: true },
            { header: "Costo hoy", value: (r: RecipeEvolutionRow) => r.costNow, money: true },
            { header: "Var. %", value: (r: RecipeEvolutionRow) => (r.variationPct != null ? Math.round(r.variationPct * 10) / 10 : null), width: 0.7 },
            { header: "Precio venta", value: (r: RecipeEvolutionRow) => r.grossPrice, money: true },
            { header: "CMV inicio %", value: (r: RecipeEvolutionRow) => r.cmvBasePct, width: 0.8 },
            { header: "CMV hoy %", value: (r: RecipeEvolutionRow) => r.cmvNowPct, width: 0.8 },
            { header: "Objetivo %", value: (r: RecipeEvolutionRow) => r.cmvTargetPct, width: 0.7 },
            { header: "Principal causa", value: (r: RecipeEvolutionRow) => r.mainDriver ?? "", width: 1.6 },
          ],
        },
        {
          name: "Precios sospechosos",
          rows: suspRows,
          columns: [
            { header: "Fecha", value: (r: SuspiciousPurchaseRow) => fmtDate(r.date), width: 0.8 },
            { header: "Insumo", value: (r: SuspiciousPurchaseRow) => r.supplyName, width: 2 },
            { header: "Precio cargado", value: (r: SuspiciousPurchaseRow) => r.unitPrice, money: true },
            { header: "Precio habitual", value: (r: SuspiciousPurchaseRow) => r.medianPrice, money: true },
            { header: "Veces", value: (r: SuspiciousPurchaseRow) => Math.round(r.factor * 10) / 10, width: 0.6 },
            { header: "Cantidad", value: (r: SuspiciousPurchaseRow) => r.quantity, width: 0.7 },
            { header: "Proveedor", value: (r: SuspiciousPurchaseRow) => r.supplierName ?? "", width: 1.5 },
            { header: "Factura", value: (r: SuspiciousPurchaseRow) => r.invoiceDisplay, width: 1.1 },
          ],
        },
      ],
    };
  };

  const t = data?.totals;
  const vsInflacion =
    t?.basketVariationPct != null && inflacionNum != null ? t.basketVariationPct - inflacionNum : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Evolución de Costos"
        description="Cómo se movieron los precios de tus insumos y cuánto encarecieron tus sub-recetas y platos"
      />

      {/* ── Filtros ── */}
      <Card>
        <CardHeader className="pb-3 flex flex-row items-start justify-between space-y-0 gap-4">
          <CardTitle className="text-base flex items-center gap-2">
            <LineChartIcon className="h-4 w-4" /> Qué quiero ver
          </CardTitle>
          <div className="flex flex-wrap gap-2 justify-end">
            <Button
              size="sm"
              variant="outline"
              disabled={!data}
              onClick={() => {
                const input = buildExport();
                if (input) exportToExcel(input);
              }}
              data-testid="button-cost-evolution-excel"
            >
              <FileSpreadsheet className="h-4 w-4 mr-1.5" /> Excel
            </Button>
            <Button
              size="sm"
              disabled={!data}
              onClick={() => {
                const input = buildExport();
                if (input) exportToPdf(input);
              }}
              data-testid="button-cost-evolution-pdf"
            >
              <FileDown className="h-4 w-4 mr-1.5" /> PDF
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1">
              <Label className="text-xs">Período</Label>
              <DataEntryCombobox
                options={PRESET_OPTIONS}
                value={preset}
                onValueChange={(v) => applyPreset(v as PresetKey)}
                placeholder="Período"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Desde / hasta</Label>
              <DateRangePicker
                from={dateFrom}
                to={dateTo}
                onChange={(f, tt) => {
                  setDateFrom(f);
                  setDateTo(tt);
                  setPreset("custom");
                }}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Ver por</Label>
              <DataEntryCombobox
                options={[
                  { value: "month", label: "Mes" },
                  { value: "week", label: "Semana" },
                ]}
                value={granularity}
                onValueChange={(v) => setGranularity(v as "month" | "week")}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Local</Label>
              <DataEntryCombobox options={localOptions} value={localId} onValueChange={(v) => setLocalId(v || "all")} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Proveedor</Label>
              <DataEntryCombobox
                options={supplierOptions}
                value={supplierId}
                onValueChange={(v) => setSupplierId(v || "all")}
                searchPlaceholder="Buscar proveedor…"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Rubro</Label>
              <DataEntryCombobox
                options={rubroOptions}
                value={rubroId}
                onValueChange={(v) => {
                  setRubroId(v || "all");
                  setSubRubroId("all");
                }}
                searchPlaceholder="Buscar rubro…"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Sub-rubro</Label>
              <DataEntryCombobox
                options={subRubroOptions}
                value={subRubroId}
                onValueChange={(v) => setSubRubroId(v || "all")}
                searchPlaceholder="Buscar sub-rubro…"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">CMV objetivo %</Label>
                <Input
                  type="number"
                  value={cmvObjetivo}
                  onChange={(e) => setCmvObjetivo(parseFloat(e.target.value) || 0)}
                  title="Para los platos que no tienen su CMV ideal cargado"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Inflación %</Label>
                <Input
                  inputMode="decimal"
                  placeholder="opcional"
                  value={inflacion}
                  onChange={(e) => setInflacion(e.target.value)}
                  title="Inflación del período, para comparar contra tu canasta"
                />
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={includeSuspicious} onCheckedChange={setIncludeSuspicious} />
              Incluir precios sospechosos en los cálculos
            </label>
            <p className="text-xs text-muted-foreground">
              Proveedor, rubro y sub-rubro filtran los insumos. Las sub-recetas y los platos se costean siempre con todos
              los proveedores, como en Carta.
            </p>
          </div>
        </CardContent>
      </Card>

      {!ready ? null : isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : isError ? (
        <p className="text-sm text-destructive">{(error as Error)?.message}</p>
      ) : data && t ? (
        <>
          {/* ── Indicadores ── */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <Stat
              label="Variación de la canasta"
              value={fmtSigned(t.basketVariationPct)}
              hint={
                vsInflacion != null
                  ? `${vsInflacion > 0 ? "Por encima" : "Por debajo"} de la inflación (${fmtSigned(vsInflacion)} pp)`
                  : "Ponderada por lo que comprás de cada insumo"
              }
              tone={t.basketVariationPct == null ? "default" : t.basketVariationPct > 0.5 ? "bad" : "good"}
            />
            <Stat
              label="Insumos que subieron"
              value={`${t.up} de ${t.suppliesWithPurchases}`}
              hint={`${t.down} bajaron · ${t.flat} sin cambio`}
            />
            <Stat label="Comprado en el período" value={formatCurrency(t.amount)} hint="Neto de IVA, sin notas de crédito" />
            <Stat
              label="Sobrecosto pagado"
              value={formatCurrency(t.overcost)}
              hint="Lo que pagaste de más contra el precio al inicio"
              tone={t.overcost > 0 ? "bad" : "good"}
            />
            <Stat
              label="Platos sobre su CMV objetivo"
              value={`${t.platosOverTarget} de ${t.platosWithPrice}`}
              hint="Con el costo de hoy y el precio de venta de Carta"
              tone={t.platosOverTarget > 0 ? "bad" : "good"}
            />
            <Stat
              label="Precios sospechosos"
              value={fmtNum(t.suspiciousInPeriod)}
              hint={includeSuspicious ? "Incluidos en los cálculos" : "Excluidos de los cálculos"}
              tone={t.suspiciousInPeriod > 0 ? "warn" : "default"}
            />
          </div>

          {t.suspiciousInPeriod > 0 && !includeSuspicious && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 flex gap-2 items-start">
              <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-500 mt-0.5 shrink-0" />
              <p className="text-sm text-amber-700 dark:text-amber-400">
                Hay <span className="font-semibold">{fmtNum(t.suspiciousInPeriod)}</span> compras con un precio que se
                aleja más de 3 veces del habitual del insumo (casi siempre una factura cargada en otra escala: gramos
                contra kilos, caja contra unidad). Quedaron fuera de los cálculos. Revisalas en la solapa{" "}
                <button type="button" className="font-semibold underline" onClick={() => setTab("sospechosos")}>
                  Sospechosos
                </button>
                .
              </p>
            </div>
          )}

          {/* ── Gráficos ── */}
          <div className="grid gap-4 lg:grid-cols-5">
            <Card className="lg:col-span-3">
              <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0 gap-2">
                <div>
                  <CardTitle className="text-base">Índice de costos (base 100)</CardTitle>
                  <p className="text-xs text-muted-foreground">
                    100 = el precio de cada insumo al inicio del período, pesado por lo que se le compró
                  </p>
                </div>
                {data.indexRubros.length > 1 && (
                  <label className="flex items-center gap-2 text-xs whitespace-nowrap">
                    <Switch checked={showRubros} onCheckedChange={setShowRubros} /> Por rubro
                  </label>
                )}
              </CardHeader>
              <CardContent>
                {data.index.every((p) => p.general == null) ? (
                  <p className="text-sm text-muted-foreground py-10 text-center">No hay compras en este período.</p>
                ) : (
                  <ResponsiveContainer width="100%" height={260}>
                    <LineChart data={data.index} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                      <YAxis domain={["auto", "auto"]} tick={{ fontSize: 11 }} width={44} />
                      <Tooltip formatter={(v: number) => (v == null ? "—" : fmtNum(v, 1))} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <ReferenceLine y={100} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" />
                      {inflacionNum != null && (
                        <ReferenceLine
                          y={100 + inflacionNum}
                          stroke="#d97706"
                          strokeDasharray="6 3"
                          label={{ value: `Inflación ${fmtSigned(inflacionNum)}`, fontSize: 10, fill: "#d97706", position: "insideTopLeft" }}
                        />
                      )}
                      <Line
                        type="monotone"
                        dataKey="general"
                        name="General"
                        stroke="hsl(var(--primary))"
                        strokeWidth={3}
                        dot={{ r: 3 }}
                        connectNulls
                      />
                      {showRubros &&
                        data.indexRubros.length > 1 &&
                        data.indexRubros.map((rubro, i) => (
                          <Line
                            key={rubro}
                            type="monotone"
                            dataKey={rubro}
                            name={rubro}
                            stroke={LINE_COLORS[i % LINE_COLORS.length]}
                            strokeWidth={1.5}
                            dot={false}
                            connectNulls
                          />
                        ))}
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0 gap-2">
                <CardTitle className="text-base">Los que más subieron</CardTitle>
                <div className="flex gap-1">
                  <Button size="sm" className="h-7 text-xs" variant={rankingMode === "pct" ? "default" : "outline"} onClick={() => setRankingMode("pct")}>
                    % suba
                  </Button>
                  <Button size="sm" className="h-7 text-xs" variant={rankingMode === "pesos" ? "default" : "outline"} onClick={() => setRankingMode("pesos")}>
                    Impacto $
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {ranking.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-10 text-center">Ningún insumo subió en este período.</p>
                ) : (
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={ranking} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" horizontal={false} />
                      <XAxis
                        type="number"
                        tick={{ fontSize: 10 }}
                        tickFormatter={(v) => (rankingMode === "pct" ? `${v}%` : `$${fmtNum(v / 1000)}k`)}
                      />
                      <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 10 }} />
                      <Tooltip
                        formatter={(v: number) => (rankingMode === "pct" ? fmtSigned(v) : formatCurrency(v))}
                        labelFormatter={(_, p) => (p?.[0]?.payload?.fullName as string) ?? ""}
                      />
                      <Bar dataKey="value" radius={[0, 3, 3, 0]} onClick={(d: any) => setDetail({ kind: "supply", row: d.row })} className="cursor-pointer">
                        {ranking.map((r) => (
                          <Cell key={r.fullName} fill="hsl(var(--destructive))" fillOpacity={0.8} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>

          {/* ── Tablas ── */}
          <Card>
            <CardContent className="pt-6">
              <Tabs value={tab} onValueChange={setTab}>
                <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                  <TabsList className="max-w-full overflow-x-auto justify-start">
                    <TabsTrigger value="insumos">Insumos ({data.supplies.length})</TabsTrigger>
                    <TabsTrigger value="sub">Sub-recetas ({data.subRecipes.length})</TabsTrigger>
                    <TabsTrigger value="platos">Platos ({data.platos.length})</TabsTrigger>
                    <TabsTrigger value="sospechosos">
                      Sospechosos ({data.suspicious.filter((s) => s.inPeriod).length})
                    </TabsTrigger>
                  </TabsList>
                  <div className="relative w-full sm:w-64">
                    <Search className="h-4 w-4 absolute left-2.5 top-2.5 text-muted-foreground" />
                    <Input className="pl-8" placeholder="Buscar…" value={search} onChange={(e) => setSearch(e.target.value)} />
                  </div>
                </div>

                {/* Insumos */}
                <TabsContent value="insumos" className="mt-0">
                  {supplyRows.length === 0 ? (
                    <p className="text-center py-8 text-sm text-muted-foreground">No hay compras de insumos con estos filtros.</p>
                  ) : (
                    <>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b text-xs text-muted-foreground">
                              <Th label="Insumo" sortKey="name" sort={supplySort} align="left" />
                              <Th label="Precio inicial" sortKey="base" sort={supplySort} />
                              <Th label="Precio actual" sortKey="last" sort={supplySort} />
                              <Th label="Var. %" sortKey="var" sort={supplySort} />
                              <Th label="Mayor salto" sortKey="jump" sort={supplySort} className="hidden lg:table-cell" />
                              <Th label="Compras" sortKey="purchases" sort={supplySort} className="hidden md:table-cell" />
                              <Th label="Comprado" sortKey="amount" sort={supplySort} className="hidden md:table-cell" />
                              <Th label="Sobrecosto" sortKey="overcost" sort={supplySort} />
                              <Th label="Evolución" className="hidden sm:table-cell" />
                            </tr>
                          </thead>
                          <tbody>
                            {supplyRows.slice(0, limits.insumos).map((r) => (
                              <tr
                                key={r.supplyId}
                                className="border-b last:border-0 hover:bg-muted/40 cursor-pointer"
                                onClick={() => setDetail({ kind: "supply", row: r })}
                              >
                                <td className="py-2 px-1">
                                  <p className="font-medium">
                                    {r.name}
                                    {r.suspiciousCount > 0 && (
                                      <AlertTriangle className="inline h-3.5 w-3.5 ml-1 text-amber-600" aria-label="Tiene precios sospechosos" />
                                    )}
                                  </p>
                                  <p className="text-[11px] text-muted-foreground">
                                    {[r.rubroName, r.subRubroName, r.unit ? `x ${r.unit}` : null].filter(Boolean).join(" · ")}
                                  </p>
                                </td>
                                <td className="py-2 px-1 text-right font-mono">
                                  {money(r.basePrice)}
                                  <p className="text-[10px] text-muted-foreground">{fmtDate(r.baseDate)}</p>
                                </td>
                                <td className="py-2 px-1 text-right font-mono">
                                  {money(r.lastPrice)}
                                  <p className="text-[10px] text-muted-foreground">{fmtDate(r.lastDate)}</p>
                                </td>
                                <td className="py-2 px-1 text-right">
                                  <Variation value={r.variationPct} />
                                  {!r.baseFromBefore && r.purchases > 1 && (
                                    <p className="text-[10px] text-muted-foreground">desde su 1ª compra</p>
                                  )}
                                </td>
                                <td className={`py-2 px-1 text-right font-mono hidden lg:table-cell ${varTone(r.maxJumpPct)}`}>
                                  {fmtSigned(r.maxJumpPct)}
                                  <p className="text-[10px] text-muted-foreground">{r.maxJumpDate ? fmtDate(r.maxJumpDate) : ""}</p>
                                </td>
                                <td className="py-2 px-1 text-right font-mono hidden md:table-cell">{r.purchases}</td>
                                <td className="py-2 px-1 text-right font-mono hidden md:table-cell">{formatCurrency(r.amount)}</td>
                                <td className={`py-2 px-1 text-right font-mono ${r.overcost > 0.5 ? "text-destructive" : r.overcost < -0.5 ? "text-emerald-600 dark:text-emerald-500" : ""}`}>
                                  {formatCurrency(r.overcost)}
                                </td>
                                <td className="py-2 px-1 text-right hidden sm:table-cell">
                                  <Sparkline values={r.series} />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <ShowMore
                        total={supplyRows.length}
                        shown={limits.insumos}
                        onMore={() => setLimits({ ...limits, insumos: limits.insumos + PAGE })}
                      />
                    </>
                  )}
                </TabsContent>

                {/* Sub-recetas */}
                <TabsContent value="sub" className="mt-0">
                  <p className="text-xs text-muted-foreground pb-2">
                    Costo reconstruido: la composición de hoy valorizada con el precio que tenía cada insumo en cada fecha.
                    Mide solo el efecto de los precios.
                  </p>
                  <RecipeTable
                    rows={subRows}
                    limit={limits.sub}
                    onMore={() => setLimits({ ...limits, sub: limits.sub + PAGE })}
                    sort={subSort}
                    perUnit
                    onOpen={(row) => setDetail({ kind: "recipe", row })}
                    empty="No hay sub-recetas con ingredientes."
                  />
                </TabsContent>

                {/* Platos */}
                <TabsContent value="platos" className="mt-0">
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-2">
                    <p className="text-xs text-muted-foreground">
                      CMV medido contra el precio de venta de Carta. El objetivo es el CMV ideal del plato o, si no lo tiene,
                      el {fmtPct(cmvObjetivo, 0)} de arriba.
                    </p>
                    <label className="flex items-center gap-2 text-xs">
                      <Switch checked={onlyOverTarget} onCheckedChange={setOnlyOverTarget} /> Solo los que pasan su objetivo
                    </label>
                  </div>
                  <RecipeTable
                    rows={platoRows}
                    limit={limits.platos}
                    onMore={() => setLimits({ ...limits, platos: limits.platos + PAGE })}
                    sort={platoSort}
                    withCmv
                    onOpen={(row) => setDetail({ kind: "recipe", row })}
                    empty={onlyOverTarget ? "Ningún plato pasa su CMV objetivo." : "No hay platos con ingredientes."}
                  />
                </TabsContent>

                {/* Sospechosos */}
                <TabsContent value="sospechosos" className="mt-0">
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-2">
                    <p className="text-xs text-muted-foreground">
                      Compras cuyo precio se aleja más de 3 veces del habitual del insumo (la mediana de todas sus compras).
                      Corregir la factura las saca de esta lista.
                    </p>
                    <label className="flex items-center gap-2 text-xs">
                      <Switch checked={onlySuspInPeriod} onCheckedChange={setOnlySuspInPeriod} /> Solo del período
                    </label>
                  </div>
                  {suspRows.length === 0 ? (
                    <p className="text-center py-8 text-sm text-muted-foreground">No hay precios sospechosos. 👌</p>
                  ) : (
                    <>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b text-xs text-muted-foreground">
                              <Th label="Fecha" align="left" />
                              <Th label="Insumo" align="left" />
                              <Th label="Precio cargado" />
                              <Th label="Precio habitual" />
                              <Th label="Veces" />
                              <Th label="Cantidad" className="hidden md:table-cell" />
                              <Th label="Proveedor" align="left" className="hidden md:table-cell" />
                              <Th label="Factura" align="left" />
                            </tr>
                          </thead>
                          <tbody>
                            {suspRows.slice(0, limits.susp).map((s) => (
                              <tr key={s.itemId} className="border-b last:border-0 hover:bg-muted/40">
                                <td className="py-2 px-1 text-xs whitespace-nowrap">{fmtDate(s.date)}</td>
                                <td className="py-2 px-1">
                                  <p className="font-medium">{s.supplyName}</p>
                                  <p className="text-[11px] text-muted-foreground">{s.unit ? `x ${s.unit}` : "sin unidad"} · {s.localName ?? ""}</p>
                                </td>
                                <td className="py-2 px-1 text-right font-mono text-amber-700 dark:text-amber-500">{formatCurrency(s.unitPrice)}</td>
                                <td className="py-2 px-1 text-right font-mono">{formatCurrency(s.medianPrice)}</td>
                                <td className="py-2 px-1 text-right font-mono">×{fmtNum(s.factor, s.factor >= 10 ? 0 : 1)}</td>
                                <td className="py-2 px-1 text-right font-mono hidden md:table-cell">{fmtQty(s.quantity)}</td>
                                <td className="py-2 px-1 text-xs hidden md:table-cell">{s.supplierName ?? "—"}</td>
                                <td className="py-2 px-1">
                                  <Link href={`/facturas/${s.invoiceId}`}>
                                    <span className="inline-flex items-center gap-1 text-xs text-primary hover:underline cursor-pointer font-mono">
                                      {s.invoiceDisplay} <ExternalLink className="h-3 w-3" />
                                    </span>
                                  </Link>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <ShowMore
                        total={suspRows.length}
                        shown={limits.susp}
                        onMore={() => setLimits({ ...limits, susp: limits.susp + PAGE })}
                      />
                    </>
                  )}
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </>
      ) : null}

      {/* ── Ficha ── */}
      <Dialog open={detail != null} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          {detail?.kind === "supply" && data && (
            <SupplyDetail
              row={detail.row}
              data={data}
              filters={{ dateFrom, dateTo, localId, supplierId }}
            />
          )}
          {detail?.kind === "recipe" && data && <RecipeDetail row={detail.row} data={data} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Tabla de recetas (sub-recetas y platos) ──────────────────────────────────

function RecipeTable({
  rows,
  limit,
  onMore,
  sort,
  perUnit,
  withCmv,
  onOpen,
  empty,
}: {
  rows: RecipeEvolutionRow[];
  limit: number;
  onMore: () => void;
  sort: { key: string; direction: SortDir; toggle: (k: any) => void };
  perUnit?: boolean;
  withCmv?: boolean;
  onOpen: (row: RecipeEvolutionRow) => void;
  empty: string;
}) {
  if (rows.length === 0) return <p className="text-center py-8 text-sm text-muted-foreground">{empty}</p>;
  const cmvTone = (r: RecipeEvolutionRow) => (r.cmvNowPct == null ? "" : r.overTarget ? "text-destructive" : "text-emerald-600 dark:text-emerald-500");
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-xs text-muted-foreground">
              <Th label={withCmv ? "Plato" : "Sub-receta"} sortKey="name" sort={sort} align="left" />
              <Th label={perUnit ? "Costo inicio (x unidad)" : "Costo inicio"} sortKey="base" sort={sort} />
              <Th label={perUnit ? "Costo hoy (x unidad)" : "Costo hoy"} sortKey="now" sort={sort} />
              <Th label="Var. %" sortKey="var" sort={sort} />
              {withCmv && (
                <>
                  <Th label="Precio venta" sortKey="price" sort={sort} className="hidden md:table-cell" />
                  <Th label="CMV inicio" sortKey="cmvBase" sort={sort} className="hidden lg:table-cell" />
                  <Th label="CMV hoy" sortKey="cmvNow" sort={sort} />
                </>
              )}
              <Th label="Principal causa" align="left" className="hidden lg:table-cell" />
              <Th label="Evolución" className="hidden sm:table-cell" />
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map((r) => (
              <tr key={r.recipeId} className="border-b last:border-0 hover:bg-muted/40 cursor-pointer" onClick={() => onOpen(r)}>
                <td className="py-2 px-1">
                  <p className="font-medium">
                    {r.name}
                    {r.storedDiffers && (
                      <AlertTriangle
                        className="inline h-3.5 w-3.5 ml-1 text-amber-600"
                        aria-label="El costo de Carta no coincide con los precios actuales"
                      />
                    )}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {[r.categoryName, r.subcategoryName, perUnit && r.usefulYield ? `rinde ${fmtQty(r.usefulYield)} ${r.yieldUnit ?? ""}` : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </td>
                <td className="py-2 px-1 text-right font-mono">{formatCurrency(perUnit ? r.unitCostBase : r.costBase)}</td>
                <td className="py-2 px-1 text-right font-mono">{formatCurrency(perUnit ? r.unitCostNow : r.costNow)}</td>
                <td className="py-2 px-1 text-right">
                  <Variation value={r.variationPct} />
                </td>
                {withCmv && (
                  <>
                    <td className="py-2 px-1 text-right font-mono hidden md:table-cell">{money(r.grossPrice)}</td>
                    <td className="py-2 px-1 text-right font-mono hidden lg:table-cell text-muted-foreground">{fmtPct(r.cmvBasePct)}</td>
                    <td className={`py-2 px-1 text-right font-mono ${cmvTone(r)}`}>
                      {fmtPct(r.cmvNowPct)}
                      {r.cmvTargetPct != null && (
                        <p className="text-[10px] text-muted-foreground">obj. {fmtPct(r.cmvTargetPct, 0)}</p>
                      )}
                    </td>
                  </>
                )}
                <td className="py-2 px-1 text-xs hidden lg:table-cell">{r.mainDriver ?? "—"}</td>
                <td className="py-2 px-1 text-right hidden sm:table-cell">
                  <Sparkline values={r.series} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ShowMore total={rows.length} shown={limit} onMore={onMore} />
    </>
  );
}

// ─── Fichas ───────────────────────────────────────────────────────────────────

type PurchaseDetail = CostPurchase & { suspicious: boolean };

function SupplyDetail({
  row,
  data,
  filters,
}: {
  row: SupplyEvolutionRow;
  data: CostEvolutionResult;
  filters: { dateFrom: string; dateTo: string; localId: string; supplierId: string };
}) {
  const chart = data.buckets.map((b, i) => ({ label: b.label, precio: row.series[i] }));
  const suppliers = data.suppliersBySupply[row.supplyId] ?? [];
  const usage = data.usageBySupply[row.supplyId] ?? [];

  const purchaseParams = new URLSearchParams({ supplyId: String(row.supplyId), dateFrom: filters.dateFrom, dateTo: filters.dateTo });
  if (filters.localId !== "all") purchaseParams.set("localId", filters.localId);
  if (filters.supplierId !== "all") purchaseParams.set("supplierId", filters.supplierId);
  const { data: purchases = [], isLoading: loadingPurchases } = useQuery<PurchaseDetail[]>({
    queryKey: ["/api/cost-evolution/purchases", purchaseParams.toString()],
    queryFn: async () => {
      const res = await fetch(`/api/cost-evolution/purchases?${purchaseParams.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.message || "Error al traer las compras");
      return res.json();
    },
  });
  const cheapest = suppliers.length > 1 ? suppliers[0] : null;

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {row.name} {row.unit && <span className="text-sm font-normal text-muted-foreground">x {row.unit}</span>}
        </DialogTitle>
        <p className="text-xs text-muted-foreground">{[row.rubroName, row.subRubroName].filter(Boolean).join(" · ")}</p>
      </DialogHeader>

      <div className="grid gap-3 grid-cols-2 md:grid-cols-5">
        <Stat label="Precio inicial" value={money(row.basePrice)} hint={fmtDate(row.baseDate)} />
        <Stat label="Precio actual" value={money(row.lastPrice)} hint={fmtDate(row.lastDate)} />
        <Stat
          label="Variación"
          value={fmtSigned(row.variationPct)}
          tone={row.variationPct == null ? "default" : row.variationPct > 0.5 ? "bad" : "good"}
        />
        <Stat label="Mínimo / máximo" value={money(row.minPrice)} hint={`hasta ${money(row.maxPrice)}`} />
        <Stat label="Sobrecosto" value={formatCurrency(row.overcost)} hint={`${row.purchases} compras · ${formatCurrency(row.amount)}`} />
      </div>

      <div>
        <p className="text-xs font-medium mb-2 text-muted-foreground">Precio promedio ponderado por período</p>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={chart} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 10 }} width={70} tickFormatter={(v) => formatCurrency(v).replace(/,\d+$/, "")} />
            <Tooltip formatter={(v: number) => formatCurrency(v)} />
            {row.basePrice != null && <ReferenceLine y={row.basePrice} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" />}
            <Line type="monotone" dataKey="precio" name="Precio" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {suppliers.length > 0 && (
        <div>
          <p className="text-sm font-semibold mb-1">Por proveedor</p>
          {cheapest && (
            <p className="text-xs text-muted-foreground mb-2">
              El más barato en el período fue <span className="font-medium text-foreground">{cheapest.supplierName}</span> (
              {money(cheapest.avgPrice)} promedio).
            </p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <Th label="Proveedor" align="left" />
                  <Th label="Compras" />
                  <Th label="Promedio" />
                  <Th label="Mín." className="hidden sm:table-cell" />
                  <Th label="Máx." className="hidden sm:table-cell" />
                  <Th label="Último" />
                </tr>
              </thead>
              <tbody>
                {suppliers.map((s) => (
                  <tr key={String(s.supplierId)} className="border-b last:border-0">
                    <td className="py-1.5 px-1">{s.supplierName}</td>
                    <td className="py-1.5 px-1 text-right font-mono">{s.purchases}</td>
                    <td className="py-1.5 px-1 text-right font-mono">{money(s.avgPrice)}</td>
                    <td className="py-1.5 px-1 text-right font-mono hidden sm:table-cell">{money(s.minPrice)}</td>
                    <td className="py-1.5 px-1 text-right font-mono hidden sm:table-cell">{money(s.maxPrice)}</td>
                    <td className="py-1.5 px-1 text-right font-mono">
                      {money(s.lastPrice)} <span className="text-[10px] text-muted-foreground">{fmtDate(s.lastDate)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div>
        <p className="text-sm font-semibold mb-1">Dónde impacta</p>
        {usage.length === 0 ? (
          <p className="text-xs text-muted-foreground">No lo usa ninguna receta activa.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <Th label="Receta" align="left" />
                  <Th label="Cantidad" />
                  <Th label="$ en la receta" />
                  <Th label="% del costo" />
                </tr>
              </thead>
              <tbody>
                {usage.slice(0, 30).map((u) => (
                  <tr key={u.recipeId} className="border-b last:border-0">
                    <td className="py-1.5 px-1">
                      {u.recipeName}{" "}
                      <Badge variant="secondary" className="text-[10px] ml-1">
                        {u.recipeType === "plato" ? "plato" : "sub-receta"}
                      </Badge>
                    </td>
                    <td className="py-1.5 px-1 text-right font-mono">
                      {fmtQty(u.quantity)} {row.unit ?? ""}
                    </td>
                    <td className="py-1.5 px-1 text-right font-mono">{formatCurrency(u.costNow)}</td>
                    <td className="py-1.5 px-1 text-right font-mono">{fmtPct(u.sharePct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {usage.length > 30 && <p className="text-xs text-muted-foreground pt-1">… y {usage.length - 30} recetas más.</p>}
          </div>
        )}
      </div>

      <div>
        <p className="text-sm font-semibold mb-1">Compras del período</p>
        {loadingPurchases && <Skeleton className="h-16 w-full" />}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <Th label="Fecha" align="left" />
                <Th label="Proveedor" align="left" />
                <Th label="Cantidad" />
                <Th label="Precio" />
                <Th label="Factura" align="left" />
              </tr>
            </thead>
            <tbody>
              {purchases.map((p) => (
                <tr key={p.itemId} className={`border-b last:border-0 ${p.suspicious ? "bg-amber-500/10" : ""}`}>
                  <td className="py-1.5 px-1 text-xs whitespace-nowrap">{fmtDate(p.date)}</td>
                  <td className="py-1.5 px-1 text-xs">
                    {p.supplierName ?? "—"} <span className="text-muted-foreground">· {p.localName ?? ""}</span>
                  </td>
                  <td className="py-1.5 px-1 text-right font-mono">{fmtQty(p.quantity)}</td>
                  <td className="py-1.5 px-1 text-right font-mono">
                    {formatCurrency(p.unitPrice)}
                    {p.suspicious && <AlertTriangle className="inline h-3 w-3 ml-1 text-amber-600" aria-label="Precio sospechoso" />}
                  </td>
                  <td className="py-1.5 px-1">
                    <Link href={`/facturas/${p.invoiceId}`}>
                      <span className="inline-flex items-center gap-1 text-xs text-primary hover:underline cursor-pointer font-mono">
                        {p.invoiceDisplay} <ExternalLink className="h-3 w-3" />
                      </span>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function RecipeDetail({ row, data }: { row: RecipeEvolutionRow; data: CostEvolutionResult }) {
  const isSub = row.recipeType !== "plato";
  const y = isSub && row.usefulYield && row.usefulYield > 0 ? row.usefulYield : 1;
  const chart = data.buckets.map((b, i) => ({ label: b.label, costo: Math.round((row.series[i] / y) * 100) / 100 }));
  const drivers = row.drivers.filter((d) => Math.abs(d.deltaCost) > 0.005 || d.priceNow > 0);
  const delta = row.costNow - row.costBase;

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2 flex-wrap">
          {row.name}
          <Badge variant="secondary" className="text-[10px]">
            {isSub ? "sub-receta" : "plato"}
          </Badge>
        </DialogTitle>
        <p className="text-xs text-muted-foreground">
          {[row.categoryName, row.subcategoryName, isSub && row.usefulYield ? `rinde ${fmtQty(row.usefulYield)} ${row.yieldUnit ?? ""}` : null]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </DialogHeader>

      <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
        <Stat label={isSub ? "Costo inicio (x unidad)" : "Costo al inicio"} value={formatCurrency(isSub ? row.unitCostBase : row.costBase)} />
        <Stat label={isSub ? "Costo hoy (x unidad)" : "Costo hoy"} value={formatCurrency(isSub ? row.unitCostNow : row.costNow)} />
        <Stat
          label="Variación"
          value={fmtSigned(row.variationPct)}
          hint={`${delta >= 0 ? "+" : ""}${formatCurrency(delta)} por ${isSub ? "tanda" : "plato"}`}
          tone={row.variationPct == null ? "default" : row.variationPct > 0.5 ? "bad" : "good"}
        />
        {!isSub ? (
          <Stat
            label="CMV hoy"
            value={fmtPct(row.cmvNowPct)}
            hint={
              row.grossPrice != null
                ? `era ${fmtPct(row.cmvBasePct)} · objetivo ${fmtPct(row.cmvTargetPct, 0)}${row.cmvTargetIsOwn ? " (propio)" : ""}`
                : "Sin precio de venta en Carta"
            }
            tone={row.cmvNowPct == null ? "default" : row.overTarget ? "bad" : "good"}
          />
        ) : (
          <Stat label="Costo de la tanda hoy" value={formatCurrency(row.costNow)} />
        )}
      </div>

      {row.storedDiffers && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 flex gap-2 items-start">
          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-500 mt-0.5 shrink-0" />
          <p className="text-sm text-amber-700 dark:text-amber-400">
            En Carta esta receta figura con un costo de <span className="font-semibold">{formatCurrency(row.storedTotalCost)}</span>,
            pero con los últimos precios de factura da {formatCurrency(row.costNow)}. Puede ser un precio sospechoso que acá
            quedó afuera, o un costo de Carta que no se recalculó. Abrí la receta y guardala para que se actualice.
          </p>
        </div>
      )}
      {row.supplyWithoutPrice > 0 && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          {row.supplyWithoutPrice} insumo(s) de esta receta no tienen ningún precio cargado y suman $0.
        </p>
      )}

      <div>
        <p className="text-xs font-medium mb-2 text-muted-foreground">
          Costo {isSub ? "por unidad de rendimiento" : "del plato"} en cada período (composición de hoy)
        </p>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={chart} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 10 }} width={70} tickFormatter={(v) => formatCurrency(v).replace(/,\d+$/, "")} />
            <Tooltip formatter={(v: number) => formatCurrency(v)} />
            <Line type="monotone" dataKey="costo" name="Costo" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div>
        <p className="text-sm font-semibold mb-1">Qué explica la variación</p>
        <p className="text-xs text-muted-foreground mb-2">
          Insumos ya explotados (las sub-recetas se abren en sus insumos), ordenados por cuánto movieron el costo.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <Th label="Insumo" align="left" />
                <Th label="Cantidad" />
                <Th label="Precio inicio" className="hidden sm:table-cell" />
                <Th label="Precio hoy" />
                <Th label="Var. %" />
                <Th label="Aporte $" />
              </tr>
            </thead>
            <tbody>
              {drivers.map((d) => (
                <tr key={d.supplyId} className="border-b last:border-0">
                  <td className="py-1.5 px-1">{d.name}</td>
                  <td className="py-1.5 px-1 text-right font-mono">
                    {fmtQty(d.quantity)} {d.unit ?? ""}
                  </td>
                  <td className="py-1.5 px-1 text-right font-mono hidden sm:table-cell">{formatCurrency(d.priceBase)}</td>
                  <td className="py-1.5 px-1 text-right font-mono">{formatCurrency(d.priceNow)}</td>
                  <td className="py-1.5 px-1 text-right">
                    <Variation value={d.variationPct} />
                  </td>
                  <td className={`py-1.5 px-1 text-right font-mono ${d.deltaCost > 0.005 ? "text-destructive" : d.deltaCost < -0.005 ? "text-emerald-600 dark:text-emerald-500" : ""}`}>
                    {d.deltaCost >= 0 ? "+" : ""}
                    {formatCurrency(d.deltaCost)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex justify-end">
        <Link href={`/recetas/${row.recipeId}${row.recipeType !== "plato" ? "?type=sub" : ""}`}>
          <Button variant="outline" size="sm">
            <ExternalLink className="h-4 w-4 mr-1.5" /> Abrir la receta
          </Button>
        </Link>
      </div>
    </>
  );
}
