import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSpec } from '../src/spec.js';

function createTempSpec(spec) {
  const dir = mkdtempSync(join(tmpdir(), 'spec-test-'));
  const specWithDir = { ...spec, __dir: dir };
  return { dir, spec: specWithDir };
}

function cleanup(dir) {
  rmSync(dir, { recursive: true, force: true });
}

const probe = () => 10;

function round3(n) {
  return Math.round(n * 1000) / 1000;
}

describe('resolveSpec', () => {
  let temp;

  beforeEach(() => {
    temp = null;
  });

  afterEach(() => {
    if (temp) cleanup(temp.dir);
  });

  it('sequential line timing with pads and estimates', () => {
    temp = createTempSpec({
      episode: 'test',
      lines: [
        { id: 'l1', text: 'Hello world' },
        { id: 'l2', text: 'This is a test line' }
      ]
    });
    const result = resolveSpec(temp.spec, { probe });
    assert.equal(result.lines[0].startSec, 0);
    assert.equal(result.lines[0].endSec, round3(Math.max(1, 2 / 2.6)));
    assert.equal(result.lines[1].startSec, round3(result.lines[0].endSec + 0.25));
  });

  it('dur override', () => {
    temp = createTempSpec({
      episode: 'test',
      lines: [
        { id: 'l1', text: 'Hello world', dur: 5 }
      ]
    });
    const result = resolveSpec(temp.spec, { probe });
    assert.equal(result.lines[0].endSec, 5);
  });

  it('anchor l1', () => {
    temp = createTempSpec({
      episode: 'test',
      lines: [
        { id: 'l1', text: 'First', dur: 2 },
        { id: 'l2', text: 'Second', dur: 2 }
      ],
      tracks: [{
        name: 'Video',
        type: 'video',
        items: [{ file: 'a.mp4', at: 'l1' }]
      }]
    });
    const result = resolveSpec(temp.spec, { probe });
    assert.equal(result.tracks[0].items[0].atSec, 0);
  });

  it('anchor l1.end', () => {
    temp = createTempSpec({
      episode: 'test',
      lines: [
        { id: 'l1', text: 'First', dur: 2 },
        { id: 'l2', text: 'Second', dur: 2 }
      ],
      tracks: [{
        name: 'Video',
        type: 'video',
        items: [{ file: 'a.mp4', at: 'l1.end' }]
      }]
    });
    const result = resolveSpec(temp.spec, { probe });
    assert.equal(result.tracks[0].items[0].atSec, 2);
  });

  it('anchor l1+0.5', () => {
    temp = createTempSpec({
      episode: 'test',
      lines: [
        { id: 'l1', text: 'First', dur: 2 },
        { id: 'l2', text: 'Second', dur: 2 }
      ],
      tracks: [{
        name: 'Video',
        type: 'video',
        items: [{ file: 'a.mp4', at: 'l1+0.5' }]
      }]
    });
    const result = resolveSpec(temp.spec, { probe });
    assert.equal(result.tracks[0].items[0].atSec, 0.5);
  });

  it('until l2 (end of l2)', () => {
    temp = createTempSpec({
      episode: 'test',
      lines: [
        { id: 'l1', text: 'First', dur: 2 },
        { id: 'l2', text: 'Second', dur: 2 }
      ],
      tracks: [{
        name: 'Video',
        type: 'video',
        items: [{ file: 'a.mp4', at: 'l1', until: 'l2' }]
      }]
    });
    const result = resolveSpec(temp.spec, { probe });
    // l1 starts at 0, ends at 2, pad 0.25 -> l2 starts at 2.25, ends at 4.25
    // item at l1 (0) until l2 (4.25) -> dur 4.25
    assert.equal(result.tracks[0].items[0].durSec, round3(4.25));
  });

  it('until end', () => {
    temp = createTempSpec({
      episode: 'test',
      lines: [
        { id: 'l1', text: 'First', dur: 2 }
      ],
      tracks: [{
        name: 'Video',
        type: 'video',
        items: [{ file: 'a.mp4', at: 0, until: 'end' }]
      }]
    });
    const result = resolveSpec(temp.spec, { probe });
    // episode end = l1.end + l1.pad = 2 + 0.25 = 2.25
    assert.equal(result.tracks[0].items[0].durSec, 2.25);
  });

  it('offset', () => {
    temp = createTempSpec({
      episode: 'test',
      lines: [
        { id: 'l1', text: 'First', dur: 2 }
      ],
      tracks: [{
        name: 'Video',
        type: 'video',
        items: [{ file: 'a.mp4', at: 'l1', offset: 0.5 }]
      }]
    });
    const result = resolveSpec(temp.spec, { probe });
    assert.equal(result.tracks[0].items[0].atSec, 0.5);
  });

  it('image default 3s', () => {
    temp = createTempSpec({
      episode: 'test',
      lines: [{ id: 'l1', text: 'First', dur: 1 }],
      tracks: [{
        name: 'Video',
        type: 'video',
        items: [{ file: 'img.png', at: 'l1' }]
      }]
    });
    const result = resolveSpec(temp.spec, { probe });
    assert.equal(result.tracks[0].items[0].durSec, 3);
  });

  it('flip passes through, default null', () => {
    temp = createTempSpec({
      episode: 'test',
      lines: [{ id: 'l1', text: 'First', dur: 1 }],
      tracks: [{
        name: 'Video',
        type: 'video',
        items: [{ file: 'a.mp4', at: 'l1', flip: 'v' }, { file: 'b.mp4', at: 'l1' }]
      }]
    });
    const result = resolveSpec(temp.spec, { probe });
    assert.equal(result.tracks[0].items[0].flip, 'v');
    assert.equal(result.tracks[0].items[1].flip, null);
  });

  it('every cuts a slot into short shots, cycling files and punching in', () => {
    temp = createTempSpec({
      episode: 'test', media_root: '/m',
      lines: [{ id: 'l1', text: 'First', dur: 10 }],
      tracks: [{ name: 'Video', type: 'video', items: [{ file: 'a.mp4', files: ['b.png'], at: 'l1', until: 'l1', every: 4 }] }]
    });
    const items = resolveSpec(temp.spec, { probe }).tracks[0].items;
    assert.equal(items.length, 3);
    assert.deepEqual(items.map(i => [i.file.split('/').pop(), i.kind, i.atSec, i.scale]),
      [['a.mp4', 'video', 0, 1], ['b.png', 'image', 3.333, 1.2], ['a.mp4', 'video', 6.667, 1]]);
    assert.equal(items[2].srcSec, 3.333);
  });

  it('overlapping audio spills into extra tracks', () => {
    temp = createTempSpec({
      episode: 'test',
      lines: [{ id: 'l1', text: 'First', dur: 10 }],
      tracks: [{ name: 'SFX', type: 'audio', items: [{ file: 'a.mp3', at: 0, dur: 3 }, { file: 'b.mp3', at: 2, dur: 3 }, { file: 'c.mp3', at: 3, dur: 1 }] }]
    });
    const t = resolveSpec(temp.spec, { probe }).tracks;
    assert.deepEqual(t.map(x => [x.name, x.items.map(i => i.atSec)]), [['SFX', [0, 3]], ['SFX 2', [2]]]);
  });

  it('sticker path', () => {
    temp = createTempSpec({
      episode: 'test',
      stickers_dir: 'stickers',
      lines: [{ id: 'l1', text: 'First', dur: 1 }],
      tracks: [{
        name: 'Video',
        type: 'video',
        items: [{ sticker: 'pointing-shock', at: 'l1', dur: 2 }]
      }]
    });
    const result = resolveSpec(temp.spec, { probe });
    assert.match(result.tracks[0].items[0].file, /pointing-shock\.png$/);
  });

  it('style precedence', () => {
    temp = createTempSpec({
      episode: 'test',
      styles: { sticker: { scale: 0.5, posX: 0.2 } },
      lines: [{ id: 'l1', text: 'First', dur: 1 }],
      tracks: [{
        name: 'Video',
        type: 'video',
        items: [
          { file: 'a.mp4', at: 'l1', style: 'sticker' },
          { file: 'b.mp4', at: 'l1', style: 'sticker', scale: 0.8 }
        ]
      }]
    });
    const result = resolveSpec(temp.spec, { probe });
    assert.equal(result.tracks[0].items[0].scale, 0.5);
    assert.equal(result.tracks[0].items[0].posX, 0.2);
    assert.equal(result.tracks[0].items[1].scale, 0.8);
    assert.equal(result.tracks[0].items[1].posX, 0.2);
  });

  it('from_lines captions', () => {
    temp = createTempSpec({
      episode: 'test',
      styles: { caption: { color: '#fff' } },
      lines: [
        { id: 'l1', text: 'First', dur: 2 },
        { id: 'l2', text: 'Second', dur: 2 }
      ],
      tracks: [{
        name: 'Captions',
        type: 'text',
        from_lines: true,
        style: 'caption'
      }]
    });
    const result = resolveSpec(temp.spec, { probe });
    assert.equal(result.tracks[0].items.length, 2);
    assert.equal(result.tracks[0].items[0].text, 'First');
    assert.equal(result.tracks[0].items[0].atSec, 0);
    assert.equal(result.tracks[0].items[0].durSec, 2);
    assert.equal(result.tracks[0].items[1].text, 'Second');
  });

  it('unknown line id throws', () => {
    temp = createTempSpec({
      episode: 'test',
      lines: [{ id: 'l1', text: 'First', dur: 1 }],
      tracks: [{
        name: 'Video',
        type: 'video',
        items: [{ file: 'a.mp4', at: 'unknown' }]
      }]
    });
    assert.throws(() => resolveSpec(temp.spec, { probe }), /unknown line id: unknown/);
  });

  it('alignment case produces Voice track', () => {
    const dir = mkdtempSync(join(tmpdir(), 'spec-align-'));
    writeFileSync(join(dir, 'take.wav'), '');
    writeFileSync(join(dir, 'alignment.json'), JSON.stringify({ hook: [0.5, 3.5] }));
    const spec = {
      episode: 'test',
      voiceover: { take: 'take.wav', alignment: 'alignment.json' },
      lines: [{ id: 'hook', text: 'Hook line', pad: 0 }],
      __dir: dir
    };
    const result = resolveSpec(spec, { probe });
    assert.ok(result.tracks.some(t => t.name === 'Voice'));
    const voiceTrack = result.tracks.find(t => t.name === 'Voice');
    assert.equal(voiceTrack.items.length, 1);
    assert.equal(voiceTrack.items[0].atSec, 0);
    assert.equal(voiceTrack.items[0].durSec, 3);
    assert.equal(voiceTrack.items[0].srcSec, 0.5);
    cleanup(dir);
  });
});
import { resolveSpec as resolveFill } from '../src/spec.js';
import { test as testFill } from 'node:test';
import assertFill from 'node:assert/strict';
testFill('files fill a long slot back to back', () => {
  const t = resolveFill({ __dir: '.', lines: [{ id: 'a', text: 'x', dur: 25 }],
    tracks: [{ name: 'V', type: 'video', items: [{ file: 'a.mp4', at: 'a', until: 'a', src: 2, files: ['b.mp4'] }] }] },
    { probe: f => (f.endsWith('a.mp4') ? 10 : 6) });
  const it = t.tracks[0].items;
  assertFill.deepEqual(it.map(i => [i.file.split('/').pop(), i.atSec, i.durSec, i.srcSec]),
    [['a.mp4', 0, 8, 2], ['b.mp4', 8, 6, 0], ['a.mp4', 14, 10, 0], ['b.mp4', 24, 1, 0]]);
});
