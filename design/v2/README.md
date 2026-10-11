# Ringtone studio: appearance redesign

Generated with the built-in ImageGen tool for the requested frontend redesign and Light / Dark / System appearance control. System is the default. These are design references, not bitmap UI assets: the working website uses native HTML, CSS, SVG icons, canvas, and JavaScript.

## Accepted concept set and exact prompts

| Surface | Image | Exact prompt |
| --- | --- | --- |
| Complete dark desktop | [desktop-dark.png](desktop-dark.png), 1178 × 1335 | [desktop-dark-prompt.md](desktop-dark-prompt.md) |
| Coordinated light desktop | [desktop-light.png](desktop-light.png), 1178 × 1335 | [desktop-light-prompt.md](desktop-light-prompt.md) |
| Mobile header and editor | [mobile-editor.png](mobile-editor.png), 988 × 1592 | [mobile-editor-prompt.md](mobile-editor-prompt.md) |
| Mobile export, guide and footer | [mobile-continuation.png](mobile-continuation.png), 825 × 1905 | [original prompt](mobile-continuation-prompt.md), then [consistency correction](mobile-continuation-correction-prompt.md) |

Every accepted image was inspected with `view_image`. The first mobile overview was discarded because it used broad outer margins and crowded horizontal switches. Fresh editor and continuation concepts resolve those details; the corrected continuation keeps the guide open, vertical switch rows, and text social links.

## Color lock

| Token | Dark | Light |
| --- | --- | --- |
| Page | `#141519` graphite | `#f5f6f8` cool gray |
| Workspace | `#1d1f24` | `#ffffff` pure white |
| Main text | `#f5f5f2` | `#202328` |
| Secondary text | `#a4a8b3` | `#626975` |
| Hairline | `#33363d` | `#d9dde3` |
| Accent | `#d7f75b` | `#d7f75b` |
| Waveform canvas | `#17191d` | `#17191d` |

Accent buttons use dark text. Selected phone choices use a quiet lime tint and outline. The audio canvas remains dark in both themes. Use flat colors, no generated raster noise, glows or gradients. Disabled controls must remain clearly distinguishable from active controls.

## Layout and typography

- DM Sans for app UI, headings and body; Instrument Serif italic only for “on repeat.” Hero around 60px desktop, 42–48px phone, with tight line height and deliberate weight contrast.
- Header: existing three-bar waveform icon, Ringtone Cropper, How to use, Source code, and compact System appearance selector. Hide secondary navigation on narrow phones; keep the theme selector visible.
- Intro: left aligned two-line headline, right aligned short supporting paragraph on desktop. Stack on mobile. No eyebrow, badges, metrics or extra promotional sections.
- One workspace frame, approximately 68/32 desktop columns. Source and crop controls on the left, finishing controls on the right, separated by a single hairline. At phone widths stack them in one frame with a horizontal divider.
- Source row: heading and source dropdown, then URL input and Import audio button. On mobile use full-width source selector, input, and action in separate rows.
- Crop section: filename and Change audio, metadata, strong waveform, play/preview, 15s/30s/40s presets, secondary nudge/repeat, and three equal timing fields. On phones the presets have their own full-width row and nudge controls can be omitted; repeat remains.
- Finishing controls: equal phone choices, format dropdown, three vertical switch rows, length summary, primary download, quality and privacy notes. Do not turn switch rows into separate cards.
- Guide is open layout: Make it ring., two phone tabs, three numbered steps. Desktop has horizontal columns with hairline dividers; mobile has stacked steps with the numbers at left.
- Footer has byline, plain text social links and legal/source links. Use the same text scale and palette on privacy and terms pages.
- Major frame radius around 14px, controls around 8px, 44px minimum primary targets, 16–20px outer gutters on phones, 24–28px desktop panel padding. Mobile images are composition references for a 390 CSS-pixel viewport, not native CSS dimensions; use readable 14–16px control text.

## Visible-copy inventory

Header: “Ringtone Cropper”, “How to use”, “Source code”, “System” with options “Light” and “Dark”. Hero: “Your sound,” / “on repeat.” Supporting copy: “Turn a YouTube link or an audio file into a ringtone that sounds like you.”

Editor: “Choose your audio”, “YouTube link”, “Upload audio”, “Paste a YouTube link”, “Import audio”, “Best available audio. Up to 20 minutes and 100 MB.”, “Find your favorite part”, “Change audio”, “Preview selection”, “15s”, “30s”, “40s”, “Start (s)”, “End (s)”, “Length”, “Drag the handles or enter a time.” Loaded sample data is “Your song.mp3”, 1:05, 48 kHz, stereo and 0–30 seconds.

