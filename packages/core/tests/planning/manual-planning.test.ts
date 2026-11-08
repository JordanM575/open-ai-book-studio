import { describe, expect, test } from "bun:test";
import { LibraryService } from "../../src/library/service";
import { createPlanningApi, planningHandler, planningValue } from "../../src/library/planning-api";
import { bookFilePath, chapterPath } from "../../src/library/paths";
import { sidecarPath, type SidecarRead } from "../../src/planning/checked-sidecar";
import { encoder, type Planning } from "../../src/planning/schema";
import type { PlanningDraft } from "../../src/planning/service";
import { InMemoryLibraryPort } from "../support/in-memory-port";
import { envelope, fields } from "./fixture";

const timeline = { title: " Winter ", when: "the winter after the siege", description: "  Literal\r\n界 😀  ", notes: "e\u0301\n\n" };
const beat = { title: " Return ", summary: "Literal summary\r\n", notes: "  notes  " };
const notes = { workingNotes: "  Working\r\n", styleNotes: "e\u0301", synopsis: "界 😀" };
function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("Missing synthetic value");
  return value;
}
async function setup() {
  const port = new InMemoryLibraryPort();
  const library = await LibraryService.open({ storage: port, runtime: port });
  const book = await library.createBook({ title: "Synthetic manual planning" });
  const api = createPlanningApi(planningHandler(() => library));
  const read = () => planningValue(api.read(book.id));
  const save = async (draft: PlanningDraft, base?: SidecarRead<Planning>) => planningValue(api.save({ ...envelope(base ?? await read()), draft }));
  const raw = () => port.readFile(sidecarPath(book.id, "planning"));
  const seed = (value: unknown) => port.commitFile(sidecarPath(book.id, "planning"), encoder.encode(JSON.stringify(value)), { kind: "any" });
  return { port, library, book, api, read, save, raw, seed };
}

