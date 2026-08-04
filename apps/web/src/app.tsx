import { startTransition, useEffect, useState, type FormEvent } from "react";
import { Plus } from "lucide-react";

import { ApprovalPanel } from "@/components/dashboard/approval-panel";
import { BrowserViewportCard } from "@/components/dashboard/browser-viewport-card";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { ScreenPanel, SignalTile } from "@/components/dashboard/dashboard-primitives";
import { InsightPanel } from "@/components/dashboard/insight-panel";
import { LauncherCard } from "@/components/dashboard/launcher-card";
import { RunSummaryCard } from "@/components/dashboard/run-summary-card";

import {
  artifactUrl,
  createRun,
  decideApproval,
  fetchArtifacts,
  fetchResultArtifact,
  fetchRunStatus,
  runEventsUrl,
  stopRun,
} from "./lib/api";
import {
  connectionLabel,
  connectionTone,
  formatTimestamp,
  isTerminalStatus,
  statusLabel,
  statusTone,
} from "./lib/dashboard-display";
import type {
  ArtifactDescriptor,
  EventType,
  ResultArtifactPayload,
  RunEvent,
  RunStatus,
  RunStatusResponse,
} from "./lib/types";
import { Button } from "@/components/ui/button";

const EVENT_TYPES: EventType[] = ["plan", "action", "observation", "approval", "error", "result"];

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected error";
}

function latestScreenshotPath(artifacts: ArtifactDescriptor[]): string | null {
  for (let index = artifacts.length - 1; index >= 0; index -= 1) {
    if (artifacts[index].kind === "screenshot") {
      return artifacts[index].path;
    }
  }

  return null;
}

async function loadRunSnapshot(runId: string): Promise<{
  status: RunStatusResponse;
  artifacts: ArtifactDescriptor[];
  screenshotPath: string | null;
  resultPayload: ResultArtifactPayload | null;
}> {
  const [status, artifactResponse] = await Promise.all([fetchRunStatus(runId), fetchArtifacts(runId)]);
  const screenshotPath = latestScreenshotPath(artifactResponse.artifacts);
  const hasResultArtifact = artifactResponse.artifacts.some((artifact) => artifact.path === "result.json");
  const resultPayload = hasResultArtifact ? await fetchResultArtifact(runId) : null;

  return {
    status,
    artifacts: artifactResponse.artifacts,
    screenshotPath,
    resultPayload,
  };
}

