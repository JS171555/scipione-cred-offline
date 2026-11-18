// src/services/apicpf.js — o CLIENTE que roda no browser (cache TTL de 30 min, dedupe de chamadas
// concorrentes, timeout de 9 s, `navigator.onLine`). Não confundir com tests/apicpf.test.mjs, que cobre o
// proxy serverless api/cpf.js — a auditoria (§2.7, D12) marcou justamente que este módulo não tinha teste
// nenhum apesar de existir um arquivo com nome quase idêntico.
//
// Zero rede: globalThis.fetch é substituído por helpers/fetch-mock.mjs (sem rota = exceção local) e o
// endpoint chamado pelo módulo é relativo, servido só pelo mock.
//
// S-02 (docs/ROADMAP.md): o transporte deixou de ser `GET /api/cpf?cpf=...`. Agora é `POST /api/cpf` com
// `{"cpf":"11144477735"}` no corpo, `Content-Type: application/json` e `cache:'no-store'` — o CPF sai da URL
// (log de intermediário, histórico do navegador, APM). Os casos que assumiam a query string quebraram por
// isso; além de consertar a rota, este arquivo passa a AFERIR O TRANSPORTE (método, content-type, corpo JSON
// com a chave `cpf`, ausência de query string e ausência do CPF na URL) em vez de presumi-lo. 403/413/415/429
// vindos da função são caminhos NOVOS de falha que caem no UNAVAILABLE que já existia — a UI não ganha código
// novo, e há um caso provando isso (inclusive que o `reason` interno não vaza para a tela).
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installFetchMock, fetchCalls, fetchUrls, deniedCalls, uninstallFetchMock } from '../helpers/fetch-mock.mjs';
import { setOnline } from '../helpers/dom.mjs';
import { cpfFicticio } from '../helpers/fixtures.mjs';
import { lookupCpf } from '../../src/services/apicpf.js';

// Rota EXATA: o cliente não manda query string. O padrão antigo (`'/api/cpf?cpf=*'`, chave de prefixo) não
// casa mais — e aceitar um prefixo `'/api/cpf*'` deixaria passar justamente o regresso que queremos impedir
// (alguém voltar a pôr o CPF na URL).
const ROTA = '/api/cpf';
const ok = (data) => ({ status: 200, json: { ok: true, data } });
let seq = 0;
const cpfsUsados = [];
// CPFs distintos por caso: o cache do módulo é por CPF e sobrevive entre `it` (o módulo é importado uma vez).
const cpfNovo = () => { const c = cpfFicticio(1000 + seq++); cpfsUsados.push(c); return c };

// O log do helper é zerado a cada installFetchMock (ou seja, a cada caso). Esta lista é do ARQUIVO INTEIRO,
// para a prova transversal de "zero rede / zero CPF em URL" não depender da ordem dos casos; `baseRede`
// marca onde o caso atual começou, para as asserções de contagem continuarem por caso.
const rede = [];
let baseRede = 0;
const reqsDoCaso = () => rede.slice(baseRede);

const mock = (value) => {
  installFetchMock({
    routes: {
      [ROTA]: async (url, init) => {
        rede.push({ url, init, method: String(init?.method ?? 'GET').toUpperCase(), headers: init?.headers ?? {}, body: init?.body });
        if (value instanceof Error) throw value;
        return typeof value === 'function' ? await value(url, init) : value;
      },
    },
  });
};

// Comparação case-insensitive: o transporte hoje manda um objeto literal com 'Content-Type'; se alguém
// trocar por `new Headers(...)`, `Object.entries` viraria vazio e o assert de content-type falaria com um
// TypeError ilegível em vez de dizer o que sumiu. Os dois formatos são lidos aqui.
const header = (req, nome) => {
  const h = req.headers;
  if (h && typeof h.get === 'function') { const v = h.get(nome); return v === null ? undefined : String(v) }
  const par = Object.entries(h ?? {}).find(([k]) => k.toLowerCase() === nome.toLowerCase());
  return par ? String(par[1]) : undefined;
};

