// Blurred / dimmed footage: `blur: <radius>` and `dim: 0..1` on a video or image item. The look is baked into a
// cached file with ffmpeg (CapCut just plays it; the preview shows the same file). A video variant holds only the
// used range (from `src`, `dur` + a small tail), so the item plays it from 0; `orig` keeps the source file and
// range for the usage checks. Cache: <media_root>/.cache/<stem>.<key>.mp4|png (spec `cache_dir` overrides).
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawnSync } from 'child_process';

const VERSION = 'v1';                 // bump when the filter changes: old cache entries are then ignored
const TAIL = 0.1;                     // extra seconds so frame rounding never leaves the segment short
const IMAGE = /\.(png|jpe?g|webp)$/i;
const r3 = n => Math.round(n * 1000) / 1000;

export const wantsVariant = it => (it.kind === 'video' || it.kind === 'image') && it.file && ((it.blur ?? 0) > 0 || (it.dim ?? 0) > 0);

/// The cache key: source identity (path, size, mtime) + the look + the range (video). Same inputs, same key.
export function variantKey(it, stat = fs.statSync(it.file)) {
  const image = IMAGE.test(it.file);
  const parts = [VERSION, path.resolve(it.file).replace(/\\/g, '/').toLowerCase(), stat.size, Math.round(stat.mtimeMs),
    r3(it.blur ?? 0), r3(it.dim ?? 0), image ? '' : `${r3(it.srcSec ?? 0)}+${r3(it.durSec)}`];
  return crypto.createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 12);
}

export function variantPath(it, cacheDir, stat) {
  const ext = IMAGE.test(it.file) ? '.png' : '.mp4';
  return path.join(cacheDir, `${path.parse(it.file).name}.${variantKey(it, stat)}${ext}`).replace(/\\/g, '/');
}

/// ffmpeg filter for the look: gaussian blur (sigma = radius in pixels at 1080p, scaled to the source height)
/// and a multiplicative dim (0 = untouched, 1 = black).
export function variantFilter(blur = 0, dim = 0, srcH = 1080) {
  const f = [];
  if (blur > 0) f.push(`gblur=sigma=${r3(blur * srcH / 1080)}`);
  if (dim > 0) { const k = r3(Math.max(0, 1 - dim)); f.push(`colorchannelmixer=rr=${k}:gg=${k}:bb=${k}`); }
  return f.join(',') || 'null';
}

function probeH(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=height', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  return parseInt(r.stdout) || 1080;
}

/// Render the variant with ffmpeg unless it is cached. Returns the output path.
export function renderVariant(it, out) {
  if (fs.existsSync(out) && fs.statSync(out).size > 0) return out;
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const vf = variantFilter(it.blur, it.dim, probeH(it.file));
  const tmp = out.replace(/(\.\w+)$/, '.part$1');
  const args = IMAGE.test(it.file)
    ? ['-v', 'error', '-y', '-i', it.file, '-vf', vf, '-frames:v', '1', tmp]
    : ['-v', 'error', '-y', '-ss', String(it.srcSec ?? 0), '-t', String(r3(it.durSec + TAIL)), '-i', it.file,
      '-map', '0:v:0', '-map', '0:a:0?', '-vf', vf, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18',
      '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', tmp];
  const r = spawnSync('ffmpeg', args, { encoding: 'utf8' });
  if (r.status !== 0) { fs.rmSync(tmp, { force: true }); throw new Error(`ffmpeg variant failed for ${it.file}: ${r.stderr}`); }
  fs.renameSync(tmp, out);
  return out;
}

/// Swap every blur/dim item's file for its cached variant. `render(item, outPath)` is injectable for tests.
export function applyVariants(tracks, cacheDir, render = renderVariant) {
  let n = 0;
  for (const tr of tracks) for (const it of tr.items) {
    if (!wantsVariant(it)) continue;
    const out = variantPath(it, cacheDir);
    render(it, out);
    it.orig = { file: it.file, srcSec: it.srcSec };
    it.file = out;
    if (it.kind === 'video') it.srcSec = 0;
    n++;
  }
  return n;
}
