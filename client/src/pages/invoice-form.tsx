import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm, useFieldArray, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useLocation, useParams } from "wouter";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
import { Plus, Trash2, Calculator, AlertTriangle, TrendingUp, TrendingDown, Check, ChevronsUpDown } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Supplier, Local, Supply, Tax, Rubro, SubRubro, UnitOfMeasure } from "@shared/schema";
import { cn } from "@/lib/utils";

interface SupplyWithUnit extends Supply {
  rubro?: Rubro | null;
  subRubro?: SubRubro | null;
  unitOfMeasure?: UnitOfMeasure | null;
}

const invoiceTypes = [
  { value: "A", label: "Factura A" },
  { value: "B", label: "Factura B" },
  { value: "C", label: "Factura C" },
  { value: "E", label: "Factura E" },
  { value: "M", label: "Factura M" },
  { value: "NC-A", label: "Nota de Credito A" },
  { value: "NC-B", label: "Nota de Credito B" },
  { value: "NC-C", label: "Nota de Credito C" },
  { value: "ND-A", label: "Nota de Debito A" },
  { value: "ND-B", label: "Nota de Debito B" },
  { value: "ND-C", label: "Nota de Debito C" },
  { value: "REM", label: "Remito" },
];

const ivaConditions = [
  { value: "responsable_inscripto", label: "Responsable Inscripto" },
  { value: "monotributista", label: "Monotributista" },
  { value: "exento", label: "Exento" },
  { value: "consumidor_final", label: "Consumidor Final" },
];

const expenseTypes = [
  { value: "cmv", label: "CMV (Costo de Mercaderia)" },
  { value: "admin", label: "Administracion / Gastos" },
];

const itemSchema = z.object({
  supplyId: z.coerce.number().optional(),
  description: z.string().optional(),
  quantity: z.coerce.number().min(0.0001, "Cantidad requerida"),
  // unitPrice se calcula automaticamente como subtotal / cantidad
  unitPrice: z.coerce.number().min(0),
  subtotal: z.coerce.number().min(0.01, "Subtotal requerido"),
  rubroId: z.coerce.number().optional(),
});

const taxItemSchema = z.object({
  taxId: z.coerce.number(),
  baseAmount: z.coerce.number(),
  taxAmount: z.coerce.number(),
});

const formSchema = z.object({
  localId: z.coerce.number().min(1, "Seleccione un local"),
  supplierId: z.coerce.number().min(1, "Seleccione un proveedor"),
  supplierRubroId: z.coerce.number().optional(),
  invoiceNumber: z.string().min(1, "Numero de factura requerido"),
  invoiceType: z.string().min(1, "Tipo de comprobante requerido"),
  invoiceDate: z.string().min(1, "Fecha requerida"),
  dueDate: z.string().optional(),
  paymentDays: z.coerce.number().min(0).default(0),
  ivaCondition: z.string().optional(),
  expenseType: z.string().default("cmv"),
  discount: z.coerce.number().min(0).default(0),
  advancePayment: z.coerce.number().min(0).default(0),
  notes: z.string().optional(),
  items: z.array(itemSchema).min(1, "Debe agregar al menos un item"),
  taxes: z.array(taxItemSchema).default([]),
});

type FormData = z.infer<typeof formSchema>;

interface InvoiceItem {
  id?: number;
  supplyId?: number | null;
  description?: string | null;
  quantity: number | string;
  unitPrice: number | string;
  subtotal: number | string;
  rubroId?: number | null;
}

interface InvoiceTaxItem {
  taxId: number;
  baseAmount: number | string;
  taxAmount: number | string;
}

interface InvoiceDetail {
  id: number;
  localId: number;
  supplierId: number;
  invoiceNumber: string;
  invoiceType: string;
  invoiceDate: string;
  dueDate?: string | null;
  paymentDays?: number;
  ivaCondition?: string | null;
  expenseType?: string | null;
  discount?: number | string;
  advancePayment?: number | string;
  notes?: string | null;
  subtotal?: number | string;
  taxTotal?: number | string;
  total?: number | string;
  balance?: number | string;
  items: InvoiceItem[];
  taxes: InvoiceTaxItem[];
  supplier?: Supplier | null;
  local?: Local | null;
}

