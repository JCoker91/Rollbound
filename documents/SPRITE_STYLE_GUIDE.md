# Game Sprite Style Guide

**Status:** Production standard v2.0  
**Purpose:** Keep every playable character and creature visually consistent across design, generation, cleanup, animation, and export.

> The approved sword-wielding character remains the visual source of truth for rendering style. This guide is the source of truth for canvas size, body scale, anchors, palette, animation layout, and export requirements.

## 1. Style Target

Create original, compact high-fantasy JRPG battle sprites with the visual density and readability of premium mobile pixel art.

The result must be:

- Stylized rather than realistic
- Designed as native pixel art, not a smooth illustration passed through a pixelation filter
- Chibi-proportioned without becoming overly cute or super-deformed
- Readable at gameplay size
- Detailed enough to identify role, clothing, armor, weapon, and major personality traits
- Built from intentional pixel clusters with restrained surface detail
- Consistent in apparent scale beside every other roster character

## 2. Canonical Technical Specification

| Property | Standard |
| --- | --- |
| Native base-frame canvas | 128 × 128 pixels |
| Working color mode | RGBA |
| Background | Fully transparent |
| Default orientation | Three-quarter view, facing screen-right |
| Humanoid ground anchor | X = 64, Y = 112 |
| Humanoid feet baseline | Y = 112 |
| Standard humanoid body height | 82–92 pixels |
| Maximum standard humanoid body height | 96 pixels |
| Typical humanoid body width | 38–56 pixels |
| Minimum canvas safety margin | 8 pixels; 12 preferred |
| Palette limit | Maximum 64 colors including transparency |
| Preferred character colors | Approximately 24–48 opaque colors |
| Alpha | Binary only: 0 or 255 |
| Pixel edges | Hard-edged; no anti-aliasing |
| File format | PNG with alpha |
| Scaling | Nearest-neighbor only |

All final sprite decisions must be made on the native pixel grid. Do not generate a high-resolution illustration and rely on automatic pixelation or color reduction to create the production sprite.

## 3. Canvas Size Is Not Character Size

The frame canvas defines the coordinate system. It does not define how much of that frame the complete silhouette must fill.

- Scale a character according to the body, not the total bounding box.
- Weapons, hats, capes, wings, tails, hair, and spell effects must not cause the body to be scaled down.
- Transparent unused space is permitted and expected.
- Comparable characters must have comparable body height even when their total silhouette widths differ.
- Never automatically fit or stretch the complete silhouette to the canvas.

Examples within a 128 × 128 base frame:

| Character | Approximate occupied area | Scaling basis |
| --- | --- | --- |
| Standard sword fighter | 55 × 90 px | Body height |
| Mage with hat and staff | 90 × 96 px | Body height; equipment extends outward |
| Heavy armored humanoid | 65 × 96 px | Broader body, only slightly taller |
| Large quadrupedal bear | 110 × 70 px | Shoulder height and body length |

These occupied areas are guidance, not crop boxes. The anchor and body scale take priority.

## 4. Scale Classes

Assign every character a scale class before generating the base sprite.

| Scale class | Typical subjects | Target body measurement |
| --- | --- | --- |
| Small | Children, goblins, tiny humanoids | 58–72 px tall |
| Standard | Most adult humanoids | 82–92 px tall |
| Large | Heavy warriors, orcs, large humanoids | 92–104 px tall |
| Quadruped | Bears, wolves, similar creatures | 85–112 px long; species-appropriate height |
| Giant | Bosses and exceptional creatures | Larger dedicated canvas required |

Rules:

- Large humanoids should become broader before becoming dramatically taller.
- Quadrupeds are measured primarily by torso length, shoulder height, and paw baseline.
- Small characters should still use the same pixel size and detail density as the rest of the roster.
- Giant characters must not be squeezed into a 128 × 128 frame.

## 5. Anchors and Registration

Every animation frame must share stable anchor points.

### Required anchors

