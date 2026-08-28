import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatCurrency } from "@/lib/formatters";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell, LabelList,
} from "recharts";
import {
  TrendingUp, TrendingDown, Minus, Target, Ticket, DollarSign, Building2,
  CreditCard, BarChart3, ShoppingCart, ChefHat, Trophy, PiggyBank, Percent,
  AlertCircle, CheckCircle2, Trash2, FileDown, ReceiptText,
} from "lucide-react";
import { useSalesSources } from "@/hooks/useSalesSources";
import { usePersistentFilter } from "@/hooks/usePersistentFilter";
import type { Local, CmvCalculation } from "@shared/schema";

const MONTH_NAMES = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
const MONTH_NAMES_FULL = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
const DAY_NAMES = ["lunes","martes","miércoles","jueves","viernes","sábado","domingo"];

const PIE_COLORS = ["#6366f1","#f59e0b","#10b981","#ef4444","#8b5cf6","#ec4899","#14b8a6","#f97316","#84cc16","#06b6d4"];

function pct(n: number | null) {
  if (n == null) return null;
  return n.toFixed(1) + "%";
}

// Importe dentro de la barra: sin decimales para que entre en vertical; vacío si no hubo venta.
function barAmountLabel(v: any) {
  const n = Number(v);
  if (!n) return "";
  return Math.round(n).toLocaleString("es-AR");
}

function TrendBadge({ value }: { value: number | null }) {
  if (value == null) return null;
  const isPos = value >= 0;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded-full ${isPos ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"}`}>
      {isPos ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {Math.abs(value).toFixed(1)}%
    </span>
  );
}

function GoalBar({ value, goal, label }: { value: number; goal: number; label: string }) {
  const pctReached = goal > 0 ? Math.min((value / goal) * 100, 100) : 0;
  const color = pctReached >= 100 ? "bg-emerald-500" : pctReached >= 75 ? "bg-amber-400" : "bg-red-400";
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <span>{pctReached.toFixed(1)}%</span>
      </div>
      <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pctReached}%` }} />
      </div>
    </div>
  );
}

function SkeletonCard() {
  return <Card><CardContent className="pt-6"><Skeleton className="h-24 w-full" /></CardContent></Card>;
}

const CustomTooltipBar = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-background border rounded-lg shadow-lg p-3 text-sm">
      <p className="font-medium mb-1">{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} style={{ color: p.color }}>{p.name}: {formatCurrency(p.value)}</p>
      ))}
    </div>
  );
};

function MultiLocalSelect({ locals, value, onChange }: { locals: Local[]; value: number[]; onChange: (v: number[]) => void }) {
  const toggle = (id: number) => {
    if (value.includes(id)) onChange(value.filter((x) => x !== id));
    else onChange([...value, id]);
  };
  const allSelected = value.length === 0;
  return (
    <div className="flex flex-wrap gap-1.5">
      <button
        className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${allSelected ? "bg-primary text-primary-foreground border-primary" : "bg-background text-muted-foreground border-border hover:bg-muted"}`}
        onClick={() => onChange([])}
      >
        Todos
      </button>
      {locals.map((l) => (
        <button
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

// Monday of the current week
function currentWeekMonday() {
  const d = new Date();
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1 - day);
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

// Captura un nodo del DOM y lo baja como PDF (multi-página si es alto). "Foto" del análisis.
async function downloadNodeAsPdf(el: HTMLElement, filename: string) {
  const isDark = document.documentElement.classList.contains("dark");
  // El viewport del clon debe ser el real: si se achica, los gráficos (SVG de ancho fijo)
  // se desbordan y quedan cortados, y los filtros con flex-wrap se re-acomodan pisándose.
  const canvas = await html2canvas(el, {
    scale: 2,
    useCORS: true,
    backgroundColor: isDark ? "#0b1220" : "#ffffff",
    windowWidth: document.documentElement.clientWidth,
    windowHeight: document.documentElement.clientHeight,
  });
  const pdf = new jsPDF({
    orientation: canvas.width > canvas.height ? "l" : "p",
    unit: "pt",
    format: "a4",
  });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const imgW = pageW;
  const imgH = (canvas.height * imgW) / canvas.width;
  const img = canvas.toDataURL("image/png");
  let heightLeft = imgH;
  let position = 0;
  pdf.addImage(img, "PNG", 0, position, imgW, imgH);
  heightLeft -= pageH;
  while (heightLeft > 0) {
    position -= pageH;
    pdf.addPage();
    pdf.addImage(img, "PNG", 0, position, imgW, imgH);
    heightLeft -= pageH;
  }
  const d = new Date();
  const ts = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  pdf.save(`${filename}_${ts}.pdf`);
}

// Botón "PDF" por análisis: exporta la card más cercana marcada con [data-pdf-card].
// onBeforeCapture/onAfterCapture permiten mostrar encabezados solo en el PDF.
function AnalysisPdfButton({ name, onBeforeCapture, onAfterCapture }: {
  name: string;
  onBeforeCapture?: () => void;
  onAfterCapture?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={busy}
      data-html2canvas-ignore="true"
      onClick={async (e) => {
        const el = (e.currentTarget as HTMLElement).closest("[data-pdf-card]") as HTMLElement | null;
        if (!el) return;
        setBusy(true);
        onBeforeCapture?.();
        try {
          // Dos frames para que el encabezado de PDF ya esté pintado antes de capturar.
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null))));
          await downloadNodeAsPdf(el, name);
        } finally {
          onAfterCapture?.();
          setBusy(false);
        }
      }}
    >
      <FileDown className="h-4 w-4 mr-1" /> {busy ? "..." : "PDF"}
    </Button>
  );
}

/** % de una parte sobre el total del periodo. "—" si no hay total: no se inventa un 0%. */
function fiscalPct(part: number, total: number): string {
  if (!Number.isFinite(total) || total <= 0) return "—";
  return `${((part / total) * 100).toFixed(1)}%`;
}

