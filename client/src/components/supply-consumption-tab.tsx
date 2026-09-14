import { useState } from "react";
import * as XLSX from "xlsx";
import { useQuery } from "@tanstack/react-query";
import { DataTable, Column } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { AlertCircle, Download, Link2 } from "lucide-react";
import { formatCurrency, formatDate, formatNumber } from "@/lib/formatters";
import { getDatePresets } from "@/lib/dateHelpers";
import { usePersistentFilter } from "@/hooks/usePersistentFilter";
import { useSalesSources } from "@/hooks/useSalesSources";
import { ProductRecipeMappingDialog } from "@/components/product-recipe-mapping-dialog";
import {
  SupplyMetricsFilters,
  MetricCard,
  EMPTY_SUPPLY_FILTERS,
  supplyFiltersToQuery,
  type SupplyMetricFilters,
} from "@/components/supply-metrics-filters";
import type {
  SupplyConsumptionDetailRow,
  SupplyConsumptionResult,
  SupplyConsumptionRow,
} from "@shared/supplyMetrics";
import type { Local, Supplier, Supply } from "@shared/schema";

interface Props {
  supplies: Supply[];
  locals: Local[];
  suppliers: Supplier[];
}

/**
 * El Consumo arranca acotado al mes en curso a propósito.
 *
 * Sin rango, Datalive obliga a recorrer todos los productos vendidos de la historia (más de cien
 * mil filas) en cada consulta. El usuario puede ampliar el rango cuando quiera; lo que se evita
 * es el escaneo completo por accidente al entrar a la pantalla.
 */
function defaultConsumptionFilters(): SupplyMetricFilters {
  const thisMonth = getDatePresets().find((p) => p.key === "mes")?.range();
  return { ...EMPTY_SUPPLY_FILTERS, dateFrom: thisMonth?.from ?? "", dateTo: thisMonth?.to ?? "" };
}

/**
 * Solapa Consumo: lo que SALIÓ según la receta de cada producto vendido.
 *
 * Es consumo teórico: cantidad vendida × receta. Si el producto no tiene receta mapeada no
 * consume nada, así que la cobertura se muestra siempre — sin ese dato el total engaña.
 */
