/**
 * Solapa IMPUESTOS del Estado de Resultado Económico.
 *
 * Se cargan por local y por mes económico, porque cada local liquida por separado. Cada impuesto
 * admite sus modos (ver TAX_KINDS): a mano, sobre medios de pago, sobre ventas facturadas netas o
 * desde extractos. Las categorías de extractos de cada impuesto NO se eligen acá: salen de
 * "Categorías que SÍ computan" (oct-2026), así una categoría tiene un solo destino.
 *
 * El importe lo calcula SIEMPRE el servidor: acá se mandan los parámetros, no el total. La vista
 * previa usa la misma fórmula para que lo que se ve antes de guardar sea lo que se guarda.
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
import { TAX_KINDS, TAX_MODE_LABELS, TAX_KIND_BY_KEY, type TaxKind, type TaxMode } from "@shared/economicStatement";
import type { Local, TransactionCategory } from "@shared/schema";
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
  categoryIds: string | null;
  manualAmount: string | number | null;
  calcBase: string | number | null;
  amount: string | number | null;
  notes: string | null;
}

interface PaymentMethodRow {
  method: string;
  amount: number;
}

interface CategoryTotal {
  categoryId: number;
  name: string;
  groupName: string;
  amount: number;
}

interface InvoicedSales {
  bruto: number;
  neto: number;
  fudo: number;
  manual: number;
  fudoDiasSinDato: number;
}

const parseIds = (raw: string | null | undefined): number[] => {
  try {
    const v = JSON.parse(String(raw ?? "[]"));
    return Array.isArray(v) ? v.map(Number).filter(Number.isFinite) : [];
  } catch {
    return [];
  }
};

const num = (v: string | number | null | undefined) => parseFloat(String(v ?? "0")) || 0;

/** Estado editable de una fila. Arranca del guardado o de los valores sugeridos del catálogo. */
interface Draft {
  mode: TaxMode;
  ratePct: number;
  excluded: string[];
  categoryIds: number[];
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

