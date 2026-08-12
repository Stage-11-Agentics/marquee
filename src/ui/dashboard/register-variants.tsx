/** @jsxImportSource preact */
// Register dashboard variants — the theme-round tropes as renderers keyed by
// chrome fields (terminal / feed / ascii / kv / timeline), each wired to the
// same computed snapshot the default Flight Deck renderers read. No counts
// are hardcoded: where the previews mocked a figure, these read the field the
// dashboard API actually returns. Sections with no real data source at all
// (the pacing chart, the company logo wall) are deliberately absent rather
// than faked.

import type { JSX } from "preact";

import type { DashboardSnapshot, DashboardTaskPreview, DashboardWave } from "../../api/dashboard";
import { DashboardLink, dueLabel, formatNumber, formatWaveDate } from "./shared";

type Navigate = (target: string) => void;

/** The post-index date: "Aug 08" — CSS lowercases it in the swyxy register. */
function feedDate(ms: number): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "2-digit" }).format(new Date(ms));
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function trackSlug(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/* ── attention: one normalized feed, three renderers ───────────────────── */

interface AttentionEntry {
  id: string;
  href: string;
  ariaLabel: string;
  title: string;
  detail: string;
  /** Right-hand stat for the post index; shell flag for the terminal. */
  stat: string;
  warn: boolean;
  dateMs: number;
  emoji: string;
  cmd: string;
  flag: string;
}

function attentionEntries(snapshot: DashboardSnapshot): AttentionEntry[] {
  const { attention, generated_at } = snapshot;
  const entries: AttentionEntry[] = [];
  if (attention.next_wave) {
    const wave = attention.next_wave;
    entries.push({
      id: "wave",
      href: wave.href,
      ariaLabel: `Open ${wave.name}`,
      title: `${wave.name} planned`,
      detail: `${formatNumber(wave.accepted_count)} accepted · ${formatNumber(wave.target_count)} target · open planner`,
      stat: `${formatNumber(wave.accepted_count)} / ${formatNumber(wave.target_count)} accepted`,
      warn: false,
      dateMs: new Date(`${wave.decision_on}T12:00:00`).getTime(),
      emoji: "⏰",
      cmd: "wave.status",
      flag: "[wave-planner]",
    });
  }
  if (attention.unreviewed_track) {
    const track = attention.unreviewed_track;
    entries.push({
      id: "review",
      href: track.href,
      ariaLabel: `Open ${track.label} unreviewed submissions`,
      title: `${formatNumber(track.count)} unreviewed in ${track.label}`,
      detail: "open the exact filtered review work",
      stat: "needs reviewers",
      warn: true,
      dateMs: generated_at,
      emoji: "📥",
      cmd: `review --track=${trackSlug(track.label)}`,
      flag: "[review]",
    });
  }
  entries.push({
    id: "overdue",
    href: attention.overdue_submissions.href,
    ariaLabel: "Open submissions with overdue speaker tasks",
    title: `${formatNumber(attention.overdue_submissions.count)} speaker tasks overdue`,
    detail: "open the affected submissions and chase work",
    stat: "overdue",
    warn: attention.overdue_submissions.count > 0,
    dateMs: generated_at,
    emoji: "🎤",
    cmd: "speakers --overdue",
    flag: "[onboarding]",
  });
  entries.push({
    id: "notify",
    href: attention.decided_not_notified.href,
    ariaLabel: `Open ${formatNumber(attention.decided_not_notified.count)} decided submissions not notified`,
    title: `${formatNumber(attention.decided_not_notified.count)} decisions not notified`,
    detail: attention.decided_not_notified.note,
    stat: "send mail",
    warn: false,
    dateMs: generated_at,
    emoji: "✉️",
    cmd: "notify --pending",
    flag: "[comms]",
  });
  return entries;
}

/** AI Engineer: the chase queue as shell output. */
export function TerminalAttention({ snapshot, navigate }: { snapshot: DashboardSnapshot; navigate: Navigate }): JSX.Element {
  const entries = attentionEntries(snapshot);
  return <section class="register-terminal" aria-label="Needs attention">
    <div class="register-terminal-bar">marquee — chase queue · {entries.length} items</div>
    {entries.map((entry) => <DashboardLink key={entry.id} href={entry.href} navigate={navigate} class="register-term-row" label={entry.ariaLabel}>
      <span class="register-term-prompt" aria-hidden="true">&gt;_</span>
      <span class="register-term-cmd">{entry.cmd}</span>
      <span class="register-term-arrow" aria-hidden="true">→</span>
      <span class="register-term-out"><strong>{entry.title}</strong> — {entry.detail}</span>
      <span class="register-term-flag">{entry.flag}</span>
    </DashboardLink>)}
  </section>;
}

/** swyxy: the chase queue as his post index — date · format emoji · title. */
export function FeedAttention({ snapshot, navigate }: { snapshot: DashboardSnapshot; navigate: Navigate }): JSX.Element {
  const entries = attentionEntries(snapshot);
  return <section aria-label="Needs attention">
    <div class="register-feed-head"><h2>needs attention</h2><span class="subtle">{entries.length} items</span></div>
    <div class="register-feed">{entries.map((entry) => <DashboardLink key={entry.id} href={entry.href} navigate={navigate} class="register-feed-row" label={entry.ariaLabel}>
      <span class="register-feed-date">{feedDate(entry.dateMs)}</span>
      <span class="register-feed-emoji" aria-hidden="true">{entry.emoji}</span>
      <span class="register-feed-what"><b>{entry.title}</b> <span class="detail">— {entry.detail}</span></span>
      <span class={`register-feed-stat ${entry.warn ? "warn" : ""}`.trim()}>{entry.stat}</span>
    </DashboardLink>)}</div>
  </section>;
}

/* ── waves ─────────────────────────────────────────────────────────────── */

function wavePercent(wave: DashboardWave): number {
  const target = Math.max(wave.target_count, 1);
  return Math.min(100, Math.round(wave.accepted_count / target * 100));
}

/** AI Engineer: wave progress as ASCII bars. */
export function AsciiWaveRows({ waves, navigate }: { waves: DashboardWave[]; navigate: Navigate }): JSX.Element {
  const WIDTH = 12;
  return <>{waves.map((wave) => {
    const percent = wavePercent(wave);
    const filled = Math.round(percent / 100 * WIDTH);
    return <div class="dashboard-wave-row" key={wave.id}>
      <span><strong>{wave.name}</strong><small>{wave.decision_on}—{wave.sent_at === null ? "planned" : "sent"}</small></span>
      <DashboardLink href={wave.href} navigate={navigate} class="dashboard-wave-progress" label={`Open ${wave.name}: ${formatNumber(wave.accepted_count)} accepted of ${formatNumber(wave.target_count)} target`}>
        <span class="register-wave-ascii" aria-hidden="true">[{"█".repeat(filled)}<span class="dim">{"░".repeat(WIDTH - filled)}</span>] {percent}%</span>
        <span class="register-wave-meta">{formatNumber(wave.accepted_count)} accepted · {formatNumber(wave.target_count)} target</span>
      </DashboardLink>
    </div>;
  })}</>;
}

/** swyxy: waves as dense key/value rows with a hairline bar. */
export function KvWaveRows({ waves, navigate }: { waves: DashboardWave[]; navigate: Navigate }): JSX.Element {
  return <>{waves.map((wave) => {
    const percent = wavePercent(wave);
    return <DashboardLink key={wave.id} href={wave.href} navigate={navigate} class="register-kv" label={`Open ${wave.name}: ${formatNumber(wave.accepted_count)} accepted of ${formatNumber(wave.target_count)} target`}>
      <span class="k"><span class="register-bar-track" aria-hidden="true"><i style={{ width: `${percent}%` }} /></span>{wave.name} <span class="detail">· {formatWaveDate(wave.decision_on)} — {wave.sent_at === null ? "planned" : "sent"}</span></span>
      <span class={`v ${percent === 0 || percent === 100 ? "muted" : ""}`.trim()}>{formatNumber(wave.accepted_count)} / {formatNumber(wave.target_count)}</span>
    </DashboardLink>;
  })}</>;
}

/* ── speaker tasks ─────────────────────────────────────────────────────── */

/** AI Engineer: task rows as timeline entries — the date— trope leads. */
export function TimelineTaskRows({ tasks, navigate }: { tasks: DashboardTaskPreview[]; navigate: Navigate }): JSX.Element {
  return <>{tasks.map((task) => <DashboardLink key={`${task.submission_id}-${task.task_title}`} href={task.href} navigate={navigate} class="dashboard-task-row" label={`Open ${task.person_name}'s ${task.task_title}`}>
    <span class="register-when">{isoDate(task.due_at)}—</span>
    <strong>{task.person_name}</strong>
    <span title={task.submission_title}>{task.submission_title}</span>
    <span class="subtle">{task.task_title}</span>
    <span class={`chip ${task.overdue ? "alarm" : ""}`.trim()}>{dueLabel(task)}</span>
  </DashboardLink>)}</>;
}

/** The format emoji: the task classifies itself at a glance. */
function taskEmoji(title: string): string {
  const lower = title.toLowerCase();
  if (lower.includes("agreement")) return "📄";
  if (lower.includes("headshot") || lower.includes("photo")) return "📸";
  if (lower.includes("travel") || lower.includes("accommodation")) return "✈️";
  if (lower.includes("slides")) return "🎞️";
  return "📌";
}

/** swyxy: speaker tasks as the post index — date · format emoji · title. */
export function FeedTaskRows({ tasks, navigate }: { tasks: DashboardTaskPreview[]; navigate: Navigate }): JSX.Element {
  return <div class="register-feed">{tasks.map((task) => <DashboardLink key={`${task.submission_id}-${task.task_title}`} href={task.href} navigate={navigate} class="register-feed-row" label={`Open ${task.person_name}'s ${task.task_title}`}>
    <span class="register-feed-date">{feedDate(task.due_at)}</span>
    <span class="register-feed-emoji" aria-hidden="true">{taskEmoji(task.task_title)}</span>
    <span class="register-feed-what"><b>{task.task_title} — {task.person_name}</b> <span class="detail">· {task.submission_title}</span></span>
    <span class={`register-feed-stat ${task.overdue ? "warn" : ""}`.trim()}>{dueLabel(task)}</span>
  </DashboardLink>)}</div>;
}

/* ── work in motion ────────────────────────────────────────────────────── */

/** swyxy: metrics, pressure, and mix as dense key/value rows. */
export function KvMetrics({ snapshot, navigate }: { snapshot: DashboardSnapshot; navigate: Navigate }): JSX.Element {
  return <>
    {snapshot.metrics.map((metric) => <DashboardLink key={metric.id} href={metric.href} navigate={navigate} class="register-kv" label={`Open ${metric.label}: ${formatNumber(metric.count)}`}>
      <span class="k">{metric.label} <span class="detail">· {metric.note}</span></span>
      <span class="v">{formatNumber(metric.count)}</span>
    </DashboardLink>)}
    {snapshot.track_pressure.length > 0 && <DashboardLink href={snapshot.track_pressure[0].href} navigate={navigate} class="register-kv" label="Open review pressure by track">
      <span class="k">review pressure <span class="detail">· {snapshot.track_pressure.map((item) => `${item.label} ${formatNumber(item.count)}`).join(" · ")}</span></span>
      <span class="v muted">by track →</span>
    </DashboardLink>}
    {snapshot.format_mix.length > 0 && <DashboardLink href={snapshot.format_mix[0].href} navigate={navigate} class="register-kv" label="Open program mix by format">
      <span class="k">program mix <span class="detail">· {snapshot.format_mix.map((item) => `${item.label} ${formatNumber(item.count)}`).join(" · ")}</span></span>
      <span class="v muted">by format →</span>
    </DashboardLink>}
  </>;
}

/* ── latent.space: the VAE-bottleneck silhouette ───────────────────────── */

export function BottleneckDeco(): JSX.Element {
  return <svg class="register-bottleneck" viewBox="0 0 1200 170" preserveAspectRatio="none" aria-hidden="true">
    <defs>
      <linearGradient id="register-ls-grad" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#ffa363" />
        <stop offset="1" stop-color="#e56eff" />
      </linearGradient>
    </defs>
    <path d="M0,14 C 320,14 420,68 600,68 C 780,68 880,14 1200,14 L1200,156 C 880,156 780,102 600,102 C 420,102 320,156 0,156 Z"
      fill="url(#register-ls-grad)" opacity="0.055" />
    <path d="M0,14 C 320,14 420,68 600,68 C 780,68 880,14 1200,14" fill="none" stroke="url(#register-ls-grad)" stroke-width="1" opacity="0.35" />
    <path d="M0,156 C 320,156 420,102 600,102 C 780,102 880,156 1200,156" fill="none" stroke="url(#register-ls-grad)" stroke-width="1" opacity="0.35" />
  </svg>;
}

export const BOTTLENECK_CAPTION = "the program funnel, drawn as an autoencoder — wide in, pinch at the decision, wide out to the site";
