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
// S-02 (docs/ROADMAP.md) — o que mudou no contrato e o que este arquivo passa a provar:
//   * transporte: GET legado continua aceito (bundles pré-cacheados em aparelhos já instalados chamam a forma
//     antiga até o Service Worker atualizar) e POST com o CPF no corpo entra como forma principal. Qualquer
//     outro método → 405/METHOD. Antes este arquivo usava 'POST' como exemplo de "método diferente de GET";
//     agora o exemplo é 'DELETE', porque POST virou método VÁLIDO e a asserção antiga seria falsa.
//   * entrada: content-type não-JSON → 415/TYPE; corpo quebrado/vazio/sem `cpf` → 422/INVALID; corpo acima
//     de 1 KiB → 413/TOO_BIG. O corpo chega de três formas segundo o runtime (objeto pronto, string e stream
//     assíncrono), então os casos exercitam as três em vez de testar só a mais cômoda.
//   * origem: `Origin`/`Referer` presente precisa bater com `req.headers.host` ou com a allowlist
//     `SCIPIONE_ALLOWED_ORIGINS`, senão 403/ORIGIN. SEM header de origem o pedido segue — limitação
//     documentada no próprio arquivo (é recusa de uso embarcado, NÃO é autenticação), e por isso existe um
//     caso que prova exatamente esse comportamento em vez de fingir que há barreira.
//   * cota: janela fixa em memória por instância (`CPF_QUOTA_PER_IP`, `CPF_QUOTA_PER_INSTANCE`,
//     `CPF_QUOTA_WINDOW_MS`) → 429/RATE_LIMITED com `Retry-After` em segundos.
//   * A ASSIMETRIA QUE IMPORTA: a chamada de SAÍDA continua GET `ENDPOINT?cpf=...` (contrato da APICPF, não é
//     nosso para mudar) enquanto a ENTRADA passa a aceitar corpo. Os casos asserem os dois lados, e um
//     varredor final prova que NENHUMA resposta ecoa o CPF consultado.
//
// Isolamento: `__quota` (gancho exportado por api/cpf.js) zera os contadores no `beforeEach`, porque a cota é
// estado de módulo por design; e o snapshot do ambiente devolve `APICPF_API_KEY`, `SCIPIONE_ALLOWED_ORIGINS`
// e `CPF_QUOTA_*` ao estado anterior no `afterEach` — nenhum caso vaza limite para o próximo. Rede real
// continua estruturalmente impossível (helpers/fetch-mock.mjs: rota desconhecida = exceção local).

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import handler, { __quota } from '../api/cpf.js';
import { installFetchMock, fetchCalls, fetchUrls, deniedCalls, uninstallFetchMock } from './helpers/fetch-mock.mjs';

const CPF = '11144477735';                 // CPF fictício clássico de documentação técnica
const CPF_MASCARADO = '111.444.777-35';
const CHAVE = 'chave-ficticia-para-teste';
const ENV_KEY = 'APICPF_API_KEY';
const ENV_ORIGENS = 'SCIPIONE_ALLOWED_ORIGINS';
const ENV_QUOTA = ['CPF_QUOTA_PER_IP', 'CPF_QUOTA_PER_INSTANCE', 'CPF_QUOTA_WINDOW_MS'];
const ENV_TODOS = [ENV_KEY, ENV_ORIGENS, ...ENV_QUOTA];
const HOST = 'scipione.example.invalid';   // host fictício: o app real usa o domínio do deploy

// A URL do upstream é lida do próprio fonte (mesma técnica do contrato de sw.js): nenhum arquivo de teste
// precisa escrever uma URL de terceiro à mão, e ainda assim provamos para onde o handler aponta.
const UPSTREAM = /const ENDPOINT='([^']+)'/.exec(readFileSync(new URL('../api/cpf.js', import.meta.url), 'utf8'))[1];

const makeRes = () => ({
  statusCode: 0, headers: {},
  setHeader(k, v) { this.headers[k] = v },
  end(body) { this.body = body },
  json() { return JSON.parse(this.body) },
});

// Headers SEMPRE explícitos nos casos novos (a helper antiga montava `req` sem `headers`, e o handler agora
// lê host/content-type/x-forwarded-for/origin). `ct: null` omite o content-type — é como se testa o 415 por
// ausência, não só por valor errado.
const H = ({ ct = 'application/json', ip, origin, referer, host = HOST } = {}) => {
  const h = { host };
  if (ct) h['content-type'] = ct;
  if (ip) h['x-forwarded-for'] = ip;
  if (origin) h.origin = origin;
  if (referer) h.referer = referer;
  return h;
};