- **Ground anchor:** center point between grounded feet or paws
- **Feet/paw baseline:** the shared ground-contact line
- **Body center:** stable torso reference used to prevent frame-to-frame drift
- **Weapon-hand anchor:** the hand position where equipment connects
- **Effect origin:** staff gem, weapon tip, hand, mouth, or other effect-emission point

### Standard humanoid placement

```text
Canvas: 128 × 128
Ground anchor: (64, 112)
Feet baseline: Y = 112
Horizontal body center: X = 64
Preferred top clearance: 8–12 pixels
Preferred bottom clearance: 12–16 pixels
```

The visible body may lean or move, but the intended anchor must remain consistent. Animation frames must not jitter because their opaque bounding boxes were centered independently.

## 6. Character Proportions

Use the following proportions for standard humanoids:

- Overall body height: approximately 3.25–3.75 heads
- Head: approximately 25–30% of total body height
- Torso: short and compact
- Hands and feet: slightly enlarged for gameplay readability
- Legs: short, sturdy, and separated enough to read clearly
- Weapons: approximately 15–30% larger than realistic scale when needed for readability

Body type may change, but pixel size and detail density must remain consistent. A heavy warrior becomes broader and more massive; a small character becomes shorter without gaining finer pixels.

### Creatures and quadrupeds

- Keep paws on the roster baseline unless the animation requires otherwise.
- Preserve the same apparent pixel size as humanoids.
- Favor a compact, readable silhouette over realistic animal anatomy.
- Armor must use large plates or bands instead of many tiny fittings.
- A quadruped must remain visibly four-legged when that is part of its design.
- Do not scale a quadruped down merely because its body is wider than a humanoid.

## 7. Pose and Camera

The default base sprite is a neutral combat idle:

- Three-quarter view facing screen-right unless the brief explicitly requires another orientation
- Head turned slightly toward the opponent
- Feet offset enough to avoid a flat paper-doll stance
- Knees slightly bent
- Weapon held ready without obscuring the face or torso silhouette
- Balanced center of mass
- Complete body and required equipment visible

Avoid:

- Full profile views
- Straight-on symmetrical humanoid poses unless intentionally specified
- Realistic perspective or dramatic foreshortening
- Camera tilt or cinematic angles
- Wide poses that force the body to be scaled down
- Weapons crossing through the face
- Cropping any body part, weapon, hat, cape, or required accessory

## 8. Pixel Construction

### Required

- Connected pixel clusters rather than isolated noise
- Deliberate stair-step diagonals such as 1-1, 2-1, or 2-2 rhythms
- Major contours readable as a unified silhouette
- One-pixel details used sparingly at focal points
- Consistent pixel size across the entire sprite
- Hard boundaries between color clusters

### Prohibited

- Anti-aliased contours
- Semi-transparent edge pixels
- Blurred or feathered edges
- Smooth gradients
- Painterly texture
- Dense dithering
- Random single-pixel highlights
- Subpixel-looking lines
- High-resolution facial rendering disguised by blocky scaling
- Automatic pixelation as the final production step

## 9. Outlines

- Use dark colored outlines related to the local material.
- Exterior contours are normally 1 pixel thick.
- Use thicker clusters only at deep overlaps or the darkest underside.
- Keep interior lines selective and lighter than the darkest exterior contour when practical.
- Do not outline every plate, fold, finger, strand, or facial feature separately.
- Use pure black sparingly for maximum separation.

| Material | Outline tendency |
| --- | --- |
| Skin and warm leather | Very dark brown or muted plum |
| Steel and blue fabric | Blue-black or cool charcoal |
| Green fabric and foliage | Very dark desaturated green |
| Gold and brass | Dark umber |

## 10. Palette and Shading

### Palette budget

- Hard maximum: 64 total colors including transparency
- Preferred range: 24–48 opaque colors for a complete character
- Simple material: 2–3 tones
- Important material: no more than 4 tones unless essential
- Reuse outline and shadow colors across materials
- No dithering when reducing colors

The 64-color limit is a ceiling, not a target. Do not add colors merely because the budget allows them.

### Lighting

