/**
 * Solapa IMPUESTOS del Estado de Resultado Económico.
 *
 * Se cargan por local y por mes económico, porque cada local liquida por separado. Dos modos:
 *  - manual: el importe se escribe (IVA, Ganancias, Débito, Cheque salen de la liquidación).
 *  - calculado: alícuota × ventas del mes, pudiendo dejar medios de pago afuera (IIBB no se paga
 *    sobre lo que no facturás por ese medio; el impuesto al crédito no aplica al efectivo).
 *
 * El importe lo calcula SIEMPRE el servidor: acá se mandan los parámetros, no el total.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatCurrency } from "@/lib/formatters";
import { Calculator, Pencil, Save, Percent } from "lucide-react";
import { TAX_KINDS, type TaxKind, type TaxMode } from "@shared/economicStatement";
import type { Local } from "@shared/schema";
import { ECON, MoneyInput, LocalPicker } from "./econ-shared";

type SalesSource = "fudo" | "datalive" | "shares";

interface TaxRow {
  id: number;
  localId: number;
  economicMonth: string;
  taxKind: TaxKind;
  mode: TaxMode;
  ratePct: string | number | null;
  excludedPaymentMethods: string | null;
  manualAmount: string | number | null;
  calcBase: string | number | null;
  amount: string | number | null;
  notes: string | null;
}

interface PaymentMethodRow {
  method: string;
  amount: number;
}

const num = (v: string | number | null | undefined) => parseFloat(String(v ?? "0")) || 0;

/** Estado editable de una fila. Arranca del guardado o de los valores sugeridos del catálogo. */
interface Draft {
  mode: TaxMode;
  ratePct: number;
  excluded: string[];
  manualAmount: number;
}

