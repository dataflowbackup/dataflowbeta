import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { 
  UserPlus, 
  Mail,
  Copy,
  Trash2,
  Clock,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { User, ClientInvitation } from "@shared/schema";

type UserWithRole = User & { role: string | null };

const ROLE_LABELS: Record<string, { name: string; color: string }> = {
  admin: { name: "Administrador", color: "bg-red-500/10 text-red-600" },
  manager: { name: "Gerente", color: "bg-blue-500/10 text-blue-600" },
  encargado: { name: "Encargado", color: "bg-green-500/10 text-green-600" },
  employee: { name: "Empleado", color: "bg-gray-500/10 text-gray-600" },
  viewer: { name: "Solo Lectura", color: "bg-gray-500/10 text-gray-400" },
};

export default function TeamPage() {
  const { toast } = useToast();
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("encargado");

  const { data: users = [], isLoading: usersLoading } = useQuery<UserWithRole[]>({
    queryKey: ["/api/team/users"],
  });

  const { data: invitations = [], isLoading: invitationsLoading } = useQuery<ClientInvitation[]>({
    queryKey: ["/api/invitations"],
  });

  const createInvitationMutation = useMutation({
    mutationFn: async (data: { email?: string; role: string }) => {
      const res = await apiRequest("POST", "/api/invitations", data);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/invitations"] });
      setInviteDialogOpen(false);
      setInviteEmail("");
      toast({ 
        title: "Invitacion creada",
        description: `Codigo: ${data.inviteCode}`,
      });
    },
    onError: () => {
      toast({ title: "Error al crear invitacion", variant: "destructive" });
    },
  });

  const deleteInvitationMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/invitations/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/invitations"] });
      toast({ title: "Invitacion eliminada" });
    },
    onError: () => {
      toast({ title: "Error al eliminar", variant: "destructive" });
    },
  });

  const copyToClipboard = (code: string) => {
    const inviteUrl = `${window.location.origin}/join/${code}`;
    navigator.clipboard.writeText(inviteUrl);
    toast({ title: "Link copiado al portapapeles" });
  };

  const getInitials = (user: UserWithRole) => {
    const first = user.firstName?.charAt(0) || "";
    const last = user.lastName?.charAt(0) || "";
    return (first + last).toUpperCase() || user.email?.charAt(0).toUpperCase() || "U";
  };

  const formatDate = (date: string | Date | null) => {
    if (!date) return "-";
    return new Date(date).toLocaleDateString("es-AR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  };

  const getInvitationStatus = (inv: ClientInvitation) => {
    if (inv.status === "used") {
      return { label: "Usada", icon: CheckCircle2, color: "text-green-600" };
    }
    if (inv.expiresAt && new Date(inv.expiresAt) < new Date()) {
      return { label: "Expirada", icon: XCircle, color: "text-red-600" };
    }
    return { label: "Pendiente", icon: Clock, color: "text-yellow-600" };
  };

  const pendingInvitations = invitations.filter(
    inv => inv.status === "pending" && (!inv.expiresAt || new Date(inv.expiresAt) >= new Date())
  );

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title="Equipo"
        description="Gestion de usuarios e invitaciones de tu empresa"
      />

      <Tabs defaultValue="users" className="w-full">
        <TabsList>
          <TabsTrigger value="users" data-testid="tab-users">
            Usuarios ({users.length})
          </TabsTrigger>
          <TabsTrigger value="invitations" data-testid="tab-invitations">
            Invitaciones ({pendingInvitations.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="users" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Miembros del Equipo</CardTitle>
              <CardDescription>
                Usuarios que tienen acceso a los datos de tu empresa
              </CardDescription>
            </CardHeader>
            <CardContent>
              {usersLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-16 w-full" />
                  ))}
                </div>
              ) : users.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">
                  No hay usuarios en tu equipo
                </p>
              ) : (
                <div className="space-y-3">
                  {users.map((user) => (
                    <div
                      key={user.id}
                      className="flex items-center justify-between p-4 rounded-lg border"
                      data-testid={`user-row-${user.id}`}
                    >
                      <div className="flex items-center gap-3">
                        <Avatar>
                          <AvatarImage src={user.profileImageUrl || undefined} />
                          <AvatarFallback>{getInitials(user)}</AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="font-medium">
                            {user.firstName} {user.lastName}
                          </p>
                          <p className="text-sm text-muted-foreground">{user.email}</p>
                        </div>
                      </div>
                      <Badge className={ROLE_LABELS[user.role || "encargado"]?.color || ""}>
                        {ROLE_LABELS[user.role || "encargado"]?.name || user.role}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="invitations" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-lg">Invitaciones</CardTitle>
                <CardDescription>
                  Invita usuarios a unirse a tu empresa
                </CardDescription>
              </div>
              <Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
                <DialogTrigger asChild>
                  <Button data-testid="button-new-invitation">
                    <UserPlus className="h-4 w-4 mr-2" />
                    Nueva Invitacion
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Crear Invitacion</DialogTitle>
                    <DialogDescription>
                      Genera un codigo de invitacion para que nuevos usuarios se unan a tu empresa.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label htmlFor="email">Email (opcional)</Label>
                      <Input
                        id="email"
                        type="email"
                        placeholder="usuario@ejemplo.com"
                        value={inviteEmail}
                        onChange={(e) => setInviteEmail(e.target.value)}
                        data-testid="input-invite-email"
                      />
                      <p className="text-xs text-muted-foreground">
                        Si lo dejas vacio, cualquiera con el codigo podra unirse
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="role">Rol</Label>
                      <Select value={inviteRole} onValueChange={setInviteRole}>
                        <SelectTrigger data-testid="select-invite-role">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="admin">Administrador</SelectItem>
                          <SelectItem value="manager">Gerente</SelectItem>
                          <SelectItem value="encargado">Encargado</SelectItem>
                          <SelectItem value="employee">Empleado</SelectItem>
                          <SelectItem value="viewer">Solo Lectura</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button
                      variant="outline"
                      onClick={() => setInviteDialogOpen(false)}
                    >
                      Cancelar
                    </Button>
                    <Button
                      onClick={() => createInvitationMutation.mutate({
                        email: inviteEmail || undefined,
                        role: inviteRole,
                      })}
                      disabled={createInvitationMutation.isPending}
                      data-testid="button-create-invitation"
                    >
                      {createInvitationMutation.isPending ? "Creando..." : "Crear Invitacion"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </CardHeader>
            <CardContent>
              {invitationsLoading ? (
                <div className="space-y-3">
                  {[1, 2].map((i) => (
                    <Skeleton key={i} className="h-16 w-full" />
                  ))}
                </div>
              ) : invitations.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">
                  No hay invitaciones. Crea una para invitar usuarios.
                </p>
              ) : (
                <div className="space-y-3">
                  {invitations.map((inv) => {
                    const status = getInvitationStatus(inv);
                    const StatusIcon = status.icon;
                    return (
                      <div
                        key={inv.id}
                        className="flex items-center justify-between p-4 rounded-lg border"
                        data-testid={`invitation-row-${inv.id}`}
                      >
                        <div className="flex items-center gap-3">
                          <div className={`p-2 rounded-full bg-muted ${status.color}`}>
                            <StatusIcon className="h-4 w-4" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <code className="font-mono text-sm bg-muted px-2 py-0.5 rounded">
                                {inv.inviteCode}
                              </code>
                              <Badge variant="outline" className="text-xs">
                                {ROLE_LABELS[inv.role || "encargado"]?.name || inv.role}
                              </Badge>
                            </div>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                              {inv.email && (
                                <span className="flex items-center gap-1">
                                  <Mail className="h-3 w-3" />
                                  {inv.email}
                                </span>
                              )}
                              <span>Expira: {formatDate(inv.expiresAt)}</span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {inv.status === "pending" && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => copyToClipboard(inv.inviteCode)}
                              title="Copiar link"
                              data-testid={`button-copy-${inv.id}`}
                            >
                              <Copy className="h-4 w-4" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => deleteInvitationMutation.mutate(inv.id)}
                            disabled={deleteInvitationMutation.isPending}
                            title="Eliminar"
                            data-testid={`button-delete-${inv.id}`}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
