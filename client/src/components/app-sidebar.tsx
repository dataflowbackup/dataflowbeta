import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, Link } from "wouter";
import {
  FileText,
  Package,
  Users,
  Building2,
  Calculator,
  Wallet,
  BarChart3,
  ChefHat,
  Receipt,
  CreditCard,
  Tags,
  Scale,
  Percent,
  LogOut,
  Home,
  Boxes,
  ClipboardCheck,
  UserCog,
  Shield,
  Bell,
  Clock,
  DollarSign,
  ChevronRight,
  UsersRound,
  FolderTree,
  Layers,
  Briefcase,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";

interface MenuItem {
  title: string;
  url: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface MenuSection {
  title: string;
  items: MenuItem[];
  defaultOpen?: boolean;
}

/** En false, la sección "Operaciones" no aparece en el menú lateral hasta activar ese módulo. */
const SHOW_OPERACIONES_SIDEBAR = false;

const menuSections: MenuSection[] = [
  {
    title: "Catalogos",
    defaultOpen: true,
    items: [
      { title: "Proveedores", url: "/proveedores", icon: Users },
      { title: "Rubros", url: "/rubros", icon: Tags },
      { title: "Sub-Rubros", url: "/sub-rubros", icon: Layers },
      { title: "Locales", url: "/locales", icon: Building2 },
      { title: "Impuestos", url: "/impuestos", icon: Percent },
      { title: "Unidades", url: "/unidades", icon: Scale },
    ],
  },
  {
    title: "Facturacion",
    defaultOpen: true,
    items: [
      { title: "Facturas", url: "/facturas", icon: FileText },
      { title: "Cuentas Corrientes", url: "/cuentas-corrientes", icon: Wallet },
      { title: "Pagos", url: "/pagos", icon: CreditCard },
    ],
  },
  {
    title: "Costos y Recetas",
    defaultOpen: false,
    items: [
      { title: "Categorias", url: "/categorias-recetas", icon: Tags },
      { title: "Subcategorias", url: "/subcategorias-recetas", icon: FolderTree },
      { title: "Insumos", url: "/insumos", icon: Package },
      { title: "Carta", url: "/recetas", icon: ChefHat },
      { title: "Sub-Recetas", url: "/sub-recetas", icon: Layers },
      { title: "Historial Costos", url: "/historial-costos", icon: Calculator },
    ],
  },
  {
    title: "Financiero",
    defaultOpen: false,
    items: [
      { title: "Extractos", url: "/extractos", icon: Receipt },
      { title: "Categorias Mov.", url: "/categorias-movimientos", icon: Tags },
      { title: "Grupos Financ.", url: "/grupos-financieros", icon: FolderTree },
      { title: "Balances Financieros", url: "/balance", icon: BarChart3 },
      { title: "Dashboard", url: "/dashboard", icon: BarChart3 },
    ],
  },
  {
    title: "Operaciones",
    defaultOpen: true,
    items: [
      { title: "Control Stock", url: "/stock", icon: Boxes },
      { title: "Auditorias", url: "/auditorias", icon: ClipboardCheck },
      { title: "Empleados", url: "/empleados", icon: UserCog },
      { title: "Asistencia", url: "/asistencia", icon: Clock },
      { title: "Liquidaciones", url: "/liquidaciones", icon: DollarSign },
    ],
  },
  {
    title: "Configuracion",
    defaultOpen: true,
    items: [
      { title: "Equipo", url: "/equipo", icon: UsersRound },
      { title: "Permisos", url: "/permisos", icon: Shield },
      { title: "Notificaciones", url: "/notificaciones", icon: Bell },
    ],
  },
];

function CollapsibleMenuSection({
  section,
  isActive,
}: {
  section: MenuSection;
  isActive: (url: string) => boolean;
}) {
  const hasActiveItem = section.items.some((item) => isActive(item.url));
  const [isOpen, setIsOpen] = useState(section.defaultOpen || hasActiveItem);

  useEffect(() => {
    if (hasActiveItem) {
      setIsOpen(true);
    }
  }, [hasActiveItem]);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <SidebarGroup className="py-0">
        <CollapsibleTrigger className="flex w-full items-center justify-between px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground transition-colors">
          <span>{section.title}</span>
          <ChevronRight
            className={cn(
              "h-3 w-3 transition-transform duration-200",
              isOpen && "rotate-90"
            )}
          />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarGroupContent>
            <SidebarMenu>
              {section.items.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild isActive={isActive(item.url)} className="h-8">
                    <Link href={item.url} data-testid={`link-${item.url.slice(1)}`}>
                      <item.icon className="h-4 w-4" />
                      <span className="text-sm">{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  );
}

type AuthOrganization = { id: number; name: string };

export function AppSidebar() {
  const [location] = useLocation();
  const { user } = useAuth();

  const { data: organization, isLoading: isOrgLoading } = useQuery<AuthOrganization | null>({
    queryKey: ["/api/auth/organization"],
    enabled: !!user,
    staleTime: 5 * 60_000,
  });

  const isActive = (url: string) => location === url;

  const getInitials = () => {
    if (!user) return "U";
    const first = user.firstName?.charAt(0) || "";
    const last = user.lastName?.charAt(0) || "";
    return (first + last).toUpperCase() || user.email?.charAt(0).toUpperCase() || "U";
  };

  return (
    <Sidebar>
      <SidebarHeader className="p-3">
        <Link href="/" className="flex gap-2.5 rounded-md outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
            <BarChart3 className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex flex-1 flex-col gap-1">
            <div className="leading-none">
              <span className="text-base font-bold tracking-tight">Data Flow</span>
            </div>
            {isOrgLoading && (
              <Skeleton className="h-3.5 w-[10rem] max-w-full rounded" />
            )}
            {!isOrgLoading && organization?.name && (
              <Tooltip delayDuration={400}>
                <TooltipTrigger asChild>
                  <div className="flex items-start gap-1 min-w-0 rounded-md bg-muted/60 px-1.5 py-1 border border-border/80">
                    <Briefcase className="h-3 w-3 shrink-0 mt-0.5 text-muted-foreground" aria-hidden />
                    <span className="text-[11px] font-semibold leading-snug text-foreground line-clamp-2">
                      {organization.name}
                    </span>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="bottom" align="start" className="max-w-xs">
                  <p className="font-medium">{organization.name}</p>
                  <p className="text-xs text-muted-foreground mt-1">Empresa activa en esta sesión</p>
                </TooltipContent>
              </Tooltip>
            )}
            {!isOrgLoading && !organization?.name && (
              <span className="text-[10px] text-muted-foreground leading-tight">Gestión empresarial</span>
            )}
          </div>
        </Link>
      </SidebarHeader>

      <SidebarSeparator />

      <SidebarContent className="px-1 overflow-y-auto flex-1">
        <SidebarGroup className="py-1">
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={isActive("/")} className="h-8">
                  <Link href="/" data-testid="link-home">
                    <Home className="h-4 w-4" />
                    <span>Inicio</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {menuSections
          .filter(
            (section) =>
              SHOW_OPERACIONES_SIDEBAR || section.title !== "Operaciones",
          )
          .map((section) => (
            <CollapsibleMenuSection
              key={section.title}
              section={section}
              isActive={isActive}
            />
          ))}
      </SidebarContent>

      <SidebarSeparator />

      <SidebarFooter className="p-2">
        <div className="flex items-center gap-2">
          <Avatar className="h-7 w-7">
            <AvatarImage
              src={user?.profileImageUrl || undefined}
              alt={user?.firstName || "Usuario"}
              className="object-cover"
            />
            <AvatarFallback className="bg-primary/10 text-primary text-xs font-medium">
              {getInitials()}
            </AvatarFallback>
          </Avatar>
          <div className="flex flex-1 flex-col overflow-hidden">
            <span className="truncate text-xs font-medium">
              {user?.firstName && user?.lastName
                ? `${user.firstName} ${user.lastName}`
                : user?.email || "Usuario"}
            </span>
          </div>
          <a
            href="/api/logout"
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover-elevate"
            data-testid="button-logout"
          >
            <LogOut className="h-3.5 w-3.5" />
          </a>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