- Standard light source: upper-left/front
- Shadows collect toward the lower-right and beneath overlaps
- Highlights use compact clusters rather than continuous glossy stripes
- Highlights may shift warmer and shadows cooler or more purple
- Adjacent major forms must maintain clear value separation

### Contrast priority

1. Face and hair silhouette
2. Weapon or defining equipment
3. Upper torso and primary costume color
4. Boots, straps, trim, and minor accessories

## 11. Face and Hair

- Eyes: compact symbolic clusters
- Nose: implied by shadow or a minimal cluster
- Mouth: omitted or extremely simple
- Beard: broad jaw-following clusters, never individual hairs
- Hair: several large locks or masses rather than individual strands
- Eyebrows and eyelashes: only when essential and readable at native size

If individual hair strands, nostrils, pupils, teeth, or complex lips dominate at gameplay size, the sprite is too detailed.

## 12. Clothing, Armor, and Equipment

### Clothing

- Use broad folds and large color blocks.
- Limit each garment to a few dominant fold shapes.
- Capes, coats, and skirts must strengthen the silhouette.

### Armor

- Favor chunky readable forms.
- Separate plates with shadow blocks instead of thin linework.
- Limit rivets, engraving, seams, and ornamental noise.
- Metallic highlights must be short, high-contrast clusters.

### Weapons and props

- Scale the body first, then place equipment around it.
- Weapons must remain anatomically holdable.
- Hands must visibly connect to the grip.
- Grips, guards, blades, axe heads, and staff shafts must align on believable axes.
- Equipment must not bend, fork, merge into clothing, or change thickness unintentionally.
- If a weapon cannot fit, adjust its angle or use a larger animation canvas. Do not shrink the character.

## 13. Animation Canvas Standards

The character body must retain the same pixel height across every animation canvas.

| Animation | Default frame canvas | Use |
| --- | --- | --- |
| Base / idle | 128 × 128 | Neutral stance and restrained idle motion |
| Basic attack | 192 × 128 | Horizontal lunges and weapon arcs |
| Victory / celebration | 192 × 160 | Dance, flourish, and end-pose transitions |
| Spell casting | 192 × 192 | Staff motion and surrounding magic |
| Large effects | Separate effect sheet | Explosions, auras, projectiles, screen-filling magic |

Rules:

- Increasing the canvas provides movement room; it does not increase character scale.
- Keep the ground anchor aligned consistently when moving between canvas sizes.
- Every frame in one sheet must use identical cell dimensions.
- No opaque pixel may cross into an adjacent cell.
- Maintain at least 8 transparent pixels between the complete foreground and each cell edge; 12 is preferred.
- Separate character and large magical effects when practical.
- Use a one-shot sheet for celebration movement and a separate looping sheet for the held end pose.

## 14. Animation Continuity

Animation starts only after the base sprite is approved.

- Reuse the exact base palette.
- Keep the head, torso, hands, equipment, and feet registered to intentional anchors.
- Move and reshape existing pixel clusters; do not redraw at a different resolution.
- Maintain character proportions and costume construction across every frame.
- Idle loops use restrained breathing, hair, cloth, or equipment movement.
- Attack and celebration animations may use larger movement but must return or transition cleanly.
- The final celebration frame must match the first frame of the victory-hold loop.
- Looping animations must transition from their final frame back to frame 1 without a visible jump.
- Do not independently center each frame by its opaque bounding box.

## 15. Composition, Export, and Packing

- Center the body around its designated anchor, not the complete silhouette bounds.
- Keep all foreground pixels inside the frame safety margin.
- Do not add a cast shadow to the master sprite; render shadows separately in-game.
- Use genuine transparent alpha, never a baked checkerboard.
- Alpha values must be only 0 or 255.
- Preserve native-resolution masters.
- Any preview enlargement must use integer nearest-neighbor scaling.
- Never resize a production frame with bilinear, bicubic, or AI interpolation.

### Trimming and atlas packing

- Keep source animation frames on their standardized canvases.
- Trim transparent space only during atlas export.
- Store the trim offset and original source-frame size in atlas metadata.
- Preserve the ground anchor and pivot after trimming.
- Do not rescale individual packed frames.

