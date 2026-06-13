import { cn } from "@/lib/cn";

export default function AppPortalHome() {
  return (
    <div className={cn("flex flex-1 items-center justify-center p-12")}>
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-semibold tracking-tight">
          Welcome to your portal
        </h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Sign in to view your dashboard, contacts, and message history.
        </p>
      </div>
    </div>
  );
}
