/**
 * Solapa COMISIONES del Estado de Resultado Económico.
 *
 * Importe a mano por local y mes económico: Rappi, Pedidos Ya, Mercado Pago, Nave, Payway, más las
 * que se agreguen con nombre libre.
 *
 * Ojo con el doble conteo: estas comisiones YA entran como movimientos desde los extractos, con
 * categorías propias. Lo que se carga acá REEMPLAZA a esas categorías en el económico, igual que
 * el CMV reemplaza a la mercadería pagada. Si una categoría de comisión quedó computando, el
 * informe lo avisa.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatCurrency } from "@/lib/formatters";
import { Plus, Trash2, Save, Handshake } from "lucide-react";
import { COMMISSION_PRESETS, commissionLabel, isReservedCommissionConcept } from "@shared/economicStatement";
import type { Local } from "@shared/schema";
import { ECON, MoneyInput, LocalPicker } from "./econ-shared";

interface CommissionRow {
  id: number;
  localId: number;
  economicMonth: string;
  concept: string;
  amount: string | number | null;
  notes: string | null;
}

const num = (v: string | number | null | undefined) => parseFloat(String(v ?? "0")) || 0;

export function CommissionsTab({
  locals,
  economicMonth,
  monthLabel,
}: {
  locals: Local[];
  economicMonth: string;
  monthLabel: string;
}) {
  const { toast } = useToast();
  const [localId, setLocalId] = useState<number | null>(locals[0]?.id ?? null);
  useEffect(() => {
    if (localId == null && locals.length > 0) setLocalId(locals[0].id);
  }, [locals, localId]);

  const [drafts, setDrafts] = useState<Record<string, number>>({});
  const [newConcept, setNewConcept] = useState("");
  useEffect(() => {
    setDrafts({});
    setNewConcept("");
  }, [localId, economicMonth]);

  const { data: saved = [], isLoading } = useQuery<CommissionRow[]>({
    queryKey: ["/api/economic/commissions", localId, economicMonth],
    enabled: localId != null,
    queryFn: async () => {
      const res = await fetch(`/api/economic/commissions?localId=${localId}&economicMonth=${economicMonth}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const savedByConcept = useMemo(() => new Map(saved.map((r) => [r.concept, r])), [saved]);

  /** Los 8 del catálogo, más las agregadas a mano que ya tengan fila guardada. */
  const conceptos = useMemo(() => {
    const presets = COMMISSION_PRESETS.map((p) => p.concept);
    const extras = saved.map((r) => r.concept).filter((c) => !presets.includes(c));
    return [...presets, ...extras];
  }, [saved]);

  const amountFor = (concept: string) =>
    drafts[concept] !== undefined ? drafts[concept] : num(savedByConcept.get(concept)?.amount);

  const saveMut = useMutation({
    mutationFn: async (concept: string) => {
      const res = await apiRequest("POST", "/api/economic/commissions", {
        localId,
        economicMonth,
        concept,
        amount: amountFor(concept),
      });
      return res.json();
    },
    onSuccess: (_r, concept) => {
      queryClient.invalidateQueries({ queryKey: ["/api/economic/commissions"] });
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[concept];
        return next;
      });
      toast({ title: "Comisión guardada" });
    },
    onError: (e: Error) => toast({ title: "No se pudo guardar", description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/economic/commissions/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/economic/commissions"] });
      toast({ title: "Comisión eliminada" });
    },
    onError: (e: Error) => toast({ title: "No se pudo eliminar", description: e.message, variant: "destructive" }),
  });

  const agregar = () => {
    const c = newConcept.trim();
    if (!c) return;
    if (isReservedCommissionConcept(c)) {
      toast({ title: "Ese nombre ya está en la lista", description: "Cargá el importe en la fila que ya existe.", variant: "destructive" });
      return;
    }
    if (savedByConcept.has(c)) {
      toast({ title: "Ya existe esa comisión en el mes", variant: "destructive" });
      return;
    }
    setDrafts((prev) => ({ ...prev, [c]: 0 }));
    setNewConcept("");
    saveMut.mutate(c);
  };

  const total = saved.reduce((s, r) => s + num(r.amount), 0);

  if (locals.length === 0) return <p className="text-sm text-muted-foreground">No hay locales cargados.</p>;

  return (
    <div className="space-y-4">
      <Card className={ECON.border}>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Handshake className={`h-4 w-4 ${ECON.text}`} /> Comisiones de {monthLabel}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Lo que se carga acá reemplaza a las categorías de comisión de los extractos en el Estado de
            Resultado Económico. Si una de esas categorías quedó computando, el informe lo avisa.
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2">
            <LocalPicker locals={locals} value={localId} onChange={setLocalId} />
            <div className="space-y-1">
              <Label className="text-xs">Total de comisiones del mes</Label>
              <p className={`text-2xl font-bold font-mono ${ECON.text}`} data-testid="text-commissions-total">
                {formatCurrency(total)}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6 space-y-2">
          {isLoading ? (
            <div className="space-y-2">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : (
            conceptos.map((concept) => {
              const row = savedByConcept.get(concept);
              const dirty = drafts[concept] !== undefined;
              const esPreset = COMMISSION_PRESETS.some((p) => p.concept === concept);
              return (
                <div key={concept} className="flex items-center gap-2 py-1 border-b last:border-0">
                  <div className="flex-1 min-w-0 flex items-center gap-2">
                    <span className="text-sm truncate">{commissionLabel(concept)}</span>
                    {!esPreset && <Badge variant="secondary" className="text-[10px]">agregada</Badge>}
                  </div>
                  <MoneyInput
                    value={amountFor(concept)}
                    onChange={(v) => setDrafts((prev) => ({ ...prev, [concept]: v }))}
                    className="w-40"
                    testId={`input-commission-${concept}`}
                  />
                  <Button
                    size="sm"
                    variant={dirty ? "default" : "outline"}
                    className={dirty ? ECON.bgSolid : undefined}
                    disabled={saveMut.isPending || localId == null}
                    onClick={() => saveMut.mutate(concept)}
                    data-testid={`button-save-commission-${concept}`}
                  >
                    <Save className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-muted-foreground"
                    disabled={!row || deleteMut.isPending}
                    onClick={() => row && deleteMut.mutate(row.id)}
                    title={row ? "Eliminar del mes" : "Todavía no está guardada"}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              );
            })
          )}

          <div className="flex items-end gap-2 pt-3">
            <div className="space-y-1 flex-1">
              <Label className="text-xs">Agregar otra comisión</Label>
              <Input
                value={newConcept}
                onChange={(e) => setNewConcept(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && agregar()}
                placeholder="Ej: Uber Eats, Getnet, Cuenta DNI…"
                className={ECON.ring}
                data-testid="input-new-commission"
              />
            </div>
            <Button onClick={agregar} disabled={!newConcept.trim() || saveMut.isPending} className={ECON.bgSolid}>
              <Plus className="h-4 w-4 mr-1.5" /> Agregar
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
