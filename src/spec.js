import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import YAML from 'yaml';
import { applyVariants } from './variant.js';

const round3 = n => Math.round(n * 1000) / 1000;

function defaultProbe(file) {
  try {
    const out = execSync(`ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "${file}"`, { encoding: 'utf8' });
    return parseFloat(out.trim());
  } catch {
    return 0;
  }
}

function resolvePath(base, rel) {
  if (!rel) return null;
  const abs = path.isAbsolute(rel) ? rel : path.resolve(base, rel);
  return abs.replace(/\\/g, '/');
}

// "<id>" | "<id>.start" | "<id>.end", optional "+1.5" / "-0.5". A bare id means the line's start in `at`
// and its end in `until`; ".start" in `until` butts a clip against the next one (CapCut's main track closes gaps).
function parseLineRef(str, lines, bareIsEnd) {
  const m = str.match(/^(\w+)(?:\.(start|end))?([+-]\d+(?:\.\d+)?)?$/);
  if (!m) throw new Error(`unknown line id: ${str}`);
  const [, id, edge, offset] = m;
  const line = lines.find(l => l.id === id);
  if (!line) throw new Error(`unknown line id: ${id}`);
  const atEnd = edge ? edge === 'end' : bareIsEnd;
  return (atEnd ? line.endSec : line.startSec) + (offset ? parseFloat(offset) : 0);
}

function parseAnchor(str, lines, episodeEnd) {
  if (str == null) return 0;
  if (typeof str === 'number') return str;
  if (str === 'start') return 0;
  if (str === 'end') return episodeEnd;
  return parseLineRef(str, lines, false);
}

function parseUntil(str, lines, episodeEnd) {
  if (typeof str === 'number') return str;
  if (str === 'start') return 0;
  if (str === 'end') return episodeEnd;
  return parseLineRef(str, lines, true);
}

// media (footage, voice, music) lives outside git: every media path resolves against media_root
const mediaRoot = spec => spec.media_root ? path.resolve(spec.__dir, spec.media_root) : spec.__dir;

function wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function loadSpec(specPath) {
  const abs = path.resolve(specPath);
  const content = fs.readFileSync(abs, 'utf8');
  const spec = YAML.parse(content);
  spec.__dir = path.dirname(abs);
  return spec;
}

function resolveLines(spec, probe) {
  const { lines = [], wps = 2.6, voiceover } = spec;
  const media = mediaRoot(spec);
  const alignPath = voiceover?.alignment ? resolvePath(media, voiceover.alignment) : null;
  const alignment = alignPath && fs.existsSync(alignPath) ? JSON.parse(fs.readFileSync(alignPath, 'utf8')) : null;
  const takePath = voiceover?.take ? resolvePath(media, voiceover.take) : null;

  let prevEnd = 0;
  return lines.map((line, i) => {
    const startSec = i === 0 ? 0 : prevEnd + (lines[i - 1].pad ?? 0.25);
    let dur, vo = null;

    if (line.dur != null) {
      dur = line.dur;
    } else if (alignment?.[line.id]) {
      dur = alignment[line.id][1] - alignment[line.id][0];
      vo = { file: takePath, srcSec: alignment[line.id][0] };
    } else if (line.vo) {
      const voPath = resolvePath(media, line.vo);
      dur = probe(voPath);
      if (!(dur > 0)) throw new Error(`voice file missing or empty for line ${line.id}: ${voPath}`);
      vo = { file: voPath, srcSec: 0 };
    } else {
      const wc = wordCount(line.text);
      dur = Math.max(1, wc / wps);
    }

    const endSec = startSec + dur;
    const padSec = line.pad ?? 0.25;
    prevEnd = endSec;

    return {
      id: line.id,
      text: line.text,
      startSec: round3(startSec),
      endSec: round3(endSec),
      padSec: round3(padSec),
      vo
    };
  });
}

function applyStyle(item, styleName, styles) {
  if (!styleName) return;
  const style = styles[styleName];
  if (!style) throw new Error(`unknown style: ${styleName}`);
  for (const [k, v] of Object.entries(style)) {
    if (item[k] === undefined) item[k] = v;
  }
}