// Corpo em stream: é o caminho que dispara a checagem de tamanho (api/cpf.js lê `for await`), então o caso de
// 413 precisa DELIVER chunks, não `req.body` pronto.
const streamOf = (...chunks) => async function* () { for (const c of chunks) yield Buffer.from(c, 'utf8') };

// Ledger transversal: helpers/fetch-mock.mjs zera o próprio log a cada installFetchMock (ou seja, a cada
// caso), então envolvemos o mock já instalado para guardar TODAS as requisições do arquivo. O wrapper é
// transparente: só registra e delega — quem decide rota, erro e deny continua sendo o helper.
const ledger = [];
const envolverFetch = () => {
  const mock = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    const alvo = typeof args[0] === 'string' ? args[0] : (args[0]?.url ?? String(args[0]));
    ledger.push({ url: alvo, method: String(args[1]?.method ?? args[0]?.method ?? 'GET').toUpperCase() });
    return mock(...args);
  };
};

// Chama o handler com o ambiente EXPLÍCITO: apagar (delete), nunca atribuir undefined.
const call = async (url, key, method = 'GET', { headers, body, stream } = {}) => {
  if (key === undefined) delete process.env[ENV_KEY]; else process.env[ENV_KEY] = key;
  const req = { method, url };
  if (headers !== undefined) req.headers = headers;
  if (body !== undefined) req.body = body;
  if (stream !== undefined) req[Symbol.asyncIterator] = stream;
  const res = makeRes();
  await handler(req, res);
  return { status: res.statusCode, body: res.json(), headers: res.headers, raw: String(res.body) };
};

// Upstream de sucesso com o shape real da APICPF (inclusive `data.cpf`, que o proxy tem de descartar).
// Cada reinstalação do mock substitui globalThis.fetch (e apagaria o wrapper do ledger), por isso o
// re-envolvimento acontece aqui dentro e não só no beforeEach: nenhuma chamada pode ficar de fora.
const rotaUpstream = (value) => { installFetchMock({ routes: { [UPSTREAM + '*']: value } }); envolverFetch(); };
const upstreamOk = (dados = { nome: 'João Teste', genero: 'M', data_nascimento: '1985-07-15' }, extra = {}) =>
  rotaUpstream({ status: 200, json: { code: 200, data: { cpf: CPF, ...dados }, ...extra } });

// POST canônico: CPF no corpo, URL da NOSSA função sem query string.
// `null` é o marcador de "chave ausente do ambiente". Não é `undefined`: com valor default no parâmetro,
// `postCpf(undefined)` reativaria CHAVE e o caso sairia para a rede — a armadilha D1 renascendo no harness.
// Foi exatamente o que o assert de "zero rede" abaixo pegou na primeira execução deste arquivo.
const postCpf = (key = CHAVE, { cpf = CPF, ip = '203.0.113.10', headers } = {}) =>
  call('/api/cpf', key === null ? undefined : key, 'POST', { headers: headers ?? H({ ip }), body: { cpf } });

const semEco = (r, cpf = CPF) => {
  assert.equal(r.raw.includes(cpf), false, `nenhuma resposta pode devolver o CPF consultado (${r.status}): ${r.raw}`);
  assert.equal(r.raw.includes(CPF_MASCARADO), false, `nem a forma mascarada (${r.status}): ${r.raw}`);
};

