import { useEffect, useRef } from 'react';

const VERTEX = `
attribute vec2 particle;
uniform vec2 resolution;
uniform vec2 steering;
uniform float time;
uniform float dpr;
varying float opacity;
varying vec3 tint;
const float TAU = 6.2831853;

vec2 path(float z) {
  return vec2(.26 * sin(z * .52) + .08 * sin(z * .24 + .8),
              .23 * cos(z * .43));
}
void main() {
  float camera = time * .29;
  float depth = fract(particle.y - time * .034);
  float radius = .15 / pow(depth * .8 + .4, 2.);
  float angle = particle.x + depth * 1.5 + camera * .16;
  // A single gradual bend leaves the vanishing point readable through the spiral.
  vec2 bend = (path(camera + depth * 1.55) - path(camera)) * pow(depth, 1.2) * .55;
  bend += steering * (.05 + pow(depth, 1.4) * .32);
  vec2 ring = radius * vec2(cos(angle), sin(angle));
  float side = min(resolution.x, resolution.y);
  vec2 screen = resolution * vec2(.33, .46) + (ring + bend) * side;
  gl_Position = vec4(screen / resolution * 2. - 1., 0., 1.);
  gl_PointSize = (1.15 + (1. - depth) * .5) * dpr;
  float fade = smoothstep(0., .04, depth) * (1. - smoothstep(.88, 1., depth));
  opacity = (.11 + .32 * pow(1. - depth, .7)) * fade;
  tint = mix(vec3(.41,.56,.74), vec3(.61,.48,.76), .5 + .5 * sin(angle + depth * 3.));
}`;

const FRAGMENT = `
precision mediump float;
varying float opacity;
varying vec3 tint;
void main() {
  float edge = length(gl_PointCoord - .5) * 2.;
  gl_FragColor = vec4(tint, opacity * (1. - smoothstep(.45, 1., edge)));
}`;

/** A perspective point tunnel with a curved flight path and eased mouse steering. */
export default function DreamTunnel() {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const surface = canvas.closest('.dream-landing');
    const gl = canvas.getContext('webgl', {alpha:true,antialias:false,depth:false,stencil:false});
    if (!gl) return;
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
    const rings = 96, points = 128;
    const particles = new Float32Array(rings * points * 2);
    for (let ring = 0; ring < rings; ring++) {
      for (let point = 0; point < points; point++) {
        const index = (ring * points + point) * 2;
        particles[index] = point / points * Math.PI * 2;
        particles[index + 1] = ring / rings;
      }
    }
    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, particles, gl.STATIC_DRAW);
    const attribute = gl.getAttribLocation(program, 'particle');
    gl.enableVertexAttribArray(attribute);
    gl.vertexAttribPointer(attribute, 2, gl.FLOAT, false, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0,0,0,0);
    const uniforms = Object.fromEntries(['resolution','steering','time','dpr'].map(name=>[name,gl.getUniformLocation(program,name)]));
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const fine = matchMedia('(hover: hover) and (pointer: fine)');
    let frame = 0, last = 0, clock = 1.8;
    let width = 1, height = 1, dpr = 1;
    let x = 0, y = 0, targetX = 0, targetY = 0, energy = 0, targetEnergy = 0;
    let enabled = false, onscreen = true, lost = false, disposed = false;
    const draw = () => {
      if (disposed || lost) return;
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(uniforms.resolution,width,height);
      gl.uniform2f(uniforms.steering,x,y);
      gl.uniform1f(uniforms.time,clock);
      gl.uniform1f(uniforms.dpr,dpr);
      gl.drawArrays(gl.POINTS,0,rings*points);
      surface.style.setProperty('--dream-tunnel-x',`${x}`);
      surface.style.setProperty('--dream-tunnel-y',`${-y}`);
      surface.style.setProperty('--dream-tunnel-energy',`${energy}`);
    };
    const animate = now => {
      frame = 0;
      if (!enabled || document.hidden || !onscreen || lost || disposed) return;
      const dt = last ? Math.min((now-last)/1000,.05) : .016;
      last = now;
      clock += dt;
      const follow = 1-Math.exp(-dt*3.5);
      x += (targetX-x)*follow;
      y += (targetY-y)*follow;
      energy += (targetEnergy-energy)*follow;
      draw();
      frame = requestAnimationFrame(animate);
    };
    const start = () => {
      if (enabled && onscreen && !document.hidden && !lost && !disposed && !frame) {
        last = 0;
        frame = requestAnimationFrame(animate);
      }
    };
    const resize = () => {
      const rect = surface.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      dpr = Math.min(devicePixelRatio||1,1.5);
      canvas.width = Math.round(width*dpr);
      canvas.height = Math.round(height*dpr);
      gl.viewport(0,0,canvas.width,canvas.height);
      draw();
    };
    const syncMotion = () => {
      const mode = document.documentElement.dataset.motion;
      enabled = fine.matches && mode !== 'reduced' && !(mode !== 'full' && reduced.matches);
      if (!enabled || document.hidden || !onscreen) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
      if (!enabled) {
        x = y = targetX = targetY = energy = targetEnergy = 0;
        draw();
      }
      canvas.dataset.motion = enabled ? 'full' : 'reduced';
      start();
    };
    const move = event => {
      if (!enabled || event.pointerType === 'touch') return;
      const rect = surface.getBoundingClientRect();
      targetX = Math.max(-1,Math.min(1,(event.clientX-rect.left)/rect.width*2-1));
      targetY = Math.max(-1,Math.min(1,1-(event.clientY-rect.top)/rect.height*2));
      targetEnergy = 1;
    };
    const leave = () => {targetX = targetY = targetEnergy = 0;};
    const contextLost = event => {
      event.preventDefault();
      lost = true;
      cancelAnimationFrame(frame);
      frame = 0;
      canvas.dataset.ready = 'false';
      surface.style.removeProperty('--dream-tunnel-x');
      surface.style.removeProperty('--dream-tunnel-y');
      surface.style.removeProperty('--dream-tunnel-energy');
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(surface);
    const motionObserver = new MutationObserver(syncMotion);
    motionObserver.observe(document.documentElement,{attributes:true,attributeFilter:['data-motion']});
    const visibilityObserver = new IntersectionObserver(([entry])=>{onscreen=entry.isIntersecting;syncMotion();});
    visibilityObserver.observe(surface);
    surface.addEventListener('pointermove',move,{passive:true});
    surface.addEventListener('pointerleave',leave);
    window.addEventListener('blur',leave);
    document.addEventListener('visibilitychange',syncMotion);
    reduced.addEventListener('change',syncMotion);
    fine.addEventListener('change',syncMotion);
    canvas.addEventListener('webglcontextlost',contextLost);
    resize();
    syncMotion();
    canvas.dataset.ready = 'true';
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      motionObserver.disconnect();
      visibilityObserver.disconnect();
      surface.removeEventListener('pointermove',move);
      surface.removeEventListener('pointerleave',leave);
      window.removeEventListener('blur',leave);
      document.removeEventListener('visibilitychange',syncMotion);
      reduced.removeEventListener('change',syncMotion);
      fine.removeEventListener('change',syncMotion);
      canvas.removeEventListener('webglcontextlost',contextLost);
      surface.style.removeProperty('--dream-tunnel-x');
      surface.style.removeProperty('--dream-tunnel-y');
      surface.style.removeProperty('--dream-tunnel-energy');
      gl.deleteBuffer(buffer);
      shaders.forEach(shader=>gl.deleteShader(shader));
      gl.deleteProgram(program);
    };
  },[]);
  return <canvas className="dream-tunnel" ref={canvasRef} aria-hidden="true" />;
}
