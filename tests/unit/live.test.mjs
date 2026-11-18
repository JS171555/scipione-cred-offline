// src/core/live.js — 4 linhas que são o único mecanismo de re-pintura reativa do app: é importado por
// src/main.js e por 7 telas (clientlist, clients, dashboard, debtspage, settings, tools), e nada no app
// chama db.batch sem passar por aqui. Cobertura antes deste arquivo: 0% (nenhum teste carregava o módulo).
//
// Camada coberta: só o roteamento do evento global 'data-changed' → callback único, e o contrato de
// registro/substituição. O EMITOR (src/db/idb.js:30, só em db.batch) é coberto em tests/svc/records.test.mjs;
// as telas (quem registra o callback) são camada (c) — dependem de pintura real.
//
// Por que o stub vem antes do import: live.js:2 chama addEventListener NO TOPO do módulo. helpers/dom.mjs
// instala globalThis.addEventListener/dispatchEvent na avaliação do import, então ele precisa ser o
// primeiro import deste arquivo (Node 22 puro não tem nenhum dos dois — medido).
//
// NÃO chamamos resetDom() aqui: resetDom() remove os listeners registrados no alvo global, e o de live.js
// só existe porque foi instalado em tempo de import — removê-lo seria irreversível neste processo (o
// módulo não exporta um meio de registrar de novo).
import '../helpers/dom.mjs';
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { globalEvents, watchGlobalEvent } from '../helpers/dom.mjs';
import { watch, unwatch } from '../../src/core/live.js';

// Dispara no MESMO alvo que o stub instala para window/document (globalThis === window no harness).
const disparo = (type = 'data-changed') => window.dispatchEvent(new Event(type));

// Espião com contagem: fn.n
const espio = () => { const fn = () => { fn.n++ }; fn.n = 0; return fn };

describe('core/live.js — observador único de data-changed', () => {
  after(() => unwatch());   // não deixa callback pendurado para outros testes deste processo

  it('a API pública são apenas watch e unwatch (não existe multiplexação de observadores)', async () => {
    const mod = await import('../../src/core/live.js');
    assert.deepEqual(Object.keys(mod).sort(), ['unwatch', 'watch']);
    assert.equal(typeof mod.watch, 'function');
    assert.equal(typeof mod.unwatch, 'function');
  });

  it('watch instala o callback e o SEGUNDO registro derruba o primeiro', () => {
    const a = espio(), b = espio();
    try {
      watch(a);
      disparo();
      assert.equal(a.n, 1, 'o callback registrado é chamado pelo evento global');
      assert.equal(b.n, 0);

      watch(b);                 // live.js:3 `cb=f` — sobrescreve, sem dessregistar nada
      disparo();
      // conhecido: ver docs/ROADMAP.md (item que cita live.js:2 guardando um só callback, com o form de
      // dívida registrando `load()` sem dessregistar — docs/ROADMAP.md:338, status NÃO CONFIRMADO lá).
      // Comportamento atual: o observador anterior perde o sinal em vez de receber junto.
      assert.equal(a.n, 1, 'CARACTERIZAÇÃO: o callback substituído deixa de ser chamado (a.n não aumentou)');
      assert.equal(b.n, 1, 'o callback novo recebe o disparo');
    } finally { unwatch() }
  });

  it('um disparo chama o callback UMA vez por registro (o listener global não se acumula)', () => {
    const s = espio();
    try {
      watch(s); watch(s); watch(s);   // três registros do mesmo callback
      disparo();
      assert.equal(s.n, 1, 'só existe um listener global (live.js:2 roda uma vez no import)');
      disparo();
      assert.equal(s.n, 2, 'cada disparo chama exatamente uma vez');
    } finally { unwatch() }
  });

  it('o disparo em window do evento data-changed chama o callback de forma síncrona', () => {
    const s = espio();
    const probe = watchGlobalEvent('data-changed');
    try {
      watch(s);
      assert.equal(s.n, 0, 'nada é chamado antes do evento');
      disparo();
      assert.equal(s.n, 1, 'a chamada é síncrona: sem microtask/markup entre o evento e a pintura');
      assert.equal(probe.count, 1, 'o evento passou pelo alvo global que o stub compartilha com window');
      assert.equal(probe.last?.type, 'data-changed');
    } finally { unwatch(); probe.stop() }
  });

  it('outros eventos globais não acionam o observador', () => {
    const s = espio();
    try {
      watch(s);
      for (const tipo of ['resize', 'visibilitychange', 'storage', 'online', 'offline']) disparo(tipo);
      assert.equal(s.n, 0, 'live.js escuta exclusivamente data-changed');
      disparo('data-changed');
      assert.equal(s.n, 1);
    } finally { unwatch() }
  });

  it('unwatch zera o callback, mas o listener global continua registrado', () => {
    const a = espio();
    watch(a);
    unwatch();                       // live.js:3 `cb=null` — não removeEventListener
    assert.doesNotThrow(() => disparo(), 'disparar sem callback é no-op (cb?.() em live.js:2)');
    assert.equal(a.n, 0, 'depois de unwatch nada é chamado');

    // Prova de que o listener global de live.js:2 sobreviveu: basta registrar de novo para voltar a
    // receber. Se unwatch tivesse removido o listener, o novo callback nunca seria chamado.
    const b = espio();
    watch(b);
    disparo();
    assert.equal(b.n, 1, 'o listener instalado no import continua no alvo global (nunca é removido)');
    assert.ok(globalEvents(), 'o alvo global do harness segue vivo');
    unwatch();
  });

  it('exceção do callback é engolida e registrada em console.warn', () => {
    const real = console.warn;
    const vistos = [];
    const boom = new Error('pintura explodiu');
    console.warn = (...args) => { vistos.push(args) };
    try {
      watch(() => { throw boom });
      assert.doesNotThrow(() => disparo(), 'o try/catch de live.js:2 protege o emissor (db.batch)');
      assert.equal(vistos.length, 1, 'a exceção não é silenciada: vai para console.warn');
      assert.equal(vistos[0][0], boom, 'console.warn recebe o próprio Error');
    } finally {
      console.warn = real;
      unwatch();
    }
  });

  it('sem observador (cb null) o evento é consumido sem efeito colateral', () => {
    const real = console.warn;
    const vistos = [];
    console.warn = (...args) => { vistos.push(args) };
    try {
      unwatch();
      disparo(); disparo();
      assert.equal(vistos.length, 0, 'nenhum warn quando não há callback');
    } finally { console.warn = real }
  });
});
