import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

/**
 * /app — client portal root. Redirects to the dashboard if signed
 * in, otherwise to /login (which itself redirects back to the
 * dashboard after sign-in).
 */
export default async function AppPortalRoot() {
  const session = await auth();
  if (session?.user) {
    redirect("/app/dashboard");
  }
  redirect("/login?callbackUrl=%2Fapp%2Fdashboard");
}
