import { describe, expect, test } from "bun:test";
import { encoder, parseJson } from "../../src/planning/schema";
import { libraryPathFromArchivePath } from "../../src/library/path";
import { envelope, fixture } from "./fixture";

describe("lossless sidecar JSON number admission", () => {
  test("escaped quotes and backslash runs keep numeric-looking strings separate from number tokens", () => {
    const dangerous = ["9007199254740993", "1e-400", "1e400", "1.0000000000000001", "-0"];
    for (const length of [...Array.from({ length: 13 }, (_, index) => index), 15, 16, 127]) {
      for (const suffix of ["", '"', '\\"', "\r\n\t\0", "\u0301😀\ud800"]) {
        const text = `${"\\".repeat(length)}${suffix} ${dangerous.join(" ")} ${"\\".repeat(length)}`;
        const encoded = JSON.stringify(text);
        const valid = `{${encoded}:[${encoded},1.00,0.1,1e21,6.022e-5],"tail":${encoded}}`;
        expect(parseJson(encoder.encode(valid))).toEqual(JSON.parse(valid));
        for (const token of dangerous) {
          expect(() => parseJson(encoder.encode(`[${encoded},${token},${encoded}]`))).toThrow("cannot preserve");
          expect(() => parseJson(encoder.encode(`[${token},${encoded}]`))).toThrow("cannot preserve");
          expect(() => parseJson(encoder.encode(`{${encoded}:${token}}`))).toThrow("cannot preserve");
        }
      }
    }
  });

  test("malformed strings and escapes remain invalid JSON", () => {
    // A backslash-escaped opening quote followed by zero is valid string text, not a number.
    expect(parseJson(encoder.encode('"\\"0"'))).toBe('"0');
    for (const raw of ['"unterminated', '"trailing\\', '{"text":"bad\\q"}', '{"text":"bad\\u12zz"}',
      '{"text":"raw\nnewline"}', '{"text":"raw\0null"}', '{"text":"closed" "extra"}', '{"text":"\\"}',
      '["\\\\",]', '["first" "second"]', '{"key":1,}', '["escaped\\"', '"a" trailing']) {
      expect(() => JSON.parse(raw)).toThrow();
      expect(() => parseJson(encoder.encode(raw))).toThrow("not valid UTF-8 JSON");
    }
  });

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

  test("large string values preserve syntax boundaries and retain numeric checks on both sides", () => {
    for (const text of ["x".repeat(2_499_000), '\\"9007199254740993 '.repeat(60_000)]) {
      const encoded = JSON.stringify(text);
      const raw = `[1.00,${encoded},1e-7]`;
      expect(encoder.encode(raw).length).toBeLessThan(2_500_000);
      expect(parseJson(encoder.encode(raw))).toEqual([1, text, 1e-7]);
      expect(() => parseJson(encoder.encode(`[${encoded},9007199254740993]`))).toThrow("cannot preserve");
      expect(() => parseJson(encoder.encode(`[9007199254740993,${encoded}]`))).toThrow("cannot preserve");
      expect(() => parseJson(encoder.encode(`[${encoded.slice(0, -1)}]`))).toThrow("not valid UTF-8 JSON");
    }
  });

});
