# Recording a site for a motion study

A motion study is built from your own screen recordings. How you record decides how readable the evidence is: the motion-energy timeline, region maps, smart keyframes and burst strips all measure what is in the recording, including your scrolling and your cursor.

## Tools

Any screen recorder works. The bundled ffmpeg normalizes every clip to H.264 MP4.

- **Windows Snipping Tool**: Record, select the browser viewport, then save as MP4.
- **Xbox Game Bar**: press `Win+G`, then capture (records the active window).
- **OBS Studio**: best for 60 fps and precise framing.

Limits: 60 seconds, 3840 × 2160, 300 MB per recording, 4 recordings per reference.

## Before you record

1. Browser window at **1440 × 900** or **1920 × 1080**, zoom **100%**.
2. Hide the bookmarks bar and disable extensions that draw on the page.
3. **Dismiss cookie and consent banners first.** They sit in every frame otherwise.
4. Load the page once and let it settle, then reload for the take if you want the intro.

## While you record

- **One behaviour per recording.** Load and intro, cursor interaction, a scroll journey: separate clips (up to four), each with a clear label.
- **Hold still for ~2 seconds** at the start so the first frames show the resting state.
- **Scroll steadily.** Constant-speed scrolling (a few wheel notches at an even pace, or a slow trackpad drag) keeps the energy curve readable: ramps and settles then come from the site's own easing, not from your hand.
- **Show the cursor only when it matters.** Move it deliberately for cursor effects (e.g. Lando Norris's helmet livery). Otherwise keep it still or out of the page, so region maps don't mistake your pointer for the site's motion.
- **Keep takes tight: 8–30 seconds.** There is no trimming in Retr0Vault.
- 30 fps is enough for most sites; use 60 fps for fast WebGL.

## Inspection notes and verified tech

The recording shows what moves. It cannot show how. While the site is open, check DevTools and write down what you actually verify. Add it on the motion sheet under **Inspection notes & verified tech**, one claim and its source per line.

| Check | Where | Example entry |
| --- | --- | --- |
| GSAP / ScrollTrigger | Console: `window.gsap`, `window.ScrollTrigger` | `window.gsap and ScrollTrigger defined — DevTools console` |
| Lenis smooth scroll | Console: `document.documentElement.classList.contains('lenis')` | `html.lenis class present — DevTools console` |
| WebGL | Console: `document.querySelectorAll('canvas')`, then inspect the context | `Page requests a WebGL2 context — canvas inspection` |
| Rive | Console: `window.rive` | `Rive runtime present — DevTools console` |
| Video | Elements: `<video>` tags | `Logo is an MP4 video — Elements panel` |
| CSS transitions | Elements → Computed: `transition` | `CTA transition opacity 0.15s — Computed styles` |

An analysis may mark a technology claim **verified** only when it cites one of these entries; everything else is **inferred**.

## After recording

1. On `/add`, open **Motion recording**, choose the reference, choose the file, set the poster frame, then file it.
2. Wait for **Ready**. Processing takes seconds for a typical clip.
3. From the motion desk (or `npm run motion:export-pending`), export the pending motion manifest and analyse it with your coding agent (see `docs/motion-analysis.md`), then import the result.
