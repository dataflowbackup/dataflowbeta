import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { usePermissions } from "@/hooks/usePermissions";
import { AlertCircle, ChevronDown, ChevronRight } from "lucide-react";

/**
 * Registro de cambios (oct-2026): quién dio de alta, modificó o borró facturas, pagos,
 * movimientos, usuarios y permisos. Solo Socio o Administrador (el backend valida lo mismo).
 */

type ChangeRow = {
  id: number;
  createdAt: string | number;
  userId: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  action: string;
  tableName: string;
  recordId: number | null;
  summary: string | null;
  oldData: Record<string, unknown> | null;
  newData: Record<string, unknown> | null;
};

const TABLE_LABELS: Record<string, string> = {
  invoices: "Facturas",
  payments: "Pagos",
  transactions: "Movimientos",
  internal_loans: "Préstamos internos",
  bank_accounts: "Cuentas",
  users: "Usuarios",
  role_permissions: "Permisos",
  recipe_drafts: "Recetas",
};

const ACTION_LABELS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  create: { label: "Alta", variant: "default" },
  update: { label: "Modificación", variant: "secondary" },
  delete: { label: "Baja", variant: "destructive" },
  reverse: { label: "Reversión", variant: "destructive" },
  correct_invoice: { label: "Corrección", variant: "secondary" },
  import: { label: "Importación", variant: "default" },
  batch_update: { label: "Masiva", variant: "secondary" },
  batch_delete: { label: "Baja masiva", variant: "destructive" },
  delete_batch: { label: "Baja de extracto", variant: "destructive" },
  purge_imports: { label: "Purga", variant: "destructive" },
  split: { label: "División", variant: "secondary" },
  reverse_split: { label: "Deshacer división", variant: "secondary" },
  role_change: { label: "Cambio de rol", variant: "secondary" },
  reset_password: { label: "Clave provisoria", variant: "secondary" },
  invite: { label: "Invitación", variant: "default" },
};

const PAGE_SIZE = 100;

function who(r: ChangeRow): string {
  const name = [r.firstName, r.lastName].filter(Boolean).join(" ").trim();
  return name || r.email || (r.userId ? "Usuario eliminado" : "Sistema");
}

function when(v: string | number): string {
  const d = new Date(v);
  return Number.isNaN(d.getTime())
    ? String(v)
    : d.toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });
}