export function SupplyConsumptionTab({ supplies, locals, suppliers }: Props) {
  const [filters, setFilters] = usePersistentFilter<SupplyMetricFilters>(
    "insumos.consumo",
    defaultConsumptionFilters(),
  );
  const { options: sourceOptions } = useSalesSources();
  const [source, setSource] = usePersistentFilter<string>("insumos.consumo.source", "");
  const [mappingOpen, setMappingOpen] = useState(false);

  // El origen arranca en el primer sistema habilitado de la empresa.
  const activeSource = source || sourceOptions[0]?.value || "fudo";

  const query = supplyFiltersToQuery(filters, { source: activeSource });
  const { data, isLoading } = useQuery<SupplyConsumptionResult>({
    queryKey: [`/api/supplies/consumption${query}`],
  });

  const isDetail = filters.supplyId !== "all";
  const unit = data?.rows[0]?.unit ?? null;
  const lowCoverage = data?.coveragePct != null && data.coveragePct < 95;

  const exportToExcel = () => {
    const sheet = isDetail
      ? (data?.detail ?? []).map((r) => ({
          Producto: r.producto,
          Receta: r.recipeName,
          "Unidades Vendidas": r.unitsSold,
          Insumo: r.supplyName,
          "Cantidad por Unidad": r.quantityPerUnit,
          "Cantidad Consumida": r.quantity,
          "Cantidad con Merma": r.quantityWithWaste,
          Unidad: r.unit ?? "",
          "Costo Unitario": r.unitCost,
          Importe: r.amount,
        }))
      : (data?.rows ?? []).map((r) => ({
          Insumo: r.supplyName,
          Unidad: r.unit ?? "",
          "Cantidad Consumida": r.quantity,
          "Cantidad con Merma": r.quantityWithWaste,
          "Costo Unitario": r.unitCost,
          "Importe Total": r.amount,
        }));

    const ws = XLSX.utils.json_to_sheet(sheet);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Consumo");
    const stamp = formatDate(new Date()).replace(/\//g, "-");
    XLSX.writeFile(wb, `insumos_consumo_${stamp}.xlsx`);
  };

  const rankingColumns: Column<SupplyConsumptionRow>[] = [
    { key: "supplyName", header: "Insumo", cell: (r) => <span className="font-medium">{r.supplyName}</span> },
    {
      key: "quantity",
      header: "Cantidad consumida",
      className: "text-right",
      cell: (r) => (
        <div className="text-right font-mono">
          {formatNumber(r.quantity, 2)} <span className="text-xs text-muted-foreground">{r.unit ?? ""}</span>
        </div>
      ),
    },
    {
      key: "quantityWithWaste",
      header: "Con merma",
      className: "text-right",
      cell: (r) => (
        <div className="text-right font-mono text-muted-foreground text-xs">
          {formatNumber(r.quantityWithWaste, 2)}
        </div>
      ),
    },
    {
      key: "unitCost",
      header: "Costo Unit.",
      className: "text-right",
      cell: (r) => <div className="text-right font-mono text-muted-foreground">{formatCurrency(r.unitCost)}</div>,
    },
    {
      key: "amount",
      header: "Importe",
      className: "text-right",
      cell: (r) => <div className="text-right font-mono font-medium">{formatCurrency(r.amount)}</div>,
    },
  ];

  const detailColumns: Column<SupplyConsumptionDetailRow>[] = [
    { key: "producto", header: "Producto vendido", cell: (r) => <span className="font-medium">{r.producto}</span> },
    {
      key: "recipeName",
      header: "Receta",
      cell: (r) => <span className="text-muted-foreground text-xs">{r.recipeName}</span>,
    },
    {
      key: "unitsSold",
      header: "Unidades",
      className: "text-right",
      cell: (r) => <div className="text-right font-mono">{formatNumber(r.unitsSold, 0)}</div>,
    },
    {
      key: "quantityPerUnit",
      header: "Por unidad",
      className: "text-right",
      cell: (r) => (
        <div className="text-right font-mono text-muted-foreground text-xs">
          {formatNumber(r.quantityPerUnit, 4)}
        </div>
      ),
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
      key: "amount",
      header: "Importe",
      className: "text-right",
      cell: (r) => <div className="text-right font-mono font-medium">{formatCurrency(r.amount)}</div>,
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
        supplierHint="En Consumo el proveedor acota a los insumos que le comprás a ese proveedor: el consumo sale de las recetas y no tiene proveedor propio."
      >
        <div className="w-40">
          <label className="block text-xs text-muted-foreground mb-1">Origen de ventas</label>
          <select
            className="w-full h-9 rounded-md border bg-background px-2 text-sm"
            value={activeSource}
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
      </SupplyMetricsFilters>

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label={isDetail ? "Cantidad consumida" : "Insumos consumidos"}
          value={
            isDetail
              ? `${formatNumber(data?.totalQuantity ?? 0, 2)}${unit ? ` ${unit}` : ""}`
              : String(data?.supplyCount ?? 0)
          }
          testId="card-consumo-cantidad"
        />
        <MetricCard
          label="Costo del consumo"
          value={formatCurrency(data?.totalAmount ?? 0)}
          hint="A costo vigente del insumo"
          testId="card-consumo-monto"
        />
        <MetricCard
          label="Unidades vendidas"
          value={formatNumber(data?.unitsSold ?? 0, 0)}
          hint={`${formatNumber(data?.unitsWithRecipe ?? 0, 0)} con receta`}
          testId="card-consumo-unidades"
        />
        <MetricCard
          label="Cobertura"
          value={data?.coveragePct != null ? `${data.coveragePct.toFixed(1)}%` : "-"}
          hint={lowCoverage ? "El consumo está incompleto" : "De las unidades vendidas"}
          tone={lowCoverage ? "warning" : "default"}
          testId="card-consumo-cobertura"
        />
      </div>

      {(lowCoverage || (data?.unmappedCount ?? 0) > 0) && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 space-y-2">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-500 mt-0.5 shrink-0" />
            <div className="text-sm">
              <div className="font-medium">
                {data?.unmappedCount} producto{data?.unmappedCount === 1 ? "" : "s"} sin receta
              </div>
              <div className="text-muted-foreground">
                Lo que esos productos consumen no está contado. Los de más volumen:{" "}
                {(data?.topUnmapped ?? [])
                  .slice(0, 4)
                  .map((u) => `${u.producto} (${formatNumber(u.cantidad, 0)})`)
                  .join(" · ")}
              </div>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => setMappingOpen(true)} data-testid="button-open-mapping">
            <Link2 className="h-4 w-4 mr-2" />
            Asignar recetas
          </Button>
        </div>
      )}

      {(data?.partialPeriodsExcluded ?? 0) > 0 && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm flex items-start gap-2">
          <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-500 mt-0.5 shrink-0" />
          <div>
            <span className="font-medium">{data?.partialPeriodsExcluded} período(s) de Datalive quedaron afuera.</span>{" "}
            <span className="text-muted-foreground">
              Datalive guarda los productos por período, no por día: los archivos que se solapan sólo en parte con
              las fechas elegidas no se pueden repartir sin inventar datos. Ampliá el rango para incluirlos.
            </span>
          </div>
        </div>
      )}

      {(data?.cyclicRecipeIds.length ?? 0) > 0 && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm flex items-start gap-2">
          <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
          <div>
            <span className="font-medium">
              {data?.cyclicRecipeIds.length} receta(s) se referencian entre sí.
            </span>{" "}
            <span className="text-muted-foreground">
              Esa rama se cortó para no colgar el cálculo, así que su consumo está incompleto. Recetas:{" "}
              {data?.cyclicRecipeIds.join(", ")}.
            </span>
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => setMappingOpen(true)} data-testid="button-mapping">
          <Link2 className="h-4 w-4 mr-2" />
          Recetas por producto
        </Button>
        <Button
          variant="outline"
          onClick={exportToExcel}
          disabled={((isDetail ? data?.detail.length : data?.rows.length) ?? 0) === 0}
          data-testid="button-export-consumo"
        >
          <Download className="h-4 w-4 mr-2" />
          Exportar detalle
        </Button>
      </div>

      {isDetail ? (
        <DataTable
          columns={detailColumns}
          data={data?.detail ?? []}
          isLoading={isLoading}
          searchPlaceholder="Buscar por producto o receta..."
          searchKeys={["producto", "recipeName"] as (keyof SupplyConsumptionDetailRow)[]}
          emptyMessage="Ningún producto vendido consume ese insumo con los filtros elegidos."
          tableClassName="text-sm"
        />
      ) : (
        <DataTable
          columns={rankingColumns}
          data={data?.rows ?? []}
          isLoading={isLoading}
          searchPlaceholder="Buscar insumo..."
          searchKeys={["supplyName"] as (keyof SupplyConsumptionRow)[]}
          emptyMessage="No hay consumo con los filtros elegidos."
        />
      )}

      <ProductRecipeMappingDialog
        open={mappingOpen}
        onOpenChange={setMappingOpen}
        source={activeSource}
        dateFrom={filters.dateFrom}
        dateTo={filters.dateTo}
        localId={filters.localId}
      />
    </div>
  );
}
