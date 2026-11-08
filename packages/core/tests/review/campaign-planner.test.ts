import { describe, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs/promises";
import { isScalarBoundary, REVIEW_LIMITS, utf8Bytes } from "../../src/review/contract";
import { admitCampaignSynthesis, planReviewCampaign } from "../../src/review/campaign-planner";
import { aggregateCampaignCoverage } from "../../src/review/campaign-coverage";
import { buildReviewEnvelope, serializeProviderRequest } from "../../src/review/envelope";
import { verifyReviewCitation } from "../../src/review/findings";
import { editReaderProfile, profileSchema } from "../../src/review/profiles";
import { REVIEW_RECORD_LIMITS } from "../../src/review/record-format";
import { campaignInput, completed, first, planned, withSynthesis } from "./campaign-fixtures";

describe("explicit campaign planning", () => {
  test("deterministic detached plans retain identity, categories, gaps and disclosed context", async () => {
    const input = await campaignInput("abc😀def\nXYZ more text\n");
    input.policy.maxPrimaryScalars = 3;
    input.policy.boundaryScalars = 1;
    first(input.sources).ranges = [{ start: 0, end: 8 }, { start: 9, end: 12 }];
    const plan = await planned(input);
    expect(await planned(input)).toEqual(plan);
    expect(Object.isFrozen(plan.stages)).toBe(true);
    const { body: _body, ...identity } = first(input.sources).saved;
    expect(first(plan.sources).identity).toEqual(identity);
    const coverage = aggregateCampaignCoverage(plan, completed(plan));
    expect(first(coverage.coverage).planned).toEqual([{ start: 0, end: 8 }, { start: 9, end: 12 }]);
    expect(first(coverage.coverage).completedUtf16).toBe(11);
    expect(coverage.sourceCoverageComplete).toBe(true);
    for (const stage of plan.stages) {
      const source = first(stage.envelope.sources);
      expect(source.kind).toBe("chapter");
      if (source.kind !== "chapter") throw new Error("Wrong synthetic source");
      expect(source.identity).toEqual(first(plan.sources).identity);
      expect(stage.envelope.profile).toEqual(input.profile);
      for (const range of [...stage.primary, ...stage.boundary]) {
        expect(isScalarBoundary(first(input.sources).saved.body, range.start)).toBe(true);
        expect(isScalarBoundary(first(input.sources).saved.body, range.end)).toBe(true);
      }
      expect(source.segments.every((segment) => segment.end <= 8 || segment.start >= 9)).toBe(true);
    }
    first(input.sources).saved.body = "Changed\n";
    expect(first(plan.sources).segments[0]?.text).toBe("abc😀def");
  });

  test.each(["bad-unicode", "noncanonical", "empty", "split-scalar", "foreign", "duplicate-id", "duplicate-identity",
    "unknown-category", "unknown-taxonomy", "unknown-profile", "wrong-digest", "outside-profile"])("refuses %s", async (kind) => {
    const input = await campaignInput("abc😀def\n");
    const source = first(input.sources);
    switch (kind) {
      case "bad-unicode": source.saved.body = "abc\ud800def\n"; break;
      case "noncanonical": source.saved.body = "abc\r\ndef"; break;
      case "empty": source.ranges = [{ start: 0, end: 0 }]; break;
      case "split-scalar": source.ranges = [{ start: 0, end: 4 }]; break;
      case "foreign": source.saved.bookId = "book_foreign"; break;
      case "duplicate-id": input.sources.push({ ...source, saved: { ...source.saved, chapterId: "ch_second" } }); break;
      case "duplicate-identity": input.sources.push({ ...source, sourceId: "alias" }); break;
      case "unknown-category": Reflect.set(input, "categories", ["new-category"]); break;
      case "unknown-taxonomy": Reflect.set(input, "taxonomyVersion", 2); break;
      case "unknown-profile": input.profile.id = "reader-unknown"; break;
      case "wrong-digest": input.profile.digest = "b".repeat(64); break;
      case "outside-profile": input.categories = ["continuity"]; break;
    }
    expect((await planReviewCampaign(input)).status).toBe("refused");
  });

  test("rejects accessors without invoking them and detaches input before awaits", async () => {
    const input = await campaignInput();
    let reads = 0;
    const hostile = { ...input, get extra() { reads++; return 1; } };
    expect((await planReviewCampaign(hostile)).status).toBe("refused");
    expect(reads).toBe(0);
    const pending = planReviewCampaign(input);
    first(input.sources).saved.body = "Mutated\n";
    const result = await pending;
    expect(result.status).toBe("planned");
    if (result.status === "refused") throw new Error(result.code);
    expect(first(result.plan.sources).segments[0]?.text).toBe("Synthetic chapter.\n");
  });

  test("rejects a compact shared DAG in an unknown field without expanding every path", async () => {
    const input = await campaignInput();
    let graph: object = { leaf: true };
    const nodes = new Set([graph]);
    for (let i = 0; i < 128; i++) {
      graph = { left: graph, right: graph };
      nodes.add(graph);
    }
    let visits = 0;
    const ownKeys = Reflect.ownKeys;
    const scan = spyOn(Reflect, "ownKeys").mockImplementation((value) => {
      if (nodes.has(value) && ++visits > nodes.size * 4) throw new Error("Unbounded shared-DAG traversal");
      return ownKeys(value);
    });
    try {
      expect(await planReviewCampaign({ ...input, unknownField: graph }))
        .toEqual({ status: "refused", code: "invalid-campaign-input" });
      expect(visits).toBeLessThanOrEqual(nodes.size * 2);
    } finally { scan.mockRestore(); }
  });

  test("ordinary overflow still refuses while explicit campaign includes all multibyte prose", async () => {
    const input = await campaignInput("😀漢é\"\\\u0000".repeat(10_000));
    const plan = await planned(input);
    const full = first(plan.sources);
    const { scopeDigest: _digest, ...ordinary } = first(plan.stages).envelope;
    await expect(buildReviewEnvelope({ ...ordinary, sources: [full] })).rejects.toThrow("source-byte-limit");
    expect(plan.stages.length).toBeGreaterThan(1);
    const coverage = aggregateCampaignCoverage(plan, completed(plan));
    expect(first(coverage.coverage).completedUtf16).toBe(first(input.sources).saved.body.length);
    for (const stage of plan.stages) {
      expect(stage.serializedBytes).toBe(utf8Bytes(serializeProviderRequest(stage.envelope)));
      expect(stage.serializedBytes).toBeLessThanOrEqual(REVIEW_LIMITS.requestBytes);
      expect(stage.envelope.sources.reduce((sum, source) => sum + (source.kind === "chapter" ?
        source.segments.reduce((n, segment) => n + utf8Bytes(segment.text), 0) : utf8Bytes(source.text)), 0)).toBeLessThanOrEqual(REVIEW_LIMITS.sourceBytes);
    }
  });

  test("exact serialized overhead limit admits, plus one refuses without trimming", async () => {
    const input = await campaignInput("a\n");
    first(input.sources).ranges = [{ start: 0, end: 1 }];
    const initial = await planned(input);
    const padding = REVIEW_LIMITS.requestBytes - first(initial.stages).serializedBytes;
    input.request.destination.model += "x".repeat(padding);
    const exact = await planned(input);
    expect(first(exact.stages).serializedBytes).toBe(REVIEW_LIMITS.requestBytes);
    input.request.destination.model += "x";
    expect(await planReviewCampaign(input)).toEqual({ status: "refused", code: "campaign-envelope-cannot-fit" });
  });

  test("exact source-byte boundary and JSON escape expansion use the existing admission", async () => {
    const input = await campaignInput("a".repeat(REVIEW_LIMITS.sourceBytes));
    input.policy.boundaryScalars = 0;
    const plan = await planned(input);
    expect(plan.stages).toHaveLength(2);
    expect(first(plan.stages).primary).toEqual([{ start: 0, end: REVIEW_LIMITS.sourceBytes }]);
    const escaped = await campaignInput("\u0000".repeat(REVIEW_LIMITS.sourceBytes));
    escaped.policy.boundaryScalars = 0;
    const escapePlan = await planned(escaped);
    const firstStage = first(escapePlan.stages);
    expect(first(firstStage.primary).end).toBeLessThan(REVIEW_LIMITS.sourceBytes);
    expect(firstStage.serializedBytes).toBeLessThanOrEqual(REVIEW_LIMITS.requestBytes);
    expect(firstStage.serializedBytes).toBeGreaterThan(REVIEW_LIMITS.requestBytes - 20);
    expect(first(aggregateCampaignCoverage(escapePlan, completed(escapePlan)).coverage).completedUtf16).toBe(REVIEW_LIMITS.sourceBytes + 1);
  });

  test("explicit multi-book selection keeps exact attribution without unselected book payloads", async () => {
    const input = await campaignInput();
    const firstBook = first(input.request.books);
    input.request.books.push({ ...firstBook, bookId: "book_second", title: "Second selected book" });
    const firstSource = first(input.sources);
    input.sources.push({ ...firstSource, sourceId: "source-2", bookTitle: "Second selected book",
      saved: { ...firstSource.saved, bookId: "book_second", chapterId: "ch_second" } });
    const plan = await planned(input);
    expect(plan.stages).toHaveLength(2);
    expect(plan.stages.map((stage) => first(stage.envelope.books).bookId)).toEqual(["book_123456", "book_second"]);
    expect(plan.stages.every((stage) => stage.envelope.books.length === 1)).toBe(true);
    input.request.books.push({ ...firstBook, bookId: "book_unused" });
    expect(await planReviewCampaign(input)).toEqual({ status: "refused", code: "unselected-campaign-book" });
  });

  test("equal-length owners bind distinct plans, coverage receipts and synthesis summaries", async () => {
    const input = withSynthesis(await campaignInput());
    const ownerA = input.ownerBookId;
    const ownerB = "book_654321";
    expect(ownerA.length).toBe(ownerB.length);
    const book = first(input.request.books);
    const source = first(input.sources);
    input.request.books.push({ ...book, bookId: ownerB, title: "Other selected book" });
    input.sources.push({ ...source, sourceId: "source-2", bookTitle: "Other selected book",
      saved: { ...source.saved, bookId: ownerB, chapterId: "ch_second" } });
    const pendingA = planned(input);
    input.ownerBookId = ownerB; // The first owner must already be detached before hashing awaits.
    const a = await pendingA;
    const b = await planned(input);
    expect(a.ownerBookId).toBe(ownerA);
    expect(b.ownerBookId).toBe(ownerB);
    expect(Object.isFrozen(a)).toBe(true);
    expect(a.digest).not.toBe(b.digest);
    expect(a.persistence.projectedBytes).toBe(b.persistence.projectedBytes);
    expect(a.stages).toEqual(b.stages);
    for (const [own, other] of [[a, b], [b, a]] as const) {
      expect(aggregateCampaignCoverage(own, completed(own)).sourceCoverageComplete).toBe(true);
      expect(() => aggregateCampaignCoverage(own, completed(other))).toThrow("coverage-plan-mismatch");
      const stage = first(own.stages.filter((item) => item.kind === "synthesis"));
      const summaries = stage.dependencies.map((stageId) => ({
        stageId, planDigest: other.digest, status: "completed", text: "Synthetic summary"
      }));
      await expect(admitCampaignSynthesis(own, stage.stageId, summaries)).rejects.toThrow("synthesis-plan-mismatch");
      expect((await admitCampaignSynthesis(own, stage.stageId,
        summaries.map((summary) => ({ ...summary, planDigest: own.digest })))).requestId).toBe(stage.stageId);
    }
  });

  test("combined limit accounts for prompt, profile, history and stage disclosure", async () => {
    const input = await campaignInput("a\n");
    first(input.sources).ranges = [{ start: 0, end: 1 }];
    input.request.priorFeedback = [{ id: "prior", runId: "old-run", label: "Selected history", text: "" }];
    const base = first((await planned(input)).stages).envelope;
    const profile = input.profile;
    const used = 1 + utf8Bytes(base.prompt) + utf8Bytes(profile.name + profile.purpose + profile.guidance + profile.focus.join(""));
    first(input.request.priorFeedback).text = "x".repeat(REVIEW_LIMITS.contentBytes - used);
    expect((await planReviewCampaign(input)).status).toBe("planned");
    first(input.request.priorFeedback).text += "x";
    expect(await planReviewCampaign(input)).toEqual({ status: "refused", code: "campaign-envelope-cannot-fit" });
  });

  test.each([70_000, 250_000])("plans every word in a %s-word oversized chapter", async (words) => {
    const input = withSynthesis(await campaignInput("word ".repeat(words)));
    const result = await planReviewCampaign(input);
    expect(result.status).toBe("planned");
    if (result.status === "refused") throw new Error(result.code);
    const plan = result.plan;
    const coverage = aggregateCampaignCoverage(plan, completed(plan));
    expect(first(coverage.coverage).completedUtf16).toBe(words * 5 + 1);
    expect(coverage.synthesis.status).toBe("complete");
    expect(plan.stages.length).toBeLessThanOrEqual(REVIEW_RECORD_LIMITS.campaignStages);
    expect(plan.persistence.projectedBytes).toBeGreaterThan(0);
    for (const stage of plan.stages) expect(stage.serializedBytes).toBeLessThanOrEqual(REVIEW_LIMITS.requestBytes);
    console.info(`campaign ${words} words: ${plan.stages.length} stages; max request ${Math.max(...plan.stages.map((s) => s.serializedBytes))}; manifest projection ${plan.persistence.projectedBytes}`);
  }, 30_000);

  test("120-chapter 250k manuscript retains all sources with explicit continuation refusal", async () => {
    const input = await campaignInput();
    const template = first(input.sources);
    input.sources = Array.from({ length: 120 }, (_, i) => {
      const words = i === 119 ? 2_123 : 2_083;
      const body = `${"word ".repeat(words)}\n`;
      return { ...template, sourceId: `source-${i}`, position: i + 1,
        saved: { ...template.saved, chapterId: `ch_${String(i).padStart(6, "0")}`, body }, ranges: [{ start: 0, end: body.length }] };
    });
    const result = await planReviewCampaign(input);
    expect(result.status).toBe("non-persistable");
    if (result.status === "refused") throw new Error(result.code);
    expect(result.plan.sources.length).toBe(120);
    expect(result.plan.stages.length).toBe(120);
    expect(result.plan.persistence.reasons).toEqual(["campaign-source-limit", "campaign-stage-limit"]);
    expect(aggregateCampaignCoverage(result.plan, completed(result.plan)).sourceCoverageComplete).toBe(true);
  }, 30_000);

  test("stage and aggregate-byte limits do not truncate or enlarge durable limits", async () => {
    const tiny = await campaignInput("a".repeat(65));
    tiny.policy.maxPrimaryScalars = 1;
    tiny.policy.boundaryScalars = 0;
    const plan = await planned(tiny);
    expect(plan.stages).toHaveLength(66);
    expect(plan.persistence.reasons).toContain("campaign-stage-limit");
    const large = await planned(await campaignInput("a".repeat(REVIEW_RECORD_LIMITS.bytes)));
    expect(large.persistence.reasons).toContain("campaign-source-byte-limit");
    expect(first(aggregateCampaignCoverage(large, completed(large)).coverage).completedUtf16).toBe(REVIEW_RECORD_LIMITS.bytes + 1);
  }, 30_000);

  test("profile versions and content digests remain immutable in every stage", async () => {
    const input = await campaignInput();
    const edited = await editReaderProfile(input.profile, { name: "Author lens", purpose: "Test", focus: ["clarity"], guidance: "New guidance" }, "author-lens");
    input.profile = profileSchema.parse(edited); input.categories = ["clarity"];
    const plan = await planned(input);
    expect(first(plan.stages).envelope.profile).toEqual(edited);
    expect(first(aggregateCampaignCoverage(plan, completed(plan)).coverage).profile.digest).toBe(edited.digest);
  });
});

describe("attributed synthesis admission", () => {
  test.each([
    { ranges: [{ start: 0, end: 4 }, { start: 2, end: 6 }] },
    { ranges: [{ start: 0, end: 2 }, { start: 2, end: 6 }] },
    { ranges: [{ start: 0, end: 6 }, { start: 0, end: 6 }] },
    { ranges: [{ start: 4, end: 6 }, { start: 0, end: 4 }] }
  ])("normalizes equivalent synthesis windows %j without duplicating disclosed text", async ({ ranges }) => {
    const input = withSynthesis(await campaignInput("abcdefghij\n"));
    input.policy.maxPrimaryScalars = 2;
    first(input.policy.synthesis.evidence).ranges = [{ start: 0, end: 6 }];
    const canonical = await planned(input);
    first(input.policy.synthesis.evidence).ranges = ranges.map((range) => ({ ...range }));
    const plan = await planned(input);
    expect(plan.stages).toEqual(canonical.stages);
    const stage = first(plan.stages.filter((entry) => entry.kind === "synthesis"));
    const source = first(stage.envelope.sources);
    if (source.kind !== "chapter") throw new Error("Expected chapter evidence");
    expect(source.segments).toEqual([{ start: 0, end: 6, text: "abcdef", startLine: 1 }]);
    const citation = { kind: "chapter", sourceId: source.sourceId, identity: source.identity, start: 1, end: 5, quote: "bcde" };
    expect(verifyReviewCitation(stage.envelope, citation).status).toBe("verified-captured");
    expect(verifyReviewCitation(stage.envelope, { ...citation, start: 5, end: 7, quote: "fg" }).status).toBe("invalid");
  });

  test("sorts disjoint multibyte windows within selected segments while preserving genuine gaps and line maps", async () => {
    const input = withSynthesis(await campaignInput("a😀b\nxxc界d\n"));
    first(input.sources).ranges = [{ start: 0, end: 5 }, { start: 7, end: 11 }];
    first(input.policy.synthesis.evidence).ranges = [
      { start: 9, end: 11 }, { start: 7, end: 9 }, { start: 3, end: 5 }, { start: 0, end: 3 }, { start: 0, end: 3 }
    ];
    const plan = await planned(input);
    const stage = first(plan.stages.filter((entry) => entry.kind === "synthesis"));
    const source = first(stage.envelope.sources);
    if (source.kind !== "chapter") throw new Error("Expected chapter evidence");
    expect(source.segments).toEqual([
      { start: 0, end: 5, text: "a😀b\n", startLine: 1 }, { start: 7, end: 11, text: "c界d\n", startLine: 2 }
    ]);
    const admitted = await admitCampaignSynthesis(plan, stage.stageId, stage.dependencies.map((stageId) => ({
      stageId, planDigest: plan.digest, status: "completed", text: "Retained summary"
    })));
    expect(admitted.sources).toEqual(stage.envelope.sources);
    const citation = { kind: "chapter", sourceId: source.sourceId, identity: source.identity, start: 7, end: 10, quote: "c界d" };
    expect(verifyReviewCitation(admitted, citation)).toMatchObject({ status: "verified-captured", evidence: { label: expect.stringContaining("lines 2–2") } });
    expect(verifyReviewCitation(admitted, { ...citation, start: 4, end: 8, quote: "\nxxc" }).status).toBe("invalid");
    first(input.policy.synthesis.evidence).ranges = [{ start: 3, end: 5 }, { start: 0, end: 1 }];
    const disjoint = first((await planned(input)).stages.filter((entry) => entry.kind === "synthesis")).envelope.sources[0];
    expect(disjoint?.kind === "chapter" && disjoint.segments.map(({ start, end }) => ({ start, end })))
      .toEqual([{ start: 0, end: 1 }, { start: 3, end: 5 }]);
  });

  test.each([
    { start: 2, end: 3 }, // A split scalar hidden inside an otherwise-valid union still refuses.
    { start: 4, end: 8 }, { start: 5, end: 7 }, { start: 0, end: 0 }, { start: 0, end: 12 }
  ])("refuses invalid original synthesis span %j before unioning", async (invalid) => {
    const input = withSynthesis(await campaignInput("a😀b\nxxc界d\n"));
    first(input.sources).ranges = [{ start: 0, end: 5 }, { start: 7, end: 11 }];
    first(input.policy.synthesis.evidence).ranges = [{ start: 0, end: 5 }, invalid];
    expect((await planReviewCampaign(input)).status).toBe("refused");
  });

  test.each(["campaign-synthetic", "c".repeat(160)])("generated feedback IDs avoid retained history deterministically for %s", async (campaignId) => {
    const input = withSynthesis(await campaignInput("abcdefg\n"));
    input.campaignId = campaignId;
    input.policy.maxPrimaryScalars = 1;
    input.policy.synthesis.fanIn = 2;
    const base = `derived-${campaignId}.000001`;
    input.request.priorFeedback = [base, `${base}-1`, `${base}-2`, `${base}-3`, `derived-${campaignId}.000002`]
      .map((id, index) => ({ id, runId: `old-run-${index}`, label: `Retained ${index}`, text: "Retain exactly: \u0000\\😀" }));
    const plan = await planned(input);
    expect(await planned(input)).toEqual(plan);
    const ids = new Set(input.request.priorFeedback.map((item) => item.id));
    for (const stage of plan.stages.filter((item) => item.kind === "synthesis")) {
      expect(stage.envelope.priorFeedback.slice(0, input.request.priorFeedback.length)).toEqual(input.request.priorFeedback);
      const generated = stage.envelope.priorFeedback.slice(input.request.priorFeedback.length);
      expect(generated.map((item) => item.runId)).toEqual([...stage.dependencies]);
      for (const item of generated) {
        expect(ids.has(item.id)).toBe(false); ids.add(item.id);
        expect(item.id.length).toBeLessThanOrEqual(200);
        if (item.runId === `${campaignId}.000001`) expect(item.id).toBe(`${base}-4`);
      }
      const admitted = await admitCampaignSynthesis(plan, stage.stageId, stage.dependencies.map((stageId) => ({
        stageId, planDigest: plan.digest, status: "completed", text: "Actual summary"
      })));
      expect(admitted.priorFeedback.slice(0, input.request.priorFeedback.length)).toEqual(input.request.priorFeedback);
      expect(admitted.priorFeedback.map((item) => item.id)).toEqual(stage.envelope.priorFeedback.map((item) => item.id));
      expect(utf8Bytes(serializeProviderRequest(admitted))).toBeLessThanOrEqual(stage.serializedBytes);
    }
    input.request.priorFeedback.push({ ...first(input.request.priorFeedback), text: "Conflicting caller duplicate" });
    expect(await planReviewCampaign(input)).toEqual({ status: "refused", code: "ambiguous-feedback-id" });
  });

  test("dependencies and original-source attribution survive multiple levels; summaries are not citations", async () => {
    const input = withSynthesis(await campaignInput("abcdefg\n"));
    input.policy.maxPrimaryScalars = 1;
    input.policy.synthesis.fanIn = 2;
    const plan = await planned(input);
    const synthesis = plan.stages.filter((stage) => stage.kind === "synthesis");
    expect(synthesis.length).toBe(7);
    const root = first(synthesis.slice(-1));
    expect(first(root.origins).primary).toEqual([{ start: 0, end: 8 }]);
    const admitted = await admitCampaignSynthesis(plan, root.stageId, root.dependencies.map((stageId) => ({
      stageId, planDigest: plan.digest, status: "completed", text: "A derived interpretation, not verified evidence."
    })));
    expect(utf8Bytes(serializeProviderRequest(admitted))).toBeLessThanOrEqual(root.serializedBytes);
    expect(admitted.priorFeedback.every((feedback) => feedback.label.includes('"derived":true'))).toBe(true);
    expect(admitted.sources).toEqual(root.envelope.sources);
    expect(root.primary).toEqual([]);
    expect(root.admission).toBe("summary-reservation");
    expect(admitted.scopeDigest).not.toBe(root.envelope.scopeDigest);
    const origin = first(root.origins);
    const citation = { kind: "chapter", sourceId: origin.sourceId, identity: origin.identity,
      start: 1, end: 2, quote: "b" };
    expect(verifyReviewCitation(admitted, citation)).toEqual({ status: "invalid", reason: "range" });
    expect(verifyReviewCitation(admitted, { ...citation, start: 0, end: 1, quote: "a" }).status).toBe("verified-captured");
  });

  test("refuses missing, foreign, failed, wrong-plan or oversized summaries without omission", async () => {
    const plan = await planned(withSynthesis(await campaignInput()));
    const stage = first(plan.stages.slice(-1));
    const valid = stage.dependencies.map((stageId) => ({ stageId, planDigest: plan.digest, status: "completed", text: "summary" }));
    for (const values of [[], [{ ...first(valid), stageId: "foreign" }], [{ ...first(valid), status: "failed" }],
      [{ ...first(valid), planDigest: "f".repeat(64) }], [{ ...first(valid), text: "😀".repeat(65) }],
      [{ ...first(valid), text: "\ud800" }]]) {
      await expect(admitCampaignSynthesis(plan, stage.stageId, values)).rejects.toThrow();
    }
    await expect(admitCampaignSynthesis(structuredClone(plan), stage.stageId, valid)).rejects.toThrow("unvalidated-campaign-plan");
  });

  test("worst escaping fits reservation and impossible synthesis refuses the full plan", async () => {
    const input = withSynthesis(await campaignInput());
    const plan = await planned(input);
    const stage = first(plan.stages.slice(-1));
    const admitted = await admitCampaignSynthesis(plan, stage.stageId, stage.dependencies.map((stageId) => ({
      stageId, planDigest: plan.digest, status: "completed", text: "\u0000".repeat(256)
    })));
    expect(utf8Bytes(serializeProviderRequest(admitted))).toBe(stage.serializedBytes);
    input.policy.synthesis.summaryBytes = REVIEW_LIMITS.contentBytes;
    expect((await planReviewCampaign(input)).status).toBe("refused");
    input.policy.synthesis.summaryBytes = 256;
    first(input.policy.synthesis.evidence).ranges = [{ start: 0, end: 100 }];
    expect((await planReviewCampaign(input)).status).toBe("refused");
  });

  test("planning, admission and aggregation perform zero I/O or clock lookup", async () => {
    const input = withSynthesis(await campaignInput());
    const spies = [spyOn(globalThis, "fetch"), spyOn(fs, "readFile"), spyOn(fs, "writeFile"),
      spyOn(Bun, "file"), spyOn(Bun, "write"), spyOn(Date, "now")];
    try {
      const plan = await planned(input);
      aggregateCampaignCoverage(plan, completed(plan));
      const stage = first(plan.stages.slice(-1));
      await admitCampaignSynthesis(plan, stage.stageId, stage.dependencies.map((stageId) => ({
        stageId, planDigest: plan.digest, status: "completed", text: "summary"
      })));
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally { for (const spy of spies) spy.mockRestore(); }
  });
});
