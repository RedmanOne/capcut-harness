// audio fades / crossfade, blur-dim variants
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fx-test-'));
const drafts = path.join(tmp, 'drafts');
process.env.CAPCUT_DRAFTS_DIR = drafts;              // before core.js is loaded
fs.mkdirSync(drafts, { recursive: true });

const { resolveSpec, applyCrossfade } = await import('../src/spec.js');
const { variantKey, variantPath, variantFilter, applyVariants, renderVariant } = await import('../src/variant.js');
const { fades } = await import('../src/preview.js');
const { CapCutDraft } = await import('../src/core.js');

const noRender = () => {};
const base = extra => ({ episode: 't', __dir: tmp, lines: [{ id: 'a', text: 'x', dur: 10 }, { id: 'b', text: 'y', dur: 10 }], ...extra });

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('audio fades', () => {
  test('fadeIn/fadeOut pass through, clamped to the item', () => {
    const tl = resolveSpec(base({ tracks: [{ name: 'Music', type: 'audio', items: [
      { file: 'm.mp3', at: 0, dur: 4, fadeIn: 1, fadeOut: 1.5 },
      { file: 'm.mp3', at: 5, dur: 2, fadeIn: 3, fadeOut: 3 }] }] }), { probe: () => 60, variant: noRender });
    const [a, b] = tl.tracks[0].items;
    assert.equal(a.fadeIn, 1); assert.equal(a.fadeOut, 1.5);
    assert.equal(b.fadeIn, 2); assert.equal(b.fadeOut, 0);
  });

  test('items without fades get 0; video items carry no fade fields', () => {
    const tl = resolveSpec(base({ tracks: [{ name: 'Main', type: 'video', items: [{ file: 'v.mp4', at: 0, dur: 2 }] },
      { name: 'SFX', type: 'audio', items: [{ file: 's.mp3', at: 0, dur: 1 }] }] }), { probe: () => 5, variant: noRender });
    assert.equal(tl.tracks[0].items[0].fadeIn, undefined);
    assert.equal(tl.tracks[1].items[0].fadeIn, 0);
  });

  test('track crossfade overlaps butted items, fades both sides, spills into a lane', () => {
    const tl = resolveSpec(base({ tracks: [{ name: 'Music', type: 'audio', crossfade: 2, items: [
      { file: 'b.mp3', at: 'b', until: 'end' },            // listed out of order on purpose
      { file: 'a.mp3', at: 'a', until: 'b.start' }] }] }), { probe: () => 60, variant: noRender });
    const music = tl.tracks.find(t => t.name === 'Music'), lane2 = tl.tracks.find(t => t.name === 'Music 2');
    assert.ok(lane2, 'the overlap spills into "Music 2"');
    const a = [...music.items, ...lane2.items].find(i => i.file.endsWith('a.mp3'));
    const b = [...music.items, ...lane2.items].find(i => i.file.endsWith('b.mp3'));
    assert.equal(b.atSec, 10.25, 'the next item keeps its anchor');
    assert.equal(a.atSec + a.durSec, 12.25, 'the previous item runs 2 s longer');
    assert.equal(a.fadeOut, 2); assert.equal(b.fadeIn, 2);
  });

  test('crossfade pulls the next item earlier when the previous file runs out', () => {
    const items = [{ file: 'a', atSec: 0, durSec: 9, srcSec: 0 }, { file: 'b', atSec: 9, durSec: 5, srcSec: 0 }];
    applyCrossfade(items, 2, () => 10);                    // a has 1 s left
    assert.equal(items[0].durSec, 10); assert.equal(items[1].atSec, 8); assert.equal(items[1].durSec, 6);
    assert.equal(items[0].fadeOut, 2); assert.equal(items[1].fadeIn, 2);
  });

  test('crossfade leaves gaps alone', () => {
    const items = [{ file: 'a', atSec: 0, durSec: 4, srcSec: 0 }, { file: 'b', atSec: 6, durSec: 4, srcSec: 0 }];
    applyCrossfade(items, 1, () => 60);
    assert.equal(items[0].durSec, 4); assert.equal(items[1].fadeIn, undefined);
  });

  test('preview afade filters', () => {
    assert.equal(fades({ durSec: 5, fadeIn: 1, fadeOut: 2 }), ',afade=t=in:st=0:d=1,afade=t=out:st=3:d=2');
    assert.equal(fades({ durSec: 5 }), '');
  });

  test('CapCut: audio_fades material referenced from the segment', () => {
    const dir = path.join(drafts, 'fx');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'draft_content.json'), JSON.stringify({ materials: { audio_fades: [] },
      tracks: [{ type: 'audio', segments: [{ id: 'S1', extra_material_refs: ['X'] }] }] }));
    const d = new CapCutDraft('fx');
    d.setAudioFade('S1', 1e6, 2e6);
    const f = d.content.materials.audio_fades;
    assert.equal(f.length, 1);
    assert.deepEqual({ ...f[0], id: 0 }, { id: 0, fade_in_duration: 1000000, fade_out_duration: 2000000, fade_type: 0, name: '', type: 'audio_fade' });
    assert.deepEqual(d.content.tracks[0].segments[0].extra_material_refs, ['X', f[0].id]);
    d.setAudioFade('S1', 5e5, 0);                          // replaces, never stacks
    assert.equal(d.content.materials.audio_fades.length, 1);
    assert.equal(d.content.tracks[0].segments[0].extra_material_refs.length, 2);
    d.setAudioFade('S1', 0, 0);
    assert.equal(d.content.materials.audio_fades.length, 0);
    assert.deepEqual(d.content.tracks[0].segments[0].extra_material_refs, ['X']);
  });
});

