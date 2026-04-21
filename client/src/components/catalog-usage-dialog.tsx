import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { ChefHat, ExternalLink, Layers, Package, Store } from "lucide-react";

type UsageRecipe = {
  id: number;
  name: string;
  recipeType: string | null;
  categoryName: string | null;
  subcategoryName: string | null;
};

export type SupplyUsageResponse = {
  supplyName: string;
  recipes: UsageRecipe[];
  suppliers: { id: number; name: string }[];
};

export type SubRecipeParentsResponse = {
  subRecipeName: string;
  parents: UsageRecipe[];
};

function recipeTypeLabel(t: string | null) {
  return t === "sub" ? "Sub-receta" : "Plato";
}

function RecipeUsageCard({ row }: { row: UsageRecipe }) {
  const href = row.recipeType === "sub" ? `/recetas/${row.id}?type=sub` : `/recetas/${row.id}`;
  return (
    <div className="rounded-lg border bg-muted/30 p-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          {row.recipeType === "sub" ? (
            <Layers className="h-4 w-4 shrink-0 text-orange-600" />
          ) : (
            <ChefHat className="h-4 w-4 shrink-0 text-primary" />
          )}
          <span className="font-medium truncate">{row.name}</span>
          <Badge variant="outline" className="text-[10px] shrink-0">
            {recipeTypeLabel(row.recipeType)}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground pl-6">
          {[row.categoryName, row.subcategoryName].filter(Boolean).join(" · ") || "Sin categoria"}
        </p>
      </div>
      <Link
        href={href}
        className={cn(buttonVariants({ variant: "outline", size: "sm" }), "shrink-0 gap-1 no-underline")}
      >
        <ExternalLink className="h-3.5 w-3.5" />
        Abrir
      </Link>
    </div>
  );
}

interface SupplyUsageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  supplyId: number | null;
}

export function SupplyUsageDialog({ open, onOpenChange, supplyId }: SupplyUsageDialogProps) {
  const { data, isLoading, isError, error } = useQuery<SupplyUsageResponse>({
    queryKey: ["/api/supplies", supplyId, "usages"],
    queryFn: async () => {
      const res = await fetch(`/api/supplies/${supplyId}/usages`, { credentials: "include" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { message?: string }).message || "Error al cargar usos");
      }
      return res.json();
    },
    enabled: open && supplyId != null,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Usos del insumo
          </DialogTitle>
          <DialogDescription>
            {data?.supplyName ? (
              <span className="text-foreground font-medium">{data.supplyName}</span>
            ) : isLoading ? (
              "Cargando…"
            ) : (
              "Vinculaciones en recetas y proveedores."
            )}
          </DialogDescription>
        </DialogHeader>

        {isError && (
          <p className="text-sm text-destructive">{(error as Error).message}</p>
        )}

        {data && (
          <ScrollArea className="max-h-[60vh] pr-3">
            <div className="space-y-6">
              <section>
                <h4 className="text-sm font-semibold flex items-center gap-2 mb-2">
                  <ChefHat className="h-4 w-4" />
                  Recetas y preparaciones
                  <Badge variant="secondary">{data.recipes.length}</Badge>
                </h4>
                {data.recipes.length === 0 ? (
                  <p className="text-sm text-muted-foreground border rounded-md p-3 bg-muted/20">
                    Este insumo no aparece como ingrediente en ninguna receta ni sub-receta.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {data.recipes.map((r) => (
                      <RecipeUsageCard key={r.id} row={r} />
                    ))}
                  </div>
                )}
              </section>

              <Separator />

              <section>
                <h4 className="text-sm font-semibold flex items-center gap-2 mb-2">
                  <Store className="h-4 w-4" />
                  Proveedores vinculados
                  <Badge variant="secondary">{data.suppliers.length}</Badge>
                </h4>
                {data.suppliers.length === 0 ? (
                  <p className="text-sm text-muted-foreground border rounded-md p-3 bg-muted/20">
                    Sin proveedores asignados (el insumo puede usarse con cualquier proveedor en facturas).
                  </p>
                ) : (
                  <ul className="flex flex-wrap gap-2">
                    {data.suppliers.map((s) => (
                      <li key={s.id}>
                        <Badge variant="outline" className="font-normal">
                          {s.name}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}

interface SubRecipeUsageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subRecipeId: number | null;
}

export function SubRecipeUsageDialog({ open, onOpenChange, subRecipeId }: SubRecipeUsageDialogProps) {
  const { data, isLoading, isError, error } = useQuery<SubRecipeParentsResponse>({
    queryKey: ["/api/recipes", subRecipeId, "parent-usages"],
    queryFn: async () => {
      const res = await fetch(`/api/recipes/${subRecipeId}/parent-usages`, { credentials: "include" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { message?: string }).message || "Error al cargar usos");
      }
      return res.json();
    },
    enabled: open && subRecipeId != null,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-orange-600" />
            Usos de la sub-receta
          </DialogTitle>
          <DialogDescription>
            {data?.subRecipeName ? (
              <span className="text-foreground font-medium">{data.subRecipeName}</span>
            ) : isLoading ? (
              "Cargando…"
            ) : (
              "Recetas que incluyen esta preparacion como ingrediente."
            )}
          </DialogDescription>
        </DialogHeader>

        {isError && (
          <p className="text-sm text-destructive">{(error as Error).message}</p>
        )}

        {data && (
          <ScrollArea className="max-h-[60vh] pr-3">
            <h4 className="text-sm font-semibold flex items-center gap-2 mb-2">
              <ChefHat className="h-4 w-4" />
              Donde se utiliza
              <Badge variant="secondary">{data.parents.length}</Badge>
            </h4>
            {data.parents.length === 0 ? (
              <p className="text-sm text-muted-foreground border rounded-md p-3 bg-muted/20">
                Esta sub-receta no esta referenciada en ninguna otra receta.
              </p>
            ) : (
              <div className="space-y-2">
                {data.parents.map((r) => (
                  <RecipeUsageCard key={r.id} row={r} />
                ))}
              </div>
            )}
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}
