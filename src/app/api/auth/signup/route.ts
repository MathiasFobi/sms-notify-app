import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { accounts, users, type NewAccount, type NewUser } from "@/db/schema";
import { hashPassword, MIN_PASSWORD_LENGTH } from "@/lib/password";
import { signIn } from "@/auth";

/**
 * POST /api/auth/signup
 *
 * Creates a new user + a paired billing `accounts` row, hashes the
 * password, and then auto-signs the user in so they land in the
 * dashboard without a separate login step.
 *
 * Request body: { email, password, name }
 * 201 -> { ok: true, email }
 * 400 -> { error: "ValidationError", issues: [...] }
 * 409 -> { error: "Email already registered" }
 *
 * Email verification is intentionally NOT done here (deferred to a
 * later story per US-002). `users.emailVerified` is set to `now()`
 * at signup time so the flow is end-to-end runnable.
 *
 * Concurrency: the unique index on `users.email` is the source of
 * truth for duplicate detection. We do an explicit pre-check and
 * also handle the unique-violation error code in case two requests
 * race.
 */

const SignupSchema = z.object({
  email: z
    .string()
    .min(1, "Email is required")
    .email("Email is not valid")
    .transform((v) => v.toLowerCase().trim()),
  password: z
    .string()
    .min(
      MIN_PASSWORD_LENGTH,
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
    ),
  name: z.string().min(1, "Name is required").max(120),
});

export type SignupRequest = z.infer<typeof SignupSchema>;
export type SignupResponse =
  | { ok: true; email: string }
  | { error: "ValidationError"; issues: { path: string; message: string }[] }
  | { error: "Email already registered" };

export async function POST(req: Request): Promise<NextResponse<SignupResponse>> {
  // Parse JSON defensively. A non-JSON body is a 400, not a 500.
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json(
      {
        error: "ValidationError",
        issues: [{ path: "body", message: "Request body must be JSON" }],
      },
      { status: 400 },
    );
  }

  const parsed = SignupSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "ValidationError",
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      },
      { status: 400 },
    );
  }

  const { email, password, name } = parsed.data;

  // Pre-check for duplicate. Cheap; saves a roundtrip on the common case.
  // The unique index is the authoritative guard against a race.
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (existing) {
    return NextResponse.json(
      { error: "Email already registered" },
      { status: 409 },
    );
  }

  const passwordHash = await hashPassword(password);

  let userId: number;
  try {
    const newUser: NewUser = {
      email,
      passwordHash,
      name,
      emailVerified: new Date(),
    };
    const [inserted] = await db
      .insert(users)
      .values(newUser)
      .returning({ id: users.id });
    userId = inserted.id;

    // Every user gets a billing `accounts` row at signup with 0
    // credits and the free plan. US-006 will adjust this when
    // Stripe is wired up.
    const newAccount: NewAccount = {
      userId,
      credits: 0,
      plan: "free",
    };
    await db.insert(accounts).values(newAccount);
  } catch (err) {
    // Postgres unique violation. Code 23505 on `users_email_idx`.
    // Race: two signups with the same email landed in parallel.
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code?: string }).code === "23505"
    ) {
      return NextResponse.json(
        { error: "Email already registered" },
        { status: 409 },
      );
    }
    throw err;
  }

  // Auto sign-in. NextAuth's `signIn` from a route handler will
  // set the session cookie on the outgoing response — we just
  // forward that response back to the client.
  try {
    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });
    if (!result || result.error) {
      // Signup succeeded but auto sign-in didn't. Return 201 anyway
      // so the client can prompt the user to log in manually.
      return NextResponse.json(
        { ok: true, email },
        { status: 201 },
      );
    }
  } catch {
    // Same as above: surface success and let the client deal.
    return NextResponse.json({ ok: true, email }, { status: 201 });
  }

  return NextResponse.json({ ok: true, email }, { status: 201 });
}
