/// <reference types="bun" />
import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import React from "react";
import { manualModel } from "@ai-book-studio/core/providers/manual";
import { bookSchema, type BookMeta } from "@ai-book-studio/core/schema";
import { mountDom, unmountDom } from "./support/dom";

let testing!: typeof import("@testing-library/react/pure");
let ModelPickerDialog!: typeof import("@ai-book-studio/app/components/ModelPickerDialog").ModelPickerDialog;

beforeAll(async () => {
  testing = await mountDom();
  ({ ModelPickerDialog } = await import("@ai-book-studio/app/components/ModelPickerDialog"));
});
afterAll(async () => {
  await unmountDom();
});

afterEach(() => testing.cleanup());

/**
 * 011 FR-007 in the model picker: a model the connection does not list can be entered by hand, is kept
 * only when the main process says it answered, and then behaves like a listed model, marked as entered
 * by hand, with every unknown fact in the picker's usual "not reported" words.
 */

const NOW = "2026-11-03T00:00:00.000Z";
const BOOK: BookMeta = bookSchema.parse({ id: "book_manual0001", title: "The Salt Road", createdAt: NOW, updatedAt: NOW });
const META = { id: "conn_metapick0001", provider: "meta", label: "Meta", kind: "api-key", createdAt: NOW };
const LISTED = {
  id: "listed-model",
  name: "Listed model",
  contextLength: 64_000,
  supportsTools: true,
  supportsImages: false,
  inputPricePerMillion: 1,
  outputPricePerMillion: 2
};

interface Options {
  models?: () => Promise<unknown>;
  addModel?: (connectionId: string, modelId: string) => Promise<unknown>;
  platform?: string;
}

function mockStudio(options: Options = {}) {
  const addModel = mock(
    options.addModel ?? (async (_connectionId: string, modelId: string) => ({ ok: true, data: manualModel("meta", modelId) }))
  );
  const models = mock(options.models ?? (async () => ({ ok: true, data: { models: [LISTED], fetchedAt: NOW } })));
  const edit = mock(async (_bookId: string, changes: Record<string, { to: unknown }>) => ({
    ok: true,
    data: {
      status: "saved",
      book: { ...BOOK, ...Object.fromEntries(Object.entries(changes).map(([key, change]) => [key, change.to])) }
    }
  }));
  (globalThis as unknown as { window: { studio: unknown } }).window.studio = {
    platform: options.platform ?? "darwin",
    providers: {
      list: mock(async () => ({ ok: true, data: [{ id: "meta", name: "Meta" }] })),
      models,
      addModel
    },
    connections: { list: mock(async () => ({ ok: true, data: [META] })) },
    books: { edit }
  };
  return { addModel, models, edit };
}

function renderPicker() {
  const onSaved = mock(() => {});
  testing.render(React.createElement(ModelPickerDialog, { open: true, book: BOOK, onClose: () => {}, onSaved }));
  return { view: testing.within(document.body), onSaved };
}

function button(view: ReturnType<typeof testing.within>, label: string): HTMLButtonElement {
  return view.getByText(label).closest("button") as HTMLButtonElement;
}

async function enterId(view: ReturnType<typeof testing.within>, id: string): Promise<void> {
  testing.fireEvent.change(view.getByLabelText("Model id"), { target: { value: id } });
  await testing.act(async () => {
    testing.fireEvent.click(view.getByTestId("manual-model-add"));
  });
}

