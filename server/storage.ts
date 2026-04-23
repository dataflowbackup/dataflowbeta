import { db } from "./db";
import { eq, and, desc, asc, gte, lte, sql, isNull, isNotNull, inArray } from "drizzle-orm";
import {
  users,
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
  financialImportBatches,
  financialSavedViews,
  clientBanks,
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
  type InsertFinancialImportBatch,
  type FinancialImportBatch,
  type InsertFinancialSavedView,
  type FinancialSavedView,
  type InsertClientBank,
  type ClientBank,
  type InsertTransaction,
  type Transaction,
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
} from "@shared/schema";

export interface IStorage {
  upsertUser(user: UpsertUser): Promise<User>;
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  
  getClientByUserId(userId: string): Promise<Client | undefined>;
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
  getInvoiceByNumber(clientId: number, invoiceNumber: string, supplierId: number): Promise<Invoice | undefined>;
  getInvoiceItems(invoiceId: number): Promise<InvoiceItem[]>;
  getInvoiceTaxes(invoiceId: number): Promise<InvoiceTax[]>;
  createInvoice(invoice: InsertInvoice, items: InsertInvoiceItem[], taxItems: InsertInvoiceTax[]): Promise<Invoice>;
  updateInvoice(clientId: number, id: number, invoice: Partial<InsertInvoice>): Promise<Invoice | undefined>;
  deleteInvoice(clientId: number, id: number): Promise<boolean>;
  
  getPayments(clientId: number): Promise<Payment[]>;
  createPayment(payment: InsertPayment): Promise<Payment>;
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
  createFinancialImportBatch(row: InsertFinancialImportBatch): Promise<FinancialImportBatch>;
  getFinancialSavedViews(clientId: number, userId: string): Promise<FinancialSavedView[]>;
  createFinancialSavedView(row: InsertFinancialSavedView): Promise<FinancialSavedView>;
  deleteFinancialSavedView(clientId: number, userId: string, id: number): Promise<boolean>;
  
  getTransactions(clientId: number): Promise<Transaction[]>;
  createTransaction(transaction: InsertTransaction): Promise<Transaction>;
  createTransactionsBatch(transactionsList: InsertTransaction[]): Promise<number>;
  updateTransaction(clientId: number, id: number, transaction: Partial<InsertTransaction>): Promise<Transaction | undefined>;
  deleteTransaction(clientId: number, id: number): Promise<boolean>;
  
  getMonthlyBalances(clientId: number, year: number): Promise<MonthlyBalance[]>;
  createMonthlyBalance(balance: InsertMonthlyBalance): Promise<MonthlyBalance>;
  updateMonthlyBalance(clientId: number, id: number, balance: Partial<InsertMonthlyBalance>): Promise<MonthlyBalance | undefined>;
  
