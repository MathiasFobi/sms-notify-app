import { Settings } from "lucide-react";
import { EmptyState } from "@/components/empty-state";

/**
 * /app/settings — user account settings.
 *
 * Placeholder. Future stories add: profile (name, email),
 * password change, notification preferences, Twilio BYO
 * credentials.
 */
export default function SettingsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <p className="text-sm text-muted-foreground">
        Profile, password, and notification preferences.
      </p>
      <EmptyState
        title="Settings coming soon"
        description="Profile edits, password changes, and notification preferences will land in a later story."
        icon={<Settings className="h-6 w-6" aria-hidden />}
      />
    </div>
  );
}
