// Swap placeholder stills for delivered clips inside a draft the owner has edited, without rebuilding it.
//   node src/patch_placeholders.js <draft name> <patch.json> [--dry]
// patch.json: [{ "placeholder": "e001r_FC4.png", "file": "D:/.../FC4.mp4", "src": 0, "at": 511.32 }, ...]
//   "at" (seconds, optional) picks one segment when the same placeholder sits in several slots.
//   "newAt" / "newDur" (seconds, optional): place the clip at its natural length instead of the old slot (the owner's
//   decision decides what it may cover; other segments it would overlap must be listed for removal).
//   { "remove": "e001r_dk1_drafting_table.png", "at": 656.93 } deletes that one segment (by media file name and start).
//   { "repoint": "C:/Users/x/Downloads/a.mp3", "to": "D:/media/a.mp3" } points every material (and the draft's media
//   list in draft_meta_info.json) at the moved file; the target must exist and the source path must be in use.
//   { "setVolume": "<segment id>", "volume": 0.12 } sets one segment's volume (linear, 1 = 0 dB), e.g. a music re-level.
// Each matching segment is replaced by the clip in the same track, at the same start and length (volume 0, scale 1,
// no motion), so the owner's edits elsewhere stay untouched. The root draft_content.json is saved through the harness
// (validation, CapCut must be closed) and mirrored into Timelines/<id>/draft_content.json, which CapCut 9.6 also reads.
// The build map's contentHash is NOT updated: the draft keeps counting as hand-edited, so a rebuild stays refused.
import fs from 'fs';
import path from 'path';
import { CapCutDraft } from './core.js';

const [name, patchPath] = process.argv.slice(2);
const dry = process.argv.includes('--dry');
if (!name || !patchPath) { console.error('usage: node src/patch_placeholders.js <draft> <patch.json> [--dry]'); process.exit(2); }
const patches = JSON.parse(fs.readFileSync(patchPath, 'utf8'));
const d = new CapCutDraft(name);
const US = 1e6;
const mats = {};
for (const [k, v] of Object.entries(d.content.materials)) if (Array.isArray(v)) for (const m of v) if (m && m.id) mats[m.id] = m;
const done = [];
const norm = x => String(x || '').split(String.fromCharCode(92)).join('/').toLowerCase();
const repointed = [];
const volumes = [];
for (const p of patches) {
  if (p.setVolume) {
    const { s } = d._find(p.setVolume);
    volumes.push({ id: p.setVolume, from: s.volume, to: p.volume });
    if (!dry) { s.volume = p.volume; if (s.last_nonzero_volume != null && p.volume > 0) s.last_nonzero_volume = p.volume; }
    continue;
  }
  if (p.repoint) {
    if (!fs.existsSync(p.to)) throw new Error(`repoint target missing: ${p.to}`);
    let n = 0;
    for (const m of Object.values(mats)) if (m.path && norm(m.path) === norm(p.repoint)) { if (!dry) m.path = p.to; n++; }
    if (!n) throw new Error(`repoint: no material uses ${p.repoint}`);
    let metaHits = 0;
    if (d.meta) {
      const walk = o => { for (const k of Object.keys(o)) { const v = o[k];
        if (typeof v === 'string' && norm(v) === norm(p.repoint)) { if (!dry) o[k] = p.to; metaHits++; }
        else if (v && typeof v === 'object') walk(v); } };
      walk(d.meta);
    }
    repointed.push({ from: p.repoint, to: p.to, materials: n, metaEntries: metaHits });
    continue;
  }
  if (p.remove) {
    const hit = [];
    d.content.tracks.forEach((tr, ti) => (tr.segments || []).forEach(s => {
      const mp = String(mats[s.material_id]?.path || '').split('\\').join('/');
      if (mp.endsWith('/' + p.remove) && Math.abs(s.target_timerange.start / US - p.at) < 0.1) hit.push({ ti, s });
    }));
    if (hit.length !== 1) throw new Error(`remove ${p.remove} at ${p.at}: ${hit.length} matching segments (need exactly 1)`);
    done.push({ removed: p.remove, track: hit[0].ti, atSec: hit[0].s.target_timerange.start / US, durSec: hit[0].s.target_timerange.duration / US });
    if (!dry) d.deleteSegment(hit[0].s.id);
    continue;
  }
  if (!fs.existsSync(p.file)) throw new Error(`missing clip: ${p.file}`);
  const hits = [];
  d.content.tracks.forEach((tr, ti) => (tr.segments || []).forEach(s => {
    const mp = String(mats[s.material_id]?.path || '').replace(/\\/g, '/');
    if (mp.endsWith('/' + p.placeholder) && (p.at == null || Math.abs(s.target_timerange.start / US - p.at) < 0.1)) hits.push({ ti, s });
  }));
  if (hits.length !== 1) throw new Error(`${p.placeholder} at ${p.at}: ${hits.length} matching segments (need exactly 1)`);
  const { ti, s } = hits[0];
  const at = p.newAt != null ? Math.round(p.newAt * US) : s.target_timerange.start;
  const dur = p.newDur != null ? Math.round(p.newDur * US) : s.target_timerange.duration;
  done.push({ placeholder: p.placeholder, track: d.content.tracks[ti].name || ti, atSec: at / US, durSec: dur / US, src: p.src || 0, file: p.file });
  if (dry) continue;
  d.deleteSegment(s.id);
  const r = d.addVideo(p.file, { atUs: at, durUs: dur, srcStartUs: Math.round((p.src || 0) * US), trackIndex: ti, volume: 0, scale: 1, posX: 0, posY: 0, opacity: 1 });
  done.at(-1).segmentId = r.segmentId;
  d.content.tracks[ti].segments.sort((a, b) => a.target_timerange.start - b.target_timerange.start);
}
// no two segments may overlap on a video track the patch touched (main track or overlay)
for (const ti of new Set(done.map(x => x.track).filter(x => typeof x === 'number'))) {
  const segs = d.content.tracks[ti].segments;
  for (let i = 1; i < segs.length; i++) {
    const a = segs[i - 1].target_timerange, b = segs[i].target_timerange;
    if (!dry && a.start + a.duration > b.start + 1000) throw new Error(`track ${ti}: overlap at ${(b.start / US).toFixed(2)} s (list the covered segment for removal)`);
  }
}
if (dry) { console.log(JSON.stringify({ dry: true, done, repointed, volumes }, null, 1)); process.exit(0); }
const saved = d.save();
// a CapCut-saved draft always fails two checks (duplicate material ids, shared render indexes): compare counts
// mirror into every timeline copy CapCut keeps
const tdir = path.join(d.dir, 'Timelines');
const mirrored = [];
if (fs.existsSync(tdir)) for (const id of fs.readdirSync(tdir)) {
  const f = path.join(tdir, id, 'draft_content.json');
  if (fs.existsSync(f)) { fs.copyFileSync(path.join(d.dir, 'draft_content.json'), f); mirrored.push(id); }
}
console.log(JSON.stringify({ saved: saved.saved, durationSec: saved.durationSec, validation: saved.validation, done, repointed, volumes, mirrored }, null, 1));
