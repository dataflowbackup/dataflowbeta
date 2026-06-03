import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DataEntryCombobox } from "@/components/data-entry-combobox";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency } from "@/lib/formatters";
import { Calculator } from "lucide-react";
import type { Local } from "@shared/schema";

interface ValuationRow {
  id: number;
  localId: number | null;
  valuationDate: string;
  totalValued: string | number;
  status: string;
}
interface CmvResult {
  stockInicial: number;
  stockInicialDate: string;
  stockFinal: number;
  stockFinalDate: string;
  compras: number;
  cmv: number;
  salesGross: number;
  ventaNeta: number;
  cmvPct: number | null;
}

function firstDayOfYear(): string {
  return `${new Date().getFullYear()}-01-01`;
}
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function CmvPage() {
  const [localId, setLocalId] = useState("all");
  const [stockInicialId, setStockInicialId] = useState("");
  const [stockFinalId, setStockFinalId] = useState("");
  const [dateFrom, setDateFrom] = useState(firstDayOfYear());
  const [dateTo, setDateTo] = useState(today());

  const { data: locals = [] } = useQuery<Local[]>({ queryKey: ["/api/locals"] });
  const { data: valuations = [] } = useQuery<ValuationRow[]>({ queryKey: ["/api/finance/stock-valuations"] });

  const localOptions = useMemo(
    () => [{ value: "all", label: "Todos los locales" }, ...locals.map((l) => ({ value: String(l.id), label: l.name }))],
    [locals],
  );
  const valuationOptions = useMemo(
    () =>
      valuations
        .filter((v) => v.status === "active")
        .map((v) => ({
          value: String(v.id),
          label: `${v.valuationDate} — ${formatCurrency(parseFloat(String(v.totalValued)) || 0)}`,
        })),
    [valuations],
  );

  const ready = stockInicialId && stockFinalId;
  const { data, isLoading, isError, error } = useQuery<CmvResult>({
    queryKey: ["/api/finance/cmv", stockInicialId, stockFinalId, localId, dateFrom, dateTo],
    enabled: !!ready,
    queryFn: async () => {
      const p = new URLSearchParams();
      p.set("stockInicialId", stockInicialId);
      p.set("stockFinalId", stockFinalId);
      if (localId !== "all") p.set("localId", localId);
      if (dateFrom) p.set("dateFrom", dateFrom);
      if (dateTo) p.set("dateTo", dateTo);
      const res = await fetch(`/api/finance/cmv?${p.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.message || "Error al calcular CMV");
      return res.json();
    },
  });

  const Line = ({ label, value, op, strong }: { label: string; value: number; op?: string; strong?: boolean }) => (
    <div className={`grid grid-cols-[auto_1fr_auto] items-center gap-2 ${strong ? "border-t pt-2 font-bold" : ""}`}>
      <span className="w-6 text-center font-mono text-muted-foreground">{op ?? ""}</span>
      <span className={strong ? "" : "text-muted-foreground"}>{label}</span>
      <span className="font-mono text-right">{formatCurrency(value)}</span>
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="CMV — Costo de Mercadería Vendida"
        description="Stock inicial + compras − stock final, cruzado con la venta sin IVA"
      />

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Parámetros</CardTitle></CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-1">
              <Label className="text-xs">Local</Label>
              <DataEntryCombobox options={localOptions} value={localId} onValueChange={setLocalId} placeholder="Local" searchPlaceholder="Buscar…" data-testid="select-local" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Stock inicial (valorización)</Label>
              <DataEntryCombobox options={valuationOptions} value={stockInicialId} onValueChange={setStockInicialId} placeholder="Elegí una valorización" searchPlaceholder="Buscar fecha…" data-testid="select-stock-inicial" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Stock final (valorización)</Label>
              <DataEntryCombobox options={valuationOptions} value={stockFinalId} onValueChange={setStockFinalId} placeholder="Elegí una valorización" searchPlaceholder="Buscar fecha…" data-testid="select-stock-final" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Compras desde</Label>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} data-testid="input-date-from" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Compras hasta</Label>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} data-testid="input-date-to" />
            </div>
          </div>
          {valuationOptions.length === 0 && (
            <p className="mt-3 text-sm text-muted-foreground">
              No hay valorizaciones de stock activas. Cargá al menos dos en "Valorizar Stock" para calcular el CMV.
            </p>
          )}
        </CardContent>
      </Card>

      {ready && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="text-base flex items-center gap-2"><Calculator className="h-4 w-4" /> Resultado</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-2">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-6 w-full" />)}</div>
            ) : isError ? (
              <p className="text-sm text-destructive">{(error as Error)?.message}</p>
            ) : data ? (
              <div className="space-y-2 max-w-md">
                <Line label={`Stock inicial (${data.stockInicialDate})`} value={data.stockInicial} op="" />
                <Line label="Compras del período (CMC, sin IVA)" value={data.compras} op="+" />
                <Line label={`Stock final (${data.stockFinalDate})`} value={data.stockFinal} op="−" />
                <Line label="CMV" value={data.cmv} strong />
                <div className="grid grid-cols-[auto_1fr_auto] items-center gap-2 pt-3 border-t">
                  <span className="w-6" />
                  <span className="text-muted-foreground">Venta sin IVA (÷1,21)</span>
                  <span className="font-mono text-right text-muted-foreground">{formatCurrency(data.ventaNeta)}</span>
                </div>
                <div className="grid grid-cols-[auto_1fr_auto] items-center gap-2 font-bold">
                  <span className="w-6" />
                  <span>CMV %</span>
                  <span className="font-mono text-right" data-testid="text-cmv-pct">{data.cmvPct == null ? "—" : `${data.cmvPct.toFixed(2)}%`}</span>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
