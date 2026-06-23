import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm, useFieldArray, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useLocation, useParams } from "wouter";
import { PageHeader } from "@/components/page-header";
import { CodeConfirmDialog } from "@/components/code-confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { DataEntryCombobox } from "@/components/data-entry-combobox";
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
import { computeInvoiceTaxes, isInternalTaxType } from "@shared/invoiceTaxComputation";
import { formatInvoiceVoucherDisplay } from "@shared/invoiceDisplay";
import { cn } from "@/lib/utils";
import { QuickCreateSupplierDialog } from "@/components/quick-create-supplier-dialog";
import { QuickCreateSupplyDialog } from "@/components/quick-create-supply-dialog";

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
  /** IVA por insumo (catalogo tipo iva); opcional */
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
  supplierRubroId: z.coerce.number().optional(),
  invoiceSalePoint: z
    .string()
    .regex(/^\d{4}$/, "Exactamente 4 digitos (ej. 0006)"),
  invoiceNumber: z.string().regex(/^\d{8}$/, "Exactamente 8 digitos (ej. 00002159)"),
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
  taxId?: number | null;
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
  invoiceSalePoint?: string | null;
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
  const [addTaxComboKey, setAddTaxComboKey] = useState(0);
  const [showCreateSupplier, setShowCreateSupplier] = useState(false);
  const [createSupplyForIndex, setCreateSupplyForIndex] = useState<number | null>(null);
  // Corrección de factura: editar una factura existente (reemplaza la vieja por una nueva) con clave.
  const [isCorrecting, setIsCorrecting] = useState(false);
  const [showCorrectCodeDialog, setShowCorrectCodeDialog] = useState(false);
  const [pendingCorrection, setPendingCorrection] = useState<FormData | null>(null);

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
      invoiceSalePoint: "",
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
      items: [
        {
          supplyId: undefined,
          description: "",
          quantity: 1,
          unitPrice: 0,
          subtotal: 0,
          rubroId: undefined,
          taxId: undefined,
        },
      ],
      taxes: [],
    },
  });

  const { fields: itemFields, prepend: prependItem, remove: removeItem } = useFieldArray({
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

      const rawNum = String(existingInvoice.invoiceNumber ?? "").trim();
      const dbSale = existingInvoice.invoiceSalePoint?.trim();
      let invoiceSalePoint = "";
      let invoiceNumberStr = "";
      if (dbSale && /^\d{4}$/.test(dbSale) && /^\d{8}$/.test(rawNum)) {
        invoiceSalePoint = dbSale;
        invoiceNumberStr = rawNum;
      } else {
        const compact = /^(\d{4})-(\d{8})$/.exec(rawNum);
        if (compact) {
          invoiceSalePoint = compact[1];
          invoiceNumberStr = compact[2];
        } else {
          const parts = rawNum.split("-");
          if (parts.length === 2 && /^\d{4}$/.test(parts[0]) && /^\d{8}$/.test(parts[1])) {
            invoiceSalePoint = parts[0];
            invoiceNumberStr = parts[1];
          } else {
            invoiceSalePoint = "0000";
            const digits = rawNum.replace(/\D/g, "");
            invoiceNumberStr =
              digits.length >= 8 ? digits.slice(-8) : digits.padStart(8, "0").slice(-8);
          }
        }
      }

      form.reset({
        localId: existingInvoice.localId,
        supplierId: existingInvoice.supplierId,
        supplierRubroId: supplierForInvoice?.rubroId || undefined,
        invoiceSalePoint,
        invoiceNumber: invoiceNumberStr,
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
                taxId: item.taxId ?? undefined,
              }))
            : [
                {
                  supplyId: undefined,
                  description: "",
                  quantity: 1,
                  unitPrice: 0,
                  subtotal: 0,
                  rubroId: undefined,
                  taxId: undefined,
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

  const taxesById = useMemo(() => new Map(taxes.map((t) => [t.id, t])), [taxes]);

  const lineTaxSelectOptions = useMemo(
    () => taxes.filter((t) => t.active !== false && String(t.type ?? "").toLowerCase() === "iva"),
    [taxes],
  );

  const localComboOptions = useMemo(
    () => locals.filter((l) => l.active).map((l) => ({ value: String(l.id), label: l.name })),
    [locals],
  );

  const supplierComboOptions = useMemo(
    () => [
      { value: "__new__", label: "+ Crear nuevo proveedor" },
      ...suppliers.filter((s) => s.active !== false).map((s) => ({ value: String(s.id), label: s.tradeName })),
    ],
    [suppliers],
  );

  const supplierRubroComboOptions = useMemo(
    () => rubros.filter((r) => r.active).map((r) => ({ value: String(r.id), label: r.name })),
    [rubros],
  );

  const invoiceTypeComboOptions = useMemo(
    () => invoiceTypes.map((t) => ({ value: t.value, label: t.label })),
    [],
  );

  const ivaConditionComboOptions = useMemo(
    () => ivaConditions.map((c) => ({ value: c.value, label: c.label })),
    [],
  );

  const expenseTypeComboOptions = useMemo(
    () => expenseTypes.map((t) => ({ value: t.value, label: t.label })),
    [],
  );

  const invoiceTaxPickComboOptions = useMemo(
    () =>
      taxes
        .filter((t) => t.active !== false)
        .map((t) => ({
          value: String(t.id),
          label: `${t.name} (${t.percentage}%)`,
        })),
    [taxes],
  );

  const lineTaxComboOptions = useMemo(
    () =>
      lineTaxSelectOptions.map((t) => ({
        value: String(t.id),
        label: `${t.name} (${t.percentage}%)`,
      })),
    [lineTaxSelectOptions],
  );

  const orderedItemIndices = useMemo(() => {
    const n = itemFields.length;
    const all = Array.from({ length: n }, (_, i) => i);
    const drafts = all.filter((i) => !confirmedItems.has(i));
    const confirmed = all.filter((i) => confirmedItems.has(i));
    return [...drafts, ...confirmed];
  }, [itemFields.length, confirmedItems]);

  const watchTaxesRows = useWatch({ control: form.control, name: "taxes" }) ?? [];

  const taxComputation = useMemo(
    () =>
      computeInvoiceTaxes({
        items: watchItems.map((item) => ({
          subtotal: item?.subtotal,
          taxId: item?.taxId,
        })),
        discount: Number(watchDiscount) || 0,
        invoiceLevelTaxes: watchTaxesRows,
        taxesById,
      }),
    [watchItems, watchDiscount, watchTaxesRows, taxesById],
  );

  const discountVal = Number(watchDiscount) || 0;
  const advancePaymentVal = Number(watchAdvancePayment) || 0;
  const calculations = {
    subtotal: taxComputation.itemsSubtotal,
    discount: discountVal,
    subtotalAfterDiscount: taxComputation.subtotalAfterDiscount,
    lineTaxTotal: taxComputation.lineTaxTotal,
    invoiceLevelTaxTotal: taxComputation.invoiceLevelTaxTotal,
    taxTotal: taxComputation.taxGrandTotal,
    total: taxComputation.subtotalAfterDiscount + taxComputation.taxGrandTotal,
    balance: taxComputation.subtotalAfterDiscount + taxComputation.taxGrandTotal - advancePaymentVal,
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
    const tax = taxes.find((t) => t.id === taxId);
    if (!tax) return;

    const existing = taxFields.find((_, i) => form.getValues(`taxes.${i}.taxId`) === taxId);
    if (existing) {
      toast({ title: "Este impuesto ya fue agregado", variant: "destructive" });
      return;
    }

    const baseAmount = calculations.subtotalAfterDiscount;
    if (isInternalTaxType(tax.type)) {
      appendTax({ taxId, baseAmount, taxAmount: 0 });
      setAddTaxComboKey((k) => k + 1);
      return;
    }
    const percentage = parseFloat(String(tax.percentage));
    const taxAmount = (baseAmount * percentage) / 100;

    appendTax({ taxId, baseAmount, taxAmount });
    setAddTaxComboKey((k) => k + 1);
  };

  const recalculateTaxes = () => {
    const newTaxes = taxFields.map((_, index) => {
      const taxId = form.getValues(`taxes.${index}.taxId`);
      const tax = taxes.find((t) => t.id === taxId);
      if (!tax) return form.getValues(`taxes.${index}`);

      if (isInternalTaxType(tax.type)) {
        return form.getValues(`taxes.${index}`);
      }

      const baseAmount = calculations.subtotalAfterDiscount;
      const percentage = parseFloat(String(tax.percentage));
      const taxAmount = (baseAmount * percentage) / 100;

      return { taxId, baseAmount, taxAmount };
    });
    replaceTaxes(newTaxes);
  };

  useEffect(() => {
    const sad = calculations.subtotalAfterDiscount;
    taxFields.forEach((_, i) => {
      const taxId = form.getValues(`taxes.${i}.taxId`);
      const tax = taxes.find((t) => t.id === taxId);
      if (!tax) return;
      if (isInternalTaxType(tax.type)) {
        form.setValue(`taxes.${i}.baseAmount`, sad, { shouldValidate: false });
        return;
      }
      const pct = parseFloat(String(tax.percentage)) || 0;
      form.setValue(`taxes.${i}.baseAmount`, sad, { shouldValidate: false });
      form.setValue(`taxes.${i}.taxAmount`, (sad * pct) / 100, { shouldValidate: false });
    });
  }, [calculations.subtotalAfterDiscount, taxFields.length, taxes, form]);

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

  const correctMutation = useMutation({
    mutationFn: async (data: FormData) => {
      const supplier = suppliers.find((s) => s.id === data.supplierId);
      if (data.supplierRubroId && supplier && supplier.rubroId !== data.supplierRubroId) {
        await apiRequest("PATCH", `/api/suppliers/${supplier.id}`, { rubroId: data.supplierRubroId });
      }
      const { supplierRubroId, ...rest } = data;
      const payload = {
        ...rest,
        subtotal: calculations.subtotal,
        taxTotal: calculations.taxTotal,
        total: calculations.total,
        balance: calculations.balance,
        confirmCode: existingInvoice?.invoiceNumber ?? "",
      };
      const res = await apiRequest("POST", `/api/invoices/${params.id}/correct`, payload);
      return res.json();
    },
    onSuccess: (resp: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/supplies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recipes"], exact: false });
      const released = resp?.releasedPayments ?? 0;
      toast({
        title: "Factura corregida",
        description: released > 0 ? `Se liberaron ${released} pago(s) — reasignalos a la factura corregida.` : undefined,
      });
      navigate("/facturas");
    },
    onError: (error: Error) => {
      toast({ title: "Error al corregir factura", description: error.message, variant: "destructive" });
    },
  });

  const onSubmit = (data: FormData) => {
    if (isCorrecting) {
      // Pide la clave (número de comprobante) antes de aplicar la corrección.
      setPendingCorrection(data);
      setShowCorrectCodeDialog(true);
      return;
    }
    createMutation.mutate(data);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={isCorrecting ? "Corregir Factura" : isViewing ? "Detalle de Factura" : "Nueva Factura"}
        description={isCorrecting ? "Modificá los datos; al guardar se pide la clave" : isViewing ? "Informacion del comprobante registrado" : "Complete los datos del comprobante"}
        backHref="/facturas"
      />

      {isViewing && isLoadingInvoice && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Cargando factura...
          </CardContent>
        </Card>
      )}

      {isViewing && !isCorrecting && existingInvoice && (
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center justify-end pb-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsCorrecting(true)}
                disabled={(existingInvoice as any).status === "reversed"}
                data-testid="button-correct-invoice"
              >
                Corregir Factura
              </Button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
              <div>
                <p className="text-xs text-muted-foreground">Proveedor</p>
                <p className="font-medium" data-testid="text-supplier-name">
                  {existingInvoice.supplier?.tradeName || suppliers.find(s => s.id === existingInvoice.supplierId)?.tradeName || "-"}
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
                  {invoiceTypes.find(t => t.value === existingInvoice.invoiceType)?.label}{" "}
                  {formatInvoiceVoucherDisplay(existingInvoice)}
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

      {isCorrecting && existingInvoice && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
          <strong>Corrigiendo factura {existingInvoice.invoiceNumber}.</strong> Al guardar se te pedirá
          el número del comprobante como clave. La factura vieja se reemplaza por la corregida y se
          recalculan costos, stock y reportes. Si tenía pagos asignados, se liberan para reasignar.
        </div>
      )}

      {(!isViewing || isCorrecting) && (
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
                          <FormControl>
                            <DataEntryCombobox
                              options={localComboOptions}
                              value={field.value ? String(field.value) : ""}
                              onValueChange={(v) => field.onChange(parseInt(v, 10))}
                              placeholder="Seleccionar local"
                              searchPlaceholder="Buscar local…"
                              data-testid="select-local"
                              emptyMessage="Sin locales activos."
                            />
                          </FormControl>
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
                          <FormControl>
                            <DataEntryCombobox
                              options={supplierComboOptions}
                              value={field.value ? String(field.value) : ""}
                              onValueChange={(v) => {
                                if (v === "__new__") { setShowCreateSupplier(true); return; }
                                field.onChange(parseInt(v, 10));
                              }}
                              placeholder="Seleccionar proveedor"
                              searchPlaceholder="Buscar proveedor…"
                              data-testid="select-supplier"
                              emptyMessage="Sin proveedores."
                            />
                          </FormControl>
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
                          <FormControl>
                            <DataEntryCombobox
                              options={supplierRubroComboOptions}
                              value={field.value != null ? String(field.value) : ""}
                              onValueChange={(v) =>
                                field.onChange(v === "" ? undefined : parseInt(v, 10))
                              }
                              placeholder="Seleccionar rubro"
                              searchPlaceholder="Buscar rubro…"
                              emptyOptionLabel="Sin rubro del proveedor"
                              data-testid="select-supplier-rubro"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <div className="grid gap-4 sm:grid-cols-4">
                    <FormField
                      control={form.control}
                      name="invoiceType"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Tipo de Comprobante *</FormLabel>
                          <FormControl>
                            <DataEntryCombobox
                              options={invoiceTypeComboOptions}
                              value={field.value || ""}
                              onValueChange={field.onChange}
                              placeholder="Seleccionar tipo"
                              searchPlaceholder="Buscar tipo de comprobante…"
                              data-testid="select-invoice-type"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="invoiceSalePoint"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Punto de venta *</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              inputMode="numeric"
                              maxLength={4}
                              placeholder="0006"
                              className="font-mono tracking-wider"
                              data-testid="input-invoice-sale-point"
                              onChange={(e) => field.onChange(e.target.value.replace(/\D/g, "").slice(0, 4))}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="invoiceNumber"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Número de comprobante *</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              inputMode="numeric"
                              maxLength={8}
                              placeholder="00002159"
                              className="font-mono tracking-wider"
                              data-testid="input-invoice-number"
                              onChange={(e) => field.onChange(e.target.value.replace(/\D/g, "").slice(0, 8))}
                            />
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
                          <FormControl>
                            <DataEntryCombobox
                              options={ivaConditionComboOptions}
                              value={field.value || ""}
                              onValueChange={field.onChange}
                              placeholder="Seleccionar"
                              searchPlaceholder="Buscar condición IVA…"
                              data-testid="select-iva-condition"
                            />
                          </FormControl>
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
                          <FormControl>
                            <DataEntryCombobox
                              options={expenseTypeComboOptions}
                              value={field.value || ""}
                              onValueChange={field.onChange}
                              placeholder="Seleccionar tipo"
                              searchPlaceholder="Buscar tipo de gasto…"
                              data-testid="select-expense-type"
                            />
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
                    onClick={() => {
                      prependItem({
                        supplyId: undefined,
                        description: "",
                        quantity: 1,
                        unitPrice: 0,
                        subtotal: 0,
                        rubroId: undefined,
                        taxId: undefined,
                      });
                      setConfirmedItems((prev) => {
                        const next = new Set<number>();
                        prev.forEach((i) => next.add(i + 1));
                        return next;
                      });
                    }}
                    data-testid="button-add-item"
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Agregar Item
                  </Button>
                </CardHeader>
                <CardContent className="space-y-4">
                  {orderedItemIndices.map((index) => {
                    const field = itemFields[index]!;
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
                                onOpenChange={(o) => setOpenSupplyPickerIndex(o ? index : null)}
                                modal
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
                                  <Command
                                    defaultValue={
                                      selectedSupply
                                        ? `${selectedSupply.name} ${selectedSupply.unitOfMeasure?.abbreviation ?? ""} ${selectedSupply.id}`
                                        : undefined
                                    }
                                  >
                                    <CommandInput placeholder="Buscar insumo..." />
                                    <CommandList>
                                      <CommandEmpty>Sin resultados</CommandEmpty>
                                      <CommandGroup>
                                        <CommandItem
                                          value="__new__ crear nuevo insumo"
                                          onSelect={() => {
                                            setOpenSupplyPickerIndex(null);
                                            setCreateSupplyForIndex(index);
                                          }}
                                          className="text-primary font-medium"
                                        >
                                          <Plus className="mr-2 h-4 w-4 shrink-0" />
                                          Crear nuevo insumo
                                        </CommandItem>
                                      </CommandGroup>
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
                      <FormField
                        control={form.control}
                        name={`items.${index}.taxId`}
                        render={({ field: taxField }) => (
                          <FormItem>
                            <FormLabel>IVA por insumo</FormLabel>
                            <FormControl>
                              <DataEntryCombobox
                                options={lineTaxComboOptions}
                                value={taxField.value != null ? String(taxField.value) : ""}
                                onValueChange={(v) =>
                                  taxField.onChange(v === "" ? undefined : parseInt(v, 10))
                                }
                                placeholder="Sin IVA en esta línea"
                                searchPlaceholder="Buscar alícuota…"
                                emptyOptionLabel="Sin IVA en esta línea"
                                data-testid={`select-item-tax-${index}`}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <p className="text-xs text-muted-foreground">
                        Opcional: alícuota por producto. Para IVA u otros impuestos sobre el subtotal del comprobante
                        usá la sección Impuestos al total.
                      </p>
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
                <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between gap-y-3">
                  <div className="space-y-1">
                    <CardTitle>Impuestos al total del comprobante</CardTitle>
                    <CardDescription>
                      Porcentaje sobre el subtotal neto (tras descuento). El impuesto interno es un importe manual al
                      total. El IVA por insumo se configura en cada linea del detalle.
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <DataEntryCombobox
                      key={addTaxComboKey}
                      options={invoiceTaxPickComboOptions}
                      value=""
                      onValueChange={(v) => handleAddTax(parseInt(v, 10))}
                      placeholder="Agregar impuesto"
                      searchPlaceholder="Buscar impuesto…"
                      triggerClassName="w-48 shrink-0"
                      data-testid="select-add-tax"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={recalculateTaxes}
                      title="Actualiza impuestos porcentuales al total (no cambia IVA por insumo ni interno manual)"
                      data-testid="button-recalculate-taxes"
                    >
                      <Calculator className="h-4 w-4" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {taxFields.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      No hay impuestos al total. Podés combinarlos con IVA por insumo en cada linea.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {taxFields.map((field, index) => {
                        const tax = taxes.find((t) => t.id === form.getValues(`taxes.${index}.taxId`));
                        const internal = tax ? isInternalTaxType(tax.type) : false;
                        return (
                          <div
                            key={field.id}
                            className="flex flex-col gap-3 p-3 rounded-lg border sm:flex-row sm:items-center sm:justify-between"
                          >
                            <div className="min-w-0">
                              <div className="font-medium">{tax?.name || "Impuesto"}</div>
                              {internal ? (
                                <p className="text-xs text-muted-foreground mt-1">
                                  Importe fijo al total del comprobante (manual).
                                </p>
                              ) : (
                                <div className="text-sm text-muted-foreground">
                                  {tax?.percentage}% sobre {formatCurrency(form.getValues(`taxes.${index}.baseAmount`))}
                                </div>
                              )}
                            </div>
                            <div className="flex flex-wrap items-center gap-3">
                              {internal ? (
                                <FormField
                                  control={form.control}
                                  name={`taxes.${index}.taxAmount`}
                                  render={({ field: amtField }) => (
                                    <FormItem className="space-y-1">
                                      <FormLabel className="text-xs">Importe</FormLabel>
                                      <FormControl>
                                        <Input
                                          type="number"
                                          step="0.01"
                                          min="0"
                                          className="w-36 font-mono"
                                          {...amtField}
                                          data-testid={`input-tax-manual-${index}`}
                                        />
                                      </FormControl>
                                      <FormMessage />
                                    </FormItem>
                                  )}
                                />
                              ) : (
                                <span className="font-mono font-medium">
                                  {formatCurrency(form.getValues(`taxes.${index}.taxAmount`))}
                                </span>
                              )}
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
                    {calculations.lineTaxTotal > 0 && (
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>Incluye IVA por insumo</span>
                        <span className="font-mono">{formatCurrency(calculations.lineTaxTotal)}</span>
                      </div>
                    )}
                    {calculations.invoiceLevelTaxTotal > 0 && (
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>Incluye impuestos al total</span>
                        <span className="font-mono">{formatCurrency(calculations.invoiceLevelTaxTotal)}</span>
                      </div>
                    )}
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
                      disabled={createMutation.isPending || correctMutation.isPending}
                      data-testid="button-submit"
                    >
                      {isCorrecting
                        ? correctMutation.isPending
                          ? "Corrigiendo..."
                          : "Guardar Corrección"
                        : createMutation.isPending
                          ? "Guardando..."
                          : "Guardar Factura"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full"
                      onClick={() => (isCorrecting ? setIsCorrecting(false) : navigate("/facturas"))}
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
      )}

      <CodeConfirmDialog
        open={showCorrectCodeDialog}
        onOpenChange={(o) => {
          setShowCorrectCodeDialog(o);
          if (!o) setPendingCorrection(null);
        }}
        title="Corregir factura"
        description="Esta acción reemplaza la factura por la versión corregida y recalcula costos, stock y reportes. La factura original deja de existir (queda registro en auditoría)."
        confirmCode={existingInvoice?.invoiceNumber ?? ""}
        confirmLabel="Corregir"
        isLoading={correctMutation.isPending}
        onConfirm={() => {
          if (pendingCorrection) correctMutation.mutate(pendingCorrection);
          setShowCorrectCodeDialog(false);
        }}
      />

      <QuickCreateSupplierDialog
        open={showCreateSupplier}
        onOpenChange={setShowCreateSupplier}
        onCreated={(supplier) => {
          queryClient.invalidateQueries({ queryKey: ["/api/suppliers"] });
          form.setValue("supplierId", supplier.id, { shouldValidate: true });
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
