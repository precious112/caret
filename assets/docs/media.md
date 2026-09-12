# Launch media

Canonical URLs for the demo videos used in `README.md`, and how to regenerate them.

Videos are **not committed to this repo** — the three masters are 116MB against a
78MB pack, and a repo-hosted MP4 renders as a *link*, not a player. GitHub only
plays video from `user-attachments` URLs, so they live there and are referenced
below. GIFs are the opposite: they render fine from a relative path, so those are
committed alongside this file.

**GitHub refuses a GIF whose decoded frames are too large, and file size has
nothing to do with it.** Measured: of five committed GIFs, only the one under
~36 megapixels of total pixel volume (width x height x frames) rendered on
github.com; the other four returned 503 on every reload. The smallest *file*
(1.3MB, 51MP) failed while the second-largest (2.6MB, 36MP) worked. Keep
`width x height x frames` under about 30MP. At 800x500 that is 75 frames, so
10fps buys 7 seconds. Check a new GIF before committing it:

```bash
python3 -c "
from PIL import Image
im = Image.open('assets/docs/x.gif'); n = 0
try:
    while True: im.seek(n); n += 1
except EOFError: pass
print(im.size, n, 'frames', im.size[0]*im.size[1]*n/1e6, 'MP')"
```

## Hosted videos

Uploaded via drag-and-drop into a GitHub comment box (there is no API or `gh`
command for `user-attachments` — see `docs/connect-an-agent.md` for the tooling
that *is* scriptable). MD5s are the local encodes in `~/edits/`, so any URL here
can be verified against the file it came from.

| What it shows | Length | Size | md5 | URL |
|---|---|---|---|---|
| Visual editing — text, colour, image, resize, overlay | 1:11 | 5.5MB | `27b6746a` | https://github.com/user-attachments/assets/2fb6a9f4-f000-423c-8b9c-d70a81422bc6 |
| Asset generation — mark, shader, photograph | 2:00 | 8.85MB | `d8e9a7fe` | https://github.com/user-attachments/assets/99115f37-797a-454c-978a-421c6dace536 |
| **Launch demo — the README hero** (`caret_launch_v2`) | 1:43 | 9.00MB | `662e1118` | https://github.com/user-attachments/assets/93e273d4-aed3-45cd-bb5e-c5b587691017 |

Only the launch demo is embedded in `README.md`. The other two are hosted and
kept here for reuse (a docs page, a release note, a social post) rather than
stacked at the bottom of the README, where a list of long videos reads as a
dumping ground instead of a feature.

To embed one, put the bare URL on its own line in Markdown. GitHub turns it into
a player. Do not wrap it in `![]()` — that renders a broken image.

**Do not use `caret_launch_v1`.** It is superseded, not an alternative cut: its
tenon cold open shipped with the WALNUT wheel blipping between arrangements
instead of travelling, because under CDP paused virtual time a CSS transition
does not tick and the tweens queued instead of playing. `record-mock-scroll.mjs`
now drives the wheel frame by frame on the clip's own timeline and produces a
frame per advance, and `caret_launch_v2` is that re-record. v1 is kept only as
history.

## Encoding

Masters are 3360x2100 at 60fps and stay untouched (they are the social-media
cuts). Delivery encodes:

```bash
# Standard: 3360x2100 -> 1680x1050 is an exact 2:1 downscale, the cleanest
# possible resample, and invisible at any size GitHub will play these.
ffmpeg -i <master>.mp4 -vf "scale=1680:1050:flags=lanczos" \
  -c:v libx264 -preset slower -crf 20 -pix_fmt yuv420p \
  -color_primaries bt709 -color_trc bt709 -colorspace bt709 \
  -an -movflags +faststart <name>_web.mp4
```

Measured ~41-47 dB PSNR against the downscaled source, glyphs indistinguishable
at 2x zoom. Most of the saving is not quality at all: the masters carry a short
15-frame GOP for scrubbing in kdenlive, which delivery does not need.

**GitHub caps video uploads at 10MB on free plans.** Anything over that is
refused with `<!-- Failed to upload "name.mp4" -->` left in the comment box. For
those, drop to 30fps and use two-pass VBR at a hard target:

```bash
KBPS=$(python3 -c "print(int(9.0*8*1024/<duration_seconds>))")   # 9MB target
ffmpeg -i <in>.mp4 -vf fps=30 -c:v libx264 -preset slower -b:v ${KBPS}k \
  -pix_fmt yuv420p -an -pass 1 -passlogfile /tmp/x264 -f mp4 /dev/null
ffmpeg -i <in>.mp4 -vf fps=30 -c:v libx264 -preset slower -b:v ${KBPS}k \
  -pix_fmt yuv420p -an -pass 2 -passlogfile /tmp/x264 \
  -movflags +faststart <out>.mp4
```

Halving the frame rate rather than raising CRF is deliberate: it keeps every
pixel of spatial detail and only costs motion smoothness, where a higher CRF
puts ringing around glyphs — which is the artefact a reader actually notices in
a screen recording.

## A gotcha when verifying a URL

`curl -I` (HEAD) against a `user-attachments` URL returns **403** even for a
perfectly public asset; only GET is permitted on the signed storage URL. Use
`curl -sL -o file <url>` to check one. A 403 from HEAD is not evidence that an
attachment is private.
