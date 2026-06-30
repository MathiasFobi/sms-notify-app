/**
 * GET /api/contacts/export — stream the current user's contacts as CSV.
 *
 * Auth is enforced by `requireUser()` (the same cookie-based stub the
 * rest of the app uses during the mock build). On success we return
 *   Content-Type: text/csv
 *   Content-Disposition: attachment; filename="contacts-YYYYMMDD-HHMM.csv"
 *
 * Failures map to standard HTTP statuses:
 *   401 Unauthorized — no / invalid `user-id` cookie
 *   500 Internal Server Error — anything else
 */

import { requireUser } from "@/lib/auth/require-user";
import { exportContactsCsv } from "@/lib/actions/contacts";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    // Touch `requireUser()` first so an unauthenticated request fails
    // before we generate any body. The action itself runs the same
    // check, but the explicit call here makes the auth gate obvious
    // and lets us return a clean 401 without leaking the action's
    // error message format.
    await requireUser();

    const { filename, csv } = await exportContactsCsv();

    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    if (/^Unauthorized/.test(message)) {
      return new Response(JSON.stringify({ error: message }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}