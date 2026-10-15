import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  CheckCheckIcon,
  CircleXIcon,
  FolderCogIcon,
  FolderPlusIcon,
  FolderXIcon,
  GitPullRequestIcon,
  KeyRoundIcon,
  PercentIcon,
  PlusIcon,
  ServerCogIcon,
  ServerIcon,
  SlidersHorizontalIcon,
  ToggleLeftIcon,
  ToggleRightIcon,
  Trash2Icon,
  UserCogIcon,
  UserMinusIcon,
  UserPlusIcon,
  UsersRoundIcon,
  type LucideIcon,
} from "lucide-react";
import type { AuditAction } from "@iwifunni/contracts";

export interface AuditActionMeta {
  icon: LucideIcon;
  tone: string;
  verb: string;
  targetLabel: string;
}

/**
 * Icon, tint and wording per audit action.
 *
 * The map is exhaustive over `AuditAction`, so adding an action to the wire
 * contract is a type error here rather than a blank row on the timeline.
 */
export const auditActionMeta: Record<AuditAction, AuditActionMeta> = {
  "project.created": {
    icon: FolderPlusIcon,
    tone: "bg-primary-ink/10 text-primary-ink",
    verb: "created project",
    targetLabel: "Project",
  },
  "project.updated": {
    icon: FolderCogIcon,
    tone: "bg-purple-ink/10 text-purple-ink",
    verb: "updated project",
    targetLabel: "Project",
  },
  "project.deleted": {
    icon: FolderXIcon,
    tone: "bg-danger-ink/10 text-danger-ink",
    verb: "deleted project",
    targetLabel: "Project",
  },
  "environment.created": {
    icon: ServerIcon,
    tone: "bg-primary-ink/10 text-primary-ink",
    verb: "created environment",
    targetLabel: "Environment",
  },
  "environment.updated": {
    icon: ServerCogIcon,
    tone: "bg-purple-ink/10 text-purple-ink",
    verb: "updated environment",
    targetLabel: "Environment",
  },
  "environment.archived": {
    icon: ArchiveIcon,
    tone: "bg-danger-ink/10 text-danger-ink",
    verb: "archived environment",
    targetLabel: "Environment",
  },
  "environment.unarchived": {
    icon: ArchiveRestoreIcon,
    tone: "bg-ok-ink/10 text-ok-ink",
    verb: "restored environment",
    targetLabel: "Environment",
  },
  "change_request.created": {
    icon: GitPullRequestIcon,
    tone: "bg-info-ink/10 text-info-ink",
    verb: "proposed a change to",
    targetLabel: "Flag",
  },
  "change_request.approved": {
    icon: CheckCheckIcon,
    tone: "bg-ok-ink/10 text-ok-ink",
    verb: "approved a change to",
    targetLabel: "Flag",
  },
  "change_request.rejected": {
    icon: CircleXIcon,
    tone: "bg-danger-ink/10 text-danger-ink",
    verb: "rejected a change to",
    targetLabel: "Flag",
  },
  "flag.created": {
    icon: PlusIcon,
    tone: "bg-primary-ink/10 text-primary-ink",
    verb: "created",
    targetLabel: "Flag",
  },
  "flag.updated": {
    icon: SlidersHorizontalIcon,
    tone: "bg-purple-ink/10 text-purple-ink",
    verb: "updated",
    targetLabel: "Flag",
  },
  "flag.enabled": {
    icon: ToggleRightIcon,
    tone: "bg-ok-ink/10 text-ok-ink",
    verb: "enabled",
    targetLabel: "Flag",
  },
  "flag.disabled": {
    icon: ToggleLeftIcon,
    tone: "bg-muted text-slate-ink",
    verb: "disabled",
    targetLabel: "Flag",
  },
  "flag.archived": {
    icon: ArchiveIcon,
    tone: "bg-danger-ink/10 text-danger-ink",
    verb: "archived",
    targetLabel: "Flag",
  },
  "flag.unarchived": {
    icon: ArchiveRestoreIcon,
    tone: "bg-ok-ink/10 text-ok-ink",
    verb: "restored",
    targetLabel: "Flag",
  },
  "flag.variation.added": {
    icon: PlusIcon,
    tone: "bg-primary-ink/10 text-primary-ink",
    verb: "added a variation to",
    targetLabel: "Flag",
  },
  "flag.variation.updated": {
    icon: SlidersHorizontalIcon,
    tone: "bg-purple-ink/10 text-purple-ink",
    verb: "updated a variation of",
    targetLabel: "Flag",
  },
  "flag.variation.removed": {
    icon: Trash2Icon,
    tone: "bg-danger-ink/10 text-danger-ink",
    verb: "removed a variation from",
    targetLabel: "Flag",
  },
  "rollout.updated": {
    icon: PercentIcon,
    tone: "bg-info-ink/10 text-info-ink",
    verb: "changed rollout on",
    targetLabel: "Flag",
  },
  "segment.created": {
    icon: UsersRoundIcon,
    tone: "bg-primary-ink/10 text-primary-ink",
    verb: "created segment",
    targetLabel: "Segment",
  },
  "segment.updated": {
    icon: UsersRoundIcon,
    tone: "bg-purple-ink/10 text-purple-ink",
    verb: "updated segment",
    targetLabel: "Segment",
  },
  "segment.archived": {
    icon: ArchiveIcon,
    tone: "bg-danger-ink/10 text-danger-ink",
    verb: "archived segment",
    targetLabel: "Segment",
  },
  "api_key.created": {
    icon: KeyRoundIcon,
    tone: "bg-muted text-slate-ink",
    verb: "created API key",
    targetLabel: "API key",
  },
  "api_key.updated": {
    icon: KeyRoundIcon,
    tone: "bg-muted text-slate-ink",
    verb: "renamed API key",
    targetLabel: "API key",
  },
  "api_key.rotated": {
    icon: KeyRoundIcon,
    tone: "bg-muted text-slate-ink",
    verb: "rotated API key",
    targetLabel: "API key",
  },
  "api_key.revoked": {
    icon: KeyRoundIcon,
    tone: "bg-danger-ink/10 text-danger-ink",
    verb: "revoked API key",
    targetLabel: "API key",
  },
  "project_member.added": {
    icon: UserPlusIcon,
    tone: "bg-primary-ink/10 text-primary-ink",
    verb: "added member",
    targetLabel: "Member",
  },
  "project_member.updated": {
    icon: UserCogIcon,
    tone: "bg-purple-ink/10 text-purple-ink",
    verb: "updated member",
    targetLabel: "Member",
  },
  "project_member.removed": {
    icon: UserMinusIcon,
    tone: "bg-danger-ink/10 text-danger-ink",
    verb: "removed member",
    targetLabel: "Member",
  },
};
