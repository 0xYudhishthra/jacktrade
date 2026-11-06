import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";

export function useHoverGlitch(text, reduced, { duration = 560, density = 1 } = {}) {
  const [scrambled, setScrambled] = useState(null);
  const frame = useRef(0);
  useEffect(() => {
    cancelAnimationFrame(frame.current);
    setScrambled(null);
    return () => cancelAnimationFrame(frame.current);
  }, [text, reduced]);

  const play = useCallback(() => {
    if (reduced) return;
    cancelAnimationFrame(frame.current);
    const start = performance.now();
    let last = -Infinity;
    const draw = (now) => {
      const progress = Math.min((now - start) / duration, 1);
      if (progress === 1) {
        setScrambled(null);
        return;
      }
      if (now - last >= 36) {
        const resolved = Math.floor(progress * text.length);
        setScrambled(Array.from(text, (letter, i) => {
          if (i < resolved || !/[a-z]/i.test(letter) || Math.random() > density) return letter;
          const alphabet = letter === letter.toUpperCase()
            ? "ABCDEFGHIJKLMNOPQRSTUVWXYZ" : "abcdefghijklmnopqrstuvwxyz";
          return alphabet[Math.floor(Math.random() * alphabet.length)];
        }).join(""));
        last = now;
      }
      frame.current = requestAnimationFrame(draw);
    };
    draw(start);
  }, [text, reduced, duration, density]);

  return { display: scrambled ?? text, active: scrambled !== null, play };
}

// Reserve each original glyph's width so scrambling cannot move the layout.
export function GlitchGlyphs({ text, display }) {
  return (
    <span className="pd-glitch-glyphs" aria-hidden="true">
      {Array.from(text, (letter, i) => (
        <span className="pd-glitch-glyph" key={i}>
          <span className="pd-glitch-size">{letter}</span>
          <span className="pd-glitch-ink">{display[i] ?? letter}</span>
        </span>
      ))}
    </span>
  );
}

export function LandingGlitchLink({ text, reduced, ...props }) {
  const glitch = useHoverGlitch(text, reduced);
  return (
    <Link {...props}
      onPointerEnter={(event) => { if (event.pointerType !== "touch") glitch.play(); }}
      onFocus={glitch.play}
    >
      <span data-gravity="action">
        <span className="sr-only">{text}</span>
        <GlitchGlyphs text={text} display={glitch.display} />
      </span>
    </Link>
  );
}
