/**
 * Parser del reporte de FUDO (primera solapa "Ventas").
 *
 * Estructura del archivo:
 *   - Fila 0: "Desde" + fecha de inicio del reporte (metadatos)
 *   - Fila 1: "Hasta" + fecha de fin
 *   - Fila 2: vacía
 *   - Fila 3: cabeceras → A:Id B:Fecha C:Creación D:Cerrada E:Caja F:Estado ... M:Total
 *   - Fila 4+: datos
 *
 * Reglas:
 *   - Solo se procesan filas donde col F (Estado) === "Cerrada" (excluye "Eliminada").
 *   - Las ventas con Total=0 se incluyen (tickets regalados, cuentan como venta).
 *   - Se agrupa por fecha (YYYY-MM-DD) sumando col M (Total).
 */

export interface ParsedFudoDay {
  fecha: string;
  ventaTotal: number;
  ticketCount: number;
}

export interface FudoParseResult {
  days: ParsedFudoDay[];
  warnings: string[];
  reportFrom: string | null;
  reportTo: string | null;
}

const COL_FECHA = 1;   // B
const COL_ESTADO = 5;  // F
const COL_TOTAL = 12;  // M
const HEADER_ROW = 3;  // índice de la fila de cabeceras (0-based)
const DATA_START = 4;  // primera fila de datos

function excelDateToIso(raw: unknown): string | null {
  if (typeof raw === "string") {
    // Fecha ya en formato ISO o DD/MM/YYYY
    const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) return raw;
    const dmy = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
    return null;
  }
  if (typeof raw === "number" && raw > 40000) {
    // Número serial de Excel → Date
    const d = new Date(Date.UTC(1899, 11, 30) + raw * 86400000);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  return null;
}

export interface ParsedFudoAdicion {
  fecha: string;
  producto: string;
  categoria: string;
  cantidad: number;
}

export interface FudoAdicionesParseResult {
  items: ParsedFudoAdicion[];
  warnings: string[];
}

/**
 * Parsea la solapa "Adiciones" del reporte FUDO.
 *
 * Estructura de la hoja Adiciones (0-based):
 *   Col 0 (A): Id. Venta   Col 1 (B): Creación   Col 2 (C): Producto
 *   Col 3 (D): Categoría   Col 4 (E): Cantidad    Col 11 (L): Cancelada
 *
 * La fecha de venta se obtiene cruzando el Id. Venta con la hoja Ventas
 * (ventasRows, col 0=Id, col 1=Fecha "YYYY-MM-DD"). Si no se pasa ventasRows
 * se usa la fecha derivada del serial Creación (col B).
 *
 * Reglas:
 *   - Filas con Cancelada === "Si" se omiten.
 *   - Se agrupa por (fecha, producto) sumando Cantidad (un mismo producto puede
 *     aparecer en múltiples tickets del mismo día).
 */
