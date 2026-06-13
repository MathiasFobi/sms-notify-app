# sms-notify-app

A production SMS notification web app — a web-first alternative to
spreadsheet gateways. Send, schedule, and track bulk SMS from a single
web app.

- **Stack:** Next.js (app router, src dir) · TypeScript (strict) · Tailwind v4 ·
  Drizzle ORM · Postgres (postgres-js)
- **Single app, two surfaces:** `/app` (client portal) and `/admin`
  (operator console)
- **Tested:** Vitest with jsdom

---

## Prerequisites

- Node.js 20+
- pnpm 10+
- A Postgres database (Neon, Supabase, Vercel Postgres, or local)

## 1. Install dependencies

```bash
pnpm install
```

## 2. Configure environment

Copy the example file and fill in real values:

```bash
cp .env.example .env
```

Required keys (all server-side unless noted):

| Key                    | Notes                                                     |
| ---------------------- | --------------------------------------------------------- |
| `DATABASE_URL`         | Postgres connection string                                |
| `AUTH_SECRET`          | 32+ random chars (`openssl rand -base64 32`); NextAuth v5 |
| `STRIPE_SECRET_KEY`    | `sk_test_...` for development                             |
| `STRIPE_WEBHOOK_SECRET`| `whsec_...` from the Stripe dashboard                     |
| `TWILIO_ACCOUNT_SID`   | Starts with `AC`                                          |
| `TWILIO_AUTH_TOKEN`    | Twilio auth token (secret)                                |
| `APP_URL`              | Public origin, e.g. `http://localhost:3000`               |

`NEXTAUTH_SECRET` is also accepted for back-compat with NextAuth v4 — it
is auto-promoted to `AUTH_SECRET` at boot.

`src/lib/env.ts` validates the environment at boot — missing or malformed
keys throw immediately with a clear error.

## 3. Set up the database

Generate the first migration (after schema changes):

```bash
pnpm db:generate
```

Apply migrations:

```bash
pnpm db:migrate
```

For local prototyping, push the schema directly without writing migration
files:

```bash
pnpm db:push
```

## 4. Run the app

```bash
pnpm dev          # http://localhost:3000
pnpm typecheck    # tsc --noEmit
pnpm test         # vitest (one-shot: pnpm test --run)
pnpm build        # production build
pnpm start        # serve the production build
pnpm lint
```

## Project layout

```
src/
├── app/
│   ├── layout.tsx        # root layout (Tailwind shell)
│   ├── page.tsx          # / marketing landing
│   ├── login/page.tsx    # /login — credentials form (client)
│   ├── signup/page.tsx   # /signup — signup form (client)
│   ├── app/              # /app — client portal (requires auth)
│   │   ├── layout.tsx
│   │   ├── page.tsx      # redirects to /app/dashboard
│   │   └── dashboard/page.tsx
│   ├── admin/            # /admin — operator console (requires admin)
│   │   ├── layout.tsx
│   │   └── page.tsx
│   └── api/
│       ├── auth/
│       │   ├── [...nextauth]/route.ts   # NextAuth catch-all
│       │   └── signup/route.ts          # POST /api/auth/signup
├── auth.config.ts        # Edge-safe NextAuth v5 config (no DB)
├── auth.ts               # NextAuth v5 instance (Drizzle adapter, credentials)
├── proxy.ts              # Edge proxy (formerly middleware.ts)
├── types/next-auth.d.ts  # NextAuth session/user type augmentations
├── db/
│   ├── schema.ts         # 13-table Drizzle schema
│   ├── index.ts          # singleton `db` (postgres-js + drizzle)
│   └── schema.test.ts
├── lib/
│   ├── env.ts            # zod-validated process.env
│   ├── env.test.ts
│   ├── cn.ts             # tailwind-merge class helper
│   ├── cn.test.ts
│   ├── auth.ts           # re-exports auth/signIn/signOut/handlers + requireUser()
│   ├── auth.test.ts      # requireUser redirect tests
│   ├── password.ts       # bcrypt cost-10 hash + verify
│   ├── password.test.ts
│   └── actions/
│       └── auth.ts       # signUpAction, signInAction, signOutAction
└── test/
    └── db.ts             # PGlite-backed test DB factory
drizzle.config.ts         # drizzle-kit config (postgresql, ./src/db/schema.ts)
vitest.config.ts
vitest.setup.ts
```

## Auth

NextAuth v5 (beta) with the Drizzle adapter and a Credentials provider.
Sessions are signed JWTs in HTTP-only cookies — no DB sessions in v1.

Public auth API (`src/lib/auth.ts`):

- `auth()` — current session, `null` if not signed in
- `signIn()` — programmatic sign-in
- `signOut()` — clear the session
- `requireUser()` — throws a `redirect("/login?callbackUrl=...")` if no session
- `handlers` — the catch-all route handler (see `app/api/auth/[...nextauth]/route.ts`)

Server actions (`src/lib/actions/auth.ts`):

- `signUpAction` — form action for `/signup`; creates user + account, auto-signs-in
- `signInAction` — form action for `/login`; calls NextAuth credentials
- `signOutAction` — clears the session and redirects to `/`

### Routes

| Path                        | Auth      | Notes                                    |
| --------------------------- | --------- | ---------------------------------------- |
| `/`                         | public    | marketing landing                        |
| `/login`                    | public    | credentials login form                   |
| `/signup`                   | public    | signup form                              |
| `/app`                      | redirect  | redirects to `/app/dashboard` if signed in, else `/login` |
| `/app/dashboard`            | required  | protected by `requireUser()`             |
| `/app/*`                    | required  | enforced by the edge proxy               |
| `/admin`                    | admin     | enforced by the edge proxy (role check)  |
| `/api/auth/signup`          | public    | POST: create user + auto-signin          |
| `/api/auth/[...nextauth]`   | public    | NextAuth catch-all (signin, signout, csrf, session, ...) |

## Conventions

- TypeScript strict, no `any` in app code.
- All env access goes through `src/lib/env.ts` — never `process.env.X` directly.
- All class merging goes through `cn()` from `src/lib/cn.ts`.
- Schema is the single source of truth. Edit `src/db/schema.ts`, then
  `pnpm db:generate` to create a migration.

## Deployment

Any platform that runs Next.js and can reach your Postgres (Vercel, Render,
Fly, Railway). Make sure every env var from `.env.example` is set in the
deployment environment. The app crashes fast on boot if anything is missing.
