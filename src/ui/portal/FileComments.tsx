/** @jsxImportSource preact */

import { useEffect, useState } from "preact/hooks";
import type { JSX } from "preact";

import { apiFetch } from "../shell/api-client";

export interface PortalFileComment {
  id: string;
  attachment_id: string | null;
  attachment_filename: string | null;
  attachment_version: number | null;
  author_name: string;
  author_role: string;
  body: string;
  created_at: number;
}

function roleLabel(role: string): string {
  return role.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function commentDate(value: number): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

export function FileComments({ taskId, attachmentId }: { taskId: string; attachmentId: string | null }): JSX.Element {
  const [comments, setComments] = useState<PortalFileComment[]>([]);
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void apiFetch<{ comments: PortalFileComment[] }>(`/api/v1/me/tasks/${encodeURIComponent(taskId)}/comments`)
      .then((response) => { if (!cancelled) setComments(response.comments); })
      .catch((caught) => { if (!cancelled) setError((caught as Error).message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [taskId]);

  const submit = async (event: Event) => {
    event.preventDefault();
    const trimmed = body.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await apiFetch<{ comment: PortalFileComment }>(`/api/v1/me/tasks/${encodeURIComponent(taskId)}/comments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: trimmed, attachment_id: attachmentId }),
      });
      setComments((current) => [...current, response.comment]);
      setBody("");
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return <section class="portal-file-comments" aria-labelledby={`file-comments-heading-${taskId}`}>
    <header class="portal-file-comments-head">
      <div><h4 id={`file-comments-heading-${taskId}`}>Comments</h4><span>shared with the conference team</span></div>
      {attachmentId ? <span class="portal-file-comments-current">new notes tag the current upload</span> : null}
    </header>
    {loading ? <p class="portal-file-comments-state">Loading comments…</p> : comments.length === 0 ? <p class="portal-file-comments-state">No comments yet. Add context for the conference team.</p> : <div class="portal-file-comment-list">{comments.map((comment) => <article class="portal-file-comment" key={comment.id}>
      <div class="portal-file-comment-meta"><strong>{comment.author_name}</strong><span>{roleLabel(comment.author_role)}</span><time dateTime={new Date(comment.created_at).toISOString()}>{commentDate(comment.created_at)}</time></div>
      <p>{comment.body}</p>
      {comment.attachment_version !== null ? <span class="portal-file-comment-version">{comment.attachment_filename ?? "upload"} · v{comment.attachment_version}</span> : null}
    </article>)}</div>}
    <form class="portal-file-comment-form" onSubmit={submit}>
      <label for={`file-comment-body-${taskId}`}>Add a comment</label>
      <textarea id={`file-comment-body-${taskId}`} value={body} onInput={(event) => setBody((event.currentTarget as HTMLTextAreaElement).value)} placeholder="Share a note about this deliverable" rows={3} />
      <div class="portal-file-comment-actions"><span class="portal-file-comment-error" aria-live="polite">{error ?? ""}</span><button class="portal-button" type="submit" disabled={busy || body.trim().length === 0}>{busy ? "Posting…" : "Post comment"}</button></div>
    </form>
  </section>;
}
