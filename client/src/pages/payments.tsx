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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { CreditCard, Trash2, Plus, FileText } from "lucide-react";
import type { Payment, Supplier, Local, BankAccount, Invoice } from "@shared/schema";

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

export default function PaymentsPage() {
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [deletePayment, setDeletePayment] = useState<PaymentWithRelations | null>(null);
  const [selectedInvoices, setSelectedInvoices] = useState<Map<number, number>>(new Map());

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

  const pendingInvoices = useMemo(() => {
    if (!watchSupplierId) return [];
    return allInvoices.filter(inv => {
      if (inv.supplierId !== watchSupplierId) return false;
      const balance = parseFloat(String(inv.balance) || "0");
      return balance > 0 && !inv.paid;
    });
  }, [allInvoices, watchSupplierId]);

  useEffect(() => {
    setSelectedInvoices(new Map());
  }, [watchSupplierId]);

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
    setSelectedInvoices(new Map());
    form.reset();
  };

  const onSubmit = (data: FormData) => {
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
      cell: (row) => row.supplier?.businessName || "-",
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
      className: "w-20",
      cell: (row) => (
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setDeletePayment(row)}
          data-testid={`button-delete-${row.id}`}
        >
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
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

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nuevo Pago</DialogTitle>
            <DialogDescription>
              Seleccione un proveedor para ver sus facturas pendientes
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
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
              </div>

              {watchSupplierId > 0 && pendingInvoices.length > 0 && (
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
                    <div className="rounded-md border overflow-hidden">
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
                                  <span className="font-mono text-sm">{inv.invoiceNumber}</span>
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

              {watchSupplierId > 0 && pendingInvoices.length === 0 && (
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
                      <Select onValueChange={field.onChange} value={field.value?.toString() || "0"}>
                        <FormControl>
                          <SelectTrigger data-testid="select-bank-account">
                            <SelectValue placeholder="Seleccionar banco" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="0">Sin especificar</SelectItem>
                          {bankAccounts.filter(b => b.active).map((bank) => (
                            <SelectItem key={bank.id} value={bank.id.toString()}>
                              {bank.name}
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
                  name="paymentMethod"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Metodo *</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-method">
                            <SelectValue placeholder="Seleccionar" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {paymentMethods.map((method) => (
                            <SelectItem key={method.value} value={method.value}>
                              {method.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
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
                      {selectedInvoices.size > 0 && (
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
              <div className="flex justify-end gap-2 pt-4">
                <Button type="button" variant="outline" onClick={closeDialog} data-testid="button-cancel">
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  disabled={createMutation.isPending}
                  data-testid="button-submit"
                >
                  {createMutation.isPending ? "Guardando..." : "Registrar Pago"}
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
    </div>
  );
}