function usePathname() {
  const [pathname, setPathname] = useState(() => window.location.pathname);

  useEffect(() => {
    const handlePopState = () => {
      setPathname(window.location.pathname);
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  function navigate(nextPath: string) {
    window.history.pushState({}, "", nextPath);
    setPathname(nextPath);
  }

  return { pathname, navigate };
}

function HomePage({ navigate }: { navigate: (path: string) => void }) {
  const [task, setTask] = useState("");
  const [model, setModel] = useState("");
  const [headless, setHeadless] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const created = await createRun({
        task,
        model: model.trim() || null,
        headless,
      });
      startTransition(() => {
        navigate(`/runs/${created.run_id}`);
      });
    } catch (error) {
      setSubmitError(getErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <DashboardShell
      title="Operator Console"
      lede="Issue a run brief, monitor the live browser state, and intercept approval-gated actions before they commit."
      bannerMeta={
        <>
          <SignalTile label="Mode" value="Idle" tone="neutral" detail="Console is ready for the next operator brief." />
          <SignalTile label="Composer" value="Ready" tone="info" detail="Natural-language briefing with constraints and stop line." />
          <SignalTile label="Stream" value="No run" tone="neutral" detail="Live event transport is waiting on a run." />
          <SignalTile label="Artifacts" value="Waiting" tone="neutral" detail="Screenshots and result exports attach per run." />
        </>
      }
      leftRail={
        <>
          <LauncherCard
            task={task}
            setTask={setTask}
            model={model}
            setModel={setModel}
            headless={headless}
            setHeadless={setHeadless}
            submitting={isSubmitting}
            submitError={submitError}
            onSubmit={handleSubmit}
            helperText="Write the run brief the operator wants executed, including hard constraints and where the agent must stop."
          />

          <RunSummaryCard status={null} connectionState="idle" navigate={navigate} />
          <ApprovalPanel
            pendingApproval={null}
            note=""
            onNoteChange={() => undefined}
            onApprove={() => undefined}
            onReject={() => undefined}
            busy={false}
          />
        </>
      }
      centerStage={
        <BrowserViewportCard runId={null} status={null} screenshotPath={null} artifactUrl={artifactUrl} />
      }
      rightRail={
        <InsightPanel
          runId={null}
          status={null}
          events={[]}
          artifacts={[]}
          resultPayload={null}
          artifactUrl={artifactUrl}
        />
      }
    />
  );
}

function RunPage({ runId, navigate }: { runId: string; navigate: (path: string) => void }) {
  const [status, setStatus] = useState<RunStatusResponse | null>(null);
  const [artifacts, setArtifacts] = useState<ArtifactDescriptor[]>([]);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [resultPayload, setResultPayload] = useState<ResultArtifactPayload | null>(null);
  const [screenshotPath, setScreenshotPath] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState("connecting");
  const [pageError, setPageError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [newRunTask, setNewRunTask] = useState("");
  const [newRunModel, setNewRunModel] = useState("");
  const [newRunHeadless, setNewRunHeadless] = useState(false);
  const [newRunSubmitting, setNewRunSubmitting] = useState(false);
  const [newRunError, setNewRunError] = useState<string | null>(null);
  const [approvalNote, setApprovalNote] = useState("");
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [stopBusy, setStopBusy] = useState(false);

  useEffect(() => {
    let active = true;

    async function refresh() {
      try {
        const snapshot = await loadRunSnapshot(runId);
        if (!active) {
          return;
        }

        setStatus(snapshot.status);
        setArtifacts(snapshot.artifacts);
        setScreenshotPath(snapshot.screenshotPath);
        setResultPayload(snapshot.resultPayload);
        setPageError(null);
      } catch (error) {
        if (active) {
          setPageError(getErrorMessage(error));
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void refresh();
    return () => {
      active = false;
    };
  }, [runId]);

  useEffect(() => {
    if (status && isTerminalStatus(status.status)) {
      setConnectionState("complete");
      return;
    }

    const timer = window.setInterval(() => {
      void loadRunSnapshot(runId)
        .then((snapshot) => {
          setStatus(snapshot.status);
          setArtifacts(snapshot.artifacts);
          setScreenshotPath((current) => snapshot.screenshotPath ?? current);
          setResultPayload(snapshot.resultPayload);
          setPageError(null);
        })
        .catch((error) => {
          setPageError(getErrorMessage(error));
        });
    }, 4000);

    return () => window.clearInterval(timer);
  }, [runId, status]);

  useEffect(() => {
    if (!status) {
      return;
    }

    setNewRunModel((current) => current || status.model);
  }, [status]);

  useEffect(() => {
    async function handleVisibilityChange() {
      if (document.visibilityState !== "visible") {
        return;
      }

      try {
        const snapshot = await loadRunSnapshot(runId);
        setStatus(snapshot.status);
        setArtifacts(snapshot.artifacts);
        setScreenshotPath((current) => snapshot.screenshotPath ?? current);
        setResultPayload(snapshot.resultPayload);
      } catch (error) {
        setPageError(getErrorMessage(error));
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [runId]);

  useEffect(() => {
    const stream = new EventSource(runEventsUrl(runId));
    setConnectionState("connecting");

    stream.onopen = () => {
      setConnectionState("live");
    };

    const listeners = EVENT_TYPES.map((eventType) => {
      const handler = (message: MessageEvent<string>) => {
        const payload = JSON.parse(message.data) as RunEvent;

        setEvents((current) => {
          if (current.some((event) => event.id === payload.id)) {
            return current;
          }
          return [...current, payload];
        });

        setStatus((current) => {
          if (!current) {
            return current;
          }

          const next: RunStatusResponse = {
            ...current,
            current_step_summary: payload.summary,
          };

          if (payload.type === "approval") {
            const approvalId = typeof payload.data.approval_id === "string" ? payload.data.approval_id : null;
            const actionName = typeof payload.data.action_name === "string" ? payload.data.action_name : "action";
            const reason = typeof payload.data.reason === "string" ? payload.data.reason : "Operator approval required.";
            next.status = "waiting_for_approval";
            next.pending_approval_id = approvalId;
            next.pending_approval = approvalId
              ? {
                  id: approvalId,
                  action_name: actionName,
                  params:
                    typeof payload.data.params === "object" && payload.data.params
                      ? (payload.data.params as Record<string, unknown>)
                      : {},
                  reason,
                  requested_at: payload.timestamp,
                }
              : null;
          }

          if (payload.type === "result") {
            const resultStatus = payload.data.status;
            if (typeof resultStatus === "string") {
              next.status = resultStatus as RunStatus;
            }
            next.completed_at = payload.timestamp;
            next.pending_approval = null;
            next.pending_approval_id = null;
          }

          if (payload.type === "error" && current.status !== "stopped") {
            next.last_error = payload.summary;
          }

          return next;
        });

        if (typeof payload.data.screenshot === "string") {
          setScreenshotPath(payload.data.screenshot);
        }

        if (payload.type === "result") {
          setConnectionState("complete");
          void loadRunSnapshot(runId)
            .then((snapshot) => {
              setStatus(snapshot.status);
              setArtifacts(snapshot.artifacts);
              setScreenshotPath((current) => snapshot.screenshotPath ?? current);
              setResultPayload(snapshot.resultPayload);
            })
            .catch((error) => setPageError(getErrorMessage(error)));
        }
      };

      stream.addEventListener(eventType, handler as EventListener);
      return [eventType, handler] as const;
    });

    stream.onerror = () => {
      setConnectionState((current) => (current === "complete" ? current : "reconnecting"));
    };

    return () => {
      for (const [eventType, handler] of listeners) {
        stream.removeEventListener(eventType, handler as EventListener);
      }
      stream.close();
    };
  }, [runId]);

  async function handleApproval(decision: "approve" | "reject") {
    if (!status?.pending_approval) {
      return;
    }

    setApprovalBusy(true);
    try {
      const nextStatus = await decideApproval(runId, status.pending_approval.id, decision, approvalNote);
      setStatus(nextStatus);
      setApprovalNote("");
    } catch (error) {
      setPageError(getErrorMessage(error));
    } finally {
      setApprovalBusy(false);
    }
  }

  async function handleStop() {
    setStopBusy(true);
    try {
      const nextStatus = await stopRun(runId);
      setStatus(nextStatus);
    } catch (error) {
      setPageError(getErrorMessage(error));
    } finally {
      setStopBusy(false);
    }
  }

  async function handleCreateRun(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNewRunSubmitting(true);
    setNewRunError(null);

    try {
      const created = await createRun({
        task: newRunTask,
        model: newRunModel.trim() || null,
        headless: newRunHeadless,
      });
      startTransition(() => {
        navigate(`/runs/${created.run_id}`);
      });
    } catch (error) {
      setNewRunError(getErrorMessage(error));
    } finally {
      setNewRunSubmitting(false);
    }
  }

  if (loading) {
    return (
      <ScreenPanel
        title="Loading run"
        description="Fetching the latest status, screenshots, and stored artifacts."
        showSkeleton
      />
    );
  }

  if (!status) {
    return (
      <ScreenPanel
        title="Run unavailable"
        description={pageError ?? "The run could not be loaded."}
        tone="danger"
        action={
          <Button type="button" variant="outline" className="rounded-xl" onClick={() => navigate("/")}>
            Back to launcher
          </Button>
        }
      />
    );
  }

  return (
    <DashboardShell
      title={`Run ${status.run_id}`}
      lede={status.task}
      mobileLayout="stage-first"
      bannerMeta={
        <>
          <SignalTile
            label="Status"
            value={statusLabel(status.status)}
            tone={statusTone(status.status)}
            detail="Current run lifecycle state."
          />
          <SignalTile label="Model" value={status.model} tone="info" detail="Execution model for this run." />
          <SignalTile
            label="Stream"
            value={connectionLabel(connectionState)}
            tone={connectionTone(connectionState)}
            detail="SSE delivery health for live updates."
          />
          <SignalTile
            label="Updated"
            value={formatTimestamp(status.updated_at)}
            tone="neutral"
            detail="Last snapshot refresh from the backend."
          />
        </>
      }
      bannerAction={
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="rounded-xl"
          onClick={() => navigate("/")}
          aria-label="New run"
          title="New run"
        >
          <Plus className="size-4" />
          <span className="sr-only">New run</span>
        </Button>
      }
      leftRail={
        <>
          <LauncherCard
            task={newRunTask}
            setTask={setNewRunTask}
            model={newRunModel}
            setModel={setNewRunModel}
            headless={newRunHeadless}
            setHeadless={setNewRunHeadless}
            submitting={newRunSubmitting}
            submitError={newRunError}
            onSubmit={handleCreateRun}
            helperText="Queue a fresh run brief from the same console without interrupting the current one."
          />

          <RunSummaryCard
            status={status}
            connectionState={connectionState}
            onStop={handleStop}
            stopBusy={stopBusy}
            navigate={navigate}
          />
          <ApprovalPanel
            pendingApproval={status.pending_approval}
            note={approvalNote}
            onNoteChange={setApprovalNote}
            onApprove={() => void handleApproval("approve")}
            onReject={() => void handleApproval("reject")}
            busy={approvalBusy}
          />
        </>
      }
      centerStage={
        <BrowserViewportCard
          runId={runId}
          status={status}
          screenshotPath={screenshotPath}
          artifactUrl={artifactUrl}
        />
      }
      rightRail={
        <InsightPanel
          runId={runId}
          status={status}
          events={events}
          artifacts={artifacts}
          resultPayload={resultPayload}
          artifactUrl={artifactUrl}
        />
      }
    />
  );
}

function NotFoundPage({ navigate }: { navigate: (path: string) => void }) {
  return (
    <ScreenPanel
      title="Unknown route"
      description="Use the launcher to start a new browser task or open a known run URL."
      action={
        <Button type="button" className="rounded-xl" onClick={() => navigate("/")}>
          Go to launcher
        </Button>
      }
    />
  );
}

export function AppRoutes() {
  const { pathname, navigate } = usePathname();
  const runMatch = pathname.match(/^\/runs\/([^/]+)$/);

  if (pathname === "/") {
    return <HomePage navigate={navigate} />;
  }

  if (runMatch) {
    return <RunPage runId={decodeURIComponent(runMatch[1])} navigate={navigate} />;
  }

  return <NotFoundPage navigate={navigate} />;
}

export default function App() {
  return <AppRoutes />;
}
