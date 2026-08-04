import { type MouseEvent, type ReactNode, useEffect, useId } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function Modal({
  open,
  title,
  description,
  onClose,
  children,
  footer,
  className,
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!open) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  function handleBackdropClick(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) {
      onClose();
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/78 px-4 py-6 backdrop-blur-[2px]"
      onClick={handleBackdropClick}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        className={cn(
          "relative flex max-h-[min(90vh,920px)] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-[0_24px_80px_rgba(0,0,0,0.55)]",
          className,
        )}
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-primary/20" />
        <div className="relative flex items-start justify-between gap-4 border-b border-border px-6 py-5">
          <div className="space-y-1">
            <p className="font-mono text-[0.68rem] uppercase tracking-[0.24em] text-primary/80">Result report</p>
            <h2 id={titleId} className="font-heading text-lg font-semibold tracking-[0.01em] text-foreground">
              {title}
            </h2>
            {description ? (
              <p id={descriptionId} className="max-w-2xl text-sm leading-6 text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="shrink-0 text-muted-foreground hover:text-foreground"
            onClick={onClose}
            aria-label="Close modal"
          >
            <X className="size-4" />
          </Button>
        </div>

        <div className="relative min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>

        {footer ? <div className="relative border-t border-border px-6 py-4">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
