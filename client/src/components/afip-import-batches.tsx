import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { FileStack, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatDate } from "@/lib/formatters";
import type { AfipImportBatch } from "@shared/schema";

type Batch = AfipImportBatch & { currentRows: number };

/**
 * Archivos importados en Mis Comprobantes, con la opción de borrar uno entero (por ejemplo,
 * si se subió el archivo equivocado). Borrar un archivo borra los comprobantes que hoy
 * apuntan a él; los que se reimportaron después en otro archivo ya no le pertenecen.
 */
export function AfipImportBatchesButton({ kind }: { kind: "received" | "issued" }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [toDelete, setToDelete] = useState<Batch | null>(null);
  const unidad = kind === "received" ? "comprobantes" : "filas resumidas";

  const { data: batches = [], isLoading } = useQuery<Batch[]>({
    queryKey: ["/api/afip/batches", kind],
    queryFn: async () => {
      const res = await fetch(`/api/afip/batches?kind=${kind}`, { credentials: "include" });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.message ?? res.statusText);
      return res.json();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/afip/batches/${id}`);
      return res.json() as Promise<{ borrados: number }>;
    },
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ["/api/afip/batches"] });
      queryClient.invalidateQueries({ queryKey: ["/api/afip/received"] });
      queryClient.invalidateQueries({ queryKey: ["/api/afip/received/reconciliation"] });
      queryClient.invalidateQueries({ queryKey: ["/api/afip/issued"] });
      toast({ title: "Archivo borrado", description: `Se borraron ${r.borrados} ${unidad}.` });
      setToDelete(null);
    },
    onError: (e: Error) => toast({ title: "No se pudo borrar", description: e.message, variant: "destructive" }),
  });

  const periodo = (b: Batch) =>
    b.periodFrom || b.periodTo ? `${formatDate(b.periodFrom)} al ${formatDate(b.periodTo)}` : "—";

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} data-testid={`button-afip-batches-${kind}`}>
        <FileStack className="h-4 w-4 mr-2" />
        Archivos importados
        {batches.length > 0 && <Badge variant="secondary" className="ml-2">{batches.length}</Badge>}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Archivos importados</DialogTitle>
            <DialogDescription>
              Borrar un archivo borra los {unidad} que entraron con él. Si un comprobante se volvió a
              importar en un archivo posterior, pertenece a ese archivo y se borra con él.
            </DialogDescription>
          </DialogHeader>

          {isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : batches.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Todavía no se importó ningún archivo.</p>
          ) : (
            <div className="max-h-[60vh] overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    <th className="text-left font-medium py-2">Archivo</th>
                    <th className="text-left font-medium py-2">Importado</th>
                    <th className="text-left font-medium py-2">Período</th>
                    <th className="text-right font-medium py-2">Vigentes</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {batches.map((b) => (
                    <tr key={b.id} className="border-b last:border-0">
                      <td className="py-2 pr-2 break-all">{b.fileName || `Importación #${b.id}`}</td>
                      <td className="py-2 pr-2 whitespace-nowrap">{formatDate(b.createdAt)}</td>
                      <td className="py-2 pr-2 whitespace-nowrap">{periodo(b)}</td>
                      <td className="py-2 text-right font-mono" title={`Entraron ${b.rowsImported ?? 0}; hoy pertenecen a este archivo ${b.currentRows}`}>
                        {b.currentRows.toLocaleString("es-AR")}
                      </td>
                      <td className="py-2 text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={() => setToDelete(b)}
                          title="Borrar este archivo"
                          data-testid={`button-delete-batch-${b.id}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={toDelete != null}
        onOpenChange={(v) => !v && setToDelete(null)}
        title="Borrar archivo importado"
        description={
          toDelete
            ? `Se van a borrar ${toDelete.currentRows.toLocaleString("es-AR")} ${unidad} de "${toDelete.fileName || `Importación #${toDelete.id}`}". Las facturas cargadas en el sistema no se tocan. Esta acción no se puede deshacer, pero podés volver a subir el archivo.`
            : ""
        }
        confirmLabel="Borrar"
        variant="destructive"
        isLoading={deleteMutation.isPending}
        onConfirm={() => toDelete && deleteMutation.mutate(toDelete.id)}
      />
    </>
  );
}
