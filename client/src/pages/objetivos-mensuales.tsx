import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { formatCurrency } from "@/lib/formatters";
import { Save, Trash2, Target, ChevronLeft, ChevronRight } from "lucide-react";
import type { Local } from "@shared/schema";

const MONTH_NAMES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

interface MonthlyGoal {
  id: number;
  localId: number;
  year: number;
  month: number;
  facturacionObjetivo: string | null;
  ticketsObjetivo: number | null;
  cmvObjetivo: string | null;
}

interface RowState {
  facturacion: string;
  tickets: string;
  cmv: string;
  dirty: boolean;
}

export default function ObjetivosMensualesPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: locals = [] } = useQuery<Local[]>({ queryKey: ["/api/locals"] });
  const { data: goals = [], isLoading } = useQuery<MonthlyGoal[]>({
    queryKey: ["/api/monthly-goals", year, month],
    queryFn: () => apiRequest("GET", `/api/monthly-goals?year=${year}&month=${month}`).then((r) => r.json()),
  });

  const goalByLocal = useMemo(() => new Map(goals.map((g) => [g.localId, g])), [goals]);

  const [rows, setRows] = useState<Map<number, RowState>>(new Map());

  const getRow = (localId: number): RowState => {
    if (rows.has(localId)) return rows.get(localId)!;
    const g = goalByLocal.get(localId);
    return {
      facturacion: g?.facturacionObjetivo ? String(parseFloat(g.facturacionObjetivo)) : "",
      tickets: g?.ticketsObjetivo != null ? String(g.ticketsObjetivo) : "",
      cmv: g?.cmvObjetivo ? String(parseFloat(g.cmvObjetivo)) : "",
      dirty: false,
    };
  };

  const setField = (localId: number, field: keyof Omit<RowState, "dirty">, value: string) => {
    setRows((prev) => {
      const current = getRow(localId);
      return new Map(prev).set(localId, { ...current, [field]: value, dirty: true });
    });
  };

  const saveMutation = useMutation({
    mutationFn: async ({ localId, row }: { localId: number; row: RowState }) => {
      const body = {
        localId,
        year,
        month,
        facturacionObjetivo: row.facturacion !== "" ? parseFloat(row.facturacion) : null,
        ticketsObjetivo: row.tickets !== "" ? parseInt(row.tickets, 10) : null,
        cmvObjetivo: row.cmv !== "" ? parseFloat(row.cmv) : null,
      };
      const res = await apiRequest("PUT", "/api/monthly-goals", body);
      return res.json();
    },
    onSuccess: (_, { localId }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/monthly-goals"] });
      setRows((prev) => {
        const next = new Map(prev);
        const current = next.get(localId);
        if (current) next.set(localId, { ...current, dirty: false });
        return next;
      });
      toast({ title: "Objetivo guardado" });
    },
    onError: (e: any) => toast({ title: "Error al guardar", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (localId: number) => {
      const res = await apiRequest("DELETE", "/api/monthly-goals", { localId, year, month });
      return res.json();
    },
    onSuccess: (_, localId) => {
      queryClient.invalidateQueries({ queryKey: ["/api/monthly-goals"] });
      setRows((prev) => {
        const next = new Map(prev);
        next.delete(localId);
        return next;
      });
      toast({ title: "Objetivo eliminado" });
    },
    onError: (e: any) => toast({ title: "Error al eliminar", description: e.message, variant: "destructive" }),
  });

  const prevMonth = () => { if (month === 1) { setYear((y) => y - 1); setMonth(12); } else setMonth((m) => m - 1); setRows(new Map()); };
  const nextMonth = () => { if (month === 12) { setYear((y) => y + 1); setMonth(1); } else setMonth((m) => m + 1); setRows(new Map()); };

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title="Objetivos Mensuales"
        description="Definí metas de facturación, tickets y CMV por local y mes"
      />

      {/* Month selector */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center gap-4">
            <Button variant="outline" size="icon" onClick={prevMonth}><ChevronLeft className="h-4 w-4" /></Button>
            <div className="text-center min-w-[160px]">
              <p className="text-lg font-semibold">{MONTH_NAMES[month - 1]} {year}</p>
            </div>
            <Button variant="outline" size="icon" onClick={nextMonth}><ChevronRight className="h-4 w-4" /></Button>
          </div>
        </CardContent>
      </Card>

      {/* Goals table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Objetivos por Local — {MONTH_NAMES[month - 1]} {year}</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Cargando...</div>
          ) : locals.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">No hay locales configurados</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 px-3 font-medium text-muted-foreground">Local</th>
                    <th className="text-center py-2 px-3 font-medium text-muted-foreground">Facturación Objetivo ($)</th>
                    <th className="text-center py-2 px-3 font-medium text-muted-foreground">Tickets Objetivo</th>
                    <th className="text-center py-2 px-3 font-medium text-muted-foreground">CMV Objetivo (%)</th>
                    <th className="py-2 px-3" />
                  </tr>
                </thead>
                <tbody>
                  {locals.map((local) => {
                    const row = getRow(local.id);
                    const hasGoal = goalByLocal.has(local.id);
                    return (
                      <tr key={local.id} className="border-b hover:bg-muted/30 transition-colors">
                        <td className="py-3 px-3">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{local.name}</span>
                            {hasGoal && !row.dirty && <Badge variant="secondary" className="text-xs">Guardado</Badge>}
                            {row.dirty && <Badge variant="outline" className="text-xs border-amber-400 text-amber-600">Sin guardar</Badge>}
                          </div>
                        </td>
                        <td className="py-3 px-3">
                          <Input
                            type="number"
                            min="0"
                            step="1000"
                            placeholder="0"
                            value={row.facturacion}
                            onChange={(e) => setField(local.id, "facturacion", e.target.value)}
                            className="text-right w-40 mx-auto"
                          />
                          {row.facturacion && (
                            <p className="text-xs text-center text-muted-foreground mt-1">{formatCurrency(parseFloat(row.facturacion) || 0)}</p>
                          )}
                        </td>
                        <td className="py-3 px-3">
                          <Input
                            type="number"
                            min="0"
                            step="10"
                            placeholder="0"
                            value={row.tickets}
                            onChange={(e) => setField(local.id, "tickets", e.target.value)}
                            className="text-right w-28 mx-auto"
                          />
                        </td>
                        <td className="py-3 px-3">
                          <div className="flex items-center gap-1 justify-center">
                            <Input
                              type="number"
                              min="0"
                              max="100"
                              step="0.1"
                              placeholder="0"
                              value={row.cmv}
                              onChange={(e) => setField(local.id, "cmv", e.target.value)}
                              className="text-right w-24"
                            />
                            <span className="text-muted-foreground">%</span>
                          </div>
                        </td>
                        <td className="py-3 px-3">
                          <div className="flex items-center gap-2 justify-end">
                            <Button
                              size="sm"
                              variant={row.dirty ? "default" : "outline"}
                              disabled={saveMutation.isPending}
                              onClick={() => saveMutation.mutate({ localId: local.id, row })}
                            >
                              <Save className="h-3 w-3 mr-1" />
                              Guardar
                            </Button>
                            {hasGoal && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-destructive hover:text-destructive"
                                disabled={deleteMutation.isPending}
                                onClick={() => deleteMutation.mutate(local.id)}
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
