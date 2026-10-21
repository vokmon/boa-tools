const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** Every email address in free text (comma, space, newline or CSV separated), lower-cased, unique, in order. */
export function extractEmails(text: string): string[] {
  return [...new Set((text.match(EMAIL) ?? []).map((e) => e.toLowerCase()))];
}

/** Parses a typed or passed list; throws when it contains no email address. */
export function parseEmailList(text: string): string[] {
  const emails = extractEmails(text);
  if (emails.length === 0) throw new Error("no email address found");
  return emails;
}
