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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatCurrency, formatDate } from "@/lib/formatters";
import { Edit, Trash2, Package, Upload, Download, Users, Building2 } from "lucide-react";
import type { Supply, Rubro, SubRubro, UnitOfMeasure, Supplier, SupplySupplier } from "@shared/schema";

interface SubRubroWithRubro extends SubRubro {
  rubro?: Rubro | null;
}

interface SupplyWithRelations extends Supply {
  rubro?: Rubro | null;
  subRubro?: SubRubro | null;
  unitOfMeasure?: UnitOfMeasure | null;
  lastPurchaseValue?: string | number | null;
  lastPurchaseQuantity?: string | number | null;
  lastPurchaseUnitCost?: string | number | null;
  lastPurchaseDate?: Date | string | null;
}

const formSchema = z.object({
  name: z.string().min(1, "El nombre es requerido"),
  subRubroId: z.coerce.number().optional(),
  unitOfMeasureId: z.coerce.number().optional(),
});

type FormData = z.infer<typeof formSchema>;

export default function SuppliesPage() {
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [isSuppliersDialogOpen, setIsSuppliersDialogOpen] = useState(false);
  const [suppliersSupply, setSuppliersSupply] = useState<SupplyWithRelations | null>(null);
  const [selectedSupplierIds, setSelectedSupplierIds] = useState<number[]>([]);
  const [editingSupply, setEditingSupply] = useState<SupplyWithRelations | null>(null);
  const [deleteSupply, setDeleteSupply] = useState<SupplyWithRelations | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: supplies = [], isLoading } = useQuery<SupplyWithRelations[]>({
    queryKey: ["/api/supplies"],
  });

  const { data: rubros = [] } = useQuery<Rubro[]>({
    queryKey: ["/api/rubros"],
  });

  const { data: subRubros = [] } = useQuery<SubRubroWithRubro[]>({
    queryKey: ["/api/sub-rubros"],
  });

  const { data: units = [] } = useQuery<UnitOfMeasure[]>({
    queryKey: ["/api/units"],
  });

  const { data: suppliers = [] } = useQuery<Supplier[]>({
    queryKey: ["/api/suppliers"],
  });

  const { data: allSupplySuppliers = [] } = useQuery<SupplySupplier[]>({
    queryKey: ["/api/supply-suppliers"],
  });

  const { data: currentSupplySuppliers = [] } = useQuery<SupplySupplier[]>({
    queryKey: ["/api/supply-suppliers", suppliersSupply?.id],
    queryFn: async () => {
      if (!suppliersSupply) return [];
      const res = await fetch(`/api/supply-suppliers/${suppliersSupply.id}`, { credentials: "include" });
      if (!res.ok) throw new Error("Error al cargar proveedores");
      return res.json();
    },
    enabled: !!suppliersSupply,
  });

  useEffect(() => {
    if (currentSupplySuppliers.length > 0) {
      setSelectedSupplierIds(currentSupplySuppliers.map(ss => ss.supplierId));
    } else if (suppliersSupply) {
      setSelectedSupplierIds([]);
    }
  }, [currentSupplySuppliers, suppliersSupply]);

  const saveSuppliersMutation = useMutation({
    mutationFn: async ({ supplyId, supplierIds }: { supplyId: number; supplierIds: number[] }) => {
      await apiRequest("PUT", `/api/supply-suppliers/${supplyId}`, { supplierIds });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/supply-suppliers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/supply-suppliers", suppliersSupply?.id] });
      toast({ title: "Proveedores actualizados correctamente" });
      setIsSuppliersDialogOpen(false);
      setSuppliersSupply(null);
    },
    onError: (error: Error) => {
      toast({ title: "Error al guardar proveedores", description: error.message, variant: "destructive" });
    },
  });

  const getSupplierCount = (supplyId: number) => {
    return allSupplySuppliers.filter(ss => ss.supplyId === supplyId).length;
  };

  const openSuppliersDialog = (supply: SupplyWithRelations) => {
    setSuppliersSupply(supply);
    setIsSuppliersDialogOpen(true);
  };

  const toggleSupplier = (supplierId: number) => {
    setSelectedSupplierIds(prev =>
      prev.includes(supplierId)
        ? prev.filter(id => id !== supplierId)
        : [...prev, supplierId]
    );
  };

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      subRubroId: undefined,
      unitOfMeasureId: undefined,
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: FormData) => {
      const res = await apiRequest("POST", "/api/supplies", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/supplies"] });
      toast({ title: "Insumo creado correctamente" });
      closeDialog();
    },
    onError: (error: Error) => {
      toast({ title: "Error al crear insumo", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: FormData }) => {
      const res = await apiRequest("PATCH", `/api/supplies/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/supplies"] });
      toast({ title: "Insumo actualizado correctamente" });
      closeDialog();
    },
    onError: (error: Error) => {
      toast({ title: "Error al actualizar insumo", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/supplies/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/supplies"] });
      toast({ title: "Insumo eliminado correctamente" });
      setDeleteSupply(null);
    },
    onError: (error: Error) => {
      toast({ title: "Error al eliminar insumo", description: error.message, variant: "destructive" });
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, active }: { id: number; active: boolean }) => {
      const res = await apiRequest("PATCH", `/api/supplies/${id}`, { active });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/supplies"] });
      toast({ title: "Estado actualizado" });
    },
    onError: (error: Error) => {
      toast({ title: "Error al cambiar estado", description: error.message, variant: "destructive" });
    },
  });

  const importMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/supplies/import", {
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
      queryClient.invalidateQueries({ queryKey: ["/api/supplies"] });
      toast({ 
        title: "Importacion completada", 
        description: `${data.imported} de ${data.total} insumos importados` 
      });
      setIsImportDialogOpen(false);
    },
    onError: (error: Error) => {
      toast({ title: "Error al importar", description: error.message, variant: "destructive" });
    },
  });

  const handleExport = async () => {
    try {
      const res = await fetch("/api/supplies/export", {
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
      a.download = "insumos.xlsx";
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
    setEditingSupply(null);
    form.reset({ name: "", subRubroId: undefined, unitOfMeasureId: undefined });
    setIsDialogOpen(true);
  };

  const openEdit = (supply: SupplyWithRelations) => {
    setEditingSupply(supply);
    form.reset({
      name: supply.name,
      subRubroId: supply.subRubroId || undefined,
      unitOfMeasureId: supply.unitOfMeasureId || undefined,
    });
    setIsDialogOpen(true);
  };

  const closeDialog = () => {
    setIsDialogOpen(false);
    setEditingSupply(null);
    form.reset();
  };

  const onSubmit = (data: FormData) => {
    if (editingSupply) {
      updateMutation.mutate({ id: editingSupply.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const columns: Column<SupplyWithRelations>[] = [
    {
      key: "name",
      header: "Nombre",
      cell: (row) => (
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
            <Package className="h-4 w-4 text-primary" />
          </div>
          <span className="font-medium">{row.name}</span>
        </div>
      ),
    },
    {
      key: "subRubro",
      header: "Sub-Rubro",
      cell: (row) =>
        row.subRubro ? (
          <div className="flex flex-col gap-0.5">
            <Badge variant="secondary">{row.subRubro.name}</Badge>
            {row.rubro && <span className="text-xs text-muted-foreground">{row.rubro.name}</span>}
          </div>
        ) : (
          <span className="text-muted-foreground">-</span>
        ),
    },
    {
      key: "lastPurchaseDate",
      header: "Ultima Compra",
      cell: (row) =>
        row.lastPurchaseDate ? (
          <span className="font-mono text-sm">
            {formatDate(row.lastPurchaseDate)}
          </span>
        ) : (
          <span className="text-muted-foreground">-</span>
        ),
    },
    {
      key: "unit",
      header: "Unidad",
      cell: (row) =>
        row.unitOfMeasure ? (
          <Badge variant="outline" className="font-mono">
            {row.unitOfMeasure.abbreviation}
          </Badge>
        ) : (
          <span className="text-muted-foreground">-</span>
        ),
    },
    {
      key: "lastCost",
      header: "Costo Ult. Compra",
      cell: (row) => {
        const lastCost = parseFloat(String(row.lastPurchaseValue ?? row.lastCost) || "0");
        return lastCost > 0 ? (
          <span className="font-mono text-sm">{formatCurrency(lastCost)}</span>
        ) : (
          <span className="text-muted-foreground">-</span>
        );
      },
    },
    {
      key: "lastQuantity",
      header: "Cant. Ult. Compra",
      cell: (row) => {
        const lastQty = parseFloat(String(row.lastPurchaseQuantity ?? row.lastQuantity) || "0");
        return lastQty > 0 ? (
          <span className="font-mono text-sm">
            {lastQty} {row.unitOfMeasure?.abbreviation || "u"}
          </span>
        ) : (
          <span className="text-muted-foreground">-</span>
        );
      },
    },
    {
      key: "unitCost",
      header: "Costo x UM",
      cell: (row) => {
        const lastUnitCost = parseFloat(String(row.lastPurchaseUnitCost) || "0");
        const lastCost = parseFloat(String(row.lastPurchaseValue ?? row.lastCost) || "0");
        const lastQty = parseFloat(String(row.lastPurchaseQuantity ?? row.lastQuantity) || "0");
        const costPerUnit = lastUnitCost > 0 ? lastUnitCost : (lastQty > 0 ? lastCost / lastQty : parseFloat(String(row.unitCost) || "0"));
        return costPerUnit > 0 ? (
          <div className="text-sm">
            <span className="font-mono font-medium">{formatCurrency(costPerUnit)}</span>
            {row.unitOfMeasure && (
              <span className="text-muted-foreground text-xs">/{row.unitOfMeasure.abbreviation}</span>
            )}
          </div>
        ) : (
          <span className="text-muted-foreground">-</span>
        );
      },
    },
    {
      key: "suppliers",
      header: "Proveedores",
      cell: (row) => {
        const count = getSupplierCount(row.id);
        return (
          <Button
            variant="ghost"
            size="sm"
            className="gap-1"
            onClick={() => openSuppliersDialog(row)}
            data-testid={`button-suppliers-${row.id}`}
          >
            <Building2 className="h-3.5 w-3.5" />
            {count > 0 ? (
              <Badge variant="secondary">{count}</Badge>
            ) : (
              <span className="text-muted-foreground text-xs">Asignar</span>
            )}
          </Button>
        );
      },
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
            onClick={() => setDeleteSupply(row)}
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
        title="Insumos"
        description="Gestiona los insumos y materias primas"
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
        data={supplies}
        isLoading={isLoading}
        searchPlaceholder="Buscar por nombre..."
        searchKeys={["name"]}
        filters={[
          {
            key: "rubroId",
            label: "Rubro",
            allLabel: "Todos los rubros",
            options: rubros
              .filter((r) => r.active)
              .map((r) => ({ value: String(r.id), label: r.name })),
          },
          {
            key: "subRubroId",
            label: "Sub-Rubro",
            allLabel: "Todos los sub-rubros",
            options: subRubros.map((sr) => ({ value: String(sr.id), label: `${sr.name}${sr.rubro ? ` (${sr.rubro.name})` : ""}` })),
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
        ] as FilterConfig<SupplyWithRelations>[]}
        onAdd={openCreate}
        addLabel="Nuevo Insumo"
        emptyMessage="No hay insumos registrados. Los costos se actualizan automaticamente al cargar facturas."
      />

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingSupply ? "Editar Insumo" : "Nuevo Insumo"}
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
                      <Input {...field} placeholder="Nombre del insumo" data-testid="input-name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="subRubroId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Sub-Rubro</FormLabel>
                      <Select
                        onValueChange={(val) => field.onChange(val ? parseInt(val) : undefined)}
                        value={field.value?.toString() || ""}
                      >
                        <FormControl>
                          <SelectTrigger data-testid="select-sub-rubro">
                            <SelectValue placeholder="Seleccionar sub-rubro" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {rubros.filter(r => r.active).map((rubro) => {
                            const rubroSubRubros = subRubros.filter(sr => sr.rubroId === rubro.id);
                            if (rubroSubRubros.length === 0) return null;
                            return (
                              <div key={rubro.id}>
                                <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">{rubro.name}</div>
                                {rubroSubRubros.map((sr) => (
                                  <SelectItem key={sr.id} value={sr.id.toString()}>
                                    {sr.name}
                                  </SelectItem>
                                ))}
                              </div>
                            );
                          })}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="unitOfMeasureId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Unidad de Medida</FormLabel>
                      <Select
                        onValueChange={(val) => field.onChange(val ? parseInt(val) : undefined)}
                        value={field.value?.toString() || ""}
                      >
                        <FormControl>
                          <SelectTrigger data-testid="select-unit">
                            <SelectValue placeholder="Seleccionar unidad" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {units.filter(u => u.active).map((unit) => (
                            <SelectItem key={unit.id} value={unit.id.toString()}>
                              {unit.name} ({unit.abbreviation})
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
                    : editingSupply
                    ? "Actualizar"
                    : "Crear"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteSupply}
        onOpenChange={(open) => !open && setDeleteSupply(null)}
        title="Eliminar Insumo"
        description={`¿Esta seguro que desea eliminar el insumo "${deleteSupply?.name}"? Esta accion no se puede deshacer.`}
        confirmLabel="Eliminar"
        onConfirm={() => deleteSupply && deleteMutation.mutate(deleteSupply.id)}
        variant="destructive"
        isLoading={deleteMutation.isPending}
      />

      <Dialog open={isImportDialogOpen} onOpenChange={setIsImportDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Importar Insumos</DialogTitle>
            <DialogDescription>
              Sube un archivo Excel con los insumos a importar. El archivo debe tener las columnas: Nombre (requerido), Codigo, Rubro, Unidad, Costo Unitario, Stock Minimo, Stock Actual.
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

      <Dialog open={isSuppliersDialogOpen} onOpenChange={(open) => {
        if (!open) {
          setIsSuppliersDialogOpen(false);
          setSuppliersSupply(null);
        }
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Proveedores Permitidos</DialogTitle>
            <DialogDescription>
              Selecciona los proveedores que pueden vender "{suppliersSupply?.name}"
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 max-h-80 overflow-y-auto">
            {suppliers.filter(s => s.active).map((supplier) => (
              <label
                key={supplier.id}
                className="flex items-center gap-3 p-3 rounded-lg border cursor-pointer hover-elevate"
                data-testid={`checkbox-supplier-${supplier.id}`}
              >
                <Checkbox
                  checked={selectedSupplierIds.includes(supplier.id)}
                  onCheckedChange={() => toggleSupplier(supplier.id)}
                />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">{supplier.businessName}</div>
                  {supplier.cuit && (
                    <div className="text-xs text-muted-foreground font-mono">{supplier.cuit}</div>
                  )}
                </div>
              </label>
            ))}
            {suppliers.filter(s => s.active).length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">
                No hay proveedores activos registrados
              </p>
            )}
          </div>
          <div className="flex items-center justify-between pt-2">
            <span className="text-sm text-muted-foreground">
              {selectedSupplierIds.length} proveedor{selectedSupplierIds.length !== 1 ? "es" : ""} seleccionado{selectedSupplierIds.length !== 1 ? "s" : ""}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => { setIsSuppliersDialogOpen(false); setSuppliersSupply(null); }} data-testid="button-suppliers-cancel">
                Cancelar
              </Button>
              <Button
                onClick={() => suppliersSupply && saveSuppliersMutation.mutate({ supplyId: suppliersSupply.id, supplierIds: selectedSupplierIds })}
                disabled={saveSuppliersMutation.isPending}
                data-testid="button-suppliers-save"
              >
                {saveSuppliersMutation.isPending ? "Guardando..." : "Guardar"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
