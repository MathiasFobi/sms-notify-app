import { handlers } from "@/auth";

/**
 * NextAuth catch-all route.
 *
 * The `[...nextauth]` segment lets NextAuth host its built-in
 * endpoints (signin, signout, callback, session, csrf, etc.) under
 * a single dynamic URL. We just hand the request through to
 * NextAuth's `handlers` object.
 */
export const { GET, POST } = handlers;
