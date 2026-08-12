/** @jsxImportSource preact */
import type { ComponentChildren, JSX } from "preact";

import type { DashboardTaskPreview } from "../../api/dashboard";

export function formatNumber(value: number): string {
  return value.toLocaleString("en-US");
}

export function formatWaveDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(
    new Date(`${value}T12:00:00`),
  );
}

export function dueLabel(task: DashboardTaskPreview): string {
  if (task.overdue) {
    const days = Math.max(1, Math.floor((Date.now() - task.due_at) / 86_400_000));
    return `${days} day${days === 1 ? "" : "s"} overdue`;
  }
  return `Due ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(task.due_at))}`;
}

export function DashboardLink({ href, navigate, class: className, children, label }: {
  href: string;
  navigate: (target: string) => void;
  class: string;
  children: ComponentChildren;
  label?: string;
}): JSX.Element {
  return <a class={className} href={href} aria-label={label} onClick={(event) => {
    event.preventDefault();
    navigate(href);
  }}>{children}</a>;
}
