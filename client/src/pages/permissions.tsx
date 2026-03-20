import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { 
  Shield, 
  Users, 
  UserCog, 
  Eye,
  AlertCircle,
  RefreshCw,
  Check,
} from "lucide-react";
import type { Permission, RolePermission } from "@shared/schema";

type PermissionsByModule = Record<string, Permission[]>;

interface RoleConfig {
  name: string;
  description: string;
  icon: typeof Shield;
  color: string;
}

const ROLES: Record<string, RoleConfig> = {
  admin: {
    name: "Administrador",
    description: "Acceso completo al sistema",
    icon: Shield,
    color: "bg-red-500/10 text-red-600 dark:text-red-400",
  },
  manager: {
    name: "Gerente",
    description: "Gestion operativa y reportes",
    icon: UserCog,
    color: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  },
  employee: {
    name: "Empleado",
    description: "Acceso limitado a operaciones diarias",
    icon: Users,
    color: "bg-green-500/10 text-green-600 dark:text-green-400",
  },
  viewer: {
    name: "Solo Lectura",
    description: "Visualizacion sin modificaciones",
    icon: Eye,
    color: "bg-gray-500/10 text-gray-600 dark:text-gray-400",
  },
};

const MODULE_LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  suppliers: "Proveedores",
  supplies: "Insumos",
  invoices: "Facturas",
  payments: "Pagos",
  recipes: "Recetas",
  bank: "Extractos Bancarios",
  transactions: "Transacciones",
  balances: "Balances P&G",
  stock: "Control de Stock",
  audits: "Auditorias",
  employees: "Empleados",
  payroll: "Liquidaciones",
  settings: "Configuracion",
  users: "Usuarios",
};

type PermState = { canView: boolean; canCreate: boolean; canEdit: boolean; canDelete: boolean };

