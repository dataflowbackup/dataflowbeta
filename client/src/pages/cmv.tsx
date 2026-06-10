import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DataEntryCombobox } from "@/components/data-entry-combobox";
import { DateRangePicker } from "@/components/date-range-picker";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatCurrency } from "@/lib/formatters";
import { Calculator, Save } from "lucide-react";
import type { Local } from "@shared/schema";

interface CmvSaved {
  id: number;
  periodFrom: string | null;
  periodTo: string | null;
  cmv: string | number;
  cmvPct: string | number | null;
  ventaNeta: string | number;
}

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

  const { toast } = useToast();
  const { data: saved = [] } = useQuery<CmvSaved[]>({ queryKey: ["/api/finance/cmv-calculations"] });
  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/finance/cmv-calculations", {
        stockInicialId,
        stockFinalId,
        localId: localId === "all" ? null : localId,
        dateFrom,
        dateTo,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/finance/cmv-calculations"] });
      toast({ title: "CMV guardado", description: "Quedó registrado el cálculo." });
    },
    onError: (e: Error) => toast({ title: "No se pudo guardar", description: e.message, variant: "destructive" }),
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
              <Label className="text-xs">Compras (período)</Label>
              <DateRangePicker from={dateFrom} to={dateTo} onChange={(f, t) => { setDateFrom(f); setDateTo(t); }} />
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
            <Button
              size="sm"
              onClick={() => saveMutation.mutate()}
              disabled={!data || isLoading || saveMutation.isPending}
              data-testid="button-save-cmv"
            >
              <Save className="h-4 w-4 mr-2" /> {saveMutation.isPending ? "Guardando..." : "Guardar"}
            </Button>
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

      {saved.length > 0 && (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">CMV guardados</CardTitle></CardHeader>
          <CardContent className="p-0 md:p-6">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50">
                    <th className="text-left px-3 py-2 font-medium border-b">Período</th>
                    <th className="text-right px-3 py-2 font-medium border-b">CMV</th>
                    <th className="text-right px-3 py-2 font-medium border-b">Venta sin IVA</th>
                    <th className="text-right px-3 py-2 font-medium border-b">CMV %</th>
                  </tr>
                </thead>
                <tbody>
                  {saved.map((c) => (
                    <tr key={c.id} className="border-b">
                      <td className="px-3 py-2">{c.periodFrom ?? "—"} → {c.periodTo ?? "—"}</td>
                      <td className="px-3 py-2 text-right font-mono">{formatCurrency(parseFloat(String(c.cmv)) || 0)}</td>
                      <td className="px-3 py-2 text-right font-mono text-muted-foreground">{formatCurrency(parseFloat(String(c.ventaNeta)) || 0)}</td>
                      <td className="px-3 py-2 text-right font-mono font-semibold">{c.cmvPct == null ? "—" : `${(parseFloat(String(c.cmvPct)) || 0).toFixed(2)}%`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
