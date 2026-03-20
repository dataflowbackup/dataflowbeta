import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatDate } from "@/lib/formatters";
import { 
  Bell, 
  BellRing, 
  CheckCheck, 
  AlertCircle,
  Info,
  AlertTriangle,
  ShieldAlert,
  Package,
  Receipt,
  Users,
  Clock,
} from "lucide-react";
import type { Notification } from "@shared/schema";

const TYPE_CONFIG: Record<string, { icon: typeof Bell; color: string; label: string }> = {
  info: { icon: Info, color: "text-blue-500", label: "Informacion" },
  warning: { icon: AlertTriangle, color: "text-yellow-500", label: "Advertencia" },
  error: { icon: ShieldAlert, color: "text-red-500", label: "Error" },
  stock: { icon: Package, color: "text-orange-500", label: "Stock" },
  invoice: { icon: Receipt, color: "text-green-500", label: "Factura" },
  employee: { icon: Users, color: "text-purple-500", label: "Empleado" },
  system: { icon: Bell, color: "text-gray-500", label: "Sistema" },
};

const PRIORITY_CONFIG: Record<string, { color: string; label: string }> = {
  low: { color: "bg-gray-500/10 text-gray-600 dark:text-gray-400", label: "Baja" },
  normal: { color: "bg-blue-500/10 text-blue-600 dark:text-blue-400", label: "Normal" },
  high: { color: "bg-orange-500/10 text-orange-600 dark:text-orange-400", label: "Alta" },
  urgent: { color: "bg-red-500/10 text-red-600 dark:text-red-400", label: "Urgente" },
};

