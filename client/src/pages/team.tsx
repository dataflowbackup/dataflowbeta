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
  MoreHorizontal,
  Pencil,
  KeyRound,
  UserCog,
  UserMinus,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { User, ClientInvitation } from "@shared/schema";

type UserWithRole = User & { role: string | null };

const ROLE_LABELS: Record<string, { name: string; color: string }> = {
  socio: { name: "Socio", color: "bg-purple-500/10 text-purple-600" },
  admin: { name: "Administrador", color: "bg-red-500/10 text-red-600" },
  manager: { name: "Gerente", color: "bg-blue-500/10 text-blue-600" },
  encargado: { name: "Encargado", color: "bg-green-500/10 text-green-600" },
  employee: { name: "Empleado", color: "bg-gray-500/10 text-gray-600" },
  viewer: { name: "Solo Lectura", color: "bg-gray-500/10 text-gray-400" },
};

const ROLE_OPTIONS = ["socio", "admin", "manager", "encargado", "employee", "viewer"] as const;

function parseApiError(err: unknown): string {
  if (!(err instanceof Error)) return "Error inesperado";
  const raw = err.message.replace(/^\d+:\s*/, "");
  try {
    const j = JSON.parse(raw) as { message?: string };
    if (j?.message) return j.message;
  } catch {
    /* plain text */
  }
  return raw || "Error desconocido";
}

