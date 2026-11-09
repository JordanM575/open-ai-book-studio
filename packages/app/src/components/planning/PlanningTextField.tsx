import { useId } from "react";
import { planningInputClass } from "./CheckedDraftDialog";

/** Keep the actual editing buffer in the guarded draft, including incomplete JSON. */
export type PlanningText = { text: string; exact: boolean };
export type TextFields<T> = { [K in keyof T]: PlanningText };

export function textFields<T extends Record<string, string>>(fields: T): TextFields<T> {
  return Object.fromEntries(Object.entries(fields).map(([key, text]) => [key,
    { text: needsExact(text) ? JSON.stringify(text) : text, exact: needsExact(text) }
  ])) as TextFields<T>;
}

function needsExact(text: string): boolean {
  // A textarea normalizes CR/CRLF. Null is also unsafe to transfer as ordinary clipboard text.
  return text.includes("\r") || text.includes("\0");
}

function parseText(field: PlanningText): string | null {
  if (!field.exact) return field.text;
  try {
    const value: unknown = JSON.parse(field.text);
    return typeof value === "string" ? value : null;
  } catch { return null; }
}

export function parseTextFields<T extends Record<string, PlanningText>>(fields: T): { [K in keyof T]: string } | null {
  const parsed: [string, string][] = [];
  for (const [key, field] of Object.entries(fields)) {
    const value = parseText(field);
    if (value === null) return null;
    parsed.push([key, value]);
  }
  return Object.fromEntries(parsed) as { [K in keyof T]: string };
}

export function PlanningTextField({ label, limit, field, onChange }: {
  label: string; limit: number; field: PlanningText; onChange: (field: PlanningText) => void;
}) {
  const id = useId();
  const value = parseText(field);
  const canUseText = value !== null && !needsExact(value);
  return <div className="space-y-1.5">
    <label htmlFor={id} className="block">{label}</label>
    <textarea id={id} className={planningInputClass} rows={limit === 200 ? 2 : 4} value={field.text}
      spellCheck={field.exact ? false : undefined} aria-invalid={value === null || value.length > limit}
      aria-describedby={`${id}-count ${id}-format`}
      onChange={(event) => onChange({ ...field, text: event.target.value })} />
    <p id={`${id}-count`} className="text-muted-foreground">{value === null
      ? "Enter one valid JSON string, including its double quotes. This field has not been submitted."
      : `${value.length.toLocaleString("en-US")} / ${limit.toLocaleString("en-US")} UTF-16 units${field.exact ? " · decoded value" : ""}`}</p>
    <label className="flex min-h-11 items-center gap-2" htmlFor={`${id}-exact`}>
      <input id={`${id}-exact`} type="checkbox" checked={field.exact} disabled={field.exact && !canUseText}
        aria-describedby={`${id}-format`} onChange={(event) => {
          if (value === null || (!event.target.checked && !canUseText)) return;
          onChange({ exact: event.target.checked, text: event.target.checked ? JSON.stringify(value) : value });
        }} />
      Use exact JSON string · {label}
    </label>
    <p id={`${id}-format`} className="text-muted-foreground">{field.exact
      ? 'Paste the exact JSON string from the recovery copy, including double quotes. Escapes such as \\r, \\n and \\t become literal characters when saved. Plain-text mode is available only for valid values without carriage returns or null characters.'
      : 'Plain text uses LF line breaks. For exact recovery, select Use exact JSON string before pasting the copy’s encoded value.'}</p>
  </div>;
}
