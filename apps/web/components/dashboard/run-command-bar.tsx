import { Clock3, RotateCcw, Square, Sparkles } from "lucide-react";

import { ActivityIndicator, StatusBadge } from "@/components/dashboard/dashboard-primitives";
import { Button } from "@/components/ui/button";
import {
  formatTimestamp,
  isTerminalStatus,
  runIndicatorState,
  statusLabel,
  statusTone,
  type DashboardTone,
} from "@/src/lib/dashboard-display";
import type { RunStatusResponse } from "@/src/lib/types";

function shellTone(status: RunStatusResponse): DashboardTone {
  if (status.pending_approval) {
    return "warning";
  }

  return statusTone(status.status);
}

function shellClasses(tone: DashboardTone): string {
  switch (tone) {
    case "warning":
      return "border-[#f2a65a]/40 bg-[#1e1710]/96 shadow-[0_18px_50px_rgba(242,166,90,0.18)]";
    case "danger":
      return "border-destructive/40 bg-[#1a1010]/96 shadow-[0_18px_50px_rgba(217,92,92,0.16)]";
    case "success":
      return "border-primary/35 bg-[#10191d]/96 shadow-[0_18px_50px_rgba(82,209,200,0.16)]";
    case "info":
      return "border-primary/35 bg-[#10191d]/96 shadow-[0_18px_50px_rgba(82,209,200,0.16)]";
    case "neutral":
    default:
      return "border-border bg-card/96 shadow-[0_18px_50px_rgba(0,0,0,0.28)]";
  }
}

function summaryCopy(status: RunStatusResponse): { title: string; summary: string } {
  if (status.pending_approval) {
    return {
      title: "Waiting for your review",
      summary:
        status.current_step_summary ??
        "Minerva is waiting for your review before it can continue with a gated action.",
    };
  }

  if (isTerminalStatus(status.status)) {
    return {
      title: "Run complete",
      summary:
        status.current_step_summary ?? "This run is finished. Review the result or start another task below.",
    };
  }

  return {
    title: "Run in progress",
    summary: status.current_step_summary ?? "Minerva is still working through the current task.",
  };
}

export function RunCommandBar({
  status,
  stopBusy = false,
  retryBusy = false,
  onStop,
  onRetry,
  onStartAnotherRun,
}: {
  status: RunStatusResponse;
  stopBusy?: boolean;
  retryBusy?: boolean;
  onStop?: () => void;
  onRetry?: () => void;
  onStartAnotherRun: () => void;
}) {
  const tone = shellTone(status);
  const { title, summary } = summaryCopy(status);
  const terminal = isTerminalStatus(status.status);
  const indicatorState = runIndicatorState(status.status, Boolean(status.pending_approval));

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 px-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] sm:px-5 lg:px-7">
      <section
        aria-label="Run command bar"
        className="mx-auto max-w-[1600px]"
      >
        <div
          className={[
            "pointer-events-auto overflow-hidden rounded-2xl border backdrop-blur",
            shellClasses(tone),
          ].join(" ")}
        >
          <div className="flex flex-col gap-4 px-4 py-4 sm:px-5 lg:flex-row lg:items-center lg:gap-5">
            <div className="min-w-0 flex-1" aria-live="polite">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge tone={tone}>{statusLabel(status.status)}</StatusBadge>
                <ActivityIndicator state={indicatorState} label={title} size="sm" />
              </div>
              <p className="mt-2 truncate text-sm font-medium text-foreground sm:text-[0.95rem]">{summary}</p>
              <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                <Clock3 className="size-3.5" />
                Updated {formatTimestamp(status.updated_at)}
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-3">
              {terminal && status.status === "failed" && onRetry ? (
                <Button
                  type="button"
                  size="lg"
                  className="rounded-md px-5"
                  onClick={onRetry}
                  disabled={retryBusy}
                >
                  <RotateCcw className="size-4" />
                  {retryBusy ? "Retrying..." : "Retry run"}
                </Button>
              ) : terminal ? (
                <Button type="button" size="lg" className="rounded-md px-5" onClick={onStartAnotherRun}>
                  <Sparkles className="size-4" />
                  Start another run
                </Button>
              ) : onStop ? (
                <Button
                  type="button"
                  variant="destructive"
                  size="lg"
                  className="rounded-md px-5"
                  onClick={onStop}
                  disabled={stopBusy}
                >
                  <Square className="size-4 fill-current" />
                  {stopBusy ? "Stopping..." : "Stop run"}
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
