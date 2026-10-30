import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
// The label font is a server resource, never a payload inside the executable.
const fontSource = new URL('../resources/fonts/FiraMono-subset.ttf', import.meta.url);
const font = await readFile(fontSource);
if (font.length !== 18848 || createHash('sha256').update(font).digest('hex') !== '45131c5e913a5c7b4311101303e3c320a97b93a27a64b7262b533ee0d31ae03c') throw new Error('External label font does not match the pinned asset.');
const wasm = await readFile(new URL('../../core/pkg-web/spaceeyes_core_bg.wasm', import.meta.url));
if (wasm.indexOf(font) !== -1) throw new Error('Embedded label font found in WASM; disable Bevy default_font.');
const fonts = new URL('../public/assets/fonts/', import.meta.url);
const shaders = new URL('../public/assets/shaders/', import.meta.url);
await mkdir(shaders, { recursive: true });
await copyFile(new URL('../resources/shaders/ring-particles.wgsl', import.meta.url), new URL('ring-particles.wgsl', shaders));
await mkdir(fonts, { recursive: true });
await copyFile(fontSource, new URL('FiraMono-subset.ttf', fonts));
const output = new URL('../public/wasm/', import.meta.url);
await mkdir(output, { recursive: true });
for (const file of ['spaceeyes_core.js', 'spaceeyes_core_bg.wasm']) {
  await copyFile(new URL(`../../core/pkg-web/${file}`, import.meta.url), new URL(file, output));
}
console.log('Prepared renderer WASM runtime; external font verified absent from WASM, surfaces load on selection.');
