export type RunStatus =
  | "pending"
  | "running"
  | "waiting_for_approval"
  | "succeeded"
  | "failed"
  | "stopped";

export type EventType =
  | "plan"
  | "action"
  | "observation"
  | "approval"
  | "error"
  | "result";

export interface CreateRunRequest {
  task: string;
  model?: string | null;
}

export interface PendingApprovalResponse {
  id: string;
  action_name: string;
  params: Record<string, unknown>;
  reason: string;
  requested_at: string;
}

export interface RunStatusResponse {
  run_id: string;
  status: RunStatus;
  task: string;
  model: string;
  headless: boolean;
  current_step_summary: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  pending_approval_id: string | null;
  pending_approval: PendingApprovalResponse | null;
  last_error: string | null;
}

export interface RunEvent {
  id: string;
  run_id: string;
  sequence: number;
  type: EventType;
  summary: string;
  timestamp: string;
  data: Record<string, unknown>;
}

export interface ArtifactDescriptor {
  kind: string;
  path: string;
  size_bytes: number;
}

export interface RunArtifactsResponse {
  run_id: string;
  artifacts: ArtifactDescriptor[];
}

export interface ResultArtifactPayload {
  status: RunStatusResponse;
  result: Record<string, unknown>;
}
