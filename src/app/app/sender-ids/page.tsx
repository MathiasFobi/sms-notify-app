import { UserCircle2 } from "lucide-react";
import { EmptyState } from "@/components/empty-state";

/**
 * /app/sender-ids — registered sender IDs.
 *
 * Placeholder for US-028–031. The full table (value, status,
 * provider SID, register-new form) lands in a later story.
 */
export default function SenderIdsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Sender IDs</h1>
      <p className="text-sm text-muted-foreground">
        Register an alphanumeric sender ID (e.g. <code>MYBRAND</code>) and
        track its approval status with the upstream provider.
      </p>
      <EmptyState
        title="Sender ID management coming soon"
        description="The sender ID table, registration form, and approval workflow land in a later story."
        icon={<UserCircle2 className="h-6 w-6" aria-hidden />}
      />
    </div>
  );
}
