import { useEffect, useRef } from 'react';

const VERTEX = `
attribute vec2 position;
varying vec2 uv;
void main() {
  uv = position * .5 + .5;
  gl_Position = vec4(position, 0., 1.);
}`;

const FRAGMENT = `
precision mediump float;
varying vec2 uv;
uniform sampler2D sky;
uniform vec2 resolution;
uniform vec2 imageSize;
uniform vec2 pointer;
uniform float time;
uniform float strength;
uniform float alignment;
void main() {
  float shortSide = min(resolution.x, resolution.y);
  vec2 delta = (uv * resolution - pointer) / shortSide;
  float radius = length(delta);
  // A refracting centre and broad, slow rings deform the actual landscape.
  float envelope = 1. - smoothstep(.025, .46, radius);
  float centre = smoothstep(0., .012, radius);
  float wave = sin(radius * 38. - time * 2.);
  vec2 rings = delta / max(radius, .001) * wave * .032 * envelope * centre;
  vec2 lens = -delta * .65 * exp(-radius * radius / .012);
  float edge = min(min(uv.x, 1. - uv.x), min(uv.y, 1. - uv.y));
  vec2 offset = (rings + lens) * smoothstep(0., .045, edge);
  vec2 displaced = uv + offset * strength * shortSide / resolution;
  float cover = max(resolution.x / imageSize.x, resolution.y / imageSize.y);
  vec2 visible = resolution / (imageSize * cover);
  vec2 sampleUV = displaced * visible + (1. - visible) * vec2(alignment, .5);
  gl_FragColor = texture2D(sky, clamp(sampleUV, .001, .999));
}`;

