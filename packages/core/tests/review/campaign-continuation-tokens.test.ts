import { describe, expect, test } from "bun:test";
import { aggregateCampaignCoverage } from "../../src/review/campaign-coverage";
import { requireCampaignPlan, type CampaignPlan } from "../../src/review/campaign-planner";
import { canonicalJson } from "../../src/review/contract";
import {
  ContinuationTokenError, CONTINUATION_TOKEN_LIMITS, inspectContinuationTokens, resolveContinuationTokens,
  tokenizeCampaignPlan, tokenizeCheckpointValue, type ContinuationPath, type ContinuationToken
} from "../../src/review/campaign-continuation-tokens";
import { canonicalJsonText } from "../../src/review/record-json";
import { campaignInput, planned, withSynthesis } from "./campaign-fixtures";

function atPath(root: unknown, path: ContinuationPath): unknown {
  let current = root;
  for (const key of path) {
    if (current === null || typeof current !== "object") throw new Error("Bad fixture path");
    const property = Object.getOwnPropertyDescriptor(current, String(key));
    if (!property || !("value" in property)) throw new Error("Missing fixture path");
    current = property.value;
  }
  return current;
}

function refusalCode(error: unknown): string {
  return error instanceof ContinuationTokenError ? error.code : (error as Error).name;
}

async function refusal(run: () => Promise<unknown>): Promise<string> {
  try { await run(); return "accepted"; } catch (error) { return refusalCode(error); }
}

