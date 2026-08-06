import { startTransition, useEffect, useEffectEvent, useRef, useState, type FormEvent } from "react";
import { AlertTriangle, Plus } from "lucide-react";

import { ApprovalModal } from "@/components/dashboard/approval-modal";
import { BrowserViewportCard } from "@/components/dashboard/browser-viewport-card";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { ScreenPanel, SignalTile } from "@/components/dashboard/dashboard-primitives";
import { InsightPanel } from "@/components/dashboard/insight-panel";
import { LauncherCard } from "@/components/dashboard/launcher-card";
import { RunCommandBar } from "@/components/dashboard/run-command-bar";
import { RunSummaryCard } from "@/components/dashboard/run-summary-card";

import {
  ApiError,
  artifactUrl,
  createRun,
  decideApproval,
  fetchArtifacts,
  fetchModelCatalog,
  fetchResultArtifact,
  fetchRunStatus,
  isApiError,
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
  ModelCatalogResponse,
  ResultArtifactPayload,
  RunEvent,
  RunStatus,
  RunStatusResponse,
} from "./lib/types";
import { Button } from "@/components/ui/button";

const EVENT_TYPES: EventType[] = ["plan", "action", "observation", "approval", "error", "result"];
const GENERIC_FAILURE_MESSAGES = new Set(["failed", "run failed"]);
type RunAvailability = "available" | "unavailable";

function getErrorMessage(error: unknown): string {
  if (isApiError(error)) {
    return error.detail;
  }

  return error instanceof Error ? error.message : "Unexpected error";
}

function isRunUnavailableError(error: unknown): error is ApiError {
  return isApiError(error) && error.status === 404;
}

function normalizeMessage(message: string | null | undefined): string | null {
  const normalized = message?.trim().toLowerCase();
  return normalized ? normalized : null;
}

function mergeRunStatus(current: RunStatusResponse | null, next: RunStatusResponse): RunStatusResponse {
  if (!current?.last_error || next.status !== "failed") {
    return next;
  }

  const nextError = normalizeMessage(next.last_error);
  if (nextError === null || GENERIC_FAILURE_MESSAGES.has(nextError)) {
    return {
      ...next,
      last_error: current.last_error,
    };
  }

  return next;
}

function resolveApprovalDecisionStatus(
  next: RunStatusResponse,
  approvalId: string,
  decision: "approve" | "reject",
): RunStatusResponse {
  if (next.pending_approval?.id !== approvalId) {
    return next;
  }

  return {
    ...next,
    status: decision === "approve" ? "running" : "failed",
    pending_approval: null,
    pending_approval_id: null,
  };
}

function latestScreenshotPath(artifacts: ArtifactDescriptor[]): string | null {
  for (let index = artifacts.length - 1; index >= 0; index -= 1) {
    if (artifacts[index].kind === "screenshot") {
      return artifacts[index].path;
    }
  }

  return null;
}

function upsertArtifact(artifacts: ArtifactDescriptor[], nextArtifact: ArtifactDescriptor): ArtifactDescriptor[] {
  const existingIndex = artifacts.findIndex((artifact) => artifact.path === nextArtifact.path);
  if (existingIndex === -1) {
    return [...artifacts, nextArtifact];
  }

  const nextArtifacts = [...artifacts];
  nextArtifacts[existingIndex] = {
    ...nextArtifacts[existingIndex],
    ...nextArtifact,
  };
  return nextArtifacts;
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

function getSupportedModelIds(catalog: ModelCatalogResponse): Set<string> {
  return new Set(catalog.models.map((option) => option.id))
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
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    setPathname(nextPath);
  }

  return { pathname, navigate };
}

