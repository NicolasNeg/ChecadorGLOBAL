import assert from 'node:assert';
import { similitud } from './face.js';

const v = [1, 2, 3, 4];
assert.ok(Math.abs(similitud(v, v) - 1) < 1e-9, 'idénticos → 1');
assert.strictEqual(similitud([1, 0], [0, 1]), 0, 'ortogonales → 0');
assert.strictEqual(similitud([1, 2, 3], [1, 2]), 0, 'distinta longitud → 0');
assert.strictEqual(similitud(null, [1]), 0, 'null → 0');
console.log('OK face.similitud');
