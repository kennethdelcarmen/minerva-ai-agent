import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-md border border-border/60 bg-muted/70", className)}
      {...props}
    />
  )
}

export { Skeleton }
