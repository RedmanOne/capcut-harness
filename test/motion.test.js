import { test } from 'node:test';
import assert from 'node:assert/strict';
import { motionKeyframes } from '../src/motion.js';

const item = (anim, durSec = 3) => ({ anim, durSec, scale: 0.3, posX: 0.7, posY: -0.4 });

test('no anim -> null', () => assert.equal(motionKeyframes(item(null)), null));

test('pop: squash in, steady hold, squash out', () => {
  const k = motionKeyframes(item('pop'));
  const sx = k.KFTypeScaleX, sy = k.KFTypeScaleY;
  assert.equal(sx.length, sy.length);
  assert.equal(sx.at(-1)[0], 3e6);
  assert.equal(sx.at(-1)[1], 0);
  assert.ok(sx.some(([, v]) => v > 0.3) && sy.some(([, v]) => v > 0.3));
  // the hold: from the end of the entrance to the start of the exit both axes sit at the item's scale
  const hold = sx.filter(([t]) => t >= 0.4e6 && t <= 2.7e6);
  assert.ok(hold.length >= 2 && hold.every(([, v]) => Math.abs(v - 0.3) < 1e-9));
  assert.equal(k.KFTypeRotation, undefined);
});

test('combined presets merge lists; unknown throws', () => {
  const k = motionKeyframes(item('push+shake', 2));
  assert.ok(k.KFTypeScaleX && k.KFTypePositionX && k.KFTypePositionY);
  assert.throws(() => motionKeyframes(item('spin')), /unknown anim/);
});

import { wrapText } from '../src/core.js';
test('wrapText breaks at spaces within the width', () => {
  assert.equal(wrapText('one two three four', 9), 'one two\nthree\nfour');
  assert.equal(wrapText('short', 20), 'short');
});

test('meme: pops in, keeps moving through the hold, squashes out to 0', () => {
  const k = motionKeyframes(item('meme', 2.5));
  const sx = k.KFTypeScaleX, sy = k.KFTypeScaleY;
  assert.equal(sx.at(-1)[1], 0);
  assert.equal(sy.at(-1)[1], 0);
  // the hold is not steady: scale grows between the end of the entrance and the start of the exit
  const atIn = sx.find(([t]) => t >= 0.35e6 - 1)[1], atOut = sx.filter(([t]) => t <= 2.25e6 + 1).at(-1)[1];
  assert.ok(atOut > atIn * 1.05);
  assert.ok(k.KFTypePositionX.at(-1)[1] < 0.7); // drifts toward the centre from the right
  assert.ok(k.KFTypeRotation.length >= 3);
});

test('breathe stays above 100% (no edges on a full-frame shot) and drifts', () => {
  const k = motionKeyframes({ anim: 'breathe', durSec: 5, scale: 1, posX: 0, posY: 0 });
  assert.ok(k.KFTypeScaleX.every(([, v]) => v >= 1.029 && v <= 1.091));
  assert.ok(k.KFTypeScaleX.length >= 10);
  assert.notEqual(k.KFTypePositionX[0][1], k.KFTypePositionX.at(-1)[1]);
});

test('kinetic text: fades in, holds visible, flies out; drift and sway exist', () => {
  const k = motionKeyframes({ anim: 'kinetic', durSec: 2, scale: 1, posX: 0, posY: 0 });
  assert.equal(k.KFTypeAlpha[0][1], 0);
  assert.equal(k.KFTypeAlpha.at(-1)[1], 0);
  assert.ok(k.KFTypeAlpha.some(([, v]) => v === 1));
  assert.ok(k.KFTypeScaleX[0][1] > 2);
  const d = motionKeyframes({ anim: 'pop+drift+sway', durSec: 3, scale: 0.4, posX: -0.5, posY: 0 });
  assert.ok(d.KFTypePositionX.at(-1)[1] > -0.5 && d.KFTypeRotation.length > 3);
});
