import { Send } from "lucide-react";
import { EmptyState } from "@/components/empty-state";

/**
 * /app/send — single + bulk send.
 *
 * Placeholder for US-013/014. The full send form (phone,
 * message, character counter, sender ID picker) and the CSV
 * upload flow land in a later story. For now we render a
 * centred empty-state so the sidebar link doesn't 404.
 */
export default function SendPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Send SMS</h1>
      <p className="text-sm text-muted-foreground">
        Compose a single message or upload a CSV for a bulk send.
      </p>
      <EmptyState
        title="Send form coming soon"
        description="The single + bulk send form is built in a later story. The route is wired up so the sidebar link works today."
        icon={<Send className="h-6 w-6" aria-hidden />}
      />
    </div>
  );
}
