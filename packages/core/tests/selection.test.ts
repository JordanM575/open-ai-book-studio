import { describe, expect, test } from "bun:test";
import { candidateFrom, chooseModel, type ModelCandidate } from "../src/providers/selection";
import type { ModelInfo } from "../src/providers/types";

const usable = (id: string, modelId: string): ModelCandidate => ({
  provider: "openrouter",
  connectionId: id,
  modelId,
  label: modelId,
  usable: true,
  reason: null
});

const blocked = (id: string, modelId: string, reason: string): ModelCandidate => ({
  provider: "openrouter",
  connectionId: id,
  modelId,
  label: modelId,
  usable: false,
  reason
});

describe("chooseModel", () => {
  test("a turn override wins over the book's saved model", () => {
    const result = chooseModel({
      turn: { connectionId: "conn_turn", modelId: "turn/model" },
      book: { connectionId: "conn_book", modelId: "book/model" },
      candidates: [usable("conn_book", "book/model"), usable("conn_turn", "turn/model")]
    });
    expect(result.source).toBe("turn");
    expect(result.choice?.modelId).toBe("turn/model");
  });

  test("the book's model is used when no turn override exists", () => {
    const result = chooseModel({
      book: { connectionId: "conn_book", modelId: "book/model" },
      candidates: [usable("conn_other", "other/model"), usable("conn_book", "book/model")]
    });
    expect(result.source).toBe("book");
    expect(result.choice?.modelId).toBe("book/model");
  });

  test("a blocked saved model falls back to the first usable one and keeps the reason", () => {
    const result = chooseModel({
      book: { connectionId: "conn_old", modelId: "old/model" },
      candidates: [blocked("conn_old", "old/model", "This model cannot use tools."), usable("conn_new", "new/model")]
    });
    expect(result.source).toBe("first");
    expect(result.choice?.modelId).toBe("new/model");
    expect(result.reason).toBe("This model cannot use tools.");
  });

  test("with nothing usable the result is empty and explained", () => {
    const result = chooseModel({ candidates: [blocked("conn_a", "a/model", "No context size.")] });
    expect(result.choice).toBeNull();
    expect(result.source).toBe("none");
    expect(result.reason).toBe("No connected model can run the writing agent yet.");
  });

  test("candidateFrom refuses unknown capabilities instead of guessing", () => {
    const info: ModelInfo = {
      id: "x",
      name: "X",
      contextLength: 1000,
      supportsTools: null,
      supportsImages: null,
      inputPricePerMillion: null,
      outputPricePerMillion: null
    };
    const candidate = candidateFrom({ provider: "openrouter", connectionId: "conn_x", modelId: "x" }, info, "X");
    expect(candidate.usable).toBe(false);
    expect(candidate.reason).toContain("cannot use tools");
    expect(candidateFrom({ provider: "openrouter", connectionId: "conn_x", modelId: "x" }, null, "X").usable).toBe(false);
  });
});
