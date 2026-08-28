/**
 * Parser del reporte de FUDO (primera solapa "Ventas").
 *
 * Estructura del archivo:
 *   - Fila 0: "Desde" + fecha de inicio del reporte (metadatos)
 *   - Fila 1: "Hasta" + fecha de fin
 *   - Fila 2: vacía
 *   - Fila 3: cabeceras → A:Id B:Fecha C:Creación D:Cerrada E:Caja F:Estado ... M:Total N:Fiscalizada
 *   - Fila 4+: datos
 *
 * Reglas:
 *   - Solo se procesan filas donde col F (Estado) === "Cerrada" (excluye "Eliminada").
 *   - Las ventas con Total=0 se incluyen (tickets regalados, cuentan como venta).
 *   - Se agrupa por fecha (YYYY-MM-DD) sumando col M (Total).
 *   - Col N dice "SI"/"NO" si la venta se fiscalizó. El corte se hace sobre el MISMO universo que
 *     el total (solo "Cerrada"), así fiscalizada + no fiscalizada + sin dato = venta total del día.
 *     Los archivos viejos no tienen esa columna: ahí el corte queda en null (= "sin dato"), nunca
 *     en cero, para no hacer pasar por "no fiscalizado" algo que simplemente no se sabe.
 */

export interface ParsedFudoDay {
  fecha: string;
  ventaTotal: number;
  ticketCount: number;
  /** Corte fiscal del día. null en los tres = el archivo no trae la columna N (dato desconocido). */
  ventaFiscalizada: number | null;
  ventaNoFiscalizada: number | null;
  /** Filas "Cerrada" cuya col N vino vacía o con un valor que no es SI/NO. */
  ventaSinDatoFiscal: number | null;
  ticketsFiscalizados: number | null;
  ticketsNoFiscalizados: number | null;
  ticketsSinDatoFiscal: number | null;
}

export interface FudoParseResult {
  days: ParsedFudoDay[];
  warnings: string[];
  reportFrom: string | null;
  reportTo: string | null;
  /** false = el archivo no trae la columna de fiscalización; los días quedan sin corte fiscal. */
  hasFiscalColumn: boolean;
}

const COL_FECHA = 1;   // B
const COL_ESTADO = 5;  // F
const COL_TOTAL = 12;  // M
const COL_FISCAL = 13; // N — "SI"/"NO"
const HEADER_ROW = 3;  // índice de la fila de cabeceras (0-based)
const DATA_START = 4;  // primera fila de datos

/**
 * Lee la col N. Se es tolerante con la forma del "sí" (mayúsculas, tilde, booleano de Excel)
 * porque el archivo lo exporta FUDO y no queremos que un cambio cosmético rompa el corte.
 * Devuelve null cuando la celda no dice nada reconocible: eso es "no se sabe", no es "no".
 */
function parseFiscalFlag(raw: unknown): boolean | null {
  if (raw == null) return null;
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "number") return raw === 1 ? true : raw === 0 ? false : null;
  const v = String(raw).trim().toUpperCase().replace(/Í/g, "I");
  if (v === "") return null;
  if (v === "SI" || v === "S" || v === "TRUE" || v === "1" || v === "VERDADERO") return true;
  if (v === "NO" || v === "N" || v === "FALSE" || v === "0" || v === "FALSO") return false;
  return null;
}

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

export interface ParsedFudoPago {
  fecha: string;
  medioPago: string;
  importe: number;
}

export interface FudoPagosParseResult {
  items: ParsedFudoPago[];
  warnings: string[];
}

/**
 * Parsea la solapa "Pagos" del reporte FUDO (4ta hoja, índice 3).
 * Col B (índice 1) = Fecha, Col C (índice 2) = Medio de pago, Col D (índice 3) = Importe.
 * Fila 0 = cabecera; datos desde fila 1.
 * Agrupa por (fecha, medioPago) sumando importes.
 */
export function parseFudoPagos(rows: any[][]): FudoPagosParseResult {
  const warnings: string[] = [];
  if (!rows || rows.length <= 1) return { items: [], warnings: ["Solapa Pagos vacía o no encontrada."] };

  const byKey = new Map<string, ParsedFudoPago>();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every((c: any) => c == null || c === "")) continue;

    const fecha = excelDateToIso(row[1]);
    if (!fecha) continue;

    const medioPago = String(row[2] ?? "").trim();
    if (!medioPago) continue;

    const importe = parseFloat(String(row[3] ?? 0)) || 0;

    const key = `${fecha}||${medioPago}`;
    if (byKey.has(key)) {
      byKey.get(key)!.importe += importe;
    } else {
      byKey.set(key, { fecha, medioPago, importe });
    }
  }

  const items = Array.from(byKey.values()).map((p) => ({
    ...p,
    importe: Math.round(p.importe * 100) / 100,
  }));

  if (items.length === 0) warnings.push("No se encontraron registros válidos en la solapa Pagos.");

  return { items, warnings };
}