function HomePage({ navigate }: { navigate: (path: string) => void }) {
  const [task, setTask] = useState("");
  const [model, setModel] = useState("");
  const [modelCatalog, setModelCatalog] = useState<ModelCatalogResponse | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [modelCatalogError, setModelCatalogError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    void fetchModelCatalog()
      .then((catalog) => {
        if (!active) {
          return;
        }

        setModelCatalog(catalog);
        setModel((current) => current || catalog.default_model);
        setModelCatalogError(null);
      })
      .catch((error) => {
        if (active) {
          setModelCatalogError(getErrorMessage(error));
        }
      });

    return () => {
      active = false;
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const created = await createRun({
        task,
        model: model || modelCatalog?.default_model || null,
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
      bannerMeta={
        <>
          <SignalTile label="Status" value="Ready" tone="success" detail="Minerva is ready for a new task." />
          <SignalTile label="Approvals" value="On" tone="warning" detail="Sensitive actions still pause for your review." />
          <SignalTile label="Browser" value="Waiting" tone="neutral" detail="The browser view appears after a run starts." />
          <SignalTile label="Answer" value="Markdown" tone="info" detail="Final answers are rendered for easy reading." />
        </>
      }
      leftRail={
        <>
          <LauncherCard
            task={task}
            setTask={setTask}
            model={model}
            setModel={setModel}
            modelOptions={modelCatalog?.models ?? []}
            modelSelectDisabled={modelCatalog === null && modelCatalogError === null}
            submitting={isSubmitting}
            submitError={submitError ?? modelCatalogError}
            onSubmit={handleSubmit}
            helperText="Describe the job in plain language and say exactly where Minerva should stop and ask you."
          />

          <RunSummaryCard status={null} connectionState="idle" navigate={navigate} />
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
  const [runAvailability, setRunAvailability] = useState<RunAvailability>("available");
  const [loading, setLoading] = useState(true);
  const [approvalNote, setApprovalNote] = useState("");
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [stopBusy, setStopBusy] = useState(false);
  const [retryBusy, setRetryBusy] = useState(false);
  const artifactsRef = useRef<ArtifactDescriptor[]>([]);
  const resultPayloadRef = useRef<ResultArtifactPayload | null>(null);

  const markRunUnavailable = useEffectEvent((error: unknown) => {
    setRunAvailability("unavailable");
    setStatus(null);
    setArtifacts([]);
    setEvents([]);
    setResultPayload(null);
    setScreenshotPath(null);
    setConnectionState("idle");
    setPageError(getErrorMessage(error));
  });

  useEffect(() => {
    setRunAvailability("available");
    setLoading(true);
    setPageError(null);
    setStatus(null);
    setArtifacts([]);
    setEvents([]);
    setResultPayload(null);
    setScreenshotPath(null);
    setConnectionState("connecting");
  }, [runId]);

  useEffect(() => {
    artifactsRef.current = artifacts;
  }, [artifacts]);

  useEffect(() => {
    resultPayloadRef.current = resultPayload;
  }, [resultPayload]);

  useEffect(() => {
    let active = true;

    async function refresh() {
      try {
        const snapshot = await loadRunSnapshot(runId);
        if (!active) {
          return;
        }

        setStatus((current) => mergeRunStatus(current, snapshot.status));
        setArtifacts(snapshot.artifacts);
        setScreenshotPath(snapshot.screenshotPath);
        setResultPayload(snapshot.resultPayload);
        setRunAvailability("available");
        setPageError(null);
      } catch (error) {
        if (active) {
          if (isRunUnavailableError(error)) {
            markRunUnavailable(error);
          } else {
            setPageError(getErrorMessage(error));
          }
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
    if (runAvailability === "unavailable" || connectionState !== "reconnecting") {
      return;
    }

    const retryTimer = window.setTimeout(() => {
      void loadRunSnapshot(runId)
        .then((snapshot) => {
          setStatus((current) => mergeRunStatus(current, snapshot.status));
          setArtifacts(snapshot.artifacts);
          setScreenshotPath((current) => snapshot.screenshotPath ?? current);
          setResultPayload(snapshot.resultPayload);
          setRunAvailability("available");
          setPageError(null);
        })
        .catch((error) => {
          if (isRunUnavailableError(error)) {
            markRunUnavailable(error);
            return;
          }

          setPageError(getErrorMessage(error));
        });
    }, 500);

    return () => window.clearTimeout(retryTimer);
  }, [connectionState, markRunUnavailable, runAvailability, runId]);

  useEffect(() => {
    if (runAvailability === "unavailable") {
      return;
    }

    async function handleVisibilityChange() {
      if (document.visibilityState !== "visible") {
        return;
      }

      try {
        const snapshot = await loadRunSnapshot(runId);
        setStatus((current) => mergeRunStatus(current, snapshot.status));
        setArtifacts(snapshot.artifacts);
        setScreenshotPath((current) => snapshot.screenshotPath ?? current);
        setResultPayload(snapshot.resultPayload);
        setRunAvailability("available");
        setPageError(null);
      } catch (error) {
        if (isRunUnavailableError(error)) {
          markRunUnavailable(error);
          return;
        }

        setPageError(getErrorMessage(error));
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [markRunUnavailable, runAvailability, runId]);

  useEffect(() => {
    if (runAvailability === "unavailable") {
      return;
    }

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

          if (payload.type === "observation") {
            const approvalId = typeof payload.data.approval_id === "string" ? payload.data.approval_id : null;
            if (approvalId && current.pending_approval?.id === approvalId) {
              next.status = "running";
              next.pending_approval = null;
              next.pending_approval_id = null;
            }
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
          setArtifacts((current) =>
            upsertArtifact(current, {
              kind: "screenshot",
              path: payload.data.screenshot,
              size_bytes: 0,
            }),
          );
        }

        if (payload.type === "result") {
          setConnectionState("complete");
          const hasResultArtifact = artifactsRef.current.some((artifact) => artifact.path === "result.json");
          if (!hasResultArtifact || resultPayloadRef.current === null) {
            void loadRunSnapshot(runId)
              .then((snapshot) => {
                setStatus((current) => mergeRunStatus(current, snapshot.status));
                setArtifacts(snapshot.artifacts);
                setScreenshotPath((current) => snapshot.screenshotPath ?? current);
                setResultPayload(snapshot.resultPayload);
              })
              .catch((error) => setPageError(getErrorMessage(error)));
          }
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
  }, [runAvailability, runId]);

  async function handleApproval(decision: "approve" | "reject") {
    const pendingApproval = status?.pending_approval;
    if (!pendingApproval) {
      return;
    }

    setApprovalBusy(true);
    try {
      const nextStatus = await decideApproval(runId, pendingApproval.id, decision, approvalNote);
      setStatus(resolveApprovalDecisionStatus(nextStatus, pendingApproval.id, decision));
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

  async function handleRetry() {
    if (status?.status !== "failed") {
      return;
    }

    setRetryBusy(true);
    setPageError(null);

    try {
      let nextModel: string | null = null;

      try {
        const modelCatalog = await fetchModelCatalog();
        const supportedModels = getSupportedModelIds(modelCatalog);
        nextModel = supportedModels.has(status.model) ? status.model : modelCatalog.default_model;
      } catch {
        nextModel = null;
      }

      const created = await createRun({
        task: status.task,
        model: nextModel,
      });

      startTransition(() => {
        navigate(`/runs/${created.run_id}`);
      });
    } catch (error) {
      setPageError(getErrorMessage(error));
    } finally {
      setRetryBusy(false);
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
    <>
      <DashboardShell
        className="pb-32 sm:pb-36"
        mobileLayout="stage-first"
        bannerMeta={
          <>
            <SignalTile
              label="Status"
              value={statusLabel(status.status)}
              tone={statusTone(status.status)}
              detail="Current run lifecycle state."
            />
            <SignalTile label="Stream" value={connectionLabel(connectionState)} tone={connectionTone(connectionState)} detail="Live update connection health." />
            <SignalTile label="Updated" value={formatTimestamp(status.updated_at)} tone="neutral" detail="Last update received from the backend." />
            <SignalTile
              label="Decision"
              value={status.pending_approval ? "Needed" : "Clear"}
              tone={status.pending_approval ? "warning" : "success"}
              detail="Whether Minerva is waiting on your approval."
            />
          </>
        }
        bannerAction={
          <Button
            type="button"
            variant="outline"
            className="rounded-xl px-4"
            onClick={() => navigate("/")}
          >
            <Plus className="size-4" />
            New run
          </Button>
        }
        leftRail={
          <>
            {pageError ? (
              <section
                role="alert"
                className="rounded-xl border border-destructive/35 bg-destructive/10 px-4 py-3 text-[#ffd1d1]"
              >
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  <div className="space-y-1">
                    <p className="font-mono text-[0.64rem] font-medium uppercase tracking-[0.2em]">
                      Refresh issue
                    </p>
                    <p className="text-sm leading-6">{pageError}</p>
                  </div>
                </div>
              </section>
            ) : null}
            <RunSummaryCard
              status={status}
              connectionState={connectionState}
              onStop={handleStop}
              stopBusy={stopBusy}
              navigate={navigate}
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
      <RunCommandBar
        status={status}
        stopBusy={stopBusy}
        retryBusy={retryBusy}
        onStop={!isTerminalStatus(status.status) ? () => void handleStop() : undefined}
        onRetry={status.status === "failed" ? () => void handleRetry() : undefined}
        onStartAnotherRun={() => navigate("/")}
      />
      <ApprovalModal
        pendingApproval={status.pending_approval}
        note={approvalNote}
        onNoteChange={setApprovalNote}
        onApprove={() => void handleApproval("approve")}
        onReject={() => void handleApproval("reject")}
        onStop={() => void handleStop()}
        busy={approvalBusy}
        stopBusy={stopBusy}
      />
    </>
  );
}

function NotFoundPage({ navigate }: { navigate: (path: string) => void }) {
  const redirectHome = useEffectEvent(() => {
    navigate("/");
  });

  useEffect(() => {
    const redirectTimer = window.setTimeout(() => {
      redirectHome();
    }, 3000);

    return () => window.clearTimeout(redirectTimer);
  }, []);

  return (
    <ScreenPanel
      title="404 | Route not found"
      description="This page does not exist. You will be redirected to the launcher in 3 seconds."
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
