import { test } from 'node:test';
import assert from 'node:assert/strict';
import { motionKeyframes } from '../src/motion.js';

const item = (anim, durSec = 3) => ({ anim, durSec, scale: 0.3, posX: 0.7, posY: -0.4 });

test('no anim -> null', () => assert.equal(motionKeyframes(item(null)), null));

test('pop: scale in and out, wobble inside the segment', () => {
  const k = motionKeyframes(item('pop'));
  const sc = k.KFTypeScaleX;
  assert.deepEqual(sc[0], [0, 0]);
  assert.equal(sc.at(-1)[0], 3e6);
  assert.equal(sc.at(-1)[1], 0);
  assert.ok(sc.some(([, v]) => v > 0.3));
  assert.ok(k.KFTypeRotation.every(([t]) => t >= 0 && t <= 3e6));
});

test('combined presets merge lists; unknown throws', () => {
  const k = motionKeyframes(item('push+shake', 2));
  assert.ok(k.KFTypeScaleX && k.KFTypePositionX && k.KFTypePositionY);
  assert.throws(() => motionKeyframes(item('spin')), /unknown anim/);
});
