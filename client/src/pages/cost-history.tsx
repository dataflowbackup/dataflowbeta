import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { DataTable, Column } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatDate, formatNumber } from "@/lib/formatters";
import { History, TrendingUp, TrendingDown, Package } from "lucide-react";
import type { CostHistory, Supply, Invoice } from "@shared/schema";

interface CostHistoryWithRelations extends CostHistory {
  supply?: Supply | null;
  invoice?: Invoice | null;
}

export default function CostHistoryPage() {
  const { data: history = [], isLoading } = useQuery<CostHistoryWithRelations[]>({
    queryKey: ["/api/cost-history"],
  });

  const recentChanges = history.slice(0, 10);
  const priceIncreases = history.filter((h, i, arr) => {
    if (i === arr.length - 1) return false;
    const prev = arr.find(a => a.supplyId === h.supplyId && new Date(a.recordedAt!) < new Date(h.recordedAt!));
    if (!prev) return false;
    return parseFloat(String(h.unitCost)) > parseFloat(String(prev.unitCost));
  }).length;

  const columns: Column<CostHistoryWithRelations>[] = [
    {
      key: "recordedAt",
      header: "Fecha",
      cell: (row) => (
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
            <History className="h-4 w-4 text-primary" />
          </div>
          <span>{formatDate(row.recordedAt)}</span>
        </div>
      ),
    },
    {
      key: "supply",
      header: "Insumo",
      cell: (row) => (
        <div className="flex items-center gap-2">
          <Package className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">{row.supply?.name || "-"}</span>
        </div>
      ),
    },
    {
      key: "quantity",
      header: "Cantidad",
      cell: (row) => (
        <span className="font-mono text-sm">
          {formatNumber(parseFloat(String(row.quantity) || "0"), 2)}
        </span>
      ),
    },
    {
      key: "unitCost",
      header: "Costo Unitario",
      cell: (row) => (
        <span className="font-mono text-sm font-medium">
          {formatCurrency(row.unitCost)}
        </span>
      ),
    },
    {
      key: "totalCost",
      header: "Costo Total",
      cell: (row) => (
        <span className="font-mono text-sm">
          {formatCurrency(row.totalCost)}
        </span>
      ),
    },
    {
      key: "invoice",
      header: "Factura",
      cell: (row) =>
        row.invoice ? (
          <Badge variant="secondary" className="font-mono">
            {row.invoice.invoiceNumber}
          </Badge>
        ) : (
          <span className="text-muted-foreground">-</span>
        ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Historial de Costos"
        description="Seguimiento de cambios en los precios de insumos"
      />

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">Total Registros</CardTitle>
            <History className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono" data-testid="stat-total">
              {history.length}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">Cambios Recientes</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono" data-testid="stat-recent">
              {recentChanges.length}
            </div>
            <p className="text-xs text-muted-foreground">Ultimos 10 registros</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">Aumentos</CardTitle>
            <TrendingUp className="h-4 w-4 text-red-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-red-600" data-testid="stat-increases">
              {priceIncreases}
            </div>
            <p className="text-xs text-muted-foreground">Precios que subieron</p>
          </CardContent>
        </Card>
      </div>

      <DataTable
        columns={columns}
        data={history}
        isLoading={isLoading}
        searchPlaceholder="Buscar por insumo..."
        searchKeys={[]}
        emptyMessage="No hay historial de costos. El historial se genera automaticamente al cargar facturas con insumos."
        pageSize={20}
      />
    </div>
  );
}
