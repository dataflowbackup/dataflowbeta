/**
 * Estructura Imputaciones (Financiero) — reemplaza a "Grupos Financ." y "Categorías Mov.".
 *
 * Pedido del usuario (16-oct-2026): crear grupos y categorías viendo EXACTAMENTE dónde van a caer en
 * el Estado de Resultado Económico. La pantalla es el edificio del informe: cada grupo y cada
 * categoría aparece en su departamento (Gastos Fijos, Comisiones, Inversión, Impuestos), y lo que no
 * entra al informe queda abajo, en "No aparece en el Estado de Resultado Económico", con el motivo.
 *
 * Desde acá también se mueve una categoría de departamento (decisión del 16-oct): son los mismos
 * datos que manejan "Grupos que computan" y "Categorías que SÍ computan" del Económico. La regla de
 * ubicación es la misma que usa el servidor en computeEconomicStatement.
 */
import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { PageHeader } from "@/components/page-header";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataEntryCombobox } from "@/components/data-entry-combobox";
import { useToast } from "@/hooks/use-toast";
import { usePersistentFilter } from "@/hooks/usePersistentFilter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Edit, Trash2, Plus, Eye, EyeOff, Download, Lock } from "lucide-react";
import type { FinancialGroup, TransactionCategory } from "@shared/schema";
import {
  CATEGORY_DESTINATION_LABELS,
  DESTINATION_TAX_KINDS,
  TAX_KIND_BY_KEY,
  type CategoryDestination,
} from "@shared/economicStatement";
import { ColumnHeader, Department, TreeRows, DEPARTAMENTOS, type TNode } from "@/components/economic/statement-visual";
import { ECON } from "@/components/economic/econ-shared";
import { MesConNumeros, useEstadoDelMes, MapaEdificio, BotonesNivel, abrirHasta } from "@/components/economic/structure-shared";

// ── Reglas (las mismas del servidor) ─────────────────────────────────────────

const GROUP_TYPES = [
  { value: "expense", label: "Gastos" },
  { value: "income", label: "Ingresos" },
  { value: "movimientos_financieros", label: "Movimientos Financieros" },
  { value: "transfer", label: "Transferencias" },
];

/** "Otros Movimientos": quedan asentados pero no entran a ningún resultado. */
const OTROS_MOVIMIENTOS = new Set([
  "opening_balance",
  "owner_withdrawal",
  "loan",
  "capital_contribution",
  "other_income",
  "cash_relief",
  "internal_transfer",
]);

const SPECIAL_TYPES = [
  { value: "opening_balance", label: "Inicio de mes (Otros Mov.)" },
  { value: "owner_withdrawal", label: "Retiro de socios (Otros Mov.)" },
  { value: "loan", label: "Préstamo (Otros Mov.)" },
  { value: "capital_contribution", label: "Aporte de Capital (Otros Mov.)" },
  { value: "other_income", label: "Otros ingresos (Otros Mov.)" },
  { value: "cash_relief", label: "Alivio de caja (Otros Mov.)" },
  { value: "internal_transfer", label: "Transferencia interna (Otros Mov.)" },
  { value: "costo_mercaderia", label: "Costo Mercadería" },
  { value: "gastos_fijos", label: "Gastos Fijos" },
  { value: "gastos_variables", label: "Gastos Variables" },
  { value: "sueldos", label: "Sueldos y Cargas Sociales" },
  { value: "impuestos", label: "Impuestos" },
  { value: "amortizaciones", label: "Amortizaciones" },
  { value: "ventas", label: "Ventas" },
  { value: "otros_ingresos", label: "Otros Ingresos" },
];

type Zona = "gastos" | "comisiones" | "inversiones" | "impuestos" | "fuera";
type MotivoFuera = "no_computa" | "ingresos" | "movfin" | "transfer" | "otros_mov" | "sin_grupo";

const MOTIVOS: Record<MotivoFuera, string> = {
  no_computa: "Grupos de gasto que no computan",
  ingresos: "Ingresos — las ventas del informe salen de FUDO, Datalive y Shares",
  movfin: "Movimientos financieros",
  transfer: "Transferencias",
  otros_mov: "Otros movimientos (retiros, préstamos, aportes, inicio de mes...)",
  sin_grupo: "Categorías sin grupo",
};

interface DestinationRow {
  categoryId: number;
  destination: CategoryDestination;
  taxKind: string | null;
}

interface Ubicacion {
  zona: Zona;
  motivo?: MotivoFuera;
  taxKind?: string;
}

const computa = (g: FinancialGroup | undefined) => ((g as any)?.economicComputes ?? true) !== false;