Recommended naming:

```text
character-name_base_v001.png
character-name_idle_00.png
character-name_attack_00.png
character-name_victory_00.png
character-name_victory-hold_00.png
```

## 16. Character Brief Template

Complete this before generating a base character:

```text
Name:
Role/class:
Species/body type:
Scale class: Small / Standard / Large / Quadruped / Giant
Primary silhouette feature:
Hair/fur:
Clothing/armor:
Weapon/equipment:
Primary color:
Secondary color:
Accent color:
Personality expressed in pose:
Three must-show details:
Things to avoid:
```

Limit the brief to three must-show details. Excessive requirements create noise and encourage inconsistent detail density.

## 17. Base-Sprite Generation Prompt

```text
Create one original playable high-fantasy JRPG battle sprite using the attached approved sprite and Sprite Style Guide as mandatory references.

Character brief:
[INSERT COMPLETED CHARACTER BRIEF]

Design the production sprite directly on a native 128x128 pixel canvas. Do not create a high-resolution illustration and shrink, pixelate, or posterize it afterward. Use genuine transparent RGBA with binary alpha, hard pixel edges, intentional connected clusters, no anti-aliasing, no dithering, and no smooth gradients. Use no more than 64 total colors including transparency; prefer 24–48 opaque colors.

For a Standard humanoid, keep the body 82–92 pixels tall, excluding raised weapons, oversized hats, capes, hair extensions, and effects. Place the humanoid ground anchor at (64,112), align grounded feet to y=112, and center the body around x=64. Scale the body according to its scale class. Do not scale the body down to fit weapons, hats, capes, wings, tails, or effects.

Show the complete character in a neutral combat-idle pose, three-quarter view facing screen-right unless the brief says otherwise. Keep every body part and required item intact inside the canvas with at least 8 pixels of transparent safety margin. The face must remain symbolic and readable at native size. Clothing, armor, hair, fur, and equipment must use broad readable shapes with restrained internal detail.

Match the approved reference sprite's proportions, pixel size, outline weight, palette density, lighting direction, shading complexity, camera angle, and overall rendering language. Change the character design, not the visual system.

Do not add scenery, a cast shadow, text, a border, multiple poses, or a sprite sheet. Do not crop the subject. Output exactly one complete base sprite.
```

## 18. Animation Generation Prompt

```text
Create [FRAME COUNT] sequential frames for [ANIMATION NAME] using the attached approved base sprite and Sprite Style Guide as mandatory references.

Use a [FRAME WIDTH]x[FRAME HEIGHT] native pixel canvas for every frame. Maintain the base sprite's exact body scale, palette, pixel size, proportions, clothing, equipment, and ground anchor. Increasing the animation canvas provides room for motion and must not change character scale.

Arrange frames in exactly [COLUMNS] columns by [ROWS] rows, read left-to-right and top-to-bottom. Every cell must have identical dimensions. Keep the complete character, equipment, hair, clothing, and effects inside its own cell with at least 8 transparent pixels of safety margin. Nothing may touch, cross, overlap, or be clipped by a cell boundary.

Reuse the exact base palette. Use binary transparency, hard pixel edges, no anti-aliasing, no dithering, no smoothing, and no background. Keep anchors consistent so the animation does not jitter. Use small logical changes between adjacent frames and preserve correct anatomy and equipment count throughout.

[DESCRIBE THE MOTION AND TRANSITION REQUIREMENTS]
```

## 19. Acceptance Checklist

A sprite is approved only when every applicable item passes.

### Technical

- [ ] Base frame is exactly 128 × 128 pixels
- [ ] Animation frame matches its required canvas dimensions
- [ ] Image is native-resolution pixel art, not automatically pixelated concept art
- [ ] No more than 64 total colors including transparency
- [ ] No dithering, gradients, anti-aliasing, blur, or semi-transparent edge pixels
- [ ] Background is genuine transparency, not black, white, or checkerboard
- [ ] At least 8 pixels of safe margin; 12 preferred
- [ ] All frames in a sheet have identical dimensions
- [ ] No foreground pixel crosses or is clipped by a frame boundary

