import { Calendar } from "lucide-react";
import { EmptyState } from "@/components/empty-state";

/**
 * /app/scheduled — list of scheduled sends.
 *
 * Placeholder for US-019–022. The full table (run time, body
 * preview, cancel/edit actions) lands in a later story.
 */
export default function ScheduledPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Scheduled sends</h1>
      <p className="text-sm text-muted-foreground">
        Schedule a single send or a bulk send for a future date and time.
      </p>
      <EmptyState
        title="Scheduled table coming soon"
        description="The list of pending scheduled sends will appear here once the scheduling story lands."
        icon={<Calendar className="h-6 w-6" aria-hidden />}
      />
    </div>
  );
}
