import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
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
import type { Supplier } from "@shared/schema";

const ivaOptions = [
  { value: "responsable_inscripto", label: "Responsable Inscripto" },
  { value: "monotributista", label: "Monotributista" },
  { value: "exento", label: "Exento" },
  { value: "consumidor_final", label: "Consumidor Final" },
];

const formSchema = z.object({
  tradeName: z.string().min(1, "El nombre comercial es requerido"),
  cuit: z.string().optional(),
  ivaCondition: z.string().default("responsable_inscripto"),
});

type FormData = z.infer<typeof formSchema>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (supplier: Supplier) => void;
}

export function QuickCreateSupplierDialog({ open, onOpenChange, onCreated }: Props) {
  const { toast } = useToast();

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: { tradeName: "", cuit: "", ivaCondition: "responsable_inscripto" },
  });

  const mutation = useMutation({
    mutationFn: async (data: FormData) => {
      const res = await apiRequest("POST", "/api/suppliers", data);
      return res.json() as Promise<Supplier>;
    },
    onSuccess: (supplier) => {
      queryClient.invalidateQueries({ queryKey: ["/api/suppliers"] });
      toast({ title: `Proveedor "${supplier.tradeName}" creado` });
      form.reset();
      onOpenChange(false);
      onCreated(supplier);
    },
    onError: (e: Error) => {
      toast({ title: "Error al crear proveedor", description: e.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) form.reset(); onOpenChange(o); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Nuevo Proveedor</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit((d) => mutation.mutate(d))} className="space-y-4">
            <FormField control={form.control} name="tradeName" render={({ field }) => (
              <FormItem>
                <FormLabel>Nombre Comercial *</FormLabel>
                <FormControl>
                  <Input {...field} placeholder="Ej: Distribuidora Norte" autoFocus />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="cuit" render={({ field }) => (
              <FormItem>
                <FormLabel>CUIT</FormLabel>
                <FormControl>
                  <Input {...field} placeholder="20-12345678-9" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="ivaCondition" render={({ field }) => (
              <FormItem>
                <FormLabel>Condición IVA</FormLabel>
                <FormControl>
                  <DataEntryCombobox
                    options={ivaOptions}
                    value={field.value}
                    onValueChange={field.onChange}
                    placeholder="Seleccionar"
                    searchPlaceholder="Buscar..."
                  />
                </FormControl>
              </FormItem>
            )} />

            <DialogFooter className="gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => { form.reset(); onOpenChange(false); }}>
                Cancelar
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? "Guardando..." : "Crear Proveedor"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
