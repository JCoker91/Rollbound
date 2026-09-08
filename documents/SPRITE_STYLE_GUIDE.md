# Stagebound Sprite Style Guide

**Status:** Working standard v2.0
**Purpose:** Keep every Performer, enemy, and prop visually consistent across generation, cleanup, animation, and export — even though each one is generated independently by an AI.

> **Precedence.** The approved reference sprite is the visual source of truth. When a written rule conflicts with it, match the sprite and update this guide afterward. When a rule conflicts with what `scripts/pack_sprites.py` measures, the measurement wins — the pipeline is what actually renders the game.

---

## 0. Why this document is strict

Every sprite is generated in a separate conversation, from a separate prompt, by a model with no memory of the last one. Nothing enforces consistency except this guide and the acceptance checklist. A sprite that looks great alone and wrong beside the roster is a **failed sprite**.

The failure mode is never obvious in isolation. Each of these shipped and looked fine until something was measured against something else:

| What happened | How it looked alone | What it actually broke |
| --- | --- | --- |
| An `_HQ` render carried 272k–612k semi-transparent pixels | Fine | An invisible halo inflated the content box; the character drew up to 40% small at the same nominal scale |
| Two sheets for one character used 640px and 362px cells | Both fine | Same character, 1.73× different size; the shared crop box was computed across two incompatible coordinate spaces |
| An idle sheet held 2.4 repetitions of a 5-frame bounce | Fine | Looping wrapped mid-bounce and visibly hitched |
| A replaced sprite kept the old aspect ratio in code | Fine | Rendered 22% too wide |

**Consistency is a cross-sheet property.** Most of the rules below exist because a per-sheet check cannot catch these.

---

## 1. Style Target

Compact high-fantasy JRPG battle sprites with the visual density and readability of *Final Fantasy Brave Exvius*, all designs original.

- Stylised rather than realistic
- Clearly pixel-built, not a smooth illustration with a pixel filter
- Chibi-proportioned, but not cute or super-deformed
- Readable at gameplay size
- Detailed enough to identify clothing, armour, weapon type, and role
- Too low-resolution for a clearly drawn mouth or small facial anatomy
- Dramatic in silhouette, restrained in surface detail

### Stagebound context

Performers are drawn from countless realms and gathered into the Grand Theater's Cast, so **the roster has no shared culture or aesthetic** — a knight, a witch, and an armoured bear belong side by side. See `STAGEBOUND_STORY_REFERENCE.md`.

What holds them together is not theme, it is **rendering language**: pixel scale, outline weight, palette density, shading complexity, camera angle, and level of detail. Change the character freely. Never change the rendering language.

Two consequences specific to this game:

- **Sprites are lit for a stage, not a battlefield.** Keep the upper-left key light consistent; the backdrop supplies the mood.
- **Silhouette carries further than detail.** Figures are drawn 2–3× larger in a side-view Performance than a tile grid would allow, but they are still read at a glance against a painted backdrop.

---

## 2. Canonical Technical Specification

| Property | Standard |
| --- | --- |
| Working canvas | 64 × 64 native pixels |
| Delivery canvas | 256 × 256 pixels |
| Upscaling | Exactly 4× nearest-neighbour; no smoothing |
| Colour mode | RGBA |
| Background | Fully transparent |
| Orientation | Three-quarter view, facing screen-right |
| Ground line | Native y = 56, delivery y = 224 |
| Playable humanoid height | 37–50 native pixels (see §3) |
| Typical humanoid width | 22–46 native pixels, excluding long weapons |
| Safe margin | ≥ 4 native pixels (16 delivery) on every edge |
| Pixel edges | Hard-edged; no anti-aliasing or semi-transparent fringe |
| File format | PNG-24/32 with alpha |

All design decisions are made on the **64 × 64 native grid**. The 256 × 256 file is a clean 4× export. Never generate or repaint detail directly at 256 × 256.

### 2.1 The delivery set

