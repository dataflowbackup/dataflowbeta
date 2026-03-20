import * as client from "openid-client";
import { Strategy, type VerifyFunction } from "openid-client/passport";

import passport from "passport";
import session from "express-session";
import type { Express, RequestHandler } from "express";
import memoize from "memoizee";
import connectPg from "connect-pg-simple";
import { storage } from "./storage";

async function discoverOidcWithRetry(maxRetries = 5, delayMs = 2000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await client.discovery(
        new URL(process.env.ISSUER_URL ?? "https://replit.com/oidc"),
        process.env.REPL_ID!
      );
    } catch (error: any) {
      const isNetworkError = error?.code === 'EAI_AGAIN' || error?.code === 'ENOTFOUND' || 
        error?.message?.includes('getaddrinfo') || error?.message?.includes('EAI_AGAIN') ||
        error?.message?.includes('ENOTFOUND');
      if (isNetworkError && attempt < maxRetries) {
        console.log(`OIDC discovery attempt ${attempt}/${maxRetries} failed (DNS), retrying in ${delayMs}ms...`);
        await new Promise(resolve => setTimeout(resolve, delayMs * attempt));
        continue;
      }
      throw error;
    }
  }
  throw new Error("OIDC discovery failed after all retries");
}

const getOidcConfig = memoize(
  async () => {
    return await discoverOidcWithRetry();
  },
  { maxAge: 3600 * 1000 }
);

export function getSession() {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000; // 1 week
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: false,
    ttl: sessionTtl,
    tableName: "sessions",
  });
  return session({
    secret: process.env.SESSION_SECRET!,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: true,
      maxAge: sessionTtl,
    },
  });
}

function updateUserSession(
  user: any,
  tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers
) {
  user.claims = tokens.claims();
  user.access_token = tokens.access_token;
  user.refresh_token = tokens.refresh_token;
  user.expires_at = user.claims?.exp;
}

async function upsertUser(claims: any) {
  await storage.upsertUser({
    id: claims["sub"],
    email: claims["email"],
    firstName: claims["first_name"],
    lastName: claims["last_name"],
    profileImageUrl: claims["profile_image_url"],
  });
}

export async function setupAuth(app: Express) {
  app.set("trust proxy", 1);
  app.use(getSession());
  app.use(passport.initialize());
  app.use(passport.session());

  let config: Awaited<ReturnType<typeof getOidcConfig>>;
  try {
    config = await getOidcConfig();
  } catch (error: any) {
    console.error("OIDC discovery failed during startup:", error?.message || error);
    console.log("Auth routes will attempt lazy initialization on first request.");
    
    let lazyConfig: Awaited<ReturnType<typeof getOidcConfig>> | null = null;
    const getLazyConfig = async () => {
      if (!lazyConfig) {
        lazyConfig = await getOidcConfig();
      }
      return lazyConfig;
    };

    passport.serializeUser((user: Express.User, cb) => cb(null, user));
    passport.deserializeUser((user: Express.User, cb) => cb(null, user));

    const lazyStrategies = new Set<string>();
    const ensureLazyStrategy = (domain: string, cfg: Awaited<ReturnType<typeof getOidcConfig>>) => {
      const strategyName = `replitauth:${domain}`;
      if (!lazyStrategies.has(strategyName)) {
        const strategy = new Strategy(
          { name: strategyName, config: cfg, scope: "openid email profile offline_access", callbackURL: `https://${domain}/api/callback` },
          async (tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers, verified: passport.AuthenticateCallback) => {
            const user = {};
            updateUserSession(user, tokens);
            await upsertUser(tokens.claims());
            verified(null, user);
          },
        );
        passport.use(strategy);
        lazyStrategies.add(strategyName);
      }
      return strategyName;
    };

    app.get("/api/login", async (req, res, next) => {
      try {
        const cfg = await getLazyConfig();
        const strategyName = ensureLazyStrategy(req.hostname, cfg);
        passport.authenticate(strategyName, { prompt: "login consent", scope: ["openid", "email", "profile", "offline_access"] })(req, res, next);
      } catch (err: any) {
        res.status(503).json({ message: "Authentication service temporarily unavailable. Please try again in a moment." });
      }
    });

    app.get("/api/callback", async (req, res, next) => {
      try {
        const cfg = await getLazyConfig();
        const strategyName = ensureLazyStrategy(req.hostname, cfg);
        passport.authenticate(strategyName, { successReturnToOrRedirect: "/", failureRedirect: "/api/login" })(req, res, next);
      } catch (err: any) {
        res.redirect("/");
      }
    });

    app.get("/api/logout", async (req, res) => {
      try {
        const cfg = await getLazyConfig();
        req.logout(() => {
          res.redirect(client.buildEndSessionUrl(cfg, { client_id: process.env.REPL_ID!, post_logout_redirect_uri: `${req.protocol}://${req.hostname}` }).href);
        });
      } catch {
        req.logout(() => res.redirect("/"));
      }
    });

    return;
  }

  const verify: VerifyFunction = async (
    tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers,
    verified: passport.AuthenticateCallback
  ) => {
    const user = {};
    updateUserSession(user, tokens);
    await upsertUser(tokens.claims());
    verified(null, user);
  };

  const registeredStrategies = new Set<string>();

  const ensureStrategy = (domain: string) => {
    const strategyName = `replitauth:${domain}`;
    if (!registeredStrategies.has(strategyName)) {
      const strategy = new Strategy(
        {
          name: strategyName,
          config,
          scope: "openid email profile offline_access",
          callbackURL: `https://${domain}/api/callback`,
        },
        verify,
      );
      passport.use(strategy);
      registeredStrategies.add(strategyName);
    }
  };

  passport.serializeUser((user: Express.User, cb) => cb(null, user));
  passport.deserializeUser((user: Express.User, cb) => cb(null, user));

  app.get("/api/login", (req, res, next) => {
    ensureStrategy(req.hostname);
    passport.authenticate(`replitauth:${req.hostname}`, {
      prompt: "login consent",
      scope: ["openid", "email", "profile", "offline_access"],
    })(req, res, next);
  });

  app.get("/api/callback", (req, res, next) => {
    ensureStrategy(req.hostname);
    passport.authenticate(`replitauth:${req.hostname}`, {
      successReturnToOrRedirect: "/",
      failureRedirect: "/api/login",
    })(req, res, next);
  });

  app.get("/api/logout", (req, res) => {
    req.logout(() => {
      res.redirect(
        client.buildEndSessionUrl(config, {
          client_id: process.env.REPL_ID!,
          post_logout_redirect_uri: `${req.protocol}://${req.hostname}`,
        }).href
      );
    });
  });
}

export const isAuthenticated: RequestHandler = async (req, res, next) => {
  const user = req.user as any;

  if (!req.isAuthenticated() || !user.expires_at) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const now = Math.floor(Date.now() / 1000);
  if (now <= user.expires_at) {
    return next();
  }

  const refreshToken = user.refresh_token;
  if (!refreshToken) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  try {
    const config = await getOidcConfig();
    const tokenResponse = await client.refreshTokenGrant(config, refreshToken);
    updateUserSession(user, tokenResponse);
    return next();
  } catch (error) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }
};
