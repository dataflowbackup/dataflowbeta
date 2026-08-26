import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/hooks/usePermissions";
import { useSalesSources, SALES_SOURCES_QUERY_KEY } from "@/hooks/useSalesSources";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { AlertCircle, Save, Settings } from "lucide-react";
import {
  SALES_SOURCES,
  SALES_SOURCE_LABELS,
  hasAtLeastOneSalesSource,
  type SalesSourcePreferences,
} from "@shared/salesSources";

const SOURCE_DESCRIPTIONS: Record<(typeof SALES_SOURCES)[number], string> = {
  fudo: "Ventas importadas del Excel de Fudo.",
  shares: "Ventas importadas del Excel de Shares.",
  datalive: "Ventas brutas del resumen diario de Datalive.",
};

/**
 * Punto 6 (ago-26): preferencias de la EMPRESA.
 *
 * Por ahora define que sistemas de venta usa el cliente. Lo que se apaga aca desaparece
 * del menu lateral y deja de ofrecerse como origen en Dashboard, Estado de Resultado
 * Economico, CMV, CMC y PAP, para todos los usuarios de la empresa.
 *
 * Apagar un sistema no borra nada de lo ya importado: si se vuelve a encender, aparece
 * igual que antes.
 */
export default function PreferencesPage() {
  const { toast } = useToast();
  const { isSocio, isLoading: permsLoading } = usePermissions();
  const { preferences, isLoading } = useSalesSources();

  const [draft, setDraft] = useState<SalesSourcePreferences>(preferences);
  const [dirty, setDirty] = useState(false);

  // Mientras no haya cambios sin guardar, el borrador sigue a lo que dice el servidor.
  useEffect(() => {
    if (!dirty) setDraft(preferences);
  }, [preferences.fudo, preferences.shares, preferences.datalive, dirty]);

  const saveMut = useMutation({
    mutationFn: async (next: SalesSourcePreferences) => {
      const res = await apiRequest("PUT", "/api/preferences/sales-sources", next);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [SALES_SOURCES_QUERY_KEY] });
      setDirty(false);
      toast({ title: "Preferencias guardadas" });
    },
    onError: (e: Error) =>
      toast({ title: "No se pudieron guardar", description: e.message, variant: "destructive" }),
  });

  const toggle = (key: (typeof SALES_SOURCES)[number], value: boolean) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  };

  const noneSelected = !hasAtLeastOneSalesSource(draft);
  const canEdit = isSocio;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Preferencias"
        description="Configuracion de la empresa: vale para todos sus usuarios"
        actions={
          <Button
            onClick={() => saveMut.mutate(draft)}
            disabled={!canEdit || !dirty || noneSelected || saveMut.isPending}
            data-testid="button-save-preferences"
          >
            <Save className="h-4 w-4 mr-2" />
            {saveMut.isPending ? "Guardando..." : "Guardar"}
          </Button>
        }
      />

      {!permsLoading && !canEdit && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Solo el socio puede cambiar las preferencias de la empresa. Podes ver como estan
            configuradas, pero no modificarlas.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Settings className="h-4 w-4" />
            Sistemas de ventas
          </CardTitle>
          <CardDescription>
            Elegi con que sistemas trabaja la empresa. Los que apagues dejan de aparecer en el
            menu y de ofrecerse como origen de ventas en Dashboard, Estado de Resultado Economico,
            CMV, CMC y PAP. No se borra nada de lo ya importado: si volves a encenderlo, aparece
            igual que antes.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <>
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </>
          ) : (
            <>
              {SALES_SOURCES.map((key) => (
                <div
                  key={key}
                  className="flex items-center justify-between gap-4 rounded-lg border p-3"
                >
                  <div className="min-w-0">
                    <Label htmlFor={`sales-source-${key}`} className="text-sm font-medium">
                      {SALES_SOURCE_LABELS[key]}
                    </Label>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {SOURCE_DESCRIPTIONS[key]}
                    </p>
                  </div>
                  <Switch
                    id={`sales-source-${key}`}
                    checked={draft[key]}
                    onCheckedChange={(value) => toggle(key, value)}
                    disabled={!canEdit || saveMut.isPending}
                    data-testid={`switch-sales-source-${key}`}
                  />
                </div>
              ))}

              {noneSelected && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    Tiene que quedar al menos un sistema encendido: si no, las pantallas de ventas
                    se quedan sin ningun origen para mostrar.
                  </AlertDescription>
                </Alert>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
