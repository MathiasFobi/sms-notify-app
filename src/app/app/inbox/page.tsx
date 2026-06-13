import { Inbox } from "lucide-react";
import { EmptyState } from "@/components/empty-state";

/**
 * /app/inbox — inbound SMS inbox.
 *
 * Placeholder for US-032–035. The full inbox (per-thread view,
 * mark-read, reply) lands in a later story.
 */
export default function InboxPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Inbox</h1>
      <p className="text-sm text-muted-foreground">
        Replies to your campaigns land here. Mark them read or reply
        directly from the portal.
      </p>
      <EmptyState
        title="Inbox coming soon"
        description="The reply inbox and per-thread view land in a later story. The webhook receiver is already wired up."
        icon={<Inbox className="h-6 w-6" aria-hidden />}
      />
    </div>
  );
}
