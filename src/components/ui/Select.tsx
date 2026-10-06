import { useId } from "react";
import type { SelectHTMLAttributes } from "react";
export function Select({
  label,
  id,
  children,
  className = "",
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string }) {
  const generated = useId();
  return (
    <div className={`field ${className}`}>
      <label htmlFor={id ?? generated}>{label}</label>
      <select id={id ?? generated} {...props}>
        {children}
      </select>
    </div>
  );
}
