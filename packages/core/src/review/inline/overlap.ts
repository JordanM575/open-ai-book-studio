/** A single already-verified occurrence. Discontinuous evidence has distinct spanIds. */
export interface InlineSpan {
  readonly runId: string;
  readonly findingId: string;
  readonly evidenceId: string;
  readonly spanId: string;
  readonly category: string;
  readonly from: number;
  readonly to: number;
  readonly quote: string;
}

export interface OverlapSegment {
  readonly from: number;
  readonly to: number;
  readonly members: readonly InlineSpan[];
}

export interface OverlapIndex {
  readonly spans: readonly InlineSpan[];
  readonly segments: readonly OverlapSegment[];
}

/** Tuple encoding avoids collisions, including prototype-like names and embedded delimiters. */
export function inlineSpanKey(span: InlineSpan): string {
  return JSON.stringify([span.runId, span.findingId, span.evidenceId, span.spanId]);
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function compareInlineMembers(a: InlineSpan, b: InlineSpan): number {
  return compareText(a.category, b.category) || compareText(a.runId, b.runId) ||
    compareText(a.findingId, b.findingId) || compareText(a.evidenceId, b.evidenceId) ||
    compareText(a.spanId, b.spanId);
}

/**
 * Endpoint sweep, not a quote search or a citation validator. Validated evidence enters here
 * through the host proof port. Bounds/unique identities are checked defensively for rendering.
 * O(n log n + emitted memberships); dense overlaps necessarily have large complete output.
 */
export function buildOverlapIndex(spans: readonly InlineSpan[], bodyLength: number): OverlapIndex {
  if (!Number.isSafeInteger(bodyLength) || bodyLength < 0) throw new Error("Invalid body length");
  const keys = new Set<string>();
  const owned: InlineSpan[] = [];
  for (const span of spans) {
    if (!span || !Number.isSafeInteger(span.from) || !Number.isSafeInteger(span.to) ||
      span.from < 0 || span.from >= span.to || span.to > bodyLength ||
      [span.runId, span.findingId, span.evidenceId, span.spanId, span.category].some(
        (id) => typeof id !== "string" || id.length === 0
      ) || typeof span.quote !== "string") throw new Error("Invalid inline span");
    const key = inlineSpanKey(span);
    if (keys.has(key)) throw new Error("Duplicate inline span identity");
    keys.add(key);
    owned.push(Object.freeze({
      runId: span.runId, findingId: span.findingId, evidenceId: span.evidenceId,
      spanId: span.spanId, category: span.category, from: span.from, to: span.to, quote: span.quote
    }));
  }
  // Rank once, maintaining that order through the sweep rather than sorting every segment.
  owned.sort(compareInlineMembers);
  const events = owned.flatMap((span, rank) => [
    { at: span.from, rank, start: true }, { at: span.to, rank, start: false }
  ]).sort((a, b) => a.at - b.at || Number(a.start) - Number(b.start) || a.rank - b.rank);
  let active: number[] = [];
  const segments: OverlapSegment[] = [];
  for (let i = 0; i < events.length;) {
    const at = required(events, i).at;
    const ending = new Set<number>();
    const starting: number[] = [];
    while (events[i]?.at === at) {
      const event = required(events, i++);
      if (event.start) starting.push(event.rank);
      else ending.add(event.rank);
    }
    // Batch equal endpoints: repeated splice/removal would be quadratic for equal spans.
    const remaining = active.filter((rank) => !ending.has(rank));
    active = [];
    let old = 0;
    let added = 0;
    while (old < remaining.length || added < starting.length) {
      if (added >= starting.length || (old < remaining.length && required(remaining, old) < required(starting, added))) {
        active.push(required(remaining, old++));
      } else {
        active.push(required(starting, added++));
      }
    }
    const to = events[i]?.at;
    if (to !== undefined && active.length > 0) {
      segments.push(Object.freeze({ from: at, to, members: Object.freeze(active.map((rank) => required(owned, rank))) }));
    }
  }
  return Object.freeze({
    spans: Object.freeze(owned.sort((a, b) => a.from - b.from || a.to - b.to || compareInlineMembers(a, b))),
    segments: Object.freeze(segments)
  });
}

/** Half-open lookup: the end of one span never aliases the next occurrence or a gap. */
export function overlapAt(index: OverlapIndex, offset: number): OverlapSegment | null {
  if (!Number.isSafeInteger(offset) || offset < 0) return null;
  let low = 0;
  let high = index.segments.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (required(index.segments, mid).to <= offset) low = mid + 1;
    else high = mid;
  }
  const segment = index.segments[low];
  return segment && segment.from <= offset ? segment : null;
}

function required<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error("Invalid overlap index");
  return item;
}
