import { useId } from "react";

import { Check, ShieldAlert, X } from "lucide-react";

import { CodeBlock, EmptyState, StatusBadge } from "@/components/dashboard/dashboard-primitives";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { approvalDetailEntries, approvalSummary } from "@/src/lib/approval-display";
import { formatTimestamp } from "@/src/lib/dashboard-display";
import type { PendingApprovalResponse } from "@/src/lib/types";

export function ApprovalPanel({
  pendingApproval,
  note,
  onNoteChange,
  onApprove,
  onReject,
  busy,
}: {
  pendingApproval: PendingApprovalResponse | null;
  note: string;
  onNoteChange: (value: string) => void;
  onApprove: () => void;
  onReject: () => void;
  busy: boolean;
}) {
  const noteId = useId();

  if (!pendingApproval) {
    return (
      <Card className="border-border bg-card">
        <CardHeader>
          <p className="font-mono text-[0.68rem] uppercase tracking-[0.24em] text-[#f2a65a]/85">Decision gate</p>
          <CardTitle>
            <h2>Approval gate</h2>
          </CardTitle>
          <CardDescription>Holds irreversible actions until the backend explicitly asks for review.</CardDescription>
        </CardHeader>
        <CardContent>
          <EmptyState
            title="No approval pending."
            description="The run can continue without intervention until a gated action appears."
            icon={<ShieldAlert className="size-5" />}
          />
        </CardContent>
      </Card>
    );
  }

  const actionSummary = approvalSummary(pendingApproval) ?? pendingApproval.action_name;
  const detailEntries = approvalDetailEntries(pendingApproval.action_name, pendingApproval.params);

  return (
    <Card className="border-[#f2a65a]/35 bg-[#221a13] shadow-[0_18px_60px_rgba(0,0,0,0.35)]">
      <CardHeader className="gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <p className="font-mono text-[0.68rem] uppercase tracking-[0.24em] text-[#f2a65a]/85">Decision gate</p>
            <div className="inline-flex size-11 items-center justify-center rounded-lg border border-[#f2a65a]/30 bg-[#f2a65a]/12 text-[#ffd9ae]">
              <ShieldAlert className="size-5" />
            </div>
            <div className="space-y-1">
              <CardTitle>
                <h2>Approval required</h2>
              </CardTitle>
              <CardDescription className="leading-6 text-[#f5d5b0]/82">{actionSummary}</CardDescription>
            </div>
          </div>
          <StatusBadge tone="warning">{pendingApproval.action_name.replaceAll("_", " ")}</StatusBadge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-[#f2a65a]/18 bg-black/18 p-3">
            <p className="font-mono text-[0.64rem] font-medium uppercase tracking-[0.22em] text-[#f2a65a]/70">Requested</p>
            <p className="mt-3 font-mono text-sm text-[#ffe3c1]">{formatTimestamp(pendingApproval.requested_at)}</p>
          </div>
          <div className="rounded-lg border border-[#f2a65a]/18 bg-black/18 p-3">
            <p className="font-mono text-[0.64rem] font-medium uppercase tracking-[0.22em] text-[#f2a65a]/70">Decision</p>
            <p className="mt-3 text-sm font-medium text-[#ffe3c1]">Operator review required</p>
          </div>
        </div>

        <div className="space-y-2">
          <Label className="text-[#f2a65a]">Why this needs review</Label>
          <p className="rounded-lg border border-[#f2a65a]/18 bg-black/18 px-4 py-3 text-sm leading-6 text-[#ffe3c1]">
            {pendingApproval.reason}
          </p>
        </div>

        {detailEntries.length > 0 ? (
          <div className="space-y-2">
            <Label className="text-[#f2a65a]">Action details</Label>
            <dl className="grid gap-3 sm:grid-cols-2">
              {detailEntries.map((entry) => (
                <div key={entry.label} className="rounded-lg border border-[#f2a65a]/18 bg-black/18 p-3">
                  <dt className="font-mono text-[0.64rem] font-medium uppercase tracking-[0.22em] text-[#f2a65a]/70">
                    {entry.label}
                  </dt>
                  <dd className="mt-3 text-sm text-[#ffe3c1]">{entry.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        ) : null}

        <details className="rounded-lg border border-[#f2a65a]/18 bg-black/18 p-3">
          <summary className="cursor-pointer list-none text-sm font-medium text-[#ffe3c1]">Raw action payload</summary>
          <CodeBlock className="mt-3 border-[#f2a65a]/18 bg-[#0d1317] text-[#ffe3c1]">
            {JSON.stringify(pendingApproval.params, null, 2)}
          </CodeBlock>
        </details>

        <div className="space-y-2">
          <Label htmlFor={noteId} className="text-[#f2a65a]">
            Operator note
          </Label>
          <Textarea
            id={noteId}
            value={note}
            onChange={(event) => onNoteChange(event.target.value)}
            placeholder="Optional note"
            className="min-h-24 rounded-lg border-[#f2a65a]/18 bg-black/18 text-[#ffe3c1] placeholder:text-[#f2d2ac]/45"
          />
        </div>
      </CardContent>

      <CardFooter className="flex flex-wrap gap-3 border-[#f2a65a]/18 bg-transparent">
        <Button
          type="button"
          size="sm"
          className="rounded-md px-4"
          onClick={onApprove}
          disabled={busy}
          aria-label={busy ? "Submitting..." : "Approve"}
          title={busy ? "Submitting..." : "Approve"}
        >
          <Check className="size-4" />
          {busy ? "Submitting..." : "Approve"}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="rounded-md border-[#f2a65a]/30 px-4 text-[#ffe3c1]"
          onClick={onReject}
          disabled={busy}
          aria-label="Reject"
          title="Reject"
        >
          <X className="size-4" />
          Reject
        </Button>
      </CardFooter>
    </Card>
  );
}
