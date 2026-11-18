// src/services/records.js + src/db/idb.js sobre o IndexedDB falso, com o cofre REAL destravado.
// Camada (b) da auditoria: exige harness, mas exercita o código de produção sem nenhuma cópia de lógica.
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as db from '../../src/db/idb.js';
import * as rec from '../../src/services/records.js';
import * as C from '../../src/security/crypto.js';
import { dumpStore } from '../helpers/fake-idb.mjs';
import { watchGlobalEvent } from '../helpers/dom.mjs';
import { setupVault, lockNow, getKey } from '../helpers/vault.mjs';
import { novoClienteFicticio, novaDividaFicticia, bytesFicticios } from '../helpers/fixtures.mjs';

describe('records: round-trip cifrado', () => {
  before(async () => { await setupVault() });
  after(() => lockNow());

  it('uid() devolve UUIDs diferentes (crypto.randomUUID nativo do Node 22)', () => {
    assert.notEqual(rec.uid(), rec.uid());
    assert.match(rec.uid(), /^[0-9a-f]{8}-[0-9a-f]{4}/);
  });

  it('enc + list devolvem o objeto com os campos em claro prometidos no cabeçalho', async () => {
    const c = novoClienteFicticio();
    await db.batch([await rec.enc('clients', c)]);
    const lista = await rec.list('clients');
    assert.equal(lista.length, 1);
    assert.equal(lista[0].id, c.id);
    assert.equal(lista[0].createdAt, c.createdAt);
    assert.equal(lista[0].name, c.name);
    assert.equal(lista[0].doc, c.doc);
  });

  it('one() acha pelo id e devolve undefined para id inexistente', async () => {
    const c = novoClienteFicticio({ id: 'cliente-um' });
    await db.batch([await rec.enc('clients', c)]);
    assert.equal((await rec.one('clients', 'cliente-um')).id, 'cliente-um');
    assert.equal(await rec.one('clients', 'nao-existe'), undefined);
  });

  it('campos além de id/createdAt/clientId ficam CIFRADOS na store', async () => {
    const d = novaDividaFicticia({ id: 'divida-um', clientId: 'cliente-um' });
    await db.batch([await rec.enc('debts', d)]);
    const crua = dumpStore('debts').find((r) => r.id === 'divida-um');
    assert.deepEqual(Object.keys(crua).sort(), ['clientId', 'createdAt', 'data', 'id']);
    assert.ok(crua.data instanceof Uint8Array, 'o restante vira um blob opaco em `data`');
    const serializado = JSON.stringify(dumpStore('debts'));
    assert.equal(serializado.includes('Empréstimo pessoal'), false, 'a descrição não pode aparecer em claro');
    assert.equal(dumpStore('debts')[0].clientId, 'cliente-um', 'clientId fica em claro de propósito (índice)');
  });

  it('sem clientId a coluna em claro é omitida (stores de cliente)', async () => {
    await db.batch([await rec.enc('clients', novoClienteFicticio({ id: 'sem-clientid' }))]);
    assert.equal('clientId' in dumpStore('clients').find((r) => r.id === 'sem-clientid'), false);
  });

  it('blob round-trip: blobOp + blobBytes preservam byte a byte', async () => {
    const original = bytesFicticios(64, 3);
    await db.batch([await rec.blobOp('blob-um', original)]);
    const crua = dumpStore('blobs').find((b) => b.id === 'blob-um');
    assert.deepEqual(Object.keys(crua).sort(), ['data', 'id']);
    assert.notDeepEqual([...crua.data], [...original], 'o blob é gravado cifrado');
    const volta = await rec.blobBytes('blob-um');
    assert.deepEqual([...volta], [...original]);
  });

  it('blobBytes de id inexistente rejeita (não devolve undefined silencioso)', async () => {
    await assert.rejects(rec.blobBytes('nao-existe'));
  });

  it('hist() grava tipo/detail cifrados e clientId/createdAt em claro', async () => {
    await db.batch([await rec.hist('cliente-um', 'Cadastro de cliente', 'detalhe fictício')]);
    const [h] = await rec.list('history');
    assert.equal(h.clientId, 'cliente-um');
    assert.equal(h.type, 'Cadastro de cliente');
    assert.equal(h.detail, 'detalhe fictício');
    assert.equal(typeof h.createdAt, 'number');
  });

  it('conhecido: o índice "at" da store history nunca é preenchido (records.js:10 grava createdAt)', async () => {
    // ver docs/ROADMAP.md — src/db/idb.js:8 cria idx('history','clientId','at'), mas hist() grava `createdAt`.
    // Nada em src/ consulta esse índice hoje, então o sintoma é silencioso: a coluna 'at' simplesmente não existe.
    await db.batch([await rec.hist('cliente-um', 'Índice ausente')]);
    const crua = dumpStore('history').find((h) => h.data);
    assert.equal('at' in crua, false);
    assert.equal('createdAt' in crua, true);
  });

  it('list() de store vazia devolve array vazio', async () => {
    assert.deepEqual(await rec.list('documents'), []);
  });
});

describe('records: cofre bloqueado', () => {
  beforeEach(async () => { await setupVault() });
  after(() => lockNow());

  it('enc/list com a sessão bloqueada lançam "Sessão bloqueada." (auth.js:14)', async () => {
    await db.batch([await rec.enc('clients', novoClienteFicticio({ id: 'antes-do-bloqueio' }))]);
    lockNow('teste');
    assert.equal((await db.getAll('clients')).length, 1, 'o registro cifrado continua no disco');
    await assert.rejects(rec.list('clients'), /Sessão bloqueada/);
    await assert.rejects(rec.enc('clients', { id: 'x', name: 'Maria Exemplo' }), /Sessão bloqueada/);
  });

  it('o que foi cifrado com a DEK de um cofre não abre com a DEK de outro', async () => {
    const dekAntiga = getKey();
    const selado = await C.sealJSON(dekAntiga, { nome: 'Maria Exemplo' });
    await setupVault('Outra-Senha-Forte-2');            // outro cofre => outra DEK
    assert.notEqual(getKey(), dekAntiga);
    await assert.rejects(C.openJSON(getKey(), selado), 'a tag GCM precisa recusar a chave errada');
  });
});

