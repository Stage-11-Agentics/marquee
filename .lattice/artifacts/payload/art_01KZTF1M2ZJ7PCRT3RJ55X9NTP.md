Validation: PASS with browser N/A justified\n\nValidated commit: d7f41b884f238b1c13f7735a6f92245a52ea8669\n\nObserved local runtime:\n- vite v8.2.1 building marquee environment for production...
[2Ktransforming...✓ 262 modules transformed.
rendering chunks...
Using secrets defined in process.env
computing gzip size...
dist/marquee/.vite/manifest.json      0.15 kB │ gzip:   0.11 kB
dist/marquee/wrangler.json            2.81 kB │ gzip:   1.30 kB
dist/marquee/index.js             1,800.63 kB │ gzip: 414.05 kB

✓ built in 239ms
vite v8.2.1 building client environment for production...
[2Ktransforming...✓ 88 modules transformed.
rendering chunks...
computing gzip size...
dist/client/.assetsignore                0.02 kB
dist/client/index.html                   1.48 kB │ gzip:  0.79 kB
dist/client/assets/index-ByVSFggc.css  163.27 kB │ gzip: 27.57 kB
dist/client/assets/index-DFdL7oLV.js   351.77 kB │ gzip: 92.34 kB

✓ built in 127ms passed; exact-head Worker health at http://127.0.0.1:8793/health returned service=marquee, status=ok, build=d7f41b884f23.\n- Authenticated curl against the seeded local D1 returned the onboarding speaker detail with  and per-file-task ; empty owners were represented with latest=null, version_count=0, latest_source=pointer.\n- {"ts":"2026-08-12T07:47:28.422Z","level":"info","event":"http_request","schema_version":1,"build_sha":"d7f41b884f23","request_id":"4417af8d-4e39-4fdc-b195-7398491ddfb8","method":"GET","route":"/api/openapi.json","status":200,"duration_ms":5,"d1_queries":0,"d1_ms":0,"principal":"anonymous"}
{"ts":"2026-08-12T07:47:28.624Z","level":"info","event":"http_request","schema_version":1,"build_sha":"d7f41b884f23","request_id":"e26936cd-6b26-4873-815d-b8313d1c7768","method":"GET","route":"/api/docs","status":200,"duration_ms":1,"d1_queries":0,"d1_ms":0,"principal":"anonymous"}
{
  "command": "check:api",
  "status": "pass",
  "openapiVersion": "3.1",
  "documentSha256": "41647403c351a88e850acf3ae40a33c598f30e5aa5b86d3d69795e8be28a677a",
  "operations": 135,
  "signatures": [
    "DELETE /api/v1/events/{eventId}/agenda/items/{itemId} removeAgendaItem",
    "DELETE /api/v1/events/{eventId}/formats/{formatId} deleteEventFormat",
    "DELETE /api/v1/events/{eventId}/forms/{formId} deleteEventForm",
    "DELETE /api/v1/events/{eventId}/forms/{formId}/admins/{personId} removeFormAdmin",
    "DELETE /api/v1/events/{eventId}/forms/{formId}/fields/{fieldId} deleteFormField",
    "DELETE /api/v1/events/{eventId}/rounds/{roundId}/assignments/{assignmentId} removeRoundAssignment",
    "DELETE /api/v1/events/{eventId}/tracks/{trackId} deleteEventTrack",
    "DELETE /api/v1/events/{eventId}/views/{viewId} deleteSavedView",
    "DELETE /api/v1/org/tokens/{tokenId} revokeApiToken",
    "GET /api/docs getApiDocs",
    "GET /api/openapi.json getOpenApiDocument",
    "GET /api/v1/admin/reset-demo/{jobId} getDemoResetJob",
    "GET /api/v1/auth/exchange exchangeMagicLink",
    "GET /api/v1/auth/me getCurrentAuth",
    "GET /api/v1/events/{eventId} getEventSettings",
    "GET /api/v1/events/{eventId}/agenda getAgenda",
    "GET /api/v1/events/{eventId}/attachments/{attachmentId}/preview previewSubmissionAttachment",
    "GET /api/v1/events/{eventId}/board listProgramBoard",
    "GET /api/v1/events/{eventId}/committees/{committeeId}/reviewers/{personId}/tracks getReviewerTrackScopes",
    "GET /api/v1/events/{eventId}/comms/audience listCommunicationAudience",
    "GET /api/v1/events/{eventId}/dashboard getProgramDashboard",
    "GET /api/v1/events/{eventId}/delivery-health getDeliveryHealth",
    "GET /api/v1/events/{eventId}/files listConferenceFiles",
    "GET /api/v1/events/{eventId}/formats listEventFormats",
    "GET /api/v1/events/{eventId}/forms listEventForms",
    "GET /api/v1/events/{eventId}/forms/{formId} getEventForm",
    "GET /api/v1/events/{eventId}/forms/{formId}/admins listFormAdmins",
    "GET /api/v1/events/{eventId}/forms/{formId}/fields listFormFields",
    "GET /api/v1/events/{eventId}/onboarding getOnboardingBoard",
    "GET /api/v1/events/{eventId}/onboarding/speakers/{personId} getOnboardingSpeaker",
    "GET /api/v1/events/{eventId}/outbox listOutbox",
    "GET /api/v1/events/{eventId}/people/{personId}/headshot previewPersonHeadshot",
    "GET /api/v1/events/{eventId}/people/{personId}/messages listPersonMessages",
    "GET /api/v1/events/{eventId}/plans listEvaluationPlans",
    "GET /api/v1/events/{eventId}/plans/{planId} getEvaluationPlan",
    "GET /api/v1/events/{eventId}/reviewer/queue getReviewerQueueContext",
    "GET /api/v1/events/{eventId}/rounds/{roundId}/assignments listRoundAssignments",
    "GET /api/v1/events/{eventId}/rounds/{roundId}/comparisons listRoundComparisonAggregate",
    "GET /api/v1/events/{eventId}/rounds/{roundId}/comparisons/next getReviewerComparisonQueue",
    "GET /api/v1/events/{eventId}/rounds/{roundId}/export exportReviewerQueue",
    "GET /api/v1/events/{eventId}/rounds/{roundId}/queue getReviewerQueue",
    "GET /api/v1/events/{eventId}/rounds/{roundId}/submissions/{submissionId} getReviewerSubmission",
    "GET /api/v1/events/{eventId}/rounds/{roundId}/submissions/{submissionId}/files getReviewerSubmissionFiles",
    "GET /api/v1/events/{eventId}/search searchEvent",
    "GET /api/v1/events/{eventId}/submissions listEventSubmissions",
    "GET /api/v1/events/{eventId}/submissions/not-notified/summary getDecidedNotNotifiedSummary",
    "GET /api/v1/events/{eventId}/submissions/{submissionId} getSubmissionRecord",
    "GET /api/v1/events/{eventId}/submissions/{submissionId}/reversal previewSubmissionAcceptanceReversal",
    "GET /api/v1/events/{eventId}/task-templates listTaskTemplates",
    "GET /api/v1/events/{eventId}/templates listEmailTemplates",
    "GET /api/v1/events/{eventId}/tracks listEventTracks",
    "GET /api/v1/events/{eventId}/venues listVenues",
    "GET /api/v1/events/{eventId}/views listSavedViews",
    "GET /api/v1/me/co-speaker/submissions/{submissionId} getCoSpeakerSubmission",
    "GET /api/v1/me/portal getSpeakerPortal",
    "GET /api/v1/media/{key} serveMedia",
    "GET /api/v1/org/tokens listApiTokens",
    "GET /api/v1/public/agenda getPublicAgenda",
    "GET /api/v1/public/embeds/{slug} getPublicEmbed",
    "GET /api/v1/public/forms/{slug} getPublicForm",
    "GET /api/v1/public/sessions/{slug} getPublicSession",
    "GET /api/v1/public/speakers/{slug} getPublicSpeaker",
    "GET /api/v1/telemetry/diagnostics getDiagnostics",
    "PATCH /api/v1/events/{eventId} updateEventSettings",
    "PATCH /api/v1/events/{eventId}/agenda/items/{itemId} updateAgendaItem",
    "PATCH /api/v1/events/{eventId}/formats/{formatId} updateEventFormat",
    "PATCH /api/v1/events/{eventId}/forms/{formId} updateEventForm",
    "PATCH /api/v1/events/{eventId}/forms/{formId}/fields/reorder reorderFormFields",
    "PATCH /api/v1/events/{eventId}/forms/{formId}/fields/{fieldId} updateFormField",
    "PATCH /api/v1/events/{eventId}/plans/{planId} updateEvaluationPlan",
    "PATCH /api/v1/events/{eventId}/rounds/{roundId} updateEvaluationRound",
    "PATCH /api/v1/events/{eventId}/submissions/{submissionId} patchDraftSubmission",
    "PATCH /api/v1/events/{eventId}/submissions/{submissionId}/talk-editing updateSpeakerTalkEditing",
    "PATCH /api/v1/events/{eventId}/task-templates/{templateId} updateTaskTemplate",
    "PATCH /api/v1/events/{eventId}/templates/{templateId} updateEmailTemplate",
    "PATCH /api/v1/events/{eventId}/tracks/{trackId} updateEventTrack",
    "PATCH /api/v1/events/{eventId}/views/{viewId} updateSavedView",
    "PATCH /api/v1/me/co-speaker/submissions/{submissionId}/profile updateCoSpeakerSubmissionProfile",
    "PATCH /api/v1/me/profile updateSpeakerProfile",
    "PATCH /api/v1/me/submissions/{submissionId}/talk updateSpeakerTalk",
    "PATCH /api/v1/public/forms/{slug}/drafts/{token} autosavePublicFormDraft",
    "POST /api/v1/admin/reset-demo enqueueDemoReset",
    "POST /api/v1/auth/demo demoLogin",
    "POST /api/v1/auth/logout logout",
    "POST /api/v1/auth/magic-link requestMagicLink",
    "POST /api/v1/events/{eventId}/agenda/items placeAgendaItem",
    "POST /api/v1/events/{eventId}/committees createEvaluationCommittee",
    "POST /api/v1/events/{eventId}/committees/{committeeId}/reviewers addCommitteeReviewer",
    "POST /api/v1/events/{eventId}/comms/preview previewCommunication",
    "POST /api/v1/events/{eventId}/comms/send sendCommunication",
    "POST /api/v1/events/{eventId}/formats createEventFormat",
    "POST /api/v1/events/{eventId}/forms createEventForm",
    "POST /api/v1/events/{eventId}/forms/{formId}/admins addFormAdmin",
    "POST /api/v1/events/{eventId}/forms/{formId}/close closeEventForm",
    "POST /api/v1/events/{eventId}/forms/{formId}/duplicate duplicateEventForm",
    "POST /api/v1/events/{eventId}/forms/{formId}/fields createFormField",
    "POST /api/v1/events/{eventId}/forms/{formId}/publish publishEventForm",
    "POST /api/v1/events/{eventId}/forms/{formId}/reopen reopenEventForm",
    "POST /api/v1/events/{eventId}/imports createSessionizeImport",
    "POST /api/v1/events/{eventId}/imports/{importId}/mapping mapSessionizeImport",
    "POST /api/v1/events/{eventId}/imports/{importId}/run runSessionizeImport",
    "POST /api/v1/events/{eventId}/imports/{importId}/undo undoSessionizeImport",
    "POST /api/v1/events/{eventId}/plans createEvaluationPlan",
    "POST /api/v1/events/{eventId}/plans/{planId}/rounds createEvaluationRound",
    "POST /api/v1/events/{eventId}/rounds/{roundId}/assignments distributeEvaluationAssignments",
    "POST /api/v1/events/{eventId}/rounds/{roundId}/comparisons writeReviewerComparison",
    "POST /api/v1/events/{eventId}/rounds/{roundId}/promote promoteEvaluationSubmissions",
    "POST /api/v1/events/{eventId}/rounds/{roundId}/submissions/{submissionId}/evaluations writeReviewerEvaluation",
    "POST /api/v1/events/{eventId}/submissions createAdminSubmission",
    "POST /api/v1/events/{eventId}/submissions/bulk bulkDecideSubmissions",
    "POST /api/v1/events/{eventId}/submissions/not-notified/notify notifyDecidedSubmissions",
    "POST /api/v1/events/{eventId}/submissions/{submissionId}/decision decideSubmission",
    "POST /api/v1/events/{eventId}/submissions/{submissionId}/invites sendSubmissionCalendarInvites",
    "POST /api/v1/events/{eventId}/submissions/{submissionId}/publish publishSubmission",
    "POST /api/v1/events/{eventId}/submissions/{submissionId}/reversal reverseSubmissionAcceptance",
    "POST /api/v1/events/{eventId}/submissions/{submissionId}/schedule scheduleSubmission",
    "POST /api/v1/events/{eventId}/templates createEmailTemplate",
    "POST /api/v1/events/{eventId}/tracks createEventTrack",
    "POST /api/v1/events/{eventId}/views createSavedView",
    "POST /api/v1/me/participations/{participationId}/confirm confirmSpeakerParticipation",
    "POST /api/v1/me/participations/{participationId}/decline declineSpeakerParticipation",
    "POST /api/v1/me/tasks/{taskId}/complete completeSpeakerTask",
    "POST /api/v1/me/uploads/sign signTaskUpload",
    "POST /api/v1/me/uploads/{id}/complete completeTaskUpload",
    "POST /api/v1/org/tokens createApiToken",
    "POST /api/v1/public/forms/{slug}/drafts createPublicFormDraft",
    "POST /api/v1/public/forms/{slug}/submissions submitPublicForm",
    "POST /api/v1/public/uploads/sign signPublicUpload",
    "POST /api/v1/public/uploads/{id}/complete completePublicUpload",
    "POST /api/v1/telemetry/client-errors postClientErrorReport",
    "PUT /api/v1/events/{eventId}/agenda/settings updateAgendaSettings",
    "PUT /api/v1/events/{eventId}/committees/{committeeId}/reviewers/{personId}/tracks replaceReviewerTrackScopes",
    "PUT /api/v1/events/{eventId}/rounds/{roundId}/criteria replaceEvaluationCriteria",
    "PUT /api/v1/events/{eventId}/venues saveVenues",
    "PUT /api/v1/uploads/local/{id} putLocalUpload"
  ],
  "halves": {
    "servedJsonAndRenderedDocs": "live",
    "cliRegistry": "checked"
  },
  "allowlist": {
    "spec4_2": [
      "/i/{uid}.ics",
      "/agenda.json",
      "/api/v1/public/agenda.ics"
    ],
    "meta": [
      "/api/openapi.json",
      "/api/docs"
    ]
  },
  "notices": [],
  "findings": [],
  "notCoveredHere": "Full-loop network-recorded traffic parity (every captured non-GET request present in the schema) is MRQ-9.",
  "report": "/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-112-speaker-files/artifacts/checks/api.json"
} passed with 135 operations, served docs live, CLI registry checked, findings=[] (including inherited MRQ-115 files route).\n\nTests and static checks:\n- : pass.\n- ✔ CONTRACT · MRQ-93 keeps generic acknowledgement separate from the two subject-bearing templates (1.000084ms)
✔ CONTRACT · MRQ-93 reuses the existing talk and profile write paths (0.296875ms)
✔ CONTRACT · MRQ-93 reserves the specialized task subject space and returns template identity (0.441208ms)
ℹ tests 3
ℹ suites 0
ℹ pass 3
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 112.50775: 3 passed.\n- Targeted Vitest: file-answer-display 9 passed; portal 18 passed including SPK-10 speaker-record file histories; portal-subject-tasks 4 passed.\n- : pass.\n\nBrowser evidence:\n- N/A, justified: c11 embedded browser surface:453 was opened against the local Worker, but get-url/goto/snapshot each hit the c11 socket timeout (10s) under the shared fleet load. No production domain, credentials, or external state was used; local HTTP/API and rendered build were exercised instead.