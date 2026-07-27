/**
 * Núcleo de importación de extractos (reutilizable desde API síncrona y jobs en background).
 */
import * as XLSX from "xlsx";
import { z } from "zod";
import { storage } from "./storage";
import {
  getBankParser,
  parseBbvaWorkbook,
  pickMercadoPagoReconciliationCandidates,
  mpAmountsMatchCent,
  type ParseResult,
  type GenericColumnMapping,
} from "./bankParsers";
import type { InsertFinancialImportBatch, InsertTransaction } from "@shared/schema";

export type BankStatementImportInput = {
  clientId: number;
  userId: string | undefined;
  buffer: Buffer;
  bankId: string;
  bankAccountId: number;
  defaultLocalId: number | null;
  openingBalanceRaw: string | undefined;
  closingBalanceRaw: string | undefined;
  skipContinuityCheck: boolean;
  mpGrossOverrides: Record<string, number>;
  /**
   * Mapeo de columnas ad-hoc para extracto genérico (import del momento). Si viene, se usa
   * para parsear ESTE archivo y NO se toca ningún banco configurado (clientBanks).
   */
  columnMapping?: GenericColumnMapping | null;
};

export type BankStatementImportResult =
  | { kind: "success"; body: Record<string, unknown> }
  | { kind: "reconciliation"; body: Record<string, unknown> }
  | { kind: "error"; status: number; body: Record<string, unknown> };

function mpGrossOverridesFromJson(raw: string | undefined): Record<string, number> {
  if (!raw?.trim()) return {};
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(o)) {
      const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
      if (Number.isFinite(n)) out[String(k)] = n;
    }
    return out;
  } catch {
    return {};
  }
}

/** Desde `paramsJson` guardado en el job (incluye mpGrossOverrides serializado). */
export function parseStoredImportParams(paramsJson: string): Omit<BankStatementImportInput, "buffer" | "clientId" | "userId"> {
  const o = JSON.parse(paramsJson) as Record<string, unknown>;
  const bankAccountParsed = z.coerce.number().int().positive().safeParse(o.bankAccountId);
  if (!bankAccountParsed.success) {
    throw new Error("Job invalido: bankAccountId");
  }
  const skipRaw = o.skipContinuityCheck;
  const skipContinuity =
    skipRaw === true ||
    skipRaw === 1 ||
    String(skipRaw).toLowerCase() === "true" ||
    String(skipRaw) === "1" ||
    String(skipRaw).toLowerCase() === "on";
  const mpRaw = typeof o.mpGrossOverridesJson === "string" ? o.mpGrossOverridesJson : undefined;
  const bankId = String(o.bankId ?? "generic").trim() || "generic";
  const defaultLocalParsed = z
    .union([z.coerce.number().int().positive(), z.null(), z.literal(""), z.literal("none")])
    .safeParse(o.defaultLocalId);
  const defaultLocalId =
    defaultLocalParsed.success && typeof defaultLocalParsed.data === "number"
      ? defaultLocalParsed.data
      : null;
  return {
    bankAccountId: bankAccountParsed.data,
    bankId,
    defaultLocalId,
    openingBalanceRaw: o.openingBalance != null ? String(o.openingBalance) : undefined,
    closingBalanceRaw: o.closingBalance != null ? String(o.closingBalance) : undefined,
    skipContinuityCheck: skipContinuity,
    mpGrossOverrides: mpGrossOverridesFromJson(mpRaw),
  };
}

