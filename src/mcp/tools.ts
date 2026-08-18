/**
 * The tool catalogue: twenty-five doors, each one an operation the REST API
 * already serves.
 *
 * A tool declares three things and no more — which registered operation it is,
 * how its arguments become that operation's path, query, body and headers, and
 * a description written for a model that has never seen Marquee. It declares no
 * tier of its own: `operationId` is resolved against the live route registry at
 * request time, and the tier comes from THAT route's policy. So a tool cannot
 * claim an authority its route does not have, and a policy change on the route
 * is a policy change here, with nothing to keep in step by hand.
 *
 * Descriptions are the product surface of an MCP server — they are the only
 * thing the calling model reads before it acts. Each one states the
 * precondition, what a refusal means, and, for a write, what it changes and how
 * it is undone. They are written flat and plain on purpose: a model reading
 * `tools/list` cold has no other context to lean on.
 */

/** How one argument object becomes one HTTP request against the API. */
export interface McpTool {
  name: string;
  /** The registered API operation this tool is a façade over. */
  operationId: string;
  /** Short human label, shown by clients that render one. */
  title: string;
  description: string;
  /** JSON Schema for the arguments, as `tools/list` publishes it. */
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties: false;
  };
  /** OpenAPI path-parameter name -> argument name. */
  pathParams?: Record<string, string>;
  /** Arguments forwarded verbatim as query parameters. */
  query?: readonly string[];
  /** Arguments assembled into the JSON body, plus any fixed fields. */
  body?: {
    /** Argument names copied straight through when present. */
    fields?: readonly string[];
    /** Argument name -> body field name, where the API spells it differently. */
    rename?: Record<string, string>;
    /** Values this tool always sends, whatever the caller asked for. */
    fixed?: Record<string, unknown>;
    /**
     * Build the plan/apply `selector` from `ids` or `filter`. It is a flag
     * rather than a callback because the two-phase decision contract has one
     * selector shape and inventing a second would be exactly the business logic
     * a façade must not hold.
     */
    selector?: true;
    /**
     * Arguments gathered into a flat `selector` object — the shape the comms
     * endpoint takes, where the recipients are named rather than filtered.
     */
    selectorFields?: readonly string[];
  };
  /** HTTP header name -> argument name (If-Match, Idempotency-Key). */
  headers?: Record<string, string>;
  /** True when the tool changes state; clients surface this to their operator. */
  write?: boolean;
}

const eventIdArgument = {
  type: "string",
  description: "The conference id, as returned by list_events. Not the slug.",
} as const;

/**
 * The filter vocabulary of the one submissions list. It is repeated by
 * `comms_audience` because that endpoint resolves the SAME filters into
 * recipients — which is precisely why an agent can count before it sends.
 */
const submissionFilterProperties = {
  q: { type: "string", description: "Free-text search over title, abstract, and speaker name." },
  kind: { type: "string", enum: ["abstract", "session"], description: "`abstract` is something applying to be on the program; `session` is already guaranteed a slot." },
  status: {
    type: "string",
    enum: [
      "draft", "submitted", "in_review", "accepted", "accepted_any", "waitlisted",
      "rejected", "withdrawn", "waved", "unreviewed", "onboarding", "scheduled",
      "published", "not_yet_public", "live_on_site", "not_notified",
    ],
    description: "Pipeline stage. `unreviewed` is the pile nobody has read; `not_notified` is decided but not yet told.",
  },
  track: { type: "string", description: "Track name." },
  format: { type: "string", description: "Format name (talk, workshop, lightning, …)." },
  wave: { type: "string", description: "Acceptance wave name." },
  task: { type: "string", enum: ["overdue"], description: "`overdue` narrows to speakers with a task past its due date." },
  placement: { type: "string", enum: ["unplaced"], description: "`unplaced` narrows to accepted sessions with no room and time yet." },
} as const;

