# 4a2s — Game Plan

> Status: planning · Last updated: 7 Oct 2026
> A multiplayer, semi-realistic 3D web game where your character's face is built from snapshots of your real face, including your own expressions.

---

## 1. Core idea

Before playing, the player creates their character's face in **two capture steps**:

1. **Neutral face scan.** Snap the face with **no expression** from the front, about 45° left and right, up, down, and every other angle possible.
2. **Expression snaps.** Snap the face making a few easy expressions: **smile, angry, sad, laugh**, plus optional extras like surprised.

The game then **applies this face data to the character**:
- The neutral scan shapes the character's head and face, so it looks like the player.
- The expression snaps become the character's own versions of those expressions, so its smile looks like the player's smile.

The character is **semi-realistic** and comes alive through animation: a **giggle (laugh) animation** based on the player's own giggle, and **interaction animations** between players (high-five, hug, wave and so on).

**Hair, neck, body, shirt and the rest are customized later, in the game.** The scan only covers the face.

**The game goal is not decided yet.** Character creation comes first.

## 2. Key decisions

| Decision | Choice | Why |
|---|---|---|
| Platform | **PWA** (Progressive Web App) | No US$99 Apple fee, no 7-day re-signing, no Mac needed, shareable by link |
| Face tracking | **MediaPipe Face Landmarker** (in browser) | 478 landmarks + 52 expression blendshapes + head pose, all from the normal camera |
| Character creation flow | **Two steps of snapshots:** neutral multi-angle scan, then expression snaps | Neutral gives the face shape; expressions give the player's personal emotions |
| Art style | **Semi-realistic** | Realistic proportions and skin shading, but not photoreal. Avoids the uncanny valley and stays light enough for iPhone browsers |
| Likeness target | **Semi-realistic character that resembles the player** | Face shape + skin tone + personal expressions from the scan, applied to a semi-real base head |
| Animation | **Giggle animation + interaction animations** | Makes characters feel alive and gives players ways to play together |
| Accuracy strategy | **Capture as many angles as possible** | Profile views reveal nose and jaw depth that a single front photo can't |
| Body and style | **Customized in game**, not scanned | Hair, neck, body and clothes are game assets the player picks |
| Hosting | **Cloudflare** (Pages + Workers + Durable Objects) | Free tier covers both the static PWA and the real-time multiplayer server |
| Budget | **As close to RM0 as possible** | Fun project, not a business |

### Known trade-off (accepted)
A PWA has no access to the TrueDepth camera, so face depth is **estimated**, not measured. Front-view proportions will be accurate. Profile features (nose projection, jaw and chin depth) will lean toward an average face. Multi-angle capture reduces this gap.

Because the style is semi-realistic rather than cartoon, likeness errors will be a bit more noticeable. More capture angles and the manual sliders matter more.

## 3. Tech stack

- **Language/build:** TypeScript + Vite
- **3D engine:** Three.js (alternative: Babylon.js)
- **Face tracking:** MediaPipe Tasks Vision — Face Landmarker
- **3D assets:** Blender. Semi-real base head mesh with likeness morph targets + 52 expression shape keys (ARKit names)
- **Rendering:** Three.js `MeshPhysicalMaterial` for skin, HDRI environment lighting
- **Animation:** standard humanoid rig (Mixamo-compatible), Mixamo clips + custom Blender clips, Three.js `AnimationMixer`
- **Backend:** Cloudflare Workers + Durable Objects (one Durable Object per game room)
- **Local storage:** IndexedDB for the player's face data
- **Hosting:** Cloudflare Pages (free HTTPS, which iOS requires for camera access)

## 4. Character creation pipeline

### 4.1 Step 1 — Neutral face scan (no expression)
1. Ask for camera permission and check lighting (warn if too dark or backlit).
2. Ask the player to keep a **relaxed, neutral face**. Use the blendshapes to check: if smile, brow or jaw values are too high, show "relax your face".
3. Show a Face ID–style guide ring. The player turns their head to cover: **front, ~45° left, ~45° right, up, down, and the diagonals** in between.
4. For each angle, read the head pose from MediaPipe's transformation matrix. Snap a frame only when:
   - the face is centered and sharp (not blurred),
   - the head angle is inside the target zone,
   - tracking confidence is high,
   - the face is still neutral.
