import "./segmented-progress.css";

const SEGMENTS = 26;

export default function SegmentedProgress({ value, label = "Loading", className = "" }) {
  const determinate = Number.isFinite(value);
  const progress = determinate ? Math.max(0, Math.min(100, value)) : null;
  const filled = determinate ? Math.round((progress / 100) * SEGMENTS) : 0;
  return (
    <div
      className={`hm-segmented-progress ${determinate ? "" : "is-indeterminate"} ${className}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={progress ?? undefined}
    >
      {Array.from({ length: SEGMENTS }, (_, index) => (
        <span key={index} aria-hidden="true" data-filled={index < filled}
          style={{ "--segment-index": index }} />
      ))}
    </div>
  );
}