export const MCP_TOOLS: readonly McpTool[] = [
  // ── Public tier ────────────────────────────────────────────────────────────
  // Exactly what a signed-out browser can reach, and nothing more. Note what is
  // absent: this instance has no anonymous way to enumerate conferences, so
  // there is no public `list_events` here rather than an invented one.
  {
    name: "agenda",
    operationId: "getPublicAgenda",
    title: "Read the published program",
    description:
      "The public conference schedule: every session an organizer has chosen to publish, with its day, time, room, track, format and speakers. Needs no credential — this is the same data the public agenda page shows. Filter with day, track, format, room, or a free-text q; omit them all for the whole program. An empty result means nothing is published yet, not that the conference is missing. Start here when you have been given a conference and no ids.",
    inputSchema: {
      type: "object",
      properties: {
        event: { type: "string", description: "Conference slug or id. Omit on a single-conference instance." },
        day: { type: "string", description: "A day key from a previous response, e.g. `2026-10-13`. Omit for every day." },
        track: { type: "string", description: "Track name, as it appears in the program." },
        format: { type: "string", description: "Format name (talk, workshop, lightning, …)." },
        room: { type: "string", description: "Room name." },
        q: { type: "string", description: "Free-text search over titles, abstracts and speaker names." },
      },
      additionalProperties: false,
    },
    query: ["event", "day", "track", "format", "room", "q"],
  },
  {
    name: "session",
    operationId: "getPublicSession",
    title: "Read one published session",
    description:
      "One published session by its permalink slug — full abstract, speakers, time, room, and its calendar link. Needs no credential. A 'not found' refusal means the session exists but is not published, or the slug is wrong; the two are deliberately indistinguishable to a stranger. Get slugs from `agenda`.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", description: "The session's public slug, from an `agenda` result." },
        event: { type: "string", description: "Conference slug or id, on a multi-conference instance." },
      },
      required: ["slug"],
      additionalProperties: false,
    },
    pathParams: { slug: "slug" },
    query: ["event"],
  },
  {
    name: "speaker",
    operationId: "getPublicSpeaker",
    title: "Read one published speaker",
    description:
      "A speaker's public profile — bio, title, company, links — and the published sessions they appear in. Needs no credential. Only speakers attached to a published session are reachable this way; anyone else is 'not found', which is concealment, not absence. Get slugs from `agenda`.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", description: "The speaker's public slug, from an `agenda` result." },
        event: { type: "string", description: "Conference slug or id, on a multi-conference instance." },
      },
      required: ["slug"],
      additionalProperties: false,
    },
    pathParams: { slug: "slug" },
    query: ["event"],
  },
  {
    name: "cfp_form",
    operationId: "getPublicForm",
    title: "Read a call for proposals",
    description:
      "The questions a call for proposals asks, in order, with each field's id, type, whether it is required, its options, its length limits, and the conditions that show or hide it — plus whether the call is open, and until when. Needs no credential. Read this before `submit_proposal`: the field ids here are the keys that tool's `answers` object takes, so composing a valid submission without it is guesswork. A closed or unpublished call answers with its own honest lifecycle state rather than an error.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", description: "The form's public slug, e.g. `cfp`. It is the last segment of the /f/<slug> URL." },
      },
      required: ["slug"],
      additionalProperties: false,
    },
    pathParams: { slug: "slug" },
  },
  {
    name: "submit_proposal",
    operationId: "submitPublicForm",
    title: "Send a proposal to a call for proposals",
    description:
      "Sends a proposal through the public call for proposals. This is the same door the web form uses and writes the same row: the same validation, the same per-submitter cap, the same confirmation mail, the same arrival record an organizer sees. WRITE. Read `cfp_form` first and key `answers` by that form's field ids. Refusals are the form's own and are worth reading rather than retrying: a closed window, a submitter at their limit, a required answer missing, or — when this deployment protects its public form with a CAPTCHA — a demand for a `turnstile_token` no agent can mint, which is a deliberate refusal and not a gap to route around. To undo: an undecided submission can still be edited or withdrawn through the link mailed to the submitter.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", description: "The form's public slug, from the /f/<slug> URL." },
        email: { type: "string", description: "The submitter's email address. The confirmation and every later decision letter go here." },
        answers: {
          type: "object",
          description: "One key per form field id, as `cfp_form` lists them. Values are strings, numbers, booleans, or arrays for multi-select.",
          additionalProperties: true,
        },
        participants: {
          type: "array",
          description: "Co-speakers and moderators to attach. Each is invited to fill in their own profile.",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              email: { type: "string" },
              role: { type: "string", enum: ["co_speaker", "moderator"] },
            },
            required: ["name", "email", "role"],
            additionalProperties: false,
          },
        },
        on_behalf_of: {
          type: "object",
          description: "Set when you are submitting for someone else; they, not you, become the speaker of record.",
          properties: { name: { type: "string" }, email: { type: "string" } },
          required: ["name", "email"],
          additionalProperties: false,
        },
        turnstile_token: { type: "string", description: "Only when this deployment requires one. Agents normally cannot produce it." },
      },
      required: ["slug", "answers"],
      additionalProperties: false,
    },
    pathParams: { slug: "slug" },
    body: { fields: ["email", "answers", "participants", "on_behalf_of", "turnstile_token"] },
    write: true,
  },
  {
    name: "star_session",
    operationId: "recordPublicStarBeacon",
    title: "Star a published session as one device",
    description:
      "Records (or removes) one anonymous device's interest in a published session. WRITE, but a small one: the row is (conference, session, device) and carries no person — it feeds the organizer's advance-demand signal, which is how they spot a talk that will outgrow its room. Needs no credential. Idempotent in both directions: starring twice is starring once. Set `starred` false to undo. `device_hash` is a random handle the caller invents for itself and reuses; it must not be derived from a person.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string", description: "A published session's id or slug." },
        device_hash: { type: "string", description: "16–64 lowercase hex characters, invented once by this caller and reused." },
        starred: { type: "boolean", description: "true records the star, false removes it." },
        event: { type: "string", description: "Conference slug or id, on a multi-conference instance." },
      },
      required: ["session_id", "device_hash", "starred"],
      additionalProperties: false,
    },
    body: {
      fields: ["starred"],
      rename: { session_id: "sessionId", device_hash: "deviceHash", event: "eventSlug" },
    },
    write: true,
  },

  // ── Signed tier ────────────────────────────────────────────────────────────
  // Every one of these is exactly as reachable over MCP as it is over REST with
  // the same token, and no more: the tool set widens with the token's grants,
  // its seat, and its conference restriction.
  {
    name: "whoami",
    operationId: "getCurrentAuth",
    title: "Read who this token acts as",
    description:
      "What this credential is and what it can reach: the seat it acts as, its organization, its grants, and any single conference it is pinned to. Call it first on a signed connection — every write is credited to this identity in the audit trail, and it is the cheapest way to find out whether you are a reviewer, an organizer, or a speaker before you assume.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "list_events",
    operationId: "listEvents",
    title: "List the conferences this token can read",
    description:
      "Every conference this credential is allowed to see, with its id, name, dates and status. The ids returned here are the `event_id` every other signed tool takes. A token pinned to one conference sees exactly that one.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "event",
    operationId: "getEventSettings",
    title: "Read a conference's details",
    description:
      "One conference's name, dates, timezone, venue — and, importantly for anything that writes, its tracks and formats with their ids. `place_session` and the track filters take those ids, so read this before scheduling.",
    inputSchema: {
      type: "object",
      properties: { event_id: eventIdArgument },
      required: ["event_id"],
      additionalProperties: false,
    },
    pathParams: { eventId: "event_id" },
  },
  {
    name: "pipeline_summary",
    operationId: "getProgramDashboard",
    title: "Read the program dashboard counts",
    description:
      "The organizer's dashboard in one call: how many proposals have arrived, how many are unread, how many are accepted, waitlisted, rejected, scheduled, published, and what is overdue. Each count corresponds to a `list_submissions` filter, so this is the right first read for 'where does this conference stand' before pulling any rows.",
    inputSchema: {
      type: "object",
      properties: { event_id: eventIdArgument },
      required: ["event_id"],
      additionalProperties: false,
    },
    pathParams: { eventId: "event_id" },
  },
  {
    name: "list_submissions",
    operationId: "listEventSubmissions",
    title: "List proposals and sessions",
    description:
      "The conference pile, filtered, sorted and paginated on the server — never in the client. Filter by status, track, format, kind, wave, or free text; sort by newest, updated, title, human score, or `agent_score` for an agent's first read, highest first. Pages are deterministic, so walking `page` 1..n sees every row exactly once. Ask for what you need rather than pulling everything: this list is built to hold thousands of rows.",
    inputSchema: {
      type: "object",
      properties: {
        event_id: eventIdArgument,
        ...submissionFilterProperties,
        sort: {
          type: "string",
          enum: ["newest", "updated", "title", "score", "score_asc", "agent_score"],
          description: "`score` is the human committee's weighted score, high to low. `agent_score` is the agent first read, high to low — the two are never mixed.",
        },
        page: { type: "integer", minimum: 1, description: "1-based page number." },
        per_page: { type: "integer", minimum: 1, maximum: 100, description: "Rows per page, up to 100." },
      },
      required: ["event_id"],
      additionalProperties: false,
    },
    pathParams: { eventId: "event_id" },
    query: [
      "q", "kind", "status", "track", "format", "wave", "task", "placement",
      "sort", "page", "per_page",
    ],
  },
  {
    name: "submission",
    operationId: "getSubmissionRecord",
    title: "Read one proposal in full",
    description:
      "Everything an organizer sees about one proposal: every answer as given, its speakers and their profiles, its decision and history, its reviews, its tasks and files. Use it when a list row is not enough to judge or to act. Ids come from `list_submissions`.",
    inputSchema: {
      type: "object",
      properties: {
        event_id: eventIdArgument,
        submission_id: { type: "string", description: "From a `list_submissions` row." },
      },
      required: ["event_id", "submission_id"],
      additionalProperties: false,
    },
    pathParams: { eventId: "event_id", submissionId: "submission_id" },
  },
  {
    name: "review_queue",
    operationId: "getReviewerQueueContext",
    title: "Read this seat's review queue",
    description:
      "What this evaluator seat has been asked to read, in the order the round intends, with the round id and the rubric criteria the scores must key to. Needs a reviewer seat — an organizer token without one gets a refusal naming the missing grant, which is correct rather than surprising. This is the entry point for an agent doing a first read of the pile: the queue tells you both what to read and what to score it against.",
    inputSchema: {
      type: "object",
      properties: { event_id: eventIdArgument },
      required: ["event_id"],
      additionalProperties: false,
    },
    pathParams: { eventId: "event_id" },
  },
  {
    name: "review_submission",
    operationId: "getReviewerSubmission",
    title: "Read one proposal as an evaluator",
    description:
      "One proposal exactly as an evaluator is allowed to see it. When the round is blind, the speaker's identifying fields are withheld here — deliberately, so that a reviewer scores the work and not the name. Score from what this returns, not from `submission`, which is the organizer's unblinded view and would defeat the round's own rules.",
    inputSchema: {
      type: "object",
      properties: {
        event_id: eventIdArgument,
        round_id: { type: "string", description: "From `review_queue`." },
        submission_id: { type: "string", description: "From `review_queue`." },
      },
      required: ["event_id", "round_id", "submission_id"],
      additionalProperties: false,
    },
    pathParams: { eventId: "event_id", roundId: "round_id", submissionId: "submission_id" },
  },
  {
    name: "record_evaluation",
    operationId: "writeReviewerEvaluation",
    title: "Record this seat's evaluation of one proposal",
    description:
      "Files this evaluator seat's scores and written rationale for one proposal. WRITE. Key `criteria_scores` by the criterion ids `review_queue` returned, and say why in `comment` — a rationale that cites the abstract is the whole value of a first read, since a chair reads it verbatim. This does NOT decide anything: an evaluation is a recommendation, and acceptance is `decision_plan` → `apply_decisions` by someone with the authority to decide. When the seat is an agent seat, the score is shown beside the committee's and is never averaged into the human number; a chair can override it. To undo: call again for the same proposal — the latest evaluation from one seat replaces the earlier one.",
    inputSchema: {
      type: "object",
      properties: {
        event_id: eventIdArgument,
        round_id: { type: "string", description: "From `review_queue`." },
        submission_id: { type: "string", description: "From `review_queue`." },
        criteria_scores: {
          type: "object",
          description: "One entry per rubric criterion, keyed by criterion id. Numbers score; strings answer a written criterion.",
          additionalProperties: true,
        },
        score: { type: "number", description: "An overall score, when the round asks for one instead of per-criterion scores." },
        recommendation: { type: "string", enum: ["approve", "maybe", "deny"], description: "The seat's recommendation, if the round takes one." },
        comment: { type: "string", description: "The rationale a chair will read. Two sentences citing the abstract beats a paragraph of praise." },
      },
      required: ["event_id", "round_id", "submission_id"],
      additionalProperties: false,
    },
    pathParams: { eventId: "event_id", roundId: "round_id", submissionId: "submission_id" },
    body: { fields: ["criteria_scores", "score", "recommendation", "comment"], fixed: { abstained: 0 } },
    write: true,
  },
  {
    name: "abstain",
    operationId: "writeReviewerEvaluation",
    title: "Step aside from one proposal",
    description:
      "Records that this seat will not score one proposal — a conflict of interest, or a subject it cannot judge. WRITE. An abstention is counted as answered and is excluded from every score aggregate, which is why it is the honest move rather than a low score or silence: silence looks like unread work and stalls the round. Say why in `comment`. To undo: file a real evaluation with `record_evaluation`, which replaces it.",
    inputSchema: {
      type: "object",
      properties: {
        event_id: eventIdArgument,
        round_id: { type: "string", description: "From `review_queue`." },
        submission_id: { type: "string", description: "From `review_queue`." },
        comment: { type: "string", description: "Why this seat is standing down. A conflict of interest should say whose." },
      },
      required: ["event_id", "round_id", "submission_id"],
      additionalProperties: false,
    },
    pathParams: { eventId: "event_id", roundId: "round_id", submissionId: "submission_id" },
    body: { fields: ["comment"], fixed: { abstained: 1 } },
    write: true,
  },
  {
    name: "speakers",
    operationId: "listEventSpeakers",
    title: "List the speaker roster",
    description:
      "Every speaker of this conference however they arrived — added by an organizer, accepted from the call, or imported — with their confirmation status and their sessions. Filter by status to find who has not confirmed, or by track. This is the roster to work from when chasing outstanding speaker work.",
    inputSchema: {
      type: "object",
      properties: {
        event_id: eventIdArgument,
        q: { type: "string", description: "Free-text search over name, email and company." },
        status: { type: "string", enum: ["all", "pending", "invited", "confirmed", "declined"], description: "Roster status for THIS conference. The same person may be confirmed at one conference and invited at another." },
        track: { type: "string", description: "Track name." },
        page: { type: "integer", minimum: 1 },
        per_page: { type: "integer", minimum: 1, maximum: 100 },
      },
      required: ["event_id"],
      additionalProperties: false,
    },
    pathParams: { eventId: "event_id" },
    query: ["q", "status", "track", "page", "per_page"],
  },
  {
    name: "my_tasks",
    operationId: "getSpeakerPortal",
    title: "Read what this speaker seat owes",
    description:
      "The speaker's own portal: their accepted sessions, the tasks still outstanding, what has been sent, and their profile. This is the speaker's own view of themselves and reaches nobody else's — an organizer token sees nothing here and should use `speakers` instead. Task ids from this response are what `complete_task` takes.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "complete_task",
    operationId: "completeSpeakerTask",
    title: "Complete one of this speaker's tasks",
    description:
      "Marks one of this speaker's own tasks done. WRITE. What it needs depends on the task: an acknowledgement takes `acknowledged` true, a form takes `answers`, a file task takes the `attachment_id` of an already-uploaded file — the wrong payload is refused rather than silently accepted, which is what stops a task looking done with nothing behind it. To undo: an organizer can reopen a completed task.",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "From `my_tasks`." },
        acknowledged: { type: "boolean", description: "For an acknowledgement task." },
        answers: { type: "object", description: "For a form task, keyed by field id.", additionalProperties: true },
        attachment_id: { type: "string", description: "For a file task: an upload already completed by this speaker." },
      },
      required: ["task_id"],
      additionalProperties: false,
    },
    pathParams: { taskId: "task_id" },
    body: { fields: ["acknowledged", "answers", "attachment_id"] },
    write: true,
  },
  {
    name: "decision_plan",
    operationId: "planBulkSubmissionDecision",
    title: "Preview a decision before making it",
    description:
      "Reads back exactly what a decision would do — which proposals it lands on, what each one's status becomes, who gets which letter, and one fully rendered recipient preview — and changes nothing. It returns a `plan_fingerprint`, and that fingerprint IS the confirmation: `apply_decisions` will not act without it, and refuses it if the pile moved underneath. Select either explicit `ids` or a `filter`, and prefer the filter for a whole wave so the server, not a page of results, decides the set. SHOW THIS PLAN TO A HUMAN AND GET THEIR ANSWER BEFORE CALLING apply_decisions. Acceptance and rejection letters are the moment a conference becomes real to the people who applied to it; they are not an agent's to send unasked.",
    inputSchema: {
      type: "object",
      properties: {
        event_id: eventIdArgument,
        action: { type: "string", enum: ["accept", "reject", "waitlist", "withdraw"], description: "What would be applied to every selected proposal." },
        ids: { type: "array", items: { type: "string" }, description: "Explicit submission ids. Use this OR `filter`, not both." },
        filter: {
          type: "object",
          description: "Server-side selection using the `list_submissions` filter vocabulary. Everything matching is selected, not just the current page.",
          properties: submissionFilterProperties,
          additionalProperties: false,
        },
        feedback_md: { type: "string", description: "Feedback included in the letter, in Markdown. For a rejection, this is the kind part." },
        wave_id: { type: "string", description: "The acceptance wave to file these under." },
        confirm_published: { type: "boolean", description: "Required acknowledgement when the selection would disturb something already public." },
      },
      required: ["event_id", "action"],
      additionalProperties: false,
    },
    pathParams: { eventId: "event_id" },
    body: { fields: ["action", "feedback_md", "wave_id", "confirm_published"], selector: true },
  },
  {
    name: "apply_decisions",
    operationId: "bulkDecideSubmissions",
    title: "Apply a previewed decision",
    description:
      "Applies the decision a `decision_plan` previewed. WRITE, and the loudest one here: it changes each proposal's status, starts the acceptance cascade for the accepted, and queues a letter to every affected person. It requires the `plan_fingerprint` from that plan AND its ETag in `if_match`. A stale plan — anything decided, edited or withdrawn since you previewed — is refused with a conflict, and the cure is to re-run `decision_plan` and show the human the new one, never to retry. Only call this after a human has seen the plan and said yes. To undo: an acceptance can be reversed from the submission record, but letters already queued cannot be unsent.",
    inputSchema: {
      type: "object",
      properties: {
        event_id: eventIdArgument,
        action: { type: "string", enum: ["accept", "reject", "waitlist", "withdraw"], description: "Must match the previewed action." },
        ids: { type: "array", items: { type: "string" }, description: "Must match the previewed selection." },
        filter: { type: "object", description: "Must match the previewed selection.", properties: submissionFilterProperties, additionalProperties: false },
        plan_fingerprint: { type: "string", description: "The 64-character fingerprint from `decision_plan`." },
        if_match: { type: "string", description: "The plan's ETag, returned alongside the fingerprint." },
        feedback_md: { type: "string", description: "As previewed." },
        internal_note: { type: "string", description: "A note for the organizers, never shown to the recipient." },
        wave_id: { type: "string", description: "As previewed." },
        confirm_published: { type: "boolean", description: "As previewed." },
        idempotency_key: { type: "string", description: "Set it to make a retry of the same apply safe after a timeout." },
      },
      required: ["event_id", "action", "plan_fingerprint", "if_match"],
      additionalProperties: false,
    },
    pathParams: { eventId: "event_id" },
    body: {
      fields: ["action", "plan_fingerprint", "feedback_md", "internal_note", "wave_id", "confirm_published"],
      selector: true,
    },
    headers: { "if-match": "if_match", "idempotency-key": "idempotency_key" },
    write: true,
  },
  {
    name: "comms_audience",
    operationId: "listCommunicationAudience",
    title: "Count and list who a message would reach",
    description:
      "Resolves the same filters `list_submissions` takes into one row per person who would actually receive a message, with the total. Changes nothing and sends nothing. Call it before `send_reminder` every time: the total is the number to put in front of a human, and 'nudge everyone still owing a headshot' is a very different act at 4 people than at 400.",
    inputSchema: {
      type: "object",
      properties: {
        event_id: eventIdArgument,
        ...submissionFilterProperties,
        task_state: { type: "string", enum: ["open", "done"], description: "`open` narrows to people with work outstanding." },
        page: { type: "integer", minimum: 1 },
        per_page: { type: "integer", minimum: 1, maximum: 100 },
      },
      required: ["event_id"],
      additionalProperties: false,
    },
    pathParams: { eventId: "event_id" },
    query: ["q", "kind", "status", "track", "format", "wave", "task", "placement", "task_state", "page", "per_page"],
  },
  {
    name: "send_reminder",
    operationId: "sendCommunication",
    title: "Queue a message to a selected audience",
    description:
      "Queues one message to a selected audience — a stored template, or a subject and body you write. WRITE, and it reaches real people's inboxes. Run `comms_audience` with the same selection first and tell the human the count. Mail here is demo-safe by design: the queue and the receipts are real, and what actually leaves depends on how this deployment is configured. Set `idempotency_key` when retrying one compose after a timeout; omit it and each call is a fresh nudge. To undo: nothing already queued can be recalled.",
    inputSchema: {
      type: "object",
      properties: {
        event_id: eventIdArgument,
        template_key: { type: "string", description: "A stored template's key. Use this or subject+body." },
        subject: { type: "string", description: "For an ad-hoc message." },
        body: { type: "string", description: "For an ad-hoc message, in Markdown." },
        person_ids: { type: "array", items: { type: "string" }, description: "Explicit recipients, from `comms_audience`." },
        submission_ids: { type: "array", items: { type: "string" }, description: "Recipients derived from these proposals." },
        role: { type: "string", enum: ["speaker", "co_speaker", "moderator", "chairperson", "submitter", "sponsor_contact"], description: "Narrow to one role." },
        status: { type: "string", description: "Narrow to one pipeline status." },
        track_id: { type: "string", description: "Narrow to one track, by id." },
        task_state: { type: "string", enum: ["open", "done"], description: "Narrow to people with work outstanding, or done." },
        idempotency_key: { type: "string", description: "Durable key for retrying one compose." },
      },
      required: ["event_id"],
      additionalProperties: false,
    },
    pathParams: { eventId: "event_id" },
    body: {
      fields: ["template_key", "subject", "body"],
      selectorFields: ["person_ids", "submission_ids", "role", "status", "track_id", "task_state"],
    },
    headers: { "idempotency-key": "idempotency_key" },
    write: true,
  },
  {
    name: "place_session",
    operationId: "placeAgendaItem",
    title: "Put a session on the agenda",
    description:
      "Places one accepted session into a room at a time. WRITE. `starts_at` is epoch milliseconds; room and track ids come from `event`. The server checks the placement and refuses a real clash — a speaker in two rooms at once, a room double-booked — and that refusal is the feature, not an obstacle: work around it by choosing a different slot, never by retrying. Placing does not publish; the schedule stays private until `publish_sessions`. To undo: place it again elsewhere, or remove it from the agenda.",
    inputSchema: {
      type: "object",
      properties: {
        event_id: eventIdArgument,
        submission_id: { type: "string", description: "An accepted, schedulable session." },
        room_id: { type: "string", description: "A room id from `event`." },
        starts_at: { type: "integer", description: "Start time in epoch milliseconds." },
        duration_min: { type: "integer", description: "Length in minutes. Defaults to the format's length." },
        track_id: { type: "string", description: "A track id from `event`." },
      },
      required: ["event_id", "submission_id", "room_id", "starts_at"],
      additionalProperties: false,
    },
    pathParams: { eventId: "event_id" },
    body: { fields: ["submission_id", "room_id", "starts_at", "duration_min", "track_id"] },
    write: true,
  },
  {
    name: "publish_sessions",
    operationId: "batchPublishAgenda",
    title: "Publish scheduled sessions to the public program",
    description:
      "Makes a chosen batch of scheduled sessions public — they appear on the public agenda and are readable by the `agenda`, `session` and `speaker` tools from that moment. WRITE, and the most visible one: this is what attendees see. Every id must already be accepted, scheduled, and not yet public; anything else is refused rather than partially applied. Publishing is a deliberate choice per session, which is why there is no 'publish everything'. To undo: unpublish the session, which removes it from the public program again.",
    inputSchema: {
      type: "object",
      properties: {
        event_id: eventIdArgument,
        submission_ids: {
          type: "array",
          items: { type: "string" },
          description: "Up to 90 scheduled session ids, from `list_submissions` with status `scheduled`.",
        },
      },
      required: ["event_id", "submission_ids"],
      additionalProperties: false,
    },
    pathParams: { eventId: "event_id" },
    body: { fields: ["submission_ids"] },
    write: true,
  },
];

export const MCP_TOOLS_BY_NAME: ReadonlyMap<string, McpTool> = new Map(
  MCP_TOOLS.map((tool) => [tool.name, tool]),
);