describe('api/cpf.js — proxy público de consulta de CPF', () => {
  let snapshot;
  const restaurar = () => {
    for (const k of ENV_TODOS) {
      if (snapshot[k] === undefined) delete process.env[k]; else process.env[k] = snapshot[k];
    }
  };

  before(() => {
    snapshot = Object.fromEntries(ENV_TODOS.map((k) => [k, process.env[k]]));
    installFetchMock({ routes: {} });   // sem rota nenhuma: qualquer fetch lanço local (deny)
    __quota.reset();
  });
  after(() => {
    uninstallFetchMock(); __quota.reset(); restaurar();
    // Higiene de ambiente, contraída já na versão anterior deste arquivo — agora como asserção e não como
    // "apagar por garantia": o snapshot volta integralmente, então um APICPF_API_KEY exportado pelo CI não
    // sai destruído do processo, e nenhuma CPF_QUOTA_* sobrevive ao arquivo.
    assert.deepEqual(Object.fromEntries(ENV_TODOS.map((k) => [k, process.env[k]])), snapshot,
      'nenhuma variável de ambiente pode ficar para trás');
  });
  beforeEach(() => {
    installFetchMock({ routes: {} });   // log de rede zerado por caso: a prova de "zero rede" vale isoladamente
    envolverFetch();
    __quota.reset();
    delete process.env[ENV_KEY];
    delete process.env[ENV_ORIGENS];
    for (const k of ENV_QUOTA) delete process.env[k];
  });
  afterEach(restaurar);

  // ---------- GET legado (bundles pré-cacheados) — contrato antigo, mantido ----------

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

  it('método que não é GET nem POST responde 405/METHOD', async () => {
    // DELETE no lugar de POST: POST passou a ser método legítimo (S-02), então continuar servindo como
    // "método diferente" seria um teste falso. PUT e PATCH reforçam a whitelist, não a blacklist.
    for (const method of ['DELETE', 'PUT', 'PATCH', 'HEAD', 'OPTIONS']) {
      const r = await call('/api/cpf?cpf=' + CPF, CHAVE, method, { headers: H() });
      assert.equal(r.status, 405, `${method} precisa ser recusado`);
      assert.deepEqual(r.body, { ok: false, reason: 'METHOD' });
    }
    assert.equal(fetchCalls().length, 0);
  });

  it('upstream 200: mapeia nome/gênero/data para o shape do app, com cache no-store', async () => {
    upstreamOk();
    const r = await call('/api/cpf?cpf=' + CPF, CHAVE);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { ok: true, data: { name: 'João Teste', gender: 'M', birth: '1985-07-15' } });
    assert.equal(r.headers['Cache-Control'], 'no-store');
    assert.match(r.headers['Content-Type'], /application\/json/);
    const chamadas = fetchCalls();
    assert.equal(chamadas.length, 1);
    assert.equal(chamadas[0].url, `${UPSTREAM}?cpf=${CPF}`, 'o CPF consultado vai na URL do upstream');
    assert.deepEqual({ ...chamadas[0].init.headers }, { 'X-API-KEY': CHAVE, Accept: 'application/json' }, 'a chave vai no header, não na URL');
    semEco(r);
  });

  it('proxy esvazia gênero fora do whitelist, mas repassa a data sem validar formato (normalização é do cliente)', async () => {
    // characterization: o proxy só exige `typeof === 'string'` em `data_nascimento` — ele NÃO valida formato.
    // A correção do birth fora de ISO acontece depois, no cliente (src/services/apicpf.js, regex
    // ^\d{4}-\d{2}-\d{2}$ → ''). Cobrar ISO aqui era cobrar a camada errada. Ver docs/API.md §2 e o item de
    // endurecimento em docs/ROADMAP.md.
    upstreamOk({ nome: 'Maria Exemplo', genero: 'X', data_nascimento: '15/07/1985' });
    const r = await call('/api/cpf?cpf=' + CPF, CHAVE);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.data, { name: 'Maria Exemplo', gender: '', birth: '15/07/1985' });
  });

  it('proxy não inventa campo: só name/gender/birth saem, mesmo com lixo extra no upstream', async () => {
    upstreamOk({ nome: 'Maria Exemplo', genero: 'F', data_nascimento: '1985-07-15' }, { message: 'nao repassar', token: 'x' });
    const r = await call('/api/cpf?cpf=' + CPF, CHAVE);
    assert.deepEqual(Object.keys(r.body.data).sort(), ['birth', 'gender', 'name']);
    assert.equal(r.raw.includes('nao repassar'), false);
    semEco(r);
  });

  it('proxy não corta o nome nem fabrica birth ausente (trim e default são do cliente)', async () => {
    // characterization: o trim é aplicado só no cliente; aqui o nome passa cru.
    upstreamOk({ nome: '  Maria Exemplo  ', genero: 'F' });
    const r = await call('/api/cpf?cpf=' + CPF, CHAVE);
    assert.equal(r.body.data.name, '  Maria Exemplo  ');
    assert.equal(r.body.data.birth, '');
  });

  it('upstream 200 sem `data` cai em 503/UNAVAILABLE (shape inesperado não vaza)', async () => {
    rotaUpstream({ status: 200, json: { code: 200 } });
    const r = await call('/api/cpf?cpf=' + CPF, CHAVE);
    assert.equal(r.status, 503);
    assert.equal(r.body.reason, 'UNAVAILABLE');
    assert.equal(fetchCalls().length, 1);
  });

  it('upstream 404 vira 422/INVALID sem expor a mensagem do terceiro', async () => {
    rotaUpstream({ status: 404, json: { code: 404, message: 'Pessoa não encontrada' } });
    const r = await call('/api/cpf?cpf=' + CPF, CHAVE);
    assert.equal(r.status, 422);
    assert.equal(r.body.reason, 'INVALID');
    assert.equal(r.raw.includes('message'), false);
  });

  for (const status of [401, 402, 403, 429, 500]) {
    it(`upstream ${status} vira 503/UNAVAILABLE sem vazar a mensagem do terceiro`, async () => {
      rotaUpstream({ status, json: { code: status, message: 'erro interno do upstream' } });
      const r = await call('/api/cpf?cpf=' + CPF, CHAVE);
      assert.equal(r.status, 503);
      assert.equal(r.body.reason, 'UNAVAILABLE');
      assert.equal(r.raw.includes('message'), false, 'anti-enumeração: nada do upstream no corpo');
      assert.equal(fetchUrls().length, 1);
    });
  }

  it('falha de rede do upstream (fetch lança) vira 503 silencioso', async () => {
    rotaUpstream(new Error('offline'));
    const r = await call('/api/cpf?cpf=' + CPF, CHAVE);
    assert.equal(r.status, 503);
    assert.deepEqual(r.body, { ok: false, reason: 'UNAVAILABLE' });
  });

  it('resposta do upstream que não é JSON vira 503 sem estourar', async () => {
    rotaUpstream({ status: 200, text: '<html>gateway</html>', headers: { 'Content-Type': 'text/html' } });
    const r = await call('/api/cpf?cpf=' + CPF, CHAVE);
    assert.equal(r.status, 503);
  });

  // ---------- POST: o CPF deixa de viajar na URL da NOSSA função ----------

  it('POST com o CPF no corpo e NENHUM `?cpf=` na URL responde 200 com o mesmo mapeamento do GET', async () => {
    upstreamOk();
    const r = await postCpf();
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { ok: true, data: { name: 'João Teste', gender: 'M', birth: '1985-07-15' } });
    assert.equal(r.headers['Cache-Control'], 'no-store');
    assert.match(r.headers['Content-Type'], /application\/json/);
    // O ponto central do S-02, nos dois sentidos:
    const saida = fetchCalls();
    assert.equal(saida.length, 1);
    assert.equal(saida[0].url, `${UPSTREAM}?cpf=${CPF}`, 'contrato de saída: o provedor só sabe consultar por query string GET — não é escolha nossa');
    assert.equal(saida[0].method, 'GET');
    assert.deepEqual({ ...saida[0].init.headers }, { 'X-API-KEY': CHAVE, Accept: 'application/json' });
    semEco(r);
  });

  it('POST 422/INVALID para CPF inválido no corpo (espelho do GET)', async () => {
    for (const cpf of ['11111111111', '11144477736', '123', '']) {
      const r = await postCpf(CHAVE, { cpf });
      assert.equal(r.status, 422, `o corpo {cpf:${JSON.stringify(cpf)}} precisa dar 422`);
      assert.equal(r.body.reason, 'INVALID');
    }
    assert.equal(fetchCalls().length, 0, 'nada de rede para CPF que já chega inválido');
  });

  it('POST sem APICPF_API_KEY responde 503/UNAVAILABLE sem tocar na rede (espelho do GET)', async () => {
    const r = await postCpf(null);
    assert.equal(r.status, 503);
    assert.deepEqual(r.body, { ok: false, reason: 'UNAVAILABLE' });
    assert.equal(fetchCalls().length, 0, 'a guarda de chave não pode ser burlada pelo caminho POST');
  });

  it('POST ignora `?cpf=` da URL da nossa função: quem manda é o corpo', async () => {
    // Prova de que a query deixou de ser a fonte de verdade no transporte novo: a URL traz um CPF
    // deliberadamente inválido e o corpo um CPF válido — se o handler lesse a query, o resultado seria 422.
    upstreamOk();
    const r = await call('/api/cpf?cpf=11111111111', CHAVE, 'POST', { headers: H(), body: { cpf: CPF } });
    assert.equal(r.status, 200);
    assert.equal(fetchCalls()[0].url, `${UPSTREAM}?cpf=${CPF}`, 'só o CPF do corpo foi adiante');
  });

  it('aceita as três formas de corpo que o runtime pode entregar: objeto pronto, string e stream', async () => {
    // A Vercel entrega `req.body` já parseado; outros runtimes (e o teste de stream) dão o corpo bruto. O
    // contrato de entrada tem de valer nos três, senão o teste cobre um caminho e a produção outra.
    for (const [nome, opts] of [
      ['objeto', { body: { cpf: CPF } }],
      ['string', { body: JSON.stringify({ cpf: CPF }) }],
      ['stream', { stream: streamOf(JSON.stringify({ cpf: CPF })) }],
    ]) {
      upstreamOk();
      const r = await call('/api/cpf', CHAVE, 'POST', { headers: H(), ...opts });
      assert.equal(r.status, 200, `${nome}: corpo válido tem de ser aceito`);
      assert.equal(r.body.data.name, 'João Teste', nome);
      assert.equal(fetchCalls()[0].url, `${UPSTREAM}?cpf=${CPF}`, `${nome}: a URL da nossa função não é lida`);
    }
  });

  it('POST com content-type que não é JSON cai em 415/TYPE antes de qualquer leitura de corpo', async () => {
    for (const ct of ['application/x-www-form-urlencoded', 'text/plain', 'application/octet-stream', null]) {
      const r = await call('/api/cpf', CHAVE, 'POST', { headers: H({ ct }), body: JSON.stringify({ cpf: CPF }) });
      assert.equal(r.status, 415, `content-type ${ct ?? '(ausente)'} precisa ser recusado`);
      assert.deepEqual(r.body, { ok: false, reason: 'TYPE' });
    }
    // Control positivo: o mesmo corpo com charset declarado (forma que o browser manda de fato) é aceito.
    upstreamOk();
    const okCharset = await call('/api/cpf', CHAVE, 'POST', { headers: H({ ct: 'application/json; charset=utf-8' }), body: JSON.stringify({ cpf: CPF }) });
    assert.equal(okCharset.status, 200, 'a checagem é "contém application/json", não igualdade rígida');
    assert.equal(fetchCalls().length, 1);
  });

  it('corpo quebrado, vazio ou sem o campo `cpf` cai em 422/INVALID, sem sair para a rede', async () => {
    const corpos = [
      ['JSON quebrado', '{cpf: 11144477735'],
      ['vazio', ''],
      ['objeto sem cpf', '{"nome":"Maria Exemplo"}'],
      ['array no topo', JSON.stringify([CPF])],
      ['literal não-objeto', '42'],
      ['sem cpf no corpo', undefined],
    ];
    for (const [nome, body] of corpos) {
      const opts = { headers: H() };
      if (body !== undefined) opts.body = body; else opts.body = {};
      const r = await call('/api/cpf', CHAVE, 'POST', opts);
      assert.equal(r.status, 422, `${nome} precisa dar 422/INVALID`);
      assert.equal(r.body.reason, 'INVALID');
      semEco(r);
    }
    assert.equal(fetchCalls().length, 0);
  });

  it('número no campo `cpf` é aceito (o cliente pode mandar sem máscara e sem aspas)', async () => {
    upstreamOk();
    const r = await call('/api/cpf', CHAVE, 'POST', { headers: H(), body: { cpf: 11144477735 } });
    assert.equal(r.status, 200);
    assert.equal(fetchCalls()[0].url, `${UPSTREAM}?cpf=${CPF}`, 'digits() normaliza antes de ir ao provedor');
  });

  it('corpo acima de 1 KiB é cortado em 413/TOO_BIG no meio da leitura, sem estourar memória nem tocar a rede', async () => {
    // Só o caminho de stream mede tamanho (api/cpf.js acumula chunks e desiste ao passar MAX_BODY), então o
    // corpo é entregue em pedaços, como viria de um cliente hostil.
    const lixo = 'x'.repeat(4000);
    const r = await call('/api/cpf', CHAVE, 'POST', { headers: H(), stream: streamOf(JSON.stringify({ cpf: CPF }), lixo) });
    assert.equal(r.status, 413);
    assert.deepEqual(r.body, { ok: false, reason: 'TOO_BIG' });
    assert.equal(fetchCalls().length, 0, 'não se paga uma consulta por um corpo rejeitado');
    semEco(r);
    // Control: o mesmo caminho com corpo abaixo do teto passa — o 413 é sobre tamanho, não sobre stream.
    upstreamOk();
    const pequeno = await call('/api/cpf', CHAVE, 'POST', { headers: H(), stream: streamOf(JSON.stringify({ cpf: CPF })) });
    assert.equal(pequeno.status, 200);
  });

  // ---------- origem: recusa de uso embarcado (NÃO é autenticação) ----------

  it('Origin estrangeira é recusada com 403/ORIGIN antes de gastar cota ou pagar consulta', async () => {
    upstreamOk({ nome: 'Maria Exemplo' });
    const r = await postCpf(CHAVE, { headers: H({ origin: 'https://site-de-terceiros.invalid' }) });
    assert.equal(r.status, 403);
    assert.deepEqual(r.body, { ok: false, reason: 'ORIGIN' });
    assert.equal(fetchCalls().length, 0, 'origem recusada não chega ao provedor');
    // Mesmo valor malformado não abre exceção: se não dá para extrair host, o pedido vai fora.
    const lixo = await postCpf(CHAVE, { headers: H({ origin: 'nao-e-uma-url' }) });
    assert.equal(lixo.status, 403);
    // Referer é o substituto do Origin em navegação de página: a mesma regra vale para ele.
    const ref = await call('/api/cpf?cpf=' + CPF, CHAVE, 'GET', { headers: H({ ct: null, referer: 'https://site-de-terceiros.invalid/pagina' }) });
    assert.equal(ref.status, 403);
  });

  it('Origin igual ao host da própria função passa (same-origin não é punido)', async () => {
    upstreamOk();
    const r = await postCpf(CHAVE, { headers: H({ origin: `https://${HOST}` }) });
    assert.equal(r.status, 200);
    assert.equal(r.body.data.name, 'João Teste');
    // GET same-origin sem header nenhum é a forma antiga dos bundles velhos: continua andando.
    const legado = await call('/api/cpf?cpf=' + CPF, CHAVE, 'GET', { headers: H({ ct: null }) });
    assert.equal(legado.status, 200);
  });

  it('allowlist SCIPIONE_ALLOWED_ORIGINS aceita a origem listada e recusa a vizinha', async () => {
    process.env[ENV_ORIGENS] = 'https://parceiro-valido.invalid, parceiro-2.invalid/';
    upstreamOk();
    for (const origem of ['https://parceiro-valido.invalid', 'https://parceiro-2.invalid']) {
      const r = await postCpf(CHAVE, { headers: H({ origin: origem }) });
      assert.equal(r.status, 200, `${origem} está na allowlist`);
    }
    const fora = await postCpf(CHAVE, { headers: H({ origin: 'https://parceiro-3.invalid' }) });
    assert.equal(fora.status, 403, 'a allowlist é exata por host: prefixo parecido não entra');
    assert.equal(fetchCalls().length, 2, 'a origem recusada não saiu para o provedor');
    // O host da própria função continua aceito mesmo com allowlist declarada (união, não substituição).
    const proprio = await postCpf(CHAVE, { headers: H({ origin: `https://${HOST}` }) });
    assert.equal(proprio.status, 200);
  });

  it('sem Origin e sem Referer o pedido segue: limitação documentada, barreira efetiva é a cota', async () => {
    // Não é um bug a testar como tal — é o comportamento escrito no cabeçalho de originAllowed(): curl e o
    // GET same-origin do navegador não enviam Origin. Deixar isto explícito impede que alguém leia o 403
    // como controle de acesso. O que segura o abuso aqui é CPF_QUOTA_PER_IP, coberto nos casos seguintes.
    upstreamOk();
    const semOrigem = await postCpf(CHAVE, { headers: { host: HOST, 'content-type': 'application/json' } });
    assert.equal(semOrigem.status, 200);
    const semHeaders = await call('/api/cpf?cpf=' + CPF, CHAVE, 'GET');   // `req` cru, como os casos antigos
    assert.equal(semHeaders.status, 200);
    assert.equal(__quota.ip({ headers: { 'x-forwarded-for': '198.51.100.1, 203.0.113.9' } }), '198.51.100.1', 'o primeiro item da cadeia de proxies é o IP do cliente');
    assert.equal(__quota.ip({ headers: { 'x-real-ip': '198.51.100.2' } }), '198.51.100.2', 'x-real-ip é o fallback');
    assert.equal(__quota.ip({}), 'desconhecido', 'sem header de IP todos os pedidos caem no mesmo balde — por isso a cota por instância existe');
  });

  // ---------- cota de janela fixa (em memória, por instância aquecida) ----------

  it(`CPF_QUOTA_PER_IP=3 nega o 4º pedido do mesmo IP com 429/RATE_LIMITED e Retry-After, e outro IP ainda passa`, async () => {
    process.env.CPF_QUOTA_PER_IP = '3';
    upstreamOk();
    for (let i = 1; i <= 3; i++) {
      const r = await postCpf(CHAVE, { ip: '203.0.113.7' });
      assert.equal(r.status, 200, `o ${i}º pedido do mesmo IP é atendido`);
      assert.equal(r.headers['Retry-After'], undefined, 'só o pedido negado carrega Retry-After');
    }
    const negado = await postCpf(CHAVE, { ip: '203.0.113.7' });
    assert.equal(negado.status, 429);
    assert.deepEqual(negado.body, { ok: false, reason: 'RATE_LIMITED' });
    const retry = Number(negado.headers['Retry-After']);
    assert.ok(Number.isInteger(retry) && retry >= 1, `Retry-After precisa ser segundos inteiros ≥ 1, veio ${JSON.stringify(negado.headers['Retry-After'])}`);
    assert.ok(retry <= 60, 'dentro da janela default de 60 s o Retry-After não pode prometer espera maior que a janela');
    assert.equal(fetchCalls().length, 3, 'o pedido negado não virou custo: não chamou o provedor');
    // O outro IP não herdou nada: a cota é por IP, não global.
    const outro = await postCpf(CHAVE, { ip: '198.51.100.9' });
    assert.equal(outro.status, 200);
    assert.equal(__quota.size(), 2, 'dois baldes de IP abertos');
  });

  it('CPF_QUOTA_PER_INSTANCE=5 bloqueia no 6º pedido mesmo rodando o IP (trava-custos contra IP rotativo)', async () => {
    process.env.CPF_QUOTA_PER_INSTANCE = '5';
    upstreamOk();
    for (let i = 1; i <= 5; i++) {
      const r = await postCpf(CHAVE, { ip: `203.0.113.${i}` });
      assert.equal(r.status, 200, `o ${i}º pedido, cada um de um IP novo, ainda é atendido`);
    }
    const negado = await postCpf(CHAVE, { ip: '203.0.113.99' });
    assert.equal(negado.status, 429, 'trocar de IP não dribla o teto da instância');
    assert.equal(negado.body.reason, 'RATE_LIMITED');
    assert.ok(Number(negado.headers['Retry-After']) >= 1);
    assert.equal(__quota.size(), 6, 'cada IP novo abriu um balde — o que segurou foi o contador da instância');
    assert.equal(fetchCalls().length, 5);
  });

  it('__quota.reset() volta a permitir imediatamente (estado de módulo, não rede)', async () => {
    process.env.CPF_QUOTA_PER_IP = '2';
    upstreamOk();
    await postCpf(CHAVE, { ip: '203.0.113.5' });
    await postCpf(CHAVE, { ip: '203.0.113.5' });
    assert.equal((await postCpf(CHAVE, { ip: '203.0.113.5' })).status, 429);
    __quota.reset();
    const depois = await postCpf(CHAVE, { ip: '203.0.113.5' });
    assert.equal(depois.status, 200, 'zerar os contadores reabre a janela');
    assert.equal(__quota.size(), 1);
  });

  it('a janela expira: com CPF_QUOTA_WINDOW_MS curto, o mesmo IP volta a ser atendido após o prazo', async () => {
    // Espera REAL de alguns milissegundos: não mexemos em api/cpf.js nem injetamos relógio — a janela é
    // `Date.now()` e este caso prova que ela fecha sozinha (sem isso, "429 para sempre" passaria despercebido).
    process.env.CPF_QUOTA_PER_IP = '1';
    // 400 ms de janela com 450 ms de espera: a margem é larga de propósito. Apertar demais faria este caso
    // falhar por jitter do runner (o 2º pedido precisaria cair DENTRO da janela para o 429 ser honesto).
    process.env.CPF_QUOTA_WINDOW_MS = '400';
    upstreamOk();
    assert.equal((await postCpf(CHAVE, { ip: '203.0.113.20' })).status, 200);
    const negado = await postCpf(CHAVE, { ip: '203.0.113.20' });
    assert.equal(negado.status, 429);
    assert.equal(__quota.size(), 1, 'o balde é reusado, não recriado');
    await new Promise((res) => setTimeout(res, 450));
    const renovado = await postCpf(CHAVE, { ip: '203.0.113.20' });
    assert.equal(renovado.status, 200, `passada a janela (${process.env.CPF_QUOTA_WINDOW_MS} ms) o mesmo IP consulta de novo`);
    assert.equal(fetchCalls().length, 2, 'duas consultas efetivas: a negada no meio não foi ao provedor');
  });

  it('429 não vaza a mensagem do terceiro nem o CPF, e não consome cota de upstream', async () => {
    process.env.CPF_QUOTA_PER_IP = '1';
    rotaUpstream({ status: 200, json: { code: 200, message: 'crédito do provedor esgotado — detalhe interno', data: { cpf: CPF, nome: 'João Teste', genero: 'M', data_nascimento: '1985-07-15' } } });
    assert.equal((await postCpf(CHAVE, { ip: '203.0.113.30' })).status, 200);
    const r = await postCpf(CHAVE, { ip: '203.0.113.30' });
    assert.equal(r.status, 429);
    assert.deepEqual(r.body, { ok: false, reason: 'RATE_LIMITED' }, 'corpo do 429 é só o motivo: nada do upstream, nada do cliente');
    assert.equal(r.raw.includes('message'), false);
    assert.equal(r.raw.includes('crédito do provedor'), false);
    semEco(r);
    assert.equal(fetchCalls().length, 1, 'o pedido rate-limited nunca alcançou o provedor');
    assert.equal(r.headers['Cache-Control'], 'no-store', '429 também não pode ser cacheado pelo navegador');
  });

  // ---------- higiene transversal ----------

  it('nenhuma resposta ecoa o CPF consultado, em nenhum caminho de status', async () => {
    const cenarios = [
      ['GET 200', async () => { upstreamOk(); return call('/api/cpf?cpf=' + CPF, CHAVE, 'GET', { headers: H({ ct: null }) }) }],
      ['POST 200', async () => { upstreamOk(); return postCpf(CHAVE, { ip: '198.51.100.40' }) }],
      ['405', async () => call('/api/cpf?cpf=' + CPF, CHAVE, 'DELETE', { headers: H() })],
      ['413', async () => call('/api/cpf', CHAVE, 'POST', { headers: H(), stream: streamOf(JSON.stringify({ cpf: CPF }), 'y'.repeat(2000)) })],
      ['415', async () => call('/api/cpf', CHAVE, 'POST', { headers: H({ ct: 'text/plain' }), body: JSON.stringify({ cpf: CPF }) })],
      ['422 corpo', async () => call('/api/cpf', CHAVE, 'POST', { headers: H(), body: { cpf: '11144477736' } })],
      ['422 query', async () => call('/api/cpf?cpf=11144477736', CHAVE, 'GET', { headers: H({ ct: null }) })],
      ['403', async () => postCpf(CHAVE, { headers: H({ origin: 'https://intruso.invalid' }) })],
      // O teto é baixado DENTRO do cenário: os outros dependem do default (30) porque a cota é consumida
      // antes da leitura do corpo — se ela fosse apertada aqui, 413/422 virariam 429 e o teste mentiria.
      ['429', async () => {
        process.env.CPF_QUOTA_PER_IP = '1';
        assert.equal((await postCpf(CHAVE, { ip: '198.51.100.44' })).status, 200, 'o primeiro pedido abre a janela');
        return postCpf(CHAVE, { ip: '198.51.100.44' });
      }],
      // `null` (não `undefined`) é o marcador de chave ausente — ver a nota na definição de `postCpf`.
      ['503 sem chave', async () => postCpf(null)],
      ['503 upstream fora', async () => { rotaUpstream(new Error('offline')); return postCpf(CHAVE, { ip: '198.51.100.41' }) }],
    ];
    for (const [nome, exec] of cenarios) {
      const r = await exec();
      assert.ok([200, 403, 405, 413, 415, 422, 429, 503].includes(r.status), `${nome}: status inesperado ${r.status}`);
      semEco(r);
      assert.equal(r.raw.includes('X-API-KEY'), false, `${nome}: a chave nunca aparece na resposta`);
      assert.equal(r.raw.includes(CHAVE), false, `${nome}: a chave nunca aparece na resposta`);
    }
  });

  it('todas as requisições registradas foram roteadas pelo mock (nenhuma escapou para a rede)', () => {
    // Rede real é estruturalmente impossível aqui: globalThis.fetch foi substituído no before() e qualquer URL
    // sem rota lançaria NETWORK_DENIED. Esta asserção documenta a intenção (auditoria §6.4, anti-regras).
    assert.ok(fetchUrls().every((u) => u.startsWith(UPSTREAM)), 'só o upstream roteado foi chamado');
    assert.equal(deniedCalls().length, 0, 'nenhuma chamada bateu na trava de deny do helper');
  });

  it('prova transversal: nenhuma URL fora do upstream simulado foi tocada no arquivo inteiro', () => {
    // O log do helper é zerado a cada installFetchMock (cada caso), então este ledger é montado por cima do
    // mock: registramos TODAS as chamadas do arquivo e provamos que o CPF só aparece na URL do provedor —
    // exatamente a assimetria documentada no topo (entrada em corpo, saída em query por contrato da APICPF).
    assert.ok(ledger.length > 0, 'os casos acima exercitaram o upstream simulado');
    for (const c of ledger) {
      assert.ok(c.url.startsWith(UPSTREAM), `escapou uma chamada para fora do upstream: ${c.method} ${c.url}`);
      assert.equal(c.method, 'GET', 'a saída para o provedor é GET, como manda o contrato da APICPF');
      assert.ok(!c.url.includes(CPF) || c.url.startsWith(UPSTREAM), `CPF em URL que não é o provedor: ${c.url}`);
    }
    assert.equal(deniedCalls().length, 0);
  });
});
