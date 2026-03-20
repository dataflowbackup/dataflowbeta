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
import type { Rubro, SubRubro } from "@shared/schema";

interface SubRubroWithRubro extends SubRubro {
  rubro?: Rubro | null;
}

const formSchema = z.object({
  name: z.string().min(1, "El nombre es requerido"),
  rubroId: z.coerce.number().min(1, "Debe seleccionar un rubro"),
  description: z.string().optional(),
});

type FormData = z.infer<typeof formSchema>;

export default function SubRubrosPage() {
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingSubRubro, setEditingSubRubro] = useState<SubRubroWithRubro | null>(null);
  const [deleteSubRubro, setDeleteSubRubro] = useState<SubRubroWithRubro | null>(null);

  const { data: subRubros = [], isLoading } = useQuery<SubRubroWithRubro[]>({
    queryKey: ["/api/sub-rubros"],
  });

  const { data: rubros = [] } = useQuery<Rubro[]>({
    queryKey: ["/api/rubros"],
  });

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      rubroId: undefined,
      description: "",
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: FormData) => {
      const res = await apiRequest("POST", "/api/sub-rubros", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sub-rubros"] });
      toast({ title: "Sub-Rubro creado correctamente" });
      closeDialog();
    },
    onError: (error: Error) => {
      toast({ title: "Error al crear sub-rubro", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: FormData }) => {
      const res = await apiRequest("PATCH", `/api/sub-rubros/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sub-rubros"] });
      toast({ title: "Sub-Rubro actualizado correctamente" });
      closeDialog();
    },
    onError: (error: Error) => {
      toast({ title: "Error al actualizar sub-rubro", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/sub-rubros/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sub-rubros"] });
      toast({ title: "Sub-Rubro eliminado correctamente" });
      setDeleteSubRubro(null);
    },
    onError: (error: Error) => {
      toast({ title: "Error al eliminar sub-rubro", description: error.message, variant: "destructive" });
    },
  });

  const openCreate = () => {
    setEditingSubRubro(null);
    form.reset({ name: "", rubroId: undefined, description: "" });
    setIsDialogOpen(true);
  };

  const openEdit = (subRubro: SubRubroWithRubro) => {
    setEditingSubRubro(subRubro);
    form.reset({
      name: subRubro.name,
      rubroId: subRubro.rubroId,
      description: subRubro.description || "",
    });
    setIsDialogOpen(true);
  };

  const closeDialog = () => {
    setIsDialogOpen(false);
    setEditingSubRubro(null);
    form.reset();
  };

  const onSubmit = (data: FormData) => {
    if (editingSubRubro) {
      updateMutation.mutate({ id: editingSubRubro.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const columns: Column<SubRubroWithRubro>[] = [
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
      key: "rubro",
      header: "Rubro Padre",
      cell: (row) => (
        <Badge variant="secondary" data-testid={`badge-rubro-${row.id}`}>
          {row.rubro?.name || "-"}
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
        <Badge variant={row.active ? "default" : "secondary"} data-testid={`badge-status-${row.id}`}>
          {row.active ? "Activo" : "Inactivo"}
        </Badge>
      ),
    },
    {
      key: "actions",
      header: "",
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
            onClick={() => setDeleteSubRubro(row)}
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
        title="Sub-Rubros"
        description="Gestiona las subcategorias de insumos"
      />

      <DataTable
        columns={columns}
        data={subRubros}
        isLoading={isLoading}
        searchPlaceholder="Buscar por nombre..."
        searchKeys={["name"]}
        filters={[
          {
            key: "rubroId",
            label: "Rubro",
            allLabel: "Todos los rubros",
            options: rubros.map((r) => ({ value: String(r.id), label: r.name })),
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
        ] as FilterConfig<SubRubroWithRubro>[]}
        onAdd={openCreate}
        addLabel="Nuevo Sub-Rubro"
        emptyMessage="No hay sub-rubros registrados"
      />

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingSubRubro ? "Editar Sub-Rubro" : "Nuevo Sub-Rubro"}
            </DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="rubroId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Rubro Padre *</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value?.toString()}
                    >
                      <FormControl>
                        <SelectTrigger data-testid="select-rubroId">
                          <SelectValue placeholder="Seleccionar rubro" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {rubros.map((rubro) => (
                          <SelectItem key={rubro.id} value={rubro.id.toString()}>
                            {rubro.name}
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
                      <Input {...field} placeholder="Ej: Lacteos, Carnes Rojas" data-testid="input-name" />
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
                      <Textarea {...field} placeholder="Descripcion opcional" data-testid="input-description" />
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
                  {editingSubRubro ? "Guardar Cambios" : "Crear Sub-Rubro"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteSubRubro}
        onOpenChange={(open) => !open && setDeleteSubRubro(null)}
        title="Eliminar Sub-Rubro"
        description={`¿Esta seguro que desea eliminar el sub-rubro "${deleteSubRubro?.name}"? Esta accion no se puede deshacer.`}
        onConfirm={() => deleteSubRubro && deleteMutation.mutate(deleteSubRubro.id)}
        isLoading={deleteMutation.isPending}
      />
    </div>
  );
}
