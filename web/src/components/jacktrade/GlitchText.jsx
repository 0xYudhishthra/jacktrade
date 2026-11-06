import { useEffect, useState } from 'react';

// Selective glitch: briefly applies a glitch class on mount or when `trigger` changes.
// Respects prefers-reduced-motion (handled in CSS).
export function useGlitchOn(trigger, duration = 130) {
  const [active, setActive] = useState(false);
  useEffect(() => {
    if (trigger === undefined) return;
    setActive(true);
    const id = setTimeout(() => setActive(false), duration);
    return () => clearTimeout(id);
  }, [trigger, duration]);
  return active;
}

// Wraps children and glitches them when `trigger` changes.
export default function GlitchText({ children, trigger, className = '', duration = 130 }) {
  const active = useGlitchOn(trigger, duration);
  return (
    <span className={`${active ? 'hm-glitch-text' : ''} ${className}`}>{children}</span>
  );
}