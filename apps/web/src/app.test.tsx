import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./app";
import type { ResultArtifactPayload, RunEvent, RunStatusResponse } from "./lib/types";

class MockEventSource {
  static instances: MockEventSource[] = [];

  url: string;
  readyState = 0;
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  listeners = new Map<string, Set<(event: MessageEvent<string>) => void>>();

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
    queueMicrotask(() => {
      this.readyState = 1;
      this.onopen?.(new Event("open"));
    });
  }

  addEventListener(type: string, handler: (event: MessageEvent<string>) => void) {
    const existing = this.listeners.get(type) ?? new Set<(event: MessageEvent<string>) => void>();
    existing.add(handler);
    this.listeners.set(type, existing);
  }

  removeEventListener(type: string, handler: (event: MessageEvent<string>) => void) {
    this.listeners.get(type)?.delete(handler);
  }

  close() {
    this.readyState = 2;
  }

  emit(type: string, payload: RunEvent) {
    const handlers = this.listeners.get(type);
    if (!handlers) {
      return;
    }

    const event = new MessageEvent("message", { data: JSON.stringify(payload) });
    for (const handler of handlers) {
      handler(event);
    }
  }
}

function createStatus(overrides: Partial<RunStatusResponse> = {}): RunStatusResponse {
  return {
    run_id: "run-123",
    status: "running",
    task: "Open example.com",
    model: "gemini-3.6-flash",
    headless: false,
    current_step_summary: "Run started.",
    created_at: "2026-08-03T10:00:00Z",
    updated_at: "2026-08-03T10:00:01Z",
    completed_at: null,
    pending_approval_id: null,
    pending_approval: null,
    last_error: null,
    ...overrides,
  };
}

function createResultPayload(): ResultArtifactPayload {
  return {
    status: createStatus({ status: "succeeded", completed_at: "2026-08-03T10:02:00Z" }),
    result: {
      success: true,
      final_output: "done",
      steps: 3,
    },
  };
}

