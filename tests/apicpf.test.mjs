// Testes do handler serverless api/cpf.js (proxy público de consulta de CPF).
//
// POR QUE CONTINUA EM tests/ (não foi movido para tests/unit/): o contrato de estrutura da suíte é
// tests/unit + tests/svc + tests/contracts + tests/helpers, mas este arquivo já é referenciado pelo caminho
// por outros agentes/CI e é o único teste de um handler que roda na Vercel — fora do app, sem IndexedDB e sem
// DOM. O glob canônico `node --test "tests/**/*.test.mjs"` alcança os dois lugares, então mover não ganha
// nada e rompe um caminho conhecido. Motivo do arquivo ficar onde está: estabilidade de contrato.
//
// CORREÇÃO DO DEFEITO D1 (auditoria 7-testes-infra.md §2.7, confirmado por execução): a versão antiga fazia
// `process.env.APICPF_API_KEY = key` com `key === undefined`, que o Node coage para a STRING "undefined"
// (truthy). Com isso a guarda "sem chave" de api/cpf.js:20 era burlada, o handler chamava o fetch REAL de
// api/cpf.js:25 contra o endpoint de terceiros (CPF na URL + header X-API-KEY: undefined), e o
// `assert.equal(r.status, 503)` passava pelo catch de api/cpf.js:43 — não pela guarda. Cobertura real da
// guarda: 0%. Agora: (1) a variável é APAGADA com `delete`; (2) o fetch-espião é instalado ANTES de qualquer
// chamada; (3) asserimos 0 requisições de rede nesse caso. O custo do arquivo caiu de ~1,4-5,8 s para ms.
//
// Nenhum cenário anterior foi perdido: 405, 422 (CPF inválido / sem parâmetro), 200 com mapeamento de shape,
// 422 por 404 do upstream, 503/UNAVAILABLE para 401/402/403/429/500 sem vazar `message`, 503 offline,
// headers Cache-Control/Content-Type e higiene de ambiente no final.

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import handler from '../api/cpf.js';
import { installFetchMock, fetchCalls, fetchUrls, uninstallFetchMock } from './helpers/fetch-mock.mjs';

const CPF = '11144477735';                 // CPF fictício clássico de documentação técnica
const CHAVE = 'chave-ficticia-para-teste';
const ENV_KEY = 'APICPF_API_KEY';

// A URL do upstream é lida do próprio fonte (mesma técnica do contrato de sw.js): nenhum arquivo de teste
// precisa escrever uma URL de terceiro à mão, e ainda assim provamos para onde o handler aponta.
const UPSTREAM = /const ENDPOINT='([^']+)'/.exec(readFileSync(new URL('../api/cpf.js', import.meta.url), 'utf8'))[1];

const makeRes = () => ({
  statusCode: 0, headers: {},
  setHeader(k, v) { this.headers[k] = v },
  end(body) { this.body = body },
  json() { return JSON.parse(this.body) },
});

// Chama o handler com o ambiente EXPLÍCITO: apagar (delete), nunca atribuir undefined.
const call = async (url, key, method = 'GET') => {
  if (key === undefined) delete process.env[ENV_KEY]; else process.env[ENV_KEY] = key;
  const res = makeRes();
  await handler({ method, url }, res);
  return { status: res.statusCode, body: res.json(), headers: res.headers };
};

