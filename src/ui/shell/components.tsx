import type { ComponentChildren, JSX } from "preact";

export function Button({ variant = "", small = false, class: className = "", ...props }: JSX.HTMLAttributes<HTMLButtonElement> & { variant?: "" | "primary" | "danger" | "ghost"; small?: boolean }): JSX.Element {
  return <button {...props} class={`button ${variant} ${small ? "small" : ""} ${className}`.trim()} />;
}

export function Card({ children, class: className = "" }: { children: ComponentChildren; class?: string }): JSX.Element {
  return <section class={`card ${className}`.trim()}>{children}</section>;
}

export function CardHeader({ title, children }: { title: string; children?: ComponentChildren }): JSX.Element {
  return <header class="card-head"><h2>{title}</h2>{children}</header>;
}

export function CardBody({ children }: { children: ComponentChildren }): JSX.Element {
  return <div class="card-body">{children}</div>;
}

export function PageHeader({ title, copy, actions }: { title: string; copy: string; actions?: ComponentChildren }): JSX.Element {
  return <header class="page-head"><div><h1>{title}</h1><p>{copy}</p></div><div class="head-actions">{actions}</div></header>;
}

export function Chip({ tone = "", children }: { tone?: "" | "success" | "warning" | "alarm"; children: ComponentChildren }): JSX.Element {
  return <span class={`chip ${tone}`.trim()}>{children}</span>;
}

export function EmptyState({ title, copy, action }: { title: string; copy: string; action?: ComponentChildren }): JSX.Element {
  return <section class="card empty-state"><div><span class="empty-mark" aria-hidden="true">◇</span><h2>{title}</h2><p>{copy}</p>{action}</div></section>;
}

export function Switch({ on, label, onClick }: { on: boolean; label: string; onClick?: () => void }): JSX.Element {
  return <button type="button" class={`switch ${on ? "on" : ""}`} aria-label={label} aria-pressed={on} onClick={onClick} />;
}
