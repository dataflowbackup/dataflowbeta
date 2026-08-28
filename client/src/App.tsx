import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { useAuth } from "@/hooks/useAuth";
import { ForcePasswordChangeGate } from "@/components/force-password-change-dialog";
import { AppSidebar } from "@/components/app-sidebar";
import { syncFilterScope } from "@/lib/filter-scope";
import { moduleForPath } from "@/lib/nav-modules";
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
import BulkInvoiceImportPage from "@/pages/bulk-invoice-import";
import InvoiceFormPage from "@/pages/invoice-form";
import CreditNoteFormPage from "@/pages/credit-note-form";
import MerchandiseTransfersPage from "@/pages/merchandise-transfers";
import AccountsPage from "@/pages/accounts";
import PaymentsPage from "@/pages/payments";
import RecipeCategoriesPage from "@/pages/recipe-categories";
import RecipeSubCategoriesPage from "@/pages/recipe-sub-categories";
import RecipesPage from "@/pages/recipes";
import RecipeFormPage from "@/pages/recipe-form";
import SubRecipesPage from "@/pages/sub-recipes";
import CostHistoryPage from "@/pages/cost-history";
import TransactionCategoriesPage from "@/pages/transaction-categories";
import FinancialGroupsPage from "@/pages/financial-groups";
import BankStatementsPage from "@/pages/bank-statements";
import CashPage from "@/pages/cash";
import ExtractosEfectivoPage from "@/pages/extractos-efectivo";
import BalancePage from "@/pages/balance";
import EconomicBalancePage from "@/pages/economic-balance";
import CmcPage from "@/pages/cmc";
import PapPage from "@/pages/pap";
import StockValuationPage from "@/pages/stock-valuation";
import CmvPage from "@/pages/cmv";
import CmvProductosPage from "@/pages/cmv-productos";
import BreakevenPage from "@/pages/breakeven";
import DataliveVentasPage from "@/pages/datalive-ventas";
import DecomisosPage from "@/pages/decomisos";
import FudoVentasPage from "@/pages/fudo-ventas";
import SharesVentasPage from "@/pages/shares-ventas";
import DashboardPage from "@/pages/dashboard";
import ObjetivosMensualesPage from "@/pages/objetivos-mensuales";
import StockPage from "@/pages/stock";
import EmployeesPage from "@/pages/employees";
import AuditsPage from "@/pages/audits";
import PermissionsPage from "@/pages/permissions";
import NotificationsPage from "@/pages/notifications";
import PreferencesPage from "@/pages/preferences";
import MisComprobantesPage from "@/pages/mis-comprobantes";
import AttendancePage from "@/pages/attendance";
import PayrollPage from "@/pages/payroll";
import TeamPage from "@/pages/team";
import JoinPage from "@/pages/join";
import AuthPage from "@/pages/auth-page";
import BusinessNamesPage from "@/pages/business-names";

/**
 * Punto 7 (ago-26): sincroniza el modulo activo con el guardado de filtros.
 *
 * Corre durante el render (no en un efecto) para que, cuando el usuario cambia de
 * modulo, la limpieza ocurra ANTES de que la pantalla nueva lea su estado inicial.
 */
function FilterScopeGuard() {
  const [location] = useLocation();
  syncFilterScope(moduleForPath(location));
  return null;
}

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
      <Route path="/facturas/importacion-excel" component={BulkInvoiceImportPage} />
      <Route path="/facturas/nota-credito/nueva" component={CreditNoteFormPage} />
      <Route path="/facturas/traslados" component={MerchandiseTransfersPage} />
      <Route path="/facturas/nueva" component={InvoiceFormPage} />
      <Route path="/facturas/:id" component={InvoiceFormPage} />
      <Route path="/cuentas-corrientes" component={AccountsPage} />
      <Route path="/pagos" component={PaymentsPage} />
      <Route path="/categorias-recetas" component={RecipeCategoriesPage} />
      <Route path="/subcategorias-recetas" component={RecipeSubCategoriesPage} />
      <Route path="/recetas" component={RecipesPage} />
      <Route path="/sub-recetas" component={SubRecipesPage} />
      <Route path="/recetas/nueva" component={RecipeFormPage} />
      <Route path="/recetas/:id" component={RecipeFormPage} />
      <Route path="/historial-costos" component={CostHistoryPage} />
      <Route path="/categorias-movimientos" component={TransactionCategoriesPage} />
      <Route path="/grupos-financieros" component={FinancialGroupsPage} />
      <Route path="/extractos-efectivo" component={ExtractosEfectivoPage} />
      <Route path="/extractos" component={BankStatementsPage} />
      <Route path="/efectivo" component={CashPage} />
      <Route path="/balance" component={BalancePage} />
      <Route path="/balances-economicos" component={EconomicBalancePage} />
      <Route path="/cmc" component={CmcPage} />
      <Route path="/pap" component={PapPage} />
      <Route path="/valorizar-stock" component={StockValuationPage} />
      <Route path="/cmv" component={CmvPage} />
      <Route path="/cmv-productos" component={CmvProductosPage} />
      <Route path="/punto-equilibrio" component={BreakevenPage} />
      <Route path="/ventas-datalive" component={DataliveVentasPage} />
      <Route path="/decomisos" component={DecomisosPage} />
      <Route path="/ventas-fudo" component={FudoVentasPage} />
      <Route path="/ventas-shares" component={SharesVentasPage} />
      <Route path="/dashboard" component={DashboardPage} />
      <Route path="/objetivos-mensuales" component={ObjetivosMensualesPage} />
      <Route path="/stock" component={StockPage} />
      <Route path="/empleados" component={EmployeesPage} />
      <Route path="/auditorias" component={AuditsPage} />
      <Route path="/permisos" component={PermissionsPage} />
      <Route path="/notificaciones" component={NotificationsPage} />
      <Route path="/preferencias" component={PreferencesPage} />
      <Route path="/mis-comprobantes" component={MisComprobantesPage} />
      <Route path="/asistencia" component={AttendancePage} />
      <Route path="/liquidaciones" component={PayrollPage} />
      <Route path="/equipo" component={TeamPage} />
      <Route path="/sociedades" component={BusinessNamesPage} />
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
            <FilterScopeGuard />
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

  return (
    <>
      <AuthenticatedLayout />
      <ForcePasswordChangeGate open={Boolean(user.mustChangePassword)} />
    </>
  );
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
