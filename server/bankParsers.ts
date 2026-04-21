import XLSX from "xlsx";

export interface ParsedTransaction {
  date: string; // YYYY-MM-DD format
  description: string;
  amount: number;
  type: "income" | "expense";
  rawData?: Record<string, any>;
  grossAmount?: number;
  commission?: number;
  taxWithholding?: number;
  branchName?: string;
}

export interface ParseResult {
  transactions: ParsedTransaction[];
  skipped: number;
  skippedReasons: string[];
  total: number;
}

export interface BankParser {
  bankId: string;
  bankName: string;
  parse(rawData: any[][]): ParseResult;
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

class GaliciaParser implements BankParser {
  bankId = "galicia";
  bankName = "Banco Galicia";
  
  parse(rawData: any[][]): ParseResult {
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
    let debitIdx = headers.findIndex(h => 
      h.includes("debito") || h === "debe" || h.includes("egreso")
    );
    let creditIdx = headers.findIndex(h => 
      h.includes("credito") || h === "haber" || h.includes("ingreso")
    );
    
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
    
    if (debitIdx === -1 && creditIdx === -1) {
      for (let i = 0; i < headers.length; i++) {
        const h = headers[i];
        if (h.includes("debito") || h === "debitos") debitIdx = i;
        if (h.includes("credito") || h === "creditos") creditIdx = i;
      }
    }
    
    const total = rawData.length - 1;
    
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
      
      transactions.push({
        date: dateValue,
        description,
        amount,
        type,
        rawData: { rowIndex: i, debit: debitVal, credit: creditVal }
      });
    }
    
    return { transactions, skipped, skippedReasons, total };
  }
}

class GenericParser implements BankParser {
  bankId = "generic";
  bankName = "Genérico (Auto-detectar)";
  
  parse(rawData: any[][]): ParseResult {
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
}

const BBVA_MOVEMENT_SHEETS = ["Movimientos Históricos", "Movimientos del Día"];

/** Layout fijo extractos BBVA: A Fecha, C Concepto, G Créditos, H Débitos (índices 0-based). */
const BBVA_COL_FECHA = 0;
const BBVA_COL_CONCEPTO = 2;
const BBVA_COL_CREDITO = 6;
const BBVA_COL_DEBITO = 7;

class BbvaParser implements BankParser {
  bankId = "bbva";
  bankName = "Banco BBVA";

