// Contrato do service worker: o pre-cache declarado em sw.js tem de bater com o disco.
// sw.js:1 manda "ao adicionar arquivos nas próximas etapas: inclua-os em FILES e incremente V" — política
// manual, hoje sem nenhuma guarda automatizada (auditoria §3.4 item 8 e §9). Este arquivo fecha isso.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname;
const SW = readFileSync(join(ROOT, 'sw.js'), 'utf8');

const extrairV = () => /const V='([^']+)'/.exec(SW)?.[1];
const extrairFILES = () => {
  const bruto = /const V='[^']+',FILES=(\[[^\]]*\])/.exec(SW)?.[1];
  assert.ok(bruto, 'não foi possível extrair FILES de sw.js — o formato da linha 2 mudou');
  return JSON.parse(bruto.replace(/'/g, '"')).map(norm);
};
const norm = (f) => f.replace(/^\.\//, '');
const V = extrairV();
const FILES = extrairFILES();

// todos os .js reais de src/ (recursivo), na forma como sw.js os referencia
function moduloDe(dir, out = []) {
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) moduloDe(p, out);
    else if (nome.endsWith('.js')) out.push(p.slice(ROOT.length).split('\\').join('/'));
  }
  return out;
}
const MODULOS_SRC = moduloDe(join(ROOT, 'src'));

describe('sw.js: contrato do pre-cache', () => {
  it('V existe e segue o formato sc-v<numero>', () => {
    assert.equal(typeof V, 'string');
    assert.match(V, /^sc-v\d+$/);
    assert.ok(Number(V.slice(4)) >= 1, 'V é manual: ao mudar FILES, incremente o número (sw.js:1)');
  });

  it('FILES não tem entradas duplicadas nem vazias', () => {
    assert.ok(FILES.length > 40, `esperava dezenas de recursos, vieram ${FILES.length}`);
    assert.deepEqual(FILES.filter((f, i) => FILES.indexOf(f) !== i), []);
    assert.ok(FILES.every((f) => typeof f === 'string'));
    assert.equal(FILES.filter((f) => f === '').length, 1, 'a entrada de raiz do shell é única');
  });

  for (const arquivo of FILES) {
    it(`recurso pre-cached existe no disco: ${arquivo || './ (raiz)'}`, () => {
      assert.ok(arquivo === '' || existsSync(join(ROOT, arquivo)), `falta ${arquivo} — o addAll de sw.js:3 falharia em cadeia`);
    });
  }

  it('nenhum módulo de src/ ficou de fora do pre-cache', () => {
    const ausentes = MODULOS_SRC.filter((m) => !FILES.includes(m));
    assert.deepEqual(ausentes, [], 'adicione ao FILES de sw.js e incremente V');
  });

  it('os arquivos essenciais do shell estão listados', () => {
    for (const essencial of ['', 'index.html', 'manifest.json', 'css/app.css', 'css/ui.css', 'src/main.js', 'vendor/fflate.min.js']) {
      assert.ok(FILES.includes(essencial), `essencial ausente: ${essencial}`);
    }
  });

  it('o vendor usado pelo backup existe no caminho relativo declarado em src/export/lib.js:4', () => {
    const src = readFileSync(join(ROOT, 'src/export/lib.js'), 'utf8');
    const caminho = /load\('([^']+)','fflate'\)/.exec(src)?.[1];
    assert.equal(caminho, 'vendor/fflate.min.js');
    assert.ok(existsSync(join(ROOT, caminho)), 'sem fallback de carregamento (R-07), o caminho tem de existir');
  });

  it('conhecido: api/*.js (serverless) NÃO entra no pre-cache, e sw.js também não', () => {
    // ver docs/ROADMAP.md — é o comportamento correto (o handler roda na Vercel e o sw.js é buscado à parte
    // pelo browser), mas está explicitado aqui para que uma "faxina" de coverage não os adicione por engano.
    assert.equal(FILES.some((f) => f.startsWith('api/')), false);
    assert.equal(FILES.includes('sw.js'), false);
  });

  it('conhecido: nada verifica que V foi INCREMENTADO quando FILES mudou', () => {
    // ver docs/ROADMAP.md — só o diff com a base do PR pegaria isso (sugestão §7.3 item 5 do auditor).
    // Sem git, a asserção possível é estrutural: V é literal e FILES é literal na mesma linha.
    assert.match(SW, /const V='sc-v\d+',FILES=\[/);
  });
});