describe("conditional continuation token grammar", () => {
  test("externalizes all four exact locations, resolves every planner field, and never grants planner provenance", async () => {
    const input = withSynthesis(await campaignInput("SOURCE_SENTINEL 🧪\nSelected synthetic passage.\n"));
    input.request.prompt = "PROMPT_SENTINEL";
    input.request.priorFeedback = [{ id: "feedback-1", runId: "run-1", label: "label", text: "FEEDBACK_SENTINEL" }];
    input.policy.maxPrimaryScalars = 12;
    const plan = await planned(input);
    const result = await tokenizeCampaignPlan(plan);
    const serialized = JSON.stringify(result.tokens);
    expect(serialized).not.toContain("SOURCE_SENTINEL");
    expect(serialized).not.toContain("PROMPT_SENTINEL");
    expect(serialized).not.toContain("FEEDBACK_SENTINEL");
    expect(result.contentDigest).toBe(plan.digest);
    const inspection = inspectContinuationTokens(result.tokens, "plan");
    expect(inspection.status).toBe("structural-only");
    expect(inspection.holes.length).toBe(result.holes);
    expect(new Set(inspection.holes.map((hole) => hole.kind))).toEqual(new Set(["source-text", "stage-prompt", "prior-feedback"]));
    expect(inspection.holes.some((hole) => hole.path[0] === "sources")).toBe(true);
    expect(inspection.holes.some((hole) => hole.path[0] === "stages" && hole.path[3] === "sources")).toBe(true);
    const { digest: _digest, ...content } = plan;
    const resolved = await resolveContinuationTokens(result.tokens, "plan", ({ path }) => atPath(content, path));
    expect(resolved.status).toBe("structural-only");
    expect(canonicalJson(resolved.root)).toBe(canonicalJson(content));
    expect(resolved.contentDigest).toBe(plan.digest);
    expect(resolved.contentBytes).toBe(result.contentBytes);
    expect(resolved.holeBytes).toBe(result.holeBytes);
    const untrusted = { ...(resolved.root as Omit<CampaignPlan, "digest">), digest: plan.digest } as CampaignPlan;
    expect(() => requireCampaignPlan(untrusted)).toThrow();
    expect(() => aggregateCampaignCoverage(untrusted, [])).toThrow();
    expect(await refusal(() => tokenizeCampaignPlan(untrusted))).not.toBe("accepted");
    const fresh = await planned(input);
    const { digest: _freshDigest, ...freshContent } = fresh;
    expect(fresh.digest).toBe(plan.digest);
    expect(canonicalJson(freshContent)).toBe(canonicalJson(resolved.root));
    requireCampaignPlan(fresh);
  });

  test("handles actual 70k and 250k word planner inputs with exact resolved digests", async () => {
    for (const words of [70_000, 250_000]) {
      const plan = await planned(withSynthesis(await campaignInput("word ".repeat(words))));
      const stream = await tokenizeCampaignPlan(plan);
      const { digest: _digest, ...content } = plan;
      const resolved = await resolveContinuationTokens(stream.tokens, "plan", ({ path }) => atPath(content, path));
      expect(resolved.contentDigest).toBe(plan.digest);
      expect(canonicalJson(resolved.root)).toBe(canonicalJson(content));
    }
  }, 60_000);

  test("retains more than 64 disjoint selected spans and stages without collapsing gaps", async () => {
    const input = await campaignInput("a_".repeat(70));
    const source = input.sources[0];
    if (!source) throw new Error("Missing fixture source");
    source.ranges = Array.from({ length: 70 }, (_, index) => ({ start: index * 2, end: index * 2 + 1 }));
    const plan = await planned(input);
    expect(plan.sources[0]?.segments.length).toBe(70);
    expect(plan.stages.length).toBe(70);
    const stream = await tokenizeCampaignPlan(plan);
    const { digest: _digest, ...content } = plan;
    const resolved = await resolveContinuationTokens(stream.tokens, "plan", ({ path }) => atPath(content, path));
    expect(resolved.contentDigest).toBe(plan.digest);
    expect(canonicalJson(resolved.root)).toBe(canonicalJson(content));
  }, 30_000);

  test("retains supported unknown checkpoint values and own __proto__ without prototype mutation", async () => {
    const checkpoint: unknown = JSON.parse('{"__proto__":{"x":"🧪"},"checkpointVersion":1,"stages":[{"receipt":null,"stageId":"s","unknown":{"__proto__":[1,2]}}]}');
    const stream = await tokenizeCheckpointValue(checkpoint);
    expect(stream.holes).toBe(0);
    const inspection = inspectContinuationTokens(stream.tokens, "checkpoint");
    expect(canonicalJsonText(inspection.root)).toBe(canonicalJsonText(checkpoint));
    expect(Object.getPrototypeOf(inspection.root)).toBe(Object.prototype);
    expect(Object.hasOwn(inspection.root as object, "__proto__")).toBe(true);
    const resolved = await resolveContinuationTokens(stream.tokens, "checkpoint", () => { throw new Error("unexpected hole"); });
    expect(resolved.contentDigest).toBe(stream.contentDigest);
  });

  test("distinguishes absent, wrong type, wrong hash and wrong length from an exact hole", async () => {
    const plan = await planned(await campaignInput("Exact 🧪 data.\n"));
    const stream = await tokenizeCampaignPlan(plan);
    const { digest: _digest, ...content } = plan;
    expect(await refusal(() => resolveContinuationTokens(stream.tokens, "plan", () => undefined))).toBe("external-unavailable");
    expect(await refusal(() => resolveContinuationTokens(stream.tokens, "plan", () => 1))).toBe("external-mismatch");
    expect(await refusal(() => resolveContinuationTokens(stream.tokens, "plan", () => "wrong"))).toBe("external-mismatch");
    expect(await refusal(() => resolveContinuationTokens(stream.tokens, "plan", () => "x".repeat(100_000)))).toBe("external-mismatch");
    const changed = [...stream.tokens];
    const index = changed.findIndex((token) => token.t === "H");
    const hole = changed[index];
    if (hole?.t !== "H") throw new Error("Missing fixture hole");
    changed[index] = { ...hole, digest: "0".repeat(64) };
    expect(await refusal(() => resolveContinuationTokens(changed, "plan", ({ path }) => atPath(content, path)))).toBe("external-mismatch");
  });

  test("refuses non-hole substitutions, foreign holes, bad ordering, closures, extra values and future controls", async () => {
    const plan = await planned(await campaignInput());
    const { tokens } = await tokenizeCampaignPlan(plan);
    const holeIndex = tokens.findIndex((token) => token.t === "H");
    const badHole = [...tokens];
    badHole[holeIndex] = { t: "V", value: "not externalized" };
    expect(() => inspectContinuationTokens(badHole, "plan")).toThrow(ContinuationTokenError);
    const wrongKind = [...tokens];
    const hole = wrongKind[holeIndex];
    if (hole?.t !== "H") throw new Error("Missing fixture hole");
    wrongKind[holeIndex] = { ...hole, kind: hole.kind === "source-text" ? "stage-prompt" : "source-text" };
    expect(() => inspectContinuationTokens(wrongKind, "plan")).toThrow(ContinuationTokenError);
    const external = { t: "H", kind: "source-text", bytes: 2, digest: "0".repeat(64) };
    for (const invalid of [
      [external], [{ t: "O" }, { t: "K", value: "b" }, { t: "V", value: 1 }, { t: "K", value: "a" }, { t: "V", value: 2 }, { t: "}" }],
      [{ t: "O" }, { t: "K", value: "a" }, { t: "V", value: 1 }, { t: "K", value: "a" }, { t: "V", value: 2 }, { t: "}" }],
      [{ t: "A" }, { t: "}" }], [{ t: "V", value: 1 }, { t: "V", value: 2 }], [{ t: "Q" }],
      [{ t: "V", value: 1, future: true }], [{ t: "V", value: {} }]
    ]) expect(() => inspectContinuationTokens(invalid, "plan")).toThrow();
    expect(() => inspectContinuationTokens([external], "checkpoint")).toThrow(ContinuationTokenError);
  });

  test("enforces the actual serialized token boundary for values and keys, including wrapper and escaping", async () => {
    const bytes = (value: unknown) => new TextEncoder().encode(canonicalJsonText(value)).length;
    const valueSize = bytes({ t: "V", value: "" });
    const exactValue = "x".repeat(CONTINUATION_TOKEN_LIMITS.tokenBytes - valueSize);
    const accepted = await tokenizeCheckpointValue(exactValue);
    expect(bytes(accepted.tokens[0])).toBe(CONTINUATION_TOKEN_LIMITS.tokenBytes);
    expect(await refusal(() => tokenizeCheckpointValue(`${exactValue}x`))).not.toBe("accepted");
    const keySize = bytes({ t: "K", value: "" });
    const exactKey = "x".repeat(CONTINUATION_TOKEN_LIMITS.tokenBytes - keySize);
    const object = Object.fromEntries([[exactKey, 1]]);
    const acceptedKey = await tokenizeCheckpointValue(object);
    expect(bytes(acceptedKey.tokens[1])).toBe(CONTINUATION_TOKEN_LIMITS.tokenBytes);
    expect(await refusal(() => tokenizeCheckpointValue(Object.fromEntries([[`${exactKey}x`, 1]])))).not.toBe("accepted");
    const escaped = { t: "V", value: `${"x".repeat(CONTINUATION_TOKEN_LIMITS.tokenBytes - valueSize - 1)}\n` };
    expect(() => inspectContinuationTokens([escaped], "checkpoint")).toThrow();
  }, 30_000);

  test("enforces token-tree depth and repeated claimed hole budgets across the stream", () => {
    const nested = (depth: number): ContinuationToken[] => [
      ...Array.from({ length: depth }, () => ({ t: "A" as const })), { t: "V", value: 1 },
      ...Array.from({ length: depth }, () => ({ t: "]" as const }))
    ];
    expect(inspectContinuationTokens(nested(64), "checkpoint").status).toBe("structural-only");
    expect(() => inspectContinuationTokens(nested(65), "checkpoint")).toThrow(ContinuationTokenError);
    const withHoles = (second: number): ContinuationToken[] => [
      { t: "O" }, { t: "K", value: "stages" }, { t: "A" },
      ...[CONTINUATION_TOKEN_LIMITS.expandedBytes / 2, second].flatMap((bytes): ContinuationToken[] => [
        { t: "O" }, { t: "K", value: "envelope" }, { t: "O" }, { t: "K", value: "prompt" },
        { t: "H", kind: "stage-prompt", bytes, digest: "0".repeat(64) }, { t: "}" }, { t: "}" }
      ]),
      { t: "]" }, { t: "}" }
    ];
    expect(inspectContinuationTokens(withHoles(CONTINUATION_TOKEN_LIMITS.expandedBytes / 2), "plan").holeBytes).toBe(CONTINUATION_TOKEN_LIMITS.expandedBytes);
    expect(() => inspectContinuationTokens(withHoles(CONTINUATION_TOKEN_LIMITS.expandedBytes / 2 + 1), "plan")).toThrow(ContinuationTokenError);
  });

  test("parses a real million-token tree and refuses one token more", () => {
    const primitive: ContinuationToken = { t: "V", value: null };
    const tokens = Array<ContinuationToken>(CONTINUATION_TOKEN_LIMITS.tokens).fill(primitive);
    tokens[0] = { t: "A" };
    tokens[tokens.length - 1] = { t: "]" };
    const parsed = inspectContinuationTokens(tokens, "checkpoint");
    expect((parsed.root as unknown[]).length).toBe(CONTINUATION_TOKEN_LIMITS.tokens - 2);
    tokens.push({ t: "]" });
    expect(() => inspectContinuationTokens(tokens, "checkpoint")).toThrow(ContinuationTokenError);
  }, 60_000);

  test("refuses a projected expanded plan before requesting any external value", async () => {
    const tokens: ContinuationToken[] = [
      { t: "O" }, { t: "K", value: "stages" }, { t: "A" }, { t: "O" },
      { t: "K", value: "envelope" }, { t: "O" }, { t: "K", value: "prompt" },
      { t: "H", kind: "stage-prompt", bytes: CONTINUATION_TOKEN_LIMITS.expandedBytes, digest: "0".repeat(64) },
      { t: "}" }, { t: "}" }, { t: "]" }, { t: "}" }
    ];
    let called = false;
    await expect(resolveContinuationTokens(tokens, "plan", () => { called = true; return ""; })).rejects.toThrow();
    expect(called).toBe(false);
  });
});
