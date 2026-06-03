import { useQuery } from "@tanstack/react-query";

export type PermissionAction = "view" | "create" | "edit" | "delete";

export interface PermFlags {
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

export interface MyPermissions {
  role: string;
  isSocio: boolean;
  permissions: Record<string, PermFlags>;
}

/**
 * Permisos efectivos del usuario actual para gating de UI.
 *
 * `can(code, action)` devuelve true si el rol tiene la acción habilitada.
 * - socio: siempre true (override de dueño).
 * - mientras carga: `isLoading` es true; el consumidor decide (el sidebar muestra
 *   los ítems opt-in durante la carga para evitar parpadeo y nunca oculta ítems sin permiso declarado).
 */
export function usePermissions() {
  const { data, isLoading } = useQuery<MyPermissions | null>({
    queryKey: ["/api/me/permissions"],
    staleTime: 5 * 60_000,
  });

  const isSocio = data?.isSocio ?? false;

  const can = (code: string, action: PermissionAction = "view"): boolean => {
    if (!data) return false;
    if (data.isSocio) return true;
    const flags = data.permissions[code];
    if (!flags) return false;
    switch (action) {
      case "view":
        return !!flags.canView;
      case "create":
        return !!flags.canCreate;
      case "edit":
        return !!flags.canEdit;
      case "delete":
        return !!flags.canDelete;
      default:
        return false;
    }
  };

  return {
    role: data?.role ?? null,
    isSocio,
    isLoading,
    permissions: data?.permissions ?? {},
    can,
  };
}
