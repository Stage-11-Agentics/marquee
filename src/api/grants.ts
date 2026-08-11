/**
 * The fixed scoped-token grant enum (Amendment 7 / AC-242 semantics).
 * Token creation accepts exactly these; effective authority is the
 * intersection of grants and issuer membership.
 */
export const API_GRANTS = [
  "program:read",
  "program:write",
  "review:write",
  "speaker:write",
  "agenda:write",
  "comms:send",
  "mirror:write",
] as const;

export type ApiGrant = (typeof API_GRANTS)[number];

export const apiGrantSchemaValues: [ApiGrant, ...ApiGrant[]] = [
  "program:read",
  "program:write",
  "review:write",
  "speaker:write",
  "agenda:write",
  "comms:send",
  "mirror:write",
];
