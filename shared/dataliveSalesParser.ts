/**
 * Parser del reporte de ventas de Datalive (resumen diario por local).
 *
 * El reporte trae, por día: FECHA (embebida en la 1ª columna junto a "Cod. caja", día de la
 * semana y nombre del local), TOTAL VTAS, VTAS EFECTIVO, VTAS ONLINE, y otras columnas que NO
 * usamos (gastos/sueldos/ingresos/egresos).
 *
 * Particularidades del archivo real:
 * - Total y Online vienen como texto con formato argentino ("$1.962.898,60").
 * - Efectivo viene como número MAL exportado por Datalive (ej. 683.8006 en vez de 683800,60).
 *   Por eso el Efectivo se DERIVA: Efectivo = Total − Online (el reporte solo tiene esos dos
 *   buckets de venta, así que Total = Efectivo + Online).
 * - Filas "TOTAL - <local>", "TOTALES", "BALANCE", "Total de ...", "Ganancia ..." se ignoran.
 */

export interface ParsedDataliveDay {
  fecha: string; // YYYY-MM-DD
  ventaTotal: number;
  ventaEfectivo: number;
  ventaOnline: number;
}

export interface ParseDataliveResult {
  days: ParsedDataliveDay[];
  warnings: string[];
}

/** Parsea un importe en formato argentino ("$1.962.898,60") o un número JS limpio. */
export function parseArgMoney(value: unknown): number {
  if (value == null || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  let s = String(value).trim();
  if (!s) return 0;
  s = s.replace(/\$/g, "").replace(/\s/g, "");
  // Argentino: punto = miles, coma = decimal.
  s = s.replace(/\./g, "").replace(",", ".");
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

const norm = (v: unknown) =>
  String(v ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Lee un importe del reporte Datalive respetando cómo lo exporta el archivo:
 * - NÚMERO: Datalive lo exporta dividido por 1000 (ej. 851.4504 = $851.450,40). Se multiplica ×1000.
 *   Esto aplica a TODAS las columnas de plata (Total, Efectivo y Online vienen así).
 * - TEXTO con formato argentino ("$851.450,40"): ya viene completo; se parsea tal cual.
 */
export function parseDataliveMoney(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? round2(value * 1000) : 0;
  }
  return parseArgMoney(value);
}

/** Extrae la fecha (dd/mm/aaaa) de una celda y la devuelve como YYYY-MM-DD, o null. */
function extractFecha(cellText: string): string | null {
  const m = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(cellText);
  if (!m) return null;
  const dd = m[1].padStart(2, "0");
  const mm = m[2].padStart(2, "0");
  const yyyy = m[3];
  return `${yyyy}-${mm}-${dd}`;
}

const SKIP_PREFIXES = ["total", "balance", "ganancia"];

export function parseDataliveReport(rawRows: any[][]): ParseDataliveResult {
  const warnings: string[] = [];
  const days: ParsedDataliveDay[] = [];

  if (!Array.isArray(rawRows) || rawRows.length === 0) {
    return { days, warnings: ["El archivo está vacío."] };
  }

  // 1) Encontrar la fila de encabezados (la que tiene "total vtas" y "vtas online").
  let headerIdx = -1;
  for (let i = 0; i < Math.min(rawRows.length, 15); i++) {
    const cells = (rawRows[i] || []).map(norm);
    if (cells.some((c) => c.includes("total vtas")) && cells.some((c) => c.includes("vtas online"))) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) {
    return { days, warnings: ["No se reconoció el formato del reporte (faltan columnas TOTAL VTAS / VTAS ONLINE)."] };
  }

  const header = (rawRows[headerIdx] || []).map(norm);
  const colTotal = header.findIndex((c) => c.includes("total vtas"));
  const colOnline = header.findIndex((c) => c.includes("vtas online"));
  const colEfectivo = header.findIndex((c) => c.includes("vtas efectivo"));
  const colFecha = 0; // la fecha viene siempre en la 1ª columna (junto a Cod. caja / local)

  // 2) Recorrer las filas de datos.
  const seen = new Set<string>();
  for (let i = headerIdx + 1; i < rawRows.length; i++) {
    const row = rawRows[i];
    if (!row || row.length === 0) continue;

    const firstCell = String(row[colFecha] ?? "");
    const firstNorm = norm(firstCell);
    if (SKIP_PREFIXES.some((p) => firstNorm.startsWith(p))) continue;

    const fecha = extractFecha(firstCell);
    if (!fecha) continue; // no es una fila-día

    const ventaTotal = parseDataliveMoney(row[colTotal]);
    const ventaOnline = parseDataliveMoney(row[colOnline]);
    // Efectivo derivado (Total − Online): el reporte solo tiene esos dos buckets de venta.
    // Si diera negativo, se usa el Efectivo crudo del archivo.
    let ventaEfectivo = round2(ventaTotal - ventaOnline);
    if (ventaEfectivo < 0) {
      ventaEfectivo = parseDataliveMoney(row[colEfectivo]);
      warnings.push(`Día ${fecha}: Total − Online dio negativo; se usó el valor de Efectivo del archivo.`);
    }

    if (ventaTotal === 0 && ventaEfectivo === 0 && ventaOnline === 0) continue; // fila sin datos

    if (seen.has(fecha)) {
      warnings.push(`El archivo trae el día ${fecha} más de una vez; se tomó la primera aparición.`);
      continue;
    }
    seen.add(fecha);
    days.push({ fecha, ventaTotal, ventaEfectivo, ventaOnline });
  }

  if (days.length === 0) {
    warnings.push("No se encontraron días con ventas en el archivo.");
  }
  return { days, warnings };
}