/** Decorative image refraction. The CSS sky remains the no-WebGL fallback. */
export default function RippleSky() {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const surface = canvas.closest('.dream-landing');
    const visibleSky = !surface.classList.contains('dream-landing-white');
    const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (!finePointer.matches) return;
    const gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false });
    if (!gl) return;
    let disposed = false;
    let lost = false;
    let frame = 0;
    let ready = false;
    let enabled = false;
    let hovering = false;
    let strength = 0;
    let last = 0;
    let clock = 0;
    let width = 1;
    let height = 1;
    let x = 0;
    let y = 0;
    let targetX = 0;
    let targetY = 0;
    const letters = Array.from(surface.querySelectorAll('[data-ripple-letter]'));
    const waveSurfaces = Array.from(surface.querySelectorAll('[data-ripple-surface]'));
    let letterPoints = [];
    let surfacePoints = [];
    const resetLetters = () => {
      letters.forEach(letter => { letter.style.transform = ''; });
      waveSurfaces.forEach(element => {
        element.style.removeProperty('--dream-wave-x');
        element.style.removeProperty('--dream-wave-y');
        element.style.removeProperty('--dream-wave-skew');
      });
    };
    const measureLetters = () => {
      resetLetters();
      const canvasRect = canvas.getBoundingClientRect();
      letterPoints = letters.map(element => {
        const rect = element.getBoundingClientRect();
        return { element, heading: !!element.closest('h1'), x: rect.left + rect.width / 2 - canvasRect.left, y: canvasRect.bottom - rect.top - rect.height / 2 };
      });
      surfacePoints = waveSurfaces.map(element => {
        const rect = element.getBoundingClientRect();
        return { element, x: rect.left + rect.width / 2 - canvasRect.left, y: canvasRect.bottom - rect.top - rect.height / 2 };
      });
    };
    const smoothstep = (a, b, value) => {
      const t = Math.max(0, Math.min(1, (value - a) / (b - a)));
      return t * t * (3 - 2 * t);
    };
    const shaders = [];
    const compile = (type, source) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      shaders.push(shader);
      return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
    };
    const vertex = compile(gl.VERTEX_SHADER, VERTEX);
    const fragment = compile(gl.FRAGMENT_SHADER, FRAGMENT);
    const program = gl.createProgram();
    if (vertex && fragment) {
      gl.attachShader(program, vertex);
      gl.attachShader(program, fragment);
      gl.linkProgram(program);
    }
    if (!vertex || !fragment || !gl.getProgramParameter(program, gl.LINK_STATUS)) {
      shaders.forEach(shader => gl.deleteShader(shader));
      gl.deleteProgram(program);
      return;
    }
    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'position');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const uniforms = Object.fromEntries(['resolution', 'imageSize', 'pointer', 'time', 'strength', 'alignment', 'sky'].map(name => [name, gl.getUniformLocation(program, name)]));
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.uniform1i(uniforms.sky, 0);
    const draw = () => {
      if (!ready || lost || disposed) return;
      gl.uniform2f(uniforms.resolution, width, height);
      gl.uniform2f(uniforms.pointer, x, y);
      gl.uniform1f(uniforms.time, clock);
      gl.uniform1f(uniforms.strength, strength);
      gl.uniform1f(uniforms.alignment, surface.clientWidth <= 950 ? .6 : .5);
      // The white-world trial keeps the shared field for text and objects only.
      if (visibleSky) gl.drawArrays(gl.TRIANGLES, 0, 6);
      // Follow the same wave at each glyph, at a fraction of its image displacement.
      const shortSide = Math.min(width, height);
      const displace = (letterX, letterY, gain, limit) => {
        const dx = (letterX - x) / shortSide, dy = (letterY - y) / shortSide;
        const radius = Math.hypot(dx, dy);
        const envelope = 1 - smoothstep(.025, .46, radius);
        const centre = smoothstep(0, .012, radius);
        const wave = Math.sin(radius * 38 - clock * 2) * .032 * envelope * centre;
        const lens = -radius * .65 * Math.exp(-radius * radius / .012);
        const bend = (wave + lens) * shortSide * strength * gain / Math.max(radius, .001);
        return [Math.max(-limit, Math.min(limit, dx * bend)), Math.max(-limit, Math.min(limit, -dy * bend))];
      };
      letterPoints.forEach(({ element, heading, x: letterX, y: letterY }) => {
        const [shiftX, shiftY] = displace(letterX, letterY, heading ? .12 : .08, heading ? 4 : 2.5);
        // The 8017 centre pull, expressed on glyphs instead of a moving SVG filter.
        // Keeping the title in the normal text layer avoids Safari dropping it on fast moves.
        const dx = x - letterX, dy = letterY - y;
        const focus = heading ? Math.max(0, 1 - Math.hypot(dx, dy) / 130) ** 2 * strength : 0;
        const clamp = (value) => Math.max(-1, Math.min(1, value));
        const pullX = clamp(dx / 70) * focus * 3;
        const pullY = clamp(dy / 40) * focus * 4.5;
        const rotate = clamp(dx / 100) * focus * 1.4;
        element.style.transform = strength > 0 ? `translate(${shiftX + pullX}px,${shiftY + pullY}px) rotate(${rotate}deg) scale(${1 - focus * .04})` : '';
      });
      surfacePoints.forEach(({ element, x: surfaceX, y: surfaceY }) => {
        const [shiftX, shiftY] = displace(surfaceX, surfaceY, .1, 3);
        element.style.setProperty('--dream-wave-x', `${shiftX}px`);
        element.style.setProperty('--dream-wave-y', `${shiftY}px`);
        element.style.setProperty('--dream-wave-skew', `${shiftY * .18}deg`);
      });
    };
    const animate = (now) => {
      frame = 0;
      if (!enabled || document.hidden || lost || disposed) return;
      const dt = last ? Math.min((now - last) / 1000, .05) : .016;
      last = now;
      clock += dt;
      const follow = 1 - Math.exp(-dt * 16);
      x += (targetX - x) * follow;
      y += (targetY - y) * follow;
      strength += ((hovering ? 1 : 0) - strength) * (1 - Math.exp(-dt * 6));
      if (!hovering && strength < .002) strength = 0;
      draw();
      if (hovering || strength > 0) frame = requestAnimationFrame(animate);
    };
    const start = () => {
      if (ready && enabled && !frame && !document.hidden) {
        last = 0;
        frame = requestAnimationFrame(animate);
      }
    };
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      gl.viewport(0, 0, canvas.width, canvas.height);
      hovering = false;
      strength = 0;
      measureLetters();
      draw();
    };
    const move = (event) => {
      if (!enabled || event.pointerType === 'touch') return;
      const rect = canvas.getBoundingClientRect();
      targetX = (event.clientX - rect.left) * width / rect.width;
      targetY = (rect.bottom - event.clientY) * height / rect.height;
      if (!hovering) { x = targetX; y = targetY; measureLetters(); }
      hovering = true;
      start();
    };
    const leave = () => { hovering = false; start(); };
    const updateMotion = () => {
      const mode = document.documentElement.dataset.motion;
      enabled = finePointer.matches && mode !== 'reduced' && !(mode !== 'full' && reduced.matches);
      if (!enabled || document.hidden) {
        cancelAnimationFrame(frame);
        frame = 0;
        hovering = false;
        strength = 0;
        draw();
      }
      // Reduced motion uses the original image, without a composited canvas.
      canvas.dataset.ready = String(ready && enabled && !lost);
    };
    const contextLost = (event) => {
      event.preventDefault();
      lost = true;
      cancelAnimationFrame(frame);
      frame = 0;
      canvas.dataset.ready = 'false';
      resetLetters();
    };
    const image = new Image();
    image.onload = () => {
      if (disposed || lost) return;
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, image);
      gl.uniform2f(uniforms.imageSize, image.naturalWidth, image.naturalHeight);
      ready = true;
      resize();
      updateMotion();
    };
    image.src = '/images/dream-meadow-reference-v5.png';
    const observer = new ResizeObserver(resize);
    observer.observe(surface);
    const motionObserver = new MutationObserver(updateMotion);
    motionObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-motion'] });
    finePointer.addEventListener('change', updateMotion);
    reduced.addEventListener('change', updateMotion);
    surface.addEventListener('pointermove', move, { passive: true });
    surface.addEventListener('pointerleave', leave);
    document.addEventListener('visibilitychange', updateMotion);
    window.addEventListener('blur', leave);
    window.addEventListener('scroll', measureLetters, { passive: true });
    canvas.addEventListener('webglcontextlost', contextLost);
    return () => {
      disposed = true;
      image.onload = null;
      cancelAnimationFrame(frame);
      observer.disconnect();
      motionObserver.disconnect();
      finePointer.removeEventListener('change', updateMotion);
      reduced.removeEventListener('change', updateMotion);
      surface.removeEventListener('pointermove', move);
      surface.removeEventListener('pointerleave', leave);
      document.removeEventListener('visibilitychange', updateMotion);
      window.removeEventListener('blur', leave);
      window.removeEventListener('scroll', measureLetters);
      resetLetters();
      canvas.removeEventListener('webglcontextlost', contextLost);
      gl.deleteTexture(texture);
      gl.deleteBuffer(buffer);
      shaders.forEach(shader => gl.deleteShader(shader));
      gl.deleteProgram(program);
    };
  }, []);
  return <div className="dream-sky" aria-hidden="true"><canvas ref={canvasRef} className="dream-sky-ripple" /></div>;
}
