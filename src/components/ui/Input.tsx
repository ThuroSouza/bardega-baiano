import { useId } from "react";
import type { InputHTMLAttributes } from "react";
export function Input({
  label,
  error,
  id,
  className = "",
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string }) {
  const generated = useId();
  const inputId = id ?? generated;
  return (
    <div className={`field ${className}`}>
      <label htmlFor={inputId}>{label}</label>
      <input
        id={inputId}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${inputId}-error` : undefined}
        {...props}
      />
      {error && (
        <small id={`${inputId}-error`} className="field-error">
          {error}
        </small>
      )}
    </div>
  );
}
