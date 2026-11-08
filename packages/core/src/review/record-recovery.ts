import { z } from "zod";
import { bookIdSchema, hashSchema } from "./contract";
import { decodeReviewRecord, recordIdSchema } from "./record-format";
import { canonicalJsonText } from "./record-json";
import { reviewWireSnapshotSchema } from "./record-intent";
import { validateReaderProfile } from "./profiles";

export const reviewGroupSchema = z.strictObject({
  bookId: bookIdSchema, id: recordIdSchema, groupId: recordIdSchema.nullable(),
  report: reviewWireSnapshotSchema.nullable(), dispositions: reviewWireSnapshotSchema.nullable(),
  dependencyReport: reviewWireSnapshotSchema.nullable()
});
export const reviewInspectionSchema = z.strictObject({ ...reviewGroupSchema.shape, hash: hashSchema, token: recordIdSchema });
export const reviewConfirmationSchema = z.strictObject({ id: recordIdSchema, groupId: recordIdSchema.nullable(), hash: hashSchema, token: recordIdSchema });
export const reviewTrashListSchema = z.strictObject({ bookId: bookIdSchema, offset: z.number().int().min(0), total: z.number().int().min(0),
  groups: z.array(z.strictObject({ groupId: z.string().max(255), available: z.boolean() })).max(50) });
export type ReviewGroup = z.infer<typeof reviewGroupSchema>;
export type ReviewInspection = z.infer<typeof reviewInspectionSchema>;
export type ReviewConfirmation = z.infer<typeof reviewConfirmationSchema>;
export type ReviewTrashList = z.infer<typeof reviewTrashListSchema>;
export type ReviewMoveReceipt = { status: "trashed" | "restored"; inspection: ReviewInspection; destinationGroupId: string | null };

export async function reviewGroupHash(group: ReviewGroup, sha256: (bytes: Uint8Array) => Promise<string>): Promise<string> {
  const value = reviewGroupSchema.parse(group);
  return sha256(new TextEncoder().encode(canonicalJsonText({ bookId: value.bookId, id: value.id, groupId: value.groupId,
    report: value.report?.hash ?? null, dispositions: value.dispositions?.hash ?? null, dependencyReport: value.dependencyReport?.hash ?? null })));
}

/** Both transport edges independently verify complete group content and dependent history. */
export async function validateReviewGroup(group: ReviewGroup, sha256: (bytes: Uint8Array) => Promise<string>): Promise<void> {
  const decode = async <K extends "review-report" | "review-dispositions">(wire: NonNullable<ReviewGroup["report"]>, kind: K) => {
    const bytes = new TextEncoder().encode(wire.rawJson);
    const decoded = decodeReviewRecord(bytes, { kind, bookId: group.bookId });
    if (decoded.record.id !== group.id || await sha256(bytes) !== wire.hash) throw new Error("Foreign recovery record.");
    return decoded.record;
  };
  if ((!group.report && !group.dispositions) || (group.report && group.dependencyReport) || (!group.report && (!group.groupId || !group.dependencyReport))) throw new Error("Incomplete recovery group.");
  const reportWire = group.report ?? group.dependencyReport;
  if (!reportWire) throw new Error("Missing recovery report.");
  const report = await decode(reportWire, "review-report");
  await validateReaderProfile(report.profile);
  if (group.dispositions) {
    const dispositions = await decode(group.dispositions, "review-dispositions");
    if (dispositions.report.hash !== reportWire.hash || dispositions.report.completedAt !== report.run.completedAt ||
      dispositions.dispositions.some((entry) => !report.findings.some((finding) => finding.findingId === entry.findingId))) throw new Error("Foreign recovery dispositions.");
  }
}