/** Dónde cae una categoría en el Estado de Resultado Económico. */
function ubicar(group: FinancialGroup | undefined, specialType: string | null | undefined, dest: DestinationRow | undefined): Ubicacion {
  if (specialType && OTROS_MOVIMIENTOS.has(specialType)) return { zona: "fuera", motivo: "otros_mov" };
  if (!group) return { zona: "fuera", motivo: "sin_grupo" };
  const t = String(group.type);
  if (t === "movimientos_financieros") return { zona: "fuera", motivo: "movfin" };
  if (t === "income") return { zona: "fuera", motivo: "ingresos" };
  if (t !== "expense") return { zona: "fuera", motivo: "transfer" };
  if (computa(group)) return { zona: "gastos" };
  // El destino solo vale para grupos que NO computan.
  if (!dest) return { zona: "fuera", motivo: "no_computa" };
  if (dest.destination === "gastos") return { zona: "gastos" };
  if (dest.destination === "comisiones") return { zona: "comisiones" };
  if (dest.destination === "inversion") return { zona: "inversiones" };
  if (dest.destination === "impuesto" && dest.taxKind) return { zona: "impuestos", taxKind: dest.taxKind };
  return { zona: "fuera", motivo: "no_computa" };
}

const NONE = "none";
const DEST_OPTIONS: Array<{ value: string; label: string }> = [
  { value: NONE, label: "No computa" },
  { value: "gastos", label: CATEGORY_DESTINATION_LABELS.gastos },
  { value: "comisiones", label: CATEGORY_DESTINATION_LABELS.comisiones },
  { value: "inversion", label: CATEGORY_DESTINATION_LABELS.inversion },
  ...DESTINATION_TAX_KINDS.map((k) => ({ value: `impuesto:${k}`, label: `Impuesto — ${TAX_KIND_BY_KEY[k].label}` })),
];
const destToValue = (d: DestinationRow | undefined) =>
  !d ? NONE : d.destination === "impuesto" ? `impuesto:${d.taxKind}` : d.destination;
const valueToDest = (v: string): DestinationRow | undefined => {
  if (v === NONE) return undefined;
  const [destination, taxKind] = v.split(":");
  return { categoryId: 0, destination: destination as CategoryDestination, taxKind: taxKind ?? null };
};

/** Lo que se lee del informe del mes para poner importes al lado. */
interface EstadoMes {
  gastos: { total: number; groups: Array<{ id: number; computes: boolean; children: Array<{ id: number; amount: number }> }> };
  inversiones: { total: number; groups: Array<{ id: number; children: Array<{ id: number; amount: number }> }> };
  comisiones: { total: number; lines: Array<{ concept: string; origen: string; amount: number }> };
  impuestos: { total: number; lines: Array<{ kind: string; informativo: boolean; children?: Array<{ label: string; amount: number; manual: boolean }> }> };
}

const NIVELES = [
  { n: 1, help: "Solo los departamentos" },
  { n: 2, help: "Grupos con sus categorías" },
];

const TAX_ORDER = ["iibb", "debito", "credito", "ganancias"];

type GroupDialog = { editing: FinancialGroup | null };
type CatDialog = { editing: TransactionCategory | null; groupId: number | null };

