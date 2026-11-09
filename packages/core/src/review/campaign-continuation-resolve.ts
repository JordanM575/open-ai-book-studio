import { inspectContinuationWire } from "./campaign-continuation-wire";
import { ContinuationTokenError, resolveContinuationTokens, type InspectedContinuationHole } from "./campaign-continuation-tokens";

/**
 * Reconstruct exact external values and verify the wire's content digest and expansion counts.
 * This remains structural inspection: other counts, unions, planner semantics, source identity,
 * report references and provenance require separate validation. It never registers a plan.
 */
export async function resolveContinuationWire(manifestBytes: Uint8Array,
  expected: { ownerBookId: string; campaignId: string },
  readSegment: (id: string) => Uint8Array | undefined | Promise<Uint8Array | undefined>,
  resolve: (hole: InspectedContinuationHole) => unknown | Promise<unknown>) {
  const wire = await inspectContinuationWire(manifestBytes, expected, readSegment);
  const stream = wire.streams.find((entry) => entry.stream === "plan");
  if (!stream) throw new ContinuationTokenError("corrupt");
  const resolved = await resolveContinuationTokens(stream.tokens, "plan", resolve);
  const counts = wire.manifest.counts as Record<string, unknown>;
  if (resolved.contentDigest !== wire.manifest.planDigest || resolved.contentBytes !== counts.resolvedPlanBytes ||
      resolved.holes !== counts.holes) throw new ContinuationTokenError("corrupt");
  const checkpoint = wire.streams.find((entry) => entry.stream === "checkpoint");
  return { status: "resolved-structural-only" as const, manifest: wire.manifest,
    untrustedPlanContent: resolved.root, checkpoint: checkpoint ? { root: checkpoint.root } : null };
}