export default function DashboardPage() {
  const now = new Date();
  const dashboardRef = useRef<HTMLDivElement>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [year, setYear] = usePersistentFilter("dashboard.year", now.getFullYear());
  const [month, setMonth] = usePersistentFilter("dashboard.month", now.getMonth() + 1);
  const [globalLocalIds, setGlobalLocalIds] = usePersistentFilter<number[]>("dashboard.localIds", []);
  const [source, setSource] = usePersistentFilter<"fudo" | "datalive" | "shares">("dashboard.source", "fudo");
  // Punto 6 (ago-26): solo se ofrecen los sistemas que la empresa tiene encendidos en Preferencias.
  const { enabled: enabledSalesSources } = useSalesSources();

  // Week widget filters
  const [weekStart, setWeekStart] = usePersistentFilter("dashboard.weekStart", currentWeekMonday());
  const [weekLocalIds, setWeekLocalIds] = usePersistentFilter<number[]>("dashboard.weekLocalIds", []);
  const [weekSource, setWeekSource] = usePersistentFilter<"fudo" | "datalive" | "shares">("dashboard.weekSource", "fudo");
  const [weekPdfMode, setWeekPdfMode] = useState(false); // encabezado que sale solo en el PDF

  // Top products/categories filters
  const [topDateFrom, setTopDateFrom] = usePersistentFilter("dashboard.topDateFrom", `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`);
  const [topDateTo, setTopDateTo] = usePersistentFilter("dashboard.topDateTo", now.toISOString().slice(0, 10));
  const [topLocalIds, setTopLocalIds] = usePersistentFilter<number[]>("dashboard.topLocalIds", []);
  const [topSource, setTopSource] = usePersistentFilter<"fudo" | "datalive" | "shares">("dashboard.topSource", "fudo");
  // Si el origen elegido queda deshabilitado, se cae al primero habilitado en vez de
  // quedar mostrando una fuente que la empresa ya no usa.
  useEffect(() => {
    if (enabledSalesSources.length === 0) return;
    const fix = (
      current: "fudo" | "datalive" | "shares",
      set: (next: "fudo" | "datalive" | "shares") => void,
    ) => {
      if (!enabledSalesSources.includes(current)) set(enabledSalesSources[0]);
    };
    fix(source, setSource);
    fix(weekSource, setWeekSource);
    fix(topSource, setTopSource);
  }, [enabledSalesSources.join(","), source, weekSource, topSource]);

  const [excludedProducts, setExcludedProducts] = useState<Set<string>>(new Set());
  const [excludedCategorias, setExcludedCategorias] = useState<Set<string>>(new Set());

  const { data: locals = [] } = useQuery<Local[]>({ queryKey: ["/api/locals"] });
  const localIdsParam = globalLocalIds.length > 0 ? globalLocalIds.join(",") : locals.map((l) => l.id).join(",");
  const weekLocalParam = weekLocalIds.length > 0 ? weekLocalIds.join(",") : locals.map((l) => l.id).join(",");
  const topLocalParam = topLocalIds.length > 0 ? topLocalIds.join(",") : locals.map((l) => l.id).join(",");

  const { data: ventasSummary, isLoading: loadingVentas } = useQuery<any>({
    queryKey: ["/api/dashboard/ventas-summary", year, month, localIdsParam, source],
    queryFn: () => apiRequest("GET", `/api/dashboard/ventas-summary?year=${year}&month=${month}&localIds=${localIdsParam}&source=${source}`).then((r) => r.json()),
    enabled: locals.length > 0,
  });

  const { data: goalsData = [] } = useQuery<any[]>({
    queryKey: ["/api/monthly-goals", year, month],
    queryFn: () => apiRequest("GET", `/api/monthly-goals?year=${year}&month=${month}`).then((r) => r.json()),
  });

  const { data: saldosData = [] } = useQuery<any[]>({
    queryKey: ["/api/dashboard/saldos", year, month],
    queryFn: () => apiRequest("GET", `/api/dashboard/saldos?year=${year}&month=${month}`).then((r) => r.json()),
  });

  const { data: deudasData = [] } = useQuery<any[]>({
    queryKey: ["/api/dashboard/deudas-proveedores"],
    queryFn: () => apiRequest("GET", "/api/dashboard/deudas-proveedores").then((r) => r.json()),
  });

  const { data: weekData } = useQuery<any>({
    queryKey: ["/api/dashboard/ventas-semanales", weekStart, weekLocalParam, weekSource],
    queryFn: () => apiRequest("GET", `/api/dashboard/ventas-semanales?weekStart=${weekStart}&localIds=${weekLocalParam}&source=${weekSource}`).then((r) => r.json()),
    enabled: locals.length > 0 && !!weekStart,
  });

  const { data: cmvSemanaData } = useQuery<any>({
    queryKey: ["/api/dashboard/cmv-semanal", weekStart, weekLocalParam],
    queryFn: () => {
      const start = new Date(weekStart + "T00:00:00Z");
      const end = new Date(start);
      end.setUTCDate(end.getUTCDate() + 6);
      const prevStart = new Date(start);
      prevStart.setUTCDate(prevStart.getUTCDate() - 7);
      const prevEnd = new Date(prevStart);
      prevEnd.setUTCDate(prevEnd.getUTCDate() + 6);
      const df = prevStart.toISOString().slice(0, 10);
      const dt = end.toISOString().slice(0, 10);
      return apiRequest("GET", `/api/dashboard/cmv-semanal?dateFrom=${df}&dateTo=${dt}&weekStart=${weekStart}&localIds=${weekLocalParam}`).then((r) => r.json());
    },
    enabled: locals.length > 0 && !!weekStart,
  });

  const { data: topProductos = [] } = useQuery<any[]>({
    queryKey: ["/api/dashboard/top-productos", topDateFrom, topDateTo, topLocalParam, topSource],
    queryFn: () => apiRequest("GET", `/api/dashboard/top-productos?dateFrom=${topDateFrom}&dateTo=${topDateTo}&localIds=${topLocalParam}&source=${topSource}`).then((r) => r.json()),
    enabled: locals.length > 0,
  });

  // Ventas Fiscalizadas: solo FUDO trae el dato (col N del reporte); Datalive y Shares no lo tienen.
  const { data: fiscalData } = useQuery<any>({
    queryKey: ["/api/dashboard/ventas-fiscalizadas", year, month, localIdsParam],
    queryFn: () => apiRequest("GET", `/api/dashboard/ventas-fiscalizadas?year=${year}&month=${month}&localIds=${localIdsParam}`).then((r) => r.json()),
    enabled: locals.length > 0 && source === "fudo",
  });

  const { data: topCategorias = [] } = useQuery<any[]>({
    queryKey: ["/api/dashboard/top-categorias", topDateFrom, topDateTo, topLocalParam, topSource],
    queryFn: () => apiRequest("GET", `/api/dashboard/top-categorias?dateFrom=${topDateFrom}&dateTo=${topDateTo}&localIds=${topLocalParam}&source=${topSource}`).then((r) => r.json()),
    enabled: locals.length > 0,
  });

  // Punto 18: recetas + mapeo producto vendido → receta (para margen de los más vendidos).
  const { data: recipes = [] } = useQuery<any[]>({ queryKey: ["/api/recipes"] });
  const { data: prodMappings = [] } = useQuery<any[]>({ queryKey: ["/api/product-recipe-mappings"] });
  const mapMutation = useMutation({
    mutationFn: (body: { source: string; productName: string; recipeId: number }) =>
      apiRequest("POST", "/api/product-recipe-mappings", body).then((r) => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/product-recipe-mappings"] }),
  });

  const { data: composicionData = [] } = useQuery<any[]>({
    queryKey: ["/api/dashboard/composicion-pagos", year, month, localIdsParam, source],
    queryFn: () => apiRequest("GET", `/api/dashboard/composicion-pagos?year=${year}&month=${month}&localIds=${localIdsParam}&source=${source}`).then((r) => r.json()),
    enabled: locals.length > 0,
  });

  const { data: evolucionData = [] } = useQuery<any[]>({
    queryKey: ["/api/dashboard/evolucion-mensual", year, localIdsParam, source],
    queryFn: () => apiRequest("GET", `/api/dashboard/evolucion-mensual?year=${year}&localIds=${localIdsParam}&source=${source}`).then((r) => r.json()),
    enabled: locals.length > 0,
  });

  const { data: top3Data } = useQuery<any>({
    queryKey: ["/api/dashboard/top3-balance", year],
    queryFn: () => apiRequest("GET", `/api/dashboard/top3-balance?year=${year}`).then((r) => r.json()),
  });

  // Goals aggregate (sum across selected locals)
  const goalsAggregate = useMemo(() => {
    const filtered = globalLocalIds.length > 0
      ? goalsData.filter((g) => globalLocalIds.includes(g.localId))
      : goalsData;
    return {
      facturacion: filtered.reduce((s, g) => s + (parseFloat(g.facturacionObjetivo) || 0), 0),
      tickets: filtered.reduce((s, g) => s + (g.ticketsObjetivo || 0), 0),
    };
  }, [goalsData, globalLocalIds]);

  // Rango de la semana elegida y la anterior (lunes a domingo, en UTC como el resto del widget)
  const weekRange = useMemo(() => {
    const start = new Date(weekStart + "T00:00:00Z");
    const currEnd = new Date(start); currEnd.setUTCDate(currEnd.getUTCDate() + 6);
    const prevStart = new Date(start); prevStart.setUTCDate(prevStart.getUTCDate() - 7);
    const prevEnd = new Date(start); prevEnd.setUTCDate(prevEnd.getUTCDate() - 1);
    const fmt = (d: Date) => d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
    return {
      start, currEnd, prevStart, prevEnd, fmt,
      currLabel: `${fmt(start)} al ${fmt(currEnd)}`,
      prevLabel: `${fmt(prevStart)} al ${fmt(prevEnd)}`,
    };
  }, [weekStart]);

  const localLabel = useMemo(() => {
    if (globalLocalIds.length === 0) return "Todos los locales";
    const names = locals.filter((l) => globalLocalIds.includes(l.id)).map((l) => l.name);
    return names.length > 0 ? names.join(" · ") : "Todos los locales";
  }, [globalLocalIds, locals]);

  const weekLocalLabel = useMemo(() => {
    if (weekLocalIds.length === 0) return "Todos los locales";
    const names = locals.filter((l) => weekLocalIds.includes(l.id)).map((l) => l.name);
    return names.length > 0 ? names.join(" · ") : "Todos los locales";
  }, [weekLocalIds, locals]);

  // Weekly chart data
  const weekChartData = useMemo(() => {
    if (!weekData) return [];
    return DAY_NAMES.map((day, i) => ({
      day,
      "Semana anterior": weekData.previous?.[i]?.ventaTotal ?? 0,
      "Semana actual": weekData.current?.[i]?.ventaTotal ?? 0,
    }));
  }, [weekData]);

  // Weekly summary
  const weekSummary = useMemo(() => {
    if (!weekData) return null;
    const curr = (weekData.current ?? []).reduce((s: number, d: any) => s + d.ventaTotal, 0);
    const prev = (weekData.previous ?? []).reduce((s: number, d: any) => s + d.ventaTotal, 0);
    return { curr, prev, pct: prev > 0 ? ((curr - prev) / prev) * 100 : null };
  }, [weekData]);

  // Top 10 with exclude
  const visibleProducts = useMemo(() => {
    const all = topProductos.filter((p) => !excludedProducts.has(p.producto));
    return all.slice(0, 10);
  }, [topProductos, excludedProducts]);

  const visibleCategorias = useMemo(() => {
    const all = topCategorias.filter((c) => !excludedCategorias.has(c.categoria));
    return all.slice(0, 10);
  }, [topCategorias, excludedCategorias]);

  // Punto 18: margen de los más vendidos según la receta mapeada (precio − costo, sin IVA).
  const recipeById = useMemo(() => new Map(recipes.map((r: any) => [r.id, r])), [recipes]);
  const mappingByName = useMemo(() => {
    const m = new Map<string, number>();
    for (const mp of prodMappings) if (mp.source === topSource) m.set(mp.productName, mp.recipeId);
    return m;
  }, [prodMappings, topSource]);
  const marginProducts = useMemo(() => {
    return visibleProducts.map((p: any) => {
      const recipeId = mappingByName.get(p.producto);
      const recipe = recipeId != null ? recipeById.get(recipeId) : null;
      const price = recipe ? parseFloat(String(recipe.salePrice ?? "0")) || 0 : null;
      const cost = recipe ? parseFloat(String(recipe.totalCost ?? "0")) || 0 : null;
      const unitMargin = price != null && cost != null ? price - cost : null;
      const totalMargin = unitMargin != null ? unitMargin * (p.cantidad ?? 0) : null;
      // Punto 4: usar el margen % YA calculado y persistido en la receta (ej. Empanada 35,97%),
      // no un porcentaje recalculado. Es coherente con unitMargin (ambos sin IVA).
      const marginPct =
        recipe != null && recipe.marginPercentage != null && recipe.marginPercentage !== ""
          ? parseFloat(String(recipe.marginPercentage))
          : null;
      return { ...p, recipeId, recipeName: recipe?.name ?? null, unitMargin, totalMargin, marginPct };
    });
  }, [visibleProducts, mappingByName, recipeById]);
  const totalMargin = useMemo(
    () => marginProducts.reduce((s: number, p: any) => s + (p.totalMargin ?? 0), 0),
    [marginProducts],
  );
  const recipeSelectOptions = useMemo(
    () => [...recipes].sort((a: any, b: any) => String(a.name).localeCompare(String(b.name), "es")),
    [recipes],
  );

  // Evolution chart
  const evolucionChartData = useMemo(() =>
    evolucionData.map((d: any) => ({ mes: MONTH_NAMES[d.month - 1], ventaTotal: d.ventaTotal })),
    [evolucionData],
  );

  const currentVenta = ventasSummary?.current?.ventaTotal ?? 0;
  const currentTickets = ventasSummary?.current?.ticketCount ?? null;

  const yearOptions = Array.from({ length: 5 }, (_, i) => now.getFullYear() - 2 + i);

  return (
    <div ref={dashboardRef} className="flex flex-col gap-5 p-5 min-h-screen bg-muted/20">
      {/* ── HEADER ── */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <BarChart3 className="h-7 w-7 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={pdfBusy}
            data-html2canvas-ignore="true"
            onClick={async () => {
              if (!dashboardRef.current) return;
              setPdfBusy(true);
              try { await downloadNodeAsPdf(dashboardRef.current, "dashboard_completo"); } finally { setPdfBusy(false); }
            }}
          >
            <FileDown className="h-4 w-4 mr-2" /> {pdfBusy ? "Generando..." : "Descargar PDF"}
          </Button>
        </div>

        {/* Global filters */}
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="pt-4 pb-4">
            <div className="flex flex-wrap gap-6 items-end">
              <div className="space-y-1">
                <Label className="text-xs font-medium text-muted-foreground">Año</Label>
                <Select value={String(year)} onValueChange={(v) => setYear(parseInt(v))}>
                  <SelectTrigger className="w-24 h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>{yearOptions.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium text-muted-foreground">Mes</Label>
                <Select value={String(month)} onValueChange={(v) => setMonth(parseInt(v))}>
                  <SelectTrigger className="w-32 h-8 text-sm"><SelectValue>{MONTH_NAMES_FULL[month - 1]}</SelectValue></SelectTrigger>
                  <SelectContent>{MONTH_NAMES_FULL.map((n, i) => <SelectItem key={i + 1} value={String(i + 1)}>{n}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium text-muted-foreground">Fuente de ventas</Label>
                <div className="flex gap-1">
                  {enabledSalesSources.map((s) => (
                    <button key={s} onClick={() => setSource(s)}
                      className={`px-3 py-1 rounded-md text-xs font-medium border transition-colors ${source === s ? "bg-primary text-primary-foreground border-primary" : "bg-background text-muted-foreground border-border hover:bg-muted"}`}>
                      {s === "fudo" ? "FUDO" : s === "datalive" ? "DATALIVE" : "SHARES"}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1 flex-1">
                <Label className="text-xs font-medium text-muted-foreground">Locales</Label>
                <MultiLocalSelect locals={locals} value={globalLocalIds} onChange={setGlobalLocalIds} />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── ROW 1: KPIs principales ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* 1. Facturación del mes */}
        <Card className="relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 rounded-full bg-indigo-500/10 -translate-y-4 translate-x-4" />
          <CardContent className="pt-5">
            <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium mb-2">
              <DollarSign className="h-3.5 w-3.5" />
              FACTURACIÓN DEL MES
            </div>
            {loadingVentas ? <Skeleton className="h-8 w-40" /> : (
              <>
                <p className="text-3xl font-bold text-indigo-600 dark:text-indigo-400">{formatCurrency(currentVenta)}</p>
                <div className="flex gap-2 mt-2 flex-wrap">
                  <TrendBadge value={ventasSummary?.pctVsPrev ?? null} />
                  <span className="text-xs text-muted-foreground">vs mes ant.</span>
                </div>
                {ventasSummary?.pctVsPrev2 != null && (
                  <p className="text-xs text-muted-foreground mt-1">
                    <TrendBadge value={ventasSummary.pctVsPrev2} /> vs hace 2 meses
                  </p>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* 2. Tickets del mes */}
        <Card className="relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 rounded-full bg-violet-500/10 -translate-y-4 translate-x-4" />
          <CardContent className="pt-5">
            <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium mb-2">
              <Ticket className="h-3.5 w-3.5" />
              TICKETS DEL MES
            </div>
            {loadingVentas ? <Skeleton className="h-8 w-24" /> : source === "datalive" ? (
              <div className="flex items-center gap-2 mt-2">
                <p className="text-2xl font-bold text-muted-foreground">—</p>
                <span className="text-xs text-muted-foreground">No disponible en Datalive</span>
              </div>
            ) : (
              <>
                <p className="text-3xl font-bold text-violet-600 dark:text-violet-400">{currentTickets?.toLocaleString() ?? "—"}</p>
                <div className="flex gap-2 mt-2">
                  {ventasSummary?.prev?.ticketCount != null && currentTickets != null && (
                    <TrendBadge value={ventasSummary.prev.ticketCount > 0 ? ((currentTickets - ventasSummary.prev.ticketCount) / ventasSummary.prev.ticketCount) * 100 : null} />
                  )}
                  <span className="text-xs text-muted-foreground">vs mes ant.</span>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* 3. Objetivo Facturación */}
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium mb-3">
              <Target className="h-3.5 w-3.5" />
              OBJETIVO FACTURACIÓN
            </div>
            {goalsAggregate.facturacion > 0 ? (
              <div className="space-y-3">
                <div>
                  <p className="text-sm text-muted-foreground">Objetivo</p>
                  <p className="text-xl font-bold">{formatCurrency(goalsAggregate.facturacion)}</p>
                </div>
                <GoalBar value={currentVenta} goal={goalsAggregate.facturacion} label="Alcance" />
                <div className="flex items-center gap-1 text-sm">
                  {currentVenta >= goalsAggregate.facturacion
                    ? <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    : <AlertCircle className="h-4 w-4 text-amber-500" />}
                  <span className="font-medium">{goalsAggregate.facturacion > 0 ? ((currentVenta / goalsAggregate.facturacion) * 100).toFixed(1) : "0"}%</span>
                </div>
              </div>
            ) : (
              <div className="text-center py-4 text-muted-foreground text-sm">Sin objetivo definido</div>
            )}
          </CardContent>
        </Card>

        {/* 4. Objetivo Tickets */}
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium mb-3">
              <Target className="h-3.5 w-3.5" />
              OBJETIVO TICKETS
            </div>
            {goalsAggregate.tickets > 0 && source !== "datalive" ? (
              <div className="space-y-3">
                <div>
                  <p className="text-sm text-muted-foreground">Objetivo</p>
                  <p className="text-xl font-bold">{goalsAggregate.tickets.toLocaleString()}</p>
                </div>
                <GoalBar value={currentTickets ?? 0} goal={goalsAggregate.tickets} label="Alcance" />
                <div className="flex items-center gap-1 text-sm">
                  {(currentTickets ?? 0) >= goalsAggregate.tickets
                    ? <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    : <AlertCircle className="h-4 w-4 text-amber-500" />}
                  <span className="font-medium">{goalsAggregate.tickets > 0 ? (((currentTickets ?? 0) / goalsAggregate.tickets) * 100).toFixed(1) : "0"}%</span>
                </div>
              </div>
            ) : (
              <div className="text-center py-4 text-muted-foreground text-sm">
                {source === "datalive" ? "No disponible en Datalive" : "Sin objetivo definido"}
              </div>
            )}
          </CardContent>
        </Card>
      </div>


      {/* ── ROW 1b: Ventas Fiscalizadas (solo FUDO — Datalive/Shares no traen el dato) ── */}
      {source === "fudo" && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <ReceiptText className="h-4 w-4 text-primary" />
              Ventas Fiscalizadas
              <span className="text-xs font-normal text-muted-foreground">
                {MONTH_NAMES_FULL[month - 1]} {year} · {localLabel}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {fiscalData == null ? (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 w-full" />)}
              </div>
            ) : fiscalData.ventaTotal === 0 ? (
              <p className="text-sm text-muted-foreground py-2">
                No hay ventas de FUDO importadas para este mes y estos locales.
              </p>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">FISCALIZADO</p>
                    <p className="text-2xl font-bold font-mono text-emerald-600 dark:text-emerald-400">
                      {formatCurrency(fiscalData.fiscalizada)}
                    </p>
                    <p className="text-xs text-muted-foreground pt-0.5">
                      {fiscalPct(fiscalData.fiscalizada, fiscalData.ventaTotal)} del total ·{" "}
                      {fiscalData.ticketsFiscalizados.toLocaleString("es-AR")} tickets
                    </p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">NO FISCALIZADO</p>
                    <p className="text-2xl font-bold font-mono text-rose-600 dark:text-rose-400">
                      {formatCurrency(fiscalData.noFiscalizada)}
                    </p>
                    <p className="text-xs text-muted-foreground pt-0.5">
                      {fiscalPct(fiscalData.noFiscalizada, fiscalData.ventaTotal)} del total ·{" "}
                      {fiscalData.ticketsNoFiscalizados.toLocaleString("es-AR")} tickets
                    </p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">VENTA TOTAL DEL MES</p>
                    <p className="text-2xl font-bold font-mono">{formatCurrency(fiscalData.ventaTotal)}</p>
                    <p className="text-xs text-muted-foreground pt-0.5">
                      {fiscalData.diasConDato + fiscalData.diasSinDato} día(s) importado(s)
                    </p>
                  </div>
                </div>

                {/*
                  Los días importados antes de que se leyera la columna N no tienen el corte. Se
                  muestran aparte: contarlos como "no fiscalizado" daría un porcentaje falso.
                */}
                {fiscalData.sinDato > 0 && (
                  <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 space-y-1">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-500 mt-0.5 shrink-0" />
                      <p className="text-sm text-amber-700 dark:text-amber-400">
                        <span className="font-semibold">{formatCurrency(fiscalData.sinDato)}</span>{" "}
                        ({fiscalPct(fiscalData.sinDato, fiscalData.ventaTotal)} del total) sin dato de
                        fiscalización
                        {fiscalData.diasSinDato > 0 && `, en ${fiscalData.diasSinDato} día(s) importados antes de que se leyera la columna`}
                        . Volvé a importar el archivo de FUDO marcando "reemplazar" para completarlos.
                      </p>
                    </div>
                    {fiscalData.fiscalizada + fiscalData.noFiscalizada > 0 && (
                      <p className="text-xs text-amber-700/80 dark:text-amber-400/80 pl-6">
                        Sobre lo que sí tiene dato:{" "}
                        <span className="font-semibold">
                          {fiscalPct(fiscalData.fiscalizada, fiscalData.fiscalizada + fiscalData.noFiscalizada)}
                        </span>{" "}
                        fiscalizado.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── ROW 2: Saldos + Deudas ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 5. Saldos económicos */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Building2 className="h-4 w-4 text-emerald-500" />
              Saldos Económicos — {MONTH_NAMES_FULL[month - 1]} {year}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {saldosData.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">Sin datos de extractos ni de efectivo</p>
            ) : (
              <div className="space-y-2">
                {saldosData.map((acc: any) => (
                  <div key={acc.accountId} className="flex items-center justify-between py-2 border-b last:border-0">
                    <div>
                      <p className="text-sm font-medium">{acc.accountName}</p>
                      {acc.lastMovementDate && (
                        <p className="text-xs text-muted-foreground">Último mov.: {acc.lastMovementDate}</p>
                      )}
                    </div>
                    <p className={`text-sm font-bold ${acc.saldo >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                      {formatCurrency(acc.saldo)}
                    </p>
                  </div>
                ))}
                <div className="flex justify-between font-bold pt-1">
                  <span className="text-sm">Total</span>
                  <span className={`text-sm ${saldosData.reduce((s: number, a: any) => s + a.saldo, 0) >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                    {formatCurrency(saldosData.reduce((s: number, a: any) => s + a.saldo, 0))}
                  </span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 7. Deudas proveedores */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <PiggyBank className="h-4 w-4 text-amber-500" />
              Deudas con Proveedores
            </CardTitle>
          </CardHeader>
          <CardContent>
            {deudasData.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">Sin deudas pendientes</p>
            ) : (
              <div className="space-y-2">
                {deudasData.slice(0, 8).map((s: any) => (
                  <div key={s.supplierId} className="flex items-center justify-between py-1.5 border-b last:border-0">
                    <p className="text-sm">{s.supplierName}</p>
                    <p className="text-sm font-semibold text-red-500">{formatCurrency(s.deuda)}</p>
                  </div>
                ))}
                <div className="flex justify-between font-bold pt-1">
                  <span className="text-sm">Total deuda</span>
                  <span className="text-sm text-red-600">{formatCurrency(deudasData.reduce((s: number, d: any) => s + d.deuda, 0))}</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── ROW 3: Ventas semanales (Widget 8) ── */}
      <Card data-pdf-card>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-blue-500" />
              Facturación Semanal
              <AnalysisPdfButton
                name="facturacion_semanal"
                onBeforeCapture={() => setWeekPdfMode(true)}
                onAfterCapture={() => setWeekPdfMode(false)}
              />
            </CardTitle>
            {/* Los filtros no van al PDF: en su lugar sale el encabezado con local y semanas. */}
            <div className="flex flex-wrap gap-3 items-end" data-html2canvas-ignore="true">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Inicio de semana (lunes)</Label>
                <Input type="date" value={weekStart} onChange={(e) => setWeekStart(e.target.value)} className="h-8 w-40 text-xs" />
              </div>
              <div className="flex gap-1">
                {enabledSalesSources.map((s) => (
                  <button key={s} onClick={() => setWeekSource(s)}
                    className={`px-2 py-1 rounded text-xs font-medium border transition-colors ${weekSource === s ? "bg-primary text-primary-foreground border-primary" : "bg-background text-muted-foreground border-border hover:bg-muted"}`}>
                    {s === "fudo" ? "FUDO" : s === "datalive" ? "DATALIVE" : "SHARES"}
                  </button>
                ))}
              </div>
              <div className="flex-1 min-w-[200px]">
                <MultiLocalSelect locals={locals} value={weekLocalIds} onChange={setWeekLocalIds} />
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {weekPdfMode && (
            <div className="mb-4 border-b pb-3">
              <p className="text-3xl font-bold leading-tight">{weekLocalLabel}</p>
              <p className="text-base font-semibold mt-1">
                Semana actual {weekRange.currLabel} vs Semana anterior {weekRange.prevLabel}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Facturación semanal · Origen {weekSource.toUpperCase()}
              </p>
            </div>
          )}
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weekChartData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => v >= 1000000 ? `${(v / 1000000).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)} />
                <Tooltip content={<CustomTooltipBar />} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Semana anterior" fill="#93c5fd" radius={[3, 3, 0, 0]}>
                  <LabelList dataKey="Semana anterior" position="center" angle={-90} formatter={barAmountLabel} fill="#1e3a5f" fontSize={9} fontWeight={600} />
                </Bar>
                <Bar dataKey="Semana actual" fill="#3b82f6" radius={[3, 3, 0, 0]}>
                  <LabelList dataKey="Semana actual" position="center" angle={-90} formatter={barAmountLabel} fill="#ffffff" fontSize={9} fontWeight={600} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {weekSummary && (() => {
            const factDiff = weekSummary.curr - weekSummary.prev;
            const hasPct = weekSummary.pct !== null && weekSummary.pct !== undefined;
            const pos = (weekSummary.pct ?? 0) >= 0;
            return (
              <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
                <div className="rounded-lg bg-blue-50 dark:bg-blue-950/30 p-3">
                  <p className="text-xs text-muted-foreground">Semana actual</p>
                  <p className="text-lg font-bold text-blue-600">{formatCurrency(weekSummary.curr)}</p>
                </div>
                <div className="rounded-lg bg-muted/50 p-3">
                  <p className="text-xs text-muted-foreground">Semana anterior</p>
                  <p className="text-lg font-bold">{formatCurrency(weekSummary.prev)}</p>
                </div>
                <div className="rounded-lg bg-muted/50 p-3">
                  <p className="text-xs text-muted-foreground">Desfasaje facturación</p>
                  <p className={`text-2xl font-extrabold leading-tight ${pos ? "text-green-600" : "text-red-500"}`}>
                    {hasPct ? `${pos ? "+" : ""}${weekSummary.pct!.toFixed(1)}%` : "—"}
                  </p>
                  <p className={`text-xs font-mono ${factDiff >= 0 ? "text-green-600" : "text-red-500"}`}>
                    {factDiff >= 0 ? "+" : "−"}{formatCurrency(Math.abs(factDiff))}
                  </p>
                </div>
              </div>
            );
          })()}

          {cmvSemanaData && (cmvSemanaData.current?.totalVentas > 0 || cmvSemanaData.previous?.totalVentas > 0) && (() => {
            const curr = cmvSemanaData.current ?? { totalVentas: 0, totalCosto: 0, cmvPct: 0, cmvObjetivo: null, decomisos: 0 };
            const prev = cmvSemanaData.previous ?? { totalVentas: 0, totalCosto: 0, cmvPct: 0, cmvObjetivo: null, decomisos: 0 };
            const cmvEvol = prev.cmvPct > 0 ? curr.cmvPct - prev.cmvPct : null;

            // CMV real vs objetivo (del módulo Objetivos, ponderado por facturación).
            const objetivo: number | null = curr.cmvObjetivo ?? null;
            const cmvDiffPp = objetivo != null ? curr.cmvPct - objetivo : null;      // + = por encima del objetivo (en contra)
            const cmvDiffMoney = objetivo != null ? ((curr.cmvPct - objetivo) / 100) * curr.totalVentas : null;
            const enContra = (cmvDiffPp ?? 0) > 0; // real > objetivo ⇒ gastaste de más
            // Decomiso del período (sobre facturación).
            const decoMoney: number = curr.decomisos ?? 0;
            const decoPct = curr.totalVentas > 0 ? (decoMoney / curr.totalVentas) * 100 : null;

            return (
              <div className="mt-3 rounded-lg border bg-amber-50/50 dark:bg-amber-950/20 p-3">
                <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1"><Percent className="h-3 w-3" /> CMV por semana</p>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded bg-muted/40 px-3 py-2">
                    <p className="text-xs text-muted-foreground mb-1">Semana anterior — {weekRange.prevLabel}</p>
                    <div className="flex gap-4 items-end">
                      <div><p className="text-xs text-muted-foreground">Facturación</p><p className="font-semibold">{formatCurrency(prev.totalVentas)}</p></div>
                      <div><p className="text-xs text-muted-foreground">CMV</p><p className="font-semibold">{formatCurrency(prev.totalCosto)}</p></div>
                      <div><p className="text-xs text-muted-foreground">CMV %</p><p className="text-2xl font-extrabold leading-tight text-amber-600">{prev.cmvPct.toFixed(1)}%</p></div>
                    </div>
                  </div>
                  <div className="rounded bg-blue-50/60 dark:bg-blue-950/20 px-3 py-2">
                    <p className="text-xs text-muted-foreground mb-1">Semana actual — {weekRange.currLabel}</p>
                    <div className="flex gap-4 items-end">
                      <div><p className="text-xs text-muted-foreground">Facturación</p><p className="font-semibold">{formatCurrency(curr.totalVentas)}</p></div>
                      <div><p className="text-xs text-muted-foreground">CMV</p><p className="font-semibold">{formatCurrency(curr.totalCosto)}</p></div>
                      <div><p className="text-xs text-muted-foreground">CMV %</p><p className="text-2xl font-extrabold leading-tight text-amber-600">{curr.cmvPct.toFixed(1)}%</p></div>
                    </div>
                  </div>
                </div>

                {cmvEvol !== null && (
                  <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
                    <span>Evolución CMV:</span>
                    <span className={`font-semibold ${cmvEvol > 0 ? "text-red-500" : "text-green-600"}`}>
                      {cmvEvol > 0 ? "+" : ""}{cmvEvol.toFixed(2)} pp
                    </span>
                    <span className="text-muted-foreground/60">(puntos porcentuales)</span>
                  </div>
                )}

                {/* Análisis ampliado: CMV vs Objetivo + Decomiso (semana actual) */}
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="rounded-lg border bg-background/70 p-3">
                    <p className="text-xs font-medium text-muted-foreground flex items-center gap-1"><Target className="h-3.5 w-3.5" /> CMV vs Objetivo</p>
                    {objetivo == null ? (
                      <p className="text-sm text-muted-foreground mt-2">Sin objetivo de CMV cargado para este mes/local.</p>
                    ) : (
                      <div className="mt-1">
                        <div className="flex items-baseline gap-2">
                          <span className={`text-2xl font-extrabold leading-tight ${enContra ? "text-red-500" : "text-green-600"}`}>
                            {cmvDiffPp! > 0 ? "+" : ""}{cmvDiffPp!.toFixed(1)} pp
                          </span>
                          <span className={`text-xs font-semibold ${enContra ? "text-red-500" : "text-green-600"}`}>
                            {enContra ? "EN CONTRA" : "A FAVOR"}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Objetivo <span className="font-semibold text-foreground">{objetivo.toFixed(1)}%</span> · Real <span className="font-semibold text-foreground">{curr.cmvPct.toFixed(1)}%</span>
                        </p>
                        <p className={`text-sm font-mono font-semibold mt-1 ${enContra ? "text-red-500" : "text-green-600"}`}>
                          {enContra ? "+" : "−"}{formatCurrency(Math.abs(cmvDiffMoney!))} <span className="text-xs font-normal text-muted-foreground">vs objetivo</span>
                        </p>
                      </div>
                    )}
                  </div>
                  <div className="rounded-lg border bg-background/70 p-3">
                    <p className="text-xs font-medium text-muted-foreground flex items-center gap-1"><Trash2 className="h-3.5 w-3.5" /> Decomiso de la semana</p>
                    <div className="mt-1 flex items-baseline gap-3">
                      <span className="text-2xl font-extrabold leading-tight text-orange-600">{decoPct == null ? "—" : `${decoPct.toFixed(1)}%`}</span>
                      <span className="text-sm font-mono font-semibold text-orange-600">{formatCurrency(decoMoney)}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">sobre facturación de la semana</p>
                  </div>
                </div>
              </div>
            );
          })()}
        </CardContent>
      </Card>

      {/* ── ROW 4: Top 10 productos + categorías ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 9. Top 10 Productos */}
        <Card data-pdf-card>
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <ChefHat className="h-4 w-4 text-emerald-500" />
                Top Productos más vendidos
                <AnalysisPdfButton name="top_productos" />
              </CardTitle>
              <div className="flex flex-wrap gap-2 items-end text-xs">
                <Input type="date" value={topDateFrom} onChange={(e) => setTopDateFrom(e.target.value)} className="h-7 w-36 text-xs" />
                <span className="text-muted-foreground">—</span>
                <Input type="date" value={topDateTo} onChange={(e) => setTopDateTo(e.target.value)} className="h-7 w-36 text-xs" />
                <div className="flex gap-1">
                  {enabledSalesSources.map((s) => (
                    <button key={s} onClick={() => setTopSource(s)}
                      className={`px-2 py-0.5 rounded text-xs font-medium border transition-colors ${topSource === s ? "bg-primary text-primary-foreground border-primary" : "bg-background text-muted-foreground border-border hover:bg-muted"}`}>
                      {s === "fudo" ? "FUDO" : s === "datalive" ? "DATA" : "SHARES"}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="mt-1">
              <MultiLocalSelect locals={locals} value={topLocalIds} onChange={setTopLocalIds} />
            </div>
          </CardHeader>
          <CardContent>
            {visibleProducts.length === 0 ? (
              <p className="text-center py-6 text-sm text-muted-foreground">Sin datos de productos</p>
            ) : (
              <div className="space-y-2">
                {visibleProducts.map((p: any, i: number) => {
                  const max = visibleProducts[0]?.cantidad ?? 1;
                  return (
                    <div key={p.producto} className="flex items-center gap-2">
                      <span className="w-5 text-xs text-muted-foreground text-right shrink-0">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-0.5">
                          <p className="text-xs truncate">{p.producto}</p>
                          <span className="text-xs font-semibold shrink-0 ml-2">{p.cantidad.toLocaleString()}</span>
                        </div>
                        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                          <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${(p.cantidad / max) * 100}%` }} />
                        </div>
                      </div>
                      <button onClick={() => setExcludedProducts((prev) => { const n = new Set(prev); n.add(p.producto); return n; })}
                        className="text-muted-foreground hover:text-destructive shrink-0 text-xs" title="Excluir">✕</button>
                    </div>
                  );
                })}
                {excludedProducts.size > 0 && (
                  <button onClick={() => setExcludedProducts(new Set())} className="text-xs text-primary hover:underline mt-1">
                    Restablecer ({excludedProducts.size} excluido{excludedProducts.size > 1 ? "s" : ""})
                  </button>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Punto 18: Margen de los más vendidos (mapeo manual producto → receta) */}
        <Card data-pdf-card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <PiggyBank className="h-4 w-4 text-emerald-500" />
              Margen de los más vendidos
              <span className="text-xs font-normal text-muted-foreground">(asigná la receta de carta)</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {marginProducts.length === 0 ? (
              <p className="text-center py-6 text-sm text-muted-foreground">Sin datos de productos</p>
            ) : (
              <div className="space-y-2">
                {marginProducts.map((p: any) => (
                  <div key={p.producto} className="flex items-center gap-2 border-b pb-2 last:border-0">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs truncate font-medium">{p.producto}</p>
                      <div className="mt-1">
                        <Select
                          value={p.recipeId != null ? String(p.recipeId) : ""}
                          onValueChange={(v) =>
                            mapMutation.mutate({ source: topSource, productName: p.producto, recipeId: parseInt(v, 10) })
                          }
                        >
                          <SelectTrigger className="h-7 text-xs">
                            <SelectValue placeholder="Asignar receta…" />
                          </SelectTrigger>
                          <SelectContent>
                            {recipeSelectOptions.map((r: any) => (
                              <SelectItem key={r.id} value={String(r.id)} className="text-xs">
                                {r.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="text-right shrink-0 w-28">
                      <p className="text-[11px] text-muted-foreground">{(p.cantidad ?? 0).toLocaleString()} u.</p>
                      {p.unitMargin != null ? (
                        <>
                          {p.marginPct != null && (
                            <p className="text-xs font-bold text-emerald-700">
                              {p.marginPct.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%
                            </p>
                          )}
                          <p className="text-xs font-semibold text-emerald-600">{formatCurrency(p.totalMargin ?? 0)}</p>
                          <p className="text-[10px] text-muted-foreground">{formatCurrency(p.unitMargin)}/u</p>
                        </>
                      ) : (
                        <p className="text-[11px] text-muted-foreground">Sin receta</p>
                      )}
                    </div>
                  </div>
                ))}
                <div className="flex items-center justify-between pt-1">
                  <span className="text-xs font-semibold">Margen total (mapeados)</span>
                  <span className="text-sm font-bold text-emerald-600">{formatCurrency(totalMargin)}</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 10. Top 10 Categorías */}
        <Card data-pdf-card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <ShoppingCart className="h-4 w-4 text-violet-500" />
              Top Categorías más vendidas
              <AnalysisPdfButton name="top_categorias" />
            </CardTitle>
            <p className="text-xs text-muted-foreground">Mismo período y fuente que productos</p>
          </CardHeader>
          <CardContent>
            {topSource === "datalive" ? (
              <p className="text-center py-6 text-sm text-muted-foreground">Categorías no disponibles en Datalive</p>
            ) : visibleCategorias.length === 0 ? (
              <p className="text-center py-6 text-sm text-muted-foreground">Sin datos de categorías</p>
            ) : (
              <div className="space-y-2">
                {visibleCategorias.map((c: any, i: number) => {
                  const max = visibleCategorias[0]?.cantidad ?? 1;
                  return (
                    <div key={c.categoria} className="flex items-center gap-2">
                      <span className="w-5 text-xs text-muted-foreground text-right shrink-0">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-0.5">
                          <p className="text-xs truncate">{c.categoria}</p>
                          <span className="text-xs font-semibold shrink-0 ml-2">{c.cantidad.toLocaleString()}</span>
                        </div>
                        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                          <div className="h-full bg-violet-500 rounded-full" style={{ width: `${(c.cantidad / max) * 100}%` }} />
                        </div>
                      </div>
                      <button onClick={() => setExcludedCategorias((prev) => { const n = new Set(prev); n.add(c.categoria); return n; })}
                        className="text-muted-foreground hover:text-destructive shrink-0 text-xs" title="Excluir">✕</button>
                    </div>
                  );
                })}
                {excludedCategorias.size > 0 && (
                  <button onClick={() => setExcludedCategorias(new Set())} className="text-xs text-primary hover:underline mt-1">
                    Restablecer ({excludedCategorias.size} excluido{excludedCategorias.size > 1 ? "s" : ""})
                  </button>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── ROW 5: Composición pagos + Evolución mensual ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 11. Composición de ventas */}
        <Card data-pdf-card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-pink-500" />
              Composición de Ventas — Medios de Pago
              <AnalysisPdfButton name="composicion_ventas" />
            </CardTitle>
            <p className="text-xs text-muted-foreground">{MONTH_NAMES_FULL[month - 1]} {year} · {source === "fudo" ? "FUDO" : source === "datalive" ? "DATALIVE" : "SHARES"}</p>
          </CardHeader>
          <CardContent>
            {composicionData.length === 0 ? (
              <p className="text-center py-8 text-sm text-muted-foreground">Sin datos de medios de pago{source === "fudo" ? " (importá la solapa Pagos del Excel FUDO)" : ""}</p>
            ) : (
              <div className="flex gap-4 items-center">
                <div className="flex-1 min-w-0 h-44">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={composicionData} dataKey="importe" nameKey="medioPago" cx="50%" cy="50%" innerRadius={45} outerRadius={75} paddingAngle={2}>
                        {composicionData.map((_: any, i: number) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                      </Pie>
                      <Tooltip formatter={(v: any) => formatCurrency(v)} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="space-y-2 min-w-0 shrink-0 max-w-[180px]">
                  {composicionData.map((d: any, i: number) => (
                    <div key={d.medioPago} className="flex items-center gap-2 text-xs">
                      <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                      <div className="min-w-0">
                        <p className="font-medium truncate">{d.medioPago}</p>
                        <p className="text-muted-foreground">{d.pct.toFixed(1)}% · {formatCurrency(d.importe)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 12. Evolución mensual */}
        <Card data-pdf-card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-blue-500" />
              Evolución de Ventas {year}
              <AnalysisPdfButton name="evolucion_ventas" />
            </CardTitle>
            <p className="text-xs text-muted-foreground">Mes a mes · {source === "fudo" ? "FUDO" : source === "datalive" ? "DATALIVE" : "SHARES"}</p>
          </CardHeader>
          <CardContent>
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={evolucionChartData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="mes" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => v >= 1000000 ? `${(v / 1000000).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)} />
                  <Tooltip formatter={(v: any) => formatCurrency(v)} labelClassName="font-medium" />
                  <Line type="monotone" dataKey="ventaTotal" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} name="Ventas" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── ROW 6: Top 3 del balance ── */}
      {top3Data && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* 13. Top 3 ventas */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Trophy className="h-4 w-4 text-yellow-500" />
                Top 3 Ventas Brutas {year}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {(top3Data.topVentas ?? []).length === 0 ? (
                <p className="text-sm text-center text-muted-foreground py-3">Sin datos de balance</p>
              ) : (
                <div className="h-36">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={top3Data.topVentas} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                      <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 9 }} tickFormatter={(v) => v >= 1000000 ? `${(v / 1000000).toFixed(1)}M` : `${(v / 1000).toFixed(0)}k`} />
                      <Tooltip formatter={(v: any) => formatCurrency(v)} />
                      <Bar dataKey="value" fill="#f59e0b" radius={[4, 4, 0, 0]} name="Ventas" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>

          {/* 14. Top 3 gastos */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <TrendingDown className="h-4 w-4 text-red-500" />
                Top 3 Mayores Gastos {year}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {(top3Data.topGastos ?? []).length === 0 ? (
                <p className="text-sm text-center text-muted-foreground py-3">Sin datos de balance</p>
              ) : (
                <div className="h-36">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={top3Data.topGastos} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                      <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 9 }} tickFormatter={(v) => v >= 1000000 ? `${(v / 1000000).toFixed(1)}M` : `${(v / 1000).toFixed(0)}k`} />
                      <Tooltip formatter={(v: any) => formatCurrency(v)} />
                      <Bar dataKey="value" fill="#ef4444" radius={[4, 4, 0, 0]} name="Gastos" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>

          {/* 15. Top 3 rentabilidad */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-emerald-500" />
                Top 3 Rentabilidades {year}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {(top3Data.topRentabilidad ?? []).length === 0 ? (
                <p className="text-sm text-center text-muted-foreground py-3">Sin datos de balance</p>
              ) : (
                <div className="h-36">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={top3Data.topRentabilidad} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                      <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 9 }} tickFormatter={(v) => v >= 1000000 ? `${(v / 1000000).toFixed(1)}M` : `${(v / 1000).toFixed(0)}k`} />
                      <Tooltip formatter={(v: any) => formatCurrency(v)} />
                      <Bar dataKey="value" fill="#10b981" radius={[4, 4, 0, 0]} name="Rentabilidad" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
