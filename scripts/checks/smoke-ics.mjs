import {
  commandArguments,
  inboxRowHasIcs,
  parseIcs,
  requestJson,
  runSmoke,
  smokeAssert,
  smokeContext,
  submitPublicSmoke,
  waitForInboxMessage,
} from "./inbox-smoke-lib.mjs";
import { SmokeNeedsHuman } from "./inbox-smoke-lib.mjs";

const args = commandArguments();

await runSmoke("smoke:ics", args, async () => {
  const context = smokeContext(args);
  const eventId = String(args["event-id"] ?? process.env.MARQUEE_SMOKE_EVENT_ID ?? "").trim();
  if (!eventId) throw new SmokeNeedsHuman("smoke:ics needs --event-id or MARQUEE_SMOKE_EVENT_ID so the public submission can be scheduled");
  if (Object.keys(context.auth).length === 0) {
    throw new SmokeNeedsHuman("smoke:ics needs --token/--cookie or MARQUEE_SMOKE_TOKEN/MARQUEE_SMOKE_COOKIE with program and agenda grants");
  }

  const since = new Date(Date.now() - 5_000).toISOString();
  const submission = await submitPublicSmoke(context);
  const submissionId = submission.submissionId;

  await requestJson(context.origin, `/api/v1/events/${encodeURIComponent(eventId)}/submissions/${encodeURIComponent(submissionId)}/decision`, {
    method: "POST",
    headers: context.auth,
    body: JSON.stringify({ recommendation: "approve", feedback_md: "MRQ-238 live ICS oracle" }),
  });

  const agenda = await requestJson(context.origin, `/api/v1/events/${encodeURIComponent(eventId)}/agenda`, {
    headers: context.auth,
  });
  const room = agenda?.rooms?.[0];
  smokeAssert(room?.id, "smoke:ics could not find a room in the event agenda");
  const format = agenda?.formats?.[0];
  const startsAt = Math.max(Date.now() + 60 * 60_000, Date.parse(`${agenda.event.starts_on}T10:00:00.000Z`));
  const placed = await requestJson(context.origin, `/api/v1/events/${encodeURIComponent(eventId)}/agenda/items`, {
    method: "POST",
    headers: context.auth,
    body: JSON.stringify({
      submission_id: submissionId,
      starts_at: startsAt,
      room_id: room.id,
      duration_min: format?.default_duration_min ?? 30,
    }),
  });

  const invitePath = `/api/v1/events/${encodeURIComponent(eventId)}/submissions/${encodeURIComponent(submissionId)}/invites`;
  const firstInvite = await requestJson(context.origin, invitePath, { method: "POST", headers: context.auth });
  const firstDelivery = firstInvite?.data?.[0];
  smokeAssert(firstDelivery?.uid && firstDelivery?.sequence === 0, "Calendar REQUEST did not start at sequence 0");
  const firstRow = await waitForInboxMessage(
    context,
    context.inbox.address,
    since,
    (row) => inboxRowHasIcs(row, (ics) => ics.uid === firstDelivery.uid && ics.sequence === 0 && ics.method === "REQUEST"),
    "calendar REQUEST",
  );
  const firstIcs = parseIcs(firstRow.raw_rfc822);

  const secondInvite = await requestJson(context.origin, invitePath, { method: "POST", headers: context.auth });
  const secondDelivery = secondInvite?.data?.[0];
  smokeAssert(secondDelivery?.uid === firstDelivery.uid, "Calendar reschedule changed the UID");
  smokeAssert(secondDelivery?.sequence === firstDelivery.sequence + 1, "Calendar reschedule did not increment SEQUENCE by one");
  const secondRow = await waitForInboxMessage(
    context,
    context.inbox.address,
    since,
    (row) => inboxRowHasIcs(row, (ics) => ics.uid === firstDelivery.uid && ics.sequence === 1 && ics.method === "REQUEST"),
    "calendar reschedule REQUEST",
  );
  const secondIcs = parseIcs(secondRow.raw_rfc822);

  const reversal = await requestJson(context.origin, `/api/v1/events/${encodeURIComponent(eventId)}/submissions/${encodeURIComponent(submissionId)}/reversal`, {
    method: "POST",
    headers: context.auth,
    body: JSON.stringify({ tasks: "retain", emails: "retain", calendar: "cancel", outcome: "withdrawn" }),
  });
  smokeAssert(Number(reversal?.data?.calendar_cancelled) === 1, "Acceptance reversal did not queue one calendar cancellation");
  const cancelRow = await waitForInboxMessage(
    context,
    context.inbox.address,
    since,
    (row) => inboxRowHasIcs(row, (ics) => ics.uid === firstDelivery.uid && ics.sequence === 2 && ics.method === "CANCEL"),
    "calendar CANCEL",
  );
  const cancelIcs = parseIcs(cancelRow.raw_rfc822);

  smokeAssert(firstIcs.uid === secondIcs.uid && secondIcs.uid === cancelIcs.uid, "Stored calendar messages do not share one UID");
  smokeAssert(secondIcs.sequence === firstIcs.sequence + 1, "Stored reschedule did not increment SEQUENCE by one");
  smokeAssert(cancelIcs.sequence === secondIcs.sequence + 1, "Stored cancellation did not increment SEQUENCE by one");

  return {
    run_id: context.inbox.runId,
    form: context.formSlug,
    event_id: eventId,
    generated_address: context.inbox.address,
    submission_id: submissionId,
    agenda_item_id: placed?.id ?? null,
    request: { inbox_message_id: firstRow.id, ...firstIcs },
    reschedule: { inbox_message_id: secondRow.id, ...secondIcs },
    cancel: { inbox_message_id: cancelRow.id, ...cancelIcs },
    same_uid: true,
    mechanical_oracle: "REQUEST, reschedule, and CANCEL were observed in the private inbox D1.",
    human_oracle_remaining: "Accept the REQUEST in a real calendar client and confirm the rendered event.",
  };
});
