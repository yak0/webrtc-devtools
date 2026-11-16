# Icon generation prompt

Generate at 1024×1024, save the result as `store/icon-source.png`, then run `npm run icons`
(resizes to 16/32/48/128 and writes `store/icon-128.png` for the store upload).

## Main prompt

```
App icon for a developer tool called "WebRTC DevTools", a browser extension that inspects
real-time video/audio connections between two peers.

Concept: two solid circular nodes connected by a short, thick line, with a single clean
signal pulse (one heartbeat-style peak) travelling along the line. The left node is vivid
blue (#2080F0), the right node is emerald green (#18A058), the connecting line and pulse
are white. The motif sits centered on a deep navy rounded-square tile (#0F172A, corner
radius about 22% of the width) with a very subtle diagonal gradient towards dark teal
(#0B2B2A) in the bottom-right corner.

Style: flat, geometric, modern vector icon in the visual language of Chrome DevTools and
macOS app icons. Bold, simple shapes with generous spacing; uniform stroke weight of about
8% of the icon width; perfectly round nodes with a diameter of about 24% of the width.
Crisp edges, no texture, no noise. At most a faint soft inner highlight on the tile.

Composition: front-facing, perfectly centered, symmetrical left-to-right. The motif fills
about 62% of the tile width, leaving clear padding on all sides. The tile itself fills the
canvas with roughly 6% transparent margin around it.

Must stay recognizable when scaled down to 16×16 pixels: only three elements (two nodes,
one line with one pulse), high contrast against the dark tile, no thin details.

Output: 1024×1024 PNG, transparent background outside the rounded tile, single icon,
no mockup, no device frame, no drop shadow outside the tile.
```

## Negative prompt (for tools that support one)

```
text, letters, words, logo type, watermark, camera icon, video camera, webcam, phone handset,
wifi symbol, chat bubble, globe, people, faces, hands, 3D render, photorealistic, glossy
glass, bevel, emboss, long shadow, gradient mesh, neon glow, lens flare, busy background,
multiple icons, icon sheet, grid, border frame, mockup, low contrast, thin lines, tiny details
```

## Variations to try

1. **Magnifier**: same two nodes and line, with a thin white magnifying-glass ring around the
   pulse in the middle (the "inspect" idea). Drop it if it turns muddy at 16 px.
2. **Brackets**: the nodes replaced by a blue `<` and a green `>` facing each other with the
   pulse between them (developer + peer-to-peer in one mark).
3. **Light tile**: white tile (#FFFFFF) with a 1 px light gray outline, navy line and pulse.
   Useful if the dark tile disappears on dark browser toolbars.

## Checklist before accepting a result

- Shrink it to 16×16 and 32×32: are both nodes and the pulse still readable?
- Put it on a white and on a dark gray background: is the tile edge visible on both?
- No text, no camera/phone clichés, nothing that resembles the Chrome, WebRTC or Google logos
  (the store rejects icons that imitate other brands).
