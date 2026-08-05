import { useId, type FormEvent, type Ref } from "react";

import { Bot, Play, ShieldCheck } from "lucide-react";

import { StatusBadge } from "@/components/dashboard/dashboard-primitives";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";

export function LauncherCard({
  task,
  setTask,
  model,
  setModel,
  submitting,
  submitError,
  onSubmit,
  helperText,
  eyebrow = "Start",
  title = "Tell Minerva what to do",
  taskInputRef,
}: {
  task: string;
  setTask: (value: string) => void;
  model: string;
  setModel: (value: string) => void;
  submitting: boolean;
  submitError: string | null;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  helperText: string;
  eyebrow?: string;
  title?: string;
  taskInputRef?: Ref<HTMLTextAreaElement>;
}) {
  const goalId = useId();
  const modelId = useId();

  return (
    <Card className="border-border bg-card">
      <CardHeader className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <p className="font-mono text-[0.68rem] uppercase tracking-[0.24em] text-primary/80">{eyebrow}</p>
            <div className="inline-flex size-11 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary">
              <Bot className="size-5" />
            </div>
            <div className="space-y-1">
              <CardTitle>
                <h2>{title}</h2>
              </CardTitle>
              <CardDescription className="leading-6">{helperText}</CardDescription>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusBadge tone="info">Supervised</StatusBadge>
            <StatusBadge tone="success">Approval gates</StatusBadge>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        <form className="space-y-5" onSubmit={onSubmit}>
          <div className="space-y-2">
            <Label htmlFor={goalId}>What should Minerva do?</Label>
            <Textarea
              ref={taskInputRef}
              id={goalId}
              name="task"
              value={task}
              onChange={(event) => setTask(event.target.value)}
              placeholder="Book a return flight to Tokyo next month and stop before payment."
              className="min-h-44 rounded-xl border-border bg-[#0d1317] px-4 py-3.5 text-[0.95rem] leading-7"
              required
            />
            <p className="text-xs leading-5 text-muted-foreground">
              Describe the outcome, any hard constraints, and the exact point where it should stop and ask you.
            </p>
          </div>

          <details className="rounded-xl border border-border bg-muted/35 p-4">
            <summary className="cursor-pointer list-none text-sm font-medium text-foreground">
              Advanced settings
            </summary>
            <div className="mt-4 grid gap-4">
              <div className="space-y-2">
                <Label htmlFor={modelId}>Model override</Label>
                <Input
                  id={modelId}
                  name="model"
                  type="text"
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                  placeholder="gemini-3.6-flash"
                  className="h-11 rounded-lg px-3.5"
                />
              </div>
            </div>
          </details>

          {submitError ? (
            <div
              role="alert"
              className="rounded-lg border border-destructive/35 bg-destructive/10 px-4 py-3 text-sm text-[#ffd1d1]"
            >
              {submitError}
            </div>
          ) : null}

          <Separator className="bg-border" />

          <CardFooter className="flex flex-col items-stretch gap-3 border-0 bg-transparent p-0 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <ShieldCheck className="size-4 text-primary" />
              Safe read-only steps may continue automatically. Sensitive actions still stop for your review.
            </div>
            <Button
              type="submit"
              size="lg"
              className="h-11 rounded-md px-5"
              disabled={submitting || !task.trim()}
            >
              <Play className="size-4" />
              {submitting ? "Starting..." : "Start run"}
            </Button>
          </CardFooter>
        </form>
      </CardContent>
    </Card>
  );
}