describe("entering a model id by hand", () => {
  test("the listed path is unchanged until the author asks, then an unknown model shows what is not reported", async () => {
    const mocks = mockStudio();
    const { view } = renderPicker();
    await testing.waitFor(() => view.getByText("Listed model"));

    expect(view.queryByTestId("manual-model")).toBeNull();
    testing.fireEvent.click(view.getByTestId("enter-model-id"));
    const form = view.getByTestId("manual-model");
    expect(form.textContent).toContain("For a model this connection does not list.");
    expect(form.textContent).toContain("one short request with no book text");
    expect(form.textContent).toContain("Your provider may bill that request.");
    expect(view.queryByTestId("enter-model-id")).toBeNull();
    await testing.waitFor(() => expect(document.activeElement).toBe(view.getByLabelText("Model id")));

    await enterId(view, " vendor/unlisted ");

    expect(mocks.addModel).toHaveBeenCalledTimes(1);
    expect(mocks.addModel.mock.calls[0]).toEqual(["conn_metapick0001", "vendor/unlisted"]);
    await testing.waitFor(() => view.getByText("Entered by hand"));
    const row = button(view, "vendor/unlisted");
    expect(row.textContent).toContain("Context not reported · Price not reported");
    expect(row.textContent).toContain("Tools not reported · Pictures not reported");
    // Unknown tool support is treated conservatively, exactly as for a listed model.
    expect(row.disabled).toBe(true);
    expect(row.textContent).toContain("This provider does not say whether the model supports tools.");
    expect(view.getByTestId("manual-model-result").textContent).toBe(
      "vendor/unlisted answered, so it is saved on Meta. The writing agent cannot use it yet. This provider does not say whether the model supports tools."
    );
    expect(button(view, "Use this model").disabled).toBe(true);
  });

  test("a hand-entered Contributor model still waits for the book to opt in", async () => {
    const mocks = mockStudio();
    const { view, onSaved } = renderPicker();
    await testing.waitFor(() => view.getByText("Listed model"));
    testing.fireEvent.click(view.getByTestId("enter-model-id"));

    await enterId(view, "muse-spark-1.3-contributor");

    await testing.waitFor(() => view.getByText("Contributor mode"));
    expect(view.getByText("Muse Spark 1.3 Contributor").closest("button")?.textContent).toContain("Entered by hand");
    const use = button(view, "Use this model");
    expect(use.disabled).toBe(true);
    testing.fireEvent.click(view.getByTestId("allow-contributor"));
    await testing.waitFor(() => expect(use.disabled).toBe(false));
    testing.fireEvent.click(use);
    await testing.waitFor(() =>
      expect(mocks.edit).toHaveBeenCalledWith(BOOK.id, {
        defaultProvider: { from: null, to: "meta" },
        defaultConnectionId: { from: null, to: "conn_metapick0001" },
        defaultModelId: { from: null, to: "muse-spark-1.3-contributor" },
        allowContributorTraining: { from: false, to: true }
      })
    );
    expect(onSaved).toHaveBeenCalled();
  });

  test("a list that cannot be read opens the path by itself, and the checked model can be used", async () => {
    const mocks = mockStudio({
      models: async () => ({ ok: false, error: { code: "unknown", message: "The provider returned an unexpected response." } })
    });
    const { view } = renderPicker();

    await testing.waitFor(() => view.getByTestId("manual-model"));
    expect(view.getByRole("alert").textContent).toBe("The provider returned an unexpected response.");
    expect(view.getByTestId("manual-model").textContent).toContain(
      "This connection's model list could not be read, so enter the model id by hand."
    );
    expect(view.queryByTestId("enter-model-id")).toBeNull();

    await enterId(view, "muse-spark-1.3");

    await testing.waitFor(() => expect(button(view, "Use this model").disabled).toBe(false));
    expect(view.getByTestId("manual-model-result").textContent).toBe("Muse Spark 1.3 answered, so it is saved on Meta.");
    testing.fireEvent.click(button(view, "Use this model"));
    await testing.waitFor(() =>
      // Consent did not change here, so it is not sent: a choice made elsewhere is never put back.
      expect(mocks.edit).toHaveBeenCalledWith(BOOK.id, {
        defaultProvider: { from: null, to: "meta" },
        defaultConnectionId: { from: null, to: "conn_metapick0001" },
        defaultModelId: { from: null, to: "muse-spark-1.3" }
      })
    );
  });

  test("a model that does not answer is refused with the reason, and nothing is added", async () => {
    const reason = "This connection does not offer a model with that id. Check the spelling and that your account can use it.";
    mockStudio({ addModel: async () => ({ ok: false, error: { code: "not-found", message: reason } }) });
    const { view } = renderPicker();
    await testing.waitFor(() => view.getByText("Listed model"));
    testing.fireEvent.click(view.getByTestId("enter-model-id"));

    await enterId(view, "vendor/typo");

    await testing.waitFor(() => expect(view.getByTestId("manual-model-result").textContent).toBe(reason));
    expect(view.getByTestId("manual-model-result").getAttribute("role")).toBe("alert");
    expect(view.queryByText("Entered by hand")).toBeNull();
    expect(view.queryByText("vendor/typo")).toBeNull();
  });

  test("an id the connection already lists is chosen without sending anything", async () => {
    const mocks = mockStudio();
    const { view } = renderPicker();
    await testing.waitFor(() => view.getByText("Listed model"));
    testing.fireEvent.click(view.getByTestId("enter-model-id"));

    await enterId(view, "listed-model");

    expect(mocks.addModel).not.toHaveBeenCalled();
    expect(view.getByTestId("manual-model-result").textContent).toBe(
      "This connection already lists that model, so nothing was sent."
    );
    expect(button(view, "Use this model").disabled).toBe(false);
  });

  test("the browser build, which cannot run the writing agent, does not offer the path", async () => {
    mockStudio({
      platform: "web",
      models: async () => ({ ok: false, error: { code: "unknown", message: "The provider returned an unexpected response." } })
    });
    const { view } = renderPicker();
    await testing.waitFor(() => view.getByRole("alert"));

    expect(view.queryByTestId("enter-model-id")).toBeNull();
    expect(view.queryByTestId("manual-model")).toBeNull();
  });
});
