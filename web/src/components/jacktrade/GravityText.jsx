import { useHoverGlitch } from "./HoverGlitch";

export default function GravityText({ text, reduced }) {
  const glitch = useHoverGlitch(text, reduced, { duration: 280, density: 0.25 });
  const words = glitch.display.split(" ");
  return (
    <>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true" onPointerEnter={(event) => { if (event.pointerType !== "touch") glitch.play(); }}>
        {text.split(" ").map((word, index) => (
          <span key={index}>
            {index > 0 && " "}
            <span className="pd-gravity-word">
              {Array.from(word, (letter, i) => (
                <span data-gravity-letter className="pd-gravity-letter" key={i}>
                  <span className="pd-glitch-size">{letter}</span>
                  <span className="pd-glitch-ink">{words[index]?.[i] ?? letter}</span>
                </span>
              ))}
            </span>
          </span>
        ))}
      </span>
    </>
  );
}
