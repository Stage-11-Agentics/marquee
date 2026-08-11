# MRQ-64: Arrival instructions — portal location card, place merge fields, ICS GEO

BUILDPLAN M-59 · ACs AC-260 – AC-262 · SPEC Amendment 14 · US-79.

The post-acceptance answer neither Sessionize nor Sessionboard gives.

1. Speaker-portal location card: room, building, street address, entrance note, and a leave-by computed from that speaker's OWN previous session that day — falling back to the primary building when they have none. Degrade honestly when the session is unscheduled or its venue has no pin; state the absence rather than implying a location.

2. Comms place merge fields: {{session.room}}, {{session.building}}, {{session.address}}, {{session.accessNote}}, {{session.leaveBy}}. Resolve per recipient in preview AND delivered mail, byte-identical. Insertable field reference in the editor. Unknown fields pass through intact rather than blanking. Email is the surface speakers actually read — this is the highest value-to-effort item in the amendment.

3. ICS: real LOCATION (room, building, street address, ICS-escaped for , ; and backslash) plus GEO:lat;lng when pinned, omitted when not. The current invite ships a bare room name a phone cannot navigate to. Leave METHOD:REQUEST, UID, SEQUENCE, and cancellation semantics from AC-95 – AC-97 untouched.

Binding prototype v1.7 — drive the portal and comms screens there first.