Four files per Performer. They are not variants of each other — each answers a different question.

| File | What it is | Who uses it |
| --- | --- | --- |
| `<name>_base_native_64.png` | 64 × 64 working grid | Design source of truth; humans |
| `<name>_LQ.png` | 256 × 256, exactly 4× nearest-neighbour | **The measurement reference.** Stature, ground line, and the audit all read this |
| `<name>_HQ.png` | High-detail render, any size | **What the game ships.** Best pixels at the size battles draw |
| `<name>_icon.png` | Hand-cropped square headshot | Portraits and party lists |

**Size and pixels are separate questions with different answers.** How big a character is comes from the 64px grid, because that is the one measurement the whole roster shares. *Which pixels get drawn* is a rendering question, and at the size a side-view Performance draws figures, `_HQ` measurably wins — comparable at ~97px, clearly better at 180px, decisively at 260px.

### 2.2 Alpha rules differ by file

- **`_base_native_64` and `_LQ`: alpha is strictly 0 or 255.** No exceptions. These are the measurement references, and a semi-transparent fringe silently enlarges the content box.
- **`_HQ` may carry soft alpha.** It is a render, not pixel art. The pipeline trims it on an alpha floor of 12 rather than trusting `getbbox()`, precisely because every `_HQ` in the roster carries hundreds of thousands of near-invisible pixels.
- **`_HQ` must not have a detached halo.** Soft edges hugging the figure are fine. A faint wash reaching into empty canvas is not — it is indistinguishable from content and will resize the character.

---

## 3. Proportions and relative stature

Standard humanoids:

- Overall height ≈ 3.25–3.75 heads
- Head ≈ 25–30% of total height
- Torso short and compact
- Hands and feet slightly enlarged for readability
- Shoulders wide enough to carry the silhouette
- Legs short, sturdy, visibly separated
- Weapons oversized by roughly 15–30%

Body type may change. **Head scale, detail density, and pixel scale must not.** A large warrior becomes *broader*, not taller or more finely detailed.

### Stature is deliberate, and the grid is what makes it work

The roster spans 37 to 50 native pixels, and that is **correct, not drift**. Because every sheet is built on the same 64px grid, the art already encodes relative stature — the engine scales the whole Cast by one global factor rather than a hand-tuned per-character table. Rebar reads as a stocky bear and Maxine as the tallest of the Cast because the art says so.

This only holds while every sprite is genuinely built on the shared grid. A sprite designed at some other resolution and resized to fit is the one thing that breaks it, and it is invisible until two sprites stand together.

> **The rule is not "be 44–50 native pixels tall." It is "be honestly measured on the 64px grid."** Height is an outcome.

### Creatures and quadrupeds

- Same native grid and pixel size as humanoids.
- Keep the eye line and ground line compatible with the humanoid roster.
- Compact readable silhouette over realistic animal anatomy.
- A bear or similar may occupy 46–54 native pixels horizontally.
- Armour as large readable plates or bands, never many tiny fittings.

---

## 4. Pose and Camera

Default pose is a neutral combat idle:

- Three-quarter view facing screen-right
- Head turned slightly toward the opponent
- Feet planted at different horizontal positions — no flat paper-doll stance
- Knees slightly bent
- Weapon ready, not obscuring the face or torso silhouette
- Centre of mass balanced; no running or striking in the base sprite

Avoid full profiles, straight-on symmetry, realistic perspective, dramatic camera angles, wide stances that force a smaller character scale, and weapons crossing the face.

---

## 5. Pixel Construction

The sprite must look deliberately drawn one pixel cluster at a time.

**Required:** connected pixel clusters, not isolated noise · stair-step diagonals with deliberate rhythms (1-1, 2-1, 2-2) · contours readable as a single silhouette · one-native-pixel details only at focal points · every native pixel meaningful.

**Prohibited:** anti-aliased contours · blurred or feathered edges · subpixel-looking lines · painterly texture · smooth gradients · dense dithering · random single-pixel highlights · high-resolution facial rendering disguised by blocky upscaling.

