/**
 * Solapa GENERAL del Estado de Resultado Económico — el informe.
 *
 * Replica el modelo del Excel del usuario: secciones que se abren en grupos, grupos que se abren
 * en sub-grupos y sub-grupos que llegan hasta el comprobante, con el % SOBRE VENTAS en todas las
 * líneas (common size income statement, que es lo que permite comparar meses y locales de
 * tamaños distintos).
 *
 * De las compras se puede clickear cada factura y va a la factura.
 *
 * Todo EN BRUTO, con IVA: las ventas entran con IVA y el IVA a pagar es una línea más de
 * impuestos que resta (decisión del usuario del 21-sep-2026).
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency } from "@/lib/formatters";
import { ChevronRight, ChevronDown, AlertTriangle, ExternalLink } from "lucide-react";
import { commissionLabel, TAX_KIND_BY_KEY, type TaxKind } from "@shared/economicStatement";
import { ECON } from "./econ-shared";

interface Leaf {
  label: string;
  amount: number;
  pct: number;
  date?: string;
  source?: string;
  ref?: string;
  invoiceId?: number;
}
interface Branch {
  label: string;
  amount: number;
  pct: number;
  items: Leaf[];
}
interface Node {
  id?: number;
  label: string;
  amount: number;
  pct: number;
  computes?: boolean;
  isMerchandise?: boolean;
  children: Branch[];
}

interface Statement {
  period: { year: number; month: number; economicMonth: string; from: string; to: string };
  locals: Array<{ id: number; name: string }>;
  allLocalsCount: number;
  isAllLocals: boolean;
  salesSources: string[];
  ventas: { total: number; objetivo: number; lines: Array<{ label: string; amount: number; pct: number; kind: "sistema" | "manual" }> };
  compras: { total: number; pct: number; groups: Node[] };
  gastos: { total: number; pct: number; groups: Node[]; merchandiseComputing: Array<{ id: number; label: string; amount: number }> };
  comisiones: { total: number; pct: number; lines: Array<{ concept: string; amount: number; pct: number; byLocal: Array<{ local: string; amount: number }> }> };
  impuestos: {
    operativos: Array<{ kind: string; amount: number; pct: number; byLocal: Array<{ local: string; amount: number; mode: string }> }>;
    operativosTotal: number;
    ganancias: { kind: string; amount: number; pct: number } | null;
    gananciasTotal: number;
  };
  resumen: Record<string, number>;
  indicadores: Record<string, number>;
}

const pct = (v: number) => `${v.toFixed(1)}%`;
const fmtDate = (iso?: string) => {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return y && m && d ? `${d}/${m}` : "";
};

/** Una fila del informe. La sangría marca el nivel; el % es siempre sobre ventas. */
function Row({
  label,
  amount,
  pctValue,
  level,
  bold,
  tone,
  right,
  onClick,
  open,
  hasChildren,
  meta,
  testId,
}: {
  label: string;
  amount: number;
  pctValue: number;
  level: 0 | 1 | 2 | 3;
  bold?: boolean;
  tone?: "total" | "muted" | "negative";
  right?: React.ReactNode;
  onClick?: () => void;
  open?: boolean;
  hasChildren?: boolean;
  meta?: React.ReactNode;
  testId?: string;
}) {
  const pad = ["pl-2", "pl-6", "pl-12", "pl-[4.5rem]"][level];
  const toneClass =
    tone === "total" ? `font-semibold ${ECON.text}` : tone === "negative" ? "text-destructive" : tone === "muted" ? "text-muted-foreground" : "";
  return (
    <div
      className={`flex items-center gap-2 py-1.5 border-b last:border-0 ${pad} ${onClick ? "cursor-pointer hover:bg-emerald-50/60 dark:hover:bg-emerald-950/20" : ""} ${bold ? "font-semibold" : ""}`}
      onClick={onClick}
      data-testid={testId}
    >
      <span className="w-4 shrink-0 text-muted-foreground">
        {hasChildren ? (open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />) : null}
      </span>
      <div className="flex-1 min-w-0">
        <span className={`text-sm ${toneClass}`}>{label}</span>
        {meta && <span className="ml-2 text-[11px] text-muted-foreground">{meta}</span>}
      </div>
      {right}
      <span className={`w-36 shrink-0 text-right font-mono text-sm ${toneClass}`}>{formatCurrency(amount)}</span>
      <span className="w-16 shrink-0 text-right font-mono text-xs text-muted-foreground">{pct(pctValue)}</span>
    </div>
  );
}

