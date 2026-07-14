import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DataEntryCombobox } from "@/components/data-entry-combobox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatCurrency } from "@/lib/formatters";
import { Plus, Trash2, Save, Target, Eye, TrendingUp } from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceDot,
} from "recharts";
import { DataEntryCombobox as Combo } from "@/components/data-entry-combobox";
import type { Local, Recipe, TransactionCategory, BreakevenAnalysis, BreakevenFixedCost } from "@shared/schema";

interface FixedCostRow {
  transactionCategoryId: string;
  label: string;
  amount: string;
}

interface CommissionRow {
  label: string;
  pct: string;
  base: "con_iva" | "sin_iva";
  ivaRate: string;
}

const COMMISSION_BASE_OPTIONS = [
  { value: "sin_iva", label: "Sobre precio SIN IVA (ej. IIBB)" },
  { value: "con_iva", label: "Sobre precio CON IVA (ej. Mercado Pago)" },
];

export default function BreakevenPage() {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [localId, setLocalId] = useState("all");
  const [recipeId, setRecipeId] = useState("");
  const [price, setPrice] = useState("");
  const [cost, setCost] = useState("");
  const [mode, setMode] = useState<"product" | "margin">("product");
  const [marginPctInput, setMarginPctInput] = useState("");
  const [fixed, setFixed] = useState<FixedCostRow[]>([{ transactionCategoryId: "", label: "", amount: "" }]);
  const [commissions, setCommissions] = useState<CommissionRow[]>([]);

  const [detailId, setDetailId] = useState<number | null>(null);

  const { data: locals = [] } = useQuery<Local[]>({ queryKey: ["/api/locals"] });
  const { data: recipes = [] } = useQuery<Recipe[]>({ queryKey: ["/api/recipes"] });
  const { data: categories = [] } = useQuery<TransactionCategory[]>({ queryKey: ["/api/transaction-categories"] });
  const { data: analyses = [] } = useQuery<BreakevenAnalysis[]>({ queryKey: ["/api/finance/breakeven"] });
  const { data: detail, isLoading: detailLoading } = useQuery<{ analysis: BreakevenAnalysis; fixedCosts: BreakevenFixedCost[] }>({
    queryKey: ["/api/finance/breakeven", detailId],
    enabled: detailId != null,
  });

  const localName = (id: number | null | undefined) =>
    id == null ? "General" : locals.find((l) => l.id === id)?.name ?? `Local ${id}`;
  const categoryName = (id: number | null | undefined) =>
    id == null ? null : categories.find((c) => c.id === id)?.name ?? null;

  const localOptions = useMemo(
    () => [{ value: "all", label: "Sin local / general" }, ...locals.map((l) => ({ value: String(l.id), label: l.name }))],
    [locals],
  );
  const recipeOptions = useMemo(
    () => [{ value: "", label: "Manual (sin receta)" }, ...recipes.map((r) => ({ value: String(r.id), label: r.name }))],
    [recipes],
  );
  const categoryOptions = useMemo(
    () => [{ value: "", label: "Sin categoría" }, ...categories.filter((c) => c.type === "expense").map((c) => ({ value: String(c.id), label: c.name }))],
    [categories],
  );

  const onPickRecipe = (val: string) => {
    setRecipeId(val);
    const r = recipes.find((x) => String(x.id) === val);
    if (r) {
      setPrice(String(parseFloat(String(r.salePrice ?? 0)) || 0));
      setCost(String(parseFloat(String(r.totalCost ?? 0)) || 0));
      if (!name) setName(`PE — ${r.name}`);
    }
  };

  const priceN = parseFloat(price) || 0;
  const costN = parseFloat(cost) || 0;
  const totalFixed = useMemo(() => fixed.reduce((a, f) => a + (parseFloat(f.amount) || 0), 0), [fixed]);

  const isMargin = mode === "margin";
  // Punto 22: comisiones por unidad (solo modo producto). Sobre precio con o sin IVA.
  const commissionPerUnit = useMemo(() => {
    if (isMargin) return 0;
    return commissions.reduce((acc, c) => {
      const pct = parseFloat(c.pct) || 0;
      const iva = parseFloat(c.ivaRate) || 0;
      const base = c.base === "con_iva" ? priceN * (1 + iva / 100) : priceN;
      return acc + base * (pct / 100);
    }, 0);
  }, [commissions, priceN, isMargin]);

  // % de margen de contribución: en modo producto se deriva del precio/costo/comisiones; en modo margen lo carga el usuario.
  const marginPct = isMargin
    ? parseFloat(marginPctInput) || 0
    : priceN > 0
      ? ((priceN - costN - commissionPerUnit) / priceN) * 100
      : 0;
  const contribution = priceN - costN - commissionPerUnit; // $ por unidad (solo modo producto)
  const valid = isMargin ? marginPct > 0 && marginPct < 100 : contribution > 0;
  // PE en unidades solo aplica en modo producto (hay precio por unidad).
  const units = !isMargin && contribution > 0 ? totalFixed / contribution : null;
  // PE en facturación: modo producto = units*precio; modo margen = fijos / (margen%/100).
  const revenue = isMargin
    ? marginPct > 0
      ? totalFixed / (marginPct / 100)
      : null
    : units != null
      ? units * priceN
      : null;

  // Punto 23: datos del gráfico de PE (rectas Ingresos vs Costos totales cruzándose).
  const chartData = useMemo(() => {
    if (isMargin || !valid || units == null || priceN <= 0) return [];
    const varUnit = costN + commissionPerUnit; // costo variable efectivo por unidad
    const maxU = Math.max(units * 2, 10);
    const step = maxU / 24;
    const pts: Array<{ u: number; Ingresos: number; Costos: number }> = [];
    for (let u = 0; u <= maxU + 0.0001; u += step) {
      pts.push({ u: Math.round(u), Ingresos: u * priceN, Costos: totalFixed + varUnit * u });
    }
    return pts;
  }, [isMargin, valid, units, priceN, costN, commissionPerUnit, totalFixed]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error("Poné un nombre al análisis");
      if (!valid) {
        throw new Error(isMargin ? "El margen debe estar entre 0 y 100%" : "El precio de venta debe ser mayor al costo variable");
      }
      // En modo margen no hay precio por unidad: se usa una base nocional de 100 para conservar
      // la razón de contribución (precio 100, costo 100−margen%) → la facturación de PE es exacta.
      const salePriceNoIva = isMargin ? 100 : priceN;
      const variableCostNoIva = isMargin ? 100 - marginPct : costN;
      const res = await apiRequest("POST", "/api/finance/breakeven", {
        name,
        localId: localId === "all" ? null : parseInt(localId, 10),
        recipeId: isMargin || !recipeId ? null : parseInt(recipeId, 10),
        salePriceNoIva,
        variableCostNoIva,
        commissions: isMargin
          ? []
          : commissions
              .filter((c) => (parseFloat(c.pct) || 0) > 0)
              .map((c) => ({
                label: c.label || null,
                pct: parseFloat(c.pct) || 0,
                base: c.base,
                ivaRate: c.base === "con_iva" ? parseFloat(c.ivaRate) || 0 : undefined,
              })),
        fixedCosts: fixed
          .filter((f) => parseFloat(f.amount) > 0)
          .map((f) => ({
            transactionCategoryId: f.transactionCategoryId ? parseInt(f.transactionCategoryId, 10) : null,
            label: f.label || null,
            amount: parseFloat(f.amount),
          })),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/finance/breakeven"] });
      toast({ title: "Punto de equilibrio guardado" });
    },
    onError: (e: Error) => toast({ title: "No se pudo guardar", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Punto de Equilibrio" description="Costos fijos / (precio de venta − costo variable), sin IVA" />

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Nuevo cálculo</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs">Nombre</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: PE Milanesa" data-testid="input-name" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Local</Label>
                <DataEntryCombobox options={localOptions} value={localId} onValueChange={setLocalId} placeholder="Local" searchPlaceholder="Buscar…" data-testid="select-local" />
              </div>
            </div>

            <div className="flex gap-1 rounded-md border p-1 w-fit">
              <Button size="sm" variant={mode === "product" ? "default" : "ghost"} onClick={() => setMode("product")} data-testid="mode-product">
                Por producto
              </Button>
              <Button size="sm" variant={mode === "margin" ? "default" : "ghost"} onClick={() => setMode("margin")} data-testid="mode-margin">
                Por margen %
              </Button>
            </div>

            {mode === "product" ? (
              <div className="grid gap-4 sm:grid-cols-[1fr_auto_auto]">
                <div className="space-y-1">
                  <Label className="text-xs">Producto (receta)</Label>
                  <DataEntryCombobox options={recipeOptions} value={recipeId} onValueChange={onPickRecipe} placeholder="Elegí un producto" searchPlaceholder="Buscar producto…" data-testid="select-recipe" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Precio venta (sin IVA)</Label>
                  <Input type="number" step="any" value={price} onChange={(e) => setPrice(e.target.value)} data-testid="input-price" className="w-40" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Costo variable (sin IVA)</Label>
                  <Input type="number" step="any" value={cost} onChange={(e) => setCost(e.target.value)} data-testid="input-cost" className="w-40" />
                </div>
              </div>
            ) : (
              <div className="space-y-1 max-w-xs">
                <Label className="text-xs">Margen de contribución (%)</Label>
                <Input type="number" step="any" value={marginPctInput} onChange={(e) => setMarginPctInput(e.target.value)} placeholder="Ej: 65" data-testid="input-margin" />
                <p className="text-xs text-muted-foreground">Calcula el PE en facturación a partir del margen, sin elegir un producto puntual.</p>
              </div>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm">Gastos fijos</Label>
                <Button variant="outline" size="sm" onClick={() => setFixed((p) => [...p, { transactionCategoryId: "", label: "", amount: "" }])} data-testid="button-add-fixed">
                  <Plus className="h-4 w-4 mr-1" /> Agregar
                </Button>
              </div>
              {fixed.map((f, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_120px_auto] items-center gap-2">
                  <DataEntryCombobox
                    options={categoryOptions}
                    value={f.transactionCategoryId}
                    onValueChange={(v) => setFixed((p) => p.map((x, j) => (j === i ? { ...x, transactionCategoryId: v } : x)))}
                    placeholder="Categoría"
                    searchPlaceholder="Buscar…"
                    data-testid={`fixed-cat-${i}`}
                  />
                  <Input
                    placeholder="Detalle (opcional)"
                    value={f.label}
                    onChange={(e) => setFixed((p) => p.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                  />
                  <Input
                    type="number"
                    step="any"
                    placeholder="Importe"
                    value={f.amount}
                    onChange={(e) => setFixed((p) => p.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))}
                    data-testid={`fixed-amount-${i}`}
                  />
                  <Button variant="ghost" size="icon" onClick={() => setFixed((p) => p.filter((_, j) => j !== i))}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>

            {/* Punto 22: comisiones (%) — solo modo producto */}
            {!isMargin && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm">Comisiones (%)</Label>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCommissions((p) => [...p, { label: "", pct: "", base: "sin_iva", ivaRate: "21" }])}
                    data-testid="button-add-commission"
                  >
                    <Plus className="h-4 w-4 mr-1" /> Agregar
                  </Button>
                </div>
                {commissions.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    Cargá comisiones en % (Mercado Pago, IIBB…) y elegí si aplican sobre el precio con o sin IVA. Reducen el margen de contribución.
                  </p>
                )}
                {commissions.map((c, i) => (
                  <div key={i} className="grid grid-cols-[1fr_90px_1fr_90px_auto] items-center gap-2">
                    <Input
                      placeholder="Nombre (ej. Mercado Pago)"
                      value={c.label}
                      onChange={(e) => setCommissions((p) => p.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                    />
                    <Input
                      type="number"
                      step="any"
                      placeholder="%"
                      value={c.pct}
                      onChange={(e) => setCommissions((p) => p.map((x, j) => (j === i ? { ...x, pct: e.target.value } : x)))}
                      data-testid={`commission-pct-${i}`}
                    />
                    <Combo
                      options={COMMISSION_BASE_OPTIONS}
                      value={c.base}
                      onValueChange={(v) => setCommissions((p) => p.map((x, j) => (j === i ? { ...x, base: v as "con_iva" | "sin_iva" } : x)))}
                      placeholder="Base"
                      searchPlaceholder="Buscar…"
                    />
                    <Input
                      type="number"
                      step="any"
                      placeholder="IVA %"
                      value={c.ivaRate}
                      disabled={c.base !== "con_iva"}
                      title="Alícuota de IVA (solo si aplica sobre precio con IVA)"
                      onChange={(e) => setCommissions((p) => p.map((x, j) => (j === i ? { ...x, ivaRate: e.target.value } : x)))}
                    />
                    <Button variant="ghost" size="icon" onClick={() => setCommissions((p) => p.filter((_, j) => j !== i))}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="h-fit">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="text-base flex items-center gap-2"><Target className="h-4 w-4" /> Resultado</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {!isMargin && commissionPerUnit > 0 && (
              <div className="flex justify-between"><span className="text-muted-foreground">Comisiones ($/u)</span><span className="font-mono text-amber-600">− {formatCurrency(commissionPerUnit)}</span></div>
            )}
            {!isMargin && (
              <div className="flex justify-between"><span className="text-muted-foreground">Margen contribución ($/u)</span><span className={`font-mono ${contribution <= 0 ? "text-red-600" : ""}`}>{formatCurrency(contribution)}</span></div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">% Margen de contribución</span>
              <span className={`font-mono ${!valid ? "text-red-600" : ""}`} data-testid="text-margin-pct">
                {marginPct > 0 ? `${marginPct.toFixed(2)}%` : "—"}
              </span>
            </div>
            <div className="flex justify-between"><span className="text-muted-foreground">Costos fijos</span><span className="font-mono">{formatCurrency(totalFixed)}</span></div>
            {!isMargin && (
              <div className="flex justify-between border-t pt-2 font-bold"><span>PE (unidades)</span><span className="font-mono" data-testid="text-pe-units">{units == null ? "—" : units.toFixed(2)}</span></div>
            )}
            <div className={`flex justify-between font-bold ${isMargin ? "border-t pt-2" : ""}`}><span>PE (facturación)</span><span className="font-mono" data-testid="text-pe-revenue">{revenue == null ? "—" : formatCurrency(revenue)}</span></div>
            {!valid && <p className="text-xs text-red-600">{isMargin ? "El margen debe estar entre 0 y 100%." : "El precio debe superar al costo variable."}</p>}
            <Button className="w-full mt-2" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !valid} data-testid="button-save">
              <Save className="h-4 w-4 mr-2" /> {saveMutation.isPending ? "Guardando..." : "Guardar"}
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Punto 23: gráfico de punto de equilibrio (rectas Ingresos vs Costos) */}
      {!isMargin && valid && chartData.length > 0 && units != null && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-emerald-500" /> Punto de equilibrio — visual
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 lg:grid-cols-[1fr_240px] items-center">
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={chartData} margin={{ top: 8, right: 16, left: 8, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="u" tick={{ fontSize: 11 }} label={{ value: "Unidades", position: "insideBottom", offset: -10, fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => formatCurrency(v).replace("$", "").trim()} />
                  <Tooltip
                    formatter={(v: number) => formatCurrency(v)}
                    labelFormatter={(u) => `${u} unidades`}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="Ingresos" stroke="#16a34a" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="Costos" stroke="#dc2626" strokeWidth={2} dot={false} />
                  <ReferenceDot x={Math.round(units)} y={units * priceN} r={6} fill="hsl(var(--primary))" stroke="white" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
              <div className="space-y-3">
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Necesitás vender</p>
                  <p className="text-2xl font-bold">{units.toFixed(0)} <span className="text-sm font-normal text-muted-foreground">unidades</span></p>
                  <p className="text-xs text-muted-foreground mt-1">para no ganar ni perder.</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Equivale a facturar</p>
                  <p className="text-xl font-bold font-mono">{revenue != null ? formatCurrency(revenue) : "—"}</p>
                </div>
                <p className="text-xs text-muted-foreground">
                  Debajo del punto de cruce hay <span className="text-red-600 font-medium">pérdida</span>; por encima,
                  <span className="text-green-600 font-medium"> ganancia</span>. La comisión y el costo variable ya están
                  restados del margen.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Análisis guardados</CardTitle></CardHeader>
        <CardContent className="p-0 md:p-6">
          {analyses.length === 0 ? (
            <p className="py-6 text-center text-muted-foreground">Todavía no hay análisis guardados.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50">
                    <th className="text-left px-3 py-2 font-medium border-b">Nombre</th>
                    <th className="text-left px-3 py-2 font-medium border-b">Local</th>
                    <th className="text-right px-3 py-2 font-medium border-b">Precio</th>
                    <th className="text-right px-3 py-2 font-medium border-b">Costo var.</th>
                    <th className="text-right px-3 py-2 font-medium border-b">Costos fijos</th>
                    <th className="text-right px-3 py-2 font-medium border-b">PE unidades</th>
                    <th className="text-right px-3 py-2 font-medium border-b">Importe económico</th>
                    <th className="px-3 py-2 font-medium border-b"></th>
                  </tr>
                </thead>
                <tbody>
                  {analyses.map((a) => (
                    <tr key={a.id} className="border-b">
                      <td className="px-3 py-2">{a.name}</td>
                      <td className="px-3 py-2 text-muted-foreground">{localName(a.localId)}</td>
                      <td className="px-3 py-2 text-right font-mono">{formatCurrency(parseFloat(String(a.salePriceNoIva)) || 0)}</td>
                      <td className="px-3 py-2 text-right font-mono">{formatCurrency(parseFloat(String(a.variableCostNoIva)) || 0)}</td>
                      <td className="px-3 py-2 text-right font-mono">{formatCurrency(parseFloat(String(a.totalFixedCosts)) || 0)}</td>
                      <td className="px-3 py-2 text-right font-mono font-semibold">{(parseFloat(String(a.breakevenUnits)) || 0).toFixed(2)}</td>
                      <td className="px-3 py-2 text-right font-mono font-semibold">{formatCurrency(parseFloat(String(a.breakevenRevenue)) || 0)}</td>
                      <td className="px-3 py-2 text-right">
                        <Button variant="ghost" size="sm" onClick={() => setDetailId(a.id)} data-testid={`button-detail-${a.id}`}>
                          <Eye className="h-4 w-4 mr-1" /> Ver detalle
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={detailId != null} onOpenChange={(open) => !open && setDetailId(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{detail?.analysis.name ?? "Detalle del análisis"}</DialogTitle>
          </DialogHeader>
          {detailLoading || !detail ? (
            <p className="py-6 text-center text-muted-foreground">Cargando…</p>
          ) : (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                <div className="flex justify-between col-span-2 border-b pb-1">
                  <span className="text-muted-foreground">Local</span>
                  <span>{localName(detail.analysis.localId)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Precio venta (sin IVA)</span>
                  <span className="font-mono">{formatCurrency(parseFloat(String(detail.analysis.salePriceNoIva)) || 0)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Costo variable (sin IVA)</span>
                  <span className="font-mono">{formatCurrency(parseFloat(String(detail.analysis.variableCostNoIva)) || 0)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Margen de contribución</span>
                  <span className="font-mono">{formatCurrency(parseFloat(String(detail.analysis.contributionMargin)) || 0)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">PE (unidades)</span>
                  <span className="font-mono">{(parseFloat(String(detail.analysis.breakevenUnits)) || 0).toFixed(2)}</span>
                </div>
                <div className="flex justify-between col-span-2 border-t pt-1 font-semibold">
                  <span>Importe económico (PE facturación)</span>
                  <span className="font-mono">{formatCurrency(parseFloat(String(detail.analysis.breakevenRevenue)) || 0)}</span>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between border-b pb-1 mb-2">
                  <span className="font-medium">Gastos fijos</span>
                  <span className="font-mono">{formatCurrency(parseFloat(String(detail.analysis.totalFixedCosts)) || 0)}</span>
                </div>
                {detail.fixedCosts.length === 0 ? (
                  <p className="text-muted-foreground text-xs">Sin gastos fijos cargados.</p>
                ) : (
                  <ul className="space-y-1">
                    {detail.fixedCosts.map((f) => (
                      <li key={f.id} className="flex justify-between">
                        <span className="text-muted-foreground">
                          {categoryName(f.transactionCategoryId) ?? f.label ?? "Sin categoría"}
                          {categoryName(f.transactionCategoryId) && f.label ? ` — ${f.label}` : ""}
                        </span>
                        <span className="font-mono">{formatCurrency(parseFloat(String(f.amount)) || 0)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {Array.isArray((detail.analysis as any).commissions) && (detail.analysis as any).commissions.length > 0 && (
                <div>
                  <div className="flex items-center justify-between border-b pb-1 mb-2">
                    <span className="font-medium">Comisiones consideradas</span>
                  </div>
                  <ul className="space-y-1">
                    {(detail.analysis as any).commissions.map((c: any, i: number) => (
                      <li key={i} className="flex justify-between">
                        <span className="text-muted-foreground">
                          {c.label || "Comisión"} — {c.base === "con_iva" ? `sobre precio con IVA${c.ivaRate ? ` (${c.ivaRate}%)` : ""}` : "sobre precio sin IVA"}
                        </span>
                        <span className="font-mono">{(parseFloat(String(c.pct)) || 0).toFixed(2)}%</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