// O contrato de transporte navegador → nossa função, afirmado em um lugar só.
const afirmarTransporte = (cpf, req = reqsDoCaso().at(-1)) => {
  assert.ok(req, 'nenhuma requisição foi registrada neste caso');
  assert.equal(req.method, 'POST', 'o CPF saiu do transporte de URL: o método é POST');
  assert.equal(req.url, ROTA, 'a rota é exata: nenhuma query string na URL da nossa função');
  assert.equal(req.url.includes('?'), false, `URL não pode ter query string: ${req.url}`);
  assert.equal(req.url.includes(cpf), false, `o CPF não pode aparecer na URL: ${req.url}`);
  assert.equal(header(req, 'content-type').toLowerCase(), 'application/json', 'sem JSON no corpo a função responde 415/TYPE');
  assert.equal(header(req, 'accept'), 'application/json');
  assert.equal(req.init.cache, 'no-store', 'resultado com dado pessoal não pode entrar no HTTP cache do navegador');
  const corpo = JSON.parse(req.body);
  assert.deepEqual(Object.keys(corpo), ['cpf'], `o corpo leva só o CPF: ${req.body}`);
  assert.equal(corpo.cpf, cpf, 'o corpo leva os 11 dígitos, sem máscara');
  assert.match(corpo.cpf, /^\d{11}$/, 'nenhuma pontuação no valor enviado');
};