---

## 6. Outlines

- Dark coloured outline, generally charcoal hue-shifted toward the local material.
- Exterior contours usually 1 native pixel.
- 2-pixel clusters only at deep overlaps, the underside of the body, or the darkest corners.
- Interior lines selective and lighter than the darkest outer contour.
- Do not outline every plate, fold, finger, or facial feature independently.
- Avoid pure black except at the deepest separation point.

| Material | Outline tendency |
| --- | --- |
| Skin / warm leather | Very dark brown or muted plum |
| Steel / blue fabric | Blue-black or cool charcoal |
| Green fabric / foliage | Very dark desaturated green |
| Gold / brass | Dark umber |

---

## 7. Palette and Shading

**Budget:** 16–24 colours per complete sprite including outlines. One material normally uses 3 tones (shadow, base, highlight); important materials 4; minor materials 2–3. Reuse shadow and outline colours across materials where practical.

*The current roster measures 18–23 colours. A sprite arriving at 40+ has almost certainly been rendered rather than drawn.*

**Lighting:** key from the upper-left/front. Shadows collect lower-right, beneath hair, below arms, between legs, under armour overlaps. Highlights are small clusters, never continuous glossy stripes. Hue-shift: highlights warmer, shadows cooler or more purple. Preserve strong value separation between adjacent major shapes.

**Contrast hierarchy:** face and hair silhouette → weapon or defining equipment → upper torso and primary costume colour → boots, straps, trim, accessories. Small accessories must not compete with the face or weapon.

---

## 8. Face and Hair Detail

At native resolution the face is symbolic, not illustrated.

- Eyes: one dark pixel, or a 1–2 pixel cluster per visible eye
- Nose: implied by shadow; at most one pixel
- Mouth: normally omitted
- Beard: one or two larger shadow clusters following the jaw
- Eyebrows: only if essential, as a compact cluster
- Hair: 3–6 large locks or masses; never individual strands

If the sprite has a clearly drawn mouth, nostrils, pupils, eyelashes, or individual beard hairs, **it is too detailed.**

---

## 9. Clothing, Armour, and Weapons

**Clothing** — communicate fabric through large folds and colour blocks; 1–3 dominant fold shapes per garment; capes and coats strengthen the silhouette rather than adding internal noise.

**Armour** — chunky readable forms; plate separation via shadow blocks, not thin linework; limit rivets, engraving, and trim; metallic highlights are short high-contrast clusters.

**Weapons** — clean silhouette at consistent pixel scale; hard stepped blade edges; oversized but anatomically holdable; hands visibly connected to the grip; grip, guard, and blade aligned on one believable axis. Never allow a weapon to bend, fork, merge into clothing, or change thickness midway.

---

## 10. Animation Sheets

> **Read this section before generating any animation.** Every rule here exists because a sheet that was correct on its own broke when played beside another sheet for the same character.

Animation begins only after the base sprite is approved.

### 10.1 The cross-sheet contract

All clips for one Performer must agree on **all four** of these. Getting three right is not partial credit — one mismatch is a broken character.

1. **Identical cell size.** Every sheet uses the same square cell. If the idle uses 640px cells, the attack uses 640px cells.
2. **Identical figure scale.** The character occupies the same number of pixels in every clip. Not the same *fraction of the cell* — the same absolute size.
3. **Identical ground line.** Feet rest on the same row in every cell of every sheet.
4. **Identical palette.** Reuse the base sprite's exact colours.

Rules 1 and 2 are separate, and conflating them is the specific mistake that broke this project. Maxine's idle arrived as 640px cells with a 584px figure; her celebration as 362px cells with a 338px figure. **Both filled ~92% of their own cell**, so neither sheet looked wrong — but the same character was drawn 1.73× smaller in one of them.

The pipeline now detects and corrects this (`normalise()` in `pack_sprites.py`, reported as the `normalised` factor). **Do not rely on it.** Correction means resampling, and a clip scaled up 1.7× is permanently softer than the art it was matched to.

