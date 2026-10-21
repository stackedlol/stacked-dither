import { MAX_STEPS } from "./palettes";

/* An abstract wave field, posterized to the palette and thresholded with a
   4×4 Bayer matrix, in one pass. The canvas's backing store is one pixel per
   dither cell and CSS scales it up with `image-rendering: pixelated`, so the
   cells stay chunky and stable. Running the threshold at full resolution would
   dissolve the pattern into per-pixel noise the moment anything moved.

   scripts/gif.ts is a CPU port of this shader. Change one, change the other. */

export const VERTEX = /* glsl */ `
  attribute vec2 aPos;
  void main() {
    gl_Position = vec4(aPos, 0.0, 1.0);
  }
`;

export const FRAGMENT = /* glsl */ `
  precision highp float;

  uniform float uTime;
  uniform vec2 uRes;
  uniform vec2 uAspect;
  uniform float uSeed;
  uniform float uWell;
  uniform vec3 uRamp[${MAX_STEPS}];
  uniform float uSteps;

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

  // Rotate between octaves as well as scaling, so the layers don't pile up on
  // the same axis and leave a visible grid in the result.
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    mat2 m = mat2(1.62, 1.18, -1.18, 1.62);
    for (int i = 0; i < 5; i++) {
      v += a * noise(p);
      p = m * p;
      a *= 0.5;
    }
    return v;
  }

  // 2×2 Bayer as arithmetic rather than a lookup — GLSL ES 1.0 won't index an
  // array with a computed value in a fragment shader.
  float b2(float x, float y) {
    return mod(2.0 * x + 3.0 * y, 4.0);
  }

  // 4×4 by the standard recursion: B4 = 4·B2(low bits) + B2(high bits).
  float bayer4(vec2 p) {
    float x = floor(mod(p.x, 4.0));
    float y = floor(mod(p.y, 4.0));
    return (4.0 * b2(mod(x, 2.0), mod(y, 2.0)) + b2(floor(x / 2.0), floor(y / 2.0))) / 16.0;
  }

  // Same reason as b2: walk the ramp with a constant-bound loop.
  vec3 ramp(float idx) {
    vec3 c = uRamp[0];
    for (int i = 1; i < ${MAX_STEPS}; i++) {
      if (float(i) <= idx) c = uRamp[i];
    }
    return c;
  }

  void main() {
    vec2 uv = gl_FragCoord.xy / uRes;
    vec2 p = (uv - 0.5) * uAspect * 2.5 + uSeed;
    float t = uTime * 0.11;

    // Two levels of domain warping. One level gives soft clouds; feeding the
    // result back in a second time is what folds the field into the marbled
    // bands and lets flow lines double back on themselves.
    vec2 q = vec2(
      fbm(p + vec2(0.0, t)),
      fbm(p + vec2(5.2, -t * 0.8))
    );
    vec2 r = vec2(
      fbm(p + 2.6 * q + vec2(1.7, 9.2) + t * 0.22),
      fbm(p + 2.6 * q + vec2(8.3, 2.8) - t * 0.17)
    );
    float f = fbm(p + 3.1 * r);

    // Interference ripples riding the warped coordinates, so the contours bend
    // with the field instead of sitting on top of it as concentric rings.
    float ripple = sin((r.x * 3.4 + r.y * 2.2 + f * 5.6) * 3.6 - t * 2.6);
    float ripple2 = sin((q.x - q.y) * 6.2 + t * 1.7);
    float v = 0.03 + f * 0.54 + ripple * 0.26 + ripple2 * 0.09;

    // A faint lift toward the upper left so the panel keeps a light source,
    // and a faint fall toward the lower right. Any real slope herds all the
    // light into one corner.
    float lift = 1.0 - clamp(distance(uv, vec2(0.24, 0.84)) * 0.95, 0.0, 1.0);
    v += 0.08 * pow(lift, 2.2);
    v -= 0.08 * pow(1.0 - clamp(distance(uv, vec2(0.86, 0.12)) * 1.4, 0.0, 1.0), 1.4);

    // An optional quiet well at the centre for something to sit on.
    float centre = distance(uv, vec2(0.5));
    v -= uWell * 0.34 * smoothstep(0.42, 0.02, centre);

    // Push the midtones down and keep the crests, so the low steps carry the
    // panel and the light reads as light on it.
    v = pow(clamp(v, 0.0, 1.0), 1.55);

    // Light catching the tops of the ripples. Which crests catch it is decided
    // by a drifting glint at about a crest's own scale, not by how bright the
    // field is, so the highlights spread over the whole panel.
    float glint = noise(p * 1.7 + vec2(t * 0.9, -t * 0.6));
    float crest = smoothstep(0.94, 1.0, ripple) * 0.85;
    crest *= mix(0.4, 1.0, smoothstep(0.3, 0.7, glint));
    crest *= mix(0.55, 1.0, smoothstep(0.1, 0.45, v));
    crest *= mix(1.0, smoothstep(0.22, 0.42, centre), uWell);

    // The body fills the lower three quarters of the ramp; past the halfway
    // step it's stretched gently toward the light, and the top is left to the
    // crests: the very top along their middle, a step or two down at their
    // edges.
    float d = bayer4(gl_FragCoord.xy);
    float n = uSteps - 1.0;
    float s = v * n * 0.75;
    float knee = n * 0.5;
    if (s > knee) s = knee + (s - knee) * 1.3;
    float idx = clamp(floor(s + d), 0.0, n);
    float h = floor(crest * 2.0 + d);
    if (h > 1.5) idx = n;
    else if (h > 0.5) idx = max(idx, n - floor(n / 4.0 + 0.5));
    gl_FragColor = vec4(ramp(idx), 1.0);
  }
`;
