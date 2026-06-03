import { useQuery } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataEntryCombobox } from "@/components/data-entry-combobox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency } from "@/lib/formatters";
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Download,
  ChevronRight,
  ChevronDown,
  BarChart3,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
} from "lucide-react";
import type { Local } from "@shared/schema";

const fullMonths = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
];

const shortMonths = [
  "Ene", "Feb", "Mar", "Abr", "May", "Jun",
  "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"
];

interface CategoryData {
  id: number;
  name: string;
  isSpecial?: boolean;
  specialType?: string | null;
  monthlyTotals: Record<number, number>;
  yearTotal: number;
}

interface GroupData {
  id: number;
  name: string;
  type: string;
  isSpecial?: boolean;
  specialType?: string | null;
  categories: CategoryData[];
  monthlyTotals: Record<number, number>;
  yearTotal: number;
}

interface SpreadsheetData {
  groups: GroupData[];
  summary: {
    income: Record<number, number>;
    expenses: Record<number, number>;
    net: Record<number, number>;
    /** Otros Movimientos por mes (no afectan el neto). Signo informativo. */
    otrosMovimientos?: Record<number, number>;
    totalIncome: number;
    totalExpenses: number;
    totalNet: number;
    totalOtrosMovimientos?: number;
  };
}

export default function BalancePage() {
  const currentDate = new Date();
  const currentYear = currentDate.getFullYear();
  const currentMonth = currentDate.getMonth() + 1;

  const [selectedYear, setSelectedYear] = useState(currentYear.toString());
  const [selectedMonth, setSelectedMonth] = useState(currentMonth.toString());
  const [selectedLocalId, setSelectedLocalId] = useState<string>("all");
  const [viewMode, setViewMode] = useState<string>("monthly");
  const [expandedExpenseGroupIds, setExpandedExpenseGroupIds] = useState<number[]>([]);

  const { data: locals = [] } = useQuery<Local[]>({
    queryKey: ["/api/locals"],
  });

  const spreadsheetUrl = selectedLocalId === "all"
    ? `/api/balance-spreadsheet?year=${selectedYear}`
    : `/api/balance-spreadsheet?year=${selectedYear}&localId=${selectedLocalId}`;

  const { data: spreadsheet, isLoading } = useQuery<SpreadsheetData>({
    queryKey: ["/api/balance-spreadsheet", selectedYear, selectedLocalId],
    queryFn: async () => {
      const res = await fetch(spreadsheetUrl, { credentials: "include" });
      if (!res.ok) throw new Error("Error al cargar datos");
      return res.json();
    },
  });

  const years = Array.from({ length: 5 }, (_, i) => currentYear - 2 + i);

  const yearComboOptions = useMemo(
    () => years.map((y) => ({ value: String(y), label: String(y) })),
    [years],
  );

  const monthComboOptions = useMemo(
    () => fullMonths.map((m, i) => ({ value: String(i + 1), label: m })),
    [],
  );

  const balanceLocalComboOptions = useMemo(
    () => [
      { value: "all", label: "Todos los locales" },
      ...locals.map((l) => ({ value: String(l.id), label: l.name })),
    ],
    [locals],
  );

  const month = parseInt(selectedMonth);

  const monthlyVentas = spreadsheet?.summary.income[month] ?? 0;
  const monthlyGastos = spreadsheet?.summary.expenses[month] ?? 0;
  const monthlyUtilidad = monthlyVentas - monthlyGastos;

  const prevMonth = month === 1 ? 12 : month - 1;
  const prevVentas = spreadsheet?.summary.income[prevMonth] ?? 0;
  const evolucionVentas = prevVentas > 0 ? ((monthlyVentas - prevVentas) / prevVentas) * 100 : 0;

  const expenseGroups = useMemo(() => {
    if (!spreadsheet) return [];
    // Excluir grupos especiales (Otros Movimientos): no son gastos operativos.
    return spreadsheet.groups.filter(g => g.type === "expense" && !g.isSpecial);
  }, [spreadsheet]);

  // Otros Movimientos: Inicio de mes, Retiros, Préstamos, Otros Ingresos, Transferencias.
  // Quedan asentados y se muestran abajo, pero NO afectan la utilidad.
  const otrosMovGroups = useMemo(() => {
    if (!spreadsheet) return [];
    return spreadsheet.groups.filter(g => g.isSpecial);
  }, [spreadsheet]);

  const totalGastosPercent = monthlyVentas > 0 ? (monthlyGastos / monthlyVentas) * 100 : 0;
  const utilidadPercent = monthlyVentas > 0 ? (monthlyUtilidad / monthlyVentas) * 100 : 0;

  const handleExport = () => {
    const localParam = selectedLocalId === "all" ? "all" : selectedLocalId;
    const url = `/api/balance-report/export?year=${selectedYear}&month=${selectedMonth}&localId=${localParam}&format=pdf`;
    window.open(url, "_blank");
  };

  const renderMonthlyView = () => {
    if (isLoading) {
      return (
        <div className="space-y-4">
          {[1, 2, 3, 4, 5].map(i => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      );
    }

    if (!spreadsheet) {
      return (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No hay datos para mostrar. Importa extractos bancarios y categoriza los movimientos.
          </CardContent>
        </Card>
      );
    }

    const groupedExpenseLines = expenseGroups.map((group) => {
      const categories = group.categories.map((cat) => {
        const amount = cat.monthlyTotals[month] ?? 0;
        const percent = monthlyVentas > 0 ? (amount / monthlyVentas) * 100 : 0;
        return { name: cat.name, amount, percent };
      });

      const amountFromCategories = categories.reduce((sum, cat) => sum + cat.amount, 0);
      const amountFromGroup = group.monthlyTotals[month] ?? 0;
      const groupAmount = group.categories.length > 0 ? amountFromCategories : amountFromGroup;
      const groupPercent = monthlyVentas > 0 ? (groupAmount / monthlyVentas) * 100 : 0;

      return {
        groupId: group.id,
        groupName: group.name,
        groupAmount,
        groupPercent,
        categories,
      };
    });

    return (
      <Card>
        <CardContent className="pt-6">
          <div className="space-y-5">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
              <span className="font-semibold uppercase tracking-wide">Empresa</span>
              <span className="font-mono text-right font-semibold">{fullMonths[month - 1]} {selectedYear}</span>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto] text-sm">
              <span className="font-medium">Evolucion de Ventas</span>
              <span className="font-mono text-right">
                {prevVentas > 0 ? `${evolucionVentas >= 0 ? "+" : ""}${evolucionVentas.toFixed(2)}%` : "N/A"}
              </span>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto] border-b pb-3">
              <span className="font-bold uppercase">Ventas</span>
              <span className="font-mono text-right font-bold text-green-600" data-testid="text-ventas">
                {formatCurrency(monthlyVentas)}
              </span>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
              <span className="font-bold uppercase">Gastos</span>
              <span />
            </div>

            <div className="space-y-2">
              {groupedExpenseLines.map((group, idx) => (
                <div key={`${group.groupName}-${idx}`} className="space-y-1">
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto] text-sm font-semibold">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 text-left"
                      onClick={() =>
                        setExpandedExpenseGroupIds((prev) =>
                          prev.includes(group.groupId)
                            ? prev.filter((id) => id !== group.groupId)
                            : [...prev, group.groupId],
                        )
                      }
                    >
                      {expandedExpenseGroupIds.includes(group.groupId) ? (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      )}
                      <span>{group.groupName}</span>
                    </button>
                    <span className="font-mono text-right">{formatCurrency(group.groupAmount)}</span>
                  </div>
                  {expandedExpenseGroupIds.includes(group.groupId) &&
                    group.categories.map((cat, catIdx) => (
                      <div key={`${group.groupName}-${cat.name}-${catIdx}`} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto] text-sm">
                        <span className="pl-6 text-muted-foreground">{cat.name}</span>
                        <span className="font-mono text-right text-muted-foreground">{formatCurrency(cat.amount)}</span>
                      </div>
                    ))}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto] border-t pt-3">
              <span className="font-bold uppercase">Gastos Totales</span>
              <span className="font-mono text-right font-bold text-red-600" data-testid="text-gastos-totales">
                {formatCurrency(monthlyGastos)}
              </span>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto] border-t pt-3">
              <span className="font-bold">Utilidad</span>
              <span className={`font-mono text-right font-bold ${monthlyUtilidad >= 0 ? "text-green-600" : "text-red-600"}`} data-testid="text-utilidad">
                {formatCurrency(monthlyUtilidad)}
              </span>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto] border-t pt-4">
              <span className="font-bold uppercase">Gastos / UT en %</span>
              <span />
            </div>

            <div className="space-y-2">
              {groupedExpenseLines.map((group, idx) => (
                <div key={`pct-${group.groupName}-${idx}`} className="space-y-1">
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto] text-sm font-semibold">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 text-left"
                      onClick={() =>
                        setExpandedExpenseGroupIds((prev) =>
                          prev.includes(group.groupId)
                            ? prev.filter((id) => id !== group.groupId)
                            : [...prev, group.groupId],
                        )
                      }
                    >
                      {expandedExpenseGroupIds.includes(group.groupId) ? (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      )}
                      <span>{group.groupName}</span>
                    </button>
                    <span className="font-mono text-right">{group.groupPercent.toFixed(2)}%</span>
                  </div>
                  {expandedExpenseGroupIds.includes(group.groupId) &&
                    group.categories.map((cat, catIdx) => (
                      <div key={`pct-${group.groupName}-${cat.name}-${catIdx}`} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto] text-sm">
                        <span className="pl-6 text-muted-foreground">{cat.name}</span>
                        <span className="font-mono text-right text-muted-foreground">{cat.percent.toFixed(2)}%</span>
                      </div>
                    ))}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto] border-t pt-3">
              <span className="font-bold uppercase">Total</span>
              <span />
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto] text-sm">
              <span className="font-bold">Utilidad</span>
              <span className={`font-mono text-right font-bold ${utilidadPercent >= 0 ? "text-green-600" : "text-red-600"}`} data-testid="text-utilidad-percent">
                {utilidadPercent.toFixed(2)}%
              </span>
            </div>

            {otrosMovGroups.length > 0 && (
              <div className="space-y-2 border-t-2 pt-4" data-testid="section-otros-movimientos">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
                  <span className="font-bold uppercase">Otros Movimientos</span>
                  <span className="text-xs text-muted-foreground self-center sm:text-right">
                    No afectan la utilidad
                  </span>
                </div>
                {otrosMovGroups.map((group, idx) => {
                  const raw = group.monthlyTotals[month] ?? 0;
                  const signed = group.type === "expense" ? -raw : raw;
                  return (
                    <div
                      key={`otros-${group.id}-${idx}`}
                      className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto] text-sm"
                    >
                      <span className="text-muted-foreground">{group.name}</span>
                      <span className="font-mono text-right text-muted-foreground">
                        {formatCurrency(signed)}
                      </span>
                    </div>
                  );
                })}
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto] border-t pt-2 text-sm">
                  <span className="font-semibold">Total Otros Movimientos</span>
                  <span className="font-mono text-right font-semibold" data-testid="text-total-otros-movimientos">
                    {formatCurrency(spreadsheet.summary.otrosMovimientos?.[month] ?? 0)}
                  </span>
                </div>

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto] border-t-2 pt-2">
                  <span className="font-bold uppercase">Movimiento neto del período (caja)</span>
                  <span
                    className="font-mono text-right font-bold"
                    data-testid="text-movimiento-neto-caja"
                  >
                    {formatCurrency(monthlyUtilidad + (spreadsheet.summary.otrosMovimientos?.[month] ?? 0))}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Utilidad (rentabilidad) + Otros Movimientos. Este total es el que impacta los
                  saldos de caja/cuentas — por eso los Otros Movimientos quedan asentados aunque no
                  afecten la rentabilidad.
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    );
  };

  const renderAnnualView = () => {
    if (isLoading) {
      return (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map(i => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      );
    }

    if (!spreadsheet || spreadsheet.groups.length === 0) {
      return (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No hay datos de balance para mostrar.
          </CardContent>
        </Card>
      );
    }

    const { summary } = spreadsheet;

    return (
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
              <CardTitle className="text-sm font-medium">Ventas Anuales</CardTitle>
              <TrendingUp className="h-4 w-4 text-green-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold font-mono text-green-600" data-testid="stat-annual-income">
                {formatCurrency(summary.totalIncome)}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
              <CardTitle className="text-sm font-medium">Gastos Anuales</CardTitle>
              <TrendingDown className="h-4 w-4 text-red-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold font-mono text-red-600" data-testid="stat-annual-expenses">
                {formatCurrency(summary.totalExpenses)}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
              <CardTitle className="text-sm font-medium">Utilidad Anual</CardTitle>
              <DollarSign className={`h-4 w-4 ${summary.totalNet >= 0 ? "text-green-600" : "text-red-600"}`} />
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold font-mono ${summary.totalNet >= 0 ? "text-green-600" : "text-red-600"}`} data-testid="stat-annual-net">
                {formatCurrency(summary.totalNet)}
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Resumen Anual por Mes</CardTitle>
          </CardHeader>
          <CardContent className="p-0 md:p-6">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm" data-testid="balance-annual-table">
                <thead>
                  <tr className="bg-muted/50">
                    <th className="sticky left-0 z-10 bg-muted/50 text-left px-3 py-2 font-medium border-b min-w-[80px]">
                      Mes
                    </th>
                    <th className="text-right px-3 py-2 font-medium border-b min-w-[120px]">Ventas</th>
                    <th className="text-right px-3 py-2 font-medium border-b min-w-[120px]">Gastos</th>
                    <th className="text-right px-3 py-2 font-medium border-b min-w-[120px]">Utilidad</th>
                    <th className="text-right px-3 py-2 font-medium border-b min-w-[80px]">Margen</th>
                  </tr>
                </thead>
                <tbody>
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => {
                    const inc = summary.income[m] ?? 0;
                    const exp = summary.expenses[m] ?? 0;
                    const net = inc - exp;
                    const margin = inc > 0 ? (net / inc) * 100 : 0;
                    const hasData = inc > 0 || exp > 0;

                    return (
                      <tr
                        key={m}
                        className={`border-b hover-elevate cursor-pointer ${m === parseInt(selectedMonth) ? "bg-primary/5" : ""}`}
                        onClick={() => { setSelectedMonth(m.toString()); setViewMode("monthly"); }}
                        data-testid={`row-month-${m}`}
                      >
                        <td className="sticky left-0 z-10 bg-background px-3 py-2 font-medium border-b">
                          {fullMonths[m - 1]}
                        </td>
                        <td className="text-right px-3 py-2 font-mono border-b text-green-600 dark:text-green-400">
                          {hasData ? formatCurrency(inc) : "-"}
                        </td>
                        <td className="text-right px-3 py-2 font-mono border-b text-red-600 dark:text-red-400">
                          {hasData ? formatCurrency(exp) : "-"}
                        </td>
                        <td className={`text-right px-3 py-2 font-mono font-medium border-b ${net >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                          {hasData ? formatCurrency(net) : "-"}
                        </td>
                        <td className={`text-right px-3 py-2 font-mono border-b ${margin >= 0 ? "" : "text-red-600"}`}>
                          {hasData ? `${margin.toFixed(1)}%` : "-"}
                        </td>
                      </tr>
                    );
                  })}
                  <tr className="bg-muted/50 font-bold">
                    <td className="sticky left-0 z-10 bg-muted/50 px-3 py-3 border-t-2">TOTAL</td>
                    <td className="text-right px-3 py-3 font-mono border-t-2 text-green-600 dark:text-green-400">
                      {formatCurrency(summary.totalIncome)}
                    </td>
                    <td className="text-right px-3 py-3 font-mono border-t-2 text-red-600 dark:text-red-400">
                      {formatCurrency(summary.totalExpenses)}
                    </td>
                    <td className={`text-right px-3 py-3 font-mono border-t-2 ${summary.totalNet >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                      {formatCurrency(summary.totalNet)}
                    </td>
                    <td className="text-right px-3 py-3 font-mono border-t-2">
                      {summary.totalIncome > 0 ? `${((summary.totalNet / summary.totalIncome) * 100).toFixed(1)}%` : "-"}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Balances Financieros"
        description="Estado de resultados mensual y anual"
        actions={
          <Button variant="outline" data-testid="button-export" onClick={handleExport}>
            <Download className="h-4 w-4 mr-2" />
            Exportar PDF
          </Button>
        }
      />

      <div className="flex flex-col sm:flex-row flex-wrap gap-4 items-start sm:items-center">
        <DataEntryCombobox
          options={yearComboOptions}
          value={selectedYear}
          onValueChange={setSelectedYear}
          placeholder="Año"
          searchPlaceholder="Buscar año…"
          triggerClassName="w-32"
          data-testid="select-year"
        />

        {viewMode === "monthly" && (
          <DataEntryCombobox
            options={monthComboOptions}
            value={selectedMonth}
            onValueChange={setSelectedMonth}
            placeholder="Mes"
            searchPlaceholder="Buscar mes…"
            triggerClassName="w-44"
            data-testid="select-month"
          />
        )}

        <DataEntryCombobox
          options={balanceLocalComboOptions}
          value={selectedLocalId}
          onValueChange={setSelectedLocalId}
          placeholder="Local"
          searchPlaceholder="Buscar local…"
          triggerClassName="w-48"
          data-testid="select-local"
        />
      </div>

      <Tabs value={viewMode} onValueChange={setViewMode}>
        <TabsList>
          <TabsTrigger value="monthly" data-testid="tab-monthly">
            Vista Mensual
          </TabsTrigger>
          <TabsTrigger value="annual" data-testid="tab-annual">
            Vista Anual
          </TabsTrigger>
        </TabsList>

        <TabsContent value="monthly" className="mt-4">
          {renderMonthlyView()}
        </TabsContent>

        <TabsContent value="annual" className="mt-4">
          {renderAnnualView()}
        </TabsContent>
      </Tabs>
    </div>
  );
}