### 10.2 Sheet layout

- Frames laid out on a **regular grid**, read left-to-right then top-to-bottom.
- The grid is inferred from the image's own dimensions — the greatest common divisor of width and height is taken as the cell size. `7680 × 640` resolves to 12 × 1; `1448 × 1086` to 4 × 3.
- **Therefore the cell must be square and divide both dimensions exactly.** A sheet whose gcd is not the intended cell size will be split wrongly, with no error.
- No gutters, labels, frame numbers, or borders.
- Fully transparent background, same alpha rules as the source sprite type.

> **If a sheet arrives on a flat colour instead of transparency, the pipeline will recover it** —
> it keys the backdrop, un-mixes the anti-aliased ring so no coloured outline is left, and clears
> pockets the fill cannot reach (the hole through a staff, the gap under a raised arm). It works,
> and it is still second best: recovery depends on the backdrop being *perfectly* flat, and any
> part of the figure genuinely matching that colour is at risk. Ask for transparency.

### 12 frames at 640px cells is the current house format: `7680 × 640`.

### 10.3 Looping clips

Named `idle`, `walk`, `run`, `float`, **or ending in `_ending`** (§10.5).

- **Must contain a whole number of complete cycles.** The last frame must hand back to the first without a jump.
- Do not deliver 2.4 repetitions of a bounce. Both original idles did, and the loop visibly hitched at the wrap; the pipeline detects the period by frame self-similarity and trims the remainder, which throws away frames you paid for.
- **Do not repeat the first frame at the end as a loop cue.** The pipeline recognises and drops a duplicated final frame, but it is a wasted frame either way — and holding that pose for two frames is a visible stutter if it slips through.
- Idle motion is small: breathing, cloth, hair, weapon settle. **Never** a change that alters the silhouette or implies an attack.

### 10.4 One-shot clips

Anything else — `attack`, `celebration`, `hit`, `cast`, `death`.

- Plays once and hands back to a looping clip, so it must **end somewhere that clip can continue from** (§10.5).
- Never cycle-trimmed, so every frame you deliver is used.
- May leave the ground. A jump is preserved correctly *because* all clips share a crop box — the character rises within the box rather than the box resizing around them.

### 10.5 Ending poses — where a one-shot comes to rest

A one-shot has to hand back to something or the character freezes on its last frame. There are two ways to arrange that, and the second is usually better.

**Return to the idle.** The clip's first and last frames both sit close to the neutral resting pose. Cheap, and right for `hit` or a quick `cast`.

**Settle into a held pose.** Deliver a second, looping sheet named `<clip>_ending`. A Performer who has just taken a bow keeps holding the bow, breathing in it, instead of snapping back to a combat stance.

```text
maxine_celebration.png          12 frames, one-shot   -- the flourish
maxine_celebration_ending.png    8 frames, loops      -- holding the pose
```

The suffix is the whole mechanism; no configuration. The pipeline resolves `settlesInto` automatically, preferring the clip's own ending and falling back to `idle`.

Requirements for an ending sheet:

- **It loops**, so §10.3 applies in full — whole cycles, no duplicated final frame.
- **Its first frame continues from the one-shot's last.** Aim for a step no larger than a normal frame-to-frame step inside the one-shot itself; Maxine's measures 0.95× hers, which is why the hand-off is invisible.
- **Same cell size and figure scale as every other sheet** (§10.1). This is the rule most often broken on a follow-up sheet delivered later than the original — Maxine's ending arrived at 256px cells against her idle's 640px and had to be upscaled 2.36×, which cost real detail.
- **Ground line matches.** The feet must sit where the one-shot left them.

### 10.5 Motion within a frame

