/**
 * Productos Vendidos — el ranking de lo que más se vende, con su CMV y su margen.
 *
 * Es la cara "para mostrar" de lo que CMV Productos calcula puertas adentro: mismo costeo
 * (`product_costs` + mapeo a receta), pero ordenado por unidades, comparado contra el período
 * anterior de igual largo y listo para salir en PDF en tres niveles de detalle.
 *
 * Los archivos importados traen SOLO cantidades: el CMV% y el margen% son teóricos y dependen de
 * cuántos productos tengan costo cargado. Por eso la cobertura se muestra siempre y cada fila sin
 * costo tiene el botón para asignárselo sin salir de la pantalla.
 */
import { useMemo, useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useSalesSources } from "@/hooks/useSalesSources";
import { usePersistentFilter } from "@/hooks/usePersistentFilter";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { DataEntryCombobox } from "@/components/data-entry-combobox";
import { DateRangePicker } from "@/components/date-range-picker";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatCurrency, formatEsArAmountInput, parseEsArAmount } from "@/lib/formatters";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  buildProductosVendidosPdf,
  PDF_LEVEL_LABELS,
  type ProductosVendidosPdfLevel,
} from "@/lib/productos-vendidos-pdf";
import {
  Trophy,
  FileDown,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  DollarSign,
  Store,
  X,
} from "lucide-react";
import type { Local } from "@shared/schema";

type ProductSource = "fudo" | "datalive" | "shares";

const SOURCE_LABELS: Record<string, string> = { fudo: "FUDO", datalive: "Datalive", shares: "Shares" };

interface ItemRow {
  rank: number;
  producto: string;
  categoria: string | null;
  cantidad: number;
  unidadesPorDia: number;
  porLocal: Array<{ localId: number; localName: string; cantidad: number }>;
  costoUnitario: number | null;
  costMode: "receta" | "manual" | null;
  recipeId: number | null;
  recipeName: string | null;
  precioUnitario: number | null;
  cmvPct: number | null;
  margenPct: number | null;
  margenUnitario: number | null;
  margenTotal: number | null;
  ventaTeorica: number | null;
  cantidadPrev: number | null;
  variacionPct: number | null;
  esNuevo: boolean;
  participacionPct: number;
  acumuladoPct: number;
}

interface MoverRow {
  producto: string;
  cantidad: number;
  cantidadPrev: number | null;
  variacionPct: number | null;
}

interface ProductosVendidosResult {
  source: ProductSource;
  ivaIncluded: boolean;
  topN: number;
  period: { from: string; to: string; days: number; diasConVenta: number };
  prevPeriod: { from: string; to: string; days: number };
  excluidos: string[];
  locals: Array<{ id: number; name: string }>;
  allLocalsCount: number;
  isAllLocals: boolean;
  totals: {
    unidades: number;
    unidadesPrev: number;
    variacionPct: number | null;
    productosDistintos: number;
    unidadesConCosto: number;
    coberturaPct: number | null;
    cmvPonderadoPct: number | null;
    margenPonderadoPct: number | null;
    topParticipacionPct: number;
    productosHasta80: number;
  };
  items: ItemRow[];
  subidas: MoverRow[];
  bajas: MoverRow[];
  desaparecidos: Array<{ producto: string; cantidadPrev: number }>;
  moversMinBase: number;
}

interface RecipeRow {
  id: number;
  name: string;
  totalCost: string | number | null;
}

// ─── Fechas ───────────────────────────────────────────────────────────────────
// Todo en hora local: `toISOString()` corre un día para atrás en Argentina.

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Lunes de la semana de `d`. La semana comercial arranca el lunes, como el widget semanal. */
function monday(d: Date): Date {
  const out = new Date(d);
  const day = out.getDay();
  out.setDate(out.getDate() + (day === 0 ? -6 : 1 - day));
  return out;
}

type PresetKey = "semana" | "semanaPasada" | "mes" | "mesPasado" | "custom";

