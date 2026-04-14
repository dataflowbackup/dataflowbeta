import { useState, useRef, useEffect } from "react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatCuit, validateCuit } from "@/lib/formatters";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Edit, Trash2, Upload, Download, Tags } from "lucide-react";
import type { Supplier, Rubro, SupplierRubro } from "@shared/schema";

const IVA_CONDITIONS = [
  { value: "responsable_inscripto", label: "Responsable Inscripto" },
  { value: "monotributista", label: "Monotributista" },
  { value: "exento", label: "Exento" },
  { value: "consumidor_final", label: "Consumidor Final" },
  { value: "no_responsable", label: "No Responsable" },
];

const formSchema = z.object({
  tradeName: z.string().min(1, "El nombre comercial es requerido"),
  businessName: z.string().optional().or(z.literal("")),
  cuit: z.string().optional().or(z.literal("")).refine((val) => !val || val.length === 0 || (val.length === 11 && validateCuit(val)), "CUIT invalido (debe tener 11 digitos)"),
  ivaCondition: z.string().optional().or(z.literal("")),
  email: z.string().email("Email invalido").optional().or(z.literal("")),
  phone: z.string().optional(),
  address: z.string().optional(),
  paymentDays: z.coerce.number().min(0).default(0),
});

type FormData = z.infer<typeof formSchema>;

