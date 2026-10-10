
export interface SegmentRow {
  id: string;
  projectId: string;
  key: string;
  name: string;
  description: string | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SegmentConditionRow {
  id: string;
  segmentId: string;
  attribute: string;
  attributeType: string;
  operator: string;
  values: unknown;
  priority: number;
}

export interface NewSegmentRecord {
  id: string;
  projectId: string;
  key: string;
  name: string;
  description: string | null;
}

export interface UpdateSegmentRecord {
  name?: string;
  description?: string | null;
}

export interface SegmentListFilter {
  search?: string;
  includeArchived: boolean;
  limit: number;
  cursor: string | null;
}

/** A flag that references the segment, for the segment detail flags tab. */
export interface SegmentFlagRow {
  key: string;
  environmentKey: string;
  status: string;
  enabled: boolean;
  rolloutPercentage: number | null;
  ruleRolloutPercentage: number | null;
}

export interface SegmentConditionCount {
  segmentId: string;
  count: number;
}

export interface SegmentActorContext {
  organizationId: string;
  workspaceRole: string;
  userId: string;
  userName: string;
}

