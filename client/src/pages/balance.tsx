import { useQuery } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency } from "@/lib/formatters";
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Download,
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
  monthlyTotals: Record<number, number>;
  yearTotal: number;
}

interface GroupData {
  id: number;
  name: string;
  type: string;
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
    totalIncome: number;
    totalExpenses: number;
    totalNet: number;
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

  const month = parseInt(selectedMonth);

  const monthlyVentas = spreadsheet?.summary.income[month] ?? 0;
  const monthlyGastos = spreadsheet?.summary.expenses[month] ?? 0;
  const monthlyUtilidad = monthlyVentas - monthlyGastos;

  const prevMonth = month === 1 ? 12 : month - 1;
  const prevVentas = spreadsheet?.summary.income[prevMonth] ?? 0;
  const evolucionVentas = prevVentas > 0 ? ((monthlyVentas - prevVentas) / prevVentas) * 100 : 0;

  const expenseGroups = useMemo(() => {
    if (!spreadsheet) return [];
    return spreadsheet.groups.filter(g => g.type === "expense");
  }, [spreadsheet]);

  const expenseCategories = useMemo(() => {
    if (!spreadsheet) return [];
    const cats: Array<{ groupName: string; name: string; amount: number; percent: number }> = [];

    for (const group of expenseGroups) {
      for (const cat of group.categories) {
        const amount = cat.monthlyTotals[month] ?? 0;
        const percent = monthlyVentas > 0 ? (amount / monthlyVentas) * 100 : 0;
        cats.push({ groupName: group.name, name: cat.name, amount, percent });
      }

      // Si el grupo no tiene categorías con datos, usamos el total del grupo
      if (group.categories.length === 0) {
        const amount = group.monthlyTotals[month] ?? 0;
        const percent = monthlyVentas > 0 ? (amount / monthlyVentas) * 100 : 0;
        cats.push({ groupName: group.name, name: group.name, amount, percent });
      }
    }

    return cats.sort((a, b) => b.amount - a.amount);
  }, [spreadsheet, month, monthlyVentas, expenseGroups]);

  const totalGastosPercent = monthlyVentas > 0 ? (monthlyGastos / monthlyVentas) * 100 : 0;
  const utilidadPercent = monthlyVentas > 0 ? (monthlyUtilidad / monthlyVentas) * 100 : 0;

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

