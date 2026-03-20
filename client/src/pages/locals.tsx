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
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatCuit, validateCuit } from "@/lib/formatters";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Edit, Trash2, MapPin } from "lucide-react";
import type { Local } from "@shared/schema";

const IVA_CONDITIONS = [
  { value: "responsable_inscripto", label: "Responsable Inscripto" },
  { value: "monotributista", label: "Monotributista" },
  { value: "exento", label: "Exento" },
];

const formSchema = z.object({
  name: z.string().min(1, "El nombre es requerido"),
  businessName: z.string().optional(),
  address: z.string().optional(),
  cuit: z.string().optional().refine((val) => !val || validateCuit(val), "CUIT invalido"),
  afipPOS: z.string().max(5, "Maximo 5 digitos").optional(),
  ivaCondition: z.string().default("responsable_inscripto"),
  managerName: z.string().optional(),
  managerPhone: z.string().optional(),
  managerEmail: z.string().email("Email invalido").optional().or(z.literal("")),
  active: z.boolean().default(true),
});

type FormData = z.infer<typeof formSchema>;

export default function LocalsPage() {
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingLocal, setEditingLocal] = useState<Local | null>(null);
  const [deleteLocal, setDeleteLocal] = useState<Local | null>(null);

  const { data: locals = [], isLoading } = useQuery<Local[]>({
    queryKey: ["/api/locals"],
  });

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      businessName: "",
      address: "",
      cuit: "",
      afipPOS: "",
      ivaCondition: "responsable_inscripto",
      managerName: "",
      managerPhone: "",
      managerEmail: "",
      active: true,
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: FormData) => {
      const res = await apiRequest("POST", "/api/locals", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/locals"] });
      toast({ title: "Local creado correctamente" });
      closeDialog();
    },
    onError: (error: Error) => {
      toast({ title: "Error al crear local", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: FormData }) => {
      const res = await apiRequest("PATCH", `/api/locals/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/locals"] });
      toast({ title: "Local actualizado correctamente" });
      closeDialog();
    },
    onError: (error: Error) => {
      toast({ title: "Error al actualizar local", description: error.message, variant: "destructive" });
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, active }: { id: number; active: boolean }) => {
      const res = await apiRequest("PATCH", `/api/locals/${id}`, { active });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/locals"] });
      toast({ title: "Estado actualizado" });
    },
    onError: (error: Error) => {
      toast({ title: "Error al cambiar estado", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/locals/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/locals"] });
      toast({ title: "Local eliminado correctamente" });
      setDeleteLocal(null);
    },
    onError: (error: Error) => {
      toast({ title: "Error al eliminar local", description: error.message, variant: "destructive" });
    },
  });

  const openCreate = () => {
    setEditingLocal(null);
    form.reset({
      name: "",
      businessName: "",
      address: "",
      cuit: "",
      afipPOS: "",
      ivaCondition: "responsable_inscripto",
      managerName: "",
      managerPhone: "",
      managerEmail: "",
      active: true,
    });
    setIsDialogOpen(true);
  };

  const openEdit = (local: Local) => {
    setEditingLocal(local);
    form.reset({
      name: local.name,
      businessName: local.businessName || "",
      address: local.address || "",
      cuit: local.cuit || "",
      afipPOS: local.afipPOS || "",
      ivaCondition: local.ivaCondition || "responsable_inscripto",
      managerName: local.managerName || "",
      managerPhone: local.managerPhone || "",
      managerEmail: local.managerEmail || "",
      active: local.active ?? true,
    });
    setIsDialogOpen(true);
  };

  const closeDialog = () => {
    setIsDialogOpen(false);
    setEditingLocal(null);
    form.reset();
  };

  const onSubmit = (data: FormData) => {
    if (editingLocal) {
      updateMutation.mutate({ id: editingLocal.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const columns: Column<Local>[] = [
    {
      key: "name",
      header: "Nombre",
      cell: (row) => (
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
            <MapPin className="h-4 w-4 text-primary" />
          </div>
          <span className="font-medium">{row.name}</span>
        </div>
      ),
    },
    {
      key: "address",
      header: "Direccion",
      cell: (row) => row.address || <span className="text-muted-foreground">-</span>,
    },
    {
      key: "cuit",
      header: "CUIT",
      cell: (row) =>
        row.cuit ? (
          <span className="font-mono text-sm">{formatCuit(row.cuit)}</span>
        ) : (
          <span className="text-muted-foreground">-</span>
        ),
    },
    {
      key: "managerName",
      header: "Responsable",
      cell: (row) =>
        row.managerName ? (
          <div className="text-sm">
            <div className="font-medium">{row.managerName}</div>
            {row.managerPhone && (
              <div className="text-muted-foreground text-xs">{row.managerPhone}</div>
            )}
          </div>
        ) : (
          <span className="text-muted-foreground">-</span>
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
            onClick={() => setDeleteLocal(row)}
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
        title="Locales"
        description="Gestiona los locales y sucursales de tu negocio"
      />

      <DataTable
        columns={columns}
        data={locals}
        isLoading={isLoading}
        searchPlaceholder="Buscar por nombre..."
        searchKeys={["name"]}
        onAdd={openCreate}
        addLabel="Nuevo Local"
        emptyMessage="No hay locales registrados"
      />

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingLocal ? "Editar Local" : "Nuevo Local"}
            </DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Nombre *</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="Nombre del local" data-testid="input-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="businessName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Razon Social</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="Razon social" data-testid="input-businessName" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="address"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Direccion</FormLabel>
                    <FormControl>
                      <Textarea {...field} placeholder="Direccion del local" rows={2} data-testid="input-address" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="cuit"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>CUIT</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder="20123456789"
                          maxLength={11}
                          className="font-mono"
                          data-testid="input-cuit"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="afipPOS"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Punto de Venta AFIP</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder="00001"
                          maxLength={5}
                          className="font-mono"
                          data-testid="input-afipPOS"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="ivaCondition"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Condicion IVA</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-ivaCondition">
                          <SelectValue placeholder="Seleccionar" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {IVA_CONDITIONS.map((cond) => (
                          <SelectItem key={cond.value} value={cond.value}>
                            {cond.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="pt-4 border-t">
                <h4 className="text-sm font-medium text-muted-foreground mb-3">Responsable del Local</h4>
                <div className="grid grid-cols-1 gap-4">
                  <FormField
                    control={form.control}
                    name="managerName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Nombre del Responsable</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="Juan Perez" data-testid="input-managerName" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="managerPhone"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Telefono</FormLabel>
                          <FormControl>
                            <Input {...field} placeholder="11-1234-5678" data-testid="input-managerPhone" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="managerEmail"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Email</FormLabel>
                          <FormControl>
                            <Input {...field} placeholder="responsable@ejemplo.com" type="email" data-testid="input-managerEmail" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </div>
              </div>
              <FormField
                control={form.control}
                name="active"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between rounded-lg border p-3">
                    <div>
                      <FormLabel className="text-base">Activo</FormLabel>
                      <p className="text-sm text-muted-foreground">
                        El local estara disponible para seleccionar
                      </p>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        data-testid="switch-active"
                      />
                    </FormControl>
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
                    : editingLocal
                    ? "Actualizar"
                    : "Crear"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteLocal}
        onOpenChange={(open) => !open && setDeleteLocal(null)}
        title="Eliminar Local"
        description={`¿Esta seguro que desea eliminar el local "${deleteLocal?.name}"? Esta accion no se puede deshacer.`}
        confirmLabel="Eliminar"
        onConfirm={() => deleteLocal && deleteMutation.mutate(deleteLocal.id)}
        variant="destructive"
        isLoading={deleteMutation.isPending}
      />
    </div>
  );
}