export async function runBankStatementImport(input: BankStatementImportInput): Promise<BankStatementImportResult> {
  const {
    clientId,
    userId,
    buffer,
    bankId,
    bankAccountId,
    defaultLocalId,
    openingBalanceRaw,
    closingBalanceRaw,
    skipContinuityCheck,
    mpGrossOverrides,
  } = input;

  if (defaultLocalId != null) {
    const locs = await storage.getLocals(clientId);
    if (!locs.some((l) => l.id === defaultLocalId)) {
      return { kind: "error", status: 400, body: { message: "Local invalido" } };
    }
  }

  const bankAccountRow = await storage.getBankAccount(clientId, bankAccountId);
  if (!bankAccountRow) {
    return { kind: "error", status: 400, body: { message: "La cuenta seleccionada no existe o no pertenece a su empresa" } };
  }

  console.log(`[IMPORT] Client: ${clientId}, Bank: ${bankId}, File size: ${buffer.length} bytes`);

  console.log("[IMPORT] Parsing Excel file...");
  const workbook = XLSX.read(buffer, { type: "buffer" });

  const parser = getBankParser(bankId);
  console.log(`[IMPORT] Using parser: ${parser.bankName}`);

  let parseResult: ParseResult;
  let openingBalanceDetected: number | null = null;
  let closingBalanceDetected: number | null = null;
  let periodStartDetected: string | null = null;
  let periodEndDetected: string | null = null;

  if (bankId === "bbva") {
    const bbva = parseBbvaWorkbook(workbook);
    parseResult = {
      transactions: bbva.transactions,
      skipped: bbva.skipped,
      skippedReasons: bbva.skippedReasons,
      total: bbva.total,
      openingBalance: bbva.openingBalance,
      periodStart: bbva.periodStart ?? null,
      periodEnd: bbva.periodEnd ?? null,
    };
    openingBalanceDetected = bbva.openingBalance;
    periodStartDetected = bbva.periodStart ?? null;
    periodEndDetected = bbva.periodEnd ?? null;
    console.log(`[IMPORT] BBVA sheets merged: ${parseResult.transactions.length} txs, sheets=${workbook.SheetNames.join(",")}`);
  } else {
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];
    console.log(`[IMPORT] Excel parsed: ${rawData.length} rows`);

    if (rawData.length < 2) {
      return { kind: "error", status: 400, body: { message: "El archivo esta vacio o no tiene datos" } };
    }

    if (bankId === "mercadopago") {
      parseResult = getBankParser("mercadopago").parse(rawData, {
        grossOverridesByExcelRow: mpGrossOverrides,
      });
    } else {
      // Banco genérico:
      //  1) si viene un mapeo ad-hoc en el request (import del momento), se usa ESE y no se toca
      //     ningún banco configurado;
      //  2) si no, se usa el mapeo guardado del cliente (si lo configuró);
      //  3) si tampoco hay, auto-detect.
      let columnMapping: GenericColumnMapping | null = input.columnMapping ?? null;
      if (!columnMapping) {
        const clientBank = await storage.getClientBankByBankId(clientId, bankId);
        columnMapping = (clientBank?.columnMapping as GenericColumnMapping | null) ?? null;
      }
      parseResult = parser.parse(rawData, columnMapping ? { columnMapping } : undefined);
    }
    openingBalanceDetected = parseResult.openingBalance ?? null;
    closingBalanceDetected = parseResult.closingBalance ?? null;
    periodStartDetected = parseResult.periodStart ?? null;
    periodEndDetected = parseResult.periodEnd ?? null;
  }

  const mpSumNetForReco = bankId === "mercadopago" ? (parseResult.sumNetImportable ?? 0) : 0;
  const mpSumGrossForReco = bankId === "mercadopago" ? (parseResult.sumGrossImportable ?? 0) : 0;
  const mpRefForReco = bankId === "mercadopago" ? parseResult.saldoDisponibleTotal ?? null : null;

  if (bankId === "mercadopago") {
    const ref = mpRefForReco;
    const sum = mpSumNetForReco;
    if (ref == null || Number.isNaN(Number(ref))) {
      return {
        kind: "error",
        status: 400,
        body: {
          message:
            "No se encontró en el archivo el valor «Saldo disponible total» necesario para conciliar el extracto de Mercado Pago.",
        },
      };
    }
    if (!mpAmountsMatchCent(sum, Number(ref))) {
      const candidates = pickMercadoPagoReconciliationCandidates(parseResult.transactions, 10);
      return {
        kind: "reconciliation",
        body: {
          imported: 0,
          reconciliationRequired: true,
          code: "MP_RECONCILIATION_REQUIRED",
          reason: "sum_mismatch",
          message: `La suma de los movimientos a importar (${sum.toFixed(2)}, bruto − comisión − impuesto) no coincide con la variación del saldo del archivo (${Number(ref).toFixed(2)}, saldo final − saldo inicial de la columna SALDO). Puede haber filas con importes corruptos en el Excel (bruto/neto inconsistentes con el SALDO), filas omitidas o duplicados en el sistema. Las filas mostradas son solo referencia.`,
          saldoDisponibleTotal: ref,
          sumGrossImportable: mpSumGrossForReco,
          sumNetImportable: sum,
          delta: sum - Number(ref),
          rows: candidates.map((t) => ({
            excelRow: t.excelRow ?? 0,
            description: (t.description || "").slice(0, 200),
            description2: (t.description2 || "").slice(0, 200),
            date: t.date ?? null,
            montoBrutoActual: t.grossAmount ?? 0,
          })),
          skipped: parseResult.skipped,
          total: parseResult.total,
          bankUsed: parser.bankName,
        },
      };
    }
  }

  const openingBalanceManual = z.coerce.number().safeParse(openingBalanceRaw);
  const closingBalanceManual = z.coerce.number().safeParse(closingBalanceRaw);
  const openingBalanceToUse =
    openingBalanceManual.success ? openingBalanceManual.data : openingBalanceDetected;
  let closingBalanceToUse =
    closingBalanceManual.success ? closingBalanceManual.data : closingBalanceDetected;

  // Fallback de cierre: si no hay cierre (detectado ni manual) pero sí saldo inicial,
  // se computa cierre = inicial + Σ(ingresos) − Σ(egresos) del extracto. Así el próximo
  // extracto puede validar continuidad. No aplica a MP/BBVA (tienen su propia detección).
  if (closingBalanceToUse == null && openingBalanceToUse != null && bankId !== "mercadopago" && bankId !== "bbva") {
    const net = parseResult.transactions.reduce(
      (acc, t) => acc + (t.type === "income" ? t.amount : -t.amount),
      0,
    );
    closingBalanceToUse = Number((Number(openingBalanceToUse) + net).toFixed(2));
  }

  const txCountForAccount = await storage.getTransactionCountForBankAccount(clientId, bankAccountId);
  const lastBatch = await storage.getLastFinancialImportBatchForAccount(clientId, bankAccountId);
  if (
    !skipContinuityCheck &&
    txCountForAccount > 0 &&
    lastBatch?.closingBalance != null &&
    openingBalanceToUse != null
  ) {
    const prevClose = Number(lastBatch.closingBalance);
    const currOpen = Number(openingBalanceToUse);
    const diff = Math.abs(prevClose - currOpen);
    if (diff > 0.01) {
      return {
        kind: "error",
        status: 409,
        body: {
          message:
            "El saldo inicial del extracto no coincide con el cierre del último extracto cargado para esta cuenta/caja.",
          previousClosingBalance: prevClose,
          currentOpeningBalance: currOpen,
          difference: diff,
        },
      };
    }
  }

  console.log(`[IMPORT] Parsed: ${parseResult.transactions.length} transactions, ${parseResult.skipped} skipped`);

  const unmappedBranches: string[] = [];
  const allAliases = await storage.getLocalAliases(clientId);
  const aliasToLocalId = new Map<string, number | null>(
    allAliases.map((a) => [String(a.alias || "").trim(), a.localId ?? null]),
  );

  const importBatchId = `${bankId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  console.log(`[IMPORT] Batch ID: ${importBatchId}`);
  console.log("[IMPORT] Preparing transactions for batch insert...");
  const transactionsToInsert = [];

  for (const tx of parseResult.transactions) {
    let localId: number | undefined = undefined;

    if (tx.branchName) {
      const mapped = aliasToLocalId.get(tx.branchName);
      if (mapped !== undefined && mapped !== null) {
        localId = mapped;
      } else {
        if (!unmappedBranches.includes(tx.branchName)) {
          unmappedBranches.push(tx.branchName);
        }
      }
    }

    if (localId === undefined && defaultLocalId != null) {
      localId = defaultLocalId;
    }

    transactionsToInsert.push({
      clientId,
      localId,
      bankAccountId,
      createdBy: userId ?? undefined,
      transactionDate: tx.date,
      description: tx.description,
      description2: tx.description2,
      counterpartyRef: tx.counterpartyRef,
      amount: String(tx.amount),
      type: tx.type,
      source: "import" as const,
      bankSource: bankId,
      grossAmount: tx.grossAmount ? String(tx.grossAmount) : undefined,
      commission: tx.commission ? String(tx.commission) : undefined,
      taxWithholding: tx.taxWithholding ? String(tx.taxWithholding) : undefined,
      branchName: tx.branchName,
      importBatchId,
    });
  }

  console.log(`[IMPORT] Inserting ${transactionsToInsert.length} transactions in batch...`);
  const insertStarted = Date.now();
  const imported = await storage.createTransactionsBatch(
    transactionsToInsert as unknown as InsertTransaction[],
  );
  console.log(`[IMPORT] Complete: ${imported} imported in ${Date.now() - insertStarted}ms`);

  if (imported > 0) {
    await storage.createFinancialImportBatch({
      clientId,
      importBatchId,
      bankAccountId,
      bankSource: bankId,
      openingBalance: openingBalanceToUse != null ? String(openingBalanceToUse) : undefined,
      closingBalance: closingBalanceToUse != null ? String(closingBalanceToUse) : undefined,
      periodStart: periodStartDetected ?? undefined,
      periodEnd: periodEndDetected ?? undefined,
    } as unknown as InsertFinancialImportBatch);
  }

  return {
    kind: "success",
    body: {
      imported,
      total: parseResult.total,
      skipped: parseResult.skipped,
      skippedReasons: parseResult.skippedReasons.slice(0, 10),
      bankUsed: parser.bankName,
      bankSourceId: bankId,
      unmappedBranches: unmappedBranches.length > 0 ? unmappedBranches : undefined,
      batchOpeningBalance: openingBalanceToUse,
      batchClosingBalance: closingBalanceToUse,
      batchPeriodStart: periodStartDetected,
      batchPeriodEnd: periodEndDetected,
      ...(bankId === "mercadopago"
        ? {
            mpDiagnostics: {
              saldoDisponibleTotalArchivo: mpRefForReco,
              sumNetImportable: mpSumNetForReco,
              sumGrossImportable: mpSumGrossForReco,
            },
          }
        : {}),
    },
  };
}
