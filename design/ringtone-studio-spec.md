# Ringtone Cropper studio design spec

Generated with built-in ImageGen and inspected with `view_image` before implementation. These are design references, not production raster UI. The exact prompts are retained alongside them.

## References

- Desktop: `ringtone-studio-desktop.png`, 1419 × 1108 pixels.
- Mobile: `ringtone-studio-mobile.png`, 817 × 1923 pixels. This image has generous exterior reference margins; implement its single-column content at the actual phone width using 16–20 px gutters.
- Existing waveform brand mark, controls, audio waveform and text stay native HTML/CSS/SVG/canvas.

## Direction and layout

An airy audio studio with one purposeful white workspace, a charcoal waveform canvas, and yellow selection and download actions. Do not add decoration, hero badges, marketing card grids, gradients, illustrations, or fabricated metrics.

At desktop widths use a centered content maximum around 1200 px. The quiet header, workspace, installation guidance and footer align to the same edges. The headline and supporting copy are centered. The single workspace divides around 65/35 into source/editor and output settings with a fine vertical border. Interior desktop spacing is 26–28 px. The main workspace has a 16–20 px radius and an extremely restrained shadow.

Below approximately 850 px, stack the output section directly under the editor in the same workspace and replace the vertical divider with a horizontal rule. The YouTube input and import button stack on narrow phones. Presets get a full-width row below preview. Start, end and length remain three equal columns where legible. The output controls remain full width. Instructions become a vertical list. No horizontal page overflow or reduction below a 44 px touch target for principal actions.

## Tokens

| Token | Value |
| --- | --- |
| Page | `#F2F2F7`, cool gray, never warm cream |
| Surface | `#FFFFFF` |
| Primary text and dark buttons | `#202024` |
| Waveform canvas | `#27292D` |
| Muted text | `#7B8294` |
| Fine border | `#D9DCE5` |
| Accent | `#FFCC00` |
| Inactive switch | `#D6D8DF` |
| Input radius | `8–10px` |
| Main workspace radius | `16–20px` |
| Desktop headline | `54–60px`, weight 750–800, tight tracking |
| Mobile headline | `34–38px`, weight 750–800, approximately 1.1 line height |
| Section title | `23–25px`, weight 700 |
| Subheading and labels | `14–16px`, weight 500–650 |
| Controls | `14–16px`, weight 500–600, explicit font settings |
| Muted helper | `12–14px` |

Use the existing local sans-serif family if close to the reference; otherwise a modern Inter-like system sans stack. Layout follows an 8 px spacing rhythm with 4 px refinements. Transitions may be 120–180 ms; respect reduced motion.

## Visible copy and control inventory

- Header: waveform mark, `Ringtone Cropper`, `How to use`, `GitHub`.
- Headline: `Your sound. Your ringtone.`
- Supporting sentence: `Turn a YouTube link or audio file into a ringtone for Android or iPhone.`
- Source heading: `Choose your audio`.
- Source dropdown: `YouTube link` or `Upload audio`.
- YouTube input placeholder: `Paste a YouTube link`.
- Source button: `Import audio`.
- Source helper: `Best available audio. Up to 20 minutes.`
- Editor heading: `Trim your favorite part`.
- Loaded example in concept: `Your song.mp3` and `3:42`; replace with real selected source metadata at runtime.
- Preview: `Preview selection`, live selected position and duration.
- Duration presets: `15s`, `30s`, `40s`; select `30s` by default, accurately represented by a 30-second range when source duration allows it.
- Time inputs: `Start`, `End`, `Length`, with initial values `0:00.0`, `0:30.0`, `30.0 s`.
- Editor helper: `Drag the handles or enter a time.`
- Output heading: `Make it yours`.
- Device label: `Your phone`; choices `Android` and `iPhone` with equal visual prominence.
- Format: `Format`; default per target `MP3 · Android` or `M4R · iPhone`; preserve additional supported formats.
- Sound switches: `Fade in`, `Fade out`, `Normalize volume`.
- Summary: `Clip length`, dynamic duration e.g. `30 seconds`.
- Main action: `Download ringtone` with small download icon.
- Quality note: `High-quality audio, ready for your phone.`
- Privacy note: `Your edits stay in your browser.` with quiet lock icon.
- Installation heading: `On your phone, in a few steps.`
- Installation tabs: `Android`, `iPhone`.
- Android step headings: `Download your ringtone`, `Open Sound settings`, `Choose your new ringtone`.
- Android settings detail: `Settings → Sound & vibration → Phone ringtone`; adapt wording where current platform documentation requires it.
- Footer: `Made for your kind of sound.` and `Uploads stay on your device.`; GitHub may move here on narrow phones.

