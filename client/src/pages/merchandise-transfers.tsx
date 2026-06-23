import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm, useFieldArray, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { PageHeader } from "@/components/page-header";
import { DataTable, Column } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatCurrency, formatDate, formatDateInput } from "@/lib/formatters";
import { Plus, Trash2, ArrowRight, ChevronsUpDown, RotateCcw } from "lucide-react";
import { DataEntryCombobox } from "@/components/data-entry-combobox";
import type { Local, Supply } from "@shared/schema";
import { cn } from "@/lib/utils";

interface TransferItem {
  supplyId?: number;
  description?: string;
  quantity: number;
  unitCost: number;
  lineTotal: number;
}

interface Transfer {
  id: number;
  clientId: number;
  fromLocalId: number;
  toLocalId: number;
  transferDate: string;
  totalValue: number | string;
  status: string;
  notes?: string | null;
  createdAt?: string;
  fromLocal?: Local;
  toLocal?: Local;
  items?: TransferItem[];
}

const lineSchema = z.object({
  supplyId: z.coerce.number().optional(),
  description: z.string().optional(),
  quantity: z.coerce.number().min(0.0001, "Cantidad requerida"),
  unitCost: z.coerce.number().min(0.0001, "Costo requerido"),
  lineTotal: z.coerce.number(),
});

const formSchema = z.object({
  fromLocalId: z.coerce.number().min(1, "Seleccione local de origen"),
  toLocalId: z.coerce.number().min(1, "Seleccione local de destino"),
  transferDate: z.string().min(1, "Fecha requerida"),
  notes: z.string().optional(),
  items: z.array(lineSchema).min(1, "Debe agregar al menos un ítem"),
}).refine((d) => d.fromLocalId !== d.toLocalId, {
  message: "El local de origen y destino deben ser distintos",
  path: ["toLocalId"],
});

type FormData = z.infer<typeof formSchema>;

