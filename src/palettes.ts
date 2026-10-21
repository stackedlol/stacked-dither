/**
 * A palette is a ramp of 2–16 colours, ground first, hottest last. The field
 * fills the panel with the low steps and the ripple crests land on the top
 * one, so luminance should move steadily one way down the list (dark → light
 * or light → dark) or the Bayer steps stop reading as one ramp and the
 * cross-hatch turns to noise.
 */
export const PALETTES = {
  // Navy up through periwinkle and sky blue to white.
  midnight: ["#030610", "#080e23", "#111d4a", "#213479", "#3e58b1", "#809ce6", "#7ec7f6", "#d8e4ff", "#ffffff"],
  // The light one: a cream ground with butter, pink and orange veins.
  peach: ["#fff7ea", "#ffefbd", "#fbdebd", "#f5bdbe", "#f0ae6d", "#e79249", "#e0782c"],
  ember: ["#0a0302", "#1f0705", "#43100a", "#7a1d0f", "#b8341a", "#e0632a", "#f59a3e", "#ffd27a", "#fff4d6"],
  moss: ["#030a06", "#071a0f", "#0f2e1b", "#1b4a2c", "#2f6b3f", "#4f9157", "#8cbf73", "#d2e8a8", "#f7fbe6"],
  lilac: ["#0b0612", "#1a0f2b", "#2d1a4d", "#46287a", "#6440a8", "#8c66d1", "#b796ec", "#e2cffc", "#ffffff"],
  mono: ["#000000", "#111111", "#222222", "#3a3a3a", "#5a5a5a", "#808080", "#aaaaaa", "#d6d6d6", "#ffffff"],
} satisfies Record<string, string[]>;

export type PaletteName = keyof typeof PALETTES;

/** A preset's name, or your own ramp as hex strings ("#rgb", "#rrggbb", with or without the #). */
export type Palette = PaletteName | readonly string[];

export const MAX_STEPS = 16;

/** Resolves a palette to RGB triples in 0–1. */
export function resolvePalette(palette: Palette): [number, number, number][] {
  const hexes = typeof palette === "string" ? PALETTES[palette] : palette;
  if (!hexes) throw new Error(`stacked-dither: unknown palette "${palette}"`);
  if (hexes.length < 2 || hexes.length > MAX_STEPS) {
    throw new Error(`stacked-dither: a palette needs 2–${MAX_STEPS} colours, got ${hexes.length}`);
  }
  return hexes.map(parseHex);
}

function parseHex(hex: string): [number, number, number] {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  if (!/^[0-9a-f]{6}$/i.test(h)) throw new Error(`stacked-dither: "${hex}" is not a hex colour`);
  const n = parseInt(h, 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
