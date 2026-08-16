# MRQ-237 runtime withholding transcript

- Captured: 2026-08-16T20:14:31Z
- Repository head served: `5aff4b1620ee57072c2c23108b2bde948fb98f78`
- Server: local Vite Worker at `http://127.0.0.1:8788` (8787 was already occupied)
- Scope: read-only GETs plus one publish request whose expected result is a no-op refusal

The `/health` response binds this transcript to the frozen repair head. The organizer
requests used the demo organizer session obtained immediately before the transcript;
the public agenda request was anonymous.

## 1. Withheld row is absent publicly and named privately

```console
$ curl -sS http://127.0.0.1:8788/health
{"service":"marquee","status":"ok","build":"5aff4b1620ee","built_at":"2026-08-16T20:14:02.651Z"}

$ curl -sS -c /tmp/mrq-237-cookies.txt -H 'content-type: application/json' -d '{"role":"organizer"}' http://127.0.0.1:8788/api/v1/auth/demo
{"ok":true,"role":"organizer","event_id":"evt_aie-ny-2026","person":{"id":"per_aie-program-committee","name":"AIE Program Committee"}}

$ curl -sS -b /tmp/mrq-237-cookies.txt 'http://127.0.0.1:8788/api/v1/events/evt_aie-ny-2026/agenda' | jq '.publication.candidates[] | select(.submission_id == "sub_agent-eng") | {submission_id,title,classification,primary_reason_code,reason_codes}'
{"submission_id":"sub_agent-eng","title":"Why Agent Engineering","classification":"ACCEPTED_UNSCHEDULED","primary_reason_code":"MISSING_AGENDA_ITEM","reason_codes":["MISSING_AGENDA_ITEM"]}

$ curl -sS 'http://127.0.0.1:8788/api/v1/public/agenda?event=aie-nyc-2026' | jq '{public_session_count:(.sessions|length),withheld_id_present:([.sessions[].submission_id] | index("sub_agent-eng") != null),withheld_title_present:([.sessions[].title] | index("Why Agent Engineering") != null)}'
{"public_session_count":14,"withheld_id_present":false,"withheld_title_present":false}
```

The same row is therefore named as `MISSING_AGENDA_ITEM` to the organizer and absent
from the anonymous public agenda.

## 2. Dashboard gauges and clickthrough lists agree

```console
$ curl -sS -b /tmp/mrq-237-cookies.txt 'http://127.0.0.1:8788/api/v1/events/evt_aie-ny-2026/dashboard' | jq '[.metrics[] | select(.id == "not_yet_public" or .id == "live_on_site") | {id,count,href}]'
[
  {"id":"not_yet_public","count":2,"href":"/submissions?kind=session&status=not_yet_public"},
  {"id":"live_on_site","count":14,"href":"/submissions?kind=session&status=live_on_site"}
]

$ curl -sS -b /tmp/mrq-237-cookies.txt 'http://127.0.0.1:8788/api/v1/events/evt_aie-ny-2026/submissions?kind=session&status=not_yet_public&per_page=100' | jq '{clickthrough:"not_yet_public",total}'
{"clickthrough":"not_yet_public","total":2}

$ curl -sS -b /tmp/mrq-237-cookies.txt 'http://127.0.0.1:8788/api/v1/events/evt_aie-ny-2026/submissions?kind=session&status=live_on_site&per_page=100' | jq '{clickthrough:"live_on_site",total}'
{"clickthrough":"live_on_site","total":14}
```

Both dashboard counts equal the totals returned by their named clickthrough routes:
`2/2` not-yet-public and `14/14` live-on-site.

## 3. Re-publishing a live row is a 409 no-op

```console
$ curl -sS -i -b /tmp/mrq-237-cookies.txt -X POST 'http://127.0.0.1:8788/api/v1/events/evt_aie-ny-2026/submissions/sub_how-do-you-know-your-agent-works/publish'
HTTP/1.1 409 Conflict
content-type: application/json

{"message":"Already live — nothing changed","effect":"no_op","reason_code":"ALREADY_PUBLISHED","notice":"Already live — nothing changed"}

$ curl -sS -b /tmp/mrq-237-cookies.txt 'http://127.0.0.1:8788/api/v1/events/evt_aie-ny-2026/submissions/sub_how-do-you-know-your-agent-works' | jq '{classification:.publication.classification,reason_codes:.publication.reason_codes,is_published:.publication.is_published}'
{"classification":"PUBLIC_LIVE","reason_codes":["ALREADY_PUBLISHED"],"is_published":true}
```

No publication state changed: the already-live row remained `PUBLIC_LIVE`, and the
mutation returned the named `ALREADY_PUBLISHED` no-op refusal.
