/**
 * Minimal signup API — used by the `/signup` page.
 *
 * This is the lightweight seam for the mock-data build. It:
 *   1. Validates the input via zod.
 *   2. Inserts a user row into the in-memory TestDb with a SHA-256
 *      password hash (NOT for production — only to satisfy the
 *      `passwordHash` not-null constraint and let the cookie-based
 *      auth seam work end-to-end).
 *   3. Sets the `__user-cookie` JSON cookie so subsequent requests
 *      in the same browser session resolve the user via `requireUser()`.
 *   4. Returns the new user payload to the client, which redirects
 *      to `/app/dashboard`.
 *
 * Why SHA-256 (not bcrypt): bcrypt isn't in the dependency tree. For
 * the mock-build this endpoint is solely about validating the cookie
 * seam on Vercel; the real auth + password storage lands in a later
 * story (NextAuth credentials + Drizzle adapter) and will replace
 * this file entirely.
 *
 * Why this can run on Vercel even though TestDb is in-memory:
 *   The `__user-cookie` carries the minimum user shape, so even though
 *   the in-memory DB resets per request on serverless, the user stays
 *   "logged in" across requests within the same browser session.
 *   Read-only server actions that need DB state (e.g. listing
 *   contacts) will return empty results — that's an accepted
 *   limitation of the mock build.
 */

import { NextResponse } from "next/server";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { getTestDb } from "@/test/db";

const SignupSchema = z.object({
  name: z.string().min(2).max(80),
  email: z.string().email().max(160),
  password: z.string().min(8).max(128),
});

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = SignupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 }
    );
  }

  const { name, email, password } = parsed.data;

  // Hash the password (mock-only — see file header).
  const passwordHash = createHash("sha256")
    .update(`${email}:${password}`)
    .digest("hex");

  const db = getTestDb();

  // Reject duplicate emails.
  const existing = await db.select("users", { email });
  if (existing.length > 0) {
    return NextResponse.json(
      { error: "An account with that email already exists" },
      { status: 409 }
    );
  }

  const now = new Date().toISOString();
  const inserted = await db.insert("users", {
    email,
    password_hash: passwordHash,
    name,
    role: "user",
    created_at: now,
  });

  const id = typeof inserted.id === "number" ? inserted.id : Number(inserted.id);

  const row = {
    id,
    email,
    name,
    role: "user" as const,
    password_hash: passwordHash,
    twilio_account_sid: null,
    twilio_auth_token: null,
    twilio_from_number: null,
    created_at: now,
  };

  // Create an account row with 0 credits so admin / billing pages don't crash.
  try {
    await db.insert("accounts", {
      user_id: id,
      credits: 0,
      stripe_customer_id: null,
      created_at: now,
    });
  } catch {
    // Accounts table may not exist in this serverless request — ignore.
  }

  const cookieValue = encodeURIComponent(
    JSON.stringify({ id, row })
  );

  const res = NextResponse.json({ ok: true, id, email, name });
  res.cookies.set("__user-cookie", cookieValue, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
  return res;
}