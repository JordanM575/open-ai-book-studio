import type { ReviewEnvelope } from "@ai-book-studio/core/review/envelope";
import type { ReaderProfile } from "@ai-book-studio/core/review/profiles";
import type { PreparedReaderReview } from "./contracts";

export const reviewActionClass = "min-h-11 whitespace-normal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]";
export const reviewTextClass = "whitespace-pre-wrap break-words text-(length:--text-subheadline-size)";

export function ProfileAttribution({ profile }: { profile: ReaderProfile }) {
  return <div className="space-y-2">
    <p className="font-semibold">{profile.name} · Version {profile.version} · {profile.origin === "builtin" ? "Fictional built-in lens" : "Author profile"}</p>
    <p className="text-muted-foreground">Profile identity: {profile.id}</p>
    <p className={reviewTextClass}>{profile.purpose}</p>
    <p>Focus: {profile.focus.map((category) => category.replaceAll("-", " ")).join(" · ")}</p>
    <details><summary className={reviewActionClass}>Read profile guidance</summary><p className={reviewTextClass}>{profile.guidance || "No additional guidance."}</p></details>
  </div>;
}

export function SelectedScope({ envelope }: { envelope: ReviewEnvelope }) {
  return <ul className="space-y-4" aria-label="Exact selected saved scope">
    {envelope.sources.map((source) => <li key={source.sourceId} className="space-y-2">
      {source.kind === "chapter" ? <>
        <p className="font-semibold">{source.bookTitle} · Chapter {source.position}: {source.title}</p>
        <p className="text-muted-foreground">Saved version {source.identity.version} · Captured {source.capturedAt}</p>
        {source.segments.map((segment) => <div key={segment.start}>
          <p>Lines {segment.startLine}–{segment.startLine + segment.text.slice(0, -1).split("\n").length - 1} · UTF-16 range [{segment.start}, {segment.end})</p>
          <pre className={reviewTextClass}>{segment.text}</pre>
        </div>)}
      </> : <>
        <p className="font-semibold">{source.bookTitle} · Story Bible · {source.label}</p>
        <p className="text-muted-foreground">Selected field · Captured {source.capturedAt}</p>
        <pre className={reviewTextClass}>{source.text}</pre>
      </>}
    </li>)}
  </ul>;
}

export function ReviewDisclosure({ prepared }: { prepared: PreparedReaderReview }) {
  const { envelope, terms } = prepared;
  const { environment } = envelope;
  return <section aria-label="Outgoing review disclosure" className="space-y-4">
    <h3 className="font-semibold">Inspect what will be sent</h3>
    <p>{envelope.destination.provider} · {envelope.destination.model}</p>
    <p>Connection: {envelope.destination.connectionId} · Destination: {envelope.destination.endpointIdentity}</p>
    <p>{environment.estimatedCostUsd === null ? "Estimated cost: Unknown" : `Estimated cost: USD ${environment.estimatedCostUsd} · Not a spending cap`}</p>
    <p className="text-muted-foreground">Price facts: {environment.priceAsOf ?? "Unknown"} · Context fit: Unknown</p>
    <p>Catalog context: {environment.catalogContextTokens === null ? "Unknown" : `${environment.catalogContextTokens} tokens`} · Catalog facts: {environment.catalogAsOf ?? "Unknown"}</p>
    <p>Destination readiness: {environment.hostSupported && environment.connectionAvailable && environment.modelSupported ? "Available" : "Unavailable"}</p>
    {envelope.profile ? <ProfileAttribution profile={envelope.profile} /> : null}
    <SelectedScope envelope={envelope} />
    <div><h4 className="font-semibold">Review request</h4><p className={reviewTextClass}>{envelope.prompt || "No additional request."}</p></div>
    <div><h4 className="font-semibold">Selected prior feedback</h4>
      {envelope.priorFeedback.length === 0 ? <p>None selected.</p> : envelope.priorFeedback.map((feedback) =>
        <div key={feedback.id}><p>{feedback.label} · Run {feedback.runId}</p><p className={reviewTextClass}>{feedback.text}</p></div>)}
    </div>
    {terms.map((term) => <div key={term.bookId} className="space-y-2">
      <h4 className="font-semibold">{envelope.books.find((book) => book.bookId === term.bookId)?.title} · Provider terms</h4>
      <p className={reviewTextClass}>Data use: {term.dataUse}</p>
      <p className={reviewTextClass}>Training: {term.training}</p>
      <p>Terms revision: {term.termsRevision} · Required consent: {envelope.books.find((book) => book.bookId === term.bookId)?.consentSatisfied ? "Satisfied" : "Missing"}</p>
    </div>)}
    <p className="text-muted-foreground">Only this selected saved text, profile, request and selected feedback are included. Starting may incur cost. No automatic retry or model fallback.</p>
  </section>;
}
