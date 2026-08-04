import type { ReactNode } from "react";

import { AlertTriangle, CheckCircle2, CircleDashed, LoaderCircle, TriangleAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { DashboardTone, RunIndicatorState } from "@/src/lib/dashboard-display";
import { cn } from "@/lib/utils";

const toneClasses: Record<DashboardTone, string> = {
  neutral: "border-border bg-muted/65 text-foreground",
  info: "border-primary/35 bg-primary/12 text-primary",
  success: "border-primary/35 bg-primary/12 text-primary",
  warning: "border-[#f2a65a]/35 bg-[#f2a65a]/12 text-[#ffd9ae]",
  danger: "border-destructive/35 bg-destructive/12 text-[#ffd1d1]",
};

const toneStripes: Record<DashboardTone, string> = {
  neutral: "bg-border",
  info: "bg-primary/45",
  success: "bg-primary/45",
  warning: "bg-[#f2a65a]/45",
  danger: "bg-destructive/45",
};

const indicatorTones: Record<RunIndicatorState, string> = {
  idle: "text-muted-foreground",
  running: "text-primary",
  blocked: "text-[#ffd9ae]",
  success: "text-primary",
  danger: "text-[#ffd1d1]",
};

const indicatorSizes = {
  sm: {
    icon: "size-3.5",
    text: "text-[0.68rem]",
  },
  md: {
    icon: "size-4",
    text: "text-xs",
  },
  lg: {
    icon: "size-5",
    text: "text-sm",
  },
} as const;

export function StatusBadge({
  tone = "neutral",
  className,
  children,
}: {
  tone?: DashboardTone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "h-6 rounded-md px-2.5 font-mono text-[0.68rem] font-medium uppercase tracking-[0.18em]",
        toneClasses[tone],
        className,
      )}
    >
      {children}
    </Badge>
  );
}

export function SignalTile({
  label,
  value,
  tone = "neutral",
  detail,
}: {
  label: string;
  value: string;
  tone?: DashboardTone;
  detail?: string;
}) {
  return (
    <div
      className="group relative inline-flex min-w-0 items-center gap-2 overflow-hidden rounded-md border border-border bg-muted/45 px-2.5 py-2"
      title={detail}
    >
      <div className={cn("pointer-events-none absolute inset-y-0 left-0 w-px", toneStripes[tone])} />
      <p className="pl-2 font-mono text-[0.62rem] font-medium uppercase tracking-[0.2em] text-muted-foreground">
        {label}
      </p>
      <p className="truncate font-heading text-sm font-medium tracking-[0.01em] text-foreground">{value}</p>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  icon,
  className,
}: {
  title: string;
  description: string;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-36 flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border bg-muted/35 px-5 py-8 text-center",
        className,
      )}
    >
      <div className="flex size-11 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground">
        {icon ?? <CircleDashed className="size-5" />}
      </div>
      <div className="space-y-1">
        <p className="font-heading text-base font-medium text-foreground">{title}</p>
        <p className="max-w-sm text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

export function ActivityIndicator({
  state,
  label,
  size = "sm",
  className,
}: {
  state: RunIndicatorState;
  label?: string;
  size?: keyof typeof indicatorSizes;
  className?: string;
}) {
  const sizeClasses = indicatorSizes[size];
  const toneClass = indicatorTones[state];

  return (
    <span
      data-slot="activity-indicator"
      data-state={state}
      className={cn(
        "inline-flex items-center gap-2 font-mono font-medium uppercase tracking-[0.18em]",
        toneClass,
        sizeClasses.text,
        className,
      )}
      role={state === "running" ? "status" : undefined}
    >
      {state === "running" ? (
        <LoaderCircle className={cn(sizeClasses.icon, "animate-spin motion-reduce:animate-none")} aria-hidden="true" />
      ) : state === "blocked" ? (
        <TriangleAlert className={sizeClasses.icon} aria-hidden="true" />
      ) : state === "success" ? (
        <CheckCircle2 className={sizeClasses.icon} aria-hidden="true" />
      ) : state === "danger" ? (
        <AlertTriangle className={sizeClasses.icon} aria-hidden="true" />
      ) : (
        <CircleDashed className={sizeClasses.icon} aria-hidden="true" />
      )}
      {label ? <span>{label}</span> : null}
    </span>
  );
}

export function CodeBlock({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <pre
      className={cn(
        "overflow-x-auto rounded-xl border border-border bg-[#0d1317] p-4 font-mono text-xs leading-6 text-[#d8d2c4] shadow-inner shadow-black/20",
        className,
      )}
    >
      {children}
    </pre>
  );
}

export function ScreenPanel({
  title,
  description,
  tone = "neutral",
  action,
  showSkeleton = false,
}: {
  title: string;
  description: string;
  tone?: DashboardTone;
  action?: ReactNode;
  showSkeleton?: boolean;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10 sm:px-6">
      <Card
        className={cn(
          "w-full max-w-xl border-border bg-card shadow-[0_20px_70px_rgba(0,0,0,0.4)]",
          tone === "danger" && "border-destructive/35 bg-destructive/6",
        )}
      >
        <CardContent className="space-y-5 py-8">
          <div className="space-y-3">
            <div
              className={cn(
                "flex size-12 items-center justify-center rounded-lg border border-border bg-muted/60",
                tone === "danger" && "border-destructive/35 bg-destructive/10 text-[#ffd1d1]",
              )}
            >
              {tone === "danger" ? <AlertTriangle className="size-5" /> : <CircleDashed className="size-5" />}
            </div>
            <div className="space-y-1">
              <h1 className="font-heading text-3xl font-semibold tracking-[0.01em] text-foreground">{title}</h1>
              <p className="text-sm leading-6 text-muted-foreground">{description}</p>
            </div>
          </div>

          {showSkeleton ? (
            <div className="space-y-3">
              <Skeleton className="h-4 w-3/4 rounded-md bg-muted/80" />
              <Skeleton className="h-4 w-full rounded-md bg-muted/80" />
              <Skeleton className="h-4 w-5/6 rounded-md bg-muted/80" />
            </div>
          ) : null}

          {action ? <div className="pt-1">{action}</div> : null}
        </CardContent>
      </Card>
    </main>
  );
}
