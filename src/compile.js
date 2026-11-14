// compile a resolved timeline (see spec.js) into a fresh CapCut draft.
// The draft is build output: rebuilding replaces it, so hand edits belong in the spec or come after the last build.
import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import { CapCutDraft, cloneDraft, DRAFTS_DIR } from './core.js';
import { motionKeyframes } from './motion.js';

const US = 1e6;
const us = s => Math.round(s * US);
const MAP_FILE = 'lafincat_map.json';                       // item id -> segment id, for later read-back
// replaced drafts go here, outside CapCut's folder (a backup inside it shows up as a project)
const BACKUPS = path.join(path.dirname(DRAFTS_DIR), 'Draft backups');
const hashOf = file => crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');
const gcd = (a, b) => b ? gcd(b, a % b) : a;

export function compileToCapcut(tl, { draft, base, replace = false, force = false } = {}) {
  if (!draft) throw new Error('draft name required');
  if (!base) throw new Error('base draft required (a draft with video, audio and text layers to clone templates from)');
  const missing = tl.tracks.flatMap(t => t.items).filter(it => it.file && !fs.existsSync(it.file)).map(it => it.file);
  if (missing.length) throw new Error(`missing media: ${[...new Set(missing)].join(', ')}`);
  const dir = path.join(DRAFTS_DIR, draft);
  if (fs.existsSync(dir)) {
    if (!replace) throw new Error(`draft exists: ${draft}. Pass replace to rebuild it (the old one is kept as a backup folder).`);
    if (fs.existsSync(path.join(dir, '.locked')) && !force) throw new Error(`draft ${draft} is open in CapCut. Close it first.`);
    // the owner's hand edits are never overwritten silently: a draft that changed since its last build is refused
    const mapPath = path.join(dir, MAP_FILE);
    const built = fs.existsSync(mapPath) ? JSON.parse(fs.readFileSync(mapPath, 'utf8')).contentHash : null;
    if (!force && (!built || built !== hashOf(path.join(dir, 'draft_content.json'))))
      throw new Error(`draft ${draft} was changed in CapCut since its last build (hand edits?). Bring the edits into the spec, ` +
        `or pass force to replace it (the old draft is kept in "${BACKUPS}").`);
  }
  // Build the new draft completely under a temporary name, validate it, and only then swap it in (2026-11-14: a
  // build cut off after the old draft was moved away left an empty draft that CapCut could not open and reset).
  const tmpName = `${draft}.__building`, tmpDir = path.join(DRAFTS_DIR, tmpName);
  if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });   // our own leftover from a cut-off build
  cloneDraft(base, tmpName, { empty: true });
  const d = new CapCutDraft(tmpName);
  d.templateDraft = base;
  d.content.tracks = [];
  const { w, h, fps } = tl.canvas, g = gcd(w, h);
  d.content.canvas_config = { ...(d.content.canvas_config || {}), width: w, height: h, ratio: `${w / g}:${h / g}` };
  d.content.fps = fps;
  if (d.meta) d.meta.draft_name = draft;

  const map = {};
  for (const tr of tl.tracks) {
    const idx = d.addTrack(tr.type === 'audio' ? 'audio' : tr.type === 'text' ? 'text' : 'video', tr.name);
    for (const it of tr.items) {
      const o = { atUs: us(it.atSec), durUs: us(it.durSec), srcStartUs: us(it.srcSec || 0), trackIndex: idx,
        scale: it.scale, posX: it.posX, posY: it.posY, opacity: it.opacity, volume: it.volume };
      const r = it.kind === 'text' ? d.addText(it.text, { ...o, fontSize: it.fontSize ?? undefined, color: it.color ?? undefined,
          bold: it.bold, stroke: it.stroke, strokeWidth: it.strokeWidth, show: it.show })
        : it.kind === 'image' ? d.addImage(it.file, o)
        : it.kind === 'audio' ? d.addAudio(it.file, o)
        : d.addVideo(it.file, o);
      map[it.id] = r.segmentId;
      const kf = motionKeyframes(it);
      if (kf) d.setKeyframes(r.segmentId, kf);
      // outline text (script lines, notes): on the timeline to read, not in the picture
      if (it.hidden) d.setProps(r.segmentId, { visible: false });
      if (it.kind === 'audio' && (it.fadeIn > 0 || it.fadeOut > 0)) d.setAudioFade(r.segmentId, us(it.fadeIn || 0), us(it.fadeOut || 0));
      if (it.chroma) d.setChroma(r.segmentId, it.chroma === true ? {} : it.chroma);
      if (it.flip) d.setProps(r.segmentId, { flipH: it.flip.includes('h'), flipV: it.flip.includes('v') });
    }
  }
  d.content.name = draft;
  const saved = d.save({ force });
  if (!saved.validation.ok) throw new Error(`the new draft failed validation (kept as "${tmpName}", the old draft is untouched): ` +
    JSON.stringify(saved.validation.issues).slice(0, 500));
  // the new draft is complete: point its meta at the final name and folder, then swap folders
  const metaPath = path.join(tmpDir, 'draft_meta_info.json');
  if (fs.existsSync(metaPath)) {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    Object.assign(meta, { draft_name: draft, draft_fold_path: dir.split(path.sep).join('/') });
    fs.writeFileSync(metaPath, JSON.stringify(meta));
  }
  for (const fn of fs.readdirSync(tmpDir)) if (/\.(mcpbak|tmp)$/.test(fn)) fs.rmSync(path.join(tmpDir, fn), { force: true });
  if (fs.existsSync(dir)) {
    fs.mkdirSync(BACKUPS, { recursive: true });
    fs.renameSync(dir, path.join(BACKUPS, `${draft}.${new Date().toISOString().replace(/[:.]/g, '-')}`));
  }
  fs.renameSync(tmpDir, dir);
  fs.writeFileSync(path.join(dir, MAP_FILE), JSON.stringify({ episode: tl.episode, builtAt: new Date().toISOString(),
    contentHash: hashOf(path.join(dir, 'draft_content.json')), items: map }, null, 2));
  return { ...saved, saved: draft, items: Object.keys(map).length };
}
