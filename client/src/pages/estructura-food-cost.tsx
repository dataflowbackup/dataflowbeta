/**
 * Estructura Food Cost (Catálogos) — reemplaza a las pantallas sueltas de Rubros y Sub-Rubros.
 *
 * Pedido del usuario (16-oct-2026): que al crear rubros y sub-rubros se vea EXACTAMENTE cómo van a
 * quedar en el Estado de Resultado Económico. Por eso la pantalla es el departamento "Food Cost"
 * del informe, con las mismas piezas visuales: rubro → sub-rubro → insumo. Se crea, renombra y
 * borra desde el mismo árbol. Con "ver con los números de [mes]" aparecen los importes de ese mes,
 * ordenados como en el informe.
 *
 * No cambia nada de fondo: usa los mismos endpoints de rubros y sub-rubros de siempre.
 */
import { useMemo, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { usePersistentFilter } from "@/hooks/usePersistentFilter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Edit, Trash2, Plus, Upload, Download, Eye, EyeOff } from "lucide-react";
import type { Rubro, SubRubro } from "@shared/schema";
import { ColumnHeader, Department, TreeRows, type TNode } from "@/components/economic/statement-visual";
import { MesConNumeros, useEstadoDelMes, MapaEdificio, BotonesNivel, abrirHasta } from "@/components/economic/structure-shared";

interface SupplyLite {
  id: number;
  name: string;
  rubroId: number | null;
  subRubroId: number | null;
  active?: boolean;
}

/** Lo que se lee del informe del mes: rubro → sub-rubro → insumo, por nombre. */
interface ComprasLeaf { label: string; amount: number }
interface ComprasGroup { label: string; amount: number; children: Array<{ label: string; amount: number; items: ComprasLeaf[] }> }
interface EstadoCompras { compras: { total: number; groups: ComprasGroup[] } }

const SIN_RUBRO = "Sin rubro asignado";
const SIN_SUB = "Sin sub-rubro";
const norm = (s: string) => s.trim().toLowerCase();

const NIVELES = [
  { n: 1, help: "Solo el total del Food Cost" },
  { n: 2, help: "Los rubros" },
  { n: 3, help: "Rubros y sub-rubros" },
  { n: 4, help: "Rubros, sub-rubros y sus insumos" },
];

type DialogState =
  | { kind: "rubro"; editing: Rubro | null }
  | { kind: "sub"; editing: SubRubro | null; rubroId: number | null }
  | null;

export default function EstructuraFoodCostPage() {
  const { toast } = useToast();
  const [mes, setMes] = usePersistentFilter<string>("estructuraFoodCost.mes", "none");
  const [nivel, setNivel] = useState(3);
  const [openNodes, setOpenNodes] = useState<Set<string> | null>(null);
  const [deptOpen, setDeptOpen] = useState(true);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [form, setForm] = useState({ name: "", description: "", rubroId: "" });
  const [borrar, setBorrar] = useState<{ kind: "rubro" | "sub"; id: number; name: string } | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: rubros = [], isLoading: l1 } = useQuery<Rubro[]>({ queryKey: ["/api/rubros"] });
  const { data: subRubros = [], isLoading: l2 } = useQuery<SubRubro[]>({ queryKey: ["/api/sub-rubros"] });
  const { data: supplies = [] } = useQuery<SupplyLite[]>({ queryKey: ["/api/supplies"] });
  const { data: estado, isFetching: cargandoNumeros } = useEstadoDelMes<EstadoCompras>(mes);
  const conNumeros = mes !== "none" && !!estado;

  const invalidar = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/rubros"] });
    queryClient.invalidateQueries({ queryKey: ["/api/sub-rubros"] });
    queryClient.invalidateQueries({ queryKey: ["/api/economic/statement"] });
  };
  const onError = (titulo: string) => (e: Error) => toast({ title: titulo, description: e.message, variant: "destructive" });

  const guardar = useMutation({
    mutationFn: async () => {
      if (!dialog) return;
      const body: Record<string, unknown> = { name: form.name.trim(), description: form.description.trim() || undefined };
      if (dialog.kind === "rubro") {
        if (dialog.editing) return apiRequest("PATCH", `/api/rubros/${dialog.editing.id}`, body);
        return apiRequest("POST", "/api/rubros", body);
      }
      body.rubroId = Number(form.rubroId);
      if (dialog.editing) return apiRequest("PATCH", `/api/sub-rubros/${dialog.editing.id}`, body);
      return apiRequest("POST", "/api/sub-rubros", body);
    },
    onSuccess: () => {
      invalidar();
      toast({ title: dialog?.kind === "rubro" ? "Rubro guardado" : "Sub-rubro guardado" });
      setDialog(null);
    },
    onError: onError("No se pudo guardar"),
  });

  const toggleActivo = useMutation({
    mutationFn: async (r: Rubro) => apiRequest("PATCH", `/api/rubros/${r.id}`, { active: !r.active }),
    onSuccess: invalidar,
    onError: onError("No se pudo cambiar el estado"),
  });

  const eliminar = useMutation({
    mutationFn: async () => {
      if (!borrar) return;
      await apiRequest("DELETE", borrar.kind === "rubro" ? `/api/rubros/${borrar.id}` : `/api/sub-rubros/${borrar.id}`);
    },
    onSuccess: () => {
      invalidar();
      toast({ title: borrar?.kind === "rubro" ? "Rubro eliminado" : "Sub-rubro eliminado" });
      setBorrar(null);
    },
    onError: onError("No se pudo eliminar"),
  });

  const importar = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/rubros/import", { method: "POST", body: fd, credentials: "include" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.message || "Error al importar");
      return res.json();
    },
    onSuccess: (data) => {
      invalidar();
      toast({ title: "Importación completada", description: `${data.imported} de ${data.total} rubros importados` });
      setImportOpen(false);
    },
    onError: onError("Error al importar"),
  });

  const exportar = async () => {
    try {
      const res = await fetch("/api/rubros/export", { credentials: "include" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.message || "Error al exportar");
      const type = res.headers.get("content-type") || "";
      let blob: Blob;
      let name = "rubros.xlsx";
      if (type.includes("application/json")) {
        const p = (await res.json()) as { fileName?: string; mimeType?: string; data?: string };
        if (!p?.data) throw new Error("Respuesta de exportación inválida (sin datos)");
        blob = new Blob([Uint8Array.from(atob(p.data), (c) => c.charCodeAt(0))], {
          type: p.mimeType || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        });
        if (p.fileName) name = p.fileName;
      } else {
        blob = await res.blob();
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (e: any) {
      toast({ title: "Error al exportar", description: e.message, variant: "destructive" });
    }
  };

  const abrirRubro = (editing: Rubro | null) => {
    setForm({ name: editing?.name ?? "", description: editing?.description ?? "", rubroId: "" });
    setDialog({ kind: "rubro", editing });
  };
  const abrirSub = (editing: SubRubro | null, rubroId: number | null) => {
    setForm({ name: editing?.name ?? "", description: editing?.description ?? "", rubroId: rubroId ? String(rubroId) : "" });
    setDialog({ kind: "sub", editing, rubroId });
  };

  /** Insumos por rubro y por sub-rubro: para avisar antes de borrar y para dibujar el último nivel. */
  const insumosPorSub = useMemo(() => {
    const m = new Map<number, SupplyLite[]>();
    for (const s of supplies) if (s.subRubroId != null) m.set(s.subRubroId, [...(m.get(s.subRubroId) ?? []), s]);
    return m;
  }, [supplies]);
  const insumosPorRubro = useMemo(() => {
    const m = new Map<number, number>();
    for (const s of supplies) if (s.rubroId != null) m.set(s.rubroId, (m.get(s.rubroId) ?? 0) + 1);
    return m;
  }, [supplies]);

  const total = conNumeros ? estado!.compras.total : null;
  const pctDe = (v: number | null) => (v == null || !total ? null : (v / total) * 100);

  /** El árbol del departamento, igual al del informe: con números, ordenado por importe. */
  const nodes: TNode[] = useMemo(() => {
    const grupos = new Map((estado?.compras.groups ?? []).map((g) => [norm(g.label), g]));
    const usados = new Set<string>();
    const out: TNode[] = rubros.map((r) => {
      const g = conNumeros ? grupos.get(norm(r.name)) : undefined;
      if (g) usados.add(norm(r.name));
      const subsDelInforme = new Map((g?.children ?? []).map((c) => [norm(c.label), c]));
      const subs = subRubros.filter((s) => s.rubroId === r.id);
      const hijos: TNode[] = subs.map((s) => {
        const c = subsDelInforme.get(norm(s.name));
        subsDelInforme.delete(norm(s.name));
        const montoInsumo = new Map((c?.items ?? []).map((i) => [norm(i.label), i.amount]));
        const insumos = (insumosPorSub.get(s.id) ?? []).map((i) => {
          const a = conNumeros ? (montoInsumo.get(norm(i.name)) ?? 0) : null;
          return { key: `i${i.id}`, label: i.name, amount: a, pct: pctDe(a), muted: true, children: [] } as TNode;
        });
        if (conNumeros) insumos.sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0));
        const a = conNumeros ? (c?.amount ?? 0) : null;
        return {
          key: `s${s.id}`,
          label: s.name,
          amount: a,
          pct: pctDe(a),
          badge: s.active === false ? "inactivo" : undefined,
          meta: `${insumos.length} insumo${insumos.length === 1 ? "" : "s"}`,
          actions: (
            <>
              <Button variant="ghost" size="icon" className="h-7 w-7" title="Editar sub-rubro" onClick={() => abrirSub(s, r.id)} data-testid={`button-edit-sub-${s.id}`}>
                <Edit className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7" title="Eliminar sub-rubro" onClick={() => setBorrar({ kind: "sub", id: s.id, name: s.name })} data-testid={`button-delete-sub-${s.id}`}>
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
              </Button>
            </>
          ),
          children: insumos,
        };
      });
      // Lo que en el informe cae en "Sin sub-rubro" (insumos con rubro pero sin sub-rubro).
      for (const c of Array.from(subsDelInforme.values())) {
        hijos.push({
          key: `r${r.id}-x-${norm(c.label)}`,
          label: c.label,
          amount: c.amount,
          pct: pctDe(c.amount),
          muted: true,
          meta: c.label === SIN_SUB ? "insumos con este rubro y sin sub-rubro: se asignan en Insumos" : undefined,
          children: [],
        });
      }
      if (conNumeros) hijos.sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0));
      const a = conNumeros ? (g?.amount ?? 0) : null;
      return {
        key: `r${r.id}`,
        label: r.name,
        amount: a,
        pct: pctDe(a),
        badge: r.active === false ? "inactivo" : undefined,
        actions: (
          <>
            <Button variant="ghost" size="icon" className="h-7 w-7" title="Nuevo sub-rubro en este rubro" onClick={() => abrirSub(null, r.id)} data-testid={`button-add-sub-${r.id}`}>
              <Plus className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" title="Editar rubro" onClick={() => abrirRubro(r)} data-testid={`button-edit-rubro-${r.id}`}>
              <Edit className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              title={r.active === false ? "Activar" : "Desactivar"}
              onClick={() => toggleActivo.mutate(r)}
              data-testid={`button-toggle-rubro-${r.id}`}
            >
              {r.active === false ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" title="Eliminar rubro" onClick={() => setBorrar({ kind: "rubro", id: r.id, name: r.name })} data-testid={`button-delete-rubro-${r.id}`}>
              <Trash2 className="h-3.5 w-3.5 text-destructive" />
            </Button>
          </>
        ),
        children: hijos,
      };
    });
    // Rubros que el informe muestra y no están en el catálogo (el más común: "Sin rubro asignado").
    if (conNumeros) {
      for (const g of estado!.compras.groups) {
        if (usados.has(norm(g.label))) continue;
        out.push({
          key: `x-${norm(g.label)}`,
          label: g.label,
          amount: g.amount,
          pct: pctDe(g.amount),
          muted: true,
          meta: g.label === SIN_RUBRO ? "insumos sin rubro: se asignan en Insumos" : undefined,
          children: [],
        });
      }
      out.sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0));
    } else {
      out.sort((a, b) => a.label.localeCompare(b.label, "es"));
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rubros, subRubros, insumosPorSub, estado, conNumeros]);

  // Mientras no se toque nada, el árbol se muestra en el nivel elegido (3 al entrar).
  const abiertos = openNodes ?? abrirHasta(nodes, nivel - 3);
  const aplicarNivel = (n: number) => {
    setNivel(n);
    setDeptOpen(n > 1);
    setOpenNodes(null);
  };
  const toggle = (k: string) =>
    setOpenNodes(() => {
      const next = new Set(abiertos);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  const borrarInfo = (() => {
    if (!borrar) return { bloqueado: false, texto: "" };
    if (borrar.kind === "rubro") {
      const nSubs = subRubros.filter((s) => s.rubroId === borrar.id).length;
      const nIns = insumosPorRubro.get(borrar.id) ?? 0;
      if (nIns > 0)
        return {
          bloqueado: true,
          texto: `"${borrar.name}" tiene ${nIns} insumo(s) asignados. Pasalos a otro rubro en Insumos antes de eliminarlo, así sus compras no quedan "Sin rubro asignado".`,
        };
      return {
        bloqueado: false,
        texto: `¿Eliminar el rubro "${borrar.name}"?${nSubs > 0 ? ` También se eliminan sus ${nSubs} sub-rubro(s).` : ""} No se puede deshacer.`,
      };
    }
    const nIns = insumosPorSub.get(borrar.id)?.length ?? 0;
    if (nIns > 0)
      return {
        bloqueado: true,
        texto: `"${borrar.name}" tiene ${nIns} insumo(s) asignados. Pasalos a otro sub-rubro en Insumos antes de eliminarlo.`,
      };
    return { bloqueado: false, texto: `¿Eliminar el sub-rubro "${borrar.name}"? No se puede deshacer.` };
  })();

  const cargando = l1 || l2;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Estructura Food Cost"
        description="Rubros y sub-rubros tal como se ven en el Estado de Resultado Económico"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={exportar} data-testid="button-export">
              <Download className="h-4 w-4 mr-2" /> Exportar
            </Button>
            <Button variant="outline" onClick={() => setImportOpen(true)} data-testid="button-import">
              <Upload className="h-4 w-4 mr-2" /> Importar
            </Button>
            <Button onClick={() => abrirRubro(null)} data-testid="button-new-rubro">
              <Plus className="h-4 w-4 mr-2" /> Nuevo rubro
            </Button>
          </div>
        }
      />

      <Card>
        <CardContent className="py-3 space-y-3">
          <MapaEdificio activos={["costo"]} />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <MesConNumeros value={mes} onChange={setMes} />
            <BotonesNivel niveles={NIVELES} activo={openNodes ? 0 : nivel} onChange={aplicarNivel} />
          </div>
          {mes !== "none" && cargandoNumeros && <p className="text-xs text-muted-foreground">Calculando los números del mes…</p>}
          {conNumeros && (
            <p className="text-[11px] text-muted-foreground">
              Compras del mes de todos los locales. El % es sobre el total del Food Cost (en el informe es sobre las ventas).
            </p>
          )}
        </CardContent>
      </Card>

      {cargando ? (
        <Card>
          <CardContent className="space-y-3 py-6">
            {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-5 w-full" />)}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          <ColumnHeader first="Rubro / Sub-rubro / Insumo" pctLabel={conNumeros ? "% Food Cost" : ""} />
          <Department
            title="Food Cost — compras del mes"
            amount={total}
            pctValue={conNumeros ? 100 : null}
            open={deptOpen}
            onToggle={() => setDeptOpen(!deptOpen)}
            testId="estructura-food-cost"
          >
            {nodes.length === 0 ? (
              <p className="px-4 py-3 text-sm text-muted-foreground">Todavía no hay rubros. Creá el primero con "Nuevo rubro".</p>
            ) : (
              <TreeRows nodes={nodes} openNodes={abiertos} onToggle={toggle} />
            )}
          </Department>
          <p className="text-[11px] text-muted-foreground">
            Cada insumo cae en el rubro y sub-rubro que tiene cargado en Insumos. Un insumo sin rubro aparece en el informe
            como "Sin rubro asignado".
          </p>
        </div>
      )}

      <Dialog open={!!dialog} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {dialog?.kind === "rubro"
                ? dialog.editing ? "Editar rubro" : "Nuevo rubro"
                : dialog?.editing ? "Editar sub-rubro" : "Nuevo sub-rubro"}
            </DialogTitle>
            <DialogDescription>
              {dialog?.kind === "rubro"
                ? "Es una fila del departamento Food Cost en el Estado de Resultado Económico."
                : "Se abre adentro de su rubro, y adentro de él los insumos que lo tengan asignado."}
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!form.name.trim()) return toast({ title: "El nombre es requerido", variant: "destructive" });
              if (dialog?.kind === "sub" && !form.rubroId) return toast({ title: "Elegí el rubro", variant: "destructive" });
              guardar.mutate();
            }}
          >
            {dialog?.kind === "sub" && (
              <div className="space-y-1.5">
                <Label>Rubro *</Label>
                <Select value={form.rubroId} onValueChange={(v) => setForm({ ...form, rubroId: v })}>
                  <SelectTrigger data-testid="select-rubro">
                    <SelectValue placeholder="Elegí el rubro" />
                  </SelectTrigger>
                  <SelectContent>
                    {[...rubros].sort((a, b) => a.name.localeCompare(b.name, "es")).map((r) => (
                      <SelectItem key={r.id} value={String(r.id)}>{r.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Nombre *</Label>
              <Input
                autoFocus
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder={dialog?.kind === "rubro" ? "Ej. Carnes" : "Ej. Vacuna"}
                data-testid="input-name"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Descripción</Label>
              <Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} data-testid="input-description" />
            </div>

            {/* Vista previa: la fila tal cual va a aparecer en el informe. */}
            {form.name.trim() && (
              <div className="space-y-1">
                <p className="text-[11px] text-muted-foreground">Así se va a ver en el Estado de Resultado Económico:</p>
                <div className="rounded-md border overflow-hidden">
                  <TreeRows
                    nodes={
                      dialog?.kind === "rubro"
                        ? [{ key: "p", label: form.name.trim(), amount: null, pct: null, children: [] }]
                        : [{
                            key: "p",
                            label: rubros.find((r) => String(r.id) === form.rubroId)?.name ?? "(rubro)",
                            amount: null,
                            pct: null,
                            children: [{ key: "p/0", label: form.name.trim(), amount: null, pct: null, children: [] }],
                          }]
                    }
                    openNodes={new Set(["p"])}
                    onToggle={() => {}}
                  />
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setDialog(null)} data-testid="button-cancel">Cancelar</Button>
              <Button type="submit" disabled={guardar.isPending} data-testid="button-submit">
                {guardar.isPending ? "Guardando..." : dialog?.editing ? "Actualizar" : "Crear"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!borrar}
        onOpenChange={(o) => !o && setBorrar(null)}
        title={borrar?.kind === "rubro" ? "Eliminar rubro" : "Eliminar sub-rubro"}
        description={borrarInfo.texto}
        confirmLabel={borrarInfo.bloqueado ? "Entendido" : "Eliminar"}
        onConfirm={() => (borrarInfo.bloqueado ? setBorrar(null) : eliminar.mutate())}
        variant={borrarInfo.bloqueado ? undefined : "destructive"}
        isLoading={eliminar.isPending}
      />

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Importar rubros</DialogTitle>
            <DialogDescription>
              Subí un Excel con los rubros. Columnas: Nombre (requerido), Descripcion.
            </DialogDescription>
          </DialogHeader>
          <Input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls"
            onChange={(e) => e.target.files?.[0] && importar.mutate(e.target.files[0])}
            data-testid="input-import-file"
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
