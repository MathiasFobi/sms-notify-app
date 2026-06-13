"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { signIn, signOut } from "@/auth";
import { hashPassword, MIN_PASSWORD_LENGTH } from "@/lib/password";
import { db } from "@/db";
import { accounts, users, type NewAccount, type NewUser } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * Server actions for the auth flow.
 *
 * These are the canonical entry points for the forms on /login and
 * /signup. We expose them as named exports so client components can
 * `import { signUpAction } from "@/lib/actions/auth"` and pass them
 * straight into a `<form action={...}>`.
 *
 * Why server actions and not a regular form POST?
 *   - We get type safety end-to-end.
 *   - We don't have to ship validation code to the client.
 *   - Errors are surfaced via `useFormState` (or just a thrown
 *     redirect) without a second round-trip.
 *
 * All actions use the `"use server"` directive at the top of the
 * file. That makes every export a server action.
 */

const SignupInput = z.object({
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

const LoginInput = z.object({
  email: z
    .string()
    .min(1, "Email is required")
    .email("Email is not valid")
    .transform((v) => v.toLowerCase().trim()),
  password: z.string().min(1, "Password is required"),
});

/**
 * Result shape returned to the form. Either `{ ok: true, redirectTo }`
 * for success or `{ ok: false, error }` for a displayable error.
 *
 * We use a redirect string rather than calling `redirect()` from
 * the action so the client component can show "Account created,
 * redirecting..." briefly. The client then navigates explicitly
 * with `window.location.assign(redirectTo)`.
 */
export type ActionResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

/**
 * Sign-up server action.
 *
 * Creates the user + their billing account, then auto-signs them
 * in by calling `signIn("credentials")`. On success the action
 * returns `{ ok: true, redirectTo: "/app/dashboard" }` — the
 * client form navigates there. On failure it returns a flat
 * `error` string the form can render above the inputs.
 */
export async function signUpAction(
  _prev: ActionResult<{ redirectTo: string }> | undefined,
  formData: FormData,
): Promise<ActionResult<{ redirectTo: string }>> {
  const raw = Object.fromEntries(formData);
  const parsed = SignupInput.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      fieldErrors[issue.path.join(".")] = issue.message;
    }
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors,
    };
  }
  const { email, password, name } = parsed.data;

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (existing) {
    return { ok: false, error: "Email already registered" };
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

    const newAccount: NewAccount = {
      userId,
      credits: 0,
      plan: "free",
    };
    await db.insert(accounts).values(newAccount);
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code?: string }).code === "23505"
    ) {
      return { ok: false, error: "Email already registered" };
    }
    throw err;
  }

  // signIn() throws a NEXT_REDIRECT on success — that's how
  // NextAuth wires up the cookie on the response. We re-throw
  // it so the action bubbles up to the framework.
  try {
    await signIn("credentials", {
      email,
      password,
      redirectTo: "/app/dashboard",
    });
  } catch (err) {
    // Re-throw NEXT_REDIRECT — it's how NextAuth signals success.
    if (err instanceof Error && err.message === "NEXT_REDIRECT") throw err;
    if (
      err &&
      typeof err === "object" &&
      "digest" in err &&
      typeof (err as { digest?: unknown }).digest === "string" &&
      ((err as { digest: string }).digest.startsWith("NEXT_REDIRECT"))
    ) {
      throw err;
    }
    // Anything else is a real failure — fall through to a 500-ish
    // response. We don't try to recover the half-logged-in state
    // automatically; the user can retry the login.
    return {
      ok: false,
      error: "Account created, but sign-in failed. Please log in.",
    };
  }

  // Unreachable on success: signIn() always throws NEXT_REDIRECT.
  return { ok: true, data: { redirectTo: "/app/dashboard" } };
}

/**
 * Sign-in server action.
 *
 * On success, signIn() throws a NEXT_REDIRECT to `redirectTo` and
 * the response is committed. On failure, NextAuth v5 throws an
 * `AuthError` (or `CredentialsSignin`) which we catch and return
 * as a user-displayable error.
 */
export async function signInAction(
  _prev: ActionResult<{ redirectTo: string }> | undefined,
  formData: FormData,
): Promise<ActionResult<{ redirectTo: string }>> {
  const raw = Object.fromEntries(formData);
  const parsed = LoginInput.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      fieldErrors[issue.path.join(".")] = issue.message;
    }
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors,
    };
  }
  const { email, password } = parsed.data;
  const callbackUrl =
    typeof raw["callbackUrl"] === "string" && raw["callbackUrl"].length > 0
      ? raw["callbackUrl"]
      : "/app/dashboard";

  try {
    await signIn("credentials", {
      email,
      password,
      redirectTo: callbackUrl,
    });
  } catch (err) {
    // Re-throw the framework's NEXT_REDIRECT — it's the success path.
    if (
      err &&
      typeof err === "object" &&
      "digest" in err &&
      typeof (err as { digest?: unknown }).digest === "string" &&
      ((err as { digest: string }).digest.startsWith("NEXT_REDIRECT"))
    ) {
      throw err;
    }
    if (err instanceof Error && err.message === "NEXT_REDIRECT") throw err;
    // Any other error is a credentials failure. The user typed the
    // wrong password (or the user doesn't exist).
    return { ok: false, error: "Invalid credentials" };
  }

  return { ok: true, data: { redirectTo: callbackUrl } };
}

/**
 * Sign-out server action.
 *
 * Clears the session cookie and redirects to the marketing root.
 * The redirect uses Next's `redirect()` so it surfaces as a
 * NEXT_REDIRECT on the response.
 */
export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: "/" });
  // `redirectTo` is a v5 alias for `callbackUrl`; the function
  // always throws, so the `revalidatePath` is belt-and-braces
  // for any cached server-component data.
  revalidatePath("/", "layout");
}
