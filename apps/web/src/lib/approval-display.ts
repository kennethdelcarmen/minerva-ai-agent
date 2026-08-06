import type { PendingApprovalResponse } from "./types";

type ApprovalParams = Record<string, unknown>;

export interface ApprovalDetailEntry {
  label: string;
  value: string;
}

function humanizeLabel(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function formatValue(value: unknown): string | null {
  if (value == null) {
    return null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    const parts = value.map((item) => formatValue(item)).filter((item): item is string => Boolean(item));
    return parts.length > 0 ? parts.join(", ") : null;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function findFirst(params: ApprovalParams, keys: string[]): { key: string; value: string } | null {
  for (const key of keys) {
    const value = formatValue(params[key]);
    if (value) {
      return { key, value };
    }
  }

  return null;
}

function quote(value: string): string {
  return `"${value}"`;
}

function formatTarget(match: { key: string; value: string } | null): string | null {
  if (!match) {
    return null;
  }

  if (match.key === "url") {
    return `the link to ${match.value}`;
  }

  if (match.key === "selector" || match.key === "xpath") {
    return `element ${quote(match.value)}`;
  }

  return quote(match.value);
}

function formatField(match: { key: string; value: string } | null): string | null {
  if (!match) {
    return null;
  }

  if (match.key === "index") {
    return `field #${match.value}`;
  }

  if (match.key === "selector" || match.key === "xpath") {
    return `field ${quote(match.value)}`;
  }

  return quote(match.value);
}

function humanizeActionName(actionName: string): string {
  return humanizeLabel(actionName).toLowerCase();
}

function detailPriority(actionName: string): string[] {
  switch (actionName) {
    case "click":
      return ["description", "element", "target", "label", "text", "selector", "url", "xpath", "index"];
    case "input":
      return ["label", "field", "name", "description", "selector", "index", "text", "value", "content"];
    case "send_keys":
      return ["keys", "key", "shortcut", "text", "value"];
    case "select_dropdown_option":
      return ["label", "field", "name", "selector", "index", "value", "option", "text", "selection"];
    case "upload_file":
      return ["label", "field", "selector", "index", "path", "file", "filename", "name"];
    case "save_as_pdf":
      return ["filename", "path", "name"];
    default:
      return ["description", "label", "text", "value", "selector", "url", "index"];
  }
}

export function formatApprovalAction(actionName: string, params: ApprovalParams): string {
  if (actionName === "click") {
    const target = formatTarget(
      findFirst(params, ["description", "element", "target", "label", "text", "selector", "url", "xpath"]),
    );
    if (target) {
      return `Click ${target}`;
    }

    const index = findFirst(params, ["index"]);
    if (index) {
      return `Click element #${index.value}`;
    }

    return "Click the highlighted element";
  }

  if (actionName === "input") {
    const value = findFirst(params, ["text", "value", "content"]);
    const field = formatField(findFirst(params, ["label", "field", "name", "description", "selector", "index"]));
    if (value && field) {
      return `Type ${quote(value.value)} into ${field}`;
    }
    if (field) {
      return `Type into ${field}`;
    }
    if (value) {
      return `Type ${quote(value.value)}`;
    }
    return "Type into the current field";
  }

  if (actionName === "send_keys") {
    const keys = findFirst(params, ["keys", "key", "shortcut", "text", "value"]);
    return keys ? `Press ${quote(keys.value)}` : "Send keyboard input";
  }

  if (actionName === "select_dropdown_option") {
    const option = findFirst(params, ["value", "option", "text", "selection"]);
    const field = formatField(findFirst(params, ["label", "field", "name", "selector", "index"]));
    if (option && field) {
      return `Select ${quote(option.value)} in ${field}`;
    }
    if (option) {
      return `Select ${quote(option.value)}`;
    }
    if (field) {
      return `Change ${field}`;
    }
    return "Change the selected dropdown option";
  }

  if (actionName === "upload_file") {
    const file = findFirst(params, ["path", "file", "filename", "name"]);
    const field = formatField(findFirst(params, ["label", "field", "selector", "index"]));
    if (file && field) {
      return `Upload ${quote(file.value)} to ${field}`;
    }
    if (file) {
      return `Upload ${quote(file.value)}`;
    }
    return "Upload a file";
  }

  if (actionName === "save_as_pdf") {
    const filename = findFirst(params, ["filename", "path", "name"]);
    return filename ? `Save the page as PDF ${quote(filename.value)}` : "Save the page as PDF";
  }

  if (actionName === "close_tab") {
    return "Close the current tab";
  }

  const match = findFirst(params, ["description", "label", "text", "value", "selector", "url", "index"]);
  if (match) {
    const target = formatTarget(match);
    if (target) {
      return `${humanizeLabel(actionName)} ${target}`;
    }
  }

  return humanizeLabel(actionName);
}

export function approvalDetailEntries(actionName: string, params: ApprovalParams): ApprovalDetailEntry[] {
  const seen = new Set<string>();
  const entries: ApprovalDetailEntry[] = [];

  for (const key of [...detailPriority(actionName), ...Object.keys(params)]) {
    if (seen.has(key) || !(key in params)) {
      continue;
    }

    seen.add(key);
    const value = formatValue(params[key]);
    if (!value) {
      continue;
    }

    entries.push({
      label: humanizeLabel(key),
      value,
    });
  }

  return entries.slice(0, 6);
}

export function approvalSummary(approval: PendingApprovalResponse | null): string | null {
  if (!approval) {
    return null;
  }

  return formatApprovalAction(approval.action_name, approval.params);
}