  /** Categorías de gasto con movimientos en el mes: la lista para armar Crédito y Débito. */
  const { data: categoryTotals = [] } = useQuery<CategoryTotal[]>({
    queryKey: ["/api/economic/category-totals", localId, economicMonth],
    enabled: localId != null,
    queryFn: async () => {
      const res = await fetch(`/api/economic/category-totals?localId=${localId}&economicMonth=${economicMonth}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  /** Ventas facturadas del mes: la base de IIBB "sobre ventas facturadas netas". */
  const { data: invoiced } = useQuery<InvoicedSales>({
    queryKey: ["/api/economic/invoiced-sales", localId, economicMonth, salesSource],
    enabled: localId != null,
    queryFn: async () => {
      const res = await fetch(
        `/api/economic/invoiced-sales?localId=${localId}&economicMonth=${economicMonth}&source=${salesSource}`,
        { credentials: "include" },
      );
      if (!res.ok) return { bruto: 0, neto: 0, fudo: 0, manual: 0, fudoDiasSinDato: 0 };
      return res.json();
    },
  });

  const savedByKind = useMemo(() => new Map(saved.map((r) => [r.taxKind, r])), [saved]);

  /** Categorías asignadas a cada impuesto en "Categorías que SÍ computan". */
  const { data: destinations = [] } = useQuery<Array<{ categoryId: number; destination: string; taxKind: string | null }>>({
    queryKey: ["/api/economic/category-destinations"],
  });
  const { data: allCategories = [] } = useQuery<TransactionCategory[]>({ queryKey: ["/api/transaction-categories"] });
  const assignedIds = (kind: TaxKind) =>
    destinations.filter((x) => x.destination === "impuesto" && x.taxKind === kind).map((x) => x.categoryId);

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
      const mode = def.modes.includes(row.mode as TaxMode) ? (row.mode as TaxMode) : def.modes[0];
      return {
        mode,
        // Una fila vieja guardada con otro modo no tiene alícuota útil: arranca de la sugerida.
        ratePct: row.mode === mode ? num(row.ratePct) : def.defaultRatePct,
        excluded: Array.isArray(excluded) ? excluded : [],
        categoryIds: parseIds(row.categoryIds),
        manualAmount: num(row.manualAmount),
      };
    }
    // Sin nada guardado, el informe ya toma lo de extractos si el impuesto tiene categorías.
    const mode: TaxMode = def.modes.includes("categorias") && assignedIds(kind).length > 0 ? "categorias" : def.modes[0];
    return { mode, ratePct: def.defaultRatePct, excluded: [], categoryIds: [], manualAmount: 0 };
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
        categoryIds: d.categoryIds,
        manualAmount: d.manualAmount,
        salesSource,
      });
      return res.json();
    },
    onSuccess: (_r, kind) => {
      queryClient.invalidateQueries({ queryKey: ["/api/economic/taxes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/economic/statement"] });
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
    if (d.mode === "categorias") {
      const ids = assignedIds(kind);
      const amount = categoryTotals.filter((c) => ids.includes(c.categoryId)).reduce((s, c) => s + c.amount, 0);
      return { amount, base: 0 };
    }
    if (d.mode === "facturado") {
      const base = invoiced?.neto ?? 0;
      return { amount: (base * d.ratePct) / 100, base };
    }
    const ex = new Set(d.excluded.map((m) => m.trim().toLowerCase()));
    const base = methods.filter((m) => !ex.has(m.method.trim().toLowerCase())).reduce((s, m) => s + m.amount, 0);
    return { amount: (base * d.ratePct) / 100, base };
  };

  // Los guardados, con el importe al día para los modos que el informe recalcula en vivo.
  const savedAmount = (kind: TaxKind) => {
    const row = savedByKind.get(kind);
    // Sin fila, el informe igual suma lo de extractos si el impuesto tiene categorías asignadas.
    if (!row) return assignedIds(kind).length > 0 ? preview(kind).amount : 0;
    if (row.mode === "categorias" || row.mode === "facturado") {
      return drafts[kind] ? num(row.amount) : preview(kind).amount;
    }
    return num(row.amount);
  };
  // El IVA no suma: ya se descontó de las ventas facturadas.
  const totalImpuestos = TAX_KINDS.filter((t) => t.kind !== "iva").reduce((s, t) => s + savedAmount(t.kind), 0);

  if (locals.length === 0) return <p className="text-sm text-muted-foreground">No hay locales cargados.</p>;

  return (
    <div className="space-y-4">
      <Card className={ECON.border}>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Percent className={`h-4 w-4 ${ECON.text}`} /> Impuestos de {monthLabel}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Se cargan por local. Ingresos Brutos se calcula sobre las ventas; Crédito, Débito y Ganancias pueden
            salir de los extractos (las categorías se eligen en "Categorías que SÍ computan") o ir a mano. Todos
            restan juntos, después del Resultado Operativo con Inversión.
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-3">
            <LocalPicker locals={locals} value={localId} onChange={setLocalId} />
            <div className="space-y-1 sm:col-span-2">
              <Label className="text-xs">Total de impuestos del local (sin IVA, que no resta)</Label>
              <p className={`text-xl font-bold font-mono ${ECON.text}`}>{formatCurrency(totalImpuestos)}</p>
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
                    {def.modes.length > 1 && (
                      <div className="space-y-1">
                        <Label className="text-xs">Cómo se determina</Label>
                        <div className="flex flex-wrap gap-1.5">
                          {def.modes.map((m) => (
                            <button
                              key={m}
                              type="button"
                              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${d.mode === m ? ECON.chipOn : ECON.chipOff}`}
                              onClick={() => setDraft(def.kind, { mode: m })}
                              data-testid={`button-tax-mode-${def.kind}-${m}`}
                            >
                              {TAX_MODE_LABELS[m]}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {d.mode === "categorias" ? null : d.mode === "calculado" || d.mode === "facturado" ? (
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

                  {d.mode === "facturado" && (
                    <div className="space-y-1">
                      <p className="text-[11px] text-muted-foreground">
                        Ventas facturadas {formatCurrency(invoiced?.bruto ?? 0)}
                        {(invoiced?.manual ?? 0) > 0 && ` (FUDO ${formatCurrency(invoiced?.fudo ?? 0)} + manuales ${formatCurrency(invoiced?.manual ?? 0)})`}{" "}
                        ÷ 1,21 = base <span className="font-mono">{formatCurrency(p.base)}</span> × {d.ratePct}% ={" "}
                        <span className={`font-mono font-semibold ${ECON.text}`}>{formatCurrency(p.amount)}</span>
                      </p>
                      {(invoiced?.bruto ?? 0) === 0 && (
                        <p className="text-[11px] text-amber-700 dark:text-amber-400">
                          No hay ventas facturadas en {monthLabel} para este local. Lo facturado sale de la columna de FUDO
                          y de las ventas manuales marcadas como facturadas; sin FUDO todo cuenta como no facturado, así
                          que cargalo a mano.
                        </p>
                      )}
                      {(invoiced?.fudoDiasSinDato ?? 0) > 0 && (
                        <p className="text-[11px] text-amber-700 dark:text-amber-400">
                          {invoiced?.fudoDiasSinDato} día(s) de FUDO importados sin la columna de facturación: no suman.
                          Re-importá esos archivos para completarlo.
                        </p>
                      )}
                    </div>
                  )}

                  {d.mode === "categorias" && (() => {
                    const ids = assignedIds(def.kind);
                    const totalById = new Map(categoryTotals.map((c) => [c.categoryId, c.amount]));
                    return (
                      <div className="space-y-1.5">
                        <Label className="text-xs flex items-center gap-1.5">
                          <Calculator className="h-3.5 w-3.5" />
                          Categorías de los extractos que forman este impuesto
                        </Label>
                        {ids.length === 0 ? (
                          <p className="text-xs text-amber-700 dark:text-amber-400">
                            Todavía no tiene categorías. Asignáselas en "Categorías que SÍ computan" (arriba, al lado de
                            "Grupos que computan"), eligiendo "Impuesto — {def.label}".
                          </p>
                        ) : (
                          <>
                            <div className="flex flex-wrap gap-1.5">
                              {ids.map((id) => (
                                <span key={id} className={`px-3 py-1 rounded-full text-xs font-medium border ${ECON.chipOn}`}>
                                  {allCategories.find((c) => c.id === id)?.name ?? `Categoría ${id}`} ·{" "}
                                  {formatCurrency(totalById.get(id) ?? 0)}
                                </span>
                              ))}
                            </div>
                            <p className="text-[11px] text-muted-foreground">
                              Total en {monthLabel}: <span className={`font-mono font-semibold ${ECON.text}`}>{formatCurrency(p.amount)}</span>.
                              Para cambiarlas, usá "Categorías que SÍ computan".
                            </p>
                          </>
                        )}
                      </div>
                    );
                  })()}

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
