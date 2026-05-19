/**
 * Helpers para import masivo desde Excel generado por factura_parser.py (sin acoplar al HTTP).
 */

/** Solo dígitos para comparar CUIT / claves compuestas. */
export function digitsOnly(s: string | undefined | null): string {
  return String(s ?? "").replace(/\D/g, "");
}

/** Formato común XX-XXXXXXXX-X si hay 11 dígitos. */
export function formatCuitAr(digits: string): string {
  const d = digitsOnly(digits);
  if (d.length !== 11) return digits?.trim() ?? "";
  return `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}`;
}

export function normalizeInvoiceSalePoint(raw: string | undefined | null): string {
  const d = digitsOnly(raw);
  if (!d) return "";
  return d.padStart(4, "0").slice(-4);
}

export function normalizeInvoiceNumber(raw: string | undefined | null): string {
  const d = digitsOnly(raw);
  if (!d) return "";
  return d.padStart(8, "0").slice(-8);
}

/** dd/mm/aaaa → aaaa-mm-dd */
export function parseEsDateToIso(raw: string | undefined | null): string | null {
  const s = String(raw ?? "").trim();
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (!m) return null;
  const dd = m[1].padStart(2, "0");
  const mm = m[2].padStart(2, "0");
  const yyyy = m[3];
  return `${yyyy}-${mm}-${dd}`;
}

/** Número argentino con coma o punto → float */
export function parseMoneyAr(raw: string | number | undefined | null): number {
  if (raw === undefined || raw === null || raw === "") return NaN;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : NaN;
  let s = String(raw).trim().replace(/\s/g, "").replace(/\$/g, "");
  if (!s) return NaN;
  if (s.includes(",") && s.includes(".")) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (s.includes(",")) {
    s = s.replace(",", ".");
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : NaN;
}

export function stripDiacriticsLower(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
}

/** Texto típico de factura AFIP → valor `ivaCondition` del schema / invoice-form */
export function mapIvaTextToInvoiceCondition(raw: string | undefined | null): string {
  const t = stripDiacriticsLower(String(raw ?? ""));
  if (!t.trim()) return "responsable_inscripto";
  if (t.includes("monotributo")) return "monotributista";
  if (t.includes("exento")) return "exento";
  if (t.includes("consumidor final")) return "consumidor_final";
  if (t.includes("responsable inscripto") || t.includes("resp inscripto") || t.includes("resp.inscripto")) {
    return "responsable_inscripto";
  }
  return "responsable_inscripto";
}

/** "FACTURA A" → "A"; fallback "A". */
export function mapTipoComprobanteToCode(raw: string | undefined | null): string {
  const u = stripDiacriticsLower(String(raw ?? ""));
  const map: [RegExp, string][] = [
    [/nota\s+de\s+credito\s+a/, "NC-A"],
    [/nota\s+de\s+credito\s+b/, "NC-B"],
    [/nota\s+de\s+credito\s+c/, "NC-C"],
    [/nota\s+de\s+debito\s+a/, "ND-A"],
    [/nota\s+de\s+debito\s+b/, "ND-B"],
    [/nota\s+de\s+debito\s+c/, "ND-C"],
    [/factura\s+m/, "M"],
    [/factura\s+e/, "E"],
    [/factura\s+c/, "C"],
    [/factura\s+b/, "B"],
    [/factura\s+a/, "A"],
    [/remito/, "REM"],
  ];
  for (const [re, code] of map) {
    if (re.test(u)) return code;
  }
  const letter = String(raw ?? "").toUpperCase().match(/\b([ABCM])\b/);
  return letter ? letter[1] : "A";
}

export type SupplyLike = { id: number; name: string };

/** Score 0–1 para matchear descripción OCR vs nombre de insumo */
export function scoreSupplyMatch(ocrDescription: string, supplyName: string): number {
  const a = stripDiacriticsLower(ocrDescription.trim()).replace(/[^a-z0-9]+/g, " ").trim();
  const b = stripDiacriticsLower(supplyName.trim()).replace(/[^a-z0-9]+/g, " ").trim();
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.92;
  const tokens = b.split(" ").filter((t) => t.length > 2);
  if (!tokens.length) return 0;
  const hits = tokens.filter((t) => a.includes(t)).length;
  return round4((hits / tokens.length) * 0.88);
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
