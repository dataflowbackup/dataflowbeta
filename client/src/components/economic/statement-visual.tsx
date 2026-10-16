/**
 * Piezas visuales del Estado de Resultado Económico, compartidas con las pantallas de
 * "Estructura Food Cost" y "Estructura Imputaciones": la idea del usuario (16-oct-2026) es que al
 * crear rubros, grupos o categorías se vea EXACTAMENTE cómo van a quedar en el informe, así que
 * las tres pantallas dibujan con estas mismas piezas.
 *
 * El informe es un "edificio": cada departamento (Ventas, Food Cost, Gastos Fijos, Comisiones,
 * Inversión, Impuestos) es una tarjeta aparte, y los resultados (utilidad bruta, resultado
 * operativo...) son las bandas que quedan entre un departamento y el siguiente.
 */
import { Link } from "wouter";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/formatters";
import { ChevronRight, ChevronDown, ExternalLink } from "lucide-react";
import { ECON } from "./econ-shared";

/**
 * Ancho de las dos columnas numéricas, en un solo lugar. Tienen que coincidir en el encabezado,
 * en las filas, en los departamentos y en las bandas de resultado: si una se desalinea, la
 * columna de porcentaje se corta contra el borde de la tarjeta.
 */
export const COL_IMPORTE = "w-40";
export const COL_PCT = "w-20";

export const pct = (v: number) => `${v.toFixed(1)}%`;

/** Un nodo del árbol de un departamento. Cualquier profundidad: rubro → sub-rubro → insumo → factura. */
export interface TNode {
  /** Ruta única dentro del informe ("costo/0/2/1"): es lo que guarda el estado de plegado. */
  key: string;
  label: string;
  /** null en las pantallas de estructura cuando no se eligió un mes con números. */
  amount: number | null;
  pct: number | null;
  meta?: string;
  badge?: string;
  invoiceId?: number;
  muted?: boolean;
  /** Botones de la fila (editar, borrar...) en las pantallas de estructura. */
  actions?: React.ReactNode;
  children: TNode[];
}

const PADS = ["pl-2", "pl-6", "pl-12", "pl-[4.5rem]", "pl-24"];

/** Una fila del informe. La sangría marca el nivel; el % es siempre sobre ventas. */
export function Row({
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
  amount: number | null;
  pctValue: number | null;
  level: number;
  bold?: boolean;
  tone?: "total" | "muted" | "negative";
  right?: React.ReactNode;
  onClick?: () => void;
  open?: boolean;
  hasChildren?: boolean;
  meta?: React.ReactNode;
  testId?: string;
}) {
  const pad = PADS[Math.min(level, PADS.length - 1)];
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
      <span className={`${COL_IMPORTE} shrink-0 text-right font-mono text-sm ${toneClass}`}>
        {amount == null ? "" : formatCurrency(amount)}
      </span>
      <span className={`${COL_PCT} shrink-0 text-right font-mono text-xs text-muted-foreground`}>
        {pctValue == null ? "" : pct(pctValue)}
      </span>
    </div>
  );
}

/** Dibuja un árbol completo respetando qué nodos están abiertos. */
export function TreeRows({
  nodes,
  depth = 0,
  openNodes,
  onToggle,
}: {
  nodes: TNode[];
  depth?: number;
  openNodes: Set<string>;
  onToggle: (key: string) => void;
}) {
  return (
    <>
      {nodes.map((n) => {
        const has = n.children.length > 0;
        const isOpen = has && openNodes.has(n.key);
        return (
          <div key={n.key}>
            <Row
              label={n.label}
              amount={n.amount}
              pctValue={n.pct}
              level={depth}
              bold={depth === 0 && has}
              tone={n.muted ? "muted" : undefined}
              hasChildren={has}
              open={isOpen}
              onClick={has ? () => onToggle(n.key) : undefined}
              meta={
                n.badge || n.meta ? (
                  <>
                    {n.badge && <Badge variant="outline" className="text-[10px] mr-1.5">{n.badge}</Badge>}
                    {n.meta}
                  </>
                ) : undefined
              }
              right={
                <>
                  {n.actions && (
                    <span className="shrink-0 flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                      {n.actions}
                    </span>
                  )}
                  {n.invoiceId ? (
                    <Link
                      href={`/facturas/${n.invoiceId}`}
                      onClick={(e) => e.stopPropagation()}
                      className={`shrink-0 ${ECON.text} hover:underline`}
                      title="Abrir la factura"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </Link>
                  ) : null}
                </>
              }
              testId={`row-${n.key}`}
            />
            {isOpen && <TreeRows nodes={n.children} depth={depth + 1} openNodes={openNodes} onToggle={onToggle} />}
          </div>
        );
      })}
    </>
  );
}

