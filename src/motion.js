// motion presets -> CapCut keyframe lists (times in microseconds from the segment start).
// Nothing on screen stays still: stickers pop in, wobble and pop out; stills drift; impacts shake.
const US = 1e6;

const presets = {
  // sticker: 0 -> 110% -> 100% in 0.25 s, a slow +-3 degree wobble, 100% -> 0 in the last 0.15 s
  pop(it, D) {
    const s = it.scale, inEnd = Math.min(0.25, D / 3), outStart = Math.max(inEnd, D - 0.15);
    const rot = [[0, 0]];
    for (let t = inEnd, k = 0; t < outStart; t += 0.6, k++) rot.push([t, k % 2 ? -3 : 3]);
    rot.push([outStart, 0]);
    return {
      KFTypeScaleX: [[0, 0], [inEnd * 0.6, s * 1.1], [inEnd, s], [outStart, s], [D, 0]],
      KFTypeRotation: rot,
    };
  },
  // still: slow push-in / pull-out (Ken Burns)
  push: (it, D) => ({ KFTypeScaleX: [[0, it.scale], [D, it.scale * 1.08]] }),
  pull: (it, D) => ({ KFTypeScaleX: [[0, it.scale * 1.08], [D, it.scale]] }),
  // impact: position jitter for 0.4 s
  shake(it) {
    const xs = [], ys = [];
    for (let i = 0, t = 0; t <= 0.4; i++, t += 0.04) {
      const a = 0.02 * (1 - t / 0.4);
      xs.push([t, it.posX + (i % 2 ? a : -a)]);
      ys.push([t, it.posY + (i % 3 === 0 ? a : -a / 2)]);
    }
    return { KFTypePositionX: xs, KFTypePositionY: ys };
  },
  // zoom punch on a word: 112% -> 100% in 0.2 s
  punch: (it) => ({ KFTypeScaleX: [[0, it.scale * 1.12], [0.2, it.scale]] }),
};

/// "pop", "push+shake", ... -> merged keyframe lists in microseconds, or null.
export function motionKeyframes(item) {
  if (!item.anim) return null;
  const D = item.durSec, out = {};
  for (const name of String(item.anim).split('+')) {
    const p = presets[name.trim()];
    if (!p) throw new Error(`unknown anim: ${name} (pop, push, pull, shake, punch)`);
    for (const [type, keys] of Object.entries(p(item, D)))
      out[type] = [...(out[type] || []), ...keys.filter(([t]) => t <= D + 1e-6)];
  }
  for (const k of Object.keys(out)) out[k] = out[k].map(([t, v]) => [t * US, +v.toFixed(4)]);
  return out;
}

export const motionNames = Object.keys(presets);
