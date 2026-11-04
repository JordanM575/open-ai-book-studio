import type { ReactElement } from "react";
import {
  DOCX_FORMATTING_NOTE,
  describeLoss,
  describeLossPlaces,
  type ImportLossItem
} from "@ai-book-studio/core/manuscript-import";

interface Props {
  loss: ImportLossItem[];
  /** Distinguishes the preview's list from the result report's in tests. */
  testId: string;
}

/**
 * What a Word document's chapters cannot carry (D-183): each kind with its count, what
 * happened to it and where it was. The import preview and the result report show the
 * same list, so nothing is dropped without the author seeing it first.
 */
export function ImportLossList({ loss, testId }: Props): ReactElement {
  return (
    <section data-testid={testId} className="space-y-2">
      {loss.length > 0 ? (
        <>
          <h3 className="text-(length:--text-callout-size) font-medium">Changed or left out</h3>
          <ul className="space-y-1.5">
            {loss.map((item) => {
              const { label, outcome } = describeLoss(item);
              const places = describeLossPlaces(item);
              return (
                <li
                  key={item.kind}
                  data-testid={`${testId}-${item.kind}`}
                  className="text-(length:--text-caption-size) text-muted-foreground"
                >
                  <span className="font-medium text-foreground">{label}</span> · {outcome}
                  {places ? ` · ${places}` : null}
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
      <p role="note" className="text-(length:--text-caption-size) text-muted-foreground">
        {DOCX_FORMATTING_NOTE}
      </p>
    </section>
  );
}
