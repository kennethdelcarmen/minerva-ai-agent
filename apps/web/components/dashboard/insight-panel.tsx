import { useDeferredValue, useEffect, useMemo, useState } from "react";

import { ExternalLink, Eye, FileJson2, ScrollText } from "lucide-react";

import { CodeBlock, EmptyState, StatusBadge } from "@/components/dashboard/dashboard-primitives";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MarkdownContent } from "@/components/ui/markdown-content";
import { Modal } from "@/components/ui/modal";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { eventTone, formatBytes, formatTimestamp, statusLabel } from "@/src/lib/dashboard-display";
import type { ArtifactDescriptor, EventType, ResultArtifactPayload, RunEvent, RunStatusResponse } from "@/src/lib/types";

const EVENT_TYPES: EventType[] = ["plan", "action", "observation", "approval", "error", "result"];

type InsightTab = "activity" | "result";
type ResultTab = "answer" | "advanced";
type EventFilter = "all" | EventType;

function formatStructuredResult(value: unknown): string {
  return JSON.stringify(value ?? null, null, 2);
}

function buildPreviewText(value: unknown): string {
  if (typeof value !== "string") {
    return value == null ? "No final answer yet." : JSON.stringify(value);
  }

  return value
    .replace(/\r\n/g, "\n")
    .replace(/```[\s\S]*?```/g, " code block ")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/[*_`>#-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function readBlockedResult(payload: ResultArtifactPayload | null): { status: "blocked"; message: string } | null {
  if (!payload || payload.result.status !== "blocked" || typeof payload.result.message !== "string") {
    return null;
  }

  return {
    status: "blocked",
    message: payload.result.message,
  };
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
          {status?.current_step_summary ?? "Minerva will list each important step here as it works."}
        </p>
      </div>

      <div className="flex flex-wrap gap-2" role="toolbar" aria-label="Activity filters">
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

      <ScrollArea className="h-136 rounded-xl border border-border bg-[#0d1317]">
        <div className="space-y-3 p-3">
          {visibleEvents.length === 0 ? (
            <EmptyState
              title="No activity yet."
              description="Plans, actions, observations, approvals, errors, and results will appear here as Minerva works."
              icon={<ScrollText className="size-5" />}
              className="min-h-48 border-0 bg-transparent"
            />
          ) : (
            visibleEvents.map((event) => (
              <article key={event.id} className="relative rounded-xl border border-border bg-card p-4">
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
  const blockedResult = readBlockedResult(resultPayload);
  const finalOutput =
    typeof resultPayload?.result.final_output === "string"
      ? resultPayload.result.final_output
      : blockedResult?.message;
  const previewText = buildPreviewText(finalOutput);
  const preview = previewText.length > 220 ? `${previewText.slice(0, 220).trimEnd()}...` : previewText;

  return (
    <div className="space-y-4">
      <p className="text-sm leading-6 text-muted-foreground">
        {terminalStatus
          ? `Final status: ${blockedResult ? "Blocked" : statusLabel(terminalStatus)}`
          : "The final answer and supporting files will appear here when the run finishes."}
      </p>

      <section className="rounded-xl border border-border bg-muted/35 p-4">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-lg border border-border bg-muted/50 text-foreground/80">
              <FileJson2 className="size-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-foreground">Final answer</h3>
              <p className="text-xs leading-5 text-muted-foreground">
                Read the answer first. Open the full view for markdown formatting and advanced details.
              </p>
            </div>
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
            View full answer
          </Button>
        </div>

        {resultPayload ? (
          <div className="rounded-xl border border-border bg-[#0d1317] p-4">
            <MarkdownContent value={finalOutput} className="markdown-preview" />
            {preview ? <p className="mt-4 text-xs leading-5 text-muted-foreground">Preview: {preview}</p> : null}
          </div>
        ) : (
          <EmptyState
            title="No final answer yet."
            description="Minerva will place the final answer here once the run reaches a result."
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
            <h3 className="text-sm font-semibold text-foreground">Supporting files</h3>
            <p className="text-xs leading-5 text-muted-foreground">
              Screenshots, result payloads, and other files stay attached to the run.
            </p>
          </div>
        </div>

        <div className="space-y-2">
          {deferredArtifacts.length === 0 ? (
            <EmptyState
              title="Supporting files will appear here."
              description="Minerva attaches screenshots and result files as the run progresses."
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
  const [activeTab, setActiveTab] = useState<ResultTab>("answer");
  const blockedResult = readBlockedResult(resultPayload);
  const finalOutput =
    typeof resultPayload?.result.final_output === "string"
      ? resultPayload.result.final_output
      : blockedResult?.message;

  useEffect(() => {
    if (open) {
      setActiveTab("answer");
    }
  }, [open]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Final answer"
      eyebrow="Result"
      description="Review the polished answer first, then open the advanced tab if you need the raw result payload."
      footer={
        <div className="flex justify-end">
          <Button type="button" variant="outline" className="rounded-md" onClick={onClose}>
            Close
          </Button>
        </div>
      }
    >
      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as ResultTab)} className="gap-4">
        <TabsList variant="line" className="w-full justify-start">
          <TabsTrigger value="answer" className="px-4">
            Answer
          </TabsTrigger>
          <TabsTrigger value="advanced" className="px-4">
            Advanced
          </TabsTrigger>
        </TabsList>

        <TabsContent value="answer">
          <section className="rounded-xl border border-primary/20 bg-primary/8 p-5">
            <p className="font-mono text-[0.68rem] font-medium uppercase tracking-[0.2em] text-primary/80">
              Operator answer
            </p>
            <div className="mt-4 rounded-xl border border-border bg-[#0d1317] p-5">
              <MarkdownContent value={finalOutput} />
            </div>
          </section>
        </TabsContent>

        <TabsContent value="advanced">
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
            <ScrollArea className="max-h-96 rounded-xl border border-border">
              <CodeBlock className="rounded-none border-0 bg-[#0d1317]">
                {formatStructuredResult(resultPayload?.result)}
              </CodeBlock>
            </ScrollArea>
          </section>
        </TabsContent>
      </Tabs>
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
  const [activeTab, setActiveTab] = useState<InsightTab>(() => (resultPayload ? "result" : "activity"));
  const [resultModalOpen, setResultModalOpen] = useState(false);
  const [presentedResultKey, setPresentedResultKey] = useState<string | null>(null);
  const resultKey = useMemo(
    () => (resultPayload ? `${resultPayload.status.run_id}:${resultPayload.status.completed_at ?? "pending"}` : null),
    [resultPayload],
  );

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
            <p className="font-mono text-[0.68rem] uppercase tracking-[0.24em] text-primary/80">Activity</p>
            <CardTitle>
              <h2>Activity and answer</h2>
            </CardTitle>
            <CardDescription className="leading-6">
              Follow the step-by-step activity, then review the final answer and supporting files.
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent>
          <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as InsightTab)} className="gap-4">
            <TabsList variant="line" className="w-full justify-start">
              <TabsTrigger value="activity" className="px-4">
                Activity
              </TabsTrigger>
              <TabsTrigger value="result" className="px-4">
                Final answer
              </TabsTrigger>
            </TabsList>

            <TabsContent value="activity">
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

      <ResultModal open={resultModalOpen} onClose={() => setResultModalOpen(false)} resultPayload={resultPayload} />
    </>
  );
}
