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

  // reaction meme (rule 35): pop in, keep moving while shown (slow stretch to ~110% with a little more height,
  // drift toward the centre and up, a slight tilt), then squash out from where it got to
  meme(it, D) {
    const s = it.scale, a = Math.min(0.35, D * 0.3), b = Math.min(0.25, D * 0.25), o = D - b;
    const inX = [[0, 0.2], [0.35, 1.18], [0.65, 0.93], [1, 1]];
    const inY = [[0, 0.2], [0.35, 1.25], [0.65, 0.9], [1, 1]];
    const endX = 1.08, endY = 1.12;
    const sx = [...inX.map(([f, v]) => [f * a, s * v]), [o, s * endX], [o + b * 0.4, s * endX * 1.12], [D, 0]];
    const sy = [...inY.map(([f, v]) => [f * a, s * v]), [o, s * endY], [o + b * 0.4, s * endY * 0.88], [D, 0]];
    const dx = it.posX > 0.05 ? -0.04 : it.posX < -0.05 ? 0.04 : 0.03;
    const tilt = it.posX < 0 ? 1 : -1;
    return {
      KFTypeScaleX: sx, KFTypeScaleY: sy,
      KFTypePositionX: [[0, it.posX], [D, it.posX + dx]],
      KFTypePositionY: [[0, it.posY], [D, it.posY + 0.03]],
      KFTypeRotation: [[0, 4 * tilt], [a, -1 * tilt], [D, 2 * tilt]],
    };
  },
  // full-frame meme or still: never frozen; scale breathes 103-109% (no edges show) with a slow sideways drift
  breathe(it, D) {
    const s = it.scale, keys = [], xs = [];
    const n = Math.max(2, Math.ceil(D / 0.5));
    for (let i = 0; i <= n; i++) {
      const t = (D * i) / n;
      keys.push([t, s * (1.06 + 0.03 * Math.sin((2 * Math.PI * t) / 2.4))]);
    }
    xs.push([0, it.posX - 0.015], [D, it.posX + 0.015]);
    return { KFTypeScaleX: keys, KFTypePositionX: xs };
  },
  // slow move toward the centre and up (pair it with push/pull or pop on stills and stickers)
  drift(it, D) {
    const dx = it.posX > 0.05 ? -0.05 : it.posX < -0.05 ? 0.05 : 0.04;
    return { KFTypePositionX: [[0, it.posX], [D, it.posX + dx]], KFTypePositionY: [[0, it.posY], [D, it.posY + 0.03]] };
  },
  // gentle rotation back and forth, ±2.5°
  sway(it, D) {
    const keys = [], n = Math.max(2, Math.ceil(D / 0.6));
    for (let i = 0; i <= n; i++) { const t = (D * i) / n; keys.push([t, 2.5 * Math.sin((2 * Math.PI * t) / 2.4)]); }
    return { KFTypeRotation: keys };
  },
  // kinetic text (rule 36 text mode): slams in big and tilted, settles, keeps growing slowly, then flies out
  // (grows and fades in the last 0.2 s)
  kinetic(it, D) {
    const s = it.scale, a = Math.min(0.3, D * 0.25), b = Math.min(0.2, D * 0.2), o = D - b;
    return {
      KFTypeScaleX: [[0, s * 2.2], [a * 0.6, s * 0.92], [a, s], [o, s * 1.1], [D, s * 1.5]],
      KFTypeAlpha: [[0, 0], [a * 0.4, 1], [o, 1], [D, 0]],
      KFTypeRotation: [[0, -6], [a, 0], [o, 1.5], [D, 4]],
    };
  },

  // ---- text in/out (owner 2026-11-13: motion only in and out, a calm readable hold in between; vary them).
  // Combine one `tin_*` with one `tout_*` ("tin_rise+tout_fade"); each writes keys only inside its window.
  tin_pop(it, D) { const a = Math.min(0.3, D * 0.5), s = it.scale;
    return { KFTypeScaleX: [[0, s * 0.4], [a * 0.6, s * 1.08], [a, s]], KFTypeAlpha: [[0, 0], [a * 0.4, 1]] }; },
  tin_rise(it, D) { const a = Math.min(0.3, D * 0.5);
    return { KFTypePositionY: [[0, it.posY - 0.08], [a, it.posY]], KFTypeAlpha: [[0, 0], [a, 1]] }; },
  tin_drop(it, D) { const a = Math.min(0.3, D * 0.5);
    return { KFTypePositionY: [[0, it.posY + 0.1], [a * 0.7, it.posY - 0.01], [a, it.posY]], KFTypeAlpha: [[0, 0], [a * 0.4, 1]] }; },
  tin_slide(it, D) { const a = Math.min(0.3, D * 0.5);
    return { KFTypePositionX: [[0, it.posX - 0.15], [a, it.posX]], KFTypeAlpha: [[0, 0], [a, 1]] }; },
  tin_zoom(it, D) { const a = Math.min(0.3, D * 0.5), s = it.scale;
    return { KFTypeScaleX: [[0, s * 1.6], [a, s]], KFTypeAlpha: [[0, 0], [a, 1]] }; },
  tout_fade(it, D) { const b = Math.min(0.25, D * 0.4), s = it.scale;
    return { KFTypeAlpha: [[D - b, 1], [D, 0]], KFTypeScaleX: [[D - b, s], [D, s * 1.08]] }; },
  tout_up(it, D) { const b = Math.min(0.25, D * 0.4);
    return { KFTypePositionY: [[D - b, it.posY], [D, it.posY + 0.08]], KFTypeAlpha: [[D - b, 1], [D, 0]] }; },
  tout_shrink(it, D) { const b = Math.min(0.25, D * 0.4), s = it.scale;
    return { KFTypeScaleX: [[D - b, s], [D, s * 0.5]], KFTypeAlpha: [[D - b, 1], [D, 0]] }; },
};

/// "pop", "push+shake", ... -> merged keyframe lists in microseconds, or null.
export function motionKeyframes(item) {
  if (!item.anim) return null;
  const D = item.durSec, out = {};
  for (const name of String(item.anim).split('+')) {
    const p = presets[name.trim()];
    if (!p) throw new Error(`unknown anim: ${name} (${Object.keys(presets).join(', ')})`);
    for (const [type, keys] of Object.entries(p(item, D)))
      out[type] = [...(out[type] || []), ...keys.filter(([t]) => t <= D + 1e-6)];
  }
  for (const k of Object.keys(out)) out[k] = out[k].map(([t, v]) => [t * US, +v.toFixed(4)]);
  return out;
}

export const motionNames = Object.keys(presets);
