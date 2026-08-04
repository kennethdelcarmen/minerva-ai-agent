import { useDeferredValue, useEffect, useState } from "react";

import { ExternalLink, Eye, FileJson2, ScrollText } from "lucide-react";

import { CodeBlock, EmptyState, StatusBadge } from "@/components/dashboard/dashboard-primitives";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { eventTone, formatBytes, formatTimestamp, statusLabel } from "@/src/lib/dashboard-display";
import type { ArtifactDescriptor, EventType, ResultArtifactPayload, RunEvent, RunStatusResponse } from "@/src/lib/types";

const EVENT_TYPES: EventType[] = ["plan", "action", "observation", "approval", "error", "result"];

type InsightTab = "reasoning" | "result";
type EventFilter = "all" | EventType;

function formatResultValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (value == null) {
    return "No final output was returned for this run.";
  }

  return JSON.stringify(value, null, 2);
}

function ReasoningPanel({
  events,
  status,
}: {
  events: RunEvent[];
  status: RunStatusResponse | null;
}) {
  const [filter, setFilter] = useState<EventFilter>("all");
  const deferredEvents = useDeferredValue(events);
  const visibleEvents =
    filter === "all" ? deferredEvents : deferredEvents.filter((event) => event.type === filter);

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="text-sm leading-6 text-muted-foreground">
          {status?.current_step_summary ?? "The reasoning log will populate as the agent works."}
        </p>
      </div>

      <div className="flex flex-wrap gap-2" role="toolbar" aria-label="Event filters">
        <Button
          type="button"
          variant={filter === "all" ? "default" : "outline"}
          size="sm"
          className="rounded-md"
          aria-pressed={filter === "all"}
          onClick={() => setFilter("all")}
        >
          All
        </Button>
        {EVENT_TYPES.map((type) => {
          const count = deferredEvents.filter((event) => event.type === type).length;

          return (
            <Button
              key={type}
              type="button"
              variant={filter === type ? "default" : "outline"}
              size="sm"
              className="rounded-md capitalize"
              aria-pressed={filter === type}
              onClick={() => setFilter(type)}
            >
              {type} {count > 0 ? `(${count})` : ""}
            </Button>
          );
        })}
      </div>

      <ScrollArea className="h-[34rem] rounded-xl border border-border bg-[#0d1317]">
        <div className="space-y-3 p-3">
          {visibleEvents.length === 0 ? (
            <EmptyState
              title="No reasoning events yet."
              description="Plan, action, observation, approval, error, and result events will appear here."
              icon={<ScrollText className="size-5" />}
              className="min-h-48 border-0 bg-transparent"
            />
          ) : (
            visibleEvents.map((event) => (
              <article
                key={event.id}
                className="relative rounded-xl border border-border bg-card p-4"
              >
                <div className="pointer-events-none absolute inset-y-4 left-4 w-px bg-primary/18" />
                <div className="pl-4">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <StatusBadge tone={eventTone(event.type)}>{event.type}</StatusBadge>
                    <span className="font-mono">#{event.sequence}</span>
                    <time className="font-mono" dateTime={event.timestamp}>
                      {formatTimestamp(event.timestamp)}
                    </time>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-foreground">{event.summary}</p>
                </div>
              </article>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function ResultPanel({
  runId,
  artifacts,
  resultPayload,
  artifactUrl,
  onOpenResultModal,
}: {
  runId: string;
  artifacts: ArtifactDescriptor[];
  resultPayload: ResultArtifactPayload | null;
  artifactUrl: (runId: string, artifactPath: string) => string;
  onOpenResultModal: () => void;
}) {
  const deferredArtifacts = useDeferredValue(artifacts);
  const terminalStatus = resultPayload?.status.status ?? null;
  const finalOutput = resultPayload?.result.final_output;
  const formattedFinalOutput = formatResultValue(finalOutput);
  const finalOutputPreview =
    formattedFinalOutput.length > 240
      ? `${formattedFinalOutput.slice(0, 240).trimEnd()}...`
      : formattedFinalOutput;

  return (
    <div className="space-y-4">
      <p className="text-sm leading-6 text-muted-foreground">
        {terminalStatus
          ? `Result status: ${statusLabel(terminalStatus)}`
          : "Structured output and artifacts will appear after the run finishes."}
      </p>

      <div className="space-y-4">
        <section className="rounded-xl border border-border bg-muted/35 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex size-9 items-center justify-center rounded-lg border border-border bg-muted/50 text-foreground/80">
              <FileJson2 className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold text-foreground">Final output</h3>
              <p className="text-xs leading-5 text-muted-foreground">
                Open the modal for the operator-facing output and full structured payload.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-md"
              onClick={onOpenResultModal}
              disabled={!resultPayload}
            >
              <Eye className="size-3.5" />
              View output
            </Button>
          </div>
          {resultPayload ? (
            <div className="rounded-xl border border-border bg-[#0d1317] p-4">
              <p className="font-mono text-[0.68rem] font-medium uppercase tracking-[0.2em] text-muted-foreground">
                Preview
              </p>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-foreground">{finalOutputPreview}</p>
            </div>
          ) : (
            <EmptyState
              title="No final output yet."
              description="The modal will unlock once the run writes a terminal result artifact."
              className="min-h-40"
            />
          )}
        </section>

        <section className="rounded-xl border border-border bg-muted/35 p-4">
          <div className="mb-3 flex items-center gap-2">
            <div className="flex size-9 items-center justify-center rounded-lg border border-border bg-card text-foreground/80">
              <ExternalLink className="size-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">Artifacts</h3>
            </div>
          </div>

          <div className="space-y-2">
            {deferredArtifacts.length === 0 ? (
              <EmptyState
                title="Artifacts will appear here once the run produces them."
                description="Screenshots, result payloads, and other exported files stay attached to the run."
                className="min-h-40"
              />
            ) : (
              deferredArtifacts.map((artifact) => (
                <a
                  key={artifact.path}
                  className="flex items-center justify-between gap-4 rounded-lg border border-border bg-card px-4 py-3 text-sm transition-colors hover:border-primary/45 hover:bg-muted/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  href={artifactUrl(runId, artifact.path)}
                  target="_blank"
                  rel="noreferrer"
                >
                  <div className="min-w-0">
                    <p className="break-all font-medium text-foreground">{artifact.path}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {artifact.kind} · {formatBytes(artifact.size_bytes)}
                    </p>
                  </div>
                  <StatusBadge tone="neutral" className="shrink-0 px-2" aria-hidden="true">
                    <ExternalLink className="size-3" />
                  </StatusBadge>
                </a>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function ResultModal({
  open,
  onClose,
  resultPayload,
}: {
  open: boolean;
  onClose: () => void;
  resultPayload: ResultArtifactPayload | null;
}) {
  const finalOutput = resultPayload?.result.final_output;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Final output"
      description="Review the operator-facing answer and the raw structured result before you move on."
      footer={
        <div className="flex justify-end">
          <Button type="button" variant="outline" className="rounded-md" onClick={onClose}>
            Close
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        <section className="rounded-xl border border-primary/20 bg-primary/8 p-5">
          <p className="font-mono text-[0.68rem] font-medium uppercase tracking-[0.2em] text-primary/80">
            Operator answer
          </p>
          <div className="mt-3 rounded-xl border border-border bg-[#0d1317] p-4">
            <p className="whitespace-pre-wrap text-sm leading-7 text-foreground">{formatResultValue(finalOutput)}</p>
          </div>
        </section>

        <section className="rounded-xl border border-border bg-muted/35 p-5">
          <div className="mb-3 flex items-center gap-2">
            <div className="flex size-9 items-center justify-center rounded-lg border border-border bg-card text-foreground/80">
              <FileJson2 className="size-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">Structured result</h3>
              <p className="text-xs leading-5 text-muted-foreground">
                Raw payload persisted to the run artifact store.
              </p>
            </div>
          </div>
          <ScrollArea className="max-h-[24rem] rounded-xl border border-border">
            <CodeBlock className="rounded-none border-0 bg-[#0d1317]">
              {JSON.stringify(resultPayload?.result ?? null, null, 2)}
            </CodeBlock>
          </ScrollArea>
        </section>
      </div>
    </Modal>
  );
}

export function InsightPanel({
  runId,
  status,
  events,
  artifacts,
  resultPayload,
  artifactUrl,
}: {
  runId: string | null;
  status: RunStatusResponse | null;
  events: RunEvent[];
  artifacts: ArtifactDescriptor[];
  resultPayload: ResultArtifactPayload | null;
  artifactUrl: (runId: string, artifactPath: string) => string;
}) {
  const [activeTab, setActiveTab] = useState<InsightTab>(() => (resultPayload ? "result" : "reasoning"));
  const [resultModalOpen, setResultModalOpen] = useState(false);
  const [presentedResultKey, setPresentedResultKey] = useState<string | null>(null);
  const resultKey = resultPayload
    ? `${resultPayload.status.run_id}:${resultPayload.status.completed_at ?? "pending"}`
    : null;

  useEffect(() => {
    if (resultPayload) {
      setActiveTab("result");
    }
  }, [resultPayload]);

  useEffect(() => {
    if (!resultKey || presentedResultKey === resultKey) {
      return;
    }

    setActiveTab("result");
    setResultModalOpen(true);
    setPresentedResultKey(resultKey);
  }, [presentedResultKey, resultKey]);

  return (
    <>
      <Card className="border-border bg-card">
        <CardHeader className="gap-4">
          <div className="space-y-1">
            <p className="font-mono text-[0.68rem] uppercase tracking-[0.24em] text-primary/80">Evidence and results</p>
            <CardTitle>
              <h2>Operator insight</h2>
            </CardTitle>
            <CardDescription className="leading-6">
              Trace the agent&apos;s reasoning trail, approvals, outputs, and exported artifacts.
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent>
          <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as InsightTab)} className="gap-4">
            <TabsList variant="line" className="w-full justify-start">
              <TabsTrigger value="reasoning" className="px-4">
                Reasoning
              </TabsTrigger>
              <TabsTrigger value="result" className="px-4">
                Result
              </TabsTrigger>
            </TabsList>

            <TabsContent value="reasoning">
              <ReasoningPanel events={events} status={status} />
            </TabsContent>
            <TabsContent value="result">
              <ResultPanel
                runId={runId ?? "run"}
                artifacts={artifacts}
                resultPayload={resultPayload}
                artifactUrl={artifactUrl}
                onOpenResultModal={() => setResultModalOpen(true)}
              />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <ResultModal
        open={resultModalOpen}
        onClose={() => setResultModalOpen(false)}
        resultPayload={resultPayload}
      />
    </>
  );
}