describe('services/apicpf.js — cliente de consulta de CPF', () => {
  beforeEach(() => {
    mock({ status: 200, json: { ok: false, reason: 'UNAVAILABLE' } });   // default mudo: nada aqui é "sucesso por acaso"
    baseRede = rede.length;
    setOnline(true);
  });
  afterEach(() => { uninstallFetchMock(); setOnline(true) });

  it('CPF inválido é recusado localmente, sem nenhuma chamada', async () => {
    await assert.rejects(lookupCpf('111.111.111-11'), (e) => e.code === 'INVALID');
    await assert.rejects(lookupCpf('123'), (e) => e.code === 'INVALID');
    await assert.rejects(lookupCpf(''), (e) => e.code === 'INVALID');
    assert.equal(fetchCalls().length, 0);
    assert.equal(reqsDoCaso().length, 0, 'validação local não toca a rede em nenhum transporte');
  });

  it('offline (navigator.onLine=false) é OFFLINE e não tenta a rede', async () => {
    setOnline(false);
    await assert.rejects(lookupCpf(cpfNovo()), (e) => e.code === 'OFFLINE');
    assert.equal(fetchCalls().length, 0);
    assert.equal(reqsDoCaso().length, 0);
  });

  // ---------- transporte ----------

  it('o transporte é POST /api/cpf com o CPF no corpo e nenhum `?cpf=` na URL', async () => {
    const cpf = cpfNovo();
    mock(ok({ name: 'Maria Exemplo', gender: 'F', birth: '1985-07-15' }));
    assert.deepEqual(await lookupCpf(cpf), { name: 'Maria Exemplo', gender: 'F', birth: '1985-07-15' });
    afirmarTransporte(cpf);
    assert.equal(reqsDoCaso().length, 1);
  });

  it('aceita máscara na entrada e manda só os dígitos no corpo', async () => {
    const cpf = cpfNovo();
    mock(ok({ name: 'João Teste', gender: 'M', birth: '1985-07-15' }));
    const mascarado = `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`;
    assert.deepEqual(await lookupCpf(mascarado), { name: 'João Teste', gender: 'M', birth: '1985-07-15' });
    afirmarTransporte(cpf);   // o valor enviado são os 11 dígitos, não a forma mascarada
    assert.equal(JSON.parse(reqsDoCaso().at(-1).body).cpf.includes('.'), false);
  });

  // ---------- shape e códigos ----------

  it('normaliza o shape: trim no nome, whitelist em gênero, ISO estrito no nascimento', async () => {
    const cpf = cpfNovo();
    mock(ok({ name: '  Maria Exemplo  ', gender: 'X', birth: '15/07/1985' }));
    assert.deepEqual(await lookupCpf(cpf), { name: 'Maria Exemplo', gender: '', birth: '' });
    afirmarTransporte(cpf);
    mock(ok({ name: 'João Teste', gender: 'F', birth: '1985-07-15' }));
    assert.deepEqual(await lookupCpf(cpfNovo()), { name: 'João Teste', gender: 'F', birth: '1985-07-15' });
  });

  it('resposta ok:true sem `data` é UNAVAILABLE', async () => {
    mock({ status: 200, json: { ok: true } });
    await assert.rejects(lookupCpf(cpfNovo()), (e) => e.code === 'UNAVAILABLE');
  });

  it('422 do proxy vira INVALID e 503 vira UNAVAILABLE', async () => {
    mock({ status: 422, json: { ok: false, reason: 'INVALID' } });
    await assert.rejects(lookupCpf(cpfNovo()), (e) => e.code === 'INVALID');
    mock({ status: 503, json: { ok: false, reason: 'UNAVAILABLE' } });
    await assert.rejects(lookupCpf(cpfNovo()), (e) => e.code === 'UNAVAILABLE');
  });

  it('403/413/415/429 do proxy caem no UNAVAILABLE que já existia, sem código novo e sem vazar o motivo', async () => {
    // O ponto do S-02 no cliente: origem recusada, corpo grande, content-type errado e rate limit são caminhos
    // NOVOS de falha e ainda assim a UI não muda — nem o código nem a mensagem. Se alguém traduzir `reason`
    // para texto de tela, este caso quebra (é assim que a anti-enumeração continua valendo no transporte novo).
    for (const [status, reason] of [[403, 'ORIGIN'], [413, 'TOO_BIG'], [415, 'TYPE'], [429, 'RATE_LIMITED']]) {
      mock({ status, json: { ok: false, reason }, headers: { 'Retry-After': '60' } });
      const cpf = cpfNovo();
      await assert.rejects(lookupCpf(cpf), (e) => {
        assert.equal(e.code, 'UNAVAILABLE', `${status} não pode ganhar código próprio`);
        assert.equal(String(e.message).includes(reason), false, `${status}: o motivo interno não vaza`);
        assert.equal(String(e.message).includes(cpf), false, `${status}: o CPF não volta na mensagem`);
        return true;
      }, `${status} deveria ser UNAVAILABLE`);
      afirmarTransporte(cpf);
    }
    assert.equal(reqsDoCaso().length, 4, 'um pedido por status recusado');
  });

  // ---------- cache, dedupe, timeout, cancelamento ----------

  it('dois chamadores simultâneos compartilham UMA única requisição (single-flight PENDING)', async () => {
    const cpf = cpfNovo();
    mock(async () => ok({ name: 'Maria Exemplo', gender: 'F', birth: '1985-07-15' }));
    const p1 = lookupCpf(cpf), p2 = lookupCpf(cpf);
    // O dedupe é interno (PENDING.get(cpf) devolvido pelo módulo); como lookupCpf é `async function`, a Promise
    // visível é um wrapper novo por chamada — o que se observa é UMA requisição e o MESMO objeto.
    const [a, b] = await Promise.all([p1, p2]);
    assert.equal(fetchCalls().length, 1, 'a segunda chamada tem de ser servida pelo PENDING, não pela rede');
    assert.equal(a, b, 'os dois chamadores recebem a mesma instância de resultado');
    assert.deepEqual(a, { name: 'Maria Exemplo', gender: 'F', birth: '1985-07-15' });
    afirmarTransporte(cpf);   // o dedupe continua valendo no POST: uma requisição, e ela é POST
  });

  it('resposta é cacheada por 30 minutos e depois expira', async () => {
    const cpf = cpfNovo();
    let agora = 1_700_000_000_000;
    const real = Date.now; Date.now = () => agora;
    try {
      mock(ok({ name: 'Maria Exemplo', gender: 'F', birth: '1985-07-15' }));
      await lookupCpf(cpf);
      await lookupCpf(cpf);
      assert.equal(fetchCalls().length, 1, 'dentro do TTL não pode haver nova requisição');
      agora += 29 * 60 * 1000; await lookupCpf(cpf);
      assert.equal(fetchCalls().length, 1, '29 min depois ainda é cache');
      agora += 2 * 60 * 1000; await lookupCpf(cpf);          // 31 min > TTL de 30 min (TTL no módulo)
      assert.equal(fetchCalls().length, 2, 'depois do TTL a consulta se repete');
      assert.equal(reqsDoCaso().length, 2, 'o TTL não mudou de comportamento com o POST');
      afirmarTransporte(cpf, reqsDoCaso().at(-1));           // o requery pós-TTL também é POST, sem query string
      assert.ok(reqsDoCaso().every((r) => r.method === 'POST' && !r.url.includes('?')), 'cache algum dia trocou o transporte');
    } finally { Date.now = real }
  });

  it('nenhuma retomada regressiva para GET: nem falha, nem retry, nem cache frio colocam o CPF na URL', async () => {
    // Regressão específica que este arquivo existe para pegar: se alguém "consertar" um 415 voltando ao
    // `GET /api/cpf?cpf=...`, o CPF reaparece em log de intermediário sem quebrar nenhum outro caso.
    const cpf = cpfNovo();
    mock({ status: 500, text: 'erro', headers: { 'Content-Type': 'text/html' } });
    await assert.rejects(lookupCpf(cpf), (e) => e.code === 'UNAVAILABLE');
    await assert.rejects(lookupCpf(cpf), (e) => e.code === 'UNAVAILABLE');   // segunda tentativa: nada em cache
    assert.equal(reqsDoCaso().length, 2, 'falha não é cacheada');
    for (const r of reqsDoCaso()) afirmarTransporte(cpf, r);
  });

  it('timeout de 9 s é TIMEOUT (não UNAVAILABLE) e aborta o fetch', async (t) => {
    const cpf = cpfNovo();
    t.mock.timers.enable({ timers: ['setTimeout'] });
    mock((url, init) => new Promise((_res, rej) => {
      init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
    }));
    const p = lookupCpf(cpf);
    t.mock.timers.tick(9000);
    await assert.rejects(p, (e) => e.code === 'TIMEOUT');
    assert.equal(fetchCalls().length, 1);
    afirmarTransporte(cpf);   // o abort do timer opera no mesmo POST: o timeout não trocou o transporte
  });

  it('cancelamento do chamador repassa o AbortError original', async () => {
    const cpf = cpfNovo();
    const ctrl = new AbortController();
    mock((url, init) => new Promise((_res, rej) => {
      init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
    }));
    const p = lookupCpf(cpf, { signal: ctrl.signal });
    ctrl.abort();
    await assert.rejects(p, (e) => e.name === 'AbortError');
    afirmarTransporte(cpf);
  });

  it('falha de transporte (fetch lança) vira UNAVAILABLE', async () => {
    mock(new Error('network down'));
    await assert.rejects(lookupCpf(cpfNovo()), (e) => e.code === 'UNAVAILABLE');
  });

  // ---------- prova transversal ----------

  it('nenhuma chamada saiu fora do mock e nenhum CPF entrou em URL, no arquivo inteiro', async () => {
    // Rede real é estruturalmente impossível: globalThis.fetch foi substituído e só existe a rota ROTA.
    assert.ok(rede.length > 0, 'os casos acima exercitaram o proxy simulado');
    assert.equal(deniedCalls().length, 0, 'nenhuma URL bateu na trava de deny do helper');
    for (const r of rede) {
      assert.equal(r.url, ROTA, `apareceu uma URL fora da rota do proxy: ${r.url}`);
      assert.ok(String(r.url).startsWith('/api/cpf'), 'todas as URLs são o proxy relativo');
      assert.equal(String(r.url).includes('?'), false, `query string em alguma requisição do arquivo: ${r.url}`);
      for (const cpf of cpfsUsados) {
        assert.equal(String(r.url).includes(cpf), false, `CPF ${cpf} apareceu na URL ${r.url}`);
        assert.equal(String(r.url).includes(`${cpf.slice(0, 3)}.${cpf.slice(3, 6)}`), false, 'nem a forma mascarada');
      }
    }
    assert.ok(fetchUrls().every((u) => u === ROTA), 'o log do helper também só viu a rota exata');
    assert.ok(cpfsUsados.length > 0, 'a varredura acima precisa de CPFs reais do arquivo para ter valor');
  });
});
