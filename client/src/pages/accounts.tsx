import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { PageHeader } from "@/components/page-header";
import { DataTable, Column } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatCurrency, formatCuit, formatDate } from "@/lib/formatters";
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from "recharts";
import { 
  Building2, 
  Eye,
  AlertCircle,
  CheckCircle,
  DollarSign,
  FileText,
  Filter,
  PieChart as PieChartIcon,
  Clock,
  Download,
} from "lucide-react";
import type { Supplier, Local, Rubro, Invoice } from "@shared/schema";

interface SupplierAccount extends Supplier {
  totalDebt: number;
  overdueDebt: number;
  invoiceCount: number;
  overdueCount: number;
  totalPaid: number;
}

interface AccountsResponse {
  accounts: SupplierAccount[];
  stats: {
    totalDebt: number;
    totalOverdue: number;
    totalInvoices: number;
    totalOverdueCount: number;
  };
}

const CHART_COLORS = [
  "#ef4444", "#f97316", "#f59e0b", "#eab308", "#84cc16",
  "#22c55e", "#14b8a6", "#06b6d4", "#0ea5e9", "#3b82f6",
  "#6366f1", "#8b5cf6", "#a855f7", "#d946ef", "#ec4899",
];

interface InvoiceWithSupplier extends Invoice {
  supplier?: Supplier | null;
  local?: Local | null;
}

type AccountTab = "suppliers" | "overdue";

