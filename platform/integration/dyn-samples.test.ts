import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeDyn } from '../dyn-decoder.ts';
import { resolve } from 'node:path';
for (const [file, type, count] of [['earth-sun-orb-def.dyn', 'orb', 429], ['earth-ori-def.dyn', 'ori', 3]] as const) {
  test(`fixed real ${type} sample fields and coverage`, () => {
    const path = process.env.SPACEEYES_SAMPLES ? resolve(process.env.SPACEEYES_SAMPLES, file) : new URL(`../../validation/.cache/${file}`, import.meta.url);
    const result = decodeDyn(readFileSync(path));
    assert.equal(result.type, type); assert.equal(result.kind, 'inline');
    assert.deepEqual(result.coverage, { start: -3155716758.816, end: 3155716869.184 });
    if (result.kind !== 'inline') throw Error('inline'); assert.equal(result.records.length, count);
    if (result.type === 'orb') { assert.equal(result.gravitationalParameter1, 398600.4355070226); assert.equal(result.records[0].semiMajorAxis, 149739000.8915808); }
    else assert.equal(result.records[0].orientation[0], 0.6323292458066715);
  });
}
