/**
 * Piezas compartidas del Estado de Resultado Económico.
 *
 * La paleta del módulo es VERDE (emerald), a propósito distinta del Estado de Resultado
 * Financiero: son dos informes que se parecen mucho y conviven en el mismo menú, así que el color
 * es lo que evita que alguien lea uno creyendo que mira el otro.
 */
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DataEntryCombobox } from "@/components/data-entry-combobox";
import { formatEsArAmountInput, parseEsArAmount } from "@/lib/formatters";
import type { Local } from "@shared/schema";

/** Clases del acento verde, en un solo lugar para que las cuatro solapas no se desalineen. */
export const ECON = {
  text: "text-emerald-700 dark:text-emerald-400",
  textSoft: "text-emerald-600/80 dark:text-emerald-500/80",
  bg: "bg-emerald-50 dark:bg-emerald-950/30",
  bgSolid: "bg-emerald-600 dark:bg-emerald-700",
  border: "border-emerald-200 dark:border-emerald-900",
  ring: "focus-visible:ring-emerald-500",
  chipOn: "bg-emerald-600 text-white border-emerald-600",
  chipOff: "bg-background text-muted-foreground border-border hover:bg-emerald-50 dark:hover:bg-emerald-950/40",
} as const;

/** Campo de importe en es-AR: miles con punto, decimales con coma. */
export function MoneyInput({
  value,
  onChange,
  placeholder = "0,00",
  className,
  disabled,
  testId,
}: {
  value: number | string | null | undefined;
  onChange: (value: number) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  testId?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const asText = (v: number | string | null | undefined) => {
    if (v === null || v === undefined || v === "") return "";
    const n = typeof v === "string" ? parseFloat(v) : v;
    if (!Number.isFinite(n)) return "";
    return formatEsArAmountInput(n.toFixed(2).replace(".", ","));
  };
  return (
    <Input
      inputMode="decimal"
      disabled={disabled}
      className={`font-mono text-right ${ECON.ring} ${className ?? ""}`}
      placeholder={placeholder}
      value={draft ?? asText(value)}
      data-testid={testId}
      onFocus={() => setDraft(asText(value))}
      onChange={(e) => {
        const masked = formatEsArAmountInput(e.target.value);
        setDraft(masked);
        const n = parseEsArAmount(masked);
        onChange(Number.isFinite(n) ? n : 0);
      }}
      onBlur={() => setDraft(null)}
    />
  );
}

/**
 * Selector de UN local. Los impuestos y las comisiones se liquidan por local, así que las tres
 * solapas de carga trabajan de a un local por vez — a diferencia del informe, que consolida.
 */
export function LocalPicker({
  locals,
  value,
  onChange,
}: {
  locals: Local[];
  value: number | null;
  onChange: (id: number) => void;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">Local</Label>
      <DataEntryCombobox
        options={locals.map((l) => ({ value: String(l.id), label: l.name }))}
        value={value != null ? String(value) : ""}
        onValueChange={(v) => onChange(parseInt(v, 10))}
        placeholder="Elegí el local"
        searchPlaceholder="Buscar local…"
      />
    </div>
  );
}

/** Aviso de que nada está cargado todavía, con el mismo tono en las tres solapas. */
export function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <div className={`rounded-lg border ${ECON.border} ${ECON.bg} p-4 text-sm ${ECON.text}`}>
      {children}
    </div>
  );
}
