import { inspectImage, type ImageFormat, type ImageInspection } from "../images/schema";
import { ProviderError } from "./types";

export const META_IMAGE_MODEL = "muse-image-1.0";
export const IMAGE_COST_USD = 0.01;
export const IMAGE_SIZES = ["1024x1024", "1536x1024", "1024x1536", "1792x1024", "1024x1792"] as const;
export type ImageSize = (typeof IMAGE_SIZES)[number];

export interface ImageRequest {
  prompt: string;
  size?: ImageSize;
}

export interface GeneratedImage {
  bytes: Uint8Array;
  inspection: ImageInspection;
  model: string;
  size: string;
  costUsd: number;
  usage: { inputTokens: number | null; outputTokens: number | null } | null;
}

/** Meta's image endpoints are OpenAI-compatible; the base URL includes the version. */
export function imageGenerationEndpoint(baseUrl: string | undefined): string {
  const base = normalizeBase(baseUrl);
  return `${base}/images/generations`;
}

export function imageRequestBody(request: ImageRequest): Record<string, unknown> {
  return {
    model: META_IMAGE_MODEL,
    prompt: request.prompt,
    n: 1,
    size: request.size ?? "1024x1024",
    response_format: "b64_json",
    output_format: "png",
    reasoning_strength: "low"
  };
}

export function parseImageResponse(payload: unknown, size: string): GeneratedImage {
  const body = payload as {
    data?: Array<{ b64_json?: unknown }>;
    output_format?: unknown;
    usage?: { input_tokens?: unknown; output_tokens?: unknown };
  } | null;
  const encoded = body?.data?.[0]?.b64_json;
  if (typeof encoded !== "string" || !encoded.trim()) {
    throw new ProviderError("unknown", "Meta returned no image data.");
  }
  let bytes: Uint8Array;
  try {
    bytes = decodeBase64(encoded);
  } catch {
    throw new ProviderError("unknown", "Meta returned image data that could not be decoded.");
  }
  const inspection = inspectImage(bytes);
  if (!inspection) {
    throw new ProviderError("unknown", "Meta returned a file that is not a complete image.");
  }
  const format = typeof body?.output_format === "string" ? body.output_format : null;
  if (format && !formatMatches(format, inspection.format)) {
    throw new ProviderError("unknown", "Meta returned an image in a different format than the request.");
  }
  return {
    bytes,
    inspection,
    model: META_IMAGE_MODEL,
    size,
    costUsd: IMAGE_COST_USD,
    usage: body?.usage
      ? {
          inputTokens: numberOrNull(body.usage.input_tokens),
          outputTokens: numberOrNull(body.usage.output_tokens)
        }
      : null
  };
}

function normalizeBase(baseUrl: string | undefined): string {
  const raw = baseUrl?.trim();
  if (!raw) throw new ProviderError("invalid-request", "Meta needs a base URL before it can generate images.");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ProviderError("invalid-request", "The Meta base URL is not a valid address.");
  }
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new ProviderError("invalid-request", "Use an https address for Meta's base URL.");
  }
  return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
}

function decodeBase64(value: string): Uint8Array {
  if (typeof atob !== "function") throw new Error("Base64 decoding is unavailable.");
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function formatMatches(reported: string, actual: ImageFormat): boolean {
  if (reported === "jpg") return actual === "jpeg";
  return reported === actual;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}