- **Move clusters; do not redraw the character at a different resolution.** Re-rendering a frame is how a sheet ends up at a different figure scale.
- Keep head, torso, hands, weapon, and feet on consistent anchor points.
- Timing is authored in data, not baked into frames. Do not deliver duplicated frames to create a hold — any frame can be given a `hold` weight in `art/actors/<name>/<name>.anim.json`, and duplicates just cost bundle size.
- Do not bake position offsets either. Per-frame `dx`/`dy` live in the same file.
- **A frame that does not work can be disabled rather than re-exported.** The same file carries an `order` list, so a bad frame can be dropped or the sequence rearranged without touching the sheet. Prefer fixing the art when it is cheap; use this when it is not.

---

## 11. Composition and Export

- Centre the visual **mass**, not necessarily the head.
- Every opaque pixel inside the safe margin.
- Both feet, or all grounded paws, on the same ground line unless the pose clearly requires otherwise.
- **No cast shadow** in the master sprite; the game renders shadows separately.
- Remove all background pixels completely.
- Export with nearest-neighbour scaling only.

### Naming

The pipeline parses these. They are not suggestions.

```text
art/actors/<name>/<name>_base_native_64.png
art/actors/<name>/<name>_LQ.png
art/actors/<name>/<name>_HQ.png
art/actors/<name>/<name>_icon.png
art/actors/<name>/animations/<name>_<clip>.png
```

`<name>` is lowercase, no spaces, and matches the character id in `engine/content.ts`. `<clip>` decides looping behaviour (§10.3). Keep superseded art with a suffix — `<name>_previous_*.png` — never by leaving it in `animations/`, which is scanned indiscriminately.

**Never place anything in `public/`.** It is generated wholesale from `art/` and a run will overwrite or prune it.

---

## 12. What the pipeline measures

Knowing what is read makes it obvious why the rules matter. `scripts/pack_sprites.py` derives all of this automatically — nothing is hand-copied into code, because hand-copied metrics go stale.

| Measured | From | Used for |
| --- | --- | --- |
| `nativePx` | `_LQ` content box ÷ 4 | Relative stature across the Cast |
| `aspect`, `anchorX` | Shipped sheet | Draw size and foot-centred mirroring |
| `restFill` | Median resting frame ÷ box height | Sizing by **figure**, not by crop box |
| `footPad` | Feet above box bottom | Landing feet on the slot mark |
| `normalised` | Figure ÷ reference figure | Cross-sheet scale correction (§10.1) |
| `loops`, `frames` | Clip name, cycle detection | Playback mode and cycle trimming |

The script also runs this guide's checklist as a lint and prints violations. **They are warnings, never fatal** — a sprite 2px off the ground line is still usable, and the roster should not be blocked on it. Drift is worth seeing because the ground line is what keeps feet on one line.

---

## 13. Generation Prompt Templates

### 13.1 Base sprite

Attach the approved reference. Replace only the bracketed description.

```text
Create one original playable high-fantasy JRPG battle sprite of [CHARACTER DESCRIPTION]. Use a compact, low-resolution mobile pixel-art style inspired by the visual density and chibi proportions of Final Fantasy Brave Exvius, but do not reproduce an existing character or design.

The sprite must be designed on a true 64x64 pixel grid and delivered as a 256x256 PNG enlarged exactly 4x with nearest-neighbor scaling. Show the complete character in a neutral combat-idle pose, three-quarter view facing screen-right, with the feet aligned near y=224 on the delivered canvas. Keep at least 16 delivered pixels of empty margin around the sprite.

Use chunky, deliberate pixel clusters, hard stair-stepped edges, a dark colored one-pixel native outline, approximately 16-24 total colors, and only 3-4 shades per major material. Light comes from the upper-left. Use a large readable silhouette and restrained internal detail. The head should be roughly one quarter of the figure's height. Slightly exaggerate the hands, feet, and weapon for gameplay readability.

The face must remain extremely simple: tiny eyes, an implied nose, and no clearly drawn mouth. Hair and facial hair must use large pixel clusters rather than strands. Clothing and armor use broad shapes with very few folds, seams, rivets, or decorations.

Do not use anti-aliasing, smooth gradients, painterly texture, realistic anatomy, realistic rendering, fine facial details, individual hair strands, dense dithering, random pixel noise, a cast shadow, scenery, text, a frame, multiple poses, or a sprite sheet. Use a fully transparent background with clean binary-alpha edges: every pixel is either fully opaque or fully transparent.

Match the attached approved reference sprite's pixel size, body proportions, outline weight, palette density, shading complexity, camera angle, and overall level of detail. Change the character design, not the rendering language.
```

