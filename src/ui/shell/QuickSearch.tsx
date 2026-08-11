import type { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

import type { SearchResult } from "../../api/search";
import { useDialogLifecycle } from "./OverlayHosts";
import "./quick-search.css";

type SearchState = "idle" | "loading" | "ready" | "error";

interface SearchResponse {
  data: SearchResult[];
}

interface Props {
  eventId: string;
  open: boolean;
  onClose: () => void;
  navigate: (target: string) => void;
}

async function readSearchResponse(response: Response): Promise<SearchResponse> {
  const body = await response.json().catch(() => null) as unknown;
  if (!response.ok) throw new Error("Search could not be loaded. Try again.");
  if (typeof body !== "object" || body === null || !Array.isArray((body as { data?: unknown }).data)) {
    throw new Error("Search returned an unreadable result set.");
  }
  return body as SearchResponse;
}

export function QuickSearch({ eventId, open, onClose, navigate }: Props): JSX.Element | null {
  const dialogRef = useDialogLifecycle(open, onClose);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [state, setState] = useState<SearchState>("idle");
  const [paintedQuery, setPaintedQuery] = useState("");
  const activeRequestRef = useRef<AbortController | null>(null);
  const searchSessionRef = useRef("");

  useEffect(() => {
    if (!open) return;
    searchSessionRef.current = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setQuery("");
    setResults([]);
    setState("idle");
    setPaintedQuery("");
    void fetch(`/api/v1/events/${encodeURIComponent(eventId)}/search?q=`, {
      headers: { accept: "application/json", "x-search-session": searchSessionRef.current, "x-search-prefetch": "1" },
    }).catch(() => undefined);
    inputRef.current?.focus();
  }, [eventId, open]);

  useEffect(() => {
    if (!open || query.trim().length === 0) {
      setResults([]);
      setState("idle");
      if (query.trim().length === 0) setPaintedQuery("");
      return;
    }
    const controller = new AbortController();
    activeRequestRef.current = controller;
    const requestQuery = query;
    setState("loading");
    void fetch(`/api/v1/events/${encodeURIComponent(eventId)}/search?q=${encodeURIComponent(requestQuery)}`, {
      headers: { accept: "application/json", "x-search-session": searchSessionRef.current },
      signal: controller.signal,
    })
      .then(readSearchResponse)
      .then((body) => {
        if (controller.signal.aborted) return;
        setResults(body.data);
        setState("ready");
        setPaintedQuery(requestQuery);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof Error && error.name === "AbortError") return;
        setState("error");
        setResults([]);
        setPaintedQuery(requestQuery);
      });
    return () => {
      controller.abort();
      if (activeRequestRef.current === controller) activeRequestRef.current = null;
    };
  }, [eventId, open, query]);

  if (!open) return null;

  const selectResult = (result: SearchResult) => {
    onClose();
    navigate(result.href);
  };

  return <div class="quick-search-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
    <section ref={dialogRef} class="modal quick-search-dialog" role="dialog" aria-modal="true" aria-label="Search everything" tabIndex={-1}>
      <div class="quick-search-input-wrap">
        <span class="search-glyph" aria-hidden="true">⌕</span>
        <input
          ref={inputRef}
          data-search-input
          class="quick-search-input"
          aria-label="Search submissions, speakers, sessions, or forms"
          placeholder="Search submissions, speakers, sessions, or forms…"
          autocomplete="off"
          onInput={(event) => {
            activeRequestRef.current?.abort();
            setQuery((event.currentTarget as HTMLInputElement).value);
          }}
        />
        <kbd>Esc</kbd>
      </div>
      <div
        class="quick-search-results"
        role="listbox"
        aria-label="Search results"
        data-search-results
        data-search-query={query}
        data-search-painted-query={paintedQuery}
        data-search-state={state}
      >
        {state === "loading" && <div class="quick-search-status" role="status" aria-live="polite"><strong>Searching the conference</strong><span>Reading abstracts, sessions, speakers, and forms…</span></div>}
        {state === "error" && <div class="quick-search-status" role="alert"><strong>Search needs attention</strong><span>Try that query again.</span></div>}
        {state === "idle" && <div class="quick-search-status"><strong>Search the conference</strong><span>Type a partial or misspelled name, title, or record ID.</span></div>}
        {state === "ready" && results.length === 0 && <div class="quick-search-status"><strong>No results for “{query}”</strong><span>Try an Abstract, Session, Speaker, Form, or record ID.</span></div>}
        {state === "ready" && results.length > 0 && results.map((result, index) => <button
          type="button"
          role="option"
          aria-label={`${result.type}: ${result.title}`}
          class="quick-search-result"
          data-search-result
          data-result-type={result.type}
          key={`${result.type}-${result.id}`}
          onClick={() => selectResult(result)}
        >
          <span class="quick-search-result-type">{result.type}</span>
          <span class="quick-search-result-copy"><strong>{result.title}</strong><small>{result.subtitle}</small></span>
          <kbd>{index + 1}</kbd>
        </button>)}
      </div>
      <footer class="quick-search-footer"><span>Results update as you type</span><button type="button" class="button small" onClick={onClose}>Esc · Close</button></footer>
    </section>
  </div>;
}
