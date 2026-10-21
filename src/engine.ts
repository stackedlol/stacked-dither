import { MAX_STEPS, resolvePalette, type Palette } from "./palettes";
import { FRAGMENT, VERTEX } from "./shader";

export type DitherOptions = {
  /** A preset name or your own ramp, ground first. Default "midnight". */
  palette?: Palette;
  /** CSS px per dither cell. At 1 it's a gradient; at 3 the cross-hatch reads. Default 3. */
  cell?: number;
  /** Time multiplier. Default 1. */
  speed?: number;
  /** Depth of a quiet well at the centre (0–1) for something to sit on. Default 0. */
  well?: number;
  /** Offsets the field so two canvases on one page aren't the same picture. Default 0. */
  seed?: number;
};

const DEFAULTS: Required<DitherOptions> = { palette: "midnight", cell: 3, speed: 1, well: 0, seed: 0 };

/** The frame drawn under prefers-reduced-motion, well into the drift so the field is developed. */
const STILL = 20;

/**
 * Runs the dither field on a canvas sized by CSS: resize, pausing off-screen,
 * and prefers-reduced-motion. Without WebGL the canvas is left painted with
 * the palette's ground colour.
 */
export class DitherEngine {
  private gl: WebGLRenderingContext | null;
  private program: WebGLProgram | null = null;
  private buffer: WebGLBuffer | null = null;
  private u: Record<string, WebGLUniformLocation | null> = {};
  private opts: Required<DitherOptions>;
  private time = 0;
  private last = 0;
  private raf = 0;
  private visible = true;
  private reducedMotion: MediaQueryList;
  private resizeObserver: ResizeObserver;
  private intersectionObserver: IntersectionObserver;
  private disposed = false;

  constructor(private canvas: HTMLCanvasElement, options: DitherOptions = {}) {
    this.opts = { ...DEFAULTS, ...options };
    canvas.style.imageRendering = "pixelated";
    this.gl = canvas.getContext("webgl", { antialias: false, alpha: false, depth: false, stencil: false });
    if (this.gl) this.init(this.gl);
    this.applyPalette();
    this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.intersectionObserver = new IntersectionObserver(([entry]) => {
      this.visible = entry.isIntersecting;
      this.schedule();
    });
    this.intersectionObserver.observe(canvas);
    this.reducedMotion.addEventListener("change", this.onMotionPreference);

    this.resize();
    this.schedule();
  }

  /** Change any option on the fly — swap the palette, slow it down. */
  set(options: DitherOptions) {
    const cellChanged = options.cell !== undefined && options.cell !== this.opts.cell;
    this.opts = { ...this.opts, ...options };
    if (options.palette) this.applyPalette();
    if (cellChanged) this.resize();
    this.draw();
  }

  destroy() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.intersectionObserver.disconnect();
    this.reducedMotion.removeEventListener("change", this.onMotionPreference);
    const gl = this.gl;
    if (gl) {
      gl.deleteBuffer(this.buffer);
      gl.deleteProgram(this.program);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
  }

  private init(gl: WebGLRenderingContext) {
    const program = gl.createProgram();
    const vs = compile(gl, gl.VERTEX_SHADER, VERTEX);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
    if (!program || !vs || !fs) return;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.bindAttribLocation(program, 0, "aPos");
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.warn("[stacked-dither]", gl.getProgramInfoLog(program));
      return;
    }
    gl.useProgram(program);
    this.program = program;

    // One triangle that covers clip space.
    this.buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    for (const name of ["uTime", "uRes", "uAspect", "uSeed", "uWell", "uRamp", "uSteps"]) {
      this.u[name] = gl.getUniformLocation(program, name);
    }
  }

  private applyPalette() {
    const ramp = resolvePalette(this.opts.palette);
    const [r, g, b] = ramp[0];
    this.canvas.style.backgroundColor = `rgb(${r * 255} ${g * 255} ${b * 255})`;
    const gl = this.gl;
    if (!gl || !this.program) return;
    const flat = new Float32Array(MAX_STEPS * 3);
    ramp.forEach((c, i) => flat.set(c, i * 3));
    gl.uniform3fv(this.u.uRamp, flat);
    gl.uniform1f(this.u.uSteps, ramp.length);
  }

  private resize() {
    const gl = this.gl;
    const rect = this.canvas.getBoundingClientRect();
    if (!gl || !this.program || rect.width < 1 || rect.height < 1) return;
    const w = Math.max(2, Math.round(rect.width / this.opts.cell));
    const h = Math.max(2, Math.round(rect.height / this.opts.cell));
    this.canvas.width = w;
    this.canvas.height = h;
    gl.viewport(0, 0, w, h);
    gl.uniform2f(this.u.uRes, w, h);
    // Feed the longer axis more of the pattern rather than stretching one
    // square of it across the canvas.
    const aspect = rect.width / rect.height;
    gl.uniform2f(this.u.uAspect, aspect >= 1 ? aspect : 1, aspect >= 1 ? 1 : 1 / aspect);
    // Setting the size clears the canvas, and nothing else repaints it while
    // paused or under reduced motion.
    this.draw();
  }

  private draw() {
    const gl = this.gl;
    if (!gl || !this.program || this.disposed) return;
    gl.uniform1f(this.u.uTime, this.reducedMotion.matches ? STILL : this.time);
    gl.uniform1f(this.u.uSeed, this.opts.seed);
    gl.uniform1f(this.u.uWell, this.opts.well);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private schedule() {
    cancelAnimationFrame(this.raf);
    if (this.disposed || !this.visible || this.reducedMotion.matches) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  private frame = (now: number) => {
    this.time += Math.min(0.1, (now - this.last) / 1000) * this.opts.speed;
    this.last = now;
    this.draw();
    this.raf = requestAnimationFrame(this.frame);
  };

  private onMotionPreference = () => {
    this.draw();
    this.schedule();
  };
}

function compile(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.warn("[stacked-dither]", gl.getShaderInfoLog(shader));
    return null;
  }
  return shader;
}
