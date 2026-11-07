export function JacktradeMark({ className = "", size = 28 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={`jt-brand-icon ${className}`}
      aria-hidden="true"
    >
      <rect x="2" y="2" width="28" height="28" rx="8" fill="#245EDC" />
      <rect x="2" y="2" width="28" height="28" rx="8" fill="url(#hmg)" fillOpacity="0.5" />
      <path
        d="M9 22V12.5L16 8l7 4.5V22h-4v-5h-6v5H9z"
        fill="#F8FBFF"
        stroke="#245EDC"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <circle cx="16" cy="14.5" r="1.4" fill="#B9A7EA" />
      <defs>
        <linearGradient id="hmg" x1="2" y1="2" x2="30" y2="30" gradientUnits="userSpaceOnUse">
          <stop stopColor="#BCE8FF" />
          <stop offset="1" stopColor="#3B83D5" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export function JacktradeWordmark({ className = "" }) {
  return <span className={`jt-brand-wordmark ${className}`}>JackTrade</span>;
}

export function JacktradeSparkle({ className = "" }) {
  return (
    <svg viewBox="0 0 24 24" className={`jt-brand-sparkle ${className}`} aria-hidden="true">
      <path
        d="M12 0 C13 8 16 11 24 12 C16 13 13 16 12 24 C11 16 8 13 0 12 C8 11 11 8 12 0Z"
        fill="currentColor"
      />
    </svg>
  );
}

export default function JacktradeLogo({ size = 28, withWordmark = true, className = "" }) {
  return (
    <span className={`jt-brand-logo inline-flex items-center gap-1 ${className}`}>
      {withWordmark ? (
        <>
          <span className="jt-eastern-seal" lang="zh-Hans" aria-hidden="true">
            屋
          </span>
          <JacktradeWordmark />
          <JacktradeSparkle />
        </>
      ) : (
        <JacktradeMark size={size} />
      )}
    </span>
  );
}