function resolveItem(item, track, spec, lines, episodeEnd, probe, stickersDir, itemIndex) {
  const { styles = {} } = spec;
  const kind = item.sticker ? 'image' : !item.file ? 'text' : track.type === 'audio' ? 'audio'
    : /\.(png|jpe?g|webp)$/i.test(item.file) ? 'image' : 'video';
  const file = item.sticker
    ? resolvePath(stickersDir, `${item.sticker}.png`)
    : item.file
      ? resolvePath(mediaRoot(spec), item.file)
      : null;

  const at = parseAnchor(item.at, lines, episodeEnd) + (item.offset ?? 0);
  let dur;
  if (item.dur != null) {
    dur = item.dur;
  } else if (item.until != null) {
    dur = parseUntil(item.until, lines, episodeEnd) - at;
  } else if (kind === 'image') {
    dur = 3;
  } else {
    dur = Math.max(0, probe(file) - (item.src ?? 0));
  }

  const resolved = {
    id: item.id ?? `${track.name}#${itemIndex}`,
    kind,
    file,
    text: item.text ?? null,
    atSec: round3(at),
    durSec: round3(dur),
    srcSec: round3(item.src ?? 0),
    volume: item.volume,
    opacity: item.opacity,
    scale: item.scale,
    posX: item.posX,
    posY: item.posY,
    fontSize: item.fontSize,
    color: item.color,
    anim: item.anim,
    hidden: item.hidden,
    flip: item.flip,
    fadeIn: item.fadeIn,
    fadeOut: item.fadeOut,
    blur: item.blur,
    dim: item.dim
  };

  const styleName = item.style ?? track.style;
  applyStyle(resolved, styleName, styles);

  resolved.volume ??= 1;
  resolved.opacity ??= 1;
  resolved.scale ??= 1;
  resolved.posX ??= 0;
  resolved.posY ??= 0;
  resolved.fontSize ??= null;
  resolved.color ??= null;
  resolved.anim ??= null;
  resolved.hidden ??= false;
  resolved.flip ??= null;
  if (kind === 'audio') {
    resolved.fadeIn = round3(Math.min(resolved.fadeIn ?? 0, resolved.durSec));
    resolved.fadeOut = round3(Math.min(resolved.fadeOut ?? 0, resolved.durSec - resolved.fadeIn));
  } else { delete resolved.fadeIn; delete resolved.fadeOut; }
  if (kind !== 'video' && kind !== 'image') { delete resolved.blur; delete resolved.dim; }
  else { resolved.blur ??= 0; resolved.dim ??= 0; }

  if (item.every) return cutSlot(resolved, item, spec, probe);
  return item.files ? fillSlot(resolved, item, spec, probe) : resolved;
}

// A CapCut track can't hold overlapping segments: items that overlap spill into extra tracks ("SFX", "SFX 2", ...).
// Video tracks never spill (the first one is the main track; an overlap there is a spec error the validator reports).
function lanes(track) {
  if (track.type !== 'audio') return [track];
  const out = [];
  for (const it of [...track.items].sort((a, b) => a.atSec - b.atSec)) {
    let lane = out.find(l => l.end <= it.atSec + 1e-6);
    if (!lane) out.push(lane = { end: 0, items: [] });
    lane.items.push(it); lane.end = it.atSec + it.durSec;
  }
  return out.length ? out.map((l, i) => ({ name: i ? `${track.name} ${i + 1}` : track.name, type: track.type, items: l.items })) : [track];
}

// `crossfade: N` on an audio track: each item that butts against (or overlaps) the previous one overlaps it by N s;
// the previous one fades out over the overlap and the next fades in (an item's own fadeIn/fadeOut wins when longer).
// The overlap comes from running the previous item longer (as far as its file allows); the rest moves the next
// item's start earlier. The overlap then spills into a second lane like any audio overlap.
export function applyCrossfade(items, N, probe) {
  const xs = [...items].sort((a, b) => a.atSec - b.atSec);
  for (let i = 1; i < xs.length; i++) {
    const a = xs[i - 1], b = xs[i], aEnd = a.atSec + a.durSec;
    if (b.atSec - aEnd > 0.05) continue;                    // a gap: not a hand-over
    const have = aEnd - b.atSec;                            // overlap the spec already has
    const need = Math.max(0, N - Math.max(0, have));
    const room = a.file ? Math.max(0, probe(a.file) - a.srcSec - a.durSec) : need;
    const ext = Math.min(need, room), pull = Math.min(need - ext, b.atSec);
    a.durSec = round3(a.durSec + ext + Math.max(0, -have));
    b.atSec = round3(b.atSec - pull); b.durSec = round3(b.durSec + pull);
    const ov = round3(a.atSec + a.durSec - b.atSec);
    a.fadeOut = round3(Math.min(Math.max(a.fadeOut ?? 0, ov), a.durSec - (a.fadeIn ?? 0)));
    b.fadeIn = round3(Math.min(Math.max(b.fadeIn ?? 0, ov), b.durSec));
  }
  return items;
}

// `every: N` on a video item: cut the slot into equal shots of at most N seconds (a new frame every few seconds).
// Shots cycle through `file` and `files`; a clip used again continues from where it stopped (wrapping at its end);
// every other shot is punched in by `zoom` (default 1.2; 1 = off), so even a single still changes framing.
function cutSlot(first, item, spec, probe) {
  const pool = [first.file, ...(item.files ?? []).map(f => resolvePath(mediaRoot(spec), f))];
  const n = Math.max(1, Math.ceil(first.durSec / item.every - 1e-6)), len = first.durSec / n, zoom = item.zoom ?? 1.2;
  const head = new Map([[first.file, first.srcSec]]);
  const out = [];
  for (let k = 0; k < n; k++) {
    const file = pool[k % pool.length], image = /\.(png|jpe?g|webp)$/i.test(file);
    let src = image ? 0 : head.get(file) ?? 0;
    if (!image && src + len > probe(file)) src = 0;
    if (!image) head.set(file, src + len);
    out.push({ ...first, id: `${first.id}.${k}`, file, kind: image ? 'image' : 'video', srcSec: round3(src),
      atSec: round3(first.atSec + k * len), durSec: round3(round3(first.atSec + (k + 1) * len) - round3(first.atSec + k * len)), scale: k % 2 ? round3(first.scale * zoom) : first.scale });
  }
  return out;
}