export default function TeamPage() {
  const { toast } = useToast();
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteFirstName, setInviteFirstName] = useState("");
  const [inviteLastName, setInviteLastName] = useState("");
  const [inviteRole, setInviteRole] = useState("encargado");

  const [editingUser, setEditingUser] = useState<UserWithRole | null>(null);
  const [editFirstName, setEditFirstName] = useState("");
  const [editLastName, setEditLastName] = useState("");
  const [editEmail, setEditEmail] = useState("");

  const [roleTarget, setRoleTarget] = useState<UserWithRole | null>(null);
  const [newRole, setNewRole] = useState("encargado");

  const [confirmDeleteUser, setConfirmDeleteUser] = useState<UserWithRole | null>(null);
  const [confirmResetUser, setConfirmResetUser] = useState<UserWithRole | null>(null);

  const { data: users = [], isLoading: usersLoading } = useQuery<UserWithRole[]>({
    queryKey: ["/api/team/users"],
  });

  const { data: invitations = [], isLoading: invitationsLoading } = useQuery<ClientInvitation[]>({
    queryKey: ["/api/invitations"],
  });

  const createInvitationMutation = useMutation({
    mutationFn: async (data: {
      email: string;
      role: string;
      firstName?: string;
      lastName?: string;
    }) => {
      const res = await apiRequest("POST", "/api/invitations", data);
      return res.json() as Promise<{ success?: boolean; message?: string; userId?: string }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/invitations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/team/users"] });
      setInviteDialogOpen(false);
      setInviteEmail("");
      setInviteFirstName("");
      setInviteLastName("");
      toast({
        title: "Invitación enviada",
        description: data.message || "Correo con contraseña provisoria enviado.",
      });
    },
    onError: (err: unknown) => {
      toast({ title: "No se pudo invitar", description: parseApiError(err), variant: "destructive" });
    },
  });

  const deleteInvitationMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/invitations/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/invitations"] });
      toast({ title: "Invitación eliminada" });
    },
    onError: (err: unknown) => {
      toast({ title: "Error al eliminar", description: parseApiError(err), variant: "destructive" });
    },
  });

  const updateMemberMutation = useMutation({
    mutationFn: async ({ id, body }: { id: string; body: { firstName?: string; lastName?: string; email?: string } }) => {
      const res = await apiRequest("PATCH", `/api/team/users/${id}`, body);
      return res.json() as Promise<User>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/team/users"] });
      setEditingUser(null);
      toast({ title: "Usuario actualizado" });
    },
    onError: (err: unknown) => {
      toast({ title: "Error al guardar", description: parseApiError(err), variant: "destructive" });
    },
  });

  const updateRoleMutation = useMutation({
    mutationFn: async ({ id, role }: { id: string; role: string }) => {
      const res = await apiRequest("PATCH", `/api/team/users/${id}/role`, { role });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/team/users"] });
      setRoleTarget(null);
      toast({ title: "Rol actualizado" });
    },
    onError: (err: unknown) => {
      toast({ title: "Error", description: parseApiError(err), variant: "destructive" });
    },
  });

  const resetPasswordMutation = useMutation({
    mutationFn: async (userId: string) => {
      const res = await apiRequest("POST", `/api/team/users/${userId}/reset-password`, {});
      return res.json() as Promise<{ message?: string }>;
    },
    onSuccess: (data) => {
      toast({
        title: "Contraseña reiniciada",
        description: data.message || "Se envió correo con contraseña provisoria.",
      });
      setConfirmResetUser(null);
    },
    onError: (err: unknown) => {
      toast({ title: "Error", description: parseApiError(err), variant: "destructive" });
      setConfirmResetUser(null);
    },
  });

  const removeMemberMutation = useMutation({
    mutationFn: async (userId: string) => {
      await apiRequest("DELETE", `/api/team/users/${userId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/team/users"] });
      setConfirmDeleteUser(null);
      toast({ title: "Usuario quitado del equipo" });
    },
    onError: (err: unknown) => {
      toast({ title: "Error", description: parseApiError(err), variant: "destructive" });
      setConfirmDeleteUser(null);
    },
  });

  const openEdit = (user: UserWithRole) => {
    setEditingUser(user);
    setEditFirstName(user.firstName ?? "");
    setEditLastName(user.lastName ?? "");
    setEditEmail(user.email ?? "");
  };

  const openChangeRole = (user: UserWithRole) => {
    setRoleTarget(user);
    setNewRole(user.role ?? "encargado");
  };

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
    (inv) => inv.status === "pending" && (!inv.expiresAt || new Date(inv.expiresAt) >= new Date()),
  );

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader title="Equipo" description="Gestioná usuarios e invitaciones de tu empresa" />

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
              <CardTitle className="text-lg">Miembros del equipo</CardTitle>
              <CardDescription>
                Solo Socio, Administrador y Gerente pueden editar miembros, roles, resetear contraseña o quitar usuarios de
                esta empresa.
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
                <p className="text-muted-foreground text-center py-8">No hay usuarios en tu equipo</p>
              ) : (
                <div className="space-y-3">
                  {users.map((user) => (
                    <div
                      key={user.id}
                      className="flex items-center justify-between p-4 rounded-lg border gap-4"
                      data-testid={`user-row-${user.id}`}
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <Avatar>
                          <AvatarImage src={user.profileImageUrl || undefined} />
                          <AvatarFallback>{getInitials(user)}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <p className="font-medium truncate">
                            {user.firstName} {user.lastName}
                          </p>
                          <p className="text-sm text-muted-foreground truncate">{user.email}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge className={ROLE_LABELS[user.role || "encargado"]?.color || ""}>
                          {ROLE_LABELS[user.role || "encargado"]?.name || user.role}
                        </Badge>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" aria-label="Acciones de usuario">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openEdit(user)}>
                              <Pencil className="h-4 w-4 mr-2" />
                              Editar datos
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => openChangeRole(user)}>
                              <UserCog className="h-4 w-4 mr-2" />
                              Asignar rol
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setConfirmResetUser(user)}>
                              <KeyRound className="h-4 w-4 mr-2" />
                              Resetear contraseña
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={() => setConfirmDeleteUser(user)}
                            >
                              <UserMinus className="h-4 w-4 mr-2" />
                              Quitar del equipo
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="invitations" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4">
              <div>
                <CardTitle className="text-lg">Invitaciones</CardTitle>
                <CardDescription>
                  Invitación por correo (obligatorio): se crea el usuario, se asigna a tu empresa y recibe por email una
                  contraseña provisoria. Las invitaciones antiguas «solo con link» siguen apareciendo abajo si existen.
                </CardDescription>
              </div>
              <Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
                <DialogTrigger asChild>
                  <Button data-testid="button-new-invitation">
                    <UserPlus className="h-4 w-4 mr-2" />
                    Invitar por email
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Invitar por email</DialogTitle>
                    <DialogDescription>
                      El correo es obligatorio. La persona recibirá bienvenida, contraseña provisoria y deberá cambiarla al
                      entrar.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label htmlFor="email">Email</Label>
                      <Input
                        id="email"
                        type="email"
                        required
                        placeholder="usuario@ejemplo.com"
                        value={inviteEmail}
                        onChange={(e) => setInviteEmail(e.target.value)}
                        data-testid="input-invite-email"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label htmlFor="invite-fn">Nombre (opcional)</Label>
                        <Input
                          id="invite-fn"
                          value={inviteFirstName}
                          onChange={(e) => setInviteFirstName(e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="invite-ln">Apellido (opcional)</Label>
                        <Input
                          id="invite-ln"
                          value={inviteLastName}
                          onChange={(e) => setInviteLastName(e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="role">Rol</Label>
                      <Select value={inviteRole} onValueChange={setInviteRole}>
                        <SelectTrigger data-testid="select-invite-role">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ROLE_OPTIONS.map((r) => (
                            <SelectItem key={r} value={r}>
                              {ROLE_LABELS[r]?.name ?? r}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setInviteDialogOpen(false)}>
                      Cancelar
                    </Button>
                    <Button
                      onClick={() => {
                        const e = inviteEmail.trim();
                        if (!e) {
                          toast({ title: "Falta el email", variant: "destructive" });
                          return;
                        }
                        createInvitationMutation.mutate({
                          email: e,
                          role: inviteRole,
                          firstName: inviteFirstName.trim() || undefined,
                          lastName: inviteLastName.trim() || undefined,
                        });
                      }}
                      disabled={createInvitationMutation.isPending}
                      data-testid="button-create-invitation"
                    >
                      {createInvitationMutation.isPending ? "Enviando..." : "Enviar invitación"}
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
                  No hay invitaciones con código/link. Creá una invitación por email arriba.
                </p>
              ) : (
                <div className="space-y-3">
                  {invitations.map((inv) => {
                    const status = getInvitationStatus(inv);
                    const StatusIcon = status.icon;
                    return (
                      <div
                        key={inv.id}
                        className="flex items-center justify-between p-4 rounded-lg border gap-4"
                        data-testid={`invitation-row-${inv.id}`}
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <div className={`p-2 rounded-full bg-muted shrink-0 ${status.color}`}>
                            <StatusIcon className="h-4 w-4" />
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <code className="font-mono text-sm bg-muted px-2 py-0.5 rounded">
                                {inv.inviteCode}
                              </code>
                              <Badge variant="outline" className="text-xs">
                                {ROLE_LABELS[inv.role || "encargado"]?.name || inv.role}
                              </Badge>
                            </div>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1 flex-wrap">
                              {inv.email && (
                                <span className="flex items-center gap-1 truncate">
                                  <Mail className="h-3 w-3 shrink-0" />
                                  {inv.email}
                                </span>
                              )}
                              <span>Expira: {formatDate(inv.expiresAt)}</span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
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

      <Dialog open={!!editingUser} onOpenChange={(open) => !open && setEditingUser(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar usuario</DialogTitle>
            <DialogDescription>Los cambios aplican solo a esta empresa cuando corresponda.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-2">
              <Label>Nombre</Label>
              <Input value={editFirstName} onChange={(e) => setEditFirstName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Apellido</Label>
              <Input value={editLastName} onChange={(e) => setEditLastName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input type="email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingUser(null)}>
              Cancelar
            </Button>
            <Button
              disabled={!editingUser || updateMemberMutation.isPending}
              onClick={() => {
                if (!editingUser) return;
                updateMemberMutation.mutate({
                  id: editingUser.id,
                  body: {
                    firstName: editFirstName,
                    lastName: editLastName,
                    email: editEmail.trim(),
                  },
                });
              }}
            >
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!roleTarget} onOpenChange={(open) => !open && setRoleTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rol en la empresa</DialogTitle>
            <DialogDescription>Cambiar el rol solo en esta empresa (tabla de equipo).</DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Select value={newRole} onValueChange={setNewRole}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLE_OPTIONS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {ROLE_LABELS[r]?.name ?? r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRoleTarget(null)}>
              Cancelar
            </Button>
            <Button
              disabled={!roleTarget || updateRoleMutation.isPending}
              onClick={() => {
                if (!roleTarget) return;
                updateRoleMutation.mutate({ id: roleTarget.id, role: newRole });
              }}
            >
              Guardar rol
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmResetUser} onOpenChange={(open) => !open && setConfirmResetUser(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Resetear contraseña?</AlertDialogTitle>
            <AlertDialogDescription>
              Se generará una contraseña provisoria y se enviará por correo a{" "}
              <strong>{confirmResetUser?.email}</strong>. Deberá cambiarla al iniciar sesión (si el SMTP está bien
              configurado).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (confirmResetUser) resetPasswordMutation.mutate(confirmResetUser.id);
              }}
            >
              Confirmar envío
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!confirmDeleteUser} onOpenChange={(open) => !open && setConfirmDeleteUser(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Quitar del equipo?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta persona pierde acceso a los datos de tu empresa. No podés usar esta opción sobre tu propio usuario desde
              acá.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                if (confirmDeleteUser) removeMemberMutation.mutate(confirmDeleteUser.id);
              }}
            >
              Quitar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
