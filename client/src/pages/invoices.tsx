import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, Link } from "wouter";
import { PageHeader } from "@/components/page-header";
import { DataTable, Column } from "@/components/data-table";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatCurrency, formatDate, formatCuit } from "@/lib/formatters";
import { 
  FileText, 
  Plus, 
  Eye,
  Trash2,
  AlertCircle,
  CheckCircle,
  Clock,
  DollarSign,
} from "lucide-react";
import type { Invoice, Supplier, Local } from "@shared/schema";

interface InvoiceWithRelations extends Invoice {
  supplier?: Supplier | null;
  local?: Local | null;
}

const invoiceTypes: Record<string, string> = {
  "A": "Factura A",
  "B": "Factura B",
  "C": "Factura C",
  "E": "Factura E",
  "M": "Factura M",
  "NC-A": "Nota de Credito A",
  "NC-B": "Nota de Credito B",
  "NC-C": "Nota de Credito C",
  "ND-A": "Nota de Debito A",
  "ND-B": "Nota de Debito B",
  "ND-C": "Nota de Debito C",
  "REM": "Remito",
};

type FilterStatus = "all" | "pending" | "overdue" | "paid";

export default function InvoicesPage() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [deleteInvoice, setDeleteInvoice] = useState<InvoiceWithRelations | null>(null);
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");

  const { data: suppliers = [] } = useQuery<Supplier[]>({
    queryKey: ["/api/suppliers"],
  });

  const { data: locals = [] } = useQuery<Local[]>({
    queryKey: ["/api/locals"],
  });

  const [selectedLocalId, setSelectedLocalId] = useState<string>("all");
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>("all");
  const [selectedExpenseType, setSelectedExpenseType] = useState<string>("all");
  const [selectedActiveState, setSelectedActiveState] = useState<string>("active");

  const { data: invoices = [], isLoading } = useQuery<InvoiceWithRelations[]>({
    queryKey: ["/api/invoices"],
  });

  const { data: stats } = useQuery<{
    total: number;
    pending: number;
    overdue: number;
    thisMonth: number;
  }>({
    queryKey: ["/api/invoices/stats"],
  });

  const getInvoiceStatus = (invoice: InvoiceWithRelations): FilterStatus => {
    const balance = parseFloat(String(invoice.balance) || "0");
    if (invoice.paid || balance <= 0) return "paid";
    
    const dueDate = invoice.dueDate ? new Date(invoice.dueDate) : null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    if (dueDate && dueDate < today) return "overdue";
    return "pending";
  };

  const filteredInvoices = useMemo(() => {
    return invoices.filter(inv => {
      const statusMatch =
        filterStatus === "all" ? true : getInvoiceStatus(inv) === filterStatus;

      const localMatch =
        selectedLocalId === "all"
          ? true
          : inv.localId === parseInt(selectedLocalId);

      const supplierMatch =
        selectedSupplierId === "all"
          ? true
          : inv.supplierId === parseInt(selectedSupplierId);

      const expenseMatch =
        selectedExpenseType === "all"
          ? true
          : inv.expenseType === selectedExpenseType;

      const activeMatch =
        selectedActiveState === "all"
          ? true
          : selectedActiveState === "active"
          ? inv.status === "active"
          : inv.status !== "active";

      return statusMatch && localMatch && supplierMatch && expenseMatch && activeMatch;
    });
  }, [invoices, filterStatus, selectedLocalId, selectedSupplierId, selectedExpenseType, selectedActiveState]);

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/invoices/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices/stats"] });
      toast({ title: "Factura eliminada correctamente" });
      setDeleteInvoice(null);
    },
    onError: (error: Error) => {
      toast({ title: "Error al eliminar factura", description: error.message, variant: "destructive" });
    },
  });

  const getStatusBadge = (invoice: InvoiceWithRelations) => {
    if (invoice.paid) {
      return (
        <Badge variant="default" className="gap-1">
          <CheckCircle className="h-3 w-3" />
          Pagada
        </Badge>
      );
    }
    
    const balance = parseFloat(String(invoice.balance) || "0");
    if (balance <= 0) {
      return (
        <Badge variant="default" className="gap-1">
          <CheckCircle className="h-3 w-3" />
          Pagada
        </Badge>
      );
    }

    const dueDate = invoice.dueDate ? new Date(invoice.dueDate) : null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (dueDate && dueDate < today) {
      return (
        <Badge variant="destructive" className="gap-1">
          <AlertCircle className="h-3 w-3" />
          Vencida
        </Badge>
      );
    }

    return (
      <Badge variant="secondary" className="gap-1">
        <Clock className="h-3 w-3" />
        Pendiente
      </Badge>
    );
  };

  const columns: Column<InvoiceWithRelations>[] = [
    {
      key: "invoiceNumber",
      header: "Comprobante",
      cell: (row) => (
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
            <FileText className="h-4 w-4 text-primary" />
          </div>
          <div>
            <div className="font-medium">{row.invoiceNumber}</div>
            <div className="text-xs text-muted-foreground">
              {invoiceTypes[row.invoiceType] || row.invoiceType}
            </div>
          </div>
        </div>
      ),
    },
    {
      key: "supplier",
      header: "Proveedor",
      cell: (row) => (
        <div>
          <div className="font-medium">{row.supplier?.businessName || "-"}</div>
          <div className="text-xs text-muted-foreground font-mono">
            {row.supplier?.cuit ? formatCuit(row.supplier.cuit) : "-"}
          </div>
        </div>
      ),
    },
    {
      key: "local",
      header: "Local",
      cell: (row) => row.local?.name || <span className="text-muted-foreground">-</span>,
    },
    {
      key: "invoiceDate",
      header: "Fecha",
      cell: (row) => (
        <div>
          <div>{formatDate(row.invoiceDate)}</div>
          {row.dueDate && (
            <div className="text-xs text-muted-foreground">
              Vence: {formatDate(row.dueDate)}
            </div>
          )}
        </div>
      ),
    },
    {
      key: "total",
      header: "Total",
      className: "text-right",
      cell: (row) => (
        <div className="text-right">
          <div className="font-mono font-medium">{formatCurrency(row.total)}</div>
          {parseFloat(String(row.balance) || "0") > 0 && (
            <div className="text-xs text-destructive font-mono">
              Saldo: {formatCurrency(row.balance)}
            </div>
          )}
        </div>
      ),
    },
    {
      key: "expenseType",
      header: "Tipo Gasto",
      cell: (row) => (
        <Badge variant={row.expenseType === "cmv" ? "default" : "secondary"}>
          {row.expenseType === "cmv" ? "CMV" : "Admin"}
        </Badge>
      ),
    },
    {
      key: "status",
      header: "Estado",
      cell: (row) => getStatusBadge(row),
    },
    {
      key: "actions",
      header: "",
      className: "w-24",
      cell: (row) => (
        <div className="flex items-center gap-1">
          <Link href={`/facturas/${row.id}`}>
            <Button variant="ghost" size="icon" data-testid={`button-view-${row.id}`}>
              <Eye className="h-4 w-4" />
            </Button>
          </Link>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setDeleteInvoice(row)}
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
        title="Facturas"
        description="Gestiona las facturas de proveedores"
        actions={
          <Button onClick={() => navigate("/facturas/nueva")} data-testid="button-new-invoice">
            <Plus className="h-4 w-4 mr-2" />
            Nueva Factura
          </Button>
        }
      />

      <div className="flex flex-wrap gap-3 items-center">
        <div className="w-40">
          <label className="block text-xs text-muted-foreground mb-1">Local</label>
          <select
            className="w-full h-9 rounded-md border bg-background px-2 text-sm"
            value={selectedLocalId}
            onChange={(e) => setSelectedLocalId(e.target.value)}
          >
            <option value="all">Todos</option>
            {locals.map((l) => (
              <option key={l.id} value={l.id.toString()}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
        <div className="w-56">
          <label className="block text-xs text-muted-foreground mb-1">Proveedor</label>
          <select
            className="w-full h-9 rounded-md border bg-background px-2 text-sm"
            value={selectedSupplierId}
            onChange={(e) => setSelectedSupplierId(e.target.value)}
          >
            <option value="all">Todos</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id.toString()}>
                {s.businessName}
              </option>
            ))}
          </select>
        </div>
        <div className="w-40">
          <label className="block text-xs text-muted-foreground mb-1">Estado</label>
          <select
            className="w-full h-9 rounded-md border bg-background px-2 text-sm"
            value={selectedActiveState}
            onChange={(e) => setSelectedActiveState(e.target.value)}
          >
            <option value="active">Activas</option>
            <option value="inactive">Anuladas</option>
            <option value="all">Todas</option>
          </select>
        </div>
        <div className="w-40">
          <label className="block text-xs text-muted-foreground mb-1">Tipo de Gasto</label>
          <select
            className="w-full h-9 rounded-md border bg-background px-2 text-sm"
            value={selectedExpenseType}
            onChange={(e) => setSelectedExpenseType(e.target.value)}
          >
            <option value="all">Todos</option>
            <option value="cmv">CMV</option>
            <option value="admin">Adm</option>
          </select>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">Total Facturas</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono" data-testid="stat-total">
              {stats?.total || 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">Pendientes</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono" data-testid="stat-pending">
              {stats?.pending || 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">Vencidas</CardTitle>
            <AlertCircle className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-destructive" data-testid="stat-overdue">
              {stats?.overdue || 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">Este Mes</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono" data-testid="stat-this-month">
              {formatCurrency(stats?.thisMonth || 0)}
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs value={filterStatus} onValueChange={(v) => setFilterStatus(v as FilterStatus)}>
        <TabsList data-testid="tabs-invoice-filter">
          <TabsTrigger value="all" data-testid="tab-all">
            Todas ({invoices.length})
          </TabsTrigger>
          <TabsTrigger value="pending" data-testid="tab-pending">
            Pendientes ({invoices.filter(i => getInvoiceStatus(i) === "pending").length})
          </TabsTrigger>
          <TabsTrigger value="overdue" data-testid="tab-overdue" className="text-destructive">
            Vencidas ({invoices.filter(i => getInvoiceStatus(i) === "overdue").length})
          </TabsTrigger>
          <TabsTrigger value="paid" data-testid="tab-paid">
            Pagadas ({invoices.filter(i => getInvoiceStatus(i) === "paid").length})
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <DataTable
        columns={columns}
        data={filteredInvoices}
        isLoading={isLoading}
        searchPlaceholder="Buscar por numero o proveedor..."
        searchKeys={["invoiceNumber"]}
        emptyMessage={
          filterStatus === "all" 
            ? "No hay facturas registradas. Comienza cargando tu primera factura."
            : `No hay facturas ${filterStatus === "overdue" ? "vencidas" : filterStatus === "pending" ? "pendientes" : "pagadas"}.`
        }
        pageSize={15}
      />

      <ConfirmDialog
        open={!!deleteInvoice}
        onOpenChange={(open) => !open && setDeleteInvoice(null)}
        title="Eliminar Factura"
        description={`¿Esta seguro que desea eliminar la factura "${deleteInvoice?.invoiceNumber}"? Esta accion no se puede deshacer y afectara los saldos de cuenta corriente.`}
        confirmLabel="Eliminar"
        onConfirm={() => deleteInvoice && deleteMutation.mutate(deleteInvoice.id)}
        variant="destructive"
        isLoading={deleteMutation.isPending}
      />
    </div>
  );
}
