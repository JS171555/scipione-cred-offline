// Contrato de ausência de rede (a correção estrutural do defeito D1 da auditoria §2.7):
//  (a) nenhum arquivo de teste contém URL de terceiro — só origens reservadas ".invalid"/localhost;
//  (b) nenhum teste chama fetch sem antes instalar o mock que NEGA rota desconhecida;
//  (c) o handler de CPF sem variável de ambiente faz 0 chamadas de rede (prova comportamental, não só estática);
//  (d) uma URL sem rota falha LOCAL e IMEDIATAMENTE (o vazamento antigo levava 1,4-5,8 s de DNS/timeout).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const RAIZ_TESTES = new URL('../', import.meta.url).pathname;
const REPO = new URL('../../', import.meta.url).pathname;

function walk(dir, out = []) {
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (nome.endsWith('.mjs')) out.push(p);
  }
  return out;
}
const ARQUIVOS = walk(RAIZ_TESTES).sort();
const RE_URL = /https?:\/\/([A-Za-z0-9.\-]+[A-Za-z0-9])/g;
// O TLD .invalid é reservado (RFC 2606) e nunca resolve: host terminando nele é stub inofensivo.
const PERMITIDAS = /^[A-Za-z0-9.\-]*\.invalid$/;   // + localhost/127.0.0.1 logo abaixo

describe('no-egress: a suíte de testes não fala com o mundo', () => {
  it('existem arquivos de teste suficientes para este contrato significar algo', () => {
    assert.ok(ARQUIVOS.length >= 15, `só ${ARQUIVOS.length} arquivos em tests/`);
  });

  it('nenhum arquivo de teste contém URL fora de origens reservadas (.invalid/localhost)', () => {
    const ofensas = [];
    for (const arquivo of ARQUIVOS) {
      const codigo = readFileSync(arquivo, 'utf8');
      for (const m of codigo.matchAll(RE_URL)) {
        const h = m[1];
        if (!(PERMITIDAS.test(h) || h === 'localhost' || h === '127.0.0.1')) ofensas.push(`${relative(REPO, arquivo)} -> ${h}`);
      }
    }
    assert.deepEqual(ofensas, [], 'URL de terceiro em teste = risco de egress (D1)');
  });

  it('nenhum arquivo de teste usa WebSocket, EventSource, XMLHttpRequest ou sendBeacon', () => {
    const ofensas = [];
    for (const arquivo of ARQUIVOS) {
      // este próprio arquivo lista os padrões proibidos como string: ele é o escâner, não o escaneado
      if (arquivo.endsWith('contracts/no-egress.test.mjs')) continue;
      const codigo = readFileSync(arquivo, 'utf8');
      for (const padrao of ['new WebSocket', 'EventSource', 'XMLHttpRequest', 'sendBeacon', 'node:http', 'node:https', 'node:net', 'node:dns', 'deno.serve']) {
        if (codigo.includes(padrao)) ofensas.push(`${relative(REPO, arquivo)} -> ${padrao}`);
      }
    }
    assert.deepEqual(ofensas, []);
  });

  it('todo teste que toca em fetch usa helpers/fetch-mock.mjs (nunca o fetch nativo)', () => {
    const ofensas = [];
    for (const arquivo of ARQUIVOS) {
      if (arquivo.endsWith('helpers/fetch-mock.mjs')) continue;
      const codigo = readFileSync(arquivo, 'utf8');
      const usaFetch = /globalThis\.fetch|(?<![A-Za-z.])fetch\s*\(/.test(codigo) && !/^/;
      const importaMock = /helpers\/fetch-mock\.mjs/.test(codigo);
      if (usaFetch && !importaMock) ofensas.push(relative(REPO, arquivo));
    }
    assert.deepEqual(ofensas, [], 'instale o mock antes de mexer em fetch (auditoria §6.4)');
  });

  it('helpers/fetch-mock.mjs nega por default e não guarda o fetch nativo para passthrough', () => {
    const codigo = readFileSync(join(RAIZ_TESTES, 'helpers/fetch-mock.mjs'), 'utf8');
    assert.match(codigo, /fallback\s*=\s*'deny'/, 'o default precisa continuar sendo deny');
    assert.match(codigo, /NETWORK_DENIED/, 'rotas não cadastradas têm de lançar localmente');
    assert.equal(/globalThis\.fetch\s*=\s*state\.real/.exec(codigo) && (codigo.split('function uninstallFetchMock')[1] || '').includes('state.real'), true,
      'o fetch nativo só pode voltar em uninstallFetchMock (nunca como passthrough de rota ausente)');
  });

  it('o handler de CPF sem variável de ambiente faz 0 chamadas de rede', async () => {
    const { installFetchMock, fetchCalls, uninstallFetchMock } = await import('../helpers/fetch-mock.mjs');
    const handler = (await import('../../api/cpf.js')).default;
    const env = 'APICPF_API_KEY';
    delete process.env[env];
    installFetchMock({ routes: {} });                    // nenhuma rota: nada pode sair
    const res = { statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k] = v }, end(b) { this.body = b } };
    try {
      await handler({ method: 'GET', url: '/api/cpf?cpf=11144477735' }, res);
      assert.equal(res.statusCode, 503);
      assert.deepEqual(JSON.parse(res.body), { ok: false, reason: 'UNAVAILABLE' });
      assert.equal(fetchCalls().length, 0, 'a guarda de api/cpf.js:20 tem de decidir ANTES de qualquer fetch');
    } finally {
      uninstallFetchMock();
      delete process.env[env];
    }
  });

  it('URL sem rota falha local e imediato (sem DNS): < 1000 ms', async () => {
    // O defeito original custava 1.385-5.821 ms por causa de uma tentativa real de conexão.
    const { installFetchMock, uninstallFetchMock, deniedCalls } = await import('../helpers/fetch-mock.mjs');
    const handler = (await import('../../api/cpf.js')).default;
    installFetchMock({ routes: {} });
    process.env.APICPF_API_KEY = 'chave-ficticia-para-teste';
    const res = { statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k] = v }, end(b) { this.body = b } };
    const t0 = performance.now();
    try {
      await handler({ method: 'GET', url: '/api/cpf?cpf=11144477735' }, res);
      const durou = performance.now() - t0;
      assert.equal(res.statusCode, 503, 'sem rota, o fetch nega -> catch de api/cpf.js:43 -> 503');
      assert.equal(deniedCalls().length, 1, 'a tentativa foi registrada como negada, não executada');
      assert.ok(durou < 1000, `negar uma URL sem rota levou ${durou.toFixed(0)} ms — isso cheira a rede real`);
    } finally {
      uninstallFetchMock();
      delete process.env.APICPF_API_KEY;
    }
  });
});
