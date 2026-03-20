import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { PageHeader } from "@/components/page-header";
import { DataTable, Column } from "@/components/data-table";
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
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Edit, Trash2, FolderOpen, ArrowUp, ArrowDown } from "lucide-react";
import type { RecipeCategory } from "@shared/schema";

const formSchema = z.object({
  name: z.string().min(1, "El nombre es requerido"),
  description: z.string().optional(),
  displayOrder: z.coerce.number().min(0).default(0),
});

type FormData = z.infer<typeof formSchema>;

export default function RecipeCategoriesPage() {
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<RecipeCategory | null>(null);
  const [deleteCategory, setDeleteCategory] = useState<RecipeCategory | null>(null);

  const { data: categories = [], isLoading } = useQuery<RecipeCategory[]>({
    queryKey: ["/api/recipe-categories"],
  });

  const sortedCategories = [...categories].sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0));

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      description: "",
      displayOrder: 0,
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: FormData) => {
      const res = await apiRequest("POST", "/api/recipe-categories", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recipe-categories"] });
      toast({ title: "Categoria creada correctamente" });
      closeDialog();
    },
    onError: (error: Error) => {
      toast({ title: "Error al crear categoria", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<FormData> }) => {
      const res = await apiRequest("PATCH", `/api/recipe-categories/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recipe-categories"] });
      toast({ title: "Categoria actualizada correctamente" });
      closeDialog();
    },
    onError: (error: Error) => {
      toast({ title: "Error al actualizar categoria", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/recipe-categories/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recipe-categories"] });
      toast({ title: "Categoria eliminada correctamente" });
      setDeleteCategory(null);
    },
    onError: (error: Error) => {
      toast({ title: "Error al eliminar categoria", description: error.message, variant: "destructive" });
    },
  });

  const moveCategory = (category: RecipeCategory, direction: "up" | "down") => {
    const idx = sortedCategories.findIndex(c => c.id === category.id);
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= sortedCategories.length) return;

    const currentOrder = sortedCategories[idx].displayOrder || 0;
    const swapOrder = sortedCategories[swapIdx].displayOrder || 0;

    updateMutation.mutate({ id: category.id, data: { displayOrder: swapOrder } });
    updateMutation.mutate({ id: sortedCategories[swapIdx].id, data: { displayOrder: currentOrder } });
  };

  const openCreate = () => {
    setEditingCategory(null);
    form.reset({ name: "", description: "", displayOrder: sortedCategories.length });
    setIsDialogOpen(true);
  };

  const openEdit = (category: RecipeCategory) => {
    setEditingCategory(category);
    form.reset({
      name: category.name,
      description: category.description || "",
      displayOrder: category.displayOrder || 0,
    });
    setIsDialogOpen(true);
  };

  const closeDialog = () => {
    setIsDialogOpen(false);
    setEditingCategory(null);
    form.reset();
  };

  const onSubmit = (data: FormData) => {
    if (editingCategory) {
      updateMutation.mutate({ id: editingCategory.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const columns: Column<RecipeCategory>[] = [
    {
      key: "displayOrder",
      header: "Orden",
      className: "w-24",
      cell: (row) => {
        const idx = sortedCategories.findIndex(c => c.id === row.id);
        return (
          <div className="flex items-center gap-1">
            <span className="font-mono text-sm text-muted-foreground w-6">{idx + 1}</span>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => moveCategory(row, "up")}
              disabled={idx === 0}
              data-testid={`button-move-up-${row.id}`}
            >
              <ArrowUp className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => moveCategory(row, "down")}
              disabled={idx === sortedCategories.length - 1}
              data-testid={`button-move-down-${row.id}`}
            >
              <ArrowDown className="h-3 w-3" />
            </Button>
          </div>
        );
      },
    },
    {
      key: "name",
      header: "Nombre",
      cell: (row) => (
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
            <FolderOpen className="h-4 w-4 text-primary" />
          </div>
          <span className="font-medium">{row.name}</span>
        </div>
      ),
    },
    {
      key: "description",
      header: "Descripcion (Menu Digital)",
      cell: (row) => row.description || <span className="text-muted-foreground">-</span>,
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
          <Button
            variant="ghost"
            size="icon"
            onClick={() => openEdit(row)}
            data-testid={`button-edit-${row.id}`}
          >
            <Edit className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setDeleteCategory(row)}
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
        title="Categorias de Recetas"
        description="Organiza tus recetas por categorias. El orden se refleja en el menu digital."
      />

      <DataTable
        columns={columns}
        data={sortedCategories}
        isLoading={isLoading}
        searchPlaceholder="Buscar por nombre..."
        searchKeys={["name"]}
        onAdd={openCreate}
        addLabel="Nueva Categoria"
        emptyMessage="No hay categorias registradas"
      />

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingCategory ? "Editar Categoria" : "Nueva Categoria"}
            </DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nombre *</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Ej: Hamburguesas" data-testid="input-name" />
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
                    <FormLabel>Descripcion (visible en menu digital)</FormLabel>
                    <FormControl>
                      <Textarea {...field} placeholder="Descripcion de la categoria para el menu" rows={3} data-testid="input-description" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="displayOrder"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Orden de visualizacion</FormLabel>
                    <FormControl>
                      <Input type="number" min="0" {...field} className="font-mono" data-testid="input-order" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="flex justify-end gap-2 pt-4">
                <Button type="button" variant="outline" onClick={closeDialog} data-testid="button-cancel">
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  disabled={createMutation.isPending || updateMutation.isPending}
                  data-testid="button-submit"
                >
                  {createMutation.isPending || updateMutation.isPending
                    ? "Guardando..."
                    : editingCategory
                    ? "Actualizar"
                    : "Crear"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteCategory}
        onOpenChange={(open) => !open && setDeleteCategory(null)}
        title="Eliminar Categoria"
        description={`¿Esta seguro que desea eliminar la categoria "${deleteCategory?.name}"? Esta accion no se puede deshacer.`}
        confirmLabel="Eliminar"
        onConfirm={() => deleteCategory && deleteMutation.mutate(deleteCategory.id)}
        variant="destructive"
        isLoading={deleteMutation.isPending}
      />
    </div>
  );
}
