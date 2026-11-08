import { z } from "zod";
import { assertReviewData, digestJson, freeze, hashSchema, idSchema, requireContract, REVIEW_LIMITS, textSchema, versionSchema, withinScalarLimit, type Immutable } from "./contract";

export const categorySchema = z.enum(["reader-impression", "clarity", "pacing", "character-motivation", "continuity"]);
const profileContentSchema = z.strictObject({
  name: textSchema.refine((s) => s.length > 0), purpose: textSchema,
  focus: z.array(categorySchema).min(1).max(5).refine((values) => new Set(values).size === values.length),
  guidance: textSchema.refine((s) => withinScalarLimit(s, REVIEW_LIMITS.guidanceScalars))
});
export const profileSchema = profileContentSchema.extend({
  id: idSchema, origin: z.enum(["builtin", "author"]), version: versionSchema, digest: hashSchema
});
export type ReaderProfile = Immutable<z.infer<typeof profileSchema>>;
export type ProfileContent = z.infer<typeof profileContentSchema>;

const builtins: Record<"alpha" | "beta", ProfileContent> = {
  alpha: { name: "Alpha reader", purpose: "A fictional editorial lens for structure, motivation and clarity.",
    focus: ["clarity", "character-motivation"], guidance: "Discuss structure, character motivation and clarity as subjective interpretations." },
  beta: { name: "Beta reader", purpose: "A fictional editorial lens for reading experience, pacing and remaining confusion.",
    focus: ["reader-impression", "pacing", "clarity"], guidance: "Discuss reading experience, pacing and remaining confusion as subjective impressions." }
};

export async function builtinReaderProfile(lens: "alpha" | "beta"): Promise<ReaderProfile> {
  requireContract(lens === "alpha" || lens === "beta", "unknown-reader");
  return buildProfile({ ...builtins[lens], id: `reader-${lens}`, origin: "builtin", version: 1 });
}

async function buildProfile(input: Omit<z.infer<typeof profileSchema>, "digest">): Promise<ReaderProfile> {
  const parsed = profileSchema.omit({ digest: true }).parse(input);
  return freeze({ ...parsed, digest: await digestJson(profileContentSchema.parse({
    name: parsed.name, purpose: parsed.purpose, focus: parsed.focus, guidance: parsed.guidance
  })) });
}

export async function validateReaderProfile(input: unknown): Promise<ReaderProfile> {
  assertReviewData(input);
  const profile = profileSchema.parse(input);
  const { digest, ...rest } = profile;
  requireContract((await buildProfile(rest)).digest === digest, "profile-digest");
  if (profile.origin === "builtin") {
    requireContract(profile.id === "reader-alpha" || profile.id === "reader-beta", "unknown-reader");
    const builtin = await builtinReaderProfile(profile.id === "reader-alpha" ? "alpha" : "beta");
    requireContract(profile.version === 1 && profile.digest === builtin.digest, "builtin-reader-changed");
  } else requireContract(!profile.id.startsWith("reader-"), "reserved-reader-id");
  return freeze(profile);
}

/** Built-in edits fork to a host-generated author ID. Author edits retain lineage and increment. */
export async function editReaderProfile(previousInput: ReaderProfile, content: ProfileContent, authorId?: string): Promise<ReaderProfile> {
  assertReviewData(content);
  const parsed = profileContentSchema.parse(content);
  const previous = await validateReaderProfile(previousInput);
  const id = previous.origin === "builtin" ? idSchema.parse(authorId) : previous.id;
  requireContract(!id.startsWith("reader-"), "reserved-reader-id");
  if (previous.origin === "author") requireContract(authorId === undefined || authorId === previous.id, "profile-lineage");
  return buildProfile({ ...parsed, id, origin: "author", version: previous.origin === "builtin" ? 1 : previous.version + 1 });
}
