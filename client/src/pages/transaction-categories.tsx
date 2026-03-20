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
import { Switch } from "@/components/ui/switch";
import { Edit, Trash2, TrendingUp, TrendingDown, Tags, Star } from "lucide-react";
import type { TransactionCategory, FinancialGroup } from "@shared/schema";

interface CategoryWithGroup extends TransactionCategory {
  financialGroup?: FinancialGroup | null;
}

const categoryTypes = [
  { value: "income", label: "Ingreso" },
  { value: "expense", label: "Egreso" },
];

const specialTypes = [
  { value: "costo_mercaderia", label: "Costo Mercadería" },
  { value: "gastos_fijos", label: "Gastos Fijos" },
  { value: "gastos_variables", label: "Gastos Variables" },
  { value: "sueldos", label: "Sueldos y Cargas Sociales" },
  { value: "impuestos", label: "Impuestos" },
  { value: "amortizaciones", label: "Amortizaciones" },
  { value: "ventas", label: "Ventas" },
  { value: "otros_ingresos", label: "Otros Ingresos" },
];

const formSchema = z.object({
  name: z.string().min(1, "El nombre es requerido"),
  type: z.string().min(1, "El tipo es requerido"),
  financialGroupId: z.coerce.number().optional().nullable(),
  isSpecial: z.boolean().default(false),
  specialType: z.string().optional(),
}).refine((data) => {
  if (data.isSpecial && !data.specialType) {
    return false;
  }
  return true;
}, {
  message: "Debe seleccionar un tipo para EE.RR.",
  path: ["specialType"],
});

type FormData = z.infer<typeof formSchema>;

