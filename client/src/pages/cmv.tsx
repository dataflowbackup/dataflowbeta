import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { DataEntryCombobox } from "@/components/data-entry-combobox";
import { DateRangePicker } from "@/components/date-range-picker";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatCurrency } from "@/lib/formatters";
import { Calculator, Save, TrendingUp, TrendingDown, BarChart2, DollarSign, Trash2, ChevronsUpDown, Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Checkbox } from "@/components/ui/checkbox";
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
  ResponsiveContainer,
} from "recharts";
import type { Local } from "@shared/schema";

interface CmvSaved {
  id: number;
  localId: number | null;
  periodFrom: string | null;
  periodTo: string | null;
  cmv: string | number;
  cmvPct: string | number | null;
  ventaNeta: string | number;
  stockInicial: string | number;
  compras: string | number;
  stockFinal: string | number;
  salesSource: string | null;
  ivaIncluded: boolean | null;
}

interface ValuationRow {
  id: number;
  localId: number | null;
  valuationDate: string;
  totalValued: string | number;
  status: string;
}

interface CmvResult {
  stockInicial: number;
  stockInicialDate: string;
  stockFinal: number;
  stockFinalDate: string;
  compras: number;
  cmv: number;
  salesGross: number;
  ventaNeta: number;
  cmvPct: number | null;
}

function firstDayOfYear(): string {
  return `${new Date().getFullYear()}-01-01`;
}
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function pct(v: string | number | null): number {
  return parseFloat(String(v ?? "0")) || 0;
}
function money(v: string | number | null): number {
  return parseFloat(String(v ?? "0")) || 0;
}

// ─── Dashboard ───────────────────────────────────────────────────────────────