  getBalanceSpreadsheet(clientId: number, year: number, localId?: number): Promise<{
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
      totalIncome: number;
      totalExpenses: number;
      totalNet: number;
    };
  }>;
  
  getSales(clientId: number): Promise<Sale[]>;
  
  getPermissions(): Promise<Permission[]>;
  createPermission(permission: InsertPermission): Promise<Permission>;
  
  getRolePermissions(clientId: number, role?: string): Promise<RolePermission[]>;
  setRolePermission(rolePermission: InsertRolePermission): Promise<RolePermission>;
  deleteRolePermission(clientId: number, role: string, permissionId: number): Promise<boolean>;
  
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
  reassignUserToClient(userId: string, newClientId: number, role?: string): Promise<boolean>;
  
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
        const salePriceWithTax = parseFloat(String(recipe.salePriceWithTax ?? 0)) || 0;
        const salePrice = salePriceWithTax > 0 ? salePriceWithTax / 1.21 : (parseFloat(String(recipe.salePrice ?? 0)) || 0);

        const cmvPercentageRaw = salePrice > 0 ? (newTotalCost / salePrice) * 100 : 0;
        const marginRaw = salePrice - newTotalCost;
        const marginPercentageRaw = salePrice > 0 ? (marginRaw / salePrice) * 100 : 0;
        const markupRaw = newTotalCost > 0 ? (marginRaw / newTotalCost) * 100 : 0;

        const cmvPercentage = clamp(toFinite(cmvPercentageRaw), -999.99, 999.99);
        const margin = clamp(toFinite(marginRaw), -9999999999.99, 9999999999.99);
        const marginPercentage = clamp(toFinite(marginPercentageRaw), -999.99, 999.99);
        const markup = clamp(toFinite(markupRaw), -999.99, 999.99);

        await tx
          .update(recipes)
          .set({
            totalCost: newTotalCost.toFixed(4),
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
      invoiceDate: string | null;
      quantity: string;
      unitPrice: string;
      subtotal: string;
    }>();

    for (const row of latestPurchaseRows) {
      const supplyId = row.supplyId;
      if (!supplyId || latestPurchaseBySupplyId.has(supplyId)) continue;

      latestPurchaseBySupplyId.set(supplyId, {
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

  async getInvoiceByNumber(clientId: number, invoiceNumber: string, supplierId: number): Promise<Invoice | undefined> {
    const [invoice] = await db.select().from(invoices)
      .where(and(
        eq(invoices.clientId, clientId),
        eq(invoices.invoiceNumber, invoiceNumber),
        eq(invoices.supplierId, supplierId)
      ));
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
    
    const aggregatedItems = new Map<number, { totalQty: number; totalCost: number; lastUnitPrice: number; items: InsertInvoiceItem[] }>();
    
    for (const item of items) {
      await db.insert(invoiceItems).values({ ...item, invoiceId: newInvoice.id });
      
      if (item.supplyId) {
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
        notes: `Compra - Factura ${invoice.invoiceNumber || ""}`,
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
        notes: `Reversion - Factura ${invoice.invoiceNumber}: ${reason}`,
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
    const [updated] = await db.update(financialGroups)
      .set(group)
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
    const [updated] = await db.update(transactionCategories)
      .set(category)
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
    const result = await db.delete(bankAccounts).where(and(eq(bankAccounts.id, id), eq(bankAccounts.clientId, clientId)));
    return (result.rowCount ?? 0) > 0;
  }

  async createFinancialImportBatch(row: InsertFinancialImportBatch): Promise<FinancialImportBatch> {
    const [created] = await db.insert(financialImportBatches).values(row).returning();
    return created;
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

  async getTransactions(clientId: number): Promise<Transaction[]> {
    return db.select().from(transactions).where(eq(transactions.clientId, clientId)).orderBy(desc(transactions.transactionDate));
  }

  async createTransaction(transaction: InsertTransaction): Promise<Transaction> {
    const [newTransaction] = await db.insert(transactions).values(transaction).returning();
    return newTransaction;
  }

  async createTransactionsBatch(transactionsList: InsertTransaction[]): Promise<number> {
    if (transactionsList.length === 0) {
      console.log("[BATCH] No transactions to insert");
      return 0;
    }
    
    console.log(`[BATCH] Starting batch insert of ${transactionsList.length} transactions`);
    console.log(`[BATCH] First transaction sample:`, JSON.stringify(transactionsList[0], null, 2));
    
    const BATCH_SIZE = 100;
    let inserted = 0;
    
    for (let i = 0; i < transactionsList.length; i += BATCH_SIZE) {
      const batch = transactionsList.slice(i, i + BATCH_SIZE);
      try {
        await db.insert(transactions).values(batch);
        inserted += batch.length;
        console.log(`[BATCH] Inserted batch ${i / BATCH_SIZE + 1}: ${batch.length} rows`);
      } catch (error: any) {
        console.error(`[BATCH] Error inserting batch ${i / BATCH_SIZE + 1}:`, error.message);
        throw error;
      }
    }
    
    console.log(`[BATCH] Complete: ${inserted} total inserted`);
    return inserted;
  }

  async updateTransaction(clientId: number, id: number, transaction: Partial<InsertTransaction>): Promise<Transaction | undefined> {
    const [updated] = await db.update(transactions)
      .set(transaction)
      .where(and(eq(transactions.id, id), eq(transactions.clientId, clientId)))
      .returning();
    return updated;
  }

  async deleteTransaction(clientId: number, id: number): Promise<boolean> {
    const result = await db.delete(transactions)
      .where(and(eq(transactions.id, id), eq(transactions.clientId, clientId)));
    return (result.rowCount ?? 0) > 0;
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

  async getBalanceSpreadsheet(clientId: number, year: number, localId?: number) {
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
    
    const filteredTransactions = localId 
      ? allTransactions.filter(t => t.localId === localId)
      : allTransactions;
    
    const categoryMonthlyTotals: Record<number, Record<number, number>> = {};
    const summaryIncome: Record<number, number> = {};
    const summaryExpenses: Record<number, number> = {};
    
    for (let m = 1; m <= 12; m++) {
      summaryIncome[m] = 0;
      summaryExpenses[m] = 0;
    }
    
    for (const tx of filteredTransactions) {
      if (!tx.categoryId) continue;
      
      const txDate = new Date(tx.transactionDate);
      const month = txDate.getMonth() + 1;
      const amount = parseFloat(String(tx.amount) || "0");
      
      if (!categoryMonthlyTotals[tx.categoryId]) {
        categoryMonthlyTotals[tx.categoryId] = {};
        for (let m = 1; m <= 12; m++) {
          categoryMonthlyTotals[tx.categoryId][m] = 0;
        }
      }
      
      categoryMonthlyTotals[tx.categoryId][month] += amount;
      
      if (tx.type === "income") {
        summaryIncome[month] += amount;
      } else if (tx.type === "expense") {
        summaryExpenses[month] += amount;
      }
    }
    
    const groups = allFinancialGroups.map(group => {
      const groupCategories = allCategories.filter((c) => {
        if (c.financialGroupId === group.id) return true;
        const mappedFinancialId = c.groupId ? legacyToFinancialId.get(c.groupId) : undefined;
        return mappedFinancialId === group.id;
      });
      const groupMonthlyTotals: Record<number, number> = {};
      
      for (let m = 1; m <= 12; m++) {
        groupMonthlyTotals[m] = 0;
      }
      
      const categories = groupCategories.map(cat => {
        const monthlyTotals = categoryMonthlyTotals[cat.id] || {};
        let yearTotal = 0;
        
        for (let m = 1; m <= 12; m++) {
          const val = monthlyTotals[m] || 0;
          yearTotal += val;
          groupMonthlyTotals[m] += val;
        }
        
        return {
          id: cat.id,
          name: cat.name,
          monthlyTotals,
          yearTotal,
        };
      });
      
      const groupYearTotal = Object.values(groupMonthlyTotals).reduce((a, b) => a + b, 0);
      
      return {
        id: group.id,
        name: group.name,
        type: group.type,
        categories,
        monthlyTotals: groupMonthlyTotals,
        yearTotal: groupYearTotal,
      };
    });
    
    const summaryNet: Record<number, number> = {};
    for (let m = 1; m <= 12; m++) {
      summaryNet[m] = summaryIncome[m] - summaryExpenses[m];
    }
    
    const totalIncome = Object.values(summaryIncome).reduce((a, b) => a + b, 0);
    const totalExpenses = Object.values(summaryExpenses).reduce((a, b) => a + b, 0);
    const totalNet = totalIncome - totalExpenses;
    
    return {
      groups,
      summary: {
        income: summaryIncome,
        expenses: summaryExpenses,
        net: summaryNet,
        totalIncome,
        totalExpenses,
        totalNet,
      },
    };
  }

  async getSales(clientId: number): Promise<Sale[]> {
    return db.select().from(sales).where(eq(sales.clientId, clientId)).orderBy(desc(sales.saleDate));
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

  async reassignUserToClient(userId: string, newClientId: number, role: string = "encargado"): Promise<boolean> {
    await db.delete(userClients).where(eq(userClients.userId, userId));
    await db.insert(userClients).values({
      userId,
      clientId: newClientId,
      role,
    });
    return true;
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
    await this.reassignUserToClient(userId, invitation.clientId, invitation.role ?? "encargado");
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
}

export const storage = new DatabaseStorage();