export function parseFudoReport(rows: any[][]): FudoParseResult {
  const warnings: string[] = [];

  if (!rows || rows.length < DATA_START) {
    return { days: [], warnings: ["El archivo no tiene filas de datos."], reportFrom: null, reportTo: null, hasFiscalColumn: false };
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

  // La columna N solo existe en los reportes nuevos. Si no está, el archivo se importa igual
  // (venta y tickets no cambian) pero el corte fiscal del día queda en null.
  const hasFiscalColumn = rows
    .slice(DATA_START)
    .some((r) => r && parseFiscalFlag(r[COL_FISCAL]) !== null);
  if (!hasFiscalColumn) {
    warnings.push(
      'No se encontró la columna N ("SI"/"NO" de fiscalización): estos días quedan sin corte fiscal en el Dashboard.',
    );
  }

  interface DayAcc {
    ventaTotal: number;
    ticketCount: number;
    ventaFiscalizada: number;
    ventaNoFiscalizada: number;
    ventaSinDatoFiscal: number;
    ticketsFiscalizados: number;
    ticketsNoFiscalizados: number;
    ticketsSinDatoFiscal: number;
  }
  const byDay = new Map<string, DayAcc>();
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

    if (!byDay.has(fecha)) {
      byDay.set(fecha, {
        ventaTotal: 0,
        ticketCount: 0,
        ventaFiscalizada: 0,
        ventaNoFiscalizada: 0,
        ventaSinDatoFiscal: 0,
        ticketsFiscalizados: 0,
        ticketsNoFiscalizados: 0,
        ticketsSinDatoFiscal: 0,
      });
    }
    const entry = byDay.get(fecha)!;
    entry.ventaTotal += total;
    entry.ticketCount++;

    // Mismo universo que el total (solo "Cerrada"): los tres baldes cierran contra ventaTotal.
    const fiscal = parseFiscalFlag(row[COL_FISCAL]);
    if (fiscal === true) {
      entry.ventaFiscalizada += total;
      entry.ticketsFiscalizados++;
    } else if (fiscal === false) {
      entry.ventaNoFiscalizada += total;
      entry.ticketsNoFiscalizados++;
    } else {
      entry.ventaSinDatoFiscal += total;
      entry.ticketsSinDatoFiscal++;
    }
  }

  if (skippedEstado > 0) {
    warnings.push(`${skippedEstado} fila(s) omitidas por tener Estado distinto a "Cerrada".`);
  }

  const round2 = (n: number) => Math.round(n * 100) / 100;
  const days: ParsedFudoDay[] = Array.from(byDay.entries())
    .map(([fecha, v]) => ({
      fecha,
      ventaTotal: round2(v.ventaTotal),
      ticketCount: v.ticketCount,
      ventaFiscalizada: hasFiscalColumn ? round2(v.ventaFiscalizada) : null,
      ventaNoFiscalizada: hasFiscalColumn ? round2(v.ventaNoFiscalizada) : null,
      ventaSinDatoFiscal: hasFiscalColumn ? round2(v.ventaSinDatoFiscal) : null,
      ticketsFiscalizados: hasFiscalColumn ? v.ticketsFiscalizados : null,
      ticketsNoFiscalizados: hasFiscalColumn ? v.ticketsNoFiscalizados : null,
      ticketsSinDatoFiscal: hasFiscalColumn ? v.ticketsSinDatoFiscal : null,
    }))
    .sort((a, b) => a.fecha.localeCompare(b.fecha));

  // Filas "Cerrada" con la col N vacía o ilegible: el corte no cubre todo el período y hay que decirlo.
  const sinDatoTickets = days.reduce((acc, d) => acc + (d.ticketsSinDatoFiscal ?? 0), 0);
  if (hasFiscalColumn && sinDatoTickets > 0) {
    warnings.push(`${sinDatoTickets} venta(s) tienen la columna N vacía o con un valor distinto de SI/NO.`);
  }

  if (days.length === 0) {
    warnings.push("No se encontraron filas con Estado=Cerrada en el archivo.");
  }

  return { days, warnings, reportFrom, reportTo, hasFiscalColumn };
}
