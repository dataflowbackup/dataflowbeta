/**
 * Campo de CANTIDAD con coma decimal, a la argentina.
 *
 * Desde sep-2026 los insumos se cargan en kilos y litros: "1,125 Kg" en vez de "1125 gramos".
 * El `<input type="number">` del navegador acepta el separador decimal según la configuración
 * regional del sistema operativo, así que en una máquina en inglés la coma se perdía y "1,1"
 * entraba como 11 o como vacío. Esto lo hace determinista: la coma siempre es el decimal y el
 * punto siempre es el separador de miles.
 *
 * Mientras el campo tiene foco se respeta lo que la persona está tipeando (poder escribir "1,"
 * sin que el componente lo "arregle"); al salir se re-formatea desde el número.
 */
import { forwardRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { formatEsArQuantityInput, parseEsArAmount, quantityToEsArInput } from "@/lib/formatters";

export interface QuantityInputProps
  extends Omit<React.ComponentProps<typeof Input>, "value" | "onChange" | "type"> {
  value: number | string | null | undefined;
  /** Recibe el número ya parseado. NaN se entrega como 0. */
  onChange: (value: number) => void;
  /** Se muestra en gris dentro del campo (Kg, Lt, Und). */
  unit?: string | null;
}

export const QuantityInput = forwardRef<HTMLInputElement, QuantityInputProps>(
  ({ value, onChange, unit, className, onBlur, onFocus, ...rest }, ref) => {
    // `null` = mostrar el valor de la prop. Con texto = lo que se está tipeando.
    const [draft, setDraft] = useState<string | null>(null);
    const shown = draft ?? quantityToEsArInput(value);

    return (
      <div className="relative">
        <Input
          {...rest}
          ref={ref}
          type="text"
          inputMode="decimal"
          value={shown}
          className={`font-mono ${unit ? "pr-12" : ""} ${className ?? ""}`}
          onFocus={(e) => {
            setDraft(quantityToEsArInput(value));
            onFocus?.(e);
          }}
          onChange={(e) => {
            const masked = formatEsArQuantityInput(e.target.value);
            setDraft(masked);
            const n = parseEsArAmount(masked);
            onChange(Number.isFinite(n) ? n : 0);
          }}
          onBlur={(e) => {
            setDraft(null);
            onBlur?.(e);
          }}
        />
        {unit && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-mono pointer-events-none">
            {unit}
          </span>
        )}
      </div>
    );
  },
);
QuantityInput.displayName = "QuantityInput";
