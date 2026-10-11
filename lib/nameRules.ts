// Name validation shared by the server store and the /owner form.
//
// Deliberately free of node: imports so the client bundle can use it too —
// store.ts pulls in node:fs and must never be imported from a component.

export const NAME_MAX = 60;

/** Trim, collapse whitespace, strip control characters, bound the length.
 *  Runs on BOTH sides: the UI for a live error, the server because the
 *  projector renders whatever ends up in the store. */
export function cleanTournamentName(raw: unknown): string {
  if (typeof raw !== "string") throw new Error("Name must be text.");
  // Line breaks / tabs become a space so a wrapped paste doesn't glue words
  // together; other control characters are simply dropped.
  const s = raw
    .replace(/[\r\n\t\f\v]+/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) throw new Error("Name cannot be empty.");
  if (s.length > NAME_MAX) throw new Error(`Name must be ${NAME_MAX} characters or fewer.`);
  return s;
}
