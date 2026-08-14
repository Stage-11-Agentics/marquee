/** The confirmation is exact, case-sensitive, with harmless surrounding space trimmed. */
export function conferenceNameMatches(input: string, conferenceName: string): boolean {
  return input.trim() === conferenceName;
}
