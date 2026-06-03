import XLSX from "xlsx";

export interface ParsedTransaction {
  date: string; // YYYY-MM-DD format
  description: string;
  description2?: string;
  counterpartyRef?: string;
  amount: number;
  type: "income" | "expense";
  rawData?: Record<string, any>;
  grossAmount?: number;
  commission?: number;
  taxWithholding?: number;
  branchName?: string;
  /** Fila Excel (1-based) para conciliación / overrides Mercado Pago */
  excelRow?: number;
  /** Mercado Pago (desglose ×3): componente de la línea emitida */
  mpLineKind?: "gross" | "commission" | "tax" | "adjustment";
}

export interface ParseResult {
  transactions: ParsedTransaction[];
  skipped: number;
  skippedReasons: string[];
  total: number;
  openingBalance?: number | null;
  closingBalance?: number | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  /** Mercado Pago: valor «Saldo disponible total» / dinero disponible detectado en el archivo */
  saldoDisponibleTotal?: number | null;
  /** Mercado Pago: suma de brutos (columna H) por fila importada — sólo informativo */
  sumGrossImportable?: number;
  /** Mercado Pago: suma algebraica de todas las líneas emitidas (bruto+comisión+impuesto+ajuste); debe coincidir con saldoDisponibleTotal */
  sumNetImportable?: number;
}

/** Resultado de `parseBbvaWorkbook` (incluye saldo inicial leído del encabezado del Excel). */
export interface BbvaWorkbookParseResult extends ParseResult {
  openingBalance: number | null;
}

const MAX_SKIP_REASONS_DETAIL = 80;

function pushSkipReason(reasons: string[], message: string) {
  if (reasons.length < MAX_SKIP_REASONS_DETAIL) {
    reasons.push(message);
  }
}

/**
 * Mapeo manual de columnas para el "Banco genérico" (ROADMAP_BETA Fase 2).
 * Índices de columna 0-based dentro de la hoja del extracto.
 */
export interface GenericColumnMapping {
  /** Filas de encabezado a saltar antes de los datos (default 1). */
  headerRows?: number;
  /** Columna de fecha (obligatoria). */
  dateCol: number;
  /** Primera columna de descripción. */
  desc1Col?: number;
  /** Segunda columna de descripción. */
  desc2Col?: number;
  /** Columna de débitos (egresos). */
  debitCol?: number;
  /** Columna de créditos (ingresos). */
  creditCol?: number;
  /** Alternativa a débito/crédito: una sola columna con monto con signo. */
  amountCol?: number;
}

export interface ParserOptions {
  /** Mercado Pago: override de MONTO BRUTO por número de fila Excel (string del entero, ej. "234") */
  grossOverridesByExcelRow?: Record<string, number>;
  /** Banco genérico: mapeo manual de columnas. Si está presente, se usa en vez del auto-detect. */
  columnMapping?: GenericColumnMapping | null;
}

export interface BankParser {
  bankId: string;
  bankName: string;
  parse(rawData: any[][], options?: ParserOptions): ParseResult;
}