const PRESET_OPTIONS = [
  { value: "semana", label: "Semana actual" },
  { value: "semanaPasada", label: "Semana pasada" },
  { value: "mes", label: "Mes actual" },
  { value: "mesPasado", label: "Mes anterior" },
  { value: "custom", label: "Personalizado" },
];

function presetRange(preset: PresetKey): { from: string; to: string } | null {
  const now = new Date();
  if (preset === "semana") {
    return { from: ymd(monday(now)), to: ymd(now) };
  }
  if (preset === "semanaPasada") {
    const start = monday(now);
    start.setDate(start.getDate() - 7);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    return { from: ymd(start), to: ymd(end) };
  }
  if (preset === "mes") {
    return { from: ymd(new Date(now.getFullYear(), now.getMonth(), 1)), to: ymd(now) };
  }
  if (preset === "mesPasado") {
    return {
      from: ymd(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
      to: ymd(new Date(now.getFullYear(), now.getMonth(), 0)),
    };
  }
  return null;
}

const fmtDate = (iso: string) => {
  const [y, m, d] = String(iso ?? "").slice(0, 10).split("-");
  return y && m && d ? `${d}/${m}/${y}` : String(iso ?? "");
};
const fmtPct = (v: number | null | undefined, d = 1) => (v == null ? "—" : `${v.toFixed(d)}%`);
const fmtSigned = (v: number | null | undefined, d = 1) =>
  v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`;
const fmtNum = (v: number, d = 0) =>
  new Intl.NumberFormat("es-AR", { minimumFractionDigits: d, maximumFractionDigits: d }).format(v);

// ─── Piezas de UI ─────────────────────────────────────────────────────────────

function MultiLocalSelect({
  locals,
  value,
  onChange,
}: {
  locals: Local[];
  value: number[];
  onChange: (v: number[]) => void;
}) {
  const toggle = (id: number) => {
    if (value.includes(id)) onChange(value.filter((x) => x !== id));
    else onChange([...value, id]);
  };
  const allSelected = value.length === 0;
  return (
    <div className="flex flex-wrap gap-1.5">
      <button
        type="button"
        className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${allSelected ? "bg-primary text-primary-foreground border-primary" : "bg-background text-muted-foreground border-border hover:bg-muted"}`}
        onClick={() => onChange([])}
        data-testid="button-productos-vendidos-todos-locales"
      >
        Todos
      </button>
      {locals.map((l) => (
        <button
          type="button"
          key={l.id}
          className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${value.includes(l.id) ? "bg-primary text-primary-foreground border-primary" : "bg-background text-muted-foreground border-border hover:bg-muted"}`}
          onClick={() => toggle(l.id)}
        >
          {l.name}
        </button>
      ))}
    </div>
  );
}

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
      <p className={`text-xl font-bold font-mono ${toneClass}`}>{value}</p>
      {hint && <p className="text-[11px] text-muted-foreground pt-0.5">{hint}</p>}
    </div>
  );
}

/** Variación contra el período anterior. Sin base previa no es "+∞%": es un producto nuevo. */
function Variacion({ value, esNuevo }: { value: number | null; esNuevo: boolean }) {
  if (esNuevo) return <Badge variant="secondary" className="text-[10px]">nuevo</Badge>;
  if (value == null) return <span className="text-muted-foreground">—</span>;
  const up = value >= 0;
  return (
    <span className={`inline-flex items-center gap-1 font-medium ${up ? "text-emerald-600 dark:text-emerald-500" : "text-destructive"}`}>
      {up ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
      {fmtSigned(value)}
    </span>
  );
}

// ─── Página ───────────────────────────────────────────────────────────────────

export default function ProductosVendidosPage() {
  const { toast } = useToast();
  const { isEnabled: isSourceEnabled } = useSalesSources();

  const [source, setSource] = usePersistentFilter<ProductSource>("prodVend.source", "fudo");
  const [preset, setPreset] = usePersistentFilter<PresetKey>("prodVend.preset", "mes");
  const [dateFrom, setDateFrom] = usePersistentFilter("prodVend.dateFrom", presetRange("mes")!.from);
  const [dateTo, setDateTo] = usePersistentFilter("prodVend.dateTo", presetRange("mes")!.to);
  const [localIds, setLocalIds] = usePersistentFilter<number[]>("prodVend.localIds", []);
  const [topN, setTopN] = usePersistentFilter("prodVend.topN", 15);
  const [ivaIncluded, setIvaIncluded] = usePersistentFilter("prodVend.ivaIncluded", false);
  const [cmvObjetivo, setCmvObjetivo] = usePersistentFilter("prodVend.cmvObjetivo", 35);
  // Los reportes traen conceptos que no son productos ("Servicio de Mesa", cubiertos, delivery).
  // Se excluyen del ranking Y de los totales, para que los porcentajes midan contra lo que se ve.
  const [excluded, setExcluded] = usePersistentFilter<string[]>("prodVend.excluded", []);

  const [costTarget, setCostTarget] = useState<ItemRow | null>(null);
  const [costMode, setCostMode] = useState<"receta" | "manual">("receta");
  const [costRecipeId, setCostRecipeId] = useState("");
  const [costManual, setCostManual] = useState("");

  const { data: locals = [] } = useQuery<Local[]>({ queryKey: ["/api/locals"] });
  const { data: recipes = [] } = useQuery<RecipeRow[]>({ queryKey: ["/api/recipes"] });

  // Las fuentes apagadas en Preferencias no se ofrecen (mismo criterio que CMV Productos).
  const sourceOptions = useMemo(
    () => (["fudo", "datalive", "shares"] as ProductSource[])
      .filter((s) => isSourceEnabled(s))
      .map((s) => ({ value: s, label: SOURCE_LABELS[s] })),
    [isSourceEnabled],
  );
  const allowedSources = sourceOptions.map((o) => o.value).join(",");
  useEffect(() => {
    const allowed = allowedSources ? allowedSources.split(",") : [];
    if (allowed.length > 0 && !allowed.includes(source)) setSource(allowed[0] as ProductSource);
  }, [allowedSources, source, setSource]);

  const applyPreset = (next: PresetKey) => {
    setPreset(next);
    const range = presetRange(next);
    if (range) {
      setDateFrom(range.from);
      setDateTo(range.to);
    }
  };

  const localParam = localIds.length > 0 ? localIds.join(",") : "";
  const ready = !!(dateFrom && dateTo);

  const { data, isLoading, isError, error } = useQuery<ProductosVendidosResult>({
    queryKey: ["/api/finance/productos-vendidos", source, dateFrom, dateTo, localParam, topN, ivaIncluded, excluded.join("|")],
    enabled: ready,
    queryFn: async () => {
      const p = new URLSearchParams();
      p.set("source", source);
      p.set("dateFrom", dateFrom);
      p.set("dateTo", dateTo);
      if (localParam) p.set("localIds", localParam);
      p.set("topN", String(topN));
      p.set("ivaIncluded", String(ivaIncluded));
      for (const name of excluded) p.append("exclude", name);
      const res = await fetch(`/api/finance/productos-vendidos?${p.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.message || "Error al calcular");
      return res.json();
    },
  });

  const recipeOptions = useMemo(
    () => [...recipes]
      .sort((a, b) => String(a.name).localeCompare(String(b.name), "es"))
      .map((r) => ({ value: String(r.id), label: `${r.name} — ${formatCurrency(parseFloat(String(r.totalCost ?? 0)) || 0)}` })),
    [recipes],
  );

  const openCostDialog = (row: ItemRow) => {
    setCostTarget(row);
    setCostMode(row.costMode === "manual" ? "manual" : "receta");
    setCostRecipeId(row.recipeId != null ? String(row.recipeId) : "");
    setCostManual(row.costMode === "manual" && row.costoUnitario != null ? formatEsArAmountInput(String(row.costoUnitario)) : "");
  };

  const saveCostMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/finance/product-costs", {
        source,
        productName: costTarget?.producto,
        costMode,
        recipeId: costMode === "receta" ? costRecipeId : (costRecipeId || null),
        manualCost: costMode === "manual" ? parseEsArAmount(costManual) : null,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/finance/productos-vendidos"] });
      queryClient.invalidateQueries({ queryKey: ["/api/finance/cmv-productos"] });
      queryClient.invalidateQueries({ queryKey: ["/api/finance/product-costs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/product-recipe-mappings"] });
      toast({ title: "Costo asignado", description: `${costTarget?.producto} quedó valorizado.` });
      setCostTarget(null);
    },
    onError: (e: Error) =>
      toast({ title: "No se pudo guardar el costo", description: e.message, variant: "destructive" }),
  });

  const exportPdf = (level: ProductosVendidosPdfLevel) => {
    if (!data) return;
    const doc = buildProductosVendidosPdf({
      level,
      sourceLabel: SOURCE_LABELS[data.source] ?? data.source,
      ivaIncluded: data.ivaIncluded,
      period: data.period,
      prevPeriod: data.prevPeriod,
      locals: data.locals,
      allLocalsCount: data.allLocalsCount,
      isAllLocals: data.isAllLocals,
      totals: data.totals,
      items: data.items,
      subidas: data.subidas,
      bajas: data.bajas,
      desaparecidos: data.desaparecidos,
      excluidos: data.excluidos,
      moversMinBase: data.moversMinBase,
      cmvObjetivo,
    });
    doc.save(`productos-vendidos_${level}_${data.period.from}_${data.period.to}.pdf`);
  };

  const localesLabel = data
    ? data.isAllLocals
      ? `Todos los locales (${data.allLocalsCount})`
      : `${data.locals.map((l) => l.name).join(" · ")} (${data.locals.length} de ${data.allLocalsCount})`
    : "";

  const multiLocal = (data?.locals.length ?? 0) > 1;
  const cmvTone = (v: number | null) =>
    v == null ? "" : v <= cmvObjetivo ? "text-emerald-600 dark:text-emerald-500" : "text-destructive";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Productos Vendidos"
        description="Los que más se venden, con su CMV y su margen, comparados contra el período anterior"
      />

      {/* ── Filtros ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Trophy className="h-4 w-4" /> Qué quiero ver
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <div className="space-y-1">
              <Label className="text-xs">Productos vendidos de</Label>
              <DataEntryCombobox
                options={sourceOptions}
                value={source}
                onValueChange={(v) => setSource(v as ProductSource)}
                placeholder="Fuente"
                searchPlaceholder="Buscar…"
                data-testid="select-productos-vendidos-source"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Período</Label>
              <DataEntryCombobox
                options={PRESET_OPTIONS}
                value={preset}
                onValueChange={(v) => applyPreset(v as PresetKey)}
                placeholder="Período"
                searchPlaceholder="Buscar…"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Desde / hasta</Label>
              <DateRangePicker
                from={dateFrom}
                to={dateTo}
                onChange={(f, t) => {
                  setDateFrom(f);
                  setDateTo(t);
                  setPreset("custom");
                }}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Cuántos productos</Label>
              <DataEntryCombobox
                options={[10, 15, 20, 30, 50].map((n) => ({ value: String(n), label: `Top ${n}` }))}
                value={String(topN)}
                onValueChange={(v) => setTopN(parseInt(v, 10) || 15)}
                placeholder="Top"
                searchPlaceholder="Buscar…"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Tomar precios</Label>
              <DataEntryCombobox
                options={[
                  { value: "sin", label: "Sin IVA (÷1,21)" },
                  { value: "con", label: "Con IVA (bruto)" },
                ]}
                value={ivaIncluded ? "con" : "sin"}
                onValueChange={(v) => setIvaIncluded(v === "con")}
                placeholder="IVA"
                searchPlaceholder="Buscar…"
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs flex items-center gap-1.5">
              <Store className="h-3.5 w-3.5" /> Locales
            </Label>
            <MultiLocalSelect locals={locals} value={localIds} onChange={setLocalIds} />
          </div>

          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1">
              <Label className="text-xs">Objetivo de CMV % (semáforo)</Label>
              <Input
                type="number"
                className="w-28"
                value={cmvObjetivo}
                onChange={(e) => setCmvObjetivo(parseFloat(e.target.value) || 0)}
                data-testid="input-productos-vendidos-objetivo"
              />
            </div>
            {data && (
              <p className="text-xs text-muted-foreground pb-2">
                Comparando <span className="font-medium text-foreground">{fmtDate(data.period.from)} al {fmtDate(data.period.to)}</span>{" "}
                ({data.period.days} días) contra{" "}
                <span className="font-medium text-foreground">{fmtDate(data.prevPeriod.from)} al {fmtDate(data.prevPeriod.to)}</span>{" "}
                ({data.prevPeriod.days} días).
                {data.prevPeriod.days !== data.period.days && " Los períodos tienen distinto largo: mirá la columna Por día."}
              </p>
            )}
          </div>

          {source === "datalive" && (
            <p className="text-xs text-muted-foreground">
              Datalive importa los productos por período (desde/hasta) y no por día: solo entran los períodos
              que caen enteros dentro del rango elegido.
            </p>
          )}
        </CardContent>
      </Card>

      {/* ── Resultado ── */}
      {ready && (
        <Card>
          <CardHeader className="flex flex-row items-start justify-between space-y-0 gap-4 pb-3">
            <div>
              <CardTitle className="text-base">Top {topN} por unidades</CardTitle>
              <p className="text-xs text-muted-foreground pt-1" data-testid="text-productos-vendidos-locales">
                Estás viendo: <span className="font-medium text-foreground">{localesLabel || "—"}</span>
                {data && <> · Origen: <span className="font-medium text-foreground">{SOURCE_LABELS[data.source] ?? data.source}</span></>}
              </p>
            </div>
            <div className="flex flex-wrap gap-2 justify-end">
              {(["empleados", "supervisores", "socios"] as ProductosVendidosPdfLevel[]).map((level) => (
                <Button
                  key={level}
                  size="sm"
                  variant={level === "socios" ? "default" : "outline"}
                  disabled={!data || isLoading}
                  onClick={() => exportPdf(level)}
                  data-testid={`button-pdf-${level}`}
                >
                  <FileDown className="h-4 w-4 mr-1.5" />
                  {PDF_LEVEL_LABELS[level]}
                </Button>
              ))}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {isLoading ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-20 w-full" />)}
              </div>
            ) : isError ? (
              <p className="text-sm text-destructive">{(error as Error)?.message}</p>
            ) : data ? (
              <>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Stat
                    label="Unidades vendidas"
                    value={fmtNum(data.totals.unidades)}
                    hint={`${data.totals.productosDistintos} productos · ${data.period.diasConVenta} días con venta`}
                  />
                  <Stat
                    label="Contra el período anterior"
                    value={fmtSigned(data.totals.variacionPct)}
                    hint={`${fmtNum(data.totals.unidadesPrev)} unidades antes`}
                    tone={data.totals.variacionPct == null ? "default" : data.totals.variacionPct >= 0 ? "good" : "bad"}
                  />
                  <Stat
                    label={`El top ${data.items.length} explica`}
                    value={fmtPct(data.totals.topParticipacionPct)}
                    hint={`${data.totals.productosHasta80} productos hacen el 80% del total`}
                  />
                  <Stat
                    label="Margen promedio (teórico)"
                    value={fmtPct(data.totals.margenPonderadoPct)}
                    hint={`CMV ${fmtPct(data.totals.cmvPonderadoPct)} · cobertura ${fmtPct(data.totals.coberturaPct)}`}
                    tone={
                      data.totals.cmvPonderadoPct == null
                        ? "default"
                        : data.totals.cmvPonderadoPct <= cmvObjetivo
                          ? "good"
                          : "bad"
                    }
                  />
                </div>

                {data.totals.coberturaPct != null && data.totals.coberturaPct < 100 && (
                  <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 flex gap-2 items-start">
                    <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-500 mt-0.5 shrink-0" />
                    <p className="text-sm text-amber-700 dark:text-amber-400">
                      Solo el <span className="font-semibold">{fmtPct(data.totals.coberturaPct)}</span> de las unidades
                      vendidas tiene un costo cargado. Las columnas de CMV y margen quedan en "—" hasta que se le asigne
                      costo a cada producto — usá el botón <span className="font-semibold">Costear</span> de cada fila.
                    </p>
                  </div>
                )}

                {data.items.length === 0 ? (
                  <p className="text-center py-8 text-sm text-muted-foreground">
                    No hay productos vendidos importados de {SOURCE_LABELS[data.source] ?? data.source} en este período
                    y estos locales.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-xs text-muted-foreground">
                          <th className="text-left font-medium py-2 w-8">#</th>
                          <th className="text-left font-medium py-2">Producto</th>
                          <th className="text-right font-medium py-2">Unidades</th>
                          <th className="text-right font-medium py-2">Por día</th>
                          <th className="text-right font-medium py-2">% del total</th>
                          <th className="text-right font-medium py-2">vs anterior</th>
                          <th className="text-right font-medium py-2">CMV %</th>
                          <th className="text-right font-medium py-2">Margen %</th>
                          <th className="text-right font-medium py-2">Margen $</th>
                          <th className="text-right font-medium py-2 w-20"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.items.map((it) => (
                          <tr key={it.producto} className="border-b last:border-0 hover:bg-muted/40">
                            <td className="py-2 text-xs text-muted-foreground">{it.rank}</td>
                            <td className="py-2">
                              <p className="font-medium">{it.producto}</p>
                              <p className="text-[11px] text-muted-foreground">
                                {it.categoria ? `${it.categoria} · ` : ""}
                                {it.recipeName
                                  ? `${it.costMode === "manual" ? "Costo manual" : it.recipeName}`
                                  : it.costMode === "manual"
                                    ? "Costo manual"
                                    : "Sin costo asignado"}
                                {multiLocal && it.porLocal.length > 0 && (
                                  <>
                                    {" · "}
                                    {it.porLocal.slice(0, 3).map((p) => `${p.localName}: ${fmtNum(p.cantidad)}`).join(" · ")}
                                  </>
                                )}
                              </p>
                            </td>
                            <td className="py-2 text-right font-mono">{fmtNum(it.cantidad)}</td>
                            <td className="py-2 text-right font-mono text-muted-foreground">{fmtNum(it.unidadesPorDia, 1)}</td>
                            <td className="py-2 text-right font-mono">{fmtPct(it.participacionPct)}</td>
                            <td className="py-2 text-right">
                              <Variacion value={it.variacionPct} esNuevo={it.esNuevo} />
                            </td>
                            <td className={`py-2 text-right font-mono ${cmvTone(it.cmvPct)}`}>{fmtPct(it.cmvPct)}</td>
                            <td className={`py-2 text-right font-mono ${cmvTone(it.cmvPct)}`}>{fmtPct(it.margenPct)}</td>
                            <td className="py-2 text-right font-mono">
                              {it.margenTotal == null ? "—" : formatCurrency(it.margenTotal)}
                            </td>
                            <td className="py-2 text-right whitespace-nowrap">
                              <Button
                                size="sm"
                                variant={it.costoUnitario == null ? "outline" : "ghost"}
                                className="h-7 text-xs"
                                onClick={() => openCostDialog(it)}
                              >
                                <DollarSign className="h-3.5 w-3.5 mr-1" />
                                {it.costoUnitario == null ? "Costear" : "Editar"}
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0 text-muted-foreground"
                                title="Sacar del ranking (no es un producto)"
                                onClick={() => setExcluded([...excluded, it.producto])}
                                data-testid="button-excluir-producto"
                              >
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {excluded.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <span className="text-xs text-muted-foreground">Fuera del ranking:</span>
                    {excluded.map((name) => (
                      <Badge key={name} variant="secondary" className="text-[11px] gap-1">
                        {name}
                        <button type="button" onClick={() => setExcluded(excluded.filter((n) => n !== name))}>
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                    <button type="button" className="text-xs text-primary hover:underline" onClick={() => setExcluded([])}>
                      Restablecer
                    </button>
                  </div>
                )}
              </>
            ) : null}
          </CardContent>
        </Card>
      )}

      {/* ── Movimientos ── */}
      {data && (data.subidas.length > 0 || data.bajas.length > 0 || data.desaparecidos.length > 0) && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Qué se movió</CardTitle>
            <p className="text-xs text-muted-foreground">
              Solo productos que en el período anterior vendieron al menos {fmtNum(data.moversMinBase)} unidades.
            </p>
          </CardHeader>
          <CardContent className="grid gap-6 md:grid-cols-3">
            <div>
              <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-500 mb-2">Los que más subieron</p>
              <div className="space-y-1.5">
                {data.subidas.length === 0 && <p className="text-xs text-muted-foreground">Sin datos suficientes.</p>}
                {data.subidas.map((m) => (
                  <div key={m.producto} className="flex items-center justify-between gap-2 text-sm">
                    <span className="truncate">{m.producto}</span>
                    <span className="font-mono text-emerald-600 dark:text-emerald-500 shrink-0">{fmtSigned(m.variacionPct)}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold text-destructive mb-2">Los que más bajaron</p>
              <div className="space-y-1.5">
                {data.bajas.length === 0 && <p className="text-xs text-muted-foreground">Sin datos suficientes.</p>}
                {data.bajas.map((m) => (
                  <div key={m.producto} className="flex items-center justify-between gap-2 text-sm">
                    <span className="truncate">{m.producto}</span>
                    <span className="font-mono text-destructive shrink-0">{fmtSigned(m.variacionPct)}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-2">Dejaron de venderse</p>
              <div className="space-y-1.5">
                {data.desaparecidos.length === 0 && <p className="text-xs text-muted-foreground">Ninguno.</p>}
                {data.desaparecidos.map((m) => (
                  <div key={m.producto} className="flex items-center justify-between gap-2 text-sm">
                    <span className="truncate">{m.producto}</span>
                    <span className="font-mono text-muted-foreground shrink-0">{fmtNum(m.cantidadPrev)} antes</span>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Costeo de un producto (mismo catálogo que CMV Productos) ── */}
      <Dialog open={costTarget != null} onOpenChange={(o) => !o && setCostTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Costo de "{costTarget?.producto}"</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              El costo se guarda para {SOURCE_LABELS[source] ?? source} y vale también en CMV Productos: se carga una
              sola vez. Si elegís una receta, el costo se actualiza solo cuando cambian los insumos.
            </p>
            <div className="space-y-1">
              <Label className="text-xs">De dónde sale el costo</Label>
              <DataEntryCombobox
                options={[
                  { value: "receta", label: "De una receta" },
                  { value: "manual", label: "Costo manual (bebidas, reventa)" },
                ]}
                value={costMode}
                onValueChange={(v) => setCostMode(v as "receta" | "manual")}
                placeholder="Modo"
                searchPlaceholder="Buscar…"
              />
            </div>
            {costMode === "receta" ? (
              <div className="space-y-1">
                <Label className="text-xs">Receta</Label>
                <DataEntryCombobox
                  options={recipeOptions}
                  value={costRecipeId}
                  onValueChange={setCostRecipeId}
                  placeholder="Elegí la receta"
                  searchPlaceholder="Buscar receta…"
                />
              </div>
            ) : (
              <div className="space-y-1">
                <Label className="text-xs">Costo unitario sin IVA</Label>
                <Input
                  value={costManual}
                  onChange={(e) => setCostManual(formatEsArAmountInput(e.target.value))}
                  placeholder="0,00"
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCostTarget(null)}>Cancelar</Button>
            <Button
              onClick={() => saveCostMutation.mutate()}
              disabled={saveCostMutation.isPending || (costMode === "receta" ? !costRecipeId : !costManual)}
            >
              {saveCostMutation.isPending ? "Guardando..." : "Guardar costo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
