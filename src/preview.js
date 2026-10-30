import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawnSync } from 'child_process';

const WIN32 = process.platform === 'win32';

// a straight quote can't live inside drawtext's quoted text: the preview shows a typographic one
function escapeDrawtext(str) {
  return String(str).replace(/'/g, '’').replace(/[\\:%,]/g, c => '\\' + c);
}

function roundEven(n) {
  return Math.round(n / 2) * 2;
}

function hasAudioStream(file) {
  try {
    const out = spawnSync('ffprobe', [
      '-v', 'error',
      '-select_streams', 'a',
      '-show_entries', 'stream=index',
      '-of', 'csv=p=0',
      file
    ], { encoding: 'utf8' });
    return out.stdout.trim().length > 0;
  } catch {
    return false;
  }
}

function buildFilterGraph(timeline, W, H, fps, durationSec, fontFile) {
  const { tracks } = timeline;
  let filterParts = [];
  let inputIndex = 0;
  const baseLabel = 'base';
  filterParts.push(`color=c=black:s=${W}x${H}:r=${fps}:d=${durationSec}[${baseLabel}]`);
  let lastVideoLabel = baseLabel;

  const videoInputs = [];
  const audioInputs = [];
  let audioInputCount = 0, textCount = 0;

  for (let ti = 0; ti < tracks.length; ti++) {
    const track = tracks[ti];
    if (track.type === 'audio') {
      for (const item of track.items) {
        if (item.kind !== 'audio' || !item.file) continue;
        const idx = inputIndex++;
        videoInputs.push({ index: idx, item, isAudioOnly: true, inputArgs: ['-ss', String(item.srcSec || 0), '-t', String(item.durSec), '-i', item.file] });
        const aLabel = `a${audioInputCount++}`;
        filterParts.push(`[${idx}:a]atrim=0:${item.durSec},asetpts=PTS-STARTPTS,volume=${item.volume || 1},adelay=${Math.round((item.atSec || 0) * 1000)}|${Math.round((item.atSec || 0) * 1000)}[${aLabel}]`);
        audioInputs.push(aLabel);
      }
      continue;
    }

    for (const item of track.items) {
      if (item.kind === 'text') {
        const fs_ = (item.fontSize || 12) * H / 270;
        const color = item.color || '#ffffff';
        const posX = item.posX || 0;
        const posY = item.posY || 0;
        const x = `(${W}/2)+${posX}*${W}/2-text_w/2`;
        const y = `(${H}/2)-(${posY})*${H}/2-text_h/2`;
        const text = escapeDrawtext(item.text || '');
        const fontOpt = fontFile ? `:fontfile='${fontFile.replace(/\\/g, '\\\\').replace(/:/g, '\\:')}'` : '';
        const tLabel = `t${textCount++}`;
        const enable = `enable='between(t,${item.atSec},${item.atSec + item.durSec})'`;
        filterParts.push(`[${lastVideoLabel}]drawtext=text='${text}':fontsize=${fs_}:fontcolor=${color}:bordercolor=black:borderw=2:x=${x}:y=${y}:${enable}${fontOpt}[${tLabel}]`);
        lastVideoLabel = tLabel;
      } else if (item.kind === 'video' || item.kind === 'image') {
        if (!item.file) continue;
        const isVideo = item.kind === 'video';
        const idx = inputIndex++;
        const srcSec = item.srcSec || 0;
        const durSec = item.durSec;
        const atSec = item.atSec || 0;
        const scale = item.scale || 1;
        const opacity = item.opacity != null ? item.opacity : 1;
        const posX = item.posX || 0;
        const posY = item.posY || 0;

        let inputArgs = [];
        if (isVideo) {
          inputArgs = ['-ss', String(srcSec), '-t', String(durSec), '-i', item.file];
        } else {
          inputArgs = ['-loop', '1', '-t', String(durSec), '-i', item.file];
        }
        videoInputs.push({ index: idx, item, inputArgs, isVideo });

        const vLabel = `v${idx}`;
        const scaledLabel = `s${idx}`;
        const overlayLabel = `o${idx}`;

        let vf = `[${idx}:v]setpts=PTS-STARTPTS+${atSec}/TB`;
        vf += `,scale=${W}:${H}:force_original_aspect_ratio=decrease`;
        if (scale !== 1) {
          vf += `,scale=iw*${scale}:ih*${scale}`;
        }
        vf += `,format=rgba`;
        if (opacity < 1) {
          vf += `,colorchannelmixer=aa=${opacity}`;
        }
        vf += `,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black@0`;
        vf += `[${scaledLabel}]`;
        filterParts.push(vf);

        const cx = `(${W}/2)+${posX}*${W}/2`;
        const cy = `(${H}/2)-${posY}*${H}/2`;
        const enable = `enable='between(t,${atSec},${atSec + durSec})'`;
        filterParts.push(`[${lastVideoLabel}][${scaledLabel}]overlay=x=${cx}-W/2:y=${cy}-H/2:${enable}:eof_action=pass[${overlayLabel}]`);
        lastVideoLabel = overlayLabel;

        if (isVideo && (item.volume || 0) > 0 && hasAudioStream(item.file)) {
          const aLabel = `a${audioInputCount++}`;
          filterParts.push(`[${idx}:a]atrim=0:${durSec},asetpts=PTS-STARTPTS,volume=${item.volume || 1},adelay=${Math.round(atSec * 1000)}|${Math.round(atSec * 1000)}[${aLabel}]`);
          audioInputs.push(aLabel);
        }
      }
    }
  }

  let finalVideoLabel = lastVideoLabel;
  let finalAudioLabel = 'final_audio';

  if (audioInputs.length > 0) {
    filterParts.push(`${audioInputs.map(l => `[${l}]`).join('')}amix=inputs=${audioInputs.length}:normalize=0:duration=longest,apad[${finalAudioLabel}]`);
  } else {
    filterParts.push(`anullsrc=r=48000:cl=stereo,atrim=0:${durationSec}[${finalAudioLabel}]`);
  }

  return { filterParts, videoInputs, finalVideoLabel, finalAudioLabel };
}

export function buildPreviewArgs(timeline, outPath, opts = {}) {
  const { canvas, durationSec, tracks } = timeline;
  const H = opts.height || 360;
  const W = roundEven(H * canvas.w / canvas.h);
  const fps = canvas.fps || 30;
  const fontFile = opts.fontFile || (WIN32 ? 'C:/Windows/Fonts/arial.ttf' : null);

  const { filterParts, videoInputs, finalVideoLabel, finalAudioLabel } = buildFilterGraph(timeline, W, H, fps, durationSec, fontFile);

  const args = ['-y'];
  for (const vi of videoInputs) {
    if (vi.inputArgs) {
      args.push(...vi.inputArgs);
    } else {
      args.push('-i', vi.item.file);
    }
  }
  const filterGraph = filterParts.join(';\n');
  // graph from a file: a long edit would overflow the Windows command line (ffmpeg 7+: -/option reads its value from a file)
  const graphFile = path.join(os.tmpdir(), `capcut-preview-${process.pid}-${Date.now()}.txt`);
  fs.writeFileSync(graphFile, filterGraph);
  args.push('-/filter_complex', graphFile);
  args.push('-map', `[${finalVideoLabel}]`, '-map', `[${finalAudioLabel}]`);
  args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30', '-pix_fmt', 'yuv420p');
  args.push('-c:a', 'aac', '-b:a', '96k');
  args.push('-t', String(durationSec), outPath);
  return { args, filterGraph, graphFile };
}

export function renderPreview(timeline, outPath, opts = {}) {
  const { args, graphFile } = buildPreviewArgs(timeline, outPath, opts);
  const res = spawnSync('ffmpeg', ['-v', 'error', ...args], { stdio: ['ignore', 'ignore', 'inherit'] });
  fs.rmSync(graphFile, { force: true });
  if (res.status !== 0) {
    throw new Error(`ffmpeg exited with code ${res.status}`);
  }
  return { out: outPath, durationSec: timeline.durationSec };
}