export default function AccountsPage() {
  const [activeTab, setActiveTab] = useState<AccountTab>("suppliers");
  const [filterLocalId, setFilterLocalId] = useState<string>("all");
  const [filterRubroId, setFilterRubroId] = useState<string>("all");

  const queryParams = new URLSearchParams();
  if (filterLocalId !== "all") queryParams.set("localId", filterLocalId);
  if (filterRubroId !== "all") queryParams.set("rubroId", filterRubroId);
  const queryString = queryParams.toString();

  const { data, isLoading } = useQuery<AccountsResponse>({
    queryKey: ["/api/supplier-accounts", queryString],
    queryFn: async () => {
      const url = queryString ? `/api/supplier-accounts?${queryString}` : "/api/supplier-accounts";
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Error loading accounts");
      return res.json();
    },
  });

  const { data: locals = [] } = useQuery<Local[]>({
    queryKey: ["/api/locals"],
  });

  const { data: rubros = [] } = useQuery<Rubro[]>({
    queryKey: ["/api/rubros"],
  });

  const { data: invoices = [] } = useQuery<InvoiceWithSupplier[]>({
    queryKey: ["/api/invoices"],
  });

  const accounts = data?.accounts || [];
  const stats = data?.stats || { totalDebt: 0, totalOverdue: 0, totalInvoices: 0, totalOverdueCount: 0 };
  const suppliersWithDebt = accounts.filter(a => a.totalDebt > 0).length;

  const overdueInvoices = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const supplierMap = new Map(accounts.map(a => [a.id, a]));
    const localMap = new Map(locals.map(l => [l.id, l]));
    return invoices.filter(inv => {
      if (inv.paid) return false;
      const balance = parseFloat(String(inv.balance) || "0");
      if (balance <= 0) return false;
      if (!inv.dueDate) return false;
      const dueDate = new Date(inv.dueDate);
      return dueDate < today;
    }).map(inv => ({
      ...inv,
      supplier: inv.supplierId ? supplierMap.get(inv.supplierId) || null : null,
      local: inv.localId ? localMap.get(inv.localId) || null : null,
    })).sort((a, b) => new Date(a.dueDate!).getTime() - new Date(b.dueDate!).getTime());
  }, [invoices, accounts, locals]);

  const pieChartData = useMemo(() => {
    const withDebt = accounts
      .filter(a => a.totalDebt > 0)
      .sort((a, b) => b.totalDebt - a.totalDebt);
    
    const top15 = withDebt.slice(0, 15).map((account) => ({
      name: account.tradeName || account.businessName || "Sin nombre",
      value: account.totalDebt,
    }));
    
    const rest = withDebt.slice(15);
    if (rest.length > 0) {
      const variosTotal = rest.reduce((sum, a) => sum + a.totalDebt, 0);
      top15.push({ name: "Varios", value: variosTotal });
    }
    
    return top15;
  }, [accounts]);

  const getDaysOverdue = (dueDate: string) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = new Date(dueDate);
    const diff = Math.floor((today.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
    return diff;
  };

  const overdueColumns: Column<InvoiceWithSupplier>[] = [
    {
      key: "invoiceNumber",
      header: "Comprobante",
      cell: (row) => (
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-destructive/10">
            <FileText className="h-4 w-4 text-destructive" />
          </div>
          <div>
            <div className="font-medium">{row.invoiceNumber}</div>
            <div className="text-xs text-muted-foreground">{row.invoiceType}</div>
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
        </div>
      ),
    },
    {
      key: "local",
      header: "Local",
      cell: (row) => row.local?.name || <span className="text-muted-foreground">-</span>,
    },
    {
      key: "dueDate",
      header: "Vencimiento",
      cell: (row) => (
        <div>
          <div className="text-sm">{formatDate(row.dueDate)}</div>
          <div className="text-xs text-destructive font-medium">
            {getDaysOverdue(row.dueDate!)} dias vencida
          </div>
        </div>
      ),
    },
    {
      key: "balance",
      header: "Saldo Pendiente",
      className: "text-right",
      cell: (row) => (
        <span className="font-mono font-medium text-destructive">
          {formatCurrency(row.balance)}
        </span>
      ),
    },
    {
      key: "total",
      header: "Total Factura",
      className: "text-right",
      cell: (row) => (
        <span className="font-mono text-sm text-muted-foreground">
          {formatCurrency(row.total)}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      className: "w-20",
      cell: (row) => (
        <Link href={`/facturas/${row.id}`}>
          <Button variant="ghost" size="icon" data-testid={`button-view-overdue-${row.id}`}>
            <Eye className="h-4 w-4" />
          </Button>
        </Link>
      ),
    },
  ];

  const columns: Column<SupplierAccount>[] = [
    {
      key: "businessName",
      header: "Proveedor",
      cell: (row) => (
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
            <Building2 className="h-4 w-4 text-primary" />
          </div>
          <div>
            <div className="font-medium">{row.tradeName || row.businessName}</div>
            <div className="text-xs text-muted-foreground font-mono">
              {formatCuit(row.cuit)}
            </div>
          </div>
        </div>
      ),
    },
    {
      key: "rubroId",
      header: "Rubro",
      cell: (row) => {
        const rubro = rubros.find(r => r.id === row.rubroId);
        return rubro ? <Badge variant="secondary">{rubro.name}</Badge> : <span className="text-muted-foreground">-</span>;
      },
    },
    {
      key: "invoiceCount",
      header: "Facturas",
      cell: (row) => (
        <Badge variant="secondary">
          {row.invoiceCount || 0}
        </Badge>
      ),
    },
    {
      key: "totalDebt",
      header: "Deuda Total",
      className: "text-right",
      cell: (row) => (
        <span className={`font-mono font-medium ${row.totalDebt > 0 ? "text-destructive" : "text-green-600"}`}>
          {formatCurrency(row.totalDebt)}
        </span>
      ),
    },
    {
      key: "overdueDebt",
      header: "Deuda Vencida",
      className: "text-right",
      cell: (row) => (
        <span className={`font-mono font-medium ${row.overdueDebt > 0 ? "text-destructive" : "text-muted-foreground"}`}>
          {formatCurrency(row.overdueDebt)}
        </span>
      ),
    },
    {
      key: "overdueCount",
      header: "Vencidas",
      cell: (row) => (
        row.overdueCount > 0 ? (
          <Badge variant="destructive" className="gap-1">
            <AlertCircle className="h-3 w-3" />
            {row.overdueCount}
          </Badge>
        ) : (
          <Badge variant="outline" className="gap-1 text-green-600">
            <CheckCircle className="h-3 w-3" />
            0
          </Badge>
        )
      ),
    },
    {
      key: "totalPaid",
      header: "Total Pagado",
      className: "text-right",
      cell: (row) => (
        <span className="font-mono text-sm text-green-600">
          {formatCurrency(row.totalPaid)}
        </span>
      ),
    },
    {
      key: "paymentDays",
      header: "Plazo",
      cell: (row) => (
        <span className="text-sm">
          {row.paymentDays || 0} dias
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      className: "w-20",
      cell: (row) => (
        <Link href={`/cuentas-corrientes/${row.id}`}>
          <Button variant="ghost" size="icon" data-testid={`button-view-${row.id}`}>
            <Eye className="h-4 w-4" />
          </Button>
        </Link>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cuentas Corrientes"
        description="Estado de cuenta con cada proveedor"
        actions={
          <Button
            variant="outline"
            onClick={() => {
              const params = new URLSearchParams();
              if (filterLocalId !== "all") params.set("localId", filterLocalId);
              if (filterRubroId !== "all") params.set("rubroId", filterRubroId);
              const qs = params.toString();
              window.open(`/api/supplier-accounts/export${qs ? `?${qs}` : ""}`, "_blank");
            }}
            data-testid="button-export-accounts"
          >
            <Download className="h-4 w-4 mr-2" />
            Exportar
          </Button>
        }
      />

      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Filtros:</span>
        </div>
        <Select value={filterLocalId} onValueChange={setFilterLocalId}>
          <SelectTrigger className="w-[200px]" data-testid="select-filter-local">
            <SelectValue placeholder="Todos los locales" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los locales</SelectItem>
            {locals.filter(l => l.active).map((local) => (
              <SelectItem key={local.id} value={local.id.toString()}>
                {local.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterRubroId} onValueChange={setFilterRubroId}>
          <SelectTrigger className="w-[200px]" data-testid="select-filter-rubro">
            <SelectValue placeholder="Todos los rubros" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los rubros</SelectItem>
            {rubros.filter(r => r.active).map((rubro) => (
              <SelectItem key={rubro.id} value={rubro.id.toString()}>
                {rubro.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">Deuda Total</CardTitle>
            <DollarSign className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-destructive" data-testid="stat-total-debt">
              {formatCurrency(stats.totalDebt)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">Deuda Vencida</CardTitle>
            <AlertCircle className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-destructive" data-testid="stat-total-overdue">
              {formatCurrency(stats.totalOverdue)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">Total Facturas</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono" data-testid="stat-total-invoices">
              {stats.totalInvoices}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">Facturas Vencidas</CardTitle>
            <AlertCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono" data-testid="stat-overdue-count">
              {stats.totalOverdueCount}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">Proveedores con Deuda</CardTitle>
            <Building2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono" data-testid="stat-suppliers-debt">
              {suppliersWithDebt}
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as AccountTab)}>
        <TabsList data-testid="tabs-accounts">
          <TabsTrigger value="suppliers" data-testid="tab-suppliers" className="gap-2">
            <Building2 className="h-4 w-4" />
            Proveedores ({accounts.length})
          </TabsTrigger>
          <TabsTrigger value="overdue" data-testid="tab-overdue" className="gap-2 text-destructive">
            <AlertCircle className="h-4 w-4" />
            Vencidas ({overdueInvoices.length})
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {activeTab === "suppliers" && (
        <>
          {pieChartData.length > 0 && (
            <Card data-testid="card-debt-chart">
              <CardHeader className="flex flex-row items-center justify-between gap-2">
                <CardTitle className="text-base">
                  Distribucion de Deuda por Proveedor
                  {filterLocalId !== "all" && (
                    <span className="text-sm font-normal text-muted-foreground ml-2">
                      (Local: {locals.find(l => l.id.toString() === filterLocalId)?.name})
                    </span>
                  )}
                </CardTitle>
                <PieChartIcon className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="h-[350px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieChartData}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        outerRadius={120}
                        fill="#8884d8"
                        dataKey="value"
                        label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                      >
                        {pieChartData.map((_, index) => (
                          <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip 
                        formatter={(value: number) => [formatCurrency(value), "Deuda"]}
                      />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}

          <DataTable
            columns={columns}
            data={accounts}
            isLoading={isLoading}
            searchPlaceholder="Buscar por proveedor, razon social o CUIT..."
            searchKeys={["businessName", "tradeName", "cuit"]}
            emptyMessage="No hay cuentas corrientes. Las cuentas se generan automaticamente al cargar facturas."
            pageSize={15}
          />
        </>
      )}

      {activeTab === "overdue" && (
        <>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <CardTitle className="text-base text-destructive">
                Facturas Vencidas
              </CardTitle>
              <Badge variant="destructive">
                {overdueInvoices.length} factura{overdueInvoices.length !== 1 ? "s" : ""}
              </Badge>
            </CardHeader>
            <CardContent>
              <div className="text-sm text-muted-foreground">
                Total deuda vencida: <span className="font-mono font-medium text-destructive">{formatCurrency(stats.totalOverdue)}</span>
              </div>
            </CardContent>
          </Card>

          <DataTable
            columns={overdueColumns}
            data={overdueInvoices}
            isLoading={isLoading}
            searchPlaceholder="Buscar por numero de factura o proveedor..."
            searchKeys={["invoiceNumber"]}
            emptyMessage="No hay facturas vencidas. Todas las cuentas estan al dia."
            pageSize={15}
          />
        </>
      )}
    </div>
  );
}
