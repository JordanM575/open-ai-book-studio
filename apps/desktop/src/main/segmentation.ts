import {
  decodeMaskToRaster,
  parseImageStream,
  recordsOfKind,
  type ResponsesEvent
} from "@meta-sam/parser";
import { normalizeProviderError } from "@ai-book-studio/core/providers/errors";
import { segmentPromptError, type SegmentationMatch, type SegmentationResult } from "@ai-book-studio/core/images/segmentation";
import { ProviderError, type ConnectionSummary } from "@ai-book-studio/core/providers/types";
import type { ProviderService } from "./providers";

const SEGMENT_TIMEOUT_MS = 120_000;
const SAM_MODEL = "sam-3.1";

export interface SegmentInput {
  connectionId?: string;
  prompt: string;
  bytes: Uint8Array;
  mimeType: string;
}

/**
 * The only path that asks Meta to segment an image. The parser is the official
 * `@meta-sam/parser`, so the base85/one-bit mask codec is not reimplemented here.
 */
export class SegmentationService {
  constructor(
    private readonly providers: ProviderService,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  async connections(): Promise<ConnectionSummary[]> {
    return (await this.providers.list()).filter((connection) => connection.provider === "meta");
  }

  async segment(input: SegmentInput): Promise<SegmentationResult> {
    const prompt = input.prompt.trim();
    const promptError = segmentPromptError(prompt);
    if (promptError) throw new ProviderError("invalid-request", promptError);
    if (input.bytes.byteLength === 0 || input.bytes.byteLength > 20 * 1024 * 1024) {
      throw new ProviderError("invalid-request", "The source image must be between 1 byte and 20 MB.");
    }
    const available = await this.connections();
    const connection = input.connectionId
      ? available.find((entry) => entry.id === input.connectionId)
      : available[0];
    if (!connection) {
      throw new ProviderError("invalid-request", "Connect Meta in Settings before making a cutout.");
    }
    const credential = await this.providers.credential(connection.id);
    const baseUrl = credential.metadata?.baseUrl;
    if (credential.provider !== "meta" || !baseUrl) {
      throw new ProviderError("unsupported", "This build can only segment images with a Meta connection.");
    }
    const endpoint = `${baseUrl.replace(/\/+$/, "")}/responses`;
    let response: Response;
    try {
      response = await this.fetchImpl(endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${credential.secret}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model: SAM_MODEL,
          input: [
            {
              type: "message",
              role: "user",
              content: [
                { type: "input_text", text: prompt },
                {
                  type: "input_image",
                  image_url: `data:${input.mimeType};base64,${Buffer.from(input.bytes).toString("base64")}`
                }
              ]
            }
          ],
          stream: false,
          metadata: { mask_encoding: "one_bit", include_confidence: "true" }
        }),
        signal: AbortSignal.timeout(SEGMENT_TIMEOUT_MS)
      });
    } catch (error) {
      throw new ProviderError("offline", "Could not reach Meta to segment the image. Check your connection.", {
        provider: "meta",
        cause: error
      });
    }
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw normalizeProviderError({ provider: "meta", status: response.status, body });
    }
    const text = outputText(await response.json().catch(() => null));
    if (text === null) throw new ProviderError("unknown", "Meta returned no segmentation output.");
    const result = await parseImageStream(eventsFor(text)).finalResult;
    const matches: SegmentationMatch[] = recordsOfKind(result.records, "mask").map((record) => ({
      objectId: record.objectId,
      confidence: record.confidence ?? null,
      width: record.mask.width,
      height: record.mask.height,
      bounds: {
        left: record.bounds.left,
        top: record.bounds.top,
        right: record.bounds.right,
        bottom: record.bounds.bottom
      },
      raster: decodeMaskToRaster(record.mask)
    }));
    return { prompt, model: SAM_MODEL, matches, costUsd: null };
  }
}

/** A non-streaming Responses response carries the same text in a message item. */
export function outputText(payload: unknown): string | null {
  const body = payload as {
    output_text?: unknown;
    output?: Array<{ type?: unknown; content?: Array<{ type?: unknown; text?: unknown }> }>;
  } | null;
  if (typeof body?.output_text === "string") return body.output_text;
  for (const item of body?.output ?? []) {
    if (item.type !== "message" || !Array.isArray(item.content)) continue;
    for (const part of item.content) {
      if (part.type === "output_text" && typeof part.text === "string") return part.text;
    }
  }
  return null;
}

async function* eventsFor(text: string): AsyncGenerator<ResponsesEvent> {
  yield {
    type: "response.output_text.done",
    text,
    item_id: "segmentation",
    output_index: 0,
    content_index: 0
  };
  yield { type: "response.completed" };
}
