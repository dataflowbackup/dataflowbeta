import { useState, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
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
  LineChart, Line, PieChart, Pie, Cell,
} from "recharts";
import {
  TrendingUp, TrendingDown, Minus, Target, Ticket, DollarSign, Building2,
  CreditCard, BarChart3, ShoppingCart, ChefHat, Trophy, PiggyBank, Percent,
  AlertCircle, CheckCircle2,
} from "lucide-react";
import type { Local, CmvCalculation } from "@shared/schema";

const MONTH_NAMES = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
const MONTH_NAMES_FULL = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
const DAY_NAMES = ["lunes","martes","miércoles","jueves","viernes","sábado","domingo"];

const PIE_COLORS = ["#6366f1","#f59e0b","#10b981","#ef4444","#8b5cf6","#ec4899","#14b8a6","#f97316","#84cc16","#06b6d4"];

function pct(n: number | null) {
  if (n == null) return null;
  return n.toFixed(1) + "%";
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

export default function DashboardPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [globalLocalIds, setGlobalLocalIds] = useState<number[]>([]);
  const [source, setSource] = useState<"fudo" | "datalive">("fudo");

  // Week widget filters
  const [weekStart, setWeekStart] = useState(currentWeekMonday());
  const [weekLocalIds, setWeekLocalIds] = useState<number[]>([]);
  const [weekSource, setWeekSource] = useState<"fudo" | "datalive">("fudo");

  // Top products/categories filters
  const [topDateFrom, setTopDateFrom] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`);
  const [topDateTo, setTopDateTo] = useState(now.toISOString().slice(0, 10));
  const [topLocalIds, setTopLocalIds] = useState<number[]>([]);
  const [topSource, setTopSource] = useState<"fudo" | "datalive">("fudo");
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

  const { data: topCategorias = [] } = useQuery<any[]>({
    queryKey: ["/api/dashboard/top-categorias", topDateFrom, topDateTo, topLocalParam, topSource],
    queryFn: () => apiRequest("GET", `/api/dashboard/top-categorias?dateFrom=${topDateFrom}&dateTo=${topDateTo}&localIds=${topLocalParam}&source=${topSource}`).then((r) => r.json()),
    enabled: locals.length > 0,
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

  // Evolution chart
  const evolucionChartData = useMemo(() =>
    evolucionData.map((d: any) => ({ mes: MONTH_NAMES[d.month - 1], ventaTotal: d.ventaTotal })),
    [evolucionData],
  );

  const currentVenta = ventasSummary?.current?.ventaTotal ?? 0;
  const currentTickets = ventasSummary?.current?.ticketCount ?? null;

  const yearOptions = Array.from({ length: 5 }, (_, i) => now.getFullYear() - 2 + i);

  return (
    <div className="flex flex-col gap-5 p-5 min-h-screen bg-muted/20">
      {/* ── HEADER ── */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <BarChart3 className="h-7 w-7 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
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
                  {(["fudo","datalive"] as const).map((s) => (
                    <button key={s} onClick={() => setSource(s)}
                      className={`px-3 py-1 rounded-md text-xs font-medium border transition-colors ${source === s ? "bg-primary text-primary-foreground border-primary" : "bg-background text-muted-foreground border-border hover:bg-muted"}`}>
                      {s === "fudo" ? "FUDO" : "DATALIVE"}
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
              <p className="text-sm text-muted-foreground text-center py-4">Sin datos de extractos</p>
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
      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-blue-500" />
              Facturación Semanal
            </CardTitle>
            <div className="flex flex-wrap gap-3 items-end">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Inicio de semana (lunes)</Label>
                <Input type="date" value={weekStart} onChange={(e) => setWeekStart(e.target.value)} className="h-8 w-40 text-xs" />
              </div>
              <div className="flex gap-1">
                {(["fudo","datalive"] as const).map((s) => (
                  <button key={s} onClick={() => setWeekSource(s)}
                    className={`px-2 py-1 rounded text-xs font-medium border transition-colors ${weekSource === s ? "bg-primary text-primary-foreground border-primary" : "bg-background text-muted-foreground border-border hover:bg-muted"}`}>
                    {s === "fudo" ? "FUDO" : "DATALIVE"}
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
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weekChartData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => v >= 1000000 ? `${(v / 1000000).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)} />
                <Tooltip content={<CustomTooltipBar />} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Semana anterior" fill="#93c5fd" radius={[3, 3, 0, 0]} />
                <Bar dataKey="Semana actual" fill="#3b82f6" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {weekSummary && (
            <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
              <div className="rounded-lg bg-blue-50 dark:bg-blue-950/30 p-3">
                <p className="text-xs text-muted-foreground">Semana actual</p>
                <p className="font-bold text-blue-600">{formatCurrency(weekSummary.curr)}</p>
              </div>
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground">Semana anterior</p>
                <p className="font-bold">{formatCurrency(weekSummary.prev)}</p>
              </div>
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground">Evolución</p>
                <div className="mt-0.5"><TrendBadge value={weekSummary.pct} /></div>
              </div>
            </div>
          )}

          {cmvSemanaData && (cmvSemanaData.current?.totalVentas > 0 || cmvSemanaData.previous?.totalVentas > 0) && (() => {
            const curr = cmvSemanaData.current ?? { totalVentas: 0, totalCosto: 0, cmvPct: 0 };
            const prev = cmvSemanaData.previous ?? { totalVentas: 0, totalCosto: 0, cmvPct: 0 };
            const cmvEvol = prev.cmvPct > 0 ? curr.cmvPct - prev.cmvPct : null;
            const startDate = new Date(weekStart + "T00:00:00Z");
            const fmtDate = (d: Date) => d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
            const currEnd = new Date(startDate); currEnd.setUTCDate(currEnd.getUTCDate() + 6);
            const prevStart = new Date(startDate); prevStart.setUTCDate(prevStart.getUTCDate() - 7);
            const prevEnd = new Date(startDate); prevEnd.setUTCDate(prevEnd.getUTCDate() - 1);
            return (
              <div className="mt-3 rounded-lg border bg-amber-50/50 dark:bg-amber-950/20 p-3">
                <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1"><Percent className="h-3 w-3" /> CMV por semana</p>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded bg-muted/40 px-3 py-2">
                    <p className="text-xs text-muted-foreground mb-1">Semana anterior — {fmtDate(prevStart)} al {fmtDate(prevEnd)}</p>
                    <div className="flex gap-4">
                      <div><p className="text-xs text-muted-foreground">Facturación</p><p className="font-semibold">{formatCurrency(prev.totalVentas)}</p></div>
                      <div><p className="text-xs text-muted-foreground">CMV</p><p className="font-semibold">{formatCurrency(prev.totalCosto)}</p></div>
                      <div><p className="text-xs text-muted-foreground">CMV %</p><p className="font-bold text-amber-600">{prev.cmvPct.toFixed(1)}%</p></div>
                    </div>
                  </div>
                  <div className="rounded bg-blue-50/60 dark:bg-blue-950/20 px-3 py-2">
                    <p className="text-xs text-muted-foreground mb-1">Semana actual — {fmtDate(startDate)} al {fmtDate(currEnd)}</p>
                    <div className="flex gap-4">
                      <div><p className="text-xs text-muted-foreground">Facturación</p><p className="font-semibold">{formatCurrency(curr.totalVentas)}</p></div>
                      <div><p className="text-xs text-muted-foreground">CMV</p><p className="font-semibold">{formatCurrency(curr.totalCosto)}</p></div>
                      <div><p className="text-xs text-muted-foreground">CMV %</p><p className="font-bold text-amber-600">{curr.cmvPct.toFixed(1)}%</p></div>
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
              </div>
            );
          })()}
        </CardContent>
      </Card>

      {/* ── ROW 4: Top 10 productos + categorías ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 9. Top 10 Productos */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <ChefHat className="h-4 w-4 text-emerald-500" />
                Top Productos más vendidos
              </CardTitle>
              <div className="flex flex-wrap gap-2 items-end text-xs">
                <Input type="date" value={topDateFrom} onChange={(e) => setTopDateFrom(e.target.value)} className="h-7 w-36 text-xs" />
                <span className="text-muted-foreground">—</span>
                <Input type="date" value={topDateTo} onChange={(e) => setTopDateTo(e.target.value)} className="h-7 w-36 text-xs" />
                <div className="flex gap-1">
                  {(["fudo","datalive"] as const).map((s) => (
                    <button key={s} onClick={() => setTopSource(s)}
                      className={`px-2 py-0.5 rounded text-xs font-medium border transition-colors ${topSource === s ? "bg-primary text-primary-foreground border-primary" : "bg-background text-muted-foreground border-border hover:bg-muted"}`}>
                      {s === "fudo" ? "FUDO" : "DATA"}
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

        {/* 10. Top 10 Categorías */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <ShoppingCart className="h-4 w-4 text-violet-500" />
              Top Categorías más vendidas
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
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-pink-500" />
              Composición de Ventas — Medios de Pago
            </CardTitle>
            <p className="text-xs text-muted-foreground">{MONTH_NAMES_FULL[month - 1]} {year} · {source === "fudo" ? "FUDO" : "DATALIVE"}</p>
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
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-blue-500" />
              Evolución de Ventas {year}
            </CardTitle>
            <p className="text-xs text-muted-foreground">Mes a mes · {source === "fudo" ? "FUDO" : "DATALIVE"}</p>
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
