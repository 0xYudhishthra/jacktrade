import { reduceMotion } from "@/lib/matrixMotion";
import { useEffect, useRef, useState } from "react";
import { useTradingSession } from "@/hooks/useTradingSession";
function mulberry32(a) { return () => { let t = a += 0x6D2B79F5; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const num = (value) => value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
import { MovingTape } from "./MatrixMovingTape";
const smoothstep = (from, to, value) => {
    const t = Math.max(0, Math.min(1, (value - from) / (to - from)));
    return t * t * (3 - 2 * t);
};
/** Existing rain glyphs briefly linger near a passing pointer. */
export function AsciiField() {
    const ref = useRef(null);
    useEffect(() => {
        const canvas = ref.current;
        const ctx = canvas.getContext("2d");
        if (!ctx)
            return;
        const media = matchMedia("(prefers-reduced-motion: reduce)");
        const random = mulberry32(8014);
        const glyphs = "0123456789.:=+<>/{}[]アイウエオカキクケコ";
        let w = 0, h = 0, cellX = 12, cellY = 15;
        let columns = [];
        const heldGlyphs = new Map();
        let raf = 0, last = 0, lastPaint = -Infinity, elapsed = 0;
        const pointer = { x: 0, y: 0, targetX: 0, targetY: 0, active: false, strength: 0, movedAt: -Infinity };
        let trail = [];
        const paint = () => {
            ctx.clearRect(0, 0, w, h);
            const now = performance.now();
            trail = trail.filter((point) => now - point.time < 1500);
            const memories = trail.map((point) => ({ ...point, strength: (1 - (now - point.time) / 1500) ** 1.5 * 0.5 }));
            for (const [key, glyph] of heldGlyphs)
                if (now - glyph.time >= 1200) heldGlyphs.delete(key);
            const nodes = [];
            columns.forEach((column, index) => {
                const x = index * cellX + cellX / 2 + Math.sin(elapsed * 0.00016 + column.phase) * 4;
                const head = Math.floor(column.y / cellY);
                ctx.font = `${column.size}px ui-monospace, monospace`;
                for (let offset = 0; offset < column.length; offset++) {
                    const y = (head - offset) * cellY;
                    if (y < -cellY || y > h + cellY)
                        continue;
                    // Broken runs and broad quiet bands keep the field from looking like a curtain.
                    if ((offset + column.breakAt) % 19 < column.gap) continue;
                    const fade = (1 - offset / column.length) ** 1.7;
                    const pulse = 0.85 + Math.sin(index * 2.7 + elapsed * 0.00045) * 0.15;
                    const band = 0.25 + (0.5 + Math.sin(x / Math.max(110, w * 0.12) + elapsed * 0.00007) * 0.5) ** 2 * 0.75;
                    const alpha = (offset === 0 ? 0.44 : 0.31 * fade + 0.018) * column.strength * pulse * band;
                    const distance = Math.hypot(x - pointer.x, y - pointer.y);
                    const currentInfluence = Math.max(0, 1 - distance / 185) * pointer.strength;
                    const memoryInfluence = memories.reduce((strength, point) => Math.max(strength,
                        Math.max(0, 1 - Math.hypot(x - point.x, y - point.y) / 110) * point.strength), 0);
                    const influence = Math.max(currentInfluence, memoryInfluence);
                    // Bend the falling columns locally, without changing their underlying flow.
                    const depth = Math.max(0, 1 - distance / 210) ** 2 * pointer.strength;
                    const push = Math.sin(Math.min(1, distance / 210) * Math.PI) * 10 * pointer.strength;
                    const angle = depth * 0.04;
                    const spread = 1 + push / Math.max(1, distance);
                    const dx = x - pointer.x, dy = y - pointer.y;
                    const drawX = pointer.x + (dx * Math.cos(angle) - dy * Math.sin(angle)) * spread;
                    const drawY = pointer.y + (dx * Math.sin(angle) + dy * Math.cos(angle)) * spread;
                    ctx.fillStyle =
                        offset === 0 ? `rgba(224,220,231,${(alpha + influence * 0.3) * (1 - depth * 0.16)})` : `rgba(182,155,220,${(alpha + influence * 0.42) * (1 - depth * 0.16)})`;
                    const glyphIndex = (((head - offset) % column.glyphs.length) + column.glyphs.length) %
                        column.glyphs.length;
                    const key = `${index}:${head - offset}`;
                    // Catch a scattered part of the rain itself, never add glyphs on the cursor path.
                    if (!heldGlyphs.has(key) && heldGlyphs.size < 120 && pointer.active &&
                        now - pointer.movedAt < 180 && distance < 65 && (index + head - offset) % 3 !== 0 && alpha > 0.025) {
                        heldGlyphs.set(key, {
                            x: drawX, y: drawY, glyph: column.glyphs[glyphIndex],
                            size: column.size, speed: column.speed, time: now,
                            alpha: Math.min(0.38, alpha + influence * 0.26),
                        });
                    }
                    if (heldGlyphs.has(key)) continue;
                    if (depth > 0.001) {
                        ctx.save();
                        ctx.translate(drawX, drawY);
                        ctx.rotate(angle);
                        ctx.scale(1 - depth * 0.1, 1 - depth * 0.1);
                        ctx.fillText(column.glyphs[glyphIndex], 0, 0);
                        ctx.restore();
                    } else ctx.fillText(column.glyphs[glyphIndex], drawX, drawY);
                    if (influence > 0.04 && offset % 4 === 0)
                        nodes.push({ x: drawX, y: drawY, distance, influence, currentInfluence });
                }
            });
            // A brief local pause, then the same captured rain resumes falling and blends away.
            heldGlyphs.forEach((glyph) => {
                const age = now - glyph.time;
                const release = smoothstep(450, 1200, age);
                const y = glyph.y + release * glyph.speed * 0.45;
                ctx.font = `${glyph.size}px ui-monospace, monospace`;
                ctx.fillStyle = `rgba(182,155,220,${glyph.alpha * (1 - smoothstep(750, 1200, age))})`;
                ctx.fillText(glyph.glyph, glyph.x, y);
                const distance = Math.hypot(glyph.x - pointer.x, y - pointer.y);
                const currentInfluence = Math.max(0, 1 - distance / 185) * pointer.strength;
                const memoryInfluence = memories.reduce((strength, point) => Math.max(strength,
                    Math.max(0, 1 - Math.hypot(glyph.x - point.x, y - point.y) / 110) * point.strength), 0);
                if (age < 750 && Math.max(currentInfluence, memoryInfluence) > 0.04)
                    nodes.push({ x: glyph.x, y, distance, currentInfluence, influence: Math.max(currentInfluence, memoryInfluence) });
            });
            // The original compact geometric cluster; no distant spokes.
            const nearby = nodes.filter((node) => node.currentInfluence > 0.04)
                .sort((a, b) => a.distance - b.distance).slice(0, 28);
            ctx.lineWidth = 0.65;
            const network = (group, opacity, strengthKey = "influence") => group.forEach((node, index) => {
                group.slice(index + 1)
                    .map((other) => ({ other, distance: Math.hypot(node.x - other.x, node.y - other.y) }))
                    .filter((edge) => edge.distance < 105)
                    .sort((a, b) => a.distance - b.distance)
                    .slice(0, 3)
                    .forEach(({ other, distance }) => {
                        ctx.strokeStyle = `rgba(182,155,220,${(1 - distance / 140) * Math.min(node[strengthKey], other[strengthKey]) * opacity})`;
                        ctx.beginPath();
                        ctx.moveTo(node.x, node.y);
                        ctx.lineTo(other.x, other.y);
                        ctx.stroke();
                    });
            });
            const echoes = [];
            for (const memory of [...memories].reverse()) {
                if (echoes.every((other) => Math.hypot(memory.x - other.x, memory.y - other.y) > 48)) echoes.push(memory);
                if (echoes.length === 4) break;
            }
            echoes.forEach((memory) => {
                const group = nodes.filter((node) => Math.hypot(node.x - memory.x, node.y - memory.y) < 110)
                    .sort((a, b) => Math.hypot(a.x - memory.x, a.y - memory.y) - Math.hypot(b.x - memory.x, b.y - memory.y))
                    .slice(0, 14);
                network(group, memory.strength * 0.6);
            });
            network(nearby, 0.5, "currentInfluence");
            nearby.slice(0, 4).forEach((node) => {
                ctx.strokeStyle = `rgba(182,155,220,${node.currentInfluence * 0.24})`;
                ctx.beginPath();
                ctx.moveTo(pointer.x, pointer.y);
                ctx.lineTo(node.x, node.y);
                ctx.stroke();
            });
        };
        const resize = () => {
            const previousHeight = h || canvas.clientHeight;
            w = canvas.clientWidth;
            h = canvas.clientHeight;
            const dpr = Math.min(devicePixelRatio, 2);
            canvas.width = Math.round(w * dpr);
            canvas.height = Math.round(h * dpr);
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            cellX = w < 700 ? 11 : 12;
            cellY = w < 700 ? 14 : 15;
            ctx.font = `${w < 700 ? 10 : 11}px ui-monospace, monospace`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            columns = Array.from({ length: Math.ceil(w / cellX) }, (_, i) => {
                const previous = columns[i];
                return {
                    y: previous ? (previous.y * h) / previousHeight : random() * (h + 700) - 350,
                    speed: previous?.speed ?? 24 + random() * 55,
                    length: previous?.length ?? 18 + Math.floor(random() * 30),
                    strength: previous?.strength ?? 0.3 + random() * 0.7,
                    size: previous?.size ?? 8 + random() * 3,
                    phase: previous?.phase ?? random() * Math.PI * 2,
                    breakAt: previous?.breakAt ?? Math.floor(random() * 19),
                    gap: previous?.gap ?? 3 + Math.floor(random() * 6),
                    glyphs: previous?.glyphs ??
                        Array.from({ length: 96 }, () => glyphs[Math.floor(random() * glyphs.length)]),
                };
            });
            heldGlyphs.clear();
            paint();
        };
        const draw = (time) => {
            const dt = last ? Math.min(time - last, 64) : 0;
            last = time;
            elapsed += dt;
            pointer.x += (pointer.targetX - pointer.x) * Math.min(1, dt / 70);
            pointer.y += (pointer.targetY - pointer.y) * Math.min(1, dt / 70);
            pointer.strength += ((pointer.active ? 1 : 0) - pointer.strength) * Math.min(1, dt / 120);
            columns.forEach((column) => {
                column.y += (column.speed * dt) / 1000;
                if (column.y - column.length * cellY > h)
                    column.y = -cellY * (2 + random() * 20);
            });
            if (time - lastPaint >= 1000 / 30) {
                paint();
                lastPaint = time;
            }
            raf = requestAnimationFrame(draw);
        };
        const sync = () => {
            cancelAnimationFrame(raf);
            last = 0;
            if (!reduceMotion(media) && !document.hidden)
                raf = requestAnimationFrame(draw);
            else {
                pointer.active = false;
                pointer.strength = 0;
                trail = [];
                heldGlyphs.clear();
                paint();
            }
        };
        const observer = new ResizeObserver(resize);
        const surface = canvas.parentElement;
        const move = (event) => {
            if (event.pointerType === "touch" || reduceMotion(media)) return;
            const rect = canvas.getBoundingClientRect();
            pointer.targetX = event.clientX - rect.left;
            pointer.targetY = event.clientY - rect.top;
            const now = performance.now();
            pointer.movedAt = now;
            const previous = trail.at(-1);
            if (!previous || (now - previous.time > 45 && Math.hypot(pointer.targetX - previous.x, pointer.targetY - previous.y) > 16))
                trail = [...trail.slice(-11), { x: pointer.targetX, y: pointer.targetY, time: now }];
            if (!pointer.active && pointer.strength < 0.01) {
                pointer.x = pointer.targetX;
                pointer.y = pointer.targetY;
            }
            pointer.active = true;
        };
        const leave = () => { pointer.active = false; };
        surface.addEventListener("pointermove", move);
        surface.addEventListener("pointerleave", leave);
        observer.observe(canvas);
        resize();
        sync();
        media.addEventListener("change", sync);
        document.addEventListener("visibilitychange", sync);
        return () => {
            cancelAnimationFrame(raf);
            observer.disconnect();
            surface.removeEventListener("pointermove", move);
            surface.removeEventListener("pointerleave", leave);
            media.removeEventListener("change", sync);
            document.removeEventListener("visibilitychange", sync);
        };
    }, []);
    return <canvas ref={ref} className="landing-ascii" aria-hidden="true"/>;
}
export function PriceTape() {
    const { livePrice, ticks: history, symbol } = useTradingSession();
    const [ticks, setTicks] = useState(() => history?.[symbol]?.length
      ? history[symbol].slice(-32).map((tick) => ({ t: tick.time, p: tick.price }))
      : Array.from({ length: 32 }, (_, i) => ({ t: Date.now() - (31 - i) * 1000, p: livePrice })));
    useEffect(() => setTicks(previous => [...previous.slice(-31), { t: Date.now(), p: livePrice }]), [livePrice]);
    return (<MovingTape items={ticks.slice(-32)} itemKey={(tick) => tick.t} renderItem={(tick) => (<>
          <span>{num(tick.p)}</span>
          <i>·</i>
        </>)} label="Live bitcoin price tape" className="landing-price-tape" speed={38} gap={28} estimate={100} latest/>);
}
