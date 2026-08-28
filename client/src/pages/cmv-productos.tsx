/**
 * CMV Productos — Costo de Mercadería Vendida TEÓRICO, por producto vendido.
 *
 * El CMV clásico (`/cmv`) sale de stock inicial + compras − stock final: es lo que REALMENTE se
 * consumió. Acá se llega al mismo número por el otro camino: Σ (cantidad vendida × costo unitario),
 * usando los productos que ya se importan de FUDO/Datalive/Shares. El desvío entre los dos es la
 * merma, el desperdicio y el faltante que el costeo teórico no explica.
 *
 * Los reportes de productos vendidos traen SOLO cantidades (ningún archivo trae el $ por producto),
 * así que el costo lo pone este módulo: receta mapeada (se actualiza sola) u override manual.
 */
import { useMemo, useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useSalesSources } from "@/hooks/useSalesSources";
import { usePersistentFilter } from "@/hooks/usePersistentFilter";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { DataEntryCombobox } from "@/components/data-entry-combobox";
import { DateRangePicker } from "@/components/date-range-picker";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatCurrency, formatEsArAmountInput, parseEsArAmount } from "@/lib/formatters";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Calculator,
  Save,
  Pencil,
  X,
  Trash2,
  DollarSign,
  AlertTriangle,
  Search,
  ListTree,
  ChefHat,
} from "lucide-react";
import type { Local } from "@shared/schema";

type ProductSource = "fudo" | "datalive" | "shares";

interface CmvProductoLine {
  producto: string;
  categoria: string | null;
  cantidad: number;
  costoUnitario: number | null;
  costoTotal: number;
  precioUnitario: number | null;
  ventaTeorica: number;
  costMode: "receta" | "manual" | null;
  recipeId: number | null;
  recipeName: string | null;
}

interface CmvProductoResult {
  source: ProductSource;
  periodFrom: string | null;
  periodTo: string | null;
  ivaIncluded: boolean;
  lines: CmvProductoLine[];
  unidades: number;
  unidadesConCosto: number;
  coberturaPct: number | null;
  cmvTeorico: number;
  salesGross: number;
  ventaReal: number;
  ventaTeorica: number;
  cmvPct: number | null;
  cmvPctTeorico: number | null;
}

interface CmvProductoSaved {
  id: number;
  localId: number | null;
  source: string;
  periodFrom: string | null;
  periodTo: string | null;
  unidades: number | null;
  unidadesConCosto: number | null;
  coberturaPct: string | number | null;
  cmvTeorico: string | number | null;
  ventaReal: string | number | null;
  ventaTeorica: string | number | null;
  cmvPct: string | number | null;
  cmvPctTeorico: string | number | null;
  ivaIncluded: boolean | null;
}

interface SavedLineRow {
  id: number;
  producto: string;
  categoria: string | null;
  cantidad: number;
  costoUnitario: string | number | null;
  costoTotal: string | number | null;
  precioUnitario: string | number | null;
  ventaTeorica: string | number | null;
  costMode: string | null;
  recipeName: string | null;
}

/** Fila del CMV clásico (stock inicial + compras − stock final) para cruzar teórico vs real. */
interface CmvRealRow {
  id: number;
  localId: number | null;
  periodFrom: string | null;
  periodTo: string | null;
  cmv: string | number;
  cmvPct: string | number | null;
  ventaNeta: string | number;
}

interface RecipeRow {
  id: number;
  name: string;
  totalCost: string | number | null;
  active?: boolean | null;
}

function firstDayOfMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function num(v: string | number | null | undefined): number {
  return parseFloat(String(v ?? "0")) || 0;
}

const DAY_MS = 86400000;
function dayMs(v: string | null | undefined): number {
  return v ? Date.parse(`${String(v).slice(0, 10)}T00:00:00Z`) : NaN;
}

/**
 * El CMV real del mismo local y período. Se aceptan hasta 3 días de desvío en cada extremo, igual
 * criterio que el balance: "1 al 30" y "1 al 1 del mes siguiente" son el mismo mes.
 */
