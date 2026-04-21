import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, Link } from "wouter";
import { PageHeader } from "@/components/page-header";
import { DataTable, Column } from "@/components/data-table";
import { CodeConfirmDialog } from "@/components/code-confirm-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatCurrency, formatPercentage, formatDate } from "@/lib/formatters";
import {
  ChefHat,
  Plus,
  Eye,
  Trash2,
  TrendingUp,
  TrendingDown,
  Percent,
  Layers,
  Download,
  Search,
  Info,
} from "lucide-react";
import type { Recipe, RecipeCategory, RecipeSubcategory } from "@shared/schema";

interface RecipeWithRelations extends Recipe {
  category?: RecipeCategory | null;
  subcategory?: (RecipeSubcategory & { recipeCategory?: RecipeCategory | null }) | null;
  ingredientCount?: number;
}

function computePlatoKpis(rows: RecipeWithRelations[]) {
  const n = rows.length;
  const active = rows.filter((r) => r.active).length;
  const avg = (vals: number[]) => (vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0);
  const cmvs = rows.map((r) => parseFloat(String(r.cmvPercentage || 0)));
  const margins = rows.map((r) => parseFloat(String(r.marginPercentage || 0)));
  const markups = rows.map((r) => parseFloat(String(r.markup || 0)));
  return {
    totalRecipes: n,
    activeRecipes: active,
    inactiveRecipes: n - active,
    avgCmv: Math.round(avg(cmvs) * 100) / 100,
    avgMargin: Math.round(avg(margins) * 100) / 100,
    avgMarkup: Math.round(avg(markups) * 100) / 100,
  };
}

