import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { PageHeader } from "@/components/page-header";
import { DataTable, Column } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatDate, formatNumber } from "@/lib/formatters";
import { ClipboardList, FileCheck, Plus, Eye, AlertCircle } from "lucide-react";
import type { OperationalAudit, AuditTemplate, Local } from "@shared/schema";

const auditFormSchema = z.object({
  localId: z.coerce.number().min(1, "Seleccione un local"),
  auditType: z.string().min(1, "Seleccione un tipo"),
  auditDate: z.string().min(1, "Fecha requerida"),
  notes: z.string().optional(),
});

const templateFormSchema = z.object({
  name: z.string().min(1, "Nombre requerido"),
  auditType: z.string().min(1, "Tipo requerido"),
  description: z.string().optional(),
});

type AuditFormData = z.infer<typeof auditFormSchema>;
type TemplateFormData = z.infer<typeof templateFormSchema>;

export default function AuditsPage() {
  const { toast } = useToast();
  const [isAuditDialogOpen, setIsAuditDialogOpen] = useState(false);
  const [isTemplateDialogOpen, setIsTemplateDialogOpen] = useState(false);
  const [selectedAudit, setSelectedAudit] = useState<OperationalAudit | null>(null);

  const { data: audits = [], isLoading, isError: isAuditsError } = useQuery<OperationalAudit[]>({
    queryKey: ["/api/operational-audits"],
  });

  const { data: templates = [], isError: isTemplatesError } = useQuery<AuditTemplate[]>({
    queryKey: ["/api/audit-templates"],
  });

  const { data: locals = [], isError: isLocalsError } = useQuery<Local[]>({
    queryKey: ["/api/locals"],
  });

  const hasError = isAuditsError || isTemplatesError || isLocalsError;

  const auditForm = useForm<AuditFormData>({
    resolver: zodResolver(auditFormSchema),
    defaultValues: {
      localId: 0,
      auditType: "",
      auditDate: new Date().toISOString().split("T")[0],
      notes: "",
    },
  });

  const templateForm = useForm<TemplateFormData>({
    resolver: zodResolver(templateFormSchema),
    defaultValues: {
      name: "",
      auditType: "",
      description: "",
    },
  });

  const createAuditMutation = useMutation({
    mutationFn: async (data: AuditFormData) => {
      const res = await apiRequest("POST", "/api/operational-audits", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/operational-audits"] });
      toast({ title: "Auditoria creada correctamente" });
      setIsAuditDialogOpen(false);
      auditForm.reset();
    },
    onError: (error: Error) => {
      toast({ title: "Error al crear auditoria", description: error.message, variant: "destructive" });
    },
  });

  const createTemplateMutation = useMutation({
    mutationFn: async (data: TemplateFormData) => {
      const res = await apiRequest("POST", "/api/audit-templates", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/audit-templates"] });
      toast({ title: "Plantilla creada correctamente" });
      setIsTemplateDialogOpen(false);
      templateForm.reset();
    },
    onError: (error: Error) => {
      toast({ title: "Error al crear plantilla", description: error.message, variant: "destructive" });
    },
  });

  const getLocalName = (localId: number) => {
    const local = locals.find(l => l.id === localId);
    return local?.name || "N/A";
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "completed":
        return <Badge variant="default">Completada</Badge>;
      case "in_progress":
        return <Badge variant="secondary">En Progreso</Badge>;
      default:
        return <Badge variant="outline">Borrador</Badge>;
    }
  };

  const getApprovalColor = (percentage: number) => {
    if (percentage >= 90) return "text-green-500";
    if (percentage >= 70) return "text-yellow-500";
    return "text-red-500";
  };

  const auditColumns: Column<OperationalAudit>[] = [
    { key: "auditDate", header: "Fecha", cell: (row) => formatDate(row.auditDate) },
    { key: "auditType", header: "Tipo" },
    { key: "localId", header: "Local", cell: (row) => getLocalName(row.localId) },
    { key: "status", header: "Estado", cell: (row) => getStatusBadge(row.status || "draft") },
    { 
      key: "approvalPercentage", 
      header: "Aprobacion",
      cell: (row) => {
        const pct = parseFloat(String(row.approvalPercentage) || "0");
        return (
          <div className="flex items-center gap-2">
            <Progress value={pct} className="w-20" />
            <span className={getApprovalColor(pct)}>{formatNumber(pct)}%</span>
          </div>
        );
      },
    },
    {
      key: "totalItems",
      header: "Items",
      cell: (row) => `${row.approvedItems || 0}/${row.totalItems || 0}`,
    },
    {
      key: "id",
      header: "Acciones",
      cell: (row) => (
        <Button 
          variant="ghost" 
          size="icon" 
          onClick={() => setSelectedAudit(row)}
          data-testid={`button-view-${row.id}`}
        >
          <Eye className="h-4 w-4" />
        </Button>
      ),
    },
  ];

  const templateColumns: Column<AuditTemplate>[] = [
    { key: "name", header: "Nombre" },
    { key: "auditType", header: "Tipo" },
    { key: "description", header: "Descripcion" },
    {
      key: "active",
      header: "Estado",
      cell: (row) => (
        <Badge variant={row.active ? "default" : "secondary"}>
          {row.active ? "Activo" : "Inactivo"}
        </Badge>
      ),
    },
  ];

  const auditTypes = [
    { value: "operativa", label: "Operativa" },
    { value: "financiera", label: "Financiera" },
    { value: "administrativa", label: "Administrativa" },
    { value: "higiene", label: "Higiene y Seguridad" },
    { value: "calidad", label: "Calidad" },
  ];

  const completedAudits = audits.filter(a => a.status === "completed");
  const avgApproval = completedAudits.length > 0
    ? completedAudits.reduce((sum, a) => sum + parseFloat(String(a.approvalPercentage) || "0"), 0) / completedAudits.length
    : 0;

  if (hasError) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Auditorias Operativas"
          description="Control de calidad y cumplimiento"
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
        title="Auditorias Operativas"
        description="Control de calidad y cumplimiento"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setIsTemplateDialogOpen(true)} data-testid="button-new-template">
              <Plus className="h-4 w-4 mr-2" />
              Nueva Plantilla
            </Button>
            <Button onClick={() => setIsAuditDialogOpen(true)} data-testid="button-new-audit">
              <ClipboardList className="h-4 w-4 mr-2" />
              Nueva Auditoria
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Auditorias</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{audits.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Completadas</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{completedAudits.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Promedio Aprobacion</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${getApprovalColor(avgApproval)}`}>
              {formatNumber(avgApproval)}%
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="audits">
        <TabsList>
          <TabsTrigger value="audits" data-testid="tab-audits">
            <ClipboardList className="h-4 w-4 mr-2" />
            Auditorias
          </TabsTrigger>
          <TabsTrigger value="templates" data-testid="tab-templates">
            <FileCheck className="h-4 w-4 mr-2" />
            Plantillas
          </TabsTrigger>
        </TabsList>
        
        <TabsContent value="audits">
          <DataTable
            columns={auditColumns}
            data={audits}
            isLoading={isLoading}
            searchPlaceholder="Buscar auditorias..."
          />
        </TabsContent>
        
        <TabsContent value="templates">
          <DataTable
            columns={templateColumns}
            data={templates}
            isLoading={isLoading}
            searchPlaceholder="Buscar plantillas..."
          />
        </TabsContent>
      </Tabs>

      <Dialog open={isAuditDialogOpen} onOpenChange={setIsAuditDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Nueva Auditoria</DialogTitle>
          </DialogHeader>
          <Form {...auditForm}>
            <form onSubmit={auditForm.handleSubmit((data) => createAuditMutation.mutate(data))} className="space-y-4">
              <FormField
                control={auditForm.control}
                name="localId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Local</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value?.toString()}>
                      <FormControl>
                        <SelectTrigger data-testid="select-local">
                          <SelectValue placeholder="Seleccionar local" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {locals.map((local) => (
                          <SelectItem key={local.id} value={local.id.toString()}>
                            {local.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={auditForm.control}
                name="auditType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tipo de Auditoria</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-type">
                          <SelectValue placeholder="Seleccionar tipo" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {auditTypes.map((type) => (
                          <SelectItem key={type.value} value={type.value}>
                            {type.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={auditForm.control}
                name="auditDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Fecha</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} data-testid="input-date" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={auditForm.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notas</FormLabel>
                    <FormControl>
                      <Textarea {...field} data-testid="input-notes" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setIsAuditDialogOpen(false)}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={createAuditMutation.isPending} data-testid="button-submit">
                  {createAuditMutation.isPending ? "Creando..." : "Crear Auditoria"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={isTemplateDialogOpen} onOpenChange={setIsTemplateDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Nueva Plantilla de Auditoria</DialogTitle>
          </DialogHeader>
          <Form {...templateForm}>
            <form onSubmit={templateForm.handleSubmit((data) => createTemplateMutation.mutate(data))} className="space-y-4">
              <FormField
                control={templateForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nombre</FormLabel>
                    <FormControl>
                      <Input {...field} data-testid="input-name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={templateForm.control}
                name="auditType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tipo</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-template-type">
                          <SelectValue placeholder="Seleccionar tipo" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {auditTypes.map((type) => (
                          <SelectItem key={type.value} value={type.value}>
                            {type.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={templateForm.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Descripcion</FormLabel>
                    <FormControl>
                      <Textarea {...field} data-testid="input-description" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setIsTemplateDialogOpen(false)}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={createTemplateMutation.isPending} data-testid="button-submit-template">
                  {createTemplateMutation.isPending ? "Creando..." : "Crear Plantilla"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!selectedAudit} onOpenChange={(open) => !open && setSelectedAudit(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Detalle de Auditoria</DialogTitle>
          </DialogHeader>
          {selectedAudit && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Fecha</p>
                  <p className="font-medium">{formatDate(selectedAudit.auditDate)}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Tipo</p>
                  <p className="font-medium">{selectedAudit.auditType}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Local</p>
                  <p className="font-medium">{getLocalName(selectedAudit.localId)}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Estado</p>
                  {getStatusBadge(selectedAudit.status || "draft")}
                </div>
              </div>
              <div>
                <p className="text-sm text-muted-foreground mb-2">Resultado</p>
                <div className="flex items-center gap-4">
                  <Progress 
                    value={parseFloat(String(selectedAudit.approvalPercentage) || "0")} 
                    className="flex-1" 
                  />
                  <span className={`font-bold ${getApprovalColor(parseFloat(String(selectedAudit.approvalPercentage) || "0"))}`}>
                    {formatNumber(parseFloat(String(selectedAudit.approvalPercentage) || "0"))}%
                  </span>
                </div>
                <p className="text-sm text-muted-foreground mt-2">
                  {selectedAudit.approvedItems || 0} de {selectedAudit.totalItems || 0} items aprobados
                </p>
              </div>
              {selectedAudit.notes && (
                <div>
                  <p className="text-sm text-muted-foreground">Notas</p>
                  <p>{selectedAudit.notes}</p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
