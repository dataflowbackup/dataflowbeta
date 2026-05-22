import { useQuery } from "@tanstack/react-query";
import type { User } from "@shared/schema";

/** Usuario de sesión; `mustChangePassword` viene de credenciales locales. */
export type AuthUser = User & { mustChangePassword?: boolean };

export function useAuth() {
  const { data: user, isLoading } = useQuery<AuthUser | null>({
    queryKey: ["/api/auth/user"],
    retry: false,
  });

  return {
    user,
    isLoading,
    isAuthenticated: !!user,
  };
}
