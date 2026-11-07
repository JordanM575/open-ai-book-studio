import { describe, expect, test } from "bun:test";
import { encoder, parseJson } from "../../src/planning/schema";
import { libraryPathFromArchivePath } from "../../src/library/path";
import { envelope, fixture } from "./fixture";

describe("lossless sidecar JSON number admission", () => {
  for (const kind of ["planning", "goals"] as const) {
    for (const token of ["9007199254740993", "1e-400", "1e400", "1.0000000000000001", "0.10000000000000001", "-0", "-0.00e99"]) {
      test(`${kind} refuses ${token} in active data and a stale recovery baseline without writes`, async () => {
        const f = await fixture();
        const planning = await f.seedPlanning();
        await f.goals.save({ ...envelope(await f.goals.read(f.book.id)), draft: { kind: "set-goal", targetWords: 10 } });
        const goal = await f.goals.read(f.book.id);
        const original = kind === "planning" ? planning : goal;
        const path = kind === "planning" ? f.activePath : f.goalPath;
        const raw = (original.baselineJson ?? "").replace("{", `{"future":{"nested":[${token}]},`);
        const source = { kind: "sha256" as const, value: await f.port.sha256(encoder.encode(raw)), revision: 1 };
        const save = () => kind === "planning"
          ? f.planning.save({ ...f.edit(planning, { notes: "Retained draft" }), source, baselineJson: raw })
          : f.goals.save({ ...envelope(goal), source, baselineJson: raw, draft: { kind: "set-goal", targetWords: 20 } });
        f.commits.length = 0;
        f.layouts.length = 0;
        await f.writeRaw(path, raw);
        await expect(kind === "planning" ? f.planning.read(f.book.id) : f.goals.read(f.book.id)).rejects.toThrow("cannot preserve");
        await expect(save()).rejects.toThrow("cannot preserve");
        expect(await f.raw(path)).toBe(raw);
        await f.writeRaw(path, `${raw}\n`);
        await expect(save()).rejects.toThrow("cannot preserve");
        expect(await f.raw(path)).toBe(`${raw}\n`);
        expect(f.commits).toHaveLength(0);
        expect(f.layouts).toHaveLength(0);
      });
    }

    test(`${kind} keeps exact supported numeric values and numeric-looking strings in edits and recovery`, async () => {
      const f = await fixture();
      const planning = await f.seedPlanning();
      await f.goals.save({ ...envelope(await f.goals.read(f.book.id)), draft: { kind: "set-goal", targetWords: 10 } });
      const original = kind === "planning" ? planning : await f.goals.read(f.book.id);
      const path = kind === "planning" ? f.activePath : f.goalPath;
      const text = 'Escaped "9007199254740993" \\ -0 1e-400';
      const raw = (original.baselineJson ?? "").replace("{", `{"future":{"values":[1.00,0.1,6.022e-5,1e21,1e-7,9007199254740992],"text":${JSON.stringify(text)}},`);
      await f.writeRaw(path, raw);
      const future = JSON.parse(raw).future;
      const current = kind === "planning" ? await f.planning.read(f.book.id) : await f.goals.read(f.book.id);
      const save = () => kind === "planning"
        ? f.planning.save({ ...f.edit(planning, { notes: "Retained draft" }), source: current.source, baselineJson: raw })
        : f.goals.save({ bookId: current.bookId, source: current.source, baselineJson: current.baselineJson, draft: { kind: "set-goal", targetWords: 20 } });
      expect((await save()).status).toBe("saved");
      expect(JSON.parse(await f.raw(path)).future).toEqual(future);
      const active = await f.raw(path);
      const recovery = await save();
      expect(recovery.status).toBe("conflict");
      if (recovery.status !== "conflict") throw new Error("Missing recovery copy");
      expect(JSON.parse(await f.raw(libraryPathFromArchivePath(recovery.savedAs))).future).toEqual(future);
      expect(await f.raw(path)).toBe(active);
    });
  }

  test("known target and revision tokens cannot round into an accepted integer", () => {
    for (const key of ["targetWords", "revision", "schemaVersion"]) {
      expect(() => parseJson(encoder.encode(`{"${key}":1.0000000000000001}`))).toThrow("cannot preserve");
    }
    expect(parseJson(encoder.encode('{"number":1.000,"text":"1.0000000000000001"}'))).toEqual({ number: 1, text: "1.0000000000000001" });
  });
});
