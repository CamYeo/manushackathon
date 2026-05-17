import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import * as db from "../db";
import { ENV } from "./env";
import { sdk } from "./sdk";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
};

// Mock user returned when DEV_BYPASS_AUTH is enabled and Manus OAuth is absent.
// This lets all protectedProcedure routes work locally without a real login.
const DEV_USER_SEED = {
  openId: "dev-local-user",
  name: "Local Dev User",
  email: "dev@localhost",
  loginMethod: "dev-bypass",
  role: "admin" as const,
};

// Ensures the dev user exists in the real DB so foreign-key references work.
// Runs once on first request, then caches the result.
let devUser: User | null = null;
async function getOrCreateDevUser(): Promise<User> {
  if (devUser) return devUser;
  await db.upsertUser(DEV_USER_SEED);
  const user = await db.getUserByOpenId(DEV_USER_SEED.openId);
  if (!user) throw new Error("Failed to seed dev user — is DATABASE_URL set?");
  devUser = user;
  return devUser;
}

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;

  // Local dev bypass: skip Manus OAuth entirely and return a mock user.
  if (ENV.devBypassAuth) {
    user = await getOrCreateDevUser();
    return { req: opts.req, res: opts.res, user };
  }

  try {
    user = await sdk.authenticateRequest(opts.req);
  } catch (error) {
    // Authentication is optional for public procedures.
    user = null;
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
  };
}
