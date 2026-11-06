import { useState } from "react";

function displacementTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 96;
  const ctx = canvas.getContext("2d");
  const pixels = ctx.createImageData(96, 96);
  for (let y = 0; y < 96; y++) for (let x = 0; x < 96; x++) {
    const dx = (x - 47.5) / 47.5, dy = (y - 47.5) / 47.5;
    const radius = Math.hypot(dx, dy);
    const depth = radius < 1 ? Math.sin(radius * Math.PI) * (1 - radius) * 110 : 0;
    const i = (y * 96 + x) * 4;
    pixels.data[i] = 128 + dx / (radius || 1) * depth;
    pixels.data[i + 1] = 128 + dy / (radius || 1) * depth;
    pixels.data[i + 2] = 128;
    pixels.data[i + 3] = 255;
  }
  ctx.putImageData(pixels, 0, 0);
  return canvas.toDataURL();
}

export default function GravityLenses({ id }) {
  const [texture] = useState(displacementTexture);
  return (
    <svg width="0" height="0" aria-hidden="true" className="pd-gravity-filters">
      <defs>
        {["title"].map((kind) => (
          <filter key={kind} id={`${id}-${kind}`} x="-5%" y="-10%" width="110%" height="120%"
            primitiveUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
            <feFlood floodColor="#808080" result="neutral" />
            <feImage href={texture} x="-400" y="-400" width="400" height="400"
              preserveAspectRatio="none" result="well" />
            <feMerge result="field"><feMergeNode in="neutral" /><feMergeNode in="well" /></feMerge>
            <feDisplacementMap in="SourceGraphic" in2="field" scale="0" xChannelSelector="R" yChannelSelector="G" />
          </filter>
        ))}
      </defs>
    </svg>
  );
}
