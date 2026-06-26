/**
 * Parser del reporte de PRODUCTOS de Datalive (archivo separado, distinto al de ventas diarias).
 *
 * Estructura del archivo (Sheet1):
 *   - Fila de sección:  ["EMPANADAS","","",""]          → col B vacío, sin ID → skip
 *   - Fila de cabecera: ["Producto","ID","Local","Total"] → col A==="Producto" → skip
 *   - Fila de producto: ["EMPANADA",79986,33858,33858]   → col B es número (ID) → incluir
 *   - Fila de subtotal: ["TOTAL EMPANADAS","",33858,...] → col A empieza con "TOTAL" → skip
 *   - Fila final:       ["TOTAL FINAL","","",51536]      → idem → skip
 *
 * Columnas usadas: A(0)=Producto, D(3)=Cantidad total.
 */

export interface ParsedDataliveProducto {
  producto: string;
  cantidad: number;
}

export interface DataliveProductsParseResult {
  items: ParsedDataliveProducto[];
  warnings: string[];
}

export function parseDataliveProductsReport(rows: any[][]): DataliveProductsParseResult {
  const warnings: string[] = [];
  if (!rows || rows.length === 0) return { items: [], warnings: ["El archivo está vacío."] };

  const items: ParsedDataliveProducto[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;

    const colA = String(row[0] ?? "").trim();
    const colB = row[1];

    // Skip: fila vacía
    if (!colA) continue;

    // Skip: cabecera de columnas ("Producto")
    if (colA.toLowerCase() === "producto") continue;

    // Skip: fila TOTAL (subtotales y total final)
    if (colA.toUpperCase().startsWith("TOTAL")) continue;

    // Skip: sección header — col B es string vacío (no tiene ID numérico ni valor)
    if (colB === "" || colB == null) continue;

    const producto = colA;
    const cantidad = Math.round(parseFloat(String(row[3] ?? 0)) || 0);

    items.push({ producto, cantidad });
  }

  if (items.length === 0) {
    warnings.push("No se encontraron productos válidos en el archivo.");
  }

  return { items, warnings };
}
