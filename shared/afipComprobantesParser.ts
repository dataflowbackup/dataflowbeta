/**
 * Parser de "Mis Comprobantes" de AFIP (recibidos y emitidos).
 *
 * AFIP entrega el mismo contenido en dos formatos, segun el volumen:
 *
 * - EXCEL (cuando son pocos): fila 0 con el titulo "Mis Comprobantes Recibidos - CUIT NNN",
 *   headers en la fila 1. Fecha dd/mm/aaaa, tipo "1 - Factura A", documento "CUIT"/"DNI",
 *   decimales con punto.
 * - CSV (cuando son muchos, viene dentro de un .zip): headers en la primera linea, separador
 *   ";", campos entre comillas. Fecha aaaa-mm-dd, tipo "1" (solo el codigo), documento "80"/"96"
 *   (codigos AFIP), decimales con COMA.
 *
 * Este parser normaliza los dos a la misma estructura. Corre en el browser (igual que el de
 * Datalive): la pantalla lee el archivo, parsea aca y manda JSON al servidor.
 */

// ==========================================
// CATALOGO DE TIPOS DE COMPROBANTE (RG 1415)
// ==========================================

/**
 * Codigo AFIP -> nombre y como lo llama el sistema en Facturas (`invoices.invoice_type`).
 *
 * `systemType` es la clave del cruce: el modulo de Facturas guarda "A", "B", "NC-A", etc.
 * Los tique-factura (81/82/83/111/118) son facturas a los efectos del cruce, por eso mapean a
 * la letra sin mas. Un codigo que no este en la tabla se guarda igual, con nombre generico y
 * sin `systemType` (no cruza, pero no se pierde).
 */
export const AFIP_VOUCHER_TYPES: Record<number, { name: string; systemType?: string }> = {
  1: { name: "Factura A", systemType: "A" },
  2: { name: "Nota de Débito A", systemType: "ND-A" },
  3: { name: "Nota de Crédito A", systemType: "NC-A" },
  4: { name: "Recibo A" },
  5: { name: "Nota de Venta al contado A" },
  6: { name: "Factura B", systemType: "B" },
  7: { name: "Nota de Débito B", systemType: "ND-B" },
  8: { name: "Nota de Crédito B", systemType: "NC-B" },
  9: { name: "Recibo B" },
  10: { name: "Nota de Venta al contado B" },
  11: { name: "Factura C", systemType: "C" },
  12: { name: "Nota de Débito C", systemType: "ND-C" },
  13: { name: "Nota de Crédito C", systemType: "NC-C" },
  15: { name: "Recibo C" },
  19: { name: "Factura E", systemType: "E" },
  20: { name: "Nota de Débito E", systemType: "ND-E" },
  21: { name: "Nota de Crédito E", systemType: "NC-E" },
  39: { name: "Otros comprobantes A" },
  40: { name: "Otros comprobantes B" },
  51: { name: "Factura M", systemType: "M" },
  52: { name: "Nota de Débito M", systemType: "ND-M" },
  53: { name: "Nota de Crédito M", systemType: "NC-M" },
  54: { name: "Recibo M" },
  60: { name: "Cuenta de Venta y Líquido producto A" },
  61: { name: "Cuenta de Venta y Líquido producto B" },
  63: { name: "Liquidación A" },
  64: { name: "Liquidación B" },
  81: { name: "Tique Factura A", systemType: "A" },
  82: { name: "Tique Factura B", systemType: "B" },
  83: { name: "Tique" },
  110: { name: "Tique Nota de Crédito" },
  111: { name: "Tique Factura C", systemType: "C" },
  112: { name: "Tique Nota de Crédito A", systemType: "NC-A" },
  113: { name: "Tique Nota de Crédito B", systemType: "NC-B" },
  114: { name: "Tique Nota de Crédito C", systemType: "NC-C" },
  115: { name: "Tique Nota de Débito A", systemType: "ND-A" },
  118: { name: "Tique Factura M", systemType: "M" },
};

