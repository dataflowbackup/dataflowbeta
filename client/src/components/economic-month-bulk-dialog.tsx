import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarRange } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency, formatDate } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import {
  MONTH_NAMES_ES,
  buildEconomicMonth,
  economicMonthLabelWithYear,
  isEconomicMonthOverridden,
  resolveEconomicMonth,
} from "@shared/economicMonth";

interface BulkTx {
  id: number;
  transactionDate: string | Date | null | undefined;
  economicMonth?: string | null;
  description?: string | null;
  amount: string | number;
  type?: string | null;
  localId?: number | null;
}

interface LocalOption {
  id: number;
  name: string;
}

/** Cuántas filas se pintan en la lista. El "Seleccionar todos" NO se limita a estas. */
const MAX_RENDERED = 300;

/**
 * Asignación masiva del Mes Económico (ago-2026), compartida por Extractos y Efectivo.
 *
 * Filtra sobre los movimientos ya cargados en la pantalla (por fecha de acreditación, local y
 * texto), deja elegirlos y les asigna a todos el mismo mes económico. Sin esto, reacomodar un mes
 * entero de sueldos sería inviable de a un movimiento por vez.
 */
export function EconomicMonthBulkDialog({
  transactions,
  locals,
  buttonClassName,
  open: openProp,
  onOpenChange,
}: {
  transactions: BulkTx[];
  locals: LocalOption[];
  buttonClassName?: string;
  /**
   * Modo controlado (punto 3, ago-26): si se pasa `open`, el diálogo lo abre quien lo usa
   * —hoy el menú "Acciones masivas" de Extractos/Efectivo— y este componente deja de
   * renderizar su propio botón. Sin `open`, se comporta como antes: botón + estado propio.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [openState, setOpenState] = useState(false);
  const isControlled = openProp !== undefined;
  const open = isControlled ? openProp : openState;
  const setOpen = (next: boolean) => {
    if (!isControlled) setOpenState(next);
    onOpenChange?.(next);
  };

  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [localId, setLocalId] = useState("all");
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const now = new Date();
  const [targetYear, setTargetYear] = useState(String(now.getFullYear()));
  const [targetMonth, setTargetMonth] = useState(String(now.getMonth() + 1));

  useEffect(() => {
    if (!open) return;
    setDateFrom("");
    setDateTo("");
    setLocalId("all");
    setSearch("");
    setSelectedIds(new Set());
  }, [open]);

  const matching = useMemo(() => {
    const term = search.trim().toLowerCase();
    return transactions.filter((t) => {
      const d = String(t.transactionDate ?? "").slice(0, 10);
      if (dateFrom && d < dateFrom) return false;
      if (dateTo && d > dateTo) return false;
      if (localId !== "all" && String(t.localId ?? "") !== localId) return false;
      if (term && !String(t.description ?? "").toLowerCase().includes(term)) return false;
      return true;
    });
  }, [transactions, dateFrom, dateTo, localId, search]);

  const rendered = matching.slice(0, MAX_RENDERED);
  const allSelected = matching.length > 0 && selectedIds.size === matching.length;

  const toggleAll = () => {
    setSelectedIds(allSelected ? new Set() : new Set(matching.map((t) => t.id)));
  };

  const toggleOne = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const applyMut = useMutation({
    mutationFn: async (value: string | null) => {
      const res = await apiRequest("POST", "/api/transactions/batch-economic-month", {
        transactionIds: Array.from(selectedIds),
        economicMonth: value,
      });
      return res.json() as Promise<{ updated: number; message: string }>;
    },
    onSuccess: async (data) => {
      toast({ title: "Mes económico actualizado", description: data.message });
      setOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
    },
    onError: (e: Error) => toast({ title: "No se pudo aplicar", description: e.message, variant: "destructive" }),
  });

  const target = buildEconomicMonth(parseInt(targetYear, 10), parseInt(targetMonth, 10));
  const yearOptions = [now.getFullYear() - 2, now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1];

  return (
    <>
      {!isControlled && (
        <Button
          variant="outline"
          className={buttonClassName}
          onClick={() => setOpen(true)}
          data-testid="button-economic-month-bulk"
        >
          <CalendarRange className="h-4 w-4 mr-2" />
          Mes Económico Masivo
        </Button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Asignar mes económico en masa</DialogTitle>
            <DialogDescription>
              Filtrá los movimientos por fecha de acreditación, local o texto, elegí cuáles y asignales a todos el
              mismo mes económico. No cambia la fecha de acreditación ni el saldo: solo el mes con el que el
              movimiento entra al Balance Económico.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 overflow-y-auto pr-1">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1">
                <Label className="text-xs">Desde (acreditación)</Label>
                <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Hasta (acreditación)</Label>
                <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Local</Label>
                <Select value={localId} onValueChange={setLocalId}>
                  <SelectTrigger data-testid="select-bulk-econ-local">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos los locales</SelectItem>
                    {locals.map((l) => (
                      <SelectItem key={l.id} value={String(l.id)}>
                        {l.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Buscar en descripción</Label>
                <Input placeholder="ej. sueldos" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm">
                <Badge variant="secondary">{matching.length} movimiento(s)</Badge>
                <Badge variant={selectedIds.size > 0 ? "default" : "outline"}>
                  {selectedIds.size} seleccionado(s)
                </Badge>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={toggleAll} disabled={matching.length === 0}>
                {allSelected ? "Quitar todos" : `Seleccionar todos (${matching.length})`}
              </Button>
            </div>

            <div className="rounded-md border divide-y max-h-72 overflow-y-auto">
              {matching.length === 0 ? (
                <p className="p-4 text-center text-sm text-muted-foreground">
                  Ningún movimiento coincide con los filtros.
                </p>
              ) : (
                rendered.map((t) => {
                  const overridden = isEconomicMonthOverridden(t);
                  return (
                    <label
                      key={t.id}
                      className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted/50"
                    >
                      <Checkbox checked={selectedIds.has(t.id)} onCheckedChange={() => toggleOne(t.id)} />
                      <span className="w-20 shrink-0 text-muted-foreground">{formatDate(t.transactionDate as any)}</span>
                      <span className="flex-1 truncate">{t.description || "—"}</span>
                      <span
                        className={cn(
                          "w-28 shrink-0 truncate text-right",
                          overridden ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground",
                        )}
                      >
                        {economicMonthLabelWithYear(resolveEconomicMonth(t))}
                      </span>
                      <span
                        className={cn(
                          "w-28 shrink-0 text-right font-mono",
                          t.type === "income" ? "text-green-600" : "text-red-600",
                        )}
                      >
                        {t.type === "income" ? "+" : "-"}
                        {formatCurrency(Math.abs(parseFloat(String(t.amount) || "0")))}
                      </span>
                    </label>
                  );
                })
              )}
              {matching.length > MAX_RENDERED && (
                <p className="px-3 py-2 text-xs text-muted-foreground">
                  Se muestran {MAX_RENDERED} de {matching.length}. "Seleccionar todos" alcanza a los{" "}
                  {matching.length}, no solo a los visibles.
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-end gap-3 rounded-lg border p-3">
              <div className="space-y-1">
                <Label className="text-xs">Mes económico destino</Label>
                <div className="flex gap-2">
                  <Select value={targetMonth} onValueChange={setTargetMonth}>
                    <SelectTrigger className="w-36" data-testid="select-bulk-econ-month">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MONTH_NAMES_ES.map((name, idx) => (
                        <SelectItem key={name} value={String(idx + 1)}>
                          {name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={targetYear} onValueChange={setTargetYear}>
                    <SelectTrigger className="w-28" data-testid="select-bulk-econ-year">
                      <SelectValue />
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
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={selectedIds.size === 0 || applyMut.isPending}
                onClick={() => applyMut.mutate(null)}
                data-testid="button-bulk-econ-reset"
              >
                Volver al automático
              </Button>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={applyMut.isPending}>
              Cancelar
            </Button>
            <Button
              onClick={() => applyMut.mutate(target)}
              disabled={selectedIds.size === 0 || applyMut.isPending}
              data-testid="button-bulk-econ-apply"
            >
              {applyMut.isPending
                ? "Aplicando…"
                : `Asignar ${economicMonthLabelWithYear(target)} a ${selectedIds.size}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
