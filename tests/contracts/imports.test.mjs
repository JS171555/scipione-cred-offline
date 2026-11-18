// Contrato de importação: o app não tem build, então TODO especificador relativo de src/**, api/** e sw.js
// precisa resolver para um arquivo que existe, com extensão, ou o navegador quebra em runtime (e nenhum
// teste de unidade teria culpa). Cobertura de rede zero: só lê disco.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname;

function arquivos(dir, filtro, out = []) {
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) arquivos(p, filtro, out);
    else if (filtro(p)) out.push(p);
  }
  return out;
}
const ALVOS = [
  ...arquivos(join(ROOT, 'src'), (p) => p.endsWith('.js')),
  ...arquivos(join(ROOT, 'api'), (p) => p.endsWith('.js')),
  join(ROOT, 'sw.js'),
].sort();

// from '...' | import '...' | import('...')  (inclusive o formato sem espaço `import*as x from'./y.js'`)
const RE_IMPORT = /(?:\bfrom|\bimport)\s*\(?\s*['"]([^'"]+)['"]/g;

describe('contrato de imports relativos', () => {
  it('há arquivos suficientes no grafo para o teste não ser vazio', () => {
    assert.ok(ALVOS.length >= 39, `esperava >= 39 arquivos (37 src + api + sw.js), vieram ${ALVOS.length}`);
  });

  for (const arquivo of ALVOS) {
    const relativo = './' + arquivo.slice(ROOT.length).split('\\').join('/');
    it(`todos os imports de ${relativo} resolvem`, () => {
      const codigo = readFileSync(arquivo, 'utf8');
      const encontrados = [...codigo.matchAll(RE_IMPORT)].map((m) => m[1]);
      const relativos = encontrados.filter((e) => e.startsWith('.') || e.startsWith('/'));
      for (const esp of relativos) {
        assert.match(esp, /\.js$/, `${relativo}: import "${esp}" sem .js quebraria sem build`);
        const alvo = esp.startsWith('/') ? join(ROOT, esp) : resolve(dirname(arquivo), esp);
        assert.ok(existsSync(alvo), `${relativo}: "${esp}" não existe (${alvo})`);
      }
    });
  }

  it('nenhum import de terceiro (bare specifier) entrou em src/, api/ ou sw.js', () => {
    const nus = [];
    for (const arquivo of ALVOS) {
      const codigo = readFileSync(arquivo, 'utf8');
      for (const m of codigo.matchAll(RE_IMPORT)) {
        const e = m[1];
        if (!e.startsWith('.') && !e.startsWith('/') && !e.startsWith('node:')) nus.push(`${arquivo.slice(ROOT.length)} -> ${e}`);
      }
    }
    assert.deepEqual(nus, [], 'o repo é deliberadamente sem dependências (README:157; auditoria §1.1)');
  });

  it('o único import dinâmico de src/ é tolerável e aponta para um arquivo do repo', () => {
    const dinamicos = [];
    for (const arquivo of ALVOS) {
      const codigo = readFileSync(arquivo, 'utf8');
      for (const m of codigo.matchAll(/\bimport\(\s*['"]([^'"]+)['"]/g)) dinamicos.push([arquivo.slice(ROOT.length), m[1]]);
    }
    for (const [de, esp] of dinamicos) {
      const alvo = resolve(dirname(join(ROOT, de)), esp);
      assert.ok(existsSync(alvo), `import dinâmico de ${de} quebra: ${esp}`);
    }
  });

  it('helpers de teste também respeitam o contrato (sem specifiers nus)', () => {
    const helpers = arquivos(join(ROOT, 'tests', 'helpers'), (p) => p.endsWith('.mjs'));
    assert.equal(helpers.length, 5, `esperava os 5 helpers do contrato, vieram ${helpers.length}`);
    for (const arquivo of helpers) {
      for (const m of readFileSync(arquivo, 'utf8').matchAll(RE_IMPORT)) {
        const e = m[1];
        assert.ok(e.startsWith('.') || e.startsWith('node:'), `${arquivo.slice(ROOT.length)}: import proibido "${e}"`);
        if (e.startsWith('.')) {
          const alvo = resolve(dirname(arquivo), e);
          assert.match(e, /\.mjs$|\.js$/, `${arquivo.slice(ROOT.length)}: "${e}" precisa de extensão`);
          assert.ok(existsSync(alvo), `${arquivo.slice(ROOT.length)}: "${e}" não existe`);
        }
      }
    }
  });
});
