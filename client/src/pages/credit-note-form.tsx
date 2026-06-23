import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm, useFieldArray, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useLocation } from "wouter";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { DataEntryCombobox } from "@/components/data-entry-combobox";
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
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatCurrency, formatDateInput } from "@/lib/formatters";
import { Plus, Trash2, Check, ChevronsUpDown } from "lucide-react";
import type { Supplier, Local, Supply, Tax, Rubro, Invoice } from "@shared/schema";
import { computeInvoiceTaxes, isInternalTaxType } from "@shared/invoiceTaxComputation";
import { formatInvoiceVoucherDisplay } from "@shared/invoiceDisplay";
import { cn } from "@/lib/utils";
import { QuickCreateSupplierDialog } from "@/components/quick-create-supplier-dialog";
import { QuickCreateSupplyDialog } from "@/components/quick-create-supply-dialog";

interface SupplyWithDetails extends Supply {
  rubro?: Rubro | null;
}

const NC_TYPES = [
  { value: "NC-A", label: "Nota de Crédito A" },
  { value: "NC-B", label: "Nota de Crédito B" },
  { value: "NC-C", label: "Nota de Crédito C" },
];

const ivaConditions = [
  { value: "responsable_inscripto", label: "Responsable Inscripto" },
  { value: "monotributista", label: "Monotributista" },
  { value: "exento", label: "Exento" },
  { value: "consumidor_final", label: "Consumidor Final" },
];

const itemSchema = z.object({
  supplyId: z.coerce.number().optional(),
  description: z.string().optional(),
  quantity: z.coerce.number().min(0.0001, "Cantidad requerida"),
  unitPrice: z.coerce.number().min(0),
  subtotal: z.coerce.number().min(0.01, "Subtotal requerido"),
  rubroId: z.coerce.number().optional(),
  taxId: z.preprocess(
    (v) => (v === "" || v === undefined || v === null ? undefined : v),
    z.coerce.number().optional(),
  ),
});

const taxItemSchema = z.object({
  taxId: z.coerce.number(),
  baseAmount: z.coerce.number(),
  taxAmount: z.coerce.number(),
});

const formSchema = z.object({
  localId: z.coerce.number().min(1, "Seleccione un local"),
  supplierId: z.coerce.number().min(1, "Seleccione un proveedor"),
  linkedInvoiceId: z.coerce.number().optional(),
  invoiceSalePoint: z.string().regex(/^\d{4}$/, "Exactamente 4 dígitos"),
  invoiceNumber: z.string().regex(/^\d{8}$/, "Exactamente 8 dígitos"),
  invoiceType: z.string().min(1),
  invoiceDate: z.string().min(1, "Fecha requerida"),
  ivaCondition: z.string().optional(),
  notes: z.string().optional(),
  items: z.array(itemSchema).min(1, "Debe agregar al menos un ítem"),
  taxes: z.array(taxItemSchema).default([]),
});

type FormData = z.infer<typeof formSchema>;

