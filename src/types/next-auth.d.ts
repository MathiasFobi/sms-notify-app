import type { DefaultSession } from "next-auth";

/**
 * Type augmentations for NextAuth v5.
 *
 * The default `User` / `Session` shapes don't know about our custom
 * `id` and `role` fields, so we extend them here. Server code that
 * reads `session.user.id` or `session.user.role` gets full type
 * safety; anything that uses the default `image`/`name`/`email`
 * fields still works.
 *
 * This file is picked up automatically because of its `.d.ts`
 * extension. It has no runtime impact.
 */
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: string;
    } & DefaultSession["user"];
  }

  interface User {
    role?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId?: string;
    role?: string;
  }
}

export {};
