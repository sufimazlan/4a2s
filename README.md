# 4a2s

A multiplayer, semi-realistic 3D web game where your character wears your face and your expressions.
It runs in the browser on a computer and installs as an app (PWA) on iPhone and Android.

See **[PLAN.md](PLAN.md)** for the full game plan and roadmap.

## Status

- **Phase 0, setup:** done. Vite + TypeScript + Three.js, PWA (manifest, icons, offline service worker), Cloudflare Pages config.
- **Phase 1, face scan:** started. Camera + MediaPipe Face Landmarker, landmark overlay, head pose, neutral-face check, live blendshapes, speed meter.
- The character on the home screen is a placeholder built from primitives until the Blender base head arrives (Phase 3).

## Run it

Needs Node 20+.

```bash
npm install
npm run dev          # http://localhost:5173 (camera works on localhost)
```

### Test on your phone

Phones only allow the camera over HTTPS. Pick one:

- **Deploy** (easiest, see below) and open the `*.pages.dev` link on the phone.
- **Local HTTPS:** `npm run dev:https`, then open `https://<your-computer's-LAN-IP>:5173` on the phone (same Wi-Fi) and accept the certificate warning.

To install on iPhone: open the site in **Safari**, tap **Share → Add to Home Screen**.
On Android / desktop Chrome or Edge, use the **Install app** button on the home screen.

Tip: add `?delegate=cpu` to the URL to force CPU face tracking and compare speed with the default GPU mode.

## Deploy (Cloudflare Pages, free)

**Option A: connect the GitHub repo** (auto-deploys on every push)
Cloudflare dashboard → Workers & Pages → Create → Pages → Connect to Git → pick this repo, then set:

| Setting | Value |
|---|---|
| Framework preset | None |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Environment variable | `NODE_VERSION` = `22` |

**Option B: from your computer**

```bash
npx wrangler login
npm run deploy
```

`public/_headers` sets the camera permission policy and cache rules on Cloudflare.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` / `dev:https` | Dev server (HTTP / self-signed HTTPS), reachable on your LAN |
| `npm run build` | Typecheck + production build to `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run test:e2e` | Smoke tests on desktop + phone-sized Chrome (first run: `npx playwright install chromium`) |
| `npm run icons` | Re-render the PNG app icons from `public/icons/icon.svg` |
| `npm run deploy` | Build and upload to Cloudflare Pages |

## Project layout

```
src/
  main.ts                    app start-up + hash router (#/ and #/scan)
  platform.ts                device / browser capability checks
  pwa.ts                     service worker, update prompt, install button / iOS hint
  scene/stage.ts             Three.js renderer, lights, camera, orbit controls, render loop
  scene/placeholderCharacter.ts  stand-in head & shoulders with idle animation
  face/camera.ts             front camera (iOS-safe) + friendly error messages
  face/landmarker.ts         MediaPipe Face Landmarker loader (GPU → CPU fallback)
  face/analysis.ts           head pose, blendshape map, neutral-face check
  screens/home.ts            home screen
  screens/scan.ts            face tracking test screen (lazy-loaded)
public/                      icons, Cloudflare _headers
tests/                       Playwright smoke tests
```

## How it works on desktop and mobile

- **Layout:** in landscape the character sits beside the UI panel. In portrait the panel becomes a bottom sheet. Notches and home bars are handled with safe-area insets.
- **Input:** orbit controls work with mouse (drag / scroll) and touch (swipe / pinch). The character's head follows the cursor or finger.
- **Performance:** pixel ratio is capped at 2, rendering pauses when the app is in the background or the camera screen is open, and camera input is 640×480.
- **Offline:** the app shell is precached. The MediaPipe runtime (~13 MB, served from this site) and face model (~3.7 MB) are cached the first time the face scan opens.
- **Privacy:** camera frames are processed on the device. Nothing is uploaded.
