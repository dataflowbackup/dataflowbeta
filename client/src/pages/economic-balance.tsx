import { useQuery, useMutation } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataEntryCombobox } from "@/components/data-entry-combobox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import {
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  Settings2,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Minus,
} from "lucide-react";
import type { Local, CmvCalculation, FinancialGroup } from "@shared/schema";
import { buildCmvForBalance } from "@shared/balanceCmv";
import { MONTH_NAMES_ES } from "@shared/economicMonth";

const SHORT_MONTHS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

type SalesSource = "datalive" | "fudo" | "shares";

const SALES_SOURCE_OPTIONS: { value: SalesSource; label: string }[] = [
  { value: "datalive", label: "Datalive" },
  { value: "fudo", label: "Fudo" },
  { value: "shares", label: "Shares" },
];

interface EconCategory {
  id: number;
  name: string;
  monthlyTotals: Record<number, number>;
  yearTotal: number;
}

interface EconGroup {
  id: number;
  name: string;
  type: string;
  isMerchandise: boolean;
  computes: boolean;
  categories: EconCategory[];
  monthlyTotals: Record<number, number>;
  yearTotal: number;
}

interface EconomicBalanceData {
  salesSource: SalesSource;
  ventas: {
    monthly: Record<number, number>;
    byLocal: Record<number, Record<number, number>>;
    composition: { label: string; monthlyTotals: Record<number, number>; yearTotal: number }[];
    yearTotal: number;
  };
  groups: EconGroup[];
  summary: { gastos: Record<number, number>; totalGastos: number };
}

/**
 * BALANCE ECONÓMICO (ago-2026).
 *
 * Mide rentabilidad devengada, a diferencia del Balance Financiero que mide el flujo de dinero:
 *  - las VENTAS salen del sistema de gestión (Datalive / Fudo / Shares), no de los movimientos;
 *  - los GASTOS se agrupan por MES ECONÓMICO, no por la fecha de acreditación;
 *  - el costo de mercadería es el CMV (mismo criterio que el Financiero), no lo pagado a proveedores;
 *  - los Movimientos Financieros quedan afuera: no son economía del período.
 *
 * Por eso sus ventas NO coinciden con las del Balance Financiero, y no tienen por qué: son ventas
 * brutas del sistema contra dinero efectivamente acreditado.
 */
