import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DataEntryCombobox } from "@/components/data-entry-combobox";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatCurrency } from "@/lib/formatters";
import { Plus, Trash2, Save, Target } from "lucide-react";
import type { Local, Recipe, TransactionCategory, BreakevenAnalysis } from "@shared/schema";

interface FixedCostRow {
  transactionCategoryId: string;
  label: string;
  amount: string;
}

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

  const { data: locals = [] } = useQuery<Local[]>({ queryKey: ["/api/locals"] });
  const { data: recipes = [] } = useQuery<Recipe[]>({ queryKey: ["/api/recipes"] });
  const { data: categories = [] } = useQuery<TransactionCategory[]>({ queryKey: ["/api/transaction-categories"] });
  const { data: analyses = [] } = useQuery<BreakevenAnalysis[]>({ queryKey: ["/api/finance/breakeven"] });

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
  // % de margen de contribución: en modo producto se deriva del precio/costo; en modo margen lo carga el usuario.
  const marginPct = isMargin
    ? parseFloat(marginPctInput) || 0
    : priceN > 0
      ? ((priceN - costN) / priceN) * 100
      : 0;
  const contribution = priceN - costN; // $ por unidad (solo modo producto)
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
          </CardContent>
        </Card>

        <Card className="h-fit">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="text-base flex items-center gap-2"><Target className="h-4 w-4" /> Resultado</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
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
                    <th className="text-right px-3 py-2 font-medium border-b">Precio</th>
                    <th className="text-right px-3 py-2 font-medium border-b">Costo var.</th>
                    <th className="text-right px-3 py-2 font-medium border-b">Costos fijos</th>
                    <th className="text-right px-3 py-2 font-medium border-b">PE unidades</th>
                  </tr>
                </thead>
                <tbody>
                  {analyses.map((a) => (
                    <tr key={a.id} className="border-b">
                      <td className="px-3 py-2">{a.name}</td>
                      <td className="px-3 py-2 text-right font-mono">{formatCurrency(parseFloat(String(a.salePriceNoIva)) || 0)}</td>
                      <td className="px-3 py-2 text-right font-mono">{formatCurrency(parseFloat(String(a.variableCostNoIva)) || 0)}</td>
                      <td className="px-3 py-2 text-right font-mono">{formatCurrency(parseFloat(String(a.totalFixedCosts)) || 0)}</td>
                      <td className="px-3 py-2 text-right font-mono font-semibold">{(parseFloat(String(a.breakevenUnits)) || 0).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
