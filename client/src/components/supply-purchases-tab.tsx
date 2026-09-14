import { useMemo } from "react";
import * as XLSX from "xlsx";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { DataTable, Column } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Download, MinusCircle } from "lucide-react";
import { formatCurrency, formatDate, formatNumber } from "@/lib/formatters";
import { usePersistentFilter } from "@/hooks/usePersistentFilter";
import {
  SupplyMetricsFilters,
  MetricCard,
  EMPTY_SUPPLY_FILTERS,
  supplyFiltersToQuery,
  type SupplyMetricFilters,
} from "@/components/supply-metrics-filters";
import type {
  SupplyPurchaseDetailRow,
  SupplyPurchaseRow,
  SupplyPurchasesResult,
} from "@shared/supplyMetrics";
import type { Local, Supplier, Supply } from "@shared/schema";

interface Props {
  supplies: Supply[];
  locals: Local[];
  suppliers: Supplier[];
}

/**
 * Solapa Compras: lo que ENTRÓ por factura, en cantidad y en plata (neto de IVA).
 *
 * Sin insumo elegido muestra el ranking de todos; con un insumo elegido pasa al detalle
 * factura por factura.
 */
export function SupplyPurchasesTab({ supplies, locals, suppliers }: Props) {
  const [filters, setFilters] = usePersistentFilter<SupplyMetricFilters>(
    "insumos.compras",
    EMPTY_SUPPLY_FILTERS,
  );

  const query = supplyFiltersToQuery(filters);
  const { data, isLoading } = useQuery<SupplyPurchasesResult>({
    queryKey: [`/api/supplies/purchases${query}`],
  });

  const isDetail = filters.supplyId !== "all";
  const rows = isDetail ? data?.detail ?? [] : data?.rows ?? [];

  const supplyUnit = useMemo(() => {
    if (!isDetail) return null;
    return data?.rows[0]?.unit ?? null;
  }, [isDetail, data]);

  const exportToExcel = () => {
    const sheet = isDetail
      ? (data?.detail ?? []).map((r) => ({
          Fecha: r.invoiceDate ? formatDate(r.invoiceDate) : "",
          Comprobante: r.invoiceDisplay,
          Tipo: r.invoiceType,
          Proveedor: r.supplierName ?? "",
          Local: r.localName ?? "",
          Insumo: r.supplyName,
          Detalle: r.description ?? "",
          Cantidad: r.quantity,
          Unidad: r.unit ?? "",
          "Precio Unitario": r.avgUnitPrice ?? 0,
          Importe: r.amount,
        }))
      : (data?.rows ?? []).map((r) => ({
          Insumo: r.supplyName,
          Unidad: r.unit ?? "",
          "Cantidad Comprada": r.quantity,
          "Precio Unit. Promedio": r.avgUnitPrice ?? 0,
          "Importe Total": r.amount,
        }));

    const ws = XLSX.utils.json_to_sheet(sheet);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Compras");
    const stamp = formatDate(new Date()).replace(/\//g, "-");
    XLSX.writeFile(wb, `insumos_compras_${stamp}.xlsx`);
  };

  const rankingColumns: Column<SupplyPurchaseRow>[] = [
    { key: "supplyName", header: "Insumo", cell: (r) => <span className="font-medium">{r.supplyName}</span> },
    {
      key: "quantity",
      header: "Cantidad",
      className: "text-right",
      cell: (r) => (
        <div className="text-right font-mono">
          {formatNumber(r.quantity, 2)} <span className="text-xs text-muted-foreground">{r.unit ?? ""}</span>
        </div>
      ),
    },
    {
      key: "avgUnitPrice",
      header: "Precio Unit. Prom.",
      className: "text-right",
      cell: (r) => (
        <div className="text-right font-mono text-muted-foreground">
          {r.avgUnitPrice != null ? formatCurrency(r.avgUnitPrice) : "-"}
        </div>
      ),
    },
    {
      key: "amount",
      header: "Importe",
      className: "text-right",
      cell: (r) => <div className="text-right font-mono font-medium">{formatCurrency(r.amount)}</div>,
    },
  ];

  const detailColumns: Column<SupplyPurchaseDetailRow>[] = [
    { key: "invoiceDate", header: "Fecha", cell: (r) => formatDate(r.invoiceDate) },
    {
      key: "invoiceDisplay",
      header: "Comprobante",
      cell: (r) => (
        <Link href={`/facturas/${r.invoiceId}`} className="text-primary hover:underline font-mono">
          {r.invoiceDisplay}
        </Link>
      ),
    },
    {
      key: "supplierName",
      header: "Proveedor",
      cell: (r) => r.supplierName ?? <span className="text-muted-foreground">-</span>,
    },
    { key: "localName", header: "Local", cell: (r) => r.localName ?? <span className="text-muted-foreground">-</span> },
    {
      key: "description",
      header: "Detalle",
      cell: (r) => <span className="text-muted-foreground text-xs">{r.description ?? "-"}</span>,
    },
    {
      key: "quantity",
      header: "Cantidad",
      className: "text-right",
      cell: (r) => (
        <div className="text-right font-mono">
          {formatNumber(r.quantity, 2)} <span className="text-xs text-muted-foreground">{r.unit ?? ""}</span>
        </div>
      ),
    },
    {
      key: "avgUnitPrice",
      header: "Precio Unit.",
      className: "text-right",
      cell: (r) => (
        <div className="text-right font-mono text-muted-foreground">
          {r.avgUnitPrice != null ? formatCurrency(r.avgUnitPrice) : "-"}
        </div>
      ),
    },
    {
      key: "amount",
      header: "Importe",
      className: "text-right",
      cell: (r) => (
        <div className="text-right">
          <div className="font-mono font-medium">{formatCurrency(r.amount)}</div>
          {r.isCreditNote && (
            <Badge variant="secondary" className="gap-1 mt-1">
              <MinusCircle className="h-3 w-3" />
              NC
            </Badge>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <SupplyMetricsFilters
        filters={filters}
        onChange={setFilters}
        supplies={supplies}
        locals={locals}
        suppliers={suppliers}
      />

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label={isDetail ? "Cantidad comprada" : "Insumos con compras"}
          value={
            isDetail
              ? `${formatNumber(data?.totalQuantity ?? 0, 2)}${supplyUnit ? ` ${supplyUnit}` : ""}`
              : String(data?.supplyCount ?? 0)
          }
          testId="card-compras-cantidad"
        />
        <MetricCard
          label="Costo de compra"
          value={formatCurrency(data?.totalAmount ?? 0)}
          hint="Neto de IVA"
          testId="card-compras-monto"
        />
        <MetricCard
          label="Precio unitario promedio"
          value={
            data && data.totalQuantity !== 0
              ? formatCurrency(data.totalAmount / data.totalQuantity)
              : "-"
          }
          hint={isDetail ? "Ponderado por cantidad" : "Sólo con un insumo elegido tiene sentido"}
          tone={isDetail ? "default" : "muted"}
          testId="card-compras-precio"
        />
        <MetricCard
          label="Facturas"
          value={String(data?.invoiceCount ?? 0)}
          hint="Anuladas afuera · NC restan"
          testId="card-compras-facturas"
        />
      </div>

      <div className="flex justify-end">
        <Button variant="outline" onClick={exportToExcel} disabled={rows.length === 0} data-testid="button-export-compras">
          <Download className="h-4 w-4 mr-2" />
          Exportar detalle
        </Button>
      </div>

      {isDetail ? (
        <DataTable
          columns={detailColumns}
          data={data?.detail ?? []}
          isLoading={isLoading}
          searchPlaceholder="Buscar por comprobante, proveedor o detalle..."
          searchKeys={["invoiceDisplay", "supplierName", "description"] as (keyof SupplyPurchaseDetailRow)[]}
          emptyMessage="No hay compras de ese insumo con los filtros elegidos."
          tableClassName="text-sm"
        />
      ) : (
        <DataTable
          columns={rankingColumns}
          data={data?.rows ?? []}
          isLoading={isLoading}
          searchPlaceholder="Buscar insumo..."
          searchKeys={["supplyName"] as (keyof SupplyPurchaseRow)[]}
          emptyMessage="No hay compras con los filtros elegidos."
        />
      )}
    </div>
  );
}
