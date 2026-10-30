#!/usr/bin/env node
// lafincat harness CLI:
//   node src/cli.js build <episode.yaml> [--preview [out.mp4]] [--capcut] [--replace] [--base <draft>] [--draft <name>] [--height 360]
//   node src/cli.js voice-clean <in.wav> <out.wav>
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const [cmd, ...rest] = process.argv.slice(2);
const flag = (name, def) => { const i = rest.indexOf(`--${name}`); if (i < 0) return def; const v = rest[i + 1]; return v && !v.startsWith('--') ? v : true; };

// phone-mic voice chain: rumble cut, denoise, gentle compression, loudness for voice under music
// dead air: pauses longer than 0.8 s shrink to 0.4 s; shorter, deliberate pauses stay. --keep-pauses turns it off
export const TRIM_PAUSES = 'silenceremove=start_periods=1:start_threshold=-45dB:stop_periods=-1:stop_duration=0.8:stop_threshold=-45dB:stop_silence=0.4';
export const VOICE_FILTER = 'highpass=f=80,afftdn=nf=-25,acompressor=threshold=-20dB:ratio=3:attack=5:release=120,loudnorm=I=-16:TP=-1.5:LRA=11';

async function main() {
  if (cmd === 'build') {
    const { loadSpec, resolveSpec } = await import('./spec.js');
    const specPath = path.resolve(rest[0] || 'episode.yaml');
    const spec = loadSpec(specPath);
    const tl = resolveSpec(spec);
    const tlPath = path.join(path.dirname(specPath), 'timeline.json');
    fs.writeFileSync(tlPath, JSON.stringify(tl, null, 2));
    const out = { timeline: tlPath, durationSec: tl.durationSec, lines: tl.lines.length };
    const pv = flag('preview');
    if (pv) {
      const { renderPreview } = await import('./preview.js');
      const file = path.resolve(pv === true ? path.join(path.dirname(specPath), 'render', 'preview.mp4') : pv);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      out.preview = renderPreview(tl, file, { height: +flag('height', 360) }).out;
    }
    if (flag('capcut')) {
      const { compileToCapcut } = await import('./compile.js');
      out.capcut = compileToCapcut(tl, { draft: flag('draft', spec.draft?.name || spec.episode), base: flag('base', spec.draft?.base),
        replace: !!flag('replace'), force: !!flag('force') });
    }
    console.log(JSON.stringify(out, null, 2));
  } else if (cmd === 'voice-clean') {
    const [inp, outp] = rest;
    if (!inp || !outp) throw new Error('usage: voice-clean <in> <out>');
    const af = flag('keep-pauses') ? VOICE_FILTER : VOICE_FILTER.replace('acompressor', `${TRIM_PAUSES},acompressor`);
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', inp, '-af', af, '-ar', '48000', '-ac', '1', outp], { stdio: 'inherit' });
    console.log(JSON.stringify({ out: path.resolve(outp) }));
  } else {
    console.error('commands: build <episode.yaml> [--preview [out]] [--capcut] [--replace] [--base draft] [--draft name] | voice-clean <in> <out> [--keep-pauses]');
    process.exit(2);
  }
}
main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
