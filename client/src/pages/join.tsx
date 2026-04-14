import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, AlertCircle, UsersRound, UserPlus, LogIn } from "lucide-react";
import type { User } from "@shared/schema";

export default function JoinPage() {
  const params = useParams<{ code?: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [manualCode, setManualCode] = useState("");
  const inviteCode = params.code || manualCode;

  // Form states for registration
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");

  const { data: user, isLoading: userLoading } = useQuery<User | null>({
    queryKey: ["/api/auth/user"],
    retry: false,
  });

  const isLoggedIn = !!user?.id;

  const { data: inviteCheck, isLoading: checking, isError } = useQuery({
    queryKey: ["/api/invitations/check", inviteCode],
    queryFn: async () => {
      if (!inviteCode) return null;
      const res = await fetch(`/api/invitations/check/${inviteCode}`, {
        credentials: "include",
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Invitacion no valida");
      }
      return res.json();
    },
    enabled: !!inviteCode && inviteCode.length >= 8,
    retry: false,
  });

  // For logged in users - use existing invitation
  const useInvitationMutation = useMutation({
    mutationFn: async (code: string) => {
      const res = await apiRequest("POST", `/api/invitations/use/${code}`, {});
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Error al usar invitacion");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      toast({
        title: "Te uniste exitosamente",
        description: "Ahora tienes acceso a los datos de la empresa",
      });
      setTimeout(() => setLocation("/"), 1500);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // For new users - register with invitation
  const registerWithInvitationMutation = useMutation({
    mutationFn: async (data: {
      email: string;
      password: string;
      firstName?: string;
      lastName?: string;
      inviteCode: string;
    }) => {
      const res = await fetch("/api/auth/register-with-invitation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.message || "Error al registrar");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      toast({
        title: "Registro exitoso",
        description: "Ya estas en la empresa. Redirigiendo...",
      });
      setTimeout(() => setLocation("/"), 1500);
    },
    onError: (error: Error) => {
      toast({
        title: "Error al registrar",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleRegister = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (password !== confirmPassword) {
      toast({
        title: "Error",
        description: "Las contraseñas no coinciden",
        variant: "destructive",
      });
      return;
    }

    if (password.length < 6) {
      toast({
        title: "Error",
        description: "La contraseña debe tener al menos 6 caracteres",
        variant: "destructive",
      });
      return;
    }

    registerWithInvitationMutation.mutate({
      email,
      password,
      firstName: firstName || undefined,
      lastName: lastName || undefined,
      inviteCode,
    });
  };

  if (userLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-background to-muted">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6">
            <Skeleton className="h-8 w-full mb-4" />
            <Skeleton className="h-4 w-2/3 mb-2" />
            <Skeleton className="h-4 w-1/2" />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-background to-muted">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 p-3 rounded-full bg-primary/10 w-fit">
            <UsersRound className="h-8 w-8 text-primary" />
          </div>
          <CardTitle>Unirse a una Empresa</CardTitle>
          <CardDescription>
            {isLoggedIn 
              ? "Usa tu codigo de invitacion para unirte al equipo"
              : "Registrate y unite al equipo con tu codigo de invitacion"
            }
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Code input - always visible if no code in URL */}
          {!params.code && (
            <div className="space-y-2">
              <Label htmlFor="code">Codigo de Invitacion</Label>
              <Input
                id="code"
                placeholder="ABCD1234..."
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value.toUpperCase())}
                className="font-mono text-center text-lg tracking-wider"
                data-testid="input-invite-code"
              />
            </div>
          )}

          {params.code && (
            <div className="text-center">
              <p className="text-sm text-muted-foreground mb-2">Codigo de invitacion:</p>
              <code className="font-mono text-lg bg-muted px-4 py-2 rounded">
                {params.code}
              </code>
            </div>
          )}

          {checking && inviteCode && (
            <div className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          )}

          {isError && inviteCode && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                La invitacion no es valida o ha expirado
              </AlertDescription>
            </Alert>
          )}

          {inviteCheck?.valid && (
            <Alert className="border-green-200 bg-green-50 dark:bg-green-950/20">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <AlertDescription className="text-green-700 dark:text-green-400">
                Invitacion valida. Rol asignado: <strong>{inviteCheck.role}</strong>
              </AlertDescription>
            </Alert>
          )}

          {/* If logged in, show simple join button */}
          {isLoggedIn && inviteCheck?.valid && (
            <>
              <Alert className="bg-blue-50 dark:bg-blue-950/20 border-blue-200">
                <AlertDescription className="text-blue-700 dark:text-blue-400">
                  Hola <strong>{user?.firstName || user?.email}</strong>. Click abajo para unirte.
                </AlertDescription>
              </Alert>
              <Button
                className="w-full"
                size="lg"
                disabled={useInvitationMutation.isPending}
                onClick={() => useInvitationMutation.mutate(inviteCode)}
                data-testid="button-join"
              >
                {useInvitationMutation.isPending ? "Uniendose..." : "Unirse al Equipo"}
              </Button>
            </>
          )}

          {/* If NOT logged in, show tabs for login or register */}
          {!isLoggedIn && inviteCheck?.valid && (
            <Tabs defaultValue="register" className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="register" data-testid="tab-register">
                  <UserPlus className="h-4 w-4 mr-2" />
                  Crear Cuenta
                </TabsTrigger>
                <TabsTrigger value="login" data-testid="tab-login">
                  <LogIn className="h-4 w-4 mr-2" />
                  Ya tengo cuenta
                </TabsTrigger>
              </TabsList>

              <TabsContent value="register" className="space-y-4 pt-4">
                <form onSubmit={handleRegister} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="firstName">Nombre</Label>
                      <Input
                        id="firstName"
                        placeholder="Juan"
                        value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                        data-testid="input-first-name"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="lastName">Apellido</Label>
                      <Input
                        id="lastName"
                        placeholder="Perez"
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                        data-testid="input-last-name"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email">Email *</Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="tu@email.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      data-testid="input-email"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="password">Contraseña *</Label>
                    <Input
                      id="password"
                      type="password"
                      placeholder="Minimo 6 caracteres"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      data-testid="input-password"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="confirmPassword">Confirmar Contraseña *</Label>
                    <Input
                      id="confirmPassword"
                      type="password"
                      placeholder="Repetir contraseña"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      required
                      data-testid="input-confirm-password"
                    />
                  </div>
                  <Button 
                    type="submit" 
                    className="w-full" 
                    size="lg"
                    disabled={registerWithInvitationMutation.isPending}
                    data-testid="button-register"
                  >
                    {registerWithInvitationMutation.isPending 
                      ? "Registrando..." 
                      : "Registrarme y Unirme"
                    }
                  </Button>
                </form>
              </TabsContent>

              <TabsContent value="login" className="space-y-4 pt-4">
                <Alert>
                  <AlertDescription>
                    Si ya tienes una cuenta, inicia sesion primero y luego vuelve a este enlace.
                  </AlertDescription>
                </Alert>
                <Button 
                  className="w-full" 
                  variant="outline"
                  onClick={() => setLocation(`/auth?redirect=/join/${inviteCode}`)}
                  data-testid="button-go-to-login"
                >
                  <LogIn className="h-4 w-4 mr-2" />
                  Ir a Iniciar Sesion
                </Button>
              </TabsContent>
            </Tabs>
          )}

          <p className="text-xs text-center text-muted-foreground">
            Al unirte, tendras acceso a los datos compartidos de la empresa
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