function findCmvReal(list: CmvRealRow[], localId: number | null, from: string, to: string): CmvRealRow | null {
  const fromMs = dayMs(from);
  const toMs = dayMs(to);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return null;
  let best: { row: CmvRealRow; score: number } | null = null;
  for (const r of list) {
    if ((r.localId ?? null) !== localId) continue;
    const rf = dayMs(r.periodFrom);
    const rt = dayMs(r.periodTo);
    if (!Number.isFinite(rf) || !Number.isFinite(rt)) continue;
    const dFrom = Math.abs(Math.round((rf - fromMs) / DAY_MS));
    const dTo = Math.abs(Math.round((rt - toMs) / DAY_MS));
    if (dFrom > 3 || dTo > 3) continue;
    const score = dFrom + dTo;
    if (!best || score < best.score || (score === best.score && r.id > best.row.id)) best = { row: r, score };
  }
  return best?.row ?? null;
}

const SOURCE_LABELS: Record<string, string> = { fudo: "FUDO", datalive: "Datalive", shares: "Shares" };

// ─── Tarjeta de indicador ─────────────────────────────────────────────────────

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "warn" | "good";
}) {
  const toneClass =
    tone === "warn"
      ? "text-amber-700 dark:text-amber-500"
      : tone === "good"
        ? "text-emerald-700 dark:text-emerald-500"
        : "";
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-xl font-bold font-mono ${toneClass}`}>{value}</p>
      {hint && <p className="text-[11px] text-muted-foreground pt-0.5">{hint}</p>}
    </div>
  );
}

// ─── Página ───────────────────────────────────────────────────────────────────

export default function CmvProductosPage() {
  const { toast } = useToast();
  const { isEnabled: isSourceEnabled } = useSalesSources();

  const [localId, setLocalId] = usePersistentFilter("cmvProd.localId", "all");
  const [source, setSource] = usePersistentFilter<ProductSource>("cmvProd.source", "fudo");
  const [dateFrom, setDateFrom] = usePersistentFilter("cmvProd.dateFrom", firstDayOfMonth());
  const [dateTo, setDateTo] = usePersistentFilter("cmvProd.dateTo", today());
  const [ivaIncluded, setIvaIncluded] = usePersistentFilter("cmvProd.ivaIncluded", false);
  const [editingId, setEditingId] = useState<number | null>(null);

  // Filtros de la tabla de productos
  const [search, setSearch] = usePersistentFilter("cmvProd.search", "");
  const [costFilter, setCostFilter] = usePersistentFilter<"all" | "sin" | "con">("cmvProd.costFilter", "all");

  const [costTarget, setCostTarget] = useState<CmvProductoLine | null>(null);
  const [costMode, setCostMode] = useState<"receta" | "manual">("receta");
  const [costRecipeId, setCostRecipeId] = useState("");
  const [costManual, setCostManual] = useState("");

  const [detailTarget, setDetailTarget] = useState<CmvProductoSaved | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CmvProductoSaved | null>(null);
  const [deleteCode, setDeleteCode] = useState("");

  const { data: locals = [] } = useQuery<Local[]>({ queryKey: ["/api/locals"] });
  const { data: recipes = [] } = useQuery<RecipeRow[]>({ queryKey: ["/api/recipes"] });
  const { data: saved = [] } = useQuery<CmvProductoSaved[]>({ queryKey: ["/api/finance/cmv-producto-calculations"] });
  const { data: cmvReales = [] } = useQuery<CmvRealRow[]>({ queryKey: ["/api/finance/cmv-calculations"] });

  const localOptions = useMemo(
    () => [{ value: "all", label: "Todos los locales" }, ...locals.map((l) => ({ value: String(l.id), label: l.name }))],
    [locals],
  );
  const localMap = useMemo(() => new Map(locals.map((l) => [l.id, l.name])), [locals]);

  // Las fuentes que la empresa apagó en Preferencias no se ofrecen (punto 6, ago-26).
  const sourceOptions = useMemo(
    () => (["fudo", "datalive", "shares"] as ProductSource[])
      .filter((s) => isSourceEnabled(s))
      .map((s) => ({ value: s, label: SOURCE_LABELS[s] })),
    [isSourceEnabled],
  );
  const allowedSources = sourceOptions.map((o) => o.value).join(",");
  useEffect(() => {
    const allowed = allowedSources ? allowedSources.split(",") : [];
    if (allowed.length > 0 && !allowed.includes(source)) setSource(allowed[0] as ProductSource);
  }, [allowedSources, source, setSource]);

  const ready = !!(dateFrom && dateTo);
  const { data, isLoading, isError, error } = useQuery<CmvProductoResult>({
    queryKey: ["/api/finance/cmv-productos", localId, source, dateFrom, dateTo, ivaIncluded],
    enabled: ready,
    queryFn: async () => {
      const p = new URLSearchParams();
      if (localId !== "all") p.set("localId", localId);
      p.set("source", source);
      p.set("dateFrom", dateFrom);
      p.set("dateTo", dateTo);
      p.set("ivaIncluded", String(ivaIncluded));
      const res = await fetch(`/api/finance/cmv-productos?${p.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.message || "Error al calcular");
      return res.json();
    },
  });

  const cmvReal = useMemo(
    () => findCmvReal(cmvReales, localId === "all" ? null : parseInt(localId, 10), dateFrom, dateTo),
    [cmvReales, localId, dateFrom, dateTo],
  );

  const recipeOptions = useMemo(
    () => [...recipes]
      .sort((a, b) => String(a.name).localeCompare(String(b.name), "es"))
      .map((r) => ({ value: String(r.id), label: `${r.name} — ${formatCurrency(num(r.totalCost))}` })),
    [recipes],
  );

  const visibleLines = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.lines ?? []).filter((l) => {
      if (costFilter === "sin" && l.costoUnitario != null) return false;
      if (costFilter === "con" && l.costoUnitario == null) return false;
      if (q && !l.producto.toLowerCase().includes(q) && !(l.recipeName ?? "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [data, search, costFilter]);

  /** Unidades sin costo, para saber cuánto CMV falta explicar. */
  const sinCostoUnidades = useMemo(
    () => (data?.lines ?? []).filter((l) => l.costoUnitario == null).reduce((s, l) => s + l.cantidad, 0),
    [data],
  );

  const saveCostMutation = useMutation({
    mutationFn: async () => {
      const body = {
        source,
        productName: costTarget?.producto,
        costMode,
        recipeId: costMode === "receta" ? costRecipeId : (costRecipeId || null),
        manualCost: costMode === "manual" ? parseEsArAmount(costManual) : null,
      };
      const res = await apiRequest("POST", "/api/finance/product-costs", body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/finance/cmv-productos"] });
      queryClient.invalidateQueries({ queryKey: ["/api/finance/product-costs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/product-recipe-mappings"] });
      toast({ title: "Costo asignado", description: `${costTarget?.producto} quedó valorizado.` });
      setCostTarget(null);
    },
    onError: (e: Error) => toast({ title: "No se pudo guardar el costo", description: e.message, variant: "destructive" }),
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body = { localId: localId === "all" ? null : localId, source, dateFrom, dateTo, ivaIncluded };
      const res = editingId != null
        ? await apiRequest("PUT", `/api/finance/cmv-producto-calculations/${editingId}`, body)
        : await apiRequest("POST", "/api/finance/cmv-producto-calculations", body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/finance/cmv-producto-calculations"] });
      toast(editingId != null
        ? { title: "CMV Productos actualizado", description: "Se recalculó y se volvió a congelar el detalle." }
        : { title: "CMV Productos guardado", description: "Quedó registrado con el detalle producto por producto." });
      setEditingId(null);
    },
    onError: (e: Error) => toast({ title: "No se pudo guardar", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => (await apiRequest("DELETE", `/api/finance/cmv-producto-calculations/${id}`)).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/finance/cmv-producto-calculations"] });
      toast({ title: "Registro eliminado" });
      setDeleteTarget(null);
      setDeleteCode("");
    },
    onError: (e: Error) => toast({ title: "No se pudo eliminar", description: e.message, variant: "destructive" }),
  });

  const openCostDialog = (line: CmvProductoLine) => {
    setCostTarget(line);
    setCostMode(line.costMode === "manual" ? "manual" : "receta");
    setCostRecipeId(line.recipeId != null ? String(line.recipeId) : "");
    setCostManual(line.costMode === "manual" && line.costoUnitario != null
      ? formatEsArAmountInput(String(line.costoUnitario).replace(".", ","))
      : "");
  };

  const startEdit = (row: CmvProductoSaved) => {
    setLocalId(row.localId != null ? String(row.localId) : "all");
    setSource((row.source as ProductSource) ?? "fudo");
    setDateFrom(row.periodFrom ?? firstDayOfMonth());
    setDateTo(row.periodTo ?? today());
    setIvaIncluded(!!row.ivaIncluded);
    setEditingId(row.id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Desvío teórico vs real: lo que el costeo no explica (merma, desperdicio, faltante).
  const desvioPp = cmvReal != null && data?.cmvPct != null && cmvReal.cmvPct != null
    ? num(cmvReal.cmvPct) - data.cmvPct
    : null;
  const desvioMoney = cmvReal != null && data != null ? num(cmvReal.cmv) - data.cmvTeorico : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="CMV Productos — Costo de Mercadería Vendida teórico"
        description="Cantidad vendida × costo del producto, cruzado contra la venta del período"
      />

      {/* ── Parámetros ── */}
      <Card className={editingId != null ? "border-primary" : undefined}>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              {editingId != null && <Pencil className="h-4 w-4 text-primary" />}
              {editingId != null ? "Editando CMV Productos guardado" : "Parámetros"}
            </span>
            {editingId != null && (
              <Button variant="ghost" size="sm" onClick={() => setEditingId(null)} data-testid="button-cancel-edit-cmv-productos">
                <X className="h-4 w-4 mr-1" /> Cancelar edición
              </Button>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1">
              <Label className="text-xs">Local</Label>
              <DataEntryCombobox options={localOptions} value={localId} onValueChange={setLocalId} placeholder="Local" searchPlaceholder="Buscar…" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Productos vendidos de</Label>
              <DataEntryCombobox
                options={sourceOptions}
                value={source}
                onValueChange={(v) => setSource(v as ProductSource)}
                placeholder="Fuente"
                searchPlaceholder="Buscar…"
                data-testid="select-cmv-productos-source"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Período</Label>
              <DateRangePicker from={dateFrom} to={dateTo} onChange={(f, t) => { setDateFrom(f); setDateTo(t); }} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Tomar venta</Label>
              <DataEntryCombobox
                options={[
                  { value: "sin", label: "Sin IVA (÷1,21)" },
                  { value: "con", label: "Con IVA (bruto)" },
                ]}
                value={ivaIncluded ? "con" : "sin"}
                onValueChange={(v) => setIvaIncluded(v === "con")}
                placeholder="IVA"
                searchPlaceholder="Buscar…"
              />
            </div>
          </div>

          {source === "datalive" && (
            <p className="mt-3 text-xs text-muted-foreground">
              Datalive importa los productos por período (desde/hasta) y no por día: solo entran los
              períodos que caen enteros dentro del rango elegido. En la práctica casi todos se
              importaron de a un día, así que cualquier rango funciona.
            </p>
          )}
        </CardContent>
      </Card>

      {/* ── Resultado ── */}
      {ready && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Calculator className="h-4 w-4" /> Resultado
            </CardTitle>
            <Button
              size="sm"
              onClick={() => saveMutation.mutate()}
              disabled={!data || isLoading || saveMutation.isPending}
              data-testid="button-save-cmv-productos"
            >
              <Save className="h-4 w-4 mr-2" />
              {saveMutation.isPending ? "Guardando..." : editingId != null ? "Guardar cambios" : "Guardar"}
            </Button>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-20 w-full" />)}
              </div>
            ) : isError ? (
              <p className="text-sm text-destructive">{(error as Error)?.message}</p>
            ) : data ? (
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Stat
                    label="CMV teórico $"
                    value={formatCurrency(data.cmvTeorico)}
                    hint={`${data.unidadesConCosto.toLocaleString("es-AR")} unidades valorizadas`}
                  />
                  <Stat
                    label={ivaIncluded ? "Venta bruta (con IVA)" : "Venta sin IVA (÷1,21)"}
                    value={formatCurrency(data.ventaReal)}
                    hint={`Importada de ${SOURCE_LABELS[data.source] ?? data.source}`}
                  />
                  <Stat
                    label="CMV Productos %"
                    value={data.cmvPct == null ? "—" : `${data.cmvPct.toFixed(2)}%`}
                    hint="CMV teórico sobre la venta real"
                  />
                  <Stat
                    label="Cobertura"
                    value={data.coberturaPct == null ? "—" : `${data.coberturaPct.toFixed(1)}%`}
                    hint={`${data.unidades.toLocaleString("es-AR")} unidades vendidas`}
                    tone={data.coberturaPct != null && data.coberturaPct < 95 ? "warn" : "good"}
                  />
                </div>

                {/* Venta teórica: lo que se habría facturado a precio de lista. */}
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <Stat
                    label="Venta teórica (precio de receta)"
                    value={formatCurrency(data.ventaTeorica)}
                    hint="Solo productos con receta mapeada"
                  />
                  <Stat
                    label="CMV sobre venta teórica"
                    value={data.cmvPctTeorico == null ? "—" : `${data.cmvPctTeorico.toFixed(2)}%`}
                    hint="El CMV que daría vendiendo todo a precio de lista"
                  />
                  <Stat
                    label="Brecha venta real vs teórica"
                    value={
                      data.ventaTeorica > 0
                        ? `${(((data.ventaReal - data.ventaTeorica) / data.ventaTeorica) * 100).toFixed(1)}%`
                        : "—"
                    }
                    hint="Negativo = descuentos, promos o precios desactualizados"
                  />
                </div>

                {/* Cobertura incompleta: el número está subvaluado y hay que decirlo. */}
                {data.coberturaPct != null && data.coberturaPct < 100 && (
                  <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 flex gap-2 items-start">
                    <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-500 mt-0.5 shrink-0" />
                    <p className="text-sm text-amber-700 dark:text-amber-400">
                      Quedan <span className="font-semibold">{sinCostoUnidades.toLocaleString("es-AR")} unidades</span> sin
                      costo asignado. El CMV teórico está subvaluado hasta que se les asigne uno — filtrá por
                      "Sin costo" en la tabla de abajo para completarlos.
                    </p>
                  </div>
                )}

                {/* El cruce que da sentido al módulo: teórico vs real. */}
                {cmvReal != null && (
                  <div className="rounded-lg border p-3 space-y-2">
                    <p className="text-sm font-medium flex items-center gap-2">
                      <ListTree className="h-4 w-4 text-primary" />
                      Teórico vs. real (CMV por stock del período {cmvReal.periodFrom} → {cmvReal.periodTo})
                    </p>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <Stat label="CMV real $" value={formatCurrency(num(cmvReal.cmv))} />
                      <Stat label="CMV real %" value={cmvReal.cmvPct == null ? "—" : `${num(cmvReal.cmvPct).toFixed(2)}%`} />
                      <Stat
                        label="Desvío"
                        value={desvioPp == null ? "—" : `${desvioPp >= 0 ? "+" : ""}${desvioPp.toFixed(2)} pp`}
                        tone={desvioPp != null && desvioPp > 0 ? "warn" : "good"}
                      />
                      <Stat
                        label="Desvío $"
                        value={desvioMoney == null ? "—" : formatCurrency(desvioMoney)}
                        hint="Consumo que el costeo no explica"
                        tone={desvioMoney != null && desvioMoney > 0 ? "warn" : "good"}
                      />
                    </div>
                  </div>
                )}
              </div>
            ) : null}
          </CardContent>
        </Card>
      )}

      {/* ── Productos vendidos ── */}
      {ready && data && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex flex-wrap items-center justify-between gap-3">
              <span className="flex items-center gap-2">
                <DollarSign className="h-4 w-4" /> Productos vendidos ({visibleLines.length})
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Buscar producto…"
                    className="h-8 pl-7 w-52 text-sm font-normal"
                  />
                </div>
                {(["all", "sin", "con"] as const).map((f) => (
                  <Button
                    key={f}
                    size="sm"
                    variant={costFilter === f ? "default" : "outline"}
                    className="h-8"
                    onClick={() => setCostFilter(f)}
                  >
                    {f === "all" ? "Todos" : f === "sin" ? "Sin costo" : "Con costo"}
                  </Button>
                ))}
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 md:p-6 md:pt-0">
            {visibleLines.length === 0 ? (
              <p className="px-3 py-6 text-sm text-muted-foreground">
                No hay productos vendidos con estos filtros en el período elegido.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/50">
                      <th className="text-left px-3 py-2 font-medium border-b whitespace-nowrap">Producto</th>
                      <th className="text-left px-3 py-2 font-medium border-b whitespace-nowrap">Categoría</th>
                      <th className="text-right px-3 py-2 font-medium border-b whitespace-nowrap">Cantidad</th>
                      <th className="text-right px-3 py-2 font-medium border-b whitespace-nowrap">Costo unit.</th>
                      <th className="text-right px-3 py-2 font-medium border-b whitespace-nowrap">Costo total</th>
                      <th className="text-left px-3 py-2 font-medium border-b whitespace-nowrap">Origen del costo</th>
                      <th className="text-right px-3 py-2 font-medium border-b whitespace-nowrap">Precio unit.</th>
                      <th className="text-right px-3 py-2 font-medium border-b whitespace-nowrap">Venta teórica</th>
                      <th className="text-right px-3 py-2 font-medium border-b whitespace-nowrap">CMV %</th>
                      <th className="px-3 py-2 border-b" />
                    </tr>
                  </thead>
                  <tbody>
                    {visibleLines.map((l) => {
                      const lineCmvPct = l.ventaTeorica > 0 ? (l.costoTotal / l.ventaTeorica) * 100 : null;
                      return (
                        <tr
                          key={l.producto}
                          className={`border-b hover:bg-muted/30 transition-colors ${l.costoUnitario == null ? "bg-amber-500/5" : ""}`}
                        >
                          <td className="px-3 py-2 font-medium">{l.producto}</td>
                          <td className="px-3 py-2 text-muted-foreground">{l.categoria ?? "—"}</td>
                          <td className="px-3 py-2 text-right font-mono">{l.cantidad.toLocaleString("es-AR")}</td>
                          <td className="px-3 py-2 text-right font-mono">
                            {l.costoUnitario == null ? <span className="text-amber-600 dark:text-amber-500">Sin costo</span> : formatCurrency(l.costoUnitario)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono font-medium">
                            {l.costoUnitario == null ? "—" : formatCurrency(l.costoTotal)}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            {l.costMode == null ? (
                              <Badge variant="outline" className="text-[10px] border-amber-500/50 text-amber-700 dark:text-amber-500">
                                Sin asignar
                              </Badge>
                            ) : l.costMode === "manual" ? (
                              <Badge variant="secondary" className="text-[10px]">Manual</Badge>
                            ) : (
                              <Badge variant="outline" className="text-[10px]">
                                <ChefHat className="h-3 w-3 mr-1" /> {l.recipeName ?? "Receta"}
                              </Badge>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                            {l.precioUnitario == null ? "—" : formatCurrency(l.precioUnitario)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                            {l.precioUnitario == null ? "—" : formatCurrency(l.ventaTeorica)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono">
                            {lineCmvPct == null || l.costoUnitario == null ? "—" : `${lineCmvPct.toFixed(1)}%`}
                          </td>
                          <td className="px-3 py-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs"
                              onClick={() => openCostDialog(l)}
                              data-testid={`button-assign-cost-${l.producto}`}
                            >
                              <Pencil className="h-3.5 w-3.5 mr-1" />
                              {l.costoUnitario == null ? "Asignar costo" : "Editar"}
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Guardados ── */}
      {saved.length > 0 && (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">CMV Productos guardados</CardTitle></CardHeader>
          <CardContent className="p-0 md:p-6 md:pt-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50">
                    <th className="text-left px-3 py-2 font-medium border-b whitespace-nowrap">Período</th>
                    <th className="text-left px-3 py-2 font-medium border-b whitespace-nowrap">Local</th>
                    <th className="text-center px-3 py-2 font-medium border-b whitespace-nowrap">Fuente</th>
                    <th className="text-right px-3 py-2 font-medium border-b whitespace-nowrap">Unidades</th>
                    <th className="text-right px-3 py-2 font-medium border-b whitespace-nowrap">Cobertura</th>
                    <th className="text-right px-3 py-2 font-medium border-b whitespace-nowrap">CMV teórico $</th>
                    <th className="text-right px-3 py-2 font-medium border-b whitespace-nowrap">Venta</th>
                    <th className="text-right px-3 py-2 font-medium border-b whitespace-nowrap">CMV %</th>
                    <th className="px-3 py-2 border-b" />
                  </tr>
                </thead>
                <tbody>
                  {saved.map((r) => (
                    <tr key={r.id} className="border-b hover:bg-muted/30 transition-colors">
                      <td className="px-3 py-2 whitespace-nowrap">{r.periodFrom ?? "—"} → {r.periodTo ?? "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                        {r.localId != null ? (localMap.get(r.localId) ?? "—") : "Todos"}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <Badge variant="outline" className="text-[10px]">{SOURCE_LABELS[r.source] ?? r.source}</Badge>
                      </td>
                      <td className="px-3 py-2 text-right font-mono">{(r.unidades ?? 0).toLocaleString("es-AR")}</td>
                      <td className="px-3 py-2 text-right font-mono">
                        {r.coberturaPct == null ? "—" : `${num(r.coberturaPct).toFixed(1)}%`}
                      </td>
                      <td className="px-3 py-2 text-right font-mono font-medium">{formatCurrency(num(r.cmvTeorico))}</td>
                      <td className="px-3 py-2 text-right font-mono text-muted-foreground">{formatCurrency(num(r.ventaReal))}</td>
                      <td className="px-3 py-2 text-right font-mono font-semibold">
                        {r.cmvPct == null ? "—" : `${num(r.cmvPct).toFixed(2)}%`}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-primary"
                            title="Ver detalle congelado"
                            onClick={() => setDetailTarget(r)}
                          >
                            <ListTree className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-primary"
                            title="Editar (recalcula y vuelve a congelar)"
                            onClick={() => startEdit(r)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            title="Eliminar"
                            onClick={() => { setDeleteTarget(r); setDeleteCode(""); }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Diálogo: asignar costo ── */}
      <Dialog open={!!costTarget} onOpenChange={(open) => { if (!open) setCostTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Costo de "{costTarget?.producto}"</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-xs text-muted-foreground">
              El costo se carga SIN IVA, igual que el costeo de recetas. Aplica a este producto en{" "}
              {SOURCE_LABELS[source] ?? source} para toda la empresa.
            </p>

            <div className="flex gap-2">
              <Button
                size="sm"
                variant={costMode === "receta" ? "default" : "outline"}
                className="flex-1"
                onClick={() => setCostMode("receta")}
              >
                <ChefHat className="h-4 w-4 mr-1" /> Desde una receta
              </Button>
              <Button
                size="sm"
                variant={costMode === "manual" ? "default" : "outline"}
                className="flex-1"
                onClick={() => setCostMode("manual")}
              >
                <DollarSign className="h-4 w-4 mr-1" /> Costo manual
              </Button>
            </div>

            {costMode === "receta" ? (
              <div className="space-y-1">
                <Label className="text-xs">Receta</Label>
                <DataEntryCombobox
                  options={recipeOptions}
                  value={costRecipeId}
                  onValueChange={setCostRecipeId}
                  placeholder="Elegí la receta"
                  searchPlaceholder="Buscar receta…"
                  data-testid="select-product-cost-recipe"
                />
                <p className="text-[11px] text-muted-foreground pt-0.5">
                  El costo sale del costeo de la receta y se actualiza solo cuando cambian los insumos.
                  El mapeo también se usa en el widget de márgenes del Dashboard.
                </p>
              </div>
            ) : (
              <div className="space-y-1">
                <Label className="text-xs">Costo unitario (sin IVA)</Label>
                <Input
                  value={costManual}
                  onChange={(e) => setCostManual(formatEsArAmountInput(e.target.value))}
                  placeholder="0,00"
                  autoComplete="off"
                  data-testid="input-product-cost-manual"
                />
                <p className="text-[11px] text-muted-foreground pt-0.5">
                  Pisa el costo de la receta. Útil para bebidas, reventa o cuando la receta no representa el producto.
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCostTarget(null)}>Cancelar</Button>
            <Button
              disabled={
                saveCostMutation.isPending ||
                (costMode === "receta" ? !costRecipeId : parseEsArAmount(costManual) <= 0)
              }
              onClick={() => saveCostMutation.mutate()}
              data-testid="button-save-product-cost"
            >
              {saveCostMutation.isPending ? "Guardando..." : "Guardar costo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Diálogo: detalle congelado ── */}
      <SavedDetailDialog target={detailTarget} onClose={() => setDetailTarget(null)} />

      {/* ── Diálogo: eliminar ── */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) { setDeleteTarget(null); setDeleteCode(""); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Eliminar CMV Productos guardado</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            {deleteTarget && (
              <p className="text-sm text-muted-foreground">
                Vas a eliminar el registro del período{" "}
                <span className="font-semibold text-foreground">
                  {deleteTarget.periodFrom ?? "—"} → {deleteTarget.periodTo ?? "—"}
                </span>{" "}
                y su detalle congelado. Esta acción no se puede deshacer.
              </p>
            )}
            <div className="space-y-1">
              <Label className="text-xs">
                Escribí <span className="font-bold text-destructive">ELIMINAR</span> para confirmar
              </Label>
              <Input value={deleteCode} onChange={(e) => setDeleteCode(e.target.value)} placeholder="ELIMINAR" autoComplete="off" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDeleteTarget(null); setDeleteCode(""); }}>Cancelar</Button>
            <Button
              variant="destructive"
              disabled={deleteCode !== "ELIMINAR" || deleteMutation.isPending}
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            >
              {deleteMutation.isPending ? "Eliminando..." : "Eliminar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Detalle congelado de un cálculo guardado ─────────────────────────────────

function SavedDetailDialog({ target, onClose }: { target: CmvProductoSaved | null; onClose: () => void }) {
  const { data: lines = [], isLoading } = useQuery<SavedLineRow[]>({
    queryKey: ["/api/finance/cmv-producto-calculations", target?.id, "lines"],
    enabled: target != null,
    queryFn: async () => {
      const res = await fetch(`/api/finance/cmv-producto-calculations/${target!.id}/lines`, { credentials: "include" });
      if (!res.ok) throw new Error("No se pudo leer el detalle");
      return res.json();
    },
  });

  return (
    <Dialog open={target != null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>
            Detalle congelado — {target?.periodFrom ?? "—"} → {target?.periodTo ?? "—"}
          </DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          Costos tal como estaban al momento de guardar. No cambian aunque después cambie el costeo.
        </p>
        <div className="max-h-[60vh] overflow-auto">
          {isLoading ? (
            <div className="space-y-2 p-2">{[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-6 w-full" />)}</div>
          ) : lines.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">Este registro no tiene detalle guardado.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-background">
                <tr className="bg-muted/50">
                  <th className="text-left px-3 py-2 font-medium border-b">Producto</th>
                  <th className="text-right px-3 py-2 font-medium border-b whitespace-nowrap">Cantidad</th>
                  <th className="text-right px-3 py-2 font-medium border-b whitespace-nowrap">Costo unit.</th>
                  <th className="text-right px-3 py-2 font-medium border-b whitespace-nowrap">Costo total</th>
                  <th className="text-left px-3 py-2 font-medium border-b whitespace-nowrap">Origen</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id} className="border-b">
                    <td className="px-3 py-1.5">{l.producto}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{(l.cantidad ?? 0).toLocaleString("es-AR")}</td>
                    <td className="px-3 py-1.5 text-right font-mono">
                      {l.costoUnitario == null ? "—" : formatCurrency(num(l.costoUnitario))}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono">
                      {l.costoUnitario == null ? "—" : formatCurrency(num(l.costoTotal))}
                    </td>
                    <td className="px-3 py-1.5 text-muted-foreground text-xs">
                      {l.costMode === "manual" ? "Manual" : l.costMode === "receta" ? (l.recipeName ?? "Receta") : "Sin costo"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cerrar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
