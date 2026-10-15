import {
  ChartColumnIcon,
  FlagIcon,
  KeyRoundIcon,
  ServerIcon,
  type LucideIcon,
} from "lucide-react";
import { STARTER_ENVIRONMENTS } from "@iwifunni/contracts";
import { cn } from "cn";
import { SectionCard } from "@/components/app/page-header";

const starterEnvironmentNames = STARTER_ENVIRONMENTS.map(({ name }) => name);

const projectBenefits: Array<{
  title: string;
  description: string;
  icon: LucideIcon;
  tone: string;
}> = [
  {
    title: "Environments",
    description: `${starterEnvironmentNames.join(" and ")} created for you.`,
    icon: ServerIcon,
    tone: "bg-primary/10 text-primary",
  },
  {
    title: "Feature flags",
    description: "Flag definitions and targeting shared across environments.",
    icon: FlagIcon,
    tone: "bg-purple-ink/10 text-purple-ink",
  },
  {
    title: "SDK keys",
    description: "Scoped keys per environment with instant rotation.",
    icon: KeyRoundIcon,
    tone: "bg-info-ink/10 text-info-ink",
  },
  {
    title: "Insights",
    description: "Evaluation volume, latency and error analytics.",
    icon: ChartColumnIcon,
    tone: "bg-primary-ink/10 text-primary-ink",
  },
];

/** Right rail of the create screen: what a new project comes with. */
export function ProjectWhatYouGetCard() {
  return (
    <SectionCard title="What you get">
      <ul className="space-y-3">
        {projectBenefits.map((benefit) => {
          const Icon = benefit.icon;

          return (
            <li key={benefit.title} className="flex items-start gap-2.5">
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-md",
                  benefit.tone,
                )}
              >
                <Icon aria-hidden="true" className="size-3.5" />
              </span>
              <span className="min-w-0">
                <span className="block text-[12px] font-medium">
                  {benefit.title}
                </span>
                <span className="text-muted-foreground block text-[11px] leading-5">
                  {benefit.description}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </SectionCard>
  );
}