// `files: [a, b, ...]`: the slot plays `file` (from `src`) and fills the rest of its duration with the listed
// clips in turn (each from its start), back to back — B-roll under long talking parts.
function fillSlot(first, item, spec, probe) {
  const pool = [first.file, ...item.files.map(f => resolvePath(mediaRoot(spec), f))];
  const out = [];
  let t = first.atSec, left = first.durSec, k = 0;
  while (left > 0.01 && k < 200) {
    const file = pool[k % pool.length], src = k === 0 ? first.srcSec : 0;
    const len = Math.max(0, probe(file) - src);
    if (!(len > 0.05)) { k++; continue; }
    const dur = Math.min(len, left);
    out.push({ ...first, id: `${first.id}.${k}`, file, srcSec: round3(src), atSec: round3(t), durSec: round3(dur) });
    t += dur; left -= dur; k++;
  }
  return out;
}

function resolveFromLinesTrack(track, spec, lines, episodeEnd, stickersDir) {
  const { styles = {} } = spec;
  const items = lines.map((line, i) => {
    const item = {
      id: `${track.name}#${line.id}`,
      kind: 'text',
      file: null,
      text: line.text,
      atSec: round3(line.startSec),
      durSec: round3(line.endSec - line.startSec),
      srcSec: 0,
      volume: undefined,
      opacity: undefined,
      scale: undefined,
      posX: undefined,
      posY: undefined,
      fontSize: undefined,
      color: undefined
    };
    applyStyle(item, track.style, styles);
    item.volume ??= 1;
    item.opacity ??= 1;
    item.scale ??= 1;
    item.posX ??= 0;
    item.posY ??= 0;
    item.fontSize ??= null;
    item.color ??= null;
    return item;
  });
  return { name: track.name, type: 'text', items };
}

export function resolveSpec(spec, opts = {}) {
  const { probe = defaultProbe, stickersDir } = opts;
  const canvas = { w: 1920, h: 1080, fps: 30, ...spec.canvas };
  const stickers = stickersDir ?? resolvePath(spec.__dir, spec.stickers_dir);
  const lines = resolveLines(spec, probe);

  const linesEnd = lines.length ? lines[lines.length - 1].endSec + lines[lines.length - 1].padSec : 0;
  const toEnd = item => item.until === 'end' || item.at === 'end';

  // pass 1: everything that doesn't depend on the episode end; pass 2: items anchored to the end
  const specTracks = spec.tracks ?? [];
  const resolved = specTracks.map(track => track.from_lines ? null
    : (track.items ?? []).map((item, i) => toEnd(item) ? null : resolveItem(item, track, spec, lines, linesEnd, probe, stickers, i)));
  let durationSec = linesEnd;
  for (const items of resolved) for (const it of (items ?? []).flat()) if (it) durationSec = Math.max(durationSec, it.atSec + it.durSec);

  const tracks = specTracks.map((track, ti) => {
    if (track.from_lines) return resolveFromLinesTrack(track, spec, lines, durationSec, stickers);
    const items = (track.items ?? []).map((item, i) => resolved[ti][i] ?? resolveItem(item, track, spec, lines, durationSec, probe, stickers, i)).flat();
    if (track.type === 'audio' && track.crossfade > 0) applyCrossfade(items, track.crossfade, probe);
    return { name: track.name, type: track.type, items };
  }).flatMap(lanes);

  // blur/dim: bake the look into cached files (opts.variant replaces the ffmpeg renderer in tests)
  const cacheDir = resolvePath(mediaRoot(spec), spec.cache_dir ?? '.cache');
  applyVariants(tracks, cacheDir, opts.variant);

  const voiceItems = lines
    .filter(l => l.vo)
    .map(l => ({
      id: `Voice#${l.id}`,
      kind: 'audio',
      file: l.vo.file,
      text: null,
      atSec: round3(l.startSec),
      durSec: round3(l.endSec - l.startSec),
      srcSec: round3(l.vo.srcSec),
      volume: 1,
      opacity: 1,
      scale: 1,
      posX: 0,
      posY: 0,
      fontSize: null,
      color: null
    }));

  if (voiceItems.length) {
    tracks.push({ name: 'Voice', type: 'audio', items: voiceItems });
  }

  return {
    episode: spec.episode,
    canvas,
    durationSec: round3(durationSec),
    lines: lines.map(l => ({ ...l, startSec: round3(l.startSec), endSec: round3(l.endSec), padSec: round3(l.padSec) })),
    tracks
  };
}