function Dashboard({ records, locals }: { records: CmvSaved[]; locals: Local[] }) {
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [filterSource, setFilterSource] = useState("all");
  const [filterLocals, setFilterLocals] = useState<number[]>([]);
  const [localPopoverOpen, setLocalPopoverOpen] = useState(false);

  const toggleLocal = (id: number) =>
    setFilterLocals((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);

  const filtered = useMemo(() => {
    return records.filter((r) => {
      if (filterSource !== "all" && r.salesSource !== filterSource) return false;
      if (filterFrom && r.periodFrom && r.periodFrom < filterFrom) return false;
      if (filterTo && r.periodTo && r.periodTo > filterTo) return false;
      if (filterLocals.length > 0) {
        // record con localId null = "Todos los locales"; lo incluimos solo si no hay filtro activo
        if (r.localId == null) return false;
        if (!filterLocals.includes(r.localId)) return false;
      }
      return true;
    });
  }, [records, filterFrom, filterTo, filterSource, filterLocals]);

  const sorted = useMemo(() => [...filtered].sort((a, b) => (a.periodFrom ?? "").localeCompare(b.periodFrom ?? "")), [filtered]);

  const avgPct = useMemo(() => {
    const valid = sorted.filter((r) => r.cmvPct != null);
    return valid.length > 0 ? valid.reduce((s, r) => s + pct(r.cmvPct), 0) / valid.length : null;
  }, [sorted]);

  const lastPct = sorted.length > 0 ? pct(sorted[sorted.length - 1].cmvPct) : null;
  const totalCmv = sorted.reduce((s, r) => s + money(r.cmv), 0);
  const totalVenta = sorted.reduce((s, r) => s + money(r.ventaNeta), 0);

  const trend = sorted.length >= 2
    ? pct(sorted[sorted.length - 1].cmvPct) - pct(sorted[sorted.length - 2].cmvPct)
    : null;

  const chartData = sorted.map((r) => ({
    label: r.periodFrom ? r.periodFrom.slice(0, 7) : String(r.id),
    "CMV %": pct(r.cmvPct),
    "CMV $": money(r.cmv),
    "Venta $": money(r.ventaNeta),
  }));

  const sourceOptions = [
    { value: "all", label: "Todas las fuentes" },
    { value: "extractos", label: "Extractos" },
    { value: "datalive", label: "Datalive" },
    { value: "fudo", label: "FUDO" },
  ];

  const hasFilters = filterFrom || filterTo || filterSource !== "all" || filterLocals.length > 0;

  const localButtonLabel = filterLocals.length === 0
    ? "Todos los locales"
    : filterLocals.length === 1
      ? (locals.find((l) => l.id === filterLocals[0])?.name ?? "1 local")
      : `${filterLocals.length} locales`;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <BarChart2 className="h-4 w-4" /> Dashboard CMV
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Filtros */}
        <div className="flex flex-wrap gap-3 items-end">
          <div className="space-y-1">
            <Label className="text-xs">Fuente</Label>
            <DataEntryCombobox
              options={sourceOptions}
              value={filterSource}
              onValueChange={setFilterSource}
              placeholder="Fuente"
              searchPlaceholder="Buscar…"
            />
          </div>

          {/* Multi-select locales */}
          <div className="space-y-1">
            <Label className="text-xs">Local</Label>
            <Popover open={localPopoverOpen} onOpenChange={setLocalPopoverOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-9 min-w-[180px] justify-between font-normal">
                  <span className="truncate">{localButtonLabel}</span>
                  <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-56 p-0" align="start">
                <Command>
                  <CommandInput placeholder="Buscar local…" />
                  <CommandList>
                    <CommandEmpty>Sin resultados</CommandEmpty>
                    <CommandGroup>
                      {locals.map((l) => (
                        <CommandItem key={l.id} onSelect={() => toggleLocal(l.id)} className="gap-2">
                          <Checkbox checked={filterLocals.includes(l.id)} className="pointer-events-none" />
                          <span>{l.name}</span>
                          {filterLocals.includes(l.id) && <Check className="ml-auto h-3.5 w-3.5" />}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Período desde</Label>
            <input
              type="date"
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
              value={filterFrom}
              onChange={(e) => setFilterFrom(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Período hasta</Label>
            <input
              type="date"
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
              value={filterTo}
              onChange={(e) => setFilterTo(e.target.value)}
            />
          </div>
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={() => { setFilterFrom(""); setFilterTo(""); setFilterSource("all"); setFilterLocals([]); }}>
              Limpiar
            </Button>
          )}
          {filterLocals.length > 0 && (
            <div className="flex flex-wrap gap-1 items-center">
              {filterLocals.map((id) => {
                const name = locals.find((l) => l.id === id)?.name ?? String(id);
                return (
                  <Badge key={id} variant="secondary" className="text-xs gap-1 cursor-pointer" onClick={() => toggleLocal(id)}>
                    {name} ✕
                  </Badge>
                );
              })}
            </div>
          )}
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="rounded-lg border p-3 space-y-1">
            <p className="text-xs text-muted-foreground">CMV % promedio</p>
            <p className="text-xl font-bold">{avgPct != null ? `${avgPct.toFixed(2)}%` : "—"}</p>
            {trend != null && (
              <p className={`text-xs flex items-center gap-1 ${trend > 0 ? "text-destructive" : "text-green-600"}`}>
                {trend > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                {trend > 0 ? "+" : ""}{trend.toFixed(2)}% vs anterior
              </p>
            )}
          </div>
          <div className="rounded-lg border p-3 space-y-1">
            <p className="text-xs text-muted-foreground">CMV % último período</p>
            <p className="text-xl font-bold">{lastPct != null ? `${lastPct.toFixed(2)}%` : "—"}</p>
          </div>
          <div className="rounded-lg border p-3 space-y-1">
            <p className="text-xs text-muted-foreground flex items-center gap-1"><DollarSign className="h-3 w-3" />CMV $ acumulado</p>
            <p className="text-xl font-bold font-mono">{formatCurrency(totalCmv)}</p>
            <p className="text-xs text-muted-foreground">{sorted.length} período{sorted.length !== 1 ? "s" : ""}</p>
          </div>
          <div className="rounded-lg border p-3 space-y-1">
            <p className="text-xs text-muted-foreground flex items-center gap-1"><DollarSign className="h-3 w-3" />Venta acumulada</p>
            <p className="text-xl font-bold font-mono">{formatCurrency(totalVenta)}</p>
          </div>
        </div>

        {chartData.length >= 2 && (
          <div className="grid gap-4 lg:grid-cols-2">
            {/* Evolución CMV % */}
            <div>
              <p className="text-xs font-medium mb-2 text-muted-foreground">Evolución CMV %</p>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tickFormatter={(v) => `${v.toFixed(0)}%`} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: number) => `${v.toFixed(2)}%`} />
                  <Line type="monotone" dataKey="CMV %" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* CMV $ vs Venta $ */}
            <div>
              <p className="text-xs font-medium mb-2 text-muted-foreground">CMV $ vs Venta $ por período</p>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tickFormatter={(v) => formatCurrency(v).replace("$", "").trim()} tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(v: number) => formatCurrency(v)} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="Venta $" fill="hsl(var(--muted-foreground))" opacity={0.4} radius={[2, 2, 0, 0]} />
                  <Bar dataKey="CMV $" fill="hsl(var(--primary))" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {chartData.length < 2 && (
          <p className="text-sm text-muted-foreground text-center py-4">
            Guardá al menos 2 CMV para ver los gráficos de evolución.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

export default function CmvPage() {
  const [localId, setLocalId] = useState("all");
  const [stockInicialId, setStockInicialId] = useState("");
  const [stockFinalId, setStockFinalId] = useState("");
  const [dateFrom, setDateFrom] = useState(firstDayOfYear());
  const [dateTo, setDateTo] = useState(today());
  const [salesSource, setSalesSource] = useState<"extractos" | "datalive">("extractos");
  const [ivaIncluded, setIvaIncluded] = useState(false);

  const { data: locals = [] } = useQuery<Local[]>({ queryKey: ["/api/locals"] });
  const { data: valuations = [] } = useQuery<ValuationRow[]>({ queryKey: ["/api/finance/stock-valuations"] });
  const { data: saved = [] } = useQuery<CmvSaved[]>({ queryKey: ["/api/finance/cmv-calculations"] });

  const localOptions = useMemo(
    () => [{ value: "all", label: "Todos los locales" }, ...locals.map((l) => ({ value: String(l.id), label: l.name }))],
    [locals],
  );
  const valuationOptions = useMemo(
    () =>
      valuations
        .filter((v) => v.status === "active")
        .map((v) => {
          const localName = v.localId != null ? (locals.find((l) => l.id === v.localId)?.name ?? "Local desconocido") : "Todos los locales";
          return {
            value: String(v.id),
            label: `${v.valuationDate} — ${localName} — ${formatCurrency(parseFloat(String(v.totalValued)) || 0)}`,
          };
        }),
    [valuations, locals],
  );
  const sourceOptions = [
    { value: "extractos", label: "Extractos" },
    { value: "datalive", label: "Datalive" },
    { value: "fudo", label: "FUDO" },
  ];
  const ivaOptions = [
    { value: "sin", label: "Sin IVA (÷1,21)" },
    { value: "con", label: "Con IVA (bruto)" },
  ];

  // Preview compras en vivo — se activa apenas hay fechas
  const { data: comprasPreview } = useQuery<{ compras: number }>({
    queryKey: ["/api/finance/cmv-compras", localId, dateFrom, dateTo],
    enabled: !!(dateFrom && dateTo),
    queryFn: async () => {
      const p = new URLSearchParams();
      if (localId !== "all") p.set("localId", localId);
      if (dateFrom) p.set("dateFrom", dateFrom);
      if (dateTo) p.set("dateTo", dateTo);
      const res = await fetch(`/api/finance/cmv-compras?${p.toString()}`, { credentials: "include" });
      if (!res.ok) return { compras: 0 };
      return res.json();
    },
  });

  const ready = stockInicialId && stockFinalId;
  const { data, isLoading, isError, error } = useQuery<CmvResult>({
    queryKey: ["/api/finance/cmv", stockInicialId, stockFinalId, localId, dateFrom, dateTo, salesSource, ivaIncluded],
    enabled: !!ready,
    queryFn: async () => {
      const p = new URLSearchParams();
      p.set("stockInicialId", stockInicialId);
      p.set("stockFinalId", stockFinalId);
      if (localId !== "all") p.set("localId", localId);
      if (dateFrom) p.set("dateFrom", dateFrom);
      if (dateTo) p.set("dateTo", dateTo);
      p.set("salesSource", salesSource);
      p.set("ivaIncluded", String(ivaIncluded));
      const res = await fetch(`/api/finance/cmv?${p.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.message || "Error al calcular CMV");
      return res.json();
    },
  });

  const [deleteTarget, setDeleteTarget] = useState<CmvSaved | null>(null);
  const [deleteCode, setDeleteCode] = useState("");

  const { toast } = useToast();
  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/finance/cmv-calculations", {
        stockInicialId,
        stockFinalId,
        localId: localId === "all" ? null : localId,
        dateFrom,
        dateTo,
        salesSource,
        ivaIncluded,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/finance/cmv-calculations"] });
      toast({ title: "CMV guardado", description: "Quedó registrado el cálculo." });
    },
    onError: (e: Error) => toast({ title: "No se pudo guardar", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/finance/cmv-calculations/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/finance/cmv-calculations"] });
      toast({ title: "CMV eliminado", description: "El registro fue eliminado correctamente." });
      setDeleteTarget(null);
      setDeleteCode("");
    },
    onError: (e: Error) => toast({ title: "No se pudo eliminar", description: e.message, variant: "destructive" }),
  });

  const localMap = useMemo(() => {
    const m = new Map<number, string>();
    locals.forEach((l) => m.set(l.id, l.name));
    return m;
  }, [locals]);

  const ResultLine = ({ label, value, op, strong }: { label: string; value: number; op?: string; strong?: boolean }) => (
    <div className={`grid grid-cols-[auto_1fr_auto] items-center gap-2 ${strong ? "border-t pt-2 font-bold" : ""}`}>
      <span className="w-6 text-center font-mono text-muted-foreground">{op ?? ""}</span>
      <span className={strong ? "" : "text-muted-foreground"}>{label}</span>
      <span className="font-mono text-right">{formatCurrency(value)}</span>
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="CMV — Costo de Mercadería Vendida"
        description="Stock inicial + compras − stock final, cruzado con la venta"
      />

      {/* Dashboard (solo si hay guardados) */}
      {saved.length > 0 && <Dashboard records={saved} locals={locals} />}

      {/* Parámetros */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Parámetros</CardTitle></CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-1">
              <Label className="text-xs">Local</Label>
              <DataEntryCombobox options={localOptions} value={localId} onValueChange={setLocalId} placeholder="Local" searchPlaceholder="Buscar…" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Stock inicial (valorización)</Label>
              <DataEntryCombobox options={valuationOptions} value={stockInicialId} onValueChange={setStockInicialId} placeholder="Elegí una valorización" searchPlaceholder="Buscar fecha…" data-testid="select-stock-inicial" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Stock final (valorización)</Label>
              <DataEntryCombobox options={valuationOptions} value={stockFinalId} onValueChange={setStockFinalId} placeholder="Elegí una valorización" searchPlaceholder="Buscar fecha…" data-testid="select-stock-final" />
            </div>

            {/* Compras período + preview en vivo */}
            <div className="space-y-1">
              <Label className="text-xs">Compras (período)</Label>
              <DateRangePicker from={dateFrom} to={dateTo} onChange={(f, t) => { setDateFrom(f); setDateTo(t); }} />
              {comprasPreview != null && (
                <p className="text-xs text-muted-foreground pt-0.5">
                  Compras en el período: <span className="font-semibold font-mono text-foreground">{formatCurrency(comprasPreview.compras)}</span>
                </p>
              )}
            </div>

            {/* Fuente de facturación */}
            <div className="space-y-1">
              <Label className="text-xs">Facturación desde</Label>
              <DataEntryCombobox
                options={sourceOptions}
                value={salesSource}
                onValueChange={(v) => setSalesSource(v as "extractos" | "datalive" | "fudo")}
                placeholder="Fuente"
                searchPlaceholder="Buscar…"
              />
            </div>

            {/* Con / sin IVA */}
            <div className="space-y-1">
              <Label className="text-xs">Tomar venta</Label>
              <DataEntryCombobox
                options={ivaOptions}
                value={ivaIncluded ? "con" : "sin"}
                onValueChange={(v) => setIvaIncluded(v === "con")}
                placeholder="IVA"
                searchPlaceholder="Buscar…"
              />
            </div>
          </div>

          {valuationOptions.length === 0 && (
            <p className="mt-3 text-sm text-muted-foreground">
              No hay valorizaciones de stock activas. Cargá al menos dos en "Valorizar Stock" para calcular el CMV.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Resultado */}
      {ready && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Calculator className="h-4 w-4" /> Resultado
            </CardTitle>
            <Button
              size="sm"
              onClick={() => saveMutation.mutate()}
              disabled={!data || isLoading || saveMutation.isPending}
              data-testid="button-save-cmv"
            >
              <Save className="h-4 w-4 mr-2" /> {saveMutation.isPending ? "Guardando..." : "Guardar"}
            </Button>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-2">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-6 w-full" />)}</div>
            ) : isError ? (
              <p className="text-sm text-destructive">{(error as Error)?.message}</p>
            ) : data ? (
              <div className="space-y-2 max-w-md">
                <ResultLine label={`Stock inicial (${data.stockInicialDate})`} value={data.stockInicial} op="" />
                <ResultLine label="Compras del período (CMC, sin IVA)" value={data.compras} op="+" />
                <ResultLine label={`Stock final (${data.stockFinalDate})`} value={data.stockFinal} op="−" />
                <ResultLine label="CMV" value={data.cmv} strong />
                <div className="grid grid-cols-[auto_1fr_auto] items-center gap-2 pt-3 border-t">
                  <span className="w-6" />
                  <span className="text-muted-foreground">
                    {ivaIncluded ? "Venta bruta (con IVA)" : "Venta sin IVA (÷1,21)"}
                    <Badge variant="outline" className="ml-2 text-[10px]">{salesSource}</Badge>
                  </span>
                  <span className="font-mono text-right text-muted-foreground">{formatCurrency(data.ventaNeta)}</span>
                </div>
                <div className="grid grid-cols-[auto_1fr_auto] items-center gap-2 font-bold">
                  <span className="w-6" />
                  <span>CMV %</span>
                  <span className="font-mono text-right" data-testid="text-cmv-pct">
                    {data.cmvPct == null ? "—" : `${data.cmvPct.toFixed(2)}%`}
                  </span>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      )}

      {/* CMV Guardados */}
      {saved.length > 0 && (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">CMV guardados</CardTitle></CardHeader>
          <CardContent className="p-0 md:p-6">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50">
                    <th className="text-left px-3 py-2 font-medium border-b whitespace-nowrap">Período</th>
                    <th className="text-right px-3 py-2 font-medium border-b whitespace-nowrap">Stock inicial</th>
                    <th className="text-right px-3 py-2 font-medium border-b whitespace-nowrap">Compras $</th>
                    <th className="text-right px-3 py-2 font-medium border-b whitespace-nowrap">Stock final</th>
                    <th className="text-right px-3 py-2 font-medium border-b whitespace-nowrap">CMV $</th>
                    <th className="text-right px-3 py-2 font-medium border-b whitespace-nowrap">Facturación</th>
                    <th className="text-center px-3 py-2 font-medium border-b whitespace-nowrap">IVA</th>
                    <th className="text-right px-3 py-2 font-medium border-b whitespace-nowrap">Venta base</th>
                    <th className="text-left px-3 py-2 font-medium border-b whitespace-nowrap">Local</th>
                    <th className="text-right px-3 py-2 font-medium border-b whitespace-nowrap">CMV %</th>
                    <th className="px-3 py-2 border-b" />
                  </tr>
                </thead>
                <tbody>
                  {saved.map((c) => (
                    <tr key={c.id} className="border-b hover:bg-muted/30 transition-colors">
                      <td className="px-3 py-2 whitespace-nowrap">{c.periodFrom ?? "—"} → {c.periodTo ?? "—"}</td>
                      <td className="px-3 py-2 text-right font-mono">{formatCurrency(money(c.stockInicial))}</td>
                      <td className="px-3 py-2 text-right font-mono">{formatCurrency(money(c.compras))}</td>
                      <td className="px-3 py-2 text-right font-mono">{formatCurrency(money(c.stockFinal))}</td>
                      <td className="px-3 py-2 text-right font-mono font-medium">{formatCurrency(money(c.cmv))}</td>
                      <td className="px-3 py-2 text-right">
                        <Badge variant="outline" className="text-[10px]">{c.salesSource ?? "extractos"}</Badge>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <Badge variant={c.ivaIncluded ? "secondary" : "outline"} className="text-[10px]">
                          {c.ivaIncluded ? "Con IVA" : "Sin IVA"}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-muted-foreground">{formatCurrency(money(c.ventaNeta))}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                        {c.localId != null ? (localMap.get(c.localId) ?? "—") : "Todos"}
                      </td>
                      <td className="px-3 py-2 text-right font-mono font-semibold">
                        {c.cmvPct == null ? "—" : `${pct(c.cmvPct).toFixed(2)}%`}
                      </td>
                      <td className="px-3 py-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={() => { setDeleteTarget(c); setDeleteCode(""); }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Dialog eliminar CMV */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) { setDeleteTarget(null); setDeleteCode(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Eliminar CMV guardado</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {deleteTarget && (
              <p className="text-sm text-muted-foreground">
                Vas a eliminar el CMV del período{" "}
                <span className="font-semibold text-foreground">
                  {deleteTarget.periodFrom ?? "—"} → {deleteTarget.periodTo ?? "—"}
                </span>
                . Esta acción no se puede deshacer.
              </p>
            )}
            <div className="space-y-1">
              <Label className="text-xs">
                Escribí <span className="font-bold text-destructive">ELIMINAR</span> para confirmar
              </Label>
              <Input
                value={deleteCode}
                onChange={(e) => setDeleteCode(e.target.value)}
                placeholder="ELIMINAR"
                autoComplete="off"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDeleteTarget(null); setDeleteCode(""); }}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={deleteCode !== "ELIMINAR" || deleteMutation.isPending}
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            >
              {deleteMutation.isPending ? "Eliminando..." : "Eliminar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
