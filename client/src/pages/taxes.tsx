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
import { formatPercentage } from "@/lib/formatters";
import { Edit, Trash2, Percent, Download } from "lucide-react";
import type { Tax } from "@shared/schema";

const taxTypes = [
  { value: "iva", label: "IVA" },
  { value: "percepcion_iva", label: "Percepcion IVA" },
  { value: "percepcion_iibb", label: "Percepcion IIBB" },
  { value: "retencion_iva", label: "Retencion IVA" },
  { value: "retencion_ganancias", label: "Retencion Ganancias" },
  { value: "retencion_iibb", label: "Retencion IIBB" },
  { value: "impuesto_interno", label: "Impuesto Interno" },
  { value: "otro", label: "Otro" },
];

const formSchema = z.object({
  name: z.string().min(1, "El nombre es requerido"),
  percentage: z.coerce.number().min(0, "El porcentaje debe ser mayor a 0"),
  type: z.string().min(1, "El tipo es requerido"),
});

type FormData = z.infer<typeof formSchema>;

export default function TaxesPage() {
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const seedMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/taxes/seed-argentina", {});
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/taxes"] });
      toast({ title: "Catalogo argentino importado", description: data.message });
    },
    onError: (error: Error) => {
      toast({ title: "Error al importar catalogo", description: error.message, variant: "destructive" });
    },
  });
  const [editingTax, setEditingTax] = useState<Tax | null>(null);
  const [deleteTax, setDeleteTax] = useState<Tax | null>(null);

  const { data: taxes = [], isLoading } = useQuery<Tax[]>({
    queryKey: ["/api/taxes"],
  });

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      percentage: 0,
      type: "iva",
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: FormData) => {
      const res = await apiRequest("POST", "/api/taxes", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/taxes"] });
      toast({ title: "Impuesto creado correctamente" });
      closeDialog();
    },
    onError: (error: Error) => {
      toast({ title: "Error al crear impuesto", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: FormData }) => {
      const res = await apiRequest("PATCH", `/api/taxes/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/taxes"] });
      toast({ title: "Impuesto actualizado correctamente" });
      closeDialog();
    },
    onError: (error: Error) => {
      toast({ title: "Error al actualizar impuesto", description: error.message, variant: "destructive" });
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, active }: { id: number; active: boolean }) => {
      const res = await apiRequest("PATCH", `/api/taxes/${id}`, { active });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/taxes"] });
      toast({ title: "Estado actualizado" });
    },
    onError: (error: Error) => {
      toast({ title: "Error al cambiar estado", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/taxes/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/taxes"] });
      toast({ title: "Impuesto eliminado correctamente" });
      setDeleteTax(null);
    },
    onError: (error: Error) => {
      toast({ title: "Error al eliminar impuesto", description: error.message, variant: "destructive" });
    },
  });

  const openCreate = () => {
    setEditingTax(null);
    form.reset({ name: "", percentage: 0, type: "iva" });
    setIsDialogOpen(true);
  };

  const openEdit = (tax: Tax) => {
    setEditingTax(tax);
    form.reset({
      name: tax.name,
      percentage: parseFloat(tax.percentage),
      type: tax.type || "iva",
    });
    setIsDialogOpen(true);
  };

  const closeDialog = () => {
    setIsDialogOpen(false);
    setEditingTax(null);
    form.reset();
  };

  const onSubmit = (data: FormData) => {
    if (editingTax) {
      updateMutation.mutate({ id: editingTax.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const getTypeLabel = (type: string | null) => {
    return taxTypes.find((t) => t.value === type)?.label || type || "-";
  };

  const columns: Column<Tax>[] = [
    {
      key: "name",
      header: "Nombre",
      cell: (row) => (
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
            <Percent className="h-4 w-4 text-primary" />
          </div>
          <span className="font-medium">{row.name}</span>
        </div>
      ),
    },
    {
      key: "percentage",
      header: "Porcentaje",
      cell: (row) => (
        <span className="font-mono text-sm">
          {formatPercentage(row.percentage)}
        </span>
      ),
    },
    {
      key: "type",
      header: "Tipo",
      cell: (row) => (
        <Badge variant="secondary">
          {getTypeLabel(row.type)}
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
            onClick={() => setDeleteTax(row)}
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
        title="Impuestos"
        description="Gestiona los impuestos y alicuotas para facturas"
        actions={
          <Button
            variant="outline"
            onClick={() => seedMutation.mutate()}
            disabled={seedMutation.isPending}
            data-testid="button-seed-taxes"
          >
            <Download className="h-4 w-4 mr-2" />
            {seedMutation.isPending ? "Importando..." : "Catalogo Argentina"}
          </Button>
        }
      />

      <DataTable
        columns={columns}
        data={taxes}
        isLoading={isLoading}
        searchPlaceholder="Buscar por nombre..."
        searchKeys={["name"]}
        onAdd={openCreate}
        addLabel="Nuevo Impuesto"
        emptyMessage="No hay impuestos registrados. Agrega los impuestos que utilizas en tus facturas."
      />

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingTax ? "Editar Impuesto" : "Nuevo Impuesto"}
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
                      <Input {...field} placeholder="Ej: IVA 21%" data-testid="input-name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="percentage"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Porcentaje *</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="number"
                          step="0.01"
                          min="0"
                          placeholder="21.00"
                          className="font-mono"
                          data-testid="input-percentage"
                        />
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
                      <FormLabel>Tipo *</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-type">
                            <SelectValue placeholder="Seleccionar tipo" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {taxTypes.map((type) => (
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
                    : editingTax
                    ? "Actualizar"
                    : "Crear"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTax}
        onOpenChange={(open) => !open && setDeleteTax(null)}
        title="Eliminar Impuesto"
        description={`¿Esta seguro que desea eliminar el impuesto "${deleteTax?.name}"? Esta accion no se puede deshacer.`}
        confirmLabel="Eliminar"
        onConfirm={() => deleteTax && deleteMutation.mutate(deleteTax.id)}
        variant="destructive"
        isLoading={deleteMutation.isPending}
      />
    </div>
  );
}
