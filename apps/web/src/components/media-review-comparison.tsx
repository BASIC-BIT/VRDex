type MediaReviewComparisonProps = {
  candidateAlt: string;
  candidateSrc: string | null;
  currentAlt: string;
  currentSrc: string | null;
};

function ImageSlot({ alt, empty, src }: { alt: string; empty: string; src: string | null }) {
  return src ? (
    // These authenticated and fixture URLs are intentionally loaded directly.
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={alt} className="h-64 w-full rounded-lg bg-surface-raised object-contain" src={src} />
  ) : <div className="grid h-64 place-items-center rounded-lg bg-surface-raised text-sm text-muted">{empty}</div>;
}

export function MediaReviewComparison(props: MediaReviewComparisonProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <p className="mb-2 text-sm font-medium">Current</p>
        <ImageSlot alt={props.currentAlt} empty="No image" src={props.currentSrc} />
      </div>
      <div>
        <p className="mb-2 text-sm font-medium">Candidate</p>
        <ImageSlot alt={props.candidateAlt} empty="Unavailable" src={props.candidateSrc} />
      </div>
    </div>
  );
}
