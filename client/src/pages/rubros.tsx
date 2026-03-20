import { useState, useRef } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Edit, Trash2, Tag, Upload, Download } from "lucide-react";
import type { Rubro } from "@shared/schema";

const formSchema = z.object({
  name: z.string().min(1, "El nombre es requerido"),
  description: z.string().optional(),
});

type FormData = z.infer<typeof formSchema>;

export default function RubrosPage() {
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [editingRubro, setEditingRubro] = useState<Rubro | null>(null);
  const [deleteRubro, setDeleteRubro] = useState<Rubro | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: rubros = [], isLoading } = useQuery<Rubro[]>({
    queryKey: ["/api/rubros"],
  });

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      description: "",
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: FormData) => {
      const res = await apiRequest("POST", "/api/rubros", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rubros"] });
      toast({ title: "Rubro creado correctamente" });
      closeDialog();
    },
    onError: (error: Error) => {
      toast({ title: "Error al crear rubro", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: FormData }) => {
      const res = await apiRequest("PATCH", `/api/rubros/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rubros"] });
      toast({ title: "Rubro actualizado correctamente" });
      closeDialog();
    },
    onError: (error: Error) => {
      toast({ title: "Error al actualizar rubro", description: error.message, variant: "destructive" });
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, active }: { id: number; active: boolean }) => {
      const res = await apiRequest("PATCH", `/api/rubros/${id}`, { active });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rubros"] });
      toast({ title: "Estado actualizado" });
    },
    onError: (error: Error) => {
      toast({ title: "Error al cambiar estado", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/rubros/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rubros"] });
      toast({ title: "Rubro eliminado correctamente" });
      setDeleteRubro(null);
    },
    onError: (error: Error) => {
      toast({ title: "Error al eliminar rubro", description: error.message, variant: "destructive" });
    },
  });

  const importMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/rubros/import", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Error al importar");
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/rubros"] });
      toast({ 
        title: "Importacion completada", 
        description: `${data.imported} de ${data.total} rubros importados` 
      });
      setIsImportDialogOpen(false);
    },
    onError: (error: Error) => {
      toast({ title: "Error al importar", description: error.message, variant: "destructive" });
    },
  });

  const handleExport = async () => {
    try {
      const res = await fetch("/api/rubros/export", {
        method: "GET",
        credentials: "include",
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Error al exportar");
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "rubros.xlsx";
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error: any) {
      toast({ title: "Error al exportar", description: error.message, variant: "destructive" });
    }
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      importMutation.mutate(file);
    }
  };

  const openCreate = () => {
    setEditingRubro(null);
    form.reset({ name: "", description: "" });
    setIsDialogOpen(true);
  };

  const openEdit = (rubro: Rubro) => {
    setEditingRubro(rubro);
    form.reset({
      name: rubro.name,
      description: rubro.description || "",
    });
    setIsDialogOpen(true);
  };

  const closeDialog = () => {
    setIsDialogOpen(false);
    setEditingRubro(null);
    form.reset();
  };

  const onSubmit = (data: FormData) => {
    if (editingRubro) {
      updateMutation.mutate({ id: editingRubro.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const columns: Column<Rubro>[] = [
    {
      key: "name",
      header: "Nombre",
      cell: (row) => (
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
            <Tag className="h-4 w-4 text-primary" />
          </div>
          <span className="font-medium">{row.name}</span>
        </div>
      ),
    },
    {
      key: "description",
      header: "Descripcion",
      cell: (row) => row.description || <span className="text-muted-foreground">-</span>,
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
            onClick={() => setDeleteRubro(row)}
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
        title="Rubros"
        description="Gestiona los rubros o categorias de insumos"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleExport} data-testid="button-export">
              <Download className="h-4 w-4 mr-2" />
              Exportar
            </Button>
            <Button variant="outline" onClick={() => setIsImportDialogOpen(true)} data-testid="button-import">
              <Upload className="h-4 w-4 mr-2" />
              Importar
            </Button>
          </div>
        }
      />

      <DataTable
        columns={columns}
        data={rubros}
        isLoading={isLoading}
        searchPlaceholder="Buscar por nombre..."
        searchKeys={["name"]}
        onAdd={openCreate}
        addLabel="Nuevo Rubro"
        emptyMessage="No hay rubros registrados"
      />

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingRubro ? "Editar Rubro" : "Nuevo Rubro"}
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
                      <Input {...field} placeholder="Nombre del rubro" data-testid="input-name" />
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
                      <Textarea {...field} placeholder="Descripcion del rubro" rows={3} data-testid="input-description" />
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
                    : editingRubro
                    ? "Actualizar"
                    : "Crear"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteRubro}
        onOpenChange={(open) => !open && setDeleteRubro(null)}
        title="Eliminar Rubro"
        description={`¿Esta seguro que desea eliminar el rubro "${deleteRubro?.name}"? Esta accion no se puede deshacer.`}
        confirmLabel="Eliminar"
        onConfirm={() => deleteRubro && deleteMutation.mutate(deleteRubro.id)}
        variant="destructive"
        isLoading={deleteMutation.isPending}
      />

      <Dialog open={isImportDialogOpen} onOpenChange={setIsImportDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Importar Rubros</DialogTitle>
            <DialogDescription>
              Sube un archivo Excel con los rubros a importar. El archivo debe tener las columnas: Nombre (requerido), Descripcion.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={handleImportFile}
              data-testid="input-import-file"
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIsImportDialogOpen(false)}>
                Cancelar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
