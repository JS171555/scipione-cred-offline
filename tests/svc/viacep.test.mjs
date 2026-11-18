// src/services/viacep.js — consulta de CEP (6 códigos de erro, cache sem TTL nem limite). Usado por
// src/ui/clients.js no preenchimento automático de endereço. Cobertura antes deste arquivo: 0% — nenhum
// teste carregava o módulo (docs/ROADMAP.md:390 lista "viacep.js (6 códigos)" como descoberto).
//
// Zero rede: helpers/fetch-mock.mjs substitui globalThis.fetch e o default é NEGAR rota desconhecida.
// A rota é cadastrada pela curinga '*' por dois motivos: (1) o helper monta as rotas com Object.entries,
// e chave computada é coagida para STRING — função/RegExp como chave nunca casariam; (2) escrever o host
// real do ViaCEP neste arquivo violaria tests/contracts/no-egress.test.mjs. O que se confere então é o
// CAMINHO da URL ('/ws/<8 dígitos>/json/'), sem copiar o host para o teste.
//
// Estado do módulo: `cache` (viacep.js:4) é um Map privado, sem TTL e sem capacidade, e não é exportado.
// Cada caso usa um CEP distinto (novoCep) para não ser servido por uma gravação anterior — é isso que
// torna os testes independentes entre si e o teste do cache determinístico.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installFetchMock, uninstallFetchMock, fetchCalls, fetchUrls, deniedCalls } from '../helpers/fetch-mock.mjs';
import { setOnline } from '../helpers/dom.mjs';
import { lookupCep } from '../../src/services/viacep.js';

const ROTA = '*';                        // curinga: casa qualquer URL (ver header)
let seq = 0;
const novoCep = () => String(41000000 + seq++);             // 8 dígitos, nunca '00000000', nunca repetido
const mascarado = (d) => d.slice(0, 5) + '-' + d.slice(5);  // 41000000 -> 41000-000
const caminhoDe = (d) => '/ws/' + d + '/json/';

// Resposta no shape cru do ViaCEP: nomes de campo reais, valores 100% fictícios.
const crua = (over = {}) => ({
  status: 200,
  json: {
    cep: '41000000', logradouro: 'Rua Maria Exemplo', bairro: 'Bairro Teste',
    localidade: 'Cidade Exemplo', uf: 'sp', ibge: '0000000', ddd: '41', gia: '9999999',
    ...over,
  },
});

// Upstream lento: a promessa só rejeita (AbortError) quando o AbortController interno de viacep.js:11 é
// abortado — pelo timer de timeout ou pelo `signal` do chamador.
const pendenteAteAbort = () => (url, init) => new Promise((_res, rej) => {
  const abortar = () => rej(Object.assign(new Error('the operation was aborted'), { name: 'AbortError' }));
  if (init && init.signal && init.signal.aborted) abortar();
  else init.signal.addEventListener('abort', abortar, { once: true });
});

