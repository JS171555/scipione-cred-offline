// src/services/apicpf.js — o CLIENTE que roda no browser (cache TTL de 30 min, dedupe de chamadas
// concorrentes, timeout de 9 s, `navigator.onLine`). Não confundir com tests/apicpf.test.mjs, que cobre o
// proxy serverless api/cpf.js — a auditoria (§2.7, D12) marcou justamente que este módulo não tinha teste
// nenhum apesar de existir um arquivo com nome quase idêntico.
//
// Zero rede: globalThis.fetch é substituído por helpers/fetch-mock.mjs (sem rota = exceção local) e o
// endpoint chamado pelo módulo é relativo ('/api/cpf?cpf=...'), servido só pelo mock.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installFetchMock, fetchCalls, fetchUrls, uninstallFetchMock } from '../helpers/fetch-mock.mjs';
import { setOnline } from '../helpers/dom.mjs';
import { cpfFicticio } from '../helpers/fixtures.mjs';
import { lookupCpf } from '../../src/services/apicpf.js';

const ROTA = '/api/cpf?cpf=*';   // chave de prefixo: o mock casa por começo de URL
const ok = (data) => ({ status: 200, json: { ok: true, data } });
let seq = 0;
const cpfNovo = () => cpfFicticio(1000 + seq++);   // CPFs distintos: o cache do módulo é por CPF

describe('services/apicpf.js — cliente de consulta de CPF', () => {
  beforeEach(() => { installFetchMock({ routes: {} }); setOnline(true) });
  afterEach(() => { uninstallFetchMock(); setOnline(true) });

  it('CPF inválido é recusado localmente, sem nenhuma chamada', async () => {
    await assert.rejects(lookupCpf('111.111.111-11'), (e) => e.code === 'INVALID');
    await assert.rejects(lookupCpf('123'), (e) => e.code === 'INVALID');
    await assert.rejects(lookupCpf(''), (e) => e.code === 'INVALID');
    assert.equal(fetchCalls().length, 0);
  });

  it('offline (navigator.onLine=false) é OFFLINE e não tenta a rede', async () => {
    setOnline(false);
    await assert.rejects(lookupCpf(cpfNovo()), (e) => e.code === 'OFFLINE');
    assert.equal(fetchCalls().length, 0);
  });

  it('normaliza o shape: trim no nome, whitelist em gênero, ISO estrito no nascimento', async () => {
    const cpf = cpfNovo();
    installFetchMock({ routes: { [ROTA]: ok({ name: '  Maria Exemplo  ', gender: 'X', birth: '15/07/1985' }) } });
    assert.deepEqual(await lookupCpf(cpf), { name: 'Maria Exemplo', gender: '', birth: '' });
    installFetchMock({ routes: { [ROTA]: ok({ name: 'João Teste', gender: 'F', birth: '1985-07-15' }) } });
    assert.deepEqual(await lookupCpf(cpfNovo()), { name: 'João Teste', gender: 'F', birth: '1985-07-15' });
  });

  it('resposta ok:true sem `data` é UNAVAILABLE', async () => {
    installFetchMock({ routes: { [ROTA]: { status: 200, json: { ok: true } } } });
    await assert.rejects(lookupCpf(cpfNovo()), (e) => e.code === 'UNAVAILABLE');
  });

  it('422 do proxy vira INVALID e 503 vira UNAVAILABLE', async () => {
    installFetchMock({ routes: { [ROTA]: { status: 422, json: { ok: false, reason: 'INVALID' } } } });
    await assert.rejects(lookupCpf(cpfNovo()), (e) => e.code === 'INVALID');
    installFetchMock({ routes: { [ROTA]: { status: 503, json: { ok: false, reason: 'UNAVAILABLE' } } } });
    await assert.rejects(lookupCpf(cpfNovo()), (e) => e.code === 'UNAVAILABLE');
  });

  it('dois chamadores simultâneos compartilham UMA única requisição (single-flight PENDING)', async () => {
    const cpf = cpfNovo();
    installFetchMock({ routes: { [ROTA]: async () => ok({ name: 'Maria Exemplo', gender: 'F', birth: '1985-07-15' }) } });
    const p1 = lookupCpf(cpf), p2 = lookupCpf(cpf);
    // O dedupe é interno (PENDING.get(cpf) devolvido em apicpf.js:13); como lookupCpf é `async function`,
    // a Promise visível é um wrapper novo por chamada — o que se observa é UMA requisição e o MESMO objeto.
    const [a, b] = await Promise.all([p1, p2]);
    assert.equal(fetchCalls().length, 1, 'a segunda chamada tem de ser servida pelo PENDING, não pela rede');
    assert.equal(a, b, 'os dois chamadores recebem a mesma instância de resultado');
    assert.deepEqual(a, { name: 'Maria Exemplo', gender: 'F', birth: '1985-07-15' });
  });

  it('resposta é cacheada por 30 minutos e depois expira', async () => {
    const cpf = cpfNovo();
    let agora = 1_700_000_000_000;
    const real = Date.now; Date.now = () => agora;
    try {
      installFetchMock({ routes: { [ROTA]: ok({ name: 'Maria Exemplo', gender: 'F', birth: '1985-07-15' }) } });
      await lookupCpf(cpf);
      await lookupCpf(cpf);
      assert.equal(fetchCalls().length, 1, 'dentro do TTL não pode haver nova requisição');
      agora += 29 * 60 * 1000; await lookupCpf(cpf);
      assert.equal(fetchCalls().length, 1, '29 min depois ainda é cache');
      agora += 2 * 60 * 1000; await lookupCpf(cpf);          // 31 min > TTL de 30 min (apicpf.js:3)
      assert.equal(fetchCalls().length, 2, 'depois do TTL a consulta se repete');
    } finally { Date.now = real }
  });

  it('timeout de 9 s é TIMEOUT (não UNAVAILABLE) e aborta o fetch', async (t) => {
    const cpf = cpfNovo();
    t.mock.timers.enable({ timers: ['setTimeout'] });
    installFetchMock({
      routes: {
        [ROTA]: (url, init) => new Promise((_res, rej) => {
          init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
        }),
      },
    });
    const p = lookupCpf(cpf);
    t.mock.timers.tick(9000);
    await assert.rejects(p, (e) => e.code === 'TIMEOUT');
    assert.equal(fetchCalls().length, 1);
  });

  it('cancelamento do chamador repassa o AbortError original', async () => {
    const cpf = cpfNovo();
    const ctrl = new AbortController();
    installFetchMock({
      routes: {
        [ROTA]: (url, init) => new Promise((_res, rej) => {
          init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
        }),
      },
    });
    const p = lookupCpf(cpf, { signal: ctrl.signal });
    ctrl.abort();
    await assert.rejects(p, (e) => e.name === 'AbortError');
  });

  it('falha de transporte (fetch lança) vira UNAVAILABLE', async () => {
    installFetchMock({ routes: { [ROTA]: new Error('network down') } });
    await assert.rejects(lookupCpf(cpfNovo()), (e) => e.code === 'UNAVAILABLE');
  });

  it('nenhuma chamada saiu fora do mock ao longo do arquivo', async () => {
    assert.ok(fetchUrls().every((u) => String(u).startsWith('/api/cpf?cpf=')), 'todas as URLs são o proxy relativo');
  });
});
