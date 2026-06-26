import assert from 'node:assert';
import { gridGafetes, urlVerificacion } from './gafetes-layout.mjs';

// Letter (portrait) con tarjetas CR80: deben caber 2 columnas × 4 filas = 8.
const LETTER = { pagW: 215.9, pagH: 279.4 };
const CR80   = { cardW: 85.6, cardH: 54 };
const g = gridGafetes({ ...LETTER, ...CR80, margen: 12, gap: 8 });
assert.strictEqual(g.cols, 2, 'CR80 en Letter → 2 columnas');
assert.strictEqual(g.rows, 4, 'CR80 en Letter → 4 filas');
assert.strictEqual(g.porPagina, 8);
assert.strictEqual(g.posiciones.length, 8);

// La primera tarjeta respeta el margen; ninguna se sale de la hoja.
assert.deepStrictEqual(g.posiciones[0], { x: 12, y: 12 });
for (const p of g.posiciones) {
  assert.ok(p.x >= 12 && p.x + CR80.cardW <= LETTER.pagW - 12 + 0.001, `x dentro: ${p.x}`);
  assert.ok(p.y >= 12 && p.y + CR80.cardH <= LETTER.pagH - 12 + 0.001, `y dentro: ${p.y}`);
}

// Hoja diminuta: nunca menos de 1×1 (no dividir por cero ni grilla vacía).
const chico = gridGafetes({ pagW: 50, pagH: 50, cardW: 85.6, cardH: 54 });
assert.strictEqual(chico.porPagina, 1);

// URL de verificación en ambos hosts.
assert.strictEqual(
  urlVerificacion('https://nicolasneg.github.io', '/ChecadorGLOBAL', 'abc'),
  'https://nicolasneg.github.io/ChecadorGLOBAL/verificar/?c=abc');
assert.strictEqual(
  urlVerificacion('https://eqs.vercel.app', '', 'xyz'),
  'https://eqs.vercel.app/verificar/?c=xyz');

console.log('gafetes-layout: OK');
