import * as React from "react"

import { cn } from "@/lib/utils"

function ScrollArea({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="scroll-area"
      className={cn("relative overflow-hidden", className)}
      {...props}
    >
      <div
        data-slot="scroll-area-viewport"
        className="size-full overflow-auto rounded-[inherit] focus-visible:outline-none"
      >
        {children}
      </div>
    </div>
  )
}

function ScrollBar({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="scroll-area-scrollbar"
      className={cn("hidden", className)}
      {...props}
    />
  )
}

export { ScrollArea, ScrollBar }
