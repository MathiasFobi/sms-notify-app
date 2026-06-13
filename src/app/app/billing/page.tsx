import { CreditCard } from "lucide-react";
import { EmptyState } from "@/components/empty-state";

/**
 * /app/billing — credit purchase history.
 *
 * Placeholder for US-006–012. The full transaction history +
 * Stripe Checkout flow lands in a later story.
 */
export default function BillingPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Billing</h1>
      <p className="text-sm text-muted-foreground">
        Buy credits and review your transaction history.
      </p>
      <EmptyState
        title="Billing coming soon"
        description="Stripe Checkout, the credit ledger, and pricing-tier selection land in a later story."
        icon={<CreditCard className="h-6 w-6" aria-hidden />}
      />
    </div>
  );
}
