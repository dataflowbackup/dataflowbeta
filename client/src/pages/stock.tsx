import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm, useWatch } from "react-hook-form";
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
  FormDescription,
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
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatNumber, formatDate } from "@/lib/formatters";
import { Package, ArrowUpDown, AlertTriangle, ClipboardCheck, AlertCircle } from "lucide-react";
import type { StockLevel, StockAdjustment, StockMovement, Supply, Local } from "@shared/schema";

const adjustmentSchema = z.object({
  localId: z.coerce.number().min(1, "Seleccione un local"),
  supplyId: z.coerce.number().min(1, "Seleccione un insumo"),
  theoreticalBefore: z.coerce.number(),
  actualCount: z.coerce.number().min(0, "La cantidad debe ser positiva"),
  reason: z.string().optional(),
});

type AdjustmentFormData = z.infer<typeof adjustmentSchema>;

export default function StockPage() {
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedLocal, setSelectedLocal] = useState<string>("all");

  const stockLevelsUrl = selectedLocal === "all" 
    ? "/api/stock-levels" 
    : `/api/stock-levels?localId=${selectedLocal}`;
  
  const { data: stockLevels = [], isLoading, isError: isStockError } = useQuery<StockLevel[]>({
    queryKey: [stockLevelsUrl],
  });

  const adjustmentsUrl = selectedLocal === "all"
    ? "/api/stock-adjustments"
    : `/api/stock-adjustments?localId=${selectedLocal}`;

  const { data: adjustments = [], isError: isAdjustmentsError } = useQuery<StockAdjustment[]>({
    queryKey: [adjustmentsUrl],
  });

  const movementsUrl = selectedLocal === "all"
    ? "/api/stock-movements"
    : `/api/stock-movements?localId=${selectedLocal}`;

  const { data: movements = [], isError: isMovementsError } = useQuery<StockMovement[]>({
    queryKey: [movementsUrl],
  });

  const { data: supplies = [], isError: isSuppliesError } = useQuery<Supply[]>({
    queryKey: ["/api/supplies"],
  });

  const { data: locals = [], isError: isLocalsError } = useQuery<Local[]>({
    queryKey: ["/api/locals"],
  });

  const form = useForm<AdjustmentFormData>({
    resolver: zodResolver(adjustmentSchema),
    defaultValues: {
      localId: 0,
      supplyId: 0,
      theoreticalBefore: 0,
      actualCount: 0,
      reason: "",
    },
  });

  const watchedLocalId = useWatch({ control: form.control, name: "localId" });
  const watchedSupplyId = useWatch({ control: form.control, name: "supplyId" });

  useEffect(() => {
    if (watchedLocalId && watchedSupplyId) {
      const stockLevel = stockLevels.find(
        s => s.localId === Number(watchedLocalId) && s.supplyId === Number(watchedSupplyId)
      );
      if (stockLevel) {
        const theoretical = parseFloat(String(stockLevel.theoreticalStock) || "0");
        form.setValue("theoreticalBefore", theoretical);
      } else {
        form.setValue("theoreticalBefore", 0);
      }
    }
  }, [watchedLocalId, watchedSupplyId, stockLevels, form]);

  const adjustMutation = useMutation({
    mutationFn: async (data: AdjustmentFormData) => {
      const difference = data.actualCount - data.theoreticalBefore;
      const res = await apiRequest("POST", "/api/stock-adjustments", {
        localId: data.localId,
        supplyId: data.supplyId,
        theoreticalBefore: data.theoreticalBefore.toString(),
        actualCount: data.actualCount.toString(),
        difference: difference.toString(),
        reason: data.reason,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: (query) => {
        const key = query.queryKey[0]?.toString() || "";
        return key.startsWith("/api/stock-levels") || key.startsWith("/api/stock-adjustments");
      }});
      toast({ title: "Ajuste de stock registrado correctamente" });
      setIsDialogOpen(false);
      form.reset();
    },
    onError: (error: Error) => {
      toast({ title: "Error al registrar ajuste", description: error.message, variant: "destructive" });
    },
  });

  const getSupplyName = (supplyId: number) => {
    const supply = supplies.find(s => s.id === supplyId);
    return supply?.name || "N/A";
  };

  const getLocalName = (localId: number) => {
    const local = locals.find(l => l.id === localId);
    return local?.name || "N/A";
  };

  const handleOpenAdjustFromRow = (row: StockLevel) => {
    form.reset({
      localId: row.localId,
      supplyId: row.supplyId,
      theoreticalBefore: parseFloat(String(row.theoreticalStock) || "0"),
      actualCount: 0,
      reason: "",
    });
    setIsDialogOpen(true);
  };

  const stockColumns: Column<StockLevel>[] = [
    { key: "supplyId", header: "Insumo", cell: (row) => getSupplyName(row.supplyId) },
    { key: "localId", header: "Local", cell: (row) => getLocalName(row.localId) },
    { 
      key: "theoreticalStock", 
      header: "Stock Teorico",
      cell: (row) => formatNumber(parseFloat(String(row.theoreticalStock) || "0")),
    },
    { 
      key: "actualStock", 
      header: "Stock Real",
      cell: (row) => formatNumber(parseFloat(String(row.actualStock) || "0")),
    },
    { 
      key: "minimumStock", 
      header: "Stock Minimo",
      cell: (row) => formatNumber(parseFloat(String(row.minimumStock) || "0")),
    },
    {
      key: "id",
      header: "Estado",
      cell: (row) => {
        const actual = parseFloat(String(row.actualStock) || "0");
        const minimum = parseFloat(String(row.minimumStock) || "0");
        if (minimum > 0 && actual <= minimum) {
          return <Badge variant="destructive">Bajo</Badge>;
        }
        return <Badge variant="secondary">Normal</Badge>;
      },
    },
    {
      key: "id",
      header: "Acciones",
      cell: (row) => (
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={() => handleOpenAdjustFromRow(row)}
          data-testid={`button-adjust-${row.id}`}
        >
          <ClipboardCheck className="h-4 w-4 mr-1" />
          Contar
        </Button>
      ),
    },
  ];

  const adjustmentColumns: Column<StockAdjustment>[] = [
    { key: "createdAt", header: "Fecha", cell: (row) => formatDate(row.createdAt as unknown as string) },
    { key: "supplyId", header: "Insumo", cell: (row) => getSupplyName(row.supplyId) },
    { key: "localId", header: "Local", cell: (row) => getLocalName(row.localId) },
    { 
      key: "theoreticalBefore", 
      header: "Teorico",
      cell: (row) => formatNumber(parseFloat(String(row.theoreticalBefore) || "0")),
    },
    { 
      key: "actualCount", 
      header: "Conteo Real",
      cell: (row) => formatNumber(parseFloat(String(row.actualCount) || "0")),
    },
    {
      key: "difference",
      header: "Diferencia",
      cell: (row) => {
        const diff = parseFloat(String(row.difference) || "0");
        const color = diff < 0 ? "text-red-500" : diff > 0 ? "text-green-500" : "";
        return <span className={color}>{diff > 0 ? "+" : ""}{formatNumber(diff)}</span>;
      },
    },
    { key: "reason", header: "Motivo" },
  ];

  const movementColumns: Column<StockMovement>[] = [
    { key: "createdAt", header: "Fecha", cell: (row) => formatDate(row.createdAt as unknown as string) },
    { key: "supplyId", header: "Insumo", cell: (row) => getSupplyName(row.supplyId) },
    { key: "localId", header: "Local", cell: (row) => getLocalName(row.localId) },
    { key: "movementType", header: "Tipo" },
    { 
      key: "quantity", 
      header: "Cantidad",
      cell: (row) => formatNumber(parseFloat(String(row.quantity) || "0")),
    },
    { key: "notes", header: "Notas" },
  ];

  const lowStockItems = stockLevels.filter(s => {
    const actual = parseFloat(String(s.actualStock) || "0");
    const minimum = parseFloat(String(s.minimumStock) || "0");
    return minimum > 0 && actual <= minimum;
  });

  const hasError = isStockError || isAdjustmentsError || isMovementsError || isSuppliesError || isLocalsError;

  if (hasError) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Control de Stock"
          description="Gestion de inventario teorico vs real"
        />
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Error al cargar los datos de stock. Por favor, intente nuevamente.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Control de Stock"
        description="Gestion de inventario teorico vs real"
        actions={
          <Button onClick={() => {
            form.reset({
              localId: 0,
              supplyId: 0,
              theoreticalBefore: 0,
              actualCount: 0,
              reason: "",
            });
            setIsDialogOpen(true);
          }} data-testid="button-new-adjustment">
            <ClipboardCheck className="h-4 w-4 mr-2" />
            Registrar Conteo
          </Button>
        }
      />

      <div className="flex items-center gap-4">
        <Select value={selectedLocal} onValueChange={setSelectedLocal}>
          <SelectTrigger className="w-[200px]" data-testid="select-local-filter">
            <SelectValue placeholder="Todos los locales" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los locales</SelectItem>
            {locals.map((local) => (
              <SelectItem key={local.id} value={local.id.toString()}>
                {local.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {lowStockItems.length > 0 && (
        <Card className="border-destructive">
          <CardHeader className="pb-2">
            <CardTitle className="text-destructive flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              Alertas de Stock Bajo ({lowStockItems.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {lowStockItems.map((item) => (
                <Badge key={item.id} variant="destructive">
                  {getSupplyName(item.supplyId)} - {getLocalName(item.localId)}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="levels">
        <TabsList>
          <TabsTrigger value="levels" data-testid="tab-levels">
            <Package className="h-4 w-4 mr-2" />
            Niveles de Stock
          </TabsTrigger>
          <TabsTrigger value="adjustments" data-testid="tab-adjustments">
            <ClipboardCheck className="h-4 w-4 mr-2" />
            Ajustes
          </TabsTrigger>
          <TabsTrigger value="movements" data-testid="tab-movements">
            <ArrowUpDown className="h-4 w-4 mr-2" />
            Movimientos
          </TabsTrigger>
        </TabsList>
        
        <TabsContent value="levels">
          <DataTable
            columns={stockColumns}
            data={stockLevels}
            isLoading={isLoading}
            searchPlaceholder="Buscar por insumo..."
            emptyMessage="No hay niveles de stock registrados"
          />
        </TabsContent>
        
        <TabsContent value="adjustments">
          <DataTable
            columns={adjustmentColumns}
            data={adjustments}
            isLoading={isLoading}
            searchPlaceholder="Buscar ajustes..."
            emptyMessage="No hay ajustes de stock registrados"
          />
        </TabsContent>
        
        <TabsContent value="movements">
          <DataTable
            columns={movementColumns}
            data={movements}
            isLoading={isLoading}
            searchPlaceholder="Buscar movimientos..."
            emptyMessage="No hay movimientos de stock registrados"
          />
        </TabsContent>
      </Tabs>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Registrar Conteo de Stock</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit((data) => adjustMutation.mutate(data))} className="space-y-4">
              <FormField
                control={form.control}
                name="localId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Local</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value ? field.value.toString() : ""}>
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
                control={form.control}
                name="supplyId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Insumo</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value ? field.value.toString() : ""}>
                      <FormControl>
                        <SelectTrigger data-testid="select-supply">
                          <SelectValue placeholder="Seleccionar insumo" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {supplies.map((supply) => (
                          <SelectItem key={supply.id} value={supply.id.toString()}>
                            {supply.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="theoreticalBefore"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Stock Teorico Actual</FormLabel>
                    <FormControl>
                      <Input 
                        type="number" 
                        step="0.01" 
                        {...field} 
                        readOnly 
                        className="bg-muted"
                        data-testid="input-theoretical" 
                      />
                    </FormControl>
                    <FormDescription>
                      Se calcula automaticamente segun el local e insumo seleccionados
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="actualCount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Conteo Real</FormLabel>
                    <FormControl>
                      <Input type="number" step="0.01" {...field} data-testid="input-actual" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="reason"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Motivo del Ajuste</FormLabel>
                    <FormControl>
                      <Textarea {...field} data-testid="input-reason" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={adjustMutation.isPending} data-testid="button-submit">
                  {adjustMutation.isPending ? "Guardando..." : "Registrar"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