export default function TransactionCategoriesPage() {
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<CategoryWithGroup | null>(null);
  const [deleteCategory, setDeleteCategory] = useState<CategoryWithGroup | null>(null);

  const { data: categories = [], isLoading } = useQuery<CategoryWithGroup[]>({
    queryKey: ["/api/transaction-categories"],
  });

  const { data: financialGroups = [] } = useQuery<FinancialGroup[]>({
    queryKey: ["/api/financial-groups"],
  });

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      type: "expense",
      financialGroupId: undefined,
      isSpecial: false,
      specialType: undefined,
    },
  });

  const watchIsSpecial = form.watch("isSpecial");

  const createMutation = useMutation({
    mutationFn: async (data: FormData) => {
      const res = await apiRequest("POST", "/api/transaction-categories", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/transaction-categories"] });
      toast({ title: "Categoria creada correctamente" });
      closeDialog();
    },
    onError: (error: Error) => {
      toast({ title: "Error al crear categoria", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: FormData }) => {
      const res = await apiRequest("PATCH", `/api/transaction-categories/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/transaction-categories"] });
      toast({ title: "Categoria actualizada correctamente" });
      closeDialog();
    },
    onError: (error: Error) => {
      toast({ title: "Error al actualizar categoria", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/transaction-categories/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/transaction-categories"] });
      toast({ title: "Categoria eliminada correctamente" });
      setDeleteCategory(null);
    },
    onError: (error: Error) => {
      toast({ title: "Error al eliminar categoria", description: error.message, variant: "destructive" });
    },
  });

  const openCreate = () => {
    setEditingCategory(null);
    form.reset({ name: "", type: "expense", financialGroupId: undefined, isSpecial: false, specialType: undefined });
    setIsDialogOpen(true);
  };

  const openEdit = (category: CategoryWithGroup) => {
    if (category.isSystem) {
      toast({ title: "No editable", description: "Las categorías del sistema no se pueden editar", variant: "destructive" });
      return;
    }
    setEditingCategory(category);
    form.reset({
      name: category.name,
      type: category.type,
      financialGroupId: category.financialGroupId || undefined,
      isSpecial: category.isSpecial || false,
      specialType: category.specialType || undefined,
    });
    setIsDialogOpen(true);
  };

  const closeDialog = () => {
    setIsDialogOpen(false);
    setEditingCategory(null);
    form.reset();
  };

  const onSubmit = (data: FormData) => {
    const cleanedData = {
      ...data,
      specialType: data.isSpecial ? data.specialType : undefined,
    };
    if (editingCategory) {
      updateMutation.mutate({ id: editingCategory.id, data: cleanedData });
    } else {
      createMutation.mutate(cleanedData);
    }
  };

  const columns: Column<CategoryWithGroup>[] = [
    {
      key: "name",
      header: "Nombre",
      cell: (row) => (
        <div className="flex items-center gap-2">
          <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${
            row.type === "income" ? "bg-green-500/10" : "bg-red-500/10"
          }`}>
            {row.type === "income" ? (
              <TrendingUp className="h-4 w-4 text-green-600" />
            ) : (
              <TrendingDown className="h-4 w-4 text-red-600" />
            )}
          </div>
          <span className="font-medium">{row.name}</span>
        </div>
      ),
    },
    {
      key: "type",
      header: "Tipo",
      cell: (row) => (
        <Badge variant={row.type === "income" ? "default" : "secondary"}>
          {row.type === "income" ? "Ingreso" : "Egreso"}
        </Badge>
      ),
    },
    {
      key: "financialGroup",
      header: "Grupo Financiero",
      cell: (row) => {
        const group = financialGroups.find(g => g.id === row.financialGroupId);
        return group ? (
          <Badge variant="outline">{group.name}</Badge>
        ) : (
          <span className="text-muted-foreground">-</span>
        );
      },
    },
    {
      key: "isSpecial",
      header: "EE.RR.",
      cell: (row) =>
        row.isSpecial ? (
          <div className="flex items-center gap-1">
            <Star className="h-4 w-4 text-amber-500 fill-amber-500" />
            <Badge variant="outline" className="text-xs">
              {specialTypes.find(s => s.value === row.specialType)?.label || row.specialType}
            </Badge>
          </div>
        ) : (
          <span className="text-muted-foreground">-</span>
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

  const incomeCategories = categories.filter(c => c.type === "income");
  const expenseCategories = categories.filter(c => c.type === "expense");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Categorias de Movimientos"
        description="Gestiona las categorias para clasificar ingresos y egresos"
      />

      <div className="grid gap-4 md:grid-cols-2">
        <div className="p-4 rounded-lg border bg-green-50 dark:bg-green-950/20">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="h-5 w-5 text-green-600" />
            <span className="font-medium text-green-700 dark:text-green-400">Ingresos</span>
          </div>
          <p className="text-2xl font-bold text-green-600">{incomeCategories.length}</p>
          <p className="text-sm text-muted-foreground">categorias</p>
        </div>
        <div className="p-4 rounded-lg border bg-red-50 dark:bg-red-950/20">
          <div className="flex items-center gap-2 mb-2">
            <TrendingDown className="h-5 w-5 text-red-600" />
            <span className="font-medium text-red-700 dark:text-red-400">Egresos</span>
          </div>
          <p className="text-2xl font-bold text-red-600">{expenseCategories.length}</p>
          <p className="text-sm text-muted-foreground">categorias</p>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={categories}
        isLoading={isLoading}
        searchPlaceholder="Buscar por nombre..."
        searchKeys={["name"]}
        onAdd={openCreate}
        addLabel="Nueva Categoria"
        emptyMessage="No hay categorias registradas. Agrega categorias para clasificar tus movimientos."
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
                      <Input {...field} placeholder="Ej: Ventas Efectivo" data-testid="input-name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="type"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Tipo *</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-type">
                            <SelectValue placeholder="Seleccionar tipo" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {categoryTypes.map((type) => (
                            <SelectItem key={type.value} value={type.value}>
                              {type.label}
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
                  name="financialGroupId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Grupo Financiero</FormLabel>
                      <Select
                        onValueChange={(val) => field.onChange(val ? parseInt(val) : undefined)}
                        value={field.value?.toString() || ""}
                      >
                        <FormControl>
                          <SelectTrigger data-testid="select-group">
                            <SelectValue placeholder="Seleccionar grupo" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {financialGroups.filter(g => g.active !== false).map((group) => (
                            <SelectItem key={group.id} value={group.id.toString()}>
                              {group.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              
              <div className="space-y-4 rounded-lg border p-4 bg-muted/30">
                <FormField
                  control={form.control}
                  name="isSpecial"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between">
                      <div className="space-y-0.5">
                        <FormLabel>Categoria EE.RR.</FormLabel>
                        <p className="text-xs text-muted-foreground">
                          Marcar para incluir en el Estado de Resultados
                        </p>
                      </div>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          data-testid="switch-isSpecial"
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
                
                {watchIsSpecial && (
                  <FormField
                    control={form.control}
                    name="specialType"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Tipo para EE.RR. *</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value || ""}>
                          <FormControl>
                            <SelectTrigger data-testid="select-specialType">
                              <SelectValue placeholder="Seleccionar tipo" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {specialTypes.map((type) => (
                              <SelectItem key={type.value} value={type.value}>
                                {type.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
              </div>
              
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
