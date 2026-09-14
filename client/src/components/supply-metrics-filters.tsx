import { DataEntryCombobox } from "@/components/data-entry-combobox";
import { DateRangePicker } from "@/components/date-range-picker";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import type { Local, Supplier, Supply } from "@shared/schema";

export interface SupplyMetricFilters {
  supplyId: string;
  localId: string;
  supplierId: string;
  dateFrom: string;
  dateTo: string;
}

export const EMPTY_SUPPLY_FILTERS: SupplyMetricFilters = {
  supplyId: "all",
  localId: "all",
  supplierId: "all",
  dateFrom: "",
  dateTo: "",
};

/** Convierte los filtros de pantalla en query string; "all" y vacío no viajan. */
export function supplyFiltersToQuery(f: SupplyMetricFilters, extra?: Record<string, string>): string {
  const params = new URLSearchParams();
  if (f.supplyId !== "all") params.set("supplyId", f.supplyId);
  if (f.localId !== "all") params.set("localId", f.localId);
  if (f.supplierId !== "all") params.set("supplierId", f.supplierId);
  if (f.dateFrom) params.set("dateFrom", f.dateFrom);
  if (f.dateTo) params.set("dateTo", f.dateTo);
  for (const [k, v] of Object.entries(extra ?? {})) params.set(k, v);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function hasAnySupplyFilter(f: SupplyMetricFilters): boolean {
  return (
    f.supplyId !== "all" || f.localId !== "all" || f.supplierId !== "all" || Boolean(f.dateFrom) || Boolean(f.dateTo)
  );
}

interface Props {
  filters: SupplyMetricFilters;
  onChange: (next: SupplyMetricFilters) => void;
  supplies: Supply[];
  locals: Local[];
  suppliers: Supplier[];
  /** En Consumo el proveedor acota el universo de insumos, no el consumo en sí. */
  supplierHint?: string;
  /** Selector extra a la derecha (el origen de ventas en la solapa Consumo). */
  children?: React.ReactNode;
}

/** Barra de filtros compartida por Compras y Consumo, para que las dos solapas se lean igual. */
export function SupplyMetricsFilters({
  filters,
  onChange,
  supplies,
  locals,
  suppliers,
  supplierHint,
  children,
}: Props) {
  const set = (patch: Partial<SupplyMetricFilters>) => onChange({ ...filters, ...patch });

  const supplyOptions = [
    { value: "all", label: "Todos los insumos" },
    ...supplies
      .filter((s) => s.active !== false)
      .map((s) => ({ value: String(s.id), label: s.name })),
  ];

  return (
    <div className="flex flex-wrap gap-3 items-end">
      <div className="w-64">
        <label className="block text-xs text-muted-foreground mb-1">Insumo</label>
        <DataEntryCombobox
          options={supplyOptions}
          value={filters.supplyId}
          onValueChange={(v) => set({ supplyId: v || "all" })}
          placeholder="Todos los insumos"
          searchPlaceholder="Buscar insumo…"
          data-testid="filter-supply"
        />
      </div>

      <div className="w-40">
        <label className="block text-xs text-muted-foreground mb-1">Local</label>
        <select
          className="w-full h-9 rounded-md border bg-background px-2 text-sm"
          value={filters.localId}
          onChange={(e) => set({ localId: e.target.value })}
          data-testid="filter-local"
        >
          <option value="all">Todos</option>
          {locals.map((l) => (
            <option key={l.id} value={String(l.id)}>
              {l.name}
            </option>
          ))}
        </select>
      </div>

      <div className="w-56">
        <label className="block text-xs text-muted-foreground mb-1" title={supplierHint}>
          Proveedor
        </label>
        <DataEntryCombobox
          options={[
            { value: "all", label: "Todos los proveedores" },
            ...suppliers
              .filter((s) => s.active !== false)
              .map((s) => ({ value: String(s.id), label: s.tradeName })),
          ]}
          value={filters.supplierId}
          onValueChange={(v) => set({ supplierId: v || "all" })}
          placeholder="Todos los proveedores"
          searchPlaceholder="Buscar proveedor…"
          data-testid="filter-supplier"
        />
      </div>

      <div>
        <label className="block text-xs text-muted-foreground mb-1">Fecha</label>
        <DateRangePicker
          from={filters.dateFrom}
          to={filters.dateTo}
          onChange={(from, to) => set({ dateFrom: from, dateTo: to })}
          placeholder="Todo el período"
        />
      </div>

      {children}

      {hasAnySupplyFilter(filters) && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onChange({ ...EMPTY_SUPPLY_FILTERS })}
          data-testid="button-clear-supply-filters"
        >
          <X className="h-4 w-4 mr-1" />
          Limpiar
        </Button>
      )}
    </div>
  );
}

/** Tarjeta de resumen, con el mismo aire que las de Facturas. */
export function MetricCard({
  label,
  value,
  hint,
  tone = "default",
  testId,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "muted" | "warning";
  testId?: string;
}) {
  const valueClass =
    tone === "warning" ? "text-amber-600 dark:text-amber-500" : tone === "muted" ? "text-muted-foreground" : "";
  return (
    <div className="rounded-lg border bg-card p-4" data-testid={testId}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-2xl font-semibold font-mono mt-1 ${valueClass}`}>{value}</div>
      {hint && <div className="text-xs text-muted-foreground mt-1">{hint}</div>}
    </div>
  );
}
