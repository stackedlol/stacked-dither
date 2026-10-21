import { DitherEngine, PALETTES, type Palette, type PaletteName } from "./src";

// ?palette=ember picks a preset; ?colors=0a0302,7a1d0f,fff4d6 brings your own ramp.
const params = new URLSearchParams(location.search);
const names = Object.keys(PALETTES) as PaletteName[];
const custom = params.get("colors")?.split(",").filter(Boolean);
let current = names.indexOf(params.get("palette") as PaletteName);
if (current < 0 && !custom) current = 0;
const palette: Palette = custom ?? names[current];

const engine = new DitherEngine(document.querySelector("canvas")!, { palette });

const label = document.querySelector("nav output")!;
const swatches = names.map((name, i) => {
  const button = document.createElement("button");
  button.setAttribute("aria-label", name);
  button.style.background = `linear-gradient(90deg, ${PALETTES[name].join(", ")})`;
  button.onclick = () => select(i);
  document.querySelector("nav div")!.append(button);
  return button;
});

const pad = (n: number) => String(n + 1).padStart(2, "0");
const show = () => {
  label.textContent = current < 0 ? "Custom" : `${pad(current)} / ${pad(names.length - 1)} ${names[current]}`;
  swatches.forEach((b, i) => b.setAttribute("aria-pressed", String(i === current)));
};

function select(i: number) {
  current = (i + names.length) % names.length;
  engine.set({ palette: names[current] });
  history.replaceState(null, "", `?palette=${names[current]}`);
  show();
}

addEventListener("keydown", (e) => {
  if (e.key === "ArrowRight") select(current + 1);
  if (e.key === "ArrowLeft") select(current - 1);
});

show();
