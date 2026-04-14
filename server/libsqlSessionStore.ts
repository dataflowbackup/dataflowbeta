import session from "express-session";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { sessions } from "@shared/schema";

type SessionData = session.SessionData;

/** `db` se exporta tipado como PG en `db.ts`; este store solo se usa con libSQL en runtime. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- alinear tipos Drizzle libSQL vs cast en db.ts
const sqliteDb = db as any;

/**
 * Persiste sesiones de express-session en la tabla `sessions` (SQLite / Turso).
 * Necesario en Netlify: con MemoryStore cada instancia de función tiene memoria distinta
 * y la sesión “desaparece” → módulos vacíos o datos intermitentes.
 */
export class LibsqlSessionStore extends session.Store {
  private readonly ttlMs: number;

  constructor(opts: { ttlMs: number }) {
    super();
    this.ttlMs = opts.ttlMs;
  }

  get(sid: string, callback: (err: unknown, sess?: SessionData | null) => void): void {
    void this.doGet(sid)
      .then((s) => callback(null, s))
      .catch((err: unknown) => callback(err));
  }

  private async doGet(sid: string): Promise<SessionData | null> {
    const rows = await sqliteDb.select().from(sessions).where(eq(sessions.sid, sid)).limit(1);
    const row = rows[0];
    if (!row) return null;

    const exp =
      row.expire instanceof Date
        ? row.expire.getTime()
        : typeof row.expire === "number"
          ? row.expire
          : new Date(String(row.expire)).getTime();

    if (!Number.isFinite(exp) || exp < Date.now()) {
      await sqliteDb.delete(sessions).where(eq(sessions.sid, sid));
      return null;
    }

    const raw = row.sess;
    const parsed =
      typeof raw === "string"
        ? (JSON.parse(raw) as SessionData)
        : (raw as SessionData);
    return parsed;
  }

  set(sid: string, sess: SessionData, callback?: (err?: unknown) => void): void {
    void this.doSet(sid, sess)
      .then(() => callback?.())
      .catch((err: unknown) => callback?.(err));
  }

  private async doSet(sid: string, sess: SessionData): Promise<void> {
    const expire = new Date(Date.now() + this.ttlMs);
    const payload = JSON.parse(JSON.stringify(sess)) as Record<string, unknown>;

    await sqliteDb
      .insert(sessions)
      .values({
        sid,
        sess: payload,
        expire,
      })
      .onConflictDoUpdate({
        target: [sessions.sid],
        set: {
          sess: payload,
          expire,
        },
      });
  }

  destroy(sid: string, callback?: (err?: unknown) => void): void {
    void sqliteDb
      .delete(sessions)
      .where(eq(sessions.sid, sid))
      .then(() => callback?.())
      .catch((err: unknown) => callback?.(err));
  }

  touch(sid: string, _sess: SessionData, callback?: () => void): void {
    void this.doTouch(sid)
      .then(() => callback?.())
      .catch(() => callback?.());
  }

  private async doTouch(sid: string): Promise<void> {
    const expire = new Date(Date.now() + this.ttlMs);
    await sqliteDb.update(sessions).set({ expire }).where(eq(sessions.sid, sid));
  }
}
