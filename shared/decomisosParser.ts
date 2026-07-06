/**
 * Parser del reporte de DECOMISOS de Datalive (archivo "REPORTE_DE_DECOMISOS.xls").
 *
 * El archivo NO es una tabla plana: viene agrupado en secciones con filas-título.
 *   - Fila-título de sucursal:  ["Sucursal Brozziano Aguero","","",...]  → col A texto, resto vacío → skip
 *   - Fila-título de tipo:       ["MALA ROTACION","","",...]              → col A texto, resto vacío → skip
 *   - Fila de cabecera:          ["Cód. Decomiso","Cód. Producto",...]    → col A === "Cód. Decomiso" → skip
 *   - Fila de datos:             [201932,79839,"30/06/2026","18:33hs","Medialunas...","Brozziano Aguero","MALA ROTACION",...]
 *                                → col A es NÚMERO (Cód. Decomiso) → incluir
 *   - Fila TOTALES:              ["TOTALES","","","","","","","","",4375,...] → col A empieza con "TOTAL" → skip
 *
 * Columnas usadas (0-indexed):
 *   A(0)=Cód. Decomiso · B(1)=Cód. Producto · C(2)=Fecha alta · E(4)=Descripción ·
 *   F(5)=Sucursal · G(6)=Tipo decomiso · K(10)=Decomiso Total (cantidad).
 *
 * La fecha puede venir como texto "dd/mm/aaaa" o como número serial de Excel; se normaliza a ISO (aaaa-mm-dd).
 */

export interface ParsedDecomiso {
  codDecomiso: string;
  codProducto: string;
  fecha: string; // ISO aaaa-mm-dd
  descripcion: string;
  sucursal: string;
  tipoDecomiso: string;
  cantidad: number;
}

export interface DecomisosParseResult {
  items: ParsedDecomiso[];
  warnings: string[];
}

/** Convierte un valor de celda de fecha (texto dd/mm/aaaa, serial de Excel o Date) a ISO aaaa-mm-dd. */
function toIsoDate(value: any): string | null {
  if (value == null || value === "") return null;

  // Date object (cuando el workbook se leyó con cellDates)
  if (value instanceof Date && !isNaN(value.getTime())) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  }

  // Número serial de Excel (días desde 1899-12-30). Se descarta la fracción horaria.
  if (typeof value === "number" && isFinite(value)) {
    const serial = Math.floor(value);
    const ms = Date.UTC(1899, 11, 30) + serial * 86400 * 1000;
    const d = new Date(ms);
    if (isNaN(d.getTime())) return null;
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  }

  const s = String(value).trim();
  // Texto dd/mm/aaaa (o dd-mm-aaaa)
  let m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (m) {
    let [, dd, mm, yyyy] = m;
    if (yyyy.length === 2) yyyy = `20${yyyy}`;
    return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }
  // Ya viene ISO
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;

  return null;
}

/** Normaliza la cantidad (col K) a número (soporta coma decimal es-AR). */
function toNumber(value: any): number {
  if (value == null || value === "") return 0;
  if (typeof value === "number") return value;
  const s = String(value).trim().replace(/\./g, "").replace(/,/g, ".");
  const n = parseFloat(s);
  return isFinite(n) ? n : 0;
}

export function parseDecomisosReport(rows: any[][]): DecomisosParseResult {
  const warnings: string[] = [];
  if (!rows || rows.length === 0) return { items: [], warnings: ["El archivo está vacío."] };

  const items: ParsedDecomiso[] = [];
  let sinFecha = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;

    const colA = row[0];

    // Fila de datos ⇔ col A es un número (Cód. Decomiso). El resto (títulos, cabecera,
    // TOTALES, filas vacías) tiene col A texto o vacío → se descarta.
    const codNum = typeof colA === "number" ? colA : (typeof colA === "string" && /^\d+$/.test(colA.trim()) ? parseInt(colA.trim(), 10) : NaN);
    if (!isFinite(codNum)) continue;

    const fecha = toIsoDate(row[2]);
    if (!fecha) {
      sinFecha++;
      continue;
    }

    const descripcion = String(row[4] ?? "").trim();
    const sucursal = String(row[5] ?? "").trim();
    const cantidad = toNumber(row[10]);

    if (!descripcion) continue;

    items.push({
      codDecomiso: String(codNum),
      codProducto: row[1] != null && row[1] !== "" ? String(row[1]).trim() : "",
      fecha,
      descripcion,
      sucursal,
      tipoDecomiso: String(row[6] ?? "").trim(),
      cantidad,
    });
  }

  if (sinFecha > 0) warnings.push(`${sinFecha} fila(s) se omitieron por no tener fecha válida.`);
  if (items.length === 0) warnings.push("No se encontraron decomisos válidos en el archivo.");

  return { items, warnings };
}
