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
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency } from "@/lib/formatters";
import { ChevronRight, ChevronDown, AlertTriangle, ExternalLink, FileDown, ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { buildEconomicStatementPdf, type StatementPdfRow } from "@/lib/economic-statement-pdf";
import { commissionLabel, TAX_KIND_BY_KEY, TAX_MODE_LABELS, type TaxKind, type TaxMode } from "@shared/economicStatement";
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

export type CmvMode = "compras" | "inventario" | "productos";

interface CmvVariantRow {
  localId: number;
  local: string;
  ventas: number;
  amount: number;
  pct: number;
  detalle: string | null;
}
interface CmvVariant {
  key: CmvMode;
  label: string;
  help: string;
  total: number;
  pct: number;
  utilidadBruta: number;
  utilidadBrutaPct: number;
  disponible: boolean;
  rows: CmvVariantRow[];
  faltantes: Array<{ local: string; ventas: number }>;
  aviso: string | null;
}

interface Statement {
  period: { year: number; month: number; economicMonth: string; from: string; to: string };
  locals: Array<{ id: number; name: string }>;
  allLocalsCount: number;
  isAllLocals: boolean;
  salesSources: string[];
  ventas: { total: number; objetivo: number; lines: Array<{ label: string; amount: number; pct: number; kind: "sistema" | "manual" }> };
  compras: { total: number; pct: number; groups: Node[] };
  cmv: {
    mode: CmvMode;
    modePedido: CmvMode;
    elegido: string;
    variantes: CmvVariant[];
    desvioMerma: { monto: number; puntos: number; locales: string[]; ventasComparadas: number } | null;
  };
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
  topProductos?: {
    source: string;
    coberturaPct: number | null;
    unidades: number;
    items: Array<{
      rank: number;
      producto: string;
      cantidad: number;
      participacionPct: number;
      cmvPct: number | null;
      margenPct: number | null;
      variacionPct: number | null;
      esNuevo: boolean;
    }>;
  };
  ventasNoFacturadas?:
    | {
        disponible: true;
        ventaTotal: number;
        facturada: number;
        noFacturada: number;
        sinDato: number;
        noFacturadaPct: number;
        diasSinDato: number;
        ventasDelInforme: number;
        brechaConInforme: number;
        coincideConInforme: boolean;
      }
    | { disponible: false; motivo: string };
  puntoEquilibrio?: {
    alcanzable: boolean;
    costosFijos: number;
    margenContribucionPct: number;
    ventasNecesarias: number | null;
    excedente: number | null;
  };
  anterior?: {
    period: { year: number; month: number; economicMonth: string };
    resumen: Record<string, number>;
    indicadores: Record<string, number>;
  };
}

/**
 * Ancho de las dos columnas numéricas, en un solo lugar. Tienen que coincidir en el encabezado,
 * en las filas, en los títulos de sección y en el resultado neto: si una se desalinea, la columna
 * de porcentaje se corta contra el borde de la tarjeta.
 */
const COL_IMPORTE = "w-40";
const COL_PCT = "w-20";

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
      className={`flex items-center gap-2 py-1.5 pr-3 border-b last:border-0 ${pad} ${onClick ? "cursor-pointer hover:bg-emerald-50/60 dark:hover:bg-emerald-950/20" : ""} ${bold ? "font-semibold" : ""}`}
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
      <span className={`${COL_IMPORTE} shrink-0 text-right font-mono text-sm ${toneClass}`}>{formatCurrency(amount)}</span>
      <span className={`${COL_PCT} shrink-0 text-right font-mono text-xs text-muted-foreground`}>{pct(pctValue)}</span>
    </div>
  );
}

/**
 * Encabezado de una sección. Pliega y despliega TODO lo que tiene abajo de una sola vez: con
 * 22 rubros de compras abiertos, llegar al resultado neto era hacer scroll a ciegas.
 */