export default function MerchandiseTransfersPage() {
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [reverseTarget, setReverseTarget] = useState<Transfer | null>(null);
  const [openSupplyPicker, setOpenSupplyPicker] = useState<number | null>(null);

  const { data: transfers = [], isLoading } = useQuery<Transfer[]>({
    queryKey: ["/api/merchandise-transfers"],
  });

  const { data: locals = [] } = useQuery<Local[]>({ queryKey: ["/api/locals"] });
  const { data: supplies = [] } = useQuery<Supply[]>({ queryKey: ["/api/supplies"] });

  const activeLocals = useMemo(() => locals.filter((l) => l.active), [locals]);
  const activeSupplies = useMemo(() => supplies.filter((s) => s.active), [supplies]);

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      fromLocalId: 0,
      toLocalId: 0,
      transferDate: formatDateInput(new Date()),
      notes: "",
      items: [{ supplyId: undefined, description: "", quantity: 1, unitCost: 0, lineTotal: 0 }],
    },
  });

  const { fields, append, remove } = useFieldArray({ control: form.control, name: "items" });
  const watchItems = useWatch({ control: form.control, name: "items" }) ?? [];
  const watchFrom = form.watch("fromLocalId");
  const watchTo = form.watch("toLocalId");

  const totalValue = useMemo(
    () => watchItems.reduce((acc, it) => acc + (Number(it?.lineTotal) || 0), 0),
    [watchItems],
  );

  const handleSupplyChange = (index: number, supplyId: number) => {
    const supply = supplies.find((s) => s.id === supplyId);
    if (supply) {
      form.setValue(`items.${index}.supplyId`, supplyId);
      form.setValue(`items.${index}.description`, supply.name);
      const cpp = parseFloat(String(supply.unitCost)) || 0;
      form.setValue(`items.${index}.unitCost`, cpp);
      const qty = Number(form.getValues(`items.${index}.quantity`)) || 1;
      form.setValue(`items.${index}.lineTotal`, parseFloat((cpp * qty).toFixed(2)));
    }
  };

  const recalcLineTotal = (index: number) => {
    const qty = Number(form.getValues(`items.${index}.quantity`)) || 0;
    const cost = Number(form.getValues(`items.${index}.unitCost`)) || 0;
    form.setValue(`items.${index}.lineTotal`, parseFloat((qty * cost).toFixed(2)));
  };

  const createMutation = useMutation({
    mutationFn: async (data: FormData) => {
      const res = await apiRequest("POST", "/api/merchandise-transfers", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/merchandise-transfers"] });
      toast({ title: "Traslado registrado correctamente" });
      setShowForm(false);
      form.reset({
        fromLocalId: 0,
        toLocalId: 0,
        transferDate: formatDateInput(new Date()),
        notes: "",
        items: [{ supplyId: undefined, description: "", quantity: 1, unitCost: 0, lineTotal: 0 }],
      });
    },
    onError: (error: Error) => {
      toast({ title: "Error al registrar traslado", description: error.message, variant: "destructive" });
    },
  });

  const reverseMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("POST", `/api/merchandise-transfers/${id}/reverse`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/merchandise-transfers"] });
      toast({ title: "Traslado anulado" });
      setReverseTarget(null);
    },
    onError: (error: Error) => {
      toast({ title: "Error al anular traslado", description: error.message, variant: "destructive" });
    },
  });

  const columns: Column<Transfer>[] = [
    {
      key: "transferDate",
      header: "Fecha",
      cell: (row) => formatDate(row.transferDate),
    },
    {
      key: "fromLocalId",
      header: "Desde → Hasta",
      cell: (row) => (
        <div className="flex items-center gap-2 font-medium">
          <span>{row.fromLocal?.name ?? `Local ${row.fromLocalId}`}</span>
          <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
          <span>{row.toLocal?.name ?? `Local ${row.toLocalId}`}</span>
        </div>
      ),
    },
    {
      key: "totalValue",
      header: "Total",
      className: "text-right",
      cell: (row) => (
        <span className="font-mono font-medium">{formatCurrency(row.totalValue)}</span>
      ),
    },
    {
      key: "status",
      header: "Estado",
      cell: (row) => (
        <Badge variant={row.status === "active" ? "default" : "secondary"}>
          {row.status === "active" ? "Activo" : "Anulado"}
        </Badge>
      ),
    },
    {
      key: "actions",
      header: "",
      className: "w-16",
      cell: (row) => row.status === "active" ? (
        <Button
          variant="ghost"
          size="icon"
          title="Anular traslado"
          onClick={() => setReverseTarget(row)}
        >
          <RotateCcw className="h-4 w-4 text-destructive" />
        </Button>
      ) : null,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Traslados de Mercadería"
        description="Movimientos internos entre locales. Afectan el CMV: restan en el local emisor y suman en el receptor."
        actions={
          <Button onClick={() => setShowForm(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Nuevo Traslado
          </Button>
        }
      />

      <DataTable
        columns={columns}
        data={transfers}
        isLoading={isLoading}
        searchPlaceholder="Buscar por local..."
        searchKeys={[]}
        emptyMessage="No hay traslados registrados."
        pageSize={15}
      />

      <Dialog open={showForm} onOpenChange={(o) => { if (!o) { setShowForm(false); } }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nuevo Traslado de Mercadería</DialogTitle>
          </DialogHeader>

          <Form {...form}>
            <form onSubmit={form.handleSubmit((d) => createMutation.mutate(d))} className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-3">
                <FormField control={form.control} name="fromLocalId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Local Emisor *</FormLabel>
                    <FormControl>
                      <DataEntryCombobox
                        options={activeLocals.map((l) => ({ value: String(l.id), label: l.name }))}
                        value={field.value ? String(field.value) : ""}
                        onValueChange={(v) => field.onChange(parseInt(v, 10))}
                        placeholder="Seleccionar"
                        searchPlaceholder="Buscar local…"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="toLocalId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Local Receptor *</FormLabel>
                    <FormControl>
                      <DataEntryCombobox
                        options={activeLocals
                          .filter((l) => l.id !== Number(watchFrom))
                          .map((l) => ({ value: String(l.id), label: l.name }))}
                        value={field.value ? String(field.value) : ""}
                        onValueChange={(v) => field.onChange(parseInt(v, 10))}
                        placeholder="Seleccionar"
                        searchPlaceholder="Buscar local…"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="transferDate" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Fecha *</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              {watchFrom > 0 && watchTo > 0 && (
                <div className="flex items-center gap-3 rounded-md bg-muted/50 px-4 py-2 text-sm font-medium">
                  <span>{activeLocals.find((l) => l.id === Number(watchFrom))?.name ?? "—"}</span>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  <span>{activeLocals.find((l) => l.id === Number(watchTo))?.name ?? "—"}</span>
                </div>
              )}

              <Card>
                <CardHeader className="flex flex-row items-center justify-between gap-2 py-3">
                  <CardTitle className="text-base">Ítems</CardTitle>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => append({ supplyId: undefined, description: "", quantity: 1, unitCost: 0, lineTotal: 0 })}
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Agregar Ítem
                  </Button>
                </CardHeader>
                <CardContent className="space-y-3">
                  {fields.map((field, index) => {
                    const selectedSupply = supplies.find((s) => s.id === watchItems[index]?.supplyId);
                    return (
                      <div key={field.id} className="grid gap-3 p-3 rounded-lg border bg-muted/20">
                        <div className="grid gap-3 sm:grid-cols-2">
                          <FormField control={form.control} name={`items.${index}.supplyId`} render={({ field: f }) => (
                            <FormItem>
                              <FormLabel>Insumo</FormLabel>
                              <Popover open={openSupplyPicker === index} onOpenChange={(o) => setOpenSupplyPicker(o ? index : null)} modal>
                                <PopoverTrigger asChild>
                                  <FormControl>
                                    <Button
                                      type="button"
                                      variant="outline"
                                      role="combobox"
                                      className={cn("w-full justify-between font-normal", !f.value && "text-muted-foreground")}
                                    >
                                      <span className="truncate text-left">
                                        {selectedSupply ? selectedSupply.name : "Seleccionar insumo"}
                                      </span>
                                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                    </Button>
                                  </FormControl>
                                </PopoverTrigger>
                                <PopoverContent className="w-[min(100vw-2rem,380px)] p-0" align="start">
                                  <Command>
                                    <CommandInput placeholder="Buscar insumo..." />
                                    <CommandList>
                                      <CommandEmpty>Sin resultados</CommandEmpty>
                                      <CommandGroup>
                                        {activeSupplies.map((s) => (
                                          <CommandItem
                                            key={s.id}
                                            value={`${s.name} ${s.id}`}
                                            onSelect={() => { handleSupplyChange(index, s.id); setOpenSupplyPicker(null); }}
                                          >
                                            {s.name}
                                          </CommandItem>
                                        ))}
                                      </CommandGroup>
                                    </CommandList>
                                  </Command>
                                </PopoverContent>
                              </Popover>
                            </FormItem>
                          )} />

                          <FormField control={form.control} name={`items.${index}.description`} render={({ field: f }) => (
                            <FormItem>
                              <FormLabel>Descripción</FormLabel>
                              <FormControl>
                                <Input {...f} placeholder="Descripción del ítem" />
                              </FormControl>
                            </FormItem>
                          )} />
                        </div>

                        <div className="grid gap-3 sm:grid-cols-4 items-end">
                          <FormField control={form.control} name={`items.${index}.quantity`} render={({ field: f }) => (
                            <FormItem>
                              <FormLabel>Cantidad</FormLabel>
                              <FormControl>
                                <Input
                                  type="number"
                                  step="0.0001"
                                  min="0"
                                  {...f}
                                  className="font-mono"
                                  onChange={(e) => { f.onChange(e); setTimeout(() => recalcLineTotal(index), 0); }}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )} />

                          <FormField control={form.control} name={`items.${index}.unitCost`} render={({ field: f }) => (
                            <FormItem>
                              <FormLabel>Costo Unitario</FormLabel>
                              <FormControl>
                                <Input
                                  type="number"
                                  step="0.0001"
                                  min="0"
                                  {...f}
                                  className="font-mono"
                                  onChange={(e) => { f.onChange(e); setTimeout(() => recalcLineTotal(index), 0); }}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )} />

                          <div>
                            <FormLabel>Total Línea</FormLabel>
                            <div className="h-9 min-h-9 px-3 py-2 rounded-md border bg-muted font-mono text-sm flex items-center">
                              {formatCurrency(watchItems[index]?.lineTotal ?? 0)}
                            </div>
                          </div>

                          {fields.length > 1 && (
                            <Button type="button" variant="ghost" size="icon" onClick={() => remove(index)} className="mb-0">
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  <div className="flex justify-end pt-2">
                    <div className="flex items-center gap-3 font-medium">
                      <span className="text-muted-foreground text-sm">Total Traslado:</span>
                      <span className="font-mono text-lg">{formatCurrency(totalValue)}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <FormField control={form.control} name="notes" render={({ field }) => (
                <FormItem>
                  <FormLabel>Notas</FormLabel>
                  <FormControl>
                    <Textarea {...field} placeholder="Observaciones..." rows={2} />
                  </FormControl>
                </FormItem>
              )} />

              <DialogFooter className="gap-2">
                <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={createMutation.isPending}>
                  {createMutation.isPending ? "Guardando..." : "Registrar Traslado"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!reverseTarget}
        onOpenChange={(o) => !o && setReverseTarget(null)}
        title="Anular Traslado"
        description={`¿Anular el traslado de ${reverseTarget?.fromLocal?.name ?? "—"} → ${reverseTarget?.toLocal?.name ?? "—"} por ${formatCurrency(reverseTarget?.totalValue ?? 0)}? El ajuste dejará de aplicarse en el CMV.`}
        confirmLabel="Anular"
        onConfirm={() => reverseTarget && reverseMutation.mutate(reverseTarget.id)}
        variant="destructive"
        isLoading={reverseMutation.isPending}
      />
    </div>
  );
}
