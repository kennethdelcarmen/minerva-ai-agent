import type { ReactNode } from "react";

import { Orbit } from "lucide-react";

import { cn } from "@/lib/utils";

export function DashboardShell({
  bannerMeta,
  bannerAction,
  leftRail,
  centerStage,
  rightRail,
  mobileLayout = "default",
  className,
}: {
  bannerMeta: ReactNode;
  bannerAction?: ReactNode;
  leftRail: ReactNode;
  centerStage: ReactNode;
  rightRail: ReactNode;
  mobileLayout?: "default" | "stage-first";
  className?: string;
}) {
  return (
    <main className={cn("min-h-screen px-3 py-3 sm:px-5 lg:px-7", className)}>
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4">
        <header className="relative overflow-hidden rounded-2xl border border-border bg-card shadow-[0_20px_60px_rgba(0,0,0,0.35)]">
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(82,209,200,0.08),transparent_22%),linear-gradient(180deg,rgba(255,255,255,0.02),transparent_36%)]" />
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-primary/35" />
          <div className="relative flex items-center gap-3 overflow-x-auto p-4 sm:p-5">
            <div className="inline-flex shrink-0 items-center gap-2 rounded-md border border-border bg-muted/60 px-2.5 py-1.5 font-mono text-[0.67rem] font-medium uppercase tracking-[0.24em] text-primary">
              <Orbit className="size-3.5" />
              Minerva Agent
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <div className="flex shrink-0 items-center gap-2">{bannerMeta}</div>
              {bannerAction ? <div className="shrink-0">{bannerAction}</div> : null}
            </div>
          </div>
        </header>

        <section className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)_360px]">
          <aside
            className={cn(
              "xl:sticky xl:top-5 xl:self-start",
              mobileLayout === "stage-first" ? "order-2 xl:order-1" : "order-1",
            )}
          >
            <div className={cn("flex flex-col gap-6")}>{leftRail}</div>
          </aside>

          <section
            className={cn("min-w-0", mobileLayout === "stage-first" ? "order-1 xl:order-2" : "order-2")}
          >
            {centerStage}
          </section>

          <aside className="order-3 xl:sticky xl:top-5 xl:self-start">
            <div className={cn("flex flex-col gap-6")}>{rightRail}</div>
          </aside>
        </section>
      </div>
    </main>
  );
}