    return (
      <div className="space-y-6">
        <Card className="border-2">
          <CardContent className="pt-6">
            <div className="text-center space-y-2">
              <h2 className="text-xl font-bold" data-testid="text-title">
                {fullMonths[month - 1]} {selectedYear}
              </h2>
              <div className="flex items-center justify-center gap-3">
                <span className="text-sm text-muted-foreground">Evolucion de Ventas</span>
                {prevVentas > 0 ? (
                  <Badge
                    variant={evolucionVentas >= 0 ? "default" : "destructive"}
                    className="font-mono"
                  >
                    {evolucionVentas >= 0 ? (
                      <ArrowUpRight className="h-3 w-3 mr-1" />
                    ) : (
                      <ArrowDownRight className="h-3 w-3 mr-1" />
                    )}
                    {evolucionVentas >= 0 ? "+" : ""}{evolucionVentas.toFixed(1)}%
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="font-mono">
                    <Minus className="h-3 w-3 mr-1" />
                    N/A
                  </Badge>
                )}
              </div>
              <div className="pt-4">
                <p className="text-sm font-medium text-muted-foreground mb-1">VENTAS</p>
                <p className="text-3xl font-bold font-mono text-green-600 dark:text-green-400" data-testid="text-ventas">
                  {formatCurrency(monthlyVentas)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2">
              <TrendingDown className="h-5 w-5 text-red-600" />
              GASTOS
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-0">
              {expenseGroups.map(group => {
                const groupCats = expenseCategories.filter(c => c.groupName === group.name && c.amount > 0);
                const groupTotal = groupCats.reduce((sum, c) => sum + c.amount, 0);

                if (groupTotal === 0) return null;

                return (
                  <div key={group.id} className="border-b last:border-b-0 py-2.5">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-semibold">{group.name}</span>
                      <span className="font-mono text-sm font-semibold text-red-600">
                        {formatCurrency(groupTotal)}
                      </span>
                    </div>
                    {groupCats.map((cat, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between py-1 pl-3"
                        data-testid={`row-gasto-${group.id}-${idx}`}
                      >
                        <span className="text-xs">{cat.name}</span>
                        <span className={`font-mono text-xs ${cat.amount > 0 ? "" : "text-muted-foreground"}`}>
                          {cat.amount > 0 ? formatCurrency(cat.amount) : "$0,00"}
                        </span>
                      </div>
                    ))}
                  </div>
                );
              })}

              {expenseCategories.length === 0 && (
                <p className="text-muted-foreground text-center py-4 text-sm">
                  No hay gastos registrados en este periodo
                </p>
              )}

              <div className="flex items-center justify-between py-3 border-t-2 mt-2 font-bold">
                <span>GASTOS TOTALES</span>
                <span className="font-mono text-red-600 dark:text-red-400" data-testid="text-gastos-totales">
                  {formatCurrency(monthlyGastos)}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className={monthlyUtilidad >= 0
          ? "border-green-500/50 bg-green-50/30 dark:bg-green-950/10"
          : "border-red-500/50 bg-red-50/30 dark:bg-red-950/10"
        }>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <DollarSign className={`h-5 w-5 ${monthlyUtilidad >= 0 ? "text-green-600" : "text-red-600"}`} />
                <span className="text-lg font-bold">UTILIDAD</span>
              </div>
              <span className={`text-2xl font-bold font-mono ${monthlyUtilidad >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`} data-testid="text-utilidad">
                {formatCurrency(monthlyUtilidad)}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              GASTOS / UTILIDAD EN %
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-0">
              {expenseGroups.map(group => {
                const groupCats = expenseCategories.filter(c => c.groupName === group.name && c.amount > 0);
                const groupTotal = groupCats.reduce((sum, c) => sum + c.amount, 0);
                const groupPercent = monthlyVentas > 0 ? (groupTotal / monthlyVentas) * 100 : 0;

                if (groupTotal === 0) return null;

                return (
                  <div key={group.id} className="py-2.5 border-b last:border-b-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-semibold">{group.name}</span>
                      <div className="flex items-center gap-3">
                        <div className="w-24 h-2 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full bg-red-500"
                            style={{ width: `${Math.min(groupPercent, 100)}%` }}
                          />
                        </div>
                        <span className="font-mono text-sm font-bold w-16 text-right">
                          {groupPercent.toFixed(2)}%
                        </span>
                      </div>
                    </div>
                    {groupCats.map((cat, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between py-1 pl-3"
                        data-testid={`row-percent-${group.id}-${idx}`}
                      >
                        <span className="text-xs">{cat.name}</span>
                        <span className="font-mono text-xs w-16 text-right text-muted-foreground">
                          {cat.percent.toFixed(2)}%
                        </span>
                      </div>
                    ))}
                  </div>
                );
              })}

              <div className="flex items-center justify-between py-3 border-t-2 mt-2">
                <span className="font-bold">TOTAL GASTOS</span>
                <div className="flex items-center gap-3">
                  <div className="w-24 h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-red-500"
                      style={{ width: `${Math.min(totalGastosPercent, 100)}%` }}
                    />
                  </div>
                  <span className="font-mono text-sm font-bold w-16 text-right text-red-600 dark:text-red-400" data-testid="text-gastos-percent">
                    {totalGastosPercent.toFixed(2)}%
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between py-3 border-t">
                <span className="font-bold">UTILIDAD</span>
                <div className="flex items-center gap-3">
                  <div className="w-24 h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className={`h-full rounded-full ${utilidadPercent >= 0 ? "bg-green-500" : "bg-red-500"}`}
                      style={{ width: `${Math.min(Math.abs(utilidadPercent), 100)}%` }}
                    />
                  </div>
                  <span className={`font-mono text-sm font-bold w-16 text-right ${utilidadPercent >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`} data-testid="text-utilidad-percent">
                    {utilidadPercent.toFixed(2)}%
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
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
          <Button variant="outline" data-testid="button-export">
            <Download className="h-4 w-4 mr-2" />
            Exportar
          </Button>
        }
      />

      <div className="flex flex-col sm:flex-row flex-wrap gap-4 items-start sm:items-center">
        <Select value={selectedYear} onValueChange={setSelectedYear}>
          <SelectTrigger className="w-32" data-testid="select-year">
            <SelectValue placeholder="Ano" />
          </SelectTrigger>
          <SelectContent>
            {years.map((year) => (
              <SelectItem key={year} value={year.toString()}>
                {year}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {viewMode === "monthly" && (
          <Select value={selectedMonth} onValueChange={setSelectedMonth}>
            <SelectTrigger className="w-44" data-testid="select-month">
              <SelectValue placeholder="Mes" />
            </SelectTrigger>
            <SelectContent>
              {fullMonths.map((m, i) => (
                <SelectItem key={i} value={(i + 1).toString()}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <Select value={selectedLocalId} onValueChange={setSelectedLocalId}>
          <SelectTrigger className="w-48" data-testid="select-local">
            <SelectValue placeholder="Local" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los locales</SelectItem>
            {locals.map((local) => (
              <SelectItem key={local.id} value={local.id.toString()}>
                {local.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
