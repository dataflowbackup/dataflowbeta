import { SelectGroup, SelectItem, SelectLabel } from "@/components/ui/select";
import type { TransactionCategory, FinancialGroup } from "@shared/schema";

/**
 * Opciones de categoría para los diálogos de préstamo interno y de división entre locales.
 *
 * Se ofrecen TODAS las categorías activas —ventas, gastos y movimientos financieros (Retiros,
 * Préstamos, Aportes…)—, agrupadas por grupo financiero. Antes cada diálogo filtraba por la
 * dirección del movimiento y escondía las especiales, así que categorías como "Retiros" no
 * aparecían nunca. La categoría es una etiqueta: no cambia el `type` de los movimientos que se
 * generan (siempre heredan el del original) y por lo tanto no mueve ningún saldo.
 */

export interface CategoryOptionGroup {
  label: string;
  cats: TransactionCategory[];
}

const MOVIMIENTOS_FINANCIEROS_GROUP_TYPE = "movimientos_financieros";

/**
 * @param preferredType dirección del movimiento que se está cargando: sus grupos van primero,
 *                      después los de la otra dirección y al final Movimientos Financieros.
 */
export function buildCategoryOptionGroups(
  categories: TransactionCategory[],
  financialGroups: FinancialGroup[],
  preferredType: "income" | "expense",
): CategoryOptionGroup[] {
  const active = categories.filter((c) => c.active !== false);
  const groupById = new Map(financialGroups.map((g) => [g.id, g]));
  const byGroup = new Map<string, { label: string; rank: number; cats: TransactionCategory[] }>();

  const rankOf = (groupType: string | undefined) => {
    if (groupType === MOVIMIENTOS_FINANCIEROS_GROUP_TYPE) return 3;
    if (groupType === preferredType) return 0;
    if (groupType === "income" || groupType === "expense") return 1;
    return 2; // sin grupo, o grupo de un tipo que no conocemos
  };

  for (const c of active) {
    const g = c.financialGroupId != null ? groupById.get(c.financialGroupId) : undefined;
    const key = g ? String(g.id) : "__none__";
    if (!byGroup.has(key)) {
      byGroup.set(key, { label: g?.name ?? "Sin grupo", rank: rankOf(g?.type), cats: [] });
    }
    byGroup.get(key)!.cats.push(c);
  }

  return Array.from(byGroup.values())
    .map((g) => ({
      ...g,
      cats: [...g.cats].sort((a, b) => String(a.name).localeCompare(String(b.name), "es")),
    }))
    .sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label, "es"));
}

export function CategorySelectOptions({ groups }: { groups: CategoryOptionGroup[] }) {
  return (
    <>
      {groups.map((g, i) => (
        <SelectGroup key={`${g.label}-${i}`}>
          <SelectLabel>{g.label}</SelectLabel>
          {g.cats.map((c) => (
            <SelectItem key={c.id} value={String(c.id)}>
              {c.name}
            </SelectItem>
          ))}
        </SelectGroup>
      ))}
    </>
  );
}