### Scale and alignment

- [ ] Scale class is recorded in the character brief
- [ ] Standard humanoid body is 82–92 pixels tall unless intentionally classified otherwise
- [ ] Body scale is independent of weapon, hat, cape, wings, hair, tail, or effects
- [ ] Ground anchor and baseline match the roster standard
- [ ] Comparable characters have comparable body height and apparent pixel size
- [ ] Character was not scaled to fill its opaque bounding box
- [ ] Frame-to-frame registration does not jitter

### Style

- [ ] Matches the approved reference's pixel size and detail density
- [ ] Chibi JRPG proportions without becoming overly cute
- [ ] Major shapes read clearly at native size
- [ ] Face and hair remain symbolic rather than finely illustrated
- [ ] Lighting consistently comes from the upper-left/front
- [ ] Important colors and shapes remain clearly separated
- [ ] Pixel clusters are deliberate and connected

### Design integrity

- [ ] Correct number of arms, legs, eyes, weapons, and accessories
- [ ] Hands connect correctly to equipment
- [ ] Weapon geometry is continuous and intentional
- [ ] Clothing, anatomy, and equipment do not merge accidentally
- [ ] Every required detail is visible
- [ ] No unrequested scenery, shadow, text, border, or extra pose

### Animation

- [ ] Body scale remains constant across all animations
- [ ] Every frame uses the approved base palette
- [ ] Motion is readable in sequence and changes logically between frames
- [ ] Idle and hold animations loop without a visible jump
- [ ] One-shot animations transition cleanly to their destination state
- [ ] Celebration final frame matches victory-hold first frame when both are used
- [ ] Large effects are separated when they would force the character to shrink

## 20. Immediate Rejection Conditions

Reject and rebuild when any of these occur:

- The image looks like a detailed illustration reduced or posterized into pixel art.
- Pixel sizes vary within the sprite or between roster characters.
- A character was shrunk because its weapon, hat, cape, or body width was large.
- Comparable bodies appear at inconsistent scales.
- Anatomy or equipment count is wrong.
- A weapon bends, forks, disconnects, or changes thickness unintentionally.
- The face or hair is more detailed than the approved reference.
- The image contains more than 64 colors.
- The background is baked in or uses partial transparency.
- Any body part, prop, effect, or garment is cropped by a canvas or cell boundary.
- Adjacent animation cells overlap.
- Animation frames drift because each silhouette was centered separately.

## 21. Production Workflow

1. Create or approve character concept art.
2. Assign a scale class and complete the character brief.
3. Attach the approved reference sprite and this guide.
4. Create one native 128 × 128 base sprite.
5. Verify body height, baseline, anchor, pixel size, palette, alpha, and silhouette.
6. Correct structural problems before starting animation.
7. Approve the base sprite as the character's canonical pixel asset.
8. Build animations directly from that approved base sprite.
9. Validate cell dimensions, registration, continuity, and transitions.
10. Preserve standardized source frames.
11. Trim and pack only during engine export while retaining offsets and pivots.

## 22. Reference Measurements

Store approved references under:

```text
references/approved-sword-character.png
references/approved-character-name.png
```

Record these values for every approved base sprite:

| Measurement | Value |
| --- | --- |
| Scale class | Required |
| Native canvas | 128 × 128 |
| Opaque bounding box | Required |
| Body height excluding equipment | Required |
| Body width excluding equipment | Required |
| Ground anchor | Required |
| Feet or paw baseline | Required |
| Unique total colors | Required; maximum 64 |
| Unique opaque colors | Required |
| Primary outline colors | Required |
| Head-to-body ratio | Required |

---

### Revision note

Version 2.0 replaces the former 64 × 64 native-grid specification with a 128 × 128 base-frame standard. It separates character body scale from total silhouette bounds, introduces scale classes and stable anchors, defines larger animation canvases, caps the palette at 64 colors, and establishes transition requirements for one-shot and looping animation sheets.
