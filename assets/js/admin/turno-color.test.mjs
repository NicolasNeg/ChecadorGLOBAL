import assert from 'node:assert';
import { colorDeTurno, contraste, PALETA } from './turno-color.mjs';

// Color explícito manda.
assert.strictEqual(colorDeTurno({ id: 1, color: '#FF0000' }), '#FF0000');
// Sin color → cae a la paleta por id, de forma estable.
const c = colorDeTurno({ id: 7 });
assert.ok(PALETA.includes(c), 'fallback debe venir de la paleta');
assert.strictEqual(colorDeTurno({ id: 7 }), colorDeTurno({ id: 7 }), 'estable por id');
// Contraste: fondo claro → texto oscuro; fondo oscuro → texto claro.
assert.strictEqual(contraste('#FFFFFF'), '#111111');
assert.strictEqual(contraste('#000000'), '#ffffff');
assert.strictEqual(contraste('#1E40AF'), '#ffffff'); // azul oscuro → blanco

console.log('turno-color OK');
