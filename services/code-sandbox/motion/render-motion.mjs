#!/usr/bin/env node
// Deterministic motion-design renderer for the Braand code sandbox.
// Renders an HTML composition frame by frame with a virtual clock, so CSS
// animations, the Web Animations API, GSAP/anime.js timelines driven by
// requestAnimationFrame, and canvas/WebGL drawings are captured exactly,
// then encodes them with FFmpeg (H.264, yuv420p, faststart) or as a GIF.
//
// Usage:
//   render-motion --input scene.html --output out.mp4 [--width 1080] [--height 1920]
//                 [--fps 30] [--duration 8] [--audio music.mp3] [--quality high|draft]
//                 [--poster poster.png] [--background #000000]
// Optional page hooks: window.__braandReady (Promise), window.__braandSeek(seconds).
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
// The image installs playwright-core globally; ESM ignores NODE_PATH, so resolve it explicitly.
const require = createRequire(path.join(process.env.NODE_PATH || path.dirname(new URL(import.meta.url).pathname), 'resolver.cjs'));
const {chromium} = require(process.env.BRAAND_PLAYWRIGHT_CORE || 'playwright-core');

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, all) => value.startsWith('--') ? [...pairs, [value.slice(2), all[index + 1] && !all[index + 1].startsWith('--') ? all[index + 1] : 'true']] : pairs, []));
const fail = message => { console.error('render-motion: ' + message); process.exit(2); };
const input = path.resolve(args.input || fail('--input is required'));
const output = path.resolve(args.output || fail('--output is required'));
const width = Number(args.width || 1080), height = Number(args.height || 1920), fps = Number(args.fps || 30), duration = Number(args.duration || 6);
if (!existsSync(input)) fail('input not found: ' + input);
for (const [name, value, min, max] of [['width', width, 64, 3840], ['height', height, 64, 3840], ['fps', fps, 1, 60], ['duration', duration, 0.2, 180]]) if (!Number.isFinite(value) || value < min || value > max) fail(`${name} must be between ${min} and ${max}`);
if (width % 2 || height % 2) fail('width and height must be even numbers for H.264');
const frames = Math.round(duration * fps), gif = output.toLowerCase().endsWith('.gif'), draft = args.quality === 'draft';
await mkdir(path.dirname(output), {recursive: true});

const browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none', '--force-color-profile=srgb', '--hide-scrollbars']});
const page = await browser.newPage({viewport: {width, height}, deviceScaleFactor: 1});
// Virtual clock installed before any page script runs.
await page.addInitScript(() => {
  let now = 0; const callbacks = new Map(); let nextId = 1; const start = Date.parse('2026-01-01T00:00:00Z');
  window.requestAnimationFrame = callback => { const id = nextId++; callbacks.set(id, callback); return id; };
  window.cancelAnimationFrame = id => callbacks.delete(id);
  performance.now = () => now;
  const RealDate = Date;
  class VirtualDate extends RealDate { constructor(...values) { super(...(values.length ? values : [start + now])); } static now() { return start + now; } }
  window.Date = VirtualDate;
  window.__braandAdvance = async milliseconds => {
    now = milliseconds;
    for (const animation of document.getAnimations()) { animation.pause(); animation.currentTime = milliseconds; }
    const due = [...callbacks.entries()]; callbacks.clear();
    for (const [, callback] of due) { try { callback(now); } catch (error) { console.error(error); } }
    if (typeof window.__braandSeek === 'function') await window.__braandSeek(milliseconds / 1000);
  };
});
page.on('pageerror', error => console.error('page error: ' + error.message));
await page.goto(pathToFileURL(input).href, {waitUntil: 'load'});
if (args.background) await page.evaluate(color => { document.documentElement.style.background = color; }, args.background);
await page.evaluate(() => document.fonts?.ready);
await page.evaluate(() => window.__braandReady);

const encoderArgs = gif
  ? ['-y', '-f', 'image2pipe', '-framerate', String(fps), '-i', '-', '-vf', `fps=${Math.min(fps, 20)},scale=${Math.min(width, 720)}:-2:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a`, output]
  : ['-y', '-f', 'image2pipe', '-framerate', String(fps), '-i', '-', ...(args.audio ? ['-i', path.resolve(args.audio)] : []), '-c:v', 'libx264', '-preset', draft ? 'veryfast' : 'slow', '-crf', draft ? '26' : '17', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-r', String(fps), ...(args.audio ? ['-c:a', 'aac', '-b:a', '192k', '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11', '-shortest'] : []), output];
const encoder = spawn('ffmpeg', encoderArgs, {stdio: ['pipe', 'ignore', 'pipe']});
let encoderLog = ''; encoder.stderr.on('data', chunk => { encoderLog = (encoderLog + chunk).slice(-4000); });
const finished = new Promise((resolve, reject) => { encoder.on('error', reject); encoder.on('close', code => code === 0 ? resolve() : reject(new Error('ffmpeg exited with ' + code + '\n' + encoderLog))); });

const started = Date.now();
for (let frame = 0; frame < frames; frame++) {
  await page.evaluate(ms => window.__braandAdvance(ms), (frame * 1000) / fps);
  // High quality JPEG frames are visually lossless at CRF 17 and far faster than PNG.
  const image = await page.screenshot({type: 'jpeg', quality: draft ? 82 : 95, animations: 'allow', caret: 'hide'});
  if (!encoder.stdin.write(image)) await new Promise(resolve => encoder.stdin.once('drain', resolve));
  if (args.poster && frame === Math.floor(frames / 3)) await page.screenshot({path: path.resolve(args.poster), type: args.poster.toLowerCase().endsWith('.png') ? 'png' : 'jpeg', animations: 'allow', caret: 'hide'});
  if (frame % Math.max(1, fps) === 0) process.stdout.write(`frame ${frame + 1}/${frames}\n`);
}
encoder.stdin.end();
await finished;
await browser.close();
console.log(JSON.stringify({output, width, height, fps, duration, frames, format: gif ? 'gif' : 'mp4', renderSeconds: Math.round((Date.now() - started) / 100) / 10}));
