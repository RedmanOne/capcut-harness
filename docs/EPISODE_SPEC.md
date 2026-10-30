# Episode spec

An episode is a YAML file in git; the CapCut draft and the preview are built from it.
Change the spec, rebuild. Hand edits in CapCut come after the last rebuild (a rebuild replaces the draft,
keeping the old one as `<name>.bak-<time>`).

```bash
node src/cli.js build path/to/episode.yaml --preview            # timeline.json + render/preview.mp4 (360p)
node src/cli.js build path/to/episode.yaml --capcut --replace   # fresh CapCut draft (CapCut must be closed)
node src/cli.js voice-clean raw.wav clean.wav                   # phone-voice cleanup to -16 LUFS; pauses > 0.4 s shrink to 0.25 s (--keep-pauses: off)
```
MCP: `capcut_build_episode { spec, preview, capcut, replace }`.

`draft: { name, base }` in the spec names the draft and the base draft whose video/audio/text layers are
cloned as templates (it must contain at least one of each).

Line ids: letters, digits, `_` only (anchors like `hook.end-1.5` rely on it).

## Spec format (input)
```yaml
episode: E001-demo
canvas: { w: 1920, h: 1080, fps: 30 }        # default 1920x1080, 30
media_root: ../media                          # relative paths of files resolve against this (itself resolved against spec.__dir); default spec.__dir
stickers_dir: ../../brand/stickers/png        # resolved against spec.__dir
wps: 2.6                                      # words per second for estimating line duration without voice; default 2.6
voiceover:                                    # optional
  take: vo/take1.wav                          # one recording of all lines
  alignment: vo/alignment.json                # optional: { "<lineId>": [startSec, endSec], ... } positions inside the take
styles:                                       # named property presets, merged under item props
  sticker: { scale: 0.3, posX: 0.7, posY: -0.5 }
lines:                                        # narration, the timing backbone, laid one after another
  - id: hook
    text: "These are chess pieces."
    vo: vo/hook.wav                           # optional per-line recording
    pad: 0.3                                  # pause after the line, default 0.25
    dur: 3                                    # optional explicit duration (overrides everything)
tracks:
  - name: Footage
    type: video                               # video | audio | text
    items:
      - file: clips/a.mp4                     # video track: .png/.jpg/.jpeg/.webp => kind "image", else "video"
        at: hook                              # see "Anchors"
        until: l2                             # or dur: 4.5 ; or neither => media length (images: 3 s)
        src: 12                               # in-point inside the source, default 0
        volume: 0
      - sticker: pointing-shock               # => kind "image", file = <stickersDir>/pointing-shock.png
        at: hook+0.5
        dur: 2
        style: sticker
  - name: Captions
    type: text
    from_lines: true                          # one text item per line (text = line.text, at = line start, dur = line duration without pad)
    style: caption                            # applied to each generated item
  - name: Music
    type: audio
    items:
      - { file: music/x.mp3, at: 0, until: end, volume: 0.15 }
```

## Line timing
Lines are laid sequentially starting at 0: `line.startSec = previous line endSec + previous pad` (first line starts at 0).
Line duration (`endSec - startSec`), first match wins:
1. `dur` given -> dur.
2. `voiceover.alignment` file exists and has the line id -> `end - start` from it.
3. `vo` given (file exists) -> probe(vo file).
4. estimate: `max(1, wordCount / wps)` where wordCount = text split on whitespace (non-empty).
Each resolved line: `{ id, text, startSec, endSec, padSec, vo: { file, srcSec } | null }`:
- case 2: `vo = { file: <abs take path>, srcSec: alignment start }`
- case 3: `vo = { file: <abs vo path>, srcSec: 0 }`
- otherwise null.

## Anchors (`at` and `until`)
- number -> seconds.
- `"<lineId>"` -> that line's startSec; `"<lineId>.end"` -> its endSec.
- `"start"` -> 0; `"end"` -> the episode end (see below).
- optional offset suffix: `"hook+0.5"`, `"hook.end-1.25"`.
- item `offset: <number>` is added to `at` as well.
- `until` uses the same syntax, BUT a bare `"<lineId>"` in `until` means that line's **endSec**.
- unknown line id -> throw Error(`unknown line id: <id>`).
Item duration: `dur` if given; else `until - at`; else probe(file) - src for video/audio; 3 for images.
Episode end (`durationSec`) = max(last line endSec + its pad, end of every item that does not use `until: end`).
Items with `until: end` are resolved after that.

## Voice track (automatic)
If any line has `vo`, append an audio track `{ name: "Voice", type: "audio", items: [...] }` with one item per voiced line:
`{ kind: "audio", file: vo.file, atSec: line.startSec, durSec: line.endSec - line.startSec, srcSec: vo.srcSec, volume: 1 }`.

## Output (resolved timeline)
```js
{
  episode, canvas: { w, h, fps },
  durationSec,
  lines: [ ...resolved lines ],
  tracks: [ { name, type, items: [ Item ] } ]   // same order as spec, Voice track last
}
// Item:
{ id, kind, file, text, atSec, durSec, srcSec, volume, opacity, scale, posX, posY, fontSize, color }
```
- `id`: stable and unique: `item.id` from the spec if given, else `<trackName>#<index>` (index within that track, 0-based);
  for from_lines items `<trackName>#<lineId>`; voice items `Voice#<lineId>`.
- `file`: absolute path with forward slashes, or null for text.
- `text`: string for text items, else null.
- Defaults: srcSec 0, volume 1, opacity 1, scale 1, posX 0, posY 0, fontSize null, color null.
- Property precedence: item fields > its `style` (or the track's `style`) from `spec.styles` > defaults.
  Unknown style name -> throw Error(`unknown style: <name>`).
- Numbers rounded to 3 decimals (seconds).
- Text items in a `type: text` track may also be written by hand: `{ text: "Hello", at: hook, dur: 2 }`.


## Notes
- Items in an `audio` track are audio; in a `video` track, image extensions are stills, the rest video;
  items without `file` are text.
- `at` may be omitted (0). `"<id>.start"` in `until` ends a clip exactly where that line starts: use it on the first video track, which CapCut treats as the main track and closes gaps on (later clips would shift). `at: end` / `until: end` resolve after every other item, so music can run to the end.
- Positions: `posX`/`posY` in -1..1 from the frame centre, +y up (CapCut's convention); `scale` 1 = fitted to the frame.
- Motion: `anim` on an item (or in its style) adds CapCut keyframes: `pop` (sticker: 0 → 110% → 100% in 0.25 s,
  ±3° wobble, out in the last 0.15 s), `push` / `pull` (stills: 100% ↔ 108% over the clip), `shake` (0.4 s position
  jitter), `punch` (112% → 100% in 0.2 s). Combine with `+`: `pop+shake`. See `src/motion.js`.
- Rebuilding (`--replace`) refuses a draft that changed in CapCut since its last build (the owner's hand edits): bring
  the edits into the spec first, or pass `--force`. Replaced drafts are kept in `D:/CapCut/Draft backups/`, never deleted.
- `hidden: true` keeps an item on the timeline but out of the picture (outline text: script lines, notes, cues).
- `every: 4` on a video/image item: cut the slot into equal shots of at most 4 s, cycling through `file` and `files`
  (a reused clip continues where it stopped); every other shot is punched in by `zoom` (default 1.2, 1 = off).
- `flip: v | h | hv` on a video/image item: mirror it vertically and/or horizontally (e.g. footage shot as a reflection).
- `files: [b.mp4, c.mp4]` on a video item: the slot plays `file` from `src`, then fills the rest of its duration with the listed clips in turn (B-roll under long talking parts).
