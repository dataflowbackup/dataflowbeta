import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DataEntryCombobox } from "@/components/data-entry-combobox";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency } from "@/lib/formatters";
import { ChevronRight, ChevronDown, ShoppingCart, Percent, DollarSign } from "lucide-react";
import type { Local } from "@shared/schema";

interface CmcSubRubro {
  id: number | null;
  name: string;
  total: number;
  pct: number | null;
}
interface CmcRubro extends CmcSubRubro {
  subRubros: CmcSubRubro[];
}
interface CmcReport {
  total: number;
  salesGross: number;
  salesNet: number;
  pct: number | null;
  rubros: CmcRubro[];
}

function firstDayOfMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function CmcPage() {
  const [dateFrom, setDateFrom] = useState(firstDayOfMonth());
  const [dateTo, setDateTo] = useState(today());
  const [localId, setLocalId] = useState("all");
  const [mode, setMode] = useState<"amount" | "percent">("amount");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const { data: locals = [] } = useQuery<Local[]>({ queryKey: ["/api/locals"] });

  const localOptions = useMemo(
    () => [{ value: "all", label: "Todos los locales" }, ...locals.map((l) => ({ value: String(l.id), label: l.name }))],
    [locals],
  );

  const url = useMemo(() => {
    const p = new URLSearchParams();
    if (dateFrom) p.set("dateFrom", dateFrom);
    if (dateTo) p.set("dateTo", dateTo);
    if (localId !== "all") p.set("localIds", localId);
    return `/api/finance/cmc?${p.toString()}`;
  }, [dateFrom, dateTo, localId]);

  const { data, isLoading } = useQuery<CmcReport>({
    queryKey: ["/api/finance/cmc", dateFrom, dateTo, localId],
    queryFn: async () => {
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Error al cargar CMC");
      return res.json();
    },
  });

  const showPct = mode === "percent";
  const fmt = (amount: number, pct: number | null) =>
    showPct ? (pct == null ? "—" : `${pct.toFixed(2)}%`) : formatCurrency(amount);

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  return (
    <div className="space-y-6">
      <PageHeader
        title="CMC — Costo de Mercadería Comprada"
        description="Costo de insumos adquiridos (sin IVA), por rubro y sub-rubro"
      />

      <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="space-y-1">
          <Label className="text-xs">Desde</Label>
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40" data-testid="input-date-from" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Hasta</Label>
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-40" data-testid="input-date-to" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Local</Label>
          <DataEntryCombobox
            options={localOptions}
            value={localId}
            onValueChange={setLocalId}
            placeholder="Local"
            searchPlaceholder="Buscar local…"
            triggerClassName="w-48"
            data-testid="select-local"
          />
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
            <CardTitle className="text-sm font-medium">CMC Total (sin IVA)</CardTitle>
            <ShoppingCart className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono" data-testid="stat-cmc-total">
              {isLoading ? <Skeleton className="h-8 w-32" /> : formatCurrency(data?.total ?? 0)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Venta sin IVA (÷1,21)</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-muted-foreground">
              {isLoading ? <Skeleton className="h-8 w-32" /> : formatCurrency(data?.salesNet ?? 0)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">CMC %</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono" data-testid="stat-cmc-pct">
              {isLoading ? <Skeleton className="h-8 w-20" /> : data?.pct == null ? "—" : `${data.pct.toFixed(2)}%`}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3"><CardTitle>Desglose por Rubro</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : !data || data.rubros.length === 0 ? (
            <p className="py-6 text-center text-muted-foreground">
              No hay compras en el período seleccionado.
            </p>
          ) : (
            <div className="space-y-1">
              {data.rubros.map((r) => {
                const key = `r-${r.id ?? "x"}-${r.name}`;
                const open = expanded.has(key);
                return (
                  <div key={key} className="space-y-1">
                    <div className="grid grid-cols-[1fr_auto] items-center gap-2 border-b py-1.5 text-sm font-semibold">
                      <button type="button" className="inline-flex items-center gap-1 text-left" onClick={() => toggle(key)}>
                        {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                        <span>{r.name}</span>
                      </button>
                      <span className="font-mono text-right">{fmt(r.total, r.pct)}</span>
                    </div>
                    {open &&
                      r.subRubros.map((s, i) => (
                        <div key={`${key}-s${s.id ?? i}`} className="grid grid-cols-[1fr_auto] gap-2 text-sm">
                          <span className="pl-6 text-muted-foreground">{s.name}</span>
                          <span className="font-mono text-right text-muted-foreground">{fmt(s.total, s.pct)}</span>
                        </div>
                      ))}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
