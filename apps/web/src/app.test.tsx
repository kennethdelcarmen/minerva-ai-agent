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
      final_output: "# Done\n\n- First finding\n- Second finding\n\nVisit [docs](https://example.com/docs).\n\n```bash\nnpm test\n```",
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
  Object.defineProperty(window, "scrollTo", {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("operator console", () => {
  it("renders the guided idle shell", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "Tell Minerva what to do" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start run" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "What Minerva sees" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Activity and answer" })).toBeInTheDocument();
    expect(screen.getByText("Status updates will appear here")).toBeInTheDocument();
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
    await user.type(screen.getByLabelText("What should Minerva do?"), "Open example.com and summarize the page");
    await user.click(screen.getByRole("button", { name: "Start run" }));

    await screen.findByRole("heading", { name: "What Minerva is doing" });
    expect(window.location.pathname).toBe("/runs/run-123");
  });

  it("renders streamed activity events from the SSE connection", async () => {
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

    await screen.findByRole("heading", { name: "What Minerva is doing" });

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

    const activityPanel = screen.getByRole("tabpanel", { name: "Activity" });
    expect(within(activityPanel).getAllByText("Searching the pricing page.").length).toBeGreaterThanOrEqual(1);
  });

  it("renders the refreshed run summary with a primary step panel and operator controls", async () => {
    installFetchMock((input) => {
      const url = input.toString();

      if (url.endsWith("/runs/run-123")) {
        return jsonResponse(createStatus({ current_step_summary: "Searching the pricing page." }));
      }

      if (url.endsWith("/runs/run-123/artifacts")) {
        return jsonResponse({ run_id: "run-123", artifacts: [] });
      }

      throw new Error(`Unhandled request: GET ${url}`);
    });

    window.history.pushState({}, "", "/runs/run-123");
    render(<App />);

    const summaryHeading = await screen.findByRole("heading", { name: "What Minerva is doing" });
    const summaryCard = summaryHeading.closest("[data-slot='card']");

    expect(summaryCard).not.toBeNull();

    const summary = within(summaryCard as HTMLElement);
    expect(summary.getByText("Current step")).toBeInTheDocument();
    expect(summary.getByText("Searching the pricing page.")).toBeInTheDocument();
    expect(summary.getByText("Run details")).toBeInTheDocument();
    expect(summary.getByRole("button", { name: "Stop run" })).toBeInTheDocument();
    expect(summary.getByRole("button", { name: "New run" })).toBeInTheDocument();
    expect(summary.getByText("Minerva is actively working through the current task.")).toBeInTheDocument();

    const commandBar = screen.getByRole("region", { name: "Run command bar" });
    expect(within(commandBar).getByText("Run in progress")).toBeInTheDocument();
    expect(within(commandBar).getByText("Searching the pricing page.")).toBeInTheDocument();
    expect(commandBar.querySelector('[data-slot="activity-indicator"][data-state="running"]')).not.toBeNull();
  });

  it("opens a blocking approval modal when approval is already pending", async () => {
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

    const dialog = await screen.findByRole("alertdialog", { name: "Approval required" });
    expect(within(dialog).getByText("Click requires approval.")).toBeInTheDocument();
    expect(document.body.style.overflow).toBe("hidden");
    expect(within(dialog).queryByRole("button", { name: "Close modal" })).not.toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("button", { name: "Approve" }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "http://127.0.0.1:8000/runs/run-123/approvals/approval-1",
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  it("opens the approval modal from a streamed approval event", async () => {
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

    await screen.findByRole("heading", { name: "What Minerva is doing" });

    await act(async () => {
      MockEventSource.instances[0].emit("approval", {
        id: "event-approval",
        run_id: "run-123",
        sequence: 4,
        type: "approval",
        summary: 'Approval required for "click".',
        timestamp: "2026-08-03T10:00:03Z",
        data: {
          approval_id: "approval-2",
          action_name: "click",
          params: { index: 4 },
          reason: "This click opens an external checkout page.",
        },
      });
    });

    const dialog = await screen.findByRole("alertdialog", { name: "Approval required" });
    expect(within(dialog).getByText("This click opens an external checkout page.")).toBeInTheDocument();

    const commandBar = screen.getByRole("region", { name: "Run command bar" });
    expect(within(commandBar).getByText("Waiting for your review")).toBeInTheDocument();
    expect(within(commandBar).getByText('Approval required for "click".')).toBeInTheDocument();
    expect(commandBar.querySelector('[data-slot="activity-indicator"][data-state="running"]')).toBeNull();
    expect(commandBar.querySelector('[data-slot="activity-indicator"][data-state="blocked"]')).not.toBeNull();
  });

  it("renders markdown in the terminal result modal and keeps artifact links available", async () => {
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

    const dialog = await screen.findByRole("dialog", { name: "Final answer" });
    expect(within(dialog).getByRole("heading", { name: "Done" })).toBeInTheDocument();
    expect(within(dialog).getByText("First finding")).toBeInTheDocument();
    expect(within(dialog).getByText("Second finding")).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: "docs" })).toHaveAttribute(
      "href",
      "https://example.com/docs",
    );
    expect(within(dialog).getByText("npm test")).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("button", { name: "Close" }));

    expect(await screen.findByRole("button", { name: "View full answer" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /result.json/i })).toBeInTheDocument();
  });

  it("renders long goals in the run summary without truncating the text", async () => {
    const longTask =
      "Open the pricing page, compare the Pro and Enterprise plans, capture the differences in automation limits, and stop before any checkout step.";

    installFetchMock((input) => {
      const url = input.toString();

      if (url.endsWith("/runs/run-123")) {
        return jsonResponse(createStatus({ task: longTask }));
      }

      if (url.endsWith("/runs/run-123/artifacts")) {
        return jsonResponse({ run_id: "run-123", artifacts: [] });
      }

      throw new Error(`Unhandled request: GET ${url}`);
    });

    window.history.pushState({}, "", "/runs/run-123");
    render(<App />);

    const summaryHeading = await screen.findByRole("heading", { name: "What Minerva is doing" });
    const summaryCard = summaryHeading.closest("[data-slot='card']");

    expect(summaryCard).not.toBeNull();
    expect(within(summaryCard as HTMLElement).getByText(longTask)).toBeInTheDocument();
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

    await screen.findByRole("heading", { name: "What Minerva is doing" });
    expect(screen.getByRole("heading", { name: "What Minerva is doing" })).toBeInTheDocument();
    expect(screen.getAllByText("Refresh 1").length).toBeGreaterThan(0);

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await waitFor(() => {
      expect(statusCalls).toBeGreaterThanOrEqual(2);
    });
  });

  it("updates the sticky command bar when streamed activity changes", async () => {
    installFetchMock((input) => {
      const url = input.toString();

      if (url.endsWith("/runs/run-123")) {
        return jsonResponse(createStatus({ current_step_summary: "Open the homepage." }));
      }

      if (url.endsWith("/runs/run-123/artifacts")) {
        return jsonResponse({ run_id: "run-123", artifacts: [] });
      }

      throw new Error(`Unhandled request: GET ${url}`);
    });

    window.history.pushState({}, "", "/runs/run-123");
    render(<App />);

    const commandBar = await screen.findByRole("region", { name: "Run command bar" });
    expect(within(commandBar).getByText("Open the homepage.")).toBeInTheDocument();

    await act(async () => {
      MockEventSource.instances[0].emit("action", {
        id: "event-action",
        run_id: "run-123",
        sequence: 2,
        type: "action",
        summary: "Inspecting the navigation menu.",
        timestamp: "2026-08-03T10:00:03Z",
        data: {},
      });
    });

    expect(within(commandBar).getByText("Inspecting the navigation menu.")).toBeInTheDocument();
  });

  it("shows a running browser indicator before the first screenshot arrives", async () => {
    installFetchMock((input) => {
      const url = input.toString();

      if (url.endsWith("/runs/run-123")) {
        return jsonResponse(createStatus({ current_step_summary: "Launching the visible browser." }));
      }

      if (url.endsWith("/runs/run-123/artifacts")) {
        return jsonResponse({ run_id: "run-123", artifacts: [] });
      }

      throw new Error(`Unhandled request: GET ${url}`);
    });

    window.history.pushState({}, "", "/runs/run-123");
    render(<App />);

    const browserHeading = await screen.findByRole("heading", { name: "What Minerva sees" });
    const browserCard = browserHeading.closest("[data-slot='card']");

    expect(browserCard).not.toBeNull();

    const browser = within(browserCard as HTMLElement);
    expect(browser.getAllByText("Browser live").length).toBeGreaterThan(0);
    expect(browser.getByText("Starting browser")).toBeInTheDocument();
    expect(
      (browserCard as HTMLElement).querySelector('[data-slot="activity-indicator"][data-state="running"]'),
    ).not.toBeNull();
  });

  it("switches the sticky command bar to start another run and focuses the inline launcher", async () => {
    installFetchMock((input) => {
      const url = input.toString();

      if (url.endsWith("/runs/run-123")) {
        return jsonResponse(
          createStatus({
            status: "succeeded",
            current_step_summary: "Summary delivered to the operator.",
            completed_at: "2026-08-03T10:02:00Z",
          }),
        );
      }

      if (url.endsWith("/runs/run-123/artifacts")) {
        return jsonResponse({ run_id: "run-123", artifacts: [] });
      }

      throw new Error(`Unhandled request: GET ${url}`);
    });

    const scrollIntoViewMock = vi.mocked(HTMLElement.prototype.scrollIntoView);

    window.history.pushState({}, "", "/runs/run-123");
    render(<App />);

    const commandBar = await screen.findByRole("region", { name: "Run command bar" });
    expect(within(commandBar).getByText("Run complete")).toBeInTheDocument();
    expect(commandBar.querySelector('[data-slot="activity-indicator"][data-state="running"]')).toBeNull();
    expect(commandBar.querySelector('[data-slot="activity-indicator"][data-state="success"]')).not.toBeNull();

    const launcherHeading = screen.getByRole("heading", { name: "Start another run" });
    expect(launcherHeading).toBeInTheDocument();

    await userEvent.click(within(commandBar).getByRole("button", { name: "Start another run" }));

    expect(window.location.pathname).toBe("/runs/run-123");
    expect(scrollIntoViewMock).toHaveBeenCalled();
    expect(screen.getByLabelText("What should Minerva do?")).toHaveFocus();
  });

  it("resets scroll position after starting a new run from the run page", async () => {
    installFetchMock((input, init) => {
      const url = input.toString();

      if (url.endsWith("/runs/run-123") && !init?.method) {
        return jsonResponse(
          createStatus({
            status: "succeeded",
            current_step_summary: "Initial run complete.",
            completed_at: "2026-08-03T10:02:00Z",
          }),
        );
      }

      if (url.endsWith("/runs") && init?.method === "POST") {
        return jsonResponse(
          createStatus({
            run_id: "run-456",
            status: "running",
            current_step_summary: "Second run started.",
          }),
        );
      }

      if (url.endsWith("/runs/run-123/artifacts")) {
        return jsonResponse({ run_id: "run-123", artifacts: [] });
      }

      if (url.endsWith("/runs/run-456")) {
        return jsonResponse(
          createStatus({
            run_id: "run-456",
            status: "running",
            current_step_summary: "Second run started.",
          }),
        );
      }

      if (url.endsWith("/runs/run-456/artifacts")) {
        return jsonResponse({ run_id: "run-456", artifacts: [] });
      }

      throw new Error(`Unhandled request: ${init?.method ?? "GET"} ${url}`);
    });

    window.history.pushState({}, "", "/runs/run-123");
    render(<App />);

    const launcherHeading = await screen.findByRole("heading", { name: "Start another run" });
    const launcherCard = launcherHeading.closest("[data-slot='card']");

    expect(launcherCard).not.toBeNull();

    const launcher = within(launcherCard as HTMLElement);
    await userEvent.type(launcher.getByLabelText("What should Minerva do?"), "Open docs and summarize changes");
    await userEvent.click(launcher.getByRole("button", { name: "Start run" }));

    await screen.findByRole("heading", { name: "What Minerva is doing" });
    await waitFor(() => {
      expect(window.location.pathname).toBe("/runs/run-456");
    });
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: "auto" });
  });
});