  parse(rawData: any[][]): ParseResult {
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

function dedupeBbvaTransactions(txs: ParsedTransaction[]): ParsedTransaction[] {
  const seen = new Set<string>();
  const out: ParsedTransaction[] = [];
  for (const tx of txs) {
    const cents = Math.round(tx.amount * 100);
    const key = `${tx.date}|${tx.type}|${cents}|${tx.description}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tx);
  }
  return out;
}

export function parseBbvaWorkbook(workbook: XLSX.WorkBook): ParseResult {
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
    };
  }

  let merged: ParsedTransaction[] = [];
  let skipped = 0;
  const skippedReasons: string[] = [];
  let totalRows = 0;

  for (const sheetName of sheetsToParse) {
    const sheet = workbook.Sheets[sheetName];
    const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];
    const part = parser.parse(rawData);
    merged.push(...part.transactions);
    skipped += part.skipped;
    skippedReasons.push(...part.skippedReasons);
    totalRows += part.total;
  }

  const before = merged.length;
  const transactions = dedupeBbvaTransactions(merged);
  const dupes = before - transactions.length;
  if (dupes > 0) {
    skipped += dupes;
    skippedReasons.push(`Entre hojas: ${dupes} movimiento(s) duplicado(s) omitido(s)`);
  }

  return {
    transactions,
    skipped,
    skippedReasons: skippedReasons.slice(0, 25),
    total: totalRows,
  };
}

class MercadoPagoParser implements BankParser {
  bankId = "mercadopago";
  bankName = "Mercado Pago";
  
  parse(rawData: any[][]): ParseResult {
    const transactions: ParsedTransaction[] = [];
    const skippedReasons: string[] = [];
    let skipped = 0;
    
    if (rawData.length < 2) {
      return { transactions, skipped: 0, skippedReasons: ["Archivo vacío"], total: 0 };
    }
    
    const headers = (rawData[0] as string[]).map(h => 
      String(h || "").toUpperCase().trim()
    );
    
    console.log("[MP Parser] Headers found:", headers.slice(0, 10));
    
    const dateIdx = headers.findIndex(h => h.includes("FECHA DE LIBERACIÓN") || h.includes("FECHA DE LIBERACION"));
    const descIdx = headers.findIndex(h => h === "DESCRIPCIÓN" || h === "DESCRIPCION");
    const grossIdx = headers.findIndex(h => h.includes("MONTO BRUTO"));
    const commissionIdx = headers.findIndex(h => h.includes("COMISIÓN DE MERCADO PAGO") || h.includes("COMISION DE MERCADO PAGO"));
    const taxIdx = headers.findIndex(h => h.includes("RETENCIONES IIBB"));
    const branchIdx = headers.findIndex(h => h.includes("NOMBRE DE LA SUCURSAL"));
    
    console.log("[MP Parser] Column indices - date:", dateIdx, "desc:", descIdx, "gross:", grossIdx);
    
    if (dateIdx === -1 || grossIdx === -1) {
      console.log("[MP Parser] Missing required columns! All headers:", headers);
      return { 
        transactions, 
        skipped: rawData.length - 1, 
        skippedReasons: [`No se encontraron columnas requeridas. Headers: ${headers.slice(0, 5).join(", ")}...`], 
        total: rawData.length - 1 
      };
    }
    
    const total = rawData.length - 1;
    
    const summaryDescriptions = [
      "dinero disponible del período anterior",
      "dinero disponible del periodo anterior",
      "saldo inicial",
      "saldo final",
      "total del período",
      "total del periodo"
    ];
    
    for (let i = 1; i < rawData.length; i++) {
      const row = rawData[i];
      if (!row || row.length === 0) {
        skipped++;
        skippedReasons.push(`Fila ${i + 1}: Fila vacía`);
        continue;
      }
      
      const description = descIdx !== -1 ? String(row[descIdx] || "").trim() : "";
      
      if (summaryDescriptions.some(s => description.toLowerCase().includes(s))) {
        skipped++;
        skippedReasons.push(`Fila ${i + 1}: Fila de resumen/saldo (${description})`);
        continue;
      }
      
      const dateValue = this.parseISODate(row[dateIdx]);
      if (!dateValue) {
        skipped++;
        skippedReasons.push(`Fila ${i + 1}: Fecha inválida "${row[dateIdx]}"`);
        continue;
      }
      
      const grossAmount = this.parseNumber(row[grossIdx]);
      if (grossAmount === 0) {
        skipped++;
        skippedReasons.push(`Fila ${i + 1}: Monto bruto cero o inválido`);
        continue;
      }
      
      const commission = commissionIdx !== -1 ? Math.abs(this.parseNumber(row[commissionIdx])) : 0;
      const taxWithholding = taxIdx !== -1 ? Math.abs(this.parseNumber(row[taxIdx])) : 0;
      const branchName = branchIdx !== -1 ? String(row[branchIdx] || "").trim() : "";
      
      const netAmount = grossAmount - commission - taxWithholding;
      const type: "income" | "expense" = netAmount >= 0 ? "income" : "expense";
      
      transactions.push({
        date: dateValue,
        description: description || "Movimiento Mercado Pago",
        amount: Math.abs(netAmount),
        type,
        grossAmount,
        commission,
        taxWithholding,
        branchName: branchName || undefined,
        rawData: { 
          rowIndex: i, 
          gross: grossAmount, 
          commission, 
          tax: taxWithholding,
          branch: branchName
        }
      });
    }
    
    return { transactions, skipped, skippedReasons, total };
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
    if (typeof value === "number") return value;
    if (!value) return 0;
    
    const str = String(value).trim();
    if (!str) return 0;
    
    // Mercado Pago uses international format (1234.56) not Argentine (1.234,56)
    // Just remove $ and spaces, keep the decimal point
    const cleaned = str
      .replace(/\$/g, "")
      .replace(/\s/g, "");
    
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : num;
  }
}

const parsers: Map<string, BankParser> = new Map();

parsers.set("galicia", new GaliciaParser());
parsers.set("mercadopago", new MercadoPagoParser());
parsers.set("bbva", new BbvaParser());
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
