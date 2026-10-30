// motion presets -> CapCut keyframe lists (times in microseconds from the segment start).
// Nothing on screen stays still: stickers squash in, hold steady and squash out; stills drift; impacts shake.
const US = 1e6;

const presets = {
  // sticker / logo: squash-and-stretch in (stretch up, squash, settle), a steady hold, then squash and vanish
  pop(it, D) {
    const s = it.scale, a = Math.min(0.4, D * 0.35), b = Math.min(0.3, D * 0.3), o = D - b;
    const inX = [[0, 0.2], [0.3, 0.75], [0.55, 1.2], [0.78, 0.94], [1, 1]];
    const inY = [[0, 0.2], [0.3, 1.3], [0.55, 0.82], [0.78, 1.06], [1, 1]];
    const outX = [[0, 1], [0.4, 1.18], [0.7, 0.82], [1, 0]];
    const outY = [[0, 1], [0.4, 0.86], [0.7, 1.22], [1, 0]];
    const keys = (inK, outK) => [...inK.map(([f, v]) => [f * a, s * v]), ...outK.map(([f, v]) => [o + f * b, s * v])];
    return { KFTypeScaleX: keys(inX, outX), KFTypeScaleY: keys(inY, outY) };
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
