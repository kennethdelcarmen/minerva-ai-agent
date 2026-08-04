import { Globe2, ImageIcon } from "lucide-react";

import { ActivityIndicator, EmptyState, StatusBadge } from "@/components/dashboard/dashboard-primitives";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatTimestamp, runIndicatorState, statusLabel, statusTone } from "@/src/lib/dashboard-display";
import type { RunStatusResponse } from "@/src/lib/types";

export function BrowserViewportCard({
  runId,
  status,
  screenshotPath,
  artifactUrl,
}: {
  runId: string | null;
  status: RunStatusResponse | null;
  screenshotPath: string | null;
  artifactUrl: (runId: string, artifactPath: string) => string;
}) {
  const isIdle = !status;
  const indicatorState = status ? runIndicatorState(status.status, Boolean(status.pending_approval)) : "idle";
  const browserActivityLabel =
    indicatorState === "running"
      ? "Browser live"
      : indicatorState === "blocked"
        ? "Waiting for your review"
        : indicatorState === "success"
          ? "Browser complete"
          : indicatorState === "danger"
            ? "Browser ended"
            : "Browser idle";

  return (
    <Card className="overflow-hidden border-border bg-card shadow-[0_20px_70px_rgba(0,0,0,0.38)]">
      <CardHeader className="gap-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <p className="font-mono text-[0.68rem] uppercase tracking-[0.24em] text-primary/80">Browser</p>
            <CardTitle>
              <h2>What Minerva sees</h2>
            </CardTitle>
            <CardDescription className="leading-6">
              {status?.current_step_summary ?? "The live browser view appears here during a run."}
            </CardDescription>
            </div>
          <div className="flex flex-wrap items-center gap-2">
            {status ? <ActivityIndicator state={indicatorState} label={browserActivityLabel} size="sm" /> : null}
            <StatusBadge tone={status ? statusTone(status.status) : "neutral"}>
              {status ? statusLabel(status.status) : "Idle"}
            </StatusBadge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="rounded-2xl border border-border bg-[#0d1317] p-4 shadow-inner shadow-black/15">
          <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-md border border-primary/20 bg-primary/10 text-primary">
                <Globe2 className="size-4" />
              </div>
              <div className="min-w-0">
                <p className="font-mono text-[0.68rem] uppercase tracking-[0.2em] text-muted-foreground">Current run</p>
                <p className="truncate text-sm font-medium text-foreground">
                  {runId ? `Run ${runId}` : "Awaiting a new run"}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {status ? <ActivityIndicator state={indicatorState} label={browserActivityLabel} size="sm" /> : null}
              <StatusBadge tone={status ? statusTone(status.status) : "neutral"}>
                {status ? statusLabel(status.status) : "Idle"}
              </StatusBadge>
            </div>
          </div>

          <div className="mt-4 overflow-hidden rounded-xl border border-border bg-black">
            {screenshotPath && runId ? (
              <img
                src={artifactUrl(runId, screenshotPath)}
                alt="Latest browser state captured by the agent"
                className="h-[min(72vh,760px)] w-full object-contain bg-[#0c1115]"
              />
            ) : (
              <EmptyState
                title={
                  isIdle
                    ? "Start a run to watch the browser"
                    : indicatorState === "running"
                      ? "Starting browser"
                      : "Waiting for the first browser update"
                }
                description={
                  isIdle
                    ? "The browser view becomes the main stage once Minerva starts working."
                    : indicatorState === "running"
                      ? "Minerva is actively driving the browser. The first capture will appear as soon as the page settles."
                      : "Minerva will add browser captures as soon as the first step finishes."
                }
                icon={
                  indicatorState === "running" ? (
                    <ActivityIndicator state="running" size="lg" />
                  ) : (
                    <ImageIcon className="size-5" />
                  )
                }
                className="min-h-[420px] rounded-none border-0 bg-[linear-gradient(180deg,rgba(82,209,200,0.03),transparent_16%),#0c1115]"
              />
            )}
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px]">
            <div className="rounded-xl border border-border bg-muted/35 p-4">
              <p className="font-mono text-[0.64rem] font-medium uppercase tracking-[0.22em] text-muted-foreground">
                What it is doing
              </p>
              <p className="mt-3 text-sm leading-6 text-foreground">
                {status?.current_step_summary ?? "No active browser step yet."}
              </p>
            </div>
            <div className="rounded-xl border border-border bg-muted/35 p-4">
              <p className="font-mono text-[0.64rem] font-medium uppercase tracking-[0.22em] text-muted-foreground">
                Last updated
              </p>
              <p className="mt-3 font-mono text-sm leading-6 text-foreground">
                {status?.updated_at ? formatTimestamp(status.updated_at) : "Awaiting first update"}
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
