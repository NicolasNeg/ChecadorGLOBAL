import assert from 'node:assert';
import { modeloASvg, avisoVigente, plantilla, elementoNuevo, LIENZO_W, LIENZO_H } from './aviso-modelo.mjs';

// modeloASvg: SVG válido con el viewBox del lienzo y el fondo.
const svg = modeloASvg({ fondo: '#abcdef', elementos: [elementoNuevo('texto', { x: 10, y: 20, texto: 'Hola' })] });
assert.ok(svg.startsWith('<svg'), 'arranca con <svg');
assert.ok(svg.includes(`viewBox="0 0 ${LIENZO_W} ${LIENZO_H}"`), 'viewBox del lienzo');
assert.ok(svg.includes('fill="#abcdef"'), 'pinta el fondo');
assert.ok(svg.includes('Hola'), 'incluye el texto');

// Escapa caracteres peligrosos en el texto (no rompe el SVG ni inyecta nodos).
const malicioso = modeloASvg({ elementos: [elementoNuevo('texto', { texto: '<script>"&' })] });
assert.ok(!malicioso.includes('<script>'), 'escapa < >');
assert.ok(malicioso.includes('&lt;') && malicioso.includes('&amp;') && malicioso.includes('&quot;'), 'entidades');

// Posiciona el elemento en su x/y.
const pos = modeloASvg({ elementos: [elementoNuevo('forma', { x: 33, y: 44, w: 100, h: 50 })] });
assert.ok(pos.includes('x="33"') && pos.includes('y="44"'), 'forma en su x/y');

// avisoVigente: rango de fechas.
assert.strictEqual(avisoVigente({ activo: true }, '2026-06-26'), true, 'sin fechas → vigente');
assert.strictEqual(avisoVigente({ activo: false }, '2026-06-26'), false, 'inactivo → no');
assert.strictEqual(avisoVigente({ activo: true, inicia_en: '2026-07-01' }, '2026-06-26'), false, 'antes de inicio → no');
assert.strictEqual(avisoVigente({ activo: true, termina_en: '2026-06-20' }, '2026-06-26'), false, 'después de fin → no');
assert.strictEqual(avisoVigente({ activo: true, inicia_en: '2026-06-01', termina_en: '2026-06-30' }, '2026-06-26'), true, 'dentro → vigente');

// plantillas: devuelven elementos.
for (const n of ['urgente', 'evento', 'informativo']) {
  const p = plantilla(n);
  assert.ok(Array.isArray(p.elementos) && p.elementos.length >= 3, `${n} tiene elementos`);
  assert.ok(p.elementos.every((e) => e.id), `${n}: cada elemento con id`);
}

console.log('aviso-modelo: OK');