describe('idb: o que é gravado em CLARO (characterization — records.js:4-7 vs settings/meta)', () => {
  beforeEach(async () => { await setupVault() });
  after(() => lockNow());

  it('settings é chave/valor SEM cifra: a janela de vencimento fica legível no banco', async () => {
    await db.put('settings', { key: 'dueWindow', value: 15 });
    assert.deepEqual(dumpStore('settings').find((s) => s.key === 'dueWindow'), { key: 'dueWindow', value: 15 });
  });
  it('meta guarda o cofre (salt/iv/wrapped/iter) e a sessão com a própria CryptoKey em claro no registo', async () => {
    const chaves = dumpStore('meta').map((m) => m.key).sort();
    assert.deepEqual(chaves, ['session', 'vault']);
    const sessao = dumpStore('meta').find((m) => m.key === 'session');
    assert.equal(sessao.dek.algorithm.name, 'AES-GCM');      // CryptoKey sobreviveu ao structuredClone do put
    assert.equal(sessao.dek.extractable, false);
  });
  it('as colunas indexáveis (id/createdAt/clientId) são em claro por contrato de índice', async () => {
    await db.batch([await rec.enc('documents', { id: 'd1', clientId: 'c1', createdAt: 111, name: 'contrato.txt', hash: 'h' })]);
    const crua = dumpStore('documents')[0];
    assert.deepEqual({ id: crua.id, clientId: crua.clientId, createdAt: crua.createdAt }, { id: 'd1', clientId: 'c1', createdAt: 111 });
    assert.equal(crua.name, undefined, 'name está dentro de `data`, não na coluna');
  });
  it('put() grava por VALOR (structuredClone): mutar o objeto depois não muda o banco', async () => {
    const obj = { key: 'mutavel', value: 1 };
    await db.put('settings', obj);
    obj.value = 999;
    assert.equal((await db.get('settings', 'mutavel')).value, 1);
  });
});

describe('idb.batch: data-changed é emitido SÓ pelo batch (characterization)', () => {
  beforeEach(async () => { await setupVault() });
  after(() => lockNow());

  it('db.batch dispara exatamente um data-changed por lote', async () => {
    const antes = watchGlobalEvent('data-changed');
    await db.batch([await rec.enc('clients', novoClienteFicticio({ id: 'b1' }))]);
    assert.equal(antes.count, 1);
    await db.batch([await rec.enc('clients', novoClienteFicticio({ id: 'b2' })), await rec.enc('clients', novoClienteFicticio({ id: 'b3' }))]);
    assert.equal(antes.count, 2, 'três gravações, dois eventos: o evento é por transação, não por registro');
    antes.stop();
  });

  it('db.put e db.del NÃO disparam data-changed — telas reativas só atualizam via batch', async () => {
    // conhecido: ver docs/ROADMAP.md — idb.js:22-25 (get/put/del) não emitem o evento; só idb.js:30 (batch).
    // src/services/settings.js:3 (setDueWindow) usa db.put, então mudar a janela NÃO re-renderiza a UI.
    const ouvinte = watchGlobalEvent('data-changed');
    await db.put('settings', { key: 'dueWindow', value: 9 });
    await db.del('settings', 'dueWindow');
    await db.batch([await rec.enc('clients', novoClienteFicticio({ id: 'c-um' }))]);
    assert.equal(ouvinte.count, 1, 'put+del juntos não emitem nada; o batch emite 1');
    ouvinte.stop();
  });

  it('batch com lista vazia não grava nem emite evento', async () => {
    const ouvinte = watchGlobalEvent('data-changed');
    assert.equal(await db.batch([]), undefined);
    assert.equal(ouvinte.count, 0);
    ouvinte.stop();
  });

  it('tudo ou nada: falha injetada em put faz a transação inteira não persistir', async () => {
    const { failNext } = await import('../helpers/fake-idb.mjs');
    const ops = [
      await rec.enc('clients', novoClienteFicticio({ id: 'persiste-nao-1' })),
      await rec.enc('clients', novoClienteFicticio({ id: 'persiste-nao-2' })),
    ];
    failNext('put');
    await assert.rejects(db.batch(ops));
    const ids = (await rec.list('clients')).map((c) => c.id);
    assert.deepEqual(ids.filter((i) => String(i).startsWith('persiste-nao')), [], 'nenhum dos dois pode ter ficado');
  });

  it('DB_VERSION casa com o schema criado (1 migration, 7 stores)', async () => {
    assert.equal(db.DB_VERSION, 1);
    const conexoes = await db.openDB();
    assert.deepEqual(['meta', 'settings', 'clients', 'debts', 'documents', 'blobs', 'history']
      .map((s) => [s, conexoes.objectStoreNames.contains(s)]).filter(([, ok]) => !ok), []);
  });

  it('durability:"strict" é ACEITO E IGNORADO pelo harness (não prova disco)', async () => {
    // conhecido: ver docs/ROADMAP.md — garantia de durabilidade real é camada (c), em navegador.
    await db.batch([await rec.enc('clients', novoClienteFicticio({ id: 'duravel' }))]);
    assert.equal((await rec.one('clients', 'duravel')).id, 'duravel');
  });
});
