export function formatCurrency(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return "$0.00";
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "$0.00";
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

export function formatNumber(value: number | string | null | undefined, decimals = 2): string {
  if (value === null || value === undefined) return "0";
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "0";
  return new Intl.NumberFormat("es-AR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(num);
}

/** Miles con punto y decimales con coma, mientras se escribe (máx. 2 decimales). */
export function formatEsArAmountInput(raw: string): string {
  if (raw === "") return "";
  const noDots = raw.replace(/\s/g, "").replace(/\./g, "");
  const only = noDots.replace(/[^\d,]/g, "");
  const commaIdx = only.indexOf(",");
  let intPart: string;
  let decPart: string;
  if (commaIdx === -1) {
    intPart = only;
    decPart = "";
  } else {
    intPart = only.slice(0, commaIdx);
    decPart = only.slice(commaIdx + 1).replace(/,/g, "");
  }
  decPart = decPart.slice(0, 2);
  intPart = intPart.replace(/^0+(?=\d)/, "");
  if (intPart === "" && decPart !== "") intPart = "0";
  if (intPart === "" && commaIdx !== -1 && decPart === "") return "0,";
  const grouped =
    intPart === "" ? "" : intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  if (commaIdx !== -1) {
    if (decPart.length > 0) {
      return grouped === "" ? `0,${decPart}` : `${grouped},${decPart}`;
    }
    return grouped === "" ? "0," : `${grouped},`;
  }
  return grouped;
}

/** Convierte valor del input es-AR a número (NaN si inválido). */
export function parseEsArAmount(value: string): number {
  const t = value.trim();
  if (!t) return NaN;
  return parseFloat(t.replace(/\./g, "").replace(",", "."));
}

export function formatPercentage(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return "0%";
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "0%";
  return `${formatNumber(num, 2)}%`;
}

export function formatDate(date: string | Date | null | undefined): string {
  if (!date) return "-";
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);
}

export function formatDateInput(date: string | Date | null | undefined): string {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toISOString().split("T")[0];
}

export function formatCuit(cuit: string | null | undefined): string {
  if (!cuit) return "-";
  const clean = cuit.replace(/\D/g, "");
  if (clean.length !== 11) return cuit;
  return `${clean.slice(0, 2)}-${clean.slice(2, 10)}-${clean.slice(10)}`;
}

export function validateCuit(cuit: string): boolean {
  const clean = cuit.replace(/\D/g, "");
  if (clean.length !== 11) return false;
  
  const multipliers = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  
  for (let i = 0; i < 10; i++) {
    sum += parseInt(clean[i]) * multipliers[i];
  }
  
  const remainder = sum % 11;
  const checkDigit = remainder === 0 ? 0 : remainder === 1 ? 9 : 11 - remainder;
  
  return checkDigit === parseInt(clean[10]);
}

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[,.\s]+/g, " ")
    .trim();
}
