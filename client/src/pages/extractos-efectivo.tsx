import { useState } from "react";
import { Receipt, Banknote } from "lucide-react";
import { cn } from "@/lib/utils";
import BankStatementsPage from "@/pages/bank-statements";
import CashPage from "@/pages/cash";

type View = "extractos" | "efectivo";

/**
 * Punto 1 (jul-27): módulo unificado "Extractos/Efectivo". Un selector arriba alterna entre
 * la vista de Extractos (bancos, columna Cuenta) y la de Efectivo (columna Caja). Cada vista
 * conserva su lógica, filtros y columnas propias; solo se monta la seleccionada.
 */
export default function ExtractosEfectivoPage() {
  const [view, setView] = useState<View>("extractos");

  const tabs: { id: View; label: string; icon: typeof Receipt }[] = [
    { id: "extractos", label: "Extractos", icon: Receipt },
    { id: "efectivo", label: "Efectivo", icon: Banknote },
  ];

  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-lg border bg-muted/40 p-1" role="tablist" aria-label="Extractos o Efectivo">
        {tabs.map((t) => {
          const Icon = t.icon;
          const active = view === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setView(t.id)}
              data-testid={`tab-${t.id}`}
              className={cn(
                "inline-flex items-center gap-2 rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
                active
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {view === "extractos" ? <BankStatementsPage /> : <CashPage />}
    </div>
  );
}
