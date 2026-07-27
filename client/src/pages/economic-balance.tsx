import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { LineChart } from "lucide-react";

export default function EconomicBalancePage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Balances Económicos"
        description="Análisis económico por local y período"
      />

      <Card>
        <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center text-muted-foreground">
          <LineChart className="h-10 w-10 opacity-50" />
          <p className="text-sm">Este módulo está en construcción.</p>
        </CardContent>
      </Card>
    </div>
  );
}
