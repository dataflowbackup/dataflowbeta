import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import {
  FileText,
  Package,
  Users,
  Building2,
  Calculator,
  BarChart3,
  ChefHat,
  Receipt,
  ArrowRight,
  TrendingUp,
  DollarSign,
  ShoppingCart,
} from "lucide-react";

const quickActions = [
  {
    title: "Nueva Factura",
    description: "Cargar una factura de proveedor",
    icon: FileText,
    href: "/facturas?new=true",
    color: "bg-blue-500/10 text-blue-500",
  },
  {
    title: "Nueva Receta",
    description: "Crear una receta con costos",
    icon: ChefHat,
    href: "/recetas?new=true",
    color: "bg-green-500/10 text-green-500",
  },
  {
    title: "Importar Extracto",
    description: "Cargar movimientos bancarios",
    icon: Receipt,
    href: "/extractos?import=true",
    color: "bg-purple-500/10 text-purple-500",
  },
  {
    title: "Ver Dashboard",
    description: "Analisis financiero completo",
    icon: BarChart3,
    href: "/dashboard",
    color: "bg-orange-500/10 text-orange-500",
  },
];

const modules = [
  {
    title: "Catalogos",
    items: [
      { name: "Proveedores", href: "/proveedores", icon: Users },
      { name: "Insumos", href: "/insumos", icon: Package },
      { name: "Locales", href: "/locales", icon: Building2 },
    ],
  },
  {
    title: "Facturacion",
    items: [
      { name: "Facturas", href: "/facturas", icon: FileText },
      { name: "Cuentas Corrientes", href: "/cuentas-corrientes", icon: DollarSign },
      { name: "Pagos", href: "/pagos", icon: ShoppingCart },
    ],
  },
  {
    title: "Costos",
    items: [
      { name: "Recetas", href: "/recetas", icon: ChefHat },
      { name: "Historial de Costos", href: "/historial-costos", icon: Calculator },
    ],
  },
  {
    title: "Financiero",
    items: [
      { name: "Extractos Bancarios", href: "/extractos", icon: Receipt },
      { name: "Balance P&G", href: "/balance", icon: TrendingUp },
      { name: "Dashboard", href: "/dashboard", icon: BarChart3 },
    ],
  },
];

export default function Home() {
  const { user } = useAuth();

  const greeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Buenos dias";
    if (hour < 18) return "Buenas tardes";
    return "Buenas noches";
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight" data-testid="text-greeting">
          {greeting()}, {user?.firstName || "Usuario"}
        </h1>
        <p className="text-muted-foreground mt-1">
          Bienvenido a Data Flow. Que te gustaria hacer hoy?
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {quickActions.map((action) => (
          <Link key={action.href} href={action.href}>
            <Card className="hover-elevate cursor-pointer h-full" data-testid={`card-action-${action.title.toLowerCase().replace(/\s/g, '-')}`}>
              <CardContent className="p-6">
                <div className={`flex h-12 w-12 items-center justify-center rounded-lg ${action.color} mb-4`}>
                  <action.icon className="h-6 w-6" />
                </div>
                <h3 className="font-semibold mb-1">{action.title}</h3>
                <p className="text-sm text-muted-foreground">{action.description}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        {modules.map((module) => (
          <Card key={module.title} data-testid={`card-module-${module.title.toLowerCase()}`}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">{module.title}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {module.items.map((item) => (
                <Link key={item.href} href={item.href}>
                  <Button
                    variant="ghost"
                    className="w-full justify-between h-10 px-3"
                    data-testid={`button-${item.name.toLowerCase().replace(/\s/g, '-')}`}
                  >
                    <span className="flex items-center gap-2">
                      <item.icon className="h-4 w-4 text-muted-foreground" />
                      {item.name}
                    </span>
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </Link>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Primeros Pasos</CardTitle>
          <CardDescription>
            Configura tu cuenta para comenzar a usar Data Flow
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="flex items-start gap-4 p-4 rounded-lg border">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-medium">
                1
              </div>
              <div>
                <h4 className="font-medium mb-1">Configura tus locales</h4>
                <p className="text-sm text-muted-foreground">
                  Agrega los locales o sucursales de tu negocio
                </p>
                <Link href="/locales">
                  <Button variant="link" className="h-auto p-0 mt-2" data-testid="button-setup-locales">
                    Ir a Locales <ArrowRight className="h-3 w-3 ml-1" />
                  </Button>
                </Link>
              </div>
            </div>
            <div className="flex items-start gap-4 p-4 rounded-lg border">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-medium">
                2
              </div>
              <div>
                <h4 className="font-medium mb-1">Agrega proveedores</h4>
                <p className="text-sm text-muted-foreground">
                  Registra tus proveedores para cargar facturas
                </p>
                <Link href="/proveedores">
                  <Button variant="link" className="h-auto p-0 mt-2" data-testid="button-setup-proveedores">
                    Ir a Proveedores <ArrowRight className="h-3 w-3 ml-1" />
                  </Button>
                </Link>
              </div>
            </div>
            <div className="flex items-start gap-4 p-4 rounded-lg border">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-medium">
                3
              </div>
              <div>
                <h4 className="font-medium mb-1">Carga tu primera factura</h4>
                <p className="text-sm text-muted-foreground">
                  Comienza a registrar tus compras
                </p>
                <Link href="/facturas?new=true">
                  <Button variant="link" className="h-auto p-0 mt-2" data-testid="button-setup-facturas">
                    Nueva Factura <ArrowRight className="h-3 w-3 ml-1" />
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
