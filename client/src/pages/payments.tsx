import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { PageHeader } from "@/components/page-header";
import { DataTable, Column } from "@/components/data-table";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Label } from "@/components/ui/label";
import { DataEntryCombobox } from "@/components/data-entry-combobox";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatCurrency, formatDate, formatDateInput } from "@/lib/formatters";
import { CreditCard, Trash2, Plus, FileText, Pencil } from "lucide-react";
import type { Payment, Supplier, Local, BankAccount, Invoice } from "@shared/schema";
import { formatInvoiceVoucherDisplay } from "@shared/invoiceDisplay";

interface PaymentWithRelations extends Payment {
  supplier?: Supplier | null;
  local?: Local | null;
  bankAccount?: BankAccount | null;
}

interface InvoiceWithRelations extends Invoice {
  supplier?: Supplier | null;
  local?: Local | null;
}

const paymentMethods = [
  { value: "efectivo", label: "Efectivo" },
  { value: "transferencia", label: "Transferencia" },
  { value: "cheque", label: "Cheque" },
  { value: "tarjeta", label: "Tarjeta" },
  { value: "otro", label: "Otro" },
];

const formSchema = z.object({
  localId: z.coerce.number().min(1, "Seleccione un local"),
  supplierId: z.coerce.number().min(1, "Seleccione un proveedor"),
  paymentNumber: z.string().optional(),
  paymentDate: z.string().min(1, "Fecha requerida"),
  bankAccountId: z.coerce.number().optional().or(z.literal(0)).transform(v => v === 0 ? null : v),
  paymentMethod: z.string().min(1, "Metodo de pago requerido"),
  amount: z.coerce.number().min(0.01, "Monto requerido"),
  notes: z.string().optional(),
});

type FormData = z.infer<typeof formSchema>;

interface InvoiceAllocation {
  invoiceId: number;
  amount: number;
}

const EDIT_KEYWORD = "EDITAR";

