/**
 * "Categorías que SÍ computan" (oct-2026).
 *
 * Al lado de "Grupos que computan": lista las categorías de los grupos que NO computan y deja
 * asignarle a cada una un destino en el Estado de Resultado (Gastos operativos, Comisiones,
 * Inversión o un impuesto puntual). Sin destino, la categoría queda afuera como el resto de su
 * grupo. Se guarda por empresa y vale para todos los meses, igual que el tilde del grupo.
 */
import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  CATEGORY_DESTINATION_LABELS,
  DESTINATION_TAX_KINDS,
  TAX_KIND_BY_KEY,
  type CategoryDestination,
} from "@shared/economicStatement";
import type { FinancialGroup, TransactionCategory } from "@shared/schema";

interface DestinationRow {
  categoryId: number;
  destination: CategoryDestination;
  taxKind: string | null;
}

const NONE = "none";

/** Opciones del desplegable: un valor por destino y uno por cada impuesto posible. */
const OPTIONS: Array<{ value: string; label: string }> = [
  { value: NONE, label: "No computa" },
  { value: "gastos", label: CATEGORY_DESTINATION_LABELS.gastos },
  { value: "comisiones", label: CATEGORY_DESTINATION_LABELS.comisiones },
  { value: "inversion", label: CATEGORY_DESTINATION_LABELS.inversion },
  ...DESTINATION_TAX_KINDS.map((k) => ({ value: `impuesto:${k}`, label: `Impuesto — ${TAX_KIND_BY_KEY[k].label}` })),
];

const toValue = (d: DestinationRow | undefined) =>
  !d ? NONE : d.destination === "impuesto" ? `impuesto:${d.taxKind}` : d.destination;

export function CategoryDestinationsButton({ groups }: { groups: FinancialGroup[] }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);

  /** Los grupos de gasto que NO computan: sus categorías son las que se pueden rescatar. */
  const offGroups = useMemo(
    () => groups.filter((g) => ((g as any).economicComputes ?? true) === false),
    [groups],
  );
  const offGroupIds = useMemo(() => new Set(offGroups.map((g) => g.id)), [offGroups]);

  const { data: categories = [] } = useQuery<TransactionCategory[]>({ queryKey: ["/api/transaction-categories"] });
  const { data: destinations = [] } = useQuery<DestinationRow[]>({ queryKey: ["/api/economic/category-destinations"] });
  const destByCat = useMemo(() => new Map(destinations.map((d) => [d.categoryId, d])), [destinations]);

  const byGroup = useMemo(
    () =>
      offGroups.map((g) => ({
        group: g,
        cats: categories
          .filter((c) => (c as any).financialGroupId === g.id && c.active !== false)
          .sort((a, b) => a.name.localeCompare(b.name, "es")),
      })),
    [offGroups, categories],
  );
  /** Solo cuentan las asignaciones que hoy tienen efecto (categoría de un grupo que no computa). */
  const activeCount = destinations.filter((d) => {
    const cat = categories.find((c) => c.id === d.categoryId);
    return cat && offGroupIds.has((cat as any).financialGroupId);
  }).length;

  const saveMut = useMutation({
    mutationFn: async ({ categoryId, value }: { categoryId: number; value: string }) => {
      const [destination, taxKind] = value === NONE ? [null, null] : value.split(":");
      await apiRequest("PUT", `/api/economic/category-destinations/${categoryId}`, {
        destination,
        taxKind: taxKind ?? null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/economic/category-destinations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/economic/statement"] });
      queryClient.invalidateQueries({ queryKey: ["/api/economic/taxes"] });
    },
    onError: (e: Error) => toast({ title: "No se pudo guardar", description: e.message, variant: "destructive" }),
  });

  return (
    <>
      <Button variant="outline" className="gap-2" onClick={() => setOpen(true)} data-testid="button-econ-category-destinations">
        <ListChecks className="h-4 w-4" />
        Categorías que SÍ computan
        {activeCount > 0 && <Badge variant="secondary">{activeCount}</Badge>}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Categorías que SÍ computan</DialogTitle>
            <DialogDescription>
              Son las categorías de los grupos que no computan. Elegí a dónde va cada una en el Estado de
              Resultado; las que quedan en "No computa" siguen afuera, como el resto de su grupo. Se guarda
              para esta empresa y vale para todos los meses.
            </DialogDescription>
          </DialogHeader>

          {offGroups.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Todos los grupos computan. Destildá un grupo en "Grupos que computan" para elegir acá cuáles de sus
              categorías sí cuentan.
            </p>
          ) : (
            <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
              {byGroup.map(({ group, cats }) => (
                <div key={group.id} className="space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.name}</p>
                  {cats.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Sin categorías.</p>
                  ) : (
                    cats.map((c) => {
                      const value = toValue(destByCat.get(c.id));
                      return (
                        <div key={c.id} className="flex items-center gap-2 rounded px-1 py-1 hover:bg-muted">
                          <span className={`flex-1 truncate text-sm ${value === NONE ? "text-muted-foreground" : ""}`}>
                            {c.name}
                          </span>
                          <Select
                            value={value}
                            onValueChange={(v) => saveMut.mutate({ categoryId: c.id, value: v })}
                            disabled={saveMut.isPending}
                          >
                            <SelectTrigger className="h-8 w-56 text-xs" data-testid={`select-destination-${c.id}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {OPTIONS.map((o) => (
                                <SelectItem key={o.value} value={o.value} className="text-xs">
                                  {o.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      );
                    })
                  )}
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
