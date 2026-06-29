/**
 * POST /api/webhooks/twilio/inbound
 *
 * Twilio inbound-message webhook (US-013). Twilio POSTs an
 * `application/x-www-form-urlencoded` body of the form
 *
 *   From=+15551234567
 *   To=+15550000000
 *   Body=STOP
 *   MessageSid=SMxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
 *
 * whenever a recipient REPLIES to one of our outbound messages.
 * We parse the form, hand the fields to the unit-testable
 * `processTwilioInbound()` helper, and map the result to HTTP
 * statuses:
 *
 *   200 — event accepted (new inbound inserted, duplicate replay,
 *         or unknown `To` number). Twilio will stop retrying on
 *         any 2xx.
 *   400 — `From`, `To`, `Body`, or `MessageSid` is missing or blank.
 *   500 — anything else.
 *
 * No auth: Twilio signs webhooks with HMAC-SHA1 over the URL +
 * body. Verifying that signature is a future story; for now we
 * accept the payload verbatim so the dev simulator
 * (`/dev/webhooks`, US-019) can post without signing. The handler
 * is idempotent on `twilio_message_sid`, so an attacker can
 * replay a real inbound sid but can't cause data loss.
 */

import { processTwilioInbound } from "@/lib/webhooks/twilio-inbound";
import { getTestDb } from "@/test/db";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return new Response(
      JSON.stringify({
        error:
          "body must be application/x-www-form-urlencoded or multipart/form-data",
      }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  const from = formData.get("From");
  const to = formData.get("To");
  const body = formData.get("Body");
  const messageSid = formData.get("MessageSid");

  // Per AC #6: missing fields return HTTP 400. Each missing-field
  // check is explicit so the error message tells the caller which
  // field they forgot (instead of a generic "missing fields").
  if (typeof from !== "string" || from.trim().length === 0) {
    return new Response(JSON.stringify({ error: "From is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (typeof to !== "string" || to.trim().length === 0) {
    return new Response(JSON.stringify({ error: "To is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (typeof messageSid !== "string" || messageSid.trim().length === 0) {
    return new Response(JSON.stringify({ error: "MessageSid is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  // Body is required to be a string, but unlike the other fields we
  // allow an empty string (Twilio can deliver MMS without text — the
  // helper treats an empty body as a no-op reply that doesn't trigger
  // opt-out handling).
  if (typeof body !== "string") {
    return new Response(JSON.stringify({ error: "Body is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const outcome = await processTwilioInbound({
      from: from.trim(),
      to: to.trim(),
      body,
      messageSid: messageSid.trim(),
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