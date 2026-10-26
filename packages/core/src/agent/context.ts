import { z } from "zod";

/**
 * A prompt is measured in characters and converted to a deliberate estimate. The provider's reported
 * usage stays authoritative; this breakdown only explains where the request's size comes from.
 */
export const contextSectionSchema = z.object({
  id: z.string().min(1).max(40),
  label: z.string().min(1).max(80),
  characters: z.number().int().nonnegative(),
  estimatedTokens: z.number().int().nonnegative()
});

export const contextBreakdownSchema = z.object({
  estimated: z.literal(true),
  sections: z.array(contextSectionSchema).max(20),
  conversationTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative()
});

export type ContextSection = z.infer<typeof contextSectionSchema>;
export type ContextBreakdown = z.infer<typeof contextBreakdownSchema>;

export interface ContextSectionInput {
  id: string;
  label: string;
  text: string;
}

const CHARS_PER_TOKEN = 4;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function contextBreakdown(
  sections: ContextSectionInput[],
  conversationText: string
): ContextBreakdown {
  const measured = sections
    .filter((section) => section.text.length > 0)
    .map((section) => ({
      id: section.id,
      label: section.label,
      characters: section.text.length,
      estimatedTokens: estimateTokens(section.text)
    }));
  const conversationTokens = estimateTokens(conversationText);
  return {
    estimated: true,
    sections: measured,
    conversationTokens,
    totalTokens: measured.reduce((total, section) => total + section.estimatedTokens, conversationTokens)
  };
}