export default function EconomicBalancePage() {
  const { toast } = useToast();
  const now = new Date();
  const currentYear = now.getFullYear();

  const [selectedYear, setSelectedYear] = useState(String(currentYear));
  const [selectedMonth, setSelectedMonth] = useState(String(now.getMonth() + 1));
  const [selectedLocalIds, setSelectedLocalIds] = useState<number[]>([]);
  const [salesSource, setSalesSource] = useState<SalesSource>("datalive");
  const [viewMode, setViewMode] = useState("monthly");
  const [expandedGroupIds, setExpandedGroupIds] = useState<number[]>([]);
  const [ventasOpen, setVentasOpen] = useState(false);

  const { data: locals = [] } = useQuery<Local[]>({ queryKey: ["/api/locals"] });
  const { data: financialGroups = [] } = useQuery<FinancialGroup[]>({ queryKey: ["/api/financial-groups"] });
  const { data: cmvList = [] } = useQuery<CmvCalculation[]>({
    queryKey: ["/api/finance/cmv-calculations"],
    queryFn: async () => {
      const res = await fetch("/api/finance/cmv-calculations", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const localIdsParam = selectedLocalIds.length > 0 ? selectedLocalIds.join(",") : "";
  const { data, isLoading } = useQuery<EconomicBalanceData>({
    queryKey: ["/api/economic-balance", selectedYear, localIdsParam, salesSource],
    queryFn: async () => {
      const qs = new URLSearchParams({ year: selectedYear, salesSource });
      if (localIdsParam) qs.set("localIds", localIdsParam);
      const res = await fetch(`/api/economic-balance?${qs}`, { credentials: "include" });
      if (!res.ok) throw new Error("Error al cargar el balance económico");
      return res.json();
    },
  });

  const computesMut = useMutation({
    mutationFn: async ({ id, computes }: { id: number; computes: boolean }) => {
      await apiRequest("PATCH", `/api/financial-groups/${id}/economic-computes`, { computes });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/financial-groups"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/economic-balance"] });
    },
    onError: (e: Error) =>
      toast({ title: "No se pudo cambiar el grupo", description: e.message, variant: "destructive" }),
  });

  const month = parseInt(selectedMonth, 10);
  const year = parseInt(selectedYear, 10);

  const years = Array.from({ length: 5 }, (_, i) => currentYear - 2 + i);
  const yearOptions = years.map((y) => ({ value: String(y), label: String(y) }));
  const monthOptions = MONTH_NAMES_ES.map((m, i) => ({ value: String(i + 1), label: m }));
  const localOptions = [
    { value: "all", label: "Todos los locales" },
    ...locals.map((l) => ({ value: String(l.id), label: l.name })),
  ];

  const ventasMes = data?.ventas.monthly[month] ?? 0;
  const prevMonth = month === 1 ? 12 : month - 1;
  const ventasPrev = data?.ventas.monthly[prevMonth] ?? 0;
  const evolucion = ventasPrev > 0 ? ((ventasMes - ventasPrev) / ventasPrev) * 100 : 0;

  /** Grupos de gasto que efectivamente suman: los que computan y no son de mercadería. */
  const computingGroups = useMemo(
    () => (data?.groups ?? []).filter((g) => g.computes && !g.isMerchandise),
    [data],
  );
  const merchandiseGroups = useMemo(() => (data?.groups ?? []).filter((g) => g.isMerchandise), [data]);
  const excludedGroups = useMemo(() => (data?.groups ?? []).filter((g) => !g.computes), [data]);

  const ventasByLocal = data?.ventas.byLocal ?? {};

  /** Locales con facturación en el mes: los que no facturaron no tienen rentabilidad que medir. */
  const analyzedLocalIds = useMemo(() => {
    const base = selectedLocalIds.length > 0 ? selectedLocalIds : locals.map((l) => l.id);
    return base.filter((id) => Math.abs(ventasByLocal[id]?.[month] ?? 0) > 0.005);
  }, [selectedLocalIds, locals, ventasByLocal, month]);

  /**
   * CMV del mes, pasado a pesos contra las ventas DEL SISTEMA de cada local. Los locales sin CMV
   * cargado no se completan con lo pagado: quedan reportados en `missing`, porque taparlos con otro
   * criterio daría una rentabilidad falsa.
   */
  const cmvBalance = useMemo(() => {
    const ventasMesByLocal: Record<number, number> = {};
    for (const id of analyzedLocalIds) ventasMesByLocal[id] = ventasByLocal[id]?.[month] ?? 0;
    return buildCmvForBalance(cmvList, analyzedLocalIds, year, month, ventasMesByLocal);
  }, [cmvList, analyzedLocalIds, ventasByLocal, year, month]);

  /**
   * Locales que están en la vista pero NO facturaron en la fuente elegida. Importa avisarlo: sus
   * gastos SÍ computan, así que aparecen restando sin ninguna venta que los respalde y la utilidad
   * sale falsamente negativa. Pasa de verdad cuando cada local usa un sistema de gestión distinto.
   */
  const localsSinVentas = useMemo(() => {
    const base = selectedLocalIds.length > 0 ? selectedLocalIds : locals.map((l) => l.id);
    return base.filter((id) => Math.abs(ventasByLocal[id]?.[month] ?? 0) <= 0.005);
  }, [selectedLocalIds, locals, ventasByLocal, month]);

  const gastosMes = data?.summary.gastos[month] ?? 0;
  const cmvMes = cmvBalance.totalCmv;
  const utilidadMes = ventasMes - cmvMes - gastosMes;
  const margenPct = ventasMes > 0 ? (utilidadMes / ventasMes) * 100 : 0;

  const localName = (id: number) => locals.find((l) => l.id === id)?.name ?? `Local #${id}`;

  const toggleGroup = (id: number) =>
    setExpandedGroupIds((prev) => (prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id]));

  const toggleLocal = (id: number) =>
    setSelectedLocalIds((prev) => (prev.includes(id) ? prev.filter((l) => l !== id) : [...prev, id]));

  const expenseGroupsForConfig = useMemo(
    () =>
      [...financialGroups]
        .filter((g) => g.active !== false && String(g.type) === "expense")
        .sort((a, b) => String(a.name).localeCompare(String(b.name), "es")),
    [financialGroups],
  );
  const computingCount = expenseGroupsForConfig.filter((g) => (g as any).economicComputes ?? true).length;

  const sourceLabel = SALES_SOURCE_OPTIONS.find((s) => s.value === salesSource)?.label ?? salesSource;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Balances Económicos"
        description="Rentabilidad devengada: ventas del sistema y gastos por mes económico"
      />

      {/* ---------- Filtros ---------- */}
      <div className="flex flex-wrap items-center gap-2">
        <DataEntryCombobox
          options={yearOptions}
          value={selectedYear}
          onValueChange={setSelectedYear}
          placeholder="Año"
          searchPlaceholder="Buscar…"
          triggerClassName="w-28"
        />
        <DataEntryCombobox
          options={monthOptions}
          value={selectedMonth}
          onValueChange={setSelectedMonth}
          placeholder="Mes"
          searchPlaceholder="Buscar…"
          triggerClassName="w-40"
        />

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className="gap-2" data-testid="button-econ-locals">
              <ChevronsUpDown className="h-4 w-4" />
              {selectedLocalIds.length === 0
                ? "Todos los locales"
                : selectedLocalIds.length === 1
                  ? localName(selectedLocalIds[0])
                  : `${selectedLocalIds.length} locales`}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 space-y-2" align="start">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Locales</p>
              <Button variant="ghost" size="sm" onClick={() => setSelectedLocalIds([])}>
                Todos
              </Button>
            </div>
            <div className="max-h-64 space-y-1 overflow-y-auto">
              {locals.map((l) => (
                <label key={l.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-muted">
                  <Checkbox checked={selectedLocalIds.includes(l.id)} onCheckedChange={() => toggleLocal(l.id)} />
                  <span className="text-sm">{l.name}</span>
                </label>
              ))}
            </div>
          </PopoverContent>
        </Popover>

        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Ventas de:</span>
          <DataEntryCombobox
            options={SALES_SOURCE_OPTIONS.map((s) => ({ value: s.value, label: s.label }))}
            value={salesSource}
            onValueChange={(v) => setSalesSource(v as SalesSource)}
            placeholder="Fuente"
            searchPlaceholder="Buscar…"
            triggerClassName="w-36"
          />
        </div>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className="gap-2" data-testid="button-econ-groups-config">
              <Settings2 className="h-4 w-4" />
              Grupos que computan ({computingCount} de {expenseGroupsForConfig.length})
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80 space-y-2" align="start">
            <div>
              <p className="text-sm font-medium">Grupos que computan</p>
              <p className="text-xs text-muted-foreground">
                Destildá los que no son gasto económico del período (ej. compra de bienes, que es inversión). Se
                guarda para este cliente y vale para todos los meses.
              </p>
            </div>
            <div className="max-h-72 space-y-1 overflow-y-auto">
              {expenseGroupsForConfig.map((g) => {
                const computes = (g as any).economicComputes ?? true;
                return (
                  <label
                    key={g.id}
                    className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-muted"
                  >
                    <Checkbox
                      checked={computes}
                      disabled={computesMut.isPending}
                      onCheckedChange={(v) => computesMut.mutate({ id: g.id, computes: v === true })}
                    />
                    <span className="flex-1 truncate text-sm">{g.name}</span>
                    {(g as any).isMerchandise && (
                      <Badge variant="outline" className="text-[10px]">
                        Mercadería
                      </Badge>
                    )}
                  </label>
                );
              })}
              {expenseGroupsForConfig.length === 0 && (
                <p className="py-3 text-center text-sm text-muted-foreground">No hay grupos de gasto.</p>
              )}
            </div>
          </PopoverContent>
        </Popover>
      </div>

      <Tabs value={viewMode} onValueChange={setViewMode}>
        <TabsList>
          <TabsTrigger value="monthly">Vista Mensual</TabsTrigger>
          <TabsTrigger value="annual">Vista Anual</TabsTrigger>
        </TabsList>
      </Tabs>

      {isLoading ? (
        <Card>
          <CardContent className="space-y-3 py-6">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </CardContent>
        </Card>
      ) : viewMode === "monthly" ? (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 border-b pb-3">
            <CardTitle className="text-base font-semibold tracking-wide">EMPRESA</CardTitle>
            <span className="text-sm font-semibold">
              {MONTH_NAMES_ES[month - 1]} {year}
            </span>
          </CardHeader>
          <CardContent className="pt-4">
            {/* Evolución */}
            <div className="flex items-center justify-between border-b py-2 text-sm">
              <span className="text-muted-foreground">Evolución de Ventas</span>
              <span
                className={cn(
                  "inline-flex items-center gap-1 font-medium",
                  evolucion > 0 && "text-green-600",
                  evolucion < 0 && "text-red-600",
                  evolucion === 0 && "text-muted-foreground",
                )}
              >
                {ventasPrev > 0 ? (
                  <>
                    {evolucion > 0 ? <TrendingUp className="h-4 w-4" /> : evolucion < 0 ? <TrendingDown className="h-4 w-4" /> : <Minus className="h-4 w-4" />}
                    {evolucion.toFixed(1)}%
                  </>
                ) : (
                  "N/A"
                )}
              </span>
            </div>

            {/* VENTAS */}
            <div className="flex items-center justify-between pt-4">
              <span className="text-sm font-bold tracking-wide">VENTAS</span>
              <span className="font-mono font-bold text-green-600">{formatCurrency(ventasMes)}</span>
            </div>
            <button
              type="button"
              onClick={() => setVentasOpen((v) => !v)}
              className="mt-1 flex w-full items-center justify-between py-1.5 text-sm hover:bg-muted/50"
            >
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                {ventasOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                Composición ({sourceLabel})
              </span>
              <span className="font-mono text-sm">{formatCurrency(ventasMes)}</span>
            </button>
            {ventasOpen && (
              <div className="ml-5 border-l pl-3">
                {(data?.ventas.composition ?? []).filter((c) => (c.monthlyTotals[month] ?? 0) !== 0).length === 0 ? (
                  <p className="py-2 text-xs text-muted-foreground">
                    {sourceLabel} no trae desglose de la venta para este mes.
                  </p>
                ) : (
                  (data?.ventas.composition ?? [])
                    .filter((c) => (c.monthlyTotals[month] ?? 0) !== 0)
                    .map((c) => (
                      <div key={c.label} className="flex items-center justify-between py-1 text-sm">
                        <span className="text-muted-foreground">{c.label}</span>
                        <span className="font-mono">{formatCurrency(c.monthlyTotals[month] ?? 0)}</span>
                      </div>
                    ))
                )}
              </div>
            )}

            {ventasMes === 0 ? (
              <div className="mt-2 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs text-amber-700 dark:text-amber-400">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  No hay ventas de {sourceLabel} cargadas para {MONTH_NAMES_ES[month - 1]} {year} en los locales
                  seleccionados. Probá con otra fuente.
                </span>
              </div>
            ) : (
              localsSinVentas.length > 0 && (
                <div className="mt-2 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    Sin ventas de {sourceLabel} en {localsSinVentas.map(localName).join(", ")}. Sus gastos igual
                    computan más abajo, así que la utilidad queda subestimada. Si esos locales facturan con otro
                    sistema, cambiá la fuente o filtrá por local.
                  </span>
                </div>
              )
            )}

            {/* CMV */}
            <div className="mt-5 flex items-center justify-between border-t pt-3">
              <span className="text-sm font-bold tracking-wide">CMV</span>
              <span className="font-mono font-bold text-red-600">{formatCurrency(cmvMes)}</span>
            </div>
            {cmvBalance.rows.length > 0 && (
              <div className="ml-5 border-l pl-3">
                {cmvBalance.rows.map((r) => (
                  <div key={r.localId} className="flex items-center justify-between py-1 text-sm">
                    <span className="text-muted-foreground">
                      {localName(r.localId)}{" "}
                      <Badge variant="outline" className="ml-1 text-[10px]">
                        {r.pct.toFixed(2)}%
                      </Badge>
                    </span>
                    <span className="font-mono">{formatCurrency(r.cmvAmount)}</span>
                  </div>
                ))}
              </div>
            )}
            {cmvBalance.hasMissing && (
              <div className="mt-2 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs text-amber-700 dark:text-amber-400">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  Sin CMV de {MONTH_NAMES_ES[month - 1]} en{" "}
                  {cmvBalance.missing.map((m) => localName(m.localId)).join(", ")}:{" "}
                  {formatCurrency(cmvBalance.ventasSinCmv)} de ventas quedan sin costo de mercadería, así que la
                  utilidad de abajo está sobrestimada.
                </span>
              </div>
            )}
            {merchandiseGroups.length > 0 && (
              <p className="ml-5 mt-1 text-xs text-muted-foreground">
                Reemplaza a {merchandiseGroups.map((g) => g.name).join(", ")}: en el económico el costo es el CMV,
                no lo que se le pagó al proveedor.
              </p>
            )}

            {/* GASTOS */}
            <div className="mt-5 flex items-center justify-between border-t pt-3">
              <span className="text-sm font-bold tracking-wide">GASTOS</span>
              <span className="font-mono font-bold text-red-600">{formatCurrency(gastosMes)}</span>
            </div>
            <div className="mt-1">
              {computingGroups.length === 0 ? (
                <p className="py-2 text-sm text-muted-foreground">No hay gastos en este mes económico.</p>
              ) : (
                computingGroups
                  .filter((g) => (g.monthlyTotals[month] ?? 0) !== 0)
                  .sort((a, b) => (b.monthlyTotals[month] ?? 0) - (a.monthlyTotals[month] ?? 0))
                  .map((g) => {
                    const expanded = expandedGroupIds.includes(g.id);
                    const amount = g.monthlyTotals[month] ?? 0;
                    return (
                      <div key={g.id}>
                        <button
                          type="button"
                          onClick={() => toggleGroup(g.id)}
                          className="flex w-full items-center justify-between py-1.5 text-sm hover:bg-muted/50"
                        >
                          <span className="inline-flex items-center gap-1">
                            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            {g.name}
                          </span>
                          <span className="font-mono">{formatCurrency(amount)}</span>
                        </button>
                        {expanded && (
                          <div className="ml-5 border-l pl-3">
                            {g.categories
                              .filter((c) => (c.monthlyTotals[month] ?? 0) !== 0)
                              .sort((a, b) => (b.monthlyTotals[month] ?? 0) - (a.monthlyTotals[month] ?? 0))
                              .map((c) => (
                                <div key={c.id} className="flex items-center justify-between py-1 text-sm">
                                  <span className="text-muted-foreground">{c.name}</span>
                                  <span className="font-mono">{formatCurrency(c.monthlyTotals[month] ?? 0)}</span>
                                </div>
                              ))}
                          </div>
                        )}
                      </div>
                    );
                  })
              )}
            </div>

            {excludedGroups.length > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                No computan: {excludedGroups.map((g) => g.name).join(", ")}.
              </p>
            )}

            {/* UTILIDAD */}
            <div className="mt-5 flex items-center justify-between border-t-2 pt-3">
              <span className="text-base font-bold tracking-wide">UTILIDAD ECONÓMICA</span>
              <div className="text-right">
                <span
                  className={cn(
                    "font-mono text-lg font-bold",
                    utilidadMes > 0 ? "text-green-600" : utilidadMes < 0 ? "text-red-600" : "",
                  )}
                >
                  {formatCurrency(utilidadMes)}
                </span>
                <p className="text-xs text-muted-foreground">{margenPct.toFixed(1)}% sobre ventas</p>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        /* ---------- Vista Anual ---------- */
        <Card>
          <CardHeader className="border-b pb-3">
            <CardTitle className="text-base font-semibold tracking-wide">EMPRESA — {year}</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto pt-4">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b">
                  <th className="py-2 text-left font-medium">Concepto</th>
                  {SHORT_MONTHS.map((m) => (
                    <th key={m} className="px-2 py-2 text-right font-medium">
                      {m}
                    </th>
                  ))}
                  <th className="px-2 py-2 text-right font-bold">Total</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b font-semibold">
                  <td className="py-2">VENTAS ({sourceLabel})</td>
                  {SHORT_MONTHS.map((_, i) => (
                    <td key={i} className="px-2 py-2 text-right font-mono text-green-600">
                      {formatCurrency(data?.ventas.monthly[i + 1] ?? 0)}
                    </td>
                  ))}
                  <td className="px-2 py-2 text-right font-mono font-bold text-green-600">
                    {formatCurrency(data?.ventas.yearTotal ?? 0)}
                  </td>
                </tr>
                {computingGroups
                  .filter((g) => g.yearTotal !== 0)
                  .sort((a, b) => b.yearTotal - a.yearTotal)
                  .map((g) => (
                    <tr key={g.id} className="border-b">
                      <td className="py-1.5">{g.name}</td>
                      {SHORT_MONTHS.map((_, i) => (
                        <td key={i} className="px-2 py-1.5 text-right font-mono">
                          {formatCurrency(g.monthlyTotals[i + 1] ?? 0)}
                        </td>
                      ))}
                      <td className="px-2 py-1.5 text-right font-mono font-medium">{formatCurrency(g.yearTotal)}</td>
                    </tr>
                  ))}
                <tr className="border-b font-semibold">
                  <td className="py-2">GASTOS</td>
                  {SHORT_MONTHS.map((_, i) => (
                    <td key={i} className="px-2 py-2 text-right font-mono text-red-600">
                      {formatCurrency(data?.summary.gastos[i + 1] ?? 0)}
                    </td>
                  ))}
                  <td className="px-2 py-2 text-right font-mono font-bold text-red-600">
                    {formatCurrency(data?.summary.totalGastos ?? 0)}
                  </td>
                </tr>
              </tbody>
            </table>
            <p className="mt-3 text-xs text-muted-foreground">
              La vista anual no incluye el CMV: se calcula mes a mes contra el CMV% cargado de cada local. Mirá la
              Vista Mensual para la utilidad económica del período.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
