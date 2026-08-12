/** @jsxImportSource preact */

import { useEffect, useState } from "preact/hooks";
import type { JSX } from "preact";

import { apiFetch } from "../shell/api-client";

interface FileComment {
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
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function FileComments({ eventId, taskId, attachmentId }: { eventId: string; taskId: string; attachmentId: string | null }): JSX.Element {
  const [comments, setComments] = useState<FileComment[]>([]);
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void apiFetch<{ comments: FileComment[] }>(
      `/api/v1/events/${encodeURIComponent(eventId)}/files/${encodeURIComponent(taskId)}/comments`,
    )
      .then((response) => { if (!cancelled) setComments(response.comments); })
      .catch((caught) => { if (!cancelled) setError((caught as Error).message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [eventId, taskId]);

  const submit = async (event: Event) => {
    event.preventDefault();
    const trimmed = body.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await apiFetch<{ comment: FileComment }>(
        `/api/v1/events/${encodeURIComponent(eventId)}/files/${encodeURIComponent(taskId)}/comments`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ body: trimmed, attachment_id: attachmentId }),
        },
      );
      setComments((current) => [...current, response.comment]);
      setBody("");
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return <section class="files-comments" aria-labelledby={`files-comments-heading-${taskId}`}>
    <header class="files-comments-head">
      <div><h4 id={`files-comments-heading-${taskId}`}>Comments</h4><span>threaded on this deliverable slot</span></div>
      {attachmentId ? <span class="files-comments-current">new replies tag the current upload</span> : null}
    </header>
    {loading ? <p class="files-comments-state">Loading comments…</p> : error && comments.length === 0 ? <p class="files-comments-state files-comments-error" role="alert">{error}</p> : comments.length === 0 ? <p class="files-comments-state">No comments yet. Add context for the conference team.</p> : <div class="files-comment-list">{comments.map((comment) => <article class="files-comment" key={comment.id}>
      <div class="files-comment-meta"><strong>{comment.author_name}</strong><span>{roleLabel(comment.author_role)}</span><time dateTime={new Date(comment.created_at).toISOString()}>{commentDate(comment.created_at)}</time></div>
      <p>{comment.body}</p>
      {comment.attachment_version !== null ? <span class="files-comment-version">{comment.attachment_filename ?? "upload"} · v{comment.attachment_version}</span> : null}
    </article>)}</div>}
    <form class="files-comment-form" onSubmit={submit}>
      <label for={`files-comment-body-${taskId}`}>Reply on this deliverable</label>
      <textarea id={`files-comment-body-${taskId}`} value={body} onInput={(event) => setBody((event.currentTarget as HTMLTextAreaElement).value)} placeholder="Share a note about this deliverable" rows={3} />
      <div class="files-comment-actions"><span class="files-comment-error" aria-live="polite">{error && comments.length > 0 ? error : ""}</span><button class="files-comment-submit" type="submit" disabled={busy || body.trim().length === 0}>{busy ? "Posting…" : "Post reply"}</button></div>
    </form>
  </section>;
}
