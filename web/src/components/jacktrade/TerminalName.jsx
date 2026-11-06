import { useEffect, useRef, useState } from "react";
import { reduceMotion } from "@/lib/matrixMotion";
import { GlitchGlyphs, useHoverGlitch } from "./HoverGlitch";

const NAME = "jacktrade";

export function useTerminalMotion() {
  const [reduced, setReduced] = useState(() =>
    reduceMotion(matchMedia("(prefers-reduced-motion: reduce)")),
  );
  useEffect(() => {
    const query = matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(reduceMotion(query));
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  return reduced;
}

export default function TerminalName({ loop = true, reduced = false }) {
  const [visible, setVisible] = useState(reduced ? NAME : "");
  const [hovered, setHovered] = useState(false);
  const interacted = useRef(false);
  const glitch = useHoverGlitch(NAME, reduced);
  const paused = hovered || glitch.active;
  useEffect(() => {
    if (reduced) {
      setVisible(NAME);
      return;
    }
    if (paused) return;
    let timer;
    let length = interacted.current ? NAME.length : 0;
    let deleting = interacted.current;
    setVisible(NAME.slice(0, length));
    const step = () => {
      length += deleting ? -1 : 1;
      setVisible(NAME.slice(0, length));
      let delay = deleting ? 55 : 95;
      if (length === NAME.length) {
        if (!loop) return;
        deleting = true;
        delay = 1700;
      } else if (length === 0) {
        deleting = false;
        delay = 420;
      }
      timer = setTimeout(step, delay);
    };
    timer = setTimeout(step, interacted.current ? 1700 : 100);
    return () => clearTimeout(timer);
  }, [loop, reduced, paused]);
  return (
    <span className="pd-terminal-name"
      onPointerEnter={(event) => {
        if (reduced || event.pointerType === "touch") return;
        interacted.current = true;
        setHovered(true);
        glitch.play();
      }}
      onPointerLeave={() => setHovered(false)}
    >
      <span className="sr-only">{NAME}</span>
      <span className="pd-terminal-name-visible" aria-hidden="true">
        {paused ? <GlitchGlyphs text={NAME} display={glitch.display} /> : visible}
        <i className="pd-block-cursor" />
      </span>
    </span>
  );
}