export default function SuppliersPage() {
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [isRubrosDialogOpen, setIsRubrosDialogOpen] = useState(false);
  const [rubrosSupplier, setRubrosSupplier] = useState<Supplier | null>(null);
  const [selectedRubroIds, setSelectedRubroIds] = useState<number[]>([]);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [deleteSupplier, setDeleteSupplier] = useState<Supplier | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: suppliers = [], isLoading } = useQuery<Supplier[]>({
    queryKey: ["/api/suppliers"],
  });

  const { data: rubros = [] } = useQuery<Rubro[]>({
    queryKey: ["/api/rubros"],
  });

  const { data: allSupplierRubros = [] } = useQuery<SupplierRubro[]>({
    queryKey: ["/api/supplier-rubros"],
  });

  const { data: currentSupplierRubros = [] } = useQuery<SupplierRubro[]>({
    queryKey: ["/api/supplier-rubros", rubrosSupplier?.id],
    queryFn: async () => {
      if (!rubrosSupplier) return [];
      const res = await fetch(`/api/supplier-rubros/${rubrosSupplier.id}`, { credentials: "include" });
      if (!res.ok) throw new Error("Error al cargar rubros");
      return res.json();
    },
    enabled: !!rubrosSupplier,
  });

  useEffect(() => {
    if (currentSupplierRubros.length > 0) {
      setSelectedRubroIds(currentSupplierRubros.map(sr => sr.rubroId));
    } else if (rubrosSupplier) {
      setSelectedRubroIds([]);
    }
  }, [currentSupplierRubros, rubrosSupplier]);

  const saveRubrosMutation = useMutation({
    mutationFn: async ({ supplierId, rubroIds }: { supplierId: number; rubroIds: number[] }) => {
      await apiRequest("PUT", `/api/supplier-rubros/${supplierId}`, { rubroIds });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/supplier-rubros"] });
      queryClient.invalidateQueries({ queryKey: ["/api/supplier-rubros", rubrosSupplier?.id] });
      toast({ title: "Rubros actualizados correctamente" });
      setIsRubrosDialogOpen(false);
      setRubrosSupplier(null);
    },
    onError: (error: Error) => {
      toast({ title: "Error al guardar rubros", description: error.message, variant: "destructive" });
    },
  });

  const getRubroCount = (supplierId: number) => {
    return allSupplierRubros.filter(sr => sr.supplierId === supplierId).length;
  };

  const getSupplierRubroNames = (supplierId: number) => {
    return allSupplierRubros
      .filter(sr => sr.supplierId === supplierId)
      .map(sr => rubros.find(r => r.id === sr.rubroId))
      .filter(Boolean);
  };

  const openRubrosDialog = (supplier: Supplier) => {
    setRubrosSupplier(supplier);
    setIsRubrosDialogOpen(true);
  };

  const toggleRubro = (rubroId: number) => {
    setSelectedRubroIds(prev =>
      prev.includes(rubroId)
        ? prev.filter(id => id !== rubroId)
        : [...prev, rubroId]
    );
  };

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      tradeName: "",
      businessName: "",
      cuit: "",
      ivaCondition: "",
      email: "",
      phone: "",
      address: "",
      paymentDays: 0,
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: FormData) => {
      const res = await apiRequest("POST", "/api/suppliers", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/suppliers"] });
      toast({ title: "Proveedor creado correctamente" });
      closeDialog();
    },
    onError: (error: Error) => {
      toast({ title: "Error al crear proveedor", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: FormData }) => {
      const res = await apiRequest("PATCH", `/api/suppliers/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/suppliers"] });
      toast({ title: "Proveedor actualizado correctamente" });
      closeDialog();
    },
    onError: (error: Error) => {
      toast({ title: "Error al actualizar proveedor", description: error.message, variant: "destructive" });
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, active }: { id: number; active: boolean }) => {
      const res = await apiRequest("PATCH", `/api/suppliers/${id}`, { active });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/suppliers"] });
      toast({ title: "Estado actualizado" });
    },
    onError: (error: Error) => {
      toast({ title: "Error al cambiar estado", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/suppliers/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/suppliers"] });
      toast({ title: "Proveedor eliminado correctamente" });
      setDeleteSupplier(null);
    },
    onError: (error: Error) => {
      toast({ title: "Error al eliminar proveedor", description: error.message, variant: "destructive" });
    },
  });

  const importMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/suppliers/import", {
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
      queryClient.invalidateQueries({ queryKey: ["/api/suppliers"] });
      toast({ 
        title: "Importacion completada", 
        description: `${data.imported} de ${data.total} proveedores importados` 
      });
      setIsImportDialogOpen(false);
    },
    onError: (error: Error) => {
      toast({ title: "Error al importar", description: error.message, variant: "destructive" });
    },
  });

  const handleExport = async () => {
    try {
      const res = await fetch("/api/suppliers/export", {
        method: "GET",
        credentials: "include",
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Error al exportar");
      }

      const contentType = res.headers.get("content-type") || "";
      const isXlsx =
        contentType.includes(
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ) || contentType.includes("application/vnd.ms-excel");
      if (!isXlsx) {
        // Evita bajar HTML/JSON como .xlsx (termina “corrupto” y luego falla el import).
        const text = await res.text();
        throw new Error(
          `La exportación devolvió un contenido inesperado (${contentType || "sin content-type"}). ` +
            `Detalle: ${text.slice(0, 200)}`,
        );
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "proveedores.xlsx";
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
    setEditingSupplier(null);
    form.reset({
      tradeName: "",
      businessName: "",
      cuit: "",
      ivaCondition: "",
      email: "",
      phone: "",
      address: "",
      paymentDays: 0,
    });
    setIsDialogOpen(true);
  };

  const openEdit = (supplier: Supplier) => {
    setEditingSupplier(supplier);
    form.reset({
      tradeName: supplier.tradeName,
      businessName: supplier.businessName || "",
      cuit: supplier.cuit || "",
      ivaCondition: supplier.ivaCondition || "",
      email: supplier.email || "",
      phone: supplier.phone || "",
      address: supplier.address || "",
      paymentDays: supplier.paymentDays || 0,
    });
    setIsDialogOpen(true);
  };

  const closeDialog = () => {
    setIsDialogOpen(false);
    setEditingSupplier(null);
    form.reset();
  };

  const onSubmit = (data: FormData) => {
    if (editingSupplier) {
      updateMutation.mutate({ id: editingSupplier.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const columns: Column<Supplier>[] = [
    {
      key: "tradeName",
      header: "Nombre",
      cell: (row) => (
        <div>
          <span className="font-medium">{row.tradeName || row.businessName}</span>
          {row.tradeName && row.businessName && (
            <div className="text-xs text-muted-foreground">{row.businessName}</div>
          )}
        </div>
      ),
    },
    {
      key: "rubros",
      header: "Rubros",
      cell: (row) => {
        const supplierRubros = getSupplierRubroNames(row.id);
        return (
          <Button
            variant="ghost"
            size="sm"
            className="gap-1"
            onClick={() => openRubrosDialog(row)}
            data-testid={`button-rubros-${row.id}`}
          >
            <Tags className="h-3.5 w-3.5" />
            {supplierRubros.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {supplierRubros.slice(0, 2).map((rubro: any) => (
                  <Badge key={rubro.id} variant="secondary" className="text-xs">{rubro.name}</Badge>
                ))}
                {supplierRubros.length > 2 && (
                  <Badge variant="outline" className="text-xs">+{supplierRubros.length - 2}</Badge>
                )}
              </div>
            ) : (
              <span className="text-muted-foreground text-xs">Asignar</span>
            )}
          </Button>
        );
      },
    },
    {
      key: "cuit",
      header: "CUIT",
      cell: (row) => row.cuit ? <span className="font-mono text-sm">{formatCuit(row.cuit)}</span> : <span className="text-muted-foreground">-</span>,
    },
    {
      key: "ivaCondition",
      header: "Cond. IVA",
      cell: (row) => {
        const cond = IVA_CONDITIONS.find(c => c.value === row.ivaCondition);
        return cond ? <Badge variant="outline">{cond.label}</Badge> : <span className="text-muted-foreground">-</span>;
      },
    },
    {
      key: "phone",
      header: "Telefono",
      cell: (row) => row.phone || <span className="text-muted-foreground">-</span>,
    },
    {
      key: "email",
      header: "Email",
      cell: (row) => row.email || <span className="text-muted-foreground">-</span>,
    },
    {
      key: "paymentDays",
      header: "Dias de Pago",
      cell: (row) => (
        <Badge variant="secondary">
          {row.paymentDays || 0} dias
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
            onClick={() => setDeleteSupplier(row)}
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
        title="Proveedores"
        description="Gestiona los proveedores de tu negocio"
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
        data={suppliers}
        isLoading={isLoading}
        searchPlaceholder="Buscar por nombre, razon social o CUIT..."
        searchKeys={["tradeName", "businessName", "cuit"]}
        filters={[
          {
            key: "ivaCondition",
            label: "Cond. IVA",
            allLabel: "Todas las condiciones",
            options: IVA_CONDITIONS,
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
        ] as FilterConfig<Supplier>[]}
        onAdd={openCreate}
        addLabel="Nuevo Proveedor"
        emptyMessage="No hay proveedores registrados"
      />

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingSupplier ? "Editar Proveedor" : "Nuevo Proveedor"}
            </DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="tradeName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nombre Comercial *</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Ej: Blanca Luna, Verduleria Juan" data-testid="input-tradeName" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="businessName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Razon Social</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="Opcional" data-testid="input-businessName" />
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
                      <FormLabel>CUIT</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder="Opcional"
                          maxLength={11}
                          className="font-mono"
                          data-testid="input-cuit"
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
                    <Select onValueChange={field.onChange} value={field.value || ""}>
                      <FormControl>
                        <SelectTrigger data-testid="select-ivaCondition">
                          <SelectValue placeholder="Seleccionar (opcional)" />
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
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl>
                        <Input {...field} type="email" placeholder="email@ejemplo.com" data-testid="input-email" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Telefono</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="+54 11 1234-5678" data-testid="input-phone" />
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
                      <Textarea {...field} placeholder="Direccion del proveedor" rows={2} data-testid="input-address" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="paymentDays"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Dias de Pago</FormLabel>
                    <FormControl>
                      <Input {...field} type="number" min={0} placeholder="0" data-testid="input-paymentDays" />
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
                    : editingSupplier
                    ? "Actualizar"
                    : "Crear"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteSupplier}
        onOpenChange={(open) => !open && setDeleteSupplier(null)}
        title="Eliminar Proveedor"
        description={`¿Esta seguro que desea eliminar el proveedor "${deleteSupplier?.tradeName}"? Esta accion no se puede deshacer.`}
        confirmLabel="Eliminar"
        onConfirm={() => deleteSupplier && deleteMutation.mutate(deleteSupplier.id)}
        variant="destructive"
        isLoading={deleteMutation.isPending}
      />

      <Dialog open={isImportDialogOpen} onOpenChange={setIsImportDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Importar Proveedores</DialogTitle>
            <DialogDescription>
              Sube un archivo Excel con los proveedores a importar. El archivo debe tener las columnas: Nombre Comercial (requerido), Razon Social, CUIT, Condicion IVA, Email, Telefono, Direccion, Dias de Pago.
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
              <Button 
                disabled={importMutation.isPending}
                onClick={() => fileInputRef.current?.click()}
              >
                {importMutation.isPending ? "Importando..." : "Seleccionar Archivo"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isRubrosDialogOpen} onOpenChange={(open) => {
        if (!open) {
          setIsRubrosDialogOpen(false);
          setRubrosSupplier(null);
        }
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Rubros del Proveedor</DialogTitle>
            <DialogDescription>
              Selecciona los rubros que maneja "{rubrosSupplier?.tradeName}"
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 max-h-80 overflow-y-auto">
            {rubros.filter(r => r.active).map((rubro) => (
              <label
                key={rubro.id}
                className="flex items-center gap-3 p-3 rounded-lg border cursor-pointer hover-elevate"
                data-testid={`checkbox-rubro-${rubro.id}`}
              >
                <Checkbox
                  checked={selectedRubroIds.includes(rubro.id)}
                  onCheckedChange={() => toggleRubro(rubro.id)}
                />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">{rubro.name}</div>
                </div>
              </label>
            ))}
            {rubros.filter(r => r.active).length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">
                No hay rubros activos registrados
              </p>
            )}
          </div>
          <div className="flex items-center justify-between pt-2">
            <span className="text-sm text-muted-foreground">
              {selectedRubroIds.length} rubro{selectedRubroIds.length !== 1 ? "s" : ""} seleccionado{selectedRubroIds.length !== 1 ? "s" : ""}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => { setIsRubrosDialogOpen(false); setRubrosSupplier(null); }} data-testid="button-rubros-cancel">
                Cancelar
              </Button>
              <Button
                onClick={() => rubrosSupplier && saveRubrosMutation.mutate({ supplierId: rubrosSupplier.id, rubroIds: selectedRubroIds })}
                disabled={saveRubrosMutation.isPending}
                data-testid="button-rubros-save"
              >
                {saveRubrosMutation.isPending ? "Guardando..." : "Guardar"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
