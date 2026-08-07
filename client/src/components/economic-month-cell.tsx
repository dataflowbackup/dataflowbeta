import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarRange, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  MONTH_NAMES_ES,
  buildEconomicMonth,
  economicMonthLabel,
  economicMonthLabelWithYear,
  economicMonthParts,
  isEconomicMonthOverridden,
  monthOfDate,
  resolveEconomicMonth,
} from "@shared/economicMonth";

interface RowTx {
  id: number;
  transactionDate: string | Date | null | undefined;
  economicMonth?: string | null;
}

/**
 * Celda "Mes Económico" (ago-2026), compartida por Extractos y Efectivo.
 *
 * Muestra el NOMBRE del mes (no la fecha). Por defecto es el mes de la fecha de acreditación; si se
 * corrigió a mano queda en ámbar, que en el resto del sistema ya significa "esto fue intervenido".
 * El año solo se muestra cuando difiere del de la acreditación — es el caso raro (un movimiento de
 * enero que económicamente es de diciembre del año anterior) y es justo donde no mostrarlo confunde.
 */
export function EconomicMonthCell({ row }: { row: RowTx }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const accreditedMonth = monthOfDate(row.transactionDate);
  const effective = resolveEconomicMonth(row);
  const overridden = isEconomicMonthOverridden(row);

  const [draftYear, setDraftYear] = useState<string>("");
  const [draftMonth, setDraftMonth] = useState<string>("");

  // Años ofrecidos: el de la acreditación ±1, que cubre los cierres de fin de año.
  const yearOptions = useMemo(() => {
    const base = economicMonthParts(effective)?.year ?? new Date().getFullYear();
    return [base - 1, base, base + 1];
  }, [effective]);

  const openPicker = () => {
    const parts = economicMonthParts(effective);
    setDraftYear(String(parts?.year ?? new Date().getFullYear()));
    setDraftMonth(String(parts?.month ?? new Date().getMonth() + 1));
    setOpen(true);
  };

  const saveMut = useMutation({
    mutationFn: async (value: string | null) => {
      await apiRequest("PATCH", `/api/transactions/${row.id}`, { economicMonth: value });
    },
    onSuccess: async () => {
      setOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
    },
    onError: (e: Error) =>
      toast({ title: "No se pudo cambiar el mes económico", description: e.message, variant: "destructive" }),
  });

  const showYear = overridden && economicMonthParts(effective)?.year !== economicMonthParts(accreditedMonth)?.year;
  const label = effective ? (showYear ? economicMonthLabelWithYear(effective) : economicMonthLabel(effective)) : "—";

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        if (o) openPicker();
        else setOpen(false);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          title={
            overridden
              ? `Movido de ${economicMonthLabelWithYear(accreditedMonth)} a ${economicMonthLabelWithYear(effective)}`
              : "Mes económico (igual al de acreditación). Click para corregirlo."
          }
          onClick={(e) => e.stopPropagation()}
          data-testid={`button-economic-month-${row.id}`}
          className="inline-flex"
        >
          {overridden ? (
            <Badge
              variant="outline"
              className="cursor-pointer border-amber-500/60 bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 dark:text-amber-400"
            >
              {label}
            </Badge>
          ) : (
            <span className="cursor-pointer rounded px-1.5 py-0.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
              {label}
            </span>
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent className="w-64 space-y-3" onClick={(e) => e.stopPropagation()} align="start">
        <div className="space-y-1">
          <p className="text-sm font-medium">Mes económico</p>
          <p className="text-xs text-muted-foreground">
            Acreditado en {economicMonthLabelWithYear(accreditedMonth) || "—"}. Cambialo si el hecho económico
            corresponde a otro mes.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-xs">Mes</Label>
            <Select value={draftMonth} onValueChange={setDraftMonth}>
              <SelectTrigger className="h-9" data-testid="select-economic-month-month">
                <SelectValue placeholder="Mes" />
              </SelectTrigger>
              <SelectContent>
                {MONTH_NAMES_ES.map((name, idx) => (
                  <SelectItem key={name} value={String(idx + 1)}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Año</Label>
            <Select value={draftYear} onValueChange={setDraftYear}>
              <SelectTrigger className="h-9" data-testid="select-economic-month-year">
                <SelectValue placeholder="Año" />
              </SelectTrigger>
              <SelectContent>
                {yearOptions.map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn("gap-1 px-2 text-xs", !overridden && "invisible")}
            disabled={saveMut.isPending}
            onClick={() => saveMut.mutate(null)}
            data-testid="button-economic-month-reset"
          >
            <RotateCcw className="h-3 w-3" />
            Volver al automático
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={saveMut.isPending || !draftYear || !draftMonth}
            onClick={() =>
              saveMut.mutate(buildEconomicMonth(parseInt(draftYear, 10), parseInt(draftMonth, 10)))
            }
            data-testid="button-economic-month-save"
          >
            {saveMut.isPending ? "Guardando…" : "Guardar"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Ícono/encabezado reutilizable para la columna, para que ambas pantallas se vean igual. */
export function EconomicMonthHeader() {
  return (
    <span className="inline-flex items-center gap-1">
      <CalendarRange className="h-3.5 w-3.5 text-muted-foreground" />
      Mes Económico
    </span>
  );
}
