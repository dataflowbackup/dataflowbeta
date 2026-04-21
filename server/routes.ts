import type { Express } from "express";
import express from "express";
import { type Server } from "http";
import { storage } from "./storage";
import { setupAuth, isAuthenticated as isAuthenticatedOIDC } from "./replitAuth";
import { setupLocalAuth, isAuthenticatedLocal } from "./auth";
import multer from "multer";
import * as XLSX from "xlsx";
import { z } from "zod";
import { getAvailableBanks, getBankParser } from "./bankParsers";
import { seedFinancialDataForClient } from "./seedFinancialData";
import path from "path";

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }
});

const updateTransactionSchema = z.object({
  categoryId: z.union([
    z.coerce.number().int().positive(),
    z.null(),
    z.literal("none"),
    z.literal(""),
  ]).optional().transform(val => {
    if (val === "none" || val === null || val === "" || val === undefined) return null;
    if (typeof val === "number" && val > 0) return val;
    return null;
  }),
  localId: z.union([
    z.coerce.number().int().positive(),
    z.null(),
  ]).optional().transform(val => {
    if (val === null || val === undefined) return val;
    if (typeof val === "number" && val > 0) return val;
    return null;
  }),
  invoiced: z.union([z.boolean(), z.coerce.boolean()]).optional(),
}).strict();

async function getClientId(req: any): Promise<number> {
  const session = req.session as any;
  if (session?.userId) {
    const client = await storage.getClientByUserId(session.userId);
    if (!client) throw new Error("Client not found");
    return client.id;
  }
  
  const user = req.user as any;
  if (!user?.claims?.sub) throw new Error("User not authenticated");
  
  // First try by claim sub (Replit Auth ID)
  let client = await storage.getClientByUserId(user.claims.sub);
  
  // If not found, try to find user by email and get their client
  if (!client && user.claims.email) {
    const dbUser = await storage.getUserByEmail(user.claims.email);
    if (dbUser) {
      client = await storage.getClientByUserId(dbUser.id);
    }
  }
  
  if (!client) throw new Error("Client not found");
  
  return client.id;
}

