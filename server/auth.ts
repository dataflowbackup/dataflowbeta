import bcrypt from "bcrypt";
import crypto from "crypto";
import type { Express, RequestHandler } from "express";
import session from "express-session";
import connectPg from "connect-pg-simple";
import createMemoryStore from "memorystore";
import { z } from "zod";
import { db } from "./db";
import { users, userCredentials, userClients, clients, clientInvitations } from "@shared/schema";
import { eq, or } from "drizzle-orm";

const SALT_ROUNDS = 12;
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_TIME_MINUTES = 15;

const registerSchema = z.object({
  email: z.string().email("Email inválido").optional(),
  username: z.string().min(3).max(50).optional(),
  password: z.string().min(6, "La contraseña debe tener al menos 6 caracteres"),
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  companyName: z.string().min(1).max(200).optional(),
}).refine(data => data.email || data.username, {
  message: "Debe proporcionar email o username",
});

const loginSchema = z.object({
  email: z.string().email().optional(),
  username: z.string().min(3).max(50).optional(),
  password: z.string().min(1, "Contraseña requerida"),
}).refine(data => data.email || data.username, {
  message: "Email o username requerido",
});

const forgotPasswordSchema = z.object({
  email: z.string().email("Email inválido"),
});

const resetPasswordSchema = z.object({
  token: z.string().min(1, "Token requerido"),
  password: z.string().min(6, "La contraseña debe tener al menos 6 caracteres"),
});

export function getSession() {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000;
  const dbUrl = process.env.DATABASE_URL || "";
  const usePgStore =
    dbUrl.startsWith("postgres://") ||
    dbUrl.startsWith("postgresql://") ||
    dbUrl.includes("neon.tech") ||
    dbUrl.includes(".neon.");

  const sessionStore = usePgStore
    ? new (connectPg(session))({
        conString: dbUrl,
        createTableIfMissing: false,
        ttl: sessionTtl,
        tableName: "sessions",
      })
    : new (createMemoryStore(session))({
        checkPeriod: sessionTtl,
      });

  return session({
    secret: process.env.SESSION_SECRET!,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: sessionTtl,
    },
  });
}

async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

async function hashToken(token: string): Promise<string> {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function validateCUIT(cuit: string): boolean {
  const cleaned = cuit.replace(/[-]/g, "");
  if (cleaned.length !== 11 || !/^\d+$/.test(cleaned)) return false;
  
  const mult = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    sum += parseInt(cleaned[i]) * mult[i];
  }
  const mod = sum % 11;
  const verifier = mod === 0 ? 0 : mod === 1 ? 9 : 11 - mod;
  return verifier === parseInt(cleaned[10]);
}

