import { Users } from "lucide-react";
import { EmptyState } from "@/components/empty-state";

/**
 * /app/contacts — contact list and groups.
 *
 * Placeholder for US-023–027. The full table (name, phone,
 * group, opted-out flag, import/export) lands in a later
 * story.
 */
export default function ContactsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Contacts</h1>
      <p className="text-sm text-muted-foreground">
        Manage your contacts and groups. Import a CSV to bulk-add.
      </p>
      <EmptyState
        title="Contact table coming soon"
        description="Your contact list, groups, and CSV import will live here once the contacts story lands."
        icon={<Users className="h-6 w-6" aria-hidden />}
      />
    </div>
  );
}
