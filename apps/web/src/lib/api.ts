import type {
  CreateRunRequest,
  ResultArtifactPayload,
  RunArtifactsResponse,
  RunStatusResponse,
} from "./types";

export class ApiError extends Error {
  status: number;
  detail: string;
  path: string;

  constructor({ status, detail, path }: { status: number; detail: string; path: string }) {
    super(detail || `Request failed with status ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail || `Request failed with status ${status}`;
    this.path = path;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

function getRequiredApiBaseUrl(): string {
  const value = import.meta.env.VITE_API_BASE_URL?.trim();
  if (!value) {
    throw new Error("Missing VITE_API_BASE_URL. Set it in the apps/web environment before starting the frontend.");
  }

  return value.replace(/\/$/, "");
}

const API_BASE_URL = getRequiredApiBaseUrl();

function buildUrl(path: string): string {
  return `${API_BASE_URL}${path}`;
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(buildUrl(path), {
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new ApiError({ status: response.status, detail, path });
  }

  return (await response.json()) as T;
}

async function readErrorDetail(response: Response): Promise<string> {
  const contentType = response.headers.get("Content-Type") ?? "";

  if (contentType.includes("application/json")) {
    const payload = (await response.json()) as { detail?: unknown } | unknown;
    if (
      typeof payload === "object" &&
      payload !== null &&
      "detail" in payload &&
      typeof payload.detail === "string"
    ) {
      return payload.detail;
    }

    return JSON.stringify(payload);
  }

  const detail = await response.text();
  return detail || `Request failed with status ${response.status}`;
}

export function runEventsUrl(runId: string): string {
  return buildUrl(`/runs/${runId}/events`);
}

export function artifactUrl(runId: string, artifactPath: string): string {
  const encodedPath = artifactPath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return buildUrl(`/runs/${runId}/artifacts/${encodedPath}`);
}

export async function createRun(request: CreateRunRequest): Promise<RunStatusResponse> {
  return await fetchJson<RunStatusResponse>("/runs", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

export async function fetchRunStatus(runId: string): Promise<RunStatusResponse> {
  return await fetchJson<RunStatusResponse>(`/runs/${runId}`);
}

export async function fetchArtifacts(runId: string): Promise<RunArtifactsResponse> {
  return await fetchJson<RunArtifactsResponse>(`/runs/${runId}/artifacts`);
}

export async function decideApproval(
  runId: string,
  approvalId: string,
  decision: "approve" | "reject",
  note: string,
): Promise<RunStatusResponse> {
  return await fetchJson<RunStatusResponse>(`/runs/${runId}/approvals/${approvalId}`, {
    method: "POST",
    body: JSON.stringify({ decision, note: note || null }),
  });
}

export async function stopRun(runId: string): Promise<RunStatusResponse> {
  return await fetchJson<RunStatusResponse>(`/runs/${runId}/stop`, {
    method: "POST",
  });
}

export async function fetchResultArtifact(runId: string): Promise<ResultArtifactPayload> {
  return await fetchJson<ResultArtifactPayload>(`/runs/${runId}/artifacts/result.json`, {
    headers: {
      Accept: "application/json",
    },
  });
}
