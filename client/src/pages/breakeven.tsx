import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { DataEntryCombobox } from "@/components/data-entry-combobox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatCurrency } from "@/lib/formatters";
import { buildBreakevenPdf } from "@/lib/breakeven-pdf";
import { Plus, Trash2, Save, Target, Eye, TrendingUp, Pencil, Sparkles, FileDown } from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceDot, ReferenceLine,
} from "recharts";
import {
  computeBreakeven,
  profitAtUnits,
  variableCostAmount,
  VARIABLE_COST_BASE_LABELS,
  type AppliedVariableCost,
  type VariableCostBase,
} from "@shared/breakeven";
import type {
  Local,
  Recipe,
  TransactionCategory,
  FinancialGroup,
  BreakevenAnalysis,
  BreakevenFixedCost,
  BreakevenVariableCost,
} from "@shared/schema";

/**
 * Un gasto fijo se imputa a una categoría o a un grupo financiero entero. En la pantalla es un
 * solo combo, así que la referencia viaja prefijada ("c:12" categoría, "g:5" grupo) y se abre en
 * dos campos recién al guardar.
 */
interface FixedCostRow {
  ref: string;
  label: string;
  amount: string;
}

const parseFixedRef = (ref: string): { transactionCategoryId: number | null; financialGroupId: number | null } => {
  const [kind, rawId] = ref.split(":");
  const id = parseInt(rawId ?? "", 10);
  if (!Number.isFinite(id)) return { transactionCategoryId: null, financialGroupId: null };
  return {
    transactionCategoryId: kind === "c" ? id : null,
    financialGroupId: kind === "g" ? id : null,
  };
};

const BASE_OPTIONS: VariableCostBase[] = ["costo", "sin_iva", "con_iva"];

const emptyVariableCostForm = { id: null as number | null, name: "", pct: "", base: "sin_iva" as VariableCostBase, ivaRate: "21" };

