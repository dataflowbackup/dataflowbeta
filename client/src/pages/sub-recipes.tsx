import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, Link } from "wouter";
import { PageHeader } from "@/components/page-header";
import { DataTable, Column } from "@/components/data-table";
import { CodeConfirmDialog } from "@/components/code-confirm-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatCurrency, formatPercentage, formatDate } from "@/lib/formatters";
import { Layers, Plus, Eye, Trash2, ArrowLeft } from "lucide-react";
import type { Recipe, RecipeCategory, RecipeSubcategory, UnitOfMeasure } from "@shared/schema";

interface RecipeWithRelations extends Recipe {
  category?: RecipeCategory | null;
  subcategory?: (RecipeSubcategory & { recipeCategory?: RecipeCategory | null }) | null;
  ingredientCount?: number;
  yieldUnitName?: string;
}

export default function SubRecipesPage() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [deleteRecipe, setDeleteRecipe] = useState<RecipeWithRelations | null>(null);

  const { data: recipes = [], isLoading } = useQuery<RecipeWithRelations[]>({
    queryKey: ["/api/recipes"],
  });

  const { data: stats } = useQuery<{
    totalSubRecipes: number;
    activeSubRecipes: number;
    inactiveSubRecipes: number;
  }>({
    queryKey: ["/api/recipes/stats"],
  });

  const { data: units = [] } = useQuery<UnitOfMeasure[]>({
    queryKey: ["/api/units"],
  });

  const subRecipes = recipes.filter(r => r.recipeType === 'sub');

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/recipes/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recipes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recipes/stats"] });
      toast({ title: "Sub-receta eliminada correctamente" });
      setDeleteRecipe(null);
    },
    onError: (error: Error) => {
      toast({ title: "Error al eliminar sub-receta", description: error.message, variant: "destructive" });
    },
  });

  const getUnitCost = (recipe: RecipeWithRelations) => {
    const totalCost = parseFloat(String(recipe.totalCost) || "0");
    const yield_ = parseFloat(String(recipe.usefulYield) || "0");
    if (yield_ > 0) return totalCost / yield_;
    return totalCost;
  };

  const getWastePercentage = (recipe: RecipeWithRelations) => {
    return recipe.marginPercentage ? parseFloat(String(recipe.marginPercentage)) : null;
  };

  const columns: Column<RecipeWithRelations>[] = [
    {
      key: "category",
      header: "Subcategoria",
      cell: (row) =>
        row.subcategory ? (
          <div className="flex flex-col gap-0.5">
            <Badge variant="secondary">{row.subcategory.recipeCategory?.name || "Produccion"}</Badge>
            <span className="text-xs text-muted-foreground">{row.subcategory.name}</span>
          </div>
        ) : (
          <Badge variant="secondary">Produccion</Badge>
        ),
    },
    {
      key: "name",
      header: "Sub-Receta",
      cell: (row) => (
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-500/10">
            <Layers className="h-4 w-4 text-orange-600" />
          </div>
          <div>
            <div className="font-medium">{row.name}</div>
            <div className="text-xs text-muted-foreground">
              {row.ingredientCount || 0} ingredientes
            </div>
          </div>
        </div>
      ),
    },
    {
      key: "totalCost",
      header: "Costo sin IVA",
      cell: (row) => (
        <span className="font-mono text-sm">{formatCurrency(row.totalCost)}</span>
      ),
    },
    {
      key: "yieldUnit",
      header: "Unidad de Medida",
      cell: (row) => {
        if (row.yieldUnit) {
          const unit = units.find(u => u.abbreviation === row.yieldUnit || u.name === row.yieldUnit);
          return <span className="text-sm">{unit?.name || row.yieldUnit}</span>;
        }
        return <span className="text-muted-foreground text-sm">-</span>;
      },
    },
    {
      key: "unitCost",
      header: "Costo x UM",
      cell: (row) => (
        <span className="font-mono text-sm">{formatCurrency(getUnitCost(row))}</span>
      ),
    },
    {
      key: "wastePercentage",
      header: "% Merma",
      cell: (row) => {
        const waste = getWastePercentage(row);
        return waste !== null ? (
          <span className="font-mono text-sm">{waste.toFixed(2)}%</span>
        ) : (
          <span className="text-muted-foreground text-sm">-</span>
        );
      },
    },
    {
      key: "ingredientCount",
      header: "Ingredientes",
      cell: (row) => <span className="font-mono">{row.ingredientCount || 0}</span>,
    },
    {
      key: "createdAt",
      header: "Creado",
      cell: (row) => (
        <span className="text-sm text-muted-foreground">{formatDate(row.createdAt)}</span>
      ),
    },
    {
      key: "active",
      header: "Estado",
      cell: (row) => (
        <Badge variant={row.active ? "default" : "secondary"}>
          {row.active ? "Activa" : "Inactiva"}
        </Badge>
      ),
    },
    {
      key: "actions",
      header: "",
      className: "w-24",
      cell: (row) => (
        <div className="flex items-center gap-1">
          <Link href={`/recetas/${row.id}?type=sub`}>
            <Button variant="ghost" size="icon" data-testid={`button-view-${row.id}`}>
              <Eye className="h-4 w-4" />
            </Button>
          </Link>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setDeleteRecipe(row)}
            data-testid={`button-delete-${row.id}`}
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sub-Recetas"
        description="Producciones intermedias que se usan como ingredientes en recetas"
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <Link href="/recetas">
              <Button variant="outline" data-testid="button-back-recipes">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Volver a Recetas
              </Button>
            </Link>
            <Button onClick={() => navigate("/recetas/nueva?type=sub")} data-testid="button-new-sub-recipe">
              <Plus className="h-4 w-4 mr-2" />
              Nueva Sub-Receta
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">Total Sub-Recetas</CardTitle>
            <Layers className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono" data-testid="stat-total-sub">{stats?.totalSubRecipes || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">Activas</CardTitle>
            <Layers className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-green-600" data-testid="stat-active-sub">{stats?.activeSubRecipes || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">Inactivas</CardTitle>
            <Layers className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono" data-testid="stat-inactive-sub">{stats?.inactiveSubRecipes || 0}</div>
          </CardContent>
        </Card>
      </div>

      <DataTable
        columns={columns}
        data={subRecipes}
        isLoading={isLoading}
        searchPlaceholder="Buscar sub-receta..."
        searchKeys={["name"]}
        emptyMessage="No hay sub-recetas registradas. Las sub-recetas son producciones intermedias (ej: masa, salsa) que se usan como ingredientes."
        pageSize={15}
      />

      <CodeConfirmDialog
        open={!!deleteRecipe}
        onOpenChange={(open) => !open && setDeleteRecipe(null)}
        title="Eliminar Sub-Receta"
        description={`¿Esta seguro que desea eliminar la sub-receta "${deleteRecipe?.name}"? Esta accion no se puede deshacer.`}
        confirmCode="ELIMINAR"
        confirmLabel="Eliminar"
        onConfirm={() => deleteRecipe && deleteMutation.mutate(deleteRecipe.id)}
        isLoading={deleteMutation.isPending}
      />
    </div>
  );
}
