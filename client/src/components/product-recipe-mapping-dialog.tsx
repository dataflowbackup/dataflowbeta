import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { DataEntryCombobox } from "@/components/data-entry-combobox";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatNumber } from "@/lib/formatters";
import { Check, Sparkles } from "lucide-react";
import type { Recipe } from "@shared/schema";

interface SoldProductMapping {
  producto: string;
  categoria: string | null;
  cantidad: number;
  currentRecipeId: number | null;
  currentRecipeName: string | null;
  suggestedRecipeId: number | null;
  suggestedRecipeName: string | null;
  suggestedScore: number | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source: string;
  dateFrom?: string;
  dateTo?: string;
  localId?: string;
}

/**
 * Asignar receta a cada producto vendido. Es la precondición del Consumo: un producto sin
 * receta no consume nada, así que acá se ve qué falta y cuánto pesa.
 *
 * La sugerencia por parecido de nombre es sólo una propuesta — se guarda lo que la persona
 * confirma, nunca la sugerencia sola.
 */
export function ProductRecipeMappingDialog({ open, onOpenChange, source, dateFrom, dateTo, localId }: Props) {
  const { toast } = useToast();
  const [drafts, setDrafts] = useState<Record<string, number | null>>({});
  const [search, setSearch] = useState("");
  const [onlyUnmapped, setOnlyUnmapped] = useState(true);

  const params = new URLSearchParams({ source });
  if (dateFrom) params.set("dateFrom", dateFrom);
  if (dateTo) params.set("dateTo", dateTo);
  if (localId && localId !== "all") params.set("localId", localId);
  const listKey = `/api/supplies/product-mappings?${params.toString()}`;

  const { data: products = [], isLoading } = useQuery<SoldProductMapping[]>({
    queryKey: [listKey],
    enabled: open,
  });

  const { data: recipes = [] } = useQuery<Recipe[]>({
    queryKey: ["/api/recipes"],
    enabled: open,
  });

  // Al reabrir, los cambios sin guardar se descartan: el diálogo arranca limpio.
  useEffect(() => {
    if (open) {
      setDrafts({});
      setSearch("");
    }
  }, [open]);

  const recipeOptions = useMemo(
    () => [
      { value: "none", label: "— Sin receta —" },
      ...recipes
        .filter((r) => r.active !== false)
        .map((r) => ({ value: String(r.id), label: r.name })),
    ],
    [recipes],
  );

  const effectiveRecipeId = (p: SoldProductMapping): number | null =>
    p.producto in drafts ? drafts[p.producto] : p.currentRecipeId;

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return products.filter((p) => {
      if (onlyUnmapped && effectiveRecipeId(p) != null && !(p.producto in drafts)) return false;
      if (term && !p.producto.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [products, search, onlyUnmapped, drafts]);

  const suggestable = useMemo(
    () => products.filter((p) => p.currentRecipeId == null && p.suggestedRecipeId != null),
    [products],
  );

  const pendingCount = Object.keys(drafts).length;

  const saveMutation = useMutation({
    mutationFn: async () => {
      const entries = Object.entries(drafts).map(([productName, recipeId]) => ({ productName, recipeId }));
      return apiRequest("POST", "/api/supplies/product-mappings", { source, entries });
    },
    onSuccess: async () => {
      toast({ title: "Recetas asignadas", description: `${pendingCount} producto(s) actualizados.` });
      setDrafts({});
      await queryClient.invalidateQueries({ queryKey: [listKey] });
      // El consumo cambia con cada mapeo nuevo.
      await queryClient.invalidateQueries({
        predicate: (q) => String(q.queryKey[0] ?? "").startsWith("/api/supplies/consumption"),
      });
    },
    onError: (error: Error) => {
      toast({ title: "No se pudo guardar", description: error.message, variant: "destructive" });
    },
  });

  const acceptAllSuggestions = () => {
    const next = { ...drafts };
    for (const p of suggestable) next[p.producto] = p.suggestedRecipeId;
    setDrafts(next);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Recetas por producto vendido</DialogTitle>
          <DialogDescription>
            Un producto sin receta no consume insumos. Asigná la receta de cada uno para que el consumo sea
            completo — están ordenados por volumen vendido, así lo que más pesa aparece primero.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder="Buscar producto…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-64"
            data-testid="input-search-mapping"
          />
          <Button
            variant={onlyUnmapped ? "default" : "outline"}
            size="sm"
            onClick={() => setOnlyUnmapped((v) => !v)}
            data-testid="button-toggle-unmapped"
          >
            Sólo sin receta
          </Button>
          {suggestable.length > 0 && (
            <Button variant="outline" size="sm" onClick={acceptAllSuggestions} data-testid="button-accept-suggestions">
              <Sparkles className="h-4 w-4 mr-2" />
              Aceptar {suggestable.length} sugerencia(s)
            </Button>
          )}
          <div className="ml-auto text-sm text-muted-foreground">
            {products.length} producto(s) · {products.filter((p) => p.currentRecipeId == null).length} sin receta
          </div>
        </div>

        <div className="flex-1 overflow-y-auto border rounded-md">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">Cargando…</div>
          ) : visible.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              {onlyUnmapped ? "Todos los productos tienen receta asignada." : "No hay productos para mostrar."}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/50 backdrop-blur">
                <tr>
                  <th className="text-left p-2 font-medium">Producto vendido</th>
                  <th className="text-right p-2 font-medium w-24">Unidades</th>
                  <th className="text-left p-2 font-medium w-72">Receta</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((p) => {
                  const current = effectiveRecipeId(p);
                  const isDraft = p.producto in drafts;
                  return (
                    <tr key={p.producto} className="border-t">
                      <td className="p-2">
                        <div className="font-medium">{p.producto}</div>
                        {p.suggestedRecipeName && current == null && (
                          <button
                            type="button"
                            className="text-xs text-primary hover:underline flex items-center gap-1 mt-0.5"
                            onClick={() => setDrafts({ ...drafts, [p.producto]: p.suggestedRecipeId })}
                            data-testid={`button-suggest-${p.producto}`}
                          >
                            <Sparkles className="h-3 w-3" />
                            Sugerido: {p.suggestedRecipeName}
                            <span className="text-muted-foreground">
                              ({((p.suggestedScore ?? 0) * 100).toFixed(0)}%)
                            </span>
                          </button>
                        )}
                      </td>
                      <td className="p-2 text-right font-mono">{formatNumber(p.cantidad, 0)}</td>
                      <td className="p-2">
                        <div className="flex items-center gap-1">
                          <DataEntryCombobox
                            options={recipeOptions}
                            value={current == null ? "none" : String(current)}
                            onValueChange={(v) =>
                              setDrafts({ ...drafts, [p.producto]: v === "none" || !v ? null : parseInt(v, 10) })
                            }
                            placeholder="Elegir receta…"
                            searchPlaceholder="Buscar receta…"
                            triggerClassName="w-full"
                            data-testid={`select-recipe-${p.producto}`}
                          />
                          {isDraft && (
                            <Badge variant="secondary" className="shrink-0">
                              <Check className="h-3 w-3" />
                            </Badge>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          <span className="text-sm text-muted-foreground mr-auto">
            {pendingCount > 0 ? `${pendingCount} cambio(s) sin guardar` : "Sin cambios"}
          </span>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cerrar
          </Button>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={pendingCount === 0 || saveMutation.isPending}
            data-testid="button-save-mappings"
          >
            {saveMutation.isPending ? "Guardando…" : "Guardar"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