### 13.2 Animation sheet

**Attach the character's approved base sprite AND an existing sheet for the same character if one exists.** The second attachment is what holds cell size and figure scale steady across clips.

```text
Create a [CLIP NAME] animation sprite sheet for the attached character. Match the attached sprite exactly: same character, same palette, same pixel size, same outline weight, same level of detail.

Deliver a single PNG containing [N] frames in one horizontal row, each frame exactly [CELL]x[CELL] pixels, so the file is [N*CELL]x[CELL]. Frames read left to right. Do not add gutters, borders, labels, frame numbers, or a background — the background must be fully transparent.

The character must occupy the same absolute pixel size in every frame and in every other sheet for this character. Do not resize, recenter, or reframe the character between frames. The feet must rest on the same row in every frame.

[FOR A LOOPING CLIP:] This is a looping idle. Deliver a whole number of complete cycles so the last frame hands back to the first with no jump. Keep the motion small — breathing, cloth, hair, and weapon settle only. Do not alter the silhouette or imply an attack.

[FOR A ONE-SHOT CLIP:] This plays once and returns to the idle, so begin and end close to the attached resting pose.

Animate by moving existing pixel clusters. Do not redraw or re-render the character at a different resolution between frames. Do not duplicate frames to create a pause; timing is handled outside the image.
```

---

## 14. Character Brief Template

Complete before generating.

```text
Name:
Role/class:
Body type/species:
Primary silhouette feature:
Hair/fur:
Clothing/armor:
Weapon/equipment:
Primary color:
Secondary color:
Accent color:
Personality expressed in pose:
Details that must appear:
Details that must not appear:
```

Limit to **three must-show details.** More will either make the sprite noisy or push the generator to raise the apparent resolution.

---

## 15. Reference Sheet

Approved reference: **Benjamin** (`art/actors/benjamin/benjamin_LQ.png`) — the sword-wielder this standard was calibrated against.

| Measurement | Benjamin | Roster range |
| --- | --- | --- |
| Opaque bounding box (256 canvas) | 64, 56 → 232, 224 | — |
| Height, native px | 42 | 37 – 50 |
| Width, native px | 42 | 32 – 59 |
| Ground line, native y | 56 ✓ | 53 – 56 |
| Safe margin, delivery px | 24 ✓ | 4 – 40 |
| Unique opaque colours | 23 | 18 – 23 |
| Semi-transparent pixels in `_LQ` | 0 ✓ | 0 across the roster ✓ |
| Head-to-body ratio | ≈ 1 : 3.6 | — |

**Current roster deviations, and what to do about them.** These are recorded rather than hidden, because a guide nobody's art passes is a guide nobody reads.

- **Kael** — 59 native px wide with only 4 delivery px of margin. Wide is fine (he is meant to be broad); the margin is not, and it leaves nothing for an animation to swing into. Regenerate with margin if he is ever animated.
- **Aethis, Rebar** — feet 3 native px above the ground line. Harmless for a still, because the pipeline trims and re-anchors. **Not** harmless once either is animated, where every frame must share a ground line.
- **Rebar at 37 native px** — deliberate. He is a stocky bear, and the shared grid is what lets that read as stature rather than as an error.

---

## 16. Acceptance Checklist

Approved only if every required item passes.

### Technical