function installFetchMock(handler: (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => await handler(input, init)),
  );
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  MockEventSource.instances = [];
  vi.stubGlobal("EventSource", MockEventSource);
  window.history.pushState({}, "", "/");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("operator console", () => {
  it("renders the idle shell with a live composer and placeholder panels", async () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "Operator Console" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Launch run" })).toBeInTheDocument();
    expect(screen.getByText("Browser viewport")).toBeInTheDocument();
    expect(screen.getByText("Operator insight")).toBeInTheDocument();
    expect(screen.getByText("No reasoning events yet.")).toBeInTheDocument();
    expect(screen.getByText("Launch a run to watch the browser")).toBeInTheDocument();
  });

  it("creates a run and transitions to the run route", async () => {
    installFetchMock((input, init) => {
      const url = input.toString();

      if (url.endsWith("/runs") && init?.method === "POST") {
        return jsonResponse(createStatus());
      }

      if (url.endsWith("/runs/run-123")) {
        return jsonResponse(createStatus());
      }

      if (url.endsWith("/runs/run-123/artifacts")) {
        return jsonResponse({ run_id: "run-123", artifacts: [] });
      }

      throw new Error(`Unhandled request: ${init?.method ?? "GET"} ${url}`);
    });

    render(<App />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Goal"), "Open example.com and summarize the page");
    await user.click(screen.getByRole("button", { name: "Launch run" }));

    await screen.findByRole("heading", { name: "Run run-123" });
    expect(window.location.pathname).toBe("/runs/run-123");
  });

  it("renders streamed events from the SSE connection", async () => {
    installFetchMock((input) => {
      const url = input.toString();

      if (url.endsWith("/runs/run-123")) {
        return jsonResponse(createStatus());
      }

      if (url.endsWith("/runs/run-123/artifacts")) {
        return jsonResponse({ run_id: "run-123", artifacts: [] });
      }

      throw new Error(`Unhandled request: GET ${url}`);
    });

    window.history.pushState({}, "", "/runs/run-123");
    render(<App />);

    await screen.findByRole("heading", { name: "Run run-123" });

    await act(async () => {
      MockEventSource.instances[0].emit("plan", {
        id: "event-1",
        run_id: "run-123",
        sequence: 3,
        type: "plan",
        summary: "Searching the pricing page.",
        timestamp: "2026-08-03T10:00:02Z",
        data: {},
      });
    });

    await waitFor(() => {
      const reasoningPanel = screen.getByRole("tabpanel", { name: "Reasoning" });
      expect(within(reasoningPanel).getAllByText("Searching the pricing page.").length).toBeGreaterThanOrEqual(2);
    });
  });

  it("submits approval decisions", async () => {
    installFetchMock((input, init) => {
      const url = input.toString();

      if (url.endsWith("/runs/run-123") && !init?.method) {
        return jsonResponse(
          createStatus({
            status: "waiting_for_approval",
            pending_approval_id: "approval-1",
            pending_approval: {
              id: "approval-1",
              action_name: "click",
              params: { index: 1 },
              reason: "Click requires approval.",
              requested_at: "2026-08-03T10:00:05Z",
            },
          }),
        );
      }

      if (url.endsWith("/runs/run-123/artifacts")) {
        return jsonResponse({ run_id: "run-123", artifacts: [] });
      }

      if (url.endsWith("/runs/run-123/approvals/approval-1") && init?.method === "POST") {
        return jsonResponse(createStatus());
      }

      throw new Error(`Unhandled request: ${init?.method ?? "GET"} ${url}`);
    });

    window.history.pushState({}, "", "/runs/run-123");
    render(<App />);

    await screen.findByText("Approval required");
    await userEvent.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "http://127.0.0.1:8000/runs/run-123/approvals/approval-1",
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  it("stops an active run", async () => {
    installFetchMock((input, init) => {
      const url = input.toString();

      if (url.endsWith("/runs/run-123") && !init?.method) {
        return jsonResponse(createStatus());
      }

      if (url.endsWith("/runs/run-123/artifacts")) {
        return jsonResponse({ run_id: "run-123", artifacts: [] });
      }

      if (url.endsWith("/runs/run-123/stop") && init?.method === "POST") {
        return jsonResponse(createStatus({ status: "stopped", completed_at: "2026-08-03T10:01:00Z" }));
      }

      throw new Error(`Unhandled request: ${init?.method ?? "GET"} ${url}`);
    });

    window.history.pushState({}, "", "/runs/run-123");
    render(<App />);

    await screen.findByRole("button", { name: "Stop run" });
    await userEvent.click(screen.getByRole("button", { name: "Stop run" }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "http://127.0.0.1:8000/runs/run-123/stop",
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  it("renders the terminal result and artifact links", async () => {
    installFetchMock((input) => {
      const url = input.toString();

      if (url.endsWith("/runs/run-123")) {
        return jsonResponse(createStatus({ status: "succeeded", completed_at: "2026-08-03T10:02:00Z" }));
      }

      if (url.endsWith("/runs/run-123/artifacts")) {
        return jsonResponse({
          run_id: "run-123",
          artifacts: [
            { kind: "screenshot", path: "screenshots/step-001.png", size_bytes: 2048 },
            { kind: "result", path: "result.json", size_bytes: 512 },
          ],
        });
      }

      if (url.endsWith("/runs/run-123/artifacts/result.json")) {
        return jsonResponse(createResultPayload());
      }

      throw new Error(`Unhandled request: GET ${url}`);
    });

    window.history.pushState({}, "", "/runs/run-123");
    render(<App />);

    const dialog = await screen.findByRole("dialog", { name: "Final output" });
    expect(within(dialog).getByText("done")).toBeInTheDocument();
    expect(within(dialog).getByText(/final_output/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View output" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /result.json/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stop run" })).not.toBeInTheDocument();
  });

  it("reloads status when the run page becomes visible again", async () => {
    let statusCalls = 0;

    installFetchMock((input) => {
      const url = input.toString();

      if (url.endsWith("/runs/run-123")) {
        statusCalls += 1;
        return jsonResponse(createStatus({ current_step_summary: `Refresh ${statusCalls}` }));
      }

      if (url.endsWith("/runs/run-123/artifacts")) {
        return jsonResponse({ run_id: "run-123", artifacts: [] });
      }

      throw new Error(`Unhandled request: GET ${url}`);
    });

    window.history.pushState({}, "", "/runs/run-123");
    render(<App />);

    await screen.findByRole("heading", { name: "Run run-123" });
    expect(screen.getByRole("heading", { name: "Run state" })).toBeInTheDocument();
    expect(screen.getAllByText("Refresh 1").length).toBeGreaterThan(0);

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await waitFor(() => {
      expect(statusCalls).toBeGreaterThanOrEqual(2);
    });
  });
});
