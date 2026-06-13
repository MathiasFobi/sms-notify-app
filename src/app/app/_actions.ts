"use server";

import { redirect } from "next/navigation";

import { signOut } from "@/auth";

/**
 * Server actions for the authenticated /app portal.
 *
 * US-003 requires logout to live here (not in the catch-all
 * `src/lib/actions/auth.ts`) so the portal is self-contained
 * and a future monorepo split (apps/web vs apps/admin) can
 * move the file without touching shared auth code.
 *
 * The only action in v1 is `signOutAction` — it clears the
 * session cookie and redirects to the marketing root. The
 * `revalidatePath` call invalidates any cached server data
 * (e.g. the topbar's user name) so a subsequent request sees
 * a clean state.
 *
 * The action accepts no input. We type it as
 * `(formData: FormData) => Promise<void>` so it slots into a
 * `<form action={...}>` without ceremony.
 */

export async function signOutAction(_formData?: FormData): Promise<void> {
  await signOut({ redirectTo: "/" });
  // The redirect inside `signOut` throws a NEXT_REDIRECT that
  // Next's render loop turns into a 302. The line below is
  // belt-and-braces for any cached server component data.
  redirect("/");
}