- [ ] `_LQ` is exactly 256 × 256
- [ ] Clearly derived from a 64 × 64 native grid at 4×
- [ ] Transparent background
- [ ] `_LQ` and native have **no** semi-transparent pixels
- [ ] `_HQ` has soft edges hugging the figure, with no detached halo
- [ ] ≥ 16 delivery pixels of margin
- [ ] Feet align with the roster ground line

### Style

- [ ] Same apparent pixel size as the reference
- [ ] Height plausible against comparable roster members
- [ ] Chibi JRPG proportions without becoming overly cute
- [ ] No clearly drawn mouth or high-resolution facial anatomy
- [ ] Hard pixel clusters, no smoothing
- [ ] 16–24 colours
- [ ] ≤ 3–4 tones on a major material
- [ ] Light consistently from the upper-left
- [ ] Silhouette reads at 64 × 64

### Design integrity

- [ ] Correct count of arms, legs, eyes, weapons, accessories
- [ ] Hands connect correctly to weapons
- [ ] Weapon geometry straight, continuous, intentional
- [ ] Clothing and equipment do not merge accidentally
- [ ] Recognisable at native size
- [ ] No unrequested background, shadow, text, border, or extra pose

### Animation sheets — checked **against the other sheets**, not alone

- [ ] Cell size identical to every other sheet for this character
- [ ] Figure occupies the same absolute pixel size as every other sheet
- [ ] Ground line identical across every frame of every sheet
- [ ] Palette identical to the base sprite
- [ ] Cell is square and divides both image dimensions exactly
- [ ] Looping clips contain whole cycles
- [ ] One-shots either begin and end near the resting pose, or ship a matching `_ending` sheet
- [ ] An `_ending` sheet's first frame continues cleanly from the one-shot's last frame
- [ ] No looping sheet repeats its first frame at the end
- [ ] No duplicated frames used as timing
- [ ] `normalised` reports ≈ 1.0 after packing

### Immediate rejection

- The sprite looks like a detailed digital painting reduced in size.
- Individual facial features or hair strands are clearly rendered.
- Pixel sizes vary within one sprite.
- Visibly more detailed than the approved reference.
- Anatomy or equipment count is wrong.
- Weapon axis, grip, or silhouette is malformed.
- Smooth transparency or blurred edges on `_LQ` or native.
- An animation sheet disagrees with its siblings on cell size, figure scale, or ground line.

---

## 17. Workflow

**Base sprite**

1. Attach the approved reference.
2. Fill in the character brief.
3. Generate using the unchanged prompt template.
4. Judge at both 256 × 256 and native 64 × 64.
5. Reject structural or style failures rather than stacking repair prompts.
6. Clean on the native 64 × 64 grid.
7. Re-export at 4× nearest-neighbour.
8. Drop into `art/actors/<name>/` and run `python scripts/pack_sprites.py`.
9. Read the audit output; approve before animating.

**Animation**

10. Attach the approved base **and** an existing sheet for the same character.
11. Generate with the animation template, stating cell size and frame count explicitly.
12. Drop into `art/actors/<name>/animations/` and re-run the pack script.
13. Check the reported `normalised` factor. **≈ 1.0 means the sheet agreed with its siblings.** Anything else means it was resampled — prefer regenerating at the right scale over accepting the softness.
14. Review in the animation lab (`?dev=1` → **▶ Dev**), including **Play once, then idle** to watch the hand-off into whatever the clip settles into.
15. Author timing, placement, and frame order in the lab and hit **Save** — it writes `art/actors/<name>/<name>.anim.json`. Never bake any of it into the art.

---

### Revision note

**v2.0** — Restructured around the failure modes found in production. Adds §0 (why cross-sheet consistency is the hard problem), §2.1–2.2 (the four-file delivery set and its differing alpha rules), §10 (animation sheets, entirely new and the most important section), §12 (what the pipeline measures), an animation prompt template, animation acceptance criteria, and real measured reference values replacing v1.0's pending placeholders. Reframes the height range: relative stature is deliberate and the shared 64px grid is what makes it legible, so honest measurement replaces a rigid range.
