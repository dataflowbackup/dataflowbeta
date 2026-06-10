import { useState } from "react";
import type { DateRange } from "react-day-picker";
import { es } from "date-fns/locale";
import { CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/formatters";
import { fromISODate, toISODate, getDatePresets } from "@/lib/dateHelpers";

interface Props {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  placeholder?: string;
  className?: string;
  align?: "start" | "center" | "end";
}

/**
 * Selector de rango de fechas con presets (Hoy / Ayer / Últimos 7 / Últimos 30 /
 * Este mes / Mes pasado / Personalizado). Trabaja con strings "YYYY-MM-DD" en
 * horario local — drop-in para reemplazar los pares de <input type="date">.
 */
export function DateRangePicker({
  from,
  to,
  onChange,
  placeholder = "Seleccionar fechas",
  className,
  align = "start",
}: Props) {
  const [open, setOpen] = useState(false);
  const presets = getDatePresets();

  const selected: DateRange | undefined = from
    ? { from: fromISODate(from), to: fromISODate(to) || fromISODate(from) }
    : undefined;

  const label =
    from && to
      ? from === to
        ? formatDate(from)
        : `${formatDate(from)} – ${formatDate(to)}`
      : from
        ? `${formatDate(from)} – …`
        : placeholder;

  const handleSelect = (range: DateRange | undefined) => {
    const f = range?.from ? toISODate(range.from) : "";
    const t = range?.to ? toISODate(range.to) : f;
    onChange(f, t);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn("h-9 justify-start text-left font-normal", !from && "text-muted-foreground", className)}
          data-testid="date-range-trigger"
        >
          <CalendarIcon className="mr-2 h-4 w-4 shrink-0" />
          <span className="truncate">{label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align={align}>
        <div className="flex flex-col sm:flex-row">
          <div className="flex flex-col gap-1 border-b p-2 sm:border-b-0 sm:border-r min-w-[150px]">
            {presets.map((p) => (
              <Button
                key={p.key}
                variant="ghost"
                size="sm"
                className="justify-start font-normal"
                onClick={() => {
                  const r = p.range();
                  onChange(r.from, r.to);
                  setOpen(false);
                }}
                data-testid={`date-preset-${p.key}`}
              >
                {p.label}
              </Button>
            ))}
            {(from || to) && (
              <Button
                variant="ghost"
                size="sm"
                className="justify-start font-normal text-muted-foreground"
                onClick={() => {
                  onChange("", "");
                  setOpen(false);
                }}
              >
                Limpiar
              </Button>
            )}
          </div>
          <Calendar
            mode="range"
            locale={es}
            numberOfMonths={2}
            selected={selected}
            defaultMonth={fromISODate(from)}
            onSelect={handleSelect}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