function fmt(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** Detalle: si hay antes y despues, una fila por campo; si no, los datos tal cual. */
function Detail({ row }: { row: ChangeRow }) {
  const before = row.oldData ?? {};
  const after = row.newData ?? {};
  const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]));
  if (keys.length === 0) return <p className="text-sm text-muted-foreground">Sin detalle adicional.</p>;
  const both = row.oldData && row.newData;
  return (
    <div className="overflow-x-auto">
      <table className="text-xs w-full">
        <thead>
          <tr className="text-muted-foreground text-left">
            <th className="py-1 pr-4 font-medium">Campo</th>
            {both ? (
              <>
                <th className="py-1 pr-4 font-medium">Antes</th>
                <th className="py-1 font-medium">Después</th>
              </>
            ) : (
              <th className="py-1 font-medium">Valor</th>
            )}
          </tr>
        </thead>
        <tbody>
          {keys.map((k) => (
            <tr key={k} className="border-t align-top">
              <td className="py-1 pr-4 font-mono">{k}</td>
              {both ? (
                <>
                  <td className="py-1 pr-4 break-all">{fmt((before as any)[k])}</td>
                  <td className="py-1 break-all">{fmt((after as any)[k])}</td>
                </>
              ) : (
                <td className="py-1 break-all">{fmt((after as any)[k] ?? (before as any)[k])}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ChangeLogPage() {
  const { role, isLoading: permsLoading } = usePermissions();
  const canSee = role === "socio" || role === "admin";

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [table, setTable] = useState("all");
  const [userId, setUserId] = useState("all");
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<number | null>(null);

  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  if (table !== "all") params.set("table", table);
  if (userId !== "all") params.set("userId", userId);
  params.set("limit", String(PAGE_SIZE));
  params.set("offset", String(page * PAGE_SIZE));
  const url = `/api/change-log?${params.toString()}`;

  const { data: rows = [], isLoading, isError } = useQuery<ChangeRow[]>({
    queryKey: [url],
    enabled: canSee,
  });

  // Usuarios para el filtro: los que aparecen en lo cargado (mas el elegido, para no perderlo).
  const users = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows) if (r.userId) m.set(r.userId, who(r));
    return Array.from(m.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);

  const resetPage = () => {
    setPage(0);
    setOpen(null);
  };

  if (!permsLoading && !canSee) {
    return (
      <div className="space-y-6">
        <PageHeader title="Registro de cambios" description="Quién hizo qué y cuándo" />
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>Solo un Socio o Administrador puede ver el registro de cambios.</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Registro de cambios"
        description="Altas, modificaciones y bajas de facturas, pagos, movimientos, usuarios y permisos"
      />

      <Card>
        <CardContent className="pt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1">
            <Label htmlFor="cl-from">Desde</Label>
            <Input id="cl-from" type="date" value={from} onChange={(e) => { setFrom(e.target.value); resetPage(); }} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cl-to">Hasta</Label>
            <Input id="cl-to" type="date" value={to} onChange={(e) => { setTo(e.target.value); resetPage(); }} />
          </div>
          <div className="space-y-1">
            <Label>Tipo</Label>
            <Select value={table} onValueChange={(v) => { setTable(v); resetPage(); }}>
              <SelectTrigger data-testid="select-change-log-table"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {Object.entries(TABLE_LABELS).map(([k, label]) => (
                  <SelectItem key={k} value={k}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Usuario</Label>
            <Select value={userId} onValueChange={(v) => { setUserId(v); resetPage(); }}>
              <SelectTrigger data-testid="select-change-log-user"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {users.map(([id, name]) => (
                  <SelectItem key={id} value={id}>{name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {isError ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>No se pudo cargar el registro de cambios.</AlertDescription>
        </Alert>
      ) : isLoading || permsLoading ? (
        <Card><CardContent className="pt-6 space-y-2">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-8 w-full" />)}</CardContent></Card>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            {page === 0 ? "No hay cambios registrados con estos filtros." : "No hay más cambios."}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="pt-6">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead>Fecha</TableHead>
                    <TableHead>Usuario</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Acción</TableHead>
                    <TableHead>Detalle</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const act = ACTION_LABELS[r.action] ?? { label: r.action, variant: "outline" as const };
                    const isOpen = open === r.id;
                    return (
                      <Fragment key={r.id}>
                        <TableRow
                          className="cursor-pointer"
                          onClick={() => setOpen(isOpen ? null : r.id)}
                          data-testid={`row-change-${r.id}`}
                        >
                          <TableCell>{isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</TableCell>
                          <TableCell className="whitespace-nowrap">{when(r.createdAt)}</TableCell>
                          <TableCell className="whitespace-nowrap">{who(r)}</TableCell>
                          <TableCell className="whitespace-nowrap">{TABLE_LABELS[r.tableName] ?? r.tableName}</TableCell>
                          <TableCell><Badge variant={act.variant}>{act.label}</Badge></TableCell>
                          <TableCell>{r.summary ?? (r.recordId ? `Registro #${r.recordId}` : "—")}</TableCell>
                        </TableRow>
                        {isOpen && (
                          <TableRow>
                            <TableCell />
                            <TableCell colSpan={5} className="bg-muted/40">
                              <Detail row={r} />
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            <div className="flex items-center justify-end gap-2 pt-4">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => { setPage(page - 1); setOpen(null); }}>
                Anteriores
              </Button>
              <Button variant="outline" size="sm" disabled={rows.length < PAGE_SIZE} onClick={() => { setPage(page + 1); setOpen(null); }}>
                Siguientes
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
