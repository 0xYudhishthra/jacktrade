import { reduceMotion } from "@/lib/matrixMotion";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
/** Pixel-based motion: incoming data never reflows the items already on screen. */
export function MovingTape({ items, itemKey, renderItem, className = "", label, paused = false, speed = 38, gap = 28, estimate = 110, latest = false, }) {
    const initial = useRef(null);
    if (!initial.current) {
        const count = Math.ceil(window.innerWidth / (estimate + gap)) + 1;
        initial.current = items
            .slice(-count)
            .map((item, i) => ({ id: i, item, x: i * (estimate + gap), width: estimate }));
    }
    const engine = useRef(initial.current);
    const [entries, setEntries] = useState(initial.current.map(({ id, item }) => ({ id, item })));
    const container = useRef(null);
    const nodes = useRef(new Map());
    const source = useRef(items);
    const pending = useRef([]);
    const seen = useRef(new Set(items.map(itemKey)));
    const nextId = useRef(initial.current.length);
    const fallback = useRef(0);
    const aligned = useRef(false);
    const [layoutWidth, setLayoutWidth] = useState(0);
    source.current = items;
    useEffect(() => {
        for (const item of items) {
            const key = itemKey(item);
            if (!seen.current.has(key)) {
                pending.current.push(item);
                seen.current.add(key);
            }
        }
        pending.current = pending.current.slice(-120);
        if (seen.current.size > 1000)
            seen.current = new Set(items.map(itemKey));
    }, [items, itemKey]);
    useLayoutEffect(() => {
        if (!aligned.current) {
            let x = 0;
            for (const entry of engine.current) {
                const node = nodes.current.get(entry.id);
                if (node)
                    entry.width = node.offsetWidth;
                entry.x = x;
                if (node)
                    node.style.transform = `translate3d(${x}px,-50%,0)`;
                x += entry.width + gap;
            }
            aligned.current = true;
        }
        // Fill a resized viewport even when reduced motion or Pause stops the RAF.
        const last = engine.current[engine.current.length - 1];
        const edge = last ? last.x + last.width + gap : 0;
        const width = container.current?.clientWidth ?? layoutWidth;
        if (edge < width + estimate && source.current.length) {
            const item = latest
                ? source.current[source.current.length - 1]
                : (pending.current.shift() ?? source.current[fallback.current++ % source.current.length]);
            engine.current.push({ id: nextId.current++, item, x: edge, width: estimate });
            setEntries(engine.current.map(({ id, item }) => ({ id, item })));
        }
    }, [entries, gap, estimate, latest, layoutWidth]);
    useEffect(() => {
        const host = container.current;
        if (!host)
            return;
        let width = host.clientWidth, raf = 0, previous = 0;
        const media = matchMedia("(prefers-reduced-motion: reduce)");
        const observer = new ResizeObserver(() => {
            width = host.clientWidth;
            setLayoutWidth(width);
        });
        observer.observe(host);
        const draw = (time) => {
            const delta = previous ? Math.min((time - previous) / 1000, 0.064) : 0;
            previous = time;
            for (const entry of engine.current) {
                entry.x -= speed * delta;
                const node = nodes.current.get(entry.id);
                if (node)
                    node.style.transform = `translate3d(${entry.x.toFixed(2)}px,-50%,0)`;
            }
            const next = engine.current.filter((entry) => entry.x + entry.width > -24);
            let changed = next.length !== engine.current.length;
            const edge = next.length ? next[next.length - 1].x + next[next.length - 1].width + gap : 0;
            if (edge < width + estimate && source.current.length) {
                const item = latest
                    ? source.current[source.current.length - 1]
                    : (pending.current.shift() ?? source.current[fallback.current++ % source.current.length]);
                next.push({ id: nextId.current++, item, x: edge, width: estimate });
                changed = true;
            }
            engine.current = next;
            if (changed)
                setEntries(next.map(({ id, item }) => ({ id, item })));
            raf = requestAnimationFrame(draw);
        };
        const sync = () => {
            cancelAnimationFrame(raf);
            previous = 0;
            host.dataset.reducedMotion = String(reduceMotion(media));
            if (!paused && !reduceMotion(media) && !document.hidden)
                raf = requestAnimationFrame(draw);
        };
        media.addEventListener("change", sync);
        document.addEventListener("visibilitychange", sync);
        sync();
        return () => {
            cancelAnimationFrame(raf);
            observer.disconnect();
            media.removeEventListener("change", sync);
            document.removeEventListener("visibilitychange", sync);
        };
    }, [paused, speed, gap, estimate, latest]);
    return (<div ref={container} className={`moving-tape ${className}`} role="group" aria-label={label} aria-live="off">
      {entries.map((entry) => (<span key={entry.id} className="moving-tape-item" ref={(node) => {
                if (!node) {
                    nodes.current.delete(entry.id);
                    return;
                }
                nodes.current.set(entry.id, node);
                const model = engine.current.find((e) => e.id === entry.id);
                if (model) {
                    model.width = node.offsetWidth;
                    node.style.transform = `translate3d(${model.x.toFixed(2)}px,-50%,0)`;
                }
            }}>
          {renderItem(entry.item)}
        </span>))}
    </div>);
}
