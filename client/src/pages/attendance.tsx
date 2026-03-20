import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatDate } from "@/lib/formatters";
import { 
  Clock, 
  LogIn, 
  LogOut, 
  Calendar, 
  Users, 
  AlertCircle,
  Check,
  X,
  Coffee
} from "lucide-react";
import type { Attendance, Employee, Local } from "@shared/schema";

type AttendanceWithRelations = Attendance & {
  employee?: Employee;
  local?: Local;
};

const statusLabels: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  present: { label: "Presente", variant: "default" },
  absent: { label: "Ausente", variant: "destructive" },
  late: { label: "Tarde", variant: "secondary" },
  half_day: { label: "Medio Dia", variant: "outline" },
  vacation: { label: "Vacaciones", variant: "secondary" },
  sick_leave: { label: "Enfermedad", variant: "destructive" },
};

export default function AttendancePage() {
  const { toast } = useToast();
  const [isClockDialogOpen, setIsClockDialogOpen] = useState(false);
  const [clockAction, setClockAction] = useState<"in" | "out">("in");
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<number | null>(null);
  const [selectedLocalId, setSelectedLocalId] = useState<number | null>(null);
  const [clockNotes, setClockNotes] = useState("");
  const [dateFilter, setDateFilter] = useState<string>(new Date().toISOString().split("T")[0]);

  const today = new Date().toISOString().split("T")[0];

  const { data: attendances = [], isLoading, isError: isAttendanceError } = useQuery<AttendanceWithRelations[]>({
    queryKey: ["/api/attendances", { date: dateFilter }],
    queryFn: async () => {
      const res = await fetch(`/api/attendances?date=${dateFilter}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch attendances");
      return res.json();
    },
  });

  const { data: todayAttendances = [], isError: isTodayAttendanceError } = useQuery<AttendanceWithRelations[]>({
    queryKey: ["/api/attendances", { date: today }],
    queryFn: async () => {
      const res = await fetch(`/api/attendances?date=${today}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch today attendances");
      return res.json();
    },
  });

  const { data: employees = [], isError: isEmployeesError } = useQuery<Employee[]>({
    queryKey: ["/api/employees"],
  });

  const { data: locals = [], isError: isLocalsError } = useQuery<Local[]>({
    queryKey: ["/api/locals"],
  });

  const hasError = isAttendanceError || isEmployeesError || isLocalsError || isTodayAttendanceError;

  const clockInMutation = useMutation({
    mutationFn: async (data: { employeeId: number; localId?: number; notes?: string }) => {
      const res = await apiRequest("POST", "/api/attendances", {
        employeeId: data.employeeId,
        localId: data.localId,
        date: new Date().toISOString().split("T")[0],
        checkIn: new Date().toISOString(),
        status: "present",
        notes: data.notes,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ 
        predicate: (query) => query.queryKey[0] === "/api/attendances" 
      });
      toast({ title: "Entrada registrada correctamente" });
      closeClockDialog();
    },
    onError: (error: Error) => {
      toast({ title: "Error al registrar entrada", description: error.message, variant: "destructive" });
    },
  });

  const clockOutMutation = useMutation({
    mutationFn: async (data: { attendanceId: number; checkInTime: Date; notes?: string }) => {
      const checkOut = new Date();
      const diff = (checkOut.getTime() - data.checkInTime.getTime()) / (1000 * 60 * 60);
      const hoursWorked = diff.toFixed(2);

      const res = await apiRequest("PATCH", `/api/attendances/${data.attendanceId}`, {
        checkOut: checkOut.toISOString(),
        hoursWorked,
        notes: data.notes,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ 
        predicate: (query) => query.queryKey[0] === "/api/attendances" 
      });
      toast({ title: "Salida registrada correctamente" });
      closeClockDialog();
    },
    onError: (error: Error) => {
      toast({ title: "Error al registrar salida", description: error.message, variant: "destructive" });
    },
  });

  const closeClockDialog = () => {
    setIsClockDialogOpen(false);
    setSelectedEmployeeId(null);
    setSelectedLocalId(null);
    setClockNotes("");
  };

  const openClockDialog = (action: "in" | "out") => {
    setClockAction(action);
    setIsClockDialogOpen(true);
  };

  const handleClockAction = () => {
    if (clockAction === "in") {
      if (!selectedEmployeeId) {
        toast({ title: "Seleccione un empleado", variant: "destructive" });
        return;
      }
      clockInMutation.mutate({
        employeeId: selectedEmployeeId,
        localId: selectedLocalId || undefined,
        notes: clockNotes || undefined,
      });
    } else {
      const openAttendance = todayAttendances.find(
        a => a.employeeId === selectedEmployeeId && !a.checkOut
      );
      if (!openAttendance || !openAttendance.checkIn) {
        toast({ title: "No hay entrada registrada para hoy", variant: "destructive" });
        return;
      }
      clockOutMutation.mutate({
        attendanceId: openAttendance.id,
        checkInTime: new Date(openAttendance.checkIn),
        notes: clockNotes || undefined,
      });
    }
  };

  const getEmployeeName = (employeeId: number) => {
    const employee = employees.find(e => e.id === employeeId);
    return employee ? `${employee.firstName} ${employee.lastName}` : "-";
  };

  const getLocalName = (localId: number | null) => {
    if (!localId) return "-";
    const local = locals.find(l => l.id === localId);
    return local?.name || "-";
  };

  const formatTime = (dateStr: Date | string | null) => {
    if (!dateStr) return "-";
    try {
      const date = new Date(dateStr);
      return date.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
    } catch {
      return "-";
    }
  };

  const todayStats = {
    total: todayAttendances.length,
    present: todayAttendances.filter(a => a.status === "present").length,
    absent: todayAttendances.filter(a => a.status === "absent").length,
    late: todayAttendances.filter(a => a.status === "late").length,
  };

  const employeesWithoutCheckIn = employees.filter(
    e => e.status === "active" && !todayAttendances.find(a => a.employeeId === e.id)
  );

  const employeesWithOpenCheckIn = todayAttendances.filter(a => a.checkIn && !a.checkOut);

  const columns: Column<AttendanceWithRelations>[] = [
    {
      key: "employee",
      header: "Empleado",
      cell: (row) => getEmployeeName(row.employeeId),
    },
    {
      key: "date",
      header: "Fecha",
      cell: (row) => formatDate(row.date),
    },
    {
      key: "local",
      header: "Local",
      cell: (row) => getLocalName(row.localId),
    },
    {
      key: "checkIn",
      header: "Entrada",
      cell: (row) => formatTime(row.checkIn),
    },
    {
      key: "checkOut",
      header: "Salida",
      cell: (row) => formatTime(row.checkOut),
    },
    {
      key: "hoursWorked",
      header: "Horas",
      cell: (row) => row.hoursWorked ? `${row.hoursWorked} hs` : "-",
    },
    {
      key: "status",
      header: "Estado",
      cell: (row) => {
        const status = statusLabels[row.status || "present"];
        return (
          <Badge variant={status.variant} data-testid={`badge-status-${row.id}`}>
            {status.label}
          </Badge>
        );
      },
    },
  ];

  if (hasError) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Control de Asistencia"
          description="Registro de entrada y salida de empleados"
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
        title="Control de Asistencia"
        description="Registro de entrada y salida de empleados"
        actions={
          <div className="flex gap-2">
            <Button 
              onClick={() => openClockDialog("in")}
              disabled={employeesWithoutCheckIn.length === 0}
              data-testid="button-clock-in"
            >
              <LogIn className="h-4 w-4 mr-2" />
              Registrar Entrada
            </Button>
            <Button 
              variant="outline"
              onClick={() => openClockDialog("out")}
              disabled={employeesWithOpenCheckIn.length === 0}
              data-testid="button-clock-out"
            >
              <LogOut className="h-4 w-4 mr-2" />
              Registrar Salida
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              Registros Hoy
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-today-total">{todayStats.total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Check className="h-4 w-4 text-green-500" />
              Presentes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600" data-testid="text-present-count">{todayStats.present}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <X className="h-4 w-4 text-red-500" />
              Ausentes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600" data-testid="text-absent-count">{todayStats.absent}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Coffee className="h-4 w-4 text-yellow-500" />
              Tardanzas
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600" data-testid="text-late-count">{todayStats.late}</div>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          <Label htmlFor="date-filter">Filtrar por fecha:</Label>
        </div>
        <Input
          id="date-filter"
          type="date"
          value={dateFilter}
          onChange={(e) => setDateFilter(e.target.value)}
          className="w-auto"
          data-testid="input-date-filter"
        />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setDateFilter(new Date().toISOString().split("T")[0])}
          data-testid="button-today"
        >
          Hoy
        </Button>
      </div>

      <DataTable
        data={attendances}
        columns={columns}
        isLoading={isLoading}
        emptyMessage="No hay registros de asistencia para esta fecha"
      />

      <Dialog open={isClockDialogOpen} onOpenChange={setIsClockDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {clockAction === "in" ? (
                <span className="flex items-center gap-2">
                  <LogIn className="h-5 w-5" />
                  Registrar Entrada
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <LogOut className="h-5 w-5" />
                  Registrar Salida
                </span>
              )}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="employee">Empleado</Label>
              <Select
                value={selectedEmployeeId?.toString() || ""}
                onValueChange={(value) => setSelectedEmployeeId(parseInt(value))}
              >
                <SelectTrigger data-testid="select-employee">
                  <SelectValue placeholder="Seleccionar empleado" />
                </SelectTrigger>
                <SelectContent>
                  {clockAction === "in" 
                    ? employeesWithoutCheckIn.map((employee) => (
                        <SelectItem key={employee.id} value={employee.id.toString()}>
                          {employee.firstName} {employee.lastName}
                        </SelectItem>
                      ))
                    : employeesWithOpenCheckIn.map((attendance) => {
                        const employee = employees.find(e => e.id === attendance.employeeId);
                        return employee ? (
                          <SelectItem key={attendance.employeeId} value={attendance.employeeId.toString()}>
                            {employee.firstName} {employee.lastName}
                          </SelectItem>
                        ) : null;
                      })
                  }
                </SelectContent>
              </Select>
            </div>

            {clockAction === "in" && (
              <div className="space-y-2">
                <Label htmlFor="local">Local (Opcional)</Label>
                <Select
                  value={selectedLocalId?.toString() || ""}
                  onValueChange={(value) => setSelectedLocalId(value ? parseInt(value) : null)}
                >
                  <SelectTrigger data-testid="select-local">
                    <SelectValue placeholder="Seleccionar local" />
                  </SelectTrigger>
                  <SelectContent>
                    {locals.map((local) => (
                      <SelectItem key={local.id} value={local.id.toString()}>
                        {local.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="notes">Notas (Opcional)</Label>
              <Textarea
                id="notes"
                value={clockNotes}
                onChange={(e) => setClockNotes(e.target.value)}
                placeholder="Agregar notas..."
                data-testid="input-notes"
              />
            </div>

            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="h-4 w-4" />
              Hora actual: {new Date().toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={closeClockDialog} data-testid="button-cancel">
              Cancelar
            </Button>
            <Button 
              onClick={handleClockAction}
              disabled={clockInMutation.isPending || clockOutMutation.isPending}
              data-testid="button-confirm"
            >
              {clockAction === "in" ? "Registrar Entrada" : "Registrar Salida"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
