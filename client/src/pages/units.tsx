/**
 * Unidades de Medida — catálogo CERRADO (sep-2026).
 *
 * Son tres y no se tocan: Kilogramos (Kg), Litros (Lt) y Unidad (Und). Antes cada empresa creaba
 * las suyas y la misma mercadería terminaba cargada en escalas distintas (Gramos acá, Mililitros
 * allá), con lo cual los costos no eran comparables entre locales ni entre empresas.
 *
 * La pantalla quedó de solo lectura, pero la regla la sostiene el servidor: `POST`, `PATCH` y
 * `DELETE` sobre `/api/units` responden 403.
 */
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Scale, Lock } from "lucide-react";
import type { UnitOfMeasure } from "@shared/schema";

/** Qué se carga con cada una, en criollo. */
const AYUDA: Record<string, string> = {
  Kg: "Todo lo que se pesa: carnes, harinas, quesos, verduras. Se carga con coma — 1,125 Kg, no 1125 gramos.",
  Lt: "Todo lo que se mide por volumen: aceites, bebidas, salsas. También con coma — 0,75 Lt, no 750 mililitros.",
  Und: "Todo lo que se cuenta de a uno: huevos, panes, botellas, latas.",
};

export default function UnitsPage() {
  const { data: units = [], isLoading } = useQuery<UnitOfMeasure[]>({
    queryKey: ["/api/units"],
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Unidades de Medida"
        description="Las tres unidades con las que se cargan todos los insumos"
      />

      <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 flex gap-2 items-start">
        <Lock className="h-4 w-4 text-amber-600 dark:text-amber-500 mt-0.5 shrink-0" />
        <p className="text-sm text-amber-700 dark:text-amber-400">
          Este catálogo es fijo: no se crean, no se editan y no se eliminan unidades. Tener una sola
          escala para toda la empresa es lo que permite comparar costos entre locales y entre recetas.
        </p>
      </div>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-28 w-full" />)}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-3">
          {units.map((u) => (
            <Card key={u.id} data-testid={`card-unit-${u.abbreviation}`}>
              <CardContent className="pt-6 space-y-2">
                <div className="flex items-center gap-2">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                    <Scale className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium leading-tight">{u.name}</p>
                    <Badge variant="secondary" className="font-mono text-xs mt-0.5">{u.abbreviation}</Badge>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  {AYUDA[u.abbreviation] ?? "Unidad de medida de insumos."}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