5. Take several frames per angle and average them to reduce jitter.
6. Fill in segments of the ring as each angle is captured.

Note: tracking gets unreliable past roughly 45–60° of head turn, so the side angles stay around 45°.

### 4.2 Step 2 — Expression snaps
Captured from the **front** (optionally slight left/right for extra detail). The game **auto-snaps** when the expression is clear and held steady for about half a second, with a live meter showing how strong the expression is. The player can retake or skip any expression.

| Expression | What the game checks (MediaPipe blendshapes) | Difficulty to act |
|---|---|---|
| Smile | mouthSmileLeft/Right high, jaw mostly closed | Easy |
| Laugh | mouthSmile + jawOpen high, eyes squinting | Easy |
| Surprised *(optional)* | browInnerUp, eyeWide, jawOpen | Easy |
| Angry | browDown, noseSneer, mouthPress | Harder |
| Sad | mouthFrown, browInnerUp | Harder |

Angry and sad are harder to fake on demand, so their thresholds should be lenient, and skipping should fall back to a default expression.

**Giggle clip:** after the laugh snap, the player records a **2–3 second giggle**. The game stores only the 52 blendshape values for each frame, not the video. This becomes the player's personal giggle animation (see 5.2).

### 4.3 Applying the face data to the character
**Face shape (from the neutral scan):**
1. Normalize each angle's landmarks by its head pose so all views share one coordinate space.
2. Fit one face shape to **all angles together**:
   - The front view gives widths, spacing and proportions.
   - The side views give nose projection and jaw/chin depth.
   - The up/down views give brow and chin shape.
3. Convert the fitted shape into **avatar parameters**: face width/length, jaw, chin, cheekbones, eye size/spacing/tilt, nose width/length/projection, mouth width, lip thickness, brow position.
4. Sample **skin tone** from cheek and forehead regions, correcting for lighting.
5. Apply the parameters as morph-target weights on the base head mesh.

**Personal expressions (from the expression snaps):** for each expression, store:
- the **52 blendshape weights** at the peak of the expression. These drive the character's matching shape keys, so the character makes the same mix of movements the player made.
- the **landmark offsets from the neutral face**. These are applied as small corrections on top, so the character keeps the player's personal details (a lopsided smile, how wide the mouth opens, how far the brows drop).

Then show a **preview** where the player can see their character cycle through all expressions, and adjust face sliders manually if needed.

All of this face data is small, a few KB per player.

### 4.4 In-game customization (later)
Not part of the scan. Picked by the player inside the game:
- hair style and color
- neck and body type
- shirt and clothing
- other accessories (to be decided)

### 4.5 Out of scope for v1
- Scanning hair, ears or the back of the head
- Photorealistic face textures (uncanny valley, lighting seams). The look stays semi-real.

## 5. Art style and animation

### 5.1 Semi-realistic style
- Realistic head and body proportions, slightly simplified (clean shapes, no pore or wrinkle detail).
- **Skin:** `MeshPhysicalMaterial` with a soft, warm look (sheen + a light subsurface-style shader tweak) and a baked normal map for subtle detail.
- **Eyes:** separate eyeball meshes with a wet highlight. Eyes do most of the work in making a semi-real face feel alive.
- **Lighting:** one key light + a soft HDRI environment. Looks good and stays cheap on iPhone.
- **Starting performance targets** (tune after testing): about 15–25k triangles per character, 1K–2K textures, 4–8 characters on screen.

### 5.2 Giggle (laugh) animation
The giggle is layered: **face** and **body** animate separately and play together.

- **Face, personal version (main):** replay the player's recorded giggle clip, the per-frame blendshape values from step 2. The character giggles with the player's real rhythm: how their eyes squint, how their mouth and cheeks bounce. Data size is tiny (52 values × ~90 frames).
- **Face, fallback:** if the player skipped the clip, bounce between the neutral face and their laugh snap procedurally (jaw and cheeks pulsing about 4–6 times per second, eyes squinting).
- **Body:** a short clip where the head tilts slightly back, shoulders bounce and the chest moves.
- **Sound (optional):** a generic giggle sound, or a player-recorded one later.
- **Triggers:** emote button, or automatically after funny game moments (for example being poked).