## Icons and selection treatment

Keep the existing waveform SVG brand. Plain phone-outline icons are optional inside the device segments. Download, dropdown chevron and lock use consistent 1.75–2 px stroked SVGs around 18 px. Play uses a small filled triangle inside a charcoal circular button. No emoji or mixed icon families. Selected device and installation tabs are charcoal with white text; selected duration is yellow with charcoal text. Switches are gray when off and yellow when on.

Waveform bars are gray outside the selected interval and yellow inside it. The region gets a translucent yellow wash with yellow borders and broad touch-friendly yellow handles. Timeline labels are muted light gray. Always derive bars and labels from the actual loaded audio; the reference waveform is only sample content.

## Required state adaptations

The references show loaded audio to communicate editor layout. The real initial state must be honest: clearly indicate that audio is needed, disable preview/export as appropriate, and avoid fake waveform/data. Retain the studio hierarchy when empty. Source errors, import progress, decoding state, export progress, browser compatibility messages and loaded file metadata come from real existing behavior. These functional messages are allowed even though the visual reference shows a success state.

Both Android and iPhone receive complete real installation guidance. The concept's Android-selected view does not limit iPhone content. Selected duration clamps safely for short sources. Preserve editable cropping, volume controls and all other existing functionality even if a concept omitted a secondary control; document any necessary placement adaptation during implementation review.

## Fidelity review checklist

Compare accepted concept and final desktop/mobile screenshots using `view_image` in the same QA pass. Check at least: copy, two-column/stacked layout, headline and control typography, cool gray/white/charcoal/yellow palette, single workspace container and divider, waveform treatment, source/input anatomy, phone selector, exact 30-second presentation, and installation continuation. Record functional differences such as empty state or platform-specific installation copy explicitly rather than treating them as visual defects.

## Implementation review — 11 October 2026

The desktop and mobile ImageGen references were opened alongside browser screenshots with `view_image`. The production interface is native HTML, CSS, SVG and canvas; no screenshot is used as the interface.

| Dimension | Result |
| --- | --- |
| Layout | One white workspace, approximately 65/35 on desktop and stacked with a horizontal divider on phones. |
| Palette | Cool gray page, white surface, charcoal waveform and yellow selections/actions match. |
| Typography | Centered bold headline, mobile line breaks, section hierarchy and restrained helper text match. Mobile form controls use 16 px text to avoid focus zoom. |
| Controls | Source picker, phone segments, format selector, presets and primary download action preserve the reference hierarchy. |
| Waveform | Real source peaks, yellow selected interval, draggable handles and gray unselected audio match. Empty state contains no fabricated waveform. |
| Spacing and responsiveness | Consistent panel padding; checked from 320 px to 1440 px without horizontal overflow. Very narrow screens stack the source heading and picker. |
| Copy and guidance | Core headings and action labels match. Android and iPhone instructions use the verified platform workflows. |

Intentional functional adaptations: the initial screen asks for audio instead of showing the concept's sample song; actual source metadata, errors and progress replace sample values. Start/end inputs show seconds for precise editing. Secondary nudge and repeat controls remain available. Existing fade-in/out defaults stay on and normalization stays off. M4A is the default for the iPhone GarageBand workflow; M4R remains selectable for computer transfers. Real installation instructions, export quality notes, social profiles, source link, privacy policy and terms extend the concept to cover the requested product scope.

Validation: desktop and mobile browser emulation, real file imports, keyboard and pointer trimming, source replacement, format switching, and actual MP3/M4A downloads. Both 30-second exports were measured at 30.000000 seconds with ffprobe. Mobile emulation is not a physical iOS Safari test. No material visual mismatch remains after the input-size correction.
