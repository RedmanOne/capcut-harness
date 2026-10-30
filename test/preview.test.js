import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawnSync } from 'child_process';
import { buildPreviewArgs, renderPreview } from '../src/preview.js';

const tmpDir = path.join(os.tmpdir(), `preview_test_${Date.now()}`);
let aMp4, sPng, mWav;

function runFfmpeg(args) {
  const res = spawnSync('ffmpeg', args, { encoding: 'utf8' });
  if (res.status !== 0) {
    throw new Error(`ffmpeg failed: ${res.stderr}`);
  }
}

function probeDuration(file) {
  const out = spawnSync('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=nw=1:nk=1',
    file
  ], { encoding: 'utf8' });
  return parseFloat(out.stdout.trim());
}

function probeStreams(file) {
  const out = spawnSync('ffprobe', [
    '-v', 'error',
    '-show_entries', 'stream=codec_type,width,height',
    '-of', 'csv=p=0',
    file
  ], { encoding: 'utf8' });
  return out.stdout.trim().split('\n').filter(Boolean).map(l => {
    const [type, w, h] = l.split(',');
    return { type, width: parseInt(w) || 0, height: parseInt(h) || 0 };
  });
}

before(() => {
  fs.mkdirSync(tmpDir, { recursive: true });
  aMp4 = path.join(tmpDir, 'a.mp4');
  sPng = path.join(tmpDir, 's.png');
  mWav = path.join(tmpDir, 'm.wav');

  runFfmpeg(['-f', 'lavfi', '-i', 'testsrc=s=320x240:r=30:d=3', '-f', 'lavfi', '-i', 'sine=f=440:d=3', '-shortest', '-y', aMp4]);
  runFfmpeg(['-f', 'lavfi', '-i', 'color=c=red@0.5:s=100x100,format=rgba', '-frames:v', '1', '-y', sPng]);
  runFfmpeg(['-f', 'lavfi', '-i', 'sine=f=880:d=2', '-y', mWav]);
});

after(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

describe('buildPreviewArgs', () => {
  test('returns args with filter_complex', () => {
    const timeline = {
      canvas: { w: 640, h: 360, fps: 30 },
      durationSec: 5,
      tracks: [
        { name: 'v1', type: 'video', items: [] }
      ]
    };
    const outPath = path.join(tmpDir, 'out.mp4');
    const { args } = buildPreviewArgs(timeline, outPath);
    assert.ok(args.includes('-/filter_complex'), 'should read the graph from a file');
    const idx = args.indexOf('-/filter_complex');
    assert.ok(idx >= 0 && idx + 1 < args.length, 'should have filter graph after -filter_complex');
    assert.ok(fs.readFileSync(args[idx + 1], 'utf8').includes('color=c=black'), 'filter graph should contain base color');
  });
});

describe('renderPreview', () => {
  test('renders a 5s preview with video, image, text, and audio', () => {
    const timeline = {
      canvas: { w: 640, h: 360, fps: 30 },
      durationSec: 5,
      tracks: [
        {
          name: 'video1',
          type: 'video',
          items: [
            { id: 'v1', kind: 'video', file: aMp4, atSec: 0, durSec: 3, srcSec: 0, volume: 1, opacity: 1, scale: 1, posX: 0, posY: 0 }
          ]
        },
        {
          name: 'image1',
          type: 'video',
          items: [
            { id: 'i1', kind: 'image', file: sPng, atSec: 1, durSec: 3, srcSec: 0, volume: 0, opacity: 1, scale: 0.3, posX: 0.5, posY: 0.5 }
          ]
        },
        {
          name: 'text1',
          type: 'text',
          items: [
            { id: 't1', kind: 'text', file: null, text: 'Hello World', atSec: 0.5, durSec: 2, srcSec: 0, fontSize: 24, color: '#ffff00', opacity: 1, scale: 1, posX: 0, posY: -0.3 }
          ]
        },
        {
          name: 'audio1',
          type: 'audio',
          items: [
            { id: 'a1', kind: 'audio', file: mWav, atSec: 2, durSec: 2, srcSec: 0, volume: 0.8 }
          ]
        }
      ]
    };
    const outPath = path.join(tmpDir, 'preview.mp4');
    const result = renderPreview(timeline, outPath);
    assert.equal(result.out, outPath);
    assert.equal(result.durationSec, 5);
    assert.ok(fs.existsSync(outPath), 'output file should exist');

    const dur = probeDuration(outPath);
    assert.ok(dur >= 4.8 && dur <= 5.2, `duration should be 5±0.2s, got ${dur}`);

    const streams = probeStreams(outPath);
    const videoStreams = streams.filter(s => s.type === 'video');
    const audioStreams = streams.filter(s => s.type === 'audio');
    assert.equal(videoStreams.length, 1, 'should have exactly one video stream');
    assert.equal(audioStreams.length, 1, 'should have exactly one audio stream');
    assert.equal(videoStreams[0].height, 360, 'video height should be 360');
  });
});