function parseArgentineNumber(value: any): number {
  if (typeof value === "number") return value;
  if (!value) return 0;
  
  const str = String(value).trim();
  if (!str) return 0;
  
  const cleaned = str
    .replace(/\$/g, "")
    .replace(/\s/g, "")
    .replace(/\./g, "")
    .replace(/,/g, ".");
  
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

/** Montos en columnas BBVA: con coma AR (1.234,56) o con punto decimal (-169886.82). */
function parseBbvaAmount(value: any): number {
  if (typeof value === "number") return value;
  if (value === null || value === undefined) return 0;
  const str = String(value).trim().replace(/\$/g, "").replace(/\s/g, "");
  if (!str) return 0;
  if (str.includes(",")) {
    return parseArgentineNumber(str);
  }
  const n = parseFloat(str);
  return isNaN(n) ? 0 : n;
}

function normalizeHeaderCell(value: any): string {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

/** Saldo inicial típico en extractos BBVA (fila tipo "Saldo:" antes de la tabla de movimientos). */
function extractBbvaOpeningBalance(rawData: any[][]): number | null {
  const len = Math.min(40, rawData?.length ?? 0);
  for (let r = 0; r < len; r++) {
    const row = rawData[r];
    if (!row?.length) continue;
    const label = normalizeHeaderCell(row[0]);
    if (!label || !label.includes("saldo")) continue;
    if (
      label.includes("parcial") ||
      label.includes("disponible") ||
      label.includes("minimo") ||
      label.includes("movimientos de")
    ) {
      continue;
    }
    const n = parseBbvaAmount(row[1]);
    if (n !== 0 && !Number.isNaN(n)) return n;
  }
  return null;
}

function parseExcelDate(value: any): string | null {
  if (!value) return null;
  
  if (typeof value === "number") {
    try {
      const excelDate = XLSX.SSF.parse_date_code(value);
      if (excelDate) {
        return `${excelDate.y}-${String(excelDate.m).padStart(2, "0")}-${String(excelDate.d).padStart(2, "0")}`;
      }
    } catch {
      return null;
    }
  }
  
  const dateStr = String(value).trim();
  
  const ddmmyyyySlash = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (ddmmyyyySlash) {
    const [_, d, m, y] = ddmmyyyySlash;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  
  const ddmmyyyyDash = dateStr.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (ddmmyyyyDash) {
    const [_, d, m, y] = ddmmyyyyDash;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  
  const yyyymmdd = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (yyyymmdd) {
    return dateStr;
  }
  
  return null;
}

function normalizeIdentifier(raw: string): string {
  return raw.toLowerCase().replace(/\s+/g, "").trim();
}

function extractCounterpartyRef(value: string): string | null {
  const v = String(value || "").trim();
  if (!v) return null;

  // CBU/CVU (22 dígitos) o CUIT (11 dígitos) dentro del texto
  const digits = v.replace(/\D/g, "");
  if (digits.length === 22) return digits;
  if (digits.length === 11) return digits;

  // Alias/identificador: si parece email-like o contiene puntos/guiones y es "corto"
  const norm = normalizeIdentifier(v);
  if (norm.length >= 6 && norm.length <= 40 && /[a-z]/.test(norm) && /\d/.test(norm)) {
    return v;
  }

  return null;
}

class GaliciaParser implements BankParser {
  bankId = "galicia";
  bankName = "Banco Galicia";
  
  parse(rawData: any[][], _options?: ParserOptions): ParseResult {
    const transactions: ParsedTransaction[] = [];
    const skippedReasons: string[] = [];
    let skipped = 0;
    
    if (rawData.length < 2) {
      return { transactions, skipped: 0, skippedReasons: ["Archivo vacío"], total: 0 };
    }
    
    const headers = (rawData[0] as string[]).map(h => 
      String(h || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim()
    );
    
    let dateIdx = headers.findIndex(h => 
      h.includes("fecha") || h === "f.mov" || h === "fmov" || h === "fecha mov"
    );
    let descIdx = headers.findIndex(h => 
      h.includes("concepto") || h.includes("descripcion") || h.includes("detalle") || h.includes("movimiento")
    );
    // Segunda descripción (columna K típica)
    let desc2Idx = headers.findIndex((h) => h.includes("descripcion 2") || h.includes("detalle 2") || h.includes("referencia"));
    let debitIdx = headers.findIndex(h => 
      h.includes("debito") || h === "debe" || h.includes("egreso")
    );
    let creditIdx = headers.findIndex(h => 
      h.includes("credito") || h === "haber" || h.includes("ingreso")
    );
    const saldoIdx = headers.findIndex((h) => h === "saldo" || h.includes("saldo"));
    
    if (dateIdx === -1) {
      for (let i = 0; i < Math.min(headers.length, 5); i++) {
        const firstDataRow = rawData[1];
        if (firstDataRow && parseExcelDate(firstDataRow[i])) {
          dateIdx = i;
          break;
        }
      }
    }
    
    if (descIdx === -1) descIdx = dateIdx + 1;
    if (desc2Idx === -1) desc2Idx = 10; // K
    
    if (debitIdx === -1 && creditIdx === -1) {
      for (let i = 0; i < headers.length; i++) {
        const h = headers[i];
        if (h.includes("debito") || h === "debitos") debitIdx = i;
        if (h.includes("credito") || h === "creditos") creditIdx = i;
      }
    }
    
    const total = rawData.length - 1;
    let openingBalance: number | null = null;
    let closingBalance: number | null = null;
    
    for (let i = 1; i < rawData.length; i++) {
      const row = rawData[i];
      if (!row || row.length === 0) {
        skipped++;
        skippedReasons.push(`Fila ${i + 1}: Fila vacía`);
        continue;
      }
      
      const dateValue = parseExcelDate(row[dateIdx]);
      const description = String(row[descIdx] || "").trim();
      const description2 = String(row[desc2Idx] || "").trim();
      
      if (!dateValue) {
        skipped++;
        skippedReasons.push(`Fila ${i + 1}: Fecha inválida "${row[dateIdx]}"`);
        continue;
      }
      
      if (!description) {
        skipped++;
        skippedReasons.push(`Fila ${i + 1}: Sin descripción`);
        continue;
      }
      
      const debitVal = debitIdx !== -1 ? parseArgentineNumber(row[debitIdx]) : 0;
      const creditVal = creditIdx !== -1 ? parseArgentineNumber(row[creditIdx]) : 0;
      const saldoVal =
        saldoIdx !== -1 && row[saldoIdx] != null ? parseArgentineNumber(row[saldoIdx]) : 0;
      
      let amount = 0;
      let type: "income" | "expense" = "expense";
      
      if (creditVal > 0) {
        amount = creditVal;
        type = "income";
      } else if (debitVal > 0) {
        amount = debitVal;
        type = "expense";
      } else {
        skipped++;
        skippedReasons.push(`Fila ${i + 1}: Sin monto (débito: ${row[debitIdx]}, crédito: ${row[creditIdx]})`);
        continue;
      }

      // Si el archivo tiene columna "Saldo", deducimos el saldo inicial desde el primer movimiento
      // saldo_despues = saldo_antes - debito + credito
      // => saldo_antes = saldo_despues + debito - credito
      if (openingBalance === null && saldoVal !== 0) {
        openingBalance = saldoVal + debitVal - creditVal;
      }
      if (saldoVal !== 0) {
        closingBalance = saldoVal;
      }
      
      transactions.push({
        date: dateValue,
        description,
        description2: description2 || undefined,
        counterpartyRef: extractCounterpartyRef(description2) ?? undefined,
        amount,
        type,
        rawData: { rowIndex: i, debit: debitVal, credit: creditVal, saldo: saldoVal }
      });
    }
    
    const periodStart =
      transactions.length > 0
        ? transactions.reduce((min, t) => (t.date < min ? t.date : min), transactions[0].date)
        : null;
    const periodEnd =
      transactions.length > 0
        ? transactions.reduce((max, t) => (t.date > max ? t.date : max), transactions[0].date)
        : null;

    return {
      transactions,
      skipped,
      skippedReasons,
      total,
      openingBalance,
      closingBalance,
      periodStart,
      periodEnd,
    };
  }
}

class GenericParser implements BankParser {
  bankId = "generic";
  bankName = "Genérico (Auto-detectar)";

  parse(rawData: any[][], options?: ParserOptions): ParseResult {
    const mapping = options?.columnMapping;
    if (mapping && typeof mapping.dateCol === "number") {
      return this.parseWithMapping(rawData, mapping);
    }

    const transactions: ParsedTransaction[] = [];
    const skippedReasons: string[] = [];
    let skipped = 0;
    
    if (rawData.length < 2) {
      return { transactions, skipped: 0, skippedReasons: ["Archivo vacío"], total: 0 };
    }
    
    const headers = (rawData[0] as string[]).map(h => 
      String(h || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim()
    );
    
    const dateColNames = ["fecha", "date", "fecha_movimiento", "fecha movimiento", "f.mov", "fmov"];
    const descColNames = ["descripcion", "description", "concepto", "detalle", "movimiento", "desc"];
    const amountColNames = ["monto", "amount", "importe", "valor"];
    const debitColNames = ["debito", "debitos", "debe", "egreso", "salida", "cargo"];
    const creditColNames = ["credito", "creditos", "haber", "ingreso", "entrada", "abono"];
    
    let dateIdx = headers.findIndex(h => dateColNames.some(n => h.includes(n)));
    let descIdx = headers.findIndex(h => descColNames.some(n => h.includes(n)));
    let amountIdx = headers.findIndex(h => amountColNames.some(n => h.includes(n)));
    let debitIdx = headers.findIndex(h => debitColNames.some(n => h.includes(n)));
    let creditIdx = headers.findIndex(h => creditColNames.some(n => h.includes(n)));
    
    if (dateIdx === -1) dateIdx = 0;
    if (descIdx === -1) descIdx = 1;
    
    const hasSeparateColumns = debitIdx !== -1 || creditIdx !== -1;
    const total = rawData.length - 1;
    
    for (let i = 1; i < rawData.length; i++) {
      const row = rawData[i];
      if (!row || row.length === 0) {
        skipped++;
        continue;
      }
      
      const dateValue = parseExcelDate(row[dateIdx]);
      const description = String(row[descIdx] || "").trim();
      
      if (!dateValue) {
        skipped++;
        skippedReasons.push(`Fila ${i + 1}: Fecha inválida`);
        continue;
      }
      
      let amount = 0;
      let type: "income" | "expense" = "expense";
      
      if (hasSeparateColumns) {
        const debitVal = debitIdx !== -1 ? parseArgentineNumber(row[debitIdx]) : 0;
        const creditVal = creditIdx !== -1 ? parseArgentineNumber(row[creditIdx]) : 0;
        
        if (creditVal > 0) {
          amount = creditVal;
          type = "income";
        } else if (debitVal > 0) {
          amount = debitVal;
          type = "expense";
        } else {
          skipped++;
          continue;
        }
      } else if (amountIdx !== -1) {
        const rawAmount = parseArgentineNumber(row[amountIdx]);
        if (rawAmount === 0) {
          skipped++;
          continue;
        }
        amount = Math.abs(rawAmount);
        type = rawAmount > 0 ? "income" : "expense";
      } else {
        skipped++;
        skippedReasons.push(`Fila ${i + 1}: No se encontró columna de monto`);
        continue;
      }
      
      transactions.push({
        date: dateValue,
        description: description || "Movimiento importado",
        amount,
        type
      });
    }
    
    return { transactions, skipped, skippedReasons, total };
  }

  /**
   * Parseo con mapeo manual de columnas (Banco genérico, ROADMAP_BETA Fase 2).
   * Usa índices 0-based explícitos en vez de auto-detectar por encabezado.
   */
  parseWithMapping(rawData: any[][], mapping: GenericColumnMapping): ParseResult {
    const transactions: ParsedTransaction[] = [];
    const skippedReasons: string[] = [];
    let skipped = 0;

    const headerRows = Number.isFinite(mapping.headerRows) ? Math.max(0, Number(mapping.headerRows)) : 1;
    if (rawData.length <= headerRows) {
      return { transactions, skipped: 0, skippedReasons: ["Archivo vacío"], total: 0 };
    }

    const hasDebitCredit =
      typeof mapping.debitCol === "number" || typeof mapping.creditCol === "number";
    const total = rawData.length - headerRows;

    for (let i = headerRows; i < rawData.length; i++) {
      const row = rawData[i];
      if (!row || row.length === 0) {
        skipped++;
        continue;
      }

      const dateValue = parseExcelDate(row[mapping.dateCol]);
      if (!dateValue) {
        skipped++;
        pushSkipReason(skippedReasons, `Fila ${i + 1}: Fecha inválida`);
        continue;
      }

      const desc1 =
        typeof mapping.desc1Col === "number" ? String(row[mapping.desc1Col] ?? "").trim() : "";
      const desc2 =
        typeof mapping.desc2Col === "number" ? String(row[mapping.desc2Col] ?? "").trim() : "";

      let amount = 0;
      let type: "income" | "expense" = "expense";

      if (hasDebitCredit) {
        const debitVal =
          typeof mapping.debitCol === "number" ? parseArgentineNumber(row[mapping.debitCol]) : 0;
        const creditVal =
          typeof mapping.creditCol === "number" ? parseArgentineNumber(row[mapping.creditCol]) : 0;
        if (creditVal !== 0) {
          amount = Math.abs(creditVal);
          type = "income";
        } else if (debitVal !== 0) {
          amount = Math.abs(debitVal);
          type = "expense";
        } else {
          skipped++;
          continue;
        }
      } else if (typeof mapping.amountCol === "number") {
        const rawAmount = parseArgentineNumber(row[mapping.amountCol]);
        if (rawAmount === 0) {
          skipped++;
          continue;
        }
        amount = Math.abs(rawAmount);
        type = rawAmount > 0 ? "income" : "expense";
      } else {
        skipped++;
        pushSkipReason(skippedReasons, `Fila ${i + 1}: Mapeo sin columna de monto (débito/crédito o monto)`);
        continue;
      }

      transactions.push({
        date: dateValue,
        description: desc1 || "Movimiento importado",
        description2: desc2 || undefined,
        amount,
        type,
      });
    }

    return { transactions, skipped, skippedReasons, total };
  }
}

/** Solo históricos: la solapa "del día" repite movimientos ya incluidos aquí. */
const BBVA_MOVEMENT_SHEETS = ["Movimientos Históricos"];

/** Layout fijo extractos BBVA: A Fecha, C Concepto, G Créditos, H Débitos (índices 0-based). */
const BBVA_COL_FECHA = 0;
const BBVA_COL_CONCEPTO = 2;
const BBVA_COL_CREDITO = 6;
const BBVA_COL_DEBITO = 7;

class BbvaParser implements BankParser {
  bankId = "bbva";
  bankName = "Banco BBVA";

  parse(rawData: any[][], _options?: ParserOptions): ParseResult {
    const transactions: ParsedTransaction[] = [];
    const skippedReasons: string[] = [];
    let skipped = 0;

    if (!rawData || rawData.length < 2) {
      return { transactions, skipped: 0, skippedReasons: ["Archivo vacío"], total: 0 };
    }

    const headerRowIdx = this.findHeaderRow(rawData);
    if (headerRowIdx === -1) {
      return {
        transactions,
        skipped: rawData.length,
        skippedReasons: ["No se encontró la fila de encabezados (Fecha / Concepto / Crédito / Débito)."],
        total: Math.max(0, rawData.length - 1),
      };
    }

    const headerRow = rawData[headerRowIdx] as any[];
    if (!this.headerRowMatchesBbvaLayout(headerRow)) {
      return {
        transactions,
        skipped: rawData.length - headerRowIdx - 1,
        skippedReasons: [
          "La fila de encabezados no coincide con el layout BBVA esperado (columnas A,C,G,H).",
        ],
        total: Math.max(0, rawData.length - headerRowIdx - 1),
      };
    }

    const total = Math.max(0, rawData.length - headerRowIdx - 1);

    for (let i = headerRowIdx + 1; i < rawData.length; i++) {
      const row = rawData[i];
      if (!row || row.length === 0) {
        skipped++;
        continue;
      }

      const dateValue = parseExcelDate(row[BBVA_COL_FECHA]);
      const description = String(row[BBVA_COL_CONCEPTO] ?? "").trim();

      const debitRaw = parseBbvaAmount(row[BBVA_COL_DEBITO]);
      const creditRaw = parseBbvaAmount(row[BBVA_COL_CREDITO]);

      const debitAbs = debitRaw !== 0 ? Math.abs(debitRaw) : 0;
      const creditAbs = creditRaw > 0 ? creditRaw : 0;

      if (!dateValue) {
        skipped++;
        skippedReasons.push(`Fila ${i + 1}: Fecha inválida`);
        continue;
      }

      if (creditAbs === 0 && debitAbs === 0) {
        skipped++;
        continue;
      }

      let amount = 0;
      let type: "income" | "expense" = "expense";

      if (creditAbs > 0) {
        amount = creditAbs;
        type = "income";
      } else if (debitAbs > 0) {
        amount = debitAbs;
        type = "expense";
      } else {
        skipped++;
        continue;
      }

      transactions.push({
        date: dateValue,
        description: description || "Movimiento BBVA",
        amount,
        type,
        rawData: { rowIndex: i, sheetRow: i + 1 },
      });
    }

    return { transactions, skipped, skippedReasons, total };
  }

  /** Confirma que la fila cabecera tiene texto esperado en A y crédito/débito en G/H. */
  private headerRowMatchesBbvaLayout(headerRow: any[]): boolean {
    const a = normalizeHeaderCell(headerRow[BBVA_COL_FECHA]);
    const g = normalizeHeaderCell(headerRow[BBVA_COL_CREDITO]);
    const h = normalizeHeaderCell(headerRow[BBVA_COL_DEBITO]);
    const fechaOk =
      a === "fecha" || (a.includes("fecha") && !a.includes("valor"));
    const creditoOk = g.includes("credito");
    const debitoOk = h.includes("debito");
    return fechaOk && creditoOk && debitoOk;
  }

  private findHeaderRow(rawData: any[][]): number {
    const maxScan = Math.min(rawData.length, 50);
    for (let r = 0; r < maxScan; r++) {
      const row = rawData[r];
      if (!row || row.length === 0) continue;
      const headers = row.map(normalizeHeaderCell);
      const hasConcepto = headers[BBVA_COL_CONCEPTO]?.includes("concepto");
      const hasDebito = headers[BBVA_COL_DEBITO]?.includes("debito");
      const hasCredito = headers[BBVA_COL_CREDITO]?.includes("credito");
      const hasFecha =
        headers[BBVA_COL_FECHA] === "fecha" ||
        (headers[BBVA_COL_FECHA]?.includes("fecha") &&
          !headers[BBVA_COL_FECHA]?.includes("valor"));
      if (hasFecha && hasConcepto && hasCredito && hasDebito) {
        return r;
      }
    }
    return -1;
  }
}

export function parseBbvaWorkbook(workbook: XLSX.WorkBook): BbvaWorkbookParseResult {
  const parser = new BbvaParser();
  const namesInBook = workbook.SheetNames;
  const orderedSheets = BBVA_MOVEMENT_SHEETS.filter((n) => namesInBook.includes(n));

  const sheetsToParse =
    orderedSheets.length > 0
      ? orderedSheets
      : namesInBook.length > 0
        ? [namesInBook[0]]
        : [];

  if (sheetsToParse.length === 0) {
    return {
      transactions: [],
      skipped: 0,
      skippedReasons: ["El libro no tiene hojas"],
      total: 0,
      openingBalance: null,
    };
  }

  let merged: ParsedTransaction[] = [];
  let skipped = 0;
  const skippedReasons: string[] = [];
  let totalRows = 0;
  let openingBalance: number | null = null;

  for (const sheetName of sheetsToParse) {
    const sheet = workbook.Sheets[sheetName];
    const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];
    if (openingBalance === null) {
      const ob = extractBbvaOpeningBalance(rawData);
      if (ob !== null) openingBalance = ob;
    }
    const part = parser.parse(rawData);
    merged.push(...part.transactions);
    skipped += part.skipped;
    skippedReasons.push(...part.skippedReasons);
    totalRows += part.total;
  }

  // No deduplicar por (fecha+monto+concepto): en un mismo extracto pueden existir varias
  // líneas legítimas idénticas (mismo concepto importe y día). El dedupe entre hojas ya no aplica
  // al usar solo "Movimientos Históricos".
  return {
    transactions: merged,
    skipped,
    skippedReasons: skippedReasons.slice(0, 25),
    total: totalRows,
    openingBalance,
    periodStart:
      merged.length > 0 ? merged.reduce((min, t) => (t.date < min ? t.date : min), merged[0].date) : null,
    periodEnd:
      merged.length > 0 ? merged.reduce((max, t) => (t.date > max ? t.date : max), merged[0].date) : null,
  };
}

/**
 * Montos en extractos MP: a veces internacional (1234.56), a veces AR en filas de totales (4.365.492,34).
 */
export function parseMercadoPagoExcelNumber(value: any): number {
  if (typeof value === "number" && !Number.isNaN(value)) return value;
  if (value === null || value === undefined) return 0;
  const str = String(value).trim();
  if (!str) return 0;
  const s = str.replace(/\$/g, "").replace(/\s/g, "");

  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  // Coma como decimal (formato AR u otros): la coma va después de los puntos de miles
  if (lastComma > lastDot && lastComma !== -1) {
    const normalized = s.replace(/\./g, "").replace(",", ".");
    const n = parseFloat(normalized);
    return isNaN(n) ? 0 : n;
  }

  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function normalizeMpRowText(row: any[]): string {
  return row
    .map((c) =>
      String(c || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, ""),
    )
    .join(" ");
}

/**
 * Determina si la fila corresponde al total de saldo disponible (variantes MP / reportes release).
 */
function rowMatchesMpSaldoDisponibleTotalLabel(joined: string): boolean {
  if (!joined.trim()) return false;
  // Español (varias redacciones)
  if (joined.includes("saldo disponible total")) return true;
  if (joined.includes("saldo total disponible")) return true;
  if (joined.includes("total saldo disponible")) return true;
  if (joined.includes("dinero disponible total")) return true;
  if (joined.includes("saldo disponible") && joined.includes("total")) return true;
  if (joined.includes("dinero disponible") && joined.includes("total")) return true;
  // Reportes tipo "release" / panel en inglés
  if (joined.includes("total available balance")) return true;
  if (joined.includes("available balance total")) return true;
  if (joined.includes("available balance") && joined.includes("total")) return true;
  if (joined.includes("current available balance")) return true;
  if (joined.includes("total disponible")) return true;
  if (joined.includes("balance") && joined.includes("total") && joined.includes("available")) return true;
  // Abreviaturas poco frecuentes
  if (joined.includes("saldo") && joined.includes("disp") && joined.includes("total")) return true;
  return false;
}

/**
 * Busca fila de totales «Saldo disponible total» en el extracto MP (incl. formato numérico AR en la celda).
 * Si `netCreditIdx` >= 0, prioriza esa columna (p. ej. F «MONTO NETO ACREDITADO») porque la fila de totales
 * también trae sumatoria de brutos en H y el primer número no nulo podría ser el bruto total, no el saldo.
 */
export function extractMpSaldoDisponibleTotal(
  rawData: any[][],
  grossIdx: number,
  netCreditIdx: number = -1,
): number | null {
  let lastMatch: number | null = null;

  const tryRowValue = (row: any[]): number => {
    if (netCreditIdx >= 0 && netCreditIdx < row.length) {
      const vNet = parseMercadoPagoExcelNumber(row[netCreditIdx]);
      if (Math.abs(vNet) > 1e-9) return vNet;
    }
    let val = parseMercadoPagoExcelNumber(row[grossIdx]);
    if (Math.abs(val) > 1e-9) return val;
    for (let c = 0; c < row.length; c++) {
      const tryVal = parseMercadoPagoExcelNumber(row[c]);
      if (Math.abs(tryVal) > 1e-9) return tryVal;
    }
    return 0;
  };

  for (let r = 0; r < rawData.length; r++) {
    const row = rawData[r];
    if (!row?.length) continue;
    const joined = normalizeMpRowText(row);
    if (!rowMatchesMpSaldoDisponibleTotalLabel(joined)) continue;

    let val = tryRowValue(row);
    const labelRowHasAnyNumber = row.some((c) => Math.abs(parseMercadoPagoExcelNumber(c)) > 1e-9);
    // Etiqueta sola y monto en la fila siguiente (algunos layouts)
    if (Math.abs(val) < 1e-9 && !labelRowHasAnyNumber && r + 1 < rawData.length) {
      val = tryRowValue(rawData[r + 1]);
    }
    if (Math.abs(val) > 1e-9) lastMatch = val;
  }

  return lastMatch;
}

/** Comparación exacta al centavo (evita ruido float). */
export function mpAmountsMatchCent(a: number, b: number): boolean {
  return Math.round(a * 100) === Math.round(b * 100);
}

/**
 * Hasta `max` filas candidatas a corrección manual cuando la suma de brutos no
 * coincide con el «Saldo disponible total» del archivo. Prioriza brutos sospechosos
 * (≈ 0 con descripción real) y luego las de mayor |bruto|.
 */
export function pickMercadoPagoReconciliationCandidates(
  transactions: ParsedTransaction[],
  max = 10,
): ParsedTransaction[] {
  const gross = transactions.filter((t) => t.mpLineKind === "gross" || t.mpLineKind === undefined);
  const suspicious = gross.filter(
    (t) =>
      Math.abs(t.grossAmount ?? 0) < 1e-8 &&
      String(t.description || "").trim().length > 1 &&
      !String(t.description || "")
        .toLowerCase()
        .includes("saldo inicial"),
  );
  const bySize = [...gross].sort(
    (a, b) => Math.abs(b.grossAmount ?? 0) - Math.abs(a.grossAmount ?? 0),
  );
  const seen = new Set<number>();
  const out: ParsedTransaction[] = [];
  for (const t of [...suspicious, ...bySize]) {
    const er = t.excelRow ?? -1;
    if (er < 0 || seen.has(er)) continue;
    seen.add(er);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

const MP_FIXED_COMMISSION_DESC = "Comisión Mercado Pago";

class MercadoPagoParser implements BankParser {
  bankId = "mercadopago";
  bankName = "Mercado Pago";

  parse(rawData: any[][], options?: ParserOptions): ParseResult {
    const transactions: ParsedTransaction[] = [];
    const skippedReasons: string[] = [];
    let skipped = 0;
    const grossOverrides = options?.grossOverridesByExcelRow ?? {};
    const EPS = 1e-8;

    if (rawData.length < 2) {
      return { transactions, skipped: 0, skippedReasons: ["Archivo vacío"], total: 0 };
    }

    const headers = (rawData[0] as string[]).map((h) => String(h || "").toUpperCase().trim());

    const dateIdx = headers.findIndex((h) => h.includes("FECHA DE LIBERACIÓN") || h.includes("FECHA DE LIBERACION"));
    const descIdx = headers.findIndex((h) => h === "DESCRIPCIÓN" || h === "DESCRIPCION");
    const mediopagoIdx = headers.findIndex((h) => h.includes("MEDIO DE PAGO"));
    const grossIdx = headers.findIndex((h) => h.includes("MONTO BRUTO"));
    const commissionIdx = headers.findIndex(
      (h) => h.includes("COMISIÓN DE MERCADO PAGO") || h.includes("COMISION DE MERCADO PAGO"),
    );
    const taxIdx = headers.findIndex((h) => h.includes("RETENCIONES IIBB"));
    const taxDetailIdx = headers.findIndex((h) => h.includes("DETALLE DE IMPUESTOS"));
    const branchIdx = headers.findIndex((h) => h.includes("NOMBRE DE LA SUCURSAL"));
    const netCreditIdx = headers.findIndex(
      (h) => h.includes("MONTO NETO ACREDITADO") || h === "MONTO NETO ACREDITADO",
    );
    const netDebitIdx = headers.findIndex(
      (h) => h.includes("MONTO NETO DEBITADO") || h === "MONTO NETO DEBITADO",
    );

    if (dateIdx === -1 || grossIdx === -1) {
      console.log("[MP Parser] Missing required columns! All headers:", headers);
      return {
        transactions,
        skipped: rawData.length - 1,
        skippedReasons: [`No se encontraron columnas requeridas. Headers: ${headers.slice(0, 5).join(", ")}...`],
        total: rawData.length - 1,
      };
    }

    const saldoDisponibleTotal = extractMpSaldoDisponibleTotal(rawData, grossIdx, netCreditIdx);

    const total = rawData.length - 1;
    let openingBalance: number | null = null;
    let closingBalance: number | null = null;
    let periodStart: string | null = null;
    let periodEnd: string | null = null;
    let sumGrossImportable = 0;

    const summaryDescriptions = [
      "dinero disponible del período anterior",
      "dinero disponible del periodo anterior",
      "saldo inicial",
      "saldo final",
      "total del período",
      "total del periodo",
    ];

    for (let i = 1; i < rawData.length; i++) {
      const row = rawData[i];
      if (!row || row.length === 0) {
        skipped++;
        pushSkipReason(skippedReasons, `Fila ${i + 1}: Fila vacía`);
        continue;
      }

      const excelRow = i + 1;
      const descText = descIdx !== -1 ? String(row[descIdx] || "").trim() : "";
      const descLower = descText.toLowerCase();
      if (summaryDescriptions.some((s) => descLower.includes(s))) {
        const n = this.parseNumber(row[grossIdx]);
        if (
          descLower.includes("saldo inicial") ||
          descLower.includes("periodo anterior") ||
          descLower.includes("período anterior")
        ) {
          if (n !== 0) openingBalance = n;
        }
        if (descLower.includes("saldo final")) {
          if (n !== 0) closingBalance = n;
        }
        skipped++;
        pushSkipReason(skippedReasons, `Fila ${i + 1}: Fila de resumen/saldo (${descText})`);
        continue;
      }

      const dateValue = this.parseISODate(row[dateIdx]);
      if (!dateValue) {
        skipped++;
        pushSkipReason(skippedReasons, `Fila ${i + 1}: Fecha inválida "${row[dateIdx]}"`);
        continue;
      }

      const ov = grossOverrides[String(excelRow)];
      let grossH =
        ov !== undefined && Number.isFinite(Number(ov)) ? Number(ov) : this.parseNumber(row[grossIdx]);
      const jRaw = commissionIdx !== -1 ? this.parseNumber(row[commissionIdx]) : 0;
      const mRaw = taxIdx !== -1 ? this.parseNumber(row[taxIdx]) : 0;
      const jAbs = Math.abs(jRaw);
      const mAbs = Math.abs(mRaw);
      const netCredit = netCreditIdx !== -1 ? this.parseNumber(row[netCreditIdx]) : 0;
      const netDebit = netDebitIdx !== -1 ? this.parseNumber(row[netDebitIdx]) : 0;
      const netTarget = netCredit - netDebit;

      if (Math.abs(netTarget) < EPS && Math.abs(grossH) < EPS && jAbs < EPS && mAbs < EPS) {
        skipped++;
        pushSkipReason(skippedReasons, `Fila ${i + 1}: Sin importes (bruto/comisión/impuesto/neto en cero)`);
        continue;
      }

      const mediodePago = mediopagoIdx !== -1 ? String(row[mediopagoIdx] || "").trim() : "";
      const taxDetailRaw = taxDetailIdx !== -1 ? String(row[taxDetailIdx] || "").trim() : "";
      const branchName = branchIdx !== -1 ? String(row[branchIdx] || "").trim() : "";

      const rowLines: ParsedTransaction[] = [];

      if (Math.abs(grossH) > EPS) {
        sumGrossImportable += grossH;
        rowLines.push({
          date: dateValue,
          description: descText || "Movimiento Mercado Pago",
          description2: mediodePago || undefined,
          counterpartyRef: extractCounterpartyRef(mediodePago) ?? undefined,
          amount: Math.abs(grossH),
          type: grossH >= 0 ? "income" : "expense",
          grossAmount: grossH,
          commission: 0,
          taxWithholding: 0,
          branchName: branchName || undefined,
          excelRow,
          mpLineKind: "gross",
        });
      }

      if (jAbs > EPS) {
        rowLines.push({
          date: dateValue,
          description: MP_FIXED_COMMISSION_DESC,
          amount: jAbs,
          type: "expense",
          commission: jAbs,
          branchName: branchName || undefined,
          excelRow,
          mpLineKind: "commission",
        });
      }

      if (mAbs > EPS) {
        rowLines.push({
          date: dateValue,
          description: taxDetailRaw || "Retención IIBB",
          amount: mAbs,
          type: "expense",
          taxWithholding: mAbs,
          branchName: branchName || undefined,
          excelRow,
          mpLineKind: "tax",
        });
      }

      let lineSum = 0;
      if (Math.abs(grossH) > EPS) lineSum += grossH;
      if (jAbs > EPS) lineSum -= jAbs;
      if (mAbs > EPS) lineSum -= mAbs;
      const adjustment = netTarget - lineSum;

      if (Math.abs(adjustment) > 0.005) {
        rowLines.push({
          date: dateValue,
          description:
            `Ajuste neto Mercado Pago` +
            (descText ? ` (${descText.slice(0, 120)}${descText.length > 120 ? "…" : ""})` : ""),
          amount: Math.abs(adjustment),
          type: adjustment >= 0 ? "income" : "expense",
          branchName: branchName || undefined,
          excelRow,
          mpLineKind: "adjustment",
        });
      }

      for (const tl of rowLines) {
        transactions.push(tl);
      }

      if (periodStart === null || dateValue < periodStart) periodStart = dateValue;
      if (periodEnd === null || dateValue > periodEnd) periodEnd = dateValue;
    }

    const sumNetImportable = transactions.reduce(
      (s, t) => s + (t.type === "income" ? t.amount : -t.amount),
      0,
    );

    return {
      transactions,
      skipped,
      skippedReasons,
      total,
      openingBalance,
      closingBalance,
      periodStart,
      periodEnd,
      saldoDisponibleTotal,
      sumGrossImportable,
      sumNetImportable,
    };
  }

  private parseISODate(value: any): string | null {
    if (!value) return null;
    
    const dateStr = String(value).trim();
    
    const isoMatch = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})T/);
    if (isoMatch) {
      const [_, y, m, d] = isoMatch;
      return `${y}-${m}-${d}`;
    }
    
    const yyyymmdd = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (yyyymmdd) {
      return dateStr;
    }
    
    return null;
  }
  
  private parseNumber(value: any): number {
    return parseMercadoPagoExcelNumber(value);
  }
}

class FrancesParser implements BankParser {
  bankId = "frances";
  bankName = "Banco Francés";

  parse(rawData: any[][], _options?: ParserOptions): ParseResult {
    const transactions: ParsedTransaction[] = [];
    const skippedReasons: string[] = [];
    let skipped = 0;

    if (rawData.length < 2) {
      return { transactions, skipped: 0, skippedReasons: ["Archivo vacío"], total: 0 };
    }

    const headers = (rawData[0] as string[]).map((h) =>
      String(h || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim(),
    );

    let dateIdx = headers.findIndex((h) => h === "fecha" || h.includes("fecha"));
    let descIdx = headers.findIndex((h) => h.includes("descripcion") || h.includes("concepto") || h.includes("detalle"));
    let debitIdx = headers.findIndex((h) => h.includes("debito") || h === "debitos" || h.includes("debe") || h.includes("egreso"));
    let creditIdx = headers.findIndex((h) => h.includes("credito") || h === "creditos" || h.includes("haber") || h.includes("ingreso"));
    const saldoIdx = headers.findIndex((h) => h === "saldo" || h.includes("saldo"));

    // Fallbacks por posición típicas en extractos simples
    if (dateIdx === -1) dateIdx = 0;
    if (descIdx === -1) descIdx = 1;

    const total = rawData.length - 1;
    let openingBalance: number | null = null;
    let closingBalance: number | null = null;

    for (let i = 1; i < rawData.length; i++) {
      const row = rawData[i];
      if (!row || row.length === 0) {
        skipped++;
        skippedReasons.push(`Fila ${i + 1}: Fila vacía`);
        continue;
      }

      const dateValue = parseExcelDate(row[dateIdx]);
      const description = String(row[descIdx] || "").trim();

      if (!dateValue) {
        skipped++;
        skippedReasons.push(`Fila ${i + 1}: Fecha inválida "${row[dateIdx]}"`);
        continue;
      }
      if (!description) {
        skipped++;
        skippedReasons.push(`Fila ${i + 1}: Sin descripción`);
        continue;
      }

      const debitVal = debitIdx !== -1 ? parseArgentineNumber(row[debitIdx]) : 0;
      const creditVal = creditIdx !== -1 ? parseArgentineNumber(row[creditIdx]) : 0;
      const saldoVal =
        saldoIdx !== -1 && row[saldoIdx] != null ? parseArgentineNumber(row[saldoIdx]) : 0;

      let amount = 0;
      let type: "income" | "expense" = "expense";

      if (creditVal > 0) {
        amount = creditVal;
        type = "income";
      } else if (debitVal > 0) {
        amount = debitVal;
        type = "expense";
      } else {
        skipped++;
        skippedReasons.push(`Fila ${i + 1}: Sin monto (débito/crédito vacíos)`);
        continue;
      }

      // Si el archivo tiene columna "Saldo", deducimos el saldo inicial desde el primer movimiento
      // saldo_despues = saldo_antes - debito + credito
      // => saldo_antes = saldo_despues + debito - credito
      if (openingBalance === null && saldoVal !== 0) {
        openingBalance = saldoVal + debitVal - creditVal;
      }
      if (saldoVal !== 0) {
        closingBalance = saldoVal;
      }

      transactions.push({
        date: dateValue,
        description,
        amount,
        type,
        rawData: { rowIndex: i, debit: debitVal, credit: creditVal, saldo: saldoVal },
      });
    }

    const periodStart =
      transactions.length > 0
        ? transactions.reduce((min, t) => (t.date < min ? t.date : min), transactions[0].date)
        : null;
    const periodEnd =
      transactions.length > 0
        ? transactions.reduce((max, t) => (t.date > max ? t.date : max), transactions[0].date)
        : null;

    return { transactions, skipped, skippedReasons, total, openingBalance, closingBalance, periodStart, periodEnd };
  }
}

const parsers: Map<string, BankParser> = new Map();

parsers.set("galicia", new GaliciaParser());
parsers.set("mercadopago", new MercadoPagoParser());
parsers.set("bbva", new BbvaParser());
parsers.set("frances", new FrancesParser());
parsers.set("santander", Object.assign(new GenericParser(), { bankId: "santander", bankName: "Santander Rio" }));
parsers.set("provincia", Object.assign(new GenericParser(), { bankId: "provincia", bankName: "Banco Provincia" }));
parsers.set("nacion", Object.assign(new GenericParser(), { bankId: "nacion", bankName: "Banco Nacion" }));
parsers.set("macro", Object.assign(new GenericParser(), { bankId: "macro", bankName: "Banco Macro" }));
parsers.set("generic", new GenericParser());

export function getAvailableBanks(): Array<{ id: string; name: string }> {
  return Array.from(parsers.entries()).map(([id, parser]) => ({
    id,
    name: parser.bankName
  }));
}

export function getBankParser(bankId: string): BankParser {
  const parser = parsers.get(bankId);
  if (!parser) {
    return parsers.get("generic")!;
  }
  return parser;
}

export function registerBankParser(parser: BankParser): void {
  parsers.set(parser.bankId, parser);
}
