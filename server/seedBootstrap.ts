import "dotenv/config";
import crypto from "node:crypto";
import bcrypt from "bcrypt";
import { and, eq } from "drizzle-orm";
import { db } from "./db";
import {
  clients,
  locals,
  users,
  userCredentials,
  userClients,
  roles,
} from "@shared/schema";
import { seedFinancialDataForClient } from "./seedFinancialData";

const SALT_ROUNDS = 12;

function getEnv(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

async function ensureClient(clientName: string): Promise<number> {
  const existing = await db
    .select({ id: clients.id })
    .from(clients)
    .where(eq(clients.name, clientName))
    .limit(1);

  if (existing[0]?.id) return existing[0].id;

  const inserted = await db.insert(clients).values({ name: clientName }).returning({
    id: clients.id,
  });
  return inserted[0].id;
}

async function ensureLocal(clientId: number, localName: string): Promise<number> {
  const existing = await db
    .select({ id: locals.id })
    .from(locals)
    .where(and(eq(locals.clientId, clientId), eq(locals.name, localName)))
    .limit(1);

  if (existing[0]?.id) return existing[0].id;

  const inserted = await db
    .insert(locals)
    .values({
      clientId,
      name: localName,
      active: true,
    })
    .returning({ id: locals.id });

  return inserted[0].id;
}

async function ensureRole(clientId: number, code: string, name: string) {
  const existing = await db
    .select({ id: roles.id })
    .from(roles)
    .where(and(eq(roles.clientId, clientId), eq(roles.code, code)))
    .limit(1);

  if (existing[0]?.id) return;

  await db.insert(roles).values({
    clientId,
    code,
    name,
    description: "Rol administrador inicial para beta",
    isSystem: true,
    level: 100,
    active: true,
  });
}

async function ensureAdminUser(params: {
  clientId: number;
  email: string;
  username: string;
  password: string;
  firstName: string;
  lastName: string;
}) {
  const { clientId, email, username, password, firstName, lastName } = params;

  const normalizedEmail = email.trim().toLowerCase();
  const normalizedUsername = username.trim().toLowerCase();

  const existingByEmail = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, normalizedEmail))
    .limit(1);

  const existingByUsername = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, normalizedUsername))
    .limit(1);

  const userId = existingByEmail[0]?.id || existingByUsername[0]?.id || crypto.randomUUID();

  if (!existingByEmail[0] && !existingByUsername[0]) {
    await db.insert(users).values({
      id: userId,
      email: normalizedEmail,
      username: normalizedUsername,
      firstName,
      lastName,
      role: "socio",
      isActive: true,
      emailVerified: true,
    });
  }

  const existingCredentials = await db
    .select({ id: userCredentials.id })
    .from(userCredentials)
    .where(eq(userCredentials.userId, userId))
    .limit(1);

  if (!existingCredentials[0]) {
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    await db.insert(userCredentials).values({
      userId,
      passwordHash,
      loginType: "email",
      failedAttempts: 0,
    });
  }

  const existingMembership = await db
    .select({ id: userClients.id })
    .from(userClients)
    .where(and(eq(userClients.userId, userId), eq(userClients.clientId, clientId)))
    .limit(1);

  if (!existingMembership[0]) {
    await db.insert(userClients).values({
      userId,
      clientId,
      role: "socio",
    });
  }
}

async function run() {
  const clientName = getEnv("SEED_CLIENT_NAME", "DataFlow Beta");
  const localName = getEnv("SEED_LOCAL_NAME", "Casa Central");
  const adminEmail = getEnv("SEED_ADMIN_EMAIL");
  const adminUsername = getEnv("SEED_ADMIN_USERNAME", "admin");
  const adminPassword = getEnv("SEED_ADMIN_PASSWORD");
  const adminFirstName = getEnv("SEED_ADMIN_FIRST_NAME", "Admin");
  const adminLastName = getEnv("SEED_ADMIN_LAST_NAME", "DataFlow");

  const clientId = await ensureClient(clientName);
  const localId = await ensureLocal(clientId, localName);
  await ensureRole(clientId, "socio", "Socio");
  await ensureRole(clientId, "encargado", "Encargado");
  await ensureAdminUser({
    clientId,
    email: adminEmail,
    username: adminUsername,
    password: adminPassword,
    firstName: adminFirstName,
    lastName: adminLastName,
  });

  const financialResult = await seedFinancialDataForClient(clientId);

  console.log("Seed bootstrap OK", {
    clientId,
    localId,
    financialGroupsCreated: financialResult.groups,
    financialCategoriesCreated: financialResult.categories,
    adminEmail,
    adminUsername,
  });
}

run().catch((error) => {
  console.error("Seed bootstrap error:", error);
  process.exit(1);
});
