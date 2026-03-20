import { useState, useEffect, useMemo, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm, useFieldArray, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useLocation, useParams } from "wouter";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatCurrency, formatPercentage, formatNumber } from "@/lib/formatters";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Trash2, TrendingUp, DollarSign, Percent, Package, ChefHat, Upload, Image, Check } from "lucide-react";
import type { RecipeCategory, Supply, UnitOfMeasure, Recipe } from "@shared/schema";

interface SupplyWithUnit extends Supply {
  unitOfMeasure?: UnitOfMeasure | null;
}

interface RecipeWithCategory extends Recipe {
  category?: RecipeCategory | null;
}

const ingredientSchema = z.object({
  type: z.enum(["supply", "subrecipe"]).default("supply"),
  supplyId: z.coerce.number().optional(),
  subRecipeId: z.coerce.number().optional(),
  quantityTotal: z.coerce.number().min(0.0001, "Cantidad requerida"),
  quantityUseful: z.coerce.number().min(0).default(0),
  wastePercentage: z.coerce.number().min(0).max(100).default(0),
});

const formSchema = z.object({
  name: z.string().min(1, "El nombre es requerido"),
  categoryId: z.coerce.number().optional(),
  description: z.string().optional(),
  preparationSteps: z.string().optional(),
  salePriceWithTax: z.coerce.number().min(0).default(0),
  cmvIdeal: z.coerce.number().min(0).max(100).optional(),
  usefulYield: z.coerce.number().optional(),
  yieldUnit: z.string().optional(),
  ingredients: z.array(ingredientSchema).min(1, "Debe agregar al menos un ingrediente"),
});

type FormData = z.infer<typeof formSchema>;

