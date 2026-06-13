import { BarChart3 } from "lucide-react";
import { EmptyState } from "@/components/empty-state";

/**
 * /app/reports — delivery reports.
 *
 * Placeholder for US-036–039. The full reports (per-send
 * delivery breakdown, charts, CSV export) land in a later
 * story.
 */
export default function ReportsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
      <p className="text-sm text-muted-foreground">
        Delivery reports, success rates, and credit usage over time.
      </p>
      <EmptyState
        title="Reports dashboard coming soon"
        description="Charts, per-send breakdowns, and CSV export will appear here once the reports story lands."
        icon={<BarChart3 className="h-6 w-6" aria-hidden />}
      />
    </div>
  );
}