const isAuthenticated = (req: any, res: any, next: any) => {
  const session = req.session as any;
  if (session?.userId) {
    return next();
  }
  return isAuthenticatedOIDC(req, res, next);
};

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

  app.get("/api/health", (_req, res) => {
    res.status(200).json({ status: "ok", timestamp: Date.now() });
  });

  await setupLocalAuth(app);
  await setupAuth(app);

  app.get("/api/auth/user", async (req, res) => {
    const session = req.session as any;
    if (session?.userId) {
      const dbUser = await storage.getUser(session.userId);
      return res.json(dbUser || null);
    }
    
    const user = req.user as any;
    if (!user?.claims?.sub) {
      return res.json(null);
    }
    
    // First try by ID
    let dbUser = await storage.getUser(user.claims.sub);
    
    // If not found by ID, try by email (user might exist with different ID)
    if (!dbUser && user.claims.email) {
      dbUser = await storage.getUserByEmail(user.claims.email);
    }
    
    res.json(dbUser || null);
  });

  app.get("/api/locals", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.getLocals(clientId);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/locals", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.createLocal({ ...req.body, clientId });
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/locals/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.updateLocal(clientId, parseInt(req.params.id), req.body);
      if (!data) return res.status(404).json({ message: "Local not found or access denied" });
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/locals/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const deleted = await storage.deleteLocal(clientId, parseInt(req.params.id));
      if (!deleted) return res.status(404).json({ message: "Local not found or access denied" });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/local-aliases", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.getLocalAliases(clientId);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/local-aliases", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const { localId, alias, source } = req.body;
      
      if (!localId || !alias) {
        return res.status(400).json({ message: "Se requiere localId y alias" });
      }
      
      const existing = await storage.getLocalAliasByName(clientId, alias);
      if (existing) {
        return res.status(400).json({ message: "Ya existe un alias con ese nombre" });
      }
      
      const data = await storage.createLocalAlias({ 
        clientId, 
        localId, 
        alias, 
        source: source || "mercadopago" 
      });
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/local-aliases/bulk", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const { mappings } = req.body;
      
      if (!Array.isArray(mappings)) {
        return res.status(400).json({ message: "Se requiere un array de mappings" });
      }
      
      const created: any[] = [];
      const errors: string[] = [];
      
      for (const mapping of mappings) {
        const { localId, alias, source } = mapping;
        if (!localId || !alias) continue;
        
        try {
          const existing = await storage.getLocalAliasByName(clientId, alias);
          if (!existing) {
            const newAlias = await storage.createLocalAlias({ 
              clientId, 
              localId, 
              alias, 
              source: source || "mercadopago" 
            });
            created.push(newAlias);
          }
        } catch (err: any) {
          errors.push(`${alias}: ${err.message}`);
        }
      }
      
      res.json({ created: created.length, errors });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/local-aliases/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const deleted = await storage.deleteLocalAlias(clientId, parseInt(req.params.id));
      if (!deleted) return res.status(404).json({ message: "Alias not found or access denied" });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/suppliers", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.getSuppliers(clientId);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/suppliers", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const { cuit } = req.body;
      
      if (cuit) {
        const existing = await storage.getSupplierByCuit(clientId, cuit);
        if (existing) {
          return res.status(400).json({ message: "Ya existe un proveedor con ese CUIT" });
        }
      }
      
      const data = await storage.createSupplier({ ...req.body, clientId });
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/suppliers/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const supplierId = parseInt(req.params.id);
      const { cuit } = req.body;
      
      if (cuit) {
        const existing = await storage.getSupplierByCuit(clientId, cuit);
        if (existing && existing.id !== supplierId) {
          return res.status(400).json({ message: "Ya existe otro proveedor con ese CUIT" });
        }
      }
      
      const data = await storage.updateSupplier(clientId, supplierId, req.body);
      if (!data) return res.status(404).json({ message: "Supplier not found or access denied" });
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/suppliers/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const supplierId = parseInt(req.params.id);

      // Antes de borrar, verificamos si tiene facturas asociadas
      const allInvoices = await storage.getInvoices(clientId);
      const hasInvoices = allInvoices.some((inv: any) => inv.supplierId === supplierId);

      if (hasInvoices) {
        return res.status(400).json({
          message:
            "No se puede eliminar el proveedor porque tiene facturas asociadas. " +
            "Anula o reasigna primero esas facturas.",
        });
      }

      const deleted = await storage.deleteSupplier(clientId, supplierId);
      if (!deleted) return res.status(404).json({ message: "Supplier not found or access denied" });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/suppliers/export", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const suppliers = await storage.getSuppliers(clientId);
      
      const exportData = suppliers.map(s => ({
        "Nombre Comercial": s.tradeName || "",
        "Razon Social": s.businessName || "",
        "CUIT": s.cuit || "",
        "Condicion IVA": s.ivaCondition || "",
        "Email": s.email || "",
        "Telefono": s.phone || "",
        "Direccion": s.address || "",
        "Dias de Pago": s.paymentDays || 0,
        "Activo": s.active ? "Si" : "No",
      }));
      
      const worksheet = XLSX.utils.json_to_sheet(exportData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Proveedores");
      
      const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

      // JSON+base64: evita corrupción binaria en Netlify/serverless (ZIP interno del .xlsx).
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.json({
        fileName: "proveedores.xlsx",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        data: Buffer.from(buffer as Uint8Array).toString("base64"),
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/suppliers/import", isAuthenticated, upload.single("file"), async (req, res) => {
    try {
      const clientId = await getClientId(req);
      
      if (!req.file) {
        return res.status(400).json({ message: "No se proporciono archivo" });
      }
      
      let workbook: XLSX.WorkBook;
      try {
        workbook = XLSX.read(req.file.buffer, { type: "buffer" });
      } catch (err: any) {
        return res.status(400).json({
          message:
            "El archivo no es un Excel (.xlsx) válido o está corrupto. " +
            "Si lo exportaste desde Data Flow y Excel no lo abre, re-exportá desde la versión más nueva. " +
            `Detalle: ${err?.message || String(err)}`,
        });
      }
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const rawData = XLSX.utils.sheet_to_json(sheet) as any[];
      
      let imported = 0;
      let errors: string[] = [];
      
      for (const row of rawData) {
        try {
          const tradeName = row["Nombre Comercial"] || row["nombre_comercial"] || row["tradeName"];
          if (!tradeName) {
            errors.push("Fila sin nombre comercial");
            continue;
          }
          
          const supplierData = {
            clientId,
            tradeName,
            businessName: row["Razon Social"] || row["razon_social"] || row["businessName"] || null,
            cuit: row["CUIT"] || row["cuit"] || null,
            ivaCondition: row["Condicion IVA"] || row["condicion_iva"] || row["ivaCondition"] || null,
            email: row["Email"] || row["email"] || null,
            phone: row["Telefono"] || row["telefono"] || row["phone"] || null,
            address: row["Direccion"] || row["direccion"] || row["address"] || null,
            paymentDays: parseInt(row["Dias de Pago"] || row["dias_pago"] || row["paymentDays"]) || 0,
          };
          
          if (supplierData.cuit) {
            const existing = await storage.getSupplierByCuit(clientId, supplierData.cuit);
            if (existing) {
              errors.push(`CUIT ${supplierData.cuit} ya existe`);
              continue;
            }
          }
          
          await storage.createSupplier(supplierData);
          imported++;
        } catch (err: any) {
          errors.push(err.message);
        }
      }
      
      res.json({ imported, total: rawData.length, errors: errors.slice(0, 10) });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/rubros", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.getRubros(clientId);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/rubros", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.createRubro({ ...req.body, clientId });
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/rubros/export", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const rubros = await storage.getRubros(clientId);
      
      const exportData = rubros.map(r => ({
        "Nombre": r.name,
        "Descripcion": r.description || "",
      }));
      
      const worksheet = XLSX.utils.json_to_sheet(exportData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Rubros");
      
      const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

      // JSON+base64: evita corrupción binaria en Netlify/serverless (ZIP interno del .xlsx).
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.json({
        fileName: "rubros.xlsx",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        data: Buffer.from(buffer as Uint8Array).toString("base64"),
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/rubros/import", isAuthenticated, upload.single("file"), async (req, res) => {
    try {
      const clientId = await getClientId(req);
      
      if (!req.file) {
        return res.status(400).json({ message: "No se proporciono archivo" });
      }
      
      let workbook: XLSX.WorkBook;
      try {
        workbook = XLSX.read(req.file.buffer, { type: "buffer" });
      } catch (err: any) {
        return res.status(400).json({
          message:
            "El archivo no es un Excel (.xlsx) válido o está corrupto. " +
            `Detalle: ${err?.message || String(err)}`,
        });
      }
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const rawData = XLSX.utils.sheet_to_json(sheet) as any[];

      let imported = 0;
      let errors: string[] = [];

      for (const row of rawData) {
        try {
          const name = row["Nombre"] || row["nombre"] || row["name"];
          if (!name) {
            errors.push("Fila sin nombre");
            continue;
          }
          
          await storage.createRubro({
            clientId,
            name,
            description: row["Descripcion"] || row["descripcion"] || row["description"] || null,
          });
          imported++;
        } catch (err: any) {
          errors.push(err.message);
        }
      }
      
      res.json({ imported, total: rawData.length, errors: errors.slice(0, 10) });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/rubros/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.updateRubro(clientId, parseInt(req.params.id), req.body);
      if (!data) return res.status(404).json({ message: "Rubro not found or access denied" });
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/rubros/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const deleted = await storage.deleteRubro(clientId, parseInt(req.params.id));
      if (!deleted) return res.status(404).json({ message: "Rubro not found or access denied" });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Sub-Rubros endpoints
  const createSubRubroSchema = z.object({
    rubroId: z.coerce.number().int().positive("Debe seleccionar un rubro"),
    name: z.string().min(1, "El nombre es requerido"),
    description: z.string().optional(),
    active: z.boolean().optional().default(true),
  });

  const updateSubRubroSchema = z.object({
    rubroId: z.coerce.number().int().positive().optional(),
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    active: z.boolean().optional(),
  });

  app.get("/api/sub-rubros", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.getSubRubros(clientId);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/sub-rubros", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const parsed = createSubRubroSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0]?.message || "Datos invalidos" });
      }
      
      const rubros = await storage.getRubros(clientId);
      const rubroExists = rubros.some(r => r.id === parsed.data.rubroId);
      if (!rubroExists) {
        return res.status(400).json({ message: "El rubro seleccionado no existe o no tiene permisos" });
      }
      
      const data = await storage.createSubRubro({ ...parsed.data, clientId });
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/sub-rubros/by-rubro/:rubroId", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.getSubRubrosByRubro(clientId, parseInt(req.params.rubroId));
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/sub-rubros/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const parsed = updateSubRubroSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0]?.message || "Datos invalidos" });
      }
      
      if (parsed.data.rubroId) {
        const rubros = await storage.getRubros(clientId);
        const rubroExists = rubros.some(r => r.id === parsed.data.rubroId);
        if (!rubroExists) {
          return res.status(400).json({ message: "El rubro seleccionado no existe o no tiene permisos" });
        }
      }
      
      const data = await storage.updateSubRubro(clientId, parseInt(req.params.id), parsed.data);
      if (!data) return res.status(404).json({ message: "Sub-Rubro not found or access denied" });
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/sub-rubros/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const deleted = await storage.deleteSubRubro(clientId, parseInt(req.params.id));
      if (!deleted) return res.status(404).json({ message: "Sub-Rubro not found or access denied" });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/taxes", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.getTaxes(clientId);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/taxes", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.createTax({ ...req.body, clientId });
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/taxes/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.updateTax(clientId, parseInt(req.params.id), req.body);
      if (!data) return res.status(404).json({ message: "Tax not found or access denied" });
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/taxes/seed-argentina", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const existingTaxes = await storage.getTaxes(clientId);
      
      const masterTaxes = [
        { name: "IVA 21%", percentage: "21", type: "iva", active: true },
        { name: "IVA 10.5%", percentage: "10.5", type: "iva", active: true },
        { name: "IVA 27%", percentage: "27", type: "iva", active: false },
        { name: "IVA Exento", percentage: "0", type: "iva", active: false },
        { name: "IVA No Gravado", percentage: "0", type: "iva", active: false },
        { name: "Percepcion IVA", percentage: "3", type: "percepcion", active: false },
        { name: "Percepcion IIBB CABA", percentage: "3", type: "percepcion", active: false },
        { name: "Percepcion IIBB Buenos Aires", percentage: "2.5", type: "percepcion", active: false },
        { name: "Percepcion IIBB Cordoba", percentage: "2.5", type: "percepcion", active: false },
        { name: "Percepcion IIBB Santa Fe", percentage: "2.5", type: "percepcion", active: false },
        { name: "IIBB CABA", percentage: "3", type: "iibb", active: false },
        { name: "IIBB Buenos Aires", percentage: "3.5", type: "iibb", active: false },
        { name: "IIBB Cordoba", percentage: "3", type: "iibb", active: false },
        { name: "IIBB Santa Fe", percentage: "3.6", type: "iibb", active: false },
        { name: "Impuesto Interno 8%", percentage: "8", type: "interno", active: false },
        { name: "Impuesto Interno 20%", percentage: "20", type: "interno", active: false },
        { name: "Retencion Ganancias", percentage: "2", type: "retencion", active: false },
        { name: "Retencion IVA", percentage: "50", type: "retencion", active: false },
      ];

      let created = 0;
      let skipped = 0;
      for (const tax of masterTaxes) {
        const exists = existingTaxes.find(
          t => t.name.toLowerCase() === tax.name.toLowerCase()
        );
        if (!exists) {
          await storage.createTax({ ...tax, clientId });
          created++;
        } else {
          skipped++;
        }
      }
      
      res.json({ 
        message: `Catalogo importado: ${created} creados, ${skipped} ya existian`,
        created,
        skipped,
        total: masterTaxes.length,
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/taxes/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const deleted = await storage.deleteTax(clientId, parseInt(req.params.id));
      if (!deleted) return res.status(404).json({ message: "Tax not found or access denied" });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/units", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.getUnits(clientId);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/units", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.createUnit({ ...req.body, clientId });
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/units/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.updateUnit(clientId, parseInt(req.params.id), req.body);
      if (!data) return res.status(404).json({ message: "Unit not found or access denied" });
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/units/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const deleted = await storage.deleteUnit(clientId, parseInt(req.params.id));
      if (!deleted) return res.status(404).json({ message: "Unit not found or access denied" });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/supplies", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.getSupplies(clientId);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/supplies", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.createSupply({ ...req.body, clientId });
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/supplies/export", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const supplies = await storage.getSupplies(clientId);
      const rubros = await storage.getRubros(clientId);
      const units = await storage.getUnits(clientId);
      
      const rubroMap = new Map(rubros.map(r => [r.id, r.name]));
      const unitMap = new Map(units.map(u => [u.id, u.abbreviation || u.name]));
      
      const exportData = supplies.map(s => ({
        "Nombre": s.name,
        "Rubro": s.rubroId ? rubroMap.get(s.rubroId) || "" : "",
        "Unidad": s.unitOfMeasureId ? unitMap.get(s.unitOfMeasureId) || "" : "",
        "Costo Unitario": s.unitCost || "0",
        "Ultimo Costo": s.lastCost || "0",
        "Activo": s.active ? "Si" : "No",
      }));
      
      const worksheet = XLSX.utils.json_to_sheet(exportData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Insumos");
      
      const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

      // JSON+base64: evita corrupción binaria en Netlify/serverless (ZIP interno del .xlsx).
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.json({
        fileName: "insumos.xlsx",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        data: Buffer.from(buffer as Uint8Array).toString("base64"),
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/supplies/import", isAuthenticated, upload.single("file"), async (req, res) => {
    try {
      const clientId = await getClientId(req);
      
      if (!req.file) {
        return res.status(400).json({ message: "No se proporciono archivo" });
      }
      
      const rubros = await storage.getRubros(clientId);
      const units = await storage.getUnits(clientId);
      
      const rubroByName = new Map(rubros.map(r => [r.name.toLowerCase(), r.id]));
      const unitByName = new Map(units.map(u => [(u.abbreviation || u.name).toLowerCase(), u.id]));
      
      let workbook: XLSX.WorkBook;
      try {
        workbook = XLSX.read(req.file.buffer, { type: "buffer" });
      } catch (err: any) {
        return res.status(400).json({
          message:
            "El archivo no es un Excel (.xlsx) válido o está corrupto. " +
            `Detalle: ${err?.message || String(err)}`,
        });
      }
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const rawData = XLSX.utils.sheet_to_json(sheet) as any[];
      
      let imported = 0;
      let errors: string[] = [];
      
      for (const row of rawData) {
        try {
          const name = row["Nombre"] || row["nombre"] || row["name"];
          if (!name) {
            errors.push("Fila sin nombre");
            continue;
          }
          
          const rubroName = row["Rubro"] || row["rubro"];
          const unitName = row["Unidad"] || row["unidad"];
          
          const rubroId = rubroName ? rubroByName.get(rubroName.toLowerCase()) : null;
          const unitOfMeasureId = unitName ? unitByName.get(unitName.toLowerCase()) : null;
          
          const unitCost = parseFloat(row["Costo Unitario"] || row["costo_unitario"] || row["unitCost"] || "0") || 0;
          const lastCost = parseFloat(row["Ultimo Costo"] || row["ultimo_costo"] || row["lastCost"] || "0") || 0;
          
          await storage.createSupply({
            clientId,
            name,
            rubroId: rubroId || null,
            unitOfMeasureId: unitOfMeasureId || null,
            unitCost: String(unitCost),
            lastCost: String(lastCost),
          });
          imported++;
        } catch (err: any) {
          errors.push(err.message);
        }
      }
      
      res.json({ imported, total: rawData.length, errors: errors.slice(0, 10) });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/supplies/:id/usages", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const id = parseInt(req.params.id);
      if (Number.isNaN(id)) return res.status(400).json({ message: "ID invalido" });
      const detail = await storage.getSupplyUsageDetail(clientId, id);
      if (!detail) return res.status(404).json({ message: "Insumo no encontrado" });
      res.json(detail);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/supplies/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.updateSupply(clientId, parseInt(req.params.id), req.body);
      if (!data) return res.status(404).json({ message: "Supply not found or access denied" });
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/supplies/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const deleted = await storage.deleteSupply(clientId, parseInt(req.params.id));
      if (!deleted) return res.status(404).json({ message: "Supply not found or access denied" });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Supply-Supplier relationships
  app.get("/api/supply-suppliers", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.getSupplySuppliers(clientId);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/supply-suppliers/:supplyId", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.getSupplySuppliersBySupply(clientId, parseInt(req.params.supplyId));
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.put("/api/supply-suppliers/:supplyId", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const { supplierIds } = req.body;
      await storage.setSupplySuppliers(clientId, parseInt(req.params.supplyId), supplierIds || []);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/supplier-rubros", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.getSupplierRubros(clientId);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/supplier-rubros/:supplierId", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.getSupplierRubrosBySupplier(clientId, parseInt(req.params.supplierId));
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.put("/api/supplier-rubros/:supplierId", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const supplierId = parseInt(req.params.supplierId);
      const allSuppliers = await storage.getSuppliers(clientId);
      const supplier = allSuppliers.find(s => s.id === supplierId);
      if (!supplier) return res.status(404).json({ message: "Proveedor no encontrado" });
      const { rubroIds } = req.body;
      await storage.setSupplierRubros(clientId, supplierId, rubroIds || []);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/invoices", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.getInvoices(clientId);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/invoices/stats", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const invoices = await storage.getInvoices(clientId);
      
      const today = new Date();
      const thisMonth = today.getMonth();
      const thisYear = today.getFullYear();
      
      const total = invoices.length;
      const pending = invoices.filter(i => !i.paid && parseFloat(String(i.balance) || "0") > 0).length;
      const overdue = invoices.filter(i => {
        if (i.paid) return false;
        if (!i.dueDate) return false;
        return new Date(i.dueDate) < today;
      }).length;
      const thisMonthTotal = invoices
        .filter(i => {
          const d = new Date(i.invoiceDate);
          return d.getMonth() === thisMonth && d.getFullYear() === thisYear;
        })
        .reduce((sum, i) => sum + parseFloat(String(i.total) || "0"), 0);
      
      res.json({ total, pending, overdue, thisMonth: thisMonthTotal });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/invoices/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.getInvoice(clientId, parseInt(req.params.id));
      if (!data) return res.status(404).json({ message: "Invoice not found or access denied" });
      const items = await storage.getInvoiceItems(data.id);
      const taxes = await storage.getInvoiceTaxes(data.id);
      res.json({ ...data, items, taxes });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/invoices", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const { items, taxes, ...invoice } = req.body;
      
      if (invoice.invoiceNumber && invoice.supplierId) {
        const existing = await storage.getInvoiceByNumber(clientId, invoice.invoiceNumber, invoice.supplierId);
        if (existing) {
          return res.status(400).json({ message: "Ya existe una factura con ese numero para este proveedor" });
        }
      }
      
      const invoiceDate = new Date(invoice.invoiceDate);
      const paymentDays = invoice.paymentDays || 0;
      const dueDate = new Date(invoiceDate);
      dueDate.setDate(dueDate.getDate() + paymentDays);
      
      const data = await storage.createInvoice(
        { ...invoice, clientId, dueDate: dueDate.toISOString().split("T")[0] },
        items || [],
        taxes || []
      );
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/invoices/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const deleted = await storage.deleteInvoice(clientId, parseInt(req.params.id));
      if (!deleted) return res.status(404).json({ message: "Invoice not found or access denied" });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/invoices/:id/reverse", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const { reason } = req.body;
      const userId = (req.user as any)?.id || "system";
      
      if (!reason || reason.trim().length < 5) {
        return res.status(400).json({ message: "El motivo de reversion debe tener al menos 5 caracteres" });
      }
      
      const reversed = await storage.reverseInvoice(
        clientId, 
        parseInt(req.params.id), 
        userId, 
        reason
      );
      
      if (!reversed) {
        return res.status(400).json({ message: "No se pudo revertir la factura. Puede que ya este revertida o no exista." });
      }
      
      res.json(reversed);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/payments", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.getPayments(clientId);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/payments", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const { allocations, supplierId, localId, ...paymentData } = req.body;

      const allInvoices = await storage.getInvoices(clientId);
      const pending = allInvoices.filter(i =>
        i.supplierId === supplierId &&
        (!localId || i.localId === localId) &&
        !i.paid &&
        parseFloat(String(i.balance) || "0") > 0
      );

      const hasPending = pending.length > 0;
      const hasAllocations = allocations && Array.isArray(allocations) && allocations.length > 0;

      if (hasPending && !hasAllocations) {
        return res.status(400).json({
          message: "Debes imputar el pago a una o mas facturas pendientes de este proveedor.",
        });
      }

      if (hasAllocations) {
        const data = await storage.createPaymentWithAllocations(
          { ...paymentData, supplierId, localId, clientId },
          allocations
        );
        return res.json(data);
      } else {
        const data = await storage.createPayment({ ...paymentData, supplierId, localId, clientId });
        return res.json(data);
      }
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/payments/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const deleted = await storage.deletePayment(clientId, parseInt(req.params.id));
      if (!deleted) return res.status(404).json({ message: "Payment not found or access denied" });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/supplier-accounts", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const localId = req.query.localId ? parseInt(req.query.localId as string) : undefined;
      const rubroId = req.query.rubroId ? parseInt(req.query.rubroId as string) : undefined;
      
      let suppliersList = await storage.getSuppliers(clientId);
      const allInvoices = await storage.getInvoices(clientId);
      const allPayments = await storage.getPayments(clientId);
      
      if (rubroId) {
        suppliersList = suppliersList.filter(s => s.rubroId === rubroId);
      }
      
      const today = new Date();
      const accounts = suppliersList.map(s => {
        let supplierInvoices = allInvoices.filter(i => i.supplierId === s.id && i.status === 'active');
        if (localId) {
          supplierInvoices = supplierInvoices.filter(i => i.localId === localId);
        }
        
        const totalInvoiced = supplierInvoices.reduce((sum, i) => sum + parseFloat(String(i.total) || "0"), 0);
        const totalDebt = supplierInvoices.reduce((sum, i) => sum + parseFloat(String(i.balance) || "0"), 0);
        const overdueInvoices = supplierInvoices.filter(i => {
          if (parseFloat(String(i.balance) || "0") <= 0) return false;
          if (!i.dueDate) return false;
          return new Date(i.dueDate) < today;
        });
        const overdueDebt = overdueInvoices.reduce((sum, i) => sum + parseFloat(String(i.balance) || "0"), 0);
        
        let supplierPayments = allPayments.filter(p => p.supplierId === s.id);
        if (localId) {
          supplierPayments = supplierPayments.filter(p => p.localId === localId);
        }
        const totalPaid = supplierPayments.reduce((sum, p) => sum + parseFloat(String(p.amount) || "0"), 0);
        
        return {
          ...s,
          totalDebt,
          overdueDebt,
          invoiceCount: supplierInvoices.length,
          overdueCount: overdueInvoices.length,
          totalPaid,
          // Campo auxiliar opcional para ver diferencias entre facturado, pagos y saldo
          // que podremos usar en el futuro para mostrar creditos no aplicados.
          // appliedPaid: Math.max(0, totalInvoiced - totalDebt),
        };
      });
      
      const totalDebtAll = accounts.reduce((sum, a) => sum + a.totalDebt, 0);
      const totalOverdueAll = accounts.reduce((sum, a) => sum + a.overdueDebt, 0);
      const totalInvoicesAll = accounts.reduce((sum, a) => sum + a.invoiceCount, 0);
      const totalOverdueCountAll = accounts.reduce((sum, a) => sum + a.overdueCount, 0);
      
      res.json({
        accounts,
        stats: {
          totalDebt: totalDebtAll,
          totalOverdue: totalOverdueAll,
          totalInvoices: totalInvoicesAll,
          totalOverdueCount: totalOverdueCountAll,
        }
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/supplier-accounts/export", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const localId = req.query.localId ? parseInt(req.query.localId as string) : undefined;
      const rubroId = req.query.rubroId ? parseInt(req.query.rubroId as string) : undefined;
      const suppliersList = await storage.getSuppliers(clientId);
      const allInvoices = await storage.getInvoices(clientId);
      const allPayments = await storage.getPayments(clientId);
      const allRubros = await storage.getRubros(clientId);
      const rubroMap = new Map(allRubros.map(r => [r.id, r.name]));
      const today = new Date();
      
      const filtered = rubroId ? suppliersList.filter(s => s.rubroId === rubroId) : suppliersList;
      
      const exportData: any[] = [];
      filtered.forEach(s => {
        let supplierInvoices = allInvoices.filter(i => i.supplierId === s.id && i.status === 'active');
        if (localId) supplierInvoices = supplierInvoices.filter(i => i.localId === localId);
        let supplierPayments = allPayments.filter(p => p.supplierId === s.id);
        if (localId) supplierPayments = supplierPayments.filter(p => p.localId === localId);
        
        const totalDebt = supplierInvoices.reduce((sum, i) => sum + parseFloat(String(i.balance) || "0"), 0);
        const totalPaid = supplierPayments.reduce((sum, p) => sum + parseFloat(String(p.amount) || "0"), 0);
        const overdueDebt = supplierInvoices.filter(i => {
          if (parseFloat(String(i.balance) || "0") <= 0) return false;
          return i.dueDate && new Date(i.dueDate) < today;
        }).reduce((sum, i) => sum + parseFloat(String(i.balance) || "0"), 0);
        
        exportData.push({
          "Proveedor": s.tradeName || s.businessName || "",
          "Razon Social": s.businessName || "",
          "CUIT": s.cuit || "",
          "Rubro": s.rubroId ? (rubroMap.get(s.rubroId) || "") : "",
          "Total Facturas": supplierInvoices.length,
          "Total Facturado $": supplierInvoices.reduce((sum, i) => sum + parseFloat(String(i.total) || "0"), 0),
          "Total Pagado $": totalPaid,
          "Deuda Total $": totalDebt,
          "Deuda Vencida $": overdueDebt,
          "Facturas Vencidas": supplierInvoices.filter(i => parseFloat(String(i.balance) || "0") > 0 && i.dueDate && new Date(i.dueDate) < today).length,
        });
      });
      
      const worksheet = XLSX.utils.json_to_sheet(exportData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Cuentas Corrientes");
      const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", "attachment; filename=cuentas_corrientes.xlsx");
      res.send(buffer);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/recipe-categories", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.getRecipeCategories(clientId);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/recipe-categories", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.createRecipeCategory({ ...req.body, clientId });
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/recipe-categories/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.updateRecipeCategory(clientId, parseInt(req.params.id), req.body);
      if (!data) return res.status(404).json({ message: "Recipe category not found or access denied" });
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/recipe-categories/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const deleted = await storage.deleteRecipeCategory(clientId, parseInt(req.params.id));
      if (!deleted) return res.status(404).json({ message: "Recipe category not found or access denied" });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/recipe-subcategories", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.getRecipeSubcategories(clientId);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/recipe-subcategories", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.createRecipeSubcategory({ ...req.body, clientId });
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/recipe-subcategories/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.updateRecipeSubcategory(
        clientId,
        parseInt(req.params.id),
        req.body,
      );
      if (!data) return res.status(404).json({ message: "Subcategoria no encontrada" });
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/recipe-subcategories/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const deleted = await storage.deleteRecipeSubcategory(clientId, parseInt(req.params.id));
      if (!deleted) {
        return res.status(400).json({
          message:
            "No se puede eliminar: hay recetas que usan esta subcategoria, o no existe.",
        });
      }
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/recipes", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const [recipes, categories, subcategories] = await Promise.all([
        storage.getRecipes(clientId),
        storage.getRecipeCategories(clientId),
        storage.getRecipeSubcategories(clientId),
      ]);

      const categoryById = new Map(categories.map((c) => [c.id, c]));
      const subById = new Map(subcategories.map((s) => [s.id, s]));
      const ingredientLists = await Promise.all(
        recipes.map((recipe) => storage.getRecipeIngredients(recipe.id)),
      );

      const data = recipes.map((recipe, index) => {
        const sub = recipe.subcategoryId ? subById.get(recipe.subcategoryId) : undefined;
        const categoryFromSub = sub?.recipeCategory ?? null;
        const category =
          categoryFromSub ||
          (recipe.categoryId ? categoryById.get(recipe.categoryId) || null : null);
        return {
          ...recipe,
          category,
          subcategory: sub ?? null,
          ingredientCount: ingredientLists[index]?.length || 0,
        };
      });

      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/recipes/export", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const recipes = await storage.getRecipes(clientId);
      const categories = await storage.getRecipeCategories(clientId);
      const subcategories = await storage.getRecipeSubcategories(clientId);
      const catMap = new Map(categories.map(c => [c.id, c.name]));
      const subMap = new Map(subcategories.map((s) => [s.id, s]));

      const platos = recipes.filter(r => r.recipeType !== 'sub');
      const activePlatos = platos.filter(r => r.active);
      const avgCmv = activePlatos.length > 0
        ? activePlatos.reduce((sum, r) => sum + parseFloat(String(r.cmvPercentage) || "0"), 0) / activePlatos.length : 0;
      const avgMargin = activePlatos.length > 0
        ? activePlatos.reduce((sum, r) => sum + parseFloat(String(r.marginPercentage) || "0"), 0) / activePlatos.length : 0;
      const avgMarkup = activePlatos.length > 0
        ? activePlatos.reduce((sum, r) => sum + parseFloat(String(r.markup) || "0"), 0) / activePlatos.length : 0;
      
      const summarySheet = XLSX.utils.json_to_sheet([{
        "Total Recetas": platos.length,
        "Activas": activePlatos.length,
        "Inactivas": platos.length - activePlatos.length,
        "CMV Promedio %": `${avgCmv.toFixed(2)}%`,
        "Margen Promedio %": `${avgMargin.toFixed(2)}%`,
        "Markup Promedio %": `${avgMarkup.toFixed(2)}%`,
      }]);
      
      const detailData = platos.map((r) => {
        const sub = r.subcategoryId ? subMap.get(r.subcategoryId) : undefined;
        const categoriaNombre =
          sub?.recipeCategory?.name ||
          (r.categoryId ? catMap.get(r.categoryId) || "" : "");
        return {
        "Categoria": categoriaNombre,
        "Subcategoria": sub?.name || "",
        "Nombre": r.name,
        "Ingredientes": (r as any).ingredientCount || 0,
        "Costo MP $ (sin IVA)": parseFloat(String(r.totalCost) || "0").toFixed(2),
        "Precio Venta $ (sin IVA)": parseFloat(String(r.salePrice) || "0").toFixed(2),
        "Precio Venta $ (con IVA)": parseFloat(String(r.salePriceWithTax) || "0").toFixed(2),
        "CMV %": `${parseFloat(String(r.cmvPercentage) || "0").toFixed(2)}%`,
        "Margen $": parseFloat(String(r.margin) || "0").toFixed(2),
        "Margen %": `${parseFloat(String(r.marginPercentage) || "0").toFixed(2)}%`,
        "Markup %": `${parseFloat(String(r.markup) || "0").toFixed(2)}%`,
        "CMV Ideal %": r.cmvIdeal ? `${parseFloat(String(r.cmvIdeal)).toFixed(2)}%` : "",
        "Dif CMV %": r.cmvIdeal ? `${(parseFloat(String(r.cmvPercentage) || "0") - parseFloat(String(r.cmvIdeal) || "0")).toFixed(2)}%` : "",
        "Estado": r.active ? "Activo" : "Inactivo",
        "Fecha Creacion": r.createdAt ? new Date(r.createdAt).toLocaleDateString("es-AR") : "",
      };
      });
      const detailSheet = XLSX.utils.json_to_sheet(detailData);
      
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, summarySheet, "Resumen Carta");
      XLSX.utils.book_append_sheet(workbook, detailSheet, "Detalle Platos");
      const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", "attachment; filename=carta_recetas.xlsx");
      res.send(buffer);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/recipes/stats", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const recipes = await storage.getRecipes(clientId);
      
      const platos = recipes.filter(r => r.recipeType !== 'sub');
      const subRecetas = recipes.filter(r => r.recipeType === 'sub');
      const activePlatos = platos.filter(r => r.active);
      const activeSubRecetas = subRecetas.filter(r => r.active);
      
      const avgCmv = activePlatos.length > 0
        ? activePlatos.reduce((sum, r) => sum + parseFloat(String(r.cmvPercentage) || "0"), 0) / activePlatos.length
        : 0;
      const avgMargin = activePlatos.length > 0
        ? activePlatos.reduce((sum, r) => sum + parseFloat(String(r.marginPercentage) || "0"), 0) / activePlatos.length
        : 0;
      const avgMarkup = activePlatos.length > 0
        ? activePlatos.reduce((sum, r) => sum + parseFloat(String(r.markup) || "0"), 0) / activePlatos.length
        : 0;
      
      res.json({
        totalRecipes: platos.length,
        activeRecipes: activePlatos.length,
        inactiveRecipes: platos.length - activePlatos.length,
        avgCmv: Math.round(avgCmv * 100) / 100,
        avgMargin: Math.round(avgMargin * 100) / 100,
        avgMarkup: Math.round(avgMarkup * 100) / 100,
        totalSubRecipes: subRecetas.length,
        activeSubRecipes: activeSubRecetas.length,
        inactiveSubRecipes: subRecetas.length - activeSubRecetas.length,
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/recipes", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const { ingredients, ...recipe } = req.body;
      const data = await storage.createRecipe({ ...recipe, clientId }, ingredients || []);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/recipes/:id/parent-usages", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const id = parseInt(req.params.id);
      if (Number.isNaN(id)) return res.status(400).json({ message: "ID invalido" });
      const detail = await storage.getSubRecipeParentUsageDetail(clientId, id);
      if (!detail) return res.status(404).json({ message: "Sub-receta no encontrada" });
      res.json(detail);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/recipes/:id/photo", isAuthenticated, upload.single("photo"), async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const recipeId = parseInt(req.params.id);
      if (!req.file) return res.status(400).json({ message: "No se proporciono imagen" });
      
      const fs = await import("fs");
      const path = await import("path");
      const uploadsDir = path.default.join(process.cwd(), "uploads");
      if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
      
      const ext = req.file.originalname.split(".").pop() || "jpg";
      const filename = `recipe_${recipeId}_${Date.now()}.${ext}`;
      const filepath = path.default.join(uploadsDir, filename);
      fs.writeFileSync(filepath, req.file.buffer);
      
      const photoUrl = `/uploads/${filename}`;
      const data = await storage.updateRecipe(clientId, recipeId, { photoUrl }, undefined);
      if (!data) return res.status(404).json({ message: "Recipe not found" });
      res.json({ photoUrl });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/recipes/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.getRecipe(clientId, parseInt(req.params.id));
      if (!data) return res.status(404).json({ message: "Recipe not found or access denied" });
      const ingredients = await storage.getRecipeIngredients(data.id);
      res.json({ ...data, ingredients });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/recipes/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const id = parseInt(req.params.id);
      const { ingredients, ...recipe } = req.body;
      if (Array.isArray(ingredients) && ingredients.some((ing: any) => Number(ing?.subRecipeId) === id)) {
        return res.status(400).json({ message: "Una sub-receta no puede incluirse a si misma como ingrediente" });
      }
      const data = await storage.updateRecipe(clientId, id, recipe, ingredients);
      if (!data) return res.status(404).json({ message: "Recipe not found or access denied" });
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/recipes/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const deleted = await storage.deleteRecipe(clientId, parseInt(req.params.id));
      if (!deleted) return res.status(404).json({ message: "Recipe not found or access denied" });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/cost-history", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.getCostHistory(clientId);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/category-groups", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.getCategoryGroups(clientId);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ==========================================
  // FINANCIAL GROUPS (Grupos Financieros)
  // ==========================================
  app.get("/api/financial-groups", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.getFinancialGroups(clientId);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/financial-groups", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.createFinancialGroup({ ...req.body, clientId });
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/financial-groups/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.updateFinancialGroup(clientId, parseInt(req.params.id), req.body);
      if (!data) return res.status(404).json({ message: "Grupo financiero no encontrado" });
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/financial-groups/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const groupId = parseInt(req.params.id);
      
      const categories = await storage.getTransactionCategories(clientId);
      const hasLinkedCategories = categories.some(c => c.financialGroupId === groupId);
      
      if (hasLinkedCategories) {
        return res.status(400).json({ 
          message: "No se puede eliminar el grupo porque tiene categorias asociadas. Reasigne las categorias primero." 
        });
      }
      
      const deleted = await storage.deleteFinancialGroup(clientId, groupId);
      if (!deleted) return res.status(404).json({ message: "Grupo financiero no encontrado" });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/financial-groups/seed", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const result = await seedFinancialDataForClient(clientId);
      res.json({ 
        success: true, 
        message: `Creados ${result.groups} grupos y ${result.categories} categorías`,
        ...result 
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ==========================================
  // CLIENT BANKS (Bancos del cliente)
  // ==========================================
  app.get("/api/client-banks", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.getClientBanks(clientId);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/client-banks", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.createClientBank({ ...req.body, clientId });
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/client-banks/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.updateClientBank(clientId, parseInt(req.params.id), req.body);
      if (!data) return res.status(404).json({ message: "Banco no encontrado" });
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/client-banks/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const deleted = await storage.deleteClientBank(clientId, parseInt(req.params.id));
      if (!deleted) return res.status(404).json({ message: "Banco no encontrado" });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/transaction-categories", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.getTransactionCategories(clientId);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/transaction-categories", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.createTransactionCategory({ ...req.body, clientId });
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/transaction-categories/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.updateTransactionCategory(clientId, parseInt(req.params.id), req.body);
      if (!data) return res.status(404).json({ message: "Transaction category not found or access denied" });
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/transaction-categories/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const deleted = await storage.deleteTransactionCategory(clientId, parseInt(req.params.id));
      if (!deleted) return res.status(404).json({ message: "Transaction category not found or access denied" });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/bank-accounts", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.getBankAccounts(clientId);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/transactions", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const data = await storage.getTransactions(clientId);
      const categories = await storage.getTransactionCategories(clientId);
      const allLocals = await storage.getLocals(clientId);
      const bankAccountsList = await storage.getBankAccounts(clientId);

      const catMap = new Map(categories.map(c => [c.id, c]));
      const localMap = new Map(allLocals.map(l => [l.id, l]));
      const bankMap = new Map(bankAccountsList.map(b => [b.id, b]));

      const enriched = data.map(t => ({
        ...t,
        category: t.categoryId ? catMap.get(t.categoryId) || null : null,
        local: t.localId ? localMap.get(t.localId) || null : null,
        bankAccount: t.bankAccountId ? bankMap.get(t.bankAccountId) || null : null,
      }));

      res.json(enriched);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/available-banks", isAuthenticated, async (req, res) => {
    try {
      const banks = getAvailableBanks();
      res.json(banks);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/transactions/import", isAuthenticated, upload.single("file"), async (req, res) => {
    try {
      console.log("[IMPORT] Starting import request");
      const clientId = await getClientId(req);
      const session = req.session as any;
      const userId = session?.userId || (req.user as any)?.claims?.sub;
      const bankId = req.body.bankId || "generic";
      
      console.log(`[IMPORT] Client: ${clientId}, Bank: ${bankId}, File size: ${req.file?.size || 0} bytes`);
      
      if (!req.file) {
        return res.status(400).json({ message: "No se proporciono archivo" });
      }

      console.log("[IMPORT] Parsing Excel file...");
      const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];
      console.log(`[IMPORT] Excel parsed: ${rawData.length} rows`);

      if (rawData.length < 2) {
        return res.status(400).json({ message: "El archivo esta vacio o no tiene datos" });
      }

      const parser = getBankParser(bankId);
      console.log(`[IMPORT] Using parser: ${parser.bankName}`);
      const parseResult = parser.parse(rawData);
      console.log(`[IMPORT] Parsed: ${parseResult.transactions.length} transactions, ${parseResult.skipped} skipped`);
      
      const unmappedBranches: string[] = [];
      const branchAliasCache: Map<string, number | null> = new Map();
      
      const importBatchId = `${bankId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      console.log(`[IMPORT] Batch ID: ${importBatchId}`);
      console.log("[IMPORT] Preparing transactions for batch insert...");
      const transactionsToInsert = [];
      
      for (const tx of parseResult.transactions) {
        let localId: number | undefined = undefined;
        
        if (tx.branchName) {
          if (branchAliasCache.has(tx.branchName)) {
            const cached = branchAliasCache.get(tx.branchName);
            localId = cached ?? undefined;
          } else {
            const alias = await storage.getLocalAliasByName(clientId, tx.branchName);
            if (alias) {
              localId = alias.localId;
              branchAliasCache.set(tx.branchName, alias.localId);
            } else {
              branchAliasCache.set(tx.branchName, null);
              if (!unmappedBranches.includes(tx.branchName)) {
                unmappedBranches.push(tx.branchName);
              }
            }
          }
        }
        
        transactionsToInsert.push({
          clientId,
          localId,
          transactionDate: tx.date,
          description: tx.description,
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
      
      const imported = await storage.createTransactionsBatch(transactionsToInsert);
      console.log(`[IMPORT] Complete: ${imported} imported`);
      
      res.json({ 
        imported, 
        total: parseResult.total,
        skipped: parseResult.skipped,
        skippedReasons: parseResult.skippedReasons.slice(0, 10),
        bankUsed: parser.bankName,
        unmappedBranches: unmappedBranches.length > 0 ? unmappedBranches : undefined
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/transactions/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      
      const parseResult = updateTransactionSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ message: "Campos invalidos", errors: parseResult.error.errors });
      }
      
      const safeUpdate: { categoryId?: number | null; localId?: number | null; invoiced?: boolean } = {};
      if (parseResult.data.categoryId !== undefined) {
        safeUpdate.categoryId = parseResult.data.categoryId;
      }
      if (parseResult.data.localId !== undefined) {
        safeUpdate.localId = parseResult.data.localId;
      }
      if (parseResult.data.invoiced !== undefined) {
        safeUpdate.invoiced = parseResult.data.invoiced;
      }
      
      if (Object.keys(safeUpdate).length === 0) {
        return res.status(400).json({ message: "No hay campos para actualizar" });
      }
      
      const updated = await storage.updateTransaction(clientId, parseInt(req.params.id), safeUpdate);
      if (!updated) return res.status(404).json({ message: "Transaction not found" });
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/transactions/import-batches", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const batches = await storage.getImportBatches(clientId);
      res.json(batches);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/transactions/batch/:batchId", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const { confirmCode } = req.body;
      if (confirmCode !== "ELIMINAR") {
        return res.status(400).json({ message: "Codigo de confirmacion incorrecto" });
      }
      const deleted = await storage.deleteTransactionBatch(clientId, req.params.batchId);
      if (deleted === 0) return res.status(404).json({ message: "Extracto no encontrado" });
      res.json({ success: true, deleted });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/transactions/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const deleted = await storage.deleteTransaction(clientId, parseInt(req.params.id));
      if (!deleted) return res.status(404).json({ message: "Transaction not found" });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/transactions/batch-categorize", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const { transactionIds, categoryId, localId, dateFrom, dateTo, description } = req.body;

      if (!categoryId && categoryId !== null) {
        return res.status(400).json({ message: "Se requiere categoryId" });
      }

      const allTransactions = await storage.getTransactions(clientId);
      const tenantTxIds = new Set(allTransactions.map(t => t.id));
      
      let idsToUpdate: number[] = [];
      
      if (transactionIds && Array.isArray(transactionIds) && transactionIds.length > 0) {
        const requestedIds = transactionIds.map((id: any) => parseInt(id));
        idsToUpdate = requestedIds.filter(id => tenantTxIds.has(id));
        
        if (idsToUpdate.length !== requestedIds.length) {
          return res.status(403).json({ 
            message: "Algunas transacciones no pertenecen a este cliente" 
          });
        }
      } else if (description && typeof description === "string") {
        idsToUpdate = allTransactions
          .filter(t => t.description === description && !t.categoryId)
          .map(t => t.id);
      } else if (dateFrom && dateTo) {
        const from = new Date(dateFrom);
        const to = new Date(dateTo);
        to.setHours(23, 59, 59, 999);
        
        idsToUpdate = allTransactions
          .filter(t => {
            const txDate = new Date(t.transactionDate);
            return txDate >= from && txDate <= to && !t.categoryId;
          })
          .map(t => t.id);
      }

      if (idsToUpdate.length === 0) {
        return res.status(400).json({ message: "No hay transacciones para actualizar" });
      }

      let updated = 0;
      for (const id of idsToUpdate) {
        const updateData: any = { categoryId: categoryId || null };
        if (localId !== undefined) updateData.localId = localId || null;
        const result = await storage.updateTransaction(clientId, id, updateData);
        if (result) updated++;
      }

      res.json({ 
        success: true, 
        updated,
        total: idsToUpdate.length,
        message: `Se categorizaron ${updated} de ${idsToUpdate.length} transacciones`
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/transactions/:id/split", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const parentId = parseInt(req.params.id);
      const { splits } = req.body;

      if (!splits || !Array.isArray(splits) || splits.length < 2) {
        return res.status(400).json({ message: "Se requieren al menos 2 splits" });
      }

      const allTransactions = await storage.getTransactions(clientId);
      const parent = allTransactions.find(t => t.id === parentId);
      
      if (!parent) {
        return res.status(404).json({ message: "Transaccion no encontrada" });
      }

      if (parent.parentTransactionId) {
        return res.status(400).json({ message: "No se puede dividir una transaccion que ya es un split" });
      }

      const totalSplit = splits.reduce((sum: number, s: any) => sum + parseFloat(s.amount), 0);
      const parentAmount = Math.abs(parseFloat(String(parent.amount)));
      
      if (Math.abs(totalSplit - parentAmount) > 0.01) {
        return res.status(400).json({ 
          message: `La suma de los splits (${totalSplit}) no coincide con el monto original (${parentAmount})`
        });
      }

      const createdSplits = [];
      for (const split of splits) {
        const newSplit = await storage.createTransaction({
          clientId,
          transactionDate: parent.transactionDate,
          description: `${parent.description} (${split.localName || 'Split'})`,
          amount: parent.type === "expense" 
            ? String(-Math.abs(parseFloat(split.amount))) 
            : String(Math.abs(parseFloat(split.amount))),
          type: parent.type,
          source: "split",
          categoryId: split.categoryId || parent.categoryId,
          localId: split.localId || null,
          parentTransactionId: parentId,
        });
        createdSplits.push(newSplit);
      }

      await storage.updateTransaction(clientId, parentId, { invoiced: true });

      res.json({ 
        success: true, 
        splits: createdSplits,
        message: `Transaccion dividida en ${createdSplits.length} partes`
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/transactions/:id/splits", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const parentId = parseInt(req.params.id);
      
      const allTransactions = await storage.getTransactions(clientId);
      const splits = allTransactions.filter(t => t.parentTransactionId === parentId);
      
      res.json(splits);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/transactions/:id/splits", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const parentId = parseInt(req.params.id);
      
      const allTransactions = await storage.getTransactions(clientId);
      const splits = allTransactions.filter(t => t.parentTransactionId === parentId);
      
      if (splits.length === 0) {
        return res.status(404).json({ message: "No hay splits para esta transaccion" });
      }

      for (const split of splits) {
        await storage.deleteTransaction(clientId, split.id);
      }

      await storage.updateTransaction(clientId, parentId, { invoiced: false });

      res.json({ 
        success: true, 
        deleted: splits.length,
        message: `Se eliminaron ${splits.length} splits`
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/monthly-balances", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const year = parseInt(req.query.year as string) || new Date().getFullYear();
      const data = await storage.getMonthlyBalances(clientId, year);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/balance-spreadsheet", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const year = parseInt(req.query.year as string) || new Date().getFullYear();
      const localId = req.query.localId && req.query.localId !== "all" 
        ? parseInt(req.query.localId as string) 
        : undefined;
      const data = await storage.getBalanceSpreadsheet(clientId, year, localId);
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/balance-report/export", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const year = parseInt(req.query.year as string) || new Date().getFullYear();
      const month = Math.min(12, Math.max(1, parseInt(req.query.month as string) || new Date().getMonth() + 1));
      const localId = req.query.localId && req.query.localId !== "all"
        ? parseInt(req.query.localId as string)
        : undefined;
      const format = String(req.query.format || "pdf").toLowerCase();

      const spreadsheet = await storage.getBalanceSpreadsheet(clientId, year, localId);
      const fullMonths = [
        "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
        "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
      ];
      const monthlyVentas = spreadsheet.summary.income[month] ?? 0;
      const monthlyGastos = spreadsheet.summary.expenses[month] ?? 0;
      const monthlyUtilidad = monthlyVentas - monthlyGastos;
      const prevMonth = month === 1 ? 12 : month - 1;
      const prevVentas = spreadsheet.summary.income[prevMonth] ?? 0;
      const evolucionVentas = prevVentas > 0 ? ((monthlyVentas - prevVentas) / prevVentas) * 100 : null;
      const utilidadPercent = monthlyVentas > 0 ? (monthlyUtilidad / monthlyVentas) * 100 : 0;

      const expenseGroups = spreadsheet.groups.filter((g) => g.type === "expense");
      const groupedExpenseLines = expenseGroups.map((group) => {
        const categories = group.categories.map((cat) => {
          const amount = cat.monthlyTotals[month] ?? 0;
          const percent = monthlyVentas > 0 ? (amount / monthlyVentas) * 100 : 0;
          return { name: cat.name, amount, percent };
        });

        const amountFromCategories = categories.reduce((sum, cat) => sum + cat.amount, 0);
        const amountFromGroup = group.monthlyTotals[month] ?? 0;
        const groupAmount = group.categories.length > 0 ? amountFromCategories : amountFromGroup;
        const groupPercent = monthlyVentas > 0 ? (groupAmount / monthlyVentas) * 100 : 0;

        return {
          groupName: group.name,
          groupAmount,
          groupPercent,
          categories,
        };
      });

      if (format === "pdf") {
        const { default: PDFDocument } = await import("pdfkit");
        const doc = new PDFDocument({ size: "A4", margin: 40 });

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename=balance_mensual_${year}_${String(month).padStart(2, "0")}.pdf`);
        doc.pipe(res);

        const currencyFmt = new Intl.NumberFormat("es-AR", {
          style: "currency",
          currency: "ARS",
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        });

        const rightX = 520;
        const writeRow = (label: string, value: string, options?: { bold?: boolean; color?: string }) => {
          if (options?.bold) doc.font("Helvetica-Bold");
          else doc.font("Helvetica");
          if (options?.color) doc.fillColor(options.color);
          else doc.fillColor("black");
          doc.text(label, 40, doc.y, { continued: true });
          doc.text(value, rightX, doc.y, { align: "right" });
          doc.moveDown(0.2);
        };

        doc.font("Helvetica-Bold").fontSize(13).text(`EMPRESA`, 40, 42);
        doc.font("Helvetica-Bold").fontSize(13).text(`${fullMonths[month - 1]} ${year}`, rightX - 120, 42, { width: 120, align: "right" });
        doc.moveDown(1.5);

        writeRow("Evolucion de Ventas", evolucionVentas === null ? "N/A" : `${evolucionVentas.toFixed(2)}%`);
        writeRow("Ventas", currencyFmt.format(monthlyVentas), { bold: true, color: "#0f766e" });
        doc.moveDown(0.4);

        doc.font("Helvetica-Bold").fillColor("black").text("GASTOS");
        doc.moveDown(0.3);
        for (const group of groupedExpenseLines) {
          writeRow(group.groupName, currencyFmt.format(group.groupAmount), { bold: true });
          for (const cat of group.categories) {
            writeRow(`  ${cat.name}`, currencyFmt.format(cat.amount));
          }
        }
        writeRow("GASTOS TOTALES", currencyFmt.format(monthlyGastos), { bold: true, color: "#b91c1c" });
        writeRow("Utilidad", currencyFmt.format(monthlyUtilidad), {
          bold: true,
          color: monthlyUtilidad >= 0 ? "#15803d" : "#b91c1c",
        });
        doc.moveDown(0.4);

        doc.font("Helvetica-Bold").fillColor("black").text("GASTOS / UT EN %");
        doc.moveDown(0.3);
        for (const group of groupedExpenseLines) {
          writeRow(group.groupName, `${group.groupPercent.toFixed(2)}%`, { bold: true });
          for (const cat of group.categories) {
            writeRow(`  ${cat.name}`, `${cat.percent.toFixed(2)}%`);
          }
        }
        doc.font("Helvetica-Bold").fillColor("black").text("TOTAL");
        writeRow("Utilidad", `${utilidadPercent.toFixed(2)}%`, {
          bold: true,
          color: utilidadPercent >= 0 ? "#15803d" : "#b91c1c",
        });

        doc.end();
        return;
      }

      if (format === "xlsx") {
        const rows: Array<Record<string, string | number>> = [];
        rows.push({ Concepto: "EMPRESA", Valor: `${fullMonths[month - 1]} ${year}` });
        rows.push({ Concepto: "Evolucion de Ventas", Valor: evolucionVentas === null ? "N/A" : `${evolucionVentas.toFixed(2)}%` });
        rows.push({ Concepto: "Ventas", Valor: Number(monthlyVentas.toFixed(2)) });
        rows.push({ Concepto: "", Valor: "" });
        rows.push({ Concepto: "GASTOS", Valor: "" });
        for (const group of groupedExpenseLines) {
          rows.push({ Concepto: group.groupName, Valor: Number(group.groupAmount.toFixed(2)) });
          for (const cat of group.categories) {
            rows.push({ Concepto: `  ${cat.name}`, Valor: Number(cat.amount.toFixed(2)) });
          }
        }
        rows.push({ Concepto: "GASTOS TOTALES", Valor: Number(monthlyGastos.toFixed(2)) });
        rows.push({ Concepto: "Utilidad", Valor: Number(monthlyUtilidad.toFixed(2)) });
        rows.push({ Concepto: "", Valor: "" });
        rows.push({ Concepto: "GASTOS / UT EN %", Valor: "" });
        for (const group of groupedExpenseLines) {
          rows.push({ Concepto: group.groupName, Valor: `${group.groupPercent.toFixed(2)}%` });
          for (const cat of group.categories) {
            rows.push({ Concepto: `  ${cat.name}`, Valor: `${cat.percent.toFixed(2)}%` });
          }
        }
        rows.push({ Concepto: "TOTAL", Valor: "" });
        rows.push({ Concepto: "Utilidad", Valor: `${utilidadPercent.toFixed(2)}%` });

        const worksheet = XLSX.utils.json_to_sheet(rows);
        worksheet["!cols"] = [{ wch: 46 }, { wch: 20 }];
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Balance Mensual");
        const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", `attachment; filename=balance_mensual_${year}_${String(month).padStart(2, "0")}.xlsx`);
        res.send(buffer);
        return;
      }

      return res.status(400).json({ message: "Formato no soportado. Usa format=pdf o format=xlsx" });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/dashboard/stats", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const year = parseInt(req.query.year as string) || new Date().getFullYear();
      const localId = req.query.localId as string;
      
      const invoices = await storage.getInvoices(clientId);
      const recipes = await storage.getRecipes(clientId);
      const allSales = await storage.getSales(clientId);
      
      const today = new Date();
      const oneWeekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
      const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      const startOfYear = new Date(year, 0, 1);
      const endOfYear = new Date(year, 11, 31);
      
      const filteredInvoices = invoices.filter(inv => {
        if (localId && localId !== "all" && inv.localId !== parseInt(localId)) return false;
        return true;
      });
      
      const filteredSales = allSales.filter(sale => {
        if (localId && localId !== "all" && sale.localId !== parseInt(localId)) return false;
        return true;
      });
      
      const yearlyInvoices = filteredInvoices.filter(inv => {
        const d = new Date(inv.invoiceDate);
        return d >= startOfYear && d <= endOfYear;
      });
      
      const yearlySales = filteredSales.filter(sale => {
        const d = new Date(sale.saleDate);
        return d >= startOfYear && d <= endOfYear;
      });
      
      const monthlySales = filteredSales.filter(sale => {
        const d = new Date(sale.saleDate);
        return d >= startOfMonth && d <= today;
      });
      
      const weeklySales = filteredSales.filter(sale => {
        const d = new Date(sale.saleDate);
        return d >= oneWeekAgo && d <= today;
      });
      
      const yearlyExpenses = yearlyInvoices.reduce((sum, inv) => sum + parseFloat(String(inv.total) || "0"), 0);
      const yearlySalesTotal = yearlySales.reduce((sum, sale) => sum + parseFloat(String(sale.total) || "0"), 0);
      const monthlySalesTotal = monthlySales.reduce((sum, sale) => sum + parseFloat(String(sale.total) || "0"), 0);
      const weeklySalesTotal = weeklySales.reduce((sum, sale) => sum + parseFloat(String(sale.total) || "0"), 0);
      
      const productSalesMap = new Map<string, { name: string; quantity: number; total: number }>();
      yearlySales.forEach(sale => {
        const name = sale.productName;
        const existing = productSalesMap.get(name) || { name, quantity: 0, total: 0 };
        existing.quantity += parseFloat(String(sale.quantity) || "0");
        existing.total += parseFloat(String(sale.total) || "0");
        productSalesMap.set(name, existing);
      });
      
      const topProducts = Array.from(productSalesMap.values())
        .sort((a, b) => b.total - a.total)
        .slice(0, 10);
      
      const topMarginRecipes = recipes
        .filter(r => r.active && parseFloat(String(r.margin) || "0") > 0)
        .sort((a, b) => parseFloat(String(b.margin) || "0") - parseFloat(String(a.margin) || "0"))
        .slice(0, 10)
        .map(r => ({
          name: r.name,
          margin: parseFloat(String(r.margin) || "0"),
          marginPercentage: parseFloat(String(r.salePrice) || "0") > 0 
            ? (parseFloat(String(r.margin) || "0") / parseFloat(String(r.salePrice) || "0")) * 100 
            : 0,
        }));
      
      const paymentMethodMap = new Map<string, number>();
      yearlySales.forEach(sale => {
        const method = sale.paymentMethod || "Otro";
        paymentMethodMap.set(method, (paymentMethodMap.get(method) || 0) + parseFloat(String(sale.total) || "0"));
      });
      
      const paymentMethods = Array.from(paymentMethodMap.entries())
        .map(([method, total]) => ({
          method,
          total,
          percentage: yearlySalesTotal > 0 ? (total / yearlySalesTotal) * 100 : 0,
        }))
        .sort((a, b) => b.total - a.total);
      
      const invoicedSales = yearlySales.filter(s => s.invoiced).reduce((sum, s) => sum + parseFloat(String(s.total) || "0"), 0);
      const notInvoicedSales = yearlySalesTotal - invoicedSales;
      
      res.json({
        weeklySales: weeklySalesTotal,
        monthlySales: monthlySalesTotal,
        yearlyStats: { 
          sales: yearlySalesTotal, 
          expenses: yearlyExpenses, 
          profit: yearlySalesTotal - yearlyExpenses 
        },
        topProducts: topProducts.length > 0 ? topProducts : recipes
          .filter(r => r.active && parseFloat(String(r.salePrice) || "0") > 0)
          .sort((a, b) => parseFloat(String(b.salePrice) || "0") - parseFloat(String(a.salePrice) || "0"))
          .slice(0, 10)
          .map(r => ({ name: r.name, quantity: 0, total: parseFloat(String(r.salePrice) || "0") })),
        topCategories: [],
        topMargins: topMarginRecipes,
        paymentMethods: paymentMethods.length > 0 ? paymentMethods : [
          { method: "Efectivo", total: 0, percentage: 40 },
          { method: "Transferencia", total: 0, percentage: 35 },
          { method: "Tarjeta", total: 0, percentage: 25 },
        ],
        invoicedVsNot: { invoiced: invoicedSales, notInvoiced: notInvoicedSales },
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ==========================================
  // PERMISSIONS API
  // ==========================================
  
  app.get("/api/permissions", isAuthenticated, async (req, res) => {
    try {
      const perms = await storage.getPermissions();
      res.json(perms);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/permissions/seed", isAuthenticated, async (req, res) => {
    try {
      const defaultPermissions = [
        { code: "dashboard.view", name: "Ver Dashboard", module: "dashboard" },
        { code: "suppliers.view", name: "Ver Proveedores", module: "suppliers" },
        { code: "suppliers.create", name: "Crear Proveedores", module: "suppliers" },
        { code: "suppliers.edit", name: "Editar Proveedores", module: "suppliers" },
        { code: "suppliers.delete", name: "Eliminar Proveedores", module: "suppliers" },
        { code: "supplies.view", name: "Ver Insumos", module: "supplies" },
        { code: "supplies.create", name: "Crear Insumos", module: "supplies" },
        { code: "supplies.edit", name: "Editar Insumos", module: "supplies" },
        { code: "supplies.delete", name: "Eliminar Insumos", module: "supplies" },
        { code: "invoices.view", name: "Ver Facturas", module: "invoices" },
        { code: "invoices.create", name: "Crear Facturas", module: "invoices" },
        { code: "invoices.edit", name: "Editar Facturas", module: "invoices" },
        { code: "invoices.delete", name: "Eliminar Facturas", module: "invoices" },
        { code: "payments.view", name: "Ver Pagos", module: "payments" },
        { code: "payments.create", name: "Registrar Pagos", module: "payments" },
        { code: "recipes.view", name: "Ver Recetas", module: "recipes" },
        { code: "recipes.create", name: "Crear Recetas", module: "recipes" },
        { code: "recipes.edit", name: "Editar Recetas", module: "recipes" },
        { code: "recipes.delete", name: "Eliminar Recetas", module: "recipes" },
        { code: "bank.view", name: "Ver Extractos Bancarios", module: "bank" },
        { code: "bank.import", name: "Importar Extractos", module: "bank" },
        { code: "transactions.view", name: "Ver Transacciones", module: "transactions" },
        { code: "transactions.edit", name: "Categorizar Transacciones", module: "transactions" },
        { code: "balances.view", name: "Ver Balances P&G", module: "balances" },
        { code: "stock.view", name: "Ver Stock", module: "stock" },
        { code: "stock.adjust", name: "Ajustar Stock", module: "stock" },
        { code: "audits.view", name: "Ver Auditorías", module: "audits" },
        { code: "audits.create", name: "Realizar Auditorías", module: "audits" },
        { code: "employees.view", name: "Ver Empleados", module: "employees" },
        { code: "employees.manage", name: "Gestionar Empleados", module: "employees" },
        { code: "payroll.view", name: "Ver Liquidaciones", module: "payroll" },
        { code: "payroll.manage", name: "Gestionar Liquidaciones", module: "payroll" },
        { code: "settings.view", name: "Ver Configuración", module: "settings" },
        { code: "settings.manage", name: "Gestionar Configuración", module: "settings" },
        { code: "users.view", name: "Ver Usuarios", module: "users" },
        { code: "users.manage", name: "Gestionar Usuarios", module: "users" },
      ];

      for (const perm of defaultPermissions) {
        try {
          await storage.createPermission(perm);
        } catch (e) {
          // Ignore duplicates
        }
      }
      
      const allPerms = await storage.getPermissions();
      res.json(allPerms);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/role-permissions", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const role = req.query.role as string;
      const perms = await storage.getRolePermissions(clientId, role);
      res.json(perms);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/role-permissions", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const result = await storage.setRolePermission({ ...req.body, clientId });
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/role-permissions/:role/:permissionId", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const deleted = await storage.deleteRolePermission(
        clientId, 
        req.params.role, 
        parseInt(req.params.permissionId)
      );
      res.json({ success: deleted });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ==========================================
  // USER LOCAL ASSIGNMENTS API
  // ==========================================

  app.get("/api/user-local-assignments", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const userId = req.query.userId as string;
      const assignments = await storage.getUserLocalAssignments(clientId, userId);
      res.json(assignments);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/user-local-assignments", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const assignment = await storage.createUserLocalAssignment({ ...req.body, clientId });
      res.json(assignment);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/user-local-assignments/:id", isAuthenticated, async (req, res) => {
    try {
      const updated = await storage.updateUserLocalAssignment(parseInt(req.params.id), req.body);
      if (!updated) return res.status(404).json({ message: "Asignación no encontrada" });
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/user-local-assignments/:id", isAuthenticated, async (req, res) => {
    try {
      const deleted = await storage.deleteUserLocalAssignment(parseInt(req.params.id));
      res.json({ success: deleted });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ==========================================
  // NOTIFICATIONS API
  // ==========================================

  app.get("/api/notifications", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const user = req.user as any;
      const notifs = await storage.getNotifications(clientId, user?.id);
      res.json(notifs);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/notifications", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const notification = await storage.createNotification({ ...req.body, clientId });
      res.json(notification);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/notifications/:id/read", isAuthenticated, async (req, res) => {
    try {
      const updated = await storage.markNotificationRead(parseInt(req.params.id));
      if (!updated) return res.status(404).json({ message: "Notificación no encontrada" });
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ==========================================
  // STOCK API
  // ==========================================

  app.get("/api/stock-levels", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const localId = req.query.localId ? parseInt(req.query.localId as string) : undefined;
      const levels = await storage.getStockLevels(clientId, localId);
      res.json(levels);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/stock-levels", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const level = await storage.upsertStockLevel({ ...req.body, clientId });
      res.json(level);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/stock-movements", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const localId = req.query.localId ? parseInt(req.query.localId as string) : undefined;
      const movements = await storage.getStockMovements(clientId, localId);
      res.json(movements);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/stock-movements", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const user = req.user as any;
      const movement = await storage.createStockMovement({ ...req.body, clientId, createdBy: user?.id });
      res.json(movement);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/stock-adjustments", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const localId = req.query.localId ? parseInt(req.query.localId as string) : undefined;
      const adjustments = await storage.getStockAdjustments(clientId, localId);
      res.json(adjustments);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/stock-adjustments", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const user = req.user as any;
      
      const adjustment = await storage.createStockAdjustment({ 
        ...req.body, 
        clientId, 
        createdBy: user?.id 
      });
      
      // Update stock level with new actual count
      await storage.upsertStockLevel({
        clientId,
        localId: req.body.localId,
        supplyId: req.body.supplyId,
        actualStock: req.body.actualCount,
        theoreticalStock: req.body.actualCount,
        lastCountDate: new Date(),
      });
      
      res.json(adjustment);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ==========================================
  // AUDIT TEMPLATES API
  // ==========================================

  app.get("/api/audit-templates", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const templates = await storage.getAuditTemplates(clientId);
      res.json(templates);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/audit-templates/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const template = await storage.getAuditTemplate(clientId, parseInt(req.params.id));
      if (!template) return res.status(404).json({ message: "Plantilla no encontrada" });
      
      const items = await storage.getAuditTemplateItems(template.id);
      res.json({ ...template, items });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/audit-templates", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const { items, ...templateData } = req.body;
      
      const template = await storage.createAuditTemplate({ ...templateData, clientId });
      
      if (items && items.length > 0) {
        for (const item of items) {
          await storage.createAuditTemplateItem({ ...item, templateId: template.id });
        }
      }
      
      const allItems = await storage.getAuditTemplateItems(template.id);
      res.json({ ...template, items: allItems });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/audit-templates/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const updated = await storage.updateAuditTemplate(clientId, parseInt(req.params.id), req.body);
      if (!updated) return res.status(404).json({ message: "Plantilla no encontrada" });
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/audit-templates/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const deleted = await storage.deleteAuditTemplate(clientId, parseInt(req.params.id));
      res.json({ success: deleted });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ==========================================
  // OPERATIONAL AUDITS API
  // ==========================================

  app.get("/api/operational-audits", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const localId = req.query.localId ? parseInt(req.query.localId as string) : undefined;
      const audits = await storage.getOperationalAudits(clientId, localId);
      res.json(audits);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/operational-audits/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const audit = await storage.getOperationalAudit(clientId, parseInt(req.params.id));
      if (!audit) return res.status(404).json({ message: "Auditoría no encontrada" });
      
      const results = await storage.getAuditResults(audit.id);
      res.json({ ...audit, results });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/operational-audits", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const user = req.user as any;
      const { results, ...auditData } = req.body;
      
      const audit = await storage.createOperationalAudit({ 
        ...auditData, 
        clientId, 
        auditor: user?.id 
      });
      
      if (results && results.length > 0) {
        for (const result of results) {
          await storage.createAuditResult({ ...result, auditId: audit.id });
        }
      }
      
      const allResults = await storage.getAuditResults(audit.id);
      const approvedCount = allResults.filter(r => r.approved).length;
      const totalCount = allResults.length;
      const percentage = totalCount > 0 ? (approvedCount / totalCount) * 100 : 0;
      
      const updatedAudit = await storage.updateOperationalAudit(clientId, audit.id, {
        totalItems: totalCount,
        approvedItems: approvedCount,
        approvalPercentage: percentage.toString(),
      });
      
      res.json({ ...updatedAudit, results: allResults });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/operational-audits/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const updated = await storage.updateOperationalAudit(clientId, parseInt(req.params.id), req.body);
      if (!updated) return res.status(404).json({ message: "Auditoría no encontrada" });
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/operational-audits/:id/complete", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const auditId = parseInt(req.params.id);
      
      const results = await storage.getAuditResults(auditId);
      const approvedCount = results.filter(r => r.approved).length;
      const totalCount = results.length;
      const percentage = totalCount > 0 ? (approvedCount / totalCount) * 100 : 0;
      
      const updated = await storage.updateOperationalAudit(clientId, auditId, {
        status: "completed",
        completedAt: new Date(),
        totalItems: totalCount,
        approvedItems: approvedCount,
        approvalPercentage: percentage.toString(),
      });
      
      if (!updated) return res.status(404).json({ message: "Auditoría no encontrada" });
      res.json({ ...updated, results });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ==========================================
  // EMPLOYEES API (RRHH)
  // ==========================================

  app.get("/api/employees", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const localId = req.query.localId ? parseInt(req.query.localId as string) : undefined;
      const emps = await storage.getEmployees(clientId, localId);
      res.json(emps);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/employees/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const employee = await storage.getEmployee(clientId, parseInt(req.params.id));
      if (!employee) return res.status(404).json({ message: "Empleado no encontrado" });
      res.json(employee);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/employees", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const employee = await storage.createEmployee({ ...req.body, clientId });
      res.json(employee);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/employees/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const updated = await storage.updateEmployee(clientId, parseInt(req.params.id), req.body);
      if (!updated) return res.status(404).json({ message: "Empleado no encontrado" });
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/employees/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const deleted = await storage.deleteEmployee(clientId, parseInt(req.params.id));
      res.json({ success: deleted });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ==========================================
  // ATTENDANCE API
  // ==========================================

  app.get("/api/attendances", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const employeeId = req.query.employeeId ? parseInt(req.query.employeeId as string) : undefined;
      const date = req.query.date as string | undefined;
      const atts = await storage.getAttendances(clientId, employeeId, date);
      res.json(atts);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/attendances", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const attendance = await storage.createAttendance({ ...req.body, clientId });
      res.json(attendance);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/attendances/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const updated = await storage.updateAttendance(clientId, parseInt(req.params.id), req.body);
      if (!updated) return res.status(404).json({ message: "Registro no encontrado" });
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ==========================================
  // PAYROLL API
  // ==========================================

  app.get("/api/payrolls", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const employeeId = req.query.employeeId ? parseInt(req.query.employeeId as string) : undefined;
      const period = req.query.period as string | undefined;
      const pays = await storage.getPayrolls(clientId, employeeId, period);
      res.json(pays);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/payrolls", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const user = req.user as any;
      
      const baseSalary = parseFloat(req.body.baseSalary || "0");
      const overtime = parseFloat(req.body.overtime || "0");
      const bonuses = parseFloat(req.body.bonuses || "0");
      const deductions = parseFloat(req.body.deductions || "0");
      const netSalary = baseSalary + overtime + bonuses - deductions;
      
      const payroll = await storage.createPayroll({ 
        ...req.body, 
        clientId, 
        createdBy: user?.id,
        netSalary: netSalary.toString(),
      });
      res.json(payroll);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/payrolls/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      if (req.body.baseSalary !== undefined || req.body.overtime !== undefined || 
          req.body.bonuses !== undefined || req.body.deductions !== undefined) {
        const baseSalary = parseFloat(req.body.baseSalary || "0");
        const overtime = parseFloat(req.body.overtime || "0");
        const bonuses = parseFloat(req.body.bonuses || "0");
        const deductions = parseFloat(req.body.deductions || "0");
        req.body.netSalary = (baseSalary + overtime + bonuses - deductions).toString();
      }
      
      const updated = await storage.updatePayroll(clientId, parseInt(req.params.id), req.body);
      if (!updated) return res.status(404).json({ message: "Liquidación no encontrada" });
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ==========================================
  // TEAM/USER MANAGEMENT API
  // ==========================================

  app.get("/api/team/users", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const users = await storage.getClientUsers(clientId);
      res.json(users);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/team/reassign", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const { userId, role } = req.body;
      if (!userId) {
        return res.status(400).json({ message: "userId requerido" });
      }
      await storage.reassignUserToClient(userId, clientId, role || "encargado");
      res.json({ success: true, message: "Usuario reasignado correctamente" });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ==========================================
  // INVITATIONS API
  // ==========================================

  app.get("/api/invitations", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const invites = await storage.getClientInvitations(clientId);
      res.json(invites);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/invitations", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const user = req.user as any;
      const inviteCode = Math.random().toString(36).substring(2, 10).toUpperCase() + 
                         Math.random().toString(36).substring(2, 10).toUpperCase();
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);
      
      const invitation = await storage.createInvitation({
        clientId,
        email: req.body.email || null,
        inviteCode,
        role: req.body.role || "encargado",
        createdBy: user?.id,
        expiresAt,
      });
      res.json(invitation);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/invitations/use/:code", isAuthenticated, async (req, res) => {
    try {
      const session = req.session as any;
      const oidcUser = req.user as any;
      const userId: string | undefined =
        session?.userId || oidcUser?.claims?.sub || oidcUser?.id;
      if (!userId) {
        return res.status(401).json({ message: "No autenticado" });
      }
      const result = await storage.useInvitation(req.params.code, userId);
      if (!result) {
        return res.status(400).json({ message: "Invitación inválida o expirada" });
      }
      res.json({ success: true, message: "Te uniste a la empresa exitosamente" });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/invitations/:id", isAuthenticated, async (req, res) => {
    try {
      const clientId = await getClientId(req);
      const deleted = await storage.deleteInvitation(clientId, parseInt(req.params.id));
      if (!deleted) return res.status(404).json({ message: "Invitación no encontrada" });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/invitations/check/:code", async (req, res) => {
    try {
      const invitation = await storage.getInvitationByCode(req.params.code);
      if (!invitation || invitation.status !== "pending") {
        return res.status(404).json({ valid: false, message: "Invitación no encontrada" });
      }
      if (invitation.expiresAt && new Date(invitation.expiresAt) < new Date()) {
        return res.status(400).json({ valid: false, message: "Invitación expirada" });
      }
      res.json({ valid: true, role: invitation.role });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.use("/api", (req, res) => {
    if (req.method === "OPTIONS") {
      return res.status(204).end();
    }
    res.status(404).json({
      message: `Ruta API no encontrada: ${req.method} ${req.originalUrl}`,
    });
  });

  return httpServer;
}
