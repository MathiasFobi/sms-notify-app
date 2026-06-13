import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";

/**
 * Edge proxy (formerly `middleware` in Next.js < 16).
 *
 * Runs on every request that matches the `config.matcher` below
 * and uses the edge-safe `authConfig` (no DB, no bcrypt). The
 * `authorized` callback in `authConfig` decides whether the
 * request is allowed through.
 *
 * Next.js 16 renamed `middleware` to `proxy`; we go with the new
 * name. NextAuth v5 takes care of the cookie read/write itself;
 * we just hand it the config.
 */
export const { auth: proxy } = NextAuth(authConfig);

/**
 * Default export — Next.js 16 looks for `proxy` (preferred) or
 * `middleware` (deprecated) by name. We export the NextAuth-
 * generated handler under both names to be safe across minor
 * versions.
 */
export default proxy;

export const config = {
  /**
   * Skip NextAuth's own endpoints (it would loop) and static
   * assets. Everything else flows through the authorized callback.
   */
  matcher: [
    "/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\..*).*)",
  ],
};
