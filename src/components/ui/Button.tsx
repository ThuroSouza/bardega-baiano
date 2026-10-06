import type { ButtonHTMLAttributes, ReactElement, ReactNode } from "react";
import { cloneElement, isValidElement } from "react";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  asChild?: boolean;
  children: ReactNode;
};
export function Button({
  variant = "primary",
  asChild = false,
  className = "",
  children,
  ...props
}: Props) {
  const classes = `button button-${variant} ${className}`;
  if (asChild && isValidElement(children))
    return cloneElement(children as ReactElement<{ className?: string }>, {
      className: classes,
    });
  return (
    <button className={classes} {...props}>
      {children}
    </button>
  );
}
