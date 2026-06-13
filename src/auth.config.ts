import type { NextAuthConfig } from "next-auth";

/**
 * Edge-safe NextAuth v5 config (no DB, no bcrypt).
 *
 * The full auth setup in `src/auth.ts` imports the Drizzle adapter
 * and pulls in postgres-js, which use Node built-ins and won't load
 * on the Edge runtime that `middleware.ts` runs in. So we split the
 * config in two:
 *
 *   - `auth.config.ts` (this file) — provider definitions + the
 *     `authorized` callback used by the middleware. Pure data,
 *     no I/O. Safe in the Edge runtime.
 *
 *   - `src/auth.ts` — the full config with the Drizzle adapter
 *     and the credentials authorize() callback that hits the DB.
 *     Node-only.
 *
 * Both files are merged at request time: the middleware imports
 * `auth.config.ts` directly; route handlers, server actions, and
 * server components import from `@/auth` (which re-exports from
 * `src/auth.ts`).
 *
 * The `authorized` callback is the central place for route-level
 * access control. NextAuth calls it on every request that flows
 * through the middleware. Return `true` to allow, `false` to
 * redirect to the sign-in page, or a `NextResponse` for custom
 * logic.
 */
export const authConfig = {
  pages: {
    signIn: "/login",
  },
  // Use JWT session strategy (no DB-backed sessions in v1).
  // The Drizzle adapter is still attached in `src/auth.ts` so
  // user records are normalized for future OAuth providers.
  session: { strategy: "jwt" },
  // Trust the host header in non-Vercel deployments (local dev,
  // custom domains, etc.). On Vercel, AUTH_TRUST_HOST is set
  // automatically. We enable it unconditionally so the smoke
  // test `pnpm start` doesn't error on UntrustedHost.
  trustHost: true,
  callbacks: {
    /**
     * Centralized auth gate for the App Router.
     *
     * - `/app/*` requires a session. Unauthenticated visitors are
     *   bounced to `/login?callbackUrl=...`.
     * - `/admin/*` requires a session whose user has `role: "admin"`.
     *   (US-040 wires the admin role check; for now we just require
     *   a session — the admin pages are not yet built.)
     * - Everything else (marketing site, /login, /signup, /api/auth/*)
     *   is public.
     */
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = Boolean(auth?.user);
      const path = nextUrl.pathname;

      // /app/* — client portal — requires a session.
      if (path.startsWith("/app")) {
        if (isLoggedIn) return true;
        // Build a callbackUrl so we can return the user to where
        // they were going after they sign in.
        const callbackUrl = encodeURIComponent(path + nextUrl.search);
        return Response.redirect(
          new URL(`/login?callbackUrl=${callbackUrl}`, nextUrl),
        );
      }

      // /admin/* — operator console. Requires both a session and
      // the admin role. The role is read off `auth.user.role`,
      // which is populated from the JWT in the `jwt` callback
      // (see src/auth.ts).
      if (path.startsWith("/admin")) {
        if (!isLoggedIn) {
          const callbackUrl = encodeURIComponent(path + nextUrl.search);
          return Response.redirect(
            new URL(`/login?callbackUrl=${callbackUrl}`, nextUrl),
          );
        }
        if (auth?.user?.role !== "admin") {
          // Not an admin — bounce to the client portal with a hint.
          return Response.redirect(new URL("/app?forbidden=1", nextUrl));
        }
        return true;
      }

      // Everything else (marketing, auth pages) is public.
      return true;
    },

    /**
     * Persist the user's id and role on the JWT so the
     * `session` callback below can surface them.
     *
     * `user` is only set on the initial sign-in; on subsequent
     * calls we copy from the existing token.
     */
    jwt({ token, user }) {
      if (user) {
        token.userId = (user as { id?: string | number }).id
          ? String((user as { id?: string | number }).id)
          : token.userId;
        token.role = (user as { role?: string }).role ?? token.role;
      }
      return token;
    },

    /**
     * Shape the session object that server code and `useSession`
     * see. Adds `userId` and `role` next to the default
     * `name`/`email`/`image`.
     */
    session({ session, token }) {
      if (token.userId && session.user) {
        (session.user as { id?: string }).id = token.userId as string;
      }
      if (token.role && session.user) {
        (session.user as { role?: string }).role = token.role as string;
      }
      return session;
    },
  },
  // Providers are added in src/auth.ts (the Node-side file)
  // because the credentials provider's `authorize` callback hits
  // the DB. Keeping providers here would force this file to
  // import postgres-js and crash in the Edge runtime.
  providers: [],
} satisfies NextAuthConfig;
