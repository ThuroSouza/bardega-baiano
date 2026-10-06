import type { HTMLAttributes } from "react";
export function Badge({
  tone = "neutral",
  className = "",
  ...props
}: HTMLAttributes<HTMLSpanElement> & {
  tone?: "neutral" | "amber" | "success" | "danger";
}) {
  return <span className={`badge badge-${tone} ${className}`} {...props} />;
}
