/**
 * POST /api/webhooks/twilio/status
 *
 * Twilio status-callback endpoint (US-012). Twilio POSTs an
 * `application/x-www-form-urlencoded` body of the form
 *
 *   MessageSid=SMxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
 *   MessageStatus=delivered
 *   ErrorCode=30007            (optional)
 *
 * whenever a sent message transitions through its lifecycle. We
 * parse the form, hand the fields to the unit-testable
 * `processTwilioStatus()` helper, and map the result to HTTP
 * statuses:
 *
 *   200 — event accepted (new update, duplicate replay, or
 *         unknown sid). Twilio will stop retrying on any 2xx.
 *   400 — `MessageSid` missing or blank.
 *   500 — anything else.
 *
 * No auth: Twilio signs webhooks with HMAC-SHA1 over the URL +
 * body. Verifying that signature is a future story; for now we
 * accept the payload verbatim so the dev simulator
 * (`/dev/webhooks`, US-013) can post without signing. The handler
 * is idempotent, so an attacker can replay a real `MessageSid` to
 * flip a known recipient's status, but they can't cause data loss.
 */

import { processTwilioStatus } from "@/lib/webhooks/twilio-status";
import { getTestDb } from "@/test/db";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return new Response(
      JSON.stringify({ error: "body must be application/x-www-form-urlencoded or multipart/form-data" }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  const messageSid = formData.get("MessageSid");
  const messageStatus = formData.get("MessageStatus");
  const errorCode = formData.get("ErrorCode");

  if (typeof messageSid !== "string" || messageSid.trim().length === 0) {
    return new Response(
      JSON.stringify({ error: "MessageSid is required" }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  const rawStatus = typeof messageStatus === "string" ? messageStatus : "";
  const rawErrorCode = typeof errorCode === "string" ? errorCode : undefined;

  try {
    const outcome = await processTwilioStatus({
      messageSid: messageSid.trim(),
      messageStatus: rawStatus,
      errorCode: rawErrorCode,
      db: getTestDb(),
      now: new Date(),
    });

    // Twilio treats any 2xx as "got it, stop retrying". Return 200
    // uniformly for new / duplicate / unknown — only validation
    // failures and unexpected errors get non-2xx.
    return new Response(JSON.stringify({ ok: true, ...outcome }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