/** Encabezado de una sección, con su total y su % sobre ventas. */
function SectionHeader({ title, amount, pctValue }: { title: string; amount: number; pctValue: number }) {
  return (
    <div className={`flex items-center gap-2 px-2 py-2 ${ECON.bg} border-b ${ECON.border}`}>
      <span className={`flex-1 text-xs font-semibold uppercase tracking-wide ${ECON.text}`}>{title}</span>
      <span className={`w-36 text-right font-mono text-sm font-semibold ${ECON.text}`}>{formatCurrency(amount)}</span>
      <span className={`w-16 text-right font-mono text-xs ${ECON.textSoft}`}>{pct(pctValue)}</span>
    </div>
  );
}

/** Sección con árbol de 3 niveles: grupo → sub-grupo → comprobante. */
function TreeSection({
  title,
  total,
  totalPct,
  groups,
  emptyText,
  keyPrefix,
}: {
  title: string;
  total: number;
  totalPct: number;
  groups: Node[];
  emptyText: string;
  keyPrefix: string;
}) {
  const [openGroups, setOpenGroups] = useState<string[]>([]);
  const [openBranches, setOpenBranches] = useState<string[]>([]);
  const toggle = (arr: string[], set: (v: string[]) => void, k: string) =>
    set(arr.includes(k) ? arr.filter((x) => x !== k) : [...arr, k]);

  return (
    <div>
      <SectionHeader title={title} amount={total} pctValue={totalPct} />
      {groups.length === 0 ? (
        <p className="px-4 py-3 text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        groups.map((g, gi) => {
          const gk = `${keyPrefix}-${gi}`;
          const gOpen = openGroups.includes(gk);
          return (
            <div key={gk}>
              <Row
                label={g.label}
                amount={g.amount}
                pctValue={g.pct}
                level={0}
                bold
                hasChildren={g.children.length > 0}
                open={gOpen}
                onClick={() => toggle(openGroups, setOpenGroups, gk)}
                meta={g.computes === false ? <Badge variant="outline" className="text-[10px]">no computa</Badge> : undefined}
                testId={`row-${gk}`}
              />
              {gOpen &&
                g.children.map((c, ci) => {
                  const ck = `${gk}-${ci}`;
                  const cOpen = openBranches.includes(ck);
                  return (
                    <div key={ck}>
                      <Row
                        label={c.label}
                        amount={c.amount}
                        pctValue={c.pct}
                        level={1}
                        hasChildren={c.items.length > 0}
                        open={cOpen}
                        onClick={() => toggle(openBranches, setOpenBranches, ck)}
                      />
                      {cOpen &&
                        c.items.map((it, ii) => (
                          <Row
                            key={`${ck}-${ii}`}
                            label={it.label}
                            amount={it.amount}
                            pctValue={it.pct}
                            level={2}
                            tone="muted"
                            meta={
                              <>
                                {fmtDate(it.date)}
                                {it.source ? ` · ${it.source}` : ""}
                                {it.ref && it.invoiceId ? ` · ${it.ref}` : ""}
                              </>
                            }
                            right={
                              it.invoiceId ? (
                                <Link
                                  href={`/facturas/${it.invoiceId}`}
                                  onClick={(e) => e.stopPropagation()}
                                  className={`shrink-0 ${ECON.text} hover:underline`}
                                  title="Abrir la factura"
                                >
                                  <ExternalLink className="h-3.5 w-3.5" />
                                </Link>
                              ) : undefined
                            }
                          />
                        ))}
                    </div>
                  );
                })}
            </div>
          );
        })
      )}
    </div>
  );
}