/** Encabezado de las columnas, una sola vez arriba del edificio. */
export function ColumnHeader({ first = "Concepto" }: { first?: string }) {
  return (
    <div className="flex items-center gap-2 pl-2 pr-3 py-2 rounded-md border bg-muted/40 text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
      <span className="w-4 shrink-0" />
      <span className="flex-1">{first}</span>
      <span className={`${COL_IMPORTE} text-right`}>Importe</span>
      <span className={`${COL_PCT} text-right whitespace-nowrap`}>% s/Vtas</span>
    </div>
  );
}

/**
 * Un departamento del edificio: tarjeta propia con su número, su total y su contenido. El
 * encabezado pliega y despliega TODO lo que tiene abajo.
 */
export function Department({
  numero,
  title,
  subtitle,
  amount,
  pctValue,
  open,
  onToggle,
  actions,
  children,
  testId,
}: {
  numero: number;
  title: string;
  subtitle?: string;
  amount: number | null;
  pctValue: number | null;
  open: boolean;
  onToggle?: () => void;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  testId?: string;
}) {
  return (
    <Card className={`overflow-hidden ${ECON.border}`} data-testid={testId}>
      <div
        className={`flex items-center gap-2 pl-2 pr-3 py-2.5 ${ECON.bg} ${open ? `border-b ${ECON.border}` : ""} ${onToggle ? "cursor-pointer hover:brightness-95" : ""}`}
        onClick={onToggle}
      >
        <span className={`w-4 shrink-0 ${ECON.text}`}>
          {onToggle ? (open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />) : null}
        </span>
        <span
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${ECON.bgSolid} text-[10px] font-bold text-white`}
          title={`Departamento ${numero}`}
        >
          {numero}
        </span>
        <div className="flex-1 min-w-0">
          <span className={`text-xs font-semibold uppercase tracking-wide ${ECON.text}`}>{title}</span>
          {subtitle && <span className="ml-2 text-[11px] text-muted-foreground normal-case">{subtitle}</span>}
        </div>
        {actions && (
          <span className="shrink-0 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            {actions}
          </span>
        )}
        <span className={`${COL_IMPORTE} shrink-0 text-right font-mono text-sm font-semibold ${ECON.text}`}>
          {amount == null ? "" : formatCurrency(amount)}
        </span>
        <span className={`${COL_PCT} shrink-0 text-right font-mono text-xs ${ECON.textSoft}`}>
          {pctValue == null ? "" : pct(pctValue)}
        </span>
      </div>
      {open && children}
    </Card>
  );
}

/** La banda de resultado que separa un departamento del siguiente (la "losa" entre pisos). */
export function ResultBand({
  label,
  amount,
  pctValue,
  grand,
  hint,
  testId,
}: {
  label: string;
  amount: number | null;
  pctValue: number | null;
  grand?: boolean;
  hint?: string;
  testId?: string;
}) {
  const negative = amount != null && amount < 0;
  const color = negative ? "text-destructive" : ECON.text;
  return (
    <div
      className={`flex items-center gap-2 pl-2 pr-3 ${grand ? "py-3.5 border-2" : "py-2.5 border"} rounded-lg ${ECON.border} ${grand ? ECON.bg : "bg-background"}`}
      data-testid={testId}
    >
      <span className="w-4 shrink-0" />
      <div className="flex-1 min-w-0">
        <span className={`${grand ? "text-base font-bold" : "text-sm font-bold"} uppercase tracking-wide ${color}`}>{label}</span>
        {hint && <span className="ml-2 text-[11px] text-muted-foreground normal-case">{hint}</span>}
      </div>
      <span className={`${COL_IMPORTE} shrink-0 text-right font-mono ${grand ? "text-base" : "text-sm"} font-bold ${color}`}>
        {amount == null ? "" : formatCurrency(amount)}
      </span>
      <span className={`${COL_PCT} shrink-0 text-right font-mono text-xs font-semibold ${color}`}>
        {pctValue == null ? "" : pct(pctValue)}
      </span>
    </div>
  );
}

/** Los seis departamentos, en el orden del informe. Los usan también las pantallas de estructura. */
export const DEPARTAMENTOS = {
  ventas: { numero: 1, title: "Ventas" },
  costo: { numero: 2, title: "Food Cost" },
  gastos: { numero: 3, title: "Gastos Fijos" },
  comisiones: { numero: 4, title: "Comisiones" },
  inversiones: { numero: 5, title: "Inversión" },
  impuestos: { numero: 6, title: "Impuestos" },
} as const;
