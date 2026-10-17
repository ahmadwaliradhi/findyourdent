// Fix before submit (spec 03): turns Moderation's flagged spans into what the author
// reads, sentence by sentence. Pure, so the form and its tests share it.
import type { FlaggedSpan, ModerationRuleCode } from "@findyourdent/contracts";

export interface FixIssue {
  /** The sentence as the author wrote it. */
  sentence: string;
  /** The flagged parts, as offsets into `sentence`. */
  marks: Array<{ start: number; end: number }>;
  ruleCodes: ModerationRuleCode[];
}

/** A sentence ends after `.`, `!`, `?` or `…` followed by a space, or at a line break. */
const SENTENCE_END = /[.!?…]+(?=\s|$)|\n/g;

/** [start, end) of every sentence, leading and trailing whitespace left out. */
function sentences(text: string): Array<{ start: number; end: number }> {
  const found: Array<{ start: number; end: number }> = [];
  let from = 0;
  const push = (to: number) => {
    const raw = text.slice(from, to);
    const start = from + (raw.length - raw.trimStart().length);
    const end = to - (raw.length - raw.trimEnd().length);
    if (end > start) found.push({ start, end });
  };
  for (const match of text.matchAll(SENTENCE_END)) {
    const to = match[0] === "\n" ? match.index : match.index + match[0].length;
    push(to);
    from = match.index + match[0].length;
  }
  push(text.length);
  return found;
}

/**
 * One issue per sentence holding a flagged span, in text order. Offsets are UTF-16,
 * as JavaScript strings index; a span whose text is not at its offsets is skipped.
 */
export function issuesBySentence(text: string, spans: readonly FlaggedSpan[]): FixIssue[] {
  const valid = spans
    .filter((span) => span.end > span.start && text.slice(span.start, span.end) === span.text)
    .sort((a, b) => a.start - b.start);
  const issues: FixIssue[] = [];
  for (const sentence of sentences(text)) {
    const inside = valid.filter((span) => span.start < sentence.end && span.end > sentence.start);
    if (inside.length === 0) continue;
    issues.push({
      sentence: text.slice(sentence.start, sentence.end),
      marks: inside.map((span) => ({
        start: Math.max(span.start, sentence.start) - sentence.start,
        end: Math.min(span.end, sentence.end) - sentence.start,
      })),
      ruleCodes: [...new Set(inside.map((span) => span.ruleCode))],
    });
  }
  return issues;
}

/** Rules that fired with no span pointing at them, such as R6 resting on the typed name. */
export function rulesWithoutSpan(
  ruleCodes: readonly ModerationRuleCode[],
  spans: readonly FlaggedSpan[],
): ModerationRuleCode[] {
  const spanned = new Set(spans.map((span) => span.ruleCode));
  return ruleCodes.filter((code) => !spanned.has(code));
}