export default function PermissionsPage() {
  const { toast } = useToast();
  const [selectedRole, setSelectedRole] = useState("manager");
  const [selectedModule, setSelectedModule] = useState<string | null>(null);
  const [localPermissions, setLocalPermissions] = useState<Record<number, PermState>>({});
  const [originalPermissions, setOriginalPermissions] = useState<Record<number, PermState>>({});

  const { data: permissions = [], isLoading: permissionsLoading, isError: permissionsError } = useQuery<Permission[]>({
    queryKey: ["/api/permissions"],
  });

  const { data: rolePermissions = [], isLoading: rolePermsLoading, isError: rolePermsError } = useQuery<RolePermission[]>({
    queryKey: ["/api/role-permissions", selectedRole],
    queryFn: async () => {
      const res = await fetch(`/api/role-permissions?role=${selectedRole}`);
      if (!res.ok) throw new Error("Failed to fetch role permissions");
      return res.json();
    },
  });

  const seedPermissionsMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/permissions/seed", {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/permissions"] });
      toast({ title: "Permisos inicializados correctamente" });
    },
    onError: () => {
      toast({ title: "Error al inicializar permisos", variant: "destructive" });
    },
  });

  const savePermissionsMutation = useMutation({
    mutationFn: async () => {
      const changedPermissions = Object.entries(localPermissions).filter(([id, perms]) => {
        const original = originalPermissions[parseInt(id)];
        if (!original) return true;
        return (
          perms.canView !== original.canView ||
          perms.canCreate !== original.canCreate ||
          perms.canEdit !== original.canEdit ||
          perms.canDelete !== original.canDelete
        );
      });
      
      for (const [permissionId, perms] of changedPermissions) {
        await apiRequest("POST", "/api/role-permissions", {
          role: selectedRole,
          permissionId: parseInt(permissionId),
          ...perms,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/role-permissions", selectedRole] });
      toast({ title: "Permisos guardados correctamente" });
      setOriginalPermissions({ ...localPermissions });
    },
    onError: () => {
      toast({ title: "Error al guardar permisos", variant: "destructive" });
    },
  });

  useEffect(() => {
    const initial: Record<number, PermState> = {};
    
    permissions.forEach(perm => {
      const existing = rolePermissions.find(rp => rp.permissionId === perm.id);
      initial[perm.id] = {
        canView: existing?.canView ?? false,
        canCreate: existing?.canCreate ?? false,
        canEdit: existing?.canEdit ?? false,
        canDelete: existing?.canDelete ?? false,
      };
    });
    
    setLocalPermissions(initial);
    setOriginalPermissions(initial);
  }, [rolePermissions, permissions]);

  const groupedPermissions: PermissionsByModule = useMemo(() => {
    return permissions.reduce((acc, perm) => {
      if (!acc[perm.module]) {
        acc[perm.module] = [];
      }
      acc[perm.module].push(perm);
      return acc;
    }, {} as PermissionsByModule);
  }, [permissions]);

  useEffect(() => {
    const modules = Object.keys(groupedPermissions);
    if (modules.length > 0 && !selectedModule) {
      setSelectedModule(modules[0]);
    }
  }, [groupedPermissions, selectedModule]);

  const hasChanges = useMemo(() => {
    return Object.entries(localPermissions).some(([id, perms]) => {
      const original = originalPermissions[parseInt(id)];
      if (!original) return true;
      return (
        perms.canView !== original.canView ||
        perms.canCreate !== original.canCreate ||
        perms.canEdit !== original.canEdit ||
        perms.canDelete !== original.canDelete
      );
    });
  }, [localPermissions, originalPermissions]);

  const handlePermissionChange = (permissionId: number, field: keyof PermState, value: boolean) => {
    setLocalPermissions(prev => ({
      ...prev,
      [permissionId]: {
        ...prev[permissionId],
        [field]: value,
      },
    }));
  };

  const handleSelectAll = (module: string, field: keyof PermState, value: boolean) => {
    const modulePerms = groupedPermissions[module] || [];
    setLocalPermissions(prev => {
      const updated = { ...prev };
      modulePerms.forEach(perm => {
        updated[perm.id] = {
          ...updated[perm.id],
          [field]: value,
        };
      });
      return updated;
    });
  };

  const getModuleCheckState = (module: string, field: keyof PermState): "all" | "none" | "some" => {
    const modulePerms = groupedPermissions[module] || [];
    if (modulePerms.length === 0) return "none";
    
    const checkedCount = modulePerms.filter(perm => localPermissions[perm.id]?.[field]).length;
    if (checkedCount === 0) return "none";
    if (checkedCount === modulePerms.length) return "all";
    return "some";
  };

  const isLoading = permissionsLoading || rolePermsLoading;
  const hasError = permissionsError || rolePermsError;

  if (hasError) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Permisos y Roles"
          description="Configuracion de acceso por rol"
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
        title="Permisos y Roles"
        description="Configure los permisos de acceso para cada rol de usuario"
        actions={
          <div className="flex gap-2">
            {permissions.length === 0 && (
              <Button 
                variant="outline" 
                onClick={() => seedPermissionsMutation.mutate()}
                disabled={seedPermissionsMutation.isPending}
                data-testid="button-seed-permissions"
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${seedPermissionsMutation.isPending ? "animate-spin" : ""}`} />
                Inicializar Permisos
              </Button>
            )}
            {hasChanges && (
              <Button 
                onClick={() => savePermissionsMutation.mutate()}
                disabled={savePermissionsMutation.isPending}
                data-testid="button-save-permissions"
              >
                <Check className="h-4 w-4 mr-2" />
                Guardar Cambios
              </Button>
            )}
          </div>
        }
      />

      <div className="grid gap-4 md:grid-cols-4">
        {Object.entries(ROLES).map(([roleKey, config]) => {
          const RoleIcon = config.icon;
          return (
            <Card 
              key={roleKey}
              className={`cursor-pointer transition-all ${selectedRole === roleKey ? "ring-2 ring-primary" : ""}`}
              onClick={() => setSelectedRole(roleKey)}
              data-testid={`card-role-${roleKey}`}
            >
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className={`rounded-lg p-2 ${config.color}`}>
                    <RoleIcon className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{config.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{config.description}</p>
                  </div>
                  {selectedRole === roleKey && (
                    <Badge variant="secondary" className="shrink-0">Activo</Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map(i => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-5 w-32" />
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {[1, 2, 3].map(j => (
                    <Skeleton key={j} className="h-8 w-full" />
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : permissions.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Shield className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No hay permisos configurados</h3>
            <p className="text-muted-foreground mb-4">
              Inicialice los permisos del sistema para comenzar a configurar los roles.
            </p>
            <Button 
              onClick={() => seedPermissionsMutation.mutate()}
              disabled={seedPermissionsMutation.isPending}
              data-testid="button-seed-permissions-empty"
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${seedPermissionsMutation.isPending ? "animate-spin" : ""}`} />
              Inicializar Permisos
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Tabs 
          value={selectedModule || undefined} 
          onValueChange={setSelectedModule} 
          className="space-y-4"
        >
          <TabsList className="flex-wrap h-auto gap-1">
            {Object.keys(groupedPermissions).map(module => (
              <TabsTrigger 
                key={module} 
                value={module}
                data-testid={`tab-module-${module}`}
              >
                {MODULE_LABELS[module] || module}
              </TabsTrigger>
            ))}
          </TabsList>

          {Object.entries(groupedPermissions).map(([module, modulePerms]) => {
            const viewState = getModuleCheckState(module, "canView");
            const createState = getModuleCheckState(module, "canCreate");
            const editState = getModuleCheckState(module, "canEdit");
            const deleteState = getModuleCheckState(module, "canDelete");

            return (
              <TabsContent key={module} value={module}>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between gap-2 pb-4">
                    <CardTitle className="text-lg">{MODULE_LABELS[module] || module}</CardTitle>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      <div className="flex items-center gap-2">
                        <Checkbox 
                          checked={viewState === "some" ? "indeterminate" : viewState === "all"}
                          onCheckedChange={(checked) => handleSelectAll(module, "canView", !!checked)}
                          data-testid={`checkbox-all-view-${module}`}
                        />
                        <span>Ver</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Checkbox 
                          checked={createState === "some" ? "indeterminate" : createState === "all"}
                          onCheckedChange={(checked) => handleSelectAll(module, "canCreate", !!checked)}
                          data-testid={`checkbox-all-create-${module}`}
                        />
                        <span>Crear</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Checkbox 
                          checked={editState === "some" ? "indeterminate" : editState === "all"}
                          onCheckedChange={(checked) => handleSelectAll(module, "canEdit", !!checked)}
                          data-testid={`checkbox-all-edit-${module}`}
                        />
                        <span>Editar</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Checkbox 
                          checked={deleteState === "some" ? "indeterminate" : deleteState === "all"}
                          onCheckedChange={(checked) => handleSelectAll(module, "canDelete", !!checked)}
                          data-testid={`checkbox-all-delete-${module}`}
                        />
                        <span>Eliminar</span>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {modulePerms.map(perm => (
                        <div 
                          key={perm.id} 
                          className="flex items-center justify-between py-2 border-b last:border-0"
                          data-testid={`row-permission-${perm.code}`}
                        >
                          <div>
                            <p className="font-medium">{perm.name}</p>
                            {perm.description && (
                              <p className="text-sm text-muted-foreground">{perm.description}</p>
                            )}
                            <Badge variant="outline" className="mt-1 font-mono text-xs">
                              {perm.code}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-6">
                            <div className="flex items-center gap-2">
                              <Checkbox 
                                checked={localPermissions[perm.id]?.canView ?? false}
                                onCheckedChange={(checked) => handlePermissionChange(perm.id, "canView", !!checked)}
                                data-testid={`checkbox-view-${perm.code}`}
                              />
                              <span className="text-sm text-muted-foreground">Ver</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Checkbox 
                                checked={localPermissions[perm.id]?.canCreate ?? false}
                                onCheckedChange={(checked) => handlePermissionChange(perm.id, "canCreate", !!checked)}
                                data-testid={`checkbox-create-${perm.code}`}
                              />
                              <span className="text-sm text-muted-foreground">Crear</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Checkbox 
                                checked={localPermissions[perm.id]?.canEdit ?? false}
                                onCheckedChange={(checked) => handlePermissionChange(perm.id, "canEdit", !!checked)}
                                data-testid={`checkbox-edit-${perm.code}`}
                              />
                              <span className="text-sm text-muted-foreground">Editar</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Checkbox 
                                checked={localPermissions[perm.id]?.canDelete ?? false}
                                onCheckedChange={(checked) => handlePermissionChange(perm.id, "canDelete", !!checked)}
                                data-testid={`checkbox-delete-${perm.code}`}
                              />
                              <span className="text-sm text-muted-foreground">Eliminar</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            );
          })}
        </Tabs>
      )}
    </div>
  );
}
