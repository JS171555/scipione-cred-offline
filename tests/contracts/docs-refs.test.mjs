// Contrato: cada afirmação da documentação canônica aponta para um arquivo que existe no
// repositório e para uma linha que existe nesse arquivo.
//
// Por que este teste existe: a auditoria produziu sete relatórios de evidência que ficaram
// fora do repo, e os documentos canônicos passaram a citá-los (`audit/6-integracoes-infra.md:586`,
// `/home/ubuntu/audit/deps.py`). Um revisor clicando nisso não encontra nada, e o validador
// ad hoc da época não enxergava o problema porque só reconhecia caminhos com prefixo conhecido.
// A checagem virou grupo próprio em scripts/check-static.mjs e este arquivo garante duas coisas:
// que a árvore de verdade está limpa e que o mecanismo NÃO é vacuoso — ele pega o podre quando
// ele existe, provado contra uma fixture mínima.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = path.join(REPO, 'scripts', 'check-static.mjs');
const run = (root) => {
  const r = spawnSync(process.execPath, [SCRIPT, '--only=docs', '--root=' + root], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout + r.stderr };
};

const withFixture = (files, fn) => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'sc-docs-'));
  try {
    for (const [rel, body] of Object.entries(files)) {
      const abs = path.join(tmp, rel);
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(abs, body);
    }
    return fn(tmp);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
};

const dez = Array.from({ length: 10 }, (_, i) => '// linha ' + i).join('\n') + '\n';

test('a documentação canônica está sem citação pendente nem linha fora da faixa', () => {
  const { code, out } = run(REPO);
  assert.equal(code, 0, 'check-static --only=docs falhou na árvore real:\n' + out);
  assert.match(out, /todas as citações apontam para arquivos versionados/);
  assert.match(out, /nenhuma linha citada fora da faixa do arquivo/);
  assert.match(out, /nenhum caminho absoluto de máquina específica/);
});

test('citação para arquivo que não está no repo é pega', () => {
  withFixture({
    'src/x.js': dez,
    'README.md': 'ver `src/x.js:5` e `audit/relatorio.md:40`\n',
  }, (tmp) => {
    const { code, out } = run(tmp);
    assert.equal(code, 1, 'passou verde com citação podre:\n' + out);
    assert.match(out, /não está no repositório: `audit\/relatorio\.md`/);
    assert.match(out, /README\.md:1/, 'a falha tem de dizer onde está a citação');
  });
});

test('linha citada acima do tamanho do arquivo é pega', () => {
  withFixture({ 'src/x.js': dez, 'docs/GUIA.md': 'como em `src/x.js:99`.\n' }, (tmp) => {
    const { code, out } = run(tmp);
    assert.equal(code, 1, 'passou verde com linha inexistente:\n' + out);
    assert.match(out, /linha citada fora da faixa: src\/x\.js:99 \(tem 11 linhas\)/);
  });
});

test('caminho absoluto de outra máquina é pegado, mas a raiz do projeto não', () => {
  withFixture({
    'src/x.js': dez,
    'docs/GUIA.md': 'rodar `/home/fulano/audit/deps.py` contra `/home/fulano/projeto`.\n',
  }, (tmp) => {
    const { code, out } = run(tmp);
    assert.equal(code, 1);
    assert.match(out, /caminho absoluto de uma máquina específica na documentação: \/home\/fulano\/audit\/deps\.py em docs\/GUIA\.md:1/);
  });
  withFixture({ 'src/x.js': dez, 'docs/GUIA.md': 'a raiz é /home/fulano/projeto e nada mais.\n' }, (tmp) => {
    // O único caminho absoluto tolerado é o da própria raiz do repositório checado.
    const { code, out } = run(tmp);
    assert.equal(code, 1, 'um caminho arbitrário deveria falhar:\n' + out);
    assert.match(out, /caminho absoluto/);
  });
});

test('forma abreviada resolve quando o sufixo é único e reclama quando é ambíguo', () => {
  withFixture({ 'src/ui/shell.js': dez, 'README.md': 'ver `ui/shell.js:3`.\n' }, (tmp) => {
    const { code, out } = run(tmp);
    assert.equal(code, 0, 'sufixo único deveria resolver:\n' + out);
    assert.match(out, /todas as citações apontam para arquivos versionados/);
  });
  withFixture({ 'src/ui/a.js': dez, 'api/ui/a.js': dez, 'README.md': 'ver `ui/a.js:3`.\n' }, (tmp) => {
    const { code, out } = run(tmp);
    assert.equal(code, 0, 'ambiguidade é aviso, não falha:\n' + out);
    assert.match(out, /sufixo ambíguo/);
  });
});

test('docs/auditoria/ é evidência histórica e não tem a checagem de faixa aplicada', () => {
  withFixture({
    'src/x.js': dez,
    'docs/auditoria/1-relatorio.md': 'evidência em `src/x.js:9999` e `foo/bar.js:1`.\n',
    'README.md': 'fonte: `docs/auditoria/1-relatorio.md:1`.\n',
  }, (tmp) => {
    const { code, out } = run(tmp);
    assert.equal(code, 0, 'a trilha histórica congelada não deve ser reescrita a cada mudança:\n' + out);
    assert.match(out, /nenhuma linha citada fora da faixa do arquivo/);
  });
});