describe("manual planning through real Library and validated handler", () => {
  test("all kinds create, edit, reopen, reorder, archive and restore without touching Bible, chapters or other book", async () => {
    const f = await setup();
    await f.library.updateBook(f.book.id, { outline: "Existing free-text outline" });
    const chapter = await f.library.createChapter(f.book.id, { content: "Synthetic chapter unchanged." });
    const other = await f.library.createBook({ title: "Other synthetic book" });
    const paths = [bookFilePath(f.book.id), chapterPath(f.book.id, chapter.path), bookFilePath(other.id)];
    const before = await Promise.all(paths.map((path) => f.port.readFile(path)));
    expect((await f.read()).data).toBeNull();
    expect(await f.raw()).toBeNull();
    await f.save({ kind: "create-worldbuilding", fields });
    await f.save({ kind: "create-timeline", fields: timeline });
    await f.save({ kind: "create-timeline", fields: { ...timeline, title: "Before" } });
    await f.save({ kind: "create-beat", fields: beat });
    await f.save({ kind: "create-beat", fields: { ...beat, title: "Departure" } });
    await f.save({ kind: "set-story-notes", fields: notes });
    const original = required((await f.read()).data);
    const event = required(original.timeline[0]);
    const outlineBeat = required(original.beats[0]);
    const world = required(original.worldbuilding[0]);
    expect(event.id.startsWith("tl_")).toBe(true);
    expect(outlineBeat.id.startsWith("beat_")).toBe(true);
    expect(original.storyNotes?.id.startsWith("sn_")).toBe(true);
    await f.save({ kind: "edit-timeline", id: event.id, fields: { ...timeline, title: "Changed event" } });
    await f.save({ kind: "edit-beat", id: outlineBeat.id, fields: { ...beat, summary: "Changed summary" } });
    await f.save({ kind: "set-story-notes", fields: { ...notes, synopsis: "Changed synopsis" } });
    const beforeOrder = required((await f.read()).data);
    await f.save({ kind: "order-timeline", ids: [...original.timelineOrder].reverse() });
    await f.save({ kind: "order-beats", ids: [...original.beatOrder].reverse() });
    const afterOrder = required((await f.read()).data);
    expect(afterOrder.timeline).toEqual(beforeOrder.timeline);
    expect(afterOrder.beats).toEqual(beforeOrder.beats);
    for (const [kind, id, key] of [
      ["archive-worldbuilding", world.id, "worldbuilding"], ["archive-timeline", event.id, "timeline"], ["archive-beat", outlineBeat.id, "beats"]
    ] as const) {
      const prior = required((await f.read()).data?.[key].find((record) => record.id === id));
      await f.save({ kind, id, archived: true });
      const archived = required((await f.read()).data?.[key].find((record) => record.id === id));
      expect(archived).toEqual({ ...prior, archived: true, revision: prior.revision + 1 });
      expect((await f.save({ kind, id, archived: true })).status).toBe("unchanged");
      await f.save({ kind, id, archived: false });
      expect((await f.read()).data?.[key].find((record) => record.id === id)).toEqual({ ...prior, revision: prior.revision + 2 });
    }
    const reopen = await LibraryService.open({ storage: f.port, runtime: f.port });
    const data = required((await reopen.planning.read(f.book.id)).data);
    expect(data.timelineOrder).toEqual([...original.timelineOrder].reverse());
    expect(data.beatOrder).toEqual([...original.beatOrder].reverse());
    expect(data.timeline[0]).toMatchObject({ id: event.id, revision: 4, when: timeline.when, description: timeline.description });
    expect(data.storyNotes).toMatchObject({ id: original.storyNotes?.id, revision: 2, synopsis: "Changed synopsis" });
    expect(await Promise.all(paths.map((path) => f.port.readFile(path)))).toEqual(before);
  });

  test("notes clear retains identity and unknown own __proto__ at all depths; absent/empty clear has zero writes", async () => {
    const f = await setup();
    const commit = f.port.commitFile.bind(f.port);
    let writes = 0;
    f.port.commitFile = (...args) => { writes++; return commit(...args); };
    expect((await f.save({ kind: "clear-story-notes" })).status).toBe("unchanged");
    expect((await f.save({ kind: "set-story-notes", fields: { workingNotes: "", styleNotes: "", synopsis: "" } })).status).toBe("unchanged");
    expect((await f.save({ kind: "order-timeline", ids: [] })).status).toBe("unchanged");
    expect(writes).toBe(0);
    await f.save({ kind: "set-story-notes", fields: notes });
    await f.save({ kind: "create-timeline", fields: timeline });
    const data = required((await f.read()).data);
    const extension = JSON.parse('{"__proto__":{"literal":"  keep  ","nested":{"__proto__":{}}}}') as Record<string, unknown>;
    await f.seed({ ...data, ...extension, storyNotes: { ...data.storyNotes, ...extension }, timeline: data.timeline.map((record) => ({ ...record, ...extension })) });
    const before = required((await f.read()).data);
    expect(Object.hasOwn(before, "__proto__")).toBe(true);
    await f.save({ kind: "clear-story-notes" });
    const cleared = required((await f.read()).data);
    expect(cleared.storyNotes).toEqual({ ...required(before.storyNotes), workingNotes: "", styleNotes: "", synopsis: "", revision: 2 });
    expect(Object.getOwnPropertyDescriptor(cleared, "__proto__")?.value).toEqual(Object.getOwnPropertyDescriptor(extension, "__proto__")?.value);
    expect(cleared.timeline).toEqual(before.timeline);
    const beforeNoop = await f.raw();
    writes = 0;
    expect((await f.save({ kind: "clear-story-notes" })).status).toBe("unchanged");
    expect(writes).toBe(0);
    expect(await f.raw()).toEqual(beforeNoop);
    await f.save({ kind: "set-story-notes", fields: notes });
    expect((await f.read()).data?.storyNotes).toMatchObject({ id: before.storyNotes?.id, revision: 3, ...notes });
  });

  test.each(["timeline", "beat"] as const)("%s retained limit includes archived; invalid identity/order/edit and overflow preserve bytes", async (kind) => {
    const f = await setup();
    await f.save(kind === "timeline" ? { kind: "create-timeline", fields: timeline } : { kind: "create-beat", fields: beat });
    const data = required((await f.read()).data);
    const key = kind === "timeline" ? "timeline" : "beats";
    const orderKey = kind === "timeline" ? "timelineOrder" : "beatOrder";
    const prefix = kind === "timeline" ? "tl" : "beat";
    const template = required(data[key][0]);
    const records = Array.from({ length: 200 }, (_, index) => ({ ...template, id: `${prefix}_${String(index).padStart(6, "0")}`, archived: true }));
    await f.seed({ ...data, [key]: records, [orderKey]: records.map((record) => record.id) });
    const before = await f.raw();
    const id = required(records[0]).id;
    const invalid: PlanningDraft[] = kind === "timeline" ? [
      { kind: "create-timeline", fields: timeline }, { kind: "edit-timeline", id, fields: timeline },
      { kind: "order-timeline", ids: [id, id] }, { kind: "archive-timeline", id: "tl_missing01", archived: false }
    ] : [
      { kind: "create-beat", fields: beat }, { kind: "edit-beat", id, fields: beat },
      { kind: "order-beats", ids: [id, id] }, { kind: "archive-beat", id: "beat_missing01", archived: false }
    ];
    for (const draft of invalid) await expect(f.save(draft)).rejects.toThrow();
    expect(await f.raw()).toEqual(before);
    await f.seed({ ...data, [key]: [{ ...template, revision: Number.MAX_SAFE_INTEGER }], [orderKey]: [template.id] });
    const overflow = await f.raw();
    await expect(f.save({ kind: kind === "timeline" ? "archive-timeline" : "archive-beat", id: template.id, archived: true })).rejects.toThrow();
    expect(await f.raw()).toEqual(overflow);
  });

  test("competing saves retain the complete exact draft in recovery and do not retry", async () => {
    const f = await setup();
    await f.save({ kind: "create-timeline", fields: timeline });
    const base = await f.read();
    const id = required(base.data?.timeline[0]).id;
    const [first, second] = await Promise.all([
      f.save({ kind: "edit-timeline", id, fields: { ...timeline, notes: "Winner" } }, base),
      f.save({ kind: "edit-timeline", id, fields: { ...timeline, notes: "  Exact\r\nlosing draft  " } }, base)
    ]);
    expect(first.status).toBe("saved");
    expect(second.status).toBe("conflict");
    expect((await f.read()).data?.timeline[0]?.notes).toBe("Winner");
    const list = await planningValue(f.api.listCopies(f.book.id, 0));
    const copy = await planningValue(f.api.readCopy(f.book.id, required(list.names[0])));
    expect(JSON.parse(copy.rawJson).timeline[0]).toMatchObject({ id, notes: "  Exact\r\nlosing draft  ", revision: 2 });
    // Even a semantic no-op against the stale base remains stale.
    expect((await f.save({ kind: "edit-timeline", id, fields: timeline }, base)).status).toBe("conflict");
  });

  test("unknown own data survives targeted edits and archive/order; every current semantic no-op writes no journal", async () => {
    const f = await setup();
    await f.save({ kind: "create-worldbuilding", fields });
    await f.save({ kind: "create-timeline", fields: timeline });
    await f.save({ kind: "create-beat", fields: beat });
    const data = required((await f.read()).data);
    const extra = JSON.parse('{"__proto__":{"literal":"keep"},"future":{"__proto__":{},"value":["  text  ",1.25]}}') as Record<string, unknown>;
    await f.seed({ ...data, ...extra, worldbuilding: data.worldbuilding.map((record) => ({ ...record, ...extra })),
      timeline: data.timeline.map((record) => ({ ...record, ...extra })), beats: data.beats.map((record) => ({ ...record, ...extra })) });
    const world = required(data.worldbuilding[0]); const event = required(data.timeline[0]); const outlineBeat = required(data.beats[0]);
    await f.save({ kind: "edit-worldbuilding", id: world.id, fields: { ...fields, notes: "Changed" } });
    await f.save({ kind: "edit-timeline", id: event.id, fields: { ...timeline, notes: "Changed" } });
    await f.save({ kind: "edit-beat", id: outlineBeat.id, fields: { ...beat, notes: "Changed" } });
    await f.save({ kind: "archive-timeline", id: event.id, archived: true });
    await f.save({ kind: "create-timeline", fields: { ...timeline, title: "New event" } });
    const ordered = required((await f.read()).data);
    await f.save({ kind: "order-timeline", ids: [...ordered.timelineOrder].reverse() });
    expect((await f.read()).data?.timelineOrder).toEqual([...ordered.timelineOrder].reverse());
    await f.save({ kind: "archive-timeline", id: event.id, archived: false });
    const current = required((await f.read()).data);
    for (const record of [current, current.worldbuilding[0], current.timeline[0], current.beats[0]]) {
      expect(Object.getOwnPropertyDescriptor(record, "__proto__")?.value).toEqual({ literal: "keep" });
      expect(record?.future).toEqual(extra.future);
    }
    const raw = await f.raw();
    let writes = 0; const commit = f.port.commitFile.bind(f.port);
    f.port.commitFile = (...args) => { writes++; return commit(...args); };
    const noops: PlanningDraft[] = [
      { kind: "edit-worldbuilding", id: world.id, fields: { ...fields, notes: "Changed" } },
      { kind: "edit-timeline", id: event.id, fields: { ...timeline, notes: "Changed" } },
      { kind: "edit-beat", id: outlineBeat.id, fields: { ...beat, notes: "Changed" } },
      { kind: "archive-worldbuilding", id: world.id, archived: false },
      { kind: "archive-timeline", id: event.id, archived: false }, { kind: "archive-beat", id: outlineBeat.id, archived: false },
      { kind: "order-timeline", ids: current.timelineOrder }, { kind: "order-beats", ids: current.beatOrder }
    ];
    for (const draft of noops) expect((await f.save(draft)).status).toBe("unchanged");
    expect(writes).toBe(0); expect(await f.raw()).toEqual(raw);
  });

  test("handler also rejects a self-consistent response for a different operation", async () => {
    const f = await setup();
    const base = await f.read();
    const otherResult = await f.save({ kind: "create-beat", fields: beat }, base);
    let calls = 0;
    f.library.planning.save = async () => { calls++; return otherResult; };
    const handler = planningHandler(() => f.library);
    expect(await handler("save", { ...envelope(base), draft: { kind: "create-timeline", fields: timeline } })).toMatchObject({ ok: false, error: { outcome: "uncertain" } });
    expect(calls).toBe(1);
  });

  test.each(["corrupt", "future"] as const)("%s source is unavailable and never reset by new variants", async (scenario) => {
    const f = await setup();
    await f.save({ kind: "create-beat", fields: beat });
    const base = await f.read();
    await f.port.commitFile(sidecarPath(f.book.id, "planning"), encoder.encode(scenario === "corrupt" ? "{bad" : JSON.stringify({ ...base.data, schemaVersion: 2 })), { kind: "any" });
    const raw = await f.raw();
    await expect(f.read()).rejects.toThrow();
    await expect(f.save({ kind: "set-story-notes", fields: notes }, base)).rejects.toThrow();
    expect(await f.raw()).toEqual(raw);
  });

  test.each(["create", "edit", "notes", "clear", "order", "archive", "restore", "noop"] as const)("%s response must match entire intended operation, not merely hash/revision", async (operation) => {
    const f = await setup();
    await f.save({ kind: "create-timeline", fields: timeline });
    await f.save({ kind: "create-timeline", fields: { ...timeline, title: "Other" } });
    await f.save({ kind: "set-story-notes", fields: notes });
    const initial = required((await f.read()).data);
    const id = required(initial.timeline[0]).id;
    if (operation === "restore") await f.save({ kind: "archive-timeline", id, archived: true });
    const base = await f.read();
    const draft: PlanningDraft = operation === "create" ? { kind: "create-beat", fields: beat }
      : operation === "edit" ? { kind: "edit-timeline", id, fields: { ...timeline, notes: "Changed" } }
      : operation === "notes" ? { kind: "set-story-notes", fields: { ...notes, synopsis: "Changed" } }
      : operation === "clear" ? { kind: "clear-story-notes" }
      : operation === "order" ? { kind: "order-timeline", ids: [...initial.timelineOrder].reverse() }
      : operation === "noop" ? { kind: "edit-timeline", id, fields: timeline }
      : { kind: "archive-timeline", id, archived: operation === "archive" };
    const request = { ...envelope(base), draft };
    const result = await planningValue(f.api.save(request));
    if (result.status === "conflict") throw new Error("Unexpected conflict");
    const wrong = structuredClone(result);
    const current = required(wrong.current.data);
    // Correct intent fields but unrelated data was dropped/changed: reject a self-consistent forged hash.
    current.worldbuilding = [{ id: "wb_foreign01", bookId: f.book.id, revision: 1, archived: false, kind: "worldbuilding", ...fields }];
    wrong.current.baselineJson = JSON.stringify(current);
    wrong.current.source = { kind: "sha256", revision: current.revision, value: await f.port.sha256(encoder.encode(wrong.current.baselineJson)) };
    let calls = 0;
    const foreign = createPlanningApi(async () => { calls++; return { ok: true, data: wrong }; });
    await expect(foreign.save(request)).rejects.toThrow();
    expect(calls).toBe(1);
  });

  test("transport rejects dropped empty own __proto__, wrong fields, foreign kinds and strict extras", async () => {
    const f = await setup();
    await f.save({ kind: "create-beat", fields: beat });
    const data = required((await f.read()).data);
    await f.seed({ ...data, ...JSON.parse('{"__proto__":{}}') });
    const base = await f.read();
    const request = { ...envelope(base), draft: { kind: "clear-story-notes" as const } };
    const current = structuredClone(base);
    Reflect.deleteProperty(required(current.data), "__proto__");
    const bad = createPlanningApi(async () => ({ ok: true, data: { status: "unchanged", current } }));
    await expect(bad.save(request)).rejects.toThrow();
    const handler = planningHandler(() => f.library);
    for (const draft of [
      { kind: "edit-timeline", id: required(data.beats[0]).id, fields: timeline },
      { kind: "create-beat", fields: { ...beat, extra: "not allowed" } },
      { kind: "create-timeline", fields: { ...timeline, when: "😀".repeat(101) } },
      { kind: "archive-beat", id: required(data.beats[0]).id, archived: true, path: "elsewhere" }
    ]) expect(await handler("save", { ...envelope(base), draft })).toMatchObject({ ok: false, error: { outcome: "refused" } });
  });
});
