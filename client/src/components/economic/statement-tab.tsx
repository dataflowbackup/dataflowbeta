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
 * Ventas NETAS (decisión del usuario del 25-sep-2026): a las facturadas se les quita el IVA
 * (÷1,21) y las no facturadas van completas; todos los % se miden sobre las ventas netas. Las
 * compras siguen con IVA. La línea de IVA de impuestos se muestra pero no resta.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency } from "@/lib/formatters";
import { AlertTriangle, FileDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { buildEconomicStatementPdf, type StatementPdfRow } from "@/lib/economic-statement-pdf";
import { commissionLabel, TAX_KIND_BY_KEY, TAX_MODE_LABELS, type TaxKind, type TaxMode } from "@shared/economicStatement";
import { ECON } from "./econ-shared";
import { Row, TreeRows, ColumnHeader, Department, ResultBand, DEPARTAMENTOS, pct, type TNode } from "./statement-visual";
import { TopProductosCard, type TopProductosData } from "./top-productos-card";
import { usePersistentFilter } from "@/hooks/usePersistentFilter";

interface Leaf {
  label: string;
  amount: number;
  pct: number;
  date?: string;
  source?: string;
  ref?: string;
  invoiceId?: number;
  /** Food Cost: el insumo tiene adentro sus facturas; sinInsumo = línea sin insumo vinculado. */
  sinInsumo?: boolean;
  items?: Leaf[];
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

/** El food cost elegido (compras o existencias) contra el de unidades vendidas, con los decomisos. */
type BrechaFoodCost =
  | { disponible: false; modo: CmvMode; motivo: string }
  | {
      disponible: true;
      modo: CmvMode;
      realLabel: string;
      locales: string[];
      ventas: number;
      real: number;
      realPct: number;
      teorico: number;
      teoricoPct: number;
      monto: number;
      puntos: number;
      decomisos: { total: number; porTipo: Array<{ tipo: string; monto: number }> };
      explicado: number;
      explicadoPct: number;
      sinJustificar: number;
      sinJustificarPuntos: number;
      coberturaBaja: boolean;
    };

interface Statement {
  period: { year: number; month: number; economicMonth: string; from: string; to: string };
  locals: Array<{ id: number; name: string }>;
  allLocalsCount: number;
  isAllLocals: boolean;
  salesSources: string[];
  ventas: {
    total: number;
    brutas: number;
    ivaFacturadas: number;
    facturado: number;
    facturadoFudo: number;
    facturadoManual: number;
    desfaseFudo: { diasSoloVentas: number; diasSoloMedios: number } | null;
    objetivo: number;
    lines: Array<{ label: string; amount: number; pct: number; kind: "sistema" | "manual"; invoiced?: boolean }>;
  };
  compras: { total: number; pct: number; groups: Node[] };
  cmv: {
    mode: CmvMode;
    modePedido: CmvMode;
    elegido: string;
    variantes: CmvVariant[];
    brecha: BrechaFoodCost | null;
  };
  gastos: { total: number; pct: number; groups: Node[]; merchandiseComputing: Array<{ id: number; label: string; amount: number }> };
  inversiones: { total: number; pct: number; groups: Node[] };
  comisiones: {
    total: number;
    pct: number;
    lines: Array<{ concept: string; amount: number; pct: number; origen: "manual" | "extractos"; byLocal: Array<{ local: string; amount: number }>; items?: Leaf[] }>;
  };
  /** Todos los impuestos en una sección (Ganancias incluido); el IVA es informativo y no resta. */
  impuestos: {
    total: number;
    pct: number;
    lines: Array<{
      kind: string;
      amount: number;
      pct: number;
      informativo: boolean;
      byLocal: Array<{ local: string; amount: number; mode: string }>;
      /** Categoría → movimientos de lo que sale de extractos; lo manual es una línea por local. */
      children?: Array<{ label: string; amount: number; pct: number; manual: boolean; meta?: string; items: Leaf[] }>;
    }>;
  };
  resumen: Record<string, number>;
  indicadores: Record<string, number>;
  ventasNoFacturadas?: {
    disponible: true;
    ventasNoEfectivo: number;
    facturado: number;
    noFacturada: number;
    noFacturadaPct: number;
    facturadoSuperaElectronico: boolean;
    ventasSinMedio: number;
    diasSinDato: number;
    sinFudo: boolean;
    desfaseFudo: { diasSoloVentas: number; diasSoloMedios: number } | null;
  };
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

/** La explicación que pidió el usuario, en la pantalla y en el PDF. */
const NOTA_IVA =
  "A las ventas facturadas se les quita el IVA (÷1,21) porque ese 21% se le debe a AFIP, no es ingreso del negocio. Las ventas no facturadas se toman completas. Los % del informe se miden sobre las ventas netas.";
const fmtDate = (iso?: string) => {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return y && m && d ? `${d}/${m}` : "";
};

/** Las seis secciones del edificio y a qué profundidad están sus "categorías" (para los botones 2 y 3). */
type SeccionId = keyof typeof DEPARTAMENTOS;
const SECCIONES: Array<{ id: SeccionId; catDepth: number }> = [
  { id: "ventas", catDepth: 1 },
  { id: "costo", catDepth: 0 },
  { id: "gastos", catDepth: 1 },
  { id: "comisiones", catDepth: 0 },
  { id: "inversiones", catDepth: 1 },
  { id: "impuestos", catDepth: 1 },
];

/** Qué abre cada botón de nivel (pedido del usuario, 16-oct-2026). */
const NIVELES: Array<{ n: number; help: string }> = [
  { n: 1, help: "Solo los totales de cada departamento" },
  { n: 2, help: "Rubros del Food Cost y categorías del resto" },
  { n: 3, help: "Sub-rubros del Food Cost y movimientos del resto" },
  { n: 4, help: "Como el 3, con el Food Cost por insumo comprado" },
  { n: 5, help: "Como el 4, con las facturas de cada insumo" },
];

const leafMeta = (it: Leaf) =>
  [fmtDate(it.date), it.source, it.invoiceId ? it.ref : null].filter(Boolean).join(" · ") || undefined;

/** Hoja genérica: un movimiento, una factura, o un insumo con sus facturas adentro. */
function leafNode(key: string, it: Leaf): TNode {
  const children = (it.items ?? []).map((x, i) => leafNode(`${key}/${i}`, x));
  return {
    key,
    label: it.label,
    amount: it.amount,
    pct: it.pct,
    meta: it.sinInsumo ? "sin insumo vinculado" : leafMeta(it),
    invoiceId: it.invoiceId,
    muted: children.length === 0,
    children,
  };
}

/** Grupo → sub-grupo → hojas (Food Cost por compras, Gastos Fijos, Inversión). */
function groupsToNodes(groups: Node[], prefix: string): TNode[] {
  return groups.map((g, gi) => ({
    key: `${prefix}/${gi}`,
    label: g.label,
    amount: g.amount,
    pct: g.pct,
    badge: g.computes === false ? "no computa" : undefined,
    children: g.children.map((c, ci) => ({
      key: `${prefix}/${gi}/${ci}`,
      label: c.label,
      amount: c.amount,
      pct: c.pct,
      children: c.items.map((it, ii) => leafNode(`${prefix}/${gi}/${ci}/${ii}`, it)),
    })),
  }));
}

/** Los árboles de los seis departamentos, con claves estables para el estado de plegado. */
function buildTrees(d: Statement): Record<SeccionId, TNode[]> {
  const ventas: TNode[] = [
    {
      key: "ventas/0",
      label: "Ventas brutas (por medio de pago)",
      amount: d.ventas.brutas,
      pct: d.ventas.total ? (d.ventas.brutas / d.ventas.total) * 100 : 0,
      children: d.ventas.lines.map((l, i) => ({
        key: `ventas/0/${i}`,
        label: l.label,
        amount: l.amount,
        pct: l.pct,
        meta: l.kind === "manual" ? `manual · ${l.invoiced ? "facturada" : "no facturada"}` : undefined,
        muted: true,
        children: [],
      })),
    },
  ];
  const variante = d.cmv.variantes.find((v) => v.key === d.cmv.mode);
  const costo: TNode[] =
    d.cmv.mode === "compras"
      ? groupsToNodes(d.compras.groups, "costo")
      : (variante?.rows ?? []).map((r) => ({
          key: `costo/${r.localId}`,
          label: r.local,
          amount: r.amount,
          pct: r.pct,
          meta: r.detalle ?? undefined,
          children: [],
        }));
  const comisiones: TNode[] = d.comisiones.lines.map((c, i) => ({
    key: `comisiones/${i}`,
    label: c.origen === "manual" ? commissionLabel(c.concept) : c.concept,
    amount: c.amount,
    pct: c.pct,
    meta: c.origen === "manual" ? "cargada a mano" : "de extractos",
    children: (c.items ?? []).map((it, ii) => leafNode(`comisiones/${i}/${ii}`, it)),
  }));
  const impuestos: TNode[] = d.impuestos.lines
    .filter((t) => !t.informativo)
    .map((t, i) => ({
      key: `impuestos/${i}`,
      label: TAX_KIND_BY_KEY[t.kind as TaxKind]?.label ?? t.kind,
      amount: t.amount,
      pct: t.pct,
      meta:
        t.byLocal.length > 1
          ? `${t.byLocal.length} locales`
          : (TAX_MODE_LABELS[t.byLocal[0]?.mode as TaxMode] ?? "a mano").toLowerCase(),
      children: (t.children ?? []).map((c, ci) => ({
        key: `impuestos/${i}/${ci}`,
        label: c.label,
        amount: c.amount,
        pct: c.pct,
        meta: c.manual ? c.meta : undefined,
        muted: c.manual,
        children: c.items.map((it, ii) => leafNode(`impuestos/${i}/${ci}/${ii}`, it)),
      })),
    }));
  return {
    ventas,
    costo,
    gastos: groupsToNodes(d.gastos.groups.filter((g) => g.computes !== false), "gastos"),
    comisiones,
    inversiones: groupsToNodes(d.inversiones?.groups ?? [], "inversiones"),
    impuestos,
  };
}

/** Los nodos que abre un botón de nivel. El 1 no abre nada (y además pliega los departamentos). */
function nodosDelNivel(trees: Record<SeccionId, TNode[]>, nivel: number): Set<string> {
  const out = new Set<string>();
  for (const sec of SECCIONES) {
    // Food Cost: 2 = rubros, 3 = sub-rubros, 4 = insumos, 5 = facturas. El resto: 2 = categorías,
    // 3 en adelante = movimientos.
    const max = sec.id === "costo" ? nivel - 3 : nivel === 2 ? sec.catDepth - 1 : nivel >= 3 ? sec.catDepth : -1;
    const walk = (nodes: TNode[], depth: number) => {
      if (depth > max) return;
      for (const n of nodes) {
        if (n.children.length === 0) continue;
        out.add(n.key);
        walk(n.children, depth + 1);
      }
    };
    walk(trees[sec.id], 0);
  }
  return out;
}

/** El título de cada departamento, igual en la pantalla y en el PDF. */
function tituloCosto(d: Statement) {
  return d.cmv.mode === "compras" ? "Food Cost — compras del mes" : `Food Cost — ${d.cmv.elegido}`;
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
          <p className="text-sm font-semibold">Food Cost</p>
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

        {cmv.brecha && <BrechaFoodCostPanel brecha={cmv.brecha} />}
      </CardContent>
    </Card>
  );
}

/**
 * Cruce del food cost elegido contra el de unidades vendidas: cuánto se fue de más, qué parte
 * explican los decomisos cargados y qué parte queda sin justificar.
 */
function BrechaFoodCostPanel({ brecha }: { brecha: BrechaFoodCost }) {
  if (!brecha.disponible) {
    return (
      <div className="rounded-lg border p-2.5">
        <p className="text-xs text-muted-foreground">
          <span className="font-semibold">Contra unidades vendidas:</span> {brecha.motivo} Calculalo en CMV Productos
          para ver cuánto del costo no está explicado.
        </p>
      </div>
    );
  }
  const b = brecha;
  const pp = (v: number) => `${v.toFixed(2)} pp`;
  return (
    <div className={`rounded-lg border ${ECON.border} p-3 space-y-2.5`} data-testid="panel-brecha-food-cost">
      <p className={`text-xs font-semibold ${ECON.text}`}>
        {b.modo === "compras" ? "Food cost por compras" : "Food cost por existencias"} contra unidades vendidas
      </p>

      <div className="grid gap-2 sm:grid-cols-3 text-xs">
        <div className="rounded border p-2">
          <p className="text-muted-foreground">Real ({b.modo === "compras" ? "compras" : "existencias"})</p>
          <p className="font-mono font-semibold">{formatCurrency(b.real)}</p>
          <p className="text-muted-foreground">{b.realPct.toFixed(2)}% de las ventas</p>
        </div>
        <div className="rounded border p-2">
          <p className="text-muted-foreground">Teórico (unidades vendidas × receta)</p>
          <p className="font-mono font-semibold">{formatCurrency(b.teorico)}</p>
          <p className="text-muted-foreground">{b.teoricoPct.toFixed(2)}% de las ventas</p>
        </div>
        <div className={`rounded border p-2 ${b.monto > 0 ? "border-destructive/40" : ""}`}>
          <p className="text-muted-foreground">Desfasaje</p>
          <p className={`font-mono font-semibold ${b.monto > 0 ? "text-destructive" : ECON.text}`}>{formatCurrency(b.monto)}</p>
          <p className="text-muted-foreground">{pp(b.puntos)} de las ventas</p>
        </div>
      </div>

      {b.monto > 0 ? (
        <>
          <div className="space-y-1">
            <div className="flex h-2.5 overflow-hidden rounded-full bg-muted">
              <div className="bg-amber-500" style={{ width: `${Math.min(100, b.explicadoPct)}%` }} />
              <div className="bg-destructive" style={{ width: `${Math.max(0, 100 - b.explicadoPct)}%` }} />
            </div>
            <div className="grid gap-2 sm:grid-cols-2 text-xs">
              <p>
                <span className="inline-block h-2 w-2 rounded-full bg-amber-500 mr-1.5" />
                <span className="font-semibold">Justificado por decomisos:</span>{" "}
                <span className="font-mono">{formatCurrency(b.explicado)}</span> ({b.explicadoPct.toFixed(1)}% del desfasaje)
              </p>
              <p>
                <span className="inline-block h-2 w-2 rounded-full bg-destructive mr-1.5" />
                <span className="font-semibold">Sin justificar:</span>{" "}
                <span className="font-mono">{formatCurrency(b.sinJustificar)}</span> ({pp(b.sinJustificarPuntos)} de las ventas)
              </p>
            </div>
          </div>
          {b.sinJustificar > 0 && (
            <p className="text-xs text-muted-foreground">
              Lo no justificado puede ser mal uso de la mercadería, desperdicios sin registrar, robos o que el
              proveedor haya entregado de menos.
            </p>
          )}
          {b.decomisos.total > 0 && (
            <p className="text-[11px] text-muted-foreground">
              Decomisos cargados en el mes: {formatCurrency(b.decomisos.total)}
              {b.decomisos.total > b.monto && " (más que el desfasaje: toda la diferencia queda justificada)"} —{" "}
              {b.decomisos.porTipo.slice(0, 5).map((t) => `${t.tipo} ${formatCurrency(t.monto)}`).join(" · ")}
              {b.decomisos.porTipo.length > 5 && " · …"}
            </p>
          )}
          {b.decomisos.total === 0 && (
            <p className="text-[11px] text-muted-foreground">No hay decomisos cargados para estos locales en el mes.</p>
          )}
        </>
      ) : (
        <p className="text-xs text-muted-foreground">
          El costo real quedó por debajo del teórico: no hay desfasaje que justificar. Si la diferencia es grande,
          suele ser una receta con costo desactualizado o productos sin costear.
        </p>
      )}

      {b.modo === "compras" && (
        <p className="text-[11px] text-amber-700 dark:text-amber-400">
          Por compras, el desfasaje también incluye la variación de stock: un mes en que se compra para stockearse
          aparece como diferencia sin que falte nada. La comparación limpia es por existencias.
        </p>
      )}
      {b.coberturaBaja && (
        <p className="text-[11px] text-amber-700 dark:text-amber-400">
          La cobertura de costeo de unidades vendidas es baja: el teórico está subvaluado y el desfasaje sale inflado.
        </p>
      )}
      <p className="text-[11px] text-muted-foreground">Comparado solo sobre {b.locales.join(", ")}, que tienen los dos cálculos.</p>
    </div>
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

  /** Top 10: endpoint propio, así cambiar la categoría o un excluido no recalcula todo el estado. */
  const [topCategoria, setTopCategoria] = usePersistentFilter<string>("balanceEconomico.topCartaCat", "");
  const [topSubcategoria, setTopSubcategoria] = usePersistentFilter<string>("balanceEconomico.topCartaSub", "");
  const topSource = salesSources[0] ?? "fudo";
  const { data: topData, isLoading: topLoading } = useQuery<TopProductosData>({
    queryKey: ["/api/economic/top-productos", year, month, localParam, topSource, topCategoria, topSubcategoria, excluded.join("|")],
    queryFn: async () => {
      const qs = new URLSearchParams({ year: String(year), month: String(month), source: topSource });
      if (localParam) qs.set("localIds", localParam);
      if (topCategoria) qs.set("cartaCategoryId", topCategoria);
      if (topSubcategoria) qs.set("cartaSubcategoryId", topSubcategoria);
      const res = await fetch(`/api/economic/top-productos?${qs}`, { credentials: "include" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.message || "Error al calcular el top");
      return res.json();
    },
    placeholderData: (prev) => prev,
  });

  /**
   * Todo el plegado vive acá y no adentro de cada departamento: el PDF exporta exactamente lo que
   * se ve en pantalla, así que necesita leer este estado. Los botones 1 a 5 lo cambian de una vez;
   * después cada fila se sigue abriendo y cerrando a mano (y el botón deja de marcarse).
   */
  const [openSections, setOpenSections] = useState<string[]>(SECCIONES.map((s) => s.id));
  const [openNodes, setOpenNodes] = useState<Set<string>>(() => new Set(["ventas/0"]));
  /** 0 = ningún botón marcado (se tocó algo a mano). Sobrevive al cambiar de mes o de local. */
  const [nivel, setNivel] = usePersistentFilter<number>("balanceEconomico.nivel", 0);

  const trees = useMemo(() => (data ? buildTrees(data) : null), [data]);

  const aplicarNivel = (n: number) => {
    if (!trees) return;
    setNivel(n);
    setOpenSections(n >= 2 ? SECCIONES.map((s) => s.id) : []);
    setOpenNodes(nodosDelNivel(trees, n));
  };
  // Al cambiar de mes o de local los árboles son otros: el nivel elegido se vuelve a aplicar.
  useEffect(() => {
    if (trees && nivel) aplicarNivel(nivel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trees]);

  const isSectionOpen = (k: string) => openSections.includes(k);
  const toggleSection = (k: string) => {
    setNivel(0);
    setOpenSections((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]));
  };
  const toggleNode = (k: string) => {
    setNivel(0);
    setOpenNodes((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  /**
   * Aplana a filas EXACTAMENTE lo que se está viendo: respeta qué departamentos y qué filas
   * quedaron desplegados. Es lo que se manda al PDF, así el papel sale igual que la pantalla.
   */
  const buildPdfRows = (d: Statement, t: Record<SeccionId, TNode[]>): StatementPdfRow[] => {
    const out: StatementPdfRow[] = [];
    const push = (
      label: string,
      amount: number,
      pctValue: number | null,
      level: 0 | 1 | 2 | 3,
      kind: StatementPdfRow["kind"],
      meta?: string,
    ) => out.push({ label, amount, pct: pctValue, level, kind, meta });

    const flatten = (nodes: TNode[], depth: number) => {
      for (const n of nodes) {
        const meta = [n.badge, n.meta].filter(Boolean).join(" · ");
        push(n.label, n.amount ?? 0, n.pct, Math.min(depth, 3) as 0 | 1 | 2 | 3, "row", meta || undefined);
        if (n.children.length > 0 && openNodes.has(n.key)) flatten(n.children, depth + 1);
      }
    };
    const section = (id: SeccionId, title: string, amount: number, pctValue: number) => {
      push(title, amount, pctValue, 0, "section");
      if (isSectionOpen(id)) flatten(t[id], 0);
    };

    section("ventas", "Ventas netas", d.ventas.total, 100);
    if (isSectionOpen("ventas")) {
      push(
        "IVA contenido en ventas facturadas",
        -d.ventas.ivaFacturadas,
        d.ventas.total ? (-d.ventas.ivaFacturadas / d.ventas.total) * 100 : 0,
        0,
        "row",
        `facturado ${formatCurrency(d.ventas.facturado)} ÷ 1,21`,
      );
      if (d.ventas.objetivo > 0) push("Objetivo del mes", d.ventas.objetivo, null, 0, "row");
    }
    section("costo", tituloCosto(d), d.resumen.costoMercaderia, d.indicadores.foodCostPct);
    push("Utilidad bruta", d.resumen.utilidadBruta, d.indicadores.utilidadBrutaPct, 0, "subtotal");
    section("gastos", DEPARTAMENTOS.gastos.title, d.gastos.total, d.gastos.pct);
    section("comisiones", DEPARTAMENTOS.comisiones.title, d.comisiones.total, d.comisiones.pct);
    push("Resultado operativo", d.resumen.resultadoOperativo, d.indicadores.resultadoOperativoPct, 0, "subtotal");
    section("inversiones", DEPARTAMENTOS.inversiones.title, d.inversiones.total, d.inversiones.pct);
    push(
      "Resultado operativo con inversión (antes de impuestos)",
      d.resumen.resultadoConInversion,
      d.indicadores.resultadoConInversionPct,
      0,
      "subtotal",
    );
    section("impuestos", "Impuestos sobre ingresos y movimientos", d.impuestos.total, d.impuestos.pct);
    push("Resultado neto", d.resumen.resultadoNeto, d.indicadores.resultadoNetoPct, 0, "grand");

    return out;
  };

  /** El IVA de la solapa Impuestos: se muestra aparte porque NO incide en el resultado. */
  const informativos = (data?.impuestos.lines ?? []).filter((t) => t.informativo && Math.abs(t.amount) >= 0.005);

  const exportPdf = () => {
    if (!data || !trees) return;
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
      rows: buildPdfRows(data, trees),
      informativos: informativos.map((t) => ({
        label: TAX_KIND_BY_KEY[t.kind as TaxKind]?.label ?? t.kind,
        amount: t.amount,
        pct: t.pct,
        meta: "ya se descontó de las ventas facturadas, no resta",
      })),
      indicadores: [
        { label: "Food cost %", value: data.indicadores.foodCostPct },
        { label: "Utilidad bruta %", value: data.indicadores.utilidadBrutaPct },
        { label: "Gastos fijos %", value: data.indicadores.gastosPct },
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
        v && v.disponible ? { noFacturada: v.noFacturada, pct: v.noFacturadaPct, total: v.ventasNoEfectivo } : null,
      notaIva: NOTA_IVA,
      comparativo: data.anterior
        ? {
            mesAnterior: data.anterior.period.economicMonth,
            lineas: [
              { label: "Ventas netas", hoy: data.resumen.ventas, antes: data.anterior.resumen.ventas },
              { label: "Food Cost", hoy: data.resumen.costoMercaderia, antes: data.anterior.resumen.costoMercaderia },
              { label: "Utilidad bruta", hoy: data.resumen.utilidadBruta, antes: data.anterior.resumen.utilidadBruta },
              { label: "Gastos Fijos", hoy: data.resumen.gastos, antes: data.anterior.resumen.gastos },
              { label: "Comisiones", hoy: data.resumen.comisiones, antes: data.anterior.resumen.comisiones },
              { label: "Inversión", hoy: data.resumen.inversiones ?? 0, antes: data.anterior.resumen.inversiones ?? 0 },
              { label: "Impuestos", hoy: data.resumen.impuestos ?? 0, antes: data.anterior.resumen.impuestos ?? 0 },
              { label: "Resultado neto", hoy: data.resumen.resultadoNeto, antes: data.anterior.resumen.resultadoNeto },
            ],
          }
        : null,
      topProductos: topData && topData.items.length > 0
        ? {
            source: topData.source,
            coberturaPct: topData.coberturaPct,
            items: topData.items,
          }
        : null,
    });
    doc.save(`estado-resultado-economico_${data.period.economicMonth}.pdf`);
  };

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
  if (!data || !trees) return null;

  const R = data.resumen;
  const I = data.indicadores;
  const desvioVentas = data.ventas.objetivo > 0 ? data.ventas.total - data.ventas.objetivo : null;

  const sinRubro = data.compras.groups.find((g) => g.label === "Sin rubro asignado");
  const deptProps = (id: SeccionId) => ({
    open: isSectionOpen(id),
    onToggle: () => toggleSection(id),
    testId: `section-${id}`,
  });
  const vacio = (texto: string) => <p className="px-4 py-3 text-sm text-muted-foreground">{texto}</p>;

  return (
    <div className="space-y-4">
      {/* Fija arriba al bajar: los botones de nivel y el PDF siempre a mano (pedido del usuario, 16-oct). */}
      <Card className={`${ECON.border} sticky top-0 z-20 shadow-sm`} data-testid="barra-niveles">
        <CardContent className="py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
            <span>
              <span className="font-medium text-foreground">{monthLabel}</span> · {data.isAllLocals
                ? `Todos los locales (${data.allLocalsCount})`
                : `${data.locals.map((l) => l.name).join(" · ")} (${data.locals.length} de ${data.allLocalsCount})`}
            </span>
            <span>Ventas de: {data.salesSources.map((s) => (s === "fudo" ? "FUDO" : s === "shares" ? "Shares" : "Datalive")).join(" + ")}</span>
            <span>Ventas netas de IVA en lo facturado · compras con IVA</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Nivel</span>
            <div className="flex items-center gap-1" data-testid="niveles">
              {NIVELES.map((n) => (
                <button
                  key={n.n}
                  type="button"
                  title={n.help}
                  onClick={() => aplicarNivel(n.n)}
                  className={`h-8 w-8 rounded-md border text-sm font-semibold transition-colors ${nivel === n.n ? ECON.chipOn : ECON.chipOff}`}
                  data-testid={`button-nivel-${n.n}`}
                >
                  {n.n}
                </button>
              ))}
            </div>
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

      {data.ventas.desfaseFudo && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 flex gap-2 items-start" data-testid="alert-desfase-fudo">
          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-500 mt-0.5 shrink-0" />
          <p className="text-sm text-amber-700 dark:text-amber-400">
            Los dos archivos de FUDO de este mes no tienen los mismos días cargados
            {data.ventas.desfaseFudo.diasSoloVentas > 0 &&
              `: ${data.ventas.desfaseFudo.diasSoloVentas} día(s) están en el de ventas y faltan en el de medios de pago`}
            {data.ventas.desfaseFudo.diasSoloMedios > 0 &&
              `${data.ventas.desfaseFudo.diasSoloVentas > 0 ? " y" : ":"} ${data.ventas.desfaseFudo.diasSoloMedios} día(s) están en el de medios de pago y faltan en el de ventas`}
            . Las ventas salen de los medios de pago y el IVA de lo facturado del archivo de ventas, así que el IVA
            restado no corresponde a las ventas mostradas. Re-importá el mes completo de FUDO.
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

      {/* ── EL EDIFICIO: un departamento por tarjeta, con los resultados entre medio ── */}
      <div className="space-y-6" data-testid="estado-edificio">
        <ColumnHeader />

        <Department {...deptProps("ventas")} title="Ventas netas" amount={data.ventas.total} pctValue={100}>
          <TreeRows nodes={trees.ventas} openNodes={openNodes} onToggle={toggleNode} />
          <Row
            label="− IVA contenido en ventas facturadas"
            amount={-data.ventas.ivaFacturadas}
            pctValue={data.ventas.total ? (-data.ventas.ivaFacturadas / data.ventas.total) * 100 : 0}
            level={0}
            tone={data.ventas.ivaFacturadas > 0 ? "negative" : "muted"}
            meta={
              data.ventas.facturado > 0
                ? `facturado ${formatCurrency(data.ventas.facturado)} ÷ 1,21${
                    data.ventas.facturadoManual > 0
                      ? ` (FUDO ${formatCurrency(data.ventas.facturadoFudo)} + manuales ${formatCurrency(data.ventas.facturadoManual)})`
                      : ""
                  }`
                : data.salesSources.includes("fudo")
                  ? "no hay ventas facturadas en el mes"
                  : "sin FUDO: todas las ventas cuentan como no facturadas"
            }
            testId="row-iva-ventas"
          />
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
          <p className="px-4 py-2 text-[11px] text-muted-foreground bg-muted/20" data-testid="text-nota-iva">
            {NOTA_IVA}
          </p>
        </Department>

        <Department {...deptProps("costo")} title={tituloCosto(data)} amount={R.costoMercaderia} pctValue={I.foodCostPct}>
          {trees.costo.length === 0
            ? vacio("No hay facturas de compra cargadas en este mes.")
            : <TreeRows nodes={trees.costo} openNodes={openNodes} onToggle={toggleNode} />}
        </Department>

        <ResultBand label="Utilidad bruta" amount={R.utilidadBruta} pctValue={I.utilidadBrutaPct} testId="band-utilidad-bruta" />

        <Department {...deptProps("gastos")} title={DEPARTAMENTOS.gastos.title} amount={data.gastos.total} pctValue={data.gastos.pct}>
          {trees.gastos.length === 0
            ? vacio("No hay movimientos con mes económico en este período.")
            : <TreeRows nodes={trees.gastos} openNodes={openNodes} onToggle={toggleNode} />}
        </Department>

        <Department {...deptProps("comisiones")} title={DEPARTAMENTOS.comisiones.title} amount={data.comisiones.total} pctValue={data.comisiones.pct}>
          {trees.comisiones.length === 0
            ? vacio('No hay comisiones en este mes. Cargalas en la solapa Comisiones o asigná categorías de extractos en "Categorías que SÍ computan".')
            : <TreeRows nodes={trees.comisiones} openNodes={openNodes} onToggle={toggleNode} />}
        </Department>

        <ResultBand label="Resultado operativo" amount={R.resultadoOperativo} pctValue={I.resultadoOperativoPct} testId="band-resultado-operativo" />

        <Department {...deptProps("inversiones")} title={DEPARTAMENTOS.inversiones.title} amount={data.inversiones.total} pctValue={data.inversiones.pct}>
          {trees.inversiones.length === 0
            ? vacio('No hay inversión en este mes. Se arma con las categorías que mandes a "Inversión" en "Categorías que SÍ computan".')
            : <TreeRows nodes={trees.inversiones} openNodes={openNodes} onToggle={toggleNode} />}
        </Department>

        <ResultBand
          label="Resultado operativo con inversión"
          hint="antes de impuestos"
          amount={R.resultadoConInversion}
          pctValue={I.resultadoConInversionPct}
          testId="band-resultado-con-inversion"
        />

        <Department
          {...deptProps("impuestos")}
          title={DEPARTAMENTOS.impuestos.title}
          subtitle="sobre ingresos y movimientos"
          amount={data.impuestos.total}
          pctValue={data.impuestos.pct}
        >
          {trees.impuestos.length === 0
            ? vacio('No hay impuestos en este mes. Cargalos en la solapa Impuestos o asigná categorías de extractos en "Categorías que SÍ computan".')
            : <TreeRows nodes={trees.impuestos} openNodes={openNodes} onToggle={toggleNode} />}
        </Department>

        <ResultBand grand label="Resultado neto" amount={R.resultadoNeto} pctValue={I.resultadoNetoPct} testId="band-resultado-neto" />

        {informativos.length > 0 && (
          <Card className="border-dashed" data-testid="card-informativos">
            <div className="px-4 pt-3 pb-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Datos informativos</p>
              <p className="text-[11px] text-muted-foreground">No inciden en el resultado: se muestran solo como referencia.</p>
            </div>
            {informativos.map((t) => (
              <Row
                key={t.kind}
                label={TAX_KIND_BY_KEY[t.kind as TaxKind]?.label ?? t.kind}
                amount={t.amount}
                pctValue={t.pct}
                level={0}
                tone="muted"
                meta="ya se descontó de las ventas facturadas, no resta"
              />
            ))}
          </Card>
        )}
      </div>

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
                    { key: "costoMercaderia", label: "Food Cost", bueno: "baja" as const },
                    { key: "utilidadBruta", label: "Utilidad bruta", bueno: "sube" as const },
                    { key: "gastos", label: "Gastos Fijos", bueno: "baja" as const },
                    { key: "comisiones", label: "Comisiones", bueno: "baja" as const },
                    { key: "resultadoOperativo", label: "Resultado operativo", bueno: "sube" as const },
                    { key: "inversiones", label: "Inversión", bueno: "baja" as const },
                    { key: "impuestos", label: "Impuestos", bueno: "baja" as const },
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
                  El margen de contribución no es positivo: con este food cost no hay volumen de ventas
                  que alcance el equilibrio.
                </p>
              ) : (
                <>
                  <p className={`text-2xl font-bold font-mono ${ECON.text}`}>
                    {formatCurrency(data.puntoEquilibrio.ventasNecesarias ?? 0)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Costos fijos {formatCurrency(data.puntoEquilibrio.costosFijos)} ÷ margen de contribución{" "}
                    {pct(data.puntoEquilibrio.margenContribucionPct)}. Gastos fijos + comisiones + impuestos operativos.
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
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Ventas con medio de pago no facturadas
              </p>
              {(() => {
                const v = data.ventasNoFacturadas!;
                return (
                  <>
                    <p className="text-2xl font-bold font-mono text-amber-600 dark:text-amber-500" data-testid="text-no-facturadas">
                      {formatCurrency(v.noFacturada)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Cobrado por tarjeta, QR, transferencia y cuenta corriente {formatCurrency(v.ventasNoEfectivo)} − facturado{" "}
                      {formatCurrency(v.facturado)}. Es el {pct(v.noFacturadaPct)} de lo cobrado sin efectivo.
                    </p>
                    {v.sinFudo && (
                      <p className="text-[11px] text-muted-foreground">
                        Sin FUDO no hay dato de facturación: todas las ventas cuentan como no facturadas.
                      </p>
                    )}
                    {v.facturadoSuperaElectronico && (
                      <p className="text-[11px] text-muted-foreground">
                        Lo facturado supera a lo cobrado sin efectivo: también se facturaron ventas en efectivo.
                      </p>
                    )}
                    {v.ventasSinMedio > 0 && (
                      <p className="text-[11px] text-muted-foreground">
                        No incluye {formatCurrency(v.ventasSinMedio)} de ventas sin medio de pago especificado.
                      </p>
                    )}
                    {v.desfaseFudo && (
                      <p className="text-[11px] text-amber-700 dark:text-amber-400">
                        Ojo: los dos archivos de FUDO no tienen los mismos días cargados, así que este número no es confiable
                        hasta completarlos (ver el aviso de arriba).
                      </p>
                    )}
                    {v.diasSinDato > 0 && (
                      <p className="text-[11px] text-muted-foreground">
                        {v.diasSinDato} día(s) de FUDO importados sin la columna de facturación: no suman como facturado.
                      </p>
                    )}
                    <p className="text-[11px] text-muted-foreground">
                      Estimado por diferencia de totales: FUDO marca qué ticket se facturó, pero no con qué medio se pagó.
                    </p>
                  </>
                );
              })()}
            </CardContent>
          </Card>
        )}
      </div>

      {/* ── TOP 10 PRODUCTOS ── */}
      <TopProductosCard
        data={topData}
        isLoading={topLoading}
        categoria={topCategoria}
        subcategoria={topSubcategoria}
        onFilterChange={(c, sc) => {
          setTopCategoria(c);
          setTopSubcategoria(sc);
        }}
        excluded={excluded}
        onExcludedChange={(productos) => saveExcluded.mutate(productos)}
      />

      {/* ── INDICADORES ── */}
      <Card>
        <CardContent className="pt-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Indicadores</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {[
              { label: "Food cost %", value: I.foodCostPct, hint: "Compras sobre ventas" },
              { label: "Utilidad bruta %", value: I.utilidadBrutaPct, hint: "Ventas − costo de insumos" },
              { label: "Gastos fijos %", value: I.gastosPct, hint: "Gastos fijos sobre ventas" },
              { label: "Resultado operativo %", value: I.resultadoOperativoPct, hint: "Antes de inversión e impuestos" },
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
