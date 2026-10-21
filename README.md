# stacked dither

![](dither.gif)

A wave field, Bayer-dithered to any palette. WebGL, zero dependencies.

```sh
npm install && npm run dev
```

```ts
import { DitherEngine } from "./src";

const engine = new DitherEngine(canvas, { palette: "midnight" });
engine.set({ palette: ["#0a0302", "#7a1d0f", "#e0632a", "#fff4d6"] });
```

Presets: `midnight` `peach` `ember` `moss` `lilac` `mono`. Or try `?palette=ember` and `?colors=0a0302,7a1d0f,fff4d6` on the demo.
