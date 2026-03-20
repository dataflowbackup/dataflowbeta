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
  DialogDescription,
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Edit, Trash2, FolderTree, Plus, Download, Lock } from "lucide-react";
import type { FinancialGroup, TransactionCategory } from "@shared/schema";

const groupTypes = [
  { value: "income", label: "Ingresos" },
  { value: "expense", label: "Gastos" },
  { value: "transfer", label: "Transferencias" },
];

const formSchema = z.object({
  name: z.string().min(1, "El nombre es requerido"),
  type: z.enum(["income", "expense", "transfer"], { required_error: "El tipo es requerido" }),
  displayOrder: z.coerce.number().min(1, "El orden debe ser mayor a 0"),
});

type FormData = z.infer<typeof formSchema>;

export default function FinancialGroupsPage() {
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<FinancialGroup | null>(null);
  const [deleteGroup, setDeleteGroup] = useState<FinancialGroup | null>(null);

  const { data: groups = [], isLoading } = useQuery<FinancialGroup[]>({
    queryKey: ["/api/financial-groups"],
  });

  const { data: categories = [] } = useQuery<TransactionCategory[]>({
    queryKey: ["/api/transaction-categories"],
  });

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      type: "expense",
      displayOrder: 1,
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: FormData) => {
      const res = await apiRequest("POST", "/api/financial-groups", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/financial-groups"] });
      toast({ title: "Grupo creado correctamente" });
      closeDialog();
    },
    onError: (error: Error) => {
      toast({ title: "Error al crear grupo", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: FormData }) => {
      const res = await apiRequest("PATCH", `/api/financial-groups/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/financial-groups"] });
      toast({ title: "Grupo actualizado correctamente" });
      closeDialog();
    },
    onError: (error: Error) => {
      toast({ title: "Error al actualizar grupo", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/financial-groups/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/financial-groups"] });
      toast({ title: "Grupo eliminado correctamente" });
      setDeleteGroup(null);
    },
    onError: (error: Error) => {
      toast({ title: "Error al eliminar grupo", description: error.message, variant: "destructive" });
    },
  });

  const seedMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/financial-groups/seed", {});
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/financial-groups"] });
      queryClient.invalidateQueries({ queryKey: ["/api/transaction-categories"] });
      toast({ title: "Datos cargados", description: data.message });
    },
    onError: (error: Error) => {
      toast({ title: "Error al cargar datos", description: error.message, variant: "destructive" });
    },
  });

  const openCreate = () => {
    setEditingGroup(null);
    const maxOrder = groups.length > 0 ? Math.max(...groups.map(g => g.displayOrder || 0)) + 1 : 1;
    form.reset({ name: "", type: "expense", displayOrder: maxOrder });
    setIsDialogOpen(true);
  };

  const openEdit = (group: FinancialGroup) => {
    if (group.isSystem) {
      toast({ title: "No se puede editar", description: "Los grupos del sistema no se pueden modificar", variant: "destructive" });
      return;
    }
    setEditingGroup(group);
    form.reset({
      name: group.name,
      type: group.type as "income" | "expense" | "transfer",
      displayOrder: group.displayOrder || 1,
    });
    setIsDialogOpen(true);
  };

  const closeDialog = () => {
    setIsDialogOpen(false);
    setEditingGroup(null);
    form.reset();
  };

  const onSubmit = (data: FormData) => {
    if (editingGroup) {
      updateMutation.mutate({ id: editingGroup.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const handleDelete = (group: FinancialGroup) => {
    if (group.isSystem) {
      toast({ title: "No se puede eliminar", description: "Los grupos del sistema no se pueden eliminar", variant: "destructive" });
      return;
    }
    const categoriesInGroup = categories.filter(c => c.financialGroupId === group.id);
    if (categoriesInGroup.length > 0) {
      toast({ 
        title: "No se puede eliminar", 
        description: `El grupo tiene ${categoriesInGroup.length} categorías asociadas`, 
        variant: "destructive" 
      });
      return;
    }
    setDeleteGroup(group);
  };

  const getCategoryCount = (groupId: number) => {
    return categories.filter(c => c.financialGroupId === groupId).length;
  };

  const getTypeBadge = (type: string) => {
    switch (type) {
      case "income":
        return <Badge variant="default" className="bg-green-600" data-testid={`badge-type-income`}>Ingresos</Badge>;
      case "expense":
        return <Badge variant="default" className="bg-red-600" data-testid={`badge-type-expense`}>Gastos</Badge>;
      case "transfer":
        return <Badge variant="default" className="bg-blue-600" data-testid={`badge-type-transfer`}>Transferencias</Badge>;
      default:
        return <Badge variant="secondary">{type}</Badge>;
    }
  };

  const columns: Column<FinancialGroup>[] = [
    {
      key: "displayOrder",
      header: "Orden",
      cell: (row) => <span className="font-mono text-muted-foreground">{row.displayOrder}</span>,
    },
    {
      key: "name",
      header: "Nombre",
      cell: (row) => (
        <div className="flex items-center gap-2">
          <span className="font-medium">{row.name}</span>
          {row.isSystem && (
            <Lock className="h-3 w-3 text-muted-foreground" />
          )}
        </div>
      ),
    },
    {
      key: "type",
      header: "Tipo",
      cell: (row) => getTypeBadge(row.type),
    },
    {
      key: "categories",
      header: "Categorías",
      cell: (row) => (
        <Badge variant="outline" data-testid={`badge-categories-${row.id}`}>
          {getCategoryCount(row.id)} categorías
        </Badge>
      ),
    },
    {
      key: "actions",
      header: "Acciones",
      cell: (row) => (
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => openEdit(row)}
            disabled={row.isSystem ?? false}
            data-testid={`button-edit-${row.id}`}
          >
            <Edit className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => handleDelete(row)}
            disabled={row.isSystem ?? false}
            data-testid={`button-delete-${row.id}`}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title="Grupos Financieros"
        description="Organiza las categorías de transacciones en grupos para el Estado de Resultados"
      />

      {groups.length === 0 && !isLoading ? (
        <Card>
          <CardHeader>
            <CardTitle>Cargar Datos Predeterminados</CardTitle>
            <CardDescription>
              No hay grupos financieros configurados. Puedes cargar los ~200 grupos y categorías predeterminadas 
              para gastronomía, o crear los tuyos propios.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex gap-4">
            <Button 
              onClick={() => seedMutation.mutate()} 
              disabled={seedMutation.isPending}
              data-testid="button-seed-data"
            >
              <Download className="h-4 w-4 mr-2" />
              {seedMutation.isPending ? "Cargando..." : "Cargar Datos Predeterminados"}
            </Button>
            <Button variant="outline" onClick={openCreate} data-testid="button-create-empty">
              <Plus className="h-4 w-4 mr-2" />
              Crear Grupo Vacío
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex justify-between items-center">
            <div className="text-sm text-muted-foreground">
              {groups.length} grupos, {categories.length} categorías totales
            </div>
            <Button onClick={openCreate} data-testid="button-create-group">
              <Plus className="h-4 w-4 mr-2" />
              Nuevo Grupo
            </Button>
          </div>

          <DataTable
            data={groups}
            columns={columns}
            isLoading={isLoading}
            searchKeys={["name"]}
            searchPlaceholder="Buscar grupo..."
          />
        </>
      )}

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingGroup ? "Editar Grupo" : "Nuevo Grupo Financiero"}</DialogTitle>
            <DialogDescription>
              Los grupos organizan las categorías para el Estado de Resultados
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nombre</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Ej: Ventas, RRHH, Impuestos" data-testid="input-name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tipo</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-type">
                          <SelectValue placeholder="Seleccionar tipo" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {groupTypes.map((type) => (
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
                name="displayOrder"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Orden de Visualización</FormLabel>
                    <FormControl>
                      <Input 
                        {...field} 
                        type="number" 
                        min={1}
                        data-testid="input-order" 
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={closeDialog}>
                  Cancelar
                </Button>
                <Button 
                  type="submit" 
                  disabled={createMutation.isPending || updateMutation.isPending}
                  data-testid="button-submit"
                >
                  {editingGroup ? "Guardar" : "Crear"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteGroup}
        onOpenChange={() => setDeleteGroup(null)}
        title="Eliminar Grupo"
        description={`¿Está seguro que desea eliminar el grupo "${deleteGroup?.name}"? Esta acción no se puede deshacer.`}
        onConfirm={() => deleteGroup && deleteMutation.mutate(deleteGroup.id)}
        isLoading={deleteMutation.isPending}
      />
    </div>
  );
}
