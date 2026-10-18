import type { UrgencyTier } from "@findyourdent/contracts";
import { Calendar, CircleCheck, Clock, type LucideIcon, OctagonAlert } from "lucide-react";
import { cn } from "~/lib/utils";

const TIER: Record<UrgencyTier, { icon: LucideIcon; className: string }> = {
  darurat: { icon: OctagonAlert, className: "bg-destructive text-destructive-foreground" },
  segera: { icon: Clock, className: "border-warning-line bg-warning-soft text-warning" },
  terjadwal: { icon: Calendar, className: "bg-secondary text-secondary-foreground" },
  rutin: { icon: CircleCheck, className: "bg-muted text-foreground" },
};

/**
 * How urgent the Guidance is: icon, label and a one-line instruction, readable without color.
 * `darurat` is an alert. See docs/design/design-system/components/UrgencyNotice.
 */
function UrgencyNotice({
  tier,
  label,
  description,
  className,
}: {
  tier: UrgencyTier;
  label: React.ReactNode;
  description: React.ReactNode;
  className?: string;
}) {
  const { icon: Icon, className: tone } = TIER[tier];
  return (
    <div
      data-slot="urgency-notice"
      data-tier={tier}
      role={tier === "darurat" ? "alert" : undefined}
      className={cn("flex items-start gap-3 rounded-md border border-transparent px-4 py-3", tone, className)}
    >
      <Icon aria-hidden="true" strokeWidth={1.75} className="mt-px size-[22px] shrink-0" />
      <span>
        <span className="block text-base leading-[22px] font-bold">{label}</span>
        <span className="block text-sm leading-5">{description}</span>
      </span>
    </div>
  );
}

export { UrgencyNotice };
