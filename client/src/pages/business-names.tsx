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
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Building2, Edit, Trash2 } from "lucide-react";
import type { BusinessName } from "@shared/schema";

const formSchema = z.object({
  name: z.string().min(1, "La razón social es requerida"),
  cuit: z.string().max(13).optional(),
});

type FormData = z.infer<typeof formSchema>;

export default function BusinessNamesPage() {
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editing, setEditing] = useState<BusinessName | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BusinessName | null>(null);

  const { data: rows = [], isLoading } = useQuery<BusinessName[]>({
    queryKey: ["/api/business-names"],
  });

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: "", cuit: "" },
  });

  const createMutation = useMutation({
    mutationFn: async (data: FormData) => {
      const res = await apiRequest("POST", "/api/business-names", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/business-names"] });
      toast({ title: "Sociedad creada" });
      closeDialog();
    },
    onError: (error: Error) => {
      toast({ title: "Error al crear", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: FormData }) => {
      const res = await apiRequest("PATCH", `/api/business-names/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/business-names"] });
      toast({ title: "Sociedad actualizada" });
      closeDialog();
    },
    onError: (error: Error) => {
      toast({ title: "Error al actualizar", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/business-names/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/business-names"] });
      toast({ title: "Sociedad eliminada" });
      setDeleteTarget(null);
    },
    onError: (error: Error) => {
      toast({ title: "Error al eliminar", description: error.message, variant: "destructive" });
    },
  });

  const openCreate = () => {
    setEditing(null);
    form.reset({ name: "", cuit: "" });
    setIsDialogOpen(true);
  };

  const openEdit = (row: BusinessName) => {
    setEditing(row);
    form.reset({ name: row.name, cuit: row.cuit || "" });
    setIsDialogOpen(true);
  };

  const closeDialog = () => {
    setIsDialogOpen(false);
    setEditing(null);
    form.reset();
  };

  const onSubmit = (data: FormData) => {
    const payload = { ...data, cuit: data.cuit?.trim() || undefined };
    if (editing) updateMutation.mutate({ id: editing.id, data: payload });
    else createMutation.mutate(payload);
  };

  const columns: Column<BusinessName>[] = [
    {
      key: "name",
      header: "Razón social",
      cell: (row) => (
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
            <Building2 className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0">
            <div className="font-medium">{row.name}</div>
            {row.cuit ? (
              <div className="text-xs text-muted-foreground">CUIT: {row.cuit}</div>
            ) : null}
          </div>
        </div>
      ),
    },
    {
      key: "actions",
      header: "",
      className: "w-28 text-right",
      cell: (row) => (
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="icon" onClick={() => openEdit(row)}>
            <Edit className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(row)}>
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sociedades"
        description="Catálogo de razones sociales utilizadas por la empresa."
        actions={
          <Button onClick={openCreate} data-testid="button-create-business-name">
            Nueva sociedad
          </Button>
        }
      />

      <DataTable columns={columns} data={rows} isLoading={isLoading} />

      <Dialog open={isDialogOpen} onOpenChange={(open) => (open ? setIsDialogOpen(true) : closeDialog())}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar sociedad" : "Nueva sociedad"}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Razón social</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Ej: Mi Empresa S.A." />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="cuit"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>CUIT (opcional)</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Ej: 30-12345678-9" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="flex justify-end gap-2">
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
        open={!!deleteTarget}
        onOpenChange={(open) => (!open ? setDeleteTarget(null) : undefined)}
        title="Eliminar sociedad"
        description={`¿Eliminar "${deleteTarget?.name}"?`}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        isLoading={deleteMutation.isPending}
      />
    </div>
  );
}