### 5.3 Interaction animations
**Solo emotes:** wave, nod, shrug, clap, point, giggle.

**Paired (two players):** high-five, handshake, fist bump, hug, pat on the shoulder, poke.

How a paired interaction works:
1. Player A taps player B and picks an interaction.
2. The server (room Durable Object) sends B the request. B accepts.
3. The server sends both players a start signal with a meeting point. Both characters move into position, facing each other.
4. Both phones play matching clips at the same moment. **Hand IK** adjusts the arms so hands actually meet, even when characters have different heights.
5. Faces react automatically using each player's own expressions (a smile during a high-five, a giggle after a poke).

Network cost is a couple of short messages per interaction.

### 5.4 Animation sources (free)
- One standard humanoid skeleton shared by all characters, so every clip works on every body.
- **Mixamo** (free with an Adobe account) for base clips: idle, walk, wave, clap, body laugh.
- **Paired interactions** will mostly need to be made or adjusted in **Blender**, since free two-person clips are rare.
- **Three.js `AnimationMixer`** plays and crossfades body clips. Face morph targets play on top.

## 6. Privacy

- **The snapped photos never leave the phone.** All processing happens on the device.
- After processing, the game keeps only the **derived face data** (avatar parameters + expression data). The photos can be deleted, or kept locally if the player wants to re-process later.
- The giggle clip is stored as numbers only (blendshape values per frame). **No video is kept.**
- Only the derived face data (a few KB) goes to the server, so other players in the room can see the character.
- This keeps biometric photos off the server (good for PDPA) and keeps bandwidth tiny.

## 7. Multiplayer architecture

```
[Player phone: PWA]
   │  HTTPS
   ▼
[Cloudflare Pages]  ← serves HTML / JS / 3D models
   │  WebSocket
   ▼
[Cloudflare Worker] → routes to room by code
   ▼
[Durable Object: one per room]
   - holds the room state
   - shares each player's face data on join
   - relays positions + expression triggers
   - stores data (SQLite)
```

### Rules to stay inside the free tier
- Use the **WebSocket Hibernation API** (`ctx.acceptWebSocket()`) so empty rooms sleep.
- Send player positions at **10–15 per second**, not 60. Interpolate on the client.
- Send each player's face data (including the giggle clip) **once, when they join**. After that, expressions are just short triggers (for example `"smile"`), because everyone already has the expression data.
- Interactions are also short messages: request, accept, start.
- Don't log every tick to storage. Keep only what the game needs.

### Free tier budget (Durable Objects, per day)
- 100,000 requests. Incoming WebSocket messages count at 20:1, which gives about **2 million player messages/day**.
- 13,000 GB-s of compute, roughly **28 hours of active room time/day**.
- Going over a limit makes requests fail. **It never creates a bill.** Limits reset at 00:00 UTC (8:00 am Malaysia time).

### Fallback server (RM0 + electricity)
Raspberry Pi 5 running a Node game server (for example Colyseus), exposed through a free **Cloudflare Tunnel**. No daily caps.

## 8. Costs

Exchange rate assumed: **US$1 ≈ RM4.07** (end of Sept 2026). The card FX fee may add 1–3%.

| Item | Option | First year | Renewal/yr |
|---|---|---|---|
| Hosting | Cloudflare Pages + Workers free tier | RM0 | RM0 |
| Domain | `4a2s.pages.dev` style subdomain | RM0 | RM0 |
| Domain | `.xyz` (Spaceship / Porkbun promo) | ~RM4 | ~RM52 |
| Domain | `.click` (Spaceship) | ~RM5 | ~RM43 |
| Domain | `.com` (Cloudflare, at cost) | ~RM43 (~RM45 from 1 Nov 2026) | ~RM45 |
| Domain | `.my` (Exabytes / Shinjiru) | ~RM89 (watch for festive promos) | ~RM89 |

**Plan:** use the free `pages.dev` subdomain while building. When friends start playing, get a cheap promo domain for a one-year test, or a `.com` at Cloudflare if keeping it long-term.