export default function InvoiceFormPage() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const params = useParams<{ id: string }>();
  const isEditing = params.id && params.id !== "nueva";
  const isViewing = !!isEditing;
  const [confirmedItems, setConfirmedItems] = useState<Set<number>>(new Set());
  const [openSupplyPickerIndex, setOpenSupplyPickerIndex] = useState<number | null>(null);

  const { data: existingInvoice, isLoading: isLoadingInvoice } = useQuery<InvoiceDetail>({
    queryKey: ["/api/invoices", params.id],
    enabled: !!isEditing,
  });

  const { data: suppliers = [] } = useQuery<Supplier[]>({
    queryKey: ["/api/suppliers"],
  });

  const { data: locals = [] } = useQuery<Local[]>({
    queryKey: ["/api/locals"],
  });

  const { data: supplies = [] } = useQuery<SupplyWithUnit[]>({
    queryKey: ["/api/supplies"],
  });

  const { data: allSupplySuppliers = [] } = useQuery<{ supplyId: number; supplierId: number }[]>({
    queryKey: ["/api/supply-suppliers"],
  });

  const { data: taxes = [] } = useQuery<Tax[]>({
    queryKey: ["/api/taxes"],
  });

  const { data: rubros = [] } = useQuery<Rubro[]>({
    queryKey: ["/api/rubros"],
  });

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      localId: 0,
      supplierId: 0,
      supplierRubroId: undefined,
      invoiceNumber: "",
      invoiceType: "A",
      invoiceDate: formatDateInput(new Date()),
      dueDate: "",
      paymentDays: 0,
      ivaCondition: "responsable_inscripto",
      expenseType: "cmv",
      discount: 0,
      advancePayment: 0,
      notes: "",
      items: [{ supplyId: undefined, description: "", quantity: 1, unitPrice: 0, subtotal: 0, rubroId: undefined }],
      taxes: [],
    },
  });

  const { fields: itemFields, append: appendItem, remove: removeItem } = useFieldArray({
    control: form.control,
    name: "items",
  });

  const { fields: taxFields, append: appendTax, remove: removeTax, replace: replaceTaxes } = useFieldArray({
    control: form.control,
    name: "taxes",
  });

  const watchItems = useWatch({ control: form.control, name: "items" }) ?? [];
  const watchDiscount = form.watch("discount");
  const watchAdvancePayment = form.watch("advancePayment");
  const watchSupplierIdRaw = form.watch("supplierId");
  const watchSupplierId = typeof watchSupplierIdRaw === "string"
    ? parseInt(watchSupplierIdRaw || "0") || 0
    : watchSupplierIdRaw || 0;
  const watchInvoiceDate = form.watch("invoiceDate");
  const watchPaymentDays = form.watch("paymentDays");

  useEffect(() => {
    if (existingInvoice) {
      const supplierForInvoice = suppliers.find(
        (s) => s.id === existingInvoice.supplierId
      );

      form.reset({
        localId: existingInvoice.localId,
        supplierId: existingInvoice.supplierId,
        supplierRubroId: supplierForInvoice?.rubroId || undefined,
        invoiceNumber: existingInvoice.invoiceNumber || "",
        invoiceType: existingInvoice.invoiceType || "A",
        invoiceDate: existingInvoice.invoiceDate
          ? formatDateInput(new Date(existingInvoice.invoiceDate))
          : "",
        dueDate: existingInvoice.dueDate
          ? formatDateInput(new Date(existingInvoice.dueDate))
          : "",
        paymentDays: existingInvoice.paymentDays || 0,
        ivaCondition: existingInvoice.ivaCondition || "responsable_inscripto",
        expenseType: existingInvoice.expenseType || "cmv",
        discount: parseFloat(String(existingInvoice.discount)) || 0,
        advancePayment: parseFloat(String(existingInvoice.advancePayment)) || 0,
        notes: existingInvoice.notes || "",
        items:
          existingInvoice.items?.length > 0
            ? existingInvoice.items.map((item) => ({
                supplyId: item.supplyId || undefined,
                description: item.description || "",
                quantity: parseFloat(String(item.quantity)) || 1,
                unitPrice: parseFloat(String(item.unitPrice)) || 0,
                subtotal: parseFloat(String(item.subtotal)) || 0,
                rubroId: item.rubroId || undefined,
              }))
            : [
                {
                  supplyId: undefined,
                  description: "",
                  quantity: 1,
                  unitPrice: 0,
                  subtotal: 0,
                  rubroId: undefined,
                },
              ],
        taxes:
          existingInvoice.taxes?.map((t) => ({
            taxId: t.taxId,
            baseAmount: parseFloat(String(t.baseAmount)) || 0,
            taxAmount: parseFloat(String(t.taxAmount)) || 0,
          })) || [],
      });
    }
  }, [existingInvoice, suppliers, form]);

  useEffect(() => {
    if (existingInvoice) return;
    const supplier = suppliers.find(s => s.id === watchSupplierId);
    if (supplier) {
      if (supplier.paymentDays) {
        form.setValue("paymentDays", supplier.paymentDays);
      }
      if (supplier.ivaCondition) {
        form.setValue("ivaCondition", supplier.ivaCondition);
      }
      if (supplier.rubroId) {
        form.setValue("supplierRubroId", supplier.rubroId);
      }
    }
  }, [watchSupplierId, suppliers, form]);

  useEffect(() => {
    if (existingInvoice) return;
    if (watchInvoiceDate && watchPaymentDays >= 0) {
      const invoiceDate = new Date(watchInvoiceDate);
      invoiceDate.setDate(invoiceDate.getDate() + watchPaymentDays);
      form.setValue("dueDate", formatDateInput(invoiceDate));
    }
  }, [watchInvoiceDate, watchPaymentDays, form, existingInvoice]);

  const supplierFilteredSupplies = useMemo(() => {
    return supplies.filter((s) => {
      if (!s.active) return false;
      if (!watchSupplierId) return true;
      const hasRelations = allSupplySuppliers.some((ss) => ss.supplyId === s.id);
      if (!hasRelations) return true;
      return allSupplySuppliers.some((ss) => ss.supplyId === s.id && ss.supplierId === watchSupplierId);
    });
  }, [supplies, watchSupplierId, allSupplySuppliers]);

  const itemsSubtotalSum = watchItems.reduce((sum, item) => {
    const sub = Number(item?.subtotal) || 0;
    return sum + sub;
  }, 0);
  const discountVal = watchDiscount || 0;
  const subtotalAfterDiscount = itemsSubtotalSum - discountVal;
  const taxTotal = taxFields.reduce((sum, _, index) => {
    const taxAmount = form.getValues(`taxes.${index}.taxAmount`) || 0;
    return sum + taxAmount;
  }, 0);
  const total = subtotalAfterDiscount + taxTotal;
  const advancePaymentVal = watchAdvancePayment || 0;
  const balance = total - advancePaymentVal;
  const calculations = {
    subtotal: itemsSubtotalSum,
    discount: discountVal,
    subtotalAfterDiscount,
    taxTotal,
    total,
    balance,
  };

  useEffect(() => {
    watchItems.forEach((item, index) => {
      const qty = Number(item.quantity) || 0;
      const sub = Number(item.subtotal) || 0;

      if (qty > 0) {
        const unit = sub / qty;
        form.setValue(`items.${index}.unitPrice`, unit, { shouldDirty: true, shouldValidate: false });
      } else {
        form.setValue(`items.${index}.unitPrice`, 0, { shouldDirty: true, shouldValidate: false });
      }
    });
  }, [watchItems, form]);

  const handleSupplyChange = (index: number, supplyId: number) => {
    const supply = supplies.find(s => s.id === supplyId);
    if (supply) {
      form.setValue(`items.${index}.supplyId`, supplyId);
      form.setValue(`items.${index}.description`, supply.name);
      if (supply.rubroId) {
        form.setValue(`items.${index}.rubroId`, supply.rubroId);
      }
    }
  };

  const COST_VARIATION_THRESHOLD = 15;

  const costVariations = useMemo(() => {
    return watchItems.map((item) => {
      if (!item.supplyId || !item.unitPrice) return null;
      
      const supply = supplies.find(s => s.id === item.supplyId);
      if (!supply || !supply.lastCost || parseFloat(String(supply.lastCost)) === 0) return null;
      
      const previousCost = parseFloat(String(supply.lastCost));
      const newCost = item.unitPrice;
      const variation = ((newCost - previousCost) / previousCost) * 100;
      
      if (Math.abs(variation) >= COST_VARIATION_THRESHOLD) {
        return {
          supplyName: supply.name,
          previousCost,
          newCost,
          variation: variation.toFixed(1),
          isIncrease: variation > 0,
        };
      }
      return null;
    }).filter(Boolean);
  }, [watchItems, supplies]);

  const costComparison = useMemo(() => {
    return watchItems.map((item, index) => {
      if (!item.supplyId) return null;
      
      const supply = supplies.find(s => s.id === item.supplyId);
      if (!supply) return null;
      
      const previousCost = parseFloat(String(supply.lastCost)) || 0;
      const currentCPP = parseFloat(String(supply.unitCost)) || 0;
      const newCost = item.unitPrice || 0;
      const quantity = item.quantity || 0;
      
      let variation = 0;
      if (previousCost > 0 && newCost > 0) {
        variation = ((newCost - previousCost) / previousCost) * 100;
      }
      
      return {
        index,
        supplyName: supply.name,
        previousCost,
        currentCPP,
        newCost,
        quantity,
        newTotal: newCost * quantity,
        variation: variation.toFixed(1),
        hasVariation: Math.abs(variation) >= 5,
        isIncrease: variation > 0,
      };
    }).filter(Boolean);
  }, [watchItems, supplies]);

  const handleAddTax = (taxId: number) => {
    const tax = taxes.find(t => t.id === taxId);
    if (!tax) return;

    const existing = taxFields.find((_, i) => form.getValues(`taxes.${i}.taxId`) === taxId);
    if (existing) {
      toast({ title: "Este impuesto ya fue agregado", variant: "destructive" });
      return;
    }

    const baseAmount = calculations.subtotalAfterDiscount;
    const percentage = parseFloat(tax.percentage);
    const taxAmount = (baseAmount * percentage) / 100;

    appendTax({ taxId, baseAmount, taxAmount });
  };

  const recalculateTaxes = () => {
    const newTaxes = taxFields.map((_, index) => {
      const taxId = form.getValues(`taxes.${index}.taxId`);
      const tax = taxes.find(t => t.id === taxId);
      if (!tax) return form.getValues(`taxes.${index}`);

      const baseAmount = calculations.subtotalAfterDiscount;
      const percentage = parseFloat(tax.percentage);
      const taxAmount = (baseAmount * percentage) / 100;

      return { taxId, baseAmount, taxAmount };
    });
    replaceTaxes(newTaxes);
  };

  const createMutation = useMutation({
    mutationFn: async (data: FormData) => {
      // Actualizar rubro del proveedor si se selecciono uno diferente
      const supplier = suppliers.find(s => s.id === data.supplierId);
      if (data.supplierRubroId && supplier && supplier.rubroId !== data.supplierRubroId) {
        await apiRequest("PATCH", `/api/suppliers/${supplier.id}`, {
          rubroId: data.supplierRubroId,
        });
      }

      const { supplierRubroId, ...rest } = data;

      const payload = {
        ...rest,
        subtotal: calculations.subtotal,
        taxTotal: calculations.taxTotal,
        total: calculations.total,
        balance: calculations.balance,
      };
      const res = await apiRequest("POST", "/api/invoices", payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/supplies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recipes"], exact: false });
      queryClient.invalidateQueries({ queryKey: ["/api/recipes/stats"] });
      toast({ title: "Factura creada correctamente" });
      navigate("/facturas");
    },
    onError: (error: Error) => {
      toast({ title: "Error al crear factura", description: error.message, variant: "destructive" });
    },
  });

  const onSubmit = (data: FormData) => {
    createMutation.mutate(data);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={isViewing ? "Detalle de Factura" : "Nueva Factura"}
        description={isViewing ? "Informacion del comprobante registrado" : "Complete los datos del comprobante"}
        backHref="/facturas"
      />

      {isViewing && isLoadingInvoice && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Cargando factura...
          </CardContent>
        </Card>
      )}

      {isViewing && existingInvoice && (
        <Card>
          <CardContent className="py-4">
            <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
              <div>
                <p className="text-xs text-muted-foreground">Proveedor</p>
                <p className="font-medium" data-testid="text-supplier-name">
                  {existingInvoice.supplier?.businessName || suppliers.find(s => s.id === existingInvoice.supplierId)?.businessName || "-"}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Local</p>
                <p className="font-medium" data-testid="text-local-name">
                  {existingInvoice.local?.name || locals.find(l => l.id === existingInvoice.localId)?.name || "-"}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Comprobante</p>
                <p className="font-medium font-mono" data-testid="text-invoice-number">
                  {invoiceTypes.find(t => t.value === existingInvoice.invoiceType)?.label} {existingInvoice.invoiceNumber}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total</p>
                <p className="font-medium font-mono text-lg" data-testid="text-invoice-total">
                  {formatCurrency(existingInvoice.total)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2 space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Datos del Comprobante</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-3">
                    <FormField
                      control={form.control}
                      name="localId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Local *</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value?.toString() || ""}>
                            <FormControl>
                              <SelectTrigger data-testid="select-local">
                                <SelectValue placeholder="Seleccionar local" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {locals.filter(l => l.active).map((local) => (
                                <SelectItem key={local.id} value={local.id.toString()}>
                                  {local.name}
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
                      name="supplierId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Proveedor *</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value?.toString() || ""}>
                            <FormControl>
                              <SelectTrigger data-testid="select-supplier">
                                <SelectValue placeholder="Seleccionar proveedor" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {suppliers.filter(s => s.active).map((supplier) => (
                                <SelectItem key={supplier.id} value={supplier.id.toString()}>
                                  {supplier.businessName}
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
                      name="supplierRubroId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Rubro</FormLabel>
                          <Select
                            onValueChange={(val) =>
                              field.onChange(val ? parseInt(val) : undefined)
                            }
                            value={field.value?.toString() || ""}
                          >
                            <FormControl>
                              <SelectTrigger data-testid="select-supplier-rubro">
                                <SelectValue placeholder="Seleccionar rubro" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {rubros
                                .filter((r) => r.active)
                                .map((rubro) => (
                                  <SelectItem
                                    key={rubro.id}
                                    value={rubro.id.toString()}
                                  >
                                    {rubro.name}
                                  </SelectItem>
                                ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <div className="grid gap-4 sm:grid-cols-3">
                    <FormField
                      control={form.control}
                      name="invoiceType"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Tipo de Comprobante *</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger data-testid="select-invoice-type">
                                <SelectValue placeholder="Seleccionar tipo" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {invoiceTypes.map((type) => (
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
                    <FormField
                      control={form.control}
                      name="invoiceNumber"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Numero de Comprobante *</FormLabel>
                          <FormControl>
                            <Input {...field} placeholder="0001-00000001" data-testid="input-invoice-number" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="invoiceDate"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Fecha *</FormLabel>
                          <FormControl>
                            <Input type="date" {...field} data-testid="input-invoice-date" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <div className="grid gap-4 sm:grid-cols-3">
                    <FormField
                      control={form.control}
                      name="ivaCondition"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Condicion IVA</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value || ""}>
                            <FormControl>
                              <SelectTrigger data-testid="select-iva-condition">
                                <SelectValue placeholder="Seleccionar" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {ivaConditions.map((condition) => (
                                <SelectItem key={condition.value} value={condition.value}>
                                  {condition.label}
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
                      name="expenseType"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Tipo de Gasto *</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger data-testid="select-expense-type">
                                <SelectValue placeholder="Seleccionar tipo" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {expenseTypes.map((type) => (
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
                    <FormField
                      control={form.control}
                      name="paymentDays"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Dias de Plazo</FormLabel>
                          <FormControl>
                            <Input type="number" min={0} {...field} data-testid="input-payment-days" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormField
                      control={form.control}
                      name="dueDate"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Fecha de Vencimiento</FormLabel>
                          <FormControl>
                            <Input 
                              type="date" 
                              {...field} 
                              className="bg-muted" 
                              data-testid="input-due-date" 
                            />
                          </FormControl>
                          <p className="text-xs text-muted-foreground">
                            Calculado automaticamente segun dias de plazo
                          </p>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between gap-2">
                  <CardTitle>Items / Insumos</CardTitle>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => appendItem({ supplyId: undefined, description: "", quantity: 1, unitPrice: 0, subtotal: 0, rubroId: undefined })}
                    data-testid="button-add-item"
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Agregar Item
                  </Button>
                </CardHeader>
                <CardContent className="space-y-4">
                  {itemFields.map((field, index) => {
                    const selectedSupply = supplies.find(s => s.id === watchItems[index]?.supplyId);
                    const unitAbbr = selectedSupply?.unitOfMeasure?.abbreviation || "";
                    const isItemConfirmed = confirmedItems.has(index);
                    const hasSupply = watchItems[index]?.supplyId && Number(watchItems[index]?.supplyId) > 0;
                    return (
                    <div key={field.id} className={`grid gap-3 p-4 rounded-lg border transition-colors ${isItemConfirmed ? "border-green-400 dark:border-green-700 bg-green-50/30 dark:bg-green-950/10" : "bg-muted/30"}`}>
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <div className="flex items-center gap-2">
                          {unitAbbr && (
                            <Badge variant="secondary" className="font-mono text-xs">
                              {unitAbbr}
                            </Badge>
                          )}
                          {isItemConfirmed && (
                            <Badge variant="default" className="gap-1 bg-green-600">
                              <Check className="h-3 w-3" />
                              Confirmado
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          {hasSupply && !isItemConfirmed && (
                            <Button
                              type="button"
                              variant="default"
                              size="sm"
                              className="bg-green-600 border-green-600 text-white"
                              onClick={() => setConfirmedItems(prev => new Set(prev).add(index))}
                              data-testid={`button-confirm-item-${index}`}
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
                                setConfirmedItems(prev => {
                                  const next = new Set<number>();
                                  prev.forEach(i => { if (i < index) next.add(i); else if (i > index) next.add(i - 1); });
                                  return next;
                                });
                              }}
                              data-testid={`button-remove-item-${index}`}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          )}
                        </div>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <FormField
                          control={form.control}
                          name={`items.${index}.supplyId`}
                          render={({ field: itemField }) => (
                            <FormItem>
                              <FormLabel>Insumo</FormLabel>
                              <Popover
                                open={openSupplyPickerIndex === index}
                                onOpenChange={(open) => setOpenSupplyPickerIndex(open ? index : null)}
                              >
                                <PopoverTrigger asChild>
                                  <FormControl>
                                    <Button
                                      type="button"
                                      variant="outline"
                                      role="combobox"
                                      aria-expanded={openSupplyPickerIndex === index}
                                      className={cn(
                                        "w-full justify-between font-normal",
                                        !itemField.value && "text-muted-foreground"
                                      )}
                                      data-testid={`select-supply-${index}`}
                                    >
                                      <span className="truncate text-left">
                                        {selectedSupply ? (
                                          <>
                                            {selectedSupply.name}
                                            {selectedSupply.unitOfMeasure && (
                                              <span className="text-muted-foreground font-mono text-xs ml-1">
                                                ({selectedSupply.unitOfMeasure.abbreviation})
                                              </span>
                                            )}
                                          </>
                                        ) : (
                                          "Seleccionar insumo"
                                        )}
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
                                        {supplierFilteredSupplies.map((supply) => (
                                          <CommandItem
                                            key={supply.id}
                                            value={`${supply.name} ${supply.unitOfMeasure?.abbreviation ?? ""} ${supply.id}`}
                                            onSelect={() => {
                                              handleSupplyChange(index, supply.id);
                                              setOpenSupplyPickerIndex(null);
                                            }}
                                          >
                                            <span className="truncate">{supply.name}</span>
                                            {supply.unitOfMeasure && (
                                              <span className="text-xs text-muted-foreground font-mono ml-2 shrink-0">
                                                ({supply.unitOfMeasure.abbreviation})
                                              </span>
                                            )}
                                          </CommandItem>
                                        ))}
                                      </CommandGroup>
                                    </CommandList>
                                  </Command>
                                </PopoverContent>
                              </Popover>
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name={`items.${index}.description`}
                          render={({ field: itemField }) => (
                            <FormItem>
                              <FormLabel>Descripcion</FormLabel>
                              <FormControl>
                                <Input {...itemField} placeholder="Descripcion del item" data-testid={`input-description-${index}`} />
                              </FormControl>
                            </FormItem>
                          )}
                        />
                      </div>
                      <div className="grid gap-3 sm:grid-cols-4">
                        <FormField
                          control={form.control}
                          name={`items.${index}.quantity`}
                          render={({ field: itemField }) => (
                            <FormItem>
                              <FormLabel>Cantidad {unitAbbr && <span className="text-muted-foreground font-mono">({unitAbbr})</span>}</FormLabel>
                              <FormControl>
                                <Input
                                  type="number"
                                  step="0.0001"
                                  min="0"
                                  {...itemField}
                                  className="font-mono"
                                  data-testid={`input-quantity-${index}`}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <div>
                          <FormLabel>Precio Unitario</FormLabel>
                          <div className="h-9 min-h-9 px-3 py-2 rounded-md border bg-muted font-mono text-sm flex items-center">
                            {formatCurrency(
                              (Number(watchItems[index]?.subtotal) || 0) /
                                (Number(watchItems[index]?.quantity) || 1)
                            )}
                          </div>
                        </div>
                        <div>
                          <FormLabel>Sub-Rubro</FormLabel>
                          <div className="h-9 min-h-9 px-3 py-2 rounded-md border bg-muted text-sm flex flex-col justify-center">
                            {selectedSupply?.subRubro ? (
                              <>
                                <span className="font-medium">{selectedSupply.subRubro.name}</span>
                                {selectedSupply.rubro && (
                                  <span className="text-xs text-muted-foreground">
                                    {selectedSupply.rubro.name}
                                  </span>
                                )}
                              </>
                            ) : (
                              <span className="text-muted-foreground text-xs">Sin sub-rubro asignado</span>
                            )}
                          </div>
                        </div>
                        <FormField
                          control={form.control}
                          name={`items.${index}.subtotal`}
                          render={({ field: itemField }) => (
                            <FormItem>
                              <FormLabel>Subtotal</FormLabel>
                              <FormControl>
                                <Input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  {...itemField}
                                  className="font-mono"
                                  data-testid={`input-subtotal-${index}`}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                    </div>
                    );
                  })}
                </CardContent>
              </Card>

              {costVariations.length > 0 && (
                <Alert variant="destructive" className="border-orange-500 bg-orange-50 dark:bg-orange-950/20" data-testid="alert-cost-variation">
                  <AlertTriangle className="h-4 w-4 text-orange-600" />
                  <AlertDescription>
                    <div className="font-medium text-orange-800 dark:text-orange-200 mb-2">
                      Alerta de Variacion de Costos (umbral: {COST_VARIATION_THRESHOLD}%)
                    </div>
                    <div className="space-y-1">
                      {costVariations.map((v: any, idx) => (
                        <div key={idx} className="flex items-center gap-2 text-sm">
                          {v.isIncrease ? (
                            <TrendingUp className="h-4 w-4 text-red-600" />
                          ) : (
                            <TrendingDown className="h-4 w-4 text-green-600" />
                          )}
                          <span className="text-foreground">
                            <strong>{v.supplyName}</strong>: {formatCurrency(v.previousCost)} → {formatCurrency(v.newCost)} 
                            <span className={v.isIncrease ? "text-red-600 ml-1" : "text-green-600 ml-1"}>
                              ({v.isIncrease ? "+" : ""}{v.variation}%)
                            </span>
                          </span>
                        </div>
                      ))}
                    </div>
                  </AlertDescription>
                </Alert>
              )}

              {costComparison.length > 0 && (
                <Card data-testid="card-cost-comparison">
                  <CardHeader>
                    <CardTitle className="text-base">Comparativa de Costos</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Insumo</TableHead>
                          <TableHead className="text-right">CPP Actual</TableHead>
                          <TableHead className="text-right">Costo Anterior</TableHead>
                          <TableHead className="text-right">Costo Nuevo</TableHead>
                          <TableHead className="text-right">Variacion</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {costComparison.map((item: any) => (
                          <TableRow key={item.index} data-testid={`row-cost-comparison-${item.index}`}>
                            <TableCell className="font-medium">{item.supplyName}</TableCell>
                            <TableCell className="text-right font-mono">
                              {item.currentCPP > 0 ? formatCurrency(item.currentCPP) : "-"}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {item.previousCost > 0 ? formatCurrency(item.previousCost) : "-"}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {formatCurrency(item.newCost)}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {item.previousCost > 0 ? (
                                <span className={
                                  item.hasVariation 
                                    ? (item.isIncrease ? "text-red-600" : "text-green-600")
                                    : ""
                                }>
                                  {item.isIncrease ? "+" : ""}{item.variation}%
                                </span>
                              ) : (
                                <span className="text-muted-foreground">Primera compra</span>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}

              <Card>
                <CardHeader className="flex flex-row items-center justify-between gap-2">
                  <CardTitle>Impuestos</CardTitle>
                  <div className="flex items-center gap-2">
                    <Select onValueChange={(val) => handleAddTax(parseInt(val))}>
                      <SelectTrigger className="w-48" data-testid="select-add-tax">
                        <SelectValue placeholder="Agregar impuesto" />
                      </SelectTrigger>
                      <SelectContent>
                        {taxes.filter(t => t.active).map((tax) => (
                          <SelectItem key={tax.id} value={tax.id.toString()}>
                            {tax.name} ({tax.percentage}%)
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={recalculateTaxes}
                      title="Recalcular impuestos"
                      data-testid="button-recalculate-taxes"
                    >
                      <Calculator className="h-4 w-4" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {taxFields.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      No hay impuestos agregados. Seleccione uno del menu superior.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {taxFields.map((field, index) => {
                        const tax = taxes.find(t => t.id === form.getValues(`taxes.${index}.taxId`));
                        return (
                          <div key={field.id} className="flex items-center justify-between p-3 rounded-lg border">
                            <div>
                              <div className="font-medium">{tax?.name || "Impuesto"}</div>
                              <div className="text-sm text-muted-foreground">
                                {tax?.percentage}% sobre {formatCurrency(form.getValues(`taxes.${index}.baseAmount`))}
                              </div>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="font-mono font-medium">
                                {formatCurrency(form.getValues(`taxes.${index}.taxAmount`))}
                              </span>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() => removeTax(index)}
                                data-testid={`button-remove-tax-${index}`}
                              >
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
                <CardHeader>
                  <CardTitle>Notas</CardTitle>
                </CardHeader>
                <CardContent>
                  <FormField
                    control={form.control}
                    name="notes"
                    render={({ field }) => (
                      <FormItem>
                        <FormControl>
                          <Textarea {...field} placeholder="Observaciones o notas adicionales..." rows={3} data-testid="input-notes" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </CardContent>
              </Card>
            </div>

            <div>
              <Card className="sticky top-6">
                <CardHeader>
                  <CardTitle>Resumen</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Subtotal</span>
                      <span className="font-mono">{formatCurrency(calculations.subtotal)}</span>
                    </div>
                    <FormField
                      control={form.control}
                      name="discount"
                      render={({ field }) => (
                        <div className="flex justify-between items-center text-sm">
                          <span className="text-muted-foreground">Descuento</span>
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            {...field}
                            className="w-28 h-8 font-mono text-right"
                            data-testid="input-discount"
                          />
                        </div>
                      )}
                    />
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Subtotal c/Desc.</span>
                      <span className="font-mono">{formatCurrency(calculations.subtotalAfterDiscount)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Impuestos</span>
                      <span className="font-mono">{formatCurrency(calculations.taxTotal)}</span>
                    </div>
                  </div>

                  <Separator />

                  <div className="flex justify-between font-medium">
                    <span>Total</span>
                    <span className="font-mono text-lg">{formatCurrency(calculations.total)}</span>
                  </div>

                  <FormField
                    control={form.control}
                    name="advancePayment"
                    render={({ field }) => (
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-muted-foreground">Pago Anticipado</span>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          {...field}
                          className="w-28 h-8 font-mono text-right"
                          data-testid="input-advance-payment"
                        />
                      </div>
                    )}
                  />

                  <Separator />

                  <div className="flex justify-between font-medium text-primary">
                    <span>Saldo a Pagar</span>
                    <span className="font-mono text-lg">{formatCurrency(calculations.balance)}</span>
                  </div>

                  <div className="pt-4 space-y-2">
                    <Button
                      type="submit"
                      className="w-full"
                      disabled={createMutation.isPending}
                      data-testid="button-submit"
                    >
                      {createMutation.isPending ? "Guardando..." : "Guardar Factura"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full"
                      onClick={() => navigate("/facturas")}
                      data-testid="button-cancel"
                    >
                      Cancelar
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </form>
      </Form>
    </div>
  );
}