export default function PaymentsPage() {
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [deletePayment, setDeletePayment] = useState<PaymentWithRelations | null>(null);
  const [selectedInvoices, setSelectedInvoices] = useState<Map<number, number>>(new Map());

  // Edición: pago en edición + compuerta de palabra clave para abrir el editor.
  const [editingPayment, setEditingPayment] = useState<PaymentWithRelations | null>(null);
  const [keywordPayment, setKeywordPayment] = useState<PaymentWithRelations | null>(null);
  const [editKeyword, setEditKeyword] = useState("");
  const isEditMode = !!editingPayment;

  const { data: payments = [], isLoading } = useQuery<PaymentWithRelations[]>({
    queryKey: ["/api/payments"],
  });

  const { data: suppliers = [] } = useQuery<Supplier[]>({
    queryKey: ["/api/suppliers"],
  });

  const { data: locals = [] } = useQuery<Local[]>({
    queryKey: ["/api/locals"],
  });

  const { data: bankAccounts = [] } = useQuery<BankAccount[]>({
    queryKey: ["/api/bank-accounts"],
  });

  const { data: allInvoices = [] } = useQuery<InvoiceWithRelations[]>({
    queryKey: ["/api/invoices"],
  });

  const paymentSupplierOptions = useMemo(
    () =>
      suppliers.filter((s) => s.active).map((s) => ({ value: String(s.id), label: s.tradeName })),
    [suppliers],
  );

  const paymentLocalOptions = useMemo(
    () => locals.filter((l) => l.active).map((l) => ({ value: String(l.id), label: l.name })),
    [locals],
  );

  const paymentBankOptions = useMemo(
    () => [
      { value: "0", label: "Sin especificar" },
      ...bankAccounts.filter((b) => b.active).map((b) => ({ value: String(b.id), label: b.name })),
    ],
    [bankAccounts],
  );

  const paymentMethodComboOptions = useMemo(
    () => paymentMethods.map((m) => ({ value: m.value, label: m.label })),
    [],
  );

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      localId: 0,
      supplierId: 0,
      paymentNumber: "",
      paymentDate: formatDateInput(new Date()),
      bankAccountId: 0,
      paymentMethod: "transferencia",
      amount: 0,
      notes: "",
    },
  });

  const watchSupplierIdRaw = form.watch("supplierId");
  const watchSupplierId = typeof watchSupplierIdRaw === "string"
    ? parseInt(watchSupplierIdRaw || "0") || 0
    : watchSupplierIdRaw || 0;

  const watchLocalIdRaw = form.watch("localId");
  const watchLocalId = typeof watchLocalIdRaw === "string"
    ? parseInt(watchLocalIdRaw || "0") || 0
    : watchLocalIdRaw || 0;

  const pendingInvoices = useMemo(() => {
    if (!watchSupplierId) return [];
    return allInvoices.filter(inv => {
      if (inv.supplierId !== watchSupplierId) return false;
      if (watchLocalId && inv.localId !== watchLocalId) return false;
      const balance = parseFloat(String(inv.balance) || "0");
      return balance > 0 && !inv.paid;
    });
  }, [allInvoices, watchSupplierId, watchLocalId]);

  useEffect(() => {
    setSelectedInvoices(new Map());
  }, [watchSupplierId, watchLocalId]);

  const totalSelected = useMemo(() => {
    let total = 0;
    selectedInvoices.forEach(amount => { total += amount; });
    return total;
  }, [selectedInvoices]);

  useEffect(() => {
    if (totalSelected > 0) {
      form.setValue("amount", totalSelected);
    }
  }, [totalSelected, form]);

  const toggleInvoice = (invoiceId: number, balance: number) => {
    const next = new Map(selectedInvoices);
    if (next.has(invoiceId)) {
      next.delete(invoiceId);
    } else {
      next.set(invoiceId, balance);
    }
    setSelectedInvoices(next);
  };

  const updateInvoiceAmount = (invoiceId: number, amount: number, maxBalance: number) => {
    const next = new Map(selectedInvoices);
    const clampedAmount = Math.min(Math.max(0, amount), maxBalance);
    if (clampedAmount > 0) {
      next.set(invoiceId, clampedAmount);
    } else {
      next.delete(invoiceId);
    }
    setSelectedInvoices(next);
  };

  const createMutation = useMutation({
    mutationFn: async (payload: FormData & { allocations?: InvoiceAllocation[] }) => {
      const res = await apiRequest("POST", "/api/payments", payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/supplier-accounts"] });
      toast({ title: "Pago registrado correctamente" });
      closeDialog();
    },
    onError: (error: Error) => {
      toast({ title: "Error al registrar pago", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<FormData> }) => {
      const res = await apiRequest("PATCH", `/api/payments/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
      toast({ title: "Pago actualizado correctamente" });
      closeDialog();
    },
    onError: (error: Error) => {
      toast({ title: "Error al actualizar pago", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/payments/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/supplier-accounts"] });
      toast({ title: "Pago eliminado correctamente" });
      setDeletePayment(null);
    },
    onError: (error: Error) => {
      toast({ title: "Error al eliminar pago", description: error.message, variant: "destructive" });
    },
  });

  const openCreate = () => {
    form.reset({
      localId: 0,
      supplierId: 0,
      paymentNumber: "",
      paymentDate: formatDateInput(new Date()),
      bankAccountId: 0,
      paymentMethod: "transferencia",
      amount: 0,
      notes: "",
    });
    setSelectedInvoices(new Map());
    setIsDialogOpen(true);
  };

  const closeDialog = () => {
    setIsDialogOpen(false);
    setEditingPayment(null);
    setSelectedInvoices(new Map());
    form.reset();
  };

  // Paso 1: pedir palabra clave antes de abrir el editor.
  const openEditKeyword = (payment: PaymentWithRelations) => {
    setKeywordPayment(payment);
    setEditKeyword("");
  };

  const closeKeyword = () => {
    setKeywordPayment(null);
    setEditKeyword("");
  };

  // Paso 2: validada la palabra clave, abrir el editor precargado.
  const confirmEditKeyword = () => {
    const p = keywordPayment;
    if (!p) return;
    form.reset({
      localId: p.localId,
      supplierId: p.supplierId,
      paymentNumber: p.paymentNumber ?? "",
      paymentDate: formatDateInput(p.paymentDate),
      bankAccountId: p.bankAccountId ?? 0,
      paymentMethod: p.paymentMethod,
      amount: parseFloat(String(p.amount)) || 0,
      notes: p.notes ?? "",
    });
    setSelectedInvoices(new Map());
    setEditingPayment(p);
    closeKeyword();
  };

  const onSubmit = (data: FormData) => {
    // Modo edición: solo datos neutros (no monto, proveedor/local ni facturas).
    if (isEditMode && editingPayment) {
      updateMutation.mutate({
        id: editingPayment.id,
        data: {
          paymentNumber: data.paymentNumber,
          paymentDate: data.paymentDate,
          bankAccountId: data.bankAccountId,
          paymentMethod: data.paymentMethod,
          notes: data.notes,
        },
      });
      return;
    }

    let allocations: InvoiceAllocation[] = [];

    selectedInvoices.forEach((amount, invoiceId) => {
      if (amount > 0) {
        allocations.push({ invoiceId, amount });
      }
    });

    const hasPending = pendingInvoices.length > 0;
    const hasAllocations = allocations.length > 0;

    if (hasPending && !hasAllocations) {
      toast({
        title: "Seleccioná facturas",
        description: "Este proveedor tiene facturas pendientes: debes seleccionar al menos una y un monto a pagar.",
        variant: "destructive",
      });
      return;
    }

    const payload: any = { ...data };
    if (hasAllocations) {
      payload.allocations = allocations;
    }

    createMutation.mutate(payload);
  };

  const getMethodLabel = (method: string) => {
    return paymentMethods.find(m => m.value === method)?.label || method;
  };

  const columns: Column<PaymentWithRelations>[] = [
    {
      key: "paymentNumber",
      header: "Numero",
      cell: (row) => (
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-500/10">
            <CreditCard className="h-4 w-4 text-green-600" />
          </div>
          <span className="font-medium font-mono">
            {row.paymentNumber || `#${row.id}`}
          </span>
        </div>
      ),
    },
    {
      key: "supplier",
      header: "Proveedor",
      cell: (row) => row.supplier?.tradeName || "-",
    },
    {
      key: "local",
      header: "Local",
      cell: (row) => row.local?.name || "-",
    },
    {
      key: "bankAccount",
      header: "Entidad",
      cell: (row) => {
        const bank = bankAccounts.find(b => b.id === row.bankAccountId);
        return bank ? bank.name : <span className="text-muted-foreground">-</span>;
      },
    },
    {
      key: "paymentDate",
      header: "Fecha",
      cell: (row) => formatDate(row.paymentDate),
    },
    {
      key: "paymentMethod",
      header: "Metodo",
      cell: (row) => (
        <Badge variant="secondary">
          {getMethodLabel(row.paymentMethod)}
        </Badge>
      ),
    },
    {
      key: "amount",
      header: "Monto",
      className: "text-right",
      cell: (row) => (
        <span className="font-mono font-medium text-green-600">
          {formatCurrency(row.amount)}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      className: "w-28",
      cell: (row) => (
        <div className="flex items-center justify-end gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => openEditKeyword(row)}
            data-testid={`button-edit-${row.id}`}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setDeletePayment(row)}
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
        title="Pagos"
        description="Registro de pagos a proveedores"
        actions={
          <Button onClick={openCreate} data-testid="button-new-payment">
            <Plus className="h-4 w-4 mr-2" />
            Nuevo Pago
          </Button>
        }
      />

      <DataTable
        columns={columns}
        data={payments}
        isLoading={isLoading}
        searchPlaceholder="Buscar por numero o proveedor..."
        searchKeys={["paymentNumber"]}
        emptyMessage="No hay pagos registrados"
        pageSize={15}
      />

      <Dialog open={isDialogOpen || isEditMode} onOpenChange={(o) => { if (!o) closeDialog(); }}>
        <DialogContent className="w-[95vw] max-w-4xl h-[88vh] overflow-hidden">
          <DialogHeader>
            <DialogTitle>{isEditMode ? "Editar Pago" : "Nuevo Pago"}</DialogTitle>
            <DialogDescription>
              {isEditMode
                ? "Podés editar fecha, método, entidad, N° de pago y notas. El monto y las facturas imputadas no se modifican."
                : "Seleccione un proveedor para ver sus facturas pendientes"}
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="flex h-full min-h-0 flex-col">
              <div className="flex-1 min-h-0 space-y-4 overflow-y-auto pr-1">
                <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="supplierId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Proveedor *</FormLabel>
                      <FormControl>
                        <DataEntryCombobox
                          options={paymentSupplierOptions}
                          value={field.value && field.value > 0 ? String(field.value) : ""}
                          onValueChange={(v) => field.onChange(parseInt(v, 10))}
                          placeholder="Seleccionar proveedor"
                          searchPlaceholder="Buscar proveedor…"
                          disabled={isEditMode}
                          data-testid="select-supplier"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="localId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Local *</FormLabel>
                      <FormControl>
                        <DataEntryCombobox
                          options={paymentLocalOptions}
                          value={field.value && field.value > 0 ? String(field.value) : ""}
                          onValueChange={(v) => field.onChange(parseInt(v, 10))}
                          placeholder="Seleccionar local"
                          searchPlaceholder="Buscar local…"
                          disabled={isEditMode}
                          data-testid="select-local"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                </div>

                {!isEditMode && watchSupplierId > 0 && pendingInvoices.length > 0 && (
                  <Card>
                    <CardContent className="pt-4">
                      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                        <h4 className="font-medium text-sm flex items-center gap-2">
                          <FileText className="h-4 w-4" />
                          Facturas Pendientes
                        </h4>
                        {selectedInvoices.size > 0 && (
                          <Badge variant="default" data-testid="badge-selected-total">
                            {selectedInvoices.size} seleccionadas: {formatCurrency(totalSelected)}
                          </Badge>
                        )}
                      </div>
                      <div className="rounded-md border overflow-auto max-h-56">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="w-10"></TableHead>
                              <TableHead>Factura</TableHead>
                              <TableHead>Fecha</TableHead>
                              <TableHead>Vence</TableHead>
                              <TableHead className="text-right">Total</TableHead>
                              <TableHead className="text-right">Saldo</TableHead>
                              <TableHead className="text-right w-32">A Pagar</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {pendingInvoices.map((inv) => {
                              const balance = parseFloat(String(inv.balance) || "0");
                              const isSelected = selectedInvoices.has(inv.id);
                              const allocatedAmount = selectedInvoices.get(inv.id) || 0;
                              const isOverdue = inv.dueDate && new Date(inv.dueDate) < new Date();
                              return (
                                <TableRow key={inv.id} className={isSelected ? "bg-primary/5" : ""}>
                                  <TableCell>
                                    <Checkbox
                                      checked={isSelected}
                                      onCheckedChange={() => toggleInvoice(inv.id, balance)}
                                      data-testid={`checkbox-invoice-${inv.id}`}
                                    />
                                  </TableCell>
                                  <TableCell>
                                    <span className="font-mono text-sm">{formatInvoiceVoucherDisplay(inv)}</span>
                                  </TableCell>
                                  <TableCell className="text-sm">
                                    {formatDate(inv.invoiceDate)}
                                  </TableCell>
                                  <TableCell className="text-sm">
                                    {inv.dueDate ? (
                                      <span className={isOverdue ? "text-destructive font-medium" : ""}>
                                        {formatDate(inv.dueDate)}
                                      </span>
                                    ) : "-"}
                                  </TableCell>
                                  <TableCell className="text-right font-mono text-sm">
                                    {formatCurrency(inv.total)}
                                  </TableCell>
                                  <TableCell className="text-right font-mono text-sm text-destructive">
                                    {formatCurrency(balance)}
                                  </TableCell>
                                  <TableCell className="text-right">
                                    {isSelected ? (
                                      <Input
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        max={balance}
                                        value={allocatedAmount}
                                        onChange={(e) => updateInvoiceAmount(inv.id, parseFloat(e.target.value) || 0, balance)}
                                        className="w-28 text-right font-mono h-8 ml-auto"
                                        data-testid={`input-invoice-amount-${inv.id}`}
                                      />
                                    ) : (
                                      <span className="text-muted-foreground text-sm">-</span>
                                    )}
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {!isEditMode && watchSupplierId > 0 && pendingInvoices.length === 0 && (
                  <Card>
                    <CardContent className="py-6 text-center text-muted-foreground text-sm">
                      Este proveedor no tiene facturas pendientes de pago
                    </CardContent>
                  </Card>
                )}

                <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="paymentNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Numero de Pago</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="Opcional" data-testid="input-payment-number" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="paymentDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Fecha *</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} data-testid="input-payment-date" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="bankAccountId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Entidad Bancaria</FormLabel>
                      <FormControl>
                        <DataEntryCombobox
                          options={paymentBankOptions}
                          value={
                            field.value !== null &&
                            field.value !== undefined &&
                            field.value !== 0
                              ? String(field.value)
                              : "0"
                          }
                          onValueChange={(v) => field.onChange(parseInt(v, 10))}
                          placeholder="Seleccionar banco"
                          searchPlaceholder="Buscar banco…"
                          data-testid="select-bank-account"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="paymentMethod"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Metodo *</FormLabel>
                      <FormControl>
                        <DataEntryCombobox
                          options={paymentMethodComboOptions}
                          value={field.value || ""}
                          onValueChange={field.onChange}
                          placeholder="Seleccionar"
                          searchPlaceholder="Buscar método…"
                          data-testid="select-method"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                </div>
                <FormField
                  control={form.control}
                  name="amount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        Monto Total *
                        {isEditMode ? (
                          <span className="text-muted-foreground font-normal ml-2">
                            (no editable)
                          </span>
                        ) : selectedInvoices.size > 0 && (
                          <span className="text-muted-foreground font-normal ml-2">
                            (calculado de facturas seleccionadas)
                          </span>
                        )}
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          {...field}
                          disabled={isEditMode}
                          className="font-mono"
                          data-testid="input-amount"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="notes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Notas</FormLabel>
                      <FormControl>
                        <Textarea {...field} placeholder="Notas adicionales..." rows={2} data-testid="input-notes" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <div className="flex justify-end gap-2 border-t bg-background pt-3 mt-3">
                <Button type="button" variant="outline" onClick={closeDialog} data-testid="button-cancel">
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  disabled={createMutation.isPending || updateMutation.isPending}
                  data-testid="button-submit"
                >
                  {isEditMode
                    ? (updateMutation.isPending ? "Guardando..." : "Guardar cambios")
                    : (createMutation.isPending ? "Guardando..." : "Registrar Pago")}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deletePayment}
        onOpenChange={(open) => !open && setDeletePayment(null)}
        title="Eliminar Pago"
        description="¿Esta seguro que desea eliminar este pago? Esta accion revertira los saldos de las facturas asociadas."
        confirmLabel="Eliminar"
        onConfirm={() => deletePayment && deleteMutation.mutate(deletePayment.id)}
        variant="destructive"
        isLoading={deleteMutation.isPending}
      />

      {/* Compuerta de palabra clave para habilitar la edición */}
      <Dialog open={!!keywordPayment} onOpenChange={(o) => { if (!o) closeKeyword(); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Editar pago</DialogTitle>
            <DialogDescription>
              Para editar este pago, escribí la palabra clave.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label className="text-xs">
              Escribí <span className="font-mono font-semibold">{EDIT_KEYWORD}</span> para continuar
            </Label>
            <Input
              value={editKeyword}
              onChange={(e) => setEditKeyword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && editKeyword.trim().toUpperCase() === EDIT_KEYWORD) {
                  e.preventDefault();
                  confirmEditKeyword();
                }
              }}
              placeholder={EDIT_KEYWORD}
              autoComplete="off"
              data-testid="input-edit-keyword"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={closeKeyword} data-testid="button-cancel-edit-keyword">
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={editKeyword.trim().toUpperCase() !== EDIT_KEYWORD}
              onClick={confirmEditKeyword}
              data-testid="button-confirm-edit-keyword"
            >
              Editar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
