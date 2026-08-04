import { ArrowLeft, ArrowRight, Globe2, ImageIcon, RefreshCw } from "lucide-react";

import { EmptyState, StatusBadge } from "@/components/dashboard/dashboard-primitives";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatTimestamp, statusLabel, statusTone } from "@/src/lib/dashboard-display";
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

  return (
    <Card className="overflow-hidden border-border bg-card shadow-[0_20px_70px_rgba(0,0,0,0.38)]">
      <CardHeader className="gap-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <p className="font-mono text-[0.68rem] uppercase tracking-[0.24em] text-primary/80">Live state</p>
            <CardTitle>
              <h2>Browser viewport</h2>
            </CardTitle>
            <CardDescription className="leading-6">
              {status?.current_step_summary ?? "The live browser surface appears here during a run."}
            </CardDescription>
          </div>
          <StatusBadge tone={status ? statusTone(status.status) : "neutral"}>
            {status ? statusLabel(status.status) : "Idle"}
          </StatusBadge>
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
                <p className="font-mono text-[0.68rem] uppercase tracking-[0.2em] text-muted-foreground">Evidence feed</p>
                <p className="truncate text-sm font-medium text-foreground">
                  {runId ? `Run ${runId}` : "Awaiting a new run"}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone={status ? statusTone(status.status) : "neutral"}>
                {status ? statusLabel(status.status) : "Idle"}
              </StatusBadge>
              <div className="flex items-center gap-1 text-muted-foreground" aria-hidden="true">
                <span className="flex size-8 items-center justify-center rounded-md border border-border bg-muted/50">
                  <ArrowLeft className="size-3.5" />
                </span>
                <span className="flex size-8 items-center justify-center rounded-md border border-border bg-muted/50">
                  <ArrowRight className="size-3.5" />
                </span>
                <span className="flex size-8 items-center justify-center rounded-md border border-border bg-muted/50">
                  <RefreshCw className="size-3.5" />
                </span>
              </div>
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
                title={isIdle ? "Launch a run to watch the browser" : "Waiting on the first screenshot"}
                description={
                  isIdle
                    ? "The center stage shows the live browser surface, captured screenshots, and current step context."
                    : "The runner will attach browser captures once the first step callback completes."
                }
                icon={<ImageIcon className="size-5" />}
                className="min-h-[420px] rounded-none border-0 bg-[linear-gradient(180deg,rgba(82,209,200,0.03),transparent_16%),#0c1115]"
              />
            )}
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px]">
            <div className="rounded-xl border border-border bg-muted/35 p-4">
              <p className="font-mono text-[0.64rem] font-medium uppercase tracking-[0.22em] text-muted-foreground">
                Current context
              </p>
              <p className="mt-3 text-sm leading-6 text-foreground">
                {status?.current_step_summary ?? "No active browser step yet."}
              </p>
            </div>
            <div className="rounded-xl border border-border bg-muted/35 p-4">
              <p className="font-mono text-[0.64rem] font-medium uppercase tracking-[0.22em] text-muted-foreground">
                Last capture
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
