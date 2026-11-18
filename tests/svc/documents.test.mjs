// src/services/clients.js (documentos) + src/services/settings.js — anexos cifrados e configuração legível.
import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as db from '../../src/db/idb.js';
import * as S from '../../src/services/clients.js';
import * as SET from '../../src/services/settings.js';
import { dumpStore } from '../helpers/fake-idb.mjs';
import { setupVault, lockNow } from '../helpers/vault.mjs';
import { novoClienteParaSalvar, novoArquivo, bytesFicticios, cpfFicticio } from '../helpers/fixtures.mjs';
import { mask } from '../../src/domain/validators.js';
const clienteSecundario = (n) => novoClienteParaSalvar({ name: 'João Teste', type: 'PF', doc: mask.cpf(cpfFicticio(n)) });

describe('documentos: addDoc / removeDoc', () => {
  let cliente;
  beforeEach(async () => { await setupVault(); cliente = await S.saveClient(novoClienteParaSalvar(), null) });
  after(() => lockNow());

  it('round-trip: anexa, decifra e devolve os mesmos bytes', async () => {
    await S.addDoc(cliente, novoArquivo({ name: 'contrato.txt' }), 'Identificação');
    const [doc] = await S.listDocs(cliente);
    assert.equal(doc.name, 'contrato.txt');
    assert.equal(doc.orig, 'contrato.txt');
    assert.equal(doc.category, 'Identificação');
    assert.equal(doc.type, 'text/plain');
    assert.equal(doc.size, 8);
    assert.equal(doc.converted, false);
    assert.match(doc.hash, /^[0-9a-f]{64}$/);
    assert.deepEqual([...await S.docBytes(doc)], [...bytesFicticios(8)]);
  });

  it('o `name` pode ser renomeado sem perder o `orig`', async () => {
    await S.addDoc(cliente, novoArquivo({ name: 'RG 2026-01-01.jpg', type: 'image/jpeg' }), 'Outro', 'RG');
    const [doc] = await S.listDocs(cliente);
    assert.equal(doc.name, 'RG');
    assert.equal(doc.orig, 'RG 2026-01-01.jpg');
  });

  it('documento é gravado cifrado, com clientId em claro para a listagem', async () => {
    await S.addDoc(cliente, novoArquivo(), 'Identificação');
    const [cru] = dumpStore('documents');
    assert.equal(cru.clientId, cliente);
    assert.ok(cru.data instanceof Uint8Array);
    assert.equal(JSON.stringify([...cru.data]).includes('contrato'), false);
  });

  it('o blob correspondente é cifrado e referenciado por blobId', async () => {
    await S.addDoc(cliente, novoArquivo(), 'Identificação');
    const [doc] = await S.listDocs(cliente);
    const [blob] = dumpStore('blobs');
    assert.equal(blob.id, doc.blobId);
    assert.notDeepEqual([...blob.data], [...bytesFicticios(8)]);
  });

  it('cada anexo gera um item de histórico com nome e categoria', async () => {
    await S.addDoc(cliente, novoArquivo(), 'Comprovante de endereço');
    const [h] = (await S.listHistory(cliente)).filter((x) => x.type === 'Documento incluído');
    assert.equal(h.detail, 'contrato.txt (Comprovante de endereço)');
  });

  it('removeDoc apaga documento + blob e registra a remoção', async () => {
    await S.addDoc(cliente, novoArquivo(), 'Identificação');
    const [doc] = await S.listDocs(cliente);
    await S.removeDoc(doc);
    assert.deepEqual(await S.listDocs(cliente), []);
    assert.equal((await db.getAll('blobs')).length, 0, 'o blob do documento removido tem de sumir');
    assert.ok((await S.listHistory(cliente)).some((h) => h.type === 'Documento removido'));
  });

  it('duplicata (mesmo hash, mesmo cliente) é recusada e nada extra é gravado', async () => {
    await S.addDoc(cliente, novoArquivo(), 'Identificação');
    await assert.rejects(S.addDoc(cliente, novoArquivo(), 'Outro'), /já está anexado a este cliente/);
    assert.equal((await S.listDocs(cliente)).length, 1);
    assert.equal((await db.getAll('blobs')).length, 1, 'o blob rejeitado não pode ter sobrado');
  });

  it('conhecido: o MESMO arquivo em clientes DIFERENTES é aceito (o dedupe é por cliente)', async () => {
    // ver docs/ROADMAP.md — clients.js:40 compara apenas dentro de listDocs(clientId): dois clientes com o
    // mesmo comprovante geram dois blobs cifrados separados (mesmo conteúdo, dois registros em `blobs`).
    const outro = await S.saveClient(clienteSecundario(40), null);
    await S.addDoc(cliente, novoArquivo(), 'Identificação');
    await S.addDoc(outro, novoArquivo(), 'Identificação');
    const docs = await Promise.all([S.listDocs(cliente), S.listDocs(outro)]);
    assert.equal(docs[0][0].hash, docs[1][0].hash);
    assert.notEqual(docs[0][0].blobId, docs[1][0].blobId);
    assert.equal((await db.getAll('blobs')).length, 2);
  });

  it('conhecido: mesmo nome com conteúdo diferente é aceito (a chave de dedupe é o hash, não o nome)', async () => {
    // ver docs/ROADMAP.md — 'contrato.txt' pode ser anexado N vezes com bytes distintos.
    await S.addDoc(cliente, novoArquivo({ name: 'contrato.txt' }), 'Identificação');
    await S.addDoc(cliente, novoArquivo({ name: 'contrato.txt', bytes: bytesFicticios(8, 5) }), 'Identificação');
    assert.equal((await S.listDocs(cliente)).length, 2);
  });

  it('conhecido: removeDoc aceita um objeto parcial e não valida nada (blob inexistente vira órfão)', async () => {
    // ver docs/ROADMAP.md — clients.js:43 não lê o banco antes de apagar: usa {id,blobId,clientId,name} que
    // receber. Um blobId errado gera ['delete','blobs',<inexistente>], que o IndexedDB trata como no-op.
    await S.addDoc(cliente, novoArquivo(), 'Identificação');
    const [doc] = await S.listDocs(cliente);
    await S.removeDoc({ id: doc.id, blobId: 'blob-que-nao-existe', clientId: cliente, name: doc.name });
    assert.equal((await S.listDocs(cliente)).length, 0);
    assert.equal((await db.getAll('blobs')).length, 1, 'sobrou o blob órfão e ninguém foi avisado');
  });

  it('arquivo acima de 15 MB é recusado antes de qualquer gravação', async () => {
    const gigante = { name: 'gigante.txt', type: 'text/plain', size: 15 * 1048576 + 1, arrayBuffer: async () => new Uint8Array(4) };
    await assert.rejects(S.addDoc(cliente, gigante, 'Outro'), /acima de 15 MB/);
    assert.deepEqual(await S.listDocs(cliente), []);
  });
});

