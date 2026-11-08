import { z } from "zod";
import { hashSchema, idSchema } from "./contract";
import { applyDispositionEvent, decodeReviewRecord, dispositionStateSchema, encodeReviewRecord, newDispositionsRecord, recordTimestampSchema } from "./record-format";
import { canonicalJsonText, REVIEW_RECORD_BYTES } from "./record-json";
import { ReviewRecordError } from "./record-error";
import { validateReaderProfile } from "./profiles";

export const reviewWireSnapshotSchema = z.strictObject({ hash: hashSchema, rawJson: z.string().max(REVIEW_RECORD_BYTES) });
export type ReviewWireSnapshot = z.infer<typeof reviewWireSnapshotSchema>;
export const dispositionIntentSchema = z.strictObject({
  report: reviewWireSnapshotSchema,
  base: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("absent") }),
    z.strictObject({ kind: z.literal("sha256"), value: hashSchema, revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER), rawJson: z.string().max(REVIEW_RECORD_BYTES) })
  ]),
  findingId: idSchema, state: dispositionStateSchema, note: z.string().max(4000).optional()
});
export type DispositionIntent = z.infer<typeof dispositionIntentSchema>;
const encoder = new TextEncoder();

/** Shared host/receiver reconstruction. Never merges a stale author's history with current state. */
export async function prepareDispositionIntent(bookId: string, id: string, input: DispositionIntent, at: string, sha256: (bytes: Uint8Array) => Promise<string>) {
  const intent = dispositionIntentSchema.parse(JSON.parse(canonicalJsonText(input, { maxDepth: 70 })));
  recordTimestampSchema.parse(at);
  const reportBytes = encoder.encode(intent.report.rawJson);
  const report = decodeReviewRecord(reportBytes, { kind: "review-report", bookId });
  await validateReaderProfile(report.record.profile);
  if (report.record.id !== id || await sha256(reportBytes) !== intent.report.hash || !report.record.findings.some((f) => f.findingId === intent.findingId)) {
    throw new ReviewRecordError("invalid", "The inspected report or finding does not verify. Nothing was written.");
  }
  const baseline = intent.base.kind === "absent" ? null : decodeReviewRecord(encoder.encode(intent.base.rawJson), { kind: "review-dispositions", bookId });
  if (baseline && intent.base.kind === "sha256" && (await sha256(baseline.bytes) !== intent.base.value || baseline.record.revision !== intent.base.revision || baseline.record.id !== id ||
    baseline.record.report.hash !== intent.report.hash || baseline.record.report.completedAt !== report.record.run.completedAt ||
    baseline.record.dispositions.some((entry) => !report.record.findings.some((finding) => finding.findingId === entry.findingId)))) {
    throw new ReviewRecordError("invalid", "The inspected disposition baseline does not verify. Nothing was written.");
  }
  const applied = applyDispositionEvent(baseline?.record ?? newDispositionsRecord({ bookId, runId: id, reportHash: intent.report.hash, completedAt: report.record.run.completedAt, at }), {
    findingId: intent.findingId, state: intent.state, at, ...(intent.note === undefined ? {} : { note: intent.note })
  });
  const value = applied.changed && intent.base.kind === "sha256" ? { ...applied.record, revision: intent.base.revision + 1,
    base: { kind: "sha256" as const, value: intent.base.value, revision: intent.base.revision } } : applied.record;
  const bytes = encodeReviewRecord("review-dispositions", value);
  return { intent, report, baseline, value, bytes, changed: applied.changed };
}
