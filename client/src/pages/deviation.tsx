import { useMemo } from "react";
import * as XLSX from "xlsx";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { DataTable, Column } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DataEntryCombobox } from "@/components/data-entry-combobox";
import { MetricCard } from "@/components/supply-metrics-filters";
import { usePersistentFilter } from "@/hooks/usePersistentFilter";
import { useSalesSources } from "@/hooks/useSalesSources";
import { formatCurrency, formatDate, formatNumber } from "@/lib/formatters";
import { AlertCircle, Download, TrendingDown, TrendingUp } from "lucide-react";
import type { Local } from "@shared/schema";
import type { DeviationPeriod, DeviationResult, DeviationRow } from "@shared/deviationEngine";

interface OverviewRow {
  localId: number;
  localName: string | null;
  period: DeviationPeriod;
  measuredAmount: number;
  assumedAmount: number;
  totalAmount: number;
  consumptionAmount: number;
  purchasesAmount: number;
  decomisosAmount: number;
  deviationOverConsumptionPct: number | null;
  coveragePct: number | null;
  offendersCount: number;
  worstSupplyName: string | null;
  worstSupplyAmount: number | null;
}

/** Rojo si falta mercadería, ámbar si sobra: un sobrante grande también es un problema de carga. */
function amountTone(amount: number): string {
  if (amount < 0) return "text-destructive";
  if (amount > 0) return "text-amber-600 dark:text-amber-500";
  return "text-muted-foreground";
}

