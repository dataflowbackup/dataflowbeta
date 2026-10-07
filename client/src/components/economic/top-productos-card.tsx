/**
 * Top 10 de productos del Estado de Resultado Económico (oct-2026).
 *
 * Filtros: por categoría (la del sistema de ventas) y un desplegable con todos los productos del
 * mes para elegir cuáles se ven y cuáles no aparecen nunca. Lo destildado se guarda en las
 * preferencias de la empresa (economic_top_excluded): queda fijo para todos y en cualquier
 * computadora. Las exclusiones se aplican en el servidor, así el % mide contra lo que se ve.
 */
import { useMemo, useState } from "react";
import { ListFilter } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ECON } from "./econ-shared";

export interface TopProductosData {
  source: string;
  categoria: string | null;
  coberturaPct: number | null;
  unidades: number;
  categorias: Array<{ categoria: string; cantidad: number }>;
  productos: Array<{ producto: string; categoria: string | null; cantidad: number; excluido: boolean }>;
  items: Array<{
    rank: number;
    producto: string;
    categoria: string | null;
    cantidad: number;
    participacionPct: number;
    cmvPct: number | null;
    margenPct: number | null;
    variacionPct: number | null;
    esNuevo: boolean;
  }>;
}

const ALL = "__all__";
const pct = (v: number) => `${v.toFixed(1)}%`;
const sourceLabel = (s: string) => (s === "fudo" ? "FUDO" : s === "shares" ? "Shares" : "Datalive");

export function TopProductosCard({
  data,
  isLoading,
  categoria,
  onCategoriaChange,
  excluded,
  onExcludedChange,
}: {
  data: TopProductosData | undefined;
  isLoading: boolean;
  categoria: string;
  onCategoriaChange: (c: string) => void;
  excluded: string[];
  onExcludedChange: (productos: string[]) => void;
}) {
  const [search, setSearch] = useState("");
  const excludedSet = useMemo(() => new Set(excluded.map((p) => p.trim().toLowerCase())), [excluded]);
  const isExcluded = (p: string) => excludedSet.has(p.trim().toLowerCase());
  const toggle = (p: string) =>
    onExcludedChange(isExcluded(p) ? excluded.filter((x) => x.trim().toLowerCase() !== p.trim().toLowerCase()) : [...excluded, p]);

  const productos = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.productos ?? []).filter((p) => !q || p.producto.toLowerCase().includes(q));
  }, [data?.productos, search]);

  const sinCategorias = (data?.categorias ?? []).every((c) => c.categoria === "Sin categoría");

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-baseline justify-between gap-3 flex-wrap mb-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Los 10 productos más vendidos del mes{categoria ? ` — ${categoria}` : ""}
          </p>
          {data && (
            <p className="text-[11px] text-muted-foreground">
              Origen: {sourceLabel(data.source)} · cobertura de costeo {data.coberturaPct == null ? "—" : pct(data.coberturaPct)}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-3">
          <Select value={categoria || ALL} onValueChange={(v) => onCategoriaChange(v === ALL ? "" : v)}>
            <SelectTrigger className="h-8 w-56 text-xs" data-testid="select-top-categoria">
              <SelectValue placeholder="Categoría" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL} className="text-xs">Todas las categorías</SelectItem>
              {(data?.categorias ?? []).map((c) => (
                <SelectItem key={c.categoria} value={c.categoria} className="text-xs">
                  {c.categoria} · {c.cantidad.toLocaleString("es-AR")} un.
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" data-testid="button-top-productos">
                <ListFilter className="h-3.5 w-3.5" />
                Productos que se ven
                {excluded.length > 0 && <Badge variant="secondary" className="text-[10px]">{excluded.length} ocultos</Badge>}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80 space-y-2" align="start">
              <p className="text-xs text-muted-foreground">
                Destildá los que nunca tienen que aparecer en el top (cubiertos, servicio de mesa, delivery…). Queda
                guardado para la empresa.
              </p>
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar producto…"
                className="h-8 text-xs"
              />
              <div className="max-h-72 space-y-0.5 overflow-y-auto">
                {productos.map((p) => (
                  <label key={p.producto} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-muted">
                    <Checkbox checked={!isExcluded(p.producto)} onCheckedChange={() => toggle(p.producto)} />
                    <span className={`flex-1 truncate text-xs ${isExcluded(p.producto) ? "text-muted-foreground line-through" : ""}`}>
                      {p.producto}
                    </span>
                    <span className="text-[10px] text-muted-foreground font-mono">{p.cantidad.toLocaleString("es-AR")}</span>
                  </label>
                ))}
                {productos.length === 0 && <p className="py-3 text-center text-xs text-muted-foreground">Sin productos.</p>}
              </div>
              {excluded.length > 0 && (
                <Button variant="ghost" size="sm" className="h-7 w-full text-xs" onClick={() => onExcludedChange([])}>
                  Mostrar todos de nuevo
                </Button>
              )}
            </PopoverContent>
          </Popover>
        </div>

        {isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : !data || data.items.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">
            {categoria ? `No hay ventas de "${categoria}" en este mes.` : "No hay productos vendidos importados en este mes."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="text-left font-medium py-2 w-8">#</th>
                  <th className="text-left font-medium py-2">Producto</th>
                  <th className="text-right font-medium py-2">Unidades</th>
                  <th className="text-right font-medium py-2">{categoria ? "% de la categoría" : "% del total"}</th>
                  <th className="text-right font-medium py-2">CMV %</th>
                  <th className="text-right font-medium py-2">Margen %</th>
                  <th className="text-right font-medium py-2" title="Variación de las unidades vendidas contra el mes anterior">
                    Unid. vs mes anterior
                  </th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {data.items.map((it) => (
                  <tr key={it.producto} className="border-b last:border-0">
                    <td className="py-2 text-xs text-muted-foreground">{it.rank}</td>
                    <td className="py-2">
                      {it.producto}
                      {!categoria && it.categoria && <span className="ml-2 text-[10px] text-muted-foreground">{it.categoria}</span>}
                    </td>
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
                        onClick={() => toggle(it.producto)}
                        className="text-xs text-muted-foreground hover:text-destructive"
                        title="Sacar del ranking (se puede volver a mostrar en 'Productos que se ven')"
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
        )}
        <p className="mt-3 text-[11px] text-muted-foreground">
          La columna "Unid. vs mes anterior" compara las unidades vendidas de cada producto contra las del mes anterior.
          {sinCategorias && data?.source === "datalive" &&
            " Datalive guarda la categoría desde octubre de 2026: importá un reporte de productos nuevo y los meses anteriores también quedan clasificados."}
        </p>
      </CardContent>
    </Card>
  );
}
