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