export default function DeviationPage() {
  const { options: sourceOptions } = useSalesSources();
  const [localId, setLocalId] = usePersistentFilter<string>("desvio.localId", "");
  const [periodKey, setPeriodKey] = usePersistentFilter<string>("desvio.period", "");
  const [sourceRaw, setSource] = usePersistentFilter<string>("desvio.source", "");
  const [tolerance, setTolerance] = usePersistentFilter<string>("desvio.tolerance", "2");
  const [tab, setTab] = usePersistentFilter<string>("desvio.tab", "local");

  const source = sourceRaw || sourceOptions[0]?.value || "fudo";
  const tolerancePct = Number.isFinite(parseFloat(tolerance)) ? parseFloat(tolerance) : 0;

  const { data: locals = [] } = useQuery<Local[]>({ queryKey: ["/api/locals"] });

  const { data: periods = [], isLoading: loadingPeriods } = useQuery<DeviationPeriod[]>({
    queryKey: [`/api/deviation/periods${localId ? `?localId=${localId}` : ""}`],
  });

  const selectedPeriod = useMemo(() => {
    if (periods.length === 0) return null;
    const found = periods.find(
      (p) => `${p.openingValuationId}-${p.closingValuationId}` === periodKey,
    );
    return found ?? periods[0];
  }, [periods, periodKey]);

  const deviationQuery = selectedPeriod
    ? `/api/deviation?localId=${selectedPeriod.localId}&openingValuationId=${selectedPeriod.openingValuationId}` +
      `&closingValuationId=${selectedPeriod.closingValuationId}&source=${source}&tolerancePct=${tolerancePct}`
    : null;

  const { data, isLoading } = useQuery<DeviationResult>({
    queryKey: [deviationQuery],
    enabled: tab === "local" && deviationQuery != null,
  });

  const { data: overview = [], isLoading: loadingOverview } = useQuery<OverviewRow[]>({
    queryKey: [`/api/deviation/overview?source=${source}&tolerancePct=${tolerancePct}`],
    enabled: tab === "global",
  });

  const summary = data?.summary;
  const lowCoverage = data?.coveragePct != null && data.coveragePct < 95;

  const visibleRows = useMemo(() => {
    if (!data) return [];
    // Se muestran los que superan la tolerancia y los que quedaron sin medir (para que se vean).
    return data.rows.filter(
      (r) => !r.measured || (r.deviationPct != null && Math.abs(r.deviationPct) >= tolerancePct && r.deviationAmount !== 0),
    );
  }, [data, tolerancePct]);

  const exportToExcel = () => {
    const rows = (data?.rows ?? []).map((r) => ({
      Insumo: r.supplyName,
      Unidad: r.unit ?? "",
      "Stock inicial": r.openingQty,
      Compras: r.purchases,
      "Traslados recibidos": r.transfersIn,
      "Traslados enviados": r.transfersOut,
      "Consumo teórico": r.consumption,
      Decomisos: r.decomisos,
      "Stock final teórico": r.theoreticalClosing,
      "Stock final contado": r.actualClosing,
      "Desvío cantidad": r.deviationQty,
      "Costo unitario": r.unitCost,
      "Desvío $": r.deviationAmount,
      "Desvío %": r.deviationPct,
      Medición: r.measured ? "Medido" : r.missingOpening ? "Sin conteo inicial" : "Sin conteo final",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Desvío");
    const p = data?.period;
    XLSX.writeFile(wb, `desvio_${p?.localName ?? "local"}_${p?.openingDate ?? ""}_${p?.closingDate ?? ""}.xlsx`);
  };

  const columns: Column<DeviationRow>[] = [
    {
      key: "supplyName",
      header: "Insumo",
      cell: (r) => (
        <div>
          <div className="font-medium">{r.supplyName}</div>
          {!r.measured && (
            <Badge variant="outline" className="mt-0.5 text-amber-600 dark:text-amber-500 border-amber-500/40">
              {r.missingOpening ? "Sin conteo inicial" : "Sin conteo final"}
            </Badge>
          )}
        </div>
      ),
    },
    {
      key: "openingQty",
      header: "Inicial",
      className: "text-right",
      cell: (r) => <div className="text-right font-mono text-xs">{formatNumber(r.openingQty, 2)}</div>,
    },
    {
      key: "purchases",
      header: "+ Compras",
      className: "text-right",
      cell: (r) => <div className="text-right font-mono text-xs">{formatNumber(r.purchases, 2)}</div>,
    },
    {
      key: "transfersIn",
      header: "± Traslados",
      className: "text-right",
      cell: (r) => (
        <div className="text-right font-mono text-xs">
          {r.transfersIn > 0 && <span className="text-emerald-600 dark:text-emerald-500">+{formatNumber(r.transfersIn, 2)}</span>}
          {r.transfersIn > 0 && r.transfersOut > 0 && " / "}
          {r.transfersOut > 0 && <span className="text-destructive">−{formatNumber(r.transfersOut, 2)}</span>}
          {r.transfersIn === 0 && r.transfersOut === 0 && <span className="text-muted-foreground">—</span>}
        </div>
      ),
    },
    {
      key: "consumption",
      header: "− Consumo",
      className: "text-right",
      cell: (r) => <div className="text-right font-mono text-xs">{formatNumber(r.consumption, 2)}</div>,
    },
    {
      key: "decomisos",
      header: "− Decomisos",
      className: "text-right",
      cell: (r) => (
        <div className="text-right font-mono text-xs">
          {r.decomisos > 0 ? formatNumber(r.decomisos, 2) : <span className="text-muted-foreground">—</span>}
        </div>
      ),
    },
    {
      key: "theoreticalClosing",
      header: "= Teórico",
      className: "text-right",
      cell: (r) => <div className="text-right font-mono text-xs text-muted-foreground">{formatNumber(r.theoreticalClosing, 2)}</div>,
    },
    {
      key: "actualClosing",
      header: "Contado",
      className: "text-right",
      cell: (r) => <div className="text-right font-mono text-xs font-medium">{formatNumber(r.actualClosing, 2)}</div>,
    },
    {
      key: "deviationQty",
      header: "Desvío",
      className: "text-right",
      cell: (r) => (
        <div className="text-right">
          <div className={`font-mono font-medium ${amountTone(r.deviationAmount)}`}>
            {formatCurrency(r.deviationAmount)}
          </div>
          <div className="text-xs text-muted-foreground font-mono">
            {formatNumber(r.deviationQty, 2)} {r.unit ?? ""}
            {r.deviationPct != null && ` · ${r.deviationPct.toFixed(1)}%`}
          </div>
        </div>
      ),
    },
  ];

  const overviewColumns: Column<OverviewRow & { id: number }>[] = [
    { key: "localName", header: "Local", cell: (r) => <span className="font-medium">{r.localName ?? `Local ${r.localId}`}</span> },
    {
      key: "period",
      header: "Último período",
      cell: (r) => (
        <span className="text-xs text-muted-foreground">
          {formatDate(r.period.openingDate)} → {formatDate(r.period.closingDate)} ({r.period.days}d)
        </span>
      ),
    },
    {
      key: "measuredAmount",
      header: "Desvío medido",
      className: "text-right",
      cell: (r) => (
        <div className={`text-right font-mono font-medium ${amountTone(r.measuredAmount)}`}>
          {formatCurrency(r.measuredAmount)}
        </div>
      ),
    },
    {
      key: "deviationOverConsumptionPct",
      header: "% s/ consumo",
      className: "text-right",
      cell: (r) => (
        <div className="text-right font-mono">
          {r.deviationOverConsumptionPct != null ? `${r.deviationOverConsumptionPct.toFixed(1)}%` : "—"}
        </div>
      ),
    },
    {
      key: "assumedAmount",
      header: "Supuesto",
      className: "text-right",
      cell: (r) => (
        <div className="text-right font-mono text-xs text-muted-foreground">{formatCurrency(r.assumedAmount)}</div>
      ),
    },
    {
      key: "coveragePct",
      header: "Cobertura",
      className: "text-right",
      cell: (r) => (
        <div
          className={`text-right font-mono text-xs ${
            r.coveragePct != null && r.coveragePct < 95 ? "text-amber-600 dark:text-amber-500" : "text-muted-foreground"
          }`}
        >
          {r.coveragePct != null ? `${r.coveragePct.toFixed(0)}%` : "—"}
        </div>
      ),
    },
    {
      key: "worstSupplyName",
      header: "El que más pesa",
      cell: (r) =>
        r.worstSupplyName ? (
          <div className="text-xs">
            <div>{r.worstSupplyName}</div>
            <div className={`font-mono ${amountTone(r.worstSupplyAmount ?? 0)}`}>
              {formatCurrency(r.worstSupplyAmount ?? 0)}
            </div>
          </div>
        ) : (
          <span className="text-muted-foreground text-xs">—</span>
        ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Desvío de Mercadería"
        description="Lo que debería haber quedado en stock contra lo que realmente se contó"
      />

      <div className="flex flex-wrap gap-3 items-end">
        {tab === "local" && (
          <>
            <div className="w-48">
              <Label className="block text-xs text-muted-foreground mb-1">Local</Label>
              <DataEntryCombobox
                options={[
                  { value: "", label: "Todos los locales" },
                  ...locals.map((l) => ({ value: String(l.id), label: l.name })),
                ]}
                value={localId}
                onValueChange={(v) => {
                  setLocalId(v);
                  setPeriodKey("");
                }}
                placeholder="Todos los locales"
                searchPlaceholder="Buscar local…"
                data-testid="filter-local"
              />
            </div>

            <div className="w-72">
              <Label className="block text-xs text-muted-foreground mb-1">Período (entre dos inventarios)</Label>
              <DataEntryCombobox
                options={periods.map((p) => ({
                  value: `${p.openingValuationId}-${p.closingValuationId}`,
                  label: `${p.localName ?? "—"}: ${formatDate(p.openingDate)} → ${formatDate(p.closingDate)} (${p.days}d)`,
                }))}
                value={
                  selectedPeriod
                    ? `${selectedPeriod.openingValuationId}-${selectedPeriod.closingValuationId}`
                    : ""
                }
                onValueChange={setPeriodKey}
                placeholder={loadingPeriods ? "Cargando…" : "Elegí un período"}
                searchPlaceholder="Buscar período…"
                data-testid="filter-period"
              />
            </div>
          </>
        )}

        <div className="w-40">
          <Label className="block text-xs text-muted-foreground mb-1">Origen de ventas</Label>
          <select
            className="w-full h-9 rounded-md border bg-background px-2 text-sm"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            data-testid="filter-source"
          >
            {sourceOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div className="w-32">
          <Label className="block text-xs text-muted-foreground mb-1">Tolerancia %</Label>
          <Input
            type="number"
            min={0}
            step="0.5"
            value={tolerance}
            onChange={(e) => setTolerance(e.target.value)}
            className="h-9"
            data-testid="input-tolerance"
          />
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="local" data-testid="tab-local">
            Por período
          </TabsTrigger>
          <TabsTrigger value="global" data-testid="tab-global">
            Todos los locales
          </TabsTrigger>
        </TabsList>

        <TabsContent value="local" className="mt-4 space-y-4">
          {periods.length === 0 && !loadingPeriods ? (
            <div className="rounded-lg border p-8 text-center text-muted-foreground">
              No hay períodos para medir. Hacen falta al menos dos inventarios del mismo local, con local asignado.
            </div>
          ) : (
            <>
              <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
                <MetricCard
                  label="Desvío medido"
                  value={formatCurrency(summary?.measuredAmount ?? 0)}
                  hint={`${summary?.measuredCount ?? 0} insumos contados en las dos puntas`}
                  tone={(summary?.measuredAmount ?? 0) < 0 ? "warning" : "default"}
                  testId="card-desvio-medido"
                />
                <MetricCard
                  label="Desvío supuesto"
                  value={formatCurrency(summary?.assumedAmount ?? 0)}
                  hint={`${summary?.assumedCount ?? 0} sin contar en una punta (se tomó cero)`}
                  tone="muted"
                  testId="card-desvio-supuesto"
                />
                <MetricCard
                  label="Desvío sobre consumo"
                  value={
                    summary?.deviationOverConsumptionPct != null
                      ? `${summary.deviationOverConsumptionPct.toFixed(1)}%`
                      : "—"
                  }
                  hint={`Consumo del período: ${formatCurrency(summary?.consumptionAmount ?? 0)}`}
                  testId="card-desvio-pct"
                />
                <MetricCard
                  label="Cobertura de recetas"
                  value={data?.coveragePct != null ? `${data.coveragePct.toFixed(1)}%` : "—"}
                  hint={lowCoverage ? "El consumo está incompleto" : "De las unidades vendidas"}
                  tone={lowCoverage ? "warning" : "default"}
                  testId="card-cobertura"
                />
              </div>

              {data && (
                <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
                  Movimientos contados del <span className="font-medium">{formatDate(data.movementsFrom)}</span> al{" "}
                  <span className="font-medium">{formatDate(data.movementsTo)}</span> — el conteo de apertura se toma
                  como el estado al cierre de su día, así que el período arranca al día siguiente.
                  {data.subRecipesExploded.length > 0 && (
                    <>
                      {" "}
                      Se convirtieron a insumos {data.subRecipesExploded.length} sub-receta(s) contadas:{" "}
                      {data.subRecipesExploded.map((s) => s.name).join(", ")}.
                    </>
                  )}
                </div>
              )}

              {lowCoverage && (
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-500 mt-0.5 shrink-0" />
                  <div className="text-sm">
                    <div className="font-medium">El consumo teórico está incompleto</div>
                    <div className="text-muted-foreground">
                      Sólo {data?.coveragePct?.toFixed(1)}% de las {formatNumber(data?.unitsSold ?? 0, 0)} unidades
                      vendidas tiene receta asignada. Lo que no tiene receta no resta consumo, así que el desvío va a
                      mostrar mercadería de más. Asigná recetas en Insumos → Consumo → Recetas por producto.
                    </div>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between">
                <div className="text-sm text-muted-foreground">
                  {visibleRows.length} insumo(s) por encima de la tolerancia del {tolerancePct}%, de{" "}
                  {data?.rows.length ?? 0} con movimiento
                </div>
                <Button
                  variant="outline"
                  onClick={exportToExcel}
                  disabled={(data?.rows.length ?? 0) === 0}
                  data-testid="button-export-desvio"
                >
                  <Download className="h-4 w-4 mr-2" />
                  Exportar detalle
                </Button>
              </div>

              <DataTable
                columns={columns}
                data={visibleRows}
                isLoading={isLoading}
                searchPlaceholder="Buscar insumo..."
                searchKeys={["supplyName"] as (keyof DeviationRow)[]}
                emptyMessage="Ningún insumo supera la tolerancia. Bajala para ver los desvíos chicos."
                tableClassName="text-sm"
              />
            </>
          )}
        </TabsContent>

        <TabsContent value="global" className="mt-4 space-y-4">
          <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
            <MetricCard
              label="Desvío medido total"
              value={formatCurrency(overview.reduce((a, r) => a + r.measuredAmount, 0))}
              hint={`${overview.length} local(es) con período cerrado`}
              tone={overview.reduce((a, r) => a + r.measuredAmount, 0) < 0 ? "warning" : "default"}
              testId="card-global-medido"
            />
            <MetricCard
              label="Consumo del período"
              value={formatCurrency(overview.reduce((a, r) => a + r.consumptionAmount, 0))}
              testId="card-global-consumo"
            />
            <MetricCard
              label="Compras del período"
              value={formatCurrency(overview.reduce((a, r) => a + r.purchasesAmount, 0))}
              testId="card-global-compras"
            />
            <MetricCard
              label="Decomisos del período"
              value={formatCurrency(overview.reduce((a, r) => a + r.decomisosAmount, 0))}
              testId="card-global-decomisos"
            />
          </div>

          <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
            Cada local se muestra con su <span className="font-medium">último período cerrado</span>: los calendarios
            de inventario no coinciden entre locales, así que no hay un período común. Las fechas de cada uno están en
            la tabla.
          </div>

          <DataTable
            columns={overviewColumns}
            data={overview.map((r) => ({ ...r, id: r.localId }))}
            isLoading={loadingOverview}
            searchPlaceholder="Buscar local..."
            searchKeys={["localName"] as any}
            emptyMessage="Ningún local tiene dos inventarios para comparar todavía."
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