Domain prices change often. Check them at checkout.

## 9. Roadmap

### Phase 0 — Setup
- [ ] Vite + TypeScript + Three.js project
- [ ] Deploy to Cloudflare Pages and test on iPhone Safari
- [ ] PWA manifest, so it can be added to the home screen

### Phase 1 — Neutral face scan
- [ ] Camera + MediaPipe Face Landmarker running in the PWA
- [ ] Draw landmarks over the video for debugging
- [ ] Neutral-face check using blendshapes
- [ ] Head-pose guide ring covering all angles (front, ~45° L/R, up, down, diagonals)
- [ ] Frame quality checks (lighting, blur, centering, confidence)
- [ ] Measure FPS and phone heat on the target iPhone

### Phase 2 — Expression snaps
- [ ] Expression detection + live strength meter
- [ ] Auto-snap when held steady
- [ ] Smile, laugh, angry, sad (+ optional surprised)
- [ ] Retake / skip with default fallback
- [ ] Giggle clip recording (2–3 s of blendshape values)

### Phase 3 — Apply face data to character
- [ ] Base head mesh in Blender with likeness morph targets
- [ ] 52 expression shape keys (ARKit names)
- [ ] Multi-angle fitting → avatar parameters
- [ ] Skin tone sampling
- [ ] Personal expressions (blendshape weights + landmark corrections)
- [ ] Preview screen cycling through expressions + manual sliders
- [ ] Save face data to IndexedDB

### Phase 3b — Semi-real look + animation
- [ ] Semi-real skin, eyes and lighting; test performance on iPhone
- [ ] Humanoid rig + Mixamo base clips (idle, walk, wave, clap)
- [ ] Layered face + body animation in `AnimationMixer`
- [ ] Giggle animation: personal clip playback + procedural fallback + body bounce
- [ ] Solo emotes

### Phase 4 — Multiplayer
- [ ] Worker + Durable Object room with join codes
- [ ] Share face data on join
- [ ] Sync position/rotation at 10–15 Hz + interpolation
- [ ] Expression triggers
- [ ] Paired interactions (request/accept/start, positioning, hand IK, synced playback)
- [ ] Hibernation verified, free tier usage monitored

### Phase 5 — Game + in-game customization
- [ ] Decide the game goal and core loop
- [ ] Hair, neck, body, clothing customization
- [ ] Build the game

### Phase 6 — Polish and launch
- [ ] Domain (if wanted)
- [ ] Offline caching for assets
- [ ] Test with friends on different iPhones

## 10. Risks

| Risk | Mitigation |
|---|---|
| MediaPipe + 3D rendering too heavy on older iPhones | Lower camera resolution, run tracking at a lower FPS than rendering, test early (Phase 1) |
| Poor lighting ruins the scan | Lighting check before capture, guidance messages |
| Players can't act angry or sad convincingly | Lenient thresholds, retake/skip, default expression fallback |
| Likeness too generic for distinctive faces | More capture angles + manual sliders after the scan |
| Semi-real faces falling into the uncanny valley | Keep skin and details slightly simplified, focus on good eyes and smooth expressions, test with friends early |
| Semi-real rendering too heavy for many players | Polycount and texture budgets, lower detail for distant characters |
| Paired animations look off (hands miss, out of sync) | Shared meeting point from the server, hand IK, server-timed start |
| Safari WebGL quirks | Test on a real iPhone from day one |
| Safari clearing local data | Encourage "Add to Home Screen"; optionally back up face data to the server |
| Free tier limits hit | Lower update rate, hibernation, Raspberry Pi fallback |

## 11. Open questions

- [ ] What is the game goal / genre?
- [ ] Multiplayer style: real-time action, or turn-based / casual rooms?
- [ ] How many players per room?
- [ ] Which interactions to build first (high-five, hug, handshake, poke...)?
- [ ] Giggle sound: none, generic, or recorded by the player?
- [ ] Final list of expressions to capture (smile, angry, sad, laugh + which extras?)
- [ ] How expressions are used in game: emote buttons, automatic reactions to game events, or also live mirroring of the player's real face?
- [ ] Keep the snapped photos on the phone after processing, or delete them?
