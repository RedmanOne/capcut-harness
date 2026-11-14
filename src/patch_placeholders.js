// Swap placeholder stills for delivered clips inside a draft the owner has edited, without rebuilding it.
//   node src/patch_placeholders.js <draft name> <patch.json> [--dry]
// patch.json: [{ "placeholder": "e001r_FC4.png", "file": "D:/.../FC4.mp4", "src": 0, "at": 511.32 }, ...]
//   "at" (seconds, optional) picks one segment when the same placeholder sits in several slots.
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
for (const p of patches) {
  if (!fs.existsSync(p.file)) throw new Error(`missing clip: ${p.file}`);
  const hits = [];
  d.content.tracks.forEach((tr, ti) => (tr.segments || []).forEach(s => {
    const mp = String(mats[s.material_id]?.path || '').replace(/\\/g, '/');
    if (mp.endsWith('/' + p.placeholder) && (p.at == null || Math.abs(s.target_timerange.start / US - p.at) < 0.1)) hits.push({ ti, s });
  }));
  if (hits.length !== 1) throw new Error(`${p.placeholder} at ${p.at}: ${hits.length} matching segments (need exactly 1)`);
  const { ti, s } = hits[0];
  const at = s.target_timerange.start, dur = s.target_timerange.duration;
  done.push({ placeholder: p.placeholder, track: d.content.tracks[ti].name || ti, atSec: at / US, durSec: dur / US, src: p.src || 0, file: p.file });
  if (dry) continue;
  d.deleteSegment(s.id);
  const r = d.addVideo(p.file, { atUs: at, durUs: dur, srcStartUs: Math.round((p.src || 0) * US), trackIndex: ti, volume: 0, scale: 1, posX: 0, posY: 0, opacity: 1 });
  done.at(-1).segmentId = r.segmentId;
  d.content.tracks[ti].segments.sort((a, b) => a.target_timerange.start - b.target_timerange.start);
}
if (dry) { console.log(JSON.stringify({ dry: true, done }, null, 1)); process.exit(0); }
const saved = d.save();
if (!saved.validation.ok) console.error('VALIDATION:', JSON.stringify(saved.validation.issues).slice(0, 800));
// mirror into every timeline copy CapCut keeps
const tdir = path.join(d.dir, 'Timelines');
const mirrored = [];
if (fs.existsSync(tdir)) for (const id of fs.readdirSync(tdir)) {
  const f = path.join(tdir, id, 'draft_content.json');
  if (fs.existsSync(f)) { fs.copyFileSync(path.join(d.dir, 'draft_content.json'), f); mirrored.push(id); }
}
console.log(JSON.stringify({ saved: saved.saved, durationSec: saved.durationSec, validation: saved.validation, done, mirrored }, null, 1));