describe('blur / dim variants', () => {
  let src, img;
  before(() => {
    src = path.join(tmp, 'src.mp4'); img = path.join(tmp, 'still.png');
    spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=s=320x180:r=30:d=4', '-pix_fmt', 'yuv420p', src]);
    spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=s=320x180', '-frames:v', '1', img]);
  });
  const stat = { size: 100, mtimeMs: 5 };
  const it = (o = {}) => ({ kind: 'video', file: 'D:/m/clip.mp4', srcSec: 2, durSec: 3, blur: 20, dim: 0.4, ...o });

  test('the key is stable and changes with the look, the range and the source', () => {
    const k = variantKey(it(), stat);
    assert.equal(k, variantKey(it(), { ...stat }));
    assert.match(k, /^[0-9a-f]{12}$/);
    for (const o of [{ blur: 10 }, { dim: 0.5 }, { srcSec: 2.5 }, { durSec: 4 }, { file: 'D:/m/other.mp4' }])
      assert.notEqual(variantKey(it(o), stat), k, JSON.stringify(o));
    assert.notEqual(variantKey(it(), { ...stat, mtimeMs: 6 }), k, 'a re-rendered source busts the cache');
    assert.notEqual(variantKey(it(), { ...stat, size: 101 }), k);
    assert.equal(variantKey(it({ file: 'd:\\m\\CLIP.mp4' }), stat), k, 'path spelling does not matter');
  });

  test('images ignore the range; paths keep the stem and extension', () => {
    const im = { kind: 'image', file: 'D:/m/bg.png', blur: 8, dim: 0 };
    assert.equal(variantKey({ ...im, srcSec: 0, durSec: 3 }, stat), variantKey({ ...im, srcSec: 0, durSec: 9 }, stat));
    assert.match(variantPath(im, 'D:/c', stat), /^D:\/c\/bg\.[0-9a-f]{12}\.png$/);
    assert.match(variantPath(it(), 'D:/c', stat), /^D:\/c\/clip\.[0-9a-f]{12}\.mp4$/);
  });

  test('filter', () => {
    assert.equal(variantFilter(20, 0.4, 1080), 'gblur=sigma=20,colorchannelmixer=rr=0.6:gg=0.6:bb=0.6');
    assert.equal(variantFilter(20, 0, 540), 'gblur=sigma=10');
    assert.equal(variantFilter(0, 0), 'null');
  });

  test('resolve swaps the file, plays from 0 and keeps the original for usage checks', () => {
    const seen = [];
    const tl = resolveSpec(base({ media_root: tmp, tracks: [{ name: 'Main', type: 'video', items: [
      { file: 'src.mp4', at: 0, dur: 2, src: 1, blur: 12, dim: 0.5 },
      { file: 'src.mp4', at: 2, dur: 2, src: 1 }] }] }), { probe: () => 4, variant: (i, out) => seen.push(out) });
    const [a, b] = tl.tracks[0].items;
    assert.equal(seen.length, 1);
    assert.equal(a.file, seen[0]); assert.ok(a.file.startsWith(tmp.replace(/\\/g, '/') + '/.cache/'));
    assert.equal(a.srcSec, 0); assert.deepEqual(a.orig, { file: path.join(tmp, 'src.mp4').replace(/\\/g, '/'), srcSec: 1 });
    assert.equal(b.orig, undefined); assert.equal(b.blur, 0);
  });

  test('ffmpeg renders a video variant of the used range once (cached)', () => {
    const v = { kind: 'video', file: src, srcSec: 1, durSec: 2, blur: 6, dim: 0.5 };
    const out = variantPath(v, path.join(tmp, 'cache'));
    renderVariant(v, out);
    const d = parseFloat(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out], { encoding: 'utf8' }).stdout);
    assert.ok(d >= 2 && d < 2.3, `duration ${d}`);
    const m = fs.statSync(out).mtimeMs;
    renderVariant(v, out);
    assert.equal(fs.statSync(out).mtimeMs, m, 'second call hits the cache');
  });

  test('ffmpeg renders an image variant', () => {
    const v = { kind: 'image', file: img, blur: 4, dim: 0.3 };
    const out = variantPath(v, path.join(tmp, 'cache'));
    renderVariant(v, out);
    assert.ok(fs.statSync(out).size > 0);
    const tracks = [{ items: [{ ...v, srcSec: 0, durSec: 3 }] }];
    assert.equal(applyVariants(tracks, path.join(tmp, 'cache')), 1);
    assert.equal(tracks[0].items[0].file, out);
  });
});
