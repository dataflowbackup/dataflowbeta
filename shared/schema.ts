import { sql, relations } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

const varchar = (name: string, _opts?: { length?: number }) => text(name) as any;
const pgTable = sqliteTable;
const decimal = (
  name: string,
  _opts?: { precision?: number; scale?: number },
) => real(name) as any;
const boolean = (name: string) => integer(name, { mode: "boolean" }) as any;
const timestamp = (name: string) => {
  const column = integer(name, { mode: "timestamp_ms" }) as any;
  if (typeof column.defaultNow !== "function") {
    column.defaultNow = () => column.default(sql`(unixepoch() * 1000)`);
  }
  return column;
};
const date = (name: string) => text(name) as any;
const jsonb = (name: string) => text(name, { mode: "json" }) as any;
const serial = (name: string) =>
  integer(name).primaryKey({ autoIncrement: true }) as any;

let uniqueCounter = 0;
const unique = () => uniqueIndex(`uq_${++uniqueCounter}`);

// ==========================================
// SESSION TABLE (Required for Replit Auth)
// ==========================================
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)]
);

// ==========================================
// USERS TABLE
// ==========================================
export const users = pgTable("users", {
  id: varchar("id").primaryKey(),
  email: varchar("email").unique(),
  username: varchar("username", { length: 50 }).unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  role: varchar("role", { length: 50 }).default("encargado"),
  isActive: boolean("is_active").default(true),
  emailVerified: boolean("email_verified").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;

// ==========================================
// USER CREDENTIALS (Auth Propia)
// ==========================================
export const userCredentials = pgTable("user_credentials", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  loginType: varchar("login_type", { length: 20 }).notNull().default("email"),
  lastLogin: timestamp("last_login"),
  failedAttempts: integer("failed_attempts").default(0),
  lockedUntil: timestamp("locked_until"),
  passwordResetToken: varchar("password_reset_token", { length: 255 }),
  passwordResetExpires: timestamp("password_reset_expires"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertUserCredentialsSchema = createInsertSchema(userCredentials).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertUserCredentials = z.infer<typeof insertUserCredentialsSchema>;
export type UserCredentials = typeof userCredentials.$inferSelect;

// ==========================================
// ROLES (Perfiles del Sistema)
// ==========================================
export const roles = pgTable("roles", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").references(() => clients.id, { onDelete: "cascade" }),
  code: varchar("code", { length: 50 }).notNull(),
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description"),
  isSystem: boolean("is_system").default(false),
  level: integer("level").default(0),
  active: boolean("active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertRoleSchema = createInsertSchema(roles).omit({ id: true, createdAt: true });
export type InsertRole = z.infer<typeof insertRoleSchema>;
export type Role = typeof roles.$inferSelect;

// ==========================================
// CLIENTS (Multi-Tenant Root Entity)
// ==========================================
export const clients = pgTable("clients", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  cuit: varchar("cuit", { length: 13 }),
  fiscalYearStart: integer("fiscal_year_start").default(1),
  weekStartDay: integer("week_start_day").default(1),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertClientSchema = createInsertSchema(clients).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertClient = z.infer<typeof insertClientSchema>;
export type Client = typeof clients.$inferSelect;

// ==========================================
// USER-CLIENT RELATIONSHIP (Multi-Tenant Access)
// ==========================================
export const userClients = pgTable("user_clients", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  clientId: integer("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  role: varchar("role", { length: 50 }).default("encargado"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  unique().on(table.userId, table.clientId),
]);

export type UserClient = typeof userClients.$inferSelect;
export const insertUserClientSchema = createInsertSchema(userClients).omit({ id: true, createdAt: true });
export type InsertUserClient = z.infer<typeof insertUserClientSchema>;

// ==========================================
// CLIENT INVITATIONS (Team Invites)
// ==========================================
export const clientInvitations = pgTable("client_invitations", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  email: varchar("email", { length: 255 }),
  inviteCode: varchar("invite_code", { length: 32 }).notNull().unique(),
  role: varchar("role", { length: 50 }).default("encargado"),
  status: varchar("status", { length: 20 }).default("pending"),
  createdBy: varchar("created_by").references(() => users.id),
  usedBy: varchar("used_by").references(() => users.id),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow(),
  usedAt: timestamp("used_at"),
});

export const insertClientInvitationSchema = createInsertSchema(clientInvitations).omit({ 
  id: true, createdAt: true, usedAt: true, usedBy: true, status: true 
});
export type InsertClientInvitation = z.infer<typeof insertClientInvitationSchema>;
export type ClientInvitation = typeof clientInvitations.$inferSelect;

// ==========================================
// LOCALS (Business Locations)
// ==========================================
export const locals = pgTable("locals", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  businessName: varchar("business_name", { length: 255 }),
  address: text("address"),
  cuit: varchar("cuit", { length: 13 }),
  afipPOS: varchar("afip_pos", { length: 5 }),
  ivaCondition: varchar("iva_condition", { length: 50 }).default("responsable_inscripto"),
  managerName: varchar("manager_name", { length: 255 }),
  managerPhone: varchar("manager_phone", { length: 50 }),
  managerEmail: varchar("manager_email", { length: 255 }),
  active: boolean("active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertLocalSchema = createInsertSchema(locals).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertLocal = z.infer<typeof insertLocalSchema>;
export type Local = typeof locals.$inferSelect;

// ==========================================
// RUBROS (Categories for Supplies)
// ==========================================
export const rubros = pgTable("rubros", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  active: boolean("active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertRubroSchema = createInsertSchema(rubros).omit({ id: true, createdAt: true });
export type InsertRubro = z.infer<typeof insertRubroSchema>;
export type Rubro = typeof rubros.$inferSelect;

// ==========================================
// SUB-RUBROS (Sub-categories for Supplies)
// ==========================================
export const subRubros = pgTable("sub_rubros", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  rubroId: integer("rubro_id").notNull().references(() => rubros.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  active: boolean("active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertSubRubroSchema = createInsertSchema(subRubros).omit({ id: true, createdAt: true });
export type InsertSubRubro = z.infer<typeof insertSubRubroSchema>;
export type SubRubro = typeof subRubros.$inferSelect;

// ==========================================
// UNITS OF MEASURE
// ==========================================
export const unitsOfMeasure = pgTable("units_of_measure", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 50 }).notNull(),
  abbreviation: varchar("abbreviation", { length: 10 }).notNull(),
  active: boolean("active").default(true),
});

export const insertUnitOfMeasureSchema = createInsertSchema(unitsOfMeasure).omit({ id: true });
export type InsertUnitOfMeasure = z.infer<typeof insertUnitOfMeasureSchema>;
export type UnitOfMeasure = typeof unitsOfMeasure.$inferSelect;

// ==========================================
// SUPPLIERS (Proveedores)
// ==========================================
export const suppliers = pgTable("suppliers", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  tradeName: varchar("trade_name", { length: 255 }).notNull(),
  businessName: varchar("business_name", { length: 255 }),
  cuit: varchar("cuit", { length: 13 }),
  rubroId: integer("rubro_id").references(() => rubros.id),
  ivaCondition: varchar("iva_condition", { length: 50 }).default("responsable_inscripto"),
  email: varchar("email", { length: 255 }),
  phone: varchar("phone", { length: 50 }),
  address: text("address"),
  paymentDays: integer("payment_days").default(0),
  active: boolean("active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertSupplierSchema = createInsertSchema(suppliers).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSupplier = z.infer<typeof insertSupplierSchema>;
export type Supplier = typeof suppliers.$inferSelect;

// ==========================================
// TAXES (Impuestos)
// ==========================================
export const taxes = pgTable("taxes", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 100 }).notNull(),
  percentage: decimal("percentage", { precision: 5, scale: 2 }).notNull(),
  type: varchar("type", { length: 50 }).default("iva"),
  active: boolean("active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertTaxSchema = createInsertSchema(taxes).omit({ id: true, createdAt: true });
export type InsertTax = z.infer<typeof insertTaxSchema>;
export type Tax = typeof taxes.$inferSelect;

// ==========================================
// SUPPLY-SUPPLIER (Insumo-Proveedor Relationship)
// ==========================================
export const supplySuppliers = pgTable("supply_suppliers", {
  id: serial("id").primaryKey(),
  supplyId: integer("supply_id").notNull().references(() => supplies.id, { onDelete: "cascade" }),
  supplierId: integer("supplier_id").notNull().references(() => suppliers.id, { onDelete: "cascade" }),
  clientId: integer("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  unique().on(table.supplyId, table.supplierId),
]);

export const insertSupplySupplierSchema = createInsertSchema(supplySuppliers).omit({ id: true, createdAt: true });
export type InsertSupplySupplier = z.infer<typeof insertSupplySupplierSchema>;
export type SupplySupplier = typeof supplySuppliers.$inferSelect;

// ==========================================
// SUPPLIER-RUBROS (Proveedor-Rubro Relationship)
// ==========================================
export const supplierRubros = pgTable("supplier_rubros", {
  id: serial("id").primaryKey(),
  supplierId: integer("supplier_id").notNull().references(() => suppliers.id, { onDelete: "cascade" }),
  rubroId: integer("rubro_id").notNull().references(() => rubros.id, { onDelete: "cascade" }),
  clientId: integer("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  unique().on(table.supplierId, table.rubroId),
]);

export const insertSupplierRubroSchema = createInsertSchema(supplierRubros).omit({ id: true, createdAt: true });
export type InsertSupplierRubro = z.infer<typeof insertSupplierRubroSchema>;
export type SupplierRubro = typeof supplierRubros.$inferSelect;

// ==========================================
// SUPPLIES (Insumos)
// ==========================================
export const supplies = pgTable("supplies", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  rubroId: integer("rubro_id").references(() => rubros.id),
  subRubroId: integer("sub_rubro_id").references(() => subRubros.id),
  unitOfMeasureId: integer("unit_of_measure_id").references(() => unitsOfMeasure.id),
  lastCost: decimal("last_cost", { precision: 12, scale: 4 }).default("0"),
  lastQuantity: decimal("last_quantity", { precision: 12, scale: 4 }).default("0"),
  lastPurchaseDate: timestamp("last_purchase_date"),
  unitCost: decimal("unit_cost", { precision: 12, scale: 4 }).default("0"),
  active: boolean("active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertSupplySchema = createInsertSchema(supplies).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSupply = z.infer<typeof insertSupplySchema>;
export type Supply = typeof supplies.$inferSelect;

// ==========================================
// INVOICES (Facturas)
// ==========================================
export const invoices = pgTable("invoices", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  localId: integer("local_id").notNull().references(() => locals.id),
  supplierId: integer("supplier_id").notNull().references(() => suppliers.id),
  invoiceNumber: varchar("invoice_number", { length: 50 }).notNull(),
  invoiceType: varchar("invoice_type", { length: 20 }).notNull(),
  invoiceDate: date("invoice_date").notNull(),
  dueDate: date("due_date"),
  ivaCondition: varchar("iva_condition", { length: 50 }),
  expenseType: varchar("expense_type", { length: 20 }).default("cmv"),
  subtotal: decimal("subtotal", { precision: 12, scale: 2 }).default("0"),
  discount: decimal("discount", { precision: 12, scale: 2 }).default("0"),
  taxTotal: decimal("tax_total", { precision: 12, scale: 2 }).default("0"),
  total: decimal("total", { precision: 12, scale: 2 }).default("0"),
  advancePayment: decimal("advance_payment", { precision: 12, scale: 2 }).default("0"),
  balance: decimal("balance", { precision: 12, scale: 2 }).default("0"),
  paid: boolean("paid").default(false),
  status: varchar("status", { length: 20 }).default("active"),
  reversedAt: timestamp("reversed_at"),
  reversedBy: varchar("reversed_by").references(() => users.id),
  reversalReason: text("reversal_reason"),
  notes: text("notes"),
  createdBy: varchar("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertInvoiceSchema = createInsertSchema(invoices).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertInvoice = z.infer<typeof insertInvoiceSchema>;
export type Invoice = typeof invoices.$inferSelect;

// ==========================================
// INVOICE ITEMS (Detalle de Facturas)
// ==========================================
export const invoiceItems = pgTable("invoice_items", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),
  supplyId: integer("supply_id").references(() => supplies.id),
  description: text("description"),
  quantity: decimal("quantity", { precision: 12, scale: 4 }).notNull(),
  unitPrice: decimal("unit_price", { precision: 12, scale: 4 }).notNull(),
  subtotal: decimal("subtotal", { precision: 12, scale: 2 }).notNull(),
  rubroId: integer("rubro_id").references(() => rubros.id),
});

export const insertInvoiceItemSchema = createInsertSchema(invoiceItems).omit({ id: true });
export type InsertInvoiceItem = z.infer<typeof insertInvoiceItemSchema>;
export type InvoiceItem = typeof invoiceItems.$inferSelect;

// ==========================================
// INVOICE TAXES (Impuestos de Facturas)
// ==========================================
export const invoiceTaxes = pgTable("invoice_taxes", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),
  taxId: integer("tax_id").notNull().references(() => taxes.id),
  baseAmount: decimal("base_amount", { precision: 12, scale: 2 }).notNull(),
  taxAmount: decimal("tax_amount", { precision: 12, scale: 2 }).notNull(),
});

export const insertInvoiceTaxSchema = createInsertSchema(invoiceTaxes).omit({ id: true });
export type InsertInvoiceTax = z.infer<typeof insertInvoiceTaxSchema>;
export type InvoiceTax = typeof invoiceTaxes.$inferSelect;

// ==========================================
// PAYMENTS (Pagos a Proveedores)
// ==========================================
export const payments = pgTable("payments", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  localId: integer("local_id").notNull().references(() => locals.id),
  supplierId: integer("supplier_id").notNull().references(() => suppliers.id),
  bankAccountId: integer("bank_account_id").references(() => bankAccounts.id),
  paymentNumber: varchar("payment_number", { length: 50 }),
  paymentDate: date("payment_date").notNull(),
  paymentMethod: varchar("payment_method", { length: 50 }).notNull(),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  notes: text("notes"),
  createdBy: varchar("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertPaymentSchema = createInsertSchema(payments).omit({ id: true, createdAt: true });
export type InsertPayment = z.infer<typeof insertPaymentSchema>;
export type Payment = typeof payments.$inferSelect;

// ==========================================
// PAYMENT ALLOCATIONS (Asignación de Pagos a Facturas)
// ==========================================
export const paymentAllocations = pgTable("payment_allocations", {
  id: serial("id").primaryKey(),
  paymentId: integer("payment_id").notNull().references(() => payments.id, { onDelete: "cascade" }),
  invoiceId: integer("invoice_id").notNull().references(() => invoices.id),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
});

export const insertPaymentAllocationSchema = createInsertSchema(paymentAllocations).omit({ id: true });
export type InsertPaymentAllocation = z.infer<typeof insertPaymentAllocationSchema>;
export type PaymentAllocation = typeof paymentAllocations.$inferSelect;

// ==========================================
// RECIPE CATEGORIES
// ==========================================
export const recipeCategories = pgTable("recipe_categories", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  displayOrder: integer("display_order").default(0),
  active: boolean("active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertRecipeCategorySchema = createInsertSchema(recipeCategories).omit({ id: true, createdAt: true });
export type InsertRecipeCategory = z.infer<typeof insertRecipeCategorySchema>;
export type RecipeCategory = typeof recipeCategories.$inferSelect;

// ==========================================
// RECIPE SUBCATEGORIES (hijo de recipe_categories)
// ==========================================
export const recipeSubcategories = pgTable("recipe_subcategories", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  recipeCategoryId: integer("recipe_category_id")
    .notNull()
    .references(() => recipeCategories.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  displayOrder: integer("display_order").default(0),
  active: boolean("active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertRecipeSubcategorySchema = createInsertSchema(recipeSubcategories).omit({
  id: true,
  createdAt: true,
});
export type InsertRecipeSubcategory = z.infer<typeof insertRecipeSubcategorySchema>;
export type RecipeSubcategory = typeof recipeSubcategories.$inferSelect;

// ==========================================
// RECIPES (Recetas/Platos)
// ==========================================
export const recipes = pgTable("recipes", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  categoryId: integer("category_id").references(() => recipeCategories.id),
  subcategoryId: integer("subcategory_id").references(() => recipeSubcategories.id),
  recipeType: varchar("recipe_type", { length: 20 }).default("plato"),
  name: varchar("name", { length: 255 }).notNull(),
  normalizedName: varchar("normalized_name", { length: 255 }),
  description: text("description"),
  preparationSteps: text("preparation_steps"),
  salePrice: decimal("sale_price", { precision: 12, scale: 2 }).default("0"),
  salePriceWithTax: decimal("sale_price_with_tax", { precision: 12, scale: 2 }).default("0"),
  totalCost: decimal("total_cost", { precision: 12, scale: 4 }).default("0"),
  usefulYield: decimal("useful_yield", { precision: 12, scale: 4 }),
  yieldUnit: varchar("yield_unit", { length: 20 }),
  cmvPercentage: decimal("cmv_percentage", { precision: 5, scale: 2 }).default("0"),
  cmvIdeal: decimal("cmv_ideal", { precision: 5, scale: 2 }),
  margin: decimal("margin", { precision: 12, scale: 2 }).default("0"),
  marginPercentage: decimal("margin_percentage", { precision: 5, scale: 2 }).default("0"),
  markup: decimal("markup", { precision: 5, scale: 2 }).default("0"),
  photoUrl: varchar("photo_url", { length: 500 }),
  active: boolean("active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertRecipeSchema = createInsertSchema(recipes).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertRecipe = z.infer<typeof insertRecipeSchema>;
export type Recipe = typeof recipes.$inferSelect;

// ==========================================
// RECIPE INGREDIENTS (Ingredientes de Recetas)
// ==========================================
export const recipeIngredients = pgTable("recipe_ingredients", {
  id: serial("id").primaryKey(),
  recipeId: integer("recipe_id").notNull().references(() => recipes.id, { onDelete: "cascade" }),
  supplyId: integer("supply_id").references(() => supplies.id),
  subRecipeId: integer("sub_recipe_id").references(() => recipes.id),
  quantityTotal: decimal("quantity_total", { precision: 12, scale: 4 }).notNull(),
  quantityUseful: decimal("quantity_useful", { precision: 12, scale: 4 }),
  quantityWithWaste: decimal("quantity_with_waste", { precision: 12, scale: 4 }).notNull(),
  wastePercentage: decimal("waste_percentage", { precision: 5, scale: 2 }).default("0"),
  unitCostAtCreation: decimal("unit_cost_at_creation", { precision: 12, scale: 4 }),
  currentCost: decimal("current_cost", { precision: 12, scale: 4 }),
  totalCost: decimal("total_cost", { precision: 12, scale: 4 }),
});

export const insertRecipeIngredientSchema = createInsertSchema(recipeIngredients).omit({ id: true });
export type InsertRecipeIngredient = z.infer<typeof insertRecipeIngredientSchema>;
export type RecipeIngredient = typeof recipeIngredients.$inferSelect;

// ==========================================
// COST HISTORY (Historial de Costos)
// ==========================================
export const costHistory = pgTable("cost_history", {
  id: serial("id").primaryKey(),
  supplyId: integer("supply_id").notNull().references(() => supplies.id, { onDelete: "cascade" }),
  invoiceId: integer("invoice_id").references(() => invoices.id),
  unitCost: decimal("unit_cost", { precision: 12, scale: 4 }).notNull(),
  quantity: decimal("quantity", { precision: 12, scale: 4 }).notNull(),
  totalCost: decimal("total_cost", { precision: 12, scale: 4 }).notNull(),
  recordedAt: timestamp("recorded_at").defaultNow(),
});

export const insertCostHistorySchema = createInsertSchema(costHistory).omit({ id: true, recordedAt: true });
export type InsertCostHistory = z.infer<typeof insertCostHistorySchema>;
export type CostHistory = typeof costHistory.$inferSelect;

// ==========================================
// FINANCIAL GROUPS (Grupos Financieros)
// ==========================================
export const financialGroups = pgTable("financial_groups", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 100 }).notNull(),
  type: varchar("type", { length: 20 }).notNull(),
  displayOrder: integer("display_order").default(0),
  isSystem: boolean("is_system").default(false),
  active: boolean("active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertFinancialGroupSchema = createInsertSchema(financialGroups).omit({ id: true, createdAt: true });
export type InsertFinancialGroup = z.infer<typeof insertFinancialGroupSchema>;
export type FinancialGroup = typeof financialGroups.$inferSelect;

// ==========================================
// TRANSACTION CATEGORY GROUPS (deprecated - use financialGroups)
// ==========================================
export const categoryGroups = pgTable("category_groups", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 100 }).notNull(),
  type: varchar("type", { length: 20 }).notNull(),
  order: integer("order").default(0),
  active: boolean("active").default(true),
});

export const insertCategoryGroupSchema = createInsertSchema(categoryGroups).omit({ id: true });
export type InsertCategoryGroup = z.infer<typeof insertCategoryGroupSchema>;
export type CategoryGroup = typeof categoryGroups.$inferSelect;

// ==========================================
// TRANSACTION CATEGORIES
// ==========================================
export const transactionCategories = pgTable("transaction_categories", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  groupId: integer("group_id").references(() => categoryGroups.id),
  financialGroupId: integer("financial_group_id").references(() => financialGroups.id),
  name: varchar("name", { length: 255 }).notNull(),
  type: varchar("type", { length: 20 }).notNull(),
  isDefault: boolean("is_default").default(false),
  isSpecial: boolean("is_special").default(false),
  isSystem: boolean("is_system").default(false),
  specialType: varchar("special_type", { length: 50 }),
  active: boolean("active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertTransactionCategorySchema = createInsertSchema(transactionCategories).omit({ id: true, createdAt: true });
export type InsertTransactionCategory = z.infer<typeof insertTransactionCategorySchema>;
export type TransactionCategory = typeof transactionCategories.$inferSelect;

// ==========================================
// BANK ACCOUNTS / ENTITIES
// ==========================================
export const bankAccounts = pgTable("bank_accounts", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  type: varchar("type", { length: 50 }).default("bank"),
  accountNumber: varchar("account_number", { length: 100 }),
  active: boolean("active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertBankAccountSchema = createInsertSchema(bankAccounts).omit({ id: true, createdAt: true });
export type InsertBankAccount = z.infer<typeof insertBankAccountSchema>;
export type BankAccount = typeof bankAccounts.$inferSelect;

// ==========================================
// CLIENT BANKS (Bancos configurados por cliente)
// ==========================================
export const clientBanks = pgTable("client_banks", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  bankId: varchar("bank_id", { length: 50 }).notNull(),
  displayName: varchar("display_name", { length: 100 }),
  isActive: boolean("is_active").default(true),
  displayOrder: integer("display_order").default(0),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  unique().on(table.clientId, table.bankId),
]);

export const insertClientBankSchema = createInsertSchema(clientBanks).omit({ id: true, createdAt: true });
export type InsertClientBank = z.infer<typeof insertClientBankSchema>;
export type ClientBank = typeof clientBanks.$inferSelect;

// ==========================================
// TRANSACTIONS (Movimientos)
// ==========================================
export const transactions = pgTable("transactions", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  localId: integer("local_id").references(() => locals.id),
  bankAccountId: integer("bank_account_id").references(() => bankAccounts.id),
  categoryId: integer("category_id").references(() => transactionCategories.id),
  transactionDate: date("transaction_date").notNull(),
  description: text("description"),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  type: varchar("type", { length: 20 }).notNull(),
  source: varchar("source", { length: 50 }).default("manual"),
  bankSource: varchar("bank_source", { length: 50 }),
  parentTransactionId: integer("parent_transaction_id"),
  invoiced: boolean("invoiced").default(false),
  grossAmount: decimal("gross_amount", { precision: 12, scale: 2 }),
  commission: decimal("commission", { precision: 12, scale: 2 }),
  taxWithholding: decimal("tax_withholding", { precision: 12, scale: 2 }),
  branchName: varchar("branch_name", { length: 255 }),
  importBatchId: varchar("import_batch_id", { length: 50 }),
  createdBy: varchar("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertTransactionSchema = createInsertSchema(transactions).omit({ id: true, createdAt: true });
export type InsertTransaction = z.infer<typeof insertTransactionSchema>;
export type Transaction = typeof transactions.$inferSelect;

// ==========================================
// MONTHLY BALANCES
// ==========================================
export const monthlyBalances = pgTable("monthly_balances", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  localId: integer("local_id").references(() => locals.id),
  year: integer("year").notNull(),
  month: integer("month").notNull(),
  openingBalance: decimal("opening_balance", { precision: 12, scale: 2 }).default("0"),
  totalIncome: decimal("total_income", { precision: 12, scale: 2 }).default("0"),
  totalExpenses: decimal("total_expenses", { precision: 12, scale: 2 }).default("0"),
  closingBalance: decimal("closing_balance", { precision: 12, scale: 2 }).default("0"),
  closed: boolean("closed").default(false),
  closedAt: timestamp("closed_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  unique().on(table.clientId, table.localId, table.year, table.month),
]);

export const insertMonthlyBalanceSchema = createInsertSchema(monthlyBalances).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertMonthlyBalance = z.infer<typeof insertMonthlyBalanceSchema>;
export type MonthlyBalance = typeof monthlyBalances.$inferSelect;

// ==========================================
// SALES (Ventas importadas)
// ==========================================
export const sales = pgTable("sales", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  localId: integer("local_id").references(() => locals.id),
  recipeId: integer("recipe_id").references(() => recipes.id),
  saleDate: date("sale_date").notNull(),
  productName: varchar("product_name", { length: 255 }).notNull(),
  normalizedName: varchar("normalized_name", { length: 255 }),
  quantity: decimal("quantity", { precision: 12, scale: 2 }).notNull(),
  unitPrice: decimal("unit_price", { precision: 12, scale: 2 }).notNull(),
  total: decimal("total", { precision: 12, scale: 2 }).notNull(),
  paymentMethod: varchar("payment_method", { length: 50 }),
  invoiced: boolean("invoiced").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertSaleSchema = createInsertSchema(sales).omit({ id: true, createdAt: true });
export type InsertSale = z.infer<typeof insertSaleSchema>;
export type Sale = typeof sales.$inferSelect;

// ==========================================
// PERMISSIONS (Sistema de Permisos Granulares)
// ==========================================
export const permissions = pgTable("permissions", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 100 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  module: varchar("module", { length: 100 }).notNull(),
  description: text("description"),
  active: boolean("active").default(true),
});

export const insertPermissionSchema = createInsertSchema(permissions).omit({ id: true });
export type InsertPermission = z.infer<typeof insertPermissionSchema>;
export type Permission = typeof permissions.$inferSelect;

// ==========================================
// ROLE PERMISSIONS (Permisos por Rol)
// ==========================================
export const rolePermissions = pgTable("role_permissions", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  role: varchar("role", { length: 50 }).notNull(),
  permissionId: integer("permission_id").notNull().references(() => permissions.id, { onDelete: "cascade" }),
  canView: boolean("can_view").default(true),
  canCreate: boolean("can_create").default(false),
  canEdit: boolean("can_edit").default(false),
  canDelete: boolean("can_delete").default(false),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  unique().on(table.clientId, table.role, table.permissionId),
]);

export const insertRolePermissionSchema = createInsertSchema(rolePermissions).omit({ id: true, createdAt: true });
export type InsertRolePermission = z.infer<typeof insertRolePermissionSchema>;
export type RolePermission = typeof rolePermissions.$inferSelect;

// ==========================================
// USER LOCAL ASSIGNMENTS (Asignación de Usuarios a Locales)
// ==========================================
export const userLocalAssignments = pgTable("user_local_assignments", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  clientId: integer("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  localId: integer("local_id").notNull().references(() => locals.id, { onDelete: "cascade" }),
  role: varchar("role", { length: 50 }).notNull(),
  active: boolean("active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  unique().on(table.userId, table.localId),
]);

export const insertUserLocalAssignmentSchema = createInsertSchema(userLocalAssignments).omit({ id: true, createdAt: true });
export type InsertUserLocalAssignment = z.infer<typeof insertUserLocalAssignmentSchema>;
export type UserLocalAssignment = typeof userLocalAssignments.$inferSelect;

// ==========================================
// NOTIFICATIONS (Sistema de Notificaciones)
// ==========================================
export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }),
  type: varchar("type", { length: 50 }).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  message: text("message"),
  relatedTable: varchar("related_table", { length: 100 }),
  relatedId: integer("related_id"),
  priority: varchar("priority", { length: 20 }).default("normal"),
  read: boolean("read").default(false),
  readAt: timestamp("read_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertNotificationSchema = createInsertSchema(notifications).omit({ id: true, createdAt: true });
export type InsertNotification = z.infer<typeof insertNotificationSchema>;
export type Notification = typeof notifications.$inferSelect;

// ==========================================
// STOCK MOVEMENTS (Movimientos de Stock)
// ==========================================
export const stockMovements = pgTable("stock_movements", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  localId: integer("local_id").notNull().references(() => locals.id),
  supplyId: integer("supply_id").notNull().references(() => supplies.id),
  movementType: varchar("movement_type", { length: 50 }).notNull(),
  quantity: decimal("quantity", { precision: 12, scale: 4 }).notNull(),
  unitCost: decimal("unit_cost", { precision: 12, scale: 4 }),
  referenceType: varchar("reference_type", { length: 50 }),
  referenceId: integer("reference_id"),
  notes: text("notes"),
  createdBy: varchar("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertStockMovementSchema = createInsertSchema(stockMovements).omit({ id: true, createdAt: true });
export type InsertStockMovement = z.infer<typeof insertStockMovementSchema>;
export type StockMovement = typeof stockMovements.$inferSelect;

// ==========================================
// STOCK LEVELS (Niveles de Stock por Local)
// ==========================================
export const stockLevels = pgTable("stock_levels", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  localId: integer("local_id").notNull().references(() => locals.id),
  supplyId: integer("supply_id").notNull().references(() => supplies.id),
  theoreticalStock: decimal("theoretical_stock", { precision: 12, scale: 4 }).default("0"),
  actualStock: decimal("actual_stock", { precision: 12, scale: 4 }).default("0"),
  minimumStock: decimal("minimum_stock", { precision: 12, scale: 4 }).default("0"),
  maximumStock: decimal("maximum_stock", { precision: 12, scale: 4 }),
  lastCountDate: timestamp("last_count_date"),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  unique().on(table.localId, table.supplyId),
]);

export const insertStockLevelSchema = createInsertSchema(stockLevels).omit({ id: true, updatedAt: true });
export type InsertStockLevel = z.infer<typeof insertStockLevelSchema>;
export type StockLevel = typeof stockLevels.$inferSelect;

// ==========================================
// STOCK ADJUSTMENTS (Ajustes de Stock - Inmutable)
// ==========================================
export const stockAdjustments = pgTable("stock_adjustments", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  localId: integer("local_id").notNull().references(() => locals.id),
  supplyId: integer("supply_id").notNull().references(() => supplies.id),
  theoreticalBefore: decimal("theoretical_before", { precision: 12, scale: 4 }).notNull(),
  actualCount: decimal("actual_count", { precision: 12, scale: 4 }).notNull(),
  difference: decimal("difference", { precision: 12, scale: 4 }).notNull(),
  reason: text("reason"),
  adjustmentType: varchar("adjustment_type", { length: 50 }).default("inventory_count"),
  createdBy: varchar("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertStockAdjustmentSchema = createInsertSchema(stockAdjustments).omit({ id: true, createdAt: true });
export type InsertStockAdjustment = z.infer<typeof insertStockAdjustmentSchema>;
export type StockAdjustment = typeof stockAdjustments.$inferSelect;

// ==========================================
// OPERATIONAL AUDITS (Auditorías Operativas)
// ==========================================
export const operationalAudits = pgTable("operational_audits", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  localId: integer("local_id").notNull().references(() => locals.id),
  auditType: varchar("audit_type", { length: 50 }).notNull(),
  auditDate: date("audit_date").notNull(),
  auditor: varchar("auditor").references(() => users.id),
  totalItems: integer("total_items").default(0),
  approvedItems: integer("approved_items").default(0),
  approvalPercentage: decimal("approval_percentage", { precision: 5, scale: 2 }).default("0"),
  status: varchar("status", { length: 20 }).default("draft"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  completedAt: timestamp("completed_at"),
});

export const insertOperationalAuditSchema = createInsertSchema(operationalAudits).omit({ id: true, createdAt: true });
export type InsertOperationalAudit = z.infer<typeof insertOperationalAuditSchema>;
export type OperationalAudit = typeof operationalAudits.$inferSelect;

// ==========================================
// AUDIT TEMPLATES (Plantillas de Auditoría)
// ==========================================
export const auditTemplates = pgTable("audit_templates", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  auditType: varchar("audit_type", { length: 50 }).notNull(),
  description: text("description"),
  active: boolean("active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertAuditTemplateSchema = createInsertSchema(auditTemplates).omit({ id: true, createdAt: true });
export type InsertAuditTemplate = z.infer<typeof insertAuditTemplateSchema>;
export type AuditTemplate = typeof auditTemplates.$inferSelect;

// ==========================================
// AUDIT TEMPLATE ITEMS (Items de Plantillas)
// ==========================================
export const auditTemplateItems = pgTable("audit_template_items", {
  id: serial("id").primaryKey(),
  templateId: integer("template_id").notNull().references(() => auditTemplates.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  category: varchar("category", { length: 100 }),
  weight: integer("weight").default(1),
  order: integer("order").default(0),
});

export const insertAuditTemplateItemSchema = createInsertSchema(auditTemplateItems).omit({ id: true });
export type InsertAuditTemplateItem = z.infer<typeof insertAuditTemplateItemSchema>;
export type AuditTemplateItem = typeof auditTemplateItems.$inferSelect;

// ==========================================
// AUDIT RESULTS (Resultados de Auditoría)
// ==========================================
export const auditResults = pgTable("audit_results", {
  id: serial("id").primaryKey(),
  auditId: integer("audit_id").notNull().references(() => operationalAudits.id, { onDelete: "cascade" }),
  templateItemId: integer("template_item_id").references(() => auditTemplateItems.id),
  itemDescription: text("item_description").notNull(),
  approved: boolean("approved").default(false),
  notes: text("notes"),
  imageUrl: varchar("image_url", { length: 500 }),
});

export const insertAuditResultSchema = createInsertSchema(auditResults).omit({ id: true });
export type InsertAuditResult = z.infer<typeof insertAuditResultSchema>;
export type AuditResult = typeof auditResults.$inferSelect;

// ==========================================
// EMPLOYEES (Empleados - RRHH)
// ==========================================
export const employees = pgTable("employees", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  localId: integer("local_id").references(() => locals.id),
  firstName: varchar("first_name", { length: 100 }).notNull(),
  lastName: varchar("last_name", { length: 100 }).notNull(),
  documentNumber: varchar("document_number", { length: 20 }),
  documentType: varchar("document_type", { length: 10 }).default("DNI"),
  email: varchar("email", { length: 255 }),
  phone: varchar("phone", { length: 50 }),
  address: text("address"),
  position: varchar("position", { length: 100 }),
  department: varchar("department", { length: 100 }),
  hireDate: date("hire_date"),
  terminationDate: date("termination_date"),
  baseSalary: decimal("base_salary", { precision: 12, scale: 2 }).default("0"),
  status: varchar("status", { length: 20 }).default("active"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertEmployeeSchema = createInsertSchema(employees).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEmployee = z.infer<typeof insertEmployeeSchema>;
export type Employee = typeof employees.$inferSelect;

// ==========================================
// ATTENDANCE (Asistencia)
// ==========================================
export const attendances = pgTable("attendances", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  employeeId: integer("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
  localId: integer("local_id").references(() => locals.id),
  date: date("date").notNull(),
  checkIn: timestamp("check_in"),
  checkOut: timestamp("check_out"),
  hoursWorked: decimal("hours_worked", { precision: 5, scale: 2 }),
  status: varchar("status", { length: 20 }).default("present"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertAttendanceSchema = createInsertSchema(attendances).omit({ id: true, createdAt: true });
export type InsertAttendance = z.infer<typeof insertAttendanceSchema>;
export type Attendance = typeof attendances.$inferSelect;

// ==========================================
// PAYROLL (Liquidaciones)
// ==========================================
export const payrolls = pgTable("payrolls", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  employeeId: integer("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
  period: varchar("period", { length: 7 }).notNull(),
  baseSalary: decimal("base_salary", { precision: 12, scale: 2 }).default("0"),
  overtime: decimal("overtime", { precision: 12, scale: 2 }).default("0"),
  bonuses: decimal("bonuses", { precision: 12, scale: 2 }).default("0"),
  deductions: decimal("deductions", { precision: 12, scale: 2 }).default("0"),
  netSalary: decimal("net_salary", { precision: 12, scale: 2 }).default("0"),
  payrollType: varchar("payroll_type", { length: 50 }).default("salary"),
  status: varchar("status", { length: 20 }).default("pending"),
  paidAt: timestamp("paid_at"),
  notes: text("notes"),
  createdBy: varchar("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertPayrollSchema = createInsertSchema(payrolls).omit({ id: true, createdAt: true });
export type InsertPayroll = z.infer<typeof insertPayrollSchema>;
export type Payroll = typeof payrolls.$inferSelect;

// ==========================================
// LOCAL ALIASES (Mapeo de nombres externos a locales)
// ==========================================
export const localAliases = pgTable("local_aliases", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  localId: integer("local_id").notNull().references(() => locals.id, { onDelete: "cascade" }),
  alias: varchar("alias", { length: 255 }).notNull(),
  source: varchar("source", { length: 50 }).default("mercadopago"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  unique().on(table.clientId, table.alias),
]);

export const insertLocalAliasSchema = createInsertSchema(localAliases).omit({ id: true, createdAt: true });
export type InsertLocalAlias = z.infer<typeof insertLocalAliasSchema>;
export type LocalAlias = typeof localAliases.$inferSelect;

// ==========================================
// AUDIT LOG
// ==========================================
export const auditLog = pgTable("audit_log", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").references(() => clients.id),
  userId: varchar("user_id").references(() => users.id),
  action: varchar("action", { length: 50 }).notNull(),
  tableName: varchar("table_name", { length: 100 }).notNull(),
  recordId: integer("record_id"),
  oldData: jsonb("old_data"),
  newData: jsonb("new_data"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type AuditLog = typeof auditLog.$inferSelect;

// ==========================================
// RELATIONS
// ==========================================
export const clientsRelations = relations(clients, ({ many }) => ({
  locals: many(locals),
  suppliers: many(suppliers),
  supplies: many(supplies),
  rubros: many(rubros),
  taxes: many(taxes),
  invoices: many(invoices),
  recipes: many(recipes),
  transactions: many(transactions),
  userClients: many(userClients),
}));

export const localsRelations = relations(locals, ({ one, many }) => ({
  client: one(clients, { fields: [locals.clientId], references: [clients.id] }),
  invoices: many(invoices),
  transactions: many(transactions),
}));

export const suppliersRelations = relations(suppliers, ({ one, many }) => ({
  client: one(clients, { fields: [suppliers.clientId], references: [clients.id] }),
  rubro: one(rubros, { fields: [suppliers.rubroId], references: [rubros.id] }),
  invoices: many(invoices),
  payments: many(payments),
  supplySuppliers: many(supplySuppliers),
  supplierRubros: many(supplierRubros),
}));

export const supplierRubrosRelations = relations(supplierRubros, ({ one }) => ({
  supplier: one(suppliers, { fields: [supplierRubros.supplierId], references: [suppliers.id] }),
  rubro: one(rubros, { fields: [supplierRubros.rubroId], references: [rubros.id] }),
  client: one(clients, { fields: [supplierRubros.clientId], references: [clients.id] }),
}));

export const suppliesRelations = relations(supplies, ({ one, many }) => ({
  client: one(clients, { fields: [supplies.clientId], references: [clients.id] }),
  rubro: one(rubros, { fields: [supplies.rubroId], references: [rubros.id] }),
  subRubro: one(subRubros, { fields: [supplies.subRubroId], references: [subRubros.id] }),
  unitOfMeasure: one(unitsOfMeasure, { fields: [supplies.unitOfMeasureId], references: [unitsOfMeasure.id] }),
  invoiceItems: many(invoiceItems),
  recipeIngredients: many(recipeIngredients),
  costHistory: many(costHistory),
}));

export const subRubrosRelations = relations(subRubros, ({ one, many }) => ({
  client: one(clients, { fields: [subRubros.clientId], references: [clients.id] }),
  rubro: one(rubros, { fields: [subRubros.rubroId], references: [rubros.id] }),
  supplies: many(supplies),
}));

export const invoicesRelations = relations(invoices, ({ one, many }) => ({
  client: one(clients, { fields: [invoices.clientId], references: [clients.id] }),
  local: one(locals, { fields: [invoices.localId], references: [locals.id] }),
  supplier: one(suppliers, { fields: [invoices.supplierId], references: [suppliers.id] }),
  creator: one(users, { fields: [invoices.createdBy], references: [users.id] }),
  items: many(invoiceItems),
  taxes: many(invoiceTaxes),
  paymentAllocations: many(paymentAllocations),
}));

export const invoiceItemsRelations = relations(invoiceItems, ({ one }) => ({
  invoice: one(invoices, { fields: [invoiceItems.invoiceId], references: [invoices.id] }),
  supply: one(supplies, { fields: [invoiceItems.supplyId], references: [supplies.id] }),
  rubro: one(rubros, { fields: [invoiceItems.rubroId], references: [rubros.id] }),
}));

export const recipeCategoriesRelations = relations(recipeCategories, ({ one, many }) => ({
  client: one(clients, { fields: [recipeCategories.clientId], references: [clients.id] }),
  subcategories: many(recipeSubcategories),
  recipes: many(recipes),
}));

export const recipeSubcategoriesRelations = relations(recipeSubcategories, ({ one, many }) => ({
  client: one(clients, { fields: [recipeSubcategories.clientId], references: [clients.id] }),
  recipeCategory: one(recipeCategories, {
    fields: [recipeSubcategories.recipeCategoryId],
    references: [recipeCategories.id],
  }),
  recipes: many(recipes),
}));

export const recipesRelations = relations(recipes, ({ one, many }) => ({
  client: one(clients, { fields: [recipes.clientId], references: [clients.id] }),
  category: one(recipeCategories, { fields: [recipes.categoryId], references: [recipeCategories.id] }),
  subcategory: one(recipeSubcategories, {
    fields: [recipes.subcategoryId],
    references: [recipeSubcategories.id],
  }),
  ingredients: many(recipeIngredients),
  sales: many(sales),
}));

export const recipeIngredientsRelations = relations(recipeIngredients, ({ one }) => ({
  recipe: one(recipes, { fields: [recipeIngredients.recipeId], references: [recipes.id] }),
  supply: one(supplies, { fields: [recipeIngredients.supplyId], references: [supplies.id] }),
}));

export const transactionsRelations = relations(transactions, ({ one }) => ({
  client: one(clients, { fields: [transactions.clientId], references: [clients.id] }),
  local: one(locals, { fields: [transactions.localId], references: [locals.id] }),
  bankAccount: one(bankAccounts, { fields: [transactions.bankAccountId], references: [bankAccounts.id] }),
  category: one(transactionCategories, { fields: [transactions.categoryId], references: [transactionCategories.id] }),
  creator: one(users, { fields: [transactions.createdBy], references: [users.id] }),
}));

export const paymentsRelations = relations(payments, ({ one, many }) => ({
  client: one(clients, { fields: [payments.clientId], references: [clients.id] }),
  local: one(locals, { fields: [payments.localId], references: [locals.id] }),
  supplier: one(suppliers, { fields: [payments.supplierId], references: [suppliers.id] }),
  bankAccount: one(bankAccounts, { fields: [payments.bankAccountId], references: [bankAccounts.id] }),
  allocations: many(paymentAllocations),
}));

export const supplySupplierRelations = relations(supplySuppliers, ({ one }) => ({
  supply: one(supplies, { fields: [supplySuppliers.supplyId], references: [supplies.id] }),
  supplier: one(suppliers, { fields: [supplySuppliers.supplierId], references: [suppliers.id] }),
  client: one(clients, { fields: [supplySuppliers.clientId], references: [clients.id] }),
}));

export const salesRelations = relations(sales, ({ one }) => ({
  client: one(clients, { fields: [sales.clientId], references: [clients.id] }),
  local: one(locals, { fields: [sales.localId], references: [locals.id] }),
  recipe: one(recipes, { fields: [sales.recipeId], references: [recipes.id] }),
}));