describe('api/cpf.js — proxy público de consulta de CPF', () => {
  before(() => { installFetchMock({ routes: {} }) });   // sem rota nenhuma: qualquer fetch lanço local (deny)
  after(() => { uninstallFetchMock(); delete process.env[ENV_KEY] });
  beforeEach(() => { delete process.env[ENV_KEY] });
  afterEach(() => { delete process.env[ENV_KEY] });

  it('sem APICPF_API_KEY no ambiente responde 503/UNAVAILABLE sem tocar na rede', async () => {
    // A armadilha D1: `process.env[ENV_KEY] = undefined` produziria a string "undefined", que é truthy.
    assert.equal(process.env[ENV_KEY], undefined);
    assert.equal(ENV_KEY in process.env, false, 'a chave precisa estar AUSENTE do ambiente, não "undefined"');
    const r = await call('/api/cpf?cpf=' + CPF, undefined);
    assert.equal(r.status, 503);
    assert.deepEqual(r.body, { ok: false, reason: 'UNAVAILABLE' });
    assert.equal(fetchCalls().length, 0, 'nenhuma requisição de rede era permitida neste caso');
  });

  it('chave vazia também é tratada como indisponível, sem sair para a rede', async () => {
    const r = await call('/api/cpf?cpf=' + CPF, '');
    assert.equal(r.status, 503);
    assert.equal(r.body.reason, 'UNAVAILABLE');
    assert.equal(fetchCalls().length, 0);
  });

  it('CPF com dígitos repetidos é rejeitado com 422/INVALID antes de qualquer chamada', async () => {
    const r = await call('/api/cpf?cpf=11111111111', CHAVE);
    assert.equal(r.status, 422);
    assert.equal(r.body.reason, 'INVALID');
    assert.equal(fetchCalls().length, 0);
  });

  it('CPF com dígito verificador inválido é rejeitado com 422/INVALID', async () => {
    const r = await call('/api/cpf?cpf=11144477736', CHAVE);
    assert.equal(r.status, 422);
    assert.equal(fetchCalls().length, 0);
  });

  it('sem o parâmetro cpf responde 422/INVALID', async () => {
    const r = await call('/api/cpf', CHAVE);
    assert.equal(r.status, 422);
    assert.equal(r.body.reason, 'INVALID');
    assert.equal(fetchCalls().length, 0);
  });

  it('método diferente de GET responde 405/METHOD', async () => {
    const r = await call('/api/cpf?cpf=' + CPF, CHAVE, 'POST');
    assert.equal(r.status, 405);
    assert.deepEqual(r.body, { ok: false, reason: 'METHOD' });
    assert.equal(fetchCalls().length, 0);
  });

  it('upstream 200: mapeia nome/gênero/data para o shape do app, com cache no-store', async () => {
    installFetchMock({
      routes: {
        [UPSTREAM + '*']: {
          status: 200,
          json: { code: 200, data: { cpf: CPF, nome: 'João Teste', genero: 'M', data_nascimento: '1985-07-15' } },
        },
      },
    });
    const r = await call('/api/cpf?cpf=' + CPF, CHAVE);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { ok: true, data: { name: 'João Teste', gender: 'M', birth: '1985-07-15' } });
    assert.equal(r.headers['Cache-Control'], 'no-store');
    assert.match(r.headers['Content-Type'], /application\/json/);
    const chamadas = fetchCalls();
    assert.equal(chamadas.length, 1);
    assert.equal(chamadas[0].url, `${UPSTREAM}?cpf=${CPF}`, 'o CPF consultado vai na URL do upstream');
    assert.deepEqual({ ...chamadas[0].init.headers }, { 'X-API-KEY': CHAVE, Accept: 'application/json' }, 'a chave vai no header, não na URL');
  });

  it('proxy esvazia gênero fora do whitelist, mas repassa a data sem validar formato (normalização é do cliente)', async () => {
    // characterization: api/cpf.js:35 só exige `typeof === 'string'` em `data_nascimento` — o proxy NÃO
    // valida formato. A correção do birth fora de ISO acontece depois, no cliente
    // (src/services/apicpf.js:35, regex ^\\d{4}-\\d{2}-\\d{2}$ → ''). Cobrar ISO aqui era cobrar a camada
    // errada. Ver também docs/API.md §2 e o item de endurecimento em docs/ROADMAP.md.
    installFetchMock({
      routes: { [UPSTREAM + '*']: { status: 200, json: { data: { nome: 'Maria Exemplo', genero: 'X', data_nascimento: '15/07/1985' } } } },
    });
    const r = await call('/api/cpf?cpf=' + CPF, CHAVE);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.data, { name: 'Maria Exemplo', gender: '', birth: '15/07/1985' });
  });

  it('proxy não inventa campo: só name/gender/birth saem, mesmo com lixo extra no upstream', async () => {
    installFetchMock({
      routes: {
        [UPSTREAM + '*']: {
          status: 200,
          json: { data: { nome: 'Maria Exemplo', genero: 'F', data_nascimento: '1985-07-15', cpf: CPF, message: 'nao repassar', token: 'x' } },
        },
      },
    });
    const r = await call('/api/cpf?cpf=' + CPF, CHAVE);
    assert.deepEqual(Object.keys(r.body.data).sort(), ['birth', 'gender', 'name']);
    assert.equal(JSON.stringify(r.body).includes('nao repassar'), false);
  });

  it('proxy não corta o nome nem fabrica birth ausente (trim e default são do cliente)', async () => {
    // characterization: o trim é aplicado só em src/services/apicpf.js:33; aqui o nome passa cru.
    installFetchMock({
      routes: { [UPSTREAM + '*']: { status: 200, json: { data: { nome: '  Maria Exemplo  ', genero: 'F' } } } },
    });
    const r = await call('/api/cpf?cpf=' + CPF, CHAVE);
    assert.equal(r.body.data.name, '  Maria Exemplo  ');
    assert.equal(r.body.data.birth, '');
  });

  it('upstream 200 sem `data` cai em 503/UNAVAILABLE (shape inesperado não vaza)', async () => {
    installFetchMock({ routes: { [UPSTREAM + '*']: { status: 200, json: { code: 200 } } } });
    const r = await call('/api/cpf?cpf=' + CPF, CHAVE);
    assert.equal(r.status, 503);
    assert.equal(r.body.reason, 'UNAVAILABLE');
    assert.equal(fetchCalls().length, 1);
  });

  it('upstream 404 vira 422/INVALID sem expor a mensagem do terceiro', async () => {
    installFetchMock({ routes: { [UPSTREAM + '*']: { status: 404, json: { code: 404, message: 'Pessoa não encontrada' } } } });
    const r = await call('/api/cpf?cpf=' + CPF, CHAVE);
    assert.equal(r.status, 422);
    assert.equal(r.body.reason, 'INVALID');
    assert.equal(JSON.stringify(r.body).includes('message'), false);
  });

  for (const status of [401, 402, 403, 429, 500]) {
    it(`upstream ${status} vira 503/UNAVAILABLE sem vazar a mensagem do terceiro`, async () => {
      installFetchMock({ routes: { [UPSTREAM + '*']: { status, json: { code: status, message: 'erro interno do upstream' } } } });
      const r = await call('/api/cpf?cpf=' + CPF, CHAVE);
      assert.equal(r.status, 503);
      assert.equal(r.body.reason, 'UNAVAILABLE');
      assert.equal(JSON.stringify(r.body).includes('message'), false, 'anti-enumeração: nada do upstream no corpo');
      assert.equal(fetchUrls().length, 1);
    });
  }

  it('falha de rede do upstream (fetch lança) vira 503 silencioso', async () => {
    installFetchMock({ routes: { [UPSTREAM + '*']: new Error('offline') } });
    const r = await call('/api/cpf?cpf=' + CPF, CHAVE);
    assert.equal(r.status, 503);
    assert.deepEqual(r.body, { ok: false, reason: 'UNAVAILABLE' });
  });

  it('resposta do upstream que não é JSON vira 503 sem estourar', async () => {
    installFetchMock({ routes: { [UPSTREAM + '*']: { status: 200, text: '<html>gateway</html>', headers: { 'Content-Type': 'text/html' } } } });
    const r = await call('/api/cpf?cpf=' + CPF, CHAVE);
    assert.equal(r.status, 503);
  });

  it('todas as requisições registradas foram roteadas pelo mock (nenhuma escapou para a rede)', () => {
    // Rede real é estruturalmente impossível aqui: globalThis.fetch foi substituído no before() e qualquer URL
    // sem rota lançaria NETWORK_DENIED. Esta asserção documenta a intenção (auditoria §6.4, anti-regras).
    assert.ok(fetchUrls().every((u) => u.startsWith(UPSTREAM)), 'só o upstream roteado foi chamado');
  });
});
