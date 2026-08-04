import type { ReactNode } from "react";

import { Activity, Monitor, Plus, Radio, Square, TimerReset, Waypoints } from "lucide-react";

import { ActivityIndicator, EmptyState, StatusBadge } from "@/components/dashboard/dashboard-primitives";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  connectionLabel,
  connectionTone,
  formatTimestamp,
  isTerminalStatus,
  runIndicatorState,
  statusLabel,
  statusTone,
} from "@/src/lib/dashboard-display";
import type { RunStatusResponse } from "@/src/lib/types";

function MetaTile({
  label,
  value,
  icon,
  className,
  valueClassName,
}: {
  label: string;
  value: string;
  icon: ReactNode;
  className?: string;
  valueClassName?: string;
}) {
  return (
    <div className={["rounded-xl border border-border bg-muted/30 p-3", className].filter(Boolean).join(" ")}>
      <div className="flex items-center gap-2 font-mono text-[0.62rem] font-medium uppercase tracking-[0.2em] text-muted-foreground/90">
        <span className="flex size-6 items-center justify-center rounded-md border border-border/80 bg-card/70 text-muted-foreground">
          {icon}
        </span>
        {label}
      </div>
      <p
        className={[
          "mt-2.5 font-mono text-sm leading-6 text-foreground",
          valueClassName ?? "break-all",
        ].join(" ")}
      >
        {value}
      </p>
    </div>
  );
}

export function RunSummaryCard({
  status,
  connectionState,
  onStop,
  stopBusy,
  navigate,
}: {
  status: RunStatusResponse | null;
  connectionState: string;
  onStop?: () => void;
  stopBusy?: boolean;
  navigate: (path: string) => void;
}) {
  if (!status) {
    return (
      <Card className="border-border bg-card">
        <CardHeader>
          <p className="font-mono text-[0.68rem] uppercase tracking-[0.24em] text-primary/80">Status</p>
          <CardTitle>
            <h2>What happens next</h2>
          </CardTitle>
          <CardDescription>Start a run to watch progress, review approvals, and stop the work if needed.</CardDescription>
        </CardHeader>
        <CardContent>
          <EmptyState
            title="Status updates will appear here"
            description="Minerva will explain what it is doing, when it last updated, and whether it needs your input."
          />
        </CardContent>
      </Card>
    );
  }

  const indicatorState = runIndicatorState(status.status, Boolean(status.pending_approval));
  const stateStripCopy =
    indicatorState === "running"
      ? "Minerva is actively working through the current task."
      : indicatorState === "blocked"
        ? "Waiting for your review before the next sensitive action."
        : status.status === "succeeded"
          ? "Run finished successfully. Review the outcome or start another task."
          : status.status === "failed"
            ? "Run ended with a failure. Review the last error before starting again."
            : "Run was stopped. You can review the progress so far or launch another task.";
  const stateStripClasses =
    indicatorState === "running"
      ? "border-primary/22 bg-primary/8 text-primary"
      : indicatorState === "blocked"
        ? "border-[#f2a65a]/25 bg-[#f2a65a]/10 text-[#ffd9ae]"
        : indicatorState === "success"
          ? "border-primary/22 bg-primary/8 text-primary"
          : indicatorState === "danger"
            ? "border-destructive/28 bg-destructive/10 text-[#ffd1d1]"
            : "border-border bg-muted/35 text-muted-foreground";

  return (
    <Card className="border-border bg-card">
      <CardHeader className="gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <p className="font-mono text-[0.68rem] uppercase tracking-[0.24em] text-primary/80">Status</p>
            <CardTitle>
              <h2>What Minerva is doing</h2>
            </CardTitle>
            <CardDescription className="leading-6">
              Review the live step, operator alerts, and run details from one place.
            </CardDescription>
          </div>
          <StatusBadge tone={statusTone(status.status)}>{statusLabel(status.status)}</StatusBadge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <section className={["rounded-xl border px-4 py-3", stateStripClasses].join(" ")}>
          <ActivityIndicator state={indicatorState} label={stateStripCopy} size="sm" />
        </section>

        <section className="rounded-2xl border border-primary/20 bg-[linear-gradient(180deg,rgba(82,209,200,0.08),rgba(17,24,30,0.78)_42%,rgba(17,24,30,0.95))] p-4 shadow-inner shadow-black/15">
          <p className="font-mono text-[0.64rem] font-medium uppercase tracking-[0.22em] text-primary/85">
            Current step
          </p>
          <p className="mt-3 text-sm leading-7 text-foreground">
            {status.current_step_summary ?? "Waiting for the next step."}
          </p>
        </section>

        <div className="space-y-3" aria-label="Run alerts">
          {status.pending_approval ? (
            <div className="rounded-xl border border-[#f2a65a]/35 bg-[#f2a65a]/10 px-4 py-3 text-sm leading-6 text-[#ffe3c1]">
              Minerva is blocked on your review. Approve or reject the pending action to continue the run.
            </div>
          ) : null}

          {status.last_error ? (
            <div className="rounded-xl border border-destructive/35 bg-destructive/10 px-4 py-3 text-sm leading-6 text-[#ffd1d1]">
              {status.last_error}
            </div>
          ) : null}
        </div>

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="font-mono text-[0.64rem] font-medium uppercase tracking-[0.22em] text-muted-foreground">
              Run details
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <MetaTile
              label="Goal"
              value={status.task.trim() || "No goal provided"}
              icon={<Waypoints className="size-3.5" />}
              className="sm:col-span-2"
              valueClassName="break-words font-sans text-sm leading-6"
            />
            <MetaTile label="Model" value={status.model} icon={<Activity className="size-3.5" />} />
            <MetaTile
              label="Browser"
              value={status.headless ? "Headless" : "Visible"}
              icon={<Monitor className="size-3.5" />}
            />
            <MetaTile
              label="Stream"
              value={connectionLabel(connectionState)}
              icon={<Radio className="size-3.5" />}
            />
            <MetaTile
              label="Last update"
              value={formatTimestamp(status.updated_at)}
              icon={<TimerReset className="size-3.5" />}
            />
          </div>
        </section>
      </CardContent>

      <CardFooter className="flex flex-wrap items-center gap-3 border-border bg-muted/35">
        {!isTerminalStatus(status.status) && onStop ? (
          <Button
            type="button"
            variant="destructive"
            className="rounded-md px-4"
            onClick={onStop}
            disabled={stopBusy}
          >
            <Square className="size-4 fill-current" />
            {stopBusy ? "Stopping..." : "Stop run"}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="outline"
          className="rounded-md px-4"
          onClick={() => navigate("/")}
        >
          <Plus className="size-4" />
          New run
        </Button>
      </CardFooter>
    </Card>
  );
}
