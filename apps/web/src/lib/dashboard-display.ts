import type { EventType, RunStatus } from "./types";

export type DashboardTone = "neutral" | "info" | "success" | "warning" | "danger";
export type RunIndicatorState = "idle" | "running" | "blocked" | "success" | "danger";

const TERMINAL_STATUSES: RunStatus[] = ["succeeded", "failed", "stopped"];

export function isTerminalStatus(status: RunStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export function formatTimestamp(value: string | null): string {
  if (!value) {
    return "Pending";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

export function formatBytes(size: number): string {
  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function statusLabel(status: RunStatus): string {
  return status
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function connectionLabel(connectionState: string): string {
  return connectionState
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function statusTone(status: RunStatus): DashboardTone {
  switch (status) {
    case "succeeded":
      return "success";
    case "waiting_for_approval":
      return "warning";
    case "failed":
    case "stopped":
      return "danger";
    case "running":
      return "info";
    case "pending":
    default:
      return "neutral";
  }
}

export function runIndicatorState(status: RunStatus, pendingApproval = false): RunIndicatorState {
  if (pendingApproval || status === "waiting_for_approval") {
    return "blocked";
  }

  switch (status) {
    case "running":
      return "running";
    case "succeeded":
      return "success";
    case "failed":
    case "stopped":
      return "danger";
    case "pending":
    default:
      return "idle";
  }
}

export function connectionTone(connectionState: string): DashboardTone {
  switch (connectionState) {
    case "live":
    case "complete":
      return "success";
    case "reconnecting":
    case "connecting":
      return "warning";
    case "idle":
    default:
      return "neutral";
  }
}

export function eventTone(type: EventType): DashboardTone {
  switch (type) {
    case "approval":
      return "warning";
    case "error":
      return "danger";
    case "result":
      return "success";
    case "action":
      return "info";
    case "plan":
    case "observation":
    default:
      return "neutral";
  }
}
