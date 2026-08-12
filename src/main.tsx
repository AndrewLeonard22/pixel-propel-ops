/**
 * ⭐ THE TYPEFACE IS IMPORTED HERE, NOT ASSUMED.
 *
 * `tailwind.config.ts` has specified `Geist` since this design landed and NOTHING ever
 * loaded it: no @font-face, no <link>, no package. Every screen fell back to `system-ui`
 * for body copy and to generic `monospace` (Courier on macOS) for `.font-mono-tabular`
 * and `.kpi-number` — the account-id column, all 52 spend figures, every KPI number.
 * SF Pro body beside Courier numerals is exactly the "old ass UI" tell.
 *
 * Self-hosted rather than a Google Fonts <link>: the fonts ship in the bundle, so there is
 * no third-party request on first paint and no way for the app to silently lose its
 * typeface again. The families are `Geist Variable` / `Geist Mono Variable` — the
 * @fontsource-variable names, which is why tailwind.config.ts lists those first.
 */
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";

import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);
