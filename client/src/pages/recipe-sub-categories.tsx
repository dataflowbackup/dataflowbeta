import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { PageHeader } from "@/components/page-header";
import { DataTable, Column, FilterConfig } from "@/components/data-table";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Edit, Trash2, Layers } from "lucide-react";
import type { RecipeCategory, RecipeSubcategory } from "@shared/schema";

interface RecipeSubcategoryWithParent extends RecipeSubcategory {
  recipeCategory?: RecipeCategory | null;
}

const formSchema = z.object({
  name: z.string().min(1, "El nombre es requerido"),
  recipeCategoryId: z.coerce.number().min(1, "Debe seleccionar una categoria"),
  description: z.string().optional(),
});

type FormData = z.infer<typeof formSchema>;

export default function RecipeSubCategoriesPage() {
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editing, setEditing] = useState<RecipeSubcategoryWithParent | null>(null);
  const [deleting, setDeleting] = useState<RecipeSubcategoryWithParent | null>(null);

  const { data: subcategories = [], isLoading } = useQuery<RecipeSubcategoryWithParent[]>({
    queryKey: ["/api/recipe-subcategories"],
  });

  const { data: categories = [] } = useQuery<RecipeCategory[]>({
    queryKey: ["/api/recipe-categories"],
  });

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      recipeCategoryId: undefined,
      description: "",
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: FormData) => {
      const res = await apiRequest("POST", "/api/recipe-subcategories", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recipe-subcategories"] });
      toast({ title: "Subcategoria creada correctamente" });
      closeDialog();
    },
    onError: (error: Error) => {
      toast({ title: "Error al crear subcategoria", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: FormData }) => {
      const res = await apiRequest("PATCH", `/api/recipe-subcategories/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recipe-subcategories"] });
      toast({ title: "Subcategoria actualizada correctamente" });
      closeDialog();
    },
    onError: (error: Error) => {
      toast({ title: "Error al actualizar subcategoria", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/recipe-subcategories/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recipe-subcategories"] });
      toast({ title: "Subcategoria eliminada correctamente" });
      setDeleting(null);
    },
    onError: (error: Error) => {
      toast({ title: "Error al eliminar subcategoria", description: error.message, variant: "destructive" });
    },
  });

  const openCreate = () => {
    setEditing(null);
    form.reset({ name: "", recipeCategoryId: undefined, description: "" });
    setIsDialogOpen(true);
  };

  const openEdit = (row: RecipeSubcategoryWithParent) => {
    setEditing(row);
    form.reset({
      name: row.name,
      recipeCategoryId: row.recipeCategoryId,
      description: row.description || "",
    });
    setIsDialogOpen(true);
  };

  const closeDialog = () => {
    setIsDialogOpen(false);
    setEditing(null);
    form.reset();
  };

  const onSubmit = (data: FormData) => {
    if (editing) {
      updateMutation.mutate({ id: editing.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const columns: Column<RecipeSubcategoryWithParent>[] = [
    {
      key: "name",
      header: "Nombre",
      cell: (row) => (
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
            <Layers className="h-4 w-4 text-primary" />
          </div>
          <span className="font-medium">{row.name}</span>
        </div>
      ),
    },
    {
      key: "recipeCategory",
      header: "Categoria padre",
      cell: (row) => (
        <Badge variant="secondary" data-testid={`badge-parent-${row.id}`}>
          {row.recipeCategory?.name || "-"}
        </Badge>
      ),
    },
    {
      key: "description",
      header: "Descripcion",
      cell: (row) => (
        <span className="text-muted-foreground">{row.description || "-"}</span>
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
      cell: (row) => (
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={() => openEdit(row)} data-testid={`button-edit-${row.id}`}>
            <Edit className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setDeleting(row)}
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
        title="Subcategorias de recetas"
        description="Cada subcategoria pertenece a una categoria de receta (padre). Las recetas se clasifican por subcategoria."
      />

      <DataTable
        columns={columns}
        data={subcategories}
        isLoading={isLoading}
        searchPlaceholder="Buscar por nombre..."
        searchKeys={["name"]}
        filters={
          [
            {
              key: "recipeCategoryId",
              label: "Categoria",
              allLabel: "Todas las categorias",
              options: categories.map((c) => ({ value: String(c.id), label: c.name })),
            },
            {
              key: "active",
              label: "Estado",
              allLabel: "Todos los estados",
              options: [
                { value: "true", label: "Activo" },
                { value: "false", label: "Inactivo" },
              ],
            },
          ] as FilterConfig<RecipeSubcategoryWithParent>[]
        }
        onAdd={openCreate}
        addLabel="Nueva subcategoria"
        emptyMessage="No hay subcategorias registradas"
      />

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar subcategoria" : "Nueva subcategoria"}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="recipeCategoryId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Categoria padre *</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value?.toString()}>
                      <FormControl>
                        <SelectTrigger data-testid="select-recipe-category">
                          <SelectValue placeholder="Seleccionar categoria" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {categories
                          .filter((c) => c.active)
                          .map((c) => (
                            <SelectItem key={c.id} value={c.id.toString()}>
                              {c.name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nombre *</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Ej: Pastas, Parrilla" data-testid="input-name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Descripcion</FormLabel>
                    <FormControl>
                      <Textarea {...field} placeholder="Opcional" data-testid="input-description" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="flex justify-end gap-2 pt-4">
                <Button type="button" variant="outline" onClick={closeDialog}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                  {editing ? "Guardar" : "Crear"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Eliminar subcategoria"
        description={`¿Eliminar la subcategoria "${deleting?.name}"? No debe estar en uso por ninguna receta.`}
        onConfirm={() => deleting && deleteMutation.mutate(deleting.id)}
        isLoading={deleteMutation.isPending}
      />
    </div>
  );
}