function SectionHeader({
  title,
  amount,
  pctValue,
  open,
  onToggle,
  testId,
}: {
  title: string;
  amount: number;
  pctValue: number;
  open?: boolean;
  onToggle?: () => void;
  testId?: string;
}) {
  return (
    <div
      className={`flex items-center gap-2 pl-2 pr-3 py-2 ${ECON.bg} border-b ${ECON.border} ${onToggle ? "cursor-pointer hover:brightness-95" : ""}`}
      onClick={onToggle}
      data-testid={testId}
    >
      <span className={`w-4 shrink-0 ${ECON.text}`}>
        {onToggle ? (open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />) : null}
      </span>
      <span className={`flex-1 text-xs font-semibold uppercase tracking-wide ${ECON.text}`}>{title}</span>
      <span className={`${COL_IMPORTE} text-right font-mono text-sm font-semibold ${ECON.text}`}>{formatCurrency(amount)}</span>
      <span className={`${COL_PCT} text-right font-mono text-xs ${ECON.textSoft}`}>{pct(pctValue)}</span>
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
  open,
  onToggleSection,
  openGroups,
  openBranches,
  onToggleGroup,
  onToggleBranch,
}: {
  title: string;
  total: number;
  totalPct: number;
  groups: Node[];
  emptyText: string;
  keyPrefix: string;
  /** El estado de plegado vive en StatementTab: el PDF exporta exactamente lo que se ve. */
  open: boolean;
  onToggleSection: () => void;
  openGroups: string[];
  openBranches: string[];
  onToggleGroup: (k: string) => void;
  onToggleBranch: (k: string) => void;
}) {
  return (
    <div>
      <SectionHeader
        title={title}
        amount={total}
        pctValue={totalPct}
        open={open}
        onToggle={onToggleSection}
        testId={`section-${keyPrefix}`}
      />
      {!open ? null : groups.length === 0 ? (
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
                onClick={() => onToggleGroup(gk)}
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
                        onClick={() => onToggleBranch(ck)}
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

/**
 * Los tres costos de mercadería, lado a lado, con el selector de cuál manda en el resultado.
 * Cada uno se puede abrir para ver de qué local sale y cómo se compone.
 */
function CmvSelector({
  cmv,
  mode,
  onChange,
}: {
  cmv: Statement["cmv"];
  mode: CmvMode;
  onChange: (m: CmvMode) => void;
}) {
  const [open, setOpen] = useState<CmvMode | null>(null);
  const abierta = open ? cmv.variantes.find((x) => x.key === open) : null;
  return (
    <Card className={ECON.border}>
      <CardContent className="pt-5 space-y-3">
        <div>
          <p className="text-sm font-semibold">Costo de mercadería</p>
          <p className="text-xs text-muted-foreground">
            Los tres se calculan siempre. El que elijas es el que resta en el resultado neto; los otros dos
            quedan al lado como comparación.
          </p>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          {cmv.variantes.map((v) => {
            const activo = v.key === mode;
            return (
              <div
                key={v.key}
                className={`rounded-lg border p-3 transition-colors ${activo ? `${ECON.border} ${ECON.bg}` : "hover:bg-muted/40"} ${v.disponible ? "cursor-pointer" : "opacity-60"}`}
                onClick={() => v.disponible && onChange(v.key)}
                data-testid={`card-cmv-${v.key}`}
              >
                <div className="flex items-start gap-2">
                  <span
                    className={`mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border-2 ${activo ? "border-emerald-600 bg-emerald-600" : "border-muted-foreground/40"}`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium leading-tight">{v.label}</p>
                    {!v.disponible && <Badge variant="outline" className="mt-1 text-[10px]">sin datos este mes</Badge>}
                  </div>
                </div>
                <p className={`mt-2 font-mono text-lg font-bold ${activo ? ECON.text : ""}`}>{formatCurrency(v.total)}</p>
                <p className="font-mono text-xs text-muted-foreground">{pct(v.pct)} de las ventas</p>
                <div className="mt-2 border-t pt-2">
                  <p className="text-[11px] text-muted-foreground">Utilidad bruta que da</p>
                  <p className={`font-mono text-sm font-semibold ${v.utilidadBruta >= 0 ? ECON.text : "text-destructive"}`}>
                    {formatCurrency(v.utilidadBruta)} <span className="text-xs font-normal">({pct(v.utilidadBrutaPct)})</span>
                  </p>
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">{v.help}</p>
                {v.rows.length > 0 && (
                  <button
                    type="button"
                    className={`mt-2 text-[11px] ${ECON.text} hover:underline`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpen(open === v.key ? null : v.key);
                    }}
                  >
                    {open === v.key ? "Ocultar composición" : "Ver composición"}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {abierta && (
          <div className="rounded-lg border p-3">
            <p className="text-xs font-semibold mb-2">{abierta.label} — cómo se compone</p>
            <div className="space-y-1">
              {abierta.rows.map((r) => (
                <div key={r.localId} className="flex items-center gap-2 py-1 border-b last:border-0 text-sm">
                  <span className="flex-1 min-w-0 truncate">
                    {r.local}
                    {r.detalle && <span className="ml-2 text-[11px] text-muted-foreground">{r.detalle}</span>}
                  </span>
                  <span className="w-32 text-right font-mono text-xs text-muted-foreground">{formatCurrency(r.ventas)}</span>
                  <span className="w-32 text-right font-mono">{formatCurrency(r.amount)}</span>
                  <span className="w-14 text-right font-mono text-xs text-muted-foreground">{pct(r.pct)}</span>
                </div>
              ))}
            </div>
            {abierta.faltantes.length > 0 && (
              <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-400">
                Sin dato en: {abierta.faltantes.map((f) => f.local).join(", ")}
              </p>
            )}
          </div>
        )}

        {cmv.variantes.filter((v) => v.aviso).map((v) => (
          <div key={v.key} className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 flex gap-2 items-start">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-500 mt-0.5 shrink-0" />
            <p className="text-xs text-amber-700 dark:text-amber-400">
              <span className="font-semibold">{v.label}:</span> {v.aviso}
            </p>
          </div>
        ))}

        {cmv.desvioMerma && (
          <div className={`rounded-lg border ${ECON.border} ${ECON.bg} p-2.5`}>
            <p className={`text-xs ${ECON.text}`}>
              <span className="font-semibold">Desvío de costeo:</span> el costo real por inventarios supera al teórico
              por recetas en <span className="font-mono font-semibold">{formatCurrency(cmv.desvioMerma.monto)}</span> (
              {cmv.desvioMerma.puntos.toFixed(2)} puntos de las ventas). Eso es merma, desperdicio y faltante que el
              costeo no explica. Comparado solo sobre {cmv.desvioMerma.locales.join(", ")}, que tienen los dos cálculos.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function StatementTab({
  year,
  month,
  monthLabel,
  localIds,
  salesSources,
  cmvMode,
  onCmvModeChange,
}: {
  year: number;
  month: number;
  monthLabel: string;
  localIds: number[];
  salesSources: string[];
  cmvMode: CmvMode;
  onCmvModeChange: (mode: CmvMode) => void;
}) {
  const localParam = localIds.length > 0 ? localIds.join(",") : "";
  const sourcesParam = salesSources.join(",");

  const { data, isLoading, isError, error } = useQuery<Statement>({
    queryKey: ["/api/economic/statement", year, month, localParam, sourcesParam, cmvMode],
    queryFn: async () => {
      const qs = new URLSearchParams({ year: String(year), month: String(month), salesSources: sourcesParam, cmvMode });
      if (localParam) qs.set("localIds", localParam);
      const res = await fetch(`/api/economic/statement?${qs}`, { credentials: "include" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.message || "Error al calcular");
      return res.json();
    },
  });

  /**
   * Productos que la empresa sacó del top (ej. "Servicio de mesa"). Se guardan en las
   * preferencias de la empresa, así quedan afuera para todos y en cualquier computadora.
   * El servidor manda 30 productos y acá se completa el top 10 con los que siguen.
   */
  const EXCLUDED_KEY = "/api/preferences/economic-top-excluded";
  const { data: excluded = [] } = useQuery<string[]>({ queryKey: [EXCLUDED_KEY] });
  const saveExcluded = useMutation({
    mutationFn: async (productos: string[]) => {
      const res = await apiRequest("PUT", EXCLUDED_KEY, { productos });
      return (await res.json()) as string[];
    },
    // Optimista: el ranking se reacomoda al instante y, si falla, vuelve a lo guardado.
    onMutate: (productos) => {
      const prev = queryClient.getQueryData<string[]>([EXCLUDED_KEY]);
      queryClient.setQueryData([EXCLUDED_KEY], productos);
      return { prev };
    },
    onError: (_e, _v, ctx) => queryClient.setQueryData([EXCLUDED_KEY], ctx?.prev ?? []),
    onSuccess: (saved) => queryClient.setQueryData([EXCLUDED_KEY], saved),
  });
  const excluir = (producto: string) => saveExcluded.mutate([...excluded, producto]);
  const restablecer = () => saveExcluded.mutate([]);

  /**
   * Todo el plegado vive acá y no adentro de cada sección: el PDF exporta exactamente lo que se
   * ve en pantalla, así que necesita leer este estado.
   */
  const [openSections, setOpenSections] = useState<string[]>(["ventas", "costo", "gastos", "comisiones", "impuestos"]);
  const [openGroups, setOpenGroups] = useState<string[]>([]);
  const [openBranches, setOpenBranches] = useState<string[]>([]);
  const [openVentas, setOpenVentas] = useState(true);

  const flip = (arr: string[], set: (v: string[]) => void, k: string) =>
    set(arr.includes(k) ? arr.filter((x) => x !== k) : [...arr, k]);
  const isSectionOpen = (k: string) => openSections.includes(k);

  /**
   * Aplana a filas EXACTAMENTE lo que se está viendo: respeta qué secciones, qué grupos y qué
   * sub-grupos quedaron desplegados. Es lo que se manda al PDF, así el papel sale igual que la
   * pantalla.
   */
  const buildPdfRows = (d: Statement): StatementPdfRow[] => {
    const out: StatementPdfRow[] = [];
    const push = (
      label: string,
      amount: number,
      pctValue: number | null,
      level: 0 | 1 | 2 | 3,
      kind: StatementPdfRow["kind"],
      meta?: string,
    ) => out.push({ label, amount, pct: pctValue, level, kind, meta });

    const tree = (groups: Node[], keyPrefix: string) => {
      groups.forEach((g, gi) => {
        const gk = `${keyPrefix}-${gi}`;
        push(g.label, g.amount, g.pct, 0, "row");
        if (!openGroups.includes(gk)) return;
        g.children.forEach((c, ci) => {
          const ck = `${gk}-${ci}`;
          push(c.label, c.amount, c.pct, 1, "row");
          if (!openBranches.includes(ck)) return;
          for (const it of c.items) {
            const meta = [fmtDate(it.date), it.source, it.invoiceId ? it.ref : null].filter(Boolean).join(" · ");
            push(it.label, it.amount, it.pct, 2, "row", meta || undefined);
          }
        });
      });
    };

    // Ventas
    push("Ventas", d.ventas.total, 100, 0, "section");
    if (isSectionOpen("ventas")) {
      push("Detalle por medio de pago", d.ventas.total, 100, 0, "row");
      if (openVentas) for (const l of d.ventas.lines) push(l.label, l.amount, l.pct, 1, "row", l.kind === "manual" ? "manual" : undefined);
      if (d.ventas.objetivo > 0) push("Objetivo del mes", d.ventas.objetivo, null, 0, "row");
    }

    // Costo de mercadería
    const variante = d.cmv.variantes.find((v) => v.key === d.cmv.mode);
    push(
      d.cmv.mode === "compras" ? "Costo de mercadería — compras del mes" : `Costo de mercadería — ${d.cmv.elegido}`,
      d.resumen.costoMercaderia,
      d.indicadores.foodCostPct,
      0,
      "section",
    );
    if (isSectionOpen("costo")) {
      if (d.cmv.mode === "compras") tree(d.compras.groups, "costo");
      else for (const r of variante?.rows ?? []) push(r.local, r.amount, r.pct, 0, "row", r.detalle ?? undefined);
    }
    push("Utilidad bruta", d.resumen.utilidadBruta, d.indicadores.utilidadBrutaPct, 0, "subtotal");

    // Gastos
    push("Gastos operativos", d.gastos.total, d.gastos.pct, 0, "section");
    if (isSectionOpen("gastos")) tree(d.gastos.groups.filter((g) => g.computes !== false), "gastos");

    // Comisiones
    push("Comisiones", d.comisiones.total, d.comisiones.pct, 0, "section");
    if (isSectionOpen("comisiones")) for (const c of d.comisiones.lines) push(commissionLabel(c.concept), c.amount, c.pct, 0, "row");

    push("Resultado operativo", d.resumen.resultadoOperativo, d.indicadores.resultadoOperativoPct, 0, "subtotal");

    // Impuestos
    const impPct = d.ventas.total ? (d.impuestos.operativosTotal / d.ventas.total) * 100 : 0;
    push("Impuestos sobre ingresos y movimientos", d.impuestos.operativosTotal, impPct, 0, "section");
    if (isSectionOpen("impuestos")) {
      for (const t of d.impuestos.operativos) push(TAX_KIND_BY_KEY[t.kind as TaxKind]?.label ?? t.kind, t.amount, t.pct, 0, "row");
    }

    push(
      "Resultado antes de impuestos",
      d.resumen.resultadoAntesImpuestos,
      d.ventas.total ? (d.resumen.resultadoAntesImpuestos / d.ventas.total) * 100 : 0,
      0,
      "subtotal",
    );
    push(
      "Impuesto a las Ganancias",
      d.impuestos.gananciasTotal,
      d.ventas.total ? (d.impuestos.gananciasTotal / d.ventas.total) * 100 : 0,
      0,
      "row",
    );
    push("Resultado neto", d.resumen.resultadoNeto, d.indicadores.resultadoNetoPct, 0, "grand");

    return out;
  };

  /** Plega todo de una: con 22 rubros abiertos, llegar al resultado neto era scroll a ciegas. */
  const plegarTodo = () => {
    setOpenSections([]);
    setOpenGroups([]);
    setOpenBranches([]);
    setOpenVentas(false);
  };

  /** Abre todo hasta el comprobante. Las claves son las mismas que arma el árbol al dibujarse. */
  const desplegarTodo = () => {
    if (!data) return;
    const gs: string[] = [];
    const bs: string[] = [];
    const walk = (groups: Node[], keyPrefix: string) => {
      groups.forEach((g, gi) => {
        const gk = `${keyPrefix}-${gi}`;
        gs.push(gk);
        g.children.forEach((_c, ci) => bs.push(`${gk}-${ci}`));
      });
    };
    walk(data.compras.groups, "costo");
    walk(data.gastos.groups.filter((g) => g.computes !== false), "gastos");
    setOpenSections(["ventas", "costo", "gastos", "comisiones", "impuestos"]);
    setOpenGroups(gs);
    setOpenBranches(bs);
    setOpenVentas(true);
  };

  const exportPdf = () => {
    if (!data) return;
    const v = data.ventasNoFacturadas;
    const pe = data.puntoEquilibrio;
    const doc = buildEconomicStatementPdf({
      monthLabel,
      localsLabel: data.isAllLocals
        ? `Todos los locales (${data.allLocalsCount})`
        : `${data.locals.map((l) => l.name).join(" · ")} (${data.locals.length} de ${data.allLocalsCount})`,
      sourcesLabel: data.salesSources
        .map((s) => (s === "fudo" ? "FUDO" : s === "shares" ? "Shares" : "Datalive"))
        .join(" + "),
      cmvLabel: data.cmv.elegido,
      rows: buildPdfRows(data),
      indicadores: [
        { label: "Food cost %", value: data.indicadores.foodCostPct },
        { label: "Utilidad bruta %", value: data.indicadores.utilidadBrutaPct },
        { label: "Gastos %", value: data.indicadores.gastosPct },
        { label: "Resultado operativo %", value: data.indicadores.resultadoOperativoPct },
        { label: "Resultado neto %", value: data.indicadores.resultadoNetoPct },
      ],
      puntoEquilibrio:
        pe && pe.alcanzable && pe.ventasNecesarias != null
          ? {
              ventasNecesarias: pe.ventasNecesarias,
              costosFijos: pe.costosFijos,
              margenPct: pe.margenContribucionPct,
              excedente: pe.excedente ?? 0,
            }
          : null,
      ventasNoFacturadas:
        v && v.disponible ? { noFacturada: v.noFacturada, pct: v.noFacturadaPct, total: v.ventaTotal } : null,
      comparativo: data.anterior
        ? {
            mesAnterior: data.anterior.period.economicMonth,
            lineas: [
              { label: "Ventas", hoy: data.resumen.ventas, antes: data.anterior.resumen.ventas },
              { label: "Costo de mercadería", hoy: data.resumen.costoMercaderia, antes: data.anterior.resumen.costoMercaderia },
              { label: "Utilidad bruta", hoy: data.resumen.utilidadBruta, antes: data.anterior.resumen.utilidadBruta },
              { label: "Gastos operativos", hoy: data.resumen.gastos, antes: data.anterior.resumen.gastos },
              { label: "Comisiones", hoy: data.resumen.comisiones, antes: data.anterior.resumen.comisiones },
              { label: "Resultado neto", hoy: data.resumen.resultadoNeto, antes: data.anterior.resumen.resultadoNeto },
            ],
          }
        : null,
      topProductos: data.topProductos
        ? {
            source: data.topProductos.source,
            coberturaPct: data.topProductos.coberturaPct,
            items: topVisibles,
          }
        : null,
    });
    doc.save(`estado-resultado-economico_${data.period.economicMonth}.pdf`);
  };
  const treeProps = (keyPrefix: string) => ({
    open: isSectionOpen(keyPrefix),
    onToggleSection: () => flip(openSections, setOpenSections, keyPrefix),
    openGroups,
    openBranches,
    onToggleGroup: (k: string) => flip(openGroups, setOpenGroups, k),
    onToggleBranch: (k: string) => flip(openBranches, setOpenBranches, k),
  });

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

  const excludedSet = new Set(excluded);
  const topVisibles = (data.topProductos?.items ?? [])
    .filter((it) => !excludedSet.has(it.producto))
    .slice(0, 10)
    .map((it, i) => ({ ...it, rank: i + 1 }));

  return (
    <div className="space-y-4">
      <Card className={ECON.border}>
        <CardContent className="py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
            <span>
              <span className="font-medium text-foreground">{monthLabel}</span> · {data.isAllLocals
                ? `Todos los locales (${data.allLocalsCount})`
                : `${data.locals.map((l) => l.name).join(" · ")} (${data.locals.length} de ${data.allLocalsCount})`}
            </span>
            <span>Ventas de: {data.salesSources.map((s) => (s === "fudo" ? "FUDO" : s === "shares" ? "Shares" : "Datalive")).join(" + ")}</span>
            <span>Todos los importes en bruto, con IVA</span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={plegarTodo} data-testid="button-plegar-todo">
              <ChevronsDownUp className="h-3.5 w-3.5 mr-1.5" /> Plegar todo
            </Button>
            <Button variant="outline" size="sm" onClick={desplegarTodo} data-testid="button-desplegar-todo">
              <ChevronsUpDown className="h-3.5 w-3.5 mr-1.5" /> Desplegar todo
            </Button>
            <Button size="sm" className={ECON.bgSolid} onClick={exportPdf} data-testid="button-export-statement-pdf">
              <FileDown className="h-4 w-4 mr-1.5" /> PDF
            </Button>
          </div>
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

      <CmvSelector cmv={data.cmv} mode={data.cmv.mode} onChange={onCmvModeChange} />

      {data.cmv.mode !== data.cmv.modePedido && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 flex gap-2 items-start">
          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-500 mt-0.5 shrink-0" />
          <p className="text-sm text-amber-700 dark:text-amber-400">
            No hay datos del costo elegido en este mes, así que el informe se está calculando con las compras.
          </p>
        </div>
      )}

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {/* Encabezado de columnas */}
          <div className="flex items-center gap-2 pl-2 pr-3 py-2 border-b bg-muted/40 text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
            <span className="w-4 shrink-0" />
            <span className="flex-1">Concepto</span>
            <span className={`${COL_IMPORTE} text-right`}>Importe</span>
            <span className={`${COL_PCT} text-right whitespace-nowrap`}>% s/Vtas</span>
          </div>

          {/* ── VENTAS ── */}
          <SectionHeader
            title="Ventas"
            amount={data.ventas.total}
            pctValue={100}
            open={isSectionOpen("ventas")}
            onToggle={() => flip(openSections, setOpenSections, "ventas")}
            testId="section-ventas"
          />
          {isSectionOpen("ventas") && (
          <>
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
          </>
          )}

          {/* ── COSTO DE MERCADERÍA (la variante que eligió el usuario) ── */}
          {data.cmv.mode === "compras" ? (
            <TreeSection
              title="Costo de mercadería — compras del mes"
              total={data.compras.total}
              totalPct={data.compras.pct}
              groups={data.compras.groups}
              keyPrefix="costo"
              emptyText="No hay facturas de compra cargadas en este mes."
              {...treeProps("costo")}
            />
          ) : (
            <>
              <SectionHeader
                title={`Costo de mercadería — ${data.cmv.elegido}`}
                amount={R.costoMercaderia}
                pctValue={I.foodCostPct}
                open={isSectionOpen("costo")}
                onToggle={() => flip(openSections, setOpenSections, "costo")}
                testId="section-costo"
              />
              {isSectionOpen("costo") && (data.cmv.variantes.find((v) => v.key === data.cmv.mode)?.rows ?? []).map((r) => (
                <Row key={r.localId} label={r.local} amount={r.amount} pctValue={r.pct} level={0} meta={r.detalle ?? undefined} />
              ))}
            </>
          )}

          <Row label="UTILIDAD BRUTA" amount={R.utilidadBruta} pctValue={I.utilidadBrutaPct} level={0} bold tone="total" />

          {/* ── GASTOS ── */}
          <TreeSection
            title="Gastos operativos"
            total={data.gastos.total}
            totalPct={data.gastos.pct}
            groups={data.gastos.groups.filter((g) => g.computes !== false)}
            keyPrefix="gastos"
            emptyText="No hay movimientos con mes económico en este período."
            {...treeProps("gastos")}
          />

          {/* ── COMISIONES ── */}
          <SectionHeader
            title="Comisiones"
            amount={data.comisiones.total}
            pctValue={data.comisiones.pct}
            open={isSectionOpen("comisiones")}
            onToggle={() => flip(openSections, setOpenSections, "comisiones")}
            testId="section-comisiones"
          />
          {!isSectionOpen("comisiones") ? null : data.comisiones.lines.length === 0 ? (
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
          <SectionHeader
            title="Impuestos sobre ingresos y movimientos"
            amount={data.impuestos.operativosTotal}
            pctValue={data.ventas.total ? (data.impuestos.operativosTotal / data.ventas.total) * 100 : 0}
            open={isSectionOpen("impuestos")}
            onToggle={() => flip(openSections, setOpenSections, "impuestos")}
            testId="section-impuestos"
          />
          {!isSectionOpen("impuestos") ? null : data.impuestos.operativos.length === 0 ? (
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
                meta={t.byLocal.length > 1 ? `${t.byLocal.length} locales` : (TAX_MODE_LABELS[t.byLocal[0]?.mode as TaxMode] ?? "a mano").toLowerCase()}
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

          <div className={`flex items-center gap-2 pl-2 pr-3 py-3 ${ECON.bg} border-t-2 ${ECON.border}`}>
            <span className="w-4 shrink-0" />
            <span className={`flex-1 text-sm font-bold uppercase tracking-wide ${ECON.text}`}>Resultado neto</span>
            <span className={`${COL_IMPORTE} text-right font-mono text-base font-bold ${R.resultadoNeto >= 0 ? ECON.text : "text-destructive"}`}>
              {formatCurrency(R.resultadoNeto)}
            </span>
            <span className={`${COL_PCT} text-right font-mono text-xs font-semibold ${R.resultadoNeto >= 0 ? ECON.text : "text-destructive"}`}>
              {pct(I.resultadoNetoPct)}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* ── CONTRA EL MES ANTERIOR ── */}
      {data.anterior && (
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
              Contra el mes anterior ({data.anterior.period.economicMonth})
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    <th className="text-left font-medium py-2">Concepto</th>
                    <th className="text-right font-medium py-2">Este mes</th>
                    <th className="text-right font-medium py-2">Mes anterior</th>
                    <th className="text-right font-medium py-2">Diferencia</th>
                    <th className="text-right font-medium py-2">Var. %</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { key: "ventas", label: "Ventas", bueno: "sube" as const },
                    { key: "costoMercaderia", label: "Costo de mercadería", bueno: "baja" as const },
                    { key: "utilidadBruta", label: "Utilidad bruta", bueno: "sube" as const },
                    { key: "gastos", label: "Gastos operativos", bueno: "baja" as const },
                    { key: "comisiones", label: "Comisiones", bueno: "baja" as const },
                    { key: "resultadoNeto", label: "Resultado neto", bueno: "sube" as const },
                  ].map(({ key, label, bueno }) => {
                    const hoy = R[key] ?? 0;
                    const antes = data.anterior!.resumen[key] ?? 0;
                    const dif = hoy - antes;
                    const varPct = antes !== 0 ? (dif / Math.abs(antes)) * 100 : null;
                    // Lo "bueno" depende de la línea: que las ventas suban es bueno, que los
                    // gastos suban no. Sin esto, todo el verde y el rojo mienten la mitad del tiempo.
                    const positivo = bueno === "sube" ? dif >= 0 : dif <= 0;
                    const color = dif === 0 ? "" : positivo ? "text-emerald-600 dark:text-emerald-500" : "text-destructive";
                    return (
                      <tr key={key} className="border-b last:border-0">
                        <td className="py-2">{label}</td>
                        <td className="py-2 text-right font-mono">{formatCurrency(hoy)}</td>
                        <td className="py-2 text-right font-mono text-muted-foreground">{formatCurrency(antes)}</td>
                        <td className={`py-2 text-right font-mono ${color}`}>
                          {dif >= 0 ? "+" : ""}
                          {formatCurrency(dif)}
                        </td>
                        <td className={`py-2 text-right font-mono ${color}`}>
                          {varPct == null ? "—" : `${varPct >= 0 ? "+" : ""}${varPct.toFixed(1)}%`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── PUNTO DE EQUILIBRIO Y VENTAS NO FACTURADAS ── */}
      <div className="grid gap-4 md:grid-cols-2">
        {data.puntoEquilibrio && (
          <Card>
            <CardContent className="pt-6 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Punto de equilibrio del mes</p>
              {!data.puntoEquilibrio.alcanzable ? (
                <p className="text-sm text-destructive">
                  El margen de contribución no es positivo: con este costo de mercadería no hay volumen de ventas
                  que alcance el equilibrio.
                </p>
              ) : (
                <>
                  <p className={`text-2xl font-bold font-mono ${ECON.text}`}>
                    {formatCurrency(data.puntoEquilibrio.ventasNecesarias ?? 0)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Costos fijos {formatCurrency(data.puntoEquilibrio.costosFijos)} ÷ margen de contribución{" "}
                    {pct(data.puntoEquilibrio.margenContribucionPct)}. Gastos + comisiones + impuestos operativos.
                  </p>
                  <p
                    className={`text-sm font-medium ${(data.puntoEquilibrio.excedente ?? 0) >= 0 ? "text-emerald-600 dark:text-emerald-500" : "text-destructive"}`}
                  >
                    {(data.puntoEquilibrio.excedente ?? 0) >= 0 ? "Se vendió " : "Faltaron "}
                    {formatCurrency(Math.abs(data.puntoEquilibrio.excedente ?? 0))}
                    {(data.puntoEquilibrio.excedente ?? 0) >= 0 ? " por encima del equilibrio" : " para llegar al equilibrio"}
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        )}

        {data.ventasNoFacturadas && (
          <Card>
            <CardContent className="pt-6 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Ventas no facturadas</p>
              {!data.ventasNoFacturadas.disponible ? (
                <p className="text-sm text-muted-foreground">{data.ventasNoFacturadas.motivo}</p>
              ) : (
                <>
                  <p className="text-2xl font-bold font-mono text-amber-600 dark:text-amber-500">
                    {formatCurrency(data.ventasNoFacturadas.noFacturada)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {pct(data.ventasNoFacturadas.noFacturadaPct)} de {formatCurrency(data.ventasNoFacturadas.ventaTotal)} que
                    FUDO registra como venta del mes. Facturado: {formatCurrency(data.ventasNoFacturadas.facturada)}.
                  </p>
                  {!data.ventasNoFacturadas.coincideConInforme && (
                    <p className="text-[11px] text-amber-700 dark:text-amber-400">
                      Ojo: FUDO registra {formatCurrency(data.ventasNoFacturadas.ventaTotal)} de venta y el informe suma{" "}
                      {formatCurrency(data.ventasNoFacturadas.ventasDelInforme)} de medios de pago. Son dos archivos
                      distintos de FUDO y no están cerrando entre sí, así que el porcentaje va medido contra el total
                      de FUDO, no contra el del informe.
                    </p>
                  )}
                  {data.ventasNoFacturadas.diasSinDato > 0 && (
                    <p className="text-[11px] text-muted-foreground">
                      {data.ventasNoFacturadas.diasSinDato} día(s) importados antes de que se leyera el corte: ahí no se
                      sabe, no es "no facturado".
                    </p>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* ── TOP 10 PRODUCTOS ── */}
      {data.topProductos && (topVisibles.length > 0 || excluded.length > 0) && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-baseline justify-between gap-3 flex-wrap mb-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Los 10 productos más vendidos del mes
              </p>
              <p className="text-[11px] text-muted-foreground">
                Origen: {data.topProductos.source === "fudo" ? "FUDO" : data.topProductos.source === "shares" ? "Shares" : "Datalive"} ·
                cobertura de costeo {data.topProductos.coberturaPct == null ? "—" : pct(data.topProductos.coberturaPct)}
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    <th className="text-left font-medium py-2 w-8">#</th>
                    <th className="text-left font-medium py-2">Producto</th>
                    <th className="text-right font-medium py-2">Unidades</th>
                    <th className="text-right font-medium py-2">% del total</th>
                    <th className="text-right font-medium py-2">CMV %</th>
                    <th className="text-right font-medium py-2">Margen %</th>
                    <th className="text-right font-medium py-2">vs mes ant.</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {topVisibles.map((it) => (
                    <tr key={it.producto} className="border-b last:border-0">
                      <td className="py-2 text-xs text-muted-foreground">{it.rank}</td>
                      <td className="py-2">{it.producto}</td>
                      <td className="py-2 text-right font-mono">{it.cantidad.toLocaleString("es-AR")}</td>
                      <td className="py-2 text-right font-mono">{pct(it.participacionPct)}</td>
                      <td className="py-2 text-right font-mono">{it.cmvPct == null ? "—" : pct(it.cmvPct)}</td>
                      <td className={`py-2 text-right font-mono ${it.margenPct != null ? ECON.text : ""}`}>
                        {it.margenPct == null ? "—" : pct(it.margenPct)}
                      </td>
                      <td className="py-2 text-right font-mono text-xs">
                        {it.esNuevo ? (
                          <Badge variant="secondary" className="text-[10px]">nuevo</Badge>
                        ) : it.variacionPct == null ? (
                          "—"
                        ) : (
                          <span className={it.variacionPct >= 0 ? "text-emerald-600 dark:text-emerald-500" : "text-destructive"}>
                            {it.variacionPct >= 0 ? "+" : ""}
                            {it.variacionPct.toFixed(1)}%
                          </span>
                        )}
                      </td>
                      <td className="py-2 text-right">
                        <button
                          type="button"
                          onClick={() => excluir(it.producto)}
                          className="text-xs text-muted-foreground hover:text-destructive"
                          title="Sacar del ranking"
                          data-testid={`button-excluir-top-${it.rank}`}
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {excluded.length > 0 && (
              <p className="mt-3 text-[11px] text-muted-foreground">
                Fuera del ranking: {excluded.join(", ")}.{" "}
                <button type="button" onClick={restablecer} className={`${ECON.text} hover:underline`} data-testid="button-restablecer-top">
                  Restablecer
                </button>
              </p>
            )}
            {data.topProductos.coberturaPct != null && data.topProductos.coberturaPct < 95 && (
              <p className="mt-3 text-[11px] text-amber-700 dark:text-amber-400">
                Los productos con "—" no tienen costo cargado todavía. Se les asigna en CMV Productos o en Productos
                Vendidos, y con eso se completan estas dos columnas.
              </p>
            )}
          </CardContent>
        </Card>
      )}

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