Export: “The finishing touches”, “Your phone”, “Android”, “iPhone”, “Format”, “Fade in”, “Fade out”, “Normalize volume”, “Clip length”, “Download ringtone”, “Your edits stay in your browser.” Existing format-specific quality and phone-help messages remain dynamic.

Guide: “Make it ring.”, “Download your ringtone”, “Open your audio file”, “Make it your ringtone”. Retain the existing accurate Android/iPhone instructions, official guide links, and the iPhone 30-second guidance. Footer: “Made for your kind of sound.”, “Built by Apoorv Darshan.”, “X”, “LinkedIn”, “Instagram”, “GitHub”, “Source code”, “Privacy”, “Terms”. Retain complete privacy and authorized-use explanations from the app.

## Icon and interaction inventory

- Reuse the existing code-native three-bar wave brand mark; recolor the square lime.
- Simple 1.5–2px SVG outline monitor and chevron for theme control; phone outlines for both device choices; download arrow, repeat, nudge arrows and lock. Filled play triangle inside a lime circular button. Keep the existing accessible labels and keyboard behavior.
- Controls remain real select/input/button elements. Theme choice persists locally; System follows the OS and reacts to changes while open. Apply theme before first paint and to legal pages.
- Existing upload, YouTube import, progress, error, trimming, preview, format and download behavior remains functional. A loaded concept is reference data, not a reason to fake an imported file in the real initial state.

## Recorded functional adaptations

- Preserve honest empty, loading, disabled, success and error states. The generated loaded waveform is not displayed as fake data; real audio controls waveform and duration.
- Preserve the existing phone-outline SVG icons instead of generated Android/Apple logos. This keeps the app icon family consistent without introducing brand assets.
- Keep the real format dropdown choices, iPhone M4A/GarageBand guidance, full privacy/legal copy and all requested social links. Generated abbreviated copy must not replace necessary user guidance.
- Keep Length as a read-only output, even where ImageGen renders spinner arrows. Start and End remain editable.
- Preserve default fades on and normalization off, exact 30-second preferred duration, and accessible focus/error states.
- No image overlays, photos, raster textures or decorative assets are needed. Generated mockups guide native UI; they are not embedded in the app.

## Fidelity review — 11 October 2026

The accepted desktop concepts and latest light/dark browser captures were compared directly with `view_image` at the desktop references’ native 1178 × 1335 viewport. Mobile references were compared with the real 390 CSS-pixel layout, with additional overflow checks at 320, 360, 768, 1024 and 1440 pixels. The mobile concepts are enlarged detail references, so their bitmap dimensions are not used as CSS viewport widths.

| Comparison | Evidence and result |
| --- | --- |
| Copy and hierarchy | Above-the-fold brand, two-line headline, supporting sentence, source/editor/output headings, theme choices and primary actions match the inventory. Real empty/source/progress messages replace illustrative sample data. |
| Typography | DM Sans and Instrument Serif load successfully. Hero line spacing was tightened to match the reference; native controls have explicit sizes, with 16px mobile inputs. |
| Palette | Graphite/dark panel and cool-gray/white light surfaces follow the locked tokens. Lime actions retain dark text. Text, borders, disabled controls, focus rings and policy pages have theme-specific colors. |
| Container and layout | One split workspace, prominent waveform, aligned timing fields and single sidebar divider match desktop. Phone layout stacks inside the same frame. |
| Responsive controls | Header brand wraps while the theme choice remains visible. Source selector, input and import action become full width on phones. Presets retain equal widths and timing fields stay aligned. No horizontal overflow at checked widths. |
| Guide and footer | Open numbered steps, separators, theme-aware phone tabs, social profiles, source and legal links preserve the concept's continuation. |
| Icons and audio | Native phone outlines replace generated brand logos as recorded above. Actual audio creates the waveform; no sample waveform is shown in the empty state. |

The implementation was faithfully verified against the accepted design; no material visual mismatch remains. Necessary differences are the real source waveform and metadata, dynamic quality/help text, full installation/legal guidance, and taller mobile controls to preserve readable text and 44px touch targets. Light-mode selected borders are darker than lime for visibility. These are functional and accessibility adaptations, not added product sections.

Theme interaction checks passed in headless Chrome through agent-browser MCP: fresh System default, live OS light/dark changes, explicit overrides, persistence across reloads and legal pages, cross-tab sync, invalid/blocked storage, and preservation of loaded audio and edited trim times. Page identity, meaningful rendering, screenshots and console health were verified. Automated WCAG A/AA checks reported zero violations in light and dark; native select background-image contrast checks required visual inspection. All 34 repository tests and syntax checks passed. Mobile validation used browser emulation, not physical Safari.