export function voucherTypeName(code: number): string {
  return AFIP_VOUCHER_TYPES[code]?.name ?? `Comprobante tipo ${code}`;
}

export function voucherSystemType(code: number): string | null {
  return AFIP_VOUCHER_TYPES[code]?.systemType ?? null;
}

/**
 * Los comprobantes que RESTAN (notas de credito). Se usa para que los totales del dashboard
 * no inflen la compra: una NC descuenta.
 */
export function isCreditNote(code: number): boolean {
  return [3, 8, 13, 21, 53, 110, 112, 113, 114].includes(code);
}

// ==========================================
// TIPOS DE DOCUMENTO
// ==========================================

const DOC_TYPES: Record<number, string> = {
  80: "CUIT",
  86: "CUIL",
  96: "DNI",
  99: "Consumidor Final",
};

/** Acepta el codigo numerico del CSV (80) o el texto del Excel ("CUIT"). */
export function normalizeDocType(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const code = Number(raw);
  if (Number.isFinite(code) && DOC_TYPES[code]) return DOC_TYPES[code];
  return raw.toUpperCase();
}

// ==========================================
// NORMALIZACION DE VALORES
// ==========================================

/**
 * Importes. El CSV usa coma decimal y el Excel punto; ninguno de los dos trae separador de
 * miles en las muestras, pero se contempla igual por las dudas.
 */