export default function CreditNoteFormPage() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [openSupplyPickerIndex, setOpenSupplyPickerIndex] = useState<number | null>(null);
  const [confirmedItems, setConfirmedItems] = useState<Set<number>>(new Set());
  const [addTaxComboKey, setAddTaxComboKey] = useState(0);
  const [openLinkedInvoice, setOpenLinkedInvoice] = useState(false);
  const [showCreateSupplier, setShowCreateSupplier] = useState(false);
  const [createSupplyForIndex, setCreateSupplyForIndex] = useState<number | null>(null);

  const { data: suppliers = [] } = useQuery<Supplier[]>({ queryKey: ["/api/suppliers"] });
  const { data: locals = [] } = useQuery<Local[]>({ queryKey: ["/api/locals"] });
  const { data: supplies = [] } = useQuery<SupplyWithDetails[]>({ queryKey: ["/api/supplies"] });
  const { data: taxes = [] } = useQuery<Tax[]>({ queryKey: ["/api/taxes"] });
  const { data: invoices = [] } = useQuery<Invoice[]>({ queryKey: ["/api/invoices"] });

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      localId: 0,
      supplierId: 0,
      linkedInvoiceId: undefined,
      invoiceSalePoint: "",
      invoiceNumber: "",
      invoiceType: "NC-A",
      invoiceDate: formatDateInput(new Date()),
      ivaCondition: "responsable_inscripto",
      notes: "",
      items: [{ supplyId: undefined, description: "", quantity: 1, unitPrice: 0, subtotal: 0, rubroId: undefined, taxId: undefined }],
      taxes: [],
    },
  });

  const { fields: itemFields, prepend: prependItem, remove: removeItem } = useFieldArray({ control: form.control, name: "items" });
  const { fields: taxFields, append: appendTax, remove: removeTax } = useFieldArray({ control: form.control, name: "taxes" });

  const watchItems = useWatch({ control: form.control, name: "items" }) ?? [];
  const watchTaxesRows = useWatch({ control: form.control, name: "taxes" }) ?? [];
  const watchSupplierId = form.watch("supplierId");

  const taxesById = useMemo(() => new Map(taxes.map((t) => [t.id, t])), [taxes]);

  const taxComputation = useMemo(() =>
    computeInvoiceTaxes({
      items: watchItems.map((item) => ({ subtotal: item?.subtotal, taxId: item?.taxId })),
      discount: 0,
      invoiceLevelTaxes: watchTaxesRows,
      taxesById,
    }),
    [watchItems, watchTaxesRows, taxesById],
  );

  const calculations = {
    subtotal: taxComputation.itemsSubtotal,
    taxTotal: taxComputation.taxGrandTotal,
    total: taxComputation.subtotalAfterDiscount + taxComputation.taxGrandTotal,
  };

  useEffect(() => {
    watchItems.forEach((item, index) => {
      const qty = Number(item.quantity) || 0;
      const sub = Number(item.subtotal) || 0;
      if (qty > 0) {
        form.setValue(`items.${index}.unitPrice`, sub / qty, { shouldDirty: true, shouldValidate: false });
      }
    });
  }, [watchItems, form]);

  useEffect(() => {
    taxFields.forEach((_, i) => {
      const taxId = form.getValues(`taxes.${i}.taxId`);
      const tax = taxes.find((t) => t.id === taxId);
      if (!tax || isInternalTaxType(tax.type)) return;
      const pct = parseFloat(String(tax.percentage)) || 0;
      const sad = taxComputation.subtotalAfterDiscount;
      form.setValue(`taxes.${i}.baseAmount`, sad, { shouldValidate: false });
      form.setValue(`taxes.${i}.taxAmount`, (sad * pct) / 100, { shouldValidate: false });
    });
  }, [taxComputation.subtotalAfterDiscount, taxFields.length, taxes, form]);

  const activeInvoices = useMemo(
    () => invoices.filter((inv) => inv.status === "active" && !String(inv.invoiceType ?? "").startsWith("NC-")),
    [invoices],
  );

  const supplierActiveInvoices = useMemo(() => {
    const sid = Number(watchSupplierId) || 0;
    return sid ? activeInvoices.filter((inv) => inv.supplierId === sid) : activeInvoices;
  }, [activeInvoices, watchSupplierId]);

  const watchLinkedInvoiceId = form.watch("linkedInvoiceId");
  const linkedInvoiceLabel = useMemo(() => {
    if (!watchLinkedInvoiceId) return "Sin factura asociada";
    const inv = invoices.find((i) => i.id === watchLinkedInvoiceId);
    return inv ? formatInvoiceVoucherDisplay(inv) : "Sin factura asociada";
  }, [watchLinkedInvoiceId, invoices]);

  const handleAddTax = (taxId: number) => {
    const tax = taxes.find((t) => t.id === taxId);
    if (!tax) return;
    const existing = taxFields.find((_, i) => form.getValues(`taxes.${i}.taxId`) === taxId);
    if (existing) { toast({ title: "Este impuesto ya fue agregado", variant: "destructive" }); return; }
    const baseAmount = taxComputation.subtotalAfterDiscount;
    if (isInternalTaxType(tax.type)) {
      appendTax({ taxId, baseAmount, taxAmount: 0 });
      setAddTaxComboKey((k) => k + 1);
      return;
    }
    const pct = parseFloat(String(tax.percentage));
    appendTax({ taxId, baseAmount, taxAmount: (baseAmount * pct) / 100 });
    setAddTaxComboKey((k) => k + 1);
  };

  const handleSupplyChange = (index: number, supplyId: number) => {
    const supply = supplies.find((s) => s.id === supplyId);
    if (supply) {
      form.setValue(`items.${index}.supplyId`, supplyId);
      form.setValue(`items.${index}.description`, supply.name);
      if (supply.rubroId) form.setValue(`items.${index}.rubroId`, supply.rubroId);
    }
  };

  const lineTaxOptions = useMemo(
    () => taxes.filter((t) => t.active !== false && String(t.type ?? "").toLowerCase() === "iva")
      .map((t) => ({ value: String(t.id), label: `${t.name} (${t.percentage}%)` })),
    [taxes],
  );

  const allTaxOptions = useMemo(
    () => taxes.filter((t) => t.active !== false)
      .map((t) => ({ value: String(t.id), label: `${t.name} (${t.percentage}%)` })),
    [taxes],
  );

  const orderedItemIndices = useMemo(() => {
    const n = itemFields.length;
    const all = Array.from({ length: n }, (_, i) => i);
    const drafts = all.filter((i) => !confirmedItems.has(i));
    const confirmed = all.filter((i) => confirmedItems.has(i));
    return [...drafts, ...confirmed];
  }, [itemFields.length, confirmedItems]);

  const createMutation = useMutation({
    mutationFn: async (data: FormData) => {
      const payload = {
        ...data,
        expenseType: "cmv",
        discount: 0,
        advancePayment: 0,
        subtotal: calculations.subtotal,
        taxTotal: calculations.taxTotal,
        total: calculations.total,
        balance: calculations.total,
        paid: false,
      };
      const res = await apiRequest("POST", "/api/invoices", payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices/stats"] });
      toast({ title: "Nota de Crédito registrada correctamente" });
      navigate("/facturas");
    },
    onError: (error: Error) => {
      toast({ title: "Error al registrar la Nota de Crédito", description: error.message, variant: "destructive" });
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Nueva Nota de Crédito"
        description="Registrá una nota de crédito de proveedor. Genera saldo a favor y reduce las compras del período."
        backHref="/facturas"
      />

      <Form {...form}>
        <form onSubmit={form.handleSubmit((d) => createMutation.mutate(d))} className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2 space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Datos del Comprobante</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-3">
                    <FormField control={form.control} name="localId" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Local *</FormLabel>
                        <FormControl>
                          <DataEntryCombobox
                            options={locals.filter((l) => l.active).map((l) => ({ value: String(l.id), label: l.name }))}
                            value={field.value ? String(field.value) : ""}
                            onValueChange={(v) => field.onChange(parseInt(v, 10))}
                            placeholder="Seleccionar local"
                            searchPlaceholder="Buscar local…"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />

                    <FormField control={form.control} name="supplierId" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Proveedor *</FormLabel>
                        <FormControl>
                          <DataEntryCombobox
                            options={[
                              { value: "__new__", label: "+ Crear nuevo proveedor" },
                              ...suppliers.filter((s) => s.active !== false).map((s) => ({ value: String(s.id), label: s.tradeName })),
                            ]}
                            value={field.value ? String(field.value) : ""}
                            onValueChange={(v) => {
                              if (v === "__new__") { setShowCreateSupplier(true); return; }
                              field.onChange(parseInt(v, 10));
                              form.setValue("linkedInvoiceId", undefined);
                            }}
                            placeholder="Seleccionar proveedor"
                            searchPlaceholder="Buscar proveedor…"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />

                    <FormField control={form.control} name="linkedInvoiceId" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Factura Asociada</FormLabel>
                        <Popover open={openLinkedInvoice} onOpenChange={setOpenLinkedInvoice} modal>
                          <PopoverTrigger asChild>
                            <FormControl>
                              <Button
                                type="button"
                                variant="outline"
                                role="combobox"
                                className={cn("w-full justify-between font-normal", !field.value && "text-muted-foreground")}
                              >
                                <span className="truncate text-left">{linkedInvoiceLabel}</span>
                                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                              </Button>
                            </FormControl>
                          </PopoverTrigger>
                          <PopoverContent className="w-[min(100vw-2rem,380px)] p-0" align="start">
                            <Command>
                              <CommandInput placeholder="Buscar factura…" />
                              <CommandList>
                                <CommandEmpty>Sin facturas</CommandEmpty>
                                <CommandGroup>
                                  <CommandItem value="none" onSelect={() => { field.onChange(undefined); setOpenLinkedInvoice(false); }}>
                                    Sin factura asociada
                                  </CommandItem>
                                  {supplierActiveInvoices.map((inv) => (
                                    <CommandItem
                                      key={inv.id}
                                      value={`${formatInvoiceVoucherDisplay(inv)} ${inv.id}`}
                                      onSelect={() => { field.onChange(inv.id); setOpenLinkedInvoice(false); }}
                                    >
                                      {formatInvoiceVoucherDisplay(inv)}
                                      <span className="ml-2 text-xs text-muted-foreground">{inv.invoiceDate}</span>
                                    </CommandItem>
                                  ))}
                                </CommandGroup>
                              </CommandList>
                            </Command>
                          </PopoverContent>
                        </Popover>
                        <p className="text-xs text-muted-foreground">Opcional: factura original que origina esta NC</p>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>

                  <div className="grid gap-4 sm:grid-cols-4">
                    <FormField control={form.control} name="invoiceType" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Tipo *</FormLabel>
                        <FormControl>
                          <DataEntryCombobox
                            options={NC_TYPES.map((t) => ({ value: t.value, label: t.label }))}
                            value={field.value || "NC-A"}
                            onValueChange={field.onChange}
                            placeholder="Tipo NC"
                            searchPlaceholder="Buscar tipo…"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />

                    <FormField control={form.control} name="invoiceSalePoint" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Punto de Venta *</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            inputMode="numeric"
                            maxLength={4}
                            placeholder="0001"
                            className="font-mono tracking-wider"
                            onChange={(e) => field.onChange(e.target.value.replace(/\D/g, "").slice(0, 4))}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />

                    <FormField control={form.control} name="invoiceNumber" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Número *</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            inputMode="numeric"
                            maxLength={8}
                            placeholder="00000001"
                            className="font-mono tracking-wider"
                            onChange={(e) => field.onChange(e.target.value.replace(/\D/g, "").slice(0, 8))}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />

                    <FormField control={form.control} name="invoiceDate" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Fecha *</FormLabel>
                        <FormControl>
                          <Input type="date" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>

                  <FormField control={form.control} name="ivaCondition" render={({ field }) => (
                    <FormItem className="max-w-xs">
                      <FormLabel>Condición IVA</FormLabel>
                      <FormControl>
                        <DataEntryCombobox
                          options={ivaConditions.map((c) => ({ value: c.value, label: c.label }))}
                          value={field.value || ""}
                          onValueChange={field.onChange}
                          placeholder="Seleccionar"
                          searchPlaceholder="Buscar…"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between gap-2">
                  <CardTitle>Ítems / Insumos</CardTitle>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      prependItem({ supplyId: undefined, description: "", quantity: 1, unitPrice: 0, subtotal: 0, rubroId: undefined, taxId: undefined });
                      setConfirmedItems((prev) => { const next = new Set<number>(); prev.forEach((i) => next.add(i + 1)); return next; });
                    }}
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Agregar Ítem
                  </Button>
                </CardHeader>
                <CardContent className="space-y-4">
                  {orderedItemIndices.map((index) => {
                    const field = itemFields[index]!;
                    const selectedSupply = supplies.find((s) => s.id === watchItems[index]?.supplyId);
                    const isConfirmed = confirmedItems.has(index);
                    return (
                      <div key={field.id} className={`grid gap-3 p-4 rounded-lg border transition-colors ${isConfirmed ? "border-green-400 dark:border-green-700 bg-green-50/30 dark:bg-green-950/10" : "bg-muted/30"}`}>
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <div className="flex items-center gap-2">
                            {isConfirmed && (
                              <Badge variant="default" className="gap-1 bg-green-600">
                                <Check className="h-3 w-3" />
                                Confirmado
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-1">
                            {watchItems[index]?.supplyId && !isConfirmed && (
                              <Button
                                type="button"
                                variant="default"
                                size="sm"
                                className="bg-green-600 border-green-600 text-white"
                                onClick={() => setConfirmedItems((prev) => new Set(prev).add(index))}
                              >
                                <Check className="h-3 w-3 mr-1" />
                                Confirmar
                              </Button>
                            )}
                            {itemFields.length > 1 && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() => {
                                  removeItem(index);
                                  setConfirmedItems((prev) => {
                                    const next = new Set<number>();
                                    prev.forEach((i) => { if (i < index) next.add(i); else if (i > index) next.add(i - 1); });
                                    return next;
                                  });
                                }}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            )}
                          </div>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2">
                          <FormField control={form.control} name={`items.${index}.supplyId`} render={({ field: itemField }) => (
                            <FormItem>
                              <FormLabel>Insumo</FormLabel>
                              <Popover open={openSupplyPickerIndex === index} onOpenChange={(o) => setOpenSupplyPickerIndex(o ? index : null)} modal>
                                <PopoverTrigger asChild>
                                  <FormControl>
                                    <Button
                                      type="button"
                                      variant="outline"
                                      role="combobox"
                                      className={cn("w-full justify-between font-normal", !itemField.value && "text-muted-foreground")}
                                    >
                                      <span className="truncate text-left">
                                        {selectedSupply ? selectedSupply.name : "Seleccionar insumo"}
                                      </span>
                                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                    </Button>
                                  </FormControl>
                                </PopoverTrigger>
                                <PopoverContent className="w-[min(100vw-2rem,420px)] p-0" align="start">
                                  <Command>
                                    <CommandInput placeholder="Buscar insumo..." />
                                    <CommandList>
                                      <CommandEmpty>Sin resultados</CommandEmpty>
                                      <CommandGroup>
                                        <CommandItem
                                          value="__new__ crear nuevo insumo"
                                          onSelect={() => { setOpenSupplyPickerIndex(null); setCreateSupplyForIndex(index); }}
                                          className="text-primary font-medium"
                                        >
                                          <Plus className="mr-2 h-4 w-4 shrink-0" />
                                          Crear nuevo insumo
                                        </CommandItem>
                                      </CommandGroup>
                                      <CommandGroup>
                                        {supplies.filter((s) => s.active).map((supply) => (
                                          <CommandItem
                                            key={supply.id}
                                            value={`${supply.name} ${supply.id}`}
                                            onSelect={() => { handleSupplyChange(index, supply.id); setOpenSupplyPickerIndex(null); }}
                                          >
                                            <span className="truncate">{supply.name}</span>
                                          </CommandItem>
                                        ))}
                                      </CommandGroup>
                                    </CommandList>
                                  </Command>
                                </PopoverContent>
                              </Popover>
                            </FormItem>
                          )} />

                          <FormField control={form.control} name={`items.${index}.description`} render={({ field: itemField }) => (
                            <FormItem>
                              <FormLabel>Descripción</FormLabel>
                              <FormControl>
                                <Input {...itemField} placeholder="Descripción del ítem" />
                              </FormControl>
                            </FormItem>
                          )} />
                        </div>

                        <div className="grid gap-3 sm:grid-cols-3">
                          <FormField control={form.control} name={`items.${index}.quantity`} render={({ field: itemField }) => (
                            <FormItem>
                              <FormLabel>Cantidad</FormLabel>
                              <FormControl>
                                <Input type="number" step="0.0001" min="0" {...itemField} className="font-mono" />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )} />

                          <div>
                            <FormLabel>Precio Unitario</FormLabel>
                            <div className="h-9 min-h-9 px-3 py-2 rounded-md border bg-muted font-mono text-sm flex items-center">
                              {formatCurrency((Number(watchItems[index]?.subtotal) || 0) / (Number(watchItems[index]?.quantity) || 1))}
                            </div>
                          </div>

                          <FormField control={form.control} name={`items.${index}.subtotal`} render={({ field: itemField }) => (
                            <FormItem>
                              <FormLabel>Subtotal</FormLabel>
                              <FormControl>
                                <Input type="number" step="0.01" min="0" {...itemField} className="font-mono" />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )} />
                        </div>

                        <FormField control={form.control} name={`items.${index}.taxId`} render={({ field: taxField }) => (
                          <FormItem>
                            <FormLabel>IVA por insumo</FormLabel>
                            <FormControl>
                              <DataEntryCombobox
                                options={lineTaxOptions}
                                value={taxField.value != null ? String(taxField.value) : ""}
                                onValueChange={(v) => taxField.onChange(v === "" ? undefined : parseInt(v, 10))}
                                placeholder="Sin IVA en esta línea"
                                searchPlaceholder="Buscar alícuota…"
                                emptyOptionLabel="Sin IVA en esta línea"
                              />
                            </FormControl>
                          </FormItem>
                        )} />
                      </div>
                    );
                  })}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between gap-2">
                  <CardTitle>Impuestos al total</CardTitle>
                  <DataEntryCombobox
                    key={addTaxComboKey}
                    options={allTaxOptions}
                    value=""
                    onValueChange={(v) => handleAddTax(parseInt(v, 10))}
                    placeholder="Agregar impuesto"
                    searchPlaceholder="Buscar impuesto…"
                    triggerClassName="w-48 shrink-0"
                  />
                </CardHeader>
                <CardContent>
                  {taxFields.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">Sin impuestos al total.</p>
                  ) : (
                    <div className="space-y-3">
                      {taxFields.map((field, index) => {
                        const tax = taxes.find((t) => t.id === form.getValues(`taxes.${index}.taxId`));
                        const internal = tax ? isInternalTaxType(tax.type) : false;
                        return (
                          <div key={field.id} className="flex items-center justify-between p-3 rounded-lg border">
                            <div>
                              <div className="font-medium">{tax?.name || "Impuesto"}</div>
                              {!internal && (
                                <div className="text-sm text-muted-foreground">
                                  {tax?.percentage}% sobre {formatCurrency(form.getValues(`taxes.${index}.baseAmount`))}
                                </div>
                              )}
                            </div>
                            <div className="flex items-center gap-3">
                              {internal ? (
                                <FormField control={form.control} name={`taxes.${index}.taxAmount`} render={({ field: amtField }) => (
                                  <FormItem className="space-y-1">
                                    <FormControl>
                                      <Input type="number" step="0.01" min="0" className="w-32 font-mono" {...amtField} />
                                    </FormControl>
                                  </FormItem>
                                )} />
                              ) : (
                                <span className="font-mono font-medium">{formatCurrency(form.getValues(`taxes.${index}.taxAmount`))}</span>
                              )}
                              <Button type="button" variant="ghost" size="icon" onClick={() => removeTax(index)}>
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle>Notas</CardTitle></CardHeader>
                <CardContent>
                  <FormField control={form.control} name="notes" render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <Textarea {...field} placeholder="Observaciones adicionales..." rows={3} />
                      </FormControl>
                    </FormItem>
                  )} />
                </CardContent>
              </Card>
            </div>

            <div>
              <Card className="sticky top-6">
                <CardHeader><CardTitle>Resumen</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Subtotal</span>
                      <span className="font-mono">{formatCurrency(calculations.subtotal)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Impuestos</span>
                      <span className="font-mono">{formatCurrency(calculations.taxTotal)}</span>
                    </div>
                  </div>

                  <Separator />

                  <div className="flex justify-between font-medium">
                    <span>Total NC</span>
                    <span className="font-mono text-lg">{formatCurrency(calculations.total)}</span>
                  </div>

                  <div className="rounded-md bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 px-3 py-2 text-sm text-green-800 dark:text-green-300">
                    Saldo a Favor: {formatCurrency(calculations.total)}
                  </div>

                  <div className="pt-4 space-y-2">
                    <Button type="submit" className="w-full" disabled={createMutation.isPending}>
                      {createMutation.isPending ? "Guardando..." : "Guardar Nota de Crédito"}
                    </Button>
                    <Button type="button" variant="outline" className="w-full" onClick={() => navigate("/facturas")}>
                      Cancelar
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </form>
      </Form>

      <QuickCreateSupplierDialog
        open={showCreateSupplier}
        onOpenChange={setShowCreateSupplier}
        onCreated={(supplier) => {
          queryClient.invalidateQueries({ queryKey: ["/api/suppliers"] });
          form.setValue("supplierId", supplier.id, { shouldValidate: true });
          form.setValue("linkedInvoiceId", undefined);
        }}
      />

      <QuickCreateSupplyDialog
        open={createSupplyForIndex !== null}
        onOpenChange={(o) => { if (!o) setCreateSupplyForIndex(null); }}
        onCreated={(supply) => {
          if (createSupplyForIndex !== null) {
            queryClient.invalidateQueries({ queryKey: ["/api/supplies"] });
            handleSupplyChange(createSupplyForIndex, supply.id);
          }
          setCreateSupplyForIndex(null);
        }}
      />
    </div>
  );
}
