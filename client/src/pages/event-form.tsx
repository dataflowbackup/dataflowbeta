/**
 * Eventos — armado y costeo de una propuesta.
 *
 * Mientras es borrador, los costos de los platos se toman vivos (Carta y Pizarrón). Al marcarla
 * como enviada queda congelada: se ve y se imprime con los costos y precios del momento.
 * Dos salidas: la propuesta comercial (cliente) y el detalle interno (nosotros).
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { DataEntryCombobox } from "@/components/data-entry-combobox";
import { QuantityInput } from "@/components/quantity-input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatCurrency } from "@/lib/formatters";
import { useDraftData, draftRowToInput } from "@/lib/recipe-drafts";
import { buildEventInternalPdf, buildEventProposalPdf, eventPdfFileName, type EventPdfInput } from "@/lib/event-pdf";
import {
  EVENT_IVA_MODE_LABELS,
  EVENT_STATUS_LABELS,
  computeEventTotals,
  convertUnitPrice,
  defaultUnitPrice,
  type EventDirectCost,
  type EventFixedCost,
  type EventItem,
  type EventIvaMode,
  type EventStatus,
  type EventTax,
} from "@shared/eventPricing";
import type { Local, Tax } from "@shared/schema";
import {
  CalendarDays,
  ChefHat,
  FlaskConical,
  Plus,
  Trash2,
  FileDown,
  FileLock2,
  Copy,
  GitBranch,
  Lock,
  Users,
  Percent,
  Receipt,
  Building2,
  RotateCcw,
} from "lucide-react";

const newKey = () => Math.random().toString(36).slice(2, 10);
const num = (v: unknown) => parseFloat(String(v ?? 0)) || 0;
const fmtPct = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? "—" : `${new Intl.NumberFormat("es-AR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(v)}%`;

interface EventData {
  id: number;
  name: string;
  localId: number | null;
  customerName: string | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  eventDate: string | null;
  eventTime: string | null;
  location: string | null;
  guests: number | null;
  brandName: string | null;
  status: EventStatus;
  version: number;
  validUntil: string | null;
  paymentTerms: string | null;
  clientNotes: string | null;
  internalNotes: string | null;
  ivaMode: EventIvaMode;
  ivaRate: number | string;
  discountType: "pct" | "amount";
  discountValue: number | string;
  items: EventItem[];
  directCosts: EventDirectCost[];
  fixedCosts: EventFixedCost[];
  taxes: EventTax[];
  sentAt: string | null;
}

interface FixedCostAverages {
  months: string[];
  groups: Array<{ id: number; name: string; average: number; categories: Array<{ id: number; name: string; average: number }> }>;
}

const STATUS_TONE: Record<EventStatus, string> = {
  borrador: "bg-muted text-muted-foreground",
  enviada: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  aceptada: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  rechazada: "bg-destructive/10 text-destructive",
};

export default function EventFormPage() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const params = useParams<{ id: string }>();
  const isNew = !params.id || params.id === "nuevo";
  const eventId = isNew ? undefined : parseInt(params.id, 10);

  const { data: existing, isLoading: loadingEvent } = useQuery<EventData>({
    queryKey: ["/api/events", eventId],
    enabled: eventId != null,
  });
  const { data: organization } = useQuery<{ id: number; name: string } | null>({ queryKey: ["/api/auth/organization"] });
  const { data: locals = [] } = useQuery<Local[]>({ queryKey: ["/api/locals"] });
  const { data: taxCatalog = [] } = useQuery<Tax[]>({ queryKey: ["/api/taxes"] });
  const { sources, drafts, coster } = useDraftData();

  // ── Estado ──
  const [name, setName] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [eventTime, setEventTime] = useState("");
  const [location, setLocation] = useState("");
  const [guests, setGuests] = useState(0);
  const [brandName, setBrandName] = useState("");
  const [localId, setLocalId] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("");
  const [clientNotes, setClientNotes] = useState("");
  const [internalNotes, setInternalNotes] = useState("");
  const [ivaMode, setIvaMode] = useState<EventIvaMode>("incluido");
  const [ivaRate, setIvaRate] = useState(21);
  const [discountType, setDiscountType] = useState<"pct" | "amount">("pct");
  const [discountValue, setDiscountValue] = useState(0);
  const [items, setItems] = useState<EventItem[]>([]);
  const [directCosts, setDirectCosts] = useState<EventDirectCost[]>([]);
  const [fixedCosts, setFixedCosts] = useState<EventFixedCost[]>([]);
  const [taxes, setTaxes] = useState<EventTax[]>([]);
  const [dirty, setDirty] = useState(false);
  const [loadedId, setLoadedId] = useState<number | null>(null);
  const [avgMonths, setAvgMonths] = useState(3);

  useEffect(() => {
    if (!existing || loadedId === existing.id) return;
    setName(existing.name);
    setCustomerName(existing.customerName ?? "");
    setContactName(existing.contactName ?? "");
    setContactPhone(existing.contactPhone ?? "");
    setContactEmail(existing.contactEmail ?? "");
    setEventDate(existing.eventDate ?? "");
    setEventTime(existing.eventTime ?? "");
    setLocation(existing.location ?? "");
    setGuests(existing.guests ?? 0);
    setBrandName(existing.brandName ?? "");
    setLocalId(existing.localId != null ? String(existing.localId) : "");
    setValidUntil(existing.validUntil ?? "");
    setPaymentTerms(existing.paymentTerms ?? "");
    setClientNotes(existing.clientNotes ?? "");
    setInternalNotes(existing.internalNotes ?? "");
    setIvaMode(existing.ivaMode ?? "incluido");
    setIvaRate(num(existing.ivaRate) || 21);
    setDiscountType(existing.discountType === "amount" ? "amount" : "pct");
    setDiscountValue(num(existing.discountValue));
    setItems(existing.items ?? []);
    setDirectCosts(existing.directCosts ?? []);
    setFixedCosts(existing.fixedCosts ?? []);
    setTaxes(existing.taxes ?? []);
    setLoadedId(existing.id);
    setDirty(false);
  }, [existing, loadedId]);

  // Evento nuevo: la marca arranca con el nombre de la empresa (editable).
  useEffect(() => {
    if (isNew && !brandName && organization?.name) setBrandName(organization.name);
  }, [isNew, brandName, organization]);

  const status: EventStatus = existing?.status ?? "borrador";
  const locked = status !== "borrador";
  const mark = () => setDirty(true);

  // ── Costos vivos (solo en borrador) ──
  const liveCost = (it: EventItem): number | null => {
    if (it.sourceType === "recipe") {
      const p = sources?.platos.find((x) => x.id === it.recipeId);
      return p ? p.totalCost : null;
    }
    if (it.sourceType === "draft") {
      const d = drafts.find((x) => x.id === it.draftId);
      return d && coster ? coster.costDraft(draftRowToInput(d)).totalCost : null;
    }
    return null;
  };
  const effectiveItems: EventItem[] = useMemo(
    () =>
      items.map((it) => {
        if (locked || it.sourceType === "manual") return it;
        const c = liveCost(it);
        return c != null ? { ...it, unitCost: Math.round(c * 10000) / 10000 } : it;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, locked, sources, drafts, coster],
  );

  const totals = computeEventTotals({
    ivaMode,
    ivaRate,
    discountType,
    discountValue,
    guests: guests || null,
    items: effectiveItems,
    directCosts,
    fixedCosts,
    taxes,
  });

  // ── Opciones para agregar platos ──
  const platoOptions = useMemo(
    () =>
      (sources?.platos ?? [])
        .filter((p) => p.active)
        .map((p) => ({ value: String(p.id), label: `${p.name}${p.categoryName ? ` — ${p.categoryName}` : ""} · ${formatCurrency(p.salePriceWithTax)}` })),
    [sources],
  );
  const draftOptions = useMemo(
    () =>
      drafts
        .filter((d) => d.recipeType === "plato" && d.status !== "descartada")
        .map((d) => ({ value: String(d.id), label: `${d.name} · ${formatCurrency(num(d.salePriceWithTax))}` })),
    [drafts],
  );

  const addRecipe = (id: string) => {
    const p = sources?.platos.find((x) => String(x.id) === id);
    if (!p) return;
    setItems((prev) => [
      ...prev,
      {
        key: newKey(),
        sourceType: "recipe",
        recipeId: p.id,
        name: p.name,
        quantity: guests > 0 ? guests : 1,
        unitPrice: Math.round(defaultUnitPrice(p.salePriceWithTax, ivaMode, ivaRate) * 100) / 100,
        unitCost: p.totalCost,
      },
    ]);
    mark();
  };
  const addDraft = (id: string) => {
    const d = drafts.find((x) => String(x.id) === id);
    if (!d) return;
    const cost = coster ? coster.costDraft(draftRowToInput(d)).totalCost : 0;
    setItems((prev) => [
      ...prev,
      {
        key: newKey(),
        sourceType: "draft",
        draftId: d.id,
        name: d.name,
        quantity: guests > 0 ? guests : 1,
        unitPrice: Math.round(defaultUnitPrice(num(d.salePriceWithTax), ivaMode, ivaRate) * 100) / 100,
        unitCost: cost,
      },
    ]);
    mark();
  };
  const addManual = () => {
    setItems((prev) => [...prev, { key: newKey(), sourceType: "manual", name: "", quantity: guests > 0 ? guests : 1, unitPrice: 0, unitCost: 0 }]);
    mark();
  };
  const setItem = (key: string, patch: Partial<EventItem>) => {
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...patch } : i)));
    mark();
  };
  const listPrice = (it: EventItem): number | null => {
    if (it.sourceType === "recipe") {
      const p = sources?.platos.find((x) => x.id === it.recipeId);
      return p ? defaultUnitPrice(p.salePriceWithTax, ivaMode, ivaRate) : null;
    }
    if (it.sourceType === "draft") {
      const d = drafts.find((x) => x.id === it.draftId);
      return d ? defaultUnitPrice(num(d.salePriceWithTax), ivaMode, ivaRate) : null;
    }
    return null;
  };

  const changeIvaMode = (next: EventIvaMode) => {
    if (next === ivaMode) return;
    // Lo que se cobra no cambia: los precios cargados se convierten al nuevo modo.
    setItems((prev) => prev.map((i) => ({ ...i, unitPrice: Math.round(convertUnitPrice(i.unitPrice, ivaMode, next, ivaRate) * 100) / 100 })));
    if (discountType === "amount") setDiscountValue((v) => Math.round(convertUnitPrice(v, ivaMode, next, ivaRate) * 100) / 100);
    setIvaMode(next);
    mark();
  };

  // ── Costos fijos promedio ──
  const { data: averages, isFetching: loadingAvg } = useQuery<FixedCostAverages>({
    queryKey: ["/api/events/fixed-cost-averages", avgMonths, localId],
    queryFn: async () => {
      const p = new URLSearchParams({ months: String(avgMonths) });
      if (localId) p.set("localId", localId);
      const res = await fetch(`/api/events/fixed-cost-averages?${p}`, { credentials: "include" });
      if (!res.ok) throw new Error("No se pudieron calcular los promedios");
      return res.json();
    },
    enabled: !locked,
    staleTime: 10 * 60_000,
  });
  const fixedOptions = useMemo(() => {
    if (!averages) return [];
    const out: Array<{ value: string; label: string }> = [];
    for (const g of averages.groups) {
      out.push({ value: `g:${g.id}`, label: `${g.name} (grupo) · ${formatCurrency(g.average)}/mes` });
      for (const c of g.categories) out.push({ value: `c:${c.id}`, label: `   ${g.name} › ${c.name} · ${formatCurrency(c.average)}/mes` });
    }
    return out;
  }, [averages]);
  const addFixedFromAverage = (value: string) => {
    if (!averages) return;
    const [kind, idRaw] = value.split(":");
    const id = parseInt(idRaw, 10);
    let concept = "";
    let avg = 0;
    let groupId: number | null = null;
    let categoryId: number | null = null;
    for (const g of averages.groups) {
      if (kind === "g" && g.id === id) {
        concept = g.name;
        avg = g.average;
        groupId = g.id;
      }
      for (const c of g.categories) {
        if (kind === "c" && c.id === id) {
          concept = `${g.name} › ${c.name}`;
          avg = c.average;
          groupId = g.id;
          categoryId = c.id;
        }
      }
    }
    const sharePct = Math.round((100 / 30) * 100) / 100; // 1 día de 30, editable
    setFixedCosts((prev) => [
      ...prev,
      {
        key: newKey(),
        concept,
        financialGroupId: groupId,
        categoryId,
        mode: "promedio",
        monthlyAverage: Math.round(avg * 100) / 100,
        sharePct,
        months: avgMonths,
        amount: Math.round(avg * (sharePct / 100) * 100) / 100,
      },
    ]);
    mark();
  };
  const setFixed = (key: string, patch: Partial<EventFixedCost>) => {
    setFixedCosts((prev) =>
      prev.map((f) => {
        if (f.key !== key) return f;
        const next = { ...f, ...patch };
        if (next.mode === "promedio") next.amount = Math.round(num(next.monthlyAverage) * (num(next.sharePct) / 100) * 100) / 100;
        return next;
      }),
    );
    mark();
  };

  const taxOptions = useMemo(
    () =>
      taxCatalog
        .filter((t) => t.active !== false)
        .map((t) => ({ value: String(t.id), label: `${t.name} (${new Intl.NumberFormat("es-AR").format(num(t.percentage))}%)` })),
    [taxCatalog],
  );

  // ── Guardar / estado ──
  const payload = () => ({
    name,
    localId: localId ? parseInt(localId, 10) : null,
    customerName: customerName || null,
    contactName: contactName || null,
    contactPhone: contactPhone || null,
    contactEmail: contactEmail || null,
    eventDate: eventDate || null,
    eventTime: eventTime || null,
    location: location || null,
    guests: guests || null,
    brandName: brandName || null,
    validUntil: validUntil || null,
    paymentTerms: paymentTerms || null,
    clientNotes: clientNotes || null,
    internalNotes: internalNotes || null,
    ivaMode,
    ivaRate,
    discountType,
    discountValue,
    items: effectiveItems,
    directCosts,
    fixedCosts,
    taxes,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/events"] });
  };

  const save = useMutation({
    mutationFn: async () => {
      const res = isNew ? await apiRequest("POST", "/api/events", payload()) : await apiRequest("PUT", `/api/events/${eventId}`, payload());
      return (await res.json()) as EventData;
    },
    onSuccess: (ev) => {
      invalidate();
      setDirty(false);
      toast({ title: "Propuesta guardada" });
      if (isNew) navigate(`/eventos/${ev.id}`);
    },
    onError: (e: Error) => toast({ title: "No se pudo guardar", description: e.message, variant: "destructive" }),
  });

  const changeStatus = useMutation({
    mutationFn: async (next: EventStatus) => {
      // Al enviarla se guarda primero, así la foto que se congela es la que se ve.
      if (next === "enviada" && dirty && !locked) await apiRequest("PUT", `/api/events/${eventId}`, payload());
      return (await (await apiRequest("PATCH", `/api/events/${eventId}/status`, { status: next })).json()) as EventData;
    },
    onSuccess: (ev) => {
      invalidate();
      setLoadedId(null);
      setDirty(false);
      toast({ title: `Propuesta: ${EVENT_STATUS_LABELS[ev.status]}` });
    },
    onError: (e: Error) => toast({ title: "No se pudo cambiar el estado", description: e.message, variant: "destructive" }),
  });

  const copyMutation = useMutation({
    mutationFn: async (kind: "version" | "duplicate") =>
      (await (await apiRequest("POST", `/api/events/${eventId}/${kind}`)).json()) as EventData,
    onSuccess: (ev, kind) => {
      invalidate();
      toast({ title: kind === "version" ? `Versión ${ev.version} creada` : "Copia creada" });
      setLoadedId(null);
      navigate(`/eventos/${ev.id}`);
    },
    onError: (e: Error) => toast({ title: "No se pudo copiar", description: e.message, variant: "destructive" }),
  });

  const discountLabel =
    discountValue > 0 ? (discountType === "pct" ? `${new Intl.NumberFormat("es-AR").format(discountValue)}%` : null) : null;

  const pdfInput = (): EventPdfInput => ({
    brandName: brandName || organization?.name || "Propuesta",
    name: name || "Evento",
    customerName: customerName || null,
    contactName: contactName || null,
    contactPhone: contactPhone || null,
    contactEmail: contactEmail || null,
    eventDate: eventDate || null,
    eventTime: eventTime || null,
    location: location || null,
    guests: guests || null,
    version: existing?.version ?? 1,
    status: EVENT_STATUS_LABELS[status],
    validUntil: validUntil || null,
    paymentTerms: paymentTerms || null,
    clientNotes: clientNotes || null,
    internalNotes: internalNotes || null,
    ivaMode,
    ivaRate,
    discountLabel,
    items: effectiveItems.map((i) => ({ key: i.key, name: i.name, description: i.description })),
    directCosts: directCosts.map((c) => ({ concept: c.concept, amount: num(c.amount) })),
    fixedCosts: fixedCosts.map((c) => ({
      concept: c.concept,
      amount: num(c.amount),
      detail: c.mode === "promedio" ? `${fmtPct(num(c.sharePct))} de ${formatCurrency(num(c.monthlyAverage))}/mes` : null,
    })),
    totals,
  });

  const canSave = name.trim().length > 0 && effectiveItems.every((i) => i.name.trim().length > 0);

  if (!isNew && loadingEvent) return <Skeleton className="h-64 w-full" />;
  if (!isNew && !loadingEvent && !existing) {
    return (
      <div className="space-y-6">
        <PageHeader title="Eventos" backHref="/eventos" />
        <p className="text-sm text-muted-foreground">Este evento no existe o fue eliminado.</p>
      </div>
    );
  }

  const field = "space-y-1";
  const dis = locked;

  return (
    <div className="space-y-6">
      <PageHeader
        title={isNew ? "Nuevo evento" : name || "Evento"}
        description="Armá la propuesta, costeala y sacá el PDF para el cliente y el detalle interno"
        backHref="/eventos"
      />

      {!isNew && (
        <div className="flex flex-wrap items-center gap-2">
          <Badge className={STATUS_TONE[status]} variant="secondary">
            {EVENT_STATUS_LABELS[status]}
          </Badge>
          {(existing?.version ?? 1) > 1 && <Badge variant="outline">Versión {existing?.version}</Badge>}
          <div className="flex-1" />
          {status === "borrador" && (
            <Button size="sm" variant="outline" onClick={() => changeStatus.mutate("enviada")} disabled={!canSave || changeStatus.isPending}>
              Marcar como enviada
            </Button>
          )}
          {status === "enviada" && (
            <>
              <Button size="sm" variant="outline" onClick={() => changeStatus.mutate("aceptada")}>
                Aceptada
              </Button>
              <Button size="sm" variant="outline" onClick={() => changeStatus.mutate("rechazada")}>
                Rechazada
              </Button>
            </>
          )}
          {status !== "borrador" && (
            <Button size="sm" variant="ghost" onClick={() => changeStatus.mutate("borrador")}>
              <RotateCcw className="h-4 w-4 mr-1" /> Volver a borrador
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => copyMutation.mutate("version")} disabled={copyMutation.isPending}>
            <GitBranch className="h-4 w-4 mr-1" /> Nueva versión
          </Button>
          <Button size="sm" variant="ghost" onClick={() => copyMutation.mutate("duplicate")} disabled={copyMutation.isPending}>
            <Copy className="h-4 w-4 mr-1" /> Duplicar
          </Button>
        </div>
      )}

      {locked && (
        <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-3 flex gap-2 items-start">
          <Lock className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
          <p className="text-sm text-blue-800 dark:text-blue-300">
            Propuesta {EVENT_STATUS_LABELS[status].toLowerCase()}: los costos y precios quedaron congelados como estaban al enviarla.
            Para cambiarla, creá una <span className="font-semibold">nueva versión</span> (la anterior queda de historial) o volvela a
            borrador.
          </p>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2 space-y-6">
          {/* ── Datos del evento ── */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <CalendarDays className="h-4 w-4" /> El evento
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className={`${field} sm:col-span-2 lg:col-span-3`}>
                <Label className="text-xs">Nombre del evento</Label>
                <Input disabled={dis} value={name} onChange={(e) => (setName(e.target.value), mark())} placeholder="Ej: Cena de fin de año — Estudio Pérez" data-testid="input-event-name" />
              </div>
              <div className={field}>
                <Label className="text-xs">Para quién (cliente)</Label>
                <Input disabled={dis} value={customerName} onChange={(e) => (setCustomerName(e.target.value), mark())} />
              </div>
              <div className={field}>
                <Label className="text-xs">Contacto</Label>
                <Input disabled={dis} value={contactName} onChange={(e) => (setContactName(e.target.value), mark())} />
              </div>
              <div className={field}>
                <Label className="text-xs">Teléfono</Label>
                <Input disabled={dis} value={contactPhone} onChange={(e) => (setContactPhone(e.target.value), mark())} />
              </div>
              <div className={field}>
                <Label className="text-xs">Email</Label>
                <Input disabled={dis} type="email" value={contactEmail} onChange={(e) => (setContactEmail(e.target.value), mark())} />
              </div>
              <div className={field}>
                <Label className="text-xs">Fecha</Label>
                <Input disabled={dis} type="date" value={eventDate} onChange={(e) => (setEventDate(e.target.value), mark())} />
              </div>
              <div className={field}>
                <Label className="text-xs">Horario</Label>
                <Input disabled={dis} value={eventTime} onChange={(e) => (setEventTime(e.target.value), mark())} placeholder="Ej: 21 a 02 hs" />
              </div>
              <div className={field}>
                <Label className="text-xs">Lugar</Label>
                <Input disabled={dis} value={location} onChange={(e) => (setLocation(e.target.value), mark())} />
              </div>
              <div className={field}>
                <Label className="text-xs flex items-center gap-1">
                  <Users className="h-3 w-3" /> Invitados
                </Label>
                <QuantityInput disabled={dis} value={guests} onChange={(v) => (setGuests(Math.round(v)), mark())} />
              </div>
              <div className={field}>
                <Label className="text-xs">Validez de la propuesta</Label>
                <Input disabled={dis} type="date" value={validUntil} onChange={(e) => (setValidUntil(e.target.value), mark())} />
              </div>
              <div className={`${field} sm:col-span-2 lg:col-span-2`}>
                <Label className="text-xs flex items-center gap-1">
                  <Building2 className="h-3 w-3" /> Marca que firma la propuesta
                </Label>
                <div className="flex gap-2">
                  <Input disabled={dis} value={brandName} onChange={(e) => (setBrandName(e.target.value), mark())} />
                  {organization?.name && brandName !== organization.name && !dis && (
                    <Button variant="outline" size="sm" className="h-10" onClick={() => (setBrandName(organization.name), mark())}>
                      Usar "{organization.name}"
                    </Button>
                  )}
                </div>
              </div>
              <div className={field}>
                <Label className="text-xs">Local (para los costos fijos)</Label>
                <DataEntryCombobox
                  disabled={dis}
                  options={locals.map((l) => ({ value: String(l.id), label: l.name }))}
                  value={localId}
                  onValueChange={(v) => (setLocalId(v), mark())}
                  emptyOptionLabel="Todos los locales"
                  placeholder="Todos los locales"
                />
              </div>
              <div className={`${field} sm:col-span-2 lg:col-span-3`}>
                <Label className="text-xs">Forma de pago</Label>
                <Input disabled={dis} value={paymentTerms} onChange={(e) => (setPaymentTerms(e.target.value), mark())} placeholder="Ej: 50% de seña para reservar la fecha, saldo 48 hs antes" />
              </div>
              <div className={`${field} sm:col-span-2 lg:col-span-3`}>
                <Label className="text-xs">Observaciones para el cliente (salen en la propuesta)</Label>
                <Textarea disabled={dis} rows={2} value={clientNotes} onChange={(e) => (setClientNotes(e.target.value), mark())} />
              </div>
            </CardContent>
          </Card>

          {/* ── Platos ── */}
          <Card>
            <CardHeader className="pb-3 space-y-3">
              <CardTitle className="text-base flex items-center gap-2">
                <ChefHat className="h-4 w-4" /> Platos y precios
              </CardTitle>
              {!dis && (
                <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                  <DataEntryCombobox options={platoOptions} value="" onValueChange={(v) => v && addRecipe(v)} placeholder="+ Plato de Carta" searchPlaceholder="Buscar plato…" />
                  <DataEntryCombobox
                    options={draftOptions}
                    value=""
                    onValueChange={(v) => v && addDraft(v)}
                    placeholder="+ Receta del Pizarrón"
                    searchPlaceholder="Buscar receta de prueba…"
                    emptyMessage="No hay platos en el Pizarrón."
                  />
                  <Button variant="outline" onClick={addManual}>
                    <Plus className="h-4 w-4 mr-1" /> Ítem manual
                  </Button>
                </div>
              )}
            </CardHeader>
            <CardContent className="space-y-3">
              {items.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">Agregá los platos del evento.</p>
              ) : (
                <>
                  <div className="hidden md:grid grid-cols-[1fr_100px_150px_130px_32px] gap-2 text-xs text-muted-foreground px-1">
                    <span>Plato</span>
                    <span className="text-right">Cantidad</span>
                    <span className="text-right">Precio unit. {ivaMode === "incluido" ? "(c/IVA)" : "(neto)"}</span>
                    <span className="text-right">Total</span>
                    <span />
                  </div>
                  {effectiveItems.map((it) => {
                    const r = totals.items.find((x) => x.key === it.key);
                    const lp = listPrice(it);
                    return (
                      <div key={it.key} className="rounded-lg border p-2 space-y-1.5">
                        <div className="grid grid-cols-2 md:grid-cols-[1fr_100px_150px_130px_32px] gap-2 items-start">
                          <div className="col-span-2 md:col-span-1 flex items-center gap-1.5 min-w-0">
                            {it.sourceType === "draft" && <FlaskConical className="h-3.5 w-3.5 text-muted-foreground shrink-0" aria-label="Del Pizarrón" />}
                            <Input
                              disabled={dis}
                              value={it.name}
                              onChange={(e) => setItem(it.key, { name: e.target.value })}
                              placeholder="Nombre del plato"
                              className="h-9"
                              data-testid="input-event-item-name"
                            />
                          </div>
                          <QuantityInput disabled={dis} value={it.quantity} onChange={(v) => setItem(it.key, { quantity: v })} />
                          <div className="space-y-0.5">
                            <QuantityInput disabled={dis} value={it.unitPrice} onChange={(v) => setItem(it.key, { unitPrice: v })} unit="$" />
                            {lp != null && Math.abs(lp - it.unitPrice) > 0.01 && !dis && (
                              <button type="button" className="text-[10px] text-primary hover:underline" onClick={() => setItem(it.key, { unitPrice: Math.round(lp * 100) / 100 })}>
                                Volver al de Carta: {formatCurrency(lp)}
                              </button>
                            )}
                          </div>
                          <div className="text-right font-mono text-sm font-semibold leading-9">{formatCurrency(r?.lineShown ?? 0)}</div>
                          {!dis ? (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-9 w-8 text-muted-foreground"
                              onClick={() => (setItems((prev) => prev.filter((x) => x.key !== it.key)), mark())}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          ) : (
                            <span />
                          )}
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2 items-center">
                          <Input
                            disabled={dis}
                            value={it.description ?? ""}
                            onChange={(e) => setItem(it.key, { description: e.target.value })}
                            placeholder="Descripción para el cliente (opcional)"
                            className="h-8 text-xs"
                          />
                          <div className="flex items-center gap-2 justify-end text-xs text-muted-foreground whitespace-nowrap">
                            <span>Costo unit.</span>
                            {it.sourceType === "manual" ? (
                              <div className="w-32">
                                <QuantityInput disabled={dis} value={it.unitCost} onChange={(v) => setItem(it.key, { unitCost: v })} unit="$" className="h-8 text-xs" />
                              </div>
                            ) : (
                              <span className="font-mono text-foreground">{formatCurrency(it.unitCost)}</span>
                            )}
                            <span>· CMV</span>
                            <span className="font-mono text-foreground">{fmtPct(r?.cmvPct)}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {!dis && guests > 0 && (
                    <button
                      type="button"
                      className="text-xs text-primary hover:underline"
                      onClick={() => (setItems((prev) => prev.map((i) => ({ ...i, quantity: guests }))), mark())}
                    >
                      Poner {guests} (los invitados) como cantidad de todos
                    </button>
                  )}
                </>
              )}

              <Separator />
              <div className="grid gap-4 sm:grid-cols-3">
                <div className={field}>
                  <Label className="text-xs">IVA</Label>
                  <DataEntryCombobox
                    disabled={dis}
                    options={(Object.keys(EVENT_IVA_MODE_LABELS) as EventIvaMode[]).map((m) => ({ value: m, label: EVENT_IVA_MODE_LABELS[m] }))}
                    value={ivaMode}
                    onValueChange={(v) => v && changeIvaMode(v as EventIvaMode)}
                  />
                </div>
                {ivaMode !== "sin_iva" && (
                  <div className={field}>
                    <Label className="text-xs">Alícuota de IVA</Label>
                    <QuantityInput disabled={dis} value={ivaRate} onChange={(v) => (setIvaRate(v), mark())} unit="%" />
                  </div>
                )}
                <div className={field}>
                  <Label className="text-xs">Descuento al total</Label>
                  <div className="flex gap-1">
                    <DataEntryCombobox
                      disabled={dis}
                      options={[
                        { value: "pct", label: "%" },
                        { value: "amount", label: "$" },
                      ]}
                      value={discountType}
                      onValueChange={(v) => (setDiscountType(v === "amount" ? "amount" : "pct"), mark())}
                      triggerClassName="w-20"
                    />
                    <QuantityInput disabled={dis} value={discountValue} onChange={(v) => (setDiscountValue(v), mark())} />
                  </div>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">
                El descuento se aplica sobre el neto (sin IVA) y después se calculan el IVA y los impuestos.
                {discountType === "amount" && ivaMode === "incluido" && " El monto en $ se carga con IVA, como los precios."}
              </p>
            </CardContent>
          </Card>

          {/* ── Impuestos ── */}
          <Card>
            <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0 gap-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Percent className="h-4 w-4" /> Otros impuestos
              </CardTitle>
              {!dis && (
                <div className="flex gap-2">
                  <DataEntryCombobox
                    options={taxOptions}
                    value=""
                    onValueChange={(v) => {
                      const tx = taxCatalog.find((t) => String(t.id) === v);
                      if (!tx) return;
                      setTaxes((p) => [...p, { key: newKey(), name: tx.name, taxId: tx.id, mode: "pct", rate: num(tx.percentage), chargedToClient: false }]);
                      mark();
                    }}
                    placeholder="+ Del catálogo"
                    searchPlaceholder="Buscar impuesto…"
                    triggerClassName="w-44"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-10"
                    onClick={() => (setTaxes((p) => [...p, { key: newKey(), name: "", mode: "pct", rate: 0, chargedToClient: false }]), mark())}
                  >
                    <Plus className="h-4 w-4 mr-1" /> Manual
                  </Button>
                </div>
              )}
            </CardHeader>
            <CardContent className="space-y-2">
              {taxes.length === 0 ? (
                <p className="text-xs text-muted-foreground">Ingresos Brutos, tasas municipales, etc. El IVA ya se calcula arriba.</p>
              ) : (
                taxes.map((tx) => (
                  <div key={tx.key} className="grid grid-cols-2 sm:grid-cols-[1fr_80px_120px_auto_32px] gap-2 items-center">
                    <Input disabled={dis} className="col-span-2 sm:col-span-1" value={tx.name} placeholder="Nombre" onChange={(e) => (setTaxes((p) => p.map((x) => (x.key === tx.key ? { ...x, name: e.target.value } : x))), mark())} />
                    <DataEntryCombobox
                      disabled={dis}
                      options={[
                        { value: "pct", label: "%" },
                        { value: "amount", label: "$" },
                      ]}
                      value={tx.mode}
                      onValueChange={(v) => (setTaxes((p) => p.map((x) => (x.key === tx.key ? { ...x, mode: v === "amount" ? "amount" : "pct" } : x))), mark())}
                    />
                    <QuantityInput
                      disabled={dis}
                      value={tx.mode === "pct" ? tx.rate ?? 0 : tx.amount ?? 0}
                      unit={tx.mode === "pct" ? "%" : "$"}
                      onChange={(v) => (setTaxes((p) => p.map((x) => (x.key === tx.key ? (x.mode === "pct" ? { ...x, rate: v } : { ...x, amount: v }) : x))), mark())}
                    />
                    <label className="flex items-center gap-2 text-xs whitespace-nowrap">
                      <Switch
                        disabled={dis}
                        checked={tx.chargedToClient}
                        onCheckedChange={(c) => (setTaxes((p) => p.map((x) => (x.key === tx.key ? { ...x, chargedToClient: c } : x))), mark())}
                      />
                      {tx.chargedToClient ? "Se le cobra al cliente" : "Lo paga la empresa"}
                    </label>
                    {!dis && (
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground" onClick={() => (setTaxes((p) => p.filter((x) => x.key !== tx.key)), mark())}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          {/* ── Costos ── */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Receipt className="h-4 w-4" /> Costos del evento (no los ve el cliente)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">Costos directos</p>
                  {!dis && (
                    <Button size="sm" variant="outline" onClick={() => (setDirectCosts((p) => [...p, { key: newKey(), concept: "", amount: 0 }]), mark())}>
                      <Plus className="h-4 w-4 mr-1" /> Agregar
                    </Button>
                  )}
                </div>
                {directCosts.length === 0 && (
                  <p className="text-xs text-muted-foreground">Personal extra, flete, alquiler de vajilla, descartables, decoración…</p>
                )}
                {directCosts.map((c) => (
                  <div key={c.key} className="grid grid-cols-[1fr_150px_32px] gap-2">
                    <Input disabled={dis} value={c.concept} placeholder="Concepto" onChange={(e) => (setDirectCosts((p) => p.map((x) => (x.key === c.key ? { ...x, concept: e.target.value } : x))), mark())} />
                    <QuantityInput disabled={dis} value={c.amount} unit="$" onChange={(v) => (setDirectCosts((p) => p.map((x) => (x.key === c.key ? { ...x, amount: v } : x))), mark())} />
                    {!dis ? (
                      <Button size="icon" variant="ghost" className="h-9 w-8 text-muted-foreground" onClick={() => (setDirectCosts((p) => p.filter((x) => x.key !== c.key)), mark())}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    ) : (
                      <span />
                    )}
                  </div>
                ))}
              </div>

              <Separator />

              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">Costos fijos asignados</p>
                  {!dis && (
                    <div className="flex flex-wrap gap-2 items-center">
                      <DataEntryCombobox
                        options={[1, 3, 6, 12].map((m) => ({ value: String(m), label: `Promedio ${m === 1 ? "último mes" : `últimos ${m} meses`}` }))}
                        value={String(avgMonths)}
                        onValueChange={(v) => setAvgMonths(parseInt(v, 10) || 3)}
                        triggerClassName="w-48"
                      />
                      <DataEntryCombobox
                        options={fixedOptions}
                        value=""
                        onValueChange={(v) => v && addFixedFromAverage(v)}
                        placeholder={loadingAvg ? "Calculando…" : "+ Grupo o categoría"}
                        searchPlaceholder="Buscar grupo o categoría…"
                        emptyMessage="No hay gastos en esos meses."
                        triggerClassName="w-56"
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-10"
                        onClick={() => (setFixedCosts((p) => [...p, { key: newKey(), concept: "", mode: "manual", amount: 0 }]), mark())}
                      >
                        <Plus className="h-4 w-4 mr-1" /> Manual
                      </Button>
                    </div>
                  )}
                </div>
                {fixedCosts.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    Elegí un grupo o categoría financiera: el sistema trae su gasto mensual promedio real y vos decidís qué porción le
                    asignás al evento (por defecto 1 día de 30).
                  </p>
                )}
                {fixedCosts.map((f) => (
                  <div key={f.key} className="rounded-lg border p-2 space-y-2">
                    <div className="grid grid-cols-[1fr_32px] gap-2">
                      <Input disabled={dis} value={f.concept} placeholder="Concepto" onChange={(e) => setFixed(f.key, { concept: e.target.value })} />
                      {!dis ? (
                        <Button size="icon" variant="ghost" className="h-9 w-8 text-muted-foreground" onClick={() => (setFixedCosts((p) => p.filter((x) => x.key !== f.key)), mark())}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      ) : (
                        <span />
                      )}
                    </div>
                    {f.mode === "promedio" ? (
                      <div className="grid gap-2 sm:grid-cols-3 items-end">
                        <div className={field}>
                          <Label className="text-[11px]">Promedio mensual{f.months ? ` (${f.months} m)` : ""}</Label>
                          <QuantityInput disabled={dis} value={num(f.monthlyAverage)} unit="$" onChange={(v) => setFixed(f.key, { monthlyAverage: v })} />
                        </div>
                        <div className={field}>
                          <Label className="text-[11px]">Porción para el evento</Label>
                          <QuantityInput disabled={dis} value={num(f.sharePct)} unit="%" onChange={(v) => setFixed(f.key, { sharePct: v })} />
                        </div>
                        <div className="text-right">
                          <p className="text-[11px] text-muted-foreground">Asignado</p>
                          <p className="font-mono font-medium leading-9">{formatCurrency(f.amount)}</p>
                        </div>
                        {!dis && (
                          <div className="sm:col-span-3 flex flex-wrap gap-2 text-[11px]">
                            {[
                              { l: "1 día", v: 100 / 30 },
                              { l: "2 días", v: 200 / 30 },
                              { l: "1 semana", v: 700 / 30 },
                              { l: "Medio mes", v: 50 },
                            ].map((o) => (
                              <button key={o.l} type="button" className="text-primary hover:underline" onClick={() => setFixed(f.key, { sharePct: Math.round(o.v * 100) / 100 })}>
                                {o.l}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : (
                      <QuantityInput disabled={dis} value={f.amount} unit="$" onChange={(v) => setFixed(f.key, { amount: v })} />
                    )}
                  </div>
                ))}
              </div>

              <Separator />
              <div className={field}>
                <Label className="text-xs">Notas internas (solo en el detalle interno)</Label>
                <Textarea disabled={dis} rows={2} value={internalNotes} onChange={(e) => (setInternalNotes(e.target.value), mark())} />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ── Resumen ── */}
        <div className="space-y-6">
          <Card className="xl:sticky xl:top-4">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Resumen</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5 text-sm">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Lo que ve el cliente</p>
                <Row label="Subtotal" value={formatCurrency(totals.subtotalShown)} />
                {totals.discountNet > 0.004 && (
                  <Row label={`Descuento${discountLabel ? ` (${discountLabel})` : ""}`} value={`- ${formatCurrency(totals.discountShown)}`} tone="good" />
                )}
                {ivaMode === "discriminado" && <Row label={`IVA ${new Intl.NumberFormat("es-AR").format(ivaRate)}%`} value={formatCurrency(totals.iva)} />}
                {totals.taxes.filter((t) => t.chargedToClient).map((t) => (
                  <Row key={t.key} label={t.label} value={formatCurrency(t.amount)} />
                ))}
                <div className="flex justify-between items-baseline pt-1 border-t">
                  <span className="font-semibold">Total</span>
                  <span className="text-xl font-bold font-mono" data-testid="text-event-total">
                    {formatCurrency(totals.totalClient)}
                  </span>
                </div>
                {totals.perGuest != null && <Row label="Por persona" value={formatCurrency(totals.perGuest)} muted />}
                {ivaMode === "incluido" && <Row label="IVA contenido" value={formatCurrency(totals.iva)} muted />}
              </div>

              <Separator />

              <div className="space-y-1.5 text-sm">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Para nosotros</p>
                <Row label="Venta neta (sin IVA)" value={formatCurrency(totals.netAfterDiscount)} />
                <Row label={`CMV (${fmtPct(totals.cmvPct)})`} value={`- ${formatCurrency(totals.cmv)}`} />
                <Row label="Margen bruto" value={formatCurrency(totals.grossMargin)} />
                {totals.directCosts > 0 && <Row label="Costos directos" value={`- ${formatCurrency(totals.directCosts)}`} />}
                {totals.fixedCosts > 0 && <Row label="Costos fijos" value={`- ${formatCurrency(totals.fixedCosts)}`} />}
                {totals.internalTaxes > 0 && <Row label="Impuestos a cargo" value={`- ${formatCurrency(totals.internalTaxes)}`} />}
                <div className="flex justify-between items-baseline pt-1 border-t">
                  <span className="font-semibold">Utilidad</span>
                  <span className={`text-xl font-bold font-mono ${totals.profit >= 0 ? "text-emerald-600 dark:text-emerald-500" : "text-destructive"}`}>
                    {formatCurrency(totals.profit)}
                  </span>
                </div>
                <Row label="Margen sobre la venta" value={fmtPct(totals.profitPct)} tone={totals.profit >= 0 ? "good" : "bad"} />
                {totals.costPerGuest != null && <Row label="Costo por persona" value={formatCurrency(totals.costPerGuest)} muted />}
                <div className="rounded-md bg-muted/50 p-2 text-xs mt-2">
                  {totals.maxDiscountNet == null ? (
                    "Agregá platos para ver el margen de negociación."
                  ) : totals.maxDiscountNet < 0 ? (
                    <span className="text-destructive">Con estos costos el evento pierde plata aun sin descuento.</span>
                  ) : (
                    <>
                      Podés descontar hasta <span className="font-semibold font-mono">{formatCurrency(totals.maxDiscountNet)}</span> (
                      {fmtPct(totals.maxDiscountPct)} del neto) sin perder plata.
                    </>
                  )}
                </div>
              </div>

              <Separator />

              <div className="flex flex-col gap-2">
                {!locked && (
                  <Button onClick={() => save.mutate()} disabled={!canSave || save.isPending} data-testid="button-save-event">
                    {save.isPending ? "Guardando…" : dirty || isNew ? "Guardar propuesta" : "Guardado"}
                  </Button>
                )}
                <Button
                  variant="outline"
                  disabled={items.length === 0}
                  onClick={() => buildEventProposalPdf(pdfInput()).save(eventPdfFileName("propuesta", name || "evento", existing?.version ?? 1))}
                  data-testid="button-event-pdf-client"
                >
                  <FileDown className="h-4 w-4 mr-1.5" /> PDF para el cliente
                </Button>
                <Button
                  variant="outline"
                  disabled={items.length === 0}
                  onClick={() => buildEventInternalPdf(pdfInput()).save(eventPdfFileName("interno", name || "evento", existing?.version ?? 1))}
                  data-testid="button-event-pdf-internal"
                >
                  <FileLock2 className="h-4 w-4 mr-1.5" /> PDF detalle interno
                </Button>
                {!canSave && <p className="text-xs text-muted-foreground">Para guardar: el nombre del evento y todos los platos con nombre.</p>}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, tone, muted }: { label: string; value: string; tone?: "good" | "bad"; muted?: boolean }) {
  const toneClass = tone === "good" ? "text-emerald-600 dark:text-emerald-500" : tone === "bad" ? "text-destructive" : muted ? "text-muted-foreground" : "";
  return (
    <div className={`flex justify-between gap-2 ${muted ? "text-xs" : ""}`}>
      <span className={muted ? "text-muted-foreground" : ""}>{label}</span>
      <span className={`font-mono ${toneClass}`}>{value}</span>
    </div>
  );
}
