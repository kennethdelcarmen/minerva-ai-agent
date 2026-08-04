import { useId } from "react";

import { Check, ShieldAlert, Square, X } from "lucide-react";

import { CodeBlock, StatusBadge } from "@/components/dashboard/dashboard-primitives";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatTimestamp } from "@/src/lib/dashboard-display";
import type { PendingApprovalResponse } from "@/src/lib/types";

export function ApprovalModal({
  pendingApproval,
  note,
  onNoteChange,
  onApprove,
  onReject,
  onStop,
  busy,
  stopBusy,
}: {
  pendingApproval: PendingApprovalResponse | null;
  note: string;
  onNoteChange: (value: string) => void;
  onApprove: () => void;
  onReject: () => void;
  onStop: () => void;
  busy: boolean;
  stopBusy: boolean;
}) {
  const noteId = useId();

  if (!pendingApproval) {
    return null;
  }

  return (
    <Modal
      open
      onClose={() => undefined}
      title="Approval required"
      eyebrow="Approval"
      role="alertdialog"
      dismissible={false}
      className="max-w-2xl border-[#f2a65a]/35 bg-[#17120d]"
      description="Minerva is paused because this action needs your decision before it can continue."
      footer={
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Button
            type="button"
            variant="outline"
            className="rounded-md border-[#f2a65a]/25 text-[#ffe3c1]"
            onClick={onStop}
            disabled={stopBusy || busy}
          >
            <Square className="size-4 fill-current" />
            {stopBusy ? "Stopping..." : "Stop run"}
          </Button>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              className="rounded-md border-[#f2a65a]/25 text-[#ffe3c1]"
              onClick={onReject}
              disabled={busy || stopBusy}
            >
              <X className="size-4" />
              Reject
            </Button>
            <Button type="button" className="rounded-md px-5" onClick={onApprove} disabled={busy || stopBusy}>
              <Check className="size-4" />
              {busy ? "Submitting..." : "Approve"}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-5 text-[#ffe3c1]">
        <section className="rounded-xl border border-[#f2a65a]/20 bg-[#0d1317] p-5">
          <div className="flex items-start gap-4">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-[#f2a65a]/25 bg-[#f2a65a]/10 text-[#ffd9ae]">
              <ShieldAlert className="size-5" />
            </div>
            <div className="min-w-0 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge tone="warning">Needs your decision</StatusBadge>
                <StatusBadge tone="neutral" className="bg-white/5 text-[#ffe3c1]">
                  {pendingApproval.action_name}
                </StatusBadge>
              </div>
              <div className="space-y-2">
                <h3 className="text-xl font-semibold text-white">{pendingApproval.reason}</h3>
                <p className="text-sm leading-6 text-[#f2d7b6]/82">
                  Requested {formatTimestamp(pendingApproval.requested_at)}. Review the action details below, then
                  approve or reject it.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-[#f2a65a]/16 bg-black/16 p-5">
          <div className="space-y-2">
            <Label htmlFor={noteId} className="text-[#f2d7b6]">
              Note for this decision
            </Label>
            <Textarea
              id={noteId}
              value={note}
              onChange={(event) => onNoteChange(event.target.value)}
              placeholder="Optional note for the run log"
              className="min-h-28 rounded-xl border-[#f2a65a]/16 bg-[#0d1317] text-[#ffe3c1] placeholder:text-[#f2d7b6]/40"
            />
          </div>
        </section>

        <details className="rounded-xl border border-[#f2a65a]/16 bg-black/16 p-5">
          <summary className="cursor-pointer list-none text-sm font-semibold text-[#ffe3c1]">
            Action details
          </summary>
          <div className="mt-4 space-y-4">
            <div className="rounded-lg border border-[#f2a65a]/14 bg-[#0d1317] px-4 py-3">
              <p className="font-mono text-[0.66rem] uppercase tracking-[0.18em] text-[#f2a65a]/70">Action</p>
              <p className="mt-2 text-sm text-[#ffe3c1]">{pendingApproval.action_name}</p>
            </div>
            <div className="space-y-2">
              <p className="font-mono text-[0.66rem] uppercase tracking-[0.18em] text-[#f2a65a]/70">Parameters</p>
              <CodeBlock className="border-[#f2a65a]/16 bg-[#0d1317] text-[#ffe3c1]">
                {JSON.stringify(pendingApproval.params, null, 2)}
              </CodeBlock>
            </div>
          </div>
        </details>
      </div>
    </Modal>
  );
}
