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
parsers.set("bbva", Object.assign(new GenericParser(), { bankId: "bbva", bankName: "Banco BBVA" }));
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
