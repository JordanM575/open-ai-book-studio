import { normalizeProviderError } from "@ai-book-studio/core/providers/errors";
import {
  imageGenerationEndpoint,
  imageRequestBody,
  parseImageResponse,
  type GeneratedImage,
  type ImageSize
} from "@ai-book-studio/core/providers/images";
import { ProviderError, type ConnectionSummary } from "@ai-book-studio/core/providers/types";
import type { ProviderService } from "./providers";

const GENERATE_TIMEOUT_MS = 120_000;

export interface GenerateImageInput {
  connectionId?: string;
  prompt: string;
  size?: ImageSize;
}

export interface GeneratedImageResult extends GeneratedImage {
  connectionLabel: string;
}

/**
 * The only path that asks Meta for an image. It reads the secret in main, returns bytes and
 * provenance, and never writes to the library; the IPC handler commits through `ImageStore`.
 */
export class ImageService {
  constructor(
    private readonly providers: ProviderService,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  async connections(): Promise<ConnectionSummary[]> {
    return (await this.providers.list()).filter((connection) => connection.provider === "meta");
  }

  async generate(input: GenerateImageInput): Promise<GeneratedImageResult> {
    const prompt = input.prompt.trim();
    if (!prompt || prompt.length > 4_000) {
      throw new ProviderError("invalid-request", "Write an image prompt between 1 and 4,000 characters.");
    }
    const available = await this.connections();
    const connection = input.connectionId
      ? available.find((entry) => entry.id === input.connectionId)
      : available[0];
    if (!connection) {
      throw new ProviderError(
        "invalid-request",
        "Connect Meta in Settings before generating an illustration."
      );
    }
    const credential = await this.providers.credential(connection.id);
    if (credential.provider !== "meta") {
      throw new ProviderError("unsupported", "This build can only generate images with a Meta connection.");
    }
    const size = input.size ?? "1024x1024";
    let response: Response;
    try {
      response = await this.fetchImpl(imageGenerationEndpoint(credential.metadata?.baseUrl), {
        method: "POST",
        headers: {
          authorization: `Bearer ${credential.secret}`,
          "content-type": "application/json"
        },
        body: JSON.stringify(imageRequestBody({ prompt, size })),
        signal: AbortSignal.timeout(GENERATE_TIMEOUT_MS)
      });
    } catch (error) {
      throw new ProviderError("offline", "Could not reach Meta to generate the image. Check your connection.", {
        provider: "meta",
        cause: error
      });
    }
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw normalizeProviderError({ provider: "meta", status: response.status, body });
    }
    const parsed = parseImageResponse(await response.json().catch(() => null), size);
    return { ...parsed, connectionLabel: credential.label };
  }
}
