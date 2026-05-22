import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";

export type DataEntryOption = {
  /** Valor que se envía al formulario (string estable) */
  value: string;
  /** Texto mostrado y usado para filtrar */
  label: string;
};

function cmdkItemValue(opt: DataEntryOption): string {
  /* Incluye id al final para unicidad y filtrado por nombre + id */
  return `${opt.label} ${opt.value}`;
}

export interface DataEntryComboboxProps {
  options: DataEntryOption[];
  /** Valor controlado (comparación estricta con option.value) */
  value: string | number | null | undefined;
  onValueChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
  "data-testid"?: string;
  emptyMessage?: string;
  /** Si se define, primera fila despeja la selección (onValueChange recibe "") */
  emptyOptionLabel?: string;
  triggerClassName?: string;
}

/**
 * Desplegable orientado a data entry: búsqueda, flechas (cmdk), foco visible en el ítem activo.
 * Al abrir, el resaltado arranca en la opción actualmente elegida (no siempre en la primera).
 */
export function DataEntryCombobox({
  options,
  value,
  onValueChange,
  placeholder = "Seleccionar…",
  searchPlaceholder = "Buscar…",
  disabled,
  "data-testid": testId,
  emptyMessage = "Sin resultados.",
  emptyOptionLabel,
  triggerClassName,
}: DataEntryComboboxProps) {
  const [open, setOpen] = useState(false);
  const strVal = value === undefined || value === null ? "" : String(value);
  const selected = options.find((o) => o.value === strVal);
  const defaultCmdValue = selected ? cmdkItemValue(selected) : undefined;

  return (
    <Popover open={open} onOpenChange={(o) => !disabled && setOpen(o)} modal>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn("w-full justify-between font-normal min-h-9", triggerClassName)}
          data-testid={testId}
        >
          <span className="truncate text-left">{selected ? selected.label : placeholder}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(100vw-2rem,28rem)] p-0 z-50" align="start">
        <Command defaultValue={defaultCmdValue} shouldFilter>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList className="max-h-[280px]">
            <CommandEmpty>{emptyMessage}</CommandEmpty>
            <CommandGroup>
              {emptyOptionLabel && (
                <CommandItem
                  value={`__empty__ ${emptyOptionLabel}`}
                  onSelect={() => {
                    onValueChange("");
                    setOpen(false);
                  }}
                >
                  <Check className={cn("mr-2 h-4 w-4 shrink-0", strVal === "" ? "opacity-100" : "opacity-0")} />
                  {emptyOptionLabel}
                </CommandItem>
              )}
              {options.map((opt) => {
                const cmdVal = cmdkItemValue(opt);
                return (
                  <CommandItem
                    key={opt.value}
                    value={cmdVal}
                    onSelect={() => {
                      onValueChange(opt.value);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn("mr-2 h-4 w-4 shrink-0", strVal === opt.value ? "opacity-100" : "opacity-0")}
                    />
                    <span className="truncate">{opt.label}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
