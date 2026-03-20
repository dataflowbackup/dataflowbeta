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
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Edit, Trash2, Scale } from "lucide-react";
import type { UnitOfMeasure } from "@shared/schema";

const formSchema = z.object({
  name: z.string().min(1, "El nombre es requerido"),
  abbreviation: z.string().min(1, "La abreviatura es requerida").max(10, "Maximo 10 caracteres"),
});

type FormData = z.infer<typeof formSchema>;

export default function UnitsPage() {
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingUnit, setEditingUnit] = useState<UnitOfMeasure | null>(null);
  const [deleteUnit, setDeleteUnit] = useState<UnitOfMeasure | null>(null);

  const { data: units = [], isLoading } = useQuery<UnitOfMeasure[]>({
    queryKey: ["/api/units"],
  });

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      abbreviation: "",
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: FormData) => {
      const res = await apiRequest("POST", "/api/units", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/units"] });
      toast({ title: "Unidad de medida creada correctamente" });
      closeDialog();
    },
    onError: (error: Error) => {
      toast({ title: "Error al crear unidad de medida", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: FormData }) => {
      const res = await apiRequest("PATCH", `/api/units/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/units"] });
      toast({ title: "Unidad de medida actualizada correctamente" });
      closeDialog();
    },
    onError: (error: Error) => {
      toast({ title: "Error al actualizar unidad de medida", description: error.message, variant: "destructive" });
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, active }: { id: number; active: boolean }) => {
      const res = await apiRequest("PATCH", `/api/units/${id}`, { active });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/units"] });
      toast({ title: "Estado actualizado" });
    },
    onError: (error: Error) => {
      toast({ title: "Error al cambiar estado", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/units/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/units"] });
      toast({ title: "Unidad de medida eliminada correctamente" });
      setDeleteUnit(null);
    },
    onError: (error: Error) => {
      toast({ title: "Error al eliminar unidad de medida", description: error.message, variant: "destructive" });
    },
  });

  const openCreate = () => {
    setEditingUnit(null);
    form.reset({ name: "", abbreviation: "" });
    setIsDialogOpen(true);
  };

  const openEdit = (unit: UnitOfMeasure) => {
    setEditingUnit(unit);
    form.reset({
      name: unit.name,
      abbreviation: unit.abbreviation,
    });
    setIsDialogOpen(true);
  };

  const closeDialog = () => {
    setIsDialogOpen(false);
    setEditingUnit(null);
    form.reset();
  };

  const onSubmit = (data: FormData) => {
    if (editingUnit) {
      updateMutation.mutate({ id: editingUnit.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const columns: Column<UnitOfMeasure>[] = [
    {
      key: "name",
      header: "Nombre",
      cell: (row) => (
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
            <Scale className="h-4 w-4 text-primary" />
          </div>
          <span className="font-medium">{row.name}</span>
        </div>
      ),
    },
    {
      key: "abbreviation",
      header: "Abreviatura",
      cell: (row) => (
        <Badge variant="secondary" className="font-mono">
          {row.abbreviation}
        </Badge>
      ),
    },
    {
      key: "active",
      header: "Estado",
      cell: (row) => (
        <Button
          variant="ghost"
          size="sm"
          className="p-0 h-auto"
          onClick={() => toggleActiveMutation.mutate({ id: row.id, active: !row.active })}
          data-testid={`button-toggle-active-${row.id}`}
        >
          <Badge variant={row.active ? "default" : "secondary"} className="cursor-pointer">
            {row.active ? "Activo" : "Inactivo"}
          </Badge>
        </Button>
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
            onClick={() => setDeleteUnit(row)}
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
        title="Unidades de Medida"
        description="Gestiona las unidades de medida para los insumos"
      />

      <DataTable
        columns={columns}
        data={units}
        isLoading={isLoading}
        searchPlaceholder="Buscar por nombre..."
        searchKeys={["name", "abbreviation"]}
        onAdd={openCreate}
        addLabel="Nueva Unidad"
        emptyMessage="No hay unidades de medida registradas"
      />

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingUnit ? "Editar Unidad de Medida" : "Nueva Unidad de Medida"}
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
                      <Input {...field} placeholder="Ej: Kilogramos" data-testid="input-name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="abbreviation"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Abreviatura *</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="Ej: kg"
                        maxLength={10}
                        className="font-mono"
                        data-testid="input-abbreviation"
                      />
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
                    : editingUnit
                    ? "Actualizar"
                    : "Crear"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteUnit}
        onOpenChange={(open) => !open && setDeleteUnit(null)}
        title="Eliminar Unidad de Medida"
        description={`¿Esta seguro que desea eliminar la unidad "${deleteUnit?.name}"? Esta accion no se puede deshacer.`}
        confirmLabel="Eliminar"
        onConfirm={() => deleteUnit && deleteMutation.mutate(deleteUnit.id)}
        variant="destructive"
        isLoading={deleteMutation.isPending}
      />
    </div>
  );
}
