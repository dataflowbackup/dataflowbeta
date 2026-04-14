import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { useAuth } from "@/hooks/useAuth";
import { AppSidebar } from "@/components/app-sidebar";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import NotFound from "@/pages/not-found";
import Landing from "@/pages/landing";
import Home from "@/pages/home";
import SuppliersPage from "@/pages/suppliers";
import LocalsPage from "@/pages/locals";
import RubrosPage from "@/pages/rubros";
import SubRubrosPage from "@/pages/sub-rubros";
import TaxesPage from "@/pages/taxes";
import UnitsPage from "@/pages/units";
import SuppliesPage from "@/pages/supplies";
import InvoicesPage from "@/pages/invoices";
import InvoiceFormPage from "@/pages/invoice-form";
import AccountsPage from "@/pages/accounts";
import PaymentsPage from "@/pages/payments";
import RecipeCategoriesPage from "@/pages/recipe-categories";
import RecipesPage from "@/pages/recipes";
import RecipeFormPage from "@/pages/recipe-form";
import SubRecipesPage from "@/pages/sub-recipes";
import CostHistoryPage from "@/pages/cost-history";
import TransactionCategoriesPage from "@/pages/transaction-categories";
import FinancialGroupsPage from "@/pages/financial-groups";
import BankStatementsPage from "@/pages/bank-statements";
import BalancePage from "@/pages/balance";
import DashboardPage from "@/pages/dashboard";
import StockPage from "@/pages/stock";
import EmployeesPage from "@/pages/employees";
import AuditsPage from "@/pages/audits";
import PermissionsPage from "@/pages/permissions";
import NotificationsPage from "@/pages/notifications";
import AttendancePage from "@/pages/attendance";
import PayrollPage from "@/pages/payroll";
import TeamPage from "@/pages/team";
import JoinPage from "@/pages/join";
import AuthPage from "@/pages/auth-page";

function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/proveedores" component={SuppliersPage} />
      <Route path="/locales" component={LocalsPage} />
      <Route path="/rubros" component={RubrosPage} />
      <Route path="/sub-rubros" component={SubRubrosPage} />
      <Route path="/impuestos" component={TaxesPage} />
      <Route path="/unidades" component={UnitsPage} />
      <Route path="/insumos" component={SuppliesPage} />
      <Route path="/facturas" component={InvoicesPage} />
      <Route path="/facturas/nueva" component={InvoiceFormPage} />
      <Route path="/facturas/:id" component={InvoiceFormPage} />
      <Route path="/cuentas-corrientes" component={AccountsPage} />
      <Route path="/pagos" component={PaymentsPage} />
      <Route path="/categorias-recetas" component={RecipeCategoriesPage} />
      <Route path="/recetas" component={RecipesPage} />
      <Route path="/sub-recetas" component={SubRecipesPage} />
      <Route path="/recetas/nueva" component={RecipeFormPage} />
      <Route path="/recetas/:id" component={RecipeFormPage} />
      <Route path="/historial-costos" component={CostHistoryPage} />
      <Route path="/categorias-movimientos" component={TransactionCategoriesPage} />
      <Route path="/grupos-financieros" component={FinancialGroupsPage} />
      <Route path="/extractos" component={BankStatementsPage} />
      <Route path="/balance" component={BalancePage} />
      <Route path="/dashboard" component={DashboardPage} />
      <Route path="/stock" component={StockPage} />
      <Route path="/empleados" component={EmployeesPage} />
      <Route path="/auditorias" component={AuditsPage} />
      <Route path="/permisos" component={PermissionsPage} />
      <Route path="/notificaciones" component={NotificationsPage} />
      <Route path="/asistencia" component={AttendancePage} />
      <Route path="/liquidaciones" component={PayrollPage} />
      <Route path="/equipo" component={TeamPage} />
      <Route path="/join/:code?" component={JoinPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function AuthenticatedLayout() {
  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-screen w-full">
        <AppSidebar />
        <div className="flex flex-col flex-1 overflow-hidden">
          <header className="flex items-center justify-between px-4 py-2 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <SidebarTrigger data-testid="button-sidebar-toggle" />
            <ThemeToggle />
          </header>
          <main className="flex-1 overflow-auto p-6">
            <AppRouter />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

function LoadingState() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="space-y-4 text-center">
        <Skeleton className="h-12 w-12 rounded-full mx-auto" />
        <Skeleton className="h-4 w-32 mx-auto" />
      </div>
    </div>
  );
}

function AppContent() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return <LoadingState />;
  }

  if (!user) {
    return (
      <Switch>
        <Route path="/auth" component={AuthPage} />
        <Route path="/join/:code?" component={JoinPage} />
        <Route component={Landing} />
      </Switch>
    );
  }

  return <AuthenticatedLayout />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="system" storageKey="dataflow-theme">
        <TooltipProvider>
          <AppContent />
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
