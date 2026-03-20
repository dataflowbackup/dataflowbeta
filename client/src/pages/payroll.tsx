import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { PageHeader } from "@/components/page-header";
import { DataTable, Column } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatCurrency } from "@/lib/formatters";
import {
  Plus,
  DollarSign,
  Clock,
  Users,
  AlertCircle,
  CheckCircle,
  Edit,
  CreditCard,
} from "lucide-react";
import type { Payroll, Employee } from "@shared/schema";

const formSchema = z.object({
  employeeId: z.coerce.number().min(1, "El empleado es requerido"),
  period: z.string().min(1, "El periodo es requerido").regex(/^\d{4}-\d{2}$/, "Formato de periodo invalido (YYYY-MM)"),
  baseSalary: z.coerce.number().min(0, "El salario base debe ser mayor o igual a 0"),
  overtime: z.coerce.number().min(0).default(0),
  bonuses: z.coerce.number().min(0).default(0),
  deductions: z.coerce.number().min(0).default(0),
  payrollType: z.string().default("salary"),
  status: z.string().default("pending"),
  notes: z.string().optional(),
});

type FormData = z.infer<typeof formSchema>;

type PayrollWithEmployee = Payroll & { employee?: Employee };

export default function PayrollPage() {
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingPayroll, setEditingPayroll] = useState<Payroll | null>(null);
  const [periodFilter, setPeriodFilter] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });

  const { data: payrolls = [], isLoading, isError: isPayrollsError } = useQuery<Payroll[]>({
    queryKey: ["/api/payrolls", { period: periodFilter }],
    queryFn: async () => {
      const res = await fetch(`/api/payrolls?period=${periodFilter}`, { credentials: "include" });
      if (!res.ok) throw new Error("Error al cargar liquidaciones");
      return res.json();
    },
  });

  const { data: employees = [], isError: isEmployeesError } = useQuery<Employee[]>({
    queryKey: ["/api/employees"],
  });

  const hasError = isPayrollsError || isEmployeesError;

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      employeeId: 0,
      period: periodFilter,
      baseSalary: 0,
      overtime: 0,
      bonuses: 0,
      deductions: 0,
      payrollType: "salary",
      status: "pending",
      notes: "",
    },
  });

  useEffect(() => {
    if (!editingPayroll) {
      form.setValue("period", periodFilter);
    }
  }, [periodFilter, editingPayroll, form]);

  const createMutation = useMutation({
    mutationFn: async (data: FormData) => {
      const netSalary = data.baseSalary + data.overtime + data.bonuses - data.deductions;
      const res = await apiRequest("POST", "/api/payrolls", { ...data, netSalary: netSalary.toString() });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ 
        predicate: (query) => query.queryKey[0] === "/api/payrolls" 
      });
      toast({ title: "Liquidacion creada correctamente" });
      closeDialog();
    },
    onError: (error: Error) => {
      toast({ title: "Error al crear liquidacion", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<FormData> }) => {
      const baseSalary = data.baseSalary ?? 0;
      const overtime = data.overtime ?? 0;
      const bonuses = data.bonuses ?? 0;
      const deductions = data.deductions ?? 0;
      const netSalary = baseSalary + overtime + bonuses - deductions;
      const res = await apiRequest("PATCH", `/api/payrolls/${id}`, { ...data, netSalary: netSalary.toString() });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ 
        predicate: (query) => query.queryKey[0] === "/api/payrolls" 
      });
      toast({ title: "Liquidacion actualizada correctamente" });
      closeDialog();
    },
    onError: (error: Error) => {
      toast({ title: "Error al actualizar liquidacion", description: error.message, variant: "destructive" });
    },
  });

  const markPaidMutation = useMutation({
    mutationFn: async (payroll: Payroll) => {
      const baseSalary = parseFloat(payroll.baseSalary || "0");
      const overtime = parseFloat(payroll.overtime || "0");
      const bonuses = parseFloat(payroll.bonuses || "0");
      const deductions = parseFloat(payroll.deductions || "0");
      const netSalary = baseSalary + overtime + bonuses - deductions;
      
      const res = await apiRequest("PATCH", `/api/payrolls/${payroll.id}`, { 
        status: "paid", 
        paidAt: new Date().toISOString(),
        netSalary: netSalary.toString(),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ 
        predicate: (query) => query.queryKey[0] === "/api/payrolls" 
      });
      toast({ title: "Liquidacion marcada como pagada" });
    },
    onError: (error: Error) => {
      toast({ title: "Error al marcar como pagada", description: error.message, variant: "destructive" });
    },
  });

  const closeDialog = () => {
    setIsDialogOpen(false);
    setEditingPayroll(null);
    form.reset({
      employeeId: 0,
      period: periodFilter,
      baseSalary: 0,
      overtime: 0,
      bonuses: 0,
      deductions: 0,
      payrollType: "salary",
      status: "pending",
      notes: "",
    });
  };

  const openCreate = () => {
    setEditingPayroll(null);
    form.reset({
      employeeId: 0,
      period: periodFilter,
      baseSalary: 0,
      overtime: 0,
      bonuses: 0,
      deductions: 0,
      payrollType: "salary",
      status: "pending",
      notes: "",
    });
    setIsDialogOpen(true);
  };

  const openEdit = (payroll: Payroll) => {
    setEditingPayroll(payroll);
    form.reset({
      employeeId: payroll.employeeId,
      period: payroll.period,
      baseSalary: parseFloat(payroll.baseSalary || "0"),
      overtime: parseFloat(payroll.overtime || "0"),
      bonuses: parseFloat(payroll.bonuses || "0"),
      deductions: parseFloat(payroll.deductions || "0"),
      payrollType: payroll.payrollType || "salary",
      status: payroll.status || "pending",
      notes: payroll.notes || "",
    });
    setIsDialogOpen(true);
  };

  const onSubmit = (data: FormData) => {
    if (editingPayroll) {
      updateMutation.mutate({ id: editingPayroll.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const employeesMap = new Map(employees.map((e) => [e.id, e]));

  const pendingPayrolls = payrolls.filter((p) => p.status === "pending");
  const paidPayrolls = payrolls.filter((p) => p.status === "paid");
  const totalPending = pendingPayrolls.reduce((sum, p) => sum + parseFloat(p.netSalary || "0"), 0);
  const totalPaid = paidPayrolls.reduce((sum, p) => sum + parseFloat(p.netSalary || "0"), 0);

  const getStatusBadge = (status: string | null) => {
    switch (status) {
      case "paid":
        return <Badge className="bg-green-500 text-white" data-testid="badge-status-paid">Pagado</Badge>;
      case "pending":
        return <Badge variant="outline" className="border-yellow-500 text-yellow-600" data-testid="badge-status-pending">Pendiente</Badge>;
      case "cancelled":
        return <Badge variant="destructive" data-testid="badge-status-cancelled">Cancelado</Badge>;
      default:
        return <Badge variant="secondary" data-testid="badge-status-unknown">{status}</Badge>;
    }
  };

  const getPayrollTypeBadge = (type: string | null) => {
    switch (type) {
      case "salary":
        return <Badge variant="secondary" data-testid="badge-type-salary">Mensual</Badge>;
      case "bonus":
        return <Badge variant="outline" data-testid="badge-type-bonus">Aguinaldo</Badge>;
      case "vacation":
        return <Badge variant="outline" data-testid="badge-type-vacation">Vacaciones</Badge>;
      default:
        return <Badge variant="secondary" data-testid="badge-type-other">{type}</Badge>;
    }
  };

  const watchBaseSalary = form.watch("baseSalary") || 0;
  const watchOvertime = form.watch("overtime") || 0;
  const watchBonuses = form.watch("bonuses") || 0;
  const watchDeductions = form.watch("deductions") || 0;
  const calculatedNetSalary = watchBaseSalary + watchOvertime + watchBonuses - watchDeductions;

  const columns: Column<PayrollWithEmployee>[] = [
    {
      key: "employee",
      header: "Empleado",
      cell: (payroll: PayrollWithEmployee) => {
        const employee = employeesMap.get(payroll.employeeId);
        return (
          <span data-testid={`text-employee-${payroll.id}`}>
            {employee ? `${employee.firstName} ${employee.lastName}` : `Empleado #${payroll.employeeId}`}
          </span>
        );
      },
    },
    {
      key: "period",
      header: "Periodo",
      cell: (payroll: PayrollWithEmployee) => (
        <span data-testid={`text-period-${payroll.id}`} className="font-mono">
          {payroll.period}
        </span>
      ),
    },
    {
      key: "payrollType",
      header: "Tipo",
      cell: (payroll: PayrollWithEmployee) => getPayrollTypeBadge(payroll.payrollType),
    },
    {
      key: "baseSalary",
      header: "Salario Base",
      cell: (payroll: PayrollWithEmployee) => (
        <span data-testid={`text-basesalary-${payroll.id}`} className="font-mono">
          {formatCurrency(parseFloat(payroll.baseSalary || "0"))}
        </span>
      ),
    },
    {
      key: "netSalary",
      header: "Neto",
      cell: (payroll: PayrollWithEmployee) => (
        <span data-testid={`text-netsalary-${payroll.id}`} className="font-mono font-semibold">
          {formatCurrency(parseFloat(payroll.netSalary || "0"))}
        </span>
      ),
    },
    {
      key: "status",
      header: "Estado",
      cell: (payroll: PayrollWithEmployee) => getStatusBadge(payroll.status),
    },
    {
      key: "actions",
      header: "Acciones",
      cell: (payroll: PayrollWithEmployee) => (
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => openEdit(payroll)}
            data-testid={`button-edit-${payroll.id}`}
          >
            <Edit className="w-4 h-4" />
          </Button>
          {payroll.status === "pending" && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => markPaidMutation.mutate(payroll)}
              disabled={markPaidMutation.isPending}
              data-testid={`button-markpaid-${payroll.id}`}
            >
              <CheckCircle className="w-4 h-4 text-green-600" />
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Liquidaciones"
        description="Gestion de sueldos y pagos de empleados"
        actions={
          <Button onClick={openCreate} data-testid="button-create-payroll">
            <Plus className="w-4 h-4 mr-2" />
            Nueva Liquidacion
          </Button>
        }
      />

      {hasError && (
        <Alert variant="destructive">
          <AlertCircle className="w-4 h-4" />
          <AlertDescription>
            Error al cargar los datos. Por favor, intente nuevamente.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Liquidaciones</CardTitle>
            <Users className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="stat-total-payrolls">
              {payrolls.length}
            </div>
            <p className="text-xs text-muted-foreground">en {periodFilter}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pendientes</CardTitle>
            <Clock className="w-4 h-4 text-yellow-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600" data-testid="stat-pending-count">
              {pendingPayrolls.length}
            </div>
            <p className="text-xs text-muted-foreground font-mono">
              {formatCurrency(totalPending)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pagados</CardTitle>
            <CheckCircle className="w-4 h-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600" data-testid="stat-paid-count">
              {paidPayrolls.length}
            </div>
            <p className="text-xs text-muted-foreground font-mono">
              {formatCurrency(totalPaid)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Neto</CardTitle>
            <DollarSign className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono" data-testid="stat-total-net">
              {formatCurrency(totalPending + totalPaid)}
            </div>
            <p className="text-xs text-muted-foreground">sueldos del periodo</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-2">
        <label className="text-sm font-medium">Periodo:</label>
        <Input
          type="month"
          value={periodFilter}
          onChange={(e) => setPeriodFilter(e.target.value)}
          className="w-auto"
          data-testid="input-period-filter"
        />
      </div>

      <DataTable
        data={payrolls}
        columns={columns}
        isLoading={isLoading}
        emptyMessage="No hay liquidaciones para este periodo"
      />

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editingPayroll ? "Editar Liquidacion" : "Nueva Liquidacion"}
            </DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="employeeId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Empleado</FormLabel>
                      <Select
                        value={field.value?.toString() || ""}
                        onValueChange={(val) => {
                          field.onChange(parseInt(val));
                          const emp = employees.find(e => e.id === parseInt(val));
                          if (emp && !editingPayroll) {
                            form.setValue("baseSalary", parseFloat(emp.baseSalary || "0"));
                          }
                        }}
                      >
                        <FormControl>
                          <SelectTrigger data-testid="select-employee">
                            <SelectValue placeholder="Seleccionar empleado" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {employees.filter(e => e.status === "active").map((employee) => (
                            <SelectItem key={employee.id} value={employee.id.toString()}>
                              {employee.firstName} {employee.lastName}
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
                  name="period"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Periodo</FormLabel>
                      <FormControl>
                        <Input 
                          type="month" 
                          {...field} 
                          readOnly={!!editingPayroll}
                          className={editingPayroll ? "bg-muted cursor-not-allowed" : ""}
                          data-testid="input-period" 
                        />
                      </FormControl>
                      {editingPayroll && (
                        <p className="text-xs text-muted-foreground">El periodo no se puede modificar</p>
                      )}
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="payrollType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Tipo</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger data-testid="select-payroll-type">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="salary">Sueldo Mensual</SelectItem>
                          <SelectItem value="bonus">Aguinaldo</SelectItem>
                          <SelectItem value="vacation">Vacaciones</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="status"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Estado</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger data-testid="select-status">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="pending">Pendiente</SelectItem>
                          <SelectItem value="paid">Pagado</SelectItem>
                          <SelectItem value="cancelled">Cancelado</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="baseSalary"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Salario Base</FormLabel>
                      <FormControl>
                        <Input type="number" step="0.01" {...field} data-testid="input-base-salary" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="overtime"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Horas Extras</FormLabel>
                      <FormControl>
                        <Input type="number" step="0.01" {...field} data-testid="input-overtime" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="bonuses"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Bonificaciones</FormLabel>
                      <FormControl>
                        <Input type="number" step="0.01" {...field} data-testid="input-bonuses" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="deductions"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Deducciones</FormLabel>
                      <FormControl>
                        <Input type="number" step="0.01" {...field} data-testid="input-deductions" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <Card className="bg-muted/50">
                <CardContent className="pt-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Sueldo Neto Calculado:</span>
                    <span className="text-xl font-bold font-mono" data-testid="text-calculated-net">
                      {formatCurrency(calculatedNetSalary)}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    = Salario Base + Horas Extras + Bonificaciones - Deducciones
                  </p>
                </CardContent>
              </Card>

              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notas</FormLabel>
                    <FormControl>
                      <Textarea {...field} placeholder="Observaciones adicionales..." data-testid="input-notes" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={closeDialog} data-testid="button-cancel">
                  Cancelar
                </Button>
                <Button 
                  type="submit" 
                  disabled={createMutation.isPending || updateMutation.isPending}
                  data-testid="button-submit"
                >
                  {editingPayroll ? "Actualizar" : "Crear"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
