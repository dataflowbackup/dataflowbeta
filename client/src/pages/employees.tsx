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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatCurrency, formatDate } from "@/lib/formatters";
import { Edit, Trash2, UserPlus, AlertCircle } from "lucide-react";
import type { Employee, Local } from "@shared/schema";

const formSchema = z.object({
  firstName: z.string().min(1, "El nombre es requerido"),
  lastName: z.string().min(1, "El apellido es requerido"),
  documentType: z.string().default("DNI"),
  documentNumber: z.string().optional(),
  email: z.string().email("Email invalido").optional().or(z.literal("")),
  phone: z.string().optional(),
  address: z.string().optional(),
  localId: z.coerce.number().optional(),
  position: z.string().optional(),
  department: z.string().optional(),
  hireDate: z.string().optional(),
  baseSalary: z.coerce.number().min(0).default(0),
  status: z.string().default("active"),
});

type FormData = z.infer<typeof formSchema>;

export default function EmployeesPage() {
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [deleteEmployee, setDeleteEmployee] = useState<Employee | null>(null);

  const { data: employees = [], isLoading, isError: isEmployeesError } = useQuery<Employee[]>({
    queryKey: ["/api/employees"],
  });

  const { data: locals = [], isError: isLocalsError } = useQuery<Local[]>({
    queryKey: ["/api/locals"],
  });

  const hasError = isEmployeesError || isLocalsError;

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      documentType: "DNI",
      documentNumber: "",
      email: "",
      phone: "",
      address: "",
      position: "",
      department: "",
      hireDate: "",
      baseSalary: 0,
      status: "active",
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: FormData) => {
      const res = await apiRequest("POST", "/api/employees", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/employees"] });
      toast({ title: "Empleado creado correctamente" });
      closeDialog();
    },
    onError: (error: Error) => {
      toast({ title: "Error al crear empleado", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: FormData }) => {
      const res = await apiRequest("PATCH", `/api/employees/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/employees"] });
      toast({ title: "Empleado actualizado correctamente" });
      closeDialog();
    },
    onError: (error: Error) => {
      toast({ title: "Error al actualizar empleado", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/employees/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/employees"] });
      toast({ title: "Empleado eliminado correctamente" });
      setDeleteEmployee(null);
    },
    onError: (error: Error) => {
      toast({ title: "Error al eliminar empleado", description: error.message, variant: "destructive" });
    },
  });

  const openCreate = () => {
    setEditingEmployee(null);
    form.reset({
      firstName: "",
      lastName: "",
      documentType: "DNI",
      documentNumber: "",
      email: "",
      phone: "",
      address: "",
      position: "",
      department: "",
      hireDate: "",
      baseSalary: 0,
      status: "active",
    });
    setIsDialogOpen(true);
  };

  const openEdit = (employee: Employee) => {
    setEditingEmployee(employee);
    form.reset({
      firstName: employee.firstName,
      lastName: employee.lastName,
      documentType: employee.documentType || "DNI",
      documentNumber: employee.documentNumber || "",
      email: employee.email || "",
      phone: employee.phone || "",
      address: employee.address || "",
      localId: employee.localId || undefined,
      position: employee.position || "",
      department: employee.department || "",
      hireDate: employee.hireDate || "",
      baseSalary: parseFloat(String(employee.baseSalary) || "0"),
      status: employee.status || "active",
    });
    setIsDialogOpen(true);
  };

  const closeDialog = () => {
    setIsDialogOpen(false);
    setEditingEmployee(null);
    form.reset();
  };

  const onSubmit = (data: FormData) => {
    if (editingEmployee) {
      updateMutation.mutate({ id: editingEmployee.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const getLocalName = (localId: number | null) => {
    if (!localId) return "-";
    const local = locals.find(l => l.id === localId);
    return local?.name || "-";
  };

  const columns: Column<Employee>[] = [
    { 
      key: "firstName", 
      header: "Nombre Completo",
      cell: (row) => `${row.firstName} ${row.lastName}`,
    },
    { key: "documentNumber", header: "Documento", cell: (row) => row.documentNumber ? `${row.documentType} ${row.documentNumber}` : "-" },
    { key: "position", header: "Cargo" },
    { key: "localId", header: "Local", cell: (row) => getLocalName(row.localId) },
    { key: "hireDate", header: "Fecha Ingreso", cell: (row) => row.hireDate ? formatDate(row.hireDate) : "-" },
    { 
      key: "baseSalary", 
      header: "Salario Base",
      cell: (row) => formatCurrency(parseFloat(String(row.baseSalary) || "0")),
    },
    {
      key: "status",
      header: "Estado",
      cell: (row) => (
        <Badge variant={row.status === "active" ? "default" : "secondary"}>
          {row.status === "active" ? "Activo" : row.status === "inactive" ? "Inactivo" : "Desvinculado"}
        </Badge>
      ),
    },
    {
      key: "id",
      header: "Acciones",
      cell: (row) => (
        <div className="flex gap-2">
          <Button variant="ghost" size="icon" onClick={() => openEdit(row)} data-testid={`button-edit-${row.id}`}>
            <Edit className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => setDeleteEmployee(row)} data-testid={`button-delete-${row.id}`}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ];

  const activeEmployees = employees.filter(e => e.status === "active");

  if (hasError) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Gestion de Empleados"
          description="Administracion del personal"
        />
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Error al cargar los datos. Por favor, intente nuevamente.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Gestion de Empleados"
        description={`${activeEmployees.length} empleados activos`}
        actions={
          <Button onClick={openCreate} data-testid="button-new-employee">
            <UserPlus className="h-4 w-4 mr-2" />
            Nuevo Empleado
          </Button>
        }
      />

      <DataTable
        columns={columns}
        data={employees}
        isLoading={isLoading}
        searchPlaceholder="Buscar empleados..."
        emptyMessage="No hay empleados registrados"
      />

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingEmployee ? "Editar Empleado" : "Nuevo Empleado"}
            </DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="firstName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Nombre</FormLabel>
                      <FormControl>
                        <Input {...field} data-testid="input-firstname" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="lastName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Apellido</FormLabel>
                      <FormControl>
                        <Input {...field} data-testid="input-lastname" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="documentType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Tipo Documento</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-doctype">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="DNI">DNI</SelectItem>
                          <SelectItem value="CUIL">CUIL</SelectItem>
                          <SelectItem value="CUIT">CUIT</SelectItem>
                          <SelectItem value="Pasaporte">Pasaporte</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="documentNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Numero Documento</FormLabel>
                      <FormControl>
                        <Input {...field} data-testid="input-docnumber" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl>
                        <Input type="email" {...field} data-testid="input-email" />
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
                        <Input {...field} data-testid="input-phone" />
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
                      <Textarea {...field} data-testid="input-address" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="localId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Local</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value?.toString()}>
                        <FormControl>
                          <SelectTrigger data-testid="select-local">
                            <SelectValue placeholder="Seleccionar local" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {locals.map((local) => (
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
                  name="position"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Cargo</FormLabel>
                      <FormControl>
                        <Input {...field} data-testid="input-position" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="department"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Departamento</FormLabel>
                      <FormControl>
                        <Input {...field} data-testid="input-department" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="hireDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Fecha de Ingreso</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} data-testid="input-hiredate" />
                      </FormControl>
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
                        <Input type="number" step="0.01" {...field} data-testid="input-salary" />
                      </FormControl>
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
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-status">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="active">Activo</SelectItem>
                          <SelectItem value="inactive">Inactivo</SelectItem>
                          <SelectItem value="terminated">Desvinculado</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={closeDialog}>
                  Cancelar
                </Button>
                <Button 
                  type="submit" 
                  disabled={createMutation.isPending || updateMutation.isPending}
                  data-testid="button-submit"
                >
                  {createMutation.isPending || updateMutation.isPending ? "Guardando..." : "Guardar"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteEmployee}
        onOpenChange={(open) => !open && setDeleteEmployee(null)}
        title="Eliminar Empleado"
        description={`¿Esta seguro que desea eliminar a ${deleteEmployee?.firstName} ${deleteEmployee?.lastName}?`}
        onConfirm={() => deleteEmployee && deleteMutation.mutate(deleteEmployee.id)}
        loading={deleteMutation.isPending}
      />
    </div>
  );
}
