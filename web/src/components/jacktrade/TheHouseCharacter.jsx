import { useEffect, useState } from 'react';
import GlitchText from './GlitchText';

import CHARACTER_IMG from '@/assets/terminal-house-shanghai-v1.png';

// THE HOUSE — the protocol's counterparty, a digital consciousness living in the software.
// Darker, sharper, more mysterious than the surrounding soft blue UI. The contrast is intentional.
export function CharacterAvatar({ size = 64, glitchKey, className = '' }) {
  const [glitch, setGlitch] = useState(false);
  useEffect(() => {
    if (glitchKey === undefined) return;
    setGlitch(true);
    const id = setTimeout(() => setGlitch(false), 130);
    return () => clearTimeout(id);
  }, [glitchKey]);

  return (
    <div
      className={`relative overflow-hidden hm-scanlines ${glitch ? 'hm-glitch' : ''} ${className}`}
      style={{
        flexShrink: 0,
        width: size,
        height: size,
        borderRadius: 12,
        background: 'linear-gradient(160deg, #2a2440 0%, #171722 100%)',
        border: '1px solid #494064',
      }}
    >
      <img
        src={CHARACTER_IMG}
        alt="THE HOUSE"
        className="w-full h-full object-cover"
        style={{ objectPosition: 'center 13%', filter: 'saturate(0.6)', opacity: 0.96 }}
        draggable={false}
      />
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'linear-gradient(180deg, rgba(23,23,34,0) 55%, rgba(23,23,34,0.55) 100%)',
        }}
      />
      {glitch && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'repeating-linear-gradient(0deg, rgba(185,167,234,0.15) 0px, transparent 2px, rgba(188,232,255,0.1) 3px)',
          }}
        />
      )}
    </div>
  );
}

export function CharacterStatus({ glitchKey, message = 'waiting for your next move...' }) {
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <div className="flex items-center gap-1.5">
        <GlitchText trigger={glitchKey} className="text-[13px] font-bold tracking-wide" >
          <span style={{ color: '#E6ECFA' }}>THE HOUSE</span>
        </GlitchText>
      </div>
      <div className="flex items-center gap-1.5">
        <span
          className="inline-block w-1.5 h-1.5 rounded-full hm-pulse-dot"
          style={{ background: 'var(--terminal-up)' }}
        />
        <span className="text-[10px] font-medium uppercase tracking-wider" style={{ color: '#9aa0c0' }}>
          online
        </span>
      </div>
      <p className="text-[11px] leading-snug truncate" style={{ color: '#B9A7EA', fontFamily: 'JetBrains Mono, monospace' }}>
        “{message}”
      </p>
    </div>
  );
}

// Compact panel for the lower-left corner of the trading app.
export default function TheHouseCharacter({ glitchKey, message }) {
  return (
    <div
      className="hm-house-contact hm-scanlines flex items-center gap-3 p-3"
      style={{
        borderRadius: 14,
        background: 'linear-gradient(150deg, #2a2440 0%, #171722 100%)',
        border: '1px solid #494064',
        boxShadow: '0 4px 18px rgba(23,23,34,0.25)',
      }}
    >
      <CharacterAvatar size={90} glitchKey={glitchKey} />
      <CharacterStatus glitchKey={glitchKey} message={message} />
    </div>
  );
}