export default function RecipeFormPage() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const params = useParams<{ id: string }>();
  const isEditing = params.id && params.id !== "nueva";
  const searchParams = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  const isSubRecipeFromQuery = searchParams.get("type") === "sub";
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [wasteMethod, setWasteMethod] = useState<"individual" | "total">("individual");
  const [confirmedIngredients, setConfirmedIngredients] = useState<Set<number>>(new Set());

  const { data: existingRecipe } = useQuery<Recipe & { ingredients?: Array<{
    id: number;
    supplyId?: number | null;
    subRecipeId?: number | null;
    quantityTotal: string | number;
    quantityUseful?: string | number | null;
    quantityWithWaste: string | number;
    wastePercentage?: string | number | null;
  }> }>({
    queryKey: ["/api/recipes", params.id],
    enabled: !!isEditing,
  });

  const isSubRecipe = isSubRecipeFromQuery || (existingRecipe?.recipeType === "sub");

  const { data: categories = [] } = useQuery<RecipeCategory[]>({
    queryKey: ["/api/recipe-categories"],
  });

  const produccionCategoryId = useMemo(() => {
    const prod = categories.find(c => c.name.toLowerCase() === "produccion" || c.name.toLowerCase() === "producción");
    return prod?.id;
  }, [categories]);

  const { data: supplies = [] } = useQuery<SupplyWithUnit[]>({
    queryKey: ["/api/supplies"],
  });

  const { data: units = [] } = useQuery<UnitOfMeasure[]>({
    queryKey: ["/api/units"],
  });

  const { data: subRecipes = [] } = useQuery<RecipeWithCategory[]>({
    queryKey: ["/api/recipes"],
    select: (data: RecipeWithCategory[]) => data.filter((r: RecipeWithCategory) => r.recipeType === "sub" && r.active),
  });

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      categoryId: undefined,
      description: "",
      preparationSteps: "",
      salePriceWithTax: 0,
      cmvIdeal: undefined,
      usefulYield: undefined,
      yieldUnit: "",
      ingredients: [{ type: "supply", supplyId: 0, subRecipeId: undefined, quantityTotal: 1, quantityUseful: 0, wastePercentage: 0 }],
    },
  });

  useEffect(() => {
    if (existingRecipe) {
      const loadedIngredients = existingRecipe.ingredients && existingRecipe.ingredients.length > 0
        ? existingRecipe.ingredients.map(ing => ({
            type: (ing.subRecipeId ? "subrecipe" : "supply") as "supply" | "subrecipe",
            supplyId: ing.supplyId || undefined,
            subRecipeId: ing.subRecipeId || undefined,
            quantityTotal: parseFloat(String(ing.quantityTotal)) || 0,
            quantityUseful: parseFloat(String(ing.quantityUseful || 0)),
            wastePercentage: parseFloat(String(ing.wastePercentage || 0)),
          }))
        : [{ type: "supply" as const, supplyId: 0, subRecipeId: undefined, quantityTotal: 1, quantityUseful: 0, wastePercentage: 0 }];

      form.reset({
        name: existingRecipe.name,
        categoryId: existingRecipe.categoryId || undefined,
        description: existingRecipe.description || "",
        preparationSteps: existingRecipe.preparationSteps || "",
        salePriceWithTax: parseFloat(String(existingRecipe.salePriceWithTax) || "0"),
        cmvIdeal: existingRecipe.cmvIdeal ? parseFloat(String(existingRecipe.cmvIdeal)) : undefined,
        usefulYield: existingRecipe.usefulYield ? parseFloat(String(existingRecipe.usefulYield)) : undefined,
        yieldUnit: existingRecipe.yieldUnit || "",
        ingredients: loadedIngredients,
      });

      if (loadedIngredients.length > 0) {
        const confirmed = new Set<number>();
        loadedIngredients.forEach((ing, idx) => {
          if ((ing.type === "supply" && ing.supplyId && ing.supplyId > 0) ||
              (ing.type === "subrecipe" && ing.subRecipeId && Number(ing.subRecipeId) > 0)) {
            confirmed.add(idx);
          }
        });
        setConfirmedIngredients(confirmed);
      }

      if (existingRecipe.photoUrl) {
        setPhotoPreview(existingRecipe.photoUrl);
      }
    }
  }, [existingRecipe]);

  const { fields: ingredientFields, append: appendIngredient, remove: removeIngredient } = useFieldArray({
    control: form.control,
    name: "ingredients",
  });

  const watchIngredients = useWatch({
    control: form.control,
    name: "ingredients",
  });
  const watchSalePriceWithTax = useWatch({
    control: form.control,
    name: "salePriceWithTax",
  });
  const watchCmvIdeal = useWatch({
    control: form.control,
    name: "cmvIdeal",
  });
  const watchUsefulYield = useWatch({
    control: form.control,
    name: "usefulYield",
  });

  const getIngredientUnitCost = (ing: FormData["ingredients"][number]) => {
    if (ing.type === "subrecipe" && ing.subRecipeId) {
      const sr = subRecipes.find((r) => r.id === Number(ing.subRecipeId));
      if (sr) return parseFloat(String(sr.totalCost) || "0");
    }
    if (ing.supplyId) {
      const supply = supplies.find((s) => s.id === Number(ing.supplyId));
      if (supply) return parseFloat(String(supply.unitCost) || "0");
    }
    return 0;
  };

  const getIngredientCost = (index: number) => {
    const ing = watchIngredients[index];
    if (!ing) return 0;
    const unitCost = getIngredientUnitCost(ing);
    const qty = Number(ing.quantityTotal) || 0;
    return unitCost * qty;
  };

  const calculations = useMemo(() => {
    // Costo total = suma de (costo unitario x cantidad) de cada ingrediente valido
    let totalCost = 0;
    watchIngredients.forEach((ing, idx) => {
      const hasValid =
        (ing.type === "subrecipe" && ing.subRecipeId && Number(ing.subRecipeId) > 0) ||
        (ing.type === "supply" && ing.supplyId && Number(ing.supplyId) > 0);
      if (!hasValid) return;
      totalCost += getIngredientCost(idx);
    });

    const salePriceWithTax = watchSalePriceWithTax || 0;
    const salePrice = salePriceWithTax / 1.21;
    const cmvPercentage = salePrice > 0 ? (totalCost / salePrice) * 100 : 0;
    const margin = salePrice - totalCost;
    const marginPercentage = salePrice > 0 ? (margin / salePrice) * 100 : 0;
    const markup = totalCost > 0 ? ((salePrice - totalCost) / totalCost) * 100 : 0;
    const cmvIdeal = watchCmvIdeal || 0;
    const cmvDiff = cmvIdeal > 0 ? cmvPercentage - cmvIdeal : 0;

    return {
      totalCost,
      salePrice,
      salePriceWithTax,
      cmvPercentage,
      margin,
      marginPercentage,
      markup,
      cmvIdeal,
      cmvDiff,
    };
  }, [watchIngredients, watchSalePriceWithTax, watchCmvIdeal, supplies, subRecipes]);

  const subRecipeWasteCalc = useMemo(() => {
    if (!isSubRecipe) return null;

    const totalWeight = watchIngredients.reduce((sum, ing) => {
      const qty = Number(ing.quantityTotal) || 0;
      return sum + qty;
    }, 0);

    const usefulYieldNum = Number(watchUsefulYield) || 0;
    const wasteByTotal =
      totalWeight > 0 && usefulYieldNum > 0
        ? ((totalWeight - usefulYieldNum) / totalWeight) * 100
        : 0;

    const individualWastes = watchIngredients
      .map((ing) => {
        const qtyTotal = Number(ing.quantityTotal) || 0;
        const qtyUseful = Number(ing.quantityUseful) || 0;
        if (qtyTotal <= 0 || qtyUseful <= 0) return null;
        return ((qtyTotal - qtyUseful) / qtyTotal) * 100;
      })
      .filter((v): v is number => v !== null);

    const avgWaste =
      individualWastes.length > 0
        ? individualWastes.reduce((a, b) => a + b, 0) / individualWastes.length
        : 0;

    return { totalWeight, wasteByTotal, avgWaste };
  }, [isSubRecipe, watchIngredients, watchUsefulYield]);

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setPhotoFile(file);
      const reader = new FileReader();
      reader.onload = () => setPhotoPreview(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const createMutation = useMutation({
    mutationFn: async (data: FormData) => {
      const salePrice = (data.salePriceWithTax || 0) / 1.21;
      const totalCost = calculations.totalCost;
      const ingredients = data.ingredients
        .filter(ing => {
          if (ing.type === "subrecipe") return ing.subRecipeId && Number(ing.subRecipeId) > 0;
          return ing.supplyId && Number(ing.supplyId) > 0;
        })
        .map(ing => {
          const qtyTotal = Number(ing.quantityTotal) || 0;
          const qtyUseful = Number(ing.quantityUseful ?? 0) || null;
          const unitCost = getIngredientUnitCost(ing);
          const lineTotal = unitCost * qtyTotal;

          return {
            supplyId: ing.type === "supply" ? ing.supplyId : undefined,
            subRecipeId: ing.type === "subrecipe" ? ing.subRecipeId : undefined,
            quantityTotal: qtyTotal,
            quantityUseful: qtyUseful,
            quantityWithWaste: qtyTotal,
            wastePercentage: ing.wastePercentage ?? 0,
            unitCostAtCreation: unitCost,
            currentCost: unitCost,
            totalCost: lineTotal,
          };
        });

      const wasteForSubRecipe = isSubRecipe && subRecipeWasteCalc
        ? (wasteMethod === "total" ? subRecipeWasteCalc.wasteByTotal : subRecipeWasteCalc.avgWaste)
        : 0;

      const effectiveCategoryId = isSubRecipe ? (produccionCategoryId || data.categoryId) : data.categoryId;

      const payload = {
        name: data.name,
        categoryId: effectiveCategoryId,
        description: data.description,
        preparationSteps: data.preparationSteps,
        salePrice: isSubRecipe ? 0 : salePrice,
        salePriceWithTax: isSubRecipe ? 0 : data.salePriceWithTax,
        cmvIdeal: data.cmvIdeal,
        usefulYield: data.usefulYield,
        yieldUnit: data.yieldUnit,
        recipeType: isSubRecipe ? "sub" : "plato",
        totalCost,
        cmvPercentage: isSubRecipe ? 0 : calculations.cmvPercentage,
        margin: isSubRecipe ? 0 : calculations.margin,
        marginPercentage: isSubRecipe ? wasteForSubRecipe : calculations.marginPercentage,
        markup: isSubRecipe ? 0 : calculations.markup,
        ingredients,
      };

      const method = isEditing ? "PATCH" : "POST";
      const url = isEditing ? `/api/recipes/${params.id}` : "/api/recipes";
      const res = await apiRequest(method, url, payload);
      return res.json();
    },
    onSuccess: async (data) => {
      const recipeId = data?.id || params.id;
      if (photoFile && recipeId) {
        const formData = new FormData();
        formData.append("photo", photoFile);
        await fetch(`/api/recipes/${recipeId}/photo`, {
          method: "POST",
          body: formData,
          credentials: "include",
        });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/recipes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recipes/stats"] });
      if (isEditing) {
        queryClient.invalidateQueries({ queryKey: ["/api/recipes", params.id] });
      }
      toast({ title: isSubRecipe
        ? (isEditing ? "Sub-receta actualizada" : "Sub-receta creada correctamente")
        : (isEditing ? "Receta actualizada" : "Receta creada correctamente")
      });
      navigate(isSubRecipe ? "/sub-recetas" : "/recetas");
    },
    onError: (error: Error) => {
      toast({ title: "Error al guardar", description: error.message, variant: "destructive" });
    },
  });

  const onSubmit = (data: FormData) => {
    const validIngredients = data.ingredients.filter(ing => {
      if (ing.type === "subrecipe") return ing.subRecipeId && Number(ing.subRecipeId) > 0;
      return ing.supplyId && Number(ing.supplyId) > 0;
    });
    if (validIngredients.length === 0) {
      toast({ title: "Debe agregar al menos un ingrediente con insumo seleccionado", variant: "destructive" });
      return;
    }
    createMutation.mutate(data);
  };

  const handleIngredientWasteCalc = (index: number) => {
    const ing = watchIngredients[index];
    if (ing && ing.quantityTotal > 0 && ing.quantityUseful > 0) {
      const waste = ((ing.quantityTotal - ing.quantityUseful) / ing.quantityTotal) * 100;
      form.setValue(`ingredients.${index}.wastePercentage`, Math.round(waste * 100) / 100);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={isSubRecipe ? "Nueva Sub-Receta" : (isEditing ? "Editar Receta" : "Nueva Receta")}
        description={isSubRecipe ? "Configure los ingredientes y costos de la sub-receta" : "Configure los ingredientes y costos de la receta"}
        backHref={isSubRecipe ? "/sub-recetas" : "/recetas"}
      />

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2 space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Informacion {isSubRecipe ? "de la Sub-Receta" : "del Plato"}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormField
                      control={form.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Nombre *</FormLabel>
                          <FormControl>
                            <Input {...field} placeholder={isSubRecipe ? "Ej: Salsa Bolognesa" : "Ej: Hamburguesa Completa"} data-testid="input-name" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="categoryId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Categoria {isSubRecipe && <Badge variant="secondary" className="ml-1">Produccion</Badge>}</FormLabel>
                          {isSubRecipe ? (
                            <Input value="Produccion" disabled className="bg-muted" data-testid="select-category" />
                          ) : (
                            <Select
                              onValueChange={field.onChange}
                              value={field.value?.toString() || ""}
                            >
                              <FormControl>
                                <SelectTrigger data-testid="select-category">
                                  <SelectValue placeholder="Seleccionar categoria" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {categories.filter(c => c.active).map((cat) => (
                                  <SelectItem key={cat.id} value={cat.id.toString()}>
                                    {cat.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <FormField
                    control={form.control}
                    name="description"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Descripcion {!isSubRecipe && "(visible al escanear carta)"}</FormLabel>
                        <FormControl>
                          <Textarea {...field} placeholder={isSubRecipe ? "Descripcion de la sub-receta..." : "Descripcion del plato para el menu digital..."} rows={2} data-testid="input-description" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {!isSubRecipe && (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <FormField
                        control={form.control}
                        name="salePriceWithTax"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Precio de Venta (CON IVA) *</FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                step="0.01"
                                min="0"
                                {...field}
                                className="font-mono"
                                data-testid="input-sale-price"
                              />
                            </FormControl>
                            <p className="text-xs text-muted-foreground font-mono">
                              Sin IVA: {formatCurrency(calculations.salePrice)}
                            </p>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="cmvIdeal"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>CMV Ideal %</FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                step="0.01"
                                min="0"
                                max="100"
                                {...field}
                                className="font-mono"
                                placeholder="Ej: 30"
                                data-testid="input-cmv-ideal"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  )}

                  <div className="flex items-center gap-4">
                    <div className="flex-1">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        onChange={handlePhotoChange}
                        className="hidden"
                        data-testid="input-photo"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => fileInputRef.current?.click()}
                        data-testid="button-upload-photo"
                      >
                        <Upload className="h-4 w-4 mr-2" />
                        {photoPreview ? "Cambiar foto" : "Subir foto"}
                      </Button>
                    </div>
                    {photoPreview && (
                      <div className="h-16 w-16 rounded-md overflow-hidden border">
                        <img src={photoPreview} alt="Preview" className="h-full w-full object-cover" />
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Paso a Paso</CardTitle>
                </CardHeader>
                <CardContent>
                  <FormField
                    control={form.control}
                    name="preparationSteps"
                    render={({ field }) => (
                      <FormItem>
                        <FormControl>
                          <Textarea
                            {...field}
                            placeholder="Escriba el procedimiento paso a paso para la cocina..."
                            rows={5}
                            data-testid="input-preparation-steps"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between gap-2">
                  <CardTitle>Ingredientes / Materia Prima</CardTitle>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => appendIngredient({ type: "supply", supplyId: 0, subRecipeId: undefined, quantityTotal: 1, quantityUseful: 0, wastePercentage: 0 })}
                      data-testid="button-add-ingredient"
                    >
                      <Package className="h-4 w-4 mr-1" />
                      Insumo
                    </Button>
                    {!isSubRecipe && subRecipes.length > 0 && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => appendIngredient({ type: "subrecipe", supplyId: undefined, subRecipeId: 0, quantityTotal: 1, quantityUseful: 0, wastePercentage: 0 })}
                        data-testid="button-add-subrecipe"
                      >
                        <ChefHat className="h-4 w-4 mr-1" />
                        Sub-Receta
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {ingredientFields.map((field, index) => {
                    const ing = watchIngredients[index];
                    const isSubRecipeIng = ing?.type === "subrecipe";
                    const supplyId = Number(ing?.supplyId) || 0;
                    const supply = supplies.find(s => s.id === supplyId);
                    const subRecipe = isSubRecipeIng ? subRecipes.find(r => r.id === Number(ing?.subRecipeId)) : null;
                    const unitCostDisplay = isSubRecipeIng
                      ? (subRecipe ? parseFloat(String(subRecipe.totalCost) || "0") : 0)
                      : parseFloat(String(supply?.unitCost) || "0");
                    
                    const isConfirmed = confirmedIngredients.has(index);
                    const hasValidItem = isSubRecipeIng
                      ? (ing?.subRecipeId && Number(ing.subRecipeId) > 0)
                      : (ing?.supplyId && Number(ing.supplyId) > 0);
                    
                    return (
                      <div key={field.id} className={`grid gap-3 p-4 rounded-lg border transition-colors ${isConfirmed ? "border-green-400 dark:border-green-700 bg-green-50/30 dark:bg-green-950/10" : isSubRecipeIng ? "bg-blue-50/30 dark:bg-blue-950/10 border-blue-200 dark:border-blue-900" : "bg-muted/30"}`}>
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <div className="flex items-center gap-2">
                            {isSubRecipeIng ? (
                              <Badge variant="secondary" className="gap-1">
                                <ChefHat className="h-3 w-3" />
                                Sub-Receta
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="gap-1">
                                <Package className="h-3 w-3" />
                                Insumo
                              </Badge>
                            )}
                            {!isSubRecipeIng && supply?.unitOfMeasure && (
                              <Badge variant="secondary" className="font-mono text-xs">
                                {supply.unitOfMeasure.abbreviation}
                              </Badge>
                            )}
                            {isConfirmed && (
                              <Badge variant="default" className="gap-1 bg-green-600">
                                <Check className="h-3 w-3" />
                                Confirmado
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-1">
                            {hasValidItem && !isConfirmed && (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => setConfirmedIngredients(prev => new Set(prev).add(index))}
                                data-testid={`button-confirm-ingredient-${index}`}
                              >
                                <Check className="h-3 w-3 mr-1" />
                                Confirmar
                              </Button>
                            )}
                            {ingredientFields.length > 1 && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() => {
                                  removeIngredient(index);
                                  setConfirmedIngredients(prev => {
                                    const next = new Set<number>();
                                    prev.forEach(i => { if (i < index) next.add(i); else if (i > index) next.add(i - 1); });
                                    return next;
                                  });
                                }}
                                data-testid={`button-remove-ingredient-${index}`}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            )}
                          </div>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          {isSubRecipeIng ? (
                            <FormField
                              control={form.control}
                              name={`ingredients.${index}.subRecipeId`}
                              render={({ field: ingField }) => (
                                <FormItem>
                                  <FormLabel>Sub-Receta *</FormLabel>
                                  <Select
                                    onValueChange={ingField.onChange}
                                    value={ingField.value?.toString() || ""}
                                  >
                                    <FormControl>
                                      <SelectTrigger data-testid={`select-subrecipe-${index}`}>
                                        <SelectValue placeholder="Seleccionar sub-receta" />
                                      </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                      {subRecipes.map((sr) => (
                                        <SelectItem key={sr.id} value={sr.id.toString()}>
                                          <div className="flex items-center gap-2">
                                            <ChefHat className="h-3 w-3" />
                                            {sr.name}
                                            <Badge variant="outline" className="ml-1 font-mono text-xs">
                                              {formatCurrency(sr.totalCost)}/u
                                            </Badge>
                                          </div>
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          ) : (
                            <FormField
                              control={form.control}
                              name={`ingredients.${index}.supplyId`}
                              render={({ field: ingField }) => (
                                <FormItem>
                                  <FormLabel>Insumo *</FormLabel>
                                  <Select
                                    onValueChange={ingField.onChange}
                                    value={ingField.value?.toString() || ""}
                                  >
                                    <FormControl>
                                      <SelectTrigger data-testid={`select-supply-${index}`}>
                                        <SelectValue placeholder="Seleccionar insumo" />
                                      </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                      {supplies.filter(s => s.active).map((supply) => (
                                        <SelectItem key={supply.id} value={supply.id.toString()}>
                                          <div className="flex items-center gap-2">
                                            <Package className="h-3 w-3" />
                                            {supply.name}
                                            {supply.unitOfMeasure && (
                                              <Badge variant="outline" className="ml-1 font-mono text-xs">
                                                {formatCurrency(supply.unitCost)}/{supply.unitOfMeasure.abbreviation}
                                              </Badge>
                                            )}
                                          </div>
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          )}
                          <FormField
                            control={form.control}
                            name={`ingredients.${index}.quantityTotal`}
                            render={({ field: ingField }) => (
                              <FormItem>
                                <FormLabel>Cantidad Total Necesaria</FormLabel>
                                <FormControl>
                                  <Input
                                    type="number"
                                    step="0.0001"
                                    min="0"
                                    {...ingField}
                                    className="font-mono"
                                    data-testid={`input-quantity-${index}`}
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>
                        <div className="grid gap-3 sm:grid-cols-4">
                          {!isSubRecipeIng && (
                            <FormField
                              control={form.control}
                              name={`ingredients.${index}.quantityUseful`}
                              render={({ field: ingField }) => (
                                <FormItem>
                                  <FormLabel>Cantidad Util Final</FormLabel>
                                  <FormControl>
                                    <Input
                                      type="number"
                                      step="0.0001"
                                      min="0"
                                      {...ingField}
                                      className="font-mono"
                                      onChange={(e) => {
                                        ingField.onChange(e);
                                        setTimeout(() => handleIngredientWasteCalc(index), 100);
                                      }}
                                      data-testid={`input-useful-${index}`}
                                    />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          )}
                          {!isSubRecipeIng && (
                            <div>
                              <FormLabel>% Merma</FormLabel>
                              <div className="h-9 min-h-9 px-3 py-2 rounded-md border bg-muted font-mono text-sm flex items-center" data-testid={`display-waste-${index}`}>
                                {(() => {
                                  const i = watchIngredients[index];
                                  if (i && i.quantityTotal > 0 && i.quantityUseful > 0) {
                                    const w = ((i.quantityTotal - i.quantityUseful) / i.quantityTotal) * 100;
                                    return `${w.toFixed(2)}%`;
                                  }
                                  return "0%";
                                })()}
                              </div>
                            </div>
                          )}
                          <div>
                            <FormLabel>Costo Unitario</FormLabel>
                            <div className="h-9 min-h-9 px-3 py-2 rounded-md border bg-muted font-mono text-sm flex items-center">
                              {formatCurrency(unitCostDisplay)}
                            </div>
                          </div>
                          <div>
                            <FormLabel>Costo Total</FormLabel>
                            <div className="h-9 min-h-9 px-3 py-2 rounded-md border bg-primary/5 font-mono text-sm flex items-center font-medium">
                              {formatCurrency(getIngredientCost(index))}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>

              {isSubRecipe && (
                <Card>
                  <CardHeader>
                    <CardTitle>Relleno Util y Merma de Sub-Receta</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <FormField
                        control={form.control}
                        name="usefulYield"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Peso/Volumen Util Final</FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                step="0.01"
                                min="0"
                                {...field}
                                className="font-mono"
                                placeholder="Peso final de la sub-receta"
                                data-testid="input-useful-yield"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="yieldUnit"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Unidad de Medida</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value || ""}>
                              <FormControl>
                                <SelectTrigger data-testid="select-yield-unit">
                                  <SelectValue placeholder="Seleccionar unidad" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {units.filter(u => u.active).map((u) => (
                                  <SelectItem key={u.id} value={u.abbreviation || u.name}>
                                    {u.name} ({u.abbreviation})
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    <div className="space-y-2">
                      <FormLabel>Metodo de calculo de merma</FormLabel>
                      <Tabs value={wasteMethod} onValueChange={(v) => setWasteMethod(v as "individual" | "total")}>
                        <TabsList data-testid="tabs-waste-method">
                          <TabsTrigger value="individual" data-testid="tab-waste-individual">
                            Promedio individual
                          </TabsTrigger>
                          <TabsTrigger value="total" data-testid="tab-waste-total">
                            Peso total vs final
                          </TabsTrigger>
                        </TabsList>
                      </Tabs>
                      {subRecipeWasteCalc && (
                        <div className="p-3 rounded-md bg-muted/50 space-y-1">
                          {wasteMethod === "individual" ? (
                            <>
                              <p className="text-sm">Promedio de merma individual de cada materia prima:</p>
                              <p className="font-mono font-medium">{subRecipeWasteCalc.avgWaste.toFixed(2)}%</p>
                            </>
                          ) : (
                            <>
                              <p className="text-sm">Peso total materias primas: <span className="font-mono">{subRecipeWasteCalc.totalWeight.toFixed(2)}</span></p>
                              <p className="text-sm">Peso util final: <span className="font-mono">{(watchUsefulYield || 0).toFixed(2)}</span></p>
                              <p className="text-sm">% Merma: <span className="font-mono font-medium">{subRecipeWasteCalc.wasteByTotal.toFixed(2)}%</span></p>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>

            <div>
              <Card className="sticky top-6">
                <CardHeader>
                  <CardTitle>Analisis {isSubRecipe ? "de Costos" : "de Rentabilidad"}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-3">
                    <div className="flex justify-between items-center p-3 rounded-lg bg-muted/50">
                      <div className="flex items-center gap-2 text-sm">
                        <Package className="h-4 w-4 text-muted-foreground" />
                        Costo sin IVA
                      </div>
                      <span className="font-mono font-medium">
                        {formatCurrency(calculations.totalCost)}
                      </span>
                    </div>

                    {!isSubRecipe && (
                      <>
                        <div className="flex justify-between items-center p-3 rounded-lg bg-muted/50">
                          <div className="flex items-center gap-2 text-sm">
                            <DollarSign className="h-4 w-4 text-muted-foreground" />
                            Precio Venta (sin IVA)
                          </div>
                          <span className="font-mono font-medium">
                            {formatCurrency(calculations.salePrice)}
                          </span>
                        </div>

                        <div className="flex justify-between items-center p-3 rounded-lg bg-muted/50">
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <DollarSign className="h-4 w-4" />
                            Precio c/IVA (21%)
                          </div>
                          <span className="font-mono text-muted-foreground">
                            {formatCurrency(calculations.salePriceWithTax)}
                          </span>
                        </div>
                      </>
                    )}
                  </div>

                  {!isSubRecipe && (
                    <>
                      <Separator />
                      <div className="space-y-3">
                        <div className="flex justify-between items-center p-3 rounded-lg border">
                          <div className="flex items-center gap-2 text-sm">
                            <Percent className="h-4 w-4 text-muted-foreground" />
                            CMV %
                          </div>
                          <Badge 
                            variant={calculations.cmvPercentage <= 30 ? "default" : calculations.cmvPercentage <= 40 ? "secondary" : "destructive"}
                            className="font-mono"
                          >
                            {formatPercentage(calculations.cmvPercentage)}
                          </Badge>
                        </div>

                        {calculations.cmvIdeal > 0 && (
                          <div className="flex justify-between items-center p-3 rounded-lg border">
                            <div className="flex items-center gap-2 text-sm">
                              <Percent className="h-4 w-4 text-muted-foreground" />
                              Dif CMV vs Ideal
                            </div>
                            <span className={`font-mono font-medium ${calculations.cmvDiff > 0 ? "text-red-600" : "text-green-600"}`}>
                              {calculations.cmvDiff > 0 ? "+" : ""}{calculations.cmvDiff.toFixed(2)}%
                            </span>
                          </div>
                        )}

                        <div className="flex justify-between items-center p-3 rounded-lg border border-green-200 bg-green-50 dark:bg-green-950/20">
                          <div className="flex items-center gap-2 text-sm">
                            <TrendingUp className="h-4 w-4 text-green-600" />
                            Margen $
                          </div>
                          <span className="font-mono font-medium text-green-600">
                            {formatCurrency(calculations.margin)}
                          </span>
                        </div>

                        <div className="flex justify-between items-center p-3 rounded-lg border">
                          <div className="flex items-center gap-2 text-sm">
                            <Percent className="h-4 w-4 text-muted-foreground" />
                            Margen %
                          </div>
                          <span className="font-mono font-medium">
                            {formatPercentage(calculations.marginPercentage)}
                          </span>
                        </div>

                        <div className="flex justify-between items-center p-3 rounded-lg border">
                          <div className="flex items-center gap-2 text-sm">
                            <TrendingUp className="h-4 w-4 text-muted-foreground" />
                            Mark Up %
                          </div>
                          <span className="font-mono font-medium">
                            {formatPercentage(calculations.markup)}
                          </span>
                        </div>
                      </div>
                    </>
                  )}

                  {isSubRecipe && subRecipeWasteCalc && (
                    <>
                      <Separator />
                      <div className="space-y-3">
                        <div className="flex justify-between items-center p-3 rounded-lg border">
                          <div className="text-sm">% Merma Sub-Receta</div>
                          <span className="font-mono font-medium">
                            {(wasteMethod === "total" ? subRecipeWasteCalc.wasteByTotal : subRecipeWasteCalc.avgWaste).toFixed(2)}%
                          </span>
                        </div>
                        {watchUsefulYield && Number(watchUsefulYield) > 0 && (
                          <div className="flex justify-between items-center p-3 rounded-lg border">
                            <div className="text-sm">Costo x UM</div>
                            <span className="font-mono font-medium">
                              {formatCurrency(calculations.totalCost / Number(watchUsefulYield))}
                            </span>
                          </div>
                        )}
                      </div>
                    </>
                  )}

                  <Separator />

                  <div className="text-xs text-muted-foreground p-3 rounded-lg bg-muted/30">
                    <p className="mb-1 font-medium">Formulas utilizadas:</p>
                    <ul className="space-y-1">
                      {!isSubRecipe && (
                        <>
                          <li>Precio sin IVA = Precio c/IVA / 1.21</li>
                          <li>CMV% = (Costo MP / Precio sin IVA) x 100</li>
                          <li>Margen $ = Precio sin IVA - Costo MP</li>
                          <li>Margen % = Margen / Precio sin IVA x 100</li>
                          <li>Mark Up = ((PV - Costo) / Costo) x 100</li>
                        </>
                      )}
                      {isSubRecipe && (
                        <>
                          <li>Costo x UM = Costo Total / Peso Util</li>
                          <li>% Merma = (Total - Util) / Total x 100</li>
                        </>
                      )}
                    </ul>
                  </div>

                  <div className="pt-4 space-y-2">
                    <Button
                      type="submit"
                      className="w-full"
                      disabled={createMutation.isPending}
                      data-testid="button-submit"
                    >
                      {createMutation.isPending ? "Guardando..." : (isSubRecipe ? "Guardar Sub-Receta" : "Guardar Receta")}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full"
                      onClick={() => navigate(isSubRecipe ? "/sub-recetas" : "/recetas")}
                      data-testid="button-cancel"
                    >
                      Cancelar
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </form>
      </Form>
    </div>
  );
}