export async function setupLocalAuth(app: Express) {
  app.use(getSession());

  app.post("/api/auth/register", async (req, res) => {
    try {
      const parsed = registerSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0]?.message || "Datos inválidos" });
      }

      const { email, username, password, firstName, lastName, companyName } = parsed.data;
      const normalizedEmail = email?.toLowerCase().trim();
      const normalizedUsername = username?.toLowerCase().trim();

      const existingUser = await db.select().from(users).where(
        or(
          normalizedEmail ? eq(users.email, normalizedEmail) : undefined,
          normalizedUsername ? eq(users.username, normalizedUsername) : undefined
        )
      ).limit(1);

      if (existingUser.length > 0) {
        return res.status(400).json({ message: "El usuario ya existe" });
      }

      const userId = crypto.randomUUID();
      const passwordHash = await hashPassword(password);

      let newUser: any;
      let newClient: any;

      await db.transaction(async (tx) => {
        [newUser] = await tx.insert(users).values({
          id: userId,
          email: normalizedEmail,
          username: normalizedUsername,
          firstName: firstName?.trim(),
          lastName: lastName?.trim(),
          role: "socio",
          isActive: true,
          emailVerified: false,
        }).returning();

        await tx.insert(userCredentials).values({
          userId: newUser.id,
          passwordHash,
          loginType: normalizedEmail ? "email" : "username",
        });

        if (companyName) {
          [newClient] = await tx.insert(clients).values({
            name: companyName.trim(),
          }).returning();

          await tx.insert(userClients).values({
            userId: newUser.id,
            clientId: newClient.id,
            role: "socio",
          });
        }
      });

      (req.session as any).userId = newUser.id;
      (req.session as any).user = {
        id: newUser.id,
        email: newUser.email,
        username: newUser.username,
        firstName: newUser.firstName,
        lastName: newUser.lastName,
        role: newUser.role,
      };

      res.json({
        success: true,
        user: {
          id: newUser.id,
          email: newUser.email,
          username: newUser.username,
          firstName: newUser.firstName,
          lastName: newUser.lastName,
        },
      });
    } catch (e: any) {
      console.error("Register error:", e);
      res.status(500).json({ message: "Error al registrar usuario" });
    }
  });

  // Registro con invitación - usuario se registra y se une a empresa existente
  const registerWithInvitationSchema = z.object({
    email: z.string().email("Email inválido").optional(),
    username: z.string().min(3).max(50).optional(),
    password: z.string().min(6, "La contraseña debe tener al menos 6 caracteres"),
    firstName: z.string().min(1).max(100).optional(),
    lastName: z.string().min(1).max(100).optional(),
    inviteCode: z.string().min(8, "Código de invitación inválido"),
  }).refine(data => data.email || data.username, {
    message: "Debe proporcionar email o username",
  });

  app.post("/api/auth/register-with-invitation", async (req, res) => {
    try {
      const parsed = registerWithInvitationSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0]?.message || "Datos inválidos" });
      }

      const { email, username, password, firstName, lastName, inviteCode } = parsed.data;
      const normalizedEmail = email?.toLowerCase().trim();
      const normalizedUsername = username?.toLowerCase().trim();

      // Verificar que la invitación existe y es válida
      const [invitation] = await db.select().from(clientInvitations)
        .where(eq(clientInvitations.inviteCode, inviteCode)).limit(1);

      if (!invitation) {
        return res.status(400).json({ message: "Código de invitación no válido" });
      }

      if (invitation.status !== "pending") {
        return res.status(400).json({ message: "Esta invitación ya fue utilizada" });
      }

      if (invitation.expiresAt && new Date(invitation.expiresAt) < new Date()) {
        return res.status(400).json({ message: "La invitación ha expirado" });
      }

      // Verificar si el email de la invitación coincide (si se especificó)
      if (invitation.email && normalizedEmail && invitation.email.toLowerCase() !== normalizedEmail) {
        return res.status(400).json({ message: "El email no coincide con la invitación" });
      }

      // Verificar que el usuario no existe
      const existingUser = await db.select().from(users).where(
        or(
          normalizedEmail ? eq(users.email, normalizedEmail) : undefined,
          normalizedUsername ? eq(users.username, normalizedUsername) : undefined
        )
      ).limit(1);

      if (existingUser.length > 0) {
        return res.status(400).json({ message: "El usuario ya existe. Iniciá sesión y usá el código de invitación." });
      }

      const userId = crypto.randomUUID();
      const passwordHash = await hashPassword(password);

      let newUser: any;

      await db.transaction(async (tx) => {
        // Crear usuario SIN crear empresa
        [newUser] = await tx.insert(users).values({
          id: userId,
          email: normalizedEmail,
          username: normalizedUsername,
          firstName: firstName?.trim(),
          lastName: lastName?.trim(),
          role: invitation.role || "encargado",
          isActive: true,
          emailVerified: false,
        }).returning();

        // Crear credenciales
        await tx.insert(userCredentials).values({
          userId: newUser.id,
          passwordHash,
          loginType: normalizedEmail ? "email" : "username",
        });

        // Asociar usuario al cliente de la invitación
        await tx.insert(userClients).values({
          userId: newUser.id,
          clientId: invitation.clientId,
          role: invitation.role || "encargado",
        });

        // Marcar invitación como usada
        await tx.update(clientInvitations)
          .set({
            status: "used",
            usedBy: newUser.id,
            usedAt: new Date(),
          })
          .where(eq(clientInvitations.inviteCode, inviteCode));
      });

      // Iniciar sesión automáticamente
      (req.session as any).userId = newUser.id;
      (req.session as any).user = {
        id: newUser.id,
        email: newUser.email,
        username: newUser.username,
        firstName: newUser.firstName,
        lastName: newUser.lastName,
        role: newUser.role,
      };

      res.json({
        success: true,
        message: "Te registraste y uniste a la empresa exitosamente",
        user: {
          id: newUser.id,
          email: newUser.email,
          username: newUser.username,
          firstName: newUser.firstName,
          lastName: newUser.lastName,
        },
      });
    } catch (e: any) {
      console.error("Register with invitation error:", e);
      res.status(500).json({ message: "Error al registrar usuario" });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    try {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0]?.message || "Datos inválidos" });
      }

      const { email, username, password } = parsed.data;
      const normalizedEmail = email?.toLowerCase().trim();
      const normalizedUsername = username?.toLowerCase().trim();

      const [user] = await db.select().from(users).where(
        or(
          normalizedEmail ? eq(users.email, normalizedEmail) : undefined,
          normalizedUsername ? eq(users.username, normalizedUsername) : undefined
        )
      ).limit(1);

      if (!user) {
        return res.status(401).json({ message: "Credenciales inválidas" });
      }

      if (!user.isActive) {
        return res.status(401).json({ message: "Cuenta desactivada" });
      }

      const [credentials] = await db.select().from(userCredentials)
        .where(eq(userCredentials.userId, user.id)).limit(1);

      if (!credentials) {
        return res.status(401).json({ message: "Credenciales inválidas" });
      }

      const now = new Date();
      const isLocked = credentials.lockedUntil && new Date(credentials.lockedUntil) > now;
      
      if (isLocked) {
        const remaining = Math.ceil((new Date(credentials.lockedUntil!).getTime() - now.getTime()) / 60000);
        return res.status(401).json({ 
          message: `Cuenta bloqueada. Intente nuevamente en ${remaining} minutos` 
        });
      }

      if (credentials.lockedUntil && new Date(credentials.lockedUntil) <= now) {
        await db.update(userCredentials)
          .set({ failedAttempts: 0, lockedUntil: null })
          .where(eq(userCredentials.id, credentials.id));
        credentials.failedAttempts = 0;
      }

      const validPassword = await verifyPassword(password, credentials.passwordHash);

      if (!validPassword) {
        const newAttempts = (credentials.failedAttempts || 0) + 1;
        
        if (newAttempts >= MAX_FAILED_ATTEMPTS) {
          await db.update(userCredentials)
            .set({ 
              failedAttempts: newAttempts,
              lockedUntil: new Date(Date.now() + LOCK_TIME_MINUTES * 60000)
            })
            .where(eq(userCredentials.id, credentials.id));
          
          return res.status(401).json({ 
            message: `Demasiados intentos fallidos. Cuenta bloqueada por ${LOCK_TIME_MINUTES} minutos` 
          });
        }

        await db.update(userCredentials)
          .set({ failedAttempts: newAttempts })
          .where(eq(userCredentials.id, credentials.id));

        return res.status(401).json({ message: "Credenciales inválidas" });
      }

      await db.update(userCredentials)
        .set({ 
          failedAttempts: 0,
          lockedUntil: null,
          lastLogin: new Date()
        })
        .where(eq(userCredentials.id, credentials.id));

      (req.session as any).userId = user.id;
      (req.session as any).user = {
        id: user.id,
        email: user.email,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
      };

      res.json({
        success: true,
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
        },
      });
    } catch (e: any) {
      console.error("Login error:", e);
      res.status(500).json({ message: "Error al iniciar sesión" });
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ message: "Error al cerrar sesión" });
      }
      res.clearCookie("connect.sid");
      res.json({ success: true });
    });
  });

  app.post("/api/auth/forgot-password", async (req, res) => {
    try {
      const parsed = forgotPasswordSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Email inválido" });
      }

      const normalizedEmail = parsed.data.email.toLowerCase().trim();

      const [user] = await db.select().from(users)
        .where(eq(users.email, normalizedEmail)).limit(1);

      if (!user) {
        return res.json({ success: true, message: "Si el email existe, recibirá instrucciones" });
      }

      const resetToken = generateToken();
      const hashedToken = await hashToken(resetToken);
      const resetExpires = new Date(Date.now() + 3600000);

      await db.update(userCredentials)
        .set({ 
          passwordResetToken: hashedToken,
          passwordResetExpires: resetExpires
        })
        .where(eq(userCredentials.userId, user.id));

      console.log(`Password reset token for ${normalizedEmail}: ${resetToken}`);

      res.json({ success: true, message: "Si el email existe, recibirá instrucciones" });
    } catch (e: any) {
      console.error("Forgot password error:", e);
      res.status(500).json({ message: "Error al procesar solicitud" });
    }
  });

  app.post("/api/auth/reset-password", async (req, res) => {
    try {
      const parsed = resetPasswordSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0]?.message || "Datos inválidos" });
      }

      const { token, password } = parsed.data;
      const hashedToken = await hashToken(token);

      const [credentials] = await db.select().from(userCredentials)
        .where(eq(userCredentials.passwordResetToken, hashedToken)).limit(1);

      if (!credentials || !credentials.passwordResetExpires || 
          new Date(credentials.passwordResetExpires) < new Date()) {
        return res.status(400).json({ message: "Token inválido o expirado" });
      }

      const passwordHash = await hashPassword(password);

      await db.update(userCredentials)
        .set({ 
          passwordHash,
          passwordResetToken: null,
          passwordResetExpires: null,
          failedAttempts: 0,
          lockedUntil: null
        })
        .where(eq(userCredentials.id, credentials.id));

      res.json({ success: true, message: "Contraseña actualizada correctamente" });
    } catch (e: any) {
      console.error("Reset password error:", e);
      res.status(500).json({ message: "Error al restablecer contraseña" });
    }
  });

  app.get("/api/auth/session", (req, res) => {
    const session = req.session as any;
    if (session?.user) {
      res.json({ user: session.user });
    } else {
      res.json({ user: null });
    }
  });

  app.get("/api/roles", async (_req, res) => {
    try {
      const { roles } = await import("@shared/schema");
      const allRoles = await db.select().from(roles).where(eq(roles.active, true));
      res.json(allRoles);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });
}

export const isAuthenticatedLocal: RequestHandler = (req, res, next) => {
  const session = req.session as any;
  if (session?.userId) {
    return next();
  }
  res.status(401).json({ message: "No autorizado" });
};

export { validateCUIT };
