/**
 * Eventos — listado de propuestas con su resultado. Cada versión es una fila; por defecto se ve
 * solo la última versión de cada propuesta.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { usePersistentFilter } from "@/hooks/usePersistentFilter";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DataEntryCombobox } from "@/components/data-entry-combobox";
import { DateRangePicker } from "@/components/date-range-picker";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatCurrency } from "@/lib/formatters";
import { exportToExcel, exportToPdf, type ExportInput } from "@/lib/table-export";
import { EVENT_STATUS_LABELS, type EventStatus, type EventTotals } from "@shared/eventPricing";
import { PartyPopper, Plus, Search, Copy, Trash2, FileDown, FileSpreadsheet } from "lucide-react";

interface EventListRow {
  id: number;
  name: string;
  customerName: string | null;
  eventDate: string | null;
  guests: number | null;
  status: EventStatus;
  version: number;
  rootEventId: number | null;
  updatedAt: string | null;
  totals: EventTotals | null;
}

const STATUS_TONE: Record<EventStatus, string> = {
  borrador: "bg-muted text-muted-foreground",
  enviada: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  aceptada: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  rechazada: "bg-destructive/10 text-destructive",
};

const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return y && m && d ? `${d}/${m}/${y}` : iso;
};
const fmtPct = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? "—" : `${new Intl.NumberFormat("es-AR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(v)}%`;

export default function EventsPage() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const { data: events = [], isLoading, error } = useQuery<EventListRow[]>({ queryKey: ["/api/events"] });

  const [search, setSearch] = usePersistentFilter("eventos.search", "");
  const [status, setStatus] = usePersistentFilter("eventos.status", "all");
  const [dateFrom, setDateFrom] = usePersistentFilter("eventos.dateFrom", "");
  const [dateTo, setDateTo] = usePersistentFilter("eventos.dateTo", "");
  const [onlyLatest, setOnlyLatest] = usePersistentFilter("eventos.onlyLatest", true);
  const [toDelete, setToDelete] = useState<EventListRow | null>(null);

  // Última versión de cada propuesta (agrupadas por la primera).
  const latestIds = useMemo(() => {
    const best = new Map<number, EventListRow>();
    for (const e of events) {
      const root = e.rootEventId ?? e.id;
      const cur = best.get(root);
      if (!cur || e.version > cur.version) best.set(root, e);
    }
    return new Set(Array.from(best.values()).map((e) => e.id));
  }, [events]);

  const q = search.trim().toLowerCase();
  const rows = events
    .filter((e) => !onlyLatest || latestIds.has(e.id))
    .filter((e) => status === "all" || e.status === status)
    .filter((e) => !dateFrom || (e.eventDate ?? "") >= dateFrom)
    .filter((e) => !dateTo || (e.eventDate ?? "9999") <= dateTo)
    .filter((e) => !q || [e.name, e.customerName].some((x) => String(x ?? "").toLowerCase().includes(q)))
    .sort((a, b) => String(b.eventDate ?? "").localeCompare(String(a.eventDate ?? "")) || b.id - a.id);

  const summary = useMemo(() => {
    const accepted = rows.filter((r) => r.status === "aceptada");
    return {
      count: rows.length,
      accepted: accepted.length,
      acceptedTotal: accepted.reduce((a, r) => a + (r.totals?.totalClient ?? 0), 0),
      acceptedProfit: accepted.reduce((a, r) => a + (r.totals?.profit ?? 0), 0),
    };
  }, [rows]);

  const duplicate = useMutation({
    mutationFn: async (id: number) => (await (await apiRequest("POST", `/api/events/${id}/duplicate`)).json()) as EventListRow,
    onSuccess: (ev) => {
      queryClient.invalidateQueries({ queryKey: ["/api/events"] });
      toast({ title: "Copia creada" });
      navigate(`/eventos/${ev.id}`);
    },
    onError: (e: Error) => toast({ title: "No se pudo duplicar", description: e.message, variant: "destructive" }),
  });
  const remove = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/events/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/events"] });
      setToDelete(null);
      toast({ title: "Evento eliminado" });
    },
    onError: (e: Error) => toast({ title: "No se pudo eliminar", description: e.message, variant: "destructive" }),
  });

  const buildExport = (): ExportInput => ({
    title: "Eventos",
    filtros: [
      `Estado: ${status === "all" ? "todos" : EVENT_STATUS_LABELS[status as EventStatus]}`,
      ...(dateFrom || dateTo ? [`Fecha del evento: ${fmtDate(dateFrom)} al ${fmtDate(dateTo)}`] : []),
      onlyLatest ? "Solo la última versión de cada propuesta" : "Todas las versiones",
    ],
    resumen: [`Eventos: ${summary.count}`, `Aceptados: ${summary.accepted}`, `Utilidad aceptados: ${formatCurrency(summary.acceptedProfit)}`],
    fileBase: "eventos",
    sheets: [
      {
        name: "Eventos",
        rows,
        columns: [
          { header: "Evento", value: (r: EventListRow) => r.name, width: 2.2 },
          { header: "Cliente", value: (r: EventListRow) => r.customerName ?? "", width: 1.5 },
          { header: "Fecha", value: (r: EventListRow) => fmtDate(r.eventDate), width: 0.8 },
          { header: "Invitados", value: (r: EventListRow) => r.guests ?? null, width: 0.7 },
          { header: "Estado", value: (r: EventListRow) => `${EVENT_STATUS_LABELS[r.status]}${r.version > 1 ? ` v${r.version}` : ""}`, width: 0.9 },
          { header: "Total cliente", value: (r: EventListRow) => r.totals?.totalClient ?? null, money: true },
          { header: "Utilidad", value: (r: EventListRow) => r.totals?.profit ?? null, money: true },
          { header: "Margen %", value: (r: EventListRow) => (r.totals?.profitPct != null ? Math.round(r.totals.profitPct * 10) / 10 : null), width: 0.7 },
        ],
      },
    ],
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Eventos" description="Propuestas de eventos costeadas: lo que ve el cliente y lo que ganamos nosotros" />

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => navigate("/eventos/nuevo")} data-testid="button-new-event">
          <Plus className="h-4 w-4 mr-1.5" /> Nuevo evento
        </Button>
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={() => exportToExcel(buildExport())} disabled={rows.length === 0}>
          <FileSpreadsheet className="h-4 w-4 mr-1.5" /> Excel
        </Button>
        <Button variant="outline" size="sm" onClick={() => exportToPdf(buildExport())} disabled={rows.length === 0}>
          <FileDown className="h-4 w-4 mr-1.5" /> PDF
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border p-3">
          <p className="text-xs text-muted-foreground">Propuestas</p>
          <p className="text-xl font-bold font-mono">{summary.count}</p>
        </div>
        <div className="rounded-lg border p-3">
          <p className="text-xs text-muted-foreground">Aceptadas</p>
          <p className="text-xl font-bold font-mono">{summary.accepted}</p>
          <p className="text-[11px] text-muted-foreground">{formatCurrency(summary.acceptedTotal)} facturables</p>
        </div>
        <div className="rounded-lg border p-3">
          <p className="text-xs text-muted-foreground">Utilidad de las aceptadas</p>
          <p className={`text-xl font-bold font-mono ${summary.acceptedProfit >= 0 ? "text-emerald-600 dark:text-emerald-500" : "text-destructive"}`}>
            {formatCurrency(summary.acceptedProfit)}
          </p>
        </div>
      </div>

      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 items-center">
            <div className="relative">
              <Search className="h-4 w-4 absolute left-2.5 top-3 text-muted-foreground" />
              <Input className="pl-8" placeholder="Buscar evento o cliente…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <DataEntryCombobox
              options={[
                { value: "all", label: "Todos los estados" },
                ...(Object.keys(EVENT_STATUS_LABELS) as EventStatus[]).map((s) => ({ value: s, label: EVENT_STATUS_LABELS[s] })),
              ]}
              value={status}
              onValueChange={(v) => setStatus(v || "all")}
            />
            <DateRangePicker
              from={dateFrom}
              to={dateTo}
              onChange={(f, t) => {
                setDateFrom(f);
                setDateTo(t);
              }}
              placeholder="Fecha del evento"
            />
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={onlyLatest} onCheckedChange={setOnlyLatest} /> Solo la última versión
            </label>
          </div>

          {isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : error ? (
            <p className="text-sm text-destructive">{(error as Error).message}</p>
          ) : rows.length === 0 ? (
            <div className="text-center py-12 space-y-2">
              <PartyPopper className="h-8 w-8 mx-auto text-muted-foreground" />
              <p className="text-sm text-muted-foreground">{events.length === 0 ? "Todavía no hay eventos." : "Ningún evento coincide con los filtros."}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    <th className="text-left font-medium py-2 px-1">Evento</th>
                    <th className="text-left font-medium py-2 px-1 hidden md:table-cell">Fecha</th>
                    <th className="text-right font-medium py-2 px-1 hidden md:table-cell">Invitados</th>
                    <th className="text-left font-medium py-2 px-1">Estado</th>
                    <th className="text-right font-medium py-2 px-1">Total</th>
                    <th className="text-right font-medium py-2 px-1">Utilidad</th>
                    <th className="py-2 px-1 w-20" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((e) => (
                    <tr key={e.id} className="border-b last:border-0 hover:bg-muted/40">
                      <td className="py-2 px-1">
                        <Link href={`/eventos/${e.id}`}>
                          <span className="font-medium hover:underline cursor-pointer">{e.name}</span>
                        </Link>
                        <p className="text-[11px] text-muted-foreground">{e.customerName ?? "Sin cliente"}</p>
                      </td>
                      <td className="py-2 px-1 text-xs hidden md:table-cell">{fmtDate(e.eventDate)}</td>
                      <td className="py-2 px-1 text-right font-mono hidden md:table-cell">{e.guests ?? "—"}</td>
                      <td className="py-2 px-1">
                        <Badge variant="secondary" className={STATUS_TONE[e.status]}>
                          {EVENT_STATUS_LABELS[e.status]}
                        </Badge>
                        {e.version > 1 && <span className="text-[10px] text-muted-foreground ml-1">v{e.version}</span>}
                      </td>
                      <td className="py-2 px-1 text-right font-mono">{e.totals ? formatCurrency(e.totals.totalClient) : "—"}</td>
                      <td className={`py-2 px-1 text-right font-mono ${e.totals && e.totals.profit < 0 ? "text-destructive" : ""}`}>
                        {e.totals ? formatCurrency(e.totals.profit) : "—"}
                        <p className="text-[10px] text-muted-foreground">{fmtPct(e.totals?.profitPct)}</p>
                      </td>
                      <td className="py-2 px-1 text-right whitespace-nowrap">
                        <Button size="icon" variant="ghost" className="h-7 w-7" title="Duplicar" onClick={() => duplicate.mutate(e.id)}>
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground" title="Eliminar" onClick={() => setToDelete(e)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={toDelete != null} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar "{toDelete?.name}"{toDelete && toDelete.version > 1 ? ` (versión ${toDelete.version})` : ""}?</AlertDialogTitle>
            <AlertDialogDescription>Se borra solo esta versión de la propuesta. No afecta ningún otro dato.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => toDelete && remove.mutate(toDelete.id)}>Eliminar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