describe('services/viacep.js — lookupCep', () => {
  beforeEach(() => { installFetchMock({ routes: {} }); setOnline(true) });
  afterEach(() => { uninstallFetchMock(); setOnline(true) });

  it('mapeia a resposta do ViaCEP para {cep,street,district,city,state} e normaliza o UF', async () => {
    const d = novoCep();
    installFetchMock({ routes: { [ROTA]: crua({ cep: d, uf: 'sp' }) } });
    assert.deepEqual(await lookupCep(d), {
      cep: mascarado(d), street: 'Rua Maria Exemplo', district: 'Bairro Teste',
      city: 'Cidade Exemplo', state: 'SP',
    });
    assert.equal(fetchCalls().length, 1);
    assert.ok(fetchUrls().at(-1).endsWith(caminhoDe(d)), 'a URL chama /ws/<8 dígitos>/json/');
  });

  it('aceita entrada mascarada e consulta por 8 dígitos', async () => {
    const d = novoCep();
    installFetchMock({ routes: { [ROTA]: crua({ cep: d, uf: 'PR' }) } });
    const out = await lookupCep(mascarado(d));
    assert.equal(out.cep, mascarado(d));
    assert.equal(out.state, 'PR');
    assert.ok(fetchUrls().at(-1).includes(caminhoDe(d)), 'a máscara cai antes de montar a URL');
  });

  it('campos ausentes viram string vazia e o CEP consultado entra como fallback', async () => {
    const d = novoCep();
    installFetchMock({ routes: { [ROTA]: { status: 200, json: { logradouro: '', uf: 'rj' } } } });
    assert.deepEqual(await lookupCep(d), { cep: mascarado(d), street: '', district: '', city: '', state: 'RJ' });
  });

  it('CEP inválido é recusado localmente, sem tocar na rede', async () => {
    installFetchMock({ routes: { [ROTA]: crua() } });
    const lixos = ['4100000', '00000000', '0000-0000', '', '   ', 'ab.cd-ef', null, undefined, {}, '410000000'];
    for (const lixo of lixos) {
      await assert.rejects(lookupCep(lixo), (e) => e.code === 'INVALID', 'aceitou ' + String(lixo));
    }
    assert.equal(fetchCalls().length, 0, 'a guarda de viacep.js:8 decide antes de qualquer fetch');
    assert.deepEqual(deniedCalls(), []);
  });

  it('offline (navigator.onLine === false) é OFFLINE e não tenta a rede', async () => {
    setOnline(false);
    await assert.rejects(lookupCep(novoCep()), (e) => e.code === 'OFFLINE');
    assert.equal(fetchCalls().length, 0, 'viacep.js:10 corta antes do fetch');
    setOnline(true);
    await assert.rejects(lookupCep(novoCep()), (e) => e.code === 'NETWORK', 'de volta online, a rota negada vira NETWORK');
  });

  it('timeout customizado (timer curto) é TIMEOUT, não UNAVAILABLE', async () => {
    installFetchMock({ routes: { [ROTA]: pendenteAteAbort() } });
    await assert.rejects(lookupCep(novoCep(), { timeout: 15 }), (e) => e.code === 'TIMEOUT');
    assert.equal(fetchCalls().length, 1);
  });

  it('o timeout padrão de 8 s é TIMEOUT sem esperar 8 s reais (mock.timers)', async (t) => {
    t.mock.timers.enable({ timers: ['setTimeout'] });
    installFetchMock({ routes: { [ROTA]: pendenteAteAbort() } });
    const p = lookupCep(novoCep());
    let assentado = false;
    p.catch(() => { assentado = true });
    t.mock.timers.tick(7999);
    await Promise.resolve();
    assert.equal(assentado, false, 'antes dos 8000 ms nada expira');
    t.mock.timers.tick(1);
    await assert.rejects(p, (e) => e.code === 'TIMEOUT');
    assert.equal(fetchCalls().length, 1);
  });

  it('falha de transporte (fetch lança) vira NETWORK', async () => {
    installFetchMock({ routes: { [ROTA]: new Error('socket hang up') } });
    await assert.rejects(lookupCep(novoCep()), (e) => e.code === 'NETWORK');
  });

  it('HTTP não-OK vira UNAVAILABLE', async () => {
    for (const status of [500, 503, 429]) {
      installFetchMock({ routes: { [ROTA]: { status, text: 'oops' } } });
      await assert.rejects(lookupCep(novoCep()), (e) => e.code === 'UNAVAILABLE', 'status ' + status);
    }
  });

  it('corpo {erro:true} e {erro:"true"} são NOT_FOUND', async () => {
    installFetchMock({ routes: { [ROTA]: { status: 200, json: { erro: true } } } });
    await assert.rejects(lookupCep(novoCep()), (e) => e.code === 'NOT_FOUND');
    installFetchMock({ routes: { [ROTA]: { status: 200, json: { erro: 'true' } } } });
    await assert.rejects(lookupCep(novoCep()), (e) => e.code === 'NOT_FOUND');
  });

  it('JSON imprestável (corpo não parseável) vira INVALID_RESPONSE', async () => {
    installFetchMock({ routes: { [ROTA]: { status: 200, text: 'não é json', headers: { 'Content-Type': 'text/plain' } } } });
    await assert.rejects(lookupCep(novoCep()), (e) => e.code === 'INVALID_RESPONSE');
  });

  it('conhecido: um `erro` fora de true/"true" é tratado como achado e devolve endereço em branco', async () => {
    const d = novoCep();
    installFetchMock({ routes: { [ROTA]: { status: 200, json: { erro: 'sim' } } } });
    // conhecido: ver docs/ROADMAP.md — viacep.js:31 só reconhece erro === true ou 'true'; qualquer outro
    // valor (ou campo ausente) passa, e :32 monta o shape com tudo vazio. A tela recebe "sucesso" vazio
    // em vez de NOT_FOUND. Characterization do comportamento real, não do desejado.
    assert.deepEqual(await lookupCep(d), { cep: mascarado(d), street: '', district: '', city: '', state: '' });
  });

  it('cache do módulo: a segunda consulta do mesmo CEP não faz rede — e nunca expira', async () => {
    const d = novoCep();
    installFetchMock({ routes: { [ROTA]: crua({ cep: d, logradouro: 'Rua Maria Exemplo' }) } });
    const primeira = await lookupCep(d);
    assert.equal(fetchCalls().length, 1);

    const segunda = await lookupCep(d);
    assert.equal(fetchCalls().length, 1, 'viacep.js:9 serve do Map antes de checar online/rede');
    assert.equal(segunda, primeira, 'CARACTERIZAÇÃO: devolve a MESMA instância do objeto, sem cópia');

    // conhecido: ver docs/ROADMAP.md:139 — `cache` (viacep.js:4, gravado em :33) é um Map sem TTL e sem
    // capacidade máxima, não limpo em onLock (ao contrário dos 30 min de apicpf.js:3). Aqui o relógio
    // avança um ano e nada muda: a entrada vive para sempre no processo.
    const real = Date.now;
    Date.now = () => real() + 365 * 24 * 3600 * 1000;
    try {
      await lookupCep(d);
      assert.equal(fetchCalls().length, 1, 'CARACTERIZAÇÃO: um ano depois continua servindo o mesmo cache');
    } finally { Date.now = real }

    installFetchMock({ routes: { [ROTA]: crua({ cep: d, logradouro: 'Rua Conteudo Diferente' }) } });
    const terceira = await lookupCep(d);
    assert.equal(terceira.street, 'Rua Maria Exemplo', 'a resposta nova da rede nunca é lida');
  });

  it('offline depois do cache: a gravação pré-existente vence a checagem de conexão', async () => {
    const d = novoCep();
    installFetchMock({ routes: { [ROTA]: crua({ cep: d }) } });
    await lookupCep(d);
    setOnline(false);
    const out = await lookupCep(d);                       // :9 antes de :10 → não é OFFLINE
    assert.equal(out.cep, mascarado(d));
    assert.equal(fetchCalls().length, 1, 'nenhuma requisição extra');
  });

  it('signal externo abortado repassa o AbortError original (abortado durante e já abortado antes)', async () => {
    installFetchMock({ routes: { [ROTA]: pendenteAteAbort() } });

    const ctrl = new AbortController();
    const durante = lookupCep(novoCep(), { signal: ctrl.signal });
    ctrl.abort();
    await assert.rejects(durante, (e) => e.name === 'AbortError' && e.code === undefined,
      'viacep.js:21 relança o erro sem código de negócio');

    const ja = new AbortController();
    ja.abort();
    await assert.rejects(lookupCep(novoCep(), { signal: ja.signal }), (e) => e.name === 'AbortError');
    assert.equal(fetchCalls().length, 2, 'as duas vias passam pelo fetch antes de abortar');
  });

  it('conhecido: chamador e timeout compartilham um só AbortController; decide a flag timedOut', async () => {
    // viacep.js:13-14 encadeia o `signal` do chamador no AbortController interno e :19-21 decide pela flag
    // `timedOut`: abort do timer vira TIMEOUT, abort do chamador é relançado cru. Não existe estado
    // combinado — se os dois ocorressem no mesmo tique, a flag já escrita antes vence.
    const d = novoCep();
    const ctrl = new AbortController();
    installFetchMock({ routes: { [ROTA]: pendenteAteAbort() } });
    const p = lookupCep(d, { signal: ctrl.signal, timeout: 5 });
    ctrl.abort();
    await assert.rejects(p, (e) => e.name === 'AbortError');   // chamador abortou antes do timer
  });
});
