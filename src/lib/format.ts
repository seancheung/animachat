/**
 * Auto-formatting of the user's own messages into the roleplay convention:
 *   *asterisks* = actions/descriptions, "double quotes" = spoken words, the rest narration.
 *
 * Typing quotes around every line is tedious, so an unmarked line is taken as speech and
 * quoted on the way into the timeline — the AI then reads a properly formatted message
 * instead of guessing. Deliberately conservative: it never touches a run that already
 * carries marks of its own, so an inline quotation ('He said "hello" to me') survives.
 */

const CURLY = /[“”]/;
const ANY_QUOTE = /["“”]/;
/** an *action* span, or an unpaired asterisk we must not second-guess */
const ACTION_SPLIT = /(\*[^*\n]+\*)/g;
const HAS_WORD = /[\p{L}\p{N}]/u;

/** Wrap the unmarked, unquoted runs of a user message in quotes. Idempotent. */
export function autoFormatUserText(text: string): string {
  // match the message's own quote style — curly in, curly out
  const curly = CURLY.test(text);
  const open = curly ? "“" : '"';
  const close = curly ? "”" : '"';
  // line by line: a quote may never span a newline (the renderer won't match it either)
  return text
    .split("\n")
    .map((line) => formatLine(line, open, close))
    .join("\n");
}

function formatLine(line: string, open: string, close: string): string {
  if (!line.trim()) return line;
  return line
    .split(ACTION_SPLIT)
    .map((run) => {
      // leave alone: *actions*, anything already quoted, stray asterisks (an unfinished
      // action is the user's business), and runs with nothing to say (punctuation, spaces)
      if (run.includes("*") || ANY_QUOTE.test(run) || !HAS_WORD.test(run)) return run;
      const [, lead, body, trail] = run.match(/^(\s*)([\s\S]*?)(\s*)$/)!;
      return `${lead}${open}${body}${close}${trail}`;
    })
    .join("");
}
