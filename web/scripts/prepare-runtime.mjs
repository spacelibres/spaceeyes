import { copyFile, mkdir } from 'node:fs/promises';
const output = new URL('../public/wasm/', import.meta.url);
await mkdir(output, { recursive: true });
for (const file of ['spaceeyes_core.js', 'spaceeyes_core_bg.wasm']) {
  await copyFile(new URL(`../../core/pkg-web/${file}`, import.meta.url), new URL(file, output));
}
console.log('Prepared renderer WASM runtime; planetary textures use the controlled resource route.');
