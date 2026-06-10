import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DataEntryCombobox } from "@/components/data-entry-combobox";
import { DateRangePicker } from "@/components/date-range-picker";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency } from "@/lib/formatters";
import { Truck, HandCoins, DollarSign, Percent } from "lucide-react";
import type { Local, Supplier } from "@shared/schema";

interface PapBySupplier {
  supplierId: number | null;
  name: string;
  entregado: number;
  pagado: number;
  saldo: number;
}
interface PapReport {
  totalEntregado: number;
  totalPagado: number;
  salesWithIva: number;
  pctEntregado: number | null;
  pctPagado: number | null;
  bySupplier: PapBySupplier[];
}

function firstDayOfMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function PapPage() {
  const [dateFrom, setDateFrom] = useState(firstDayOfMonth());
  const [dateTo, setDateTo] = useState(today());
  const [localId, setLocalId] = useState("all");
  const [supplierId, setSupplierId] = useState("all");
  const [mode, setMode] = useState<"amount" | "percent">("amount");
  const [salesSource, setSalesSource] = useState("extractos");

  const { data: locals = [] } = useQuery<Local[]>({ queryKey: ["/api/locals"] });
  const { data: suppliers = [] } = useQuery<Supplier[]>({ queryKey: ["/api/suppliers"] });

  const localOptions = useMemo(
    () => [{ value: "all", label: "Todos los locales" }, ...locals.map((l) => ({ value: String(l.id), label: l.name }))],
    [locals],
  );
  const supplierOptions = useMemo(
    () => [{ value: "all", label: "Todos los proveedores" }, ...suppliers.map((s) => ({ value: String(s.id), label: s.tradeName }))],
    [suppliers],
  );
  const sourceOptions = [
    { value: "extractos", label: "Extractos" },
    { value: "datalive", label: "Datalive" },
  ];

  const { data, isLoading } = useQuery<PapReport>({
    queryKey: ["/api/finance/pap", dateFrom, dateTo, localId, supplierId, salesSource],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (dateFrom) p.set("dateFrom", dateFrom);
      if (dateTo) p.set("dateTo", dateTo);
      if (localId !== "all") p.set("localIds", localId);
      if (supplierId !== "all") p.set("supplierIds", supplierId);
      p.set("salesSource", salesSource);
      const res = await fetch(`/api/finance/pap?${p.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Error al cargar PAP");
      return res.json();
    },
  });

  const showPct = mode === "percent";
  const cardValue = (amount: number, pct: number | null) =>
    showPct ? (pct == null ? "—" : `${pct.toFixed(2)}%`) : formatCurrency(amount);

  return (
    <div className="space-y-6">
      <PageHeader
        title="PAP — Pago a Proveedores"
        description="Importe entregado (facturas con IVA) vs. pagado, por proveedor"
      />

      <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="space-y-1">
          <Label className="text-xs">Período</Label>
          <DateRangePicker from={dateFrom} to={dateTo} onChange={(f, t) => { setDateFrom(f); setDateTo(t); }} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Local</Label>
          <DataEntryCombobox options={localOptions} value={localId} onValueChange={setLocalId} placeholder="Local" searchPlaceholder="Buscar local…" triggerClassName="w-48" data-testid="select-local" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Proveedor</Label>
          <DataEntryCombobox options={supplierOptions} value={supplierId} onValueChange={setSupplierId} placeholder="Proveedor" searchPlaceholder="Buscar proveedor…" triggerClassName="w-56" data-testid="select-supplier" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Venta (para %)</Label>
          <DataEntryCombobox options={sourceOptions} value={salesSource} onValueChange={setSalesSource} placeholder="Fuente" searchPlaceholder="Fuente…" triggerClassName="w-40" data-testid="select-sales-source" />
        </div>
        <div className="flex gap-1 rounded-md border p-1">
          <Button size="sm" variant={mode === "amount" ? "default" : "ghost"} onClick={() => setMode("amount")} data-testid="toggle-amount">
            <DollarSign className="h-4 w-4 mr-1" /> $
          </Button>
          <Button size="sm" variant={mode === "percent" ? "default" : "ghost"} onClick={() => setMode("percent")} data-testid="toggle-percent">
            <Percent className="h-4 w-4 mr-1" /> %
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Entregado (c/IVA)</CardTitle>
            <Truck className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono" data-testid="stat-entregado">
              {isLoading ? <Skeleton className="h-8 w-32" /> : cardValue(data?.totalEntregado ?? 0, data?.pctEntregado ?? null)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Pagado</CardTitle>
            <HandCoins className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono" data-testid="stat-pagado">
              {isLoading ? <Skeleton className="h-8 w-32" /> : cardValue(data?.totalPagado ?? 0, data?.pctPagado ?? null)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Venta c/IVA</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-muted-foreground">
              {isLoading ? <Skeleton className="h-8 w-32" /> : formatCurrency(data?.salesWithIva ?? 0)}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3"><CardTitle>Por Proveedor</CardTitle></CardHeader>
        <CardContent className="p-0 md:p-6">
          {isLoading ? (
            <div className="space-y-2 p-4">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : !data || data.bySupplier.length === 0 ? (
            <p className="py-6 text-center text-muted-foreground">No hay facturas ni pagos en el período seleccionado.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-muted/50">
                    <th className="text-left px-3 py-2 font-medium border-b">Proveedor</th>
                    <th className="text-right px-3 py-2 font-medium border-b">Entregado</th>
                    <th className="text-right px-3 py-2 font-medium border-b">Pagado</th>
                    <th className="text-right px-3 py-2 font-medium border-b">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {data.bySupplier.map((s, i) => (
                    <tr key={`${s.supplierId ?? "x"}-${i}`} className="border-b">
                      <td className="px-3 py-2">{s.name}</td>
                      <td className="text-right px-3 py-2 font-mono">{formatCurrency(s.entregado)}</td>
                      <td className="text-right px-3 py-2 font-mono">{formatCurrency(s.pagado)}</td>
                      <td className={`text-right px-3 py-2 font-mono ${s.saldo > 0 ? "text-red-600 dark:text-red-400" : ""}`}>{formatCurrency(s.saldo)}</td>
                    </tr>
                  ))}
                  <tr className="bg-muted/50 font-bold">
                    <td className="px-3 py-2 border-t-2">TOTAL</td>
                    <td className="text-right px-3 py-2 font-mono border-t-2">{formatCurrency(data.totalEntregado)}</td>
                    <td className="text-right px-3 py-2 font-mono border-t-2">{formatCurrency(data.totalPagado)}</td>
                    <td className="text-right px-3 py-2 font-mono border-t-2">{formatCurrency(data.totalEntregado - data.totalPagado)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
