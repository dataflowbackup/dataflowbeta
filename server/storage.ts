import { formatInvoiceVoucherDisplay } from "@shared/invoiceDisplay";
import { resolveEconomicMonth } from "@shared/economicMonth";
import { isCreditNote as isCreditNoteCode } from "@shared/afipComprobantesParser";
import {
  normalizeSalesSourcePreferences,
  hasAtLeastOneSalesSource,
  type SalesSourcePreferences,
} from "@shared/salesSources";
import { computeRecipeMetrics, recipeGrossPrice, recipeRemovesIva } from "@shared/recipePricing";
import { db } from "./db";
import { eq, and, desc, asc, gte, lte, sql, isNull, isNotNull, inArray, or, lt } from "drizzle-orm";
import {
  users,
  userCredentials,
  clients,
  userClients,
  locals,
  suppliers,
  rubros,
  subRubros,
  taxes,
  unitsOfMeasure,
  supplies,
  invoices,
  invoiceItems,
  invoiceTaxes,
  payments,
  paymentAllocations,
  recipeCategories,
  recipeSubcategories,
  recipes,
  recipeIngredients,
  costHistory,
  categoryGroups,
  financialGroups,
  transactionCategories,
  bankAccounts,
  cashRegisters,
  internalLoans,
  financialImportBatches,
  financialImportJobs,
  financialSavedViews,
  clientBanks,
  businessNames,
  counterparties,
  counterpartyIdentifiers,
  transactions,
  monthlyBalances,
  sales,
  permissions,
  rolePermissions,
  userLocalAssignments,
  notifications,
  stockMovements,
  stockLevels,
  stockAdjustments,
  stockValuations,
  stockValuationItems,
  breakevenAnalyses,
  breakevenFixedCosts,
  breakevenVariableCosts,
  cmvCalculations,
  dataliveVentas,
  clientPreferences,
  afipSalePoints,
  afipImportBatches,
  afipReceivedVouchers,
  afipIssuedVouchers,
  fudoVentas,
  fudoPagos,
  fudoProductos,
  dataliveProductos,
  sharesVentas,
  sharesProductos,
  productRecipeMappings,
  productCosts,
  invoiceExtractionJobs,
  supplierSupplyMappings,
  cmvProductoCalculations,
  cmvProductoLines,
  monthlyGoals,
  decomisos,
  decomisoProductMappings,
  decomisoLocalMappings,
  auditLog,
  operationalAudits,
  auditTemplates,
  auditTemplateItems,
  auditResults,
  employees,
  attendances,
  payrolls,
  clientInvitations,
  localAliases,
  supplySuppliers,
  supplierRubros,
  type User,
  type UserClient,
  type InsertUserClient,
  type UpsertUser,
  type InsertClient,
  type Client,
  type InsertLocal,
  type Local,
  type InsertSupplier,
  type Supplier,
  type InsertRubro,
  type Rubro,
  type InsertSubRubro,
  type SubRubro,
  type InsertTax,
  type Tax,
  type InsertUnitOfMeasure,
  type UnitOfMeasure,
  type InsertSupply,
  type Supply,
  type InsertInvoice,
  type Invoice,
  type InsertInvoiceItem,
  type InvoiceItem,
  type InsertInvoiceTax,
  type InvoiceTax,
  type InsertPayment,
  type Payment,
  type InsertPaymentAllocation,
  type InsertRecipeCategory,
  type RecipeCategory,
  type InsertRecipeSubcategory,
  type RecipeSubcategory,
  type InsertRecipe,
  type Recipe,
  type InsertRecipeIngredient,
  type RecipeIngredient,
  type InsertCostHistory,
  type CostHistory,
  type InsertCategoryGroup,
  type CategoryGroup,
  type InsertFinancialGroup,
  type FinancialGroup,
  type InsertTransactionCategory,
  type TransactionCategory,
  type InsertBankAccount,
  type BankAccount,
  type CashRegister,
  type ProductRecipeMapping,
  type ProductCost,
  type InvoiceExtractionJob,
  type InsertInvoiceExtractionJob,
  type SupplierSupplyMapping,
  type CmvProductoCalculation,
  type CmvProductoLine,
  type InsertFinancialImportBatch,
  type FinancialImportBatch,
  type InsertFinancialImportJob,
  type FinancialImportJob,
  type InsertFinancialSavedView,
  type FinancialSavedView,
  type InsertClientBank,
  type ClientBank,
  type InsertBusinessName,
  type BusinessName,
  type AfipSalePoint,
  type AfipImportBatch,
  type InsertCounterparty,
  type Counterparty,
  type InsertCounterpartyIdentifier,
  type CounterpartyIdentifier,
  type InsertTransaction,
  type Transaction,
  type InternalLoan,
  type InsertInternalLoan,
  type InsertMonthlyBalance,
  type MonthlyBalance,
  type Sale,
  type Permission,
  type InsertPermission,
  type RolePermission,
  type InsertRolePermission,
  type UserLocalAssignment,
  type InsertUserLocalAssignment,
  type Notification,
  type InsertNotification,
  type StockMovement,
  type InsertStockMovement,
  type StockLevel,
  type InsertStockLevel,
  type StockAdjustment,
  type InsertStockAdjustment,
  type StockValuation,
  type InsertStockValuation,
  type StockValuationItem,
  type InsertStockValuationItem,
  type BreakevenAnalysis,
  type BreakevenFixedCost,
  type BreakevenVariableCost,
  type CmvCalculation,
  type DataliveVenta,
  type FudoVenta,
  type FudoProducto,
  type DataliveProducto,
  type SharesVenta,
  type SharesProducto,
  type Decomiso,
  type DecomisoProductMapping,
  type DecomisoLocalMapping,
  type OperationalAudit,
  type InsertOperationalAudit,
  type AuditTemplate,
  type InsertAuditTemplate,
  type AuditTemplateItem,
  type InsertAuditTemplateItem,
  type AuditResult,
  type InsertAuditResult,
  type Employee,
  type InsertEmployee,
  type Attendance,
  type InsertAttendance,
  type Payroll,
  type InsertPayroll,
  type ClientInvitation,
  type InsertClientInvitation,
  type LocalAlias,
  type InsertLocalAlias,
  type SupplySupplier,
  type InsertSupplySupplier,
  type SupplierRubro,
  merchandiseTransfers,
  merchandiseTransferItems,
  type MerchandiseTransfer,
  type InsertMerchandiseTransfer,
  type MerchandiseTransferItem,
  type InsertMerchandiseTransferItem,
} from "@shared/schema";
import {
  computeBreakeven,
  type AppliedVariableCost,
  type VariableCostBase,
} from "@shared/breakeven";

/**
 * Corte fiscalizado / no fiscalizado de un dia de FUDO (columna N del reporte).
 * null = el archivo no traia la columna: es "no se sabe", nunca "no fiscalizado".
 */
export interface FudoFiscalSplit {
  ventaFiscalizada?: number | null;
  ventaNoFiscalizada?: number | null;
  ventaSinDatoFiscal?: number | null;
  ticketsFiscalizados?: number | null;
  ticketsNoFiscalizados?: number | null;
  ticketsSinDatoFiscal?: number | null;
}

/**
 * specialType canónicos de "Otros Movimientos" (ROADMAP_BETA Fase 1): categorías que
 * quedan asentadas pero NO afectan el resultado neto del balance (income - expense).
 * La exclusión se basa en estos valores, no en el booleano isSpecial (ver getBalanceSpreadsheet).
 */
export const OTROS_MOVIMIENTOS_SPECIAL_TYPES = new Set<string>([
  "opening_balance", // Inicio de mes
  "owner_withdrawal", // Retiros socios
  "loan", // Préstamos
  "capital_contribution", // Aporte de Capital (socios)
  "other_income", // Otros ingresos (no venta)
  "cash_relief", // Alivios de caja
  "internal_transfer", // Transferencias entre cuentas
]);

/**
 * Tercer tipo de grupo financiero (además de income/expense): los grupos "Movimientos
 * Financieros" (Inicio de mes, Otros Ingresos, Préstamos, Alivios, Aporte de Capital, Retiros)
 * NO miden rentabilidad → se excluyen del balance, pero SÍ cuentan para los saldos de caja.
 */
export const MOVIMIENTOS_FINANCIEROS_GROUP_TYPE = "movimientos_financieros";

export interface IStorage {
  upsertUser(user: UpsertUser): Promise<User>;
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  
  getClientByUserId(userId: string): Promise<Client | undefined>;
  /** Rol del usuario en esa empresa (tabla user_clients), ej. socio / admin / encargado */
  getUserRoleInClient(userId: string, clientId: number): Promise<string | null>;
  createClient(client: InsertClient): Promise<Client>;
  
  getLocals(clientId: number): Promise<Local[]>;
  createLocal(local: InsertLocal): Promise<Local>;
  updateLocal(clientId: number, id: number, local: Partial<InsertLocal>): Promise<Local | undefined>;
  deleteLocal(clientId: number, id: number): Promise<boolean>;
  
  getSuppliers(clientId: number): Promise<Supplier[]>;
  getSupplierByCuit(clientId: number, cuit: string): Promise<Supplier | undefined>;
  createSupplier(supplier: InsertSupplier): Promise<Supplier>;
  updateSupplier(clientId: number, id: number, supplier: Partial<InsertSupplier>): Promise<Supplier | undefined>;
  deleteSupplier(clientId: number, id: number): Promise<boolean>;
  
  getRubros(clientId: number): Promise<Rubro[]>;
  createRubro(rubro: InsertRubro): Promise<Rubro>;
  updateRubro(clientId: number, id: number, rubro: Partial<InsertRubro>): Promise<Rubro | undefined>;
  deleteRubro(clientId: number, id: number): Promise<boolean>;
  
  getSubRubros(clientId: number): Promise<(SubRubro & { rubro?: Rubro | null })[]>;
  getSubRubrosByRubro(clientId: number, rubroId: number): Promise<SubRubro[]>;
  createSubRubro(subRubro: InsertSubRubro): Promise<SubRubro>;
  updateSubRubro(clientId: number, id: number, subRubro: Partial<InsertSubRubro>): Promise<SubRubro | undefined>;
  deleteSubRubro(clientId: number, id: number): Promise<boolean>;
  
  getTaxes(clientId: number): Promise<Tax[]>;
  createTax(tax: InsertTax): Promise<Tax>;
  updateTax(clientId: number, id: number, tax: Partial<InsertTax>): Promise<Tax | undefined>;
  deleteTax(clientId: number, id: number): Promise<boolean>;
  
  getUnits(clientId: number): Promise<UnitOfMeasure[]>;
  createUnit(unit: InsertUnitOfMeasure): Promise<UnitOfMeasure>;
  updateUnit(clientId: number, id: number, unit: Partial<InsertUnitOfMeasure>): Promise<UnitOfMeasure | undefined>;
  deleteUnit(clientId: number, id: number): Promise<boolean>;
  
  getSupplies(clientId: number): Promise<Supply[]>;
  getSupplyUsageDetail(
    clientId: number,
    supplyId: number,
  ): Promise<{
    supplyName: string;
    recipes: { id: number; name: string; recipeType: string | null; categoryName: string | null; subcategoryName: string | null }[];
    suppliers: { id: number; name: string }[];
  } | null>;
  getSubRecipeParentUsageDetail(
    clientId: number,
    subRecipeId: number,
  ): Promise<{
    subRecipeName: string;
    parents: { id: number; name: string; recipeType: string | null; categoryName: string | null; subcategoryName: string | null }[];
  } | null>;
  createSupply(supply: InsertSupply): Promise<Supply>;
  updateSupply(clientId: number, id: number, supply: Partial<InsertSupply>): Promise<Supply | undefined>;
  deleteSupply(clientId: number, id: number): Promise<boolean>;
  
  getInvoices(clientId: number): Promise<Invoice[]>;
  getInvoice(clientId: number, id: number): Promise<Invoice | undefined>;
  getInvoiceByVoucherComposite(
    clientId: number,
    supplierId: number,
    invoiceSalePoint: string,
    invoiceNumber: string,
  ): Promise<Invoice | undefined>;
  getInvoiceItems(invoiceId: number): Promise<InvoiceItem[]>;
  getInvoiceTaxes(invoiceId: number): Promise<InvoiceTax[]>;
  createInvoice(invoice: InsertInvoice, items: InsertInvoiceItem[], taxItems: InsertInvoiceTax[]): Promise<Invoice>;
  updateInvoice(clientId: number, id: number, invoice: Partial<InsertInvoice>): Promise<Invoice | undefined>;
  deleteInvoice(clientId: number, id: number): Promise<boolean>;
  
  getPayments(clientId: number): Promise<Payment[]>;
  createPayment(payment: InsertPayment): Promise<Payment>;
  updatePayment(
    clientId: number,
    id: number,
    data: { paymentNumber?: string | null; paymentDate?: string; bankAccountId?: number | null; paymentMethod?: string; notes?: string | null },
  ): Promise<Payment | undefined>;
  deletePayment(clientId: number, id: number): Promise<boolean>;
  
  getRecipeCategories(clientId: number): Promise<RecipeCategory[]>;
  createRecipeCategory(category: InsertRecipeCategory): Promise<RecipeCategory>;
  updateRecipeCategory(clientId: number, id: number, category: Partial<InsertRecipeCategory>): Promise<RecipeCategory | undefined>;
  deleteRecipeCategory(clientId: number, id: number): Promise<boolean>;

  getRecipeSubcategories(
    clientId: number,
  ): Promise<(RecipeSubcategory & { recipeCategory?: RecipeCategory | null })[]>;
  createRecipeSubcategory(sub: InsertRecipeSubcategory): Promise<RecipeSubcategory>;
  updateRecipeSubcategory(
    clientId: number,
    id: number,
    sub: Partial<InsertRecipeSubcategory>,
  ): Promise<RecipeSubcategory | undefined>;
  deleteRecipeSubcategory(clientId: number, id: number): Promise<boolean>;
  
  getRecipes(clientId: number): Promise<Recipe[]>;
  getRecipe(clientId: number, id: number): Promise<Recipe | undefined>;
  getRecipeIngredients(recipeId: number): Promise<RecipeIngredient[]>;
  createRecipe(recipe: InsertRecipe, ingredients: InsertRecipeIngredient[]): Promise<Recipe>;
  updateRecipe(clientId: number, id: number, recipe: Partial<InsertRecipe>, ingredients?: InsertRecipeIngredient[]): Promise<Recipe | undefined>;
  /** Aplica a todos los platos si al precio de venta se le quita el IVA. Devuelve cuántos actualizó. */
  setRecipesIvaPolicy(clientId: number, removeIva: boolean): Promise<number>;
  deleteRecipe(clientId: number, id: number): Promise<boolean>;
  
  getCostHistory(clientId: number): Promise<CostHistory[]>;
  
  getCategoryGroups(clientId: number): Promise<CategoryGroup[]>;
  createCategoryGroup(group: InsertCategoryGroup): Promise<CategoryGroup>;
  
  getFinancialGroups(clientId: number): Promise<FinancialGroup[]>;
  getFinancialGroup(clientId: number, id: number): Promise<FinancialGroup | undefined>;
  createFinancialGroup(group: InsertFinancialGroup): Promise<FinancialGroup>;
  updateFinancialGroup(clientId: number, id: number, group: Partial<InsertFinancialGroup>): Promise<FinancialGroup | undefined>;
  deleteFinancialGroup(clientId: number, id: number): Promise<boolean>;
  
  getClientBanks(clientId: number): Promise<ClientBank[]>;
  getClientBankByBankId(clientId: number, bankId: string): Promise<ClientBank | undefined>;
  createClientBank(bank: InsertClientBank): Promise<ClientBank>;
  updateClientBank(clientId: number, id: number, bank: Partial<InsertClientBank>): Promise<ClientBank | undefined>;
  deleteClientBank(clientId: number, id: number): Promise<boolean>;
  
  getTransactionCategories(clientId: number): Promise<TransactionCategory[]>;
  createTransactionCategory(category: InsertTransactionCategory): Promise<TransactionCategory>;
  updateTransactionCategory(clientId: number, id: number, category: Partial<InsertTransactionCategory>): Promise<TransactionCategory | undefined>;
  deleteTransactionCategory(clientId: number, id: number): Promise<boolean>;
  
  getBankAccounts(clientId: number): Promise<BankAccount[]>;
  getBankAccount(clientId: number, id: number): Promise<BankAccount | undefined>;
  createBankAccount(account: InsertBankAccount): Promise<BankAccount>;
  updateBankAccount(clientId: number, id: number, account: Partial<InsertBankAccount>): Promise<BankAccount | undefined>;
  deleteBankAccount(clientId: number, id: number): Promise<boolean>;
  purgeBankAccountImportedData(
    clientId: number,
    bankAccountId: number,
  ): Promise<{ deletedTransactions: number; deletedBatches: number }>;
  createFinancialImportBatch(row: InsertFinancialImportBatch): Promise<FinancialImportBatch>;
  createFinancialImportJob(row: InsertFinancialImportJob): Promise<FinancialImportJob>;
  claimFinancialImportJobForProcessing(
    jobToken: string,
    triggerKey: string,
  ): Promise<FinancialImportJob | undefined>;
  getFinancialImportJobForClient(clientId: number, jobToken: string): Promise<FinancialImportJob | undefined>;
  updateFinancialImportJob(
    id: number,
    patch: Partial<Pick<FinancialImportJob, "status" | "resultJson" | "resultHttpStatus" | "errorMessage" | "updatedAt">>,
  ): Promise<void>;
  getLastFinancialImportBatchForAccount(clientId: number, bankAccountId: number): Promise<FinancialImportBatch | undefined>;
  getTransactionCountForBankAccount(clientId: number, bankAccountId: number): Promise<number>;
  getFinancialSavedViews(clientId: number, userId: string): Promise<FinancialSavedView[]>;
  createFinancialSavedView(row: InsertFinancialSavedView): Promise<FinancialSavedView>;
  deleteFinancialSavedView(clientId: number, userId: string, id: number): Promise<boolean>;
  
  getTransactions(
    clientId: number,
    options?: {
      limit?: number;
      offset?: number;
      /** Paginación estable para listados grandes (sin OFFSET); orden: fecha DESC, id DESC */
      cursor?: { transactionDate: string; id: number };
      bankSource?: string;
    },
  ): Promise<Transaction[]>;
  getTransactionById(clientId: number, id: number): Promise<Transaction | undefined>;
  getTransactionCount(clientId: number, options?: { bankSource?: string }): Promise<number>;
  /** Valida fila de efectivo (local, importe). Categoría es opcional. */
  assertCashMovementRowValid(
    clientId: number,
    row: {
      categoryId: number | null | undefined;
      localId: number | null | undefined;
      type: "income" | "expense";
      amount: number;
    },
  ): Promise<void>;
  insertCashMovementBatch(
    clientId: number,
    userId: string | undefined,
    rows: Array<{
      transactionDate: string;
      description: string;
      categoryId: number | null | undefined;
      localId: number | null | undefined;
      type: "income" | "expense";
      amount: number;
    }>,
  ): Promise<Transaction[]>;
  createTransaction(transaction: InsertTransaction): Promise<Transaction>;
  createTransactionsBatch(transactionsList: InsertTransaction[]): Promise<number>;
  updateTransaction(clientId: number, id: number, transaction: Partial<InsertTransaction>): Promise<Transaction | undefined>;
  deleteTransaction(clientId: number, id: number): Promise<boolean>;

  listCashRegisters(clientId: number, includeInactive?: boolean): Promise<CashRegister[]>;
  createCashRegister(clientId: number, name: string): Promise<CashRegister>;
  updateCashRegister(clientId: number, id: number, data: Partial<{ name: string; active: boolean; displayOrder: number }>): Promise<CashRegister | undefined>;
  deleteCashRegister(clientId: number, id: number): Promise<boolean>;


  getMonthlyBalances(clientId: number, year: number): Promise<MonthlyBalance[]>;
  createMonthlyBalance(balance: InsertMonthlyBalance): Promise<MonthlyBalance>;
  updateMonthlyBalance(clientId: number, id: number, balance: Partial<InsertMonthlyBalance>): Promise<MonthlyBalance | undefined>;
  
  getBalanceSpreadsheet(clientId: number, year: number, localId?: number | number[]): Promise<{
    groups: Array<{
      id: number;
      name: string;
      type: string;
      categories: Array<{
        id: number;
        name: string;
        monthlyTotals: Record<number, number>;
        yearTotal: number;
      }>;
      monthlyTotals: Record<number, number>;
      yearTotal: number;
    }>;
    summary: {
      income: Record<number, number>;
      expenses: Record<number, number>;
      net: Record<number, number>;
      /** Ventas por local y mes (misma composición que `income`). Base del CMV por local. */
      incomeByLocal: Record<number, Record<number, number>>;
      totalIncome: number;
      totalExpenses: number;
      totalNet: number;
    };
  }>;
  
  getSales(clientId: number): Promise<Sale[]>;
  /** Suma de ventas (bruto, con IVA) por período/local desde el grupo "Ventas" (extractos). */
  getSalesTotalByPeriod(clientId: number, opts: { dateFrom?: string; dateTo?: string; localIds?: number[] }): Promise<number>;
  /** Suma de ventas brutas (con IVA) por período/local desde la tabla datalive_ventas. */
  getDataliveSalesTotalByPeriod(clientId: number, opts: { dateFrom?: string; dateTo?: string; localIds?: number[] }): Promise<number>;
  /** CMC: costo de insumos comprados SIN IVA, desglosado por rubro padre → sub-rubro, con % vs venta sin IVA. */
  getCmcReport(clientId: number, opts: { dateFrom?: string; dateTo?: string; localIds?: number[] }): Promise<{
    total: number;
    salesGross: number;
    salesNet: number;
    pct: number | null;
    rubros: Array<{
      id: number | null;
      name: string;
      total: number;
      pct: number | null;
      subRubros: Array<{ id: number | null; name: string; total: number; pct: number | null }>;
    }>;
  }>;

  /** PAP: total entregado (facturas CON IVA) y total pagado, con % vs venta CON IVA. */
  getPapReport(clientId: number, opts: { dateFrom?: string; dateTo?: string; localIds?: number[]; supplierIds?: number[] }): Promise<{
    totalEntregado: number;
    totalPagado: number;
    salesWithIva: number;
    pctEntregado: number | null;
    pctPagado: number | null;
    bySupplier: Array<{ supplierId: number | null; name: string; entregado: number; pagado: number; saldo: number }>;
  }>;

  // Valorización de Stock (Fase 6)
  listStockValuations(clientId: number, localId?: number): Promise<StockValuation[]>;
  getStockValuation(clientId: number, id: number): Promise<
    | { valuation: StockValuation; items: Array<StockValuationItem & { supplyName: string | null; unitName: string | null }> }
    | undefined
  >;
  createStockValuation(input: {
    clientId: number;
    localId?: number | null;
    valuationDate: string;
    notes?: string | null;
    createdBy?: string | null;
    items: Array<{ supplyId: number; quantity: number; unitOfMeasureId?: number | null; replacementUnitCost?: number | null }>;
  }): Promise<StockValuation>;
  /**
   * Edita una valorización activa (fecha, local, cantidades) y recalcula los CMV guardados
   * que la usan — si no, quedarían apuntando a una valorización que ya dice otra cosa.
   * Los costos ya congelados se conservan: solo los insumos nuevos toman el lastCost de hoy.
   */
  updateStockValuation(clientId: number, id: number, input: {
    localId?: number | null;
    valuationDate: string;
    notes?: string | null;
    items: Array<{ supplyId: number; quantity: number; unitOfMeasureId?: number | null }>;
  }): Promise<{ valuation: StockValuation; recalculatedCmvIds: number[]; failedCmvIds: number[] }>;
  reverseStockValuation(clientId: number, id: number): Promise<StockValuation | undefined>;

  // Punto de Equilibrio (Fase 8)
  listBreakevenAnalyses(clientId: number): Promise<BreakevenAnalysis[]>;
  getBreakevenAnalysis(clientId: number, id: number): Promise<{ analysis: BreakevenAnalysis; fixedCosts: BreakevenFixedCost[] } | undefined>;
  createBreakevenAnalysis(input: {
    clientId: number;
    localId?: number | null;
    name: string;
    recipeId?: number | null;
    salePriceNoIva: number;
    variableCostNoIva: number;
    createdBy?: string | null;
    commissions?: AppliedVariableCost[];
    /** Foto de la mezcla cuando el análisis se hizo con producto líder. */
    productMix?: unknown;
    fixedCosts: Array<{ transactionCategoryId?: number | null; financialGroupId?: number | null; label?: string | null; amount: number }>;
  }): Promise<BreakevenAnalysis>;

  // Catálogo de costos variables en % del Punto de Equilibrio (ago-2026)
  listBreakevenVariableCosts(clientId: number): Promise<BreakevenVariableCost[]>;
  createBreakevenVariableCost(input: {
    clientId: number;
    name: string;
    pct: number;
    base: VariableCostBase;
    ivaRate?: number | null;
    createdBy?: string | null;
  }): Promise<BreakevenVariableCost>;
  updateBreakevenVariableCost(
    clientId: number,
    id: number,
    patch: { name?: string; pct?: number; base?: VariableCostBase; ivaRate?: number | null; active?: boolean },
  ): Promise<BreakevenVariableCost | undefined>;
  deleteBreakevenVariableCost(clientId: number, id: number): Promise<boolean>;

  /** CMV = stock inicial + compras (CMC) − stock final; CMV% sobre venta (con o sin IVA según ivaIncluded). */
  computeCmv(clientId: number, opts: { localId?: number; stockInicialId: number; stockFinalId: number; dateFrom?: string; dateTo?: string; salesSource?: "extractos" | "datalive" | "fudo" | "shares"; ivaIncluded?: boolean }): Promise<{
    stockInicial: number;
    stockInicialDate: string;
    stockFinal: number;
    stockFinalDate: string;
    compras: number;
    cmv: number;
    salesGross: number;
    ventaNeta: number;
    cmvPct: number | null;
    decomisos: number;
    decomisoPct: number | null;
  }>;
  /** Total de compras (CMC sin IVA) para un período — usado para preview en vivo. */
  getCmcTotal(clientId: number, opts: { localId?: number; dateFrom?: string; dateTo?: string }): Promise<number>;
  /** Total de decomisos valorizados para un período/local — usado en el CMV y preview. */
  getDecomisosTotal(clientId: number, opts: { localId?: number; dateFrom?: string; dateTo?: string }): Promise<number>;
  /** Guarda un cálculo de CMV como registro (recalcula server-side para integridad). */
  saveCmvCalculation(clientId: number, opts: { localId?: number; stockInicialId: number; stockFinalId: number; dateFrom?: string; dateTo?: string; salesSource?: "extractos" | "datalive" | "fudo" | "shares"; ivaIncluded?: boolean; createdBy?: string | null }): Promise<CmvCalculation>;
  listCmvCalculations(clientId: number): Promise<CmvCalculation[]>;
  /** Edita los parámetros de un CMV guardado y recalcula sus derivados server-side. */
  updateCmvCalculation(clientId: number, id: number, opts: { localId?: number; stockInicialId: number; stockFinalId: number; dateFrom?: string; dateTo?: string; salesSource?: "extractos" | "datalive" | "fudo" | "shares"; ivaIncluded?: boolean }): Promise<CmvCalculation>;
  /** CMV guardados que usan una valorización como stock inicial o final. */
  listCmvCalculationsByValuation(clientId: number, valuationId: number): Promise<CmvCalculation[]>;
  deleteCmvCalculation(clientId: number, id: number): Promise<void>;

  // Ventas Datalive (tabla paralela, fase 1)
  listDataliveVentas(clientId: number, localId?: number): Promise<DataliveVenta[]>;
  importDataliveVentas(
    clientId: number,
    localId: number,
    days: Array<{ fecha: string; ventaTotal: number; ventaEfectivo: number; ventaOnline: number }>,
    opts: { sourceFile?: string | null; createdBy?: string | null; replaceFechas?: string[] },
  ): Promise<{ insertados: number; omitidos: number; reemplazados: number }>;
  deleteDataliveVenta(clientId: number, id: number): Promise<boolean>;

  // Ventas FUDO (tabla paralela)
  listFudoVentas(clientId: number, localId?: number): Promise<FudoVenta[]>;
  importFudoVentas(
    clientId: number,
    localId: number,
    days: Array<{ fecha: string; ventaTotal: number } & FudoFiscalSplit>,
    opts: { sourceFile?: string | null; createdBy?: string | null; replaceFechas?: string[] },
  ): Promise<{ insertados: number; omitidos: number; reemplazados: number }>;
  deleteFudoVenta(clientId: number, id: number): Promise<boolean>;

  // Productos FUDO (solapa Adiciones)
  listFudoProductos(clientId: number, opts?: { localId?: number; fechaDesde?: string; fechaHasta?: string }): Promise<FudoProducto[]>;
  importFudoProductos(
    clientId: number,
    localId: number,
    items: Array<{ fecha: string; producto: string; categoria: string; cantidad: number }>,
    opts: { sourceFile?: string | null; createdBy?: string | null; replaceFechas?: string[] },
  ): Promise<{ insertados: number; omitidos: number; reemplazados: number }>;
  deleteFudoProductosByFecha(clientId: number, localId: number, fecha: string): Promise<number>;

  // Productos Datalive (reporte de productos separado)
  listDataliveProductos(clientId: number, opts?: { localId?: number; fechaDesde?: string; fechaHasta?: string }): Promise<DataliveProducto[]>;
  importDataliveProductos(
    clientId: number,
    localId: number,
    fechaDesde: string,
    fechaHasta: string,
    items: Array<{ producto: string; cantidad: number }>,
    opts: { sourceFile?: string | null; createdBy?: string | null; replace?: boolean },
  ): Promise<{ insertados: number; omitidos: number; reemplazados: number }>;
  deleteDataliveProductosByPeriodo(clientId: number, localId: number, fechaDesde: string, fechaHasta: string): Promise<number>;

  // Ventas + Productos SHARES (tercer origen, espejo de FUDO)
  listSharesVentas(clientId: number, localId?: number): Promise<SharesVenta[]>;
  importSharesVentas(
    clientId: number,
    localId: number,
    days: Array<{
      fecha: string;
      ventaTotal: number;
      ventaEfectivo: number;
      ventaTarjeta: number;
      ventaEfectivoOnline: number;
      ventaOperOnline: number;
      ventaMercadopago: number;
    }>,
    opts: { sourceFile?: string | null; createdBy?: string | null; replaceFechas?: string[] },
  ): Promise<{ insertados: number; omitidos: number; reemplazados: number }>;
  deleteSharesVenta(clientId: number, id: number): Promise<boolean>;
  listSharesProductos(clientId: number, opts?: { localId?: number; fechaDesde?: string; fechaHasta?: string }): Promise<SharesProducto[]>;
  importSharesProductos(
    clientId: number,
    localId: number,
    items: Array<{ fecha: string; producto: string; categoria: string; cantidad: number }>,
    opts: { sourceFile?: string | null; createdBy?: string | null; replaceFechas?: string[] },
  ): Promise<{ insertados: number; omitidos: number; reemplazados: number }>;
  deleteSharesProductosByFecha(clientId: number, localId: number, fecha: string): Promise<number>;
  getSharesSalesTotalByPeriod(clientId: number, opts: { dateFrom?: string; dateTo?: string; localIds?: number[] }): Promise<number>;

  // Decomisos (mercadería decomisada — reporte de Datalive, valorizada por local)
  listDecomisos(clientId: number, opts?: { localId?: number; fechaDesde?: string; fechaHasta?: string; tipo?: string }): Promise<Decomiso[]>;
  getDecomisoProductMappings(clientId: number): Promise<DecomisoProductMapping[]>;
  getDecomisoLocalMappings(clientId: number): Promise<DecomisoLocalMapping[]>;
  importDecomisos(
    clientId: number,
    items: Array<{
      codDecomiso: string;
      codProducto: string;
      fecha: string;
      descripcion: string;
      sucursal: string;
      tipoDecomiso: string;
      cantidad: number;
      localId: number;
      supplyId: number | null;
    }>,
    opts: { sourceFile?: string | null; createdBy?: string | null },
  ): Promise<{ insertados: number; omitidos: number }>;
  saveDecomisoLocalMappings(clientId: number, maps: Array<{ sucursalOriginal: string; localId: number }>): Promise<void>;
  saveDecomisoProductMappings(clientId: number, maps: Array<{ codProducto: string; descripcionOriginal?: string | null; supplyId: number }>): Promise<void>;
  deleteDecomiso(clientId: number, id: number): Promise<boolean>;
  deleteDecomisosBySource(clientId: number, sourceFile: string): Promise<number>;

  getPermissions(): Promise<Permission[]>;
  createPermission(permission: InsertPermission): Promise<Permission>;
  
  getRolePermissions(clientId: number, role?: string): Promise<RolePermission[]>;
  setRolePermission(rolePermission: InsertRolePermission): Promise<RolePermission>;
  deleteRolePermission(clientId: number, role: string, permissionId: number): Promise<boolean>;
  /**
   * Resuelve si un rol tiene un permiso efectivo para una acción concreta.
   * `socio` siempre devuelve true (override de dueño). El resto se valida contra `role_permissions`.
   */
  getEffectivePermission(
    clientId: number,
    role: string,
    code: string,
    action: "view" | "create" | "edit" | "delete",
  ): Promise<boolean>;
  
  getUserLocalAssignments(clientId: number, userId?: string): Promise<UserLocalAssignment[]>;
  createUserLocalAssignment(assignment: InsertUserLocalAssignment): Promise<UserLocalAssignment>;
  updateUserLocalAssignment(id: number, assignment: Partial<InsertUserLocalAssignment>): Promise<UserLocalAssignment | undefined>;
  deleteUserLocalAssignment(id: number): Promise<boolean>;
  
  getNotifications(clientId: number, userId?: string): Promise<Notification[]>;
  createNotification(notification: InsertNotification): Promise<Notification>;
  markNotificationRead(id: number): Promise<Notification | undefined>;
  
  getStockLevels(clientId: number, localId?: number): Promise<StockLevel[]>;
  getStockLevel(clientId: number, localId: number, supplyId: number): Promise<StockLevel | undefined>;
  upsertStockLevel(stockLevel: InsertStockLevel): Promise<StockLevel>;
  
  getStockMovements(clientId: number, localId?: number): Promise<StockMovement[]>;
  createStockMovement(movement: InsertStockMovement): Promise<StockMovement>;
  
  getStockAdjustments(clientId: number, localId?: number): Promise<StockAdjustment[]>;
  createStockAdjustment(adjustment: InsertStockAdjustment): Promise<StockAdjustment>;
  
  getAuditTemplates(clientId: number): Promise<AuditTemplate[]>;
  getAuditTemplate(clientId: number, id: number): Promise<AuditTemplate | undefined>;
  createAuditTemplate(template: InsertAuditTemplate): Promise<AuditTemplate>;
  updateAuditTemplate(clientId: number, id: number, template: Partial<InsertAuditTemplate>): Promise<AuditTemplate | undefined>;
  deleteAuditTemplate(clientId: number, id: number): Promise<boolean>;
  
  getAuditTemplateItems(templateId: number): Promise<AuditTemplateItem[]>;
  createAuditTemplateItem(item: InsertAuditTemplateItem): Promise<AuditTemplateItem>;
  deleteAuditTemplateItem(id: number): Promise<boolean>;
  
  getOperationalAudits(clientId: number, localId?: number): Promise<OperationalAudit[]>;
  getOperationalAudit(clientId: number, id: number): Promise<OperationalAudit | undefined>;
  createOperationalAudit(audit: InsertOperationalAudit): Promise<OperationalAudit>;
  updateOperationalAudit(clientId: number, id: number, audit: Partial<InsertOperationalAudit>): Promise<OperationalAudit | undefined>;
  
  getAuditResults(auditId: number): Promise<AuditResult[]>;
  createAuditResult(result: InsertAuditResult): Promise<AuditResult>;
  updateAuditResult(id: number, result: Partial<InsertAuditResult>): Promise<AuditResult | undefined>;
  
  getEmployees(clientId: number, localId?: number): Promise<Employee[]>;
  getEmployee(clientId: number, id: number): Promise<Employee | undefined>;
  createEmployee(employee: InsertEmployee): Promise<Employee>;
  updateEmployee(clientId: number, id: number, employee: Partial<InsertEmployee>): Promise<Employee | undefined>;
  deleteEmployee(clientId: number, id: number): Promise<boolean>;
  
  getAttendances(clientId: number, employeeId?: number, date?: string): Promise<Attendance[]>;
  createAttendance(attendance: InsertAttendance): Promise<Attendance>;
  updateAttendance(clientId: number, id: number, attendance: Partial<InsertAttendance>): Promise<Attendance | undefined>;
  
  getPayrolls(clientId: number, employeeId?: number, period?: string): Promise<Payroll[]>;
  createPayroll(payroll: InsertPayroll): Promise<Payroll>;
  updatePayroll(clientId: number, id: number, payroll: Partial<InsertPayroll>): Promise<Payroll | undefined>;
  
  getClientUsers(clientId: number): Promise<Array<User & { role: string | null }>>;
  updateClientUserProfile(
    clientId: number,
    userId: string,
    data: { firstName?: string | null; lastName?: string | null; email?: string | null },
  ): Promise<User | undefined>;
  /** @deprecated Borra otras empresas del usuario; preferí addUserToClient / setUserRoleInClient */
  reassignUserToClient(userId: string, newClientId: number, role?: string): Promise<boolean>;
  addUserToClient(userId: string, clientId: number, role: string): Promise<void>;
  setUserRoleInClient(clientId: number, userId: string, role: string): Promise<boolean>;
  removeUserFromClient(clientId: number, userId: string): Promise<boolean>;
  countClientsForUser(userId: string): Promise<number>;
  getUserCredentialsFlags(userId: string): Promise<{ mustChangePassword: boolean } | null>;
  setUserPasswordHash(userId: string, passwordHash: string, mustChangePassword: boolean): Promise<void>;

  getClientInvitations(clientId: number): Promise<ClientInvitation[]>;
  getInvitationByCode(inviteCode: string): Promise<ClientInvitation | undefined>;
  createInvitation(invitation: InsertClientInvitation): Promise<ClientInvitation>;
  useInvitation(inviteCode: string, userId: string): Promise<boolean>;
  deleteInvitation(clientId: number, id: number): Promise<boolean>;
  
  getLocalAliases(clientId: number): Promise<LocalAlias[]>;
  getLocalAliasByName(clientId: number, alias: string): Promise<LocalAlias | undefined>;
  createLocalAlias(alias: InsertLocalAlias): Promise<LocalAlias>;
  deleteLocalAlias(clientId: number, id: number): Promise<boolean>;

  getSupplySuppliers(clientId: number): Promise<SupplySupplier[]>;
  getSupplySuppliersBySupply(clientId: number, supplyId: number): Promise<SupplySupplier[]>;
  setSupplySuppliers(clientId: number, supplyId: number, supplierIds: number[]): Promise<void>;
  getSupplierRubros(clientId: number): Promise<SupplierRubro[]>;
  getSupplierRubrosBySupplier(clientId: number, supplierId: number): Promise<SupplierRubro[]>;
  setSupplierRubros(clientId: number, supplierId: number, rubroIds: number[]): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  /**
   * Recetas que deben recalcularse cuando cambian costos de `supplyIds`:
   * ingredientes con ese insumo + ancestros que referencian esas recetas como sub-receta.
   */
  private async collectRecipeIdsForSupplyCostChange(
    clientId: number,
    tx: typeof db,
    supplyIds: number[],
  ): Promise<number[]> {
    const unique = [...new Set(supplyIds.filter((id) => Number(id) > 0))];
    if (unique.length === 0) return [];

    const directRows = await tx
      .select({ recipeId: recipeIngredients.recipeId })
      .from(recipeIngredients)
      .innerJoin(recipes, eq(recipeIngredients.recipeId, recipes.id))
      .where(
        and(
          eq(recipes.clientId, clientId),
          isNotNull(recipeIngredients.supplyId),
          inArray(recipeIngredients.supplyId, unique),
        ),
      );

    const affected = new Set<number>();
    for (const row of directRows) {
      if (row.recipeId != null) affected.add(row.recipeId);
    }

    let toExpand = new Set(affected);
    while (toExpand.size > 0) {
      const frontierIds = [...toExpand];
      toExpand = new Set();

      const parentRows = await tx
        .select({ recipeId: recipeIngredients.recipeId })
        .from(recipeIngredients)
        .innerJoin(recipes, eq(recipeIngredients.recipeId, recipes.id))
        .where(
          and(
            eq(recipes.clientId, clientId),
            isNotNull(recipeIngredients.subRecipeId),
            inArray(recipeIngredients.subRecipeId, frontierIds),
          ),
        );

      for (const row of parentRows) {
        if (row.recipeId == null) continue;
        if (!affected.has(row.recipeId)) {
          affected.add(row.recipeId);
          toExpand.add(row.recipeId);
        }
      }
    }

    return [...affected];
  }

  /**
   * Recalcula costos de ingredientes y totales de recetas.
   * @param affectedSupplyIds Si se pasa (posiblemente vacío), solo se procesan recetas vinculadas a esos insumos
   *   (más ancestros por sub-recetas). Si es `undefined`, se recalcula todo el cliente (operación pesada).
   */
  private async recalculateAllRecipeCostsForClient(
    clientId: number,
    tx: typeof db,
    affectedSupplyIds?: number[],
  ): Promise<void> {
    const toFinite = (value: number, fallback = 0) => (Number.isFinite(value) ? value : fallback);
    const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

    if (affectedSupplyIds !== undefined && affectedSupplyIds.length === 0) {
      return;
    }

    let scopedRecipeIds: number[] | undefined;
    if (affectedSupplyIds !== undefined) {
      scopedRecipeIds = await this.collectRecipeIdsForSupplyCostChange(clientId, tx, affectedSupplyIds);
      if (scopedRecipeIds.length === 0) return;
    }

    // Memoize to avoid recalculating the same recipe multiple times (nested sub-recipes).
    const memo = new Map<number, { totalCost: number; usefulYield: number }>();
    const visiting = new Set<number>();

    const computeUnitCostForRecipe = (recipeTotalCost: number, usefulYield: number) => {
      return usefulYield > 0 ? recipeTotalCost / usefulYield : recipeTotalCost;
    };

    // Same source-of-truth used by Supplies table: latest invoice item by date/id.
    const latestPurchaseRows = await tx
      .select({
        supplyId: invoiceItems.supplyId,
        quantity: invoiceItems.quantity,
        subtotal: invoiceItems.subtotal,
        unitPrice: invoiceItems.unitPrice,
        invoiceDate: invoices.invoiceDate,
        itemId: invoiceItems.id,
      })
      .from(invoiceItems)
      .innerJoin(invoices, eq(invoiceItems.invoiceId, invoices.id))
      .where(and(eq(invoices.clientId, clientId), isNotNull(invoiceItems.supplyId)))
      .orderBy(desc(invoices.invoiceDate), desc(invoiceItems.id));

    const latestPurchaseUnitCostBySupplyId = new Map<number, number>();
    for (const row of latestPurchaseRows) {
      const supplyId = row.supplyId;
      if (!supplyId || latestPurchaseUnitCostBySupplyId.has(supplyId)) continue;

      const qty = parseFloat(String(row.quantity ?? 0)) || 0;
      const subtotal = parseFloat(String(row.subtotal ?? 0)) || 0;
      const unitPrice = parseFloat(String(row.unitPrice ?? 0)) || 0;
      const normalizedUnitCost = unitPrice > 0 ? unitPrice : (qty > 0 ? subtotal / qty : 0);
      latestPurchaseUnitCostBySupplyId.set(supplyId, normalizedUnitCost);
    }

    const computeAndPersist = async (recipeId: number): Promise<{ totalCost: number; usefulYield: number }> => {
      const memoEntry = memo.get(recipeId);
      if (memoEntry) return memoEntry;

      if (visiting.has(recipeId)) {
        // Prevent hard-fail on cyclic references; keep endpoint responsive.
        const zero = { totalCost: 0, usefulYield: 0 };
        memo.set(recipeId, zero);
        return zero;
      }
      visiting.add(recipeId);

      const [recipe] = await tx.select().from(recipes).where(and(eq(recipes.id, recipeId), eq(recipes.clientId, clientId)));
      if (!recipe) {
        // If the recipe disappeared, return zeros to avoid crashing.
        const zero = { totalCost: 0, usefulYield: 0 };
        memo.set(recipeId, zero);
        visiting.delete(recipeId);
        return zero;
      }

      const ingredientRows = await tx
        .select()
        .from(recipeIngredients)
        .where(eq(recipeIngredients.recipeId, recipeId));

      const supplyIds = Array.from(
        new Set(
          ingredientRows
            .map((i) => i.supplyId)
            .filter((id): id is number => id !== null && id !== undefined),
        ),
      );

      const suppliesById = new Map<number, (typeof supplies) & { lastCost?: any; unitCost?: any }>();
      if (supplyIds.length > 0) {
        const supplyRows = await tx.select().from(supplies).where(and(eq(supplies.clientId, clientId), inArray(supplies.id, supplyIds)));
        for (const s of supplyRows) suppliesById.set(s.id, s);
      }

      let totalCost = 0;
      const ingredientUpdates: Array<{ ingredientId: number; currentCost: string; totalCost: string }> = [];

      for (const ing of ingredientRows) {
        const quantityTotal = parseFloat(String(ing.quantityTotal ?? 0)) || 0;

        let unitCost = 0;
        if (ing.supplyId) {
          const s = suppliesById.get(ing.supplyId);
          if (s) {
            const latestPurchaseUnitCost = latestPurchaseUnitCostBySupplyId.get(ing.supplyId) || 0;
            const lastCost = parseFloat(String(s.lastCost ?? 0)) || 0;
            const cppUnitCost = parseFloat(String(s.unitCost ?? 0)) || 0;
            unitCost = latestPurchaseUnitCost > 0 ? latestPurchaseUnitCost : (lastCost > 0 ? lastCost : cppUnitCost);
          }
        } else if (ing.subRecipeId) {
          const sub = await computeAndPersist(ing.subRecipeId);
          unitCost = computeUnitCostForRecipe(sub.totalCost, sub.usefulYield);
        }

        const lineTotal = unitCost * quantityTotal;
        totalCost += lineTotal;

        ingredientUpdates.push({
          ingredientId: ing.id,
          currentCost: unitCost.toFixed(4),
          totalCost: lineTotal.toFixed(4),
        });
      }

      // Persist ingredient current costs.
      for (const update of ingredientUpdates) {
        await tx
          .update(recipeIngredients)
          .set({
            currentCost: update.currentCost,
            totalCost: update.totalCost,
          })
          .where(eq(recipeIngredients.id, update.ingredientId));
      }

      // Persist recipe totals.
      const newTotalCost = clamp(toFinite(parseFloat(totalCost.toFixed(4))), -99999999.9999, 99999999.9999);
      const usefulYield = parseFloat(String(recipe.usefulYield ?? 0)) || 0;

      if (recipe.recipeType === "plato") {
        // El precio de referencia depende de la receta: con IVA quitado o tal como se cobra.
        const metrics = computeRecipeMetrics({
          grossPrice: recipeGrossPrice(recipe),
          totalCost: newTotalCost,
          removeIva: recipeRemovesIva(recipe as any),
        });

        const cmvPercentage = clamp(toFinite(metrics.cmvPercentage), -999.99, 999.99);
        const margin = clamp(toFinite(metrics.margin), -9999999999.99, 9999999999.99);
        const marginPercentage = clamp(toFinite(metrics.marginPercentage), -999.99, 999.99);
        const markup = clamp(toFinite(metrics.markup), -999.99, 999.99);

        await tx
          .update(recipes)
          .set({
            totalCost: newTotalCost.toFixed(4),
            // Se reescriben los dos precios para que el de referencia siempre coincida con la
            // política de IVA de la receta y el bruto quede explícito (las recetas viejas lo
            // tenían en 0 y se reconstruía cada vez).
            salePrice: metrics.salePrice.toFixed(2),
            salePriceWithTax: metrics.salePriceWithTax.toFixed(2),
            cmvPercentage: cmvPercentage.toFixed(2),
            margin: margin.toFixed(2),
            marginPercentage: marginPercentage.toFixed(2),
            markup: markup.toFixed(2),
            updatedAt: new Date(),
          })
          .where(and(eq(recipes.id, recipeId), eq(recipes.clientId, clientId)));
      } else {
        await tx
          .update(recipes)
          .set({
            totalCost: newTotalCost.toFixed(4),
            updatedAt: new Date(),
          })
          .where(and(eq(recipes.id, recipeId), eq(recipes.clientId, clientId)));
      }

      const result = { totalCost: newTotalCost, usefulYield };
      memo.set(recipeId, result);
      visiting.delete(recipeId);
      return result;
    };

    const recipeIdsToProcess =
      scopedRecipeIds ??
      (await tx.select({ id: recipes.id }).from(recipes).where(eq(recipes.clientId, clientId))).map((r) => r.id);

    for (const id of recipeIdsToProcess) {
      await computeAndPersist(id);
    }
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    // First check if user exists by id or email
    const existingById = userData.id ? await db.select().from(users).where(eq(users.id, userData.id)).then(r => r[0]) : null;
    const existingByEmail = userData.email ? await db.select().from(users).where(eq(users.email, userData.email)).then(r => r[0]) : null;
    
    let user: User;
    
    if (existingById) {
      // Update existing user by id
      const [updated] = await db
        .update(users)
        .set({
          email: userData.email,
          firstName: userData.firstName,
          lastName: userData.lastName,
          profileImageUrl: userData.profileImageUrl,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userData.id!))
        .returning();
      user = updated;
    } else if (existingByEmail) {
      // User exists by email but different id - update data but keep existing id
      const [updated] = await db
        .update(users)
        .set({
          firstName: userData.firstName,
          lastName: userData.lastName,
          profileImageUrl: userData.profileImageUrl,
          updatedAt: new Date(),
        })
        .where(eq(users.email, userData.email!))
        .returning();
      user = updated;
    } else {
      // Insert new user
      const [inserted] = await db
        .insert(users)
        .values(userData)
        .returning();
      user = inserted;
    }
    
    const existingClient = await this.getClientByUserId(user.id);
    if (!existingClient) {
      const [newClient] = await db
        .insert(clients)
        .values({ name: `${user.firstName || 'Nuevo'} ${user.lastName || 'Cliente'}`.trim() })
        .returning();
      
      await db.insert(userClients).values({
        userId: user.id,
        clientId: newClient.id,
        role: "admin",
      });
    }
    
    return user;
  }

  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async getClientByUserId(userId: string): Promise<Client | undefined> {
    const [result] = await db
      .select({ client: clients })
      .from(userClients)
      .innerJoin(clients, eq(userClients.clientId, clients.id))
      .where(eq(userClients.userId, userId));
    return result?.client;
  }

  async getUserRoleInClient(userId: string, clientId: number): Promise<string | null> {
    const [row] = await db
      .select({ role: userClients.role })
      .from(userClients)
      .where(and(eq(userClients.userId, userId), eq(userClients.clientId, clientId)));
    const r = row?.role;
    return r != null && String(r).trim() !== "" ? String(r) : null;
  }

  async createClient(client: InsertClient): Promise<Client> {
    const [newClient] = await db.insert(clients).values(client).returning();
    return newClient;
  }

  async getLocals(clientId: number): Promise<Local[]> {
    return db.select().from(locals).where(eq(locals.clientId, clientId)).orderBy(locals.name);
  }

  async createLocal(local: InsertLocal): Promise<Local> {
    const [newLocal] = await db.insert(locals).values(local).returning();
    return newLocal;
  }

  async updateLocal(clientId: number, id: number, local: Partial<InsertLocal>): Promise<Local | undefined> {
    const [updated] = await db.update(locals)
      .set({ ...local, updatedAt: new Date() })
      .where(and(eq(locals.id, id), eq(locals.clientId, clientId)))
      .returning();
    return updated;
  }

  async deleteLocal(clientId: number, id: number): Promise<boolean> {
    const result = await db.delete(locals).where(and(eq(locals.id, id), eq(locals.clientId, clientId)));
    return (result.rowCount ?? 0) > 0;
  }

  async getSuppliers(clientId: number): Promise<Supplier[]> {
    return db.select().from(suppliers).where(eq(suppliers.clientId, clientId)).orderBy(suppliers.businessName);
  }

  async getSupplierByCuit(clientId: number, cuit: string): Promise<Supplier | undefined> {
    const [supplier] = await db.select().from(suppliers)
      .where(and(eq(suppliers.clientId, clientId), eq(suppliers.cuit, cuit)));
    return supplier;
  }

  async createSupplier(supplier: InsertSupplier): Promise<Supplier> {
    const [newSupplier] = await db.insert(suppliers).values(supplier).returning();
    return newSupplier;
  }

  async updateSupplier(clientId: number, id: number, supplier: Partial<InsertSupplier>): Promise<Supplier | undefined> {
    const [updated] = await db.update(suppliers)
      .set({ ...supplier, updatedAt: new Date() })
      .where(and(eq(suppliers.id, id), eq(suppliers.clientId, clientId)))
      .returning();
    return updated;
  }

  async deleteSupplier(clientId: number, id: number): Promise<boolean> {
    const result = await db.delete(suppliers).where(and(eq(suppliers.id, id), eq(suppliers.clientId, clientId)));
    return (result.rowCount ?? 0) > 0;
  }

  async getRubros(clientId: number): Promise<Rubro[]> {
    return db.select().from(rubros).where(eq(rubros.clientId, clientId)).orderBy(rubros.name);
  }

  async createRubro(rubro: InsertRubro): Promise<Rubro> {
    const [newRubro] = await db.insert(rubros).values(rubro).returning();
    return newRubro;
  }

  async updateRubro(clientId: number, id: number, rubro: Partial<InsertRubro>): Promise<Rubro | undefined> {
    const [updated] = await db.update(rubros)
      .set(rubro)
      .where(and(eq(rubros.id, id), eq(rubros.clientId, clientId)))
      .returning();
    return updated;
  }

  async deleteRubro(clientId: number, id: number): Promise<boolean> {
    const result = await db.delete(rubros).where(and(eq(rubros.id, id), eq(rubros.clientId, clientId)));
    return (result.rowCount ?? 0) > 0;
  }

  async getSubRubros(clientId: number): Promise<(SubRubro & { rubro?: Rubro | null })[]> {
    const results = await db.select({
      subRubro: subRubros,
      rubro: rubros,
    })
    .from(subRubros)
    .leftJoin(rubros, eq(subRubros.rubroId, rubros.id))
    .where(eq(subRubros.clientId, clientId))
    .orderBy(subRubros.name);
    
    return results.map(r => ({
      ...r.subRubro,
      rubro: r.rubro,
    }));
  }

  async getSubRubrosByRubro(clientId: number, rubroId: number): Promise<SubRubro[]> {
    return db.select().from(subRubros)
      .where(and(eq(subRubros.clientId, clientId), eq(subRubros.rubroId, rubroId)))
      .orderBy(subRubros.name);
  }

  async createSubRubro(subRubro: InsertSubRubro): Promise<SubRubro> {
    const [newSubRubro] = await db.insert(subRubros).values(subRubro).returning();
    return newSubRubro;
  }

  async updateSubRubro(clientId: number, id: number, subRubro: Partial<InsertSubRubro>): Promise<SubRubro | undefined> {
    const [updated] = await db.update(subRubros)
      .set(subRubro)
      .where(and(eq(subRubros.id, id), eq(subRubros.clientId, clientId)))
      .returning();
    return updated;
  }

  async deleteSubRubro(clientId: number, id: number): Promise<boolean> {
    const result = await db.delete(subRubros).where(and(eq(subRubros.id, id), eq(subRubros.clientId, clientId)));
    return (result.rowCount ?? 0) > 0;
  }

  async getTaxes(clientId: number): Promise<Tax[]> {
    return db.select().from(taxes).where(eq(taxes.clientId, clientId)).orderBy(taxes.name);
  }

  async createTax(tax: InsertTax): Promise<Tax> {
    const [newTax] = await db.insert(taxes).values(tax).returning();
    return newTax;
  }

  async updateTax(clientId: number, id: number, tax: Partial<InsertTax>): Promise<Tax | undefined> {
    const [updated] = await db.update(taxes)
      .set(tax)
      .where(and(eq(taxes.id, id), eq(taxes.clientId, clientId)))
      .returning();
    return updated;
  }

  async deleteTax(clientId: number, id: number): Promise<boolean> {
    const result = await db.delete(taxes).where(and(eq(taxes.id, id), eq(taxes.clientId, clientId)));
    return (result.rowCount ?? 0) > 0;
  }

  async getUnits(clientId: number): Promise<UnitOfMeasure[]> {
    return db.select().from(unitsOfMeasure).where(eq(unitsOfMeasure.clientId, clientId)).orderBy(unitsOfMeasure.name);
  }

  async createUnit(unit: InsertUnitOfMeasure): Promise<UnitOfMeasure> {
    const [newUnit] = await db.insert(unitsOfMeasure).values(unit).returning();
    return newUnit;
  }

  async updateUnit(clientId: number, id: number, unit: Partial<InsertUnitOfMeasure>): Promise<UnitOfMeasure | undefined> {
    const [updated] = await db.update(unitsOfMeasure)
      .set(unit)
      .where(and(eq(unitsOfMeasure.id, id), eq(unitsOfMeasure.clientId, clientId)))
      .returning();
    return updated;
  }

  async deleteUnit(clientId: number, id: number): Promise<boolean> {
    const result = await db.delete(unitsOfMeasure).where(and(eq(unitsOfMeasure.id, id), eq(unitsOfMeasure.clientId, clientId)));
    return (result.rowCount ?? 0) > 0;
  }

  async getSupplies(clientId: number): Promise<any[]> {
    const rows = await db
      .select({
        supply: supplies,
        rubro: rubros,
        subRubro: subRubros,
        unitOfMeasure: unitsOfMeasure,
      })
      .from(supplies)
      .leftJoin(rubros, eq(supplies.rubroId, rubros.id))
      .leftJoin(subRubros, eq(supplies.subRubroId, subRubros.id))
      .leftJoin(unitsOfMeasure, eq(supplies.unitOfMeasureId, unitsOfMeasure.id))
      .where(eq(supplies.clientId, clientId))
      .orderBy(supplies.name);
    const latestPurchaseRows = await db
      .select({
        supplyId: invoiceItems.supplyId,
        invoiceId: invoices.id,
        invoiceNumber: invoices.invoiceNumber,
        invoiceDate: invoices.invoiceDate,
        quantity: invoiceItems.quantity,
        unitPrice: invoiceItems.unitPrice,
        subtotal: invoiceItems.subtotal,
      })
      .from(invoiceItems)
      .innerJoin(invoices, eq(invoiceItems.invoiceId, invoices.id))
      .where(and(eq(invoices.clientId, clientId), isNotNull(invoiceItems.supplyId)))
      .orderBy(desc(invoices.invoiceDate), desc(invoiceItems.id));

    const latestPurchaseBySupplyId = new Map<number, {
      invoiceId: number;
      invoiceNumber: string | null;
      invoiceDate: string | null;
      quantity: string;
      unitPrice: string;
      subtotal: string;
    }>();

    for (const row of latestPurchaseRows) {
      const supplyId = row.supplyId;
      if (!supplyId || latestPurchaseBySupplyId.has(supplyId)) continue;

      latestPurchaseBySupplyId.set(supplyId, {
        invoiceId: row.invoiceId,
        invoiceNumber: row.invoiceNumber ?? null,
        invoiceDate: row.invoiceDate,
        quantity: String(row.quantity ?? "0"),
        unitPrice: String(row.unitPrice ?? "0"),
        subtotal: String(row.subtotal ?? "0"),
      });
    }

    return rows.map(r => ({
      ...r.supply,
      rubro: r.rubro || null,
      subRubro: r.subRubro || null,
      unitOfMeasure: r.unitOfMeasure || null,
      lastPurchaseValue: latestPurchaseBySupplyId.get(r.supply.id)?.subtotal ?? null,
      lastPurchaseQuantity: latestPurchaseBySupplyId.get(r.supply.id)?.quantity ?? null,
      lastPurchaseUnitCost: latestPurchaseBySupplyId.get(r.supply.id)?.unitPrice ?? null,
      lastPurchaseDate: latestPurchaseBySupplyId.get(r.supply.id)?.invoiceDate ?? null,
      // Punto 4 (ago-26): permite saltar desde el insumo a la factura de su ultima compra.
      lastPurchaseInvoiceId: latestPurchaseBySupplyId.get(r.supply.id)?.invoiceId ?? null,
      lastPurchaseInvoiceNumber: latestPurchaseBySupplyId.get(r.supply.id)?.invoiceNumber ?? null,
    }));
  }

  async getSupplyUsageDetail(
    clientId: number,
    supplyId: number,
  ): Promise<{
    supplyName: string;
    recipes: { id: number; name: string; recipeType: string | null; categoryName: string | null; subcategoryName: string | null }[];
    suppliers: { id: number; name: string }[];
  } | null> {
    const [supply] = await db
      .select()
      .from(supplies)
      .where(and(eq(supplies.id, supplyId), eq(supplies.clientId, clientId)));
    if (!supply) return null;

    const recipeRows = await db
      .select({
        id: recipes.id,
        name: recipes.name,
        recipeType: recipes.recipeType,
        categoryName: recipeCategories.name,
        subcategoryName: recipeSubcategories.name,
      })
      .from(recipeIngredients)
      .innerJoin(recipes, eq(recipeIngredients.recipeId, recipes.id))
      .leftJoin(recipeCategories, eq(recipes.categoryId, recipeCategories.id))
      .leftJoin(recipeSubcategories, eq(recipes.subcategoryId, recipeSubcategories.id))
      .where(and(eq(recipes.clientId, clientId), eq(recipeIngredients.supplyId, supplyId)))
      .orderBy(asc(recipes.recipeType), asc(recipes.name));

    const byRecipe = new Map<
      number,
      { id: number; name: string; recipeType: string | null; categoryName: string | null; subcategoryName: string | null }
    >();
    for (const r of recipeRows) {
      if (!byRecipe.has(r.id)) {
        byRecipe.set(r.id, {
          id: r.id,
          name: r.name,
          recipeType: r.recipeType,
          categoryName: r.categoryName,
          subcategoryName: r.subcategoryName,
        });
      }
    }

    const supplierRows = await db
      .select({
        id: suppliers.id,
        name: suppliers.businessName,
      })
      .from(supplySuppliers)
      .innerJoin(suppliers, eq(supplySuppliers.supplierId, suppliers.id))
      .where(and(eq(supplySuppliers.clientId, clientId), eq(supplySuppliers.supplyId, supplyId)))
      .orderBy(asc(suppliers.businessName));

    return {
      supplyName: supply.name,
      recipes: [...byRecipe.values()],
      suppliers: supplierRows.map((s) => ({ id: s.id, name: s.name })),
    };
  }

  async getSubRecipeParentUsageDetail(
    clientId: number,
    subRecipeId: number,
  ): Promise<{
    subRecipeName: string;
    parents: { id: number; name: string; recipeType: string | null; categoryName: string | null; subcategoryName: string | null }[];
  } | null> {
    const [sub] = await db
      .select()
      .from(recipes)
      .where(and(eq(recipes.id, subRecipeId), eq(recipes.clientId, clientId)));
    if (!sub || sub.recipeType !== "sub") return null;

    const parentRows = await db
      .select({
        id: recipes.id,
        name: recipes.name,
        recipeType: recipes.recipeType,
        categoryName: recipeCategories.name,
        subcategoryName: recipeSubcategories.name,
      })
      .from(recipeIngredients)
      .innerJoin(recipes, eq(recipeIngredients.recipeId, recipes.id))
      .leftJoin(recipeCategories, eq(recipes.categoryId, recipeCategories.id))
      .leftJoin(recipeSubcategories, eq(recipes.subcategoryId, recipeSubcategories.id))
      .where(and(eq(recipes.clientId, clientId), eq(recipeIngredients.subRecipeId, subRecipeId)))
      .orderBy(asc(recipes.recipeType), asc(recipes.name));

    const byRecipe = new Map<
      number,
      { id: number; name: string; recipeType: string | null; categoryName: string | null; subcategoryName: string | null }
    >();
    for (const r of parentRows) {
      if (!byRecipe.has(r.id)) {
        byRecipe.set(r.id, {
          id: r.id,
          name: r.name,
          recipeType: r.recipeType,
          categoryName: r.categoryName,
          subcategoryName: r.subcategoryName,
        });
      }
    }

    return {
      subRecipeName: sub.name,
      parents: [...byRecipe.values()],
    };
  }

  async createSupply(supply: InsertSupply): Promise<Supply> {
    const [newSupply] = await db.insert(supplies).values(supply).returning();
    return newSupply;
  }

  async updateSupply(clientId: number, id: number, supply: Partial<InsertSupply>): Promise<Supply | undefined> {
    const [updated] = await db.update(supplies)
      .set({ ...supply, updatedAt: new Date() })
      .where(and(eq(supplies.id, id), eq(supplies.clientId, clientId)))
      .returning();
    return updated;
  }

  async deleteSupply(clientId: number, id: number): Promise<boolean> {
    const result = await db.delete(supplies).where(and(eq(supplies.id, id), eq(supplies.clientId, clientId)));
    return (result.rowCount ?? 0) > 0;
  }

  async getInvoices(clientId: number): Promise<any[]> {
    const rows = await db
      .select({
        invoice: invoices,
        supplier: suppliers,
        local: locals,
      })
      .from(invoices)
      .leftJoin(suppliers, eq(invoices.supplierId, suppliers.id))
      .leftJoin(locals, eq(invoices.localId, locals.id))
      .where(eq(invoices.clientId, clientId))
      .orderBy(desc(invoices.invoiceDate));
    return rows.map(r => ({
      ...r.invoice,
      supplier: r.supplier || null,
      local: r.local || null,
    }));
  }

  async getInvoice(clientId: number, id: number): Promise<any | undefined> {
    const rows = await db
      .select({
        invoice: invoices,
        supplier: suppliers,
        local: locals,
      })
      .from(invoices)
      .leftJoin(suppliers, eq(invoices.supplierId, suppliers.id))
      .leftJoin(locals, eq(invoices.localId, locals.id))
      .where(and(eq(invoices.id, id), eq(invoices.clientId, clientId)));
    if (rows.length === 0) return undefined;
    return {
      ...rows[0].invoice,
      supplier: rows[0].supplier || null,
      local: rows[0].local || null,
    };
  }

  async getInvoiceByVoucherComposite(
    clientId: number,
    supplierId: number,
    invoiceSalePoint: string,
    invoiceNumber: string,
  ): Promise<Invoice | undefined> {
    const [invoice] = await db.select().from(invoices).where(
      and(
        eq(invoices.clientId, clientId),
        eq(invoices.supplierId, supplierId),
        eq(invoices.invoiceSalePoint, invoiceSalePoint),
        eq(invoices.invoiceNumber, invoiceNumber),
      ),
    );
    return invoice;
  }

  async getInvoiceItems(invoiceId: number): Promise<InvoiceItem[]> {
    return db.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, invoiceId));
  }

  async getInvoiceTaxes(invoiceId: number): Promise<InvoiceTax[]> {
    return db.select().from(invoiceTaxes).where(eq(invoiceTaxes.invoiceId, invoiceId));
  }

  async createInvoice(invoice: InsertInvoice, items: InsertInvoiceItem[], taxItems: InsertInvoiceTax[]): Promise<Invoice> {
    const [newInvoice] = await db.insert(invoices).values(invoice).returning();
    // NC (Nota de Crédito) does not generate stock entries or update CPP.
    const isNC = String(invoice.invoiceType ?? "").startsWith("NC-");

    const aggregatedItems = new Map<number, { totalQty: number; totalCost: number; lastUnitPrice: number; items: InsertInvoiceItem[] }>();

    for (const item of items) {
      await db.insert(invoiceItems).values({ ...item, invoiceId: newInvoice.id });

      if (item.supplyId && !isNC) {
        const qty = parseFloat(String(item.quantity)) || 0;
        const price = parseFloat(String(item.unitPrice)) || 0;
        
        const existing = aggregatedItems.get(item.supplyId);
        if (existing) {
          existing.totalQty += qty;
          existing.totalCost += qty * price;
          existing.lastUnitPrice = price;
          existing.items.push(item);
        } else {
          aggregatedItems.set(item.supplyId, {
            totalQty: qty,
            totalCost: qty * price,
            lastUnitPrice: price,
            items: [item],
          });
        }
      }
    }
    
    for (const [supplyId, aggregated] of aggregatedItems) {
      if (aggregated.totalQty <= 0) continue;
      
      const [currentSupply] = await db.select().from(supplies)
        .where(and(eq(supplies.id, supplyId), eq(supplies.clientId, invoice.clientId)));
      
      if (!currentSupply) continue;
      
      const currentCPP = parseFloat(String(currentSupply.unitCost)) || 0;
      const currentStock = parseFloat(String(currentSupply.lastQuantity)) || 0;
      
      const avgUnitCost = aggregated.totalCost / aggregated.totalQty;
      const newTotalStock = currentStock + aggregated.totalQty;
      
      let newCPP: number;
      if (newTotalStock > 0) {
        newCPP = (currentStock * currentCPP + aggregated.totalCost) / newTotalStock;
      } else {
        newCPP = avgUnitCost;
      }
      
      const updateData: Record<string, any> = {
        lastQuantity: String(newTotalStock),
        unitCost: String(newCPP.toFixed(4)),
        updatedAt: new Date(),
      };
      
      if (invoice.invoiceDate) {
        const parsedDate = new Date(invoice.invoiceDate);
        if (!isNaN(parsedDate.getTime())) {
          const existingPurchaseDate = currentSupply.lastPurchaseDate ? new Date(currentSupply.lastPurchaseDate) : null;
          if (!existingPurchaseDate || parsedDate >= existingPurchaseDate) {
            updateData.lastCost = String(aggregated.lastUnitPrice);
            updateData.lastPurchaseDate = parsedDate;
          }
        }
      } else {
        updateData.lastCost = String(aggregated.lastUnitPrice);
      }
      
      await db.update(supplies).set(updateData).where(and(eq(supplies.id, supplyId), eq(supplies.clientId, invoice.clientId)));
      
      await db.insert(costHistory).values({
        supplyId: supplyId,
        invoiceId: newInvoice.id,
        unitCost: String(avgUnitCost),
        quantity: String(aggregated.totalQty),
        totalCost: String(aggregated.totalCost),
      });

      await db.insert(stockMovements).values({
        clientId: invoice.clientId,
        localId: invoice.localId,
        supplyId: supplyId,
        movementType: "entrada",
        quantity: String(aggregated.totalQty),
        unitCost: String(avgUnitCost),
        referenceType: "factura",
        referenceId: newInvoice.id,
        notes: `Compra - Factura ${formatInvoiceVoucherDisplay(invoice)}`,
        createdBy: invoice.createdBy,
      });
    }
    
    for (const tax of taxItems) {
      await db.insert(invoiceTaxes).values({ ...tax, invoiceId: newInvoice.id });
    }

    // Keep recipe totals in sync with updated supply costs (solo recetas que usan esos insumos o sub-recetas padre).
    const affectedSupplyIds = [...aggregatedItems.keys()];
    await db.transaction(async (tx) => {
      await this.recalculateAllRecipeCostsForClient(invoice.clientId, tx, affectedSupplyIds);
    });
    
    return newInvoice;
  }

  async updateInvoice(clientId: number, id: number, invoice: Partial<InsertInvoice>): Promise<Invoice | undefined> {
    const [updated] = await db.update(invoices)
      .set({ ...invoice, updatedAt: new Date() })
      .where(and(eq(invoices.id, id), eq(invoices.clientId, clientId)))
      .returning();
    return updated;
  }

  async deleteInvoice(clientId: number, id: number): Promise<boolean> {
    const existing = await this.getInvoice(clientId, id);
    if (!existing) return false;

    await db.delete(invoiceTaxes).where(eq(invoiceTaxes.invoiceId, id));
    await db.delete(invoiceItems).where(eq(invoiceItems.invoiceId, id));
    await db.delete(costHistory).where(eq(costHistory.invoiceId, id));
    const result = await db.delete(invoices).where(and(eq(invoices.id, id), eq(invoices.clientId, clientId)));
    return (result.rowCount ?? 0) > 0;
  }

  /** Libera (desasigna) los pagos aplicados a una factura. Los pagos en sí no se borran. */
  async releaseInvoiceAllocations(invoiceId: number): Promise<number> {
    const allocs = await db.select().from(paymentAllocations).where(eq(paymentAllocations.invoiceId, invoiceId));
    if (allocs.length === 0) return 0;
    await db.delete(paymentAllocations).where(eq(paymentAllocations.invoiceId, invoiceId));
    return allocs.length;
  }

  /** Registro de auditoría (red de seguridad ante correcciones/borrados de datos financieros). */
  async createAuditLog(entry: {
    clientId?: number | null;
    userId?: string | null;
    action: string;
    tableName: string;
    recordId?: number | null;
    oldData?: unknown;
    newData?: unknown;
  }): Promise<void> {
    await db.insert(auditLog).values({
      clientId: entry.clientId ?? null,
      userId: entry.userId ?? null,
      action: entry.action,
      tableName: entry.tableName,
      recordId: entry.recordId ?? null,
      oldData: entry.oldData ?? null,
      newData: entry.newData ?? null,
    } as any);
  }

  async reverseInvoice(clientId: number, invoiceId: number, userId: string, reason: string): Promise<Invoice | undefined> {
    const invoice = await this.getInvoice(clientId, invoiceId);
    if (!invoice || invoice.status === "reversed") return undefined;

    const items = await this.getInvoiceItems(invoiceId);
    
    const aggregatedItems = new Map<number, { totalQty: number; totalCost: number }>();
    for (const item of items) {
      if (item.supplyId) {
        const qty = parseFloat(String(item.quantity)) || 0;
        const price = parseFloat(String(item.unitPrice)) || 0;
        const existing = aggregatedItems.get(item.supplyId);
        if (existing) {
          existing.totalQty += qty;
          existing.totalCost += qty * price;
        } else {
          aggregatedItems.set(item.supplyId, { totalQty: qty, totalCost: qty * price });
        }
      }
    }
    
    const insufficientStock: string[] = [];
    for (const [supplyId, aggregated] of aggregatedItems) {
      if (aggregated.totalQty <= 0) continue;
      
      const [currentSupply] = await db.select().from(supplies)
        .where(and(eq(supplies.id, supplyId), eq(supplies.clientId, clientId)));
      if (!currentSupply) continue;
      
      const currentStock = parseFloat(String(currentSupply.lastQuantity)) || 0;
      if (currentStock < aggregated.totalQty) {
        insufficientStock.push(`${currentSupply.name} (Stock: ${currentStock}, Revertir: ${aggregated.totalQty})`);
      }
    }
    
    if (insufficientStock.length > 0) {
      throw new Error(`Stock insuficiente para revertir: ${insufficientStock.join(", ")}`);
    }
    
    for (const [supplyId, aggregated] of aggregatedItems) {
      if (aggregated.totalQty <= 0) continue;
      
      const [currentSupply] = await db.select().from(supplies)
        .where(and(eq(supplies.id, supplyId), eq(supplies.clientId, clientId)));
      if (!currentSupply) continue;
      
      const currentCPP = parseFloat(String(currentSupply.unitCost)) || 0;
      const currentStock = parseFloat(String(currentSupply.lastQuantity)) || 0;
      const newStock = currentStock - aggregated.totalQty;
      const avgUnitCost = aggregated.totalCost / aggregated.totalQty;
      
      let newCPP = currentCPP;
      if (newStock > 0) {
        const totalValue = currentStock * currentCPP;
        const remainingValue = totalValue - aggregated.totalCost;
        newCPP = remainingValue > 0 ? remainingValue / newStock : 0;
      } else {
        newCPP = 0;
      }
      
      await db.update(supplies).set({
        lastQuantity: String(newStock),
        unitCost: String(newCPP.toFixed(4)),
        updatedAt: new Date(),
      }).where(and(eq(supplies.id, supplyId), eq(supplies.clientId, clientId)));
      
      await db.insert(stockMovements).values({
        clientId: invoice.clientId,
        localId: invoice.localId,
        supplyId: supplyId,
        movementType: "salida",
        quantity: String(aggregated.totalQty),
        unitCost: String(avgUnitCost),
        referenceType: "reversion_factura",
        referenceId: invoiceId,
        notes: `Reversion - Factura ${formatInvoiceVoucherDisplay(invoice)}: ${reason}`,
        createdBy: userId,
      });
    }
    
    const [updated] = await db.update(invoices)
      .set({
        status: "reversed",
        reversedAt: new Date(),
        reversedBy: userId,
        reversalReason: reason,
        updatedAt: new Date(),
      })
      .where(and(eq(invoices.id, invoiceId), eq(invoices.clientId, clientId)))
      .returning();
    
    // Recetas impactadas por la reversión de costos de stock (mismo alcance acotado que al crear factura).
    const affectedSupplyIds = [...aggregatedItems.keys()];
    await db.transaction(async (tx) => {
      await this.recalculateAllRecipeCostsForClient(clientId, tx, affectedSupplyIds);
    });

    return updated;
  }

  async getPayments(clientId: number): Promise<any[]> {
    const rows = await db
      .select({
        payment: payments,
        supplier: suppliers,
        local: locals,
      })
      .from(payments)
      .leftJoin(suppliers, eq(payments.supplierId, suppliers.id))
      .leftJoin(locals, eq(payments.localId, locals.id))
      .where(eq(payments.clientId, clientId))
      .orderBy(desc(payments.paymentDate));
    return rows.map(r => ({
      ...r.payment,
      supplier: r.supplier || null,
      local: r.local || null,
    }));
  }

  async createPayment(payment: InsertPayment): Promise<Payment> {
    const [newPayment] = await db.insert(payments).values(payment).returning();
    return newPayment;
  }

  async createPaymentWithAllocations(payment: InsertPayment, allocations: { invoiceId: number; amount: number }[]): Promise<Payment> {
    const [newPayment] = await db.insert(payments).values(payment).returning();
    
    for (const alloc of allocations) {
      await db.insert(paymentAllocations).values({
        paymentId: newPayment.id,
        invoiceId: alloc.invoiceId,
        amount: String(alloc.amount),
      });
      
      const [invoice] = await db.select().from(invoices).where(eq(invoices.id, alloc.invoiceId));
      if (invoice) {
        const currentBalance = parseFloat(String(invoice.balance) || "0");
        const newBalance = Math.max(0, currentBalance - alloc.amount);
        const isPaid = newBalance <= 0;
        await db.update(invoices)
          .set({ balance: String(newBalance), paid: isPaid })
          .where(eq(invoices.id, alloc.invoiceId));
      }
    }
    
    return newPayment;
  }

  // Edición acotada de un pago: SOLO datos neutros (no toca monto, proveedor/local ni
  // las facturas imputadas), por lo que no recalcula saldos de facturas.
  async updatePayment(
    clientId: number,
    id: number,
    data: { paymentNumber?: string | null; paymentDate?: string; bankAccountId?: number | null; paymentMethod?: string; notes?: string | null },
  ): Promise<Payment | undefined> {
    const set: Record<string, unknown> = {};
    if (data.paymentNumber !== undefined) set.paymentNumber = data.paymentNumber;
    if (data.paymentDate !== undefined) set.paymentDate = data.paymentDate;
    if (data.bankAccountId !== undefined) set.bankAccountId = data.bankAccountId;
    if (data.paymentMethod !== undefined) set.paymentMethod = data.paymentMethod;
    if (data.notes !== undefined) set.notes = data.notes;
    if (Object.keys(set).length === 0) {
      const [current] = await db.select().from(payments)
        .where(and(eq(payments.id, id), eq(payments.clientId, clientId)));
      return current;
    }
    const [updated] = await db
      .update(payments)
      .set(set as any)
      .where(and(eq(payments.id, id), eq(payments.clientId, clientId)))
      .returning();
    return updated;
  }

  async deletePayment(clientId: number, id: number): Promise<boolean> {
    const [existing] = await db.select().from(payments)
      .where(and(eq(payments.id, id), eq(payments.clientId, clientId)));
    if (!existing) return false;
    
    const allocations = await db.select().from(paymentAllocations)
      .where(eq(paymentAllocations.paymentId, id));
    
    for (const alloc of allocations) {
      const [invoice] = await db.select().from(invoices).where(eq(invoices.id, alloc.invoiceId));
      if (invoice) {
        const currentBalance = parseFloat(String(invoice.balance) || "0");
        const restoredBalance = currentBalance + parseFloat(String(alloc.amount));
        await db.update(invoices)
          .set({ balance: String(restoredBalance), paid: false })
          .where(eq(invoices.id, alloc.invoiceId));
      }
    }
    
    await db.delete(paymentAllocations).where(eq(paymentAllocations.paymentId, id));
    const result = await db.delete(payments).where(and(eq(payments.id, id), eq(payments.clientId, clientId)));
    return (result.rowCount ?? 0) > 0;
  }

  async getRecipeCategories(clientId: number): Promise<RecipeCategory[]> {
    return db.select().from(recipeCategories).where(eq(recipeCategories.clientId, clientId)).orderBy(recipeCategories.name);
  }

  async createRecipeCategory(category: InsertRecipeCategory): Promise<RecipeCategory> {
    const [newCategory] = await db.insert(recipeCategories).values(category).returning();
    return newCategory;
  }

  async updateRecipeCategory(clientId: number, id: number, category: Partial<InsertRecipeCategory>): Promise<RecipeCategory | undefined> {
    const [updated] = await db.update(recipeCategories)
      .set(category)
      .where(and(eq(recipeCategories.id, id), eq(recipeCategories.clientId, clientId)))
      .returning();
    return updated;
  }

  async deleteRecipeCategory(clientId: number, id: number): Promise<boolean> {
    const result = await db.delete(recipeCategories)
      .where(and(eq(recipeCategories.id, id), eq(recipeCategories.clientId, clientId)));
    return (result.rowCount ?? 0) > 0;
  }

  async getRecipeSubcategories(
    clientId: number,
  ): Promise<(RecipeSubcategory & { recipeCategory?: RecipeCategory | null })[]> {
    const results = await db
      .select({
        sub: recipeSubcategories,
        recipeCategory: recipeCategories,
      })
      .from(recipeSubcategories)
      .leftJoin(recipeCategories, eq(recipeSubcategories.recipeCategoryId, recipeCategories.id))
      .where(eq(recipeSubcategories.clientId, clientId))
      .orderBy(recipeSubcategories.name);

    return results.map((r) => ({
      ...r.sub,
      recipeCategory: r.recipeCategory,
    }));
  }

  async createRecipeSubcategory(sub: InsertRecipeSubcategory): Promise<RecipeSubcategory> {
    const [cat] = await db
      .select()
      .from(recipeCategories)
      .where(
        and(eq(recipeCategories.id, sub.recipeCategoryId), eq(recipeCategories.clientId, sub.clientId)),
      )
      .limit(1);
    if (!cat) {
      throw new Error("La categoria de receta no existe o no pertenece a este cliente");
    }
    const [row] = await db.insert(recipeSubcategories).values(sub).returning();
    return row;
  }

  async updateRecipeSubcategory(
    clientId: number,
    id: number,
    sub: Partial<InsertRecipeSubcategory>,
  ): Promise<RecipeSubcategory | undefined> {
    if (sub.recipeCategoryId != null) {
      const [cat] = await db
        .select()
        .from(recipeCategories)
        .where(
          and(eq(recipeCategories.id, sub.recipeCategoryId), eq(recipeCategories.clientId, clientId)),
        )
        .limit(1);
      if (!cat) {
        throw new Error("La categoria de receta no existe o no pertenece a este cliente");
      }
    }
    const [updated] = await db
      .update(recipeSubcategories)
      .set(sub)
      .where(and(eq(recipeSubcategories.id, id), eq(recipeSubcategories.clientId, clientId)))
      .returning();
    return updated;
  }

  async deleteRecipeSubcategory(clientId: number, id: number): Promise<boolean> {
    const used = await db
      .select({ id: recipes.id })
      .from(recipes)
      .where(and(eq(recipes.clientId, clientId), eq(recipes.subcategoryId, id)))
      .limit(1);
    if (used.length > 0) return false;
    const result = await db
      .delete(recipeSubcategories)
      .where(and(eq(recipeSubcategories.id, id), eq(recipeSubcategories.clientId, clientId)));
    return (result.rowCount ?? 0) > 0;
  }

  async getRecipes(clientId: number): Promise<Recipe[]> {
    return db.select().from(recipes).where(eq(recipes.clientId, clientId)).orderBy(recipes.name);
  }

  async getRecipe(clientId: number, id: number): Promise<Recipe | undefined> {
    const [recipe] = await db.select().from(recipes)
      .where(and(eq(recipes.id, id), eq(recipes.clientId, clientId)));
    return recipe;
  }

  async getRecipeIngredients(recipeId: number): Promise<RecipeIngredient[]> {
    return db.select().from(recipeIngredients).where(eq(recipeIngredients.recipeId, recipeId));
  }

  async createRecipe(recipe: InsertRecipe, ingredients: InsertRecipeIngredient[]): Promise<Recipe> {
    const [newRecipe] = await db.insert(recipes).values(recipe).returning();
    
    for (const ingredient of ingredients) {
      await db.insert(recipeIngredients).values({ ...ingredient, recipeId: newRecipe.id });
    }
    
    return newRecipe;
  }

  async updateRecipe(clientId: number, id: number, recipe: Partial<InsertRecipe>, ingredients?: InsertRecipeIngredient[]): Promise<Recipe | undefined> {
    const existing = await this.getRecipe(clientId, id);
    if (!existing) return undefined;

    const [updated] = await db.update(recipes)
      .set({ ...recipe, updatedAt: new Date() })
      .where(and(eq(recipes.id, id), eq(recipes.clientId, clientId)))
      .returning();
    
    if (ingredients) {
      await db.delete(recipeIngredients).where(eq(recipeIngredients.recipeId, id));
      for (const ingredient of ingredients) {
        await db.insert(recipeIngredients).values({ ...ingredient, recipeId: id });
      }
    }
    
    return updated;
  }

  /**
   * Aplica la misma política de IVA a todos los platos del cliente y reescribe las métricas
   * derivadas (ago-2026). Es idempotente: el precio cobrado no se toca, solo cambia contra qué se
   * miden CMV, margen y markup. Las sub-recetas no tienen precio de venta, así que quedan afuera.
   */
  async setRecipesIvaPolicy(clientId: number, removeIva: boolean): Promise<number> {
    const toFinite = (value: number, fallback = 0) => (Number.isFinite(value) ? value : fallback);
    const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
    const rows = await db
      .select()
      .from(recipes)
      .where(and(eq(recipes.clientId, clientId), eq(recipes.recipeType, "plato")));

    let updated = 0;
    for (const recipe of rows) {
      const metrics = computeRecipeMetrics({
        grossPrice: recipeGrossPrice(recipe),
        totalCost: parseFloat(String(recipe.totalCost ?? 0)) || 0,
        removeIva,
      });
      await db
        .update(recipes)
        .set({
          removeIvaFromPrice: removeIva,
          salePrice: metrics.salePrice.toFixed(2),
          salePriceWithTax: metrics.salePriceWithTax.toFixed(2),
          cmvPercentage: clamp(toFinite(metrics.cmvPercentage), -999.99, 999.99).toFixed(2),
          margin: clamp(toFinite(metrics.margin), -9999999999.99, 9999999999.99).toFixed(2),
          marginPercentage: clamp(toFinite(metrics.marginPercentage), -999.99, 999.99).toFixed(2),
          markup: clamp(toFinite(metrics.markup), -999.99, 999.99).toFixed(2),
          updatedAt: new Date(),
        } as any)
        .where(and(eq(recipes.id, recipe.id), eq(recipes.clientId, clientId)));
      updated += 1;
    }
    return updated;
  }

  async deleteRecipe(clientId: number, id: number): Promise<boolean> {
    const existing = await this.getRecipe(clientId, id);
    if (!existing) return false;
    
    await db.delete(recipeIngredients).where(eq(recipeIngredients.recipeId, id));
    const result = await db.delete(recipes).where(and(eq(recipes.id, id), eq(recipes.clientId, clientId)));
    return (result.rowCount ?? 0) > 0;
  }

  async getCostHistory(clientId: number): Promise<CostHistory[]> {
    return db
      .select()
      .from(costHistory)
      .innerJoin(supplies, eq(costHistory.supplyId, supplies.id))
      .where(eq(supplies.clientId, clientId))
      .orderBy(desc(costHistory.recordedAt))
      .then(rows => rows.map(r => r.cost_history));
  }

  async getCategoryGroups(clientId: number): Promise<CategoryGroup[]> {
    return db.select().from(categoryGroups).where(eq(categoryGroups.clientId, clientId)).orderBy(categoryGroups.order);
  }

  async createCategoryGroup(group: InsertCategoryGroup): Promise<CategoryGroup> {
    const [newGroup] = await db.insert(categoryGroups).values(group).returning();
    return newGroup;
  }

  async getFinancialGroups(clientId: number): Promise<FinancialGroup[]> {
    return db.select().from(financialGroups)
      .where(eq(financialGroups.clientId, clientId))
      .orderBy(financialGroups.displayOrder, financialGroups.name);
  }

  async getFinancialGroup(clientId: number, id: number): Promise<FinancialGroup | undefined> {
    const [group] = await db.select().from(financialGroups)
      .where(and(eq(financialGroups.id, id), eq(financialGroups.clientId, clientId)));
    return group;
  }

  async createFinancialGroup(group: InsertFinancialGroup): Promise<FinancialGroup> {
    const [newGroup] = await db.insert(financialGroups).values(group).returning();
    return newGroup;
  }

  async updateFinancialGroup(clientId: number, id: number, group: Partial<InsertFinancialGroup>): Promise<FinancialGroup | undefined> {
    // Se permite editar nombre, orden, activo Y tipo (el cambio de tipo se confirma en el frontend,
    // punto 1). Lo único que nunca se toca es `isSystem` (marca interna que protege el borrado y el seed).
    const [existing] = await db.select().from(financialGroups)
      .where(and(eq(financialGroups.id, id), eq(financialGroups.clientId, clientId)));
    if (!existing) return undefined;

    const patch: Partial<InsertFinancialGroup> = { ...group };
    delete (patch as any).isSystem;
    delete (patch as any).clientId;

    const [updated] = await db.update(financialGroups)
      .set(patch)
      .where(and(eq(financialGroups.id, id), eq(financialGroups.clientId, clientId)))
      .returning();
    return updated;
  }

  async deleteFinancialGroup(clientId: number, id: number): Promise<boolean> {
    const result = await db.delete(financialGroups)
      .where(and(eq(financialGroups.id, id), eq(financialGroups.clientId, clientId)));
    return (result.rowCount ?? 0) > 0;
  }

  async getClientBanks(clientId: number): Promise<ClientBank[]> {
    return db.select().from(clientBanks)
      .where(eq(clientBanks.clientId, clientId))
      .orderBy(clientBanks.displayOrder);
  }

  async getClientBankByBankId(clientId: number, bankId: string): Promise<ClientBank | undefined> {
    const [row] = await db.select().from(clientBanks)
      .where(and(eq(clientBanks.clientId, clientId), eq(clientBanks.bankId, bankId)));
    return row;
  }

  async getBusinessNames(clientId: number): Promise<BusinessName[]> {
    return db
      .select()
      .from(businessNames)
      .where(eq(businessNames.clientId, clientId))
      .orderBy(asc(businessNames.name));
  }

  async createBusinessName(row: InsertBusinessName): Promise<BusinessName> {
    const [created] = await db.insert(businessNames).values(row).returning();
    return created;
  }

  async updateBusinessName(
    clientId: number,
    id: number,
    row: Partial<InsertBusinessName>,
  ): Promise<BusinessName | undefined> {
    const [updated] = await db
      .update(businessNames)
      .set(row)
      .where(and(eq(businessNames.clientId, clientId), eq(businessNames.id, id)))
      .returning();
    return updated;
  }

  async deleteBusinessName(clientId: number, id: number): Promise<boolean> {
    const result = await db
      .delete(businessNames)
      .where(and(eq(businessNames.clientId, clientId), eq(businessNames.id, id)));
    return (result.rowCount ?? 0) > 0;
  }

  async getCounterparties(clientId: number): Promise<Counterparty[]> {
    return db
      .select()
      .from(counterparties)
      .where(eq(counterparties.clientId, clientId))
      .orderBy(asc(counterparties.displayName));
  }

  async createCounterparty(row: InsertCounterparty): Promise<Counterparty> {
    const [created] = await db.insert(counterparties).values(row).returning();
    return created;
  }

  async updateCounterparty(
    clientId: number,
    id: number,
    row: Partial<InsertCounterparty>,
  ): Promise<Counterparty | undefined> {
    const [updated] = await db
      .update(counterparties)
      .set(row)
      .where(and(eq(counterparties.clientId, clientId), eq(counterparties.id, id)))
      .returning();
    return updated;
  }

  async deleteCounterparty(clientId: number, id: number): Promise<boolean> {
    const result = await db
      .delete(counterparties)
      .where(and(eq(counterparties.clientId, clientId), eq(counterparties.id, id)));
    return (result.rowCount ?? 0) > 0;
  }

  async getCounterpartyIdentifiers(clientId: number, counterpartyId: number): Promise<CounterpartyIdentifier[]> {
    return db
      .select()
      .from(counterpartyIdentifiers)
      .where(and(eq(counterpartyIdentifiers.clientId, clientId), eq(counterpartyIdentifiers.counterpartyId, counterpartyId)))
      .orderBy(asc(counterpartyIdentifiers.type), asc(counterpartyIdentifiers.value));
  }

  async createCounterpartyIdentifier(row: InsertCounterpartyIdentifier): Promise<CounterpartyIdentifier> {
    const [created] = await db.insert(counterpartyIdentifiers).values(row).returning();
    return created;
  }

  async deleteCounterpartyIdentifier(clientId: number, id: number): Promise<boolean> {
    const result = await db
      .delete(counterpartyIdentifiers)
      .where(and(eq(counterpartyIdentifiers.clientId, clientId), eq(counterpartyIdentifiers.id, id)));
    return (result.rowCount ?? 0) > 0;
  }

  async createClientBank(bank: InsertClientBank): Promise<ClientBank> {
    const [newBank] = await db.insert(clientBanks).values(bank).returning();
    return newBank;
  }

  async updateClientBank(clientId: number, id: number, bank: Partial<InsertClientBank>): Promise<ClientBank | undefined> {
    const [updated] = await db.update(clientBanks)
      .set(bank)
      .where(and(eq(clientBanks.id, id), eq(clientBanks.clientId, clientId)))
      .returning();
    return updated;
  }

  async deleteClientBank(clientId: number, id: number): Promise<boolean> {
    const result = await db.delete(clientBanks)
      .where(and(eq(clientBanks.id, id), eq(clientBanks.clientId, clientId)));
    return (result.rowCount ?? 0) > 0;
  }

  async getTransactionCategories(clientId: number): Promise<TransactionCategory[]> {
    return db.select().from(transactionCategories).where(eq(transactionCategories.clientId, clientId)).orderBy(transactionCategories.name);
  }

  async createTransactionCategory(category: InsertTransactionCategory): Promise<TransactionCategory> {
    const [newCategory] = await db.insert(transactionCategories).values(category).returning();
    return newCategory;
  }

  async updateTransactionCategory(clientId: number, id: number, category: Partial<InsertTransactionCategory>): Promise<TransactionCategory | undefined> {
    // Punto 1: las categorías de sistema se pueden RENOMBRAR, activar/desactivar y MOVER de grupo
    // (financialGroupId). Se mantienen bloqueados type / isSpecial / specialType / isSystem, que
    // preservan la lógica del balance y de "Otros Movimientos".
    const [existing] = await db.select().from(transactionCategories)
      .where(and(eq(transactionCategories.id, id), eq(transactionCategories.clientId, clientId)));
    if (!existing) return undefined;

    let patch: Partial<InsertTransactionCategory> = category;
    if (existing.isSystem) {
      patch = {};
      if (category.name !== undefined) patch.name = category.name;
      if (category.active !== undefined) patch.active = category.active;
      if (category.financialGroupId !== undefined) patch.financialGroupId = category.financialGroupId;
    }

    const [updated] = await db.update(transactionCategories)
      .set(patch)
      .where(and(eq(transactionCategories.id, id), eq(transactionCategories.clientId, clientId)))
      .returning();
    return updated;
  }

  async deleteTransactionCategory(clientId: number, id: number): Promise<boolean> {
    const result = await db.delete(transactionCategories)
      .where(and(eq(transactionCategories.id, id), eq(transactionCategories.clientId, clientId)));
    return (result.rowCount ?? 0) > 0;
  }

  async getBankAccounts(clientId: number): Promise<BankAccount[]> {
    return db.select().from(bankAccounts).where(eq(bankAccounts.clientId, clientId)).orderBy(bankAccounts.name);
  }

  async getBankAccount(clientId: number, id: number): Promise<BankAccount | undefined> {
    const [row] = await db
      .select()
      .from(bankAccounts)
      .where(and(eq(bankAccounts.clientId, clientId), eq(bankAccounts.id, id)))
      .limit(1);
    return row;
  }

  async createBankAccount(account: InsertBankAccount): Promise<BankAccount> {
    const [newAccount] = await db.insert(bankAccounts).values(account).returning();
    return newAccount;
  }

  async updateBankAccount(clientId: number, id: number, account: Partial<InsertBankAccount>): Promise<BankAccount | undefined> {
    const [updated] = await db.update(bankAccounts)
      .set(account)
      .where(and(eq(bankAccounts.id, id), eq(bankAccounts.clientId, clientId)))
      .returning();
    return updated;
  }

  async deleteBankAccount(clientId: number, id: number): Promise<boolean> {
    const [txRef] = await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(and(eq(transactions.clientId, clientId), eq(transactions.bankAccountId, id)))
      .limit(1);
    if (txRef) return false;
    const [batchRef] = await db
      .select({ id: financialImportBatches.id })
      .from(financialImportBatches)
      .where(and(eq(financialImportBatches.clientId, clientId), eq(financialImportBatches.bankAccountId, id)))
      .limit(1);
    if (batchRef) return false;
    const deleted = await db
      .delete(bankAccounts)
      .where(and(eq(bankAccounts.id, id), eq(bankAccounts.clientId, clientId)))
      .returning({ id: bankAccounts.id });
    return deleted.length > 0;
  }

  async purgeBankAccountImportedData(
    clientId: number,
    bankAccountId: number,
  ): Promise<{ deletedTransactions: number; deletedBatches: number }> {
    const acc = await this.getBankAccount(clientId, bankAccountId);
    if (!acc) {
      throw new Error("Cuenta no encontrada");
    }

    const importedRowFilter = and(
      eq(transactions.clientId, clientId),
      eq(transactions.bankAccountId, bankAccountId),
      or(eq(transactions.source, "import"), isNotNull(transactions.importBatchId)),
    );

    const CHUNK = 400;
    let deletedTransactions = 0;

    // Borrado por lotes para no bloquear la conexión HTTP/proxy (evita 504 en cuentas con miles de filas).
    for (;;) {
      const batch = await db
        .select({ id: transactions.id })
        .from(transactions)
        .where(importedRowFilter)
        .limit(CHUNK);

      if (batch.length === 0) break;

      const ids = batch.map((r) => r.id);

      await db
        .delete(transactions)
        .where(and(eq(transactions.clientId, clientId), inArray(transactions.parentTransactionId, ids)));

      const del = await db
        .delete(transactions)
        .where(and(eq(transactions.clientId, clientId), inArray(transactions.id, ids)))
        .returning({ id: transactions.id });

      deletedTransactions += del.length;
    }

    const delBatches = await db
      .delete(financialImportBatches)
      .where(
        and(
          eq(financialImportBatches.clientId, clientId),
          eq(financialImportBatches.bankAccountId, bankAccountId),
        ),
      )
      .returning({ id: financialImportBatches.id });

    return {
      deletedTransactions,
      deletedBatches: delBatches.length,
    };
  }

  async createFinancialImportBatch(row: InsertFinancialImportBatch): Promise<FinancialImportBatch> {
    const [created] = await db.insert(financialImportBatches).values(row).returning();
    return created;
  }

  async createFinancialImportJob(row: InsertFinancialImportJob): Promise<FinancialImportJob> {
    const [created] = await db.insert(financialImportJobs).values(row).returning();
    return created;
  }

  async claimFinancialImportJobForProcessing(
    jobToken: string,
    triggerKey: string,
  ): Promise<FinancialImportJob | undefined> {
    const rows = await db
      .update(financialImportJobs)
      .set({ status: "processing", updatedAt: new Date() })
      .where(
        and(
          eq(financialImportJobs.jobToken, jobToken),
          eq(financialImportJobs.triggerKey, triggerKey),
          eq(financialImportJobs.status, "pending"),
        ),
      )
      .returning();
    return rows[0];
  }

  async getFinancialImportJobForClient(
    clientId: number,
    jobToken: string,
  ): Promise<FinancialImportJob | undefined> {
    const [row] = await db
      .select()
      .from(financialImportJobs)
      .where(and(eq(financialImportJobs.clientId, clientId), eq(financialImportJobs.jobToken, jobToken)))
      .limit(1);
    return row;
  }

  async updateFinancialImportJob(
    id: number,
    patch: Partial<Pick<FinancialImportJob, "status" | "resultJson" | "resultHttpStatus" | "errorMessage" | "updatedAt">>,
  ): Promise<void> {
    await db
      .update(financialImportJobs)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(financialImportJobs.id, id));
  }


  // ==========================================
  // FACTURA DIGITAL — job de lectura + memoria descripcion → insumo
  // ==========================================

  /** Listado minimo de insumos para matchear descripciones: sin joins ni ultima compra. */
  async listSuppliesForMatching(clientId: number): Promise<Array<{ id: number; name: string }>> {
    return db
      .select({ id: supplies.id, name: supplies.name })
      .from(supplies)
      .where(and(eq(supplies.clientId, clientId), eq(supplies.active, true)))
      .orderBy(supplies.name);
  }

  async createInvoiceExtractionJob(row: InsertInvoiceExtractionJob): Promise<InvoiceExtractionJob> {
    const [created] = await db.insert(invoiceExtractionJobs).values(row as any).returning();
    return created;
  }

  /** Toma el job solo si sigue en `pending`: hace idempotente un doble disparo de la background function. */
  async claimInvoiceExtractionJobForProcessing(
    jobToken: string,
    triggerKey: string,
  ): Promise<InvoiceExtractionJob | undefined> {
    const rows = await db
      .update(invoiceExtractionJobs)
      .set({ status: "processing", updatedAt: new Date() })
      .where(
        and(
          eq(invoiceExtractionJobs.jobToken, jobToken),
          eq(invoiceExtractionJobs.triggerKey, triggerKey),
          eq(invoiceExtractionJobs.status, "pending"),
        ),
      )
      .returning();
    return rows[0];
  }

  async getInvoiceExtractionJobForClient(
    clientId: number,
    jobToken: string,
  ): Promise<InvoiceExtractionJob | undefined> {
    const [row] = await db
      .select()
      .from(invoiceExtractionJobs)
      .where(and(eq(invoiceExtractionJobs.clientId, clientId), eq(invoiceExtractionJobs.jobToken, jobToken)))
      .limit(1);
    return row;
  }

  async updateInvoiceExtractionJob(
    id: number,
    patch: Partial<
      Pick<
        InvoiceExtractionJob,
        "status" | "resultJson" | "errorMessage" | "inputTokens" | "outputTokens" | "fileGzipBase64"
      >
    >,
  ): Promise<void> {
    await db
      .update(invoiceExtractionJobs)
      .set({ ...patch, updatedAt: new Date() } as any)
      .where(eq(invoiceExtractionJobs.id, id));
  }

  async listSupplierSupplyMappings(clientId: number, supplierId: number): Promise<SupplierSupplyMapping[]> {
    return db
      .select()
      .from(supplierSupplyMappings)
      .where(
        and(
          eq(supplierSupplyMappings.clientId, clientId),
          eq(supplierSupplyMappings.supplierId, supplierId),
        ),
      );
  }

  /**
   * Guarda que "esta descripcion de este proveedor es este insumo". Se llama al CONFIRMAR la
   * factura, nunca al leerla: solo vale como memoria lo que una persona dio por bueno.
   */
  async upsertSupplierSupplyMapping(input: {
    clientId: number;
    supplierId: number;
    normalizedDescription: string;
    rawDescription: string;
    supplyId: number;
    createdBy?: string | null;
  }): Promise<void> {
    if (!input.normalizedDescription) return;
    const [existing] = await db
      .select()
      .from(supplierSupplyMappings)
      .where(
        and(
          eq(supplierSupplyMappings.clientId, input.clientId),
          eq(supplierSupplyMappings.supplierId, input.supplierId),
          eq(supplierSupplyMappings.normalizedDescription, input.normalizedDescription),
        ),
      );

    if (existing) {
      await db
        .update(supplierSupplyMappings)
        .set({
          supplyId: input.supplyId,
          rawDescription: input.rawDescription.slice(0, 255),
          timesUsed: (existing.timesUsed ?? 0) + 1,
          updatedAt: new Date(),
        } as any)
        .where(eq(supplierSupplyMappings.id, existing.id));
      return;
    }

    await db.insert(supplierSupplyMappings).values({
      clientId: input.clientId,
      supplierId: input.supplierId,
      normalizedDescription: input.normalizedDescription,
      rawDescription: input.rawDescription.slice(0, 255),
      supplyId: input.supplyId,
      timesUsed: 1,
      createdBy: input.createdBy ?? null,
    } as any);
  }

  async getLastFinancialImportBatchForAccount(
    clientId: number,
    bankAccountId: number,
  ): Promise<FinancialImportBatch | undefined> {
    const [row] = await db
      .select()
      .from(financialImportBatches)
      .where(
        and(
          eq(financialImportBatches.clientId, clientId),
          eq(financialImportBatches.bankAccountId, bankAccountId),
        ),
      )
      .orderBy(desc(financialImportBatches.createdAt))
      .limit(1);
    return row;
  }

  async getTransactionCountForBankAccount(clientId: number, bankAccountId: number): Promise<number> {
    const [row] = await db
      .select({ c: sql<number>`count(*)` })
      .from(transactions)
      .where(
        and(eq(transactions.clientId, clientId), eq(transactions.bankAccountId, bankAccountId)),
      );
    return Number(row?.c ?? 0);
  }

  async getFinancialSavedViews(clientId: number, userId: string): Promise<FinancialSavedView[]> {
    return db
      .select()
      .from(financialSavedViews)
      .where(and(eq(financialSavedViews.clientId, clientId), eq(financialSavedViews.userId, userId)))
      .orderBy(desc(financialSavedViews.updatedAt));
  }

  async createFinancialSavedView(row: InsertFinancialSavedView): Promise<FinancialSavedView> {
    const [created] = await db.insert(financialSavedViews).values(row).returning();
    return created;
  }

  async deleteFinancialSavedView(clientId: number, userId: string, id: number): Promise<boolean> {
    const del = await db
      .delete(financialSavedViews)
      .where(
        and(
          eq(financialSavedViews.id, id),
          eq(financialSavedViews.clientId, clientId),
          eq(financialSavedViews.userId, userId),
        ),
      )
      .returning({ id: financialSavedViews.id });
    return del.length > 0;
  }

  async getTransactionCount(clientId: number, options?: { bankSource?: string }): Promise<number> {
    const conds = [eq(transactions.clientId, clientId)];
    if (options?.bankSource != null && options.bankSource !== "") {
      conds.push(eq(transactions.bankSource, options.bankSource));
    }
    const whereClause = conds.length === 1 ? conds[0]! : and(...conds);
    const [row] = await db
      .select({ c: sql<number>`count(*)` })
      .from(transactions)
      .where(whereClause);
    return Number(row?.c ?? 0);
  }

  async getTransactions(
    clientId: number,
    options?: {
      limit?: number;
      offset?: number;
      cursor?: { transactionDate: string; id: number };
      bankSource?: string;
    },
  ): Promise<Transaction[]> {
    const lim = options?.limit;
    const off = options?.offset ?? 0;
    const cursor = options?.cursor;
    const bankSource = options?.bankSource;

    const conds = [eq(transactions.clientId, clientId)];
    if (bankSource != null && bankSource !== "") {
      conds.push(eq(transactions.bankSource, bankSource));
    }
    if (cursor) {
      conds.push(
        or(
          lt(transactions.transactionDate, cursor.transactionDate),
          and(eq(transactions.transactionDate, cursor.transactionDate), lt(transactions.id, cursor.id)),
        )!,
      );
    }
    const whereClause = conds.length === 1 ? conds[0]! : and(...conds);

    let qb = db
      .select()
      .from(transactions)
      .where(whereClause)
      .orderBy(desc(transactions.transactionDate), desc(transactions.id));

    if (!cursor && off > 0) {
      qb = qb.offset(off);
    }
    if (lim != null && lim > 0) {
      qb = qb.limit(lim);
    }
    return await qb;
  }

  async getTransactionById(clientId: number, id: number): Promise<Transaction | undefined> {
    const [row] = await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.clientId, clientId), eq(transactions.id, id)))
      .limit(1);
    return row;
  }

  async assertCashMovementRowValid(
    clientId: number,
    row: {
      categoryId: number;
      localId: number | null | undefined;
      type: "income" | "expense";
      amount: number;
    },
  ): Promise<void> {
    const localsList = await this.getLocals(clientId);
    const localIds = new Set(localsList.map((l) => l.id));
    if (row.localId != null && !localIds.has(row.localId)) {
      throw new Error("Local inválido");
    }
    if (!Number.isFinite(row.amount) || row.amount <= 0 || row.amount > 1e14) {
      throw new Error("Importe inválido");
    }
  }

  async insertCashMovementBatch(
    clientId: number,
    userId: string | undefined,
    rows: Array<{
      transactionDate: string;
      description: string;
      categoryId: number | null | undefined;
      localId: number | null | undefined;
      cashRegisterId?: number | null | undefined;
      type: "income" | "expense";
      amount: number;
    }>,
  ): Promise<Transaction[]> {
    if (rows.length === 0) return [];

    for (const r of rows) {
      await this.assertCashMovementRowValid(clientId, {
        categoryId: r.categoryId,
        localId: r.localId,
        type: r.type,
        amount: r.amount,
      });
    }

    return await db.transaction(async (tx) => {
      const out: Transaction[] = [];
      for (const r of rows) {
        const [row] = await tx
          .insert(transactions)
          .values({
            clientId,
            localId: r.localId ?? undefined,
            bankAccountId: undefined,
            cashRegisterId: r.cashRegisterId ?? undefined,
            categoryId: r.categoryId ?? undefined,
            transactionDate: r.transactionDate,
            description: r.description,
            amount: String(Math.abs(r.amount)),
            type: r.type,
            source: "manual",
            bankSource: "cash",
            createdBy: userId ?? undefined,
          })
          .returning();
        out.push(row);
      }
      return out;
    });
  }

  // ---- Cajas de efectivo (catálogo global por cliente) ----
  async listCashRegisters(clientId: number, includeInactive = false): Promise<CashRegister[]> {
    const conds = [eq(cashRegisters.clientId, clientId)];
    if (!includeInactive) conds.push(eq(cashRegisters.active, true));
    return await db
      .select()
      .from(cashRegisters)
      .where(and(...conds))
      .orderBy(cashRegisters.displayOrder, cashRegisters.name);
  }

  async createCashRegister(clientId: number, name: string): Promise<CashRegister> {
    const [row] = await db
      .insert(cashRegisters)
      .values({ clientId, name: name.trim() })
      .returning();
    return row;
  }

  async updateCashRegister(
    clientId: number,
    id: number,
    data: Partial<{ name: string; active: boolean; displayOrder: number }>,
  ): Promise<CashRegister | undefined> {
    const patch: any = {};
    if (data.name !== undefined) patch.name = String(data.name).trim();
    if (data.active !== undefined) patch.active = data.active;
    if (data.displayOrder !== undefined) patch.displayOrder = data.displayOrder;
    if (Object.keys(patch).length === 0) {
      const [existing] = await db
        .select()
        .from(cashRegisters)
        .where(and(eq(cashRegisters.clientId, clientId), eq(cashRegisters.id, id)));
      return existing;
    }
    const [row] = await db
      .update(cashRegisters)
      .set(patch)
      .where(and(eq(cashRegisters.clientId, clientId), eq(cashRegisters.id, id)))
      .returning();
    return row;
  }

  async deleteCashRegister(clientId: number, id: number): Promise<boolean> {
    // No se borra físicamente si tiene movimientos: se desactiva para preservar historial.
    const [used] = await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(and(eq(transactions.clientId, clientId), eq(transactions.cashRegisterId, id)))
      .limit(1);
    if (used) {
      await db
        .update(cashRegisters)
        .set({ active: false })
        .where(and(eq(cashRegisters.clientId, clientId), eq(cashRegisters.id, id)));
      return false; // desactivada, no borrada
    }
    await db
      .delete(cashRegisters)
      .where(and(eq(cashRegisters.clientId, clientId), eq(cashRegisters.id, id)));
    return true;
  }

  // ---- Mapeo producto vendido → receta (punto 18) ----
  async listProductRecipeMappings(clientId: number): Promise<ProductRecipeMapping[]> {
    return await db.select().from(productRecipeMappings).where(eq(productRecipeMappings.clientId, clientId));
  }

  async upsertProductRecipeMapping(
    clientId: number,
    source: string,
    productName: string,
    recipeId: number,
  ): Promise<ProductRecipeMapping> {
    const [existing] = await db
      .select()
      .from(productRecipeMappings)
      .where(
        and(
          eq(productRecipeMappings.clientId, clientId),
          eq(productRecipeMappings.source, source),
          eq(productRecipeMappings.productName, productName),
        ),
      );
    if (existing) {
      const [row] = await db
        .update(productRecipeMappings)
        .set({ recipeId })
        .where(eq(productRecipeMappings.id, existing.id))
        .returning();
      return row;
    }
    const [row] = await db
      .insert(productRecipeMappings)
      .values({ clientId, source, productName, recipeId })
      .returning();
    return row;
  }

  async deleteProductRecipeMapping(clientId: number, id: number): Promise<boolean> {
    await db
      .delete(productRecipeMappings)
      .where(and(eq(productRecipeMappings.clientId, clientId), eq(productRecipeMappings.id, id)));
    return true;
  }

  async createTransaction(transaction: InsertTransaction): Promise<Transaction> {
    const [newTransaction] = await db.insert(transactions).values(transaction).returning();
    return newTransaction;
  }

  async createTransactionsBatch(transactionsList: InsertTransaction[]): Promise<number> {
    if (transactionsList.length === 0) {
      return 0;
    }

    // Lotes más grandes + sin una única transacción larga: en Netlify/Turso la transacción
    // monolítica suele acercarse al timeout (~26s) con imports MP (miles de líneas × varias por fila).
    // Límite ~32766 placeholders SQLite: ~22 columnas por fila → ~1400 filas teóricas; 1200 es seguro.
    const BATCH_SIZE = 1200;
    let inserted = 0;
    const clientId = transactionsList[0]!.clientId;
    const importBatchId = transactionsList[0]!.importBatchId;

    try {
      for (let i = 0; i < transactionsList.length; i += BATCH_SIZE) {
        const batch = transactionsList.slice(i, i + BATCH_SIZE);
        await db.insert(transactions).values(batch);
        inserted += batch.length;
      }
    } catch (e) {
      if (importBatchId) {
        await db
          .delete(transactions)
          .where(and(eq(transactions.clientId, clientId), eq(transactions.importBatchId, importBatchId)));
      }
      throw e;
    }

    return inserted;
  }

  async updateTransaction(clientId: number, id: number, transaction: Partial<InsertTransaction>): Promise<Transaction | undefined> {
    const [updated] = await db.update(transactions)
      .set(transaction)
      .where(and(eq(transactions.id, id), eq(transactions.clientId, clientId)))
      .returning();
    return updated;
  }

  /**
   * Actualiza en LOTE muchas transacciones con el mismo cambio (categorización masiva).
   * Usa un solo UPDATE ... WHERE id IN (...) por chunk en vez de N updates individuales:
   * con Turso remoto, N round-trips (p.ej. 1296) desborda el timeout de la función (504).
   */
  async batchUpdateTransactions(
    clientId: number,
    ids: number[],
    updateData: Partial<InsertTransaction>,
  ): Promise<number> {
    if (ids.length === 0) return 0;
    const CHUNK = 500; // muy por debajo del límite de variables de SQLite
    let updated = 0;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK);
      const rows = await db
        .update(transactions)
        .set(updateData)
        .where(and(eq(transactions.clientId, clientId), inArray(transactions.id, chunk)))
        .returning({ id: transactions.id });
      updated += rows.length;
    }
    return updated;
  }

  async deleteTransaction(clientId: number, id: number): Promise<boolean> {
    // SQLite/libSQL: el resultado del DELETE no garantiza rowCount útil con este driver.
    const deletedRows = await db
      .delete(transactions)
      .where(and(eq(transactions.id, id), eq(transactions.clientId, clientId)))
      .returning({ id: transactions.id });
    return deletedRows.length > 0;
  }

  async deleteTransactionBatch(clientId: number, importBatchId: string): Promise<number> {
    await db
      .delete(financialImportBatches)
      .where(
        and(eq(financialImportBatches.clientId, clientId), eq(financialImportBatches.importBatchId, importBatchId)),
      );
    const deleted = await db
      .delete(transactions)
      .where(and(eq(transactions.clientId, clientId), eq(transactions.importBatchId, importBatchId)))
      .returning({ id: transactions.id });
    return deleted.length;
  }

  // ==========================================
  // PRÉSTAMOS INTERNOS ENTRE LOCALES (jul-27)
  // ==========================================
  async getInternalLoans(clientId: number, status: "active" | "all" = "active"): Promise<InternalLoan[]> {
    const whereClause =
      status === "active"
        ? and(eq(internalLoans.clientId, clientId), eq(internalLoans.status, "active"))
        : eq(internalLoans.clientId, clientId);
    return await db.select().from(internalLoans).where(whereClause).orderBy(desc(internalLoans.id));
  }

  /**
   * Crea un préstamo interno: el movimiento de origen se recategoriza a "Préstamo" y en la cuenta
   * destino se crean un "Préstamo a favor" (ingreso) y el gasto real (egreso), que netean 0 (jul-29:
   * antes caían en una caja de efectivo; ahora van a una Cuenta, igual que la división por locales).
   * Los importes se guardan SIEMPRE en positivo (la dirección la da `type`), igual que el resto
   * de los movimientos en producción.
   */
  async createInternalLoan(
    clientId: number,
    userId: string | undefined,
    params: {
      originTransactionId: number;
      toLocalId: number;
      bankAccountId: number;
      expenseCategoryId: number;
    },
  ): Promise<InternalLoan> {
    const { originTransactionId, toLocalId, bankAccountId, expenseCategoryId } = params;

    // Categoría "Préstamo" (specialType = "loan").
    const cats = await this.getTransactionCategories(clientId);
    const loanCat =
      cats.find((c) => c.specialType === "loan" && c.active !== false) ??
      cats.find((c) => c.specialType === "loan");
    if (!loanCat) {
      throw new Error('No existe una categoría de tipo "Préstamo" para este cliente. Creá una antes de continuar.');
    }
    const expenseCat = cats.find((c) => c.id === expenseCategoryId);
    if (!expenseCat) throw new Error("Categoría de gasto inválida.");

    // Movimiento de origen.
    const [origin] = await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.id, originTransactionId), eq(transactions.clientId, clientId)));
    if (!origin) throw new Error("Movimiento de origen no encontrado.");
    if (origin.source === "internal_loan") {
      throw new Error("Este movimiento ya forma parte de un préstamo interno.");
    }
    if (origin.parentTransactionId != null) {
      throw new Error("No se puede usar un movimiento que es parte de una división.");
    }
    const existing = await this.getInternalLoans(clientId, "active");
    if (existing.some((l) => l.originTransactionId === originTransactionId)) {
      throw new Error("Este movimiento ya fue convertido en un préstamo interno.");
    }

    // Validaciones de destino.
    const localsList = await this.getLocals(clientId);
    const toLocal = localsList.find((l) => l.id === toLocalId);
    if (!toLocal) throw new Error("Local destino inválido.");
    const destAccount = await this.getBankAccount(clientId, bankAccountId);
    if (!destAccount) throw new Error("Cuenta destino inválida.");
    const destBankSource = destAccount.bankId ?? null;

    const amount = Math.abs(parseFloat(String(origin.amount)) || 0);
    if (!(amount > 0)) throw new Error("El importe del movimiento de origen no es válido.");

    const originalCategoryId = origin.categoryId ?? null;
    const fromLocalId = origin.localId ?? null;
    const fromLocalName = fromLocalId ? localsList.find((l) => l.id === fromLocalId)?.name ?? "" : "";
    const baseDesc = (origin.description || "Préstamo interno").trim();

    return await db.transaction(async (tx) => {
      // 1) Recategorizar el origen a "Préstamo".
      await tx
        .update(transactions)
        .set({ categoryId: loanCat.id })
        .where(and(eq(transactions.id, originTransactionId), eq(transactions.clientId, clientId)));

      // 2) "Préstamo a favor" (ingreso) en el local destino.
      const [receivable] = await tx
        .insert(transactions)
        .values({
          clientId,
          localId: toLocalId,
          bankAccountId,
          categoryId: loanCat.id,
          transactionDate: origin.transactionDate,
          description: `Préstamo a favor${fromLocalName ? ` (de ${fromLocalName})` : ""} — ${baseDesc}`,
          amount: String(amount),
          type: "income",
          source: "internal_loan",
          bankSource: destBankSource,
          createdBy: userId ?? undefined,
        })
        .returning();

      // 3) Gasto real en el local destino.
      const [expense] = await tx
        .insert(transactions)
        .values({
          clientId,
          localId: toLocalId,
          bankAccountId,
          categoryId: expenseCategoryId,
          transactionDate: origin.transactionDate,
          description: `${baseDesc}${fromLocalName ? ` (préstamo de ${fromLocalName})` : ""}`,
          amount: String(amount),
          type: "expense",
          source: "internal_loan",
          bankSource: destBankSource,
          createdBy: userId ?? undefined,
        })
        .returning();

      // 4) Registrar la operación (para mostrarla enlazada y poder deshacerla).
      const [loan] = await tx
        .insert(internalLoans)
        .values({
          clientId,
          fromLocalId,
          toLocalId,
          amount: String(amount),
          originTransactionId,
          originalCategoryId,
          receivableTransactionId: receivable.id,
          expenseTransactionId: expense.id,
          expenseCategoryId,
          bankAccountId,
          direction: "expense",
          status: "active",
          createdBy: userId ?? undefined,
        })
        .returning();

      return loan;
    });
  }

  /** Deshace un préstamo interno: borra los 2 movimientos del destino y restaura la categoría del origen. */
  async reverseInternalLoan(clientId: number, id: number): Promise<boolean> {
    const [loan] = await db
      .select()
      .from(internalLoans)
      .where(and(eq(internalLoans.id, id), eq(internalLoans.clientId, clientId)));
    if (!loan) throw new Error("Préstamo interno no encontrado.");
    if (loan.status === "reversed") throw new Error("Este préstamo interno ya fue revertido.");

    return await db.transaction(async (tx) => {
      if (loan.receivableTransactionId != null) {
        await tx
          .delete(transactions)
          .where(and(eq(transactions.id, loan.receivableTransactionId), eq(transactions.clientId, clientId)));
      }
      if (loan.expenseTransactionId != null) {
        await tx
          .delete(transactions)
          .where(and(eq(transactions.id, loan.expenseTransactionId), eq(transactions.clientId, clientId)));
      }
      await tx
        .update(transactions)
        .set({ categoryId: loan.originalCategoryId ?? null })
        .where(and(eq(transactions.id, loan.originTransactionId), eq(transactions.clientId, clientId)));
      await tx
        .update(internalLoans)
        .set({ status: "reversed" })
        .where(and(eq(internalLoans.id, id), eq(internalLoans.clientId, clientId)));
      return true;
    });
  }

  // ==========================================
  // DIVISIÓN DE UN MOVIMIENTO ENTRE VARIOS LOCALES (jul-29)
  // ==========================================

  /** Partes hijas de un movimiento dividido entre locales. */
  async getLocalSplitParts(clientId: number, originTransactionId: number): Promise<Transaction[]> {
    return await db
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.clientId, clientId),
          eq(transactions.parentTransactionId, originTransactionId),
        ),
      )
      .orderBy(transactions.id);
  }

  /**
   * Divide un movimiento entre varios locales generando los préstamos internos correspondientes.
   *
   * INVARIANTE: el saldo de la cuenta del movimiento original no se mueve un peso. El original queda
   * como PADRE (sigue asentado en su cuenta pero deja de computar — ya lo excluye `splitParentIds`)
   * y se descompone en partes hijas DENTRO DE SU MISMA CUENTA, cuya suma es exactamente el importe
   * original:
   *   - la parte propia del local de origen (su gasto/ingreso real; puede ser 0 si solo prestó), y
   *   - una parte por cada local destino, categorizada como "Préstamo".
   * En la cuenta destino de cada local se crean 2 movimientos que netean 0 (no mueven ese saldo):
   *   - original GASTO:   "Préstamo a favor" (ingreso) + el gasto real (egreso)
   *   - original INGRESO: el ingreso real (ingreso) + la contrapartida del préstamo (egreso)
   * Los importes se guardan SIEMPRE en positivo; la dirección la da `type`.
   */
  async createLocalSplit(
    clientId: number,
    userId: string | undefined,
    params: {
      originTransactionId: number;
      originLocalId?: number | null;
      originShareAmount?: number;
      originCategoryId?: number | null;
      parts: Array<{ localId: number; amount: number; categoryId: number; bankAccountId: number }>;
    },
  ): Promise<{ splitGroupId: string; loans: number; parts: number; destinationMovements: number }> {
    const { originTransactionId, parts } = params;
    const toCents = (n: number) => Math.round((Number(n) || 0) * 100);
    const fromCents = (c: number) => (c / 100).toFixed(2);

    if (!Array.isArray(parts) || parts.length === 0) {
      throw new Error("Elegí al menos un local destino para dividir el movimiento.");
    }

    // --- Movimiento de origen y sus candados ---
    const [origin] = await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.id, originTransactionId), eq(transactions.clientId, clientId)));
    if (!origin) throw new Error("Movimiento de origen no encontrado.");
    if (origin.parentTransactionId != null) {
      throw new Error("Este movimiento ya es una parte de otra división.");
    }
    if (origin.source === "internal_loan" || origin.source === "local_split") {
      throw new Error("Este movimiento fue generado por un préstamo o una división: no se puede dividir.");
    }
    const existingParts = await this.getLocalSplitParts(clientId, originTransactionId);
    if (existingParts.length > 0) {
      throw new Error("Este movimiento ya está dividido. Deshacé la división antes de rehacerla.");
    }
    const activeLoans = await this.getInternalLoans(clientId, "active");
    if (activeLoans.some((l) => l.originTransactionId === originTransactionId)) {
      throw new Error("Este movimiento ya forma parte de un préstamo interno.");
    }

    const originType = origin.type === "income" ? "income" : "expense";
    const totalCents = toCents(Math.abs(parseFloat(String(origin.amount)) || 0));
    if (totalCents <= 0) throw new Error("El importe del movimiento no es válido.");

    // --- Local de origen (se puede asignar en la misma operación si el movimiento no tenía) ---
    const localsList = await this.getLocals(clientId);
    const originLocalId = origin.localId ?? params.originLocalId ?? null;
    if (originLocalId == null) {
      throw new Error("El movimiento no tiene local asignado: elegí el local de origen.");
    }
    if (!localsList.some((l) => l.id === originLocalId)) throw new Error("Local de origen inválido.");

    // --- Partes destino ---
    const seen = new Set<number>();
    for (const p of parts) {
      if (!localsList.some((l) => l.id === p.localId)) throw new Error("Hay un local destino inválido.");
      if (p.localId === originLocalId) {
        throw new Error("El local de origen no puede estar entre los destinos: su parte se carga aparte.");
      }
      if (seen.has(p.localId)) throw new Error("Hay un local destino repetido.");
      seen.add(p.localId);
      if (toCents(p.amount) <= 0) throw new Error("Todas las partes deben tener un importe mayor a cero.");
    }

    // --- Categorías ---
    const cats = await this.getTransactionCategories(clientId);
    const loanCat =
      cats.find((c) => c.specialType === "loan" && c.active !== false) ??
      cats.find((c) => c.specialType === "loan");
    if (!loanCat) {
      throw new Error('No existe una categoría de tipo "Préstamo" para este cliente. Creá una antes de continuar.');
    }
    for (const p of parts) {
      if (!cats.some((c) => c.id === p.categoryId)) throw new Error("Hay una categoría inválida en las partes.");
    }

    // --- Cuentas destino ---
    const accounts = await this.getBankAccounts(clientId);
    const accountById = new Map(accounts.map((a) => [a.id, a]));
    for (const p of parts) {
      if (!accountById.has(p.bankAccountId)) throw new Error("Hay una cuenta destino inválida.");
    }

    // --- La suma tiene que dar EXACTO al centavo (es el candado del saldo) ---
    const originShareCents = toCents(params.originShareAmount ?? 0);
    if (originShareCents < 0) throw new Error("La parte del local de origen no puede ser negativa.");
    const partsCents = parts.map((p) => toCents(p.amount));
    const sumCents = partsCents.reduce((a, b) => a + b, 0) + originShareCents;
    if (sumCents !== totalCents) {
      throw new Error(
        `La suma de las partes (${fromCents(sumCents)}) no coincide exactamente con el importe original (${fromCents(totalCents)}).`,
      );
    }
    const originCategoryId = params.originCategoryId ?? null;
    if (originShareCents > 0) {
      if (originCategoryId == null || !cats.some((c) => c.id === originCategoryId)) {
        throw new Error("Elegí la categoría de la parte que absorbe el local de origen.");
      }
    }

    const localNameById = new Map(localsList.map((l) => [l.id, l.name]));
    const originLocalName = localNameById.get(originLocalId) ?? "";
    const baseDesc = (origin.description || "Movimiento dividido").trim();
    const splitGroupId = `split_${originTransactionId}_${Date.now()}`;
    // Las partes del origen viven en la MISMA cuenta/caja que el original: por eso el saldo no cambia.
    const originPlacement = {
      bankAccountId: origin.bankAccountId ?? null,
      cashRegisterId: origin.cashRegisterId ?? null,
      bankSource: origin.bankSource ?? null,
    };

    return await db.transaction(async (tx) => {
      // Si el movimiento no tenía local, se lo asignamos en la misma operación.
      if (origin.localId == null) {
        await tx
          .update(transactions)
          .set({ localId: originLocalId })
          .where(and(eq(transactions.id, originTransactionId), eq(transactions.clientId, clientId)));
      }

      let partsCreated = 0;

      // 1) Parte propia del local de origen (su gasto/ingreso real). Puede no existir.
      if (originShareCents > 0) {
        await tx.insert(transactions).values({
          clientId,
          localId: originLocalId,
          ...originPlacement,
          categoryId: originCategoryId,
          transactionDate: origin.transactionDate,
          description: `${baseDesc} — parte ${originLocalName}`,
          description2: origin.description2 ?? null,
          amount: fromCents(originShareCents),
          type: originType,
          source: "local_split",
          parentTransactionId: originTransactionId,
          createdBy: userId ?? undefined,
        });
        partsCreated++;
      }

      // 2) Una parte "Préstamo" en la cuenta de origen + los 2 movimientos del destino, por local.
      let loansCreated = 0;
      let destinationMovements = 0;
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        const amountStr = fromCents(partsCents[i]);
        const toLocalName = localNameById.get(p.localId) ?? "";
        const destAccount = accountById.get(p.bankAccountId)!;
        const destBankSource = destAccount.bankId ?? null;

        // 2.a) En la cuenta de origen: la parte prestada.
        const [originPart] = await tx
          .insert(transactions)
          .values({
            clientId,
            localId: originLocalId,
            ...originPlacement,
            categoryId: loanCat.id,
            transactionDate: origin.transactionDate,
            description:
              originType === "expense"
                ? `Préstamo a ${toLocalName} — ${baseDesc}`
                : `Préstamo de ${toLocalName} — ${baseDesc}`,
            description2: origin.description2 ?? null,
            amount: amountStr,
            type: originType,
            source: "local_split",
            parentTransactionId: originTransactionId,
            createdBy: userId ?? undefined,
          })
          .returning();
        partsCreated++;

        // 2.b) En la cuenta destino: contrapartida del préstamo + el gasto/ingreso real. Netean 0.
        const [loanLeg] = await tx
          .insert(transactions)
          .values({
            clientId,
            localId: p.localId,
            bankAccountId: p.bankAccountId,
            bankSource: destBankSource,
            categoryId: loanCat.id,
            transactionDate: origin.transactionDate,
            description:
              originType === "expense"
                ? `Préstamo a favor${originLocalName ? ` (de ${originLocalName})` : ""} — ${baseDesc}`
                : `Préstamo otorgado${originLocalName ? ` (a ${originLocalName})` : ""} — ${baseDesc}`,
            amount: amountStr,
            // Gasto: el destino recibe el préstamo (ingreso). Ingreso: el destino lo otorga (egreso).
            type: originType === "expense" ? "income" : "expense",
            source: "internal_loan",
            createdBy: userId ?? undefined,
          })
          .returning();

        const [realLeg] = await tx
          .insert(transactions)
          .values({
            clientId,
            localId: p.localId,
            bankAccountId: p.bankAccountId,
            bankSource: destBankSource,
            categoryId: p.categoryId,
            transactionDate: origin.transactionDate,
            description: `${baseDesc}${originLocalName ? ` (vía ${originLocalName})` : ""}`,
            description2: origin.description2 ?? null,
            amount: amountStr,
            type: originType,
            source: "internal_loan",
            createdBy: userId ?? undefined,
          })
          .returning();
        destinationMovements += 2;

        // 2.c) Registro del préstamo (enlaza todo y permite deshacer la división completa).
        // Convención: fromLocal = quien puso la plata, toLocal = quien absorbe el gasto/ingreso.
        await tx.insert(internalLoans).values({
          clientId,
          fromLocalId: originType === "expense" ? originLocalId : p.localId,
          toLocalId: originType === "expense" ? p.localId : originLocalId,
          amount: amountStr,
          originTransactionId,
          originalCategoryId: origin.categoryId ?? null,
          originPartTransactionId: originPart.id,
          receivableTransactionId: loanLeg.id,
          expenseTransactionId: realLeg.id,
          expenseCategoryId: p.categoryId,
          bankAccountId: p.bankAccountId,
          splitGroupId,
          direction: originType,
          status: "active",
          createdBy: userId ?? undefined,
        });
        loansCreated++;
      }

      return { splitGroupId, loans: loansCreated, parts: partsCreated, destinationMovements };
    });
  }

  /**
   * Deshace la división completa: borra las partes de la cuenta de origen y los 2 movimientos de
   * cada local destino, y el movimiento original vuelve a ser el único, tal como estaba.
   */
  async reverseLocalSplit(
    clientId: number,
    originTransactionId: number,
  ): Promise<{ deletedParts: number; deletedDestination: number; reversedLoans: number }> {
    const parts = await this.getLocalSplitParts(clientId, originTransactionId);
    const loans = (await this.getInternalLoans(clientId, "active")).filter(
      (l) => l.originTransactionId === originTransactionId && l.splitGroupId != null,
    );
    if (parts.length === 0 && loans.length === 0) {
      throw new Error("Este movimiento no está dividido.");
    }

    return await db.transaction(async (tx) => {
      let deletedDestination = 0;
      for (const loan of loans) {
        for (const txId of [loan.receivableTransactionId, loan.expenseTransactionId]) {
          if (txId == null) continue;
          const deleted = await tx
            .delete(transactions)
            .where(and(eq(transactions.id, txId), eq(transactions.clientId, clientId)))
            .returning({ id: transactions.id });
          deletedDestination += deleted.length;
        }
        await tx
          .update(internalLoans)
          .set({ status: "reversed" })
          .where(and(eq(internalLoans.id, loan.id), eq(internalLoans.clientId, clientId)));
      }

      const deletedParts = await tx
        .delete(transactions)
        .where(
          and(
            eq(transactions.clientId, clientId),
            eq(transactions.parentTransactionId, originTransactionId),
          ),
        )
        .returning({ id: transactions.id });

      // `invoiced` lo usaba la división vieja como marca de "ya dividido": lo dejamos limpio.
      await tx
        .update(transactions)
        .set({ invoiced: false })
        .where(and(eq(transactions.id, originTransactionId), eq(transactions.clientId, clientId)));

      return { deletedParts: deletedParts.length, deletedDestination, reversedLoans: loans.length };
    });
  }

  async getImportBatches(clientId: number): Promise<
    Array<{
      importBatchId: string;
      bankSource: string | null;
      count: number;
      minDate: string | null;
      maxDate: string | null;
      importedAt: Date | null;
      bankAccountId: number | null;
      bankAccountName: string | null;
      openingBalance: string | null;
      closingBalance: string | null;
    }>
  > {
    const allTx = await db.select().from(transactions).where(
      and(eq(transactions.clientId, clientId), isNotNull(transactions.importBatchId)),
    );
    const batches = new Map<
      string,
      { bankSource: string | null; count: number; minDate: string | null; maxDate: string | null; importedAt: Date | null }
    >();
    for (const tx of allTx) {
      const batchId = tx.importBatchId!;
      if (!batches.has(batchId)) {
        batches.set(batchId, {
          bankSource: tx.bankSource,
          count: 0,
          minDate: tx.transactionDate,
          maxDate: tx.transactionDate,
          importedAt: tx.createdAt,
        });
      }
      const b = batches.get(batchId)!;
      b.count++;
      if (tx.transactionDate && (!b.minDate || tx.transactionDate < b.minDate)) b.minDate = tx.transactionDate;
      if (tx.transactionDate && (!b.maxDate || tx.transactionDate > b.maxDate)) b.maxDate = tx.transactionDate;
    }

    const metaRows = await db
      .select()
      .from(financialImportBatches)
      .where(eq(financialImportBatches.clientId, clientId));
    const metaByBatch = new Map(metaRows.map((m) => [m.importBatchId, m]));

    const accountRows = await db.select().from(bankAccounts).where(eq(bankAccounts.clientId, clientId));
    const accNameById = new Map(accountRows.map((a) => [a.id, a.name]));

    const out: Array<{
      importBatchId: string;
      bankSource: string | null;
      count: number;
      minDate: string | null;
      maxDate: string | null;
      importedAt: Date | null;
      bankAccountId: number | null;
      bankAccountName: string | null;
      openingBalance: string | null;
      closingBalance: string | null;
    }> = [];

    for (const [importBatchId, data] of batches.entries()) {
      const meta = metaByBatch.get(importBatchId);
      let bankAccountId: number | null = meta?.bankAccountId ?? null;
      if (bankAccountId == null) {
        const idsInBatch = new Set(
          allTx
            .filter((t) => t.importBatchId === importBatchId)
            .map((t) => t.bankAccountId)
            .filter((x): x is number => x != null),
        );
        if (idsInBatch.size === 1) bankAccountId = [...idsInBatch][0]!;
      }
      const openingBalance =
        meta?.openingBalance != null && String(meta.openingBalance) !== ""
          ? String(meta.openingBalance)
          : null;
      const closingBalance =
        meta?.closingBalance != null && String(meta.closingBalance) !== ""
          ? String(meta.closingBalance)
          : null;

      out.push({
        importBatchId,
        bankSource: meta?.bankSource ?? data.bankSource,
        count: data.count,
        minDate: data.minDate,
        maxDate: data.maxDate,
        importedAt: data.importedAt,
        bankAccountId,
        bankAccountName: bankAccountId != null ? accNameById.get(bankAccountId) ?? null : null,
        openingBalance,
        closingBalance,
      });
    }

    out.sort((a, b) => {
      const ta = a.importedAt instanceof Date ? a.importedAt.getTime() : 0;
      const tb = b.importedAt instanceof Date ? b.importedAt.getTime() : 0;
      return tb - ta;
    });
    return out;
  }

  async getMonthlyBalances(clientId: number, year: number): Promise<MonthlyBalance[]> {
    return db
      .select()
      .from(monthlyBalances)
      .where(and(eq(monthlyBalances.clientId, clientId), eq(monthlyBalances.year, year)))
      .orderBy(monthlyBalances.month);
  }

  async createMonthlyBalance(balance: InsertMonthlyBalance): Promise<MonthlyBalance> {
    const [newBalance] = await db.insert(monthlyBalances).values(balance).returning();
    return newBalance;
  }

  async updateMonthlyBalance(clientId: number, id: number, balance: Partial<InsertMonthlyBalance>): Promise<MonthlyBalance | undefined> {
    const [updated] = await db.update(monthlyBalances)
      .set(balance)
      .where(and(eq(monthlyBalances.id, id), eq(monthlyBalances.clientId, clientId)))
      .returning();
    return updated;
  }

  async getBalanceSpreadsheet(clientId: number, year: number, localId?: number | number[]) {
    const startDate = `${year}-01-01`;
    const endDate = `${year}-12-31`;
    
    const allFinancialGroups = await db
      .select()
      .from(financialGroups)
      .where(and(eq(financialGroups.clientId, clientId), eq(financialGroups.active, true)))
      .orderBy(financialGroups.displayOrder, financialGroups.name);
    
    const allCategories = await db
      .select()
      .from(transactionCategories)
      .where(and(eq(transactionCategories.clientId, clientId), eq(transactionCategories.active, true)));

    // Compatibilidad: algunos clientes pueden tener categorías viejas con groupId
    // (tabla category_groups). Mapeamos por nombre+tipo para no perder datos.
    const legacyGroups = await db
      .select()
      .from(categoryGroups)
      .where(eq(categoryGroups.clientId, clientId));

    const financialByNormalizedKey = new Map<string, typeof allFinancialGroups[number]>();
    for (const fg of allFinancialGroups) {
      const key = `${String(fg.type || "").toLowerCase()}::${String(fg.name || "").trim().toLowerCase()}`;
      financialByNormalizedKey.set(key, fg);
    }

    const legacyToFinancialId = new Map<number, number>();
    for (const lg of legacyGroups) {
      const key = `${String(lg.type || "").toLowerCase()}::${String(lg.name || "").trim().toLowerCase()}`;
      const match = financialByNormalizedKey.get(key);
      if (match) legacyToFinancialId.set(lg.id, match.id);
    }
    
    let transactionsQuery = db.select().from(transactions)
      .where(and(
        eq(transactions.clientId, clientId),
        sql`${transactions.transactionDate} >= ${startDate}`,
        sql`${transactions.transactionDate} <= ${endDate}`
      ));
    
    const allTransactions = await transactionsQuery;

    // Movimientos "originales" que fueron divididos: quedan asentados pero NO deben incidir
    // (sus partes hijas ya suman). Se excluyen del balance para no duplicar.
    const splitParentIds = new Set(
      allTransactions
        .filter((t) => t.parentTransactionId != null)
        .map((t) => t.parentTransactionId as number),
    );

    // Punto 19: localId puede ser un id, una lista de ids, o nada (todos).
    const localIdSet =
      localId == null
        ? null
        : new Set(Array.isArray(localId) ? localId : [localId]);
    const filteredTransactions = localIdSet
      ? allTransactions.filter(t => t.localId != null && localIdSet.has(t.localId))
      : allTransactions;
    
    // Categorías "Otros Movimientos": quedan asentadas y se muestran, pero NO afectan
    // el resultado neto (income - expense).
    // IMPORTANTE: la exclusión se basa en el `specialType` canónico de Otros Movimientos,
    // NO en el booleano `isSpecial` (que históricamente se usó para una clasificación
    // EE.RR. distinta y sin efecto). Así evitamos excluir por error gastos/ingresos reales
    // que algún cliente pudiera haber marcado isSpecial=true con un specialType viejo.
    const excludedSpecialTypes = OTROS_MOVIMIENTOS_SPECIAL_TYPES;
    const isOtroMovimiento = (specialType: unknown): boolean =>
      typeof specialType === "string" && excludedSpecialTypes.has(specialType);
    // Grupos de tipo "Movimientos Financieros": sus categorías quedan fuera de la rentabilidad.
    const movFinGroupIds = new Set(
      allFinancialGroups.filter((g) => String(g.type) === MOVIMIENTOS_FINANCIEROS_GROUP_TYPE).map((g) => g.id),
    );
    const isMovFinCategory = (c: { financialGroupId: number | null }): boolean =>
      c.financialGroupId != null && movFinGroupIds.has(c.financialGroupId);
    const specialCategoryIds = new Set(
      allCategories.filter((c) => isOtroMovimiento(c.specialType) || isMovFinCategory(c)).map((c) => c.id),
    );

    // Tipo del grupo financiero resuelto de cada categoría (por financialGroupId o mapeo legacy).
    // Se usa para NETEAR por categoría: en un grupo de Gasto, un ingreso (reintegro/recupero) RESTA;
    // en un grupo de Venta, un egreso (gasto de caja) RESTA. Así los grupos reconcilian con los totales.
    const finGroupTypeById = new Map(allFinancialGroups.map((g) => [g.id, String(g.type)]));
    const catGroupTypeById = new Map<number, string | undefined>(
      allCategories.map((c) => {
        const resolvedId = c.financialGroupId ?? (c.groupId ? legacyToFinancialId.get(c.groupId) : undefined);
        return [c.id, resolvedId != null ? finGroupTypeById.get(resolvedId) : undefined];
      }),
    );

    const categoryMonthlyTotals: Record<number, Record<number, number>> = {};
    // Neto por categoría en la DIRECCIÓN de su grupo (gasto: egreso +, ingreso −; venta: ingreso +, egreso −).
    // Es lo que se muestra como subtotal del grupo y lo que compone Gastos Totales / Ventas.
    const categoryNetMonthly: Record<number, Record<number, number>> = {};
    // Punto 7: firmado por categoría ESPECIAL, con la MISMA base que el total (dirección de
    // cada transacción). Así la suma de las filas de Movimientos Financieros = el Total, sin
    // importar en qué grupo (aunque sea mixto) viva la categoría especial.
    const specialSignedByCat: Record<number, Record<number, number>> = {};
    const summaryIncome: Record<number, number> = {};
    const summaryExpenses: Record<number, number> = {};
    const otrosMovimientos: Record<number, number> = {};
    // Movimientos no-especiales cuya categoría NO tiene grupo income/expense (huérfanos): entran al
    // total por su tipo para no cambiar la Utilidad, aunque no aparezcan en ningún grupo.
    const orphanIncome: Record<number, number> = {};
    const orphanExpense: Record<number, number> = {};
    // Ventas por LOCAL y mes, con la misma composición que summaryIncome (neto por dirección de
    // grupo + huérfanos). Lo necesita el balance en modo CMV: el CMV% es por local, así que el
    // costo de mercadería se pasa a pesos contra las ventas DE ESE local y recién después se suma.
    // Movimientos sin local caen en la clave 0 (no se le pueden asignar a ningún CMV).
    const incomeByLocal: Record<number, Record<number, number>> = {};
    const addIncomeByLocal = (lid: number | null | undefined, month: number, val: number) => {
      const key = lid ?? 0;
      if (!incomeByLocal[key]) {
        incomeByLocal[key] = {};
        for (let m = 1; m <= 12; m++) incomeByLocal[key][m] = 0;
      }
      incomeByLocal[key][month] += val;
    };

    for (let m = 1; m <= 12; m++) {
      summaryIncome[m] = 0;
      summaryExpenses[m] = 0;
      otrosMovimientos[m] = 0;
      orphanIncome[m] = 0;
      orphanExpense[m] = 0;
    }

    for (const tx of filteredTransactions) {
      if (!tx.categoryId) continue;
      if (splitParentIds.has(tx.id)) continue; // original dividido: no computa

      const txDate = new Date(tx.transactionDate);
      const month = txDate.getMonth() + 1;
      const amount = parseFloat(String(tx.amount) || "0");

      if (!categoryMonthlyTotals[tx.categoryId]) {
        categoryMonthlyTotals[tx.categoryId] = {};
        for (let m = 1; m <= 12; m++) {
          categoryMonthlyTotals[tx.categoryId][m] = 0;
        }
      }

      // Se acumula SIEMPRE para el detalle por grupo/categoría (incluye especiales).
      categoryMonthlyTotals[tx.categoryId][month] += amount;

      if (specialCategoryIds.has(tx.categoryId)) {
        // "Otros Movimientos": fuera del neto. Signo informativo (egreso resta).
        const signed = tx.type === "expense" ? -amount : amount;
        otrosMovimientos[month] += signed;
        if (!specialSignedByCat[tx.categoryId]) {
          specialSignedByCat[tx.categoryId] = {};
          for (let m = 1; m <= 12; m++) specialSignedByCat[tx.categoryId][m] = 0;
        }
        specialSignedByCat[tx.categoryId][month] += signed;
        continue;
      }

      // Netear por la dirección del grupo de la categoría (gasto: egreso +, ingreso −; venta al revés).
      const gType = catGroupTypeById.get(tx.categoryId);
      if (gType === "expense" || gType === "income") {
        const net =
          gType === "expense"
            ? (tx.type === "expense" ? amount : -amount)
            : (tx.type === "income" ? amount : -amount);
        if (!categoryNetMonthly[tx.categoryId]) {
          categoryNetMonthly[tx.categoryId] = {};
          for (let m = 1; m <= 12; m++) categoryNetMonthly[tx.categoryId][m] = 0;
        }
        categoryNetMonthly[tx.categoryId][month] += net;
        if (gType === "income") addIncomeByLocal(tx.localId, month, net);
      } else {
        // Sin grupo income/expense: huérfano. Entra al total por su tipo (preserva la Utilidad).
        if (tx.type === "income") {
          orphanIncome[month] += amount;
          addIncomeByLocal(tx.localId, month, amount);
        } else if (tx.type === "expense") orphanExpense[month] += amount;
      }
    }
    
    const groups = allFinancialGroups.map(group => {
      const groupCategories = allCategories.filter((c) => {
        if (c.financialGroupId === group.id) return true;
        const mappedFinancialId = c.groupId ? legacyToFinancialId.get(c.groupId) : undefined;
        return mappedFinancialId === group.id;
      });
      const groupMonthlyTotals: Record<number, number> = {};
      // Total con signo (income +, expense −) según el type de cada categoría. Sirve para mostrar
      // los Movimientos Financieros con su dirección real (ej. Retiros restan) aunque el grupo
      // ya no sea income/expense.
      const groupSignedMonthly: Record<number, number> = {};

      for (let m = 1; m <= 12; m++) {
        groupMonthlyTotals[m] = 0;
        groupSignedMonthly[m] = 0;
      }

      // No especiales: subtotal = NETO en la dirección del grupo (gasto: egreso−ingreso; venta: ingreso−egreso).
      // Especiales (Movimientos Financieros): NO suman al subtotal; se muestran aparte.
      const mappedCats = groupCategories.map(cat => {
        const special = isOtroMovimiento(cat.specialType) || isMovFinCategory(cat);
        const monthlyTotals = special ? (categoryMonthlyTotals[cat.id] || {}) : (categoryNetMonthly[cat.id] || {});
        let yearTotal = 0;

        for (let m = 1; m <= 12; m++) {
          const val = monthlyTotals[m] || 0;
          yearTotal += val;
          if (!special) {
            groupMonthlyTotals[m] += val;
            groupSignedMonthly[m] += val;
          }
        }

        return {
          id: cat.id,
          name: cat.name,
          // isSpecial = "es Movimiento Financiero (excluido del neto)": por specialType o por tipo de grupo.
          isSpecial: special,
          specialType: cat.specialType ?? null,
          monthlyTotals,
          yearTotal,
        };
      });

      // Categorías reales (para el detalle de Gastos/Ventas). Las especiales van aparte.
      const categories = mappedCats.filter((c) => !c.isSpecial);

      const groupYearTotal = Object.values(groupMonthlyTotals).reduce((a, b) => a + b, 0);
      // El grupo es "Movimiento Financiero" si su tipo lo es, o si TODAS sus categorías lo son.
      const groupIsSpecial =
        String(group.type) === MOVIMIENTOS_FINANCIEROS_GROUP_TYPE ||
        (mappedCats.length > 0 && mappedCats.every((c) => c.isSpecial));
      const groupSpecialType =
        groupCategories.find((c) => c.specialType)?.specialType ?? null;

      // Punto 7: categorías especiales de ESTE grupo (aunque el grupo sea mixto) con su firmado.
      // El Total de Movimientos Financieros = suma de estos firmados en TODOS los grupos.
      const specialSignedMonthlyTotals: Record<number, number> = {};
      for (let m = 1; m <= 12; m++) specialSignedMonthlyTotals[m] = 0;
      const specialCategories = mappedCats
        .filter((c) => c.isSpecial)
        .map((c) => {
          const signedMonthlyTotals = specialSignedByCat[c.id] || {};
          for (let m = 1; m <= 12; m++) specialSignedMonthlyTotals[m] += signedMonthlyTotals[m] || 0;
          return {
            id: c.id,
            name: c.name,
            specialType: c.specialType,
            monthlyTotals: c.monthlyTotals,
            signedMonthlyTotals,
          };
        });

      return {
        id: group.id,
        name: group.name,
        type: group.type,
        isSpecial: groupIsSpecial,
        // Grupo de mercadería: en modo CMV deja de computar en la rentabilidad (lo reemplaza el CMV).
        isMerchandise: !!group.isMerchandise,
        specialType: groupSpecialType,
        categories,
        monthlyTotals: groupMonthlyTotals,
        signedMonthlyTotals: groupSignedMonthly,
        specialSignedMonthlyTotals,
        specialCategories,
        yearTotal: groupYearTotal,
      };
    });

    // Gastos Totales y Ventas = suma de los subtotales NETOS de los grupos (por tipo) + huérfanos.
    // Así los grupos reconcilian EXACTO con los totales, y la Utilidad se preserva (huérfanos incluidos).
    for (let m = 1; m <= 12; m++) {
      let inc = orphanIncome[m];
      let exp = orphanExpense[m];
      for (const g of groups) {
        if (g.isSpecial) continue;
        if (String(g.type) === "income") inc += g.monthlyTotals[m] || 0;
        else if (String(g.type) === "expense") exp += g.monthlyTotals[m] || 0;
      }
      summaryIncome[m] = inc;
      summaryExpenses[m] = exp;
    }

    const summaryNet: Record<number, number> = {};
    for (let m = 1; m <= 12; m++) {
      summaryNet[m] = summaryIncome[m] - summaryExpenses[m];
    }

    const totalIncome = Object.values(summaryIncome).reduce((a, b) => a + b, 0);
    const totalExpenses = Object.values(summaryExpenses).reduce((a, b) => a + b, 0);
    const totalNet = totalIncome - totalExpenses;
    const totalOtrosMovimientos = Object.values(otrosMovimientos).reduce((a, b) => a + b, 0);

    // Punto 6: Traslados de Mercadería valorizados por mes (recibidos − enviados) desde la óptica
    // del/los local(es) seleccionado(s). NO afecta la Utilidad ni los saldos bancarios: solo se
    // RESTA en el "Movimiento neto (caja)". Si se ven todos los locales (o ambas puntas están en la
    // selección), los traslados internos se compensan a 0.
    const traslados: Record<number, number> = {};
    for (let m = 1; m <= 12; m++) traslados[m] = 0;
    const activeTransfers = await db
      .select()
      .from(merchandiseTransfers)
      .where(and(
        eq(merchandiseTransfers.clientId, clientId),
        eq(merchandiseTransfers.status, "active"),
        sql`${merchandiseTransfers.transferDate} >= ${startDate}`,
        sql`${merchandiseTransfers.transferDate} <= ${endDate}`,
      ));
    const inSelection = (lid: number | null) =>
      localIdSet == null ? true : lid != null && localIdSet.has(lid);
    for (const tr of activeTransfers) {
      // Mes tomado del string YYYY-MM-DD (evita el corrimiento por timezone de new Date()).
      const m = parseInt(String(tr.transferDate).slice(5, 7), 10);
      if (!Number.isFinite(m) || m < 1 || m > 12) continue;
      const val = parseFloat(String(tr.totalValue) || "0");
      if (inSelection(tr.toLocalId)) traslados[m] += val; // recibido: entra mercadería
      if (inSelection(tr.fromLocalId)) traslados[m] -= val; // enviado: sale mercadería
    }
    const totalTraslados = Object.values(traslados).reduce((a, b) => a + b, 0);

    return {
      groups,
      summary: {
        income: summaryIncome,
        expenses: summaryExpenses,
        net: summaryNet,
        // Otros Movimientos: asentados pero fuera del neto (signo informativo).
        otrosMovimientos,
        // Punto 6: Traslados de Mercadería (recibidos − enviados). Solo resta en el neto de caja.
        traslados,
        // Ventas por local y mes (misma composición que income). Base del CMV por local.
        incomeByLocal,
        totalIncome,
        totalExpenses,
        totalNet,
        totalOtrosMovimientos,
        totalTraslados,
      },
    };
  }

  /**
   * BALANCE ECONÓMICO (ago-2026).
   *
   * Mide rentabilidad DEVENGADA, a diferencia del Balance Financiero que mide el flujo de dinero.
   * Tres diferencias de fondo con `getBalanceSpreadsheet`:
   *
   *  1. Las VENTAS salen del sistema de gestión (Datalive / Fudo / Shares), no de los movimientos.
   *     Por eso los grupos de tipo "income" NO computan acá: contarlos seria sumar dos veces la
   *     misma venta.
   *  2. Los GASTOS se agrupan por MES ECONÓMICO (`resolveEconomicMonth`), no por la fecha de
   *     acreditación. De ahí que haya que leer un rango de fechas más amplio que el año pedido:
   *     un movimiento acreditado en enero de 2027 puede ser económicamente de diciembre de 2026.
   *  3. Cada grupo puede quedar fuera con `economicComputes = false` (qué es gasto económico y qué
   *     es inversión cambia por cliente). El tilde es el ÚNICO criterio: si un grupo está tildado
   *     computa, sin importar si es de mercadería (decisión del usuario, 07-ago-2026). Por eso,
   *     cuando además hay CMV, los grupos de mercadería hay que destildarlos a mano o el costo se
   *     cuenta dos veces; el front avisa cuando eso pasa.
   *
   * Quedan siempre afuera los Movimientos Financieros y los "Otros Movimientos": no son economía
   * del período.
   *
   * Se pueden combinar varias fuentes de venta: cada local suele facturar con un solo sistema, así
   * que sumarlas es lo que da la venta completa de la empresa. Si algún local apareciera en más de
   * una fuente elegida se lo reporta en `overlappingLocalIds`, porque ahí sí se estaría duplicando.
   */
  async getEconomicBalance(
    clientId: number,
    year: number,
    localId?: number | number[],
    salesSources: Array<"datalive" | "fudo" | "shares"> = ["datalive"],
  ) {
    const localIdSet =
      localId == null ? null : new Set(Array.isArray(localId) ? localId : [localId]);
    const localIds = localIdSet ? Array.from(localIdSet) : null;
    const emptyMonths = (): Record<number, number> => {
      const o: Record<number, number> = {};
      for (let m = 1; m <= 12; m++) o[m] = 0;
      return o;
    };

    // ---------- VENTAS (del sistema de gestión) ----------
    const yearFrom = `${year}-01-01`;
    const yearTo = `${year}-12-31`;
    const ventasMonthly = emptyMonths();
    const ventasByLocal: Record<number, Record<number, number>> = {};
    const compositionMonthly: Record<string, Record<number, number>> = {};

    // localId -> fuentes en las que ese local tiene ventas. Con más de una, hay doble conteo.
    const sourcesByLocal = new Map<number, Set<string>>();
    const addVenta = (lid: number, month: number, total: number, source: string) => {
      ventasMonthly[month] += total;
      if (!ventasByLocal[lid]) ventasByLocal[lid] = emptyMonths();
      ventasByLocal[lid][month] += total;
      if (total !== 0) {
        if (!sourcesByLocal.has(lid)) sourcesByLocal.set(lid, new Set());
        sourcesByLocal.get(lid)!.add(source);
      }
    };
    const addComposition = (label: string, month: number, val: number) => {
      if (!val) return;
      if (!compositionMonthly[label]) compositionMonthly[label] = emptyMonths();
      compositionMonthly[label][month] += val;
    };
    const monthOf = (fecha: unknown): number => parseInt(String(fecha).slice(5, 7), 10);
    const num = (v: unknown): number => {
      const n = parseFloat(String(v ?? "0"));
      return Number.isFinite(n) ? n : 0;
    };

    const sources = salesSources.length > 0 ? salesSources : (["datalive"] as const);
    const multi = sources.length > 1;
    // Con varias fuentes, la composición lleva de qué sistema viene cada concepto: "Efectivo"
    // significa cosas distintas en Datalive que en Shares.
    const compLabel = (label: string, source: string) =>
      multi ? `${label} (${source === "datalive" ? "Datalive" : source === "shares" ? "Shares" : "Fudo"})` : label;

    for (const source of sources) {
      if (source === "datalive") {
        const conds = [
          eq(dataliveVentas.clientId, clientId),
          sql`${dataliveVentas.fecha} >= ${yearFrom}`,
          sql`${dataliveVentas.fecha} <= ${yearTo}`,
        ];
        if (localIds) conds.push(inArray(dataliveVentas.localId, localIds));
        const rows = await db.select().from(dataliveVentas).where(and(...conds));
        for (const r of rows) {
          const m = monthOf(r.fecha);
          if (!Number.isFinite(m) || m < 1 || m > 12) continue;
          addVenta(r.localId, m, num(r.ventaTotal), source);
          addComposition(compLabel("Efectivo", source), m, num(r.ventaEfectivo));
          addComposition(compLabel("Online", source), m, num(r.ventaOnline));
        }
      } else if (source === "shares") {
        const conds = [
          eq(sharesVentas.clientId, clientId),
          sql`${sharesVentas.fecha} >= ${yearFrom}`,
          sql`${sharesVentas.fecha} <= ${yearTo}`,
        ];
        if (localIds) conds.push(inArray(sharesVentas.localId, localIds));
        const rows = await db.select().from(sharesVentas).where(and(...conds));
        for (const r of rows) {
          const m = monthOf(r.fecha);
          if (!Number.isFinite(m) || m < 1 || m > 12) continue;
          addVenta(r.localId, m, num(r.ventaTotal), source);
          addComposition(compLabel("Efectivo", source), m, num(r.ventaEfectivo));
          addComposition(compLabel("Tarjeta", source), m, num(r.ventaTarjeta));
          addComposition(compLabel("Efectivo Online", source), m, num(r.ventaEfectivoOnline));
          addComposition(compLabel("Oper. Online", source), m, num(r.ventaOperOnline));
          addComposition(compLabel("Mercado Pago", source), m, num(r.ventaMercadopago));
        }
      } else {
        const conds = [
          eq(fudoVentas.clientId, clientId),
          sql`${fudoVentas.fecha} >= ${yearFrom}`,
          sql`${fudoVentas.fecha} <= ${yearTo}`,
        ];
        if (localIds) conds.push(inArray(fudoVentas.localId, localIds));
        const rows = await db.select().from(fudoVentas).where(and(...conds));
        for (const r of rows) {
          const m = monthOf(r.fecha);
          if (!Number.isFinite(m) || m < 1 || m > 12) continue;
          addVenta(r.localId, m, num(r.ventaTotal), source);
        }
        // La composición de Fudo vive en otra tabla: los medios de pago del día.
        const pagoConds = [
          eq(fudoPagos.clientId, clientId),
          sql`${fudoPagos.fecha} >= ${yearFrom}`,
          sql`${fudoPagos.fecha} <= ${yearTo}`,
        ];
        if (localIds) pagoConds.push(inArray(fudoPagos.localId, localIds));
        const pagos = await db.select().from(fudoPagos).where(and(...pagoConds));
        for (const p of pagos) {
          const m = monthOf(p.fecha);
          if (!Number.isFinite(m) || m < 1 || m > 12) continue;
          addComposition(compLabel(String(p.medioPago || "Sin medio"), source), m, num(p.importe));
        }
      }
    }

    const overlappingLocalIds = Array.from(sourcesByLocal.entries())
      .filter(([, set]) => set.size > 1)
      .map(([lid]) => lid);

    // ---------- GASTOS (movimientos, por MES ECONÓMICO) ----------
    const allFinancialGroups = await db
      .select()
      .from(financialGroups)
      .where(and(eq(financialGroups.clientId, clientId), eq(financialGroups.active, true)))
      .orderBy(financialGroups.displayOrder, financialGroups.name);

    const allCategories = await db
      .select()
      .from(transactionCategories)
      .where(and(eq(transactionCategories.clientId, clientId), eq(transactionCategories.active, true)));

    // Compatibilidad con categorías viejas que cuelgan de category_groups (mismo mapeo por
    // nombre+tipo que usa el balance financiero).
    const legacyGroups = await db
      .select()
      .from(categoryGroups)
      .where(eq(categoryGroups.clientId, clientId));
    const financialByNormalizedKey = new Map<string, typeof allFinancialGroups[number]>();
    for (const fg of allFinancialGroups) {
      financialByNormalizedKey.set(
        `${String(fg.type || "").toLowerCase()}::${String(fg.name || "").trim().toLowerCase()}`,
        fg,
      );
    }
    const legacyToFinancialId = new Map<number, number>();
    for (const lg of legacyGroups) {
      const match = financialByNormalizedKey.get(
        `${String(lg.type || "").toLowerCase()}::${String(lg.name || "").trim().toLowerCase()}`,
      );
      if (match) legacyToFinancialId.set(lg.id, match.id);
    }
    const resolvedGroupIdByCat = new Map<number, number | undefined>(
      allCategories.map((c) => [
        c.id,
        c.financialGroupId ?? (c.groupId ? legacyToFinancialId.get(c.groupId) : undefined),
      ]),
    );

    // El mes económico puede caer en otro año que el de acreditación, así que se lee un año para
    // cada lado y recién despues se filtra por el mes económico resuelto.
    const scanFrom = `${year - 1}-01-01`;
    const scanTo = `${year + 1}-12-31`;
    const allTransactions = await db
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.clientId, clientId),
          sql`${transactions.transactionDate} >= ${scanFrom}`,
          sql`${transactions.transactionDate} <= ${scanTo}`,
        ),
      );

    const splitParentIds = new Set(
      allTransactions.filter((t) => t.parentTransactionId != null).map((t) => t.parentTransactionId as number),
    );
    const movFinGroupIds = new Set(
      allFinancialGroups.filter((g) => String(g.type) === MOVIMIENTOS_FINANCIEROS_GROUP_TYPE).map((g) => g.id),
    );
    const isExcludedCategory = (catId: number): boolean => {
      const cat = allCategories.find((c) => c.id === catId);
      if (!cat) return true;
      if (typeof cat.specialType === "string" && OTROS_MOVIMIENTOS_SPECIAL_TYPES.has(cat.specialType)) return true;
      const gid = resolvedGroupIdByCat.get(catId);
      return gid != null && movFinGroupIds.has(gid);
    };

    const categoryNetMonthly: Record<number, Record<number, number>> = {};
    for (const tx of allTransactions) {
      if (!tx.categoryId) continue;
      if (splitParentIds.has(tx.id)) continue;
      if (localIdSet && (tx.localId == null || !localIdSet.has(tx.localId))) continue;
      if (isExcludedCategory(tx.categoryId)) continue;

      const econ = resolveEconomicMonth(tx as any);
      if (!econ || econ.slice(0, 4) !== String(year)) continue;
      const month = parseInt(econ.slice(5, 7), 10);
      if (!Number.isFinite(month) || month < 1 || month > 12) continue;

      const gid = resolvedGroupIdByCat.get(tx.categoryId);
      const group = gid != null ? allFinancialGroups.find((g) => g.id === gid) : undefined;
      // Solo gastos: las ventas ya vienen del sistema de gestión. Los huérfanos (sin grupo) no
      // computan: sin grupo no hay forma de saber si son gasto económico.
      if (!group || String(group.type) !== "expense") continue;

      const amount = parseFloat(String(tx.amount) || "0");
      // Neto en la dirección del grupo: un reintegro (ingreso en un grupo de gasto) resta.
      const net = tx.type === "expense" ? amount : -amount;
      if (!categoryNetMonthly[tx.categoryId]) categoryNetMonthly[tx.categoryId] = emptyMonths();
      categoryNetMonthly[tx.categoryId][month] += net;
    }

    const expenseGroups = allFinancialGroups.filter((g) => String(g.type) === "expense");
    const groups = expenseGroups.map((group) => {
      const groupCategories = allCategories.filter((c) => resolvedGroupIdByCat.get(c.id) === group.id);
      const monthlyTotals = emptyMonths();
      const categories = groupCategories
        .filter((c) => !isExcludedCategory(c.id))
        .map((cat) => {
          const catMonthly = categoryNetMonthly[cat.id] || emptyMonths();
          let yearTotal = 0;
          for (let m = 1; m <= 12; m++) {
            yearTotal += catMonthly[m] || 0;
            monthlyTotals[m] += catMonthly[m] || 0;
          }
          return { id: cat.id, name: cat.name, monthlyTotals: catMonthly, yearTotal };
        });
      const yearTotal = Object.values(monthlyTotals).reduce((a, b) => a + b, 0);
      return {
        id: group.id,
        name: group.name,
        type: String(group.type),
        isMerchandise: !!group.isMerchandise,
        // `?? true`: los grupos creados antes de esta columna computan, que es el default.
        computes: group.economicComputes ?? true,
        categories,
        monthlyTotals,
        yearTotal,
      };
    });

    // Gastos = TODOS los grupos tildados. El tilde es el único criterio: ser de mercadería ya no
    // excluye por su cuenta (si además se usa el CMV, hay que destildarlos a mano).
    const gastos = emptyMonths();
    for (const g of groups) {
      if (!g.computes) continue;
      for (let m = 1; m <= 12; m++) gastos[m] += g.monthlyTotals[m] || 0;
    }

    const composition = Object.entries(compositionMonthly).map(([label, monthlyTotals]) => ({
      label,
      monthlyTotals,
      yearTotal: Object.values(monthlyTotals).reduce((a, b) => a + b, 0),
    }));
    composition.sort((a, b) => b.yearTotal - a.yearTotal);

    return {
      salesSources: sources,
      ventas: {
        monthly: ventasMonthly,
        byLocal: ventasByLocal,
        composition,
        overlappingLocalIds,
        yearTotal: Object.values(ventasMonthly).reduce((a, b) => a + b, 0),
      },
      groups,
      summary: {
        gastos,
        totalGastos: Object.values(gastos).reduce((a, b) => a + b, 0),
      },
    };
  }

  /** Marca si un grupo financiero computa en el Balance Económico (guardado por cliente). */
  async setFinancialGroupEconomicComputes(
    clientId: number,
    groupId: number,
    computes: boolean,
  ): Promise<FinancialGroup | undefined> {
    const [updated] = await db
      .update(financialGroups)
      .set({ economicComputes: computes })
      .where(and(eq(financialGroups.id, groupId), eq(financialGroups.clientId, clientId)))
      .returning();
    return updated;
  }

  async getSales(clientId: number): Promise<Sale[]> {
    return db.select().from(sales).where(eq(sales.clientId, clientId)).orderBy(desc(sales.saleDate));
  }

  async getSalesTotalByPeriod(
    clientId: number,
    opts: { dateFrom?: string; dateTo?: string; localIds?: number[] },
  ): Promise<number> {
    // La "venta" = transacciones de INGRESO del grupo "Ventas" (importe bruto, con IVA tal como
    // entró). NO se usa la tabla `sales` (ventas por producto, puede estar vacía). Se prioriza el
    // grupo "Ventas" para dar la venta REAL aunque todavía no se haya marcado Inicio de mes;
    // fallback: ingresos no especiales (= "Ventas" del balance post-migración).
    const groups = await db
      .select({ id: financialGroups.id, name: financialGroups.name, type: financialGroups.type })
      .from(financialGroups)
      .where(eq(financialGroups.clientId, clientId));
    const ventasGroupIds = new Set(
      groups.filter((g) => String(g.type) === "income" && String(g.name ?? "").trim().toLowerCase() === "ventas").map((g) => g.id),
    );
    const cats = await db
      .select({ id: transactionCategories.id, type: transactionCategories.type, financialGroupId: transactionCategories.financialGroupId, specialType: transactionCategories.specialType })
      .from(transactionCategories)
      .where(eq(transactionCategories.clientId, clientId));
    const salesCatIds = new Set(
      (ventasGroupIds.size > 0
        ? cats.filter((c) => c.financialGroupId != null && ventasGroupIds.has(c.financialGroupId))
        : cats.filter(
            (c) =>
              String(c.type) === "income" &&
              !(typeof c.specialType === "string" && OTROS_MOVIMIENTOS_SPECIAL_TYPES.has(c.specialType)),
          )
      ).map((c) => c.id),
    );

    const conds = [eq(transactions.clientId, clientId), eq(transactions.type, "income")];
    if (opts.dateFrom) conds.push(sql`${transactions.transactionDate} >= ${opts.dateFrom}`);
    if (opts.dateTo) conds.push(sql`${transactions.transactionDate} <= ${opts.dateTo}`);
    if (opts.localIds && opts.localIds.length > 0) conds.push(inArray(transactions.localId, opts.localIds));
    const rows = await db
      .select({
        id: transactions.id,
        amount: transactions.amount,
        categoryId: transactions.categoryId,
        parentTransactionId: transactions.parentTransactionId,
      })
      .from(transactions)
      .where(and(...conds));

    // Originales divididos: no computan (sus partes hijas ya suman).
    const splitParentIds = new Set(
      rows.filter((r) => r.parentTransactionId != null).map((r) => r.parentTransactionId as number),
    );

    return rows.reduce((acc, r) => {
      if (r.categoryId == null || !salesCatIds.has(r.categoryId)) return acc;
      if (splitParentIds.has(r.id)) return acc;
      return acc + (parseFloat(String(r.amount)) || 0);
    }, 0);
  }

  async getDataliveSalesTotalByPeriod(
    clientId: number,
    opts: { dateFrom?: string; dateTo?: string; localIds?: number[] },
  ): Promise<number> {
    const conds = [eq(dataliveVentas.clientId, clientId)];
    if (opts.dateFrom) conds.push(sql`${dataliveVentas.fecha} >= ${opts.dateFrom}`);
    if (opts.dateTo) conds.push(sql`${dataliveVentas.fecha} <= ${opts.dateTo}`);
    if (opts.localIds && opts.localIds.length > 0) conds.push(inArray(dataliveVentas.localId, opts.localIds));
    const rows = await db.select({ total: dataliveVentas.ventaTotal }).from(dataliveVentas).where(and(...conds));
    return rows.reduce((acc, r) => acc + (parseFloat(String(r.total)) || 0), 0);
  }

  async getFudoSalesTotalByPeriod(
    clientId: number,
    opts: { dateFrom?: string; dateTo?: string; localIds?: number[] },
  ): Promise<number> {
    const conds = [eq(fudoVentas.clientId, clientId)];
    if (opts.dateFrom) conds.push(sql`${fudoVentas.fecha} >= ${opts.dateFrom}`);
    if (opts.dateTo) conds.push(sql`${fudoVentas.fecha} <= ${opts.dateTo}`);
    if (opts.localIds && opts.localIds.length > 0) conds.push(inArray(fudoVentas.localId, opts.localIds));
    const rows = await db.select({ total: fudoVentas.ventaTotal }).from(fudoVentas).where(and(...conds));
    return rows.reduce((acc, r) => acc + (parseFloat(String(r.total)) || 0), 0);
  }

  async getSharesSalesTotalByPeriod(
    clientId: number,
    opts: { dateFrom?: string; dateTo?: string; localIds?: number[] },
  ): Promise<number> {
    const conds = [eq(sharesVentas.clientId, clientId)];
    if (opts.dateFrom) conds.push(sql`${sharesVentas.fecha} >= ${opts.dateFrom}`);
    if (opts.dateTo) conds.push(sql`${sharesVentas.fecha} <= ${opts.dateTo}`);
    if (opts.localIds && opts.localIds.length > 0) conds.push(inArray(sharesVentas.localId, opts.localIds));
    const rows = await db.select({ total: sharesVentas.ventaTotal }).from(sharesVentas).where(and(...conds));
    return rows.reduce((acc, r) => acc + (parseFloat(String(r.total)) || 0), 0);
  }

  private async getSalesBySource(
    clientId: number,
    opts: { dateFrom?: string; dateTo?: string; localIds?: number[] },
    source: "extractos" | "datalive" | "fudo" | "shares",
  ): Promise<number> {
    if (source === "datalive") return this.getDataliveSalesTotalByPeriod(clientId, opts);
    if (source === "fudo") return this.getFudoSalesTotalByPeriod(clientId, opts);
    if (source === "shares") return this.getSharesSalesTotalByPeriod(clientId, opts);
    return this.getSalesTotalByPeriod(clientId, opts);
  }

  async getCmcReport(
    clientId: number,
    opts: { dateFrom?: string; dateTo?: string; localIds?: number[]; salesSource?: "extractos" | "datalive" | "fudo" | "shares" },
  ) {
    // 1) Facturas en alcance (activas, por fecha/local).
    const invConds = [eq(invoices.clientId, clientId), eq(invoices.status, "active")];
    if (opts.dateFrom) invConds.push(sql`${invoices.invoiceDate} >= ${opts.dateFrom}`);
    if (opts.dateTo) invConds.push(sql`${invoices.invoiceDate} <= ${opts.dateTo}`);
    if (opts.localIds && opts.localIds.length > 0) invConds.push(inArray(invoices.localId, opts.localIds));
    const invs = await db.select({ id: invoices.id, invoiceType: invoices.invoiceType }).from(invoices).where(and(...invConds));
    const invIds = invs.map((i) => i.id);
    // NC (Nota de Crédito) reduces compras: build a set for fast lookup.
    const ncInvoiceIds = new Set(invs.filter((i) => String(i.invoiceType ?? "").startsWith("NC-")).map((i) => i.id));

    const salesGross = await this.getSalesBySource(clientId, opts, opts.salesSource ?? "extractos");
    const salesNet = salesGross / 1.21; // criterio CMC: venta sin IVA
    const pctOf = (amount: number) => (salesNet > 0 ? (amount / salesNet) * 100 : null);

    if (invIds.length === 0) {
      return { total: 0, salesGross, salesNet, pct: pctOf(0), rubros: [] };
    }

    // 2) Ítems de esas facturas (subtotal = base SIN IVA). NC items negate the amount.
    const items = await db
      .select({ invoiceId: invoiceItems.invoiceId, subtotal: invoiceItems.subtotal, supplyId: invoiceItems.supplyId, rubroId: invoiceItems.rubroId })
      .from(invoiceItems)
      .where(inArray(invoiceItems.invoiceId, invIds));

    // 3) Mapas de lookup (insumo → sub-rubro/rubro; sub-rubro → rubro padre; rubro → nombre).
    const supplyRows = await db
      .select({ id: supplies.id, subRubroId: supplies.subRubroId, rubroId: supplies.rubroId })
      .from(supplies)
      .where(eq(supplies.clientId, clientId));
    const supplyMap = new Map(supplyRows.map((s) => [s.id, s]));
    const subRubroRows = await db.select().from(subRubros).where(eq(subRubros.clientId, clientId));
    const subRubroMap = new Map(subRubroRows.map((s) => [s.id, s]));
    const rubroRows = await db.select().from(rubros).where(eq(rubros.clientId, clientId));
    const rubroMap = new Map(rubroRows.map((r) => [r.id, r]));

    // 4) Agregación por rubro padre → sub-rubro.
    const UNCLASS = -1;
    type Sub = { id: number | null; name: string; total: number };
    type Rub = { id: number | null; name: string; total: number; subs: Map<number, Sub> };
    const agg = new Map<number, Rub>();

    for (const it of items) {
      // NC invoices are credits → subtract from compras.
      const sign = ncInvoiceIds.has(it.invoiceId) ? -1 : 1;
      const amount = (parseFloat(String(it.subtotal)) || 0) * sign;
      if (amount === 0) continue;

      let subRubroId: number | null = null;
      let rubroFromSupply: number | null = null;
      if (it.supplyId != null && supplyMap.has(it.supplyId)) {
        const s = supplyMap.get(it.supplyId)!;
        subRubroId = (s.subRubroId as number | null) ?? null;
        rubroFromSupply = (s.rubroId as number | null) ?? null;
      }
      let parentRubroId: number | null = rubroFromSupply;
      if (subRubroId != null && subRubroMap.has(subRubroId)) {
        parentRubroId = (subRubroMap.get(subRubroId)!.rubroId as number | null) ?? parentRubroId;
      }
      if (parentRubroId == null && it.rubroId != null) parentRubroId = it.rubroId;

      const rKey = parentRubroId ?? UNCLASS;
      const rName = parentRubroId != null ? (rubroMap.get(parentRubroId)?.name ?? "Sin clasificar") : "Sin clasificar";
      const sKey = subRubroId ?? UNCLASS;
      const sName = subRubroId != null ? (subRubroMap.get(subRubroId)?.name ?? "Sin sub-rubro") : "Sin sub-rubro";

      let rub = agg.get(rKey);
      if (!rub) {
        rub = { id: parentRubroId, name: rName, total: 0, subs: new Map() };
        agg.set(rKey, rub);
      }
      rub.total += amount;
      const sub = rub.subs.get(sKey);
      if (!sub) rub.subs.set(sKey, { id: subRubroId, name: sName, total: amount });
      else sub.total += amount;
    }

    const rubrosOut = Array.from(agg.values())
      .map((r) => ({
        id: r.id,
        name: r.name,
        total: r.total,
        pct: pctOf(r.total),
        subRubros: Array.from(r.subs.values())
          .map((s) => ({ id: s.id, name: s.name, total: s.total, pct: pctOf(s.total) }))
          .sort((a, b) => b.total - a.total),
      }))
      .sort((a, b) => b.total - a.total);

    const total = rubrosOut.reduce((acc, r) => acc + r.total, 0);
    return { total, salesGross, salesNet, pct: pctOf(total), rubros: rubrosOut };
  }

  async getPapReport(
    clientId: number,
    opts: { dateFrom?: string; dateTo?: string; localIds?: number[]; supplierIds?: number[]; salesSource?: "extractos" | "datalive" | "fudo" | "shares" },
  ) {
    const hasLocals = opts.localIds && opts.localIds.length > 0;
    const hasSuppliers = opts.supplierIds && opts.supplierIds.length > 0;

    // Entregado: total de facturas (CON IVA), por invoiceDate.
    const invConds = [eq(invoices.clientId, clientId), eq(invoices.status, "active")];
    if (opts.dateFrom) invConds.push(sql`${invoices.invoiceDate} >= ${opts.dateFrom}`);
    if (opts.dateTo) invConds.push(sql`${invoices.invoiceDate} <= ${opts.dateTo}`);
    if (hasLocals) invConds.push(inArray(invoices.localId, opts.localIds!));
    if (hasSuppliers) invConds.push(inArray(invoices.supplierId, opts.supplierIds!));
    const invRows = await db
      .select({ supplierId: invoices.supplierId, total: invoices.total })
      .from(invoices)
      .where(and(...invConds));

    // Pagado: monto de pagos, por paymentDate.
    const payConds = [eq(payments.clientId, clientId)];
    if (opts.dateFrom) payConds.push(sql`${payments.paymentDate} >= ${opts.dateFrom}`);
    if (opts.dateTo) payConds.push(sql`${payments.paymentDate} <= ${opts.dateTo}`);
    if (hasLocals) payConds.push(inArray(payments.localId, opts.localIds!));
    if (hasSuppliers) payConds.push(inArray(payments.supplierId, opts.supplierIds!));
    const payRows = await db
      .select({ supplierId: payments.supplierId, amount: payments.amount })
      .from(payments)
      .where(and(...payConds));

    type Row = { supplierId: number | null; entregado: number; pagado: number };
    const map = new Map<number, Row>();
    const UNKNOWN = -1;
    for (const r of invRows) {
      const k = r.supplierId ?? UNKNOWN;
      const e = map.get(k) ?? { supplierId: r.supplierId ?? null, entregado: 0, pagado: 0 };
      e.entregado += parseFloat(String(r.total)) || 0;
      map.set(k, e);
    }
    for (const r of payRows) {
      const k = r.supplierId ?? UNKNOWN;
      const e = map.get(k) ?? { supplierId: r.supplierId ?? null, entregado: 0, pagado: 0 };
      e.pagado += parseFloat(String(r.amount)) || 0;
      map.set(k, e);
    }

    const supRows = await db
      .select({ id: suppliers.id, tradeName: suppliers.tradeName })
      .from(suppliers)
      .where(eq(suppliers.clientId, clientId));
    const supMap = new Map(supRows.map((s) => [s.id, s.tradeName]));

    const totalEntregado = invRows.reduce((a, r) => a + (parseFloat(String(r.total)) || 0), 0);
    const totalPagado = payRows.reduce((a, r) => a + (parseFloat(String(r.amount)) || 0), 0);
    const salesWithIva = await this.getSalesBySource(clientId, opts, opts.salesSource ?? "extractos");
    const pctOf = (amount: number) => (salesWithIva > 0 ? (amount / salesWithIva) * 100 : null);

    const bySupplier = Array.from(map.values())
      .map((r) => ({
        supplierId: r.supplierId,
        name: r.supplierId != null ? (supMap.get(r.supplierId) ?? "Proveedor s/d") : "Sin proveedor",
        entregado: r.entregado,
        pagado: r.pagado,
        saldo: r.entregado - r.pagado,
      }))
      .sort((a, b) => b.entregado - a.entregado);

    return {
      totalEntregado,
      totalPagado,
      salesWithIva,
      pctEntregado: pctOf(totalEntregado),
      pctPagado: pctOf(totalPagado),
      bySupplier,
    };
  }

  async listStockValuations(clientId: number, localId?: number): Promise<StockValuation[]> {
    const conds = [eq(stockValuations.clientId, clientId)];
    if (localId != null) conds.push(eq(stockValuations.localId, localId));
    return db.select().from(stockValuations).where(and(...conds)).orderBy(desc(stockValuations.valuationDate), desc(stockValuations.id));
  }

  async getStockValuation(clientId: number, id: number) {
    const [valuation] = await db.select().from(stockValuations)
      .where(and(eq(stockValuations.id, id), eq(stockValuations.clientId, clientId)));
    if (!valuation) return undefined;

    const rawItems = await db.select().from(stockValuationItems).where(eq(stockValuationItems.valuationId, id));
    const supplyRows = await db.select({ id: supplies.id, name: supplies.name }).from(supplies).where(eq(supplies.clientId, clientId));
    const supplyName = new Map(supplyRows.map((s) => [s.id, s.name]));
    const unitRows = await db.select({ id: unitsOfMeasure.id, name: unitsOfMeasure.name }).from(unitsOfMeasure).where(eq(unitsOfMeasure.clientId, clientId));
    const unitName = new Map(unitRows.map((u) => [u.id, u.name]));

    const items = rawItems.map((it) => ({
      ...it,
      supplyName: it.supplyId != null ? (supplyName.get(it.supplyId) ?? null) : null,
      unitName: it.unitOfMeasureId != null ? (unitName.get(it.unitOfMeasureId) ?? null) : null,
    }));
    return { valuation, items };
  }

  async createStockValuation(input: {
    clientId: number;
    localId?: number | null;
    valuationDate: string;
    notes?: string | null;
    createdBy?: string | null;
    items: Array<{ supplyId: number; quantity: number; unitOfMeasureId?: number | null; replacementUnitCost?: number | null }>;
  }): Promise<StockValuation> {
    // Costo de reposición = última compra (supplies.lastCost) si no se provee explícito.
    const supplyRows = await db
      .select({ id: supplies.id, lastCost: supplies.lastCost, unitOfMeasureId: supplies.unitOfMeasureId })
      .from(supplies)
      .where(eq(supplies.clientId, input.clientId));
    const supplyMap = new Map(supplyRows.map((s) => [s.id, s]));

    const prepared = input.items
      .filter((it) => it.supplyId != null && Number(it.quantity) > 0)
      .map((it) => {
        const s = supplyMap.get(it.supplyId);
        const cost = it.replacementUnitCost != null ? Number(it.replacementUnitCost) : parseFloat(String(s?.lastCost ?? 0)) || 0;
        const qty = Number(it.quantity) || 0;
        const uom = it.unitOfMeasureId ?? (s?.unitOfMeasureId as number | null) ?? null;
        const lineTotal = Math.round(qty * cost * 100) / 100;
        return { supplyId: it.supplyId, unitOfMeasureId: uom, quantity: qty, replacementUnitCost: cost, lineTotal };
      });

    const totalValued = Math.round(prepared.reduce((a, it) => a + it.lineTotal, 0) * 100) / 100;

    const [created] = await db.insert(stockValuations).values({
      clientId: input.clientId,
      localId: input.localId ?? null,
      valuationDate: input.valuationDate,
      totalValued: String(totalValued),
      status: "active",
      notes: input.notes ?? null,
      createdBy: input.createdBy ?? null,
    } as any).returning();

    if (prepared.length > 0) {
      await db.insert(stockValuationItems).values(
        prepared.map((it) => ({
          valuationId: created.id,
          supplyId: it.supplyId,
          unitOfMeasureId: it.unitOfMeasureId,
          quantity: String(it.quantity),
          replacementUnitCost: String(it.replacementUnitCost),
          lineTotal: String(it.lineTotal),
        })) as any,
      );
    }
    return created;
  }

  async updateStockValuation(
    clientId: number,
    id: number,
    input: {
      localId?: number | null;
      valuationDate: string;
      notes?: string | null;
      items: Array<{ supplyId: number; quantity: number; unitOfMeasureId?: number | null }>;
    },
  ): Promise<{ valuation: StockValuation; recalculatedCmvIds: number[]; failedCmvIds: number[] }> {
    const [existing] = await db.select().from(stockValuations)
      .where(and(eq(stockValuations.id, id), eq(stockValuations.clientId, clientId)));
    if (!existing) throw new Error("Valorización no encontrada");
    if (existing.status !== "active") throw new Error("No se puede editar una valorización reversada");

    // Los costos congelados al crear se conservan: corregir una cantidad no debe re-precificar
    // la valorización con los costos de hoy. Solo un insumo nuevo toma el lastCost actual.
    const prevItems = await db.select().from(stockValuationItems).where(eq(stockValuationItems.valuationId, id));
    const prevCost = new Map(prevItems.map((it) => [it.supplyId, parseFloat(String(it.replacementUnitCost ?? 0)) || 0]));

    const supplyRows = await db
      .select({ id: supplies.id, lastCost: supplies.lastCost, unitOfMeasureId: supplies.unitOfMeasureId })
      .from(supplies)
      .where(eq(supplies.clientId, clientId));
    const supplyMap = new Map(supplyRows.map((s) => [s.id, s]));

    const prepared = input.items
      .filter((it) => it.supplyId != null && Number(it.quantity) > 0)
      .map((it) => {
        const s = supplyMap.get(it.supplyId);
        const cost = prevCost.has(it.supplyId)
          ? (prevCost.get(it.supplyId) as number)
          : parseFloat(String(s?.lastCost ?? 0)) || 0;
        const qty = Number(it.quantity) || 0;
        const uom = it.unitOfMeasureId ?? (s?.unitOfMeasureId as number | null) ?? null;
        const lineTotal = Math.round(qty * cost * 100) / 100;
        return { supplyId: it.supplyId, unitOfMeasureId: uom, quantity: qty, replacementUnitCost: cost, lineTotal };
      });

    const totalValued = Math.round(prepared.reduce((a, it) => a + it.lineTotal, 0) * 100) / 100;

    const [updated] = await db.update(stockValuations).set({
      localId: input.localId ?? null,
      valuationDate: input.valuationDate,
      totalValued: String(totalValued),
      notes: input.notes ?? existing.notes ?? null,
    } as any).where(and(eq(stockValuations.id, id), eq(stockValuations.clientId, clientId))).returning();

    await db.delete(stockValuationItems).where(eq(stockValuationItems.valuationId, id));
    if (prepared.length > 0) {
      await db.insert(stockValuationItems).values(
        prepared.map((it) => ({
          valuationId: id,
          supplyId: it.supplyId,
          unitOfMeasureId: it.unitOfMeasureId,
          quantity: String(it.quantity),
          replacementUnitCost: String(it.replacementUnitCost),
          lineTotal: String(it.lineTotal),
        })) as any,
      );
    }

    // Los CMV guardados copian los totales al guardarse: si no se recalculan acá, quedan
    // mostrando el stock viejo mientras apuntan a esta valorización ya cambiada.
    const dependents = await this.listCmvCalculationsByValuation(clientId, id);
    const recalculatedCmvIds: number[] = [];
    const failedCmvIds: number[] = [];
    for (const row of dependents) {
      try {
        await this.recomputeCmvRow(clientId, row);
        recalculatedCmvIds.push(row.id);
      } catch {
        // Un CMV que no recalcula (p. ej. le falta el otro stock) no debe abortar la edición:
        // se reporta para que el usuario lo revise.
        failedCmvIds.push(row.id);
      }
    }

    return { valuation: updated, recalculatedCmvIds, failedCmvIds };
  }

  async reverseStockValuation(clientId: number, id: number): Promise<StockValuation | undefined> {
    const [updated] = await db.update(stockValuations)
      .set({ status: "reversed" })
      .where(and(eq(stockValuations.id, id), eq(stockValuations.clientId, clientId)))
      .returning();
    return updated;
  }

  async listBreakevenAnalyses(clientId: number): Promise<BreakevenAnalysis[]> {
    return db.select().from(breakevenAnalyses).where(eq(breakevenAnalyses.clientId, clientId)).orderBy(desc(breakevenAnalyses.id));
  }

  async getBreakevenAnalysis(clientId: number, id: number) {
    const [analysis] = await db.select().from(breakevenAnalyses)
      .where(and(eq(breakevenAnalyses.id, id), eq(breakevenAnalyses.clientId, clientId)));
    if (!analysis) return undefined;
    const fixedCosts = await db.select().from(breakevenFixedCosts).where(eq(breakevenFixedCosts.analysisId, id));
    return { analysis, fixedCosts };
  }

  async createBreakevenAnalysis(input: {
    clientId: number;
    localId?: number | null;
    name: string;
    recipeId?: number | null;
    salePriceNoIva: number;
    variableCostNoIva: number;
    createdBy?: string | null;
    commissions?: AppliedVariableCost[];
    productMix?: unknown;
    fixedCosts: Array<{ transactionCategoryId?: number | null; financialGroupId?: number | null; label?: string | null; amount: number }>;
  }): Promise<BreakevenAnalysis> {
    const price = Number(input.salePriceNoIva) || 0;
    const variable = Number(input.variableCostNoIva) || 0;
    // Costos variables en % (comisiones, IIBB, packaging…): reducen el margen de contribución.
    // Se guarda una FOTO de los que se aplicaron; el catálogo puede cambiar después.
    const commissions = Array.isArray(input.commissions) ? input.commissions : [];
    const totalFixed = Math.round(input.fixedCosts.reduce((a, f) => a + (Number(f.amount) || 0), 0) * 100) / 100;
    const pe = computeBreakeven({
      priceNoIva: price,
      costNoIva: variable,
      totalFixedCosts: totalFixed,
      variableCosts: commissions,
    });
    const contribution = pe.contributionMargin;
    // Sin margen positivo no hay PE; se persiste 0 para no romper las columnas numéricas, pero la
    // ruta ya rechaza ese caso antes de llegar acá.
    const units = pe.units != null ? Math.round(pe.units * 100) / 100 : 0;
    const revenue = Math.round(units * price * 100) / 100;

    const [created] = await db.insert(breakevenAnalyses).values({
      clientId: input.clientId,
      localId: input.localId ?? null,
      name: input.name,
      recipeId: input.recipeId ?? null,
      salePriceNoIva: String(price),
      variableCostNoIva: String(variable),
      contributionMargin: String(contribution),
      totalFixedCosts: String(totalFixed),
      breakevenUnits: String(units),
      breakevenRevenue: String(revenue),
      commissions: commissions.length > 0 ? commissions : null,
      productMix: input.productMix ?? null,
      createdBy: input.createdBy ?? null,
    } as any).returning();

    const rows = input.fixedCosts.filter((f) => Number(f.amount) > 0);
    if (rows.length > 0) {
      await db.insert(breakevenFixedCosts).values(
        rows.map((f) => ({
          analysisId: created.id,
          transactionCategoryId: f.transactionCategoryId ?? null,
          financialGroupId: f.financialGroupId ?? null,
          label: f.label ?? null,
          amount: String(Number(f.amount) || 0),
        })) as any,
      );
    }
    return created;
  }

  // ---- Catálogo de costos variables en % (Punto de Equilibrio) ----
  // Se crean una vez y quedan disponibles para todos los análisis del cliente.

  async listBreakevenVariableCosts(clientId: number): Promise<BreakevenVariableCost[]> {
    return db.select().from(breakevenVariableCosts)
      .where(eq(breakevenVariableCosts.clientId, clientId))
      .orderBy(breakevenVariableCosts.name);
  }

  async createBreakevenVariableCost(input: {
    clientId: number;
    name: string;
    pct: number;
    base: VariableCostBase;
    ivaRate?: number | null;
    createdBy?: string | null;
  }): Promise<BreakevenVariableCost> {
    const [created] = await db.insert(breakevenVariableCosts).values({
      clientId: input.clientId,
      name: input.name.trim(),
      pct: String(Number(input.pct) || 0),
      base: input.base,
      // La alícuota solo tiene sentido cuando el % pega sobre el precio con IVA.
      ivaRate: input.base === "con_iva" ? String(Number(input.ivaRate) || 0) : null,
      active: true,
      createdBy: input.createdBy ?? null,
    } as any).returning();
    return created;
  }

  async updateBreakevenVariableCost(
    clientId: number,
    id: number,
    patch: { name?: string; pct?: number; base?: VariableCostBase; ivaRate?: number | null; active?: boolean },
  ): Promise<BreakevenVariableCost | undefined> {
    const values: Record<string, unknown> = {};
    if (patch.name !== undefined) values.name = patch.name.trim();
    if (patch.pct !== undefined) values.pct = String(Number(patch.pct) || 0);
    if (patch.base !== undefined) values.base = patch.base;
    if (patch.active !== undefined) values.active = patch.active;
    // Si deja de aplicar sobre el precio con IVA, la alícuota vieja quedaría colgada.
    if (patch.base !== undefined && patch.base !== "con_iva") values.ivaRate = null;
    else if (patch.ivaRate !== undefined) values.ivaRate = patch.ivaRate == null ? null : String(Number(patch.ivaRate) || 0);
    if (Object.keys(values).length === 0) {
      const [current] = await db.select().from(breakevenVariableCosts)
        .where(and(eq(breakevenVariableCosts.id, id), eq(breakevenVariableCosts.clientId, clientId)));
      return current;
    }
    const [updated] = await db.update(breakevenVariableCosts)
      .set(values as any)
      .where(and(eq(breakevenVariableCosts.id, id), eq(breakevenVariableCosts.clientId, clientId)))
      .returning();
    return updated;
  }

  async deleteBreakevenVariableCost(clientId: number, id: number): Promise<boolean> {
    const deleted = await db.delete(breakevenVariableCosts)
      .where(and(eq(breakevenVariableCosts.id, id), eq(breakevenVariableCosts.clientId, clientId)))
      .returning();
    return deleted.length > 0;
  }

  async computeCmv(
    clientId: number,
    opts: { localId?: number; stockInicialId: number; stockFinalId: number; dateFrom?: string; dateTo?: string; salesSource?: "extractos" | "datalive" | "fudo" | "shares"; ivaIncluded?: boolean },
  ) {
    const [ini] = await db.select().from(stockValuations)
      .where(and(eq(stockValuations.id, opts.stockInicialId), eq(stockValuations.clientId, clientId)));
    const [fin] = await db.select().from(stockValuations)
      .where(and(eq(stockValuations.id, opts.stockFinalId), eq(stockValuations.clientId, clientId)));
    if (!ini) throw new Error("Stock inicial no encontrado");
    if (!fin) throw new Error("Stock final no encontrado");

    const stockInicial = parseFloat(String(ini.totalValued)) || 0;
    const stockFinal = parseFloat(String(fin.totalValued)) || 0;

    const localIds = opts.localId != null ? [opts.localId] : undefined;
    const source = opts.salesSource ?? "extractos";
    const cmc = await this.getCmcReport(clientId, { dateFrom: opts.dateFrom, dateTo: opts.dateTo, localIds });
    // Transfer adjustment: add received transfers, subtract sent transfers for this local.
    const transferAdj = opts.localId != null
      ? await this.getTransferAdjustment(clientId, opts.localId, opts.dateFrom, opts.dateTo)
      : 0;
    const compras = cmc.total + transferAdj; // sin IVA, ajustado por traslados
    const salesGross = await this.getSalesBySource(clientId, { dateFrom: opts.dateFrom, dateTo: opts.dateTo, localIds }, source);
    // ventaNeta = base para calcular CMV%; si ivaIncluded usa el bruto, si no divide por 1.21
    const ventaNeta = opts.ivaIncluded ? salesGross : salesGross / 1.21;

    const cmv = stockInicial + compras - stockFinal;
    const cmvPct = ventaNeta > 0 ? (cmv / ventaNeta) * 100 : null;

    // Decomisos del local + período (desglose informativo, NO altera el CMV).
    const decomisosTotal = await this.getDecomisosTotal(clientId, {
      localId: opts.localId,
      dateFrom: opts.dateFrom,
      dateTo: opts.dateTo,
    });
    const decomisoPct = ventaNeta > 0 ? (decomisosTotal / ventaNeta) * 100 : null;

    return {
      stockInicial,
      stockInicialDate: String(ini.valuationDate),
      stockFinal,
      stockFinalDate: String(fin.valuationDate),
      compras,
      cmv,
      salesGross,
      ventaNeta,
      cmvPct,
      decomisos: decomisosTotal,
      decomisoPct,
    };
  }

  /** Suma de decomisos valorizados por (empresa, local, período). */
  async getDecomisosTotal(
    clientId: number,
    opts: { localId?: number; dateFrom?: string; dateTo?: string },
  ): Promise<number> {
    const conds: any[] = [eq(decomisos.clientId, clientId)];
    if (opts.localId != null) conds.push(eq(decomisos.localId, opts.localId));
    if (opts.dateFrom) conds.push(gte(decomisos.fecha, opts.dateFrom));
    if (opts.dateTo) conds.push(lte(decomisos.fecha, opts.dateTo));
    const rows = await db.select({ valorizado: decomisos.valorizado }).from(decomisos).where(and(...conds));
    return rows.reduce((s, r) => s + (parseFloat(String(r.valorizado ?? 0)) || 0), 0);
  }

  async getCmcTotal(
    clientId: number,
    opts: { localId?: number; dateFrom?: string; dateTo?: string },
  ): Promise<number> {
    const localIds = opts.localId != null ? [opts.localId] : undefined;
    const cmc = await this.getCmcReport(clientId, { dateFrom: opts.dateFrom, dateTo: opts.dateTo, localIds });
    const transferAdj = opts.localId != null
      ? await this.getTransferAdjustment(clientId, opts.localId, opts.dateFrom, opts.dateTo)
      : 0;
    return cmc.total + transferAdj;
  }

  async saveCmvCalculation(
    clientId: number,
    opts: { localId?: number; stockInicialId: number; stockFinalId: number; dateFrom?: string; dateTo?: string; salesSource?: "extractos" | "datalive" | "fudo" | "shares"; ivaIncluded?: boolean; createdBy?: string | null },
  ): Promise<CmvCalculation> {
    // Se recalcula server-side para que el registro sea íntegro (no se confía en el cliente).
    const r = await this.computeCmv(clientId, {
      localId: opts.localId,
      stockInicialId: opts.stockInicialId,
      stockFinalId: opts.stockFinalId,
      dateFrom: opts.dateFrom,
      dateTo: opts.dateTo,
      salesSource: opts.salesSource,
      ivaIncluded: opts.ivaIncluded,
    });
    const [created] = await db.insert(cmvCalculations).values({
      clientId,
      localId: opts.localId ?? null,
      stockInicialId: opts.stockInicialId,
      stockFinalId: opts.stockFinalId,
      periodFrom: opts.dateFrom ?? null,
      periodTo: opts.dateTo ?? null,
      stockInicial: String(r.stockInicial),
      compras: String(r.compras),
      stockFinal: String(r.stockFinal),
      cmv: String(r.cmv),
      ventaNeta: String(r.ventaNeta),
      cmvPct: r.cmvPct != null ? String(r.cmvPct) : null,
      decomisos: String(r.decomisos),
      decomisoPct: r.decomisoPct != null ? String(r.decomisoPct) : null,
      salesSource: opts.salesSource ?? "extractos",
      ivaIncluded: opts.ivaIncluded ?? false,
      createdBy: opts.createdBy ?? null,
    } as any).returning();
    return created;
  }

  async listCmvCalculations(clientId: number): Promise<CmvCalculation[]> {
    return db.select().from(cmvCalculations).where(eq(cmvCalculations.clientId, clientId)).orderBy(desc(cmvCalculations.id));
  }

  async listCmvCalculationsByValuation(clientId: number, valuationId: number): Promise<CmvCalculation[]> {
    return db.select().from(cmvCalculations)
      .where(and(
        eq(cmvCalculations.clientId, clientId),
        or(eq(cmvCalculations.stockInicialId, valuationId), eq(cmvCalculations.stockFinalId, valuationId)),
      ))
      .orderBy(desc(cmvCalculations.id));
  }

  /** Re-corre computeCmv con los parámetros ya guardados de la fila y pisa los derivados. */
  private async recomputeCmvRow(clientId: number, row: CmvCalculation): Promise<CmvCalculation> {
    if (row.stockInicialId == null || row.stockFinalId == null) {
      throw new Error("El CMV no tiene stock inicial/final asociado");
    }
    const r = await this.computeCmv(clientId, {
      localId: row.localId ?? undefined,
      stockInicialId: row.stockInicialId,
      stockFinalId: row.stockFinalId,
      dateFrom: row.periodFrom ?? undefined,
      dateTo: row.periodTo ?? undefined,
      salesSource: (row.salesSource as "extractos" | "datalive" | "fudo" | "shares") ?? "extractos",
      ivaIncluded: !!row.ivaIncluded,
    });
    const [updated] = await db.update(cmvCalculations).set({
      stockInicial: String(r.stockInicial),
      compras: String(r.compras),
      stockFinal: String(r.stockFinal),
      cmv: String(r.cmv),
      ventaNeta: String(r.ventaNeta),
      cmvPct: r.cmvPct != null ? String(r.cmvPct) : null,
      decomisos: String(r.decomisos),
      decomisoPct: r.decomisoPct != null ? String(r.decomisoPct) : null,
    } as any).where(and(eq(cmvCalculations.id, row.id), eq(cmvCalculations.clientId, clientId))).returning();
    return updated;
  }

  async updateCmvCalculation(
    clientId: number,
    id: number,
    opts: { localId?: number; stockInicialId: number; stockFinalId: number; dateFrom?: string; dateTo?: string; salesSource?: "extractos" | "datalive" | "fudo" | "shares"; ivaIncluded?: boolean },
  ): Promise<CmvCalculation> {
    const [existing] = await db.select({ id: cmvCalculations.id }).from(cmvCalculations)
      .where(and(eq(cmvCalculations.id, id), eq(cmvCalculations.clientId, clientId)));
    if (!existing) throw new Error("CMV no encontrado");

    // Mismo criterio que al guardar: se recalcula server-side, no se confía en el cliente.
    const r = await this.computeCmv(clientId, {
      localId: opts.localId,
      stockInicialId: opts.stockInicialId,
      stockFinalId: opts.stockFinalId,
      dateFrom: opts.dateFrom,
      dateTo: opts.dateTo,
      salesSource: opts.salesSource,
      ivaIncluded: opts.ivaIncluded,
    });
    const [updated] = await db.update(cmvCalculations).set({
      localId: opts.localId ?? null,
      stockInicialId: opts.stockInicialId,
      stockFinalId: opts.stockFinalId,
      periodFrom: opts.dateFrom ?? null,
      periodTo: opts.dateTo ?? null,
      stockInicial: String(r.stockInicial),
      compras: String(r.compras),
      stockFinal: String(r.stockFinal),
      cmv: String(r.cmv),
      ventaNeta: String(r.ventaNeta),
      cmvPct: r.cmvPct != null ? String(r.cmvPct) : null,
      decomisos: String(r.decomisos),
      decomisoPct: r.decomisoPct != null ? String(r.decomisoPct) : null,
      salesSource: opts.salesSource ?? "extractos",
      ivaIncluded: opts.ivaIncluded ?? false,
    } as any).where(and(eq(cmvCalculations.id, id), eq(cmvCalculations.clientId, clientId))).returning();
    return updated;
  }

  async deleteCmvCalculation(clientId: number, id: number): Promise<void> {
    const [existing] = await db.select({ id: cmvCalculations.id }).from(cmvCalculations)
      .where(and(eq(cmvCalculations.id, id), eq(cmvCalculations.clientId, clientId)));
    if (!existing) throw new Error("CMV no encontrado");
    await db.delete(cmvCalculations).where(and(eq(cmvCalculations.id, id), eq(cmvCalculations.clientId, clientId)));
  }

  // ==========================================
  // CMV PRODUCTOS — costo por producto vendido + cálculo del CMV teórico
  // ==========================================

  /** Los productos vendidos importados NO traen $: solo cantidad. El costo lo pone product_costs. */
  async listProductCosts(clientId: number): Promise<ProductCost[]> {
    return db.select().from(productCosts).where(eq(productCosts.clientId, clientId));
  }

  /**
   * Alta/edición del costo de un producto vendido. Al mapear una receta se espeja el mapeo en
   * product_recipe_mappings, que es lo que lee el widget de márgenes del Dashboard: así el trabajo
   * de mapear se hace una sola vez y sirve en las dos pantallas.
   */
  async upsertProductCost(
    clientId: number,
    input: {
      source: string;
      productName: string;
      costMode: "receta" | "manual";
      recipeId?: number | null;
      manualCost?: number | null;
      updatedBy?: string | null;
    },
  ): Promise<ProductCost> {
    const productName = input.productName.trim();
    if (!productName) throw new Error("Falta el nombre del producto");
    if (input.costMode === "receta" && input.recipeId == null) {
      throw new Error("Elegí la receta que le da el costo al producto");
    }
    if (input.costMode === "manual" && (input.manualCost == null || !Number.isFinite(Number(input.manualCost)))) {
      throw new Error("Cargá el costo manual del producto");
    }

    const values = {
      costMode: input.costMode,
      recipeId: input.recipeId ?? null,
      manualCost: input.manualCost != null ? String(Number(input.manualCost)) : null,
      updatedBy: input.updatedBy ?? null,
      updatedAt: new Date(),
    };

    const [existing] = await db.select().from(productCosts).where(and(
      eq(productCosts.clientId, clientId),
      eq(productCosts.source, input.source),
      eq(productCosts.productName, productName),
    ));

    let row: ProductCost;
    if (existing) {
      const [updated] = await db.update(productCosts).set(values as any)
        .where(eq(productCosts.id, existing.id)).returning();
      row = updated;
    } else {
      const [created] = await db.insert(productCosts)
        .values({ clientId, source: input.source, productName, ...values } as any).returning();
      row = created;
    }

    if (input.recipeId != null) {
      // Espejo hacia el mapeo del Dashboard. Nunca debe hacer fallar el guardado del costo.
      try {
        await this.upsertProductRecipeMapping(clientId, input.source, productName, input.recipeId);
      } catch { /* el costo ya quedó guardado; el espejo es una comodidad */ }
    }
    return row;
  }

  async deleteProductCost(clientId: number, id: number): Promise<void> {
    await db.delete(productCosts).where(and(eq(productCosts.clientId, clientId), eq(productCosts.id, id)));
  }

  /**
   * Productos vendidos del período, agregados por nombre.
   *
   * Ojo con Datalive: sus productos se importan por PERÍODO cerrado (desde/hasta), no por día.
   * Solo entran los períodos íntegramente contenidos en el rango pedido — igual criterio que el
   * Dashboard. Fudo y Shares sí son diarios.
   */
  async getSoldProductsByPeriod(
    clientId: number,
    opts: { source: "fudo" | "datalive" | "shares"; dateFrom?: string; dateTo?: string; localIds?: number[] },
  ): Promise<Array<{ producto: string; categoria: string | null; cantidad: number }>> {
    const map = new Map<string, { producto: string; categoria: string | null; cantidad: number }>();
    const add = (producto: string, categoria: string | null, cantidad: number) => {
      const cur = map.get(producto);
      if (cur) {
        cur.cantidad += cantidad;
        if (!cur.categoria && categoria) cur.categoria = categoria;
      } else {
        map.set(producto, { producto, categoria, cantidad });
      }
    };

    if (opts.source === "fudo") {
      const conds = [eq(fudoProductos.clientId, clientId)];
      if (opts.dateFrom) conds.push(gte(fudoProductos.fecha, opts.dateFrom));
      if (opts.dateTo) conds.push(lte(fudoProductos.fecha, opts.dateTo));
      if (opts.localIds && opts.localIds.length > 0) conds.push(inArray(fudoProductos.localId, opts.localIds));
      const rows = await db.select({ producto: fudoProductos.producto, categoria: fudoProductos.categoria, cantidad: fudoProductos.cantidad })
        .from(fudoProductos).where(and(...conds));
      for (const r of rows) add(r.producto, r.categoria ?? null, r.cantidad ?? 0);
    } else if (opts.source === "shares") {
      const conds = [eq(sharesProductos.clientId, clientId)];
      if (opts.dateFrom) conds.push(gte(sharesProductos.fecha, opts.dateFrom));
      if (opts.dateTo) conds.push(lte(sharesProductos.fecha, opts.dateTo));
      if (opts.localIds && opts.localIds.length > 0) conds.push(inArray(sharesProductos.localId, opts.localIds));
      const rows = await db.select({ producto: sharesProductos.producto, categoria: sharesProductos.categoria, cantidad: sharesProductos.cantidad })
        .from(sharesProductos).where(and(...conds));
      for (const r of rows) add(r.producto, r.categoria ?? null, r.cantidad ?? 0);
    } else {
      const conds = [eq(dataliveProductos.clientId, clientId)];
      if (opts.dateFrom) conds.push(gte(dataliveProductos.fechaDesde, opts.dateFrom));
      if (opts.dateTo) conds.push(lte(dataliveProductos.fechaHasta, opts.dateTo));
      if (opts.localIds && opts.localIds.length > 0) conds.push(inArray(dataliveProductos.localId, opts.localIds));
      const rows = await db.select({ producto: dataliveProductos.producto, cantidad: dataliveProductos.cantidad })
        .from(dataliveProductos).where(and(...conds));
      for (const r of rows) add(r.producto, null, r.cantidad ?? 0);
    }

    return Array.from(map.values()).sort((a, b) => b.cantidad - a.cantidad);
  }

  /**
   * CMV Productos (teórico): Σ (cantidad vendida × costo unitario), cruzado contra la venta.
   *
   * El costo es SIEMPRE neto (recipes.total_cost y el manual se cargan sin IVA). La venta se toma
   * bruta o neta según `ivaIncluded`, igual que el CMV por stock. La venta teórica usa el precio de
   * mostrador de la receta con el mismo criterio de IVA, para que las dos sean comparables.
   */
  async computeCmvProductos(
    clientId: number,
    opts: { localId?: number; source: "fudo" | "datalive" | "shares"; dateFrom?: string; dateTo?: string; ivaIncluded?: boolean },
  ) {
    const localIds = opts.localId != null ? [opts.localId] : undefined;
    const ivaIncluded = opts.ivaIncluded ?? false;

    const sold = await this.getSoldProductsByPeriod(clientId, {
      source: opts.source,
      dateFrom: opts.dateFrom,
      dateTo: opts.dateTo,
      localIds,
    });

    const costRows = await db.select().from(productCosts)
      .where(and(eq(productCosts.clientId, clientId), eq(productCosts.source, opts.source)));
    const costByName = new Map(costRows.map((c) => [c.productName, c]));

    // Fallback: el mapeo producto→receta del Dashboard ya existe en muchas empresas. Si un producto
    // no tiene fila propia en product_costs, se usa esa receta igual (sin obligar a re-mapear todo).
    const mappingRows = await db.select().from(productRecipeMappings)
      .where(and(eq(productRecipeMappings.clientId, clientId), eq(productRecipeMappings.source, opts.source)));
    const mappedRecipeByName = new Map(mappingRows.map((m) => [m.productName, m.recipeId]));

    const recipeRows = await db.select().from(recipes).where(eq(recipes.clientId, clientId));
    const recipeById = new Map(recipeRows.map((r) => [r.id, r]));

    const lines: Array<{
      producto: string;
      categoria: string | null;
      cantidad: number;
      costoUnitario: number | null;
      costoTotal: number;
      precioUnitario: number | null;
      ventaTeorica: number;
      costMode: "receta" | "manual" | null;
      recipeId: number | null;
      recipeName: string | null;
    }> = [];

    let unidades = 0;
    let unidadesConCosto = 0;
    let cmvTeorico = 0;
    let ventaTeorica = 0;

    for (const s of sold) {
      const cantidad = s.cantidad ?? 0;
      unidades += cantidad;

      const pc = costByName.get(s.producto);
      let costMode: "receta" | "manual" | null = null;
      const recipeId: number | null = pc?.recipeId ?? mappedRecipeByName.get(s.producto) ?? null;
      let costoUnitario: number | null = null;

      if (pc && pc.costMode === "manual" && pc.manualCost != null) {
        costoUnitario = parseFloat(String(pc.manualCost)) || 0;
        costMode = "manual";
      } else if (recipeId != null && recipeById.has(recipeId)) {
        costoUnitario = parseFloat(String(recipeById.get(recipeId)!.totalCost ?? 0)) || 0;
        costMode = "receta";
      }

      const recipe = recipeId != null ? recipeById.get(recipeId) ?? null : null;
      // Precio de mostrador (siempre con IVA) llevado a la misma base que la venta importada.
      const grossPrice = recipe ? recipeGrossPrice(recipe) : 0;
      const precioUnitario = recipe && grossPrice > 0 ? (ivaIncluded ? grossPrice : grossPrice / 1.21) : null;

      const costoTotal = costoUnitario != null ? costoUnitario * cantidad : 0;
      const ventaLinea = precioUnitario != null ? precioUnitario * cantidad : 0;

      if (costoUnitario != null) {
        unidadesConCosto += cantidad;
        cmvTeorico += costoTotal;
      }
      ventaTeorica += ventaLinea;

      lines.push({
        producto: s.producto,
        categoria: s.categoria,
        cantidad,
        costoUnitario,
        costoTotal,
        precioUnitario,
        ventaTeorica: ventaLinea,
        costMode,
        recipeId: recipeId ?? null,
        recipeName: recipe?.name ?? null,
      });
    }

    const salesGross =
      opts.source === "fudo" ? await this.getFudoSalesTotalByPeriod(clientId, { dateFrom: opts.dateFrom, dateTo: opts.dateTo, localIds })
      : opts.source === "shares" ? await this.getSharesSalesTotalByPeriod(clientId, { dateFrom: opts.dateFrom, dateTo: opts.dateTo, localIds })
      : await this.getDataliveSalesTotalByPeriod(clientId, { dateFrom: opts.dateFrom, dateTo: opts.dateTo, localIds });
    const ventaReal = ivaIncluded ? salesGross : salesGross / 1.21;

    return {
      source: opts.source,
      periodFrom: opts.dateFrom ?? null,
      periodTo: opts.dateTo ?? null,
      ivaIncluded,
      lines,
      unidades,
      unidadesConCosto,
      coberturaPct: unidades > 0 ? (unidadesConCosto / unidades) * 100 : null,
      cmvTeorico,
      salesGross,
      ventaReal,
      ventaTeorica,
      cmvPct: ventaReal > 0 ? (cmvTeorico / ventaReal) * 100 : null,
      cmvPctTeorico: ventaTeorica > 0 ? (cmvTeorico / ventaTeorica) * 100 : null,
    };
  }

  /** Guarda el cabezal + el detalle CONGELADO. Se recalcula server-side: no se confía en el cliente. */
  async saveCmvProductoCalculation(
    clientId: number,
    opts: { localId?: number; source: "fudo" | "datalive" | "shares"; dateFrom?: string; dateTo?: string; ivaIncluded?: boolean; createdBy?: string | null },
  ): Promise<CmvProductoCalculation> {
    const r = await this.computeCmvProductos(clientId, opts);
    const [created] = await db.insert(cmvProductoCalculations).values({
      clientId,
      localId: opts.localId ?? null,
      source: opts.source,
      periodFrom: opts.dateFrom ?? null,
      periodTo: opts.dateTo ?? null,
      unidades: r.unidades,
      unidadesConCosto: r.unidadesConCosto,
      coberturaPct: r.coberturaPct != null ? String(r.coberturaPct) : null,
      cmvTeorico: String(r.cmvTeorico),
      ventaReal: String(r.ventaReal),
      ventaTeorica: String(r.ventaTeorica),
      cmvPct: r.cmvPct != null ? String(r.cmvPct) : null,
      cmvPctTeorico: r.cmvPctTeorico != null ? String(r.cmvPctTeorico) : null,
      ivaIncluded: r.ivaIncluded,
      createdBy: opts.createdBy ?? null,
    } as any).returning();

    await this.replaceCmvProductoLines(created.id, r.lines);
    return created;
  }

  private async replaceCmvProductoLines(
    calculationId: number,
    lines: Array<{
      producto: string;
      categoria: string | null;
      cantidad: number;
      costoUnitario: number | null;
      costoTotal: number;
      precioUnitario: number | null;
      ventaTeorica: number;
      costMode: "receta" | "manual" | null;
      recipeId: number | null;
      recipeName: string | null;
    }>,
  ): Promise<void> {
    await db.delete(cmvProductoLines).where(eq(cmvProductoLines.calculationId, calculationId));
    if (lines.length === 0) return;
    const values = lines.map((l) => ({
      calculationId,
      producto: l.producto,
      categoria: l.categoria,
      cantidad: l.cantidad,
      costoUnitario: l.costoUnitario != null ? String(l.costoUnitario) : null,
      costoTotal: String(l.costoTotal),
      precioUnitario: l.precioUnitario != null ? String(l.precioUnitario) : null,
      ventaTeorica: String(l.ventaTeorica),
      costMode: l.costMode,
      recipeId: l.recipeId,
      recipeName: l.recipeName,
    }));
    // Se inserta de a tandas: un período largo puede traer cientos de productos.
    const CHUNK = 200;
    for (let i = 0; i < values.length; i += CHUNK) {
      await db.insert(cmvProductoLines).values(values.slice(i, i + CHUNK) as any);
    }
  }

  async listCmvProductoCalculations(clientId: number): Promise<CmvProductoCalculation[]> {
    return db.select().from(cmvProductoCalculations)
      .where(eq(cmvProductoCalculations.clientId, clientId))
      .orderBy(desc(cmvProductoCalculations.id));
  }

  async getCmvProductoLines(clientId: number, calculationId: number): Promise<CmvProductoLine[]> {
    const [head] = await db.select({ id: cmvProductoCalculations.id }).from(cmvProductoCalculations)
      .where(and(eq(cmvProductoCalculations.id, calculationId), eq(cmvProductoCalculations.clientId, clientId)));
    if (!head) throw new Error("CMV Productos no encontrado");
    return db.select().from(cmvProductoLines)
      .where(eq(cmvProductoLines.calculationId, calculationId))
      .orderBy(desc(cmvProductoLines.costoTotal));
  }

  async updateCmvProductoCalculation(
    clientId: number,
    id: number,
    opts: { localId?: number; source: "fudo" | "datalive" | "shares"; dateFrom?: string; dateTo?: string; ivaIncluded?: boolean },
  ): Promise<CmvProductoCalculation> {
    const [existing] = await db.select({ id: cmvProductoCalculations.id }).from(cmvProductoCalculations)
      .where(and(eq(cmvProductoCalculations.id, id), eq(cmvProductoCalculations.clientId, clientId)));
    if (!existing) throw new Error("CMV Productos no encontrado");

    const r = await this.computeCmvProductos(clientId, opts);
    const [updated] = await db.update(cmvProductoCalculations).set({
      localId: opts.localId ?? null,
      source: opts.source,
      periodFrom: opts.dateFrom ?? null,
      periodTo: opts.dateTo ?? null,
      unidades: r.unidades,
      unidadesConCosto: r.unidadesConCosto,
      coberturaPct: r.coberturaPct != null ? String(r.coberturaPct) : null,
      cmvTeorico: String(r.cmvTeorico),
      ventaReal: String(r.ventaReal),
      ventaTeorica: String(r.ventaTeorica),
      cmvPct: r.cmvPct != null ? String(r.cmvPct) : null,
      cmvPctTeorico: r.cmvPctTeorico != null ? String(r.cmvPctTeorico) : null,
      ivaIncluded: r.ivaIncluded,
    } as any).where(and(eq(cmvProductoCalculations.id, id), eq(cmvProductoCalculations.clientId, clientId))).returning();

    // Al reeditar se vuelve a congelar el detalle con los costos de HOY.
    await this.replaceCmvProductoLines(id, r.lines);
    return updated;
  }

  async deleteCmvProductoCalculation(clientId: number, id: number): Promise<void> {
    const [existing] = await db.select({ id: cmvProductoCalculations.id }).from(cmvProductoCalculations)
      .where(and(eq(cmvProductoCalculations.id, id), eq(cmvProductoCalculations.clientId, clientId)));
    if (!existing) throw new Error("CMV Productos no encontrado");
    await db.delete(cmvProductoLines).where(eq(cmvProductoLines.calculationId, id));
    await db.delete(cmvProductoCalculations)
      .where(and(eq(cmvProductoCalculations.id, id), eq(cmvProductoCalculations.clientId, clientId)));
  }

  async listDataliveVentas(clientId: number, localId?: number): Promise<DataliveVenta[]> {
    const conds = [eq(dataliveVentas.clientId, clientId)];
    if (localId != null) conds.push(eq(dataliveVentas.localId, localId));
    return db.select().from(dataliveVentas).where(and(...conds)).orderBy(desc(dataliveVentas.fecha));
  }

  async importDataliveVentas(
    clientId: number,
    localId: number,
    days: Array<{ fecha: string; ventaTotal: number; ventaEfectivo: number; ventaOnline: number }>,
    opts: { sourceFile?: string | null; createdBy?: string | null; replaceFechas?: string[] },
  ): Promise<{ insertados: number; omitidos: number; reemplazados: number }> {
    const replace = new Set(opts.replaceFechas ?? []);
    // Fechas ya existentes para (clientId, localId) → idempotencia por día.
    const existing = await db
      .select({ fecha: dataliveVentas.fecha })
      .from(dataliveVentas)
      .where(and(eq(dataliveVentas.clientId, clientId), eq(dataliveVentas.localId, localId)));
    const existingSet = new Set(existing.map((r) => String(r.fecha)));

    let insertados = 0;
    let omitidos = 0;
    let reemplazados = 0;

    for (const d of days) {
      const values = {
        clientId,
        localId,
        fecha: d.fecha,
        ventaTotal: String(d.ventaTotal),
        ventaEfectivo: String(d.ventaEfectivo),
        ventaOnline: String(d.ventaOnline),
        sourceFile: opts.sourceFile ?? null,
        createdBy: opts.createdBy ?? null,
      };
      if (existingSet.has(d.fecha)) {
        if (replace.has(d.fecha)) {
          await db
            .update(dataliveVentas)
            .set({
              ventaTotal: values.ventaTotal,
              ventaEfectivo: values.ventaEfectivo,
              ventaOnline: values.ventaOnline,
              sourceFile: values.sourceFile,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(dataliveVentas.clientId, clientId),
                eq(dataliveVentas.localId, localId),
                eq(dataliveVentas.fecha, d.fecha),
              ),
            );
          reemplazados++;
        } else {
          omitidos++;
        }
      } else {
        await db.insert(dataliveVentas).values(values as any);
        insertados++;
      }
    }
    return { insertados, omitidos, reemplazados };
  }

  async deleteDataliveVenta(clientId: number, id: number): Promise<boolean> {
    const deleted = await db
      .delete(dataliveVentas)
      .where(and(eq(dataliveVentas.clientId, clientId), eq(dataliveVentas.id, id)))
      .returning({ id: dataliveVentas.id });
    return deleted.length > 0;
  }

  async listFudoVentas(clientId: number, localId?: number): Promise<FudoVenta[]> {
    const conds = [eq(fudoVentas.clientId, clientId)];
    if (localId != null) conds.push(eq(fudoVentas.localId, localId));
    return db.select().from(fudoVentas).where(and(...conds)).orderBy(desc(fudoVentas.fecha));
  }

  async importFudoVentas(
    clientId: number,
    localId: number,
    days: Array<{ fecha: string; ventaTotal: number; ticketCount?: number } & FudoFiscalSplit>,
    opts: { sourceFile?: string | null; createdBy?: string | null; replaceFechas?: string[] },
  ): Promise<{ insertados: number; omitidos: number; reemplazados: number }> {
    const replace = new Set(opts.replaceFechas ?? []);
    const existing = await db
      .select({ fecha: fudoVentas.fecha })
      .from(fudoVentas)
      .where(and(eq(fudoVentas.clientId, clientId), eq(fudoVentas.localId, localId)));
    const existingSet = new Set(existing.map((r) => String(r.fecha)));

    let insertados = 0;
    let omitidos = 0;
    let reemplazados = 0;

    for (const d of days) {
      // Corte fiscal (col N). null se guarda como null a propósito: es "no se sabe", no es cero.
      const money = (v: number | null | undefined) => (v == null ? null : String(v));
      const fiscal = {
        ventaFiscalizada: money(d.ventaFiscalizada),
        ventaNoFiscalizada: money(d.ventaNoFiscalizada),
        ventaSinDatoFiscal: money(d.ventaSinDatoFiscal),
        ticketsFiscalizados: d.ticketsFiscalizados ?? null,
        ticketsNoFiscalizados: d.ticketsNoFiscalizados ?? null,
        ticketsSinDatoFiscal: d.ticketsSinDatoFiscal ?? null,
      };
      const values = {
        clientId,
        localId,
        fecha: d.fecha,
        ventaTotal: String(d.ventaTotal),
        ticketCount: d.ticketCount ?? 0,
        ...fiscal,
        sourceFile: opts.sourceFile ?? null,
        createdBy: opts.createdBy ?? null,
      };
      if (existingSet.has(d.fecha)) {
        if (replace.has(d.fecha)) {
          await db
            .update(fudoVentas)
            .set({ ventaTotal: values.ventaTotal, ticketCount: values.ticketCount, ...fiscal, sourceFile: values.sourceFile, updatedAt: new Date() })
            .where(and(eq(fudoVentas.clientId, clientId), eq(fudoVentas.localId, localId), eq(fudoVentas.fecha, d.fecha)));
          reemplazados++;
        } else {
          omitidos++;
        }
      } else {
        await db.insert(fudoVentas).values(values as any);
        insertados++;
      }
    }
    return { insertados, omitidos, reemplazados };
  }

  async importFudoPagos(
    clientId: number,
    localId: number,
    pagos: Array<{ fecha: string; medioPago: string; importe: number }>,
    opts: { sourceFile?: string | null; createdBy?: string | null; replaceFechas?: string[] },
  ): Promise<{ insertados: number; reemplazados: number }> {
    const replace = new Set(opts.replaceFechas ?? []);
    let insertados = 0;
    let reemplazados = 0;
    for (const p of pagos) {
      const values = {
        clientId,
        localId,
        fecha: p.fecha,
        medioPago: p.medioPago,
        importe: String(p.importe),
        sourceFile: opts.sourceFile ?? null,
        createdBy: opts.createdBy ?? null,
      };
      const existing = await db
        .select({ id: fudoPagos.id })
        .from(fudoPagos)
        .where(and(eq(fudoPagos.clientId, clientId), eq(fudoPagos.localId, localId), eq(fudoPagos.fecha, p.fecha), eq(fudoPagos.medioPago, p.medioPago)));
      if (existing.length > 0) {
        if (replace.has(p.fecha)) {
          await db.update(fudoPagos).set({ importe: values.importe, sourceFile: values.sourceFile }).where(eq(fudoPagos.id, existing[0].id));
          reemplazados++;
        }
      } else {
        await db.insert(fudoPagos).values(values as any);
        insertados++;
      }
    }
    return { insertados, reemplazados };
  }

  async deleteFudoVenta(clientId: number, id: number): Promise<boolean> {
    // Obtener localId y fecha antes de borrar para poder limpiar los productos del día.
    const [venta] = await db
      .select({ localId: fudoVentas.localId, fecha: fudoVentas.fecha })
      .from(fudoVentas)
      .where(and(eq(fudoVentas.clientId, clientId), eq(fudoVentas.id, id)));
    if (!venta) return false;

    await db.delete(fudoVentas).where(and(eq(fudoVentas.clientId, clientId), eq(fudoVentas.id, id)));

    // Borrar productos del mismo día y local (cascade manual).
    await db.delete(fudoProductos).where(
      and(eq(fudoProductos.clientId, clientId), eq(fudoProductos.localId, venta.localId), eq(fudoProductos.fecha, venta.fecha)),
    );
    return true;
  }

  async deleteFudoProductosByFecha(clientId: number, localId: number, fecha: string): Promise<number> {
    const deleted = await db.delete(fudoProductos).where(
      and(eq(fudoProductos.clientId, clientId), eq(fudoProductos.localId, localId), eq(fudoProductos.fecha, fecha)),
    ).returning({ id: fudoProductos.id });
    return deleted.length;
  }

  async listFudoProductos(clientId: number, opts?: { localId?: number; fechaDesde?: string; fechaHasta?: string }): Promise<FudoProducto[]> {
    const conds: any[] = [eq(fudoProductos.clientId, clientId)];
    if (opts?.localId != null) conds.push(eq(fudoProductos.localId, opts.localId));
    if (opts?.fechaDesde) conds.push(gte(fudoProductos.fecha, opts.fechaDesde));
    if (opts?.fechaHasta) conds.push(lte(fudoProductos.fecha, opts.fechaHasta));
    return db.select().from(fudoProductos).where(and(...conds)).orderBy(desc(fudoProductos.fecha), asc(fudoProductos.producto));
  }

  async importFudoProductos(
    clientId: number,
    localId: number,
    items: Array<{ fecha: string; producto: string; categoria: string; cantidad: number }>,
    opts: { sourceFile?: string | null; createdBy?: string | null; replaceFechas?: string[] },
  ): Promise<{ insertados: number; omitidos: number; reemplazados: number }> {
    const replace = new Set(opts.replaceFechas ?? []);

    // Para cada fecha marcada como "Reemplazar": borrar TODOS los productos de ese día
    // antes de insertar los nuevos (así se limpian productos que ya no están en el Excel).
    const fechasExistentes = await db
      .select({ fecha: fudoProductos.fecha })
      .from(fudoProductos)
      .where(and(eq(fudoProductos.clientId, clientId), eq(fudoProductos.localId, localId)));
    const existingFechasSet = new Set(fechasExistentes.map((r) => String(r.fecha)));

    for (const fecha of replace) {
      if (existingFechasSet.has(fecha)) {
        await db.delete(fudoProductos).where(
          and(eq(fudoProductos.clientId, clientId), eq(fudoProductos.localId, localId), eq(fudoProductos.fecha, fecha)),
        );
      }
    }

    // Ahora insertar todos los items. Los de fechas reemplazadas ya no tienen conflicto;
    // los de fechas nuevas se insertan directamente; los de fechas ya cargadas sin replace se omiten.
    const remaining = await db
      .select({ fecha: fudoProductos.fecha, producto: fudoProductos.producto })
      .from(fudoProductos)
      .where(and(eq(fudoProductos.clientId, clientId), eq(fudoProductos.localId, localId)));
    const remainingSet = new Set(remaining.map((r) => `${r.fecha}||${r.producto}`));

    let insertados = 0;
    let omitidos = 0;
    let reemplazados = 0;

    for (const item of items) {
      const key = `${item.fecha}||${item.producto}`;
      const values = {
        clientId,
        localId,
        fecha: item.fecha,
        producto: item.producto,
        categoria: item.categoria || null,
        cantidad: item.cantidad,
        sourceFile: opts.sourceFile ?? null,
        createdBy: opts.createdBy ?? null,
      };
      if (remainingSet.has(key)) {
        omitidos++;
      } else {
        await db.insert(fudoProductos).values(values as any);
        if (replace.has(item.fecha) && existingFechasSet.has(item.fecha)) {
          reemplazados++;
        } else {
          insertados++;
        }
      }
    }
    return { insertados, omitidos, reemplazados };
  }

  // ==========================================
  // SHARES (ventas + productos) — espejo de Fudo, tercer origen de ventas.
  // ==========================================
  async listSharesVentas(clientId: number, localId?: number): Promise<SharesVenta[]> {
    const conds = [eq(sharesVentas.clientId, clientId)];
    if (localId != null) conds.push(eq(sharesVentas.localId, localId));
    return db.select().from(sharesVentas).where(and(...conds)).orderBy(desc(sharesVentas.fecha));
  }

  async importSharesVentas(
    clientId: number,
    localId: number,
    days: Array<{
      fecha: string;
      ventaTotal: number;
      ventaEfectivo: number;
      ventaTarjeta: number;
      ventaEfectivoOnline: number;
      ventaOperOnline: number;
      ventaMercadopago: number;
    }>,
    opts: { sourceFile?: string | null; createdBy?: string | null; replaceFechas?: string[] },
  ): Promise<{ insertados: number; omitidos: number; reemplazados: number }> {
    const replace = new Set(opts.replaceFechas ?? []);
    const existing = await db
      .select({ fecha: sharesVentas.fecha })
      .from(sharesVentas)
      .where(and(eq(sharesVentas.clientId, clientId), eq(sharesVentas.localId, localId)));
    const existingSet = new Set(existing.map((r) => String(r.fecha)));

    let insertados = 0;
    let omitidos = 0;
    let reemplazados = 0;

    for (const d of days) {
      const values = {
        clientId,
        localId,
        fecha: d.fecha,
        ventaTotal: String(d.ventaTotal),
        ventaEfectivo: String(d.ventaEfectivo),
        ventaTarjeta: String(d.ventaTarjeta),
        ventaEfectivoOnline: String(d.ventaEfectivoOnline),
        ventaOperOnline: String(d.ventaOperOnline),
        ventaMercadopago: String(d.ventaMercadopago),
        sourceFile: opts.sourceFile ?? null,
        createdBy: opts.createdBy ?? null,
      };
      if (existingSet.has(d.fecha)) {
        if (replace.has(d.fecha)) {
          await db
            .update(sharesVentas)
            .set({
              ventaTotal: values.ventaTotal,
              ventaEfectivo: values.ventaEfectivo,
              ventaTarjeta: values.ventaTarjeta,
              ventaEfectivoOnline: values.ventaEfectivoOnline,
              ventaOperOnline: values.ventaOperOnline,
              ventaMercadopago: values.ventaMercadopago,
              sourceFile: values.sourceFile,
              updatedAt: new Date(),
            })
            .where(and(eq(sharesVentas.clientId, clientId), eq(sharesVentas.localId, localId), eq(sharesVentas.fecha, d.fecha)));
          reemplazados++;
        } else {
          omitidos++;
        }
      } else {
        await db.insert(sharesVentas).values(values as any);
        insertados++;
      }
    }
    return { insertados, omitidos, reemplazados };
  }

  async deleteSharesVenta(clientId: number, id: number): Promise<boolean> {
    const [venta] = await db
      .select({ localId: sharesVentas.localId, fecha: sharesVentas.fecha })
      .from(sharesVentas)
      .where(and(eq(sharesVentas.clientId, clientId), eq(sharesVentas.id, id)));
    if (!venta) return false;
    await db.delete(sharesVentas).where(and(eq(sharesVentas.clientId, clientId), eq(sharesVentas.id, id)));
    await db.delete(sharesProductos).where(
      and(eq(sharesProductos.clientId, clientId), eq(sharesProductos.localId, venta.localId), eq(sharesProductos.fecha, venta.fecha)),
    );
    return true;
  }

  async deleteSharesProductosByFecha(clientId: number, localId: number, fecha: string): Promise<number> {
    const deleted = await db.delete(sharesProductos).where(
      and(eq(sharesProductos.clientId, clientId), eq(sharesProductos.localId, localId), eq(sharesProductos.fecha, fecha)),
    ).returning({ id: sharesProductos.id });
    return deleted.length;
  }

  async listSharesProductos(clientId: number, opts?: { localId?: number; fechaDesde?: string; fechaHasta?: string }): Promise<SharesProducto[]> {
    const conds: any[] = [eq(sharesProductos.clientId, clientId)];
    if (opts?.localId != null) conds.push(eq(sharesProductos.localId, opts.localId));
    if (opts?.fechaDesde) conds.push(gte(sharesProductos.fecha, opts.fechaDesde));
    if (opts?.fechaHasta) conds.push(lte(sharesProductos.fecha, opts.fechaHasta));
    return db.select().from(sharesProductos).where(and(...conds)).orderBy(desc(sharesProductos.fecha), asc(sharesProductos.producto));
  }

  async importSharesProductos(
    clientId: number,
    localId: number,
    items: Array<{ fecha: string; producto: string; categoria: string; cantidad: number }>,
    opts: { sourceFile?: string | null; createdBy?: string | null; replaceFechas?: string[] },
  ): Promise<{ insertados: number; omitidos: number; reemplazados: number }> {
    const replace = new Set(opts.replaceFechas ?? []);

    const fechasExistentes = await db
      .select({ fecha: sharesProductos.fecha })
      .from(sharesProductos)
      .where(and(eq(sharesProductos.clientId, clientId), eq(sharesProductos.localId, localId)));
    const existingFechasSet = new Set(fechasExistentes.map((r) => String(r.fecha)));

    for (const fecha of replace) {
      if (existingFechasSet.has(fecha)) {
        await db.delete(sharesProductos).where(
          and(eq(sharesProductos.clientId, clientId), eq(sharesProductos.localId, localId), eq(sharesProductos.fecha, fecha)),
        );
      }
    }

    const remaining = await db
      .select({ fecha: sharesProductos.fecha, producto: sharesProductos.producto })
      .from(sharesProductos)
      .where(and(eq(sharesProductos.clientId, clientId), eq(sharesProductos.localId, localId)));
    const remainingSet = new Set(remaining.map((r) => `${r.fecha}||${r.producto}`));

    let insertados = 0;
    let omitidos = 0;
    let reemplazados = 0;

    for (const item of items) {
      const key = `${item.fecha}||${item.producto}`;
      const values = {
        clientId,
        localId,
        fecha: item.fecha,
        producto: item.producto,
        categoria: item.categoria || null,
        cantidad: item.cantidad,
        sourceFile: opts.sourceFile ?? null,
        createdBy: opts.createdBy ?? null,
      };
      if (remainingSet.has(key)) {
        omitidos++;
      } else {
        await db.insert(sharesProductos).values(values as any);
        if (replace.has(item.fecha) && existingFechasSet.has(item.fecha)) {
          reemplazados++;
        } else {
          insertados++;
        }
      }
    }
    return { insertados, omitidos, reemplazados };
  }

  async listDataliveProductos(clientId: number, opts?: { localId?: number; fechaDesde?: string; fechaHasta?: string }): Promise<DataliveProducto[]> {
    const conds: any[] = [eq(dataliveProductos.clientId, clientId)];
    if (opts?.localId != null) conds.push(eq(dataliveProductos.localId, opts.localId));
    if (opts?.fechaDesde) conds.push(gte(dataliveProductos.fechaDesde, opts.fechaDesde));
    if (opts?.fechaHasta) conds.push(lte(dataliveProductos.fechaHasta, opts.fechaHasta));
    return db.select().from(dataliveProductos).where(and(...conds)).orderBy(desc(dataliveProductos.fechaDesde), asc(dataliveProductos.producto));
  }

  async importDataliveProductos(
    clientId: number,
    localId: number,
    fechaDesde: string,
    fechaHasta: string,
    items: Array<{ producto: string; cantidad: number }>,
    opts: { sourceFile?: string | null; createdBy?: string | null; replace?: boolean },
  ): Promise<{ insertados: number; omitidos: number; reemplazados: number }> {
    const existing = await db
      .select({ producto: dataliveProductos.producto })
      .from(dataliveProductos)
      .where(and(
        eq(dataliveProductos.clientId, clientId),
        eq(dataliveProductos.localId, localId),
        eq(dataliveProductos.fechaDesde, fechaDesde),
        eq(dataliveProductos.fechaHasta, fechaHasta),
      ));
    const existingSet = new Set(existing.map((r) => r.producto));

    if (opts.replace && existingSet.size > 0) {
      await db.delete(dataliveProductos).where(
        and(
          eq(dataliveProductos.clientId, clientId),
          eq(dataliveProductos.localId, localId),
          eq(dataliveProductos.fechaDesde, fechaDesde),
          eq(dataliveProductos.fechaHasta, fechaHasta),
        ),
      );
    }

    let insertados = 0;
    let omitidos = 0;
    let reemplazados = 0;

    for (const item of items) {
      const values = {
        clientId,
        localId,
        fechaDesde,
        fechaHasta,
        producto: item.producto,
        cantidad: item.cantidad,
        sourceFile: opts.sourceFile ?? null,
        createdBy: opts.createdBy ?? null,
      };
      if (existingSet.has(item.producto) && !opts.replace) {
        omitidos++;
      } else if (existingSet.has(item.producto) && opts.replace) {
        await db.insert(dataliveProductos).values(values as any);
        reemplazados++;
      } else {
        await db.insert(dataliveProductos).values(values as any);
        insertados++;
      }
    }
    return { insertados, omitidos, reemplazados };
  }

  async deleteDataliveProductosByPeriodo(clientId: number, localId: number, fechaDesde: string, fechaHasta: string): Promise<number> {
    const deleted = await db.delete(dataliveProductos).where(
      and(
        eq(dataliveProductos.clientId, clientId),
        eq(dataliveProductos.localId, localId),
        eq(dataliveProductos.fechaDesde, fechaDesde),
        eq(dataliveProductos.fechaHasta, fechaHasta),
      ),
    ).returning({ id: dataliveProductos.id });
    return deleted.length;
  }

  // ── Decomisos ──
  async listDecomisos(clientId: number, opts?: { localId?: number; fechaDesde?: string; fechaHasta?: string; tipo?: string }): Promise<Decomiso[]> {
    const conds: any[] = [eq(decomisos.clientId, clientId)];
    if (opts?.localId != null) conds.push(eq(decomisos.localId, opts.localId));
    if (opts?.fechaDesde) conds.push(gte(decomisos.fecha, opts.fechaDesde));
    if (opts?.fechaHasta) conds.push(lte(decomisos.fecha, opts.fechaHasta));
    if (opts?.tipo) conds.push(eq(decomisos.tipoDecomiso, opts.tipo));
    return db.select().from(decomisos).where(and(...conds)).orderBy(desc(decomisos.fecha), asc(decomisos.descripcionOriginal));
  }

  async getDecomisoProductMappings(clientId: number): Promise<DecomisoProductMapping[]> {
    return db.select().from(decomisoProductMappings).where(eq(decomisoProductMappings.clientId, clientId));
  }

  async getDecomisoLocalMappings(clientId: number): Promise<DecomisoLocalMapping[]> {
    return db.select().from(decomisoLocalMappings).where(eq(decomisoLocalMappings.clientId, clientId));
  }

  async importDecomisos(
    clientId: number,
    items: Array<{
      codDecomiso: string;
      codProducto: string;
      fecha: string;
      descripcion: string;
      sucursal: string;
      tipoDecomiso: string;
      cantidad: number;
      localId: number;
      supplyId: number | null;
    }>,
    opts: { sourceFile?: string | null; createdBy?: string | null },
  ): Promise<{ insertados: number; omitidos: number }> {
    // Idempotencia por (clientId, codDecomiso): omitimos los ya cargados.
    const existing = await db
      .select({ codDecomiso: decomisos.codDecomiso })
      .from(decomisos)
      .where(eq(decomisos.clientId, clientId));
    const existingSet = new Set(existing.map((r) => r.codDecomiso));

    // Costo unitario de cada insumo (para valorizar). unitCost, fallback lastCost.
    const supplyRows = await db
      .select({ id: supplies.id, unitCost: supplies.unitCost, lastCost: supplies.lastCost })
      .from(supplies)
      .where(eq(supplies.clientId, clientId));
    const costBySupply = new Map<number, number>();
    for (const s of supplyRows) {
      const uc = parseFloat(String(s.unitCost ?? 0)) || 0;
      const lc = parseFloat(String(s.lastCost ?? 0)) || 0;
      costBySupply.set(s.id, uc > 0 ? uc : lc);
    }

    let insertados = 0;
    let omitidos = 0;

    // Todo-o-nada: si falla una inserción se revierte la importación completa.
    // Como es idempotente por codDecomiso, reintentar completa sin duplicar.
    await db.transaction(async (tx) => {
      for (const item of items) {
        if (item.codDecomiso && existingSet.has(item.codDecomiso)) {
          omitidos++;
          continue;
        }
        const unitCost = item.supplyId != null ? (costBySupply.get(item.supplyId) ?? 0) : 0;
        const valorizado = Math.round(unitCost * item.cantidad * 100) / 100;
        await tx.insert(decomisos).values({
          clientId,
          localId: item.localId,
          supplyId: item.supplyId ?? null,
          fecha: item.fecha,
          codDecomiso: item.codDecomiso || null,
          codProducto: item.codProducto || null,
          descripcionOriginal: item.descripcion,
          sucursalOriginal: item.sucursal || null,
          tipoDecomiso: item.tipoDecomiso || null,
          cantidad: String(item.cantidad),
          unitCost: String(unitCost),
          valorizado: String(valorizado),
          sourceFile: opts.sourceFile ?? null,
          createdBy: opts.createdBy ?? null,
        } as any);
        if (item.codDecomiso) existingSet.add(item.codDecomiso);
        insertados++;
      }
    });
    return { insertados, omitidos };
  }

  async saveDecomisoLocalMappings(clientId: number, maps: Array<{ sucursalOriginal: string; localId: number }>): Promise<void> {
    for (const m of maps) {
      if (!m.sucursalOriginal) continue;
      const [existing] = await db
        .select({ id: decomisoLocalMappings.id })
        .from(decomisoLocalMappings)
        .where(and(eq(decomisoLocalMappings.clientId, clientId), eq(decomisoLocalMappings.sucursalOriginal, m.sucursalOriginal)));
      if (existing) {
        await db
          .update(decomisoLocalMappings)
          .set({ localId: m.localId, updatedAt: new Date() })
          .where(eq(decomisoLocalMappings.id, existing.id));
      } else {
        await db.insert(decomisoLocalMappings).values({ clientId, sucursalOriginal: m.sucursalOriginal, localId: m.localId } as any);
      }
    }
  }

  async saveDecomisoProductMappings(clientId: number, maps: Array<{ codProducto: string; descripcionOriginal?: string | null; supplyId: number }>): Promise<void> {
    for (const m of maps) {
      if (!m.codProducto) continue;
      const [existing] = await db
        .select({ id: decomisoProductMappings.id })
        .from(decomisoProductMappings)
        .where(and(eq(decomisoProductMappings.clientId, clientId), eq(decomisoProductMappings.codProducto, m.codProducto)));
      if (existing) {
        await db
          .update(decomisoProductMappings)
          .set({ supplyId: m.supplyId, descripcionOriginal: m.descripcionOriginal ?? null, updatedAt: new Date() })
          .where(eq(decomisoProductMappings.id, existing.id));
      } else {
        await db.insert(decomisoProductMappings).values({ clientId, codProducto: m.codProducto, descripcionOriginal: m.descripcionOriginal ?? null, supplyId: m.supplyId } as any);
      }
    }
  }

  async deleteDecomiso(clientId: number, id: number): Promise<boolean> {
    const deleted = await db
      .delete(decomisos)
      .where(and(eq(decomisos.clientId, clientId), eq(decomisos.id, id)))
      .returning({ id: decomisos.id });
    return deleted.length > 0;
  }

  async deleteDecomisosBySource(clientId: number, sourceFile: string): Promise<number> {
    const deleted = await db
      .delete(decomisos)
      .where(and(eq(decomisos.clientId, clientId), eq(decomisos.sourceFile, sourceFile)))
      .returning({ id: decomisos.id });
    return deleted.length;
  }

  async getPermissions(): Promise<Permission[]> {
    return db.select().from(permissions).orderBy(permissions.module, permissions.name);
  }

  async createPermission(permission: InsertPermission): Promise<Permission> {
    const [newPermission] = await db.insert(permissions).values(permission).returning();
    return newPermission;
  }

  async getRolePermissions(clientId: number, role?: string): Promise<RolePermission[]> {
    if (role) {
      return db.select().from(rolePermissions)
        .where(and(eq(rolePermissions.clientId, clientId), eq(rolePermissions.role, role)));
    }
    return db.select().from(rolePermissions).where(eq(rolePermissions.clientId, clientId));
  }

  async setRolePermission(rolePermission: InsertRolePermission): Promise<RolePermission> {
    const [result] = await db
      .insert(rolePermissions)
      .values(rolePermission)
      .onConflictDoUpdate({
        target: [rolePermissions.clientId, rolePermissions.role, rolePermissions.permissionId],
        set: {
          canView: rolePermission.canView,
          canCreate: rolePermission.canCreate,
          canEdit: rolePermission.canEdit,
          canDelete: rolePermission.canDelete,
        },
      })
      .returning();
    return result;
  }

  async deleteRolePermission(clientId: number, role: string, permissionId: number): Promise<boolean> {
    const result = await db.delete(rolePermissions)
      .where(and(
        eq(rolePermissions.clientId, clientId),
        eq(rolePermissions.role, role),
        eq(rolePermissions.permissionId, permissionId)
      ));
    return (result.rowCount ?? 0) > 0;
  }

  async getEffectivePermission(
    clientId: number,
    role: string,
    code: string,
    action: "view" | "create" | "edit" | "delete",
  ): Promise<boolean> {
    const normalizedRole = String(role ?? "").trim().toLowerCase();
    // Override de dueño: el socio siempre tiene acceso completo.
    if (normalizedRole === "socio") return true;
    if (!normalizedRole) return false;

    // Join permissions <-> role_permissions para ubicar el flag del code/role/cliente.
    const [row] = await db
      .select({
        canView: rolePermissions.canView,
        canCreate: rolePermissions.canCreate,
        canEdit: rolePermissions.canEdit,
        canDelete: rolePermissions.canDelete,
      })
      .from(rolePermissions)
      .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
      .where(and(
        eq(rolePermissions.clientId, clientId),
        eq(rolePermissions.role, normalizedRole),
        eq(permissions.code, code),
      ));

    if (!row) return false;
    switch (action) {
      case "view": return !!row.canView;
      case "create": return !!row.canCreate;
      case "edit": return !!row.canEdit;
      case "delete": return !!row.canDelete;
      default: return false;
    }
  }

  async getUserLocalAssignments(clientId: number, userId?: string): Promise<UserLocalAssignment[]> {
    if (userId) {
      return db.select().from(userLocalAssignments)
        .where(and(eq(userLocalAssignments.clientId, clientId), eq(userLocalAssignments.userId, userId)));
    }
    return db.select().from(userLocalAssignments).where(eq(userLocalAssignments.clientId, clientId));
  }

  async createUserLocalAssignment(assignment: InsertUserLocalAssignment): Promise<UserLocalAssignment> {
    const [newAssignment] = await db.insert(userLocalAssignments).values(assignment).returning();
    return newAssignment;
  }

  async updateUserLocalAssignment(id: number, assignment: Partial<InsertUserLocalAssignment>): Promise<UserLocalAssignment | undefined> {
    const [updated] = await db.update(userLocalAssignments).set(assignment).where(eq(userLocalAssignments.id, id)).returning();
    return updated;
  }

  async deleteUserLocalAssignment(id: number): Promise<boolean> {
    const result = await db.delete(userLocalAssignments).where(eq(userLocalAssignments.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  async getNotifications(clientId: number, userId?: string): Promise<Notification[]> {
    if (userId) {
      return db.select().from(notifications)
        .where(and(eq(notifications.clientId, clientId), eq(notifications.userId, userId)))
        .orderBy(desc(notifications.createdAt));
    }
    return db.select().from(notifications).where(eq(notifications.clientId, clientId)).orderBy(desc(notifications.createdAt));
  }

  async createNotification(notification: InsertNotification): Promise<Notification> {
    const [newNotification] = await db.insert(notifications).values(notification).returning();
    return newNotification;
  }

  async markNotificationRead(id: number): Promise<Notification | undefined> {
    const [updated] = await db.update(notifications)
      .set({ read: true, readAt: new Date() })
      .where(eq(notifications.id, id))
      .returning();
    return updated;
  }

  async getStockLevels(clientId: number, localId?: number): Promise<StockLevel[]> {
    if (localId) {
      return db.select().from(stockLevels)
        .where(and(eq(stockLevels.clientId, clientId), eq(stockLevels.localId, localId)));
    }
    return db.select().from(stockLevels).where(eq(stockLevels.clientId, clientId));
  }

  async getStockLevel(clientId: number, localId: number, supplyId: number): Promise<StockLevel | undefined> {
    const [level] = await db.select().from(stockLevels)
      .where(and(
        eq(stockLevels.clientId, clientId),
        eq(stockLevels.localId, localId),
        eq(stockLevels.supplyId, supplyId)
      ));
    return level;
  }

  async upsertStockLevel(stockLevel: InsertStockLevel): Promise<StockLevel> {
    const [result] = await db
      .insert(stockLevels)
      .values(stockLevel)
      .onConflictDoUpdate({
        target: [stockLevels.localId, stockLevels.supplyId],
        set: {
          theoreticalStock: stockLevel.theoreticalStock,
          actualStock: stockLevel.actualStock,
          minimumStock: stockLevel.minimumStock,
          maximumStock: stockLevel.maximumStock,
          lastCountDate: stockLevel.lastCountDate,
          updatedAt: new Date(),
        },
      })
      .returning();
    return result;
  }

  async getStockMovements(clientId: number, localId?: number): Promise<StockMovement[]> {
    if (localId) {
      return db.select().from(stockMovements)
        .where(and(eq(stockMovements.clientId, clientId), eq(stockMovements.localId, localId)))
        .orderBy(desc(stockMovements.createdAt));
    }
    return db.select().from(stockMovements).where(eq(stockMovements.clientId, clientId)).orderBy(desc(stockMovements.createdAt));
  }

  async createStockMovement(movement: InsertStockMovement): Promise<StockMovement> {
    const [newMovement] = await db.insert(stockMovements).values(movement).returning();
    return newMovement;
  }

  async getStockAdjustments(clientId: number, localId?: number): Promise<StockAdjustment[]> {
    if (localId) {
      return db.select().from(stockAdjustments)
        .where(and(eq(stockAdjustments.clientId, clientId), eq(stockAdjustments.localId, localId)))
        .orderBy(desc(stockAdjustments.createdAt));
    }
    return db.select().from(stockAdjustments).where(eq(stockAdjustments.clientId, clientId)).orderBy(desc(stockAdjustments.createdAt));
  }

  async createStockAdjustment(adjustment: InsertStockAdjustment): Promise<StockAdjustment> {
    const [newAdjustment] = await db.insert(stockAdjustments).values(adjustment).returning();
    return newAdjustment;
  }

  async getAuditTemplates(clientId: number): Promise<AuditTemplate[]> {
    return db.select().from(auditTemplates).where(eq(auditTemplates.clientId, clientId)).orderBy(auditTemplates.name);
  }

  async getAuditTemplate(clientId: number, id: number): Promise<AuditTemplate | undefined> {
    const [template] = await db.select().from(auditTemplates)
      .where(and(eq(auditTemplates.id, id), eq(auditTemplates.clientId, clientId)));
    return template;
  }

  async createAuditTemplate(template: InsertAuditTemplate): Promise<AuditTemplate> {
    const [newTemplate] = await db.insert(auditTemplates).values(template).returning();
    return newTemplate;
  }

  async updateAuditTemplate(clientId: number, id: number, template: Partial<InsertAuditTemplate>): Promise<AuditTemplate | undefined> {
    const [updated] = await db.update(auditTemplates)
      .set(template)
      .where(and(eq(auditTemplates.id, id), eq(auditTemplates.clientId, clientId)))
      .returning();
    return updated;
  }

  async deleteAuditTemplate(clientId: number, id: number): Promise<boolean> {
    const result = await db.delete(auditTemplates)
      .where(and(eq(auditTemplates.id, id), eq(auditTemplates.clientId, clientId)));
    return (result.rowCount ?? 0) > 0;
  }

  async getAuditTemplateItems(templateId: number): Promise<AuditTemplateItem[]> {
    return db.select().from(auditTemplateItems)
      .where(eq(auditTemplateItems.templateId, templateId))
      .orderBy(auditTemplateItems.order);
  }

  async createAuditTemplateItem(item: InsertAuditTemplateItem): Promise<AuditTemplateItem> {
    const [newItem] = await db.insert(auditTemplateItems).values(item).returning();
    return newItem;
  }

  async deleteAuditTemplateItem(id: number): Promise<boolean> {
    const result = await db.delete(auditTemplateItems).where(eq(auditTemplateItems.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  async getOperationalAudits(clientId: number, localId?: number): Promise<OperationalAudit[]> {
    if (localId) {
      return db.select().from(operationalAudits)
        .where(and(eq(operationalAudits.clientId, clientId), eq(operationalAudits.localId, localId)))
        .orderBy(desc(operationalAudits.auditDate));
    }
    return db.select().from(operationalAudits).where(eq(operationalAudits.clientId, clientId)).orderBy(desc(operationalAudits.auditDate));
  }

  async getOperationalAudit(clientId: number, id: number): Promise<OperationalAudit | undefined> {
    const [audit] = await db.select().from(operationalAudits)
      .where(and(eq(operationalAudits.id, id), eq(operationalAudits.clientId, clientId)));
    return audit;
  }

  async createOperationalAudit(audit: InsertOperationalAudit): Promise<OperationalAudit> {
    const [newAudit] = await db.insert(operationalAudits).values(audit).returning();
    return newAudit;
  }

  async updateOperationalAudit(clientId: number, id: number, audit: Partial<InsertOperationalAudit>): Promise<OperationalAudit | undefined> {
    const [updated] = await db.update(operationalAudits)
      .set(audit)
      .where(and(eq(operationalAudits.id, id), eq(operationalAudits.clientId, clientId)))
      .returning();
    return updated;
  }

  async getAuditResults(auditId: number): Promise<AuditResult[]> {
    return db.select().from(auditResults).where(eq(auditResults.auditId, auditId));
  }

  async createAuditResult(result: InsertAuditResult): Promise<AuditResult> {
    const [newResult] = await db.insert(auditResults).values(result).returning();
    return newResult;
  }

  async updateAuditResult(id: number, result: Partial<InsertAuditResult>): Promise<AuditResult | undefined> {
    const [updated] = await db.update(auditResults).set(result).where(eq(auditResults.id, id)).returning();
    return updated;
  }

  async getEmployees(clientId: number, localId?: number): Promise<Employee[]> {
    if (localId) {
      return db.select().from(employees)
        .where(and(eq(employees.clientId, clientId), eq(employees.localId, localId)))
        .orderBy(employees.lastName, employees.firstName);
    }
    return db.select().from(employees).where(eq(employees.clientId, clientId)).orderBy(employees.lastName, employees.firstName);
  }

  async getEmployee(clientId: number, id: number): Promise<Employee | undefined> {
    const [employee] = await db.select().from(employees)
      .where(and(eq(employees.id, id), eq(employees.clientId, clientId)));
    return employee;
  }

  async createEmployee(employee: InsertEmployee): Promise<Employee> {
    const [newEmployee] = await db.insert(employees).values(employee).returning();
    return newEmployee;
  }

  async updateEmployee(clientId: number, id: number, employee: Partial<InsertEmployee>): Promise<Employee | undefined> {
    const [updated] = await db.update(employees)
      .set({ ...employee, updatedAt: new Date() })
      .where(and(eq(employees.id, id), eq(employees.clientId, clientId)))
      .returning();
    return updated;
  }

  async deleteEmployee(clientId: number, id: number): Promise<boolean> {
    const result = await db.delete(employees)
      .where(and(eq(employees.id, id), eq(employees.clientId, clientId)));
    return (result.rowCount ?? 0) > 0;
  }

  async getAttendances(clientId: number, employeeId?: number, date?: string): Promise<Attendance[]> {
    const conditions = [eq(attendances.clientId, clientId)];
    if (employeeId) {
      conditions.push(eq(attendances.employeeId, employeeId));
    }
    if (date) {
      conditions.push(eq(attendances.date, date));
    }
    return db.select().from(attendances)
      .where(and(...conditions))
      .orderBy(desc(attendances.date));
  }

  async createAttendance(attendance: InsertAttendance): Promise<Attendance> {
    const [newAttendance] = await db.insert(attendances).values(attendance).returning();
    return newAttendance;
  }

  async updateAttendance(clientId: number, id: number, attendance: Partial<InsertAttendance>): Promise<Attendance | undefined> {
    const [updated] = await db.update(attendances)
      .set(attendance)
      .where(and(eq(attendances.id, id), eq(attendances.clientId, clientId)))
      .returning();
    return updated;
  }

  async getPayrolls(clientId: number, employeeId?: number, period?: string): Promise<Payroll[]> {
    const conditions = [eq(payrolls.clientId, clientId)];
    if (employeeId) {
      conditions.push(eq(payrolls.employeeId, employeeId));
    }
    if (period) {
      conditions.push(eq(payrolls.period, period));
    }
    const whereClause = conditions.length === 1 ? conditions[0] : and(...conditions);
    return db.select().from(payrolls)
      .where(whereClause)
      .orderBy(desc(payrolls.period));
  }

  async createPayroll(payroll: InsertPayroll): Promise<Payroll> {
    const [newPayroll] = await db.insert(payrolls).values(payroll).returning();
    return newPayroll;
  }

  async updatePayroll(clientId: number, id: number, payroll: Partial<InsertPayroll>): Promise<Payroll | undefined> {
    const [updated] = await db.update(payrolls)
      .set(payroll)
      .where(and(eq(payrolls.id, id), eq(payrolls.clientId, clientId)))
      .returning();
    return updated;
  }

  async getClientUsers(clientId: number): Promise<Array<User & { role: string | null }>> {
    const results = await db
      .select({
        id: users.id,
        email: users.email,
        firstName: users.firstName,
        lastName: users.lastName,
        profileImageUrl: users.profileImageUrl,
        role: userClients.role,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      })
      .from(userClients)
      .innerJoin(users, eq(userClients.userId, users.id))
      .where(eq(userClients.clientId, clientId))
      .orderBy(users.firstName);
    return results.map(r => ({
      id: r.id,
      email: r.email,
      firstName: r.firstName,
      lastName: r.lastName,
      profileImageUrl: r.profileImageUrl,
      role: r.role,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  }

  async updateClientUserProfile(
    clientId: number,
    userId: string,
    data: { firstName?: string | null; lastName?: string | null; email?: string | null },
  ): Promise<User | undefined> {
    const role = await this.getUserRoleInClient(userId, clientId);
    if (role === null) return undefined;

    if (data.email !== undefined && data.email !== null && String(data.email).trim() !== "") {
      const normalized = String(data.email).toLowerCase().trim();
      const other = await this.getUserByEmail(normalized);
      if (other && other.id !== userId) {
        throw new Error("EMAIL_CONFLICT");
      }
    }

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (data.firstName !== undefined) patch.firstName = data.firstName;
    if (data.lastName !== undefined) patch.lastName = data.lastName;
    if (data.email !== undefined) {
      patch.email =
        data.email === null || String(data.email).trim() === ""
          ? null
          : String(data.email).toLowerCase().trim();
    }

    const [updated] = await db.update(users).set(patch).where(eq(users.id, userId)).returning();
    return updated;
  }

  async reassignUserToClient(userId: string, newClientId: number, role: string = "encargado"): Promise<boolean> {
    await db.delete(userClients).where(eq(userClients.userId, userId));
    await db.insert(userClients).values({
      userId,
      clientId: newClientId,
      role,
    });
    return true;
  }

  async addUserToClient(userId: string, clientId: number, role: string): Promise<void> {
    const [existing] = await db
      .select()
      .from(userClients)
      .where(and(eq(userClients.userId, userId), eq(userClients.clientId, clientId)));
    if (existing) {
      await db
        .update(userClients)
        .set({ role })
        .where(and(eq(userClients.userId, userId), eq(userClients.clientId, clientId)));
      return;
    }
    await db.insert(userClients).values({ userId, clientId, role });
  }

  async setUserRoleInClient(clientId: number, userId: string, role: string): Promise<boolean> {
    const r = await db
      .update(userClients)
      .set({ role })
      .where(and(eq(userClients.clientId, clientId), eq(userClients.userId, userId)));
    return (r.rowCount ?? 0) > 0;
  }

  async removeUserFromClient(clientId: number, userId: string): Promise<boolean> {
    const r = await db
      .delete(userClients)
      .where(and(eq(userClients.clientId, clientId), eq(userClients.userId, userId)));
    return (r.rowCount ?? 0) > 0;
  }

  async countClientsForUser(userId: string): Promise<number> {
    const rows = await db
      .select({ n: sql<number>`count(*)` })
      .from(userClients)
      .where(eq(userClients.userId, userId));
    return Number(rows[0]?.n ?? 0);
  }

  async getUserCredentialsFlags(userId: string): Promise<{ mustChangePassword: boolean } | null> {
    const [c] = await db
      .select({ mustChangePassword: userCredentials.mustChangePassword })
      .from(userCredentials)
      .where(eq(userCredentials.userId, userId));
    if (!c) return null;
    return { mustChangePassword: Boolean(c.mustChangePassword) };
  }

  async setUserPasswordHash(userId: string, passwordHash: string, mustChangePassword: boolean): Promise<void> {
    await db
      .update(userCredentials)
      .set({
        passwordHash,
        mustChangePassword,
        passwordResetToken: null,
        passwordResetExpires: null,
        failedAttempts: 0,
        lockedUntil: null,
      })
      .where(eq(userCredentials.userId, userId));
  }

  async getClientInvitations(clientId: number): Promise<ClientInvitation[]> {
    return db.select().from(clientInvitations)
      .where(eq(clientInvitations.clientId, clientId))
      .orderBy(desc(clientInvitations.createdAt));
  }

  async getInvitationByCode(inviteCode: string): Promise<ClientInvitation | undefined> {
    const [invitation] = await db.select().from(clientInvitations)
      .where(eq(clientInvitations.inviteCode, inviteCode));
    return invitation;
  }

  async createInvitation(invitation: InsertClientInvitation): Promise<ClientInvitation> {
    const [newInvitation] = await db.insert(clientInvitations).values(invitation).returning();
    return newInvitation;
  }

  async useInvitation(inviteCode: string, userId: string): Promise<boolean> {
    const invitation = await this.getInvitationByCode(inviteCode);
    if (!invitation || invitation.status !== "pending") {
      return false;
    }
    if (invitation.expiresAt && new Date(invitation.expiresAt) < new Date()) {
      return false;
    }
    if (invitation.email?.trim()) {
      const invEmail = invitation.email.trim().toLowerCase();
      const u = await this.getUser(userId);
      if (!u?.email || u.email.trim().toLowerCase() !== invEmail) {
        return false;
      }
    }
    await this.addUserToClient(userId, invitation.clientId, invitation.role ?? "encargado");
    await db.update(clientInvitations)
      .set({
        status: "used",
        usedBy: userId,
        usedAt: new Date(),
      })
      .where(eq(clientInvitations.inviteCode, inviteCode));
    return true;
  }

  async deleteInvitation(clientId: number, id: number): Promise<boolean> {
    const result = await db.delete(clientInvitations)
      .where(and(eq(clientInvitations.id, id), eq(clientInvitations.clientId, clientId)));
    return (result.rowCount ?? 0) > 0;
  }

  async getLocalAliases(clientId: number): Promise<LocalAlias[]> {
    return db.select().from(localAliases)
      .where(eq(localAliases.clientId, clientId))
      .orderBy(localAliases.alias);
  }

  async getLocalAliasByName(clientId: number, alias: string): Promise<LocalAlias | undefined> {
    const [found] = await db.select().from(localAliases)
      .where(and(
        eq(localAliases.clientId, clientId),
        eq(localAliases.alias, alias)
      ));
    return found;
  }

  async createLocalAlias(alias: InsertLocalAlias): Promise<LocalAlias> {
    const [newAlias] = await db.insert(localAliases).values(alias).returning();
    return newAlias;
  }

  async deleteLocalAlias(clientId: number, id: number): Promise<boolean> {
    const result = await db.delete(localAliases)
      .where(and(eq(localAliases.id, id), eq(localAliases.clientId, clientId)));
    return (result.rowCount ?? 0) > 0;
  }

  async getSupplySuppliers(clientId: number): Promise<SupplySupplier[]> {
    return db.select().from(supplySuppliers).where(eq(supplySuppliers.clientId, clientId));
  }

  async getSupplySuppliersBySupply(clientId: number, supplyId: number): Promise<SupplySupplier[]> {
    return db.select().from(supplySuppliers).where(
      and(eq(supplySuppliers.clientId, clientId), eq(supplySuppliers.supplyId, supplyId))
    );
  }

  async setSupplySuppliers(clientId: number, supplyId: number, supplierIds: number[]): Promise<void> {
    await db.delete(supplySuppliers).where(
      and(eq(supplySuppliers.clientId, clientId), eq(supplySuppliers.supplyId, supplyId))
    );
    if (supplierIds.length > 0) {
      await db.insert(supplySuppliers).values(
        supplierIds.map(supplierId => ({ supplyId, supplierId, clientId }))
      );
    }
  }

  async getSupplierRubros(clientId: number): Promise<SupplierRubro[]> {
    return db.select().from(supplierRubros).where(eq(supplierRubros.clientId, clientId));
  }

  async getSupplierRubrosBySupplier(clientId: number, supplierId: number): Promise<SupplierRubro[]> {
    return db.select().from(supplierRubros).where(
      and(eq(supplierRubros.clientId, clientId), eq(supplierRubros.supplierId, supplierId))
    );
  }

  async setSupplierRubros(clientId: number, supplierId: number, rubroIds: number[]): Promise<void> {
    await db.delete(supplierRubros).where(
      and(eq(supplierRubros.clientId, clientId), eq(supplierRubros.supplierId, supplierId))
    );
    if (rubroIds.length > 0) {
      await db.insert(supplierRubros).values(
        rubroIds.map(rubroId => ({ supplierId, rubroId, clientId }))
      );
    }
  }

  // ==========================================
  // MERCHANDISE TRANSFERS (Traslados de Mercadería)
  // ==========================================

  async getMerchandiseTransfers(clientId: number): Promise<(MerchandiseTransfer & { fromLocal?: any; toLocal?: any; items?: MerchandiseTransferItem[] })[]> {
    const rows = await db.select().from(merchandiseTransfers)
      .where(eq(merchandiseTransfers.clientId, clientId))
      .orderBy(desc(merchandiseTransfers.transferDate));

    const localRows = await db.select().from(locals).where(eq(locals.clientId, clientId));
    const localMap = new Map(localRows.map((l) => [l.id, l]));

    const result = [];
    for (const row of rows) {
      const items = await db.select().from(merchandiseTransferItems)
        .where(eq(merchandiseTransferItems.transferId, row.id));
      result.push({
        ...row,
        fromLocal: localMap.get(row.fromLocalId),
        toLocal: localMap.get(row.toLocalId),
        items,
      });
    }
    return result;
  }

  async getMerchandiseTransfer(clientId: number, id: number): Promise<(MerchandiseTransfer & { items: MerchandiseTransferItem[] }) | null> {
    const [row] = await db.select().from(merchandiseTransfers)
      .where(and(eq(merchandiseTransfers.id, id), eq(merchandiseTransfers.clientId, clientId)));
    if (!row) return null;
    const items = await db.select().from(merchandiseTransferItems)
      .where(eq(merchandiseTransferItems.transferId, id));
    return { ...row, items };
  }

  async createMerchandiseTransfer(
    transfer: InsertMerchandiseTransfer,
    items: InsertMerchandiseTransferItem[],
  ): Promise<MerchandiseTransfer & { items: MerchandiseTransferItem[] }> {
    const totalValue = items.reduce((acc, it) => acc + (parseFloat(String(it.lineTotal)) || 0), 0);
    const [newTransfer] = await db.insert(merchandiseTransfers)
      .values({ ...transfer, totalValue: String(totalValue) })
      .returning();
    const insertedItems: MerchandiseTransferItem[] = [];
    for (const item of items) {
      const [ins] = await db.insert(merchandiseTransferItems)
        .values({ ...item, transferId: newTransfer.id })
        .returning();
      insertedItems.push(ins);
    }
    return { ...newTransfer, items: insertedItems };
  }

  async reverseMerchandiseTransfer(clientId: number, id: number): Promise<boolean> {
    // libSQL/Turso no expone rowCount en UPDATE; usar returning() para verificar si se afectó alguna fila
    const rows = await db.update(merchandiseTransfers)
      .set({ status: "reversed" })
      .where(and(eq(merchandiseTransfers.id, id), eq(merchandiseTransfers.clientId, clientId)))
      .returning({ id: merchandiseTransfers.id });
    return rows.length > 0;
  }

  /** Net transfer value for a local in a period: received − sent (positive = net inflow). */
  async getTransferAdjustment(
    clientId: number,
    localId: number,
    dateFrom?: string,
    dateTo?: string,
  ): Promise<number> {
    const baseConds = [
      eq(merchandiseTransfers.clientId, clientId),
      eq(merchandiseTransfers.status, "active"),
    ];
    if (dateFrom) baseConds.push(sql`${merchandiseTransfers.transferDate} >= ${dateFrom}`);
    if (dateTo) baseConds.push(sql`${merchandiseTransfers.transferDate} <= ${dateTo}`);

    const received = await db.select({ totalValue: merchandiseTransfers.totalValue })
      .from(merchandiseTransfers)
      .where(and(...baseConds, eq(merchandiseTransfers.toLocalId, localId)));

    const sent = await db.select({ totalValue: merchandiseTransfers.totalValue })
      .from(merchandiseTransfers)
      .where(and(...baseConds, eq(merchandiseTransfers.fromLocalId, localId)));

    const sumReceived = received.reduce((acc, r) => acc + (parseFloat(String(r.totalValue)) || 0), 0);
    const sumSent = sent.reduce((acc, r) => acc + (parseFloat(String(r.totalValue)) || 0), 0);

    return sumReceived - sumSent;
  }

  // ==========================================
  // MONTHLY GOALS
  // ==========================================

  async getMonthlyGoals(clientId: number, year: number, month: number) {
    return db
      .select()
      .from(monthlyGoals)
      .where(and(eq(monthlyGoals.clientId, clientId), eq(monthlyGoals.year, year), eq(monthlyGoals.month, month)));
  }

  async listAllMonthlyGoals(clientId: number) {
    return db.select().from(monthlyGoals).where(eq(monthlyGoals.clientId, clientId));
  }

  async upsertMonthlyGoal(clientId: number, data: {
    localId: number; year: number; month: number;
    facturacionObjetivo?: number | null; ticketsObjetivo?: number | null; cmvObjetivo?: number | null;
  }) {
    const existing = await db
      .select()
      .from(monthlyGoals)
      .where(and(eq(monthlyGoals.clientId, clientId), eq(monthlyGoals.localId, data.localId), eq(monthlyGoals.year, data.year), eq(monthlyGoals.month, data.month)));
    const vals = {
      clientId,
      localId: data.localId,
      year: data.year,
      month: data.month,
      facturacionObjetivo: data.facturacionObjetivo != null ? String(data.facturacionObjetivo) : null,
      ticketsObjetivo: data.ticketsObjetivo ?? null,
      cmvObjetivo: data.cmvObjetivo != null ? String(data.cmvObjetivo) : null,
      updatedAt: new Date(),
    };
    if (existing.length > 0) {
      const [updated] = await db.update(monthlyGoals).set(vals).where(eq(monthlyGoals.id, existing[0].id)).returning();
      return updated;
    }
    const [inserted] = await db.insert(monthlyGoals).values(vals as any).returning();
    return inserted;
  }

  async deleteMonthlyGoal(clientId: number, localId: number, year: number, month: number) {
    await db.delete(monthlyGoals).where(
      and(eq(monthlyGoals.clientId, clientId), eq(monthlyGoals.localId, localId), eq(monthlyGoals.year, year), eq(monthlyGoals.month, month)),
    );
  }

  // ==========================================
  // DASHBOARD AGGREGATIONS
  // ==========================================

  async getDashboardVentasSummary(clientId: number, year: number, month: number, localIds: number[], source: "fudo" | "datalive" | "shares") {
    const pad = (n: number) => String(n).padStart(2, "0");
    const makeRange = (y: number, m: number) => {
      const from = `${y}-${pad(m)}-01`;
      const lastDay = new Date(y, m, 0).getDate();
      const to = `${y}-${pad(m)}-${pad(lastDay)}`;
      return { from, to };
    };

    const sumMonth = async (y: number, m: number) => {
      const { from, to } = makeRange(y, m);
      if (source === "fudo") {
        const conds = [eq(fudoVentas.clientId, clientId), gte(fudoVentas.fecha, from), lte(fudoVentas.fecha, to)];
        if (localIds.length > 0) conds.push(inArray(fudoVentas.localId, localIds));
        const rows = await db.select({ vt: fudoVentas.ventaTotal, tc: fudoVentas.ticketCount }).from(fudoVentas).where(and(...conds));
        return {
          ventaTotal: rows.reduce((s, r) => s + (parseFloat(String(r.vt)) || 0), 0),
          ticketCount: rows.reduce((s, r) => s + (r.tc ?? 0), 0),
        };
      } else if (source === "shares") {
        const conds = [eq(sharesVentas.clientId, clientId), gte(sharesVentas.fecha, from), lte(sharesVentas.fecha, to)];
        if (localIds.length > 0) conds.push(inArray(sharesVentas.localId, localIds));
        const rows = await db.select({ vt: sharesVentas.ventaTotal }).from(sharesVentas).where(and(...conds));
        return { ventaTotal: rows.reduce((s, r) => s + (parseFloat(String(r.vt)) || 0), 0), ticketCount: null };
      } else {
        const conds = [eq(dataliveVentas.clientId, clientId), gte(dataliveVentas.fecha, from), lte(dataliveVentas.fecha, to)];
        if (localIds.length > 0) conds.push(inArray(dataliveVentas.localId, localIds));
        const rows = await db.select({ vt: dataliveVentas.ventaTotal }).from(dataliveVentas).where(and(...conds));
        return { ventaTotal: rows.reduce((s, r) => s + (parseFloat(String(r.vt)) || 0), 0), ticketCount: null };
      }
    };

    const prevM = month === 1 ? { y: year - 1, m: 12 } : { y: year, m: month - 1 };
    const prev2M = prevM.m === 1 ? { y: prevM.y - 1, m: 12 } : { y: prevM.y, m: prevM.m - 1 };

    const [current, prev, prev2] = await Promise.all([
      sumMonth(year, month),
      sumMonth(prevM.y, prevM.m),
      sumMonth(prev2M.y, prev2M.m),
    ]);

    const pctVsPrev = prev.ventaTotal > 0 ? ((current.ventaTotal - prev.ventaTotal) / prev.ventaTotal) * 100 : null;
    const pctVsPrev2 = prev2.ventaTotal > 0 ? ((current.ventaTotal - prev2.ventaTotal) / prev2.ventaTotal) * 100 : null;

    return { current, prev, prev2, pctVsPrev, pctVsPrev2 };
  }

  async getDashboardSaldos(clientId: number, year: number, month: number) {
    const lastDay = new Date(year, month, 0).getDate();
    const toDate = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

    const allAccounts = await db
      .select({ id: bankAccounts.id, name: bankAccounts.name })
      .from(bankAccounts)
      .where(eq(bankAccounts.clientId, clientId));

    // Movimientos divididos entre locales: el original queda asentado pero no computa (sus partes,
    // que viven en la misma cuenta, ya suman lo mismo). Sin esto el saldo de la cuenta se duplicaría.
    const parentIdsOf = (rows: Array<{ parentTransactionId: number | null }>) =>
      new Set(rows.filter((r) => r.parentTransactionId != null).map((r) => r.parentTransactionId as number));

    const result = [];
    for (const acc of allAccounts) {
      const rows = await db
        .select({
          id: transactions.id,
          amount: transactions.amount,
          type: transactions.type,
          date: transactions.transactionDate,
          parentTransactionId: transactions.parentTransactionId,
        })
        .from(transactions)
        .where(and(eq(transactions.clientId, clientId), eq(transactions.bankAccountId, acc.id), lte(transactions.transactionDate, toDate)));
      const splitParents = parentIdsOf(rows);
      let saldo = 0;
      let lastDate: string | null = null;
      for (const r of rows) {
        if (splitParents.has(r.id)) continue;
        const amt = parseFloat(String(r.amount)) || 0;
        saldo += r.type === "income" ? amt : -amt;
        if (!lastDate || String(r.date) > lastDate) lastDate = String(r.date);
      }
      result.push({ accountId: acc.id, accountName: acc.name, saldo, lastMovementDate: lastDate });
    }

    // El efectivo se guarda sin bankAccountId, así que el loop de cuentas nunca lo alcanza
    // (bankAccountId = X no matchea NULL) y quedaba fuera del saldo. Va como fila propia.
    // accountId negativo: sintético y estable, no colisiona con los serial de bankAccounts.
    const cashRows = await db
      .select({
        id: transactions.id,
        amount: transactions.amount,
        type: transactions.type,
        date: transactions.transactionDate,
        parentTransactionId: transactions.parentTransactionId,
      })
      .from(transactions)
      .where(and(
        eq(transactions.clientId, clientId),
        eq(transactions.bankSource, "cash"),
        lte(transactions.transactionDate, toDate),
      ));
    if (cashRows.length > 0) {
      const splitParentsCash = parentIdsOf(cashRows);
      let saldo = 0;
      let lastDate: string | null = null;
      for (const r of cashRows) {
        if (splitParentsCash.has(r.id)) continue;
        const amt = parseFloat(String(r.amount)) || 0;
        saldo += r.type === "income" ? amt : -amt;
        if (!lastDate || String(r.date) > lastDate) lastDate = String(r.date);
      }
      result.push({ accountId: -1, accountName: "Efectivo", saldo, lastMovementDate: lastDate, isCash: true });
    }

    return result;
  }

  async getDashboardDeudasProveedores(clientId: number) {
    const allInvoices = await db
      .select({ id: invoices.id, supplierId: invoices.supplierId, totalAmount: invoices.totalAmount })
      .from(invoices)
      .where(and(eq(invoices.clientId, clientId)));

    const allAllocations = await db
      .select({ invoiceId: paymentAllocations.invoiceId, amount: paymentAllocations.amount })
      .from(paymentAllocations)
      .where(eq(paymentAllocations.clientId, clientId));

    const paidByInvoice = new Map<number, number>();
    for (const a of allAllocations) {
      paidByInvoice.set(a.invoiceId, (paidByInvoice.get(a.invoiceId) ?? 0) + (parseFloat(String(a.amount)) || 0));
    }

    const allSuppliers = await db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).where(eq(suppliers.clientId, clientId));
    const supplierMap = new Map(allSuppliers.map((s) => [s.id, s.name]));

    const debtBySupplier = new Map<number, number>();
    for (const inv of allInvoices) {
      const total = parseFloat(String(inv.totalAmount)) || 0;
      const paid = paidByInvoice.get(inv.id) ?? 0;
      const debt = total - paid;
      if (debt > 0) {
        debtBySupplier.set(inv.supplierId, (debtBySupplier.get(inv.supplierId) ?? 0) + debt);
      }
    }

    return Array.from(debtBySupplier.entries())
      .map(([supplierId, deuda]) => ({ supplierId, supplierName: supplierMap.get(supplierId) ?? "Desconocido", deuda }))
      .sort((a, b) => b.deuda - a.deuda);
  }

  async getDashboardVentasSemanales(clientId: number, weekStart: string, localIds: number[], source: "fudo" | "datalive" | "shares") {
    const startDate = new Date(weekStart + "T00:00:00Z");
    const prevStartDate = new Date(startDate);
    prevStartDate.setUTCDate(prevStartDate.getUTCDate() - 7);

    const toIso = (d: Date) => d.toISOString().slice(0, 10);
    const addDays = (d: Date, n: number) => { const r = new Date(d); r.setUTCDate(r.getUTCDate() + n); return r; };

    const fetchWeek = async (start: Date) => {
      const days: { date: string; ventaTotal: number }[] = [];
      for (let i = 0; i < 7; i++) {
        const d = toIso(addDays(start, i));
        if (source === "fudo") {
          const conds = [eq(fudoVentas.clientId, clientId), eq(fudoVentas.fecha, d)];
          if (localIds.length > 0) conds.push(inArray(fudoVentas.localId, localIds));
          const rows = await db.select({ vt: fudoVentas.ventaTotal }).from(fudoVentas).where(and(...conds));
          days.push({ date: d, ventaTotal: rows.reduce((s, r) => s + (parseFloat(String(r.vt)) || 0), 0) });
        } else if (source === "shares") {
          const conds = [eq(sharesVentas.clientId, clientId), eq(sharesVentas.fecha, d)];
          if (localIds.length > 0) conds.push(inArray(sharesVentas.localId, localIds));
          const rows = await db.select({ vt: sharesVentas.ventaTotal }).from(sharesVentas).where(and(...conds));
          days.push({ date: d, ventaTotal: rows.reduce((s, r) => s + (parseFloat(String(r.vt)) || 0), 0) });
        } else {
          const conds = [eq(dataliveVentas.clientId, clientId), eq(dataliveVentas.fecha, d)];
          if (localIds.length > 0) conds.push(inArray(dataliveVentas.localId, localIds));
          const rows = await db.select({ vt: dataliveVentas.ventaTotal }).from(dataliveVentas).where(and(...conds));
          days.push({ date: d, ventaTotal: rows.reduce((s, r) => s + (parseFloat(String(r.vt)) || 0), 0) });
        }
      }
      return days;
    };

    const [current, previous] = await Promise.all([fetchWeek(startDate), fetchWeek(prevStartDate)]);
    return { current, previous, weekStart: toIso(startDate), prevWeekStart: toIso(prevStartDate) };
  }

  async getDashboardCmvPeriodo(clientId: number, dateFrom: string, dateTo: string, localIds: number[], weekStart?: string) {
    const conds = [eq(cmvCalculations.clientId, clientId), gte(cmvCalculations.periodFrom, dateFrom), lte(cmvCalculations.periodTo, dateTo)];
    if (localIds.length > 0) conds.push(inArray(cmvCalculations.localId, localIds));
    const rows = await db.select().from(cmvCalculations).where(and(...conds));
    const calcSummary = (rs: typeof rows) => {
      const totalVentas = rs.reduce((s, r) => s + (parseFloat(String(r.ventaNeta)) || 0), 0);
      const totalCosto = rs.reduce((s, r) => s + (parseFloat(String(r.cmv)) || 0), 0);
      const cmvPct = totalVentas > 0 ? (totalCosto / totalVentas) * 100 : 0;
      return { totalVentas, totalCosto, cmvPct };
    };
    if (weekStart) {
      const prevRows = rows.filter((r) => r.periodTo < weekStart);
      const currRows = rows.filter((r) => r.periodFrom >= weekStart);

      // Rango de fechas de cada semana (para decomisos).
      const addDays = (iso: string, n: number) => {
        const d = new Date(iso + "T00:00:00Z");
        d.setUTCDate(d.getUTCDate() + n);
        return d.toISOString().slice(0, 10);
      };
      const currFrom = weekStart, currTo = addDays(weekStart, 6);
      const prevFrom = addDays(weekStart, -7), prevTo = addDays(weekStart, -1);

      // CMV objetivo del mes del inicio de semana, por local (módulo Objetivos).
      const ws = new Date(weekStart + "T00:00:00Z");
      const goals = await db.select().from(monthlyGoals).where(and(
        eq(monthlyGoals.clientId, clientId),
        eq(monthlyGoals.year, ws.getUTCFullYear()),
        eq(monthlyGoals.month, ws.getUTCMonth() + 1),
      ));
      const objByLocal = new Map<number, number>();
      for (const g of goals) {
        const v = parseFloat(String(g.cmvObjetivo ?? ""));
        if (isFinite(v)) objByLocal.set(g.localId, v);
      }
      // Objetivo ponderado por facturación (ventaNeta) de cada local presente en la semana.
      const weightedObjetivo = (rs: typeof rows): number | null => {
        const ventaByLocal = new Map<number, number>();
        for (const r of rs) {
          if (r.localId == null) continue;
          ventaByLocal.set(r.localId, (ventaByLocal.get(r.localId) ?? 0) + (parseFloat(String(r.ventaNeta)) || 0));
        }
        let num = 0, den = 0;
        for (const [lid, venta] of ventaByLocal) {
          const obj = objByLocal.get(lid);
          if (obj != null && venta > 0) { num += obj * venta; den += venta; }
        }
        return den > 0 ? num / den : null;
      };

      const decomisosSum = async (from: string, to: string): Promise<number> => {
        const dConds: any[] = [eq(decomisos.clientId, clientId), gte(decomisos.fecha, from), lte(decomisos.fecha, to)];
        if (localIds.length > 0) dConds.push(inArray(decomisos.localId, localIds));
        const dRows = await db.select({ v: decomisos.valorizado }).from(decomisos).where(and(...dConds));
        return dRows.reduce((s, r) => s + (parseFloat(String(r.v ?? 0)) || 0), 0);
      };
      const [currDec, prevDec] = await Promise.all([decomisosSum(currFrom, currTo), decomisosSum(prevFrom, prevTo)]);

      return {
        current: { ...calcSummary(currRows), cmvObjetivo: weightedObjetivo(currRows), decomisos: currDec },
        previous: { ...calcSummary(prevRows), cmvObjetivo: weightedObjetivo(prevRows), decomisos: prevDec },
        rows,
      };
    }
    return { ...calcSummary(rows), rows };
  }

  async getDashboardTopProductos(clientId: number, dateFrom: string, dateTo: string, localIds: number[], source: "fudo" | "datalive" | "shares") {
    if (source === "fudo") {
      const conds = [eq(fudoProductos.clientId, clientId), gte(fudoProductos.fecha, dateFrom), lte(fudoProductos.fecha, dateTo)];
      if (localIds.length > 0) conds.push(inArray(fudoProductos.localId, localIds));
      const rows = await db.select({ producto: fudoProductos.producto, cantidad: fudoProductos.cantidad }).from(fudoProductos).where(and(...conds));
      const map = new Map<string, number>();
      for (const r of rows) map.set(r.producto, (map.get(r.producto) ?? 0) + (r.cantidad ?? 0));
      return Array.from(map.entries()).map(([producto, cantidad]) => ({ producto, cantidad })).sort((a, b) => b.cantidad - a.cantidad);
    } else if (source === "shares") {
      const conds = [eq(sharesProductos.clientId, clientId), gte(sharesProductos.fecha, dateFrom), lte(sharesProductos.fecha, dateTo)];
      if (localIds.length > 0) conds.push(inArray(sharesProductos.localId, localIds));
      const rows = await db.select({ producto: sharesProductos.producto, cantidad: sharesProductos.cantidad }).from(sharesProductos).where(and(...conds));
      const map = new Map<string, number>();
      for (const r of rows) map.set(r.producto, (map.get(r.producto) ?? 0) + (r.cantidad ?? 0));
      return Array.from(map.entries()).map(([producto, cantidad]) => ({ producto, cantidad })).sort((a, b) => b.cantidad - a.cantidad);
    } else {
      const conds = [eq(dataliveProductos.clientId, clientId), gte(dataliveProductos.fechaDesde, dateFrom), lte(dataliveProductos.fechaHasta, dateTo)];
      if (localIds.length > 0) conds.push(inArray(dataliveProductos.localId, localIds));
      const rows = await db.select({ producto: dataliveProductos.producto, cantidad: dataliveProductos.cantidad }).from(dataliveProductos).where(and(...conds));
      const map = new Map<string, number>();
      for (const r of rows) map.set(r.producto, (map.get(r.producto) ?? 0) + (r.cantidad ?? 0));
      return Array.from(map.entries()).map(([producto, cantidad]) => ({ producto, cantidad })).sort((a, b) => b.cantidad - a.cantidad);
    }
  }


  /**
   * Ventas Fiscalizadas del mes (solo FUDO — Datalive y Shares no traen el dato).
   *
   * Los tres importes cierran contra la venta total del período. `sinDato` junta dos cosas
   * distintas a propósito de mostrarlas separadas: los días importados antes de que se leyera la
   * columna N (`diasSinDato`) y las ventas sueltas cuya col N vino vacía dentro de un día que sí
   * tiene el corte. En los dos casos es "no se sabe", nunca "no fiscalizado".
   */
  async getDashboardVentasFiscalizadas(
    clientId: number,
    year: number,
    month: number,
    localIds: number[],
  ): Promise<{
    ventaTotal: number;
    fiscalizada: number;
    noFiscalizada: number;
    sinDato: number;
    ticketsFiscalizados: number;
    ticketsNoFiscalizados: number;
    ticketsSinDato: number;
    diasConDato: number;
    diasSinDato: number;
    ventaDiasSinDato: number;
  }> {
    const mm = String(month).padStart(2, "0");
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const from = `${year}-${mm}-01`;
    const to = `${year}-${mm}-${String(lastDay).padStart(2, "0")}`;

    const conds = [
      eq(fudoVentas.clientId, clientId),
      gte(fudoVentas.fecha, from),
      lte(fudoVentas.fecha, to),
    ];
    if (localIds.length > 0) conds.push(inArray(fudoVentas.localId, localIds));

    const rows = await db
      .select({
        ventaTotal: fudoVentas.ventaTotal,
        ventaFiscalizada: fudoVentas.ventaFiscalizada,
        ventaNoFiscalizada: fudoVentas.ventaNoFiscalizada,
        ventaSinDatoFiscal: fudoVentas.ventaSinDatoFiscal,
        ticketsFiscalizados: fudoVentas.ticketsFiscalizados,
        ticketsNoFiscalizados: fudoVentas.ticketsNoFiscalizados,
        ticketsSinDatoFiscal: fudoVentas.ticketsSinDatoFiscal,
      })
      .from(fudoVentas)
      .where(and(...conds));

    let ventaTotal = 0;
    let fiscalizada = 0;
    let noFiscalizada = 0;
    let sinDato = 0;
    let ticketsFiscalizados = 0;
    let ticketsNoFiscalizados = 0;
    let ticketsSinDato = 0;
    let diasConDato = 0;
    let diasSinDato = 0;
    let ventaDiasSinDato = 0;

    for (const r of rows) {
      const total = parseFloat(String(r.ventaTotal ?? 0)) || 0;
      ventaTotal += total;

      // El día tiene corte solo si se importó con la columna N leída.
      if (r.ventaFiscalizada == null) {
        diasSinDato++;
        ventaDiasSinDato += total;
        sinDato += total;
        continue;
      }

      diasConDato++;
      fiscalizada += parseFloat(String(r.ventaFiscalizada)) || 0;
      noFiscalizada += parseFloat(String(r.ventaNoFiscalizada ?? 0)) || 0;
      sinDato += parseFloat(String(r.ventaSinDatoFiscal ?? 0)) || 0;
      ticketsFiscalizados += r.ticketsFiscalizados ?? 0;
      ticketsNoFiscalizados += r.ticketsNoFiscalizados ?? 0;
      ticketsSinDato += r.ticketsSinDatoFiscal ?? 0;
    }

    const round2 = (n: number) => Math.round(n * 100) / 100;
    return {
      ventaTotal: round2(ventaTotal),
      fiscalizada: round2(fiscalizada),
      noFiscalizada: round2(noFiscalizada),
      sinDato: round2(sinDato),
      ticketsFiscalizados,
      ticketsNoFiscalizados,
      ticketsSinDato,
      diasConDato,
      diasSinDato,
      ventaDiasSinDato: round2(ventaDiasSinDato),
    };
  }

  async getDashboardTopCategorias(clientId: number, dateFrom: string, dateTo: string, localIds: number[], source: "fudo" | "datalive" | "shares") {
    if (source === "fudo") {
      const conds = [eq(fudoProductos.clientId, clientId), gte(fudoProductos.fecha, dateFrom), lte(fudoProductos.fecha, dateTo)];
      if (localIds.length > 0) conds.push(inArray(fudoProductos.localId, localIds));
      const rows = await db.select({ categoria: fudoProductos.categoria, cantidad: fudoProductos.cantidad }).from(fudoProductos).where(and(...conds));
      const map = new Map<string, number>();
      for (const r of rows) {
        const cat = r.categoria || "Sin categoría";
        map.set(cat, (map.get(cat) ?? 0) + (r.cantidad ?? 0));
      }
      return Array.from(map.entries()).map(([categoria, cantidad]) => ({ categoria, cantidad })).sort((a, b) => b.cantidad - a.cantidad);
    } else if (source === "shares") {
      const conds = [eq(sharesProductos.clientId, clientId), gte(sharesProductos.fecha, dateFrom), lte(sharesProductos.fecha, dateTo)];
      if (localIds.length > 0) conds.push(inArray(sharesProductos.localId, localIds));
      const rows = await db.select({ categoria: sharesProductos.categoria, cantidad: sharesProductos.cantidad }).from(sharesProductos).where(and(...conds));
      const map = new Map<string, number>();
      for (const r of rows) {
        const cat = r.categoria || "Sin categoría";
        map.set(cat, (map.get(cat) ?? 0) + (r.cantidad ?? 0));
      }
      return Array.from(map.entries()).map(([categoria, cantidad]) => ({ categoria, cantidad })).sort((a, b) => b.cantidad - a.cantidad);
    } else {
      // Datalive products don't have categories in current schema — return empty
      return [];
    }
  }

  async getDashboardComposicionPagos(clientId: number, year: number, month: number, localIds: number[], source: "fudo" | "datalive" | "shares") {
    const pad = (n: number) => String(n).padStart(2, "0");
    const from = `${year}-${pad(month)}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const to = `${year}-${pad(month)}-${pad(lastDay)}`;

    if (source === "fudo") {
      const conds = [eq(fudoPagos.clientId, clientId), gte(fudoPagos.fecha, from), lte(fudoPagos.fecha, to)];
      if (localIds.length > 0) conds.push(inArray(fudoPagos.localId, localIds));
      const rows = await db.select({ medioPago: fudoPagos.medioPago, importe: fudoPagos.importe }).from(fudoPagos).where(and(...conds));
      const map = new Map<string, number>();
      for (const r of rows) map.set(r.medioPago, (map.get(r.medioPago) ?? 0) + (parseFloat(String(r.importe)) || 0));
      const total = Array.from(map.values()).reduce((s, v) => s + v, 0);
      return Array.from(map.entries())
        .map(([medioPago, importe]) => ({ medioPago, importe, pct: total > 0 ? (importe / total) * 100 : 0 }))
        .sort((a, b) => b.importe - a.importe);
    } else if (source === "shares") {
      const conds = [eq(sharesVentas.clientId, clientId), gte(sharesVentas.fecha, from), lte(sharesVentas.fecha, to)];
      if (localIds.length > 0) conds.push(inArray(sharesVentas.localId, localIds));
      const rows = await db.select({
        ef: sharesVentas.ventaEfectivo,
        tj: sharesVentas.ventaTarjeta,
        efOn: sharesVentas.ventaEfectivoOnline,
        opOn: sharesVentas.ventaOperOnline,
        mp: sharesVentas.ventaMercadopago,
      }).from(sharesVentas).where(and(...conds));
      const sum = (k: "ef" | "tj" | "efOn" | "opOn" | "mp") => rows.reduce((s, r) => s + (parseFloat(String(r[k])) || 0), 0);
      const medios = [
        { medioPago: "Efectivo", importe: sum("ef") },
        { medioPago: "Tarjeta", importe: sum("tj") },
        { medioPago: "Efectivo Online", importe: sum("efOn") },
        { medioPago: "Operación Online", importe: sum("opOn") },
        { medioPago: "Mercado Pago", importe: sum("mp") },
      ];
      const total = medios.reduce((s, m) => s + m.importe, 0);
      return medios
        .map((m) => ({ ...m, pct: total > 0 ? (m.importe / total) * 100 : 0 }))
        .filter((x) => x.importe > 0)
        .sort((a, b) => b.importe - a.importe);
    } else {
      const conds = [eq(dataliveVentas.clientId, clientId), gte(dataliveVentas.fecha, from), lte(dataliveVentas.fecha, to)];
      if (localIds.length > 0) conds.push(inArray(dataliveVentas.localId, localIds));
      const rows = await db.select({ ef: dataliveVentas.ventaEfectivo, on: dataliveVentas.ventaOnline }).from(dataliveVentas).where(and(...conds));
      const efectivo = rows.reduce((s, r) => s + (parseFloat(String(r.ef)) || 0), 0);
      const online = rows.reduce((s, r) => s + (parseFloat(String(r.on)) || 0), 0);
      const total = efectivo + online;
      return [
        { medioPago: "Efectivo", importe: efectivo, pct: total > 0 ? (efectivo / total) * 100 : 0 },
        { medioPago: "Online / Tarjeta", importe: online, pct: total > 0 ? (online / total) * 100 : 0 },
      ].filter((x) => x.importe > 0);
    }
  }

  async getDashboardEvolucionMensual(clientId: number, year: number, localIds: number[], source: "fudo" | "datalive" | "shares") {
    const pad = (n: number) => String(n).padStart(2, "0");
    const months = Array.from({ length: 12 }, (_, i) => i + 1);
    const result = [];
    for (const month of months) {
      const from = `${year}-${pad(month)}-01`;
      const lastDay = new Date(year, month, 0).getDate();
      const to = `${year}-${pad(month)}-${pad(lastDay)}`;
      let ventaTotal = 0;
      if (source === "fudo") {
        const conds = [eq(fudoVentas.clientId, clientId), gte(fudoVentas.fecha, from), lte(fudoVentas.fecha, to)];
        if (localIds.length > 0) conds.push(inArray(fudoVentas.localId, localIds));
        const rows = await db.select({ vt: fudoVentas.ventaTotal }).from(fudoVentas).where(and(...conds));
        ventaTotal = rows.reduce((s, r) => s + (parseFloat(String(r.vt)) || 0), 0);
      } else if (source === "shares") {
        const conds = [eq(sharesVentas.clientId, clientId), gte(sharesVentas.fecha, from), lte(sharesVentas.fecha, to)];
        if (localIds.length > 0) conds.push(inArray(sharesVentas.localId, localIds));
        const rows = await db.select({ vt: sharesVentas.ventaTotal }).from(sharesVentas).where(and(...conds));
        ventaTotal = rows.reduce((s, r) => s + (parseFloat(String(r.vt)) || 0), 0);
      } else {
        const conds = [eq(dataliveVentas.clientId, clientId), gte(dataliveVentas.fecha, from), lte(dataliveVentas.fecha, to)];
        if (localIds.length > 0) conds.push(inArray(dataliveVentas.localId, localIds));
        const rows = await db.select({ vt: dataliveVentas.ventaTotal }).from(dataliveVentas).where(and(...conds));
        ventaTotal = rows.reduce((s, r) => s + (parseFloat(String(r.vt)) || 0), 0);
      }
      result.push({ month, ventaTotal });
    }
    return result;
  }

  async getDashboardTop3Balance(clientId: number, year: number, localId?: number) {
    const spreadsheet = await this.getBalanceSpreadsheet(clientId, year, localId);
    const monthNames = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

    const monthlyVentas: { month: string; value: number }[] = [];
    const monthlyGastos: { month: string; value: number }[] = [];
    const monthlyRentabilidad: { month: string; value: number }[] = [];

    for (let m = 1; m <= 12; m++) {
      let ingresos = 0;
      let egresos = 0;
      for (const group of spreadsheet.groups) {
        if (group.type === "income") {
          for (const cat of group.categories) {
            ingresos += parseFloat(String(cat.monthlyAmounts?.[m] ?? 0)) || 0;
          }
        } else if (group.type === "expense") {
          for (const cat of group.categories) {
            egresos += parseFloat(String(cat.monthlyAmounts?.[m] ?? 0)) || 0;
          }
        }
      }
      const label = monthNames[m - 1];
      if (ingresos > 0) monthlyVentas.push({ month: label, value: ingresos });
      if (egresos > 0) monthlyGastos.push({ month: label, value: egresos });
      if (ingresos > 0 || egresos > 0) monthlyRentabilidad.push({ month: label, value: ingresos - egresos });
    }

    return {
      topVentas: monthlyVentas.sort((a, b) => b.value - a.value).slice(0, 3),
      topGastos: monthlyGastos.sort((a, b) => b.value - a.value).slice(0, 3),
      topRentabilidad: monthlyRentabilidad.sort((a, b) => b.value - a.value).slice(0, 3),
    };
  }

  // ==========================================
  // MIS COMPROBANTES AFIP (punto 1, ago-26)
  // ==========================================

  /** Puntos de venta del cliente, con el nombre del local y de la sociedad ya resueltos. */
  async listAfipSalePoints(clientId: number): Promise<any[]> {
    const rows = await db
      .select({
        salePoint: afipSalePoints,
        local: locals,
        businessName: businessNames,
      })
      .from(afipSalePoints)
      .leftJoin(locals, eq(afipSalePoints.localId, locals.id))
      .leftJoin(businessNames, eq(afipSalePoints.businessNameId, businessNames.id))
      .where(eq(afipSalePoints.clientId, clientId))
      .orderBy(asc(afipSalePoints.businessNameId), asc(afipSalePoints.number));

    return rows.map((r) => ({
      ...r.salePoint,
      local: r.local ?? null,
      businessNameLabel: r.businessName?.name ?? null,
      businessNameCuit: r.businessName?.cuit ?? null,
    }));
  }

  async createAfipSalePoint(clientId: number, data: {
    businessNameId: number;
    number: number;
    fantasyName?: string | null;
    localId?: number | null;
    salesSystem?: string | null;
  }): Promise<AfipSalePoint> {
    await this.assertBusinessNameBelongsToClient(clientId, data.businessNameId);
    if (data.localId != null) await this.assertLocalBelongsToClient(clientId, data.localId);

    const [existing] = await db
      .select({ id: afipSalePoints.id })
      .from(afipSalePoints)
      .where(and(
        eq(afipSalePoints.clientId, clientId),
        eq(afipSalePoints.businessNameId, data.businessNameId),
        eq(afipSalePoints.number, data.number),
      ))
      .limit(1);
    if (existing) throw new Error("Esa sociedad ya tiene un punto de venta con ese número");

    const [created] = await db
      .insert(afipSalePoints)
      .values({
        clientId,
        businessNameId: data.businessNameId,
        number: data.number,
        fantasyName: data.fantasyName ?? null,
        localId: data.localId ?? null,
        salesSystem: data.salesSystem ?? "none",
      })
      .returning();
    return created;
  }

  async updateAfipSalePoint(clientId: number, id: number, data: {
    businessNameId?: number;
    number?: number;
    fantasyName?: string | null;
    localId?: number | null;
    salesSystem?: string | null;
    active?: boolean;
  }): Promise<AfipSalePoint> {
    const [current] = await db
      .select()
      .from(afipSalePoints)
      .where(and(eq(afipSalePoints.id, id), eq(afipSalePoints.clientId, clientId)))
      .limit(1);
    if (!current) throw new Error("Punto de venta no encontrado");

    const businessNameId = data.businessNameId ?? current.businessNameId;
    const number = data.number ?? current.number;
    if (data.businessNameId != null) await this.assertBusinessNameBelongsToClient(clientId, data.businessNameId);
    if (data.localId != null) await this.assertLocalBelongsToClient(clientId, data.localId);

    // El par (sociedad, numero) sigue siendo unico despues del cambio.
    const [clash] = await db
      .select({ id: afipSalePoints.id })
      .from(afipSalePoints)
      .where(and(
        eq(afipSalePoints.clientId, clientId),
        eq(afipSalePoints.businessNameId, businessNameId),
        eq(afipSalePoints.number, number),
      ))
      .limit(1);
    if (clash && clash.id !== id) throw new Error("Esa sociedad ya tiene un punto de venta con ese número");

    const [updated] = await db
      .update(afipSalePoints)
      .set({
        businessNameId,
        number,
        fantasyName: data.fantasyName !== undefined ? data.fantasyName : current.fantasyName,
        localId: data.localId !== undefined ? data.localId : current.localId,
        salesSystem: data.salesSystem ?? current.salesSystem,
        active: data.active ?? current.active,
        updatedAt: new Date(),
      })
      .where(and(eq(afipSalePoints.id, id), eq(afipSalePoints.clientId, clientId)))
      .returning();
    return updated;
  }

  async deleteAfipSalePoint(clientId: number, id: number): Promise<void> {
    const result = await db
      .delete(afipSalePoints)
      .where(and(eq(afipSalePoints.id, id), eq(afipSalePoints.clientId, clientId)));
    if (((result as any).rowCount ?? (result as any).rowsAffected ?? 0) === 0) throw new Error("Punto de venta no encontrado");
  }

  private async assertBusinessNameBelongsToClient(clientId: number, businessNameId: number): Promise<void> {
    const [row] = await db
      .select({ id: businessNames.id })
      .from(businessNames)
      .where(and(eq(businessNames.id, businessNameId), eq(businessNames.clientId, clientId)))
      .limit(1);
    if (!row) throw new Error("La sociedad no pertenece a esta empresa");
  }

  private async assertLocalBelongsToClient(clientId: number, localId: number): Promise<void> {
    const [row] = await db
      .select({ id: locals.id })
      .from(locals)
      .where(and(eq(locals.id, localId), eq(locals.clientId, clientId)))
      .limit(1);
    if (!row) throw new Error("El local no pertenece a esta empresa");
  }

  /** Sociedad cuyo CUIT coincide con el que declara el archivo de AFIP. */
  async findBusinessNameByCuit(clientId: number, cuit: string): Promise<BusinessName | null> {
    const digits = String(cuit ?? "").replace(/\D/g, "");
    if (!digits) return null;
    const rows = await db
      .select()
      .from(businessNames)
      .where(eq(businessNames.clientId, clientId));
    return rows.find((r) => String(r.cuit ?? "").replace(/\D/g, "") === digits) ?? null;
  }

  /**
   * Importa comprobantes RECIBIDOS. Idempotente por (CUIT emisor, tipo, punto de venta, numero):
   * volver a subir un periodo que se solapa con otro NO duplica, actualiza la fila existente.
   *
   * El proveedor se resuelve por CUIT contra el catalogo; si no existe, el comprobante se guarda
   * igual con supplierId en null (justamente es uno de los casos que hay que revisar).
   */
  async importAfipReceivedVouchers(
    clientId: number,
    vouchers: Array<{
      fecha: string;
      tipoCodigo: number;
      tipoNombre: string;
      tipoSistema: string | null;
      puntoVenta: number;
      numeroDesde: number;
      numeroHasta: number;
      codigoAutorizacion: string;
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
      ivaPorAlicuota: Record<string, number>;
    }>,
    opts: { businessNameId: number | null; cuit: string | null; fileName?: string | null; format?: string | null; createdBy?: string | null },
  ): Promise<{ batchId: number; insertados: number; actualizados: number; proveedoresNoEncontrados: number }> {
    if (vouchers.length === 0) throw new Error("El archivo no trae comprobantes para importar");

    // Catalogo de proveedores por CUIT, una sola lectura para todo el lote.
    const supplierRows = await db
      .select({ id: suppliers.id, cuit: suppliers.cuit })
      .from(suppliers)
      .where(eq(suppliers.clientId, clientId));
    const supplierByCuit = new Map<string, number>();
    for (const s of supplierRows) {
      const digits = String(s.cuit ?? "").replace(/\D/g, "");
      if (digits) supplierByCuit.set(digits, s.id);
    }

    const fechas = vouchers.map((v) => v.fecha).sort();
    const [batch] = await db
      .insert(afipImportBatches)
      .values({
        clientId,
        businessNameId: opts.businessNameId ?? null,
        kind: "received",
        format: opts.format ?? null,
        fileName: opts.fileName ?? null,
        cuit: opts.cuit ?? null,
        periodFrom: fechas[0],
        periodTo: fechas[fechas.length - 1],
        createdBy: opts.createdBy ?? null,
      })
      .returning();

    // Lo ya cargado del mismo cliente, para decidir insert vs update sin una consulta por fila.
    const existing = await db
      .select({
        id: afipReceivedVouchers.id,
        issuerCuit: afipReceivedVouchers.issuerCuit,
        voucherTypeCode: afipReceivedVouchers.voucherTypeCode,
        salePoint: afipReceivedVouchers.salePoint,
        numberFrom: afipReceivedVouchers.numberFrom,
      })
      .from(afipReceivedVouchers)
      .where(eq(afipReceivedVouchers.clientId, clientId));
    const keyOf = (cuit: string, tipo: number, pv: number, nro: number) => `${cuit}|${tipo}|${pv}|${nro}`;
    const existingByKey = new Map(existing.map((e) => [keyOf(String(e.issuerCuit ?? ""), e.voucherTypeCode, e.salePoint, e.numberFrom), e.id]));

    let insertados = 0;
    let actualizados = 0;
    let proveedoresNoEncontrados = 0;
    const filas: any[] = [];
    const idsAReemplazar: number[] = [];

    for (const v of vouchers) {
      const supplierId = supplierByCuit.get(v.docNumero) ?? null;
      if (!supplierId) proveedoresNoEncontrados++;

      const values = {
        clientId,
        businessNameId: opts.businessNameId ?? null,
        batchId: batch.id,
        voucherDate: v.fecha,
        voucherTypeCode: v.tipoCodigo,
        voucherTypeName: v.tipoNombre,
        voucherSystemType: v.tipoSistema,
        salePoint: v.puntoVenta,
        numberFrom: v.numeroDesde,
        numberTo: v.numeroHasta,
        authorizationCode: v.codigoAutorizacion,
        issuerDocType: v.docTipo,
        issuerCuit: v.docNumero,
        issuerName: v.denominacion,
        supplierId,
        currency: v.moneda,
        exchangeRate: String(v.tipoCambio ?? 1),
        netGravado: String(v.netoGravado ?? 0),
        netNoGravado: String(v.netoNoGravado ?? 0),
        exempt: String(v.opExentas ?? 0),
        otherTaxes: String(v.otrosTributos ?? 0),
        totalIva: String(v.totalIva ?? 0),
        total: String(v.total ?? 0),
        net0: String(v.ivaPorAlicuota?.neto0 ?? 0),
        iva2_5: String(v.ivaPorAlicuota?.iva2_5 ?? 0),
        net2_5: String(v.ivaPorAlicuota?.neto2_5 ?? 0),
        iva5: String(v.ivaPorAlicuota?.iva5 ?? 0),
        net5: String(v.ivaPorAlicuota?.neto5 ?? 0),
        iva10_5: String(v.ivaPorAlicuota?.iva10_5 ?? 0),
        net10_5: String(v.ivaPorAlicuota?.neto10_5 ?? 0),
        iva21: String(v.ivaPorAlicuota?.iva21 ?? 0),
        net21: String(v.ivaPorAlicuota?.neto21 ?? 0),
        iva27: String(v.ivaPorAlicuota?.iva27 ?? 0),
        net27: String(v.ivaPorAlicuota?.neto27 ?? 0),
        createdBy: opts.createdBy ?? null,
      };

      const existingId = existingByKey.get(keyOf(v.docNumero, v.tipoCodigo, v.puntoVenta, v.numeroDesde));
      if (existingId) {
        idsAReemplazar.push(existingId);
        actualizados++;
      } else {
        insertados++;
      }
      filas.push(values);
    }

    // Se escribe POR LOTES, no fila por fila: un archivo de AFIP trae ~2.000 comprobantes y
    // una consulta por cada uno contra Turso seria lentisimo y ademas quema cuota de la base.
    // Los que ya existian se borran y se vuelven a insertar, que deja el mismo resultado que
    // un update pero con dos consultas en lugar de dos mil.
    const CHUNK_DELETE = 200;
    for (let i = 0; i < idsAReemplazar.length; i += CHUNK_DELETE) {
      await db
        .delete(afipReceivedVouchers)
        .where(inArray(afipReceivedVouchers.id, idsAReemplazar.slice(i, i + CHUNK_DELETE)));
    }

    // 20 filas por insert: son ~35 columnas cada una y SQLite corta a las 999 variables.
    const CHUNK_INSERT = 20;
    for (let i = 0; i < filas.length; i += CHUNK_INSERT) {
      await db.insert(afipReceivedVouchers).values(filas.slice(i, i + CHUNK_INSERT));
    }

    await db
      .update(afipImportBatches)
      .set({ rowsImported: insertados + actualizados, rowsSkipped: 0 })
      .where(eq(afipImportBatches.id, batch.id));

    return { batchId: batch.id, insertados, actualizados, proveedoresNoEncontrados };
  }

  /** Comprobantes recibidos del periodo, con el proveedor del sistema ya resuelto. */
  async listAfipReceivedVouchers(
    clientId: number,
    filters: { dateFrom?: string; dateTo?: string; supplierId?: number; businessNameId?: number } = {},
  ): Promise<any[]> {
    const conds = [eq(afipReceivedVouchers.clientId, clientId)];
    if (filters.dateFrom) conds.push(gte(afipReceivedVouchers.voucherDate, filters.dateFrom));
    if (filters.dateTo) conds.push(lte(afipReceivedVouchers.voucherDate, filters.dateTo));
    if (filters.supplierId != null) conds.push(eq(afipReceivedVouchers.supplierId, filters.supplierId));
    if (filters.businessNameId != null) conds.push(eq(afipReceivedVouchers.businessNameId, filters.businessNameId));

    const rows = await db
      .select({
        voucher: afipReceivedVouchers,
        supplier: suppliers,
      })
      .from(afipReceivedVouchers)
      .leftJoin(suppliers, eq(afipReceivedVouchers.supplierId, suppliers.id))
      .where(and(...conds))
      .orderBy(desc(afipReceivedVouchers.voucherDate), desc(afipReceivedVouchers.id));

    return rows.map((r) => ({
      ...r.voucher,
      supplier: r.supplier ? { id: r.supplier.id, tradeName: r.supplier.tradeName, cuit: r.supplier.cuit } : null,
    }));
  }

  /**
   * Cruce de los comprobantes RECIBIDOS de AFIP contra las Facturas cargadas.
   *
   * Se calcula AL VUELO, no se persiste: asi, a medida que se cargan las facturas que faltaban,
   * la diferencia baja sola sin tener que volver a importar ni recalcular nada.
   *
   * Dos niveles de coincidencia, como se acordo el 26-ago:
   *  - EXACTA:  CUIT emisor + tipo + punto de venta + numero.
   *  - PROBABLE: CUIT emisor + numero, ignorando el punto de venta. Existe porque hay facturas
   *    cargadas antes de que el sistema pidiera punto de venta, que lo tienen vacio.
   * La FECHA no se exige para dar por encontrada una factura (el cuarteto ya es unico); la
   * diferencia de dias se informa como observacion.
   *
   * Estados de cada comprobante de AFIP:
   *  - "ok"        esta cargado y el importe coincide.
   *  - "importe"   esta cargado pero el total no coincide.
   *  - "probable"  aparecio por numero + CUIT, sin poder confirmar el punto de venta.
   *  - "faltante"  AFIP lo tiene y el sistema no.
   * Y aparte, las facturas del sistema que AFIP no informa quedan como "sobrante".
   */
  async getAfipReceivedReconciliation(
    clientId: number,
    filters: { dateFrom?: string; dateTo?: string; supplierId?: number; localId?: number } = {},
  ): Promise<any> {
    const vouchers = await this.listAfipReceivedVouchers(clientId, {
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
      supplierId: filters.supplierId,
    });

    // Las facturas se buscan con un margen de 45 dias sobre el periodo pedido: la fecha cargada
    // a mano puede no ser exactamente la de emision y no queremos falsos faltantes por eso.
    const shiftDays = (iso: string, days: number) => {
      const d = new Date(`${iso}T00:00:00`);
      d.setDate(d.getDate() + days);
      return d.toISOString().slice(0, 10);
    };
    const invoiceConds = [eq(invoices.clientId, clientId)];
    if (filters.dateFrom) invoiceConds.push(gte(invoices.invoiceDate, shiftDays(filters.dateFrom, -45)));
    if (filters.dateTo) invoiceConds.push(lte(invoices.invoiceDate, shiftDays(filters.dateTo, 45)));

    const invoiceRows = await db
      .select({
        id: invoices.id,
        localId: invoices.localId,
        localName: locals.name,
        supplierId: invoices.supplierId,
        supplierName: suppliers.tradeName,
        supplierCuit: suppliers.cuit,
        salePoint: invoices.invoiceSalePoint,
        number: invoices.invoiceNumber,
        type: invoices.invoiceType,
        date: invoices.invoiceDate,
        total: invoices.total,
        status: invoices.status,
      })
      .from(invoices)
      .leftJoin(locals, eq(invoices.localId, locals.id))
      .leftJoin(suppliers, eq(invoices.supplierId, suppliers.id))
      .where(and(...invoiceConds));

    const digits = (v: unknown) => String(v ?? "").replace(/\D/g, "");
    const numOf = (v: unknown) => {
      const d = digits(v);
      return d ? parseInt(d, 10) : null;
    };

    // Indices de las facturas: por clave exacta y por (CUIT + numero) para el nivel probable.
    const exactKey = (cuit: string, type: string, sp: number, num: number) => `${cuit}|${type}|${sp}|${num}`;
    const loseKey = (cuit: string, num: number) => `${cuit}|${num}`;

    const byExact = new Map<string, any>();
    const byLoose = new Map<string, any[]>();
    const usedInvoiceIds = new Set<number>();

    for (const inv of invoiceRows) {
      // Las anuladas no cuentan: no deberian aparecer como cargadas ni como sobrantes.
      if (inv.status && inv.status !== "active") continue;
      const cuit = digits(inv.supplierCuit);
      const num = numOf(inv.number);
      if (!cuit || num == null) continue;
      const sp = numOf(inv.salePoint);
      if (sp != null) byExact.set(exactKey(cuit, String(inv.type ?? ""), sp, num), inv);
      const lk = loseKey(cuit, num);
      if (!byLoose.has(lk)) byLoose.set(lk, []);
      byLoose.get(lk)!.push(inv);
    }

    const AMOUNT_TOLERANCE = 1; // un peso, para no marcar diferencias por redondeo
    const daysBetween = (a: string, b: string) =>
      Math.round((new Date(`${a}T00:00:00`).getTime() - new Date(`${b}T00:00:00`).getTime()) / 86400000);

    const rows = vouchers.map((v: any) => {
      const cuit = digits(v.issuerCuit);
      const total = parseFloat(String(v.total ?? 0)) || 0;
      const num = v.numberFrom;
      const systemType = v.voucherSystemType ?? "";

      let match: any = null;
      let matchLevel: "exacta" | "probable" | null = null;

      if (cuit && systemType) {
        const hit = byExact.get(exactKey(cuit, systemType, v.salePoint, num));
        if (hit) {
          match = hit;
          matchLevel = "exacta";
        }
      }
      if (!match && cuit) {
        // Nivel probable: mismo CUIT y mismo numero, con el punto de venta sin cargar.
        const candidates = (byLoose.get(loseKey(cuit, num)) ?? []).filter(
          (c) => numOf(c.salePoint) == null && !usedInvoiceIds.has(c.id),
        );
        if (candidates.length > 0) {
          match = candidates[0];
          matchLevel = "probable";
        }
      }

      if (match) usedInvoiceIds.add(match.id);

      const invoiceTotal = match ? parseFloat(String(match.total ?? 0)) || 0 : null;
      const amountDiff = invoiceTotal != null ? Math.round((total - invoiceTotal) * 100) / 100 : null;
      const dateDiff = match ? daysBetween(v.voucherDate, String(match.date)) : null;

      let status: "ok" | "importe" | "probable" | "faltante";
      if (!match) status = "faltante";
      else if (amountDiff != null && Math.abs(amountDiff) > AMOUNT_TOLERANCE) status = "importe";
      else if (matchLevel === "probable") status = "probable";
      else status = "ok";

      return {
        id: v.id,
        voucherDate: v.voucherDate,
        voucherTypeCode: v.voucherTypeCode,
        voucherTypeName: v.voucherTypeName,
        voucherSystemType: v.voucherSystemType,
        salePoint: v.salePoint,
        numberFrom: v.numberFrom,
        issuerCuit: v.issuerCuit,
        issuerName: v.issuerName,
        supplierId: v.supplierId,
        supplierName: v.supplier?.tradeName ?? null,
        total,
        totalIva: parseFloat(String(v.totalIva ?? 0)) || 0,
        netGravado: parseFloat(String(v.netGravado ?? 0)) || 0,
        status,
        matchLevel,
        invoiceId: match?.id ?? null,
        invoiceTotal,
        invoiceDate: match ? String(match.date) : null,
        amountDiff,
        dateDiff,
        localId: match?.localId ?? null,
        localName: match?.localName ?? null,
      };
    });

    // Facturas cargadas que AFIP no informa. Se miran solo dentro del periodo pedido, para no
    // marcar como sobrante algo que simplemente cae fuera del archivo importado.
    const inPeriod = (d: string) =>
      (!filters.dateFrom || d >= filters.dateFrom) && (!filters.dateTo || d <= filters.dateTo);

    const sobrantes = invoiceRows
      .filter((inv) => {
        if (inv.status && inv.status !== "active") return false;
        if (usedInvoiceIds.has(inv.id)) return false;
        if (!inPeriod(String(inv.date))) return false;
        if (filters.supplierId != null && inv.supplierId !== filters.supplierId) return false;
        return true;
      })
      .map((inv) => ({
        invoiceId: inv.id,
        invoiceDate: String(inv.date),
        invoiceType: inv.type,
        salePoint: inv.salePoint,
        number: inv.number,
        supplierId: inv.supplierId,
        supplierName: inv.supplierName,
        supplierCuit: inv.supplierCuit,
        total: parseFloat(String(inv.total ?? 0)) || 0,
        localId: inv.localId,
        localName: inv.localName,
        /** Sin CUIT cargado el cruce es imposible: se avisa para que se complete la ficha. */
        reason: digits(inv.supplierCuit) ? "no_informado" : "proveedor_sin_cuit",
      }));

    // El filtro por LOCAL se aplica DESPUES del cruce: el local de un comprobante de AFIP sale
    // de la factura que le matcheo, asi que los que no matchearon no tienen local.
    const filteredRows =
      filters.localId != null ? rows.filter((r) => r.localId === filters.localId) : rows;
    const filteredSobrantes =
      filters.localId != null ? sobrantes.filter((s) => s.localId === filters.localId) : sobrantes;

    const sum = (list: any[], pick: (x: any) => number) => Math.round(list.reduce((s, x) => s + pick(x), 0) * 100) / 100;
    const byStatus = (st: string) => filteredRows.filter((r) => r.status === st);

    return {
      rows: filteredRows,
      sobrantes: filteredSobrantes,
      resumen: {
        totalComprobantes: filteredRows.length,
        totalAfip: sum(filteredRows, (r) => r.total),
        ok: byStatus("ok").length,
        okTotal: sum(byStatus("ok"), (r) => r.total),
        probable: byStatus("probable").length,
        probableTotal: sum(byStatus("probable"), (r) => r.total),
        importe: byStatus("importe").length,
        importeTotal: sum(byStatus("importe"), (r) => r.total),
        importeDiff: sum(byStatus("importe"), (r) => r.amountDiff ?? 0),
        faltante: byStatus("faltante").length,
        faltanteTotal: sum(byStatus("faltante"), (r) => r.total),
        sobrante: filteredSobrantes.length,
        sobranteTotal: sum(filteredSobrantes, (s) => s.total),
        sinProveedor: filteredRows.filter((r) => !r.supplierId).length,
        sinLocal: filteredRows.filter((r) => r.localId == null).length,
      },
    };
  }

  /**
   * Importa comprobantes EMITIDOS ya resumidos por dia + punto de venta + tipo.
   *
   * Idempotente por (sociedad, fecha, punto de venta, tipo): volver a subir un periodo que se
   * solapa reemplaza el resumen de esos dias en vez de sumarlo dos veces. Eso es importante
   * aca: AFIP se descarga por rango y es normal que dos descargas compartan dias.
   */
  async importAfipIssuedVouchers(
    clientId: number,
    businessNameId: number,
    aggregates: Array<{
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
    }>,
    opts: { cuit: string | null; fileName?: string | null; format?: string | null; createdBy?: string | null },
  ): Promise<{ batchId: number; insertados: number; reemplazados: number; puntosDeVentaNuevos: number[] }> {
    if (aggregates.length === 0) throw new Error("El archivo no trae comprobantes para importar");
    await this.assertBusinessNameBelongsToClient(clientId, businessNameId);

    const fechas = aggregates.map((a) => a.fecha).sort();
    const [batch] = await db
      .insert(afipImportBatches)
      .values({
        clientId,
        businessNameId,
        kind: "issued",
        format: opts.format ?? null,
        fileName: opts.fileName ?? null,
        cuit: opts.cuit ?? null,
        periodFrom: fechas[0],
        periodTo: fechas[fechas.length - 1],
        createdBy: opts.createdBy ?? null,
      })
      .returning();

    const existing = await db
      .select({
        id: afipIssuedVouchers.id,
        voucherDate: afipIssuedVouchers.voucherDate,
        salePoint: afipIssuedVouchers.salePoint,
        voucherTypeCode: afipIssuedVouchers.voucherTypeCode,
      })
      .from(afipIssuedVouchers)
      .where(and(eq(afipIssuedVouchers.clientId, clientId), eq(afipIssuedVouchers.businessNameId, businessNameId)));
    const keyOf = (fecha: string, pv: number, tipo: number) => `${fecha}|${pv}|${tipo}`;
    const existingByKey = new Map(existing.map((e) => [keyOf(String(e.voucherDate), e.salePoint, e.voucherTypeCode), e.id]));

    const filas: any[] = [];
    const idsAReemplazar: number[] = [];
    let insertados = 0;
    let reemplazados = 0;

    for (const a of aggregates) {
      const hit = existingByKey.get(keyOf(a.fecha, a.puntoVenta, a.tipoCodigo));
      if (hit) {
        idsAReemplazar.push(hit);
        reemplazados++;
      } else {
        insertados++;
      }
      filas.push({
        clientId,
        businessNameId,
        batchId: batch.id,
        voucherDate: a.fecha,
        salePoint: a.puntoVenta,
        voucherTypeCode: a.tipoCodigo,
        voucherTypeName: a.tipoNombre,
        quantity: a.cantidad,
        netGravado: String(a.netoGravado ?? 0),
        netNoGravado: String(a.netoNoGravado ?? 0),
        exempt: String(a.opExentas ?? 0),
        otherTaxes: String(a.otrosTributos ?? 0),
        totalIva: String(a.totalIva ?? 0),
        total: String(a.total ?? 0),
        createdBy: opts.createdBy ?? null,
      });
    }

    const CHUNK_DELETE = 200;
    for (let i = 0; i < idsAReemplazar.length; i += CHUNK_DELETE) {
      await db.delete(afipIssuedVouchers).where(inArray(afipIssuedVouchers.id, idsAReemplazar.slice(i, i + CHUNK_DELETE)));
    }
    const CHUNK_INSERT = 50;
    for (let i = 0; i < filas.length; i += CHUNK_INSERT) {
      await db.insert(afipIssuedVouchers).values(filas.slice(i, i + CHUNK_INSERT));
    }

    await db
      .update(afipImportBatches)
      .set({ rowsImported: filas.length, rowsSkipped: 0 })
      .where(eq(afipImportBatches.id, batch.id));

    // Puntos de venta que trae el archivo y todavia no estan dados de alta: sin ellos no hay
    // local asociado, asi que el filtro por local no los va a alcanzar.
    const declared = await db
      .select({ number: afipSalePoints.number })
      .from(afipSalePoints)
      .where(and(eq(afipSalePoints.clientId, clientId), eq(afipSalePoints.businessNameId, businessNameId)));
    const declaredSet = new Set(declared.map((d) => d.number));
    const puntosDeVentaNuevos = [...new Set(aggregates.map((a) => a.puntoVenta))]
      .filter((pv) => !declaredSet.has(pv))
      .sort((a, b) => a - b);

    return { batchId: batch.id, insertados, reemplazados, puntosDeVentaNuevos };
  }

  /**
   * Emitidos del periodo con su desglose por punto de venta.
   *
   * El local sale del punto de venta (AFIP no lo informa), por eso el filtro por local solo
   * alcanza a los puntos de venta que estan dados de alta y tienen local asignado.
   */
  async getAfipIssuedSummary(
    clientId: number,
    filters: { dateFrom?: string; dateTo?: string; localId?: number; salePoint?: number; businessNameId?: number } = {},
  ): Promise<any> {
    const conds = [eq(afipIssuedVouchers.clientId, clientId)];
    if (filters.dateFrom) conds.push(gte(afipIssuedVouchers.voucherDate, filters.dateFrom));
    if (filters.dateTo) conds.push(lte(afipIssuedVouchers.voucherDate, filters.dateTo));
    if (filters.salePoint != null) conds.push(eq(afipIssuedVouchers.salePoint, filters.salePoint));
    if (filters.businessNameId != null) conds.push(eq(afipIssuedVouchers.businessNameId, filters.businessNameId));

    const rows = await db
      .select()
      .from(afipIssuedVouchers)
      .where(and(...conds))
      .orderBy(desc(afipIssuedVouchers.voucherDate), asc(afipIssuedVouchers.salePoint));

    const salePoints = await this.listAfipSalePoints(clientId);
    const spByKey = new Map(salePoints.map((sp: any) => [`${sp.businessNameId}|${sp.number}`, sp]));

    const num = (v: unknown) => parseFloat(String(v ?? 0)) || 0;
    const enriched = rows
      .map((r) => {
        const sp = spByKey.get(`${r.businessNameId}|${r.salePoint}`) ?? null;
        return {
          id: r.id,
          voucherDate: String(r.voucherDate),
          salePoint: r.salePoint,
          voucherTypeCode: r.voucherTypeCode,
          voucherTypeName: r.voucherTypeName,
          quantity: r.quantity ?? 0,
          netGravado: num(r.netGravado),
          totalIva: num(r.totalIva),
          total: num(r.total),
          businessNameId: r.businessNameId,
          salePointId: sp?.id ?? null,
          salePointName: sp?.fantasyName ?? null,
          salesSystem: sp?.salesSystem ?? null,
          localId: sp?.localId ?? null,
          localName: sp?.local?.name ?? null,
        };
      })
      .filter((r) => filters.localId == null || r.localId === filters.localId);

    // Las notas de credito restan, para que el total facturado no quede inflado.
    const signed = (r: { voucherTypeCode: number; total: number }) =>
      isCreditNoteCode(r.voucherTypeCode) ? -r.total : r.total;

    const porPuntoVenta = new Map<number, any>();
    for (const r of enriched) {
      let acc = porPuntoVenta.get(r.salePoint);
      if (!acc) {
        acc = {
          salePoint: r.salePoint,
          salePointId: r.salePointId,
          salePointName: r.salePointName,
          localId: r.localId,
          localName: r.localName,
          salesSystem: r.salesSystem,
          cantidad: 0,
          neto: 0,
          iva: 0,
          total: 0,
        };
        porPuntoVenta.set(r.salePoint, acc);
      }
      acc.cantidad += r.quantity;
      acc.neto += isCreditNoteCode(r.voucherTypeCode) ? -r.netGravado : r.netGravado;
      acc.iva += isCreditNoteCode(r.voucherTypeCode) ? -r.totalIva : r.totalIva;
      acc.total += signed(r);
    }

    const round2 = (n: number) => Math.round(n * 100) / 100;
    const desglose = [...porPuntoVenta.values()]
      .map((a) => ({ ...a, neto: round2(a.neto), iva: round2(a.iva), total: round2(a.total) }))
      .sort((a, b) => b.total - a.total);

    return {
      rows: enriched,
      porPuntoVenta: desglose,
      resumen: {
        cantidad: enriched.reduce((s, r) => s + r.quantity, 0),
        neto: round2(desglose.reduce((s, d) => s + d.neto, 0)),
        iva: round2(desglose.reduce((s, d) => s + d.iva, 0)),
        total: round2(desglose.reduce((s, d) => s + d.total, 0)),
        puntosDeVenta: desglose.length,
        sinDarDeAlta: desglose.filter((d) => !d.salePointId).map((d) => d.salePoint),
        sinLocal: desglose.filter((d) => d.salePointId && d.localId == null).map((d) => d.salePoint),
      },
    };
  }

  /** Lotes de importacion, para mostrarlos y poder deshacerlos. */
  async listAfipImportBatches(clientId: number, kind?: string): Promise<AfipImportBatch[]> {
    const conds = [eq(afipImportBatches.clientId, clientId)];
    if (kind) conds.push(eq(afipImportBatches.kind, kind));
    return db
      .select()
      .from(afipImportBatches)
      .where(and(...conds))
      .orderBy(desc(afipImportBatches.id));
  }

  /**
   * Deshace una importacion: borra los comprobantes que entraron en ese lote.
   * Los que ya existian y solo se ACTUALIZARON quedan apuntando al lote nuevo, asi que se
   * borran tambien; volver a subir el archivo los recrea igual.
   */
  async deleteAfipImportBatch(clientId: number, batchId: number): Promise<{ borrados: number }> {
    const [batch] = await db
      .select()
      .from(afipImportBatches)
      .where(and(eq(afipImportBatches.id, batchId), eq(afipImportBatches.clientId, clientId)))
      .limit(1);
    if (!batch) throw new Error("Lote no encontrado");

    let borrados = 0;
    if (batch.kind === "received") {
      const result = await db
        .delete(afipReceivedVouchers)
        .where(and(eq(afipReceivedVouchers.clientId, clientId), eq(afipReceivedVouchers.batchId, batchId)));
      borrados = (result as any).rowCount ?? (result as any).rowsAffected ?? 0;
    } else {
      const result = await db
        .delete(afipIssuedVouchers)
        .where(and(eq(afipIssuedVouchers.clientId, clientId), eq(afipIssuedVouchers.batchId, batchId)));
      borrados = (result as any).rowCount ?? (result as any).rowsAffected ?? 0;
    }

    await db.delete(afipImportBatches).where(eq(afipImportBatches.id, batchId));
    return { borrados };
  }

  // ==========================================
  // PREFERENCIAS DE LA EMPRESA (punto 6, ago-26)
  // ==========================================

  /**
   * Preferencias del cliente. Si todavia no tiene fila, devuelve los defaults SIN
   * escribir nada: una lectura no tiene por que crear registros, y el default ya
   * equivale al comportamiento anterior (los tres sistemas habilitados).
   */
  async getSalesSourcePreferences(clientId: number): Promise<SalesSourcePreferences> {
    const [row] = await db
      .select()
      .from(clientPreferences)
      .where(eq(clientPreferences.clientId, clientId))
      .limit(1);

    if (!row) return normalizeSalesSourcePreferences(null);

    return normalizeSalesSourcePreferences({
      fudo: row.salesSourceFudo,
      shares: row.salesSourceShares,
      datalive: row.salesSourceDatalive,
    });
  }

  async updateSalesSourcePreferences(
    clientId: number,
    prefs: SalesSourcePreferences,
  ): Promise<SalesSourcePreferences> {
    const normalized = normalizeSalesSourcePreferences(prefs);
    if (!hasAtLeastOneSalesSource(normalized)) {
      throw new Error("Tiene que quedar habilitado al menos un sistema de ventas");
    }

    const values = {
      salesSourceFudo: normalized.fudo,
      salesSourceShares: normalized.shares,
      salesSourceDatalive: normalized.datalive,
      updatedAt: new Date(),
    };

    const [existing] = await db
      .select({ id: clientPreferences.id })
      .from(clientPreferences)
      .where(eq(clientPreferences.clientId, clientId))
      .limit(1);

    if (existing) {
      await db
        .update(clientPreferences)
        .set(values)
        .where(eq(clientPreferences.clientId, clientId));
    } else {
      await db.insert(clientPreferences).values({ clientId, ...values });
    }

    return normalized;
  }
}

export const storage = new DatabaseStorage();