export default function RecipesPage() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [deleteRecipe, setDeleteRecipe] = useState<RecipeWithRelations | null>(null);
  const [searchName, setSearchName] = useState("");
  const [filterCategoryId, setFilterCategoryId] = useState<string>("__all__");
  const [filterSubcategoryId, setFilterSubcategoryId] = useState<string>("__all__");
  const [filterActive, setFilterActive] = useState<string>("__all__");

  const { data: recipes = [], isLoading } = useQuery<RecipeWithRelations[]>({
    queryKey: ["/api/recipes"],
    // Evita quedar con una lista vacia cacheada para siempre (staleTime global = Infinity).
    staleTime: 60_000,
    refetchOnMount: "always",
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

  const { data: recipeCategories = [] } = useQuery<RecipeCategory[]>({
    queryKey: ["/api/recipe-categories"],
  });

  const { data: recipeSubcategories = [] } = useQuery<
    (RecipeSubcategory & { recipeCategory?: RecipeCategory | null })[]
  >({
    queryKey: ["/api/recipe-subcategories"],
  });

  const platos = recipes.filter(r => r.recipeType !== 'sub');

  const subcategoryFilterOptions = useMemo(() => {
    if (filterCategoryId === "__all__") {
      return [...recipeSubcategories].sort((a, b) => {
        const an = a.recipeCategory?.name || "";
        const bn = b.recipeCategory?.name || "";
        if (an !== bn) return an.localeCompare(bn);
        return a.name.localeCompare(b.name);
      });
    }
    const cid = Number.parseInt(filterCategoryId, 10);
    return recipeSubcategories.filter((s) => s.recipeCategoryId === cid);
  }, [recipeSubcategories, filterCategoryId]);

  const platosStructuralFiltered = useMemo(() => {
    let rows = platos;
    if (filterCategoryId !== "__all__") {
      const cid = Number.parseInt(filterCategoryId, 10);
      rows = rows.filter(
        (r) => r.category?.id === cid || r.subcategory?.recipeCategoryId === cid,
      );
    }
    if (filterSubcategoryId !== "__all__") {
      const sid = Number.parseInt(filterSubcategoryId, 10);
      rows = rows.filter((r) => r.subcategory?.id === sid);
    }
    if (filterActive === "active") rows = rows.filter((r) => r.active);
    if (filterActive === "inactive") rows = rows.filter((r) => !r.active);
    return rows;
  }, [platos, filterCategoryId, filterSubcategoryId, filterActive]);

  const platosForTable = useMemo(() => {
    const q = searchName.trim().toLowerCase();
    if (!q) return platosStructuralFiltered;
    return platosStructuralFiltered.filter((r) => r.name.toLowerCase().includes(q));
  }, [platosStructuralFiltered, searchName]);

  const dashboardKpis = useMemo(
    () => computePlatoKpis(platosStructuralFiltered),
    [platosStructuralFiltered],
  );

  const clearRecipeFilters = () => {
    setFilterCategoryId("__all__");
    setFilterSubcategoryId("__all__");
    setFilterActive("__all__");
    setSearchName("");
  };

  const patchActiveMutation = useMutation({
    mutationFn: async ({ id, active }: { id: number; active: boolean }) => {
      await apiRequest("PATCH", `/api/recipes/${id}`, { active });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recipes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recipes/stats"] });
      toast({ title: "Estado actualizado" });
    },
    onError: (error: Error) => {
      toast({ title: "Error al actualizar estado", description: error.message, variant: "destructive" });
    },
  });

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
      className: "min-w-0 max-w-[9rem] sm:max-w-[13rem] lg:max-w-[16rem] xl:max-w-[20rem]",
      cell: (row) => (
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <ChefHat className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0">
            <div className="font-medium truncate" title={row.name}>
              {row.name}
            </div>
            <div className="text-xs text-muted-foreground truncate">
              {row.ingredientCount || 0} ingredientes
            </div>
          </div>
        </div>
      ),
    },
    {
      key: "category",
      header: "Categoria",
      hideBelow: "xl",
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
      hideBelow: "xl",
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
      className: "whitespace-nowrap",
      cell: (row) => (
        <span className="font-mono text-sm">
          {formatCurrency(row.totalCost)}
        </span>
      ),
    },
    {
      key: "salePrice",
      header: "Precio Venta",
      hideBelow: "lg",
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
      className: "whitespace-nowrap",
      cell: (row) => getCmvBadge(row.cmvPercentage),
    },
    {
      key: "marginPercentage",
      header: "Margen %",
      hideBelow: "lg",
      className: "whitespace-nowrap",
      cell: (row) => (
        <span className="font-mono text-sm text-green-600">
          {formatPercentage(row.marginPercentage)}
        </span>
      ),
    },
    {
      key: "margin",
      header: "Margen $",
      hideBelow: "xl",
      className: "whitespace-nowrap",
      cell: (row) => (
        <span className="font-mono text-sm text-green-600">
          {formatCurrency(row.margin)}
        </span>
      ),
    },
    {
      key: "markup",
      header: "Mark Up %",
      hideBelow: "2xl",
      className: "whitespace-nowrap",
      cell: (row) => (
        <span className="font-mono text-sm">
          {formatPercentage(row.markup)}
        </span>
      ),
    },
    {
      key: "cmvIdeal",
      header: "CMV Ideal %",
      hideBelow: "2xl",
      className: "whitespace-nowrap",
      cell: (row) => (
        <span className="font-mono text-sm">
          {row.cmvIdeal ? formatPercentage(row.cmvIdeal) : "-"}
        </span>
      ),
    },
    {
      key: "cmvDiff",
      header: "Dif CMV",
      hideBelow: "2xl",
      className: "whitespace-nowrap",
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
      hideBelow: "lg",
      className: "whitespace-nowrap",
      cell: (row) => <span className="font-mono text-sm">{row.ingredientCount || 0}</span>,
    },
    {
      key: "createdAt",
      header: "Creado",
      hideBelow: "lg",
      className: "whitespace-nowrap",
      cell: (row) => (
        <span className="text-sm text-muted-foreground">{formatDate(row.createdAt)}</span>
      ),
    },
    {
      key: "active",
      header: "Estado",
      className: "whitespace-nowrap",
      cell: (row) => (
        <div className="flex items-center gap-2">
          <Switch
            checked={row.active}
            disabled={patchActiveMutation.isPending}
            onCheckedChange={(checked) => patchActiveMutation.mutate({ id: row.id, active: checked })}
            data-testid={`switch-active-${row.id}`}
          />
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {row.active ? "Activo" : "Inactivo"}
          </span>
        </div>
      ),
    },
    {
      key: "actions",
      header: "",
      className: "w-24 shrink-0",
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
              {dashboardKpis.totalRecipes}
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
              {dashboardKpis.activeRecipes}
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
              {dashboardKpis.inactiveRecipes}
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
              {formatPercentage(dashboardKpis.avgCmv)}
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
              {formatPercentage(dashboardKpis.avgMargin)}
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
              {formatPercentage(dashboardKpis.avgMarkup)}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border bg-card p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar por nombre..."
              value={searchName}
              onChange={(e) => setSearchName(e.target.value)}
              className="pl-9"
              data-testid="input-recipe-search"
            />
          </div>
          <div className="flex flex-col gap-1 min-w-[180px]">
            <span className="text-xs text-muted-foreground">Categoria</span>
            <Select
              value={filterCategoryId}
              onValueChange={(v) => {
                setFilterCategoryId(v);
                setFilterSubcategoryId("__all__");
              }}
            >
              <SelectTrigger data-testid="filter-recipe-category">
                <SelectValue placeholder="Todas" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Todas las categorias</SelectItem>
                {recipeCategories.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1 min-w-[200px]">
            <span className="text-xs text-muted-foreground">Subcategoria</span>
            <Select value={filterSubcategoryId} onValueChange={setFilterSubcategoryId}>
              <SelectTrigger data-testid="filter-recipe-subcategory">
                <SelectValue placeholder="Todas" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Todas las subcategorias</SelectItem>
                {subcategoryFilterOptions.map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    {(s.recipeCategory?.name || "?") + " — " + s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1 min-w-[160px]">
            <span className="text-xs text-muted-foreground">Activo / Inactivo</span>
            <Select value={filterActive} onValueChange={setFilterActive}>
              <SelectTrigger data-testid="filter-recipe-active">
                <SelectValue placeholder="Todos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Todos</SelectItem>
                <SelectItem value="active">Solo activas</SelectItem>
                <SelectItem value="inactive">Solo inactivas</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {!isLoading && platos.length > 0 && platosStructuralFiltered.length === 0 && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>Filtros sin coincidencias</AlertTitle>
          <AlertDescription className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span>
              Hay {platos.length} recetas en total, pero ninguna cumple categoria, subcategoria o estado elegidos.
            </span>
            <Button type="button" variant="outline" size="sm" onClick={clearRecipeFilters}>
              Limpiar filtros
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {!isLoading &&
        platosStructuralFiltered.length > 0 &&
        platosForTable.length === 0 &&
        searchName.trim() !== "" && (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertTitle>Sin resultados para la busqueda</AlertTitle>
            <AlertDescription className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <span>Pruebe otro texto o borre el campo de busqueda.</span>
              <Button type="button" variant="outline" size="sm" onClick={() => setSearchName("")}>
                Borrar busqueda
              </Button>
            </AlertDescription>
          </Alert>
        )}

      <DataTable
        columns={columns}
        data={platosForTable}
        isLoading={isLoading}
        showSearch={false}
        searchKeys={["name"]}
        emptyMessage="No hay recetas registradas. Los costos se calculan automaticamente basandose en los insumos y sus ultimos precios de compra."
        pageSize={15}
        tableClassName="text-xs sm:text-sm [&_th]:px-2 [&_td]:px-2"
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
