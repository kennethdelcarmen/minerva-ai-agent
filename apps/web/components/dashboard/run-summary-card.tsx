import type { ReactNode } from "react";

import { Activity, Monitor, Plus, Radio, Square, TimerReset, Waypoints } from "lucide-react";

import { EmptyState, StatusBadge } from "@/components/dashboard/dashboard-primitives";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  connectionLabel,
  connectionTone,
  formatTimestamp,
  isTerminalStatus,
  statusLabel,
  statusTone,
} from "@/src/lib/dashboard-display";
import type { RunStatusResponse } from "@/src/lib/types";

function MetaTile({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/45 p-3">
      <div className="flex items-center gap-2 font-mono text-[0.68rem] font-medium uppercase tracking-[0.18em] text-muted-foreground">
        <span className="flex size-7 items-center justify-center rounded-md border border-border bg-card text-foreground/80">
          {icon}
        </span>
        {label}
      </div>
      <p className="mt-3 break-all font-mono text-sm leading-6 text-foreground">{value}</p>
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
          <p className="font-mono text-[0.68rem] uppercase tracking-[0.24em] text-primary/80">Run telemetry</p>
          <CardTitle>
            <h2>Run state</h2>
          </CardTitle>
          <CardDescription>No active run yet.</CardDescription>
        </CardHeader>
        <CardContent>
          <EmptyState
            title="Run telemetry will land here"
            description="Launch a task to populate live status, stream health, browser mode, and refresh timestamps."
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border bg-card">
      <CardHeader className="gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <p className="font-mono text-[0.68rem] uppercase tracking-[0.24em] text-primary/80">Run telemetry</p>
            <CardTitle>
              <h2>Run state</h2>
            </CardTitle>
            <CardDescription className="leading-6">
              {status.current_step_summary ?? "Waiting for the next action."}
            </CardDescription>
          </div>
          <StatusBadge tone={statusTone(status.status)}>{statusLabel(status.status)}</StatusBadge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <MetaTile label="Run ID" value={status.run_id} icon={<Waypoints className="size-3.5" />} />
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
            label="Updated"
            value={formatTimestamp(status.updated_at)}
            icon={<TimerReset className="size-3.5" />}
          />
        </div>

        {status.last_error ? (
          <div className="rounded-lg border border-destructive/35 bg-destructive/10 px-4 py-3 text-sm text-[#ffd1d1]">
            {status.last_error}
          </div>
        ) : null}
      </CardContent>

      <CardFooter className="flex flex-wrap gap-3 border-border bg-muted/35">
        {!isTerminalStatus(status.status) && onStop ? (
          <Button
            type="button"
            variant="destructive"
            size="icon"
            className="rounded-md"
            onClick={onStop}
            disabled={stopBusy}
            aria-label={stopBusy ? "Stopping..." : "Stop run"}
            title={stopBusy ? "Stopping..." : "Stop run"}
          >
            <Square className="size-4 fill-current" />
            <span className="sr-only">{stopBusy ? "Stopping..." : "Stop run"}</span>
          </Button>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="rounded-md"
          onClick={() => navigate("/")}
          aria-label="New run"
          title="New run"
        >
          <Plus className="size-4" />
          <span className="sr-only">New run</span>
        </Button>
        <div className="ml-auto hidden sm:block">
          <StatusBadge tone={connectionTone(connectionState)}>{connectionLabel(connectionState)}</StatusBadge>
        </div>
      </CardFooter>
    </Card>
  );
}
