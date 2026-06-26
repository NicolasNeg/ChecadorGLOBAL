// Comprueba que la normalización del token en cliente coincide con la del RPC.
// El cliente manda el token sin guiones; verificar_token_plaza (SQL) compara con
// regexp_replace(upper(x), '[^A-Z0-9]', '', 'g'). Si divergen, un token válido
// tecleado "ABCD-EFGH" o "abcdefgh" fallaría. Espejo de ambas reglas + assert.
import assert from 'node:assert';

// igual que en app.js (lo que se envía) y en plazas.js (fmtToken display)
const stripCliente = (raw) => raw.replace(/[^A-Za-z0-9]/g, '');
const normSQL      = (x) => x.toUpperCase().replace(/[^A-Z0-9]/g, ''); // espejo del regexp_replace + upper

const guardado = 'ABCD2FGH'; // como lo guarda el admin (sin guion, mayúsculas)
for (const tecleado of ['ABCD2FGH', 'ABCD-2FGH', 'abcd2fgh', '  abcd-2fgh  ', 'ABCD 2FGH']) {
  assert.strictEqual(normSQL(stripCliente(tecleado)), normSQL(guardado),
    `"${tecleado}" debería igualar al token guardado`);
}
// un token distinto NO debe coincidir
assert.notStrictEqual(normSQL(stripCliente('ZZZZ9999')), normSQL(guardado));

console.log('token: OK');