export function TaxesTab({
  locals,
  economicMonth,
  monthLabel,
  salesSource,
}: {
  locals: Local[];
  economicMonth: string;
  monthLabel: string;
  salesSource: SalesSource;
}) {
  const { toast } = useToast();
  const [localId, setLocalId] = useState<number | null>(locals[0]?.id ?? null);
  useEffect(() => {
    if (localId == null && locals.length > 0) setLocalId(locals[0].id);
  }, [locals, localId]);

  const { data: saved = [], isLoading } = useQuery<TaxRow[]>({
    queryKey: ["/api/economic/taxes", localId, economicMonth],
    enabled: localId != null,
    queryFn: async () => {
      const res = await fetch(`/api/economic/taxes?localId=${localId}&economicMonth=${economicMonth}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  /** Ventas del mes por medio de pago: la base del cálculo y la lista para excluir. */
  const { data: methods = [] } = useQuery<PaymentMethodRow[]>({
    queryKey: ["/api/economic/payment-methods", localId, economicMonth, salesSource],
    enabled: localId != null,
    queryFn: async () => {
      const res = await fetch(
        `/api/economic/payment-methods?localId=${localId}&economicMonth=${economicMonth}&source=${salesSource}`,
        { credentials: "include" },
      );
      if (!res.ok) return [];
      return res.json();
    },
  });

  const savedByKind = useMemo(() => new Map(saved.map((r) => [r.taxKind, r])), [saved]);

  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  // Al cambiar de local o de mes se descartan los borradores: son de esa combinación.
  useEffect(() => setDrafts({}), [localId, economicMonth]);

  const draftFor = (kind: TaxKind): Draft => {
    if (drafts[kind]) return drafts[kind];
    const row = savedByKind.get(kind);
    const def = TAX_KINDS.find((t) => t.kind === kind)!;
    if (row) {
      let excluded: string[] = [];
      try {
        excluded = row.excludedPaymentMethods ? JSON.parse(row.excludedPaymentMethods) : [];
      } catch {
        excluded = [];
      }
      return {
        mode: (row.mode as TaxMode) ?? "manual",
        ratePct: num(row.ratePct),
        excluded: Array.isArray(excluded) ? excluded : [],
        manualAmount: num(row.manualAmount),
      };
    }
    return { mode: def.calculable ? "calculado" : "manual", ratePct: def.defaultRatePct, excluded: [], manualAmount: 0 };
  };

  const setDraft = (kind: TaxKind, patch: Partial<Draft>) =>
    setDrafts((prev) => ({ ...prev, [kind]: { ...draftFor(kind), ...patch } }));

  const saveMut = useMutation({
    mutationFn: async (kind: TaxKind) => {
      const d = draftFor(kind);
      const res = await apiRequest("POST", "/api/economic/taxes", {
        localId,
        economicMonth,
        taxKind: kind,
        mode: d.mode,
        ratePct: d.ratePct,
        excludedPaymentMethods: d.excluded,
        manualAmount: d.manualAmount,
        salesSource,
      });
      return res.json();
    },
    onSuccess: (_r, kind) => {
      queryClient.invalidateQueries({ queryKey: ["/api/economic/taxes"] });
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[kind];
        return next;
      });
      toast({ title: "Impuesto guardado" });
    },
    onError: (e: Error) => toast({ title: "No se pudo guardar", description: e.message, variant: "destructive" }),
  });

  /** Vista previa en pantalla del importe calculado, con la misma fórmula que usa el servidor. */
  const preview = (kind: TaxKind): { amount: number; base: number } => {
    const d = draftFor(kind);
    if (d.mode === "manual") return { amount: d.manualAmount, base: 0 };
    const ex = new Set(d.excluded.map((m) => m.trim().toLowerCase()));
    const base = methods.filter((m) => !ex.has(m.method.trim().toLowerCase())).reduce((s, m) => s + m.amount, 0);
    return { amount: (base * d.ratePct) / 100, base };
  };

  const totalOperativo = TAX_KINDS.filter((t) => t.placement === "operativo")
    .reduce((s, t) => s + num(savedByKind.get(t.kind)?.amount), 0);
  const totalGanancias = num(savedByKind.get("ganancias")?.amount);

  if (locals.length === 0) return <p className="text-sm text-muted-foreground">No hay locales cargados.</p>;

  return (
    <div className="space-y-4">
      <Card className={ECON.border}>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Percent className={`h-4 w-4 ${ECON.text}`} /> Impuestos de {monthLabel}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Se cargan por local. IIBB e Impuesto al Crédito se pueden calcular sobre las ventas del mes;
            el resto va a mano porque sale de la liquidación.
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-3">
            <LocalPicker locals={locals} value={localId} onChange={setLocalId} />
            <div className="space-y-1">
              <Label className="text-xs">Impuestos operativos (restan arriba)</Label>
              <p className={`text-xl font-bold font-mono ${ECON.text}`}>{formatCurrency(totalOperativo)}</p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Ganancias (resta al final)</Label>
              <p className={`text-xl font-bold font-mono ${ECON.text}`}>{formatCurrency(totalGanancias)}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="grid gap-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-28 w-full" />)}</div>
      ) : (
        <div className="grid gap-3">
          {TAX_KINDS.map((def) => {
            const d = draftFor(def.kind);
            const row = savedByKind.get(def.kind);
            const p = preview(def.kind);
            const dirty = !!drafts[def.kind];
            return (
              <Card key={def.kind} className={dirty ? "border-primary" : undefined}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2">
                      {def.label}
                      {def.placement === "sobre_resultado" && (
                        <Badge variant="secondary" className="text-[10px]">se resta al final</Badge>
                      )}
                      {row && !dirty && (
                        <Badge variant="outline" className={`text-[10px] ${ECON.text}`}>guardado</Badge>
                      )}
                    </span>
                    <span className={`font-mono text-base ${ECON.text}`}>{formatCurrency(p.amount)}</span>
                  </CardTitle>
                  <p className="text-[11px] text-muted-foreground">{def.help}</p>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap items-end gap-3">
                    {def.calculable && (
                      <div className="space-y-1">
                        <Label className="text-xs">Cómo se determina</Label>
                        <div className="flex gap-1.5">
                          {(["calculado", "manual"] as TaxMode[]).map((m) => (
                            <button
                              key={m}
                              type="button"
                              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${d.mode === m ? ECON.chipOn : ECON.chipOff}`}
                              onClick={() => setDraft(def.kind, { mode: m })}
                            >
                              {m === "calculado" ? "Calculado" : "A mano"}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {d.mode === "calculado" ? (
                      <div className="space-y-1">
                        <Label className="text-xs">Alícuota %</Label>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          className={`w-24 font-mono ${ECON.ring}`}
                          value={d.ratePct}
                          onChange={(e) => setDraft(def.kind, { ratePct: parseFloat(e.target.value) || 0 })}
                        />
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <Label className="text-xs">Importe</Label>
                        <MoneyInput
                          value={d.manualAmount}
                          onChange={(v) => setDraft(def.kind, { manualAmount: v })}
                          className="w-40"
                          testId={`input-tax-${def.kind}`}
                        />
                      </div>
                    )}

                    <Button
                      size="sm"
                      className={ECON.bgSolid}
                      disabled={saveMut.isPending || localId == null}
                      onClick={() => saveMut.mutate(def.kind)}
                      data-testid={`button-save-tax-${def.kind}`}
                    >
                      {row ? <Pencil className="h-3.5 w-3.5 mr-1.5" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
                      {saveMut.isPending ? "Guardando…" : row ? "Actualizar" : "Guardar"}
                    </Button>
                  </div>

                  {d.mode === "calculado" && (
                    <div className="space-y-1.5">
                      <Label className="text-xs flex items-center gap-1.5">
                        <Calculator className="h-3.5 w-3.5" />
                        Medios de pago que entran en el cálculo
                      </Label>
                      {methods.length === 0 ? (
                        <p className="text-xs text-muted-foreground">
                          No hay ventas importadas de este local en {monthLabel}, así que no hay base para calcular.
                        </p>
                      ) : (
                        <>
                          <div className="flex flex-wrap gap-1.5">
                            {methods.map((m) => {
                              const off = d.excluded.some((x) => x.trim().toLowerCase() === m.method.trim().toLowerCase());
                              return (
                                <button
                                  key={m.method}
                                  type="button"
                                  className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${off ? ECON.chipOff : ECON.chipOn}`}
                                  title={off ? "Fuera del cálculo — tocá para incluirlo" : "Dentro del cálculo — tocá para excluirlo"}
                                  onClick={() =>
                                    setDraft(def.kind, {
                                      excluded: off
                                        ? d.excluded.filter((x) => x.trim().toLowerCase() !== m.method.trim().toLowerCase())
                                        : [...d.excluded, m.method],
                                    })
                                  }
                                >
                                  {m.method} · {formatCurrency(m.amount)}
                                </button>
                              );
                            })}
                          </div>
                          <p className="text-[11px] text-muted-foreground">
                            Base: <span className="font-mono">{formatCurrency(p.base)}</span> × {d.ratePct}% ={" "}
                            <span className={`font-mono font-semibold ${ECON.text}`}>{formatCurrency(p.amount)}</span>
                          </p>
                        </>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