describe('settings: getDueWindow / setDueWindow', () => {
  beforeEach(async () => { await setupVault() });
  after(() => lockNow());

  it('sem nada gravado a janela default é 7', async () => {
    assert.equal(await SET.getDueWindow(), 7);
  });
  it('setDueWindow grava e devolve o valor', async () => {
    await SET.setDueWindow(15);
    assert.equal(await SET.getDueWindow(), 15);
    await SET.setDueWindow(0);
    assert.equal(await SET.getDueWindow(), 0, 'janela 0 é valor legítimo: só hoje conta como "soon"');
  });
  it('settings NÃO é cifrado: fica legível mesmo com o cofre bloqueado', async () => {
    await SET.setDueWindow(21);
    lockNow('teste');
    assert.deepEqual(dumpStore('settings').find((s) => s.key === 'dueWindow'), { key: 'dueWindow', value: 21 });
    await setupVault();
  });
  it('conhecido: setDueWindow aceita lixo (string) e a janela deixa de funcionar', async () => {
    // ver docs/ROADMAP.md — settings.js:3 grava `value` sem validação e due.status() faz `n <= win`:
    // com win='abc' a comparação é sempre false, então NADA é marcado "prestes a vencer".
    await SET.setDueWindow('abc');
    assert.equal(await SET.getDueWindow(), 'abc');
    const { status } = await import('../../src/domain/due.js');
    assert.equal(status('2026-11-15', await SET.getDueWindow(), '2026-11-14'), 'ok', 'venceria amanhã e não é "soon"');
    assert.equal(status('2026-11-13', await SET.getDueWindow(), '2026-11-14'), 'overdue', 'vencida ainda é detectada');
  });
  it('conhecido: null cai no default 7 no get, mas o null continua gravado na store', async () => {
    // ver docs/ROADMAP.md — o resgate é `?? 7` (settings.js:2), só para null/undefined.
    await SET.setDueWindow(null);
    assert.equal(await SET.getDueWindow(), 7);
    assert.equal(dumpStore('settings').find((s) => s.key === 'dueWindow').value, null);
  });
  it('idleMinutes vive na mesma store e é escrito pelo setup do cofre (auth.js:21)', async () => {
    assert.deepEqual(dumpStore('settings').find((s) => s.key === 'idleMinutes').value, 5);
  });
});
