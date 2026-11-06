import { CharacterAvatar } from '@/components/jacktrade/TheHouseCharacter';

// Custom JACKTRADE notifications. Soft blue, but selected ones carry the darker character presence.
export default function NotificationStack({ items, onDismiss }) {
  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 w-[300px]">
      {items.map((n) => (
        <div
          key={n.id}
          className={`hm-toast-in hm-panel px-3.5 py-3 flex items-start gap-3 ${n.withCharacter ? 'hm-scanlines' : ''}`}
          style={
            n.withCharacter
              ? { background: 'linear-gradient(150deg, #2a2440 0%, #171722 100%)', border: '1px solid #494064' }
              : undefined
          }
        >
          {n.withCharacter && <CharacterAvatar size={36} glitchKey={n.id} />}
          <div className="flex flex-col gap-0.5 min-w-0 flex-1">
            <span
              className="text-[12px] font-semibold truncate"
              style={{ color: n.withCharacter ? '#E6ECFA' : 'var(--terminal-text)' }}
            >
              {n.title}
            </span>
            {n.message && (
              <span
                className="text-[11px] font-mono leading-snug"
                style={{ color: n.withCharacter ? '#B9A7EA' : 'var(--terminal-secondary)' }}
              >
                {n.withCharacter && '> '}{n.message}
              </span>
            )}
          </div>
          <button
            aria-label="Dismiss notification"
            onClick={() => onDismiss(n.id)}
            className="text-[14px] leading-none shrink-0"
            style={{ color: n.withCharacter ? '#9aa0c0' : '#9FC4EF' }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}