export function StatementTab({
  year,
  month,
  monthLabel,
  localIds,
  salesSources,
}: {
  year: number;
  month: number;
  monthLabel: string;
  localIds: number[];
  salesSources: string[];
}) {
  const localParam = localIds.length > 0 ? localIds.join(",") : "";
  const sourcesParam = salesSources.join(",");

  const { data, isLoading, isError, error } = useQuery<Statement>({
    queryKey: ["/api/economic/statement", year, month, localParam, sourcesParam],
    queryFn: async () => {
      const qs = new URLSearchParams({ year: String(year), month: String(month), salesSources: sourcesParam });
      if (localParam) qs.set("localIds", localParam);
      const res = await fetch(`/api/economic/statement?${qs}`, { credentials: "include" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.message || "Error al calcular");
      return res.json();
    },
  });

  const [openVentas, setOpenVentas] = useState(true);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="space-y-3 py-6">
          {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-5 w-full" />)}
        </CardContent>
      </Card>
    );
  }
  if (isError) return <p className="text-sm text-destructive">{(error as Error)?.message}</p>;
  if (!data) return null;

  const R = data.resumen;
  const I = data.indicadores;
  const desvioVentas = data.ventas.objetivo > 0 ? data.ventas.total - data.ventas.objetivo : null;

  const sinRubro = data.compras.groups.find((g) => g.label === "Sin rubro asignado");

  return (
    <div className="space-y-4">
      <Card className={ECON.border}>
        <CardContent className="py-3 text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
          <span>
            <span className="font-medium text-foreground">{monthLabel}</span> · {data.isAllLocals
              ? `Todos los locales (${data.allLocalsCount})`
              : `${data.locals.map((l) => l.name).join(" · ")} (${data.locals.length} de ${data.allLocalsCount})`}
          </span>
          <span>Ventas de: {data.salesSources.map((s) => (s === "fudo" ? "FUDO" : s === "shares" ? "Shares" : "Datalive")).join(" + ")}</span>
          <span>Todos los importes en bruto, con IVA</span>
        </CardContent>
      </Card>

      {sinRubro && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 flex gap-2 items-start">
          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-500 mt-0.5 shrink-0" />
          <p className="text-sm text-amber-700 dark:text-amber-400">
            <span className="font-semibold">{formatCurrency(sinRubro.amount)}</span> de compras ({pct(sinRubro.pct)} de las
            ventas) están en insumos sin rubro asignado. Cargales el rubro en Insumos para que se abran en el informe.
          </p>
        </div>
      )}

      {data.gastos.merchandiseComputing.length > 0 && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 flex gap-2 items-start">
          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-500 mt-0.5 shrink-0" />
          <p className="text-sm text-amber-700 dark:text-amber-400">
            Los grupos de mercadería <span className="font-semibold">{data.gastos.merchandiseComputing.map((m) => m.label).join(", ")}</span>{" "}
            están tildados y además se está midiendo el costo por Compras: ese costo se está contando dos veces.
            Destildalos en "Grupos que computan".
          </p>
        </div>
      )}

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {/* Encabezado de columnas */}
          <div className="flex items-center gap-2 px-2 py-2 border-b bg-muted/40 text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
            <span className="w-4 shrink-0" />
            <span className="flex-1">Concepto</span>
            <span className="w-36 text-right">Importe</span>
            <span className="w-16 text-right">% s/Ventas</span>
          </div>

          {/* ── VENTAS ── */}
          <SectionHeader title="Ventas" amount={data.ventas.total} pctValue={100} />
          <Row
            label="Detalle por medio de pago"
            amount={data.ventas.total}
            pctValue={100}
            level={0}
            hasChildren={data.ventas.lines.length > 0}
            open={openVentas}
            onClick={() => setOpenVentas(!openVentas)}
            testId="row-ventas-detalle"
          />
          {openVentas &&
            data.ventas.lines.map((l, i) => (
              <Row
                key={i}
                label={l.label}
                amount={l.amount}
                pctValue={l.pct}
                level={1}
                tone="muted"
                meta={l.kind === "manual" ? <Badge variant="secondary" className="text-[10px]">manual</Badge> : undefined}
              />
            ))}
          {data.ventas.objetivo > 0 && (
            <Row
              label="Objetivo del mes"
              amount={data.ventas.objetivo}
              pctValue={0}
              level={0}
              tone="muted"
              meta={
                desvioVentas != null ? (
                  <span className={desvioVentas >= 0 ? "text-emerald-600" : "text-destructive"}>
                    {desvioVentas >= 0 ? "+" : ""}
                    {formatCurrency(desvioVentas)} vs objetivo
                  </span>
                ) : undefined
              }
            />
          )}

          {/* ── COMPRAS ── */}
          <TreeSection
            title="Costo de insumos (compras del mes)"
            total={data.compras.total}
            totalPct={data.compras.pct}
            groups={data.compras.groups}
            keyPrefix="compras"
            emptyText="No hay facturas de compra cargadas en este mes."
          />

          <Row label="UTILIDAD BRUTA" amount={R.utilidadBruta} pctValue={I.utilidadBrutaPct} level={0} bold tone="total" />

          {/* ── GASTOS ── */}
          <TreeSection
            title="Gastos operativos"
            total={data.gastos.total}
            totalPct={data.gastos.pct}
            groups={data.gastos.groups.filter((g) => g.computes !== false)}
            keyPrefix="gastos"
            emptyText="No hay movimientos con mes económico en este período."
          />

          {/* ── COMISIONES ── */}
          <SectionHeader title="Comisiones" amount={data.comisiones.total} pctValue={data.comisiones.pct} />
          {data.comisiones.lines.length === 0 ? (
            <p className="px-4 py-3 text-sm text-muted-foreground">
              No hay comisiones cargadas en este mes. Cargalas en la solapa Comisiones.
            </p>
          ) : (
            data.comisiones.lines.map((c) => (
              <Row key={c.concept} label={commissionLabel(c.concept)} amount={c.amount} pctValue={c.pct} level={0} />
            ))
          )}

          <Row label="RESULTADO OPERATIVO" amount={R.resultadoOperativo} pctValue={I.resultadoOperativoPct} level={0} bold tone="total" />

          {/* ── IMPUESTOS OPERATIVOS ── */}
          <SectionHeader title="Impuestos sobre ingresos y movimientos" amount={data.impuestos.operativosTotal} pctValue={0} />
          {data.impuestos.operativos.length === 0 ? (
            <p className="px-4 py-3 text-sm text-muted-foreground">
              No hay impuestos cargados en este mes. Cargalos en la solapa Impuestos.
            </p>
          ) : (
            data.impuestos.operativos.map((t) => (
              <Row
                key={t.kind}
                label={TAX_KIND_BY_KEY[t.kind as TaxKind]?.label ?? t.kind}
                amount={t.amount}
                pctValue={t.pct}
                level={0}
                meta={t.byLocal.length > 1 ? `${t.byLocal.length} locales` : t.byLocal[0]?.mode === "calculado" ? "calculado" : "a mano"}
              />
            ))
          )}

          <Row label="RESULTADO ANTES DE IMPUESTOS" amount={R.resultadoAntesImpuestos} pctValue={data.ventas.total ? (R.resultadoAntesImpuestos / data.ventas.total) * 100 : 0} level={0} bold tone="total" />

          {/* ── GANANCIAS ── */}
          <Row
            label="Impuesto a las Ganancias"
            amount={data.impuestos.gananciasTotal}
            pctValue={data.ventas.total ? (data.impuestos.gananciasTotal / data.ventas.total) * 100 : 0}
            level={0}
            meta="se calcula sobre el resultado, por eso resta acá"
          />

          <div className={`flex items-center gap-2 px-2 py-3 ${ECON.bg} border-t-2 ${ECON.border}`}>
            <span className="w-4 shrink-0" />
            <span className={`flex-1 text-sm font-bold uppercase tracking-wide ${ECON.text}`}>Resultado neto</span>
            <span className={`w-36 text-right font-mono text-base font-bold ${R.resultadoNeto >= 0 ? ECON.text : "text-destructive"}`}>
              {formatCurrency(R.resultadoNeto)}
            </span>
            <span className={`w-16 text-right font-mono text-xs font-semibold ${R.resultadoNeto >= 0 ? ECON.text : "text-destructive"}`}>
              {pct(I.resultadoNetoPct)}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* ── INDICADORES ── */}
      <Card>
        <CardContent className="pt-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Indicadores</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {[
              { label: "Food cost %", value: I.foodCostPct, hint: "Compras sobre ventas" },
              { label: "Utilidad bruta %", value: I.utilidadBrutaPct, hint: "Ventas − costo de insumos" },
              { label: "Gastos %", value: I.gastosPct, hint: "Gastos operativos sobre ventas" },
              { label: "Resultado operativo %", value: I.resultadoOperativoPct, hint: "Antes de impuestos" },
              { label: "Resultado neto %", value: I.resultadoNetoPct, hint: "Después de todo" },
            ].map((k) => (
              <div key={k.label} className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">{k.label}</p>
                <p className={`text-xl font-bold font-mono ${k.value >= 0 ? ECON.text : "text-destructive"}`}>{pct(k.value)}</p>
                <p className="text-[11px] text-muted-foreground pt-0.5">{k.hint}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
