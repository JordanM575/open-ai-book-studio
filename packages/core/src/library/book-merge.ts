/**
 * Field-level merging for `book.json`.
 *
 * Several writers share one book file: the Story Bible, the settings, the agent's book tools, the
 * `bookwriter` toolkit and other devices through a sync folder. An editor therefore sends only what
 * it changed, each with the value it started from, and the main process merges that onto a fresh
 * read of the file. Nothing here touches storage; `LibraryService` reads, merges and commits.
 */

type Json = Record<string, unknown>;

/** Equal as JSON values: key order does not matter, and a key holding `undefined` is a missing key. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b)) return false;
  const left = a as Json;
  const right = b as Json;
  return [...new Set([...Object.keys(left), ...Object.keys(right)])].every((key) => sameValue(left[key], right[key]));
}

/** For each field in `next` that differs from `book`, the value it started from and the value wanted. */
export function bookChanges<T extends object>(book: T, next: Partial<T>): { [K in keyof T]?: { from: T[K]; to: T[K] } } {
  const changes: Json = {};
  for (const [key, to] of Object.entries(next)) {
    const from = (book as Json)[key];
    if (!sameValue(from, to)) changes[key] = { from, to };
  }
  return changes as { [K in keyof T]?: { from: T[K]; to: T[K] } };
}

const isObject = (value: unknown): value is Json => !!value && typeof value === "object" && !Array.isArray(value);

function put(target: Json, key: string, value: unknown): void {
  if (value === undefined) delete target[key];
  else target[key] = value;
}

/** Lists of records that merge one record at a time, by `id`. Every other array is one value. */
const RECORD_LISTS = new Set(["characters", "memories"]);

/** A record list by id, or null when it is not a list or two records share an id. */
function records(list: unknown): Map<string, unknown> | null {
  if (!Array.isArray(list)) return null;
  const byId = new Map(list.map((record) => [String((record as Json | null)?.id), record as unknown]));
  return byId.size === list.length ? byId : null;
}

export interface Merged {
  /** What the file should hold: the other writer's value wherever both changed the same thing. */
  value: unknown;
  /** The editor's own version: its value wherever both changed the same thing. */
  mine: unknown;
}

/**
 * Merge one value three ways: `base` is what the editor started from, `mine` what it wants and
 * `theirs` what the file holds now. A part only one side changed takes that side. A part both
 * changed differently is an overlap: its path is added to `overlaps`, the file keeps theirs and the
 * editor's version keeps mine. Objects merge per key, `characters` and `memories` per record id. A
 * record's `updatedAt` takes the later stamp, because it changes with every edit of the record.
 */
export function mergeValue(base: unknown, mine: unknown, theirs: unknown, path: string[], overlaps: string[]): Merged {
  if (sameValue(mine, base) || sameValue(mine, theirs)) return { value: theirs, mine: theirs };
  if (sameValue(theirs, base)) return { value: mine, mine };
  if (isObject(base) && isObject(mine) && isObject(theirs)) {
    const value = { ...theirs };
    const copy = { ...theirs };
    for (const key of new Set([...Object.keys(base), ...Object.keys(mine), ...Object.keys(theirs)])) {
      const merged = mergeValue(base[key], mine[key], theirs[key], [...path, key], overlaps);
      put(value, key, merged.value);
      put(copy, key, merged.mine);
    }
    return { value, mine: copy };
  }
  const lists = RECORD_LISTS.has(path.join(".")) ? [base, mine, theirs].map(records) : [];
  // Only a list whose ids are unique merges record by record; otherwise it is one value.
  const [old, wanted, current] = lists;
  if (old && wanted && current) {
    const value: unknown[] = [];
    const copy: unknown[] = [];
    // The file's order first, then what only the editor added, in its order.
    for (const id of new Set([...current.keys(), ...wanted.keys()])) {
      const merged = mergeValue(old.get(id), wanted.get(id), current.get(id), [...path, id], overlaps);
      if (merged.value !== undefined) value.push(merged.value);
      if (merged.mine !== undefined) copy.push(merged.mine);
    }
    return { value, mine: copy };
  }
  if (path.at(-1) === "updatedAt" && typeof mine === "string" && typeof theirs === "string") {
    const later = mine > theirs ? mine : theirs;
    return { value: later, mine: later };
  }
  overlaps.push(path.join("."));
  return { value: theirs, mine };
}

/**
 * The file to write: `raw` as read, with only the parts where `next` differs from `fresh` (the parsed
 * read) replaced. A field nobody changed keeps its bytes' meaning exactly as another writer left
 * it — its shape, its unknown keys and its missing defaults.
 */
export function rewrite(raw: unknown, fresh: unknown, next: unknown): unknown {
  if (sameValue(fresh, next)) return raw;
  if (!isObject(raw) || !isObject(fresh) || !isObject(next)) return next;
  const out = { ...raw };
  for (const key of new Set([...Object.keys(fresh), ...Object.keys(next)])) {
    put(out, key, rewrite(raw[key], fresh[key], next[key]));
  }
  return out;
}
