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
import { ChefHat, Plus, Eye, Trash2, TrendingUp, TrendingDown, Percent, Layers, Download } from "lucide-react";
import type { Recipe, RecipeCategory, RecipeSubcategory } from "@shared/schema";

interface RecipeWithRelations extends Recipe {
  category?: RecipeCategory | null;
  subcategory?: (RecipeSubcategory & { recipeCategory?: RecipeCategory | null }) | null;
  ingredientCount?: number;
}

export default function RecipesPage() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [deleteRecipe, setDeleteRecipe] = useState<RecipeWithRelations | null>(null);

  const { data: recipes = [], isLoading } = useQuery<RecipeWithRelations[]>({
    queryKey: ["/api/recipes"],
  });

  const { data: stats } = useQuery<{
    totalRecipes: number;
    activeRecipes: number;
    inactiveRecipes: number;
    avgCmv: number;
    avgMargin: number;
    avgMarkup: number;
    totalSubRecipes: number;
    activeSubRecipes: number;
    inactiveSubRecipes: number;
  }>({
    queryKey: ["/api/recipes/stats"],
  });

  const platos = recipes.filter(r => r.recipeType !== 'sub');

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/recipes/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recipes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recipes/stats"] });
      toast({ title: "Receta eliminada correctamente" });
      setDeleteRecipe(null);
    },
    onError: (error: Error) => {
      toast({ title: "Error al eliminar receta", description: error.message, variant: "destructive" });
    },
  });

  const getCmvBadge = (cmv: string | null) => {
    const cmvNum = parseFloat(cmv || "0");
    if (cmvNum <= 30) {
      return (
        <Badge variant="default" className="gap-1 bg-green-500/10 text-green-600 border-green-200">
          <TrendingDown className="h-3 w-3" />
          {formatPercentage(cmv)}
        </Badge>
      );
    }
    if (cmvNum <= 40) {
      return (
        <Badge variant="secondary" className="gap-1">
          {formatPercentage(cmv)}
        </Badge>
      );
    }
    return (
      <Badge variant="destructive" className="gap-1">
        <TrendingUp className="h-3 w-3" />
        {formatPercentage(cmv)}
      </Badge>
    );
  };

  const columns: Column<RecipeWithRelations>[] = [
    {
      key: "name",
      header: "Receta",
      cell: (row) => (
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
            <ChefHat className="h-4 w-4 text-primary" />
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
      key: "category",
      header: "Categoria",
      cell: (row) =>
        row.category ? (
          <Badge variant="secondary">{row.category.name}</Badge>
        ) : (
          <span className="text-muted-foreground">-</span>
        ),
    },
    {
      key: "subcategory",
      header: "Subcategoria",
      cell: (row) =>
        row.subcategory ? (
          <Badge variant="outline">{row.subcategory.name}</Badge>
        ) : (
          <span className="text-muted-foreground">-</span>
        ),
    },
    {
      key: "totalCost",
      header: "Costo sin IVA",
      cell: (row) => (
        <span className="font-mono text-sm">
          {formatCurrency(row.totalCost)}
        </span>
      ),
    },
    {
      key: "salePrice",
      header: "Precio Venta",
      cell: (row) => (
        <div className="text-sm">
          <div className="font-mono">{formatCurrency(row.salePrice)}</div>
          {row.salePriceWithTax && (
            <div className="text-xs text-muted-foreground font-mono">
              c/IVA: {formatCurrency(row.salePriceWithTax)}
            </div>
          )}
        </div>
      ),
    },
    {
      key: "cmvPercentage",
      header: "CMV %",
      cell: (row) => getCmvBadge(row.cmvPercentage),
    },
    {
      key: "marginPercentage",
      header: "Margen %",
      cell: (row) => (
        <span className="font-mono text-sm text-green-600">
          {formatPercentage(row.marginPercentage)}
        </span>
      ),
    },
    {
      key: "margin",
      header: "Margen $",
      cell: (row) => (
        <span className="font-mono text-sm text-green-600">
          {formatCurrency(row.margin)}
        </span>
      ),
    },
    {
      key: "markup",
      header: "Mark Up %",
      cell: (row) => (
        <span className="font-mono text-sm">
          {formatPercentage(row.markup)}
        </span>
      ),
    },
    {
      key: "cmvIdeal",
      header: "CMV Ideal %",
      cell: (row) => (
        <span className="font-mono text-sm">
          {row.cmvIdeal ? formatPercentage(row.cmvIdeal) : "-"}
        </span>
      ),
    },
    {
      key: "cmvDiff",
      header: "Dif CMV",
      cell: (row) => {
        if (!row.cmvIdeal) return <span className="text-muted-foreground">-</span>;
        const diff = parseFloat(row.cmvPercentage || "0") - parseFloat(row.cmvIdeal || "0");
        return (
          <span className={`font-mono text-sm ${diff > 0 ? "text-red-600" : "text-green-600"}`}>
            {diff > 0 ? "+" : ""}{diff.toFixed(2)}%
          </span>
        );
      },
    },
    {
      key: "ingredientCount",
      header: "Ingred.",
      cell: (row) => <span className="font-mono text-sm">{row.ingredientCount || 0}</span>,
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
          {row.active ? "Activo" : "Inactivo"}
        </Badge>
      ),
    },
    {
      key: "actions",
      header: "",
      className: "w-24",
      cell: (row) => (
        <div className="flex items-center gap-1">
          <Link href={`/recetas/${row.id}`}>
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
        title="Carta, Costos y Recetas"
        description="Gestiona tus recetas, sub-recetas y costos de platos"
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <Link href="/sub-recetas">
              <Button variant="outline" data-testid="button-sub-recipes">
                <Layers className="h-4 w-4 mr-2" />
                Sub-Recetas ({stats?.totalSubRecipes || 0})
              </Button>
            </Link>
            <Button
              variant="outline"
              onClick={() => window.open("/api/recipes/export", "_blank")}
              data-testid="button-export-recipes"
            >
              <Download className="h-4 w-4 mr-2" />
              Exportar Carta
            </Button>
            <Button onClick={() => navigate("/recetas/nueva")} data-testid="button-new-recipe">
              <Plus className="h-4 w-4 mr-2" />
              Nueva Receta
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">Total Recetas</CardTitle>
            <ChefHat className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono" data-testid="stat-total">
              {stats?.totalRecipes || 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">Activas</CardTitle>
            <ChefHat className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-green-600" data-testid="stat-active">
              {stats?.activeRecipes || 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">Inactivas</CardTitle>
            <ChefHat className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono" data-testid="stat-inactive">
              {stats?.inactiveRecipes || 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">CMV Promedio %</CardTitle>
            <Percent className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono" data-testid="stat-avg-cmv">
              {formatPercentage(stats?.avgCmv || 0)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">Margen Promedio %</CardTitle>
            <TrendingUp className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-green-600" data-testid="stat-avg-margin">
              {formatPercentage(stats?.avgMargin || 0)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">Markup Promedio %</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono" data-testid="stat-avg-markup">
              {formatPercentage(stats?.avgMarkup || 0)}
            </div>
          </CardContent>
        </Card>
      </div>

      <DataTable
        columns={columns}
        data={platos}
        isLoading={isLoading}
        searchPlaceholder="Buscar por nombre..."
        searchKeys={["name"]}
        emptyMessage="No hay recetas registradas. Los costos se calculan automaticamente basandose en los insumos y sus ultimos precios de compra."
        pageSize={15}
      />

      <CodeConfirmDialog
        open={!!deleteRecipe}
        onOpenChange={(open) => !open && setDeleteRecipe(null)}
        title="Eliminar Receta"
        description={`¿Esta seguro que desea eliminar la receta "${deleteRecipe?.name}"? Esta accion no se puede deshacer.`}
        confirmCode="ELIMINAR"
        confirmLabel="Eliminar"
        onConfirm={() => deleteRecipe && deleteMutation.mutate(deleteRecipe.id)}
        isLoading={deleteMutation.isPending}
      />
    </div>
  );
}