export function parseFudoAdiciones(rows: any[][], ventasRows?: any[][]): FudoAdicionesParseResult {
  const warnings: string[] = [];
  if (!rows || rows.length === 0) return { items: [], warnings: ["Solapa Adiciones vacía o no encontrada."] };

  // Construir mapa Id.Venta → fecha desde la hoja Ventas (más preciso que el serial de Creación).
  const fechaByVentaId = new Map<number, string>();
  if (ventasRows) {
    for (let i = DATA_START; i < ventasRows.length; i++) {
      const vRow = ventasRows[i];
      if (!vRow) continue;
      const ventaId = vRow[0];
      if (typeof ventaId !== "number") continue;
      const fecha = excelDateToIso(vRow[1]); // col B = Fecha
      if (fecha) fechaByVentaId.set(ventaId, fecha);
    }
  }

  // Fila 0 = cabecera; datos desde fila 1.
  const byKey = new Map<string, ParsedFudoAdicion>();
  let canceladas = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every((c: any) => c == null || c === "")) continue;

    // Saltar adiciones canceladas (col 11 = "Cancelada")
    const cancelada = String(row[11] ?? "").trim();
    if (cancelada === "Si") { canceladas++; continue; }

    const ventaId = typeof row[0] === "number" ? row[0] : null;
    let fecha: string | null = null;

    if (ventaId !== null && fechaByVentaId.has(ventaId)) {
      fecha = fechaByVentaId.get(ventaId)!;
    } else {
      fecha = excelDateToIso(row[1]); // fallback: serial de Creación
    }
    if (!fecha) continue;

    const producto = String(row[2] ?? "").trim();
    if (!producto) continue;
    const categoria = String(row[3] ?? "").trim();
    const cantidad = Math.round(parseFloat(String(row[4] ?? 0)) || 0);

    // Agregar al acumulador (mismo producto puede aparecer en varios tickets del mismo día)
    const key = `${fecha}||${producto}`;
    if (byKey.has(key)) {
      byKey.get(key)!.cantidad += cantidad;
    } else {
      byKey.set(key, { fecha, producto, categoria, cantidad });
    }
  }

  if (canceladas > 0) warnings.push(`${canceladas} adición(es) cancelada(s) omitida(s).`);
  if (byKey.size === 0) warnings.push("No se encontraron adiciones válidas en la solapa.");

  return { items: Array.from(byKey.values()), warnings };
}

export function parseFudoReport(rows: any[][]): FudoParseResult {
  const warnings: string[] = [];

  if (!rows || rows.length < DATA_START) {
    return { days: [], warnings: ["El archivo no tiene filas de datos."], reportFrom: null, reportTo: null };
  }

  // Metadatos del reporte
  const reportFrom = excelDateToIso(rows[0]?.[1]);
  const reportTo = excelDateToIso(rows[1]?.[1]);

  // Verificar cabeceras esperadas
  const headers = rows[HEADER_ROW] as any[];
  const expectedB = "Fecha";
  const expectedF = "Estado";
  const expectedM = "Total";
  if (headers[COL_FECHA] !== expectedB || headers[COL_ESTADO] !== expectedF || headers[COL_TOTAL] !== expectedM) {
    warnings.push(
      `Cabeceras inesperadas: B="${headers[COL_FECHA]}" F="${headers[COL_ESTADO]}" M="${headers[COL_TOTAL]}". ` +
      `Se esperaba B="${expectedB}" F="${expectedF}" M="${expectedM}". El mapeo puede fallar.`,
    );
  }

  const byDay = new Map<string, { ventaTotal: number; ticketCount: number }>();
  let skippedEstado = 0;

  for (let i = DATA_START; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every((c) => c == null || c === "")) continue;

    const estado = String(row[COL_ESTADO] ?? "").trim();
    if (estado !== "Cerrada") {
      skippedEstado++;
      continue;
    }

    const fechaRaw = row[COL_FECHA];
    const fecha = excelDateToIso(fechaRaw);
    if (!fecha) {
      warnings.push(`Fila ${i + 1}: fecha inválida "${fechaRaw}", se omite.`);
      continue;
    }

    const total = parseFloat(String(row[COL_TOTAL] ?? 0)) || 0;

    if (!byDay.has(fecha)) byDay.set(fecha, { ventaTotal: 0, ticketCount: 0 });
    const entry = byDay.get(fecha)!;
    entry.ventaTotal += total;
    entry.ticketCount++;
  }

  if (skippedEstado > 0) {
    warnings.push(`${skippedEstado} fila(s) omitidas por tener Estado distinto a "Cerrada".`);
  }

  const days: ParsedFudoDay[] = Array.from(byDay.entries())
    .map(([fecha, v]) => ({ fecha, ventaTotal: Math.round(v.ventaTotal * 100) / 100, ticketCount: v.ticketCount }))
    .sort((a, b) => a.fecha.localeCompare(b.fecha));

  if (days.length === 0) {
    warnings.push("No se encontraron filas con Estado=Cerrada en el archivo.");
  }

  return { days, warnings, reportFrom, reportTo };
}
