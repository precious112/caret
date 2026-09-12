# Launch media

Canonical URLs for the demo videos used in `README.md`, and how to regenerate them.

Videos are **not committed to this repo** — the three masters are 116MB against a
78MB pack, and a repo-hosted MP4 renders as a *link*, not a player. GitHub only
plays video from `user-attachments` URLs, so they live there and are referenced
below. GIFs are the opposite: they render fine from a relative path, so those are
committed alongside this file.

## Hosted videos

Uploaded via drag-and-drop into a GitHub comment box (there is no API or `gh`
command for `user-attachments` — see `docs/connect-an-agent.md` for the tooling
that *is* scriptable). MD5s are the local encodes in `~/edits/`, so any URL here
can be verified against the file it came from.

| What it shows | Length | Size | md5 | URL |
|---|---|---|---|---|
| Visual editing — text, colour, image, resize, overlay | 1:11 | 5.5MB | `27b6746a` | https://github.com/user-attachments/assets/2fb6a9f4-f000-423c-8b9c-d70a81422bc6 |
| Asset generation — mark, shader, photograph | 2:00 | 8.85MB | `d8e9a7fe` | https://github.com/user-attachments/assets/99115f37-797a-454c-978a-421c6dace536 |
| Launch demo v2 | 1:43 | 9.00MB | `662e1118` | https://github.com/user-attachments/assets/93e273d4-aed3-45cd-bb5e-c5b587691017 |
| **Launch demo v1 — the README hero** | 1:43 | 7.25MB | `0bb9c7ad` | _not uploaded yet_ |

To embed one, put the bare URL on its own line in Markdown. GitHub turns it into
a player. Do not wrap it in `![]()` — that renders a broken image.

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
