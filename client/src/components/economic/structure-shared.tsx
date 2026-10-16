/**
 * Piezas comunes de las dos pantallas de estructura ("Estructura Food Cost" y "Estructura
 * Imputaciones"): el selector "ver con los números de [mes]", el mapa del edificio que marca en qué
 * departamento se está trabajando y los botones de nivel.
 */
import { useQuery } from "@tanstack/react-query";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ECON } from "./econ-shared";
import { DEPARTAMENTOS } from "./statement-visual";

const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

/** Los últimos 12 meses, del más reciente al más viejo, como "YYYY-MM". */
export function ultimosMeses(n = 12): Array<{ value: string; label: string }> {
  const out: Array<{ value: string; label: string }> = [];
  const d = new Date();
  for (let i = 0; i < n; i++) {
    const y = d.getFullYear();
    const m = d.getMonth();
    out.push({ value: `${y}-${String(m + 1).padStart(2, "0")}`, label: `${MESES[m]} ${y}` });
    d.setMonth(d.getMonth() - 1);
  }
  return out;
}

export function MesConNumeros({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground whitespace-nowrap">Ver con los números de</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-8 w-44" data-testid="select-mes-numeros">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">Sin números</SelectItem>
          {ultimosMeses().map((m) => (
            <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * El informe del mes elegido, solo para poner números al lado de la estructura. Todos los locales
 * y Food Cost por compras: es lo que arma el árbol rubro → sub-rubro → insumo.
 */
export function useEstadoDelMes<T>(mes: string) {
  const [y, m] = mes.split("-");
  return useQuery<T>({
    queryKey: ["/api/economic/statement", Number(y), Number(m), "", "datalive", "compras"],
    queryFn: async () => {
      const qs = new URLSearchParams({ year: y, month: String(Number(m)), salesSources: "datalive", cmvMode: "compras" });
      const res = await fetch(`/api/economic/statement?${qs}`, { credentials: "include" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.message || "Error al calcular");
      return res.json();
    },
    enabled: mes !== "none",
    staleTime: 5 * 60 * 1000,
  });
}

/** El edificio en miniatura: muestra dónde cae lo que se está armando en esta pantalla. */
export function MapaEdificio({ activos }: { activos: Array<keyof typeof DEPARTAMENTOS> }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[11px]" data-testid="mapa-edificio">
      <span className="text-muted-foreground mr-1">En el Estado de Resultado Económico:</span>
      {(Object.keys(DEPARTAMENTOS) as Array<keyof typeof DEPARTAMENTOS>).map((k) => {
        const on = activos.includes(k);
        return (
          <span
            key={k}
            className={`rounded-full border px-2 py-0.5 ${on ? ECON.chipOn : "text-muted-foreground border-dashed"}`}
          >
            {DEPARTAMENTOS[k].numero}. {DEPARTAMENTOS[k].title}
          </span>
        );
      })}
    </div>
  );
}

/** Botones de nivel, iguales a los del informe. */
export function BotonesNivel({
  niveles,
  activo,
  onChange,
}: {
  niveles: Array<{ n: number; help: string }>;
  activo: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">Nivel</span>
      <div className="flex items-center gap-1">
        {niveles.map((n) => (
          <button
            key={n.n}
            type="button"
            title={n.help}
            onClick={() => onChange(n.n)}
            className={`h-8 w-8 rounded-md border text-sm font-semibold transition-colors ${activo === n.n ? ECON.chipOn : ECON.chipOff}`}
            data-testid={`button-nivel-${n.n}`}
          >
            {n.n}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Abre todos los nodos con hijos hasta la profundidad `max` (0 = solo el primer nivel). */
export function abrirHasta<N extends { key: string; children: N[] }>(nodes: N[], max: number): Set<string> {
  const out = new Set<string>();
  const walk = (ns: N[], depth: number) => {
    if (depth > max) return;
    for (const n of ns) {
      if (n.children.length === 0) continue;
      out.add(n.key);
      walk(n.children, depth + 1);
    }
  };
  walk(nodes, 0);
  return out;
}
