import { cn } from "@/lib/cn";

export default function AdminHome() {
  return (
    <div className={cn("flex flex-1 items-center justify-center p-12")}>
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Operator console
        </h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Tenants, abuse, billing overrides. Sign in as an operator to
          continue.
        </p>
      </div>
    </div>
  );
}