export default function BreakevenPage() {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [localId, setLocalId] = useState("all");
  const [recipeId, setRecipeId] = useState("");
  const [price, setPrice] = useState("");
  const [cost, setCost] = useState("");
  const [mode, setMode] = useState<"product" | "margin">("product");
  const [marginPctInput, setMarginPctInput] = useState("");
  const [fixed, setFixed] = useState<FixedCostRow[]>([{ ref: "", label: "", amount: "" }]);
  const [selectedVarIds, setSelectedVarIds] = useState<number[]>([]);

  const [detailId, setDetailId] = useState<number | null>(null);
  const [varForm, setVarForm] = useState<typeof emptyVariableCostForm | null>(null);
  /** Unidades del simulador. Vacío = se sigue solo al punto de equilibrio. */
  const [simInput, setSimInput] = useState("");

  const { data: locals = [] } = useQuery<Local[]>({ queryKey: ["/api/locals"] });
  const { data: recipes = [] } = useQuery<Recipe[]>({ queryKey: ["/api/recipes"] });
  const { data: categories = [] } = useQuery<TransactionCategory[]>({ queryKey: ["/api/transaction-categories"] });
  const { data: groups = [] } = useQuery<FinancialGroup[]>({ queryKey: ["/api/financial-groups"] });
  const { data: variableCosts = [] } = useQuery<BreakevenVariableCost[]>({ queryKey: ["/api/finance/breakeven-variable-costs"] });
  const { data: analyses = [] } = useQuery<BreakevenAnalysis[]>({ queryKey: ["/api/finance/breakeven"] });
  const { data: detail, isLoading: detailLoading } = useQuery<{ analysis: BreakevenAnalysis; fixedCosts: BreakevenFixedCost[] }>({
    queryKey: ["/api/finance/breakeven", detailId],
    enabled: detailId != null,
  });

  const localName = (id: number | null | undefined) =>
    id == null ? "General" : locals.find((l) => l.id === id)?.name ?? `Local ${id}`;
  const categoryName = (id: number | null | undefined) =>
    id == null ? null : categories.find((c) => c.id === id)?.name ?? null;
  const groupName = (id: number | null | undefined) =>
    id == null ? null : groups.find((g) => g.id === id)?.name ?? null;

  const localOptions = useMemo(
    () => [{ value: "all", label: "Sin local / general" }, ...locals.map((l) => ({ value: String(l.id), label: l.name }))],
    [locals],
  );
  const recipeOptions = useMemo(
    () => [{ value: "", label: "Manual (sin receta)" }, ...recipes.map((r) => ({ value: String(r.id), label: r.name }))],
    [recipes],
  );

  /**
   * Grupos de gasto primero y después las categorías colgando de su grupo: así se puede cargar
   * "Sueldos" de un saque o abrir el detalle categoría por categoría, sin dos combos.
   */
  const fixedCostOptions = useMemo(() => {
    const expenseGroups = groups.filter((g) => g.type === "expense");
    const groupById = new Map(expenseGroups.map((g) => [g.id, g.name]));
    const opts: Array<{ value: string; label: string }> = [{ value: "", label: "Sin imputar" }];
    for (const g of expenseGroups) {
      opts.push({ value: `g:${g.id}`, label: `${g.name} — grupo completo` });
    }
    for (const c of categories.filter((c) => c.type === "expense")) {
      const parent = c.financialGroupId != null ? groupById.get(c.financialGroupId) : undefined;
      opts.push({ value: `c:${c.id}`, label: parent ? `${parent} › ${c.name}` : c.name });
    }
    return opts;
  }, [groups, categories]);

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

  /** Los costos variables tildados del catálogo, en el formato que entienden las fórmulas. */
  const appliedVariableCosts = useMemo<AppliedVariableCost[]>(() => {
    if (isMargin) return [];
    return variableCosts
      .filter((v) => selectedVarIds.includes(v.id))
      .map((v) => ({
        label: v.name,
        pct: parseFloat(String(v.pct)) || 0,
        base: (v.base as VariableCostBase) ?? "sin_iva",
        ivaRate: v.ivaRate == null ? undefined : parseFloat(String(v.ivaRate)) || 0,
      }));
  }, [variableCosts, selectedVarIds, isMargin]);

  const pe = useMemo(
    () =>
      computeBreakeven({
        priceNoIva: priceN,
        costNoIva: costN,
        totalFixedCosts: totalFixed,
        variableCosts: appliedVariableCosts,
      }),
    [priceN, costN, totalFixed, appliedVariableCosts],
  );

  // En modo margen no hay producto: el usuario carga el % de contribución y solo sale el PE en $.
  const marginPct = isMargin ? parseFloat(marginPctInput) || 0 : pe.contributionPct;
  const contribution = pe.contributionMargin;
  const valid = isMargin ? marginPct > 0 && marginPct < 100 : contribution > 0;
  const units = isMargin ? null : pe.units;
  const revenue = isMargin ? (marginPct > 0 ? totalFixed / (marginPct / 100) : null) : pe.revenue;

  // Gráfico de PE: rectas de Ingresos y Costos totales cruzándose en el punto de equilibrio.
  const chartData = useMemo(() => {
    if (isMargin || !valid || units == null || priceN <= 0) return [];
    const varUnit = costN + pe.variablePerUnit; // costo variable efectivo por unidad
    const maxU = Math.max(units * 2, 10);
    const step = maxU / 24;
    const pts: Array<{ u: number; Ingresos: number; Costos: number }> = [];
    for (let u = 0; u <= maxU + 0.0001; u += step) {
      pts.push({ u: Math.round(u), Ingresos: u * priceN, Costos: totalFixed + varUnit * u });
    }
    return pts;
  }, [isMargin, valid, units, priceN, costN, pe.variablePerUnit, totalFixed]);

  /**
   * Simulador: cubiertos los costos fijos, cada unidad de más deja el margen de contribución
   * entero. Arranca parado en el PE redondeado hacia arriba (la primera unidad que ya da ganancia).
   */
  const peUnitsCeil = units != null ? Math.ceil(units) : 0;
  const simUnits = simInput === "" ? peUnitsCeil : Math.max(0, parseFloat(simInput) || 0);
  const simMax = Math.max(peUnitsCeil * 3, 10);
  const sim = useMemo(() => {
    const revenueAt = simUnits * priceN;
    const variableAt = simUnits * (costN + pe.variablePerUnit);
    const profit = profitAtUnits(simUnits, contribution, totalFixed);
    return {
      units: simUnits,
      overBreakeven: units != null ? simUnits - units : 0,
      revenue: revenueAt,
      variableTotal: variableAt,
      profit,
      profitPct: revenueAt > 0 ? (profit / revenueAt) * 100 : 0,
    };
  }, [simUnits, priceN, costN, pe.variablePerUnit, contribution, totalFixed, units]);

  /** Escenarios rápidos por encima del punto de equilibrio. */
  const scenarios = useMemo(() => {
    if (units == null) return [];
    return [
      { label: "En el punto de equilibrio", factor: 1 },
      { label: "+10%", factor: 1.1 },
      { label: "+25%", factor: 1.25 },
      { label: "+50%", factor: 1.5 },
      { label: "El doble", factor: 2 },
    ].map((s) => {
      const u = Math.ceil(units * s.factor);
      const revenueAt = u * priceN;
      const profit = profitAtUnits(u, contribution, totalFixed);
      return {
        ...s,
        units: u,
        revenue: revenueAt,
        profit,
        profitPct: revenueAt > 0 ? (profit / revenueAt) * 100 : 0,
      };
    });
  }, [units, priceN, contribution, totalFixed]);

  const exportPdf = () => {
    if (units == null || revenue == null) return;
    const recipe = recipes.find((r) => String(r.id) === recipeId);
    const doc = buildBreakevenPdf({
      name: name.trim() || "Análisis sin nombre",
      localName: localId === "all" ? "General" : localName(parseInt(localId, 10)),
      productName: recipe?.name ?? null,
      priceNoIva: priceN,
      costNoIva: costN,
      variableCosts: appliedVariableCosts.map((c) => ({
        label: c.label || "Costo variable",
        pct: c.pct,
        base: c.base,
        ivaRate: c.ivaRate,
        amountPerUnit: variableCostAmount(c, priceN, costN),
      })),
      variablePerUnit: pe.variablePerUnit,
      contributionMargin: contribution,
      contributionPct: pe.contributionPct,
      fixedCosts: fixed
        .filter((f) => parseFloat(f.amount) > 0)
        .map((f) => {
          const { transactionCategoryId, financialGroupId } = parseFixedRef(f.ref);
          const imputation =
            financialGroupId != null
              ? `${groupName(financialGroupId)} (grupo)`
              : categoryName(transactionCategoryId) ?? "Sin imputar";
          return { imputation, label: f.label || "", amount: parseFloat(f.amount) };
        }),
      totalFixed,
      units,
      revenue,
      scenarios,
      // Solo se incluye si el usuario efectivamente movió el simulador.
      simulation: simInput === "" ? null : sim,
    });
    const slug = (name.trim() || "punto-de-equilibrio").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    doc.save(`${slug}.pdf`);
  };

  const saveVariableCost = useMutation({
    mutationFn: async (form: typeof emptyVariableCostForm) => {
      const pct = parseFloat(form.pct) || 0;
      if (!form.name.trim()) throw new Error("Poné un nombre al costo variable");
      if (pct <= 0) throw new Error("El porcentaje debe ser mayor a 0");
      const body = {
        name: form.name.trim(),
        pct,
        base: form.base,
        ivaRate: form.base === "con_iva" ? parseFloat(form.ivaRate) || 0 : undefined,
      };
      const res = form.id == null
        ? await apiRequest("POST", "/api/finance/breakeven-variable-costs", body)
        : await apiRequest("PATCH", `/api/finance/breakeven-variable-costs/${form.id}`, body);
      return res.json() as Promise<BreakevenVariableCost>;
    },
    onSuccess: (saved, form) => {
      queryClient.invalidateQueries({ queryKey: ["/api/finance/breakeven-variable-costs"] });
      // Recién creado se tilda solo: si lo cargaste es porque lo querés usar en este análisis.
      if (form.id == null && saved?.id != null) setSelectedVarIds((p) => [...p, saved.id]);
      setVarForm(null);
      toast({ title: form.id == null ? "Costo variable creado" : "Costo variable actualizado" });
    },
    onError: (e: Error) => toast({ title: "No se pudo guardar", description: e.message, variant: "destructive" }),
  });

  const deleteVariableCost = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/finance/breakeven-variable-costs/${id}`);
      return id;
    },
    onSuccess: (id) => {
      queryClient.invalidateQueries({ queryKey: ["/api/finance/breakeven-variable-costs"] });
      setSelectedVarIds((p) => p.filter((x) => x !== id));
      toast({ title: "Costo variable eliminado", description: "Los análisis ya guardados no cambian." });
    },
    onError: (e: Error) => toast({ title: "No se pudo eliminar", description: e.message, variant: "destructive" }),
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error("Poné un nombre al análisis");
      if (!valid) {
        throw new Error(isMargin ? "El margen debe estar entre 0 y 100%" : "El precio de venta debe ser mayor al costo más los costos variables");
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
        // Foto de los % aplicados: si mañana cambia el catálogo, este análisis no se mueve.
        commissions: appliedVariableCosts.map((c) => ({
          label: c.label ?? null,
          pct: c.pct,
          base: c.base,
          ivaRate: c.base === "con_iva" ? c.ivaRate ?? 0 : undefined,
        })),
        fixedCosts: fixed
          .filter((f) => parseFloat(f.amount) > 0)
          .map((f) => ({
            ...parseFixedRef(f.ref),
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
      <PageHeader title="Punto de Equilibrio" description="Costos fijos / (precio de venta − costo − costos variables), sin IVA" />

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
                  <Label className="text-xs">Costo del producto (sin IVA)</Label>
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
                <Button variant="outline" size="sm" onClick={() => setFixed((p) => [...p, { ref: "", label: "", amount: "" }])} data-testid="button-add-fixed">
                  <Plus className="h-4 w-4 mr-1" /> Agregar
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Imputalos a un grupo financiero completo o a una categoría puntual. El importe lo cargás vos.
              </p>
              {fixed.map((f, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_120px_auto] items-center gap-2">
                  <DataEntryCombobox
                    options={fixedCostOptions}
                    value={f.ref}
                    onValueChange={(v) => setFixed((p) => p.map((x, j) => (j === i ? { ...x, ref: v } : x)))}
                    placeholder="Grupo o categoría"
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
              <div className="flex justify-end border-t pt-2 text-sm">
                <span className="text-muted-foreground mr-3">Total fijos</span>
                <span className="font-mono font-semibold">{formatCurrency(totalFixed)}</span>
              </div>
            </div>

            {/* Catálogo de costos variables: se crean una vez y quedan disponibles siempre. */}
            {!isMargin && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm">Costos variables y comisiones (%)</Label>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setVarForm({ ...emptyVariableCostForm })}
                    data-testid="button-add-commission"
                  >
                    <Plus className="h-4 w-4 mr-1" /> Nuevo
                  </Button>
                </div>
                {variableCosts.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Todavía no creaste ninguno. Cargá los que te cobran por vender (Mercado Pago, IIBB, packaging…) y quedan
                    disponibles para todos tus análisis.
                  </p>
                ) : (
                  <>
                    <p className="text-xs text-muted-foreground">Tildá los que aplican a este producto.</p>
                    <div className="rounded-md border divide-y">
                      {variableCosts.map((v) => {
                        const checked = selectedVarIds.includes(v.id);
                        const base = (v.base as VariableCostBase) ?? "sin_iva";
                        const pctN = parseFloat(String(v.pct)) || 0;
                        const perUnit = variableCostAmount(
                          { pct: pctN, base, ivaRate: v.ivaRate == null ? undefined : parseFloat(String(v.ivaRate)) || 0 },
                          priceN,
                          costN,
                        );
                        return (
                          <div key={v.id} className="flex items-center gap-3 px-3 py-2">
                            <Checkbox
                              checked={checked}
                              onCheckedChange={(c) =>
                                setSelectedVarIds((p) => (c ? [...p, v.id] : p.filter((x) => x !== v.id)))
                              }
                              data-testid={`variable-cost-${v.id}`}
                            />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm truncate">{v.name}</p>
                              <p className="text-xs text-muted-foreground truncate">
                                {pctN.toFixed(2)}% · {VARIABLE_COST_BASE_LABELS[base]}
                                {base === "con_iva" && v.ivaRate != null ? ` (IVA ${parseFloat(String(v.ivaRate)).toFixed(0)}%)` : ""}
                              </p>
                            </div>
                            {checked && perUnit > 0 && (
                              <span className="font-mono text-xs text-amber-600 whitespace-nowrap">− {formatCurrency(perUnit)}</span>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() =>
                                setVarForm({
                                  id: v.id,
                                  name: v.name,
                                  pct: String(pctN),
                                  base,
                                  ivaRate: v.ivaRate == null ? "21" : String(parseFloat(String(v.ivaRate)) || 0),
                                })
                              }
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => deleteVariableCost.mutate(v.id)}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="h-fit">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="text-base flex items-center gap-2"><Target className="h-4 w-4" /> Resultado</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {!isMargin && pe.variablePerUnit > 0 && (
              <div className="flex justify-between"><span className="text-muted-foreground">Costos variables ($/u)</span><span className="font-mono text-amber-600">− {formatCurrency(pe.variablePerUnit)}</span></div>
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
            {!valid && <p className="text-xs text-red-600">{isMargin ? "El margen debe estar entre 0 y 100%." : "El precio debe superar al costo más los costos variables."}</p>}
            <Button className="w-full mt-2" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !valid} data-testid="button-save">
              <Save className="h-4 w-4 mr-2" /> {saveMutation.isPending ? "Guardando..." : "Guardar"}
            </Button>
            <Button
              variant="outline"
              className="w-full"
              onClick={exportPdf}
              disabled={isMargin || !valid || units == null}
              title={isMargin ? "El PDF se arma sobre un producto puntual" : undefined}
              data-testid="button-export-pdf"
            >
              <FileDown className="h-4 w-4 mr-2" /> Exportar PDF
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Gráfico de punto de equilibrio (rectas Ingresos vs Costos) */}
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
                  {/* Dónde te deja el simulador */}
                  {simUnits > 0 && Math.abs(simUnits - units) > 0.5 && (
                    <ReferenceLine
                      x={Math.round(simUnits)}
                      stroke="#0ea5e9"
                      strokeDasharray="4 4"
                      label={{ value: "Simulación", fontSize: 10, fill: "#0ea5e9", position: "top" }}
                    />
                  )}
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
                  <span className="text-green-600 font-medium"> ganancia</span>. El costo del producto y los costos
                  variables ya están restados del margen.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Simulador: qué pasa si vendo por encima del punto de equilibrio */}
      {!isMargin && valid && units != null && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-sky-500" /> ¿Y si vendo más?
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 lg:grid-cols-[1fr_auto] items-end">
              <div className="space-y-2">
                <Label className="text-xs">Unidades vendidas</Label>
                <Slider
                  value={[Math.min(simUnits, simMax)]}
                  min={0}
                  max={simMax}
                  step={1}
                  onValueChange={([v]) => setSimInput(String(v))}
                  data-testid="slider-sim"
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>0</span>
                  <span>PE: {peUnitsCeil}</span>
                  <span>{simMax}</span>
                </div>
              </div>
              <div className="flex items-end gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Unidades</Label>
                  <Input
                    type="number"
                    step="any"
                    className="w-32"
                    value={simInput === "" ? String(peUnitsCeil) : simInput}
                    onChange={(e) => setSimInput(e.target.value)}
                    data-testid="input-sim-units"
                  />
                </div>
                <Button variant="outline" size="sm" onClick={() => setSimInput("")}>Volver al PE</Button>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Sobre el punto de equilibrio</p>
                <p className="text-xl font-bold" data-testid="text-sim-over">
                  {sim.overBreakeven >= 0 ? "+" : ""}{sim.overBreakeven.toFixed(0)}
                  <span className="text-sm font-normal text-muted-foreground"> u.</span>
                </p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Facturación</p>
                <p className="text-xl font-bold font-mono">{formatCurrency(sim.revenue)}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Costos totales</p>
                <p className="text-xl font-bold font-mono">{formatCurrency(totalFixed + sim.variableTotal)}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {formatCurrency(totalFixed)} fijos + {formatCurrency(sim.variableTotal)} variables
                </p>
              </div>
              <div className={`rounded-lg border p-3 ${sim.profit >= 0 ? "bg-emerald-500/5 border-emerald-500/30" : "bg-red-500/5 border-red-500/30"}`}>
                <p className="text-xs text-muted-foreground">{sim.profit >= 0 ? "Ganancia" : "Pérdida"}</p>
                <p className={`text-xl font-bold font-mono ${sim.profit >= 0 ? "text-emerald-600" : "text-red-600"}`} data-testid="text-sim-profit">
                  {formatCurrency(sim.profit)}
                </p>
                <p className="text-xs text-muted-foreground mt-1">{sim.profitPct.toFixed(1)}% sobre ventas</p>
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              Pasado el punto de equilibrio los costos fijos ya están cubiertos: de cada unidad extra solo se descuentan
              el costo del producto y los costos variables, así que quedan{" "}
              <span className="font-mono font-medium">{formatCurrency(contribution)}</span> limpios por unidad.
            </p>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50">
                    <th className="text-left px-3 py-2 font-medium border-b">Escenario</th>
                    <th className="text-right px-3 py-2 font-medium border-b">Unidades</th>
                    <th className="text-right px-3 py-2 font-medium border-b">Facturación</th>
                    <th className="text-right px-3 py-2 font-medium border-b">Ganancia</th>
                    <th className="text-right px-3 py-2 font-medium border-b">% s/ventas</th>
                  </tr>
                </thead>
                <tbody>
                  {scenarios.map((s) => (
                    <tr key={s.label} className="border-b">
                      <td className="px-3 py-2">{s.label}</td>
                      <td className="px-3 py-2 text-right font-mono">{s.units}</td>
                      <td className="px-3 py-2 text-right font-mono">{formatCurrency(s.revenue)}</td>
                      <td className={`px-3 py-2 text-right font-mono font-semibold ${s.profit > 0 ? "text-emerald-600" : ""}`}>
                        {formatCurrency(s.profit)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-muted-foreground">{s.profitPct.toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
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

      {/* Alta/edición de un costo variable del catálogo */}
      <Dialog open={varForm != null} onOpenChange={(open) => !open && setVarForm(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{varForm?.id == null ? "Nuevo costo variable" : "Editar costo variable"}</DialogTitle>
          </DialogHeader>
          {varForm && (
            <div className="space-y-4">
              <div className="space-y-1">
                <Label className="text-xs">Nombre</Label>
                <Input
                  value={varForm.name}
                  onChange={(e) => setVarForm({ ...varForm, name: e.target.value })}
                  placeholder="Ej: Mercado Pago"
                  data-testid="input-variable-name"
                />
              </div>
              <div className="space-y-1 w-32">
                <Label className="text-xs">Porcentaje</Label>
                <Input
                  type="number"
                  step="any"
                  value={varForm.pct}
                  onChange={(e) => setVarForm({ ...varForm, pct: e.target.value })}
                  placeholder="3,5"
                  data-testid="input-variable-pct"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Se aplica sobre</Label>
                <RadioGroup
                  value={varForm.base}
                  onValueChange={(v) => setVarForm({ ...varForm, base: v as VariableCostBase })}
                  className="space-y-1"
                >
                  {BASE_OPTIONS.map((b) => (
                    <div key={b} className="flex items-center space-x-2">
                      <RadioGroupItem value={b} id={`base-${b}`} data-testid={`radio-base-${b}`} />
                      <Label htmlFor={`base-${b}`} className="font-normal cursor-pointer">{VARIABLE_COST_BASE_LABELS[b]}</Label>
                    </div>
                  ))}
                </RadioGroup>
              </div>
              {varForm.base === "con_iva" && (
                <div className="space-y-1 w-32">
                  <Label className="text-xs">Alícuota de IVA (%)</Label>
                  <Input
                    type="number"
                    step="any"
                    value={varForm.ivaRate}
                    onChange={(e) => setVarForm({ ...varForm, ivaRate: e.target.value })}
                    data-testid="input-variable-iva"
                  />
                  <p className="text-xs text-muted-foreground">
                    El precio se carga sin IVA, así que hace falta para reconstruir el importe sobre el que cobran.
                  </p>
                </div>
              )}
              {varForm.id != null && (
                <p className="text-xs text-muted-foreground">
                  Los análisis ya guardados conservan el porcentaje con el que se calcularon.
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setVarForm(null)}>Cancelar</Button>
            <Button
              onClick={() => varForm && saveVariableCost.mutate(varForm)}
              disabled={saveVariableCost.isPending}
              data-testid="button-save-variable"
            >
              {saveVariableCost.isPending ? "Guardando…" : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
                  <span className="text-muted-foreground">Costo (sin IVA)</span>
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
                    {detail.fixedCosts.map((f) => {
                      const imputation =
                        groupName((f as any).financialGroupId) != null
                          ? `${groupName((f as any).financialGroupId)} (grupo)`
                          : categoryName(f.transactionCategoryId);
                      return (
                        <li key={f.id} className="flex justify-between">
                          <span className="text-muted-foreground">
                            {imputation ?? f.label ?? "Sin imputar"}
                            {imputation && f.label ? ` — ${f.label}` : ""}
                          </span>
                          <span className="font-mono">{formatCurrency(parseFloat(String(f.amount)) || 0)}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              {Array.isArray((detail.analysis as any).commissions) && (detail.analysis as any).commissions.length > 0 && (
                <div>
                  <div className="flex items-center justify-between border-b pb-1 mb-2">
                    <span className="font-medium">Costos variables considerados</span>
                  </div>
                  <ul className="space-y-1">
                    {(detail.analysis as any).commissions.map((c: any, i: number) => (
                      <li key={i} className="flex justify-between">
                        <span className="text-muted-foreground">
                          {c.label || "Costo variable"} — {VARIABLE_COST_BASE_LABELS[(c.base as VariableCostBase) ?? "sin_iva"]}
                          {c.base === "con_iva" && c.ivaRate ? ` (IVA ${c.ivaRate}%)` : ""}
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
