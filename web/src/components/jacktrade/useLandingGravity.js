import { useEffect } from "react";

const clamp = (n) => Math.max(-1, Math.min(1, n));
const identity = () => ({ x: 0, y: 0, rx: 0, ry: 0, rz: 0, skewX: 0, skewY: 0, scale: 0, z: 0, well: 0 });

export function useLandingGravity(ref, reduced) {
  useEffect(() => {
    const root = ref.current;
    if (!root || reduced) return;
    const surfaces = Array.from(root.querySelectorAll("[data-gravity]"), (element) => {
      const filter = document.getElementById(element.dataset.gravityFilter);
      return { element, rect: null, current: identity(), letters: [],
        image: filter?.querySelector("feImage"), displacement: filter?.querySelector("feDisplacementMap") };
    });
    const pointer = { x: 0, y: 0, active: false };
    let raf = 0, last = 0;
    const measure = () => {
      surfaces.forEach((surface) => {
        surface.element.style.transform = "";
        surface.element.style.filter = "";
        surface.element.querySelectorAll("[data-gravity-letter]").forEach((letter) => { letter.style.transform = ""; });
      });
      surfaces.forEach((surface) => {
        surface.rect = surface.element.getBoundingClientRect();
        surface.letters = Array.from(surface.element.querySelectorAll("[data-gravity-letter]"), (element) => {
          const rect = element.getBoundingClientRect();
          return { element, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, current: 0 };
        });
      });
    };
    const frame = (time) => {
      const ease = 1 - Math.exp(-Math.min(last ? time - last : 16, 64) / (pointer.active ? 110 : 220));
      last = time;
      let moving = false;
      surfaces.forEach(({ element, rect, current, letters, image, displacement }) => {
        const target = identity();
        const preview = element.dataset.gravity === "preview";
        if (pointer.active && rect.width) {
          const dx = pointer.x - rect.x - rect.width / 2;
          const dy = pointer.y - rect.y - rect.height / 2;
          const outside = Math.hypot(Math.max(0, Math.abs(dx) - rect.width / 2), Math.max(0, Math.abs(dy) - rect.height / 2));
          const influence = preview ? Math.max(0, 1 - outside / 180) * Math.min(1, rect.width / 650) : 0.1 + Math.max(0, 1 - outside / 160) * 0.9;
          const nx = clamp(dx / (rect.width / 2));
          const ny = clamp(dy / (rect.height / 2));
          const weight = element.dataset.gravity === "action" ? 0.6 : 1;
          // Pull inward when the right edge comes forward, keeping the stronger tilt in view.
          target.x = nx * influence * (preview ? (nx < 0 ? 50 : 14) : 1.2) * weight;
          target.y = ny * influence * (preview ? 10 : .9) * weight;
          target.rx = -ny * influence * (preview ? 12 : .35) * weight;
          target.ry = nx * influence * (preview ? 24 : .45) * weight;
          target.z = influence * (preview ? 14 : .5);
          if (preview) {
            // The whole live terminal changes perspective, rather than wobbling its chart pixels.
            target.rz = nx * influence * 1.3;
            target.skewX = -ny * influence * 3;
            target.skewY = nx * influence * 2.4;
            target.scale = -.018 * influence * Math.max(Math.abs(nx), Math.abs(ny));
          }
          target.well = Math.max(0, 1 - outside / 100);
        }
        Object.keys(target).forEach((key) => {
          current[key] += (target[key] - current[key]) * ease;
          if (Math.abs(target[key] - current[key]) > 0.005) moving = true;
        });
        element.style.transform = `perspective(${preview ? 1100 : 1000}px) translate3d(${current.x}px,${current.y}px,${current.z}px) rotateX(${current.rx}deg) rotateY(${current.ry}deg) rotateZ(${current.rz}deg) skew(${current.skewX}deg,${current.skewY}deg) scale(${1 + current.scale})`;
        if (image && displacement) {
          const radius = element.dataset.gravity === "preview" ? 190 : 130;
          image.setAttribute("x", String(pointer.x - rect.x - radius));
          image.setAttribute("y", String(pointer.y - rect.y - radius));
          image.setAttribute("width", String(radius * 2));
          image.setAttribute("height", String(radius * 2));
          displacement.setAttribute("scale", String(current.well * 28));
          element.style.filter = current.well > 0.01 ? `url(#${element.dataset.gravityFilter})` : "";
        }
        letters.forEach((letter) => {
          const dx = pointer.x - letter.x, dy = pointer.y - letter.y;
          const target = pointer.active ? Math.max(0, 1 - Math.hypot(dx, dy) / 130) ** 2 : 0;
          letter.current += (target - letter.current) * ease;
          if (Math.abs(target - letter.current) > 0.005) moving = true;
          const bendX = clamp(dx / 70) * letter.current * 3;
          const bendY = clamp(dy / 40) * letter.current * 4.5;
          letter.element.style.transform = `translate(${bendX}px,${bendY}px) rotate(${clamp(dx / 100) * letter.current * 1.4}deg) scale(${1 - letter.current * 0.04})`;
        });
      });
      raf = moving ? requestAnimationFrame(frame) : 0;
    };
    const start = () => { if (!raf) { last = 0; raf = requestAnimationFrame(frame); } };
    const move = (event) => {
      if (event.pointerType === "touch") return;
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      pointer.active = true;
      start();
    };
    const leave = () => { pointer.active = false; start(); };
    const observer = new ResizeObserver(() => { measure(); start(); });
    observer.observe(root);
    measure();
    root.addEventListener("pointermove", move);
    root.addEventListener("pointerleave", leave);
    window.addEventListener("scroll", measure, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      root.removeEventListener("pointermove", move);
      root.removeEventListener("pointerleave", leave);
      window.removeEventListener("scroll", measure);
      surfaces.forEach(({ element, letters }) => {
        element.style.transform = "";
        element.style.filter = "";
        letters.forEach((letter) => { letter.element.style.transform = ""; });
      });
    };
  }, [ref, reduced]);
}