export function parseAfipAmount(value: unknown): number {
  if (value == null || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  let s = String(value).trim().replace(/\$/g, "").replace(/\s/g, "");
  if (!s) return 0;

  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    // Los dos separadores: el ULTIMO es el decimal.
    if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (lastComma >= 0) {
    // Solo coma: decimal si deja 1 o 2 digitos a la derecha; si no, es separador de miles.
    const decimals = s.length - lastComma - 1;
    s = decimals > 0 && decimals <= 2 ? s.replace(",", ".") : s.replace(/,/g, "");
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

/** Fecha a YYYY-MM-DD, desde "dd/mm/aaaa" (Excel), "aaaa-mm-dd" (CSV) o un Date de xlsx. */
export function parseAfipDate(value: unknown): string | null {
  if (value == null || value === "") return null;

  if (value instanceof Date && !isNaN(value.getTime())) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  const s = String(value).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

/** "1 - Factura A" -> 1 ; "1" -> 1 */
export function parseVoucherTypeCode(value: unknown): number | null {
  const s = String(value ?? "").trim();
  if (!s) return null;
  const m = s.match(/^(\d+)/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

/** Deja solo digitos: sirve para CUIT con o sin guiones. */
export function onlyDigits(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}

// ==========================================
// ESTRUCTURA NORMALIZADA
// ==========================================

export interface ParsedComprobante {
  /** YYYY-MM-DD */
  fecha: string;
  /** Codigo AFIP (1, 6, 11, ...) */
  tipoCodigo: number;
  /** Nombre legible ("Factura A") */
  tipoNombre: string;
  /** Como lo llama el modulo de Facturas ("A", "NC-B"); null si el tipo no tiene equivalente. */
  tipoSistema: string | null;
  puntoVenta: number;
  numeroDesde: number;
  numeroHasta: number;
  codigoAutorizacion: string;
  /** Contraparte: emisor en recibidos, receptor en emitidos. */
  docTipo: string;
  docNumero: string;
  denominacion: string;
  moneda: string;
  tipoCambio: number;
  netoGravado: number;
  netoNoGravado: number;
  opExentas: number;
  otrosTributos: number;
  totalIva: number;
  total: number;
  /** Neto e IVA abiertos por alicuota, para el libro de IVA a futuro. */
  ivaPorAlicuota: {
    neto0: number;
    iva2_5: number;
    neto2_5: number;
    iva5: number;
    neto5: number;
    iva10_5: number;
    neto10_5: number;
    iva21: number;
    neto21: number;
    iva27: number;
    neto27: number;
  };
}

export interface ParseComprobantesResult {
  kind: "recibidos" | "emitidos";
  /** CUIT propio (el de la sociedad), si el archivo lo declara. */
  cuitPropio: string | null;
  comprobantes: ParsedComprobante[];
  warnings: string[];
}

// ==========================================
// LECTURA POR NOMBRE DE COLUMNA
// ==========================================

/**
 * Arregla el mojibake tipico de un CSV UTF-8 leido como Windows-1252 ("NÃºmero" -> "Número").
 * Pasa cuando el archivo se abre y se vuelve a guardar con Excel antes de subirlo. Sin esto,
 * columnas con acento como "Número Desde" no se encontrarian.
 */
function fixMojibake(s: string): string {
  if (!s.includes("Ã") && !s.includes("Â")) return s;
  return s
    .replace(/Ã¡/g, "á")
    .replace(/Ã©/g, "é")
    .replace(/Ã­/g, "í")
    .replace(/Ã³/g, "ó")
    .replace(/Ãº/g, "ú")
    .replace(/Ã±/g, "ñ")
    .replace(/Ã/g, "Á")
    .replace(/Ã‰/g, "É")
    .replace(/Ã"/g, "Ó")
    .replace(/Ãš/g, "Ú")
    .replace(/Ã'/g, "Ñ")
    .replace(/Â/g, "");
}

const norm = (v: unknown) =>
  fixMojibake(String(v ?? ""))
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Ubica columnas por nombre, tolerando las diferencias entre el Excel y el CSV
 * ("Fecha" vs "Fecha de Emisión", "Neto Grav. IVA 21%" vs "Imp. Neto Gravado IVA 21%").
 */
function buildHeaderIndex(headers: unknown[]): Map<string, number> {
  const index = new Map<string, number>();
  headers.forEach((h, i) => {
    const key = norm(h);
    if (key && !index.has(key)) index.set(key, i);
  });
  return index;
}

function findColumn(index: Map<string, number>, candidates: string[]): number {
  for (const c of candidates) {
    const hit = index.get(norm(c));
    if (hit !== undefined) return hit;
  }
  // Segundo intento: por "empieza con", para variantes de nombre.
  for (const c of candidates) {
    const target = norm(c);
    for (const [key, i] of index) {
      if (key.startsWith(target)) return i;
    }
  }
  return -1;
}

const COLUMNS = {
  fecha: ["Fecha", "Fecha de Emisión"],
  tipo: ["Tipo", "Tipo de Comprobante"],
  puntoVenta: ["Punto de Venta"],
  numeroDesde: ["Número Desde"],
  numeroHasta: ["Número Hasta"],
  codigoAutorizacion: ["Cód. Autorización"],
  docTipoEmisor: ["Tipo Doc. Emisor"],
  docNumeroEmisor: ["Nro. Doc. Emisor"],
  denominacionEmisor: ["Denominación Emisor"],
  docTipoReceptor: ["Tipo Doc. Receptor"],
  docNumeroReceptor: ["Nro. Doc. Receptor"],
  denominacionReceptor: ["Denominación Receptor"],
  tipoCambio: ["Tipo Cambio"],
  moneda: ["Moneda"],
  neto0: ["Neto Grav. IVA 0%", "Imp. Neto Gravado IVA 0%"],
  iva2_5: ["IVA 2,5%"],
  neto2_5: ["Neto Grav. IVA 2,5%", "Imp. Neto Gravado IVA 2,5%"],
  iva5: ["IVA 5%"],
  neto5: ["Neto Grav. IVA 5%", "Imp. Neto Gravado IVA 5%"],
  iva10_5: ["IVA 10,5%"],
  neto10_5: ["Neto Grav. IVA 10,5%", "Imp. Neto Gravado IVA 10,5%"],
  iva21: ["IVA 21%"],
  neto21: ["Neto Grav. IVA 21%", "Imp. Neto Gravado IVA 21%"],
  iva27: ["IVA 27%"],
  neto27: ["Neto Grav. IVA 27%", "Imp. Neto Gravado IVA 27%"],
  netoGravado: ["Neto Gravado Total", "Imp. Neto Gravado Total"],
  netoNoGravado: ["Neto No Gravado", "Imp. Neto No Gravado"],
  opExentas: ["Op. Exentas", "Imp. Op. Exentas"],
  otrosTributos: ["Otros Tributos"],
  totalIva: ["Total IVA"],
  total: ["Imp. Total"],
};

// ==========================================
// PARSER PRINCIPAL
// ==========================================

/** Detecta si la fila es el encabezado real (la que dice "Fecha" y "Punto de Venta"). */
function looksLikeHeader(row: unknown[]): boolean {
  const cells = row.map(norm);
  return cells.some((c) => c.startsWith("fecha")) && cells.some((c) => c.includes("punto de venta"));
}

/**
 * Parsea filas ya leidas como matriz (lo que devuelve `XLSX.utils.sheet_to_json(..., {header:1})`
 * o el split del CSV). Sirve para los dos formatos porque ubica el encabezado por contenido.
 *
 * @param kind si el archivo es de recibidos (contraparte = emisor) o emitidos (= receptor).
 *             Si se omite, se deduce de las columnas presentes.
 */
export function parseComprobantesRows(
  rows: unknown[][],
  kind?: "recibidos" | "emitidos",
): ParseComprobantesResult {
  const warnings: string[] = [];
  let cuitPropio: string | null = null;

  // El Excel trae "Mis Comprobantes Recibidos - CUIT 30717077748" en la fila 0.
  let headerRow = -1;
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const joined = rows[i].map((c) => String(c ?? "")).join(" ");
    const m = joined.match(/cuit\s*:?\s*(\d{11})/i);
    if (m && !cuitPropio) cuitPropio = m[1];
    if (looksLikeHeader(rows[i])) {
      headerRow = i;
      break;
    }
  }

  if (headerRow === -1) {
    return {
      kind: kind ?? "recibidos",
      cuitPropio,
      comprobantes: [],
      warnings: ["No se encontró el encabezado del archivo. ¿Es un export de Mis Comprobantes?"],
    };
  }

  const index = buildHeaderIndex(rows[headerRow]);
  const col = (candidates: string[]) => findColumn(index, candidates);

  const emisorCol = col(COLUMNS.docNumeroEmisor);
  const resolvedKind: "recibidos" | "emitidos" = kind ?? (emisorCol >= 0 ? "recibidos" : "emitidos");

  // La contraparte es el emisor en recibidos y el receptor en emitidos.
  const cDocTipo = col(resolvedKind === "recibidos" ? COLUMNS.docTipoEmisor : COLUMNS.docTipoReceptor);
  const cDocNumero = col(resolvedKind === "recibidos" ? COLUMNS.docNumeroEmisor : COLUMNS.docNumeroReceptor);
  const cDenominacion = col(
    resolvedKind === "recibidos" ? COLUMNS.denominacionEmisor : COLUMNS.denominacionReceptor,
  );
  // En recibidos, el receptor somos nosotros: de ahi sale el CUIT propio si el titulo no estaba.
  const cPropio = resolvedKind === "recibidos" ? col(COLUMNS.docNumeroReceptor) : -1;

  const cFecha = col(COLUMNS.fecha);
  const cTipo = col(COLUMNS.tipo);
  const cPv = col(COLUMNS.puntoVenta);
  const cDesde = col(COLUMNS.numeroDesde);
  const cHasta = col(COLUMNS.numeroHasta);
  const cCae = col(COLUMNS.codigoAutorizacion);
  const cTotal = col(COLUMNS.total);

  if (cFecha < 0 || cTipo < 0 || cPv < 0 || cDesde < 0 || cTotal < 0) {
    return {
      kind: resolvedKind,
      cuitPropio,
      comprobantes: [],
      warnings: ["Faltan columnas obligatorias (fecha, tipo, punto de venta, número o importe total)."],
    };
  }

  const num = (row: unknown[], c: number) => (c >= 0 ? parseAfipAmount(row[c]) : 0);
  const int = (row: unknown[], c: number) => {
    if (c < 0) return 0;
    const n = parseInt(onlyDigits(row[c]) || "0", 10);
    return Number.isFinite(n) ? n : 0;
  };

  const comprobantes: ParsedComprobante[] = [];
  let descartadas = 0;
  const tiposDesconocidos = new Set<number>();

  for (let i = headerRow + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every((c) => String(c ?? "").trim() === "")) continue;

    const fecha = parseAfipDate(row[cFecha]);
    const tipoCodigo = parseVoucherTypeCode(row[cTipo]);
    if (!fecha || tipoCodigo == null) {
      descartadas++;
      continue;
    }

    if (!AFIP_VOUCHER_TYPES[tipoCodigo]) tiposDesconocidos.add(tipoCodigo);
    if (cPropio >= 0 && !cuitPropio) cuitPropio = onlyDigits(row[cPropio]) || null;

    comprobantes.push({
      fecha,
      tipoCodigo,
      tipoNombre: voucherTypeName(tipoCodigo),
      tipoSistema: voucherSystemType(tipoCodigo),
      puntoVenta: int(row, cPv),
      numeroDesde: int(row, cDesde),
      numeroHasta: int(row, cHasta >= 0 ? cHasta : cDesde),
      codigoAutorizacion: String(row[cCae] ?? "").trim(),
      docTipo: normalizeDocType(row[cDocTipo]),
      docNumero: onlyDigits(row[cDocNumero]),
      denominacion: String(row[cDenominacion] ?? "").trim(),
      moneda: String(row[col(COLUMNS.moneda)] ?? "$").trim() || "$",
      tipoCambio: num(row, col(COLUMNS.tipoCambio)) || 1,
      netoGravado: num(row, col(COLUMNS.netoGravado)),
      netoNoGravado: num(row, col(COLUMNS.netoNoGravado)),
      opExentas: num(row, col(COLUMNS.opExentas)),
      otrosTributos: num(row, col(COLUMNS.otrosTributos)),
      totalIva: num(row, col(COLUMNS.totalIva)),
      total: num(row, cTotal),
      ivaPorAlicuota: {
        neto0: num(row, col(COLUMNS.neto0)),
        iva2_5: num(row, col(COLUMNS.iva2_5)),
        neto2_5: num(row, col(COLUMNS.neto2_5)),
        iva5: num(row, col(COLUMNS.iva5)),
        neto5: num(row, col(COLUMNS.neto5)),
        iva10_5: num(row, col(COLUMNS.iva10_5)),
        neto10_5: num(row, col(COLUMNS.neto10_5)),
        iva21: num(row, col(COLUMNS.iva21)),
        neto21: num(row, col(COLUMNS.neto21)),
        iva27: num(row, col(COLUMNS.iva27)),
        neto27: num(row, col(COLUMNS.neto27)),
      },
    });
  }

  if (descartadas > 0) {
    warnings.push(`${descartadas} fila(s) sin fecha o sin tipo de comprobante: se ignoraron.`);
  }
  if (tiposDesconocidos.size > 0) {
    warnings.push(
      `Tipos de comprobante fuera del catálogo conocido: ${[...tiposDesconocidos].join(", ")}. ` +
        "Se importan igual, pero no se van a cruzar contra Facturas.",
    );
  }

  return { kind: resolvedKind, cuitPropio, comprobantes, warnings };
}

/**
 * Parsea el CSV de AFIP (separador ";", campos entre comillas dobles).
 * Se escribe a mano en vez de usar una libreria: el formato es fijo y asi el parser sirve
 * igual en el browser sin sumar dependencias.
 */
export function parseComprobantesCsv(
  text: string,
  kind?: "recibidos" | "emitidos",
): ParseComprobantesResult {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === ";") pushField();
    else if (ch === "\n") pushRow();
    else if (ch !== "\r") field += ch;
  }
  if (field !== "" || row.length > 0) pushRow();

  return parseComprobantesRows(rows, kind);
}

/**
 * Decodifica el CSV de AFIP. El export viene en UTF-8 sin BOM, pero si el usuario lo abrio y
 * lo volvio a guardar con Excel puede llegar en Windows-1252. Se prueba UTF-8 estricto y, si
 * los bytes no son UTF-8 valido, se cae a Windows-1252.
 */
export function decodeAfipCsv(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

/** Nombre de archivo del CSV de AFIP: trae el CUIT propio y si es recibidos o emitidos. */
export function readCsvFileNameHints(fileName: string): {
  kind: "recibidos" | "emitidos" | null;
  cuit: string | null;
} {
  const lower = fileName.toLowerCase();
  const kind = lower.includes("recibidos") ? "recibidos" : lower.includes("emitidos") ? "emitidos" : null;
  // ..._recibidos_206775526_30717077748_20260826-0936...: el CUIT es el grupo de 11 digitos.
  // Sin \b: los grupos van separados por guion bajo, que cuenta como caracter de palabra.
  const cuits = fileName.match(/(?<!\d)\d{11}(?!\d)/g);
  return { kind, cuit: cuits && cuits.length > 0 ? cuits[cuits.length - 1] : null };
}

// ==========================================
// AGREGACION DE EMITIDOS
// ==========================================

export interface EmitidoAggregate {
  fecha: string;
  puntoVenta: number;
  tipoCodigo: number;
  tipoNombre: string;
  cantidad: number;
  netoGravado: number;
  netoNoGravado: number;
  opExentas: number;
  otrosTributos: number;
  totalIva: number;
  total: number;
}

/**
 * Los emitidos se guardan RESUMIDOS por dia + punto de venta + tipo, no comprobante por
 * comprobante: una sola sociedad emite ~11.000 por mes y guardarlos al detalle multiplicaria
 * por 40 las filas sin agregar informacion que se use (ver la decision del 26-ago).
 * El detalle igual se ve en la previa de la importacion, antes de confirmar.
 */
export function aggregateEmitidos(comprobantes: ParsedComprobante[]): EmitidoAggregate[] {
  const map = new Map<string, EmitidoAggregate>();

  for (const c of comprobantes) {
    const key = `${c.fecha}|${c.puntoVenta}|${c.tipoCodigo}`;
    let agg = map.get(key);
    if (!agg) {
      agg = {
        fecha: c.fecha,
        puntoVenta: c.puntoVenta,
        tipoCodigo: c.tipoCodigo,
        tipoNombre: c.tipoNombre,
        cantidad: 0,
        netoGravado: 0,
        netoNoGravado: 0,
        opExentas: 0,
        otrosTributos: 0,
        totalIva: 0,
        total: 0,
      };
      map.set(key, agg);
    }
    agg.cantidad += 1;
    agg.netoGravado += c.netoGravado;
    agg.netoNoGravado += c.netoNoGravado;
    agg.opExentas += c.opExentas;
    agg.otrosTributos += c.otrosTributos;
    agg.totalIva += c.totalIva;
    agg.total += c.total;
  }

  const round2 = (n: number) => Math.round(n * 100) / 100;
  return [...map.values()]
    .map((a) => ({
      ...a,
      netoGravado: round2(a.netoGravado),
      netoNoGravado: round2(a.netoNoGravado),
      opExentas: round2(a.opExentas),
      otrosTributos: round2(a.otrosTributos),
      totalIva: round2(a.totalIva),
      total: round2(a.total),
    }))
    .sort((a, b) =>
      a.fecha !== b.fecha
        ? a.fecha.localeCompare(b.fecha)
        : a.puntoVenta !== b.puntoVenta
          ? a.puntoVenta - b.puntoVenta
          : a.tipoCodigo - b.tipoCodigo,
    );
}
