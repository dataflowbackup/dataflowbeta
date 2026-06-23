import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { DataEntryCombobox } from "@/components/data-entry-combobox";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Supply, Rubro, SubRubro, UnitOfMeasure } from "@shared/schema";

const formSchema = z.object({
  name: z.string().min(1, "El nombre del insumo es requerido"),
  rubroId: z.coerce.number().optional(),
  subRubroId: z.coerce.number().optional(),
  unitOfMeasureId: z.coerce.number().optional(),
});

type FormData = z.infer<typeof formSchema>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (supply: Supply) => void;
  initialName?: string;
}

export function QuickCreateSupplyDialog({ open, onOpenChange, onCreated, initialName }: Props) {
  const { toast } = useToast();

  const { data: rubros = [] } = useQuery<Rubro[]>({ queryKey: ["/api/rubros"] });
  const { data: subRubros = [] } = useQuery<SubRubro[]>({ queryKey: ["/api/sub-rubros"] });
  const { data: units = [] } = useQuery<UnitOfMeasure[]>({ queryKey: ["/api/units"] });

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: initialName ?? "", rubroId: undefined, subRubroId: undefined, unitOfMeasureId: undefined },
  });

  useEffect(() => {
    if (open && initialName) form.setValue("name", initialName);
  }, [open, initialName, form]);

  const watchRubroId = form.watch("rubroId");

  const filteredSubRubros = watchRubroId
    ? subRubros.filter((s) => s.rubroId === watchRubroId)
    : subRubros;

  const rubroOptions = rubros.map((r) => ({ value: String(r.id), label: r.name }));
  const subRubroOptions = filteredSubRubros.map((s) => ({ value: String(s.id), label: s.name }));
  const unitOptions = units.map((u) => ({ value: String(u.id), label: `${u.name} (${u.abbreviation})` }));

  const mutation = useMutation({
    mutationFn: async (data: FormData) => {
      const res = await apiRequest("POST", "/api/supplies", data);
      return res.json() as Promise<Supply>;
    },
    onSuccess: (supply) => {
      queryClient.invalidateQueries({ queryKey: ["/api/supplies"] });
      toast({ title: `Insumo "${supply.name}" creado` });
      form.reset();
      onOpenChange(false);
      onCreated(supply);
    },
    onError: (e: Error) => {
      toast({ title: "Error al crear insumo", description: e.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) form.reset(); onOpenChange(o); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Nuevo Insumo</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit((d) => mutation.mutate(d))} className="space-y-4">
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem>
                <FormLabel>Nombre del Insumo *</FormLabel>
                <FormControl>
                  <Input {...field} placeholder="Ej: Harina 000" autoFocus />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="rubroId" render={({ field }) => (
              <FormItem>
                <FormLabel>Rubro</FormLabel>
                <FormControl>
                  <DataEntryCombobox
                    options={rubroOptions}
                    value={field.value != null ? String(field.value) : ""}
                    onValueChange={(v) => {
                      field.onChange(v === "" ? undefined : parseInt(v, 10));
                      form.setValue("subRubroId", undefined);
                    }}
                    placeholder="Sin rubro"
                    searchPlaceholder="Buscar rubro..."
                    emptyOptionLabel="Sin rubro"
                  />
                </FormControl>
              </FormItem>
            )} />

            {filteredSubRubros.length > 0 && (
              <FormField control={form.control} name="subRubroId" render={({ field }) => (
                <FormItem>
                  <FormLabel>Sub-Rubro</FormLabel>
                  <FormControl>
                    <DataEntryCombobox
                      options={subRubroOptions}
                      value={field.value != null ? String(field.value) : ""}
                      onValueChange={(v) => field.onChange(v === "" ? undefined : parseInt(v, 10))}
                      placeholder="Sin sub-rubro"
                      searchPlaceholder="Buscar sub-rubro..."
                      emptyOptionLabel="Sin sub-rubro"
                    />
                  </FormControl>
                </FormItem>
              )} />
            )}

            <FormField control={form.control} name="unitOfMeasureId" render={({ field }) => (
              <FormItem>
                <FormLabel>Unidad de Medida</FormLabel>
                <FormControl>
                  <DataEntryCombobox
                    options={unitOptions}
                    value={field.value != null ? String(field.value) : ""}
                    onValueChange={(v) => field.onChange(v === "" ? undefined : parseInt(v, 10))}
                    placeholder="Sin unidad"
                    searchPlaceholder="Buscar unidad..."
                    emptyOptionLabel="Sin unidad"
                  />
                </FormControl>
              </FormItem>
            )} />

            <DialogFooter className="gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => { form.reset(); onOpenChange(false); }}>
                Cancelar
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? "Guardando..." : "Crear Insumo"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
