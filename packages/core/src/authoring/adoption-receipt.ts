import { sameOwner, validateOwner, validateReference, type Owner, type Reference } from './contracts';
import { copyValue, digest, freeze, id, integer, requireValue, type Immutable } from './value';

/**
 * Recorded adoption receipts for guided autonomous authoring (037 FR-017 /
 * ADR 0019, serving 037 T032 adoption-based cadence).
 *
 * A receipt is the recorded state that distinguishes a coordinator-adopted
 * chapter from any other saved chapter. Only a future Library publisher
 * creates receipts; this leaf validates, freezes and counts them. It checks
 * that a record is well-formed, exact and attributable — never that the
 * adoption was wise. It reads no prose, takes no clock, and counts nothing
 * besides adopted chapters.
 *
 * Candidate identity follows the existing contracts: the exact candidate is
 * an `artifact` reference (its `hash` is the artifact body SHA-256 and its
 * `revision` the artifact revision), adopted into `chapterId`; the published
 * chapter is bound by `resultVersion`/`resultHash`, the names the effect
 * receipt uses for the saved chapter's version and raw hash. The grant is a
 * `grant` reference (policy agreement lineage) and the direction a
 * `direction` reference; both are validated by the authoring contracts' own
 * `validateReference` against the receipt owner. No `Reference<'grant'>`
 * kind existed before this slice; adding it is the only contracts change.
 */

export const ADOPTION_RECEIPT_SCHEMA_VERSION = 1 as const;
export const ADOPTION_RECEIPT_KIND = 'adoption-receipt' as const;

export const ADOPTION_RECEIPT_LIMITS = Object.freeze({
  recordBytes: 262_144,
  maxReceiptsPerRun: 10_000,
  maxListPage: 256,
  maxSequence: 1_000_000,
});

export interface AdoptionReceipt {
  schemaVersion: 1;
  kind: 'adoption-receipt';
  id: string;
  owner: Owner;
  chapterId: string;
  candidate: Reference<'artifact'>;
  resultVersion: number;
  resultHash: string;
  grant: Reference<'grant'>;
  direction: Reference<'direction'>;
  /** Caller-supplied monotonic adoption sequence; the publisher owns ordering. */
  sequence: number;
  /** Caller-supplied adoption instant (UTC, millisecond precision). No clock is read here. */
  adoptedAt: string;
}

function adoptedAtValue(value: unknown): string {
  requireValue(typeof value === 'string', 'invalid-timestamp');
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})Z$/.exec(value);
  requireValue(match, 'invalid-timestamp');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;
  requireValue(month >= 1 && month <= 12 && day >= 1 && day <= days &&
    Number(match[4]) <= 23 && Number(match[5]) <= 59 && Number(match[6]) <= 59,
  'invalid-timestamp');
  return value;
}

/** Validate one receipt exactly; unknown versions and shapes refuse without coercion. */
export function validateAdoptionReceipt(input: AdoptionReceipt): Immutable<AdoptionReceipt> {
  const receipt = copyValue(input, ADOPTION_RECEIPT_LIMITS.recordBytes);
  requireValue(receipt !== null && typeof receipt === 'object' && !Array.isArray(receipt),
    'invalid-adoption-receipt');
  requireValue(typeof receipt.schemaVersion === 'number' &&
    Number.isSafeInteger(receipt.schemaVersion), 'invalid-adoption-receipt');
  requireValue(receipt.schemaVersion === ADOPTION_RECEIPT_SCHEMA_VERSION, 'unsupported-version');
  requireValue(receipt.kind === ADOPTION_RECEIPT_KIND, 'invalid-adoption-receipt');
  id(receipt.id);
  requireValue(receipt.id.startsWith('adoption_'), 'invalid-adoption-receipt');
  validateOwner(receipt.owner);
  id(receipt.chapterId);
  validateReference(receipt.candidate, 'artifact', receipt.owner);
  integer(receipt.candidate.revision, 1);
  integer(receipt.resultVersion, 1);
  digest(receipt.resultHash);
  validateReference(receipt.grant, 'grant', receipt.owner);
  validateReference(receipt.direction, 'direction', receipt.owner);
  integer(receipt.sequence, 1, ADOPTION_RECEIPT_LIMITS.maxSequence);
  adoptedAtValue(receipt.adoptedAt);
  return freeze(receipt);
}

export type AdoptionSinceMarker =
  | { kind: 'sequence'; sequence: number }
  | { kind: 'adoptedAt'; adoptedAt: string };

export interface AdoptionCount {
  adoptedChaptersSinceCheckin: number;
  firstAdoptedChapterOccurred: boolean;
}

function validateMarker(marker: AdoptionSinceMarker): void {
  const value = copyValue(marker);
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value),
    'invalid-adoption-marker');
  if (value.kind === 'sequence') {
    integer(value.sequence, 0, ADOPTION_RECEIPT_LIMITS.maxSequence);
    return;
  }
  if (value.kind === 'adoptedAt') {
    adoptedAtValue(value.adoptedAt);
    return;
  }
  requireValue(false, 'invalid-adoption-marker');
}

/**
 * Count adopted chapters from validated receipts for one book/run.
 *
 * Marker semantics (exclusive): a receipt counts only when it is strictly
 * after the marker — `sequence > marker.sequence`, or `adoptedAt` later
 * than the marker instant (fixed-width UTC strings compare chronologically).
 * A receipt exactly at the marker was already counted by the check-in that
 * took the marker and is not recounted. An absent marker counts from the
 * beginning. Within the window, chapters are distinct: a re-adoption of the
 * same chapter counts once. `firstAdoptedChapterOccurred` reports whether
 * any adoption exists at all for the owner, independent of the window; the
 * caller passes it to cadence only until the first check-in is taken.
 *
 * Receipts must already validate and belong to `owner`; foreign book/run
 * receipts refuse. Nothing besides adopted chapters is counted.
 */
export function countAdoptedChapters(
  receipts: readonly AdoptionReceipt[],
  owner: Owner,
  since?: AdoptionSinceMarker | null
): Immutable<AdoptionCount> {
  validateOwner(owner);
  requireValue(Array.isArray(receipts), 'invalid-adoption-receipts');
  requireValue(receipts.length <= ADOPTION_RECEIPT_LIMITS.maxReceiptsPerRun, 'record-count');
  const validated: Immutable<AdoptionReceipt>[] = [];
  for (const receipt of receipts) {
    const checked = validateAdoptionReceipt(receipt);
    requireValue(sameOwner(checked.owner, owner), 'foreign-owner');
    validated.push(checked);
  }
  let marker: AdoptionSinceMarker | null = null;
  if (since !== undefined && since !== null) {
    validateMarker(since);
    marker = since;
  }
  const chapters = new Set<string>();
  for (const receipt of validated) {
    if (marker?.kind === 'sequence' && !(receipt.sequence > marker.sequence)) continue;
    if (marker?.kind === 'adoptedAt' && !(receipt.adoptedAt > marker.adoptedAt)) continue;
    chapters.add(receipt.chapterId);
  }
  return freeze({
    adoptedChaptersSinceCheckin: chapters.size,
    firstAdoptedChapterOccurred: validated.length > 0
  });
}
