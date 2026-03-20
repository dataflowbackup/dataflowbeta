import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency, formatNumber } from "@/lib/formatters";
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Download,
  ShoppingCart,
  ChefHat,
  Package,
  BarChart3,
  Loader2,
} from "lucide-react";
import type { Local } from "@shared/schema";

interface DashboardStats {
  weeklySales: number;
  monthlySales: number;
  yearlyStats: {
    sales: number;
    expenses: number;
    profit: number;
  };
  topProducts: Array<{ name: string; quantity: number; total: number }>;
  topCategories: Array<{ name: string; total: number }>;
  topMargins: Array<{ name: string; margin: number; marginPercentage: number }>;
  paymentMethods: Array<{ method: string; total: number; percentage: number }>;
  invoicedVsNot: { invoiced: number; notInvoiced: number };
}

export default function DashboardPage() {
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear.toString());
  const [selectedLocalId, setSelectedLocalId] = useState<string>("all");

  const { data: locals = [] } = useQuery<Local[]>({
    queryKey: ["/api/locals"],
  });

  const { data: stats, isLoading } = useQuery<DashboardStats>({
    queryKey: ["/api/dashboard/stats", selectedYear, selectedLocalId],
  });

  const years = Array.from({ length: 5 }, (_, i) => currentYear - 2 + i);

  const defaultStats: DashboardStats = {
    weeklySales: 0,
    monthlySales: 0,
    yearlyStats: { sales: 0, expenses: 0, profit: 0 },
    topProducts: [],
    topCategories: [],
    topMargins: [],
    paymentMethods: [],
    invoicedVsNot: { invoiced: 0, notInvoiced: 0 },
  };

  const data = stats || defaultStats;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Dashboard"
          description="Analisis financiero y metricas clave"
        />
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <Skeleton className="h-4 w-24" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-32" />
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-4 w-48 mt-2" />
              </CardHeader>
              <CardContent className="space-y-3">
                {Array.from({ length: 5 }).map((_, j) => (
                  <Skeleton key={j} className="h-8 w-full" />
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description="Analisis financiero y metricas clave"
        actions={
          <Button variant="outline" disabled data-testid="button-export" title="Disponible en la proxima version">
            <Download className="h-4 w-4 mr-2" />
            Exportar PDF
          </Button>
        }
      />

      <div className="flex flex-col sm:flex-row gap-4">
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

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">Ventas Semanales</CardTitle>
            <ShoppingCart className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono" data-testid="stat-weekly">
              {formatCurrency(data.weeklySales)}
            </div>
            <p className="text-xs text-muted-foreground">Ultimos 7 dias</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">Ventas Mensuales</CardTitle>
            <TrendingUp className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-green-600" data-testid="stat-monthly">
              {formatCurrency(data.monthlySales)}
            </div>
            <p className="text-xs text-muted-foreground">Mes actual</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">Ventas Anuales</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono" data-testid="stat-yearly">
              {formatCurrency(data.yearlyStats.sales)}
            </div>
            <p className="text-xs text-muted-foreground">Ano {selectedYear}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">Ganancia Anual</CardTitle>
            <TrendingUp className={`h-4 w-4 ${data.yearlyStats.profit >= 0 ? "text-green-600" : "text-red-600"}`} />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold font-mono ${data.yearlyStats.profit >= 0 ? "text-green-600" : "text-red-600"}`} data-testid="stat-profit">
              {formatCurrency(data.yearlyStats.profit)}
            </div>
            <p className="text-xs text-muted-foreground">
              Gastos: {formatCurrency(data.yearlyStats.expenses)}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ChefHat className="h-5 w-5" />
              Top 10 Productos
            </CardTitle>
            <CardDescription>Productos mas vendidos del periodo</CardDescription>
          </CardHeader>
          <CardContent>
            {data.topProducts.length > 0 ? (
              <div className="space-y-3">
                {data.topProducts.slice(0, 10).map((product, index) => (
                  <div key={index} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Badge variant="outline" className="w-6 h-6 p-0 flex items-center justify-center font-mono">
                        {index + 1}
                      </Badge>
                      <div>
                        <p className="font-medium text-sm truncate max-w-48">{product.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatNumber(product.quantity, 0)} unidades
                        </p>
                      </div>
                    </div>
                    <span className="font-mono text-sm">{formatCurrency(product.total)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">
                No hay datos de productos disponibles
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              Top 10 Categorias
            </CardTitle>
            <CardDescription>Categorias con mayores ventas</CardDescription>
          </CardHeader>
          <CardContent>
            {data.topCategories.length > 0 ? (
              <div className="space-y-3">
                {data.topCategories.slice(0, 10).map((category, index) => (
                  <div key={index} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Badge variant="outline" className="w-6 h-6 p-0 flex items-center justify-center font-mono">
                        {index + 1}
                      </Badge>
                      <p className="font-medium text-sm">{category.name}</p>
                    </div>
                    <span className="font-mono text-sm">{formatCurrency(category.total)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">
                No hay datos de categorias disponibles
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-green-600" />
              Top 10 Margenes
            </CardTitle>
            <CardDescription>Productos con mejor rentabilidad</CardDescription>
          </CardHeader>
          <CardContent>
            {data.topMargins.length > 0 ? (
              <div className="space-y-3">
                {data.topMargins.slice(0, 10).map((item, index) => (
                  <div key={index} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Badge variant="outline" className="w-6 h-6 p-0 flex items-center justify-center font-mono">
                        {index + 1}
                      </Badge>
                      <p className="font-medium text-sm truncate max-w-40">{item.name}</p>
                    </div>
                    <div className="text-right">
                      <span className="font-mono text-sm text-green-600">{formatCurrency(item.margin)}</span>
                      <p className="text-xs text-muted-foreground">{formatNumber(item.marginPercentage, 1)}%</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">
                No hay datos de margenes disponibles
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              Composicion de Pagos
            </CardTitle>
            <CardDescription>Distribucion por metodo de pago</CardDescription>
          </CardHeader>
          <CardContent>
            {data.paymentMethods.length > 0 ? (
              <div className="space-y-3">
                {data.paymentMethods.map((method, index) => (
                  <div key={index} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <p className="font-medium text-sm capitalize">{method.method}</p>
                      <span className="font-mono text-sm">{formatCurrency(method.total)}</span>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full transition-all"
                        style={{ width: `${method.percentage}%` }}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground text-right">
                      {formatNumber(method.percentage, 1)}%
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">
                No hay datos de metodos de pago disponibles
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Ventas Facturadas vs No Facturadas</CardTitle>
          <CardDescription>Proporcion de ventas con y sin factura</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="p-4 rounded-lg bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="h-5 w-5 text-green-600" />
                <span className="font-medium text-green-700 dark:text-green-400">Facturadas</span>
              </div>
              <p className="text-2xl font-bold text-green-600 font-mono">
                {formatCurrency(data.invoicedVsNot.invoiced)}
              </p>
            </div>
            <div className="p-4 rounded-lg bg-orange-50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-800">
              <div className="flex items-center gap-2 mb-2">
                <TrendingDown className="h-5 w-5 text-orange-600" />
                <span className="font-medium text-orange-700 dark:text-orange-400">No Facturadas</span>
              </div>
              <p className="text-2xl font-bold text-orange-600 font-mono">
                {formatCurrency(data.invoicedVsNot.notInvoiced)}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