export default function NotificationsPage() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("all");

  const { data: notifications = [], isLoading, isError } = useQuery<Notification[]>({
    queryKey: ["/api/notifications"],
  });

  const markReadMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("PATCH", `/api/notifications/${id}/read`, {});
      return res.json();
    },
    onMutate: async (id: number) => {
      await queryClient.cancelQueries({ queryKey: ["/api/notifications"] });
      const previousNotifications = queryClient.getQueryData<Notification[]>(["/api/notifications"]);
      queryClient.setQueryData<Notification[]>(["/api/notifications"], (old) =>
        old?.map(n => n.id === id ? { ...n, read: true, readAt: new Date() } : n)
      );
      return { previousNotifications };
    },
    onError: (_err, _id, context) => {
      if (context?.previousNotifications) {
        queryClient.setQueryData(["/api/notifications"], context.previousNotifications);
      }
      toast({ title: "Error al marcar como leida", variant: "destructive" });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: async (unreadIds: number[]) => {
      if (unreadIds.length === 0) return;
      for (const id of unreadIds) {
        await apiRequest("PATCH", `/api/notifications/${id}/read`, {});
      }
    },
    onMutate: async (unreadIds: number[]) => {
      if (unreadIds.length === 0) return { previousNotifications: undefined };
      await queryClient.cancelQueries({ queryKey: ["/api/notifications"] });
      const previousNotifications = queryClient.getQueryData<Notification[]>(["/api/notifications"]);
      queryClient.setQueryData<Notification[]>(["/api/notifications"], (old) =>
        old?.map(n => unreadIds.includes(n.id) ? { ...n, read: true, readAt: new Date() } : n)
      );
      return { previousNotifications };
    },
    onError: (_err, _vars, context) => {
      if (context?.previousNotifications) {
        queryClient.setQueryData(["/api/notifications"], context.previousNotifications);
      }
      toast({ title: "Error al marcar todas como leidas", variant: "destructive" });
    },
    onSuccess: (_data, unreadIds) => {
      if (unreadIds.length > 0) {
        toast({ title: "Todas las notificaciones marcadas como leidas" });
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
    },
  });

  const unreadCount = notifications.filter(n => !n.read).length;
  const filteredNotifications = activeTab === "unread" 
    ? notifications.filter(n => !n.read)
    : notifications;

  const groupedByDate = filteredNotifications.reduce((acc, notif) => {
    const dateKey = notif.createdAt ? new Date(notif.createdAt).toDateString() : "Sin fecha";
    if (!acc[dateKey]) {
      acc[dateKey] = [];
    }
    acc[dateKey].push(notif);
    return acc;
  }, {} as Record<string, Notification[]>);

  const formatGroupDate = (dateStr: string) => {
    if (dateStr === "Sin fecha") return dateStr;
    const date = new Date(dateStr);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) return "Hoy";
    if (date.toDateString() === yesterday.toDateString()) return "Ayer";
    return formatDate(dateStr);
  };

  if (isError) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Notificaciones"
          description="Centro de alertas y avisos del sistema"
        />
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Error al cargar las notificaciones. Por favor, intente nuevamente.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notificaciones"
        description={unreadCount > 0 ? `${unreadCount} sin leer` : "Todas leidas"}
        actions={
          unreadCount > 0 && (
            <Button 
              variant="outline"
              onClick={() => {
                const unreadIds = notifications.filter(n => !n.read).map(n => n.id);
                if (unreadIds.length > 0) {
                  markAllReadMutation.mutate(unreadIds);
                }
              }}
              disabled={markAllReadMutation.isPending}
              data-testid="button-mark-all-read"
            >
              <CheckCheck className="h-4 w-4 mr-2" />
              Marcar todas como leidas
            </Button>
          )
        }
      />

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Bell className="h-4 w-4 text-muted-foreground" />
              Total
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-count">{notifications.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <BellRing className="h-4 w-4 text-blue-500" />
              Sin Leer
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600" data-testid="text-unread-count">{unreadCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-orange-500" />
              Alta Prioridad
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600" data-testid="text-high-priority-count">
              {notifications.filter(n => n.priority === "high" || n.priority === "urgent").length}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              Ultimas 24h
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-recent-count">
              {notifications.filter(n => {
                if (!n.createdAt) return false;
                const created = new Date(n.createdAt);
                const now = new Date();
                return (now.getTime() - created.getTime()) < 24 * 60 * 60 * 1000;
              }).length}
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="all" data-testid="tab-all">
            Todas
          </TabsTrigger>
          <TabsTrigger value="unread" data-testid="tab-unread">
            Sin Leer {unreadCount > 0 && <Badge variant="secondary" className="ml-2">{unreadCount}</Badge>}
          </TabsTrigger>
        </TabsList>

        <TabsContent value={activeTab} className="mt-4">
          {isLoading ? (
            <div className="space-y-4">
              {[1, 2, 3, 4, 5].map(i => (
                <Card key={i}>
                  <CardContent className="p-4">
                    <div className="flex items-start gap-4">
                      <Skeleton className="h-10 w-10 rounded-full" />
                      <div className="flex-1 space-y-2">
                        <Skeleton className="h-4 w-48" />
                        <Skeleton className="h-3 w-full" />
                        <Skeleton className="h-3 w-24" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : filteredNotifications.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Bell className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold mb-2">
                  {activeTab === "unread" ? "No hay notificaciones sin leer" : "No hay notificaciones"}
                </h3>
                <p className="text-muted-foreground">
                  {activeTab === "unread" 
                    ? "Todas las notificaciones han sido leidas."
                    : "Las notificaciones del sistema apareceran aqui."}
                </p>
              </CardContent>
            </Card>
          ) : (
            <ScrollArea className="h-[600px]">
              <div className="space-y-6">
                {Object.entries(groupedByDate).map(([dateKey, dateNotifs]) => (
                  <div key={dateKey}>
                    <h3 className="text-sm font-semibold text-muted-foreground mb-3">
                      {formatGroupDate(dateKey)}
                    </h3>
                    <div className="space-y-2">
                      {dateNotifs.map(notif => {
                        const typeConfig = TYPE_CONFIG[notif.type] || TYPE_CONFIG.system;
                        const priorityConfig = PRIORITY_CONFIG[notif.priority || "normal"] || PRIORITY_CONFIG.normal;
                        const TypeIcon = typeConfig.icon;

                        return (
                          <Card 
                            key={notif.id}
                            className={`transition-all ${!notif.read ? "border-l-4 border-l-primary bg-accent/30" : ""}`}
                            data-testid={`card-notification-${notif.id}`}
                          >
                            <CardContent className="p-4">
                              <div className="flex items-start gap-4">
                                <div className={`rounded-full p-2 bg-muted ${typeConfig.color}`}>
                                  <TypeIcon className="h-5 w-5" />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 mb-1">
                                    <h4 className="font-semibold truncate">{notif.title}</h4>
                                    <Badge variant="outline" className={priorityConfig.color}>
                                      {priorityConfig.label}
                                    </Badge>
                                    <Badge variant="secondary" className="text-xs">
                                      {typeConfig.label}
                                    </Badge>
                                  </div>
                                  {notif.message && (
                                    <p className="text-sm text-muted-foreground mb-2">{notif.message}</p>
                                  )}
                                  <div className="flex items-center justify-between">
                                    <span className="text-xs text-muted-foreground">
                                      {notif.createdAt && formatDate(notif.createdAt.toString())}
                                    </span>
                                    {!notif.read && (
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => markReadMutation.mutate(notif.id)}
                                        disabled={markReadMutation.isPending}
                                        data-testid={`button-mark-read-${notif.id}`}
                                      >
                                        <CheckCheck className="h-4 w-4 mr-1" />
                                        Marcar como leida
                                      </Button>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