export default function EstructuraImputacionesPage() {
  const { toast } = useToast();
  const [mes, setMes] = usePersistentFilter<string>("estructuraImputaciones.mes", "none");
  const [nivel, setNivel] = useState(2);
  const [openSections, setOpenSections] = useState<string[] | null>(null);
  const [openNodes, setOpenNodes] = useState<Set<string> | null>(null);

  const [groupDialog, setGroupDialog] = useState<GroupDialog | null>(null);
  const [gForm, setGForm] = useState({ name: "", type: "expense", displayOrder: 1, computes: true });
  const [confirmTipo, setConfirmTipo] = useState(false);
  const [catDialog, setCatDialog] = useState<CatDialog | null>(null);
  const [cForm, setCForm] = useState({ name: "", type: "expense", groupId: "", isSpecial: false, specialType: "", dest: NONE });
  const [borrar, setBorrar] = useState<{ kind: "group" | "cat"; id: number; name: string } | null>(null);

  const { data: groups = [], isLoading: l1 } = useQuery<FinancialGroup[]>({ queryKey: ["/api/financial-groups"] });
  const { data: categories = [], isLoading: l2 } = useQuery<TransactionCategory[]>({ queryKey: ["/api/transaction-categories"] });
  const { data: destinations = [] } = useQuery<DestinationRow[]>({ queryKey: ["/api/economic/category-destinations"] });
  const { data: estado, isFetching: cargandoNumeros } = useEstadoDelMes<EstadoMes>(mes);
  const conNumeros = mes !== "none" && !!estado;

  const groupById = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);
  const destByCat = useMemo(() => new Map(destinations.map((d) => [d.categoryId, d])), [destinations]);

  const invalidar = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/financial-groups"] });
    queryClient.invalidateQueries({ queryKey: ["/api/transaction-categories"] });
    queryClient.invalidateQueries({ queryKey: ["/api/economic/category-destinations"] });
    queryClient.invalidateQueries({ queryKey: ["/api/economic/statement"] });
    queryClient.invalidateQueries({ queryKey: ["/api/economic-balance"] });
    queryClient.invalidateQueries({ queryKey: ["/api/economic/taxes"] });
  };
  const onError = (titulo: string) => (e: Error) => toast({ title: titulo, description: e.message, variant: "destructive" });

  // ── Mutaciones (los mismos endpoints de las pantallas viejas) ──────────────
  const setComputes = useMutation({
    mutationFn: async ({ id, computes }: { id: number; computes: boolean }) =>
      apiRequest("PATCH", `/api/financial-groups/${id}/economic-computes`, { computes }),
    onSuccess: invalidar,
    onError: onError("No se pudo cambiar el grupo"),
  });
  const setDestino = useMutation({
    mutationFn: async ({ categoryId, value }: { categoryId: number; value: string }) => {
      const [destination, taxKind] = value === NONE ? [null, null] : value.split(":");
      await apiRequest("PUT", `/api/economic/category-destinations/${categoryId}`, { destination, taxKind: taxKind ?? null });
    },
    onSuccess: invalidar,
    onError: onError("No se pudo mover la categoría"),
  });
  const toggleGroupActive = useMutation({
    mutationFn: async (g: FinancialGroup) => apiRequest("PATCH", `/api/financial-groups/${g.id}`, { active: g.active === false }),
    onSuccess: invalidar,
    onError: onError("No se pudo cambiar el grupo"),
  });
  const seed = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/financial-groups/seed", {})).json(),
    onSuccess: (data: any) => {
      invalidar();
      toast({ title: "Datos cargados", description: data?.message });
    },
    onError: onError("Error al cargar datos"),
  });

  const guardarGrupo = useMutation({
    mutationFn: async () => {
      if (!groupDialog) return;
      const body = { name: gForm.name.trim(), type: gForm.type, displayOrder: Number(gForm.displayOrder) || 1 };
      let id = groupDialog.editing?.id;
      if (groupDialog.editing) {
        await apiRequest("PATCH", `/api/financial-groups/${id}`, body);
      } else {
        const created = await (await apiRequest("POST", "/api/financial-groups", body)).json();
        id = created?.id;
      }
      // Solo los grupos de gasto computan o no.
      const antes = groupDialog.editing ? computa(groupDialog.editing) : true;
      if (id && gForm.type === "expense" && gForm.computes !== antes) {
        await apiRequest("PATCH", `/api/financial-groups/${id}/economic-computes`, { computes: gForm.computes });
      }
    },
    onSuccess: () => {
      invalidar();
      toast({ title: "Grupo guardado" });
      setGroupDialog(null);
    },
    onError: onError("No se pudo guardar el grupo"),
  });

  const guardarCategoria = useMutation({
    mutationFn: async () => {
      if (!catDialog) return;
      const body = {
        name: cForm.name.trim(),
        type: cForm.type,
        financialGroupId: cForm.groupId ? Number(cForm.groupId) : null,
        isSpecial: cForm.isSpecial,
        specialType: cForm.isSpecial ? cForm.specialType : undefined,
      };
      let id = catDialog.editing?.id;
      if (catDialog.editing) {
        await apiRequest("PATCH", `/api/transaction-categories/${id}`, body);
      } else {
        const created = await (await apiRequest("POST", "/api/transaction-categories", body)).json();
        id = created?.id;
      }
      const antes = id ? destToValue(destByCat.get(id)) : NONE;
      const g = cForm.groupId ? groupById.get(Number(cForm.groupId)) : undefined;
      const destinoAplica = g && String(g.type) === "expense" && !computa(g);
      if (id && destinoAplica && cForm.dest !== antes) {
        const [destination, taxKind] = cForm.dest === NONE ? [null, null] : cForm.dest.split(":");
        await apiRequest("PUT", `/api/economic/category-destinations/${id}`, { destination, taxKind: taxKind ?? null });
      }
    },
    onSuccess: () => {
      invalidar();
      toast({ title: "Categoría guardada" });
      setCatDialog(null);
    },
    onError: onError("No se pudo guardar la categoría"),
  });

  const eliminar = useMutation({
    mutationFn: async () => {
      if (!borrar) return;
      await apiRequest("DELETE", borrar.kind === "group" ? `/api/financial-groups/${borrar.id}` : `/api/transaction-categories/${borrar.id}`);
    },
    onSuccess: () => {
      invalidar();
      toast({ title: borrar?.kind === "group" ? "Grupo eliminado" : "Categoría eliminada" });
      setBorrar(null);
    },
    onError: (e: Error) =>
      toast({
        title: "No se pudo eliminar",
        description: /foreign key|constraint/i.test(e.message)
          ? "Tiene movimientos cargados. Movelos a otra categoría antes de eliminarla."
          : e.message,
        variant: "destructive",
      }),
  });

  const abrirGrupo = (editing: FinancialGroup | null, type = "expense") => {
    const maxOrder = groups.length > 0 ? Math.max(...groups.map((g) => g.displayOrder || 0)) + 1 : 1;
    setGForm({
      name: editing?.name ?? "",
      type: editing ? String(editing.type) : type,
      displayOrder: editing?.displayOrder || maxOrder,
      computes: editing ? computa(editing) : true,
    });
    setGroupDialog({ editing });
  };
  const abrirCategoria = (editing: TransactionCategory | null, groupId: number | null) => {
    const gid = editing ? (editing as any).financialGroupId ?? null : groupId;
    const g = gid != null ? groupById.get(gid) : undefined;
    setCForm({
      name: editing?.name ?? "",
      type: editing?.type ?? (g && String(g.type) === "income" ? "income" : "expense"),
      groupId: gid != null ? String(gid) : "",
      isSpecial: editing?.isSpecial ?? false,
      specialType: editing?.specialType ?? "",
      dest: editing ? destToValue(destByCat.get(editing.id)) : NONE,
    });
    setCatDialog({ editing, groupId });
  };

  // ── Importes del mes elegido ───────────────────────────────────────────────
  const montoCat = useMemo(() => {
    const m = new Map<number, number>();
    if (!estado) return m;
    for (const g of [...estado.gastos.groups, ...estado.inversiones.groups])
      for (const c of g.children) m.set(c.id, (m.get(c.id) ?? 0) + c.amount);
    // Comisiones e impuestos de extractos vienen por nombre de categoría.
    const porNombre = new Map(categories.map((c) => [c.name.trim().toLowerCase(), c.id]));
    for (const l of estado.comisiones.lines) {
      if (l.origen !== "extractos") continue;
      const id = porNombre.get(l.concept.trim().toLowerCase());
      if (id != null) m.set(id, (m.get(id) ?? 0) + l.amount);
    }
    for (const t of estado.impuestos.lines)
      for (const c of t.children ?? []) {
        if (c.manual) continue;
        const id = porNombre.get(c.label.trim().toLowerCase());
        if (id != null) m.set(id, (m.get(id) ?? 0) + c.amount);
      }
    return m;
  }, [estado, categories]);
  const monto = (catId: number) => (conNumeros ? (montoCat.get(catId) ?? 0) : null);

  // ── El edificio ────────────────────────────────────────────────────────────
  const arbol = useMemo(() => {
    const catActions = (c: TransactionCategory) => {
      const g = groupById.get((c as any).financialGroupId);
      const destinoAplica = g && String(g.type) === "expense" && !computa(g);
      return (
        <>
          {destinoAplica ? (
            <Select value={destToValue(destByCat.get(c.id))} onValueChange={(v) => setDestino.mutate({ categoryId: c.id, value: v })}>
              <SelectTrigger className="h-7 w-44 text-xs" title="A qué departamento va" data-testid={`select-destino-${c.id}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DEST_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          <Button variant="ghost" size="icon" className="h-7 w-7" title="Editar categoría" onClick={() => abrirCategoria(c, null)} data-testid={`button-edit-cat-${c.id}`}>
            <Edit className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" title="Eliminar categoría" onClick={() => setBorrar({ kind: "cat", id: c.id, name: c.name })} data-testid={`button-delete-cat-${c.id}`}>
            <Trash2 className="h-3.5 w-3.5 text-destructive" />
          </Button>
        </>
      );
    };
    const groupActions = (g: FinancialGroup) => {
      const nCats = categories.filter((c) => (c as any).financialGroupId === g.id).length;
      return (
        <>
          {String(g.type) === "expense" && (
            <Button
              variant="outline"
              size="sm"
              className={`h-7 px-2 text-[11px] ${computa(g) ? ECON.text : "text-muted-foreground"}`}
              title={computa(g) ? "El grupo entero va a Gastos Fijos. Clic para que no compute." : "El grupo no computa. Clic para mandarlo entero a Gastos Fijos."}
              onClick={() => setComputes.mutate({ id: g.id, computes: !computa(g) })}
              data-testid={`button-computa-${g.id}`}
            >
              {computa(g) ? "Computa" : "No computa"}
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-7 w-7" title="Nueva categoría en este grupo" onClick={() => abrirCategoria(null, g.id)} data-testid={`button-add-cat-${g.id}`}>
            <Plus className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" title="Editar grupo" onClick={() => abrirGrupo(g)} data-testid={`button-edit-group-${g.id}`}>
            <Edit className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            title={g.active === false ? "Mostrar grupo" : "Ocultar grupo (los movimientos quedan intactos)"}
            onClick={() => toggleGroupActive.mutate(g)}
            data-testid={`button-toggle-group-${g.id}`}
          >
            {g.active === false ? <EyeOff className="h-3.5 w-3.5 text-muted-foreground" /> : <Eye className="h-3.5 w-3.5" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            title={g.isSystem ? "Los grupos del sistema no se eliminan" : nCats > 0 ? `Tiene ${nCats} categorías: movelas antes de eliminarlo` : "Eliminar grupo"}
            disabled={!!g.isSystem || nCats > 0}
            onClick={() => setBorrar({ kind: "group", id: g.id, name: g.name })}
            data-testid={`button-delete-group-${g.id}`}
          >
            {g.isSystem ? <Lock className="h-3.5 w-3.5" /> : <Trash2 className="h-3.5 w-3.5 text-destructive" />}
          </Button>
        </>
      );
    };
    const catNode = (prefix: string, c: TransactionCategory): TNode => ({
      key: `${prefix}/c${c.id}`,
      label: c.name,
      amount: monto(c.id),
      pct: null,
      badge: c.active === false ? "inactiva" : undefined,
      actions: catActions(c),
      children: [],
    });
    const ordenar = (ns: TNode[]) =>
      conNumeros ? ns.sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0)) : ns.sort((a, b) => a.label.localeCompare(b.label, "es"));
    const suma = (ns: TNode[]) => (conNumeros ? ns.reduce((a, n) => a + (n.amount ?? 0), 0) : null);

    // Cada categoría a su zona.
    const porZona: Record<Zona, Array<{ c: TransactionCategory; u: Ubicacion }>> = { gastos: [], comisiones: [], inversiones: [], impuestos: [], fuera: [] };
    for (const c of categories) {
      const g = groupById.get((c as any).financialGroupId);
      const u = ubicar(g, c.specialType, destByCat.get(c.id));
      porZona[u.zona].push({ c, u });
    }

    /** Grupo → categorías, con los grupos ordenados como en el informe. */
    const porGrupo = (prefix: string, items: Array<{ c: TransactionCategory }>, incluirGrupos: FinancialGroup[] = []) => {
      const map = new Map<number, TransactionCategory[]>();
      for (const g of incluirGrupos) map.set(g.id, []);
      for (const { c } of items) {
        const gid = (c as any).financialGroupId as number;
        map.set(gid, [...(map.get(gid) ?? []), c]);
      }
      const nodes: TNode[] = Array.from(map.entries()).map(([gid, cats]) => {
        const g = groupById.get(gid)!;
        const hijos = ordenar(cats.map((c) => catNode(`${prefix}/g${gid}`, c)));
        return {
          key: `${prefix}/g${gid}`,
          label: g?.name ?? "Sin grupo",
          amount: suma(hijos),
          pct: null,
          badge: [g && !computa(g) && String(g.type) === "expense" && prefix !== "fuera-no_computa" ? "grupo que no computa" : null, g?.active === false ? "oculto" : null]
            .filter(Boolean)
            .join(" · ") || undefined,
          actions: g ? groupActions(g) : undefined,
          children: hijos,
        };
      });
      return conNumeros
        ? nodes.sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0))
        : nodes.sort((a, b) => (groupById.get(Number(a.key.split("/g")[1]))?.displayOrder ?? 0) - (groupById.get(Number(b.key.split("/g")[1]))?.displayOrder ?? 0));
    };

    const gruposGastoQueComputan = groups.filter((g) => String(g.type) === "expense" && computa(g));
    const gastos = porGrupo("gastos", porZona.gastos, gruposGastoQueComputan);
    const inversiones = porGrupo("inversiones", porZona.inversiones);
    const comisiones = ordenar(porZona.comisiones.map(({ c }) => ({ ...catNode("comisiones", c), meta: "de extractos" })));
    const impuestos: TNode[] = TAX_ORDER.map((k) => {
      const hijos = ordenar(porZona.impuestos.filter(({ u }) => u.taxKind === k).map(({ c }) => catNode(`impuestos/${k}`, c)));
      return {
        key: `impuestos/${k}`,
        label: TAX_KIND_BY_KEY[k as keyof typeof TAX_KIND_BY_KEY]?.label ?? k,
        amount: suma(hijos),
        pct: null,
        meta: hijos.length === 0 ? "sin categorías: se carga a mano en la solapa Impuestos" : undefined,
        children: hijos,
      };
    });

    // Fuera del informe, por motivo. Los grupos que no computan aparecen aunque no tengan categorías.
    const fuera: TNode[] = (Object.keys(MOTIVOS) as MotivoFuera[])
      .map((motivo) => {
        const items = porZona.fuera.filter(({ u }) => u.motivo === motivo);
        let hijos: TNode[];
        if (motivo === "otros_mov" || motivo === "sin_grupo") {
          hijos = ordenar(items.map(({ c }) => catNode(`fuera-${motivo}`, c)));
        } else {
          const tipo = motivo === "no_computa" ? "expense" : motivo === "ingresos" ? "income" : motivo === "movfin" ? "movimientos_financieros" : "transfer";
          const vacios = groups.filter((g) => String(g.type) === tipo && (motivo !== "no_computa" || !computa(g)));
          hijos = porGrupo(`fuera-${motivo}`, items, vacios);
        }
        return { key: `fuera/${motivo}`, label: MOTIVOS[motivo], amount: motivo === "no_computa" ? suma(hijos) : null, pct: null, children: hijos } as TNode;
      })
      .filter((n) => n.children.length > 0);

    return { gastos, comisiones, inversiones, impuestos, fuera };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, categories, destByCat, montoCat, conNumeros]);

  const SECCIONES = ["gastos", "comisiones", "inversiones", "impuestos", "fuera"] as const;
  const secAbiertas = openSections ?? (nivel === 1 ? [] : [...SECCIONES]);
  const nodosAbiertos =
    openNodes ??
    (nivel === 1
      ? new Set<string>()
      : new Set([
          ...Array.from(abrirHasta(arbol.gastos, 0)),
          ...Array.from(abrirHasta(arbol.inversiones, 0)),
          ...Array.from(abrirHasta(arbol.impuestos, 0)),
          ...Array.from(abrirHasta(arbol.fuera, 0)),
        ]));
  const aplicarNivel = (n: number) => {
    setNivel(n);
    setOpenSections(null);
    setOpenNodes(null);
  };
  const toggleSection = (k: string) =>
    setOpenSections(secAbiertas.includes(k as any) ? secAbiertas.filter((x) => x !== k) : [...secAbiertas, k]);
  const toggleNode = (k: string) =>
    setOpenNodes(() => {
      const next = new Set(nodosAbiertos);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  const dept = (k: (typeof SECCIONES)[number]) => ({ open: secAbiertas.includes(k), onToggle: () => toggleSection(k) });

  // ── Vista previa de la categoría que se está creando o editando ────────────
  const preview = (() => {
    if (!catDialog || !cForm.name.trim()) return null;
    const g = cForm.groupId ? groupById.get(Number(cForm.groupId)) : undefined;
    const u = ubicar(g, cForm.isSpecial ? cForm.specialType : null, valueToDest(cForm.dest));
    const destino =
      u.zona === "fuera"
        ? `No aparece en el Estado de Resultado Económico — ${MOTIVOS[u.motivo!]}`
        : `${DEPARTAMENTOS[u.zona].title}${u.taxKind ? ` — ${TAX_KIND_BY_KEY[u.taxKind as keyof typeof TAX_KIND_BY_KEY]?.label ?? u.taxKind}` : ""}`;
    const hoja: TNode = { key: "p/0", label: cForm.name.trim(), amount: null, pct: null, children: [] };
    const nodes: TNode[] =
      u.zona === "comisiones" || (u.zona === "fuera" && (u.motivo === "otros_mov" || u.motivo === "sin_grupo"))
        ? [{ ...hoja, key: "p" }]
        : [{ key: "p", label: u.zona === "impuestos" ? (TAX_KIND_BY_KEY[u.taxKind as keyof typeof TAX_KIND_BY_KEY]?.label ?? "") : g?.name ?? "", amount: null, pct: null, children: [hoja] }];
    return { destino, fuera: u.zona === "fuera", nodes };
  })();

  const grupoSel = cForm.groupId ? groupById.get(Number(cForm.groupId)) : undefined;
  const destinoAplicaForm = !!grupoSel && String(grupoSel.type) === "expense" && !computa(grupoSel);
  const tipoCambiaSistema = !!groupDialog?.editing?.isSystem && gForm.type !== String(groupDialog.editing.type);

  const cargando = l1 || l2;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Estructura Imputaciones"
        description="Grupos y categorías de movimientos tal como se ven en el Estado de Resultado Económico"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => abrirCategoria(null, null)} data-testid="button-new-cat">
              <Plus className="h-4 w-4 mr-2" /> Nueva categoría
            </Button>
            <Button onClick={() => abrirGrupo(null)} data-testid="button-new-group">
              <Plus className="h-4 w-4 mr-2" /> Nuevo grupo
            </Button>
          </div>
        }
      />

      {!cargando && groups.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Cargar datos predeterminados</CardTitle>
            <CardDescription>
              No hay grupos configurados. Podés cargar los grupos y categorías predeterminados para gastronomía o crear los tuyos.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex gap-4">
            <Button onClick={() => seed.mutate()} disabled={seed.isPending} data-testid="button-seed-data">
              <Download className="h-4 w-4 mr-2" /> {seed.isPending ? "Cargando..." : "Cargar datos predeterminados"}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardContent className="py-3 space-y-3">
              <MapaEdificio activos={["gastos", "comisiones", "inversiones", "impuestos"]} />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <MesConNumeros value={mes} onChange={setMes} />
                <BotonesNivel niveles={NIVELES} activo={openSections || openNodes ? 0 : nivel} onChange={aplicarNivel} />
              </div>
              {mes !== "none" && cargandoNumeros && <p className="text-xs text-muted-foreground">Calculando los números del mes…</p>}
              {conNumeros && (
                <p className="text-[11px] text-muted-foreground">
                  Movimientos del mes económico de todos los locales. Los totales de cada departamento incluyen lo cargado a mano.
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
              <ColumnHeader first="Grupo / Categoría" pctLabel="" />

              <Department title="Ventas netas" subtitle="salen de FUDO, Datalive, Shares y las ventas manuales: no se arman con categorías" amount={null} pctValue={null} open={false} />
              <Department title="Food Cost" subtitle="" amount={null} pctValue={null} open={false} actions={<Link href="/estructura-food-cost" className={`text-[11px] ${ECON.text} hover:underline`}>se arma en Estructura Food Cost →</Link>} />

              <Department title={DEPARTAMENTOS.gastos.title} subtitle="grupos que computan y categorías mandadas acá" amount={conNumeros ? estado!.gastos.total : null} pctValue={null} {...dept("gastos")} testId="estructura-gastos">
                {arbol.gastos.length === 0
                  ? <p className="px-4 py-3 text-sm text-muted-foreground">Ningún grupo de gasto computa.</p>
                  : <TreeRows nodes={arbol.gastos} openNodes={nodosAbiertos} onToggle={toggleNode} />}
              </Department>

              <Department title={DEPARTAMENTOS.comisiones.title} subtitle="más las que se cargan a mano en la solapa Comisiones" amount={conNumeros ? estado!.comisiones.total : null} pctValue={null} {...dept("comisiones")} testId="estructura-comisiones">
                {arbol.comisiones.length === 0
                  ? <p className="px-4 py-3 text-sm text-muted-foreground">Ninguna categoría va a Comisiones. Se manda desde un grupo que no computa.</p>
                  : <TreeRows nodes={arbol.comisiones} openNodes={nodosAbiertos} onToggle={toggleNode} />}
              </Department>

              <Department title={DEPARTAMENTOS.inversiones.title} amount={conNumeros ? estado!.inversiones.total : null} pctValue={null} {...dept("inversiones")} testId="estructura-inversion">
                {arbol.inversiones.length === 0
                  ? <p className="px-4 py-3 text-sm text-muted-foreground">Ninguna categoría va a Inversión. Se manda desde un grupo que no computa.</p>
                  : <TreeRows nodes={arbol.inversiones} openNodes={nodosAbiertos} onToggle={toggleNode} />}
              </Department>

              <Department title={DEPARTAMENTOS.impuestos.title} subtitle="el IVA no va acá: es informativo" amount={conNumeros ? estado!.impuestos.total : null} pctValue={null} {...dept("impuestos")} testId="estructura-impuestos">
                <TreeRows nodes={arbol.impuestos} openNodes={nodosAbiertos} onToggle={toggleNode} />
              </Department>

              <Card className="overflow-hidden border-dashed" data-testid="estructura-fuera">
                <div className="flex items-center gap-2 pl-2 pr-3 py-2.5 cursor-pointer bg-muted/30" onClick={() => toggleSection("fuera")}>
                  <span className="w-4 shrink-0" />
                  <div className="flex-1">
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">No aparece en el Estado de Resultado Económico</span>
                    <span className="ml-2 text-[11px] text-muted-foreground">
                      revisá que no haya quedado afuera algo que debería contar
                    </span>
                  </div>
                  <Badge variant="outline" className="text-[10px]">{secAbiertas.includes("fuera") ? "ocultar" : "ver"}</Badge>
                </div>
                {secAbiertas.includes("fuera") && <TreeRows nodes={arbol.fuera} openNodes={nodosAbiertos} onToggle={toggleNode} />}
              </Card>

              <p className="text-[11px] text-muted-foreground">
                Un grupo de gasto que computa va entero a Gastos Fijos. Si no computa, cada una de sus categorías se puede
                mandar a Gastos Fijos, Comisiones, Inversión o a un impuesto con el desplegable de la fila; sin destino queda afuera.
              </p>
            </div>
          )}
        </>
      )}

      {/* ── Grupo ── */}
      <Dialog open={!!groupDialog} onOpenChange={(o) => !o && setGroupDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{groupDialog?.editing ? "Editar grupo" : "Nuevo grupo"}</DialogTitle>
            <DialogDescription>Los grupos ordenan las categorías en el Estado de Resultado.</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!gForm.name.trim()) return toast({ title: "El nombre es requerido", variant: "destructive" });
              if (tipoCambiaSistema) return setConfirmTipo(true);
              guardarGrupo.mutate();
            }}
          >
            {groupDialog?.editing?.isSystem && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                Grupo del sistema: se puede renombrar y cambiar el tipo (con confirmación), pero no eliminar.
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Nombre *</Label>
              <Input autoFocus value={gForm.name} onChange={(e) => setGForm({ ...gForm, name: e.target.value })} placeholder="Ej: RRHH, Servicios" data-testid="input-group-name" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Tipo</Label>
                <DataEntryCombobox
                  options={GROUP_TYPES}
                  value={gForm.type}
                  onValueChange={(v) => setGForm({ ...gForm, type: v || "expense" })}
                  placeholder="Seleccionar tipo"
                  searchPlaceholder="Buscar tipo…"
                  data-testid="select-group-type"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Orden</Label>
                <Input type="number" min={1} value={gForm.displayOrder} onChange={(e) => setGForm({ ...gForm, displayOrder: Number(e.target.value) })} data-testid="input-group-order" />
              </div>
            </div>
            {gForm.type === "expense" && (
              <div className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <p className="text-sm font-medium">Computa en el Estado Económico</p>
                  <p className="text-xs text-muted-foreground">
                    Si computa, el grupo entero va a Gastos Fijos. Si no, cada categoría se manda a donde corresponda.
                  </p>
                </div>
                <Switch checked={gForm.computes} onCheckedChange={(v) => setGForm({ ...gForm, computes: v })} data-testid="switch-group-computes" />
              </div>
            )}
            {gForm.name.trim() && (
              <p className="text-xs">
                <span className="text-muted-foreground">En el informe: </span>
                <span className={`font-medium ${gForm.type === "expense" && gForm.computes ? ECON.text : "text-muted-foreground"}`}>
                  {gForm.type === "expense"
                    ? gForm.computes
                      ? "Gastos Fijos"
                      : "no computa (sus categorías se mandan una por una)"
                    : `no aparece — ${MOTIVOS[gForm.type === "income" ? "ingresos" : gForm.type === "movimientos_financieros" ? "movfin" : "transfer"]}`}
                </span>
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setGroupDialog(null)}>Cancelar</Button>
              <Button type="submit" disabled={guardarGrupo.isPending} data-testid="button-submit-group">
                {guardarGrupo.isPending ? "Guardando..." : groupDialog?.editing ? "Guardar" : "Crear"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmTipo}
        onOpenChange={setConfirmTipo}
        title="Cambiar el tipo de un grupo del sistema"
        description={`Vas a cambiar el tipo de "${groupDialog?.editing?.name}" a "${GROUP_TYPES.find((t) => t.value === gForm.type)?.label}". Esto cambia de qué lado suma en el balance. ¿Confirmás?`}
        onConfirm={() => {
          setConfirmTipo(false);
          guardarGrupo.mutate();
        }}
        isLoading={guardarGrupo.isPending}
      />

      {/* ── Categoría ── */}
      <Dialog open={!!catDialog} onOpenChange={(o) => !o && setCatDialog(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{catDialog?.editing ? "Editar categoría" : "Nueva categoría"}</DialogTitle>
            <DialogDescription>Abajo se ve en qué departamento del informe va a caer.</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!cForm.name.trim()) return toast({ title: "El nombre es requerido", variant: "destructive" });
              if (cForm.isSpecial && !cForm.specialType) return toast({ title: "Elegí el tipo especial", variant: "destructive" });
              guardarCategoria.mutate();
            }}
          >
            {catDialog?.editing?.isSystem && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                Categoría del sistema: se puede renombrar y mover de grupo. El tipo y la clasificación especial quedan bloqueados.
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Nombre *</Label>
              <Input autoFocus value={cForm.name} onChange={(e) => setCForm({ ...cForm, name: e.target.value })} placeholder="Ej: Luz, Alquiler" data-testid="input-cat-name" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Tipo *</Label>
                <DataEntryCombobox
                  options={[{ value: "expense", label: "Egreso" }, { value: "income", label: "Ingreso" }]}
                  value={cForm.type}
                  onValueChange={(v) => setCForm({ ...cForm, type: v || "expense" })}
                  disabled={catDialog?.editing?.isSystem === true}
                  placeholder="Seleccionar tipo"
                  searchPlaceholder="Buscar tipo…"
                  data-testid="select-cat-type"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Grupo</Label>
                <DataEntryCombobox
                  options={groups.filter((g) => g.active !== false || String(g.id) === cForm.groupId).map((g) => ({ value: String(g.id), label: g.name }))}
                  value={cForm.groupId}
                  onValueChange={(v) => setCForm({ ...cForm, groupId: v || "" })}
                  placeholder="Seleccionar grupo"
                  searchPlaceholder="Buscar grupo…"
                  emptyOptionLabel="Sin grupo"
                  data-testid="select-cat-group"
                />
              </div>
            </div>
            {destinoAplicaForm && (
              <div className="space-y-1.5">
                <Label>Destino en el Estado Económico</Label>
                <Select value={cForm.dest} onValueChange={(v) => setCForm({ ...cForm, dest: v })}>
                  <SelectTrigger data-testid="select-cat-dest">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DEST_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">El grupo no computa, así que esta categoría va a donde la mandes.</p>
              </div>
            )}
            <div className="space-y-3 rounded-lg border p-3 bg-muted/30">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Categoría especial</p>
                  <p className="text-xs text-muted-foreground">Los tipos "(Otros Mov.)" quedan asentados pero no entran al resultado.</p>
                </div>
                <Switch
                  checked={cForm.isSpecial}
                  onCheckedChange={(v) => setCForm({ ...cForm, isSpecial: v })}
                  disabled={catDialog?.editing?.isSystem === true}
                  data-testid="switch-cat-special"
                />
              </div>
              {cForm.isSpecial && (
                <DataEntryCombobox
                  options={SPECIAL_TYPES}
                  value={cForm.specialType}
                  onValueChange={(v) => setCForm({ ...cForm, specialType: v || "" })}
                  disabled={catDialog?.editing?.isSystem === true}
                  placeholder="Tipo especial"
                  searchPlaceholder="Buscar tipo…"
                  data-testid="select-cat-special"
                />
              )}
            </div>

            {preview && (
              <div className="space-y-1">
                <p className="text-[11px] text-muted-foreground">
                  En el Estado de Resultado Económico:{" "}
                  <span className={`font-medium ${preview.fuera ? "text-amber-700 dark:text-amber-400" : ECON.text}`}>{preview.destino}</span>
                </p>
                {!preview.fuera && (
                  <div className="rounded-md border overflow-hidden">
                    <TreeRows nodes={preview.nodes} openNodes={new Set(["p"])} onToggle={() => {}} />
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setCatDialog(null)}>Cancelar</Button>
              <Button type="submit" disabled={guardarCategoria.isPending} data-testid="button-submit-cat">
                {guardarCategoria.isPending ? "Guardando..." : catDialog?.editing ? "Guardar" : "Crear"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!borrar}
        onOpenChange={(o) => !o && setBorrar(null)}
        title={borrar?.kind === "group" ? "Eliminar grupo" : "Eliminar categoría"}
        description={
          borrar?.kind === "group"
            ? `¿Eliminar el grupo "${borrar?.name}"? No se puede deshacer.`
            : `¿Eliminar la categoría "${borrar?.name}"? Si tiene movimientos cargados no se va a poder; no se puede deshacer.`
        }
        confirmLabel="Eliminar"
        onConfirm={() => eliminar.mutate()}
        variant="destructive"
        isLoading={eliminar.isPending}
      />
    </div>
  );
}
