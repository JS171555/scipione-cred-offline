// src/services/clients.js — CRUD sobre o IndexedDB falso com o cofre REAL destravado.
// Cada caso ganha um cofre/banco novos (beforeEach): são ~250 ms de PBKDF2 por cofre, e isolamento vale o tempo.
import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as db from '../../src/db/idb.js';
import * as S from '../../src/services/clients.js';
import * as rec from '../../src/services/records.js';
import { dumpStore } from '../helpers/fake-idb.mjs';
import { setupVault, lockNow } from '../helpers/vault.mjs';
import { novoClienteParaSalvar, novoArquivo, bytesFicticios, TELEFONE_CELULAR } from '../helpers/fixtures.mjs';

// Semeia uma foto sem passar por files/process.js: a conversão de imagem exige createImageBitmap (camada (c),
// ver helpers/dom.mjs), então o blob de foto é montado pelas API públicas de gravação do próprio app.
async function semearFoto(clientId, blobId = 'foto-semeada') {
  const atual = await S.getClient(clientId);
  await db.batch([await rec.blobOp(blobId, bytesFicticios(12, 5)),
    await rec.enc('clients', { ...atual, photoId: blobId, photoType: 'image/webp' })]);
  return S.getClient(clientId);
}

describe('clients: saveClient criação vs edição', () => {
  beforeEach(async () => { await setupVault() });
  after(() => lockNow());

  it('criação devolve um id novo, grava 1 cliente e 1 item de histórico', async () => {
    const id = await S.saveClient(novoClienteParaSalvar(), null);
    assert.match(id, /[0-9a-f-]{36}/);
    assert.equal((await S.listClients()).length, 1);
    assert.equal((await db.getAll('history')).length, 1);
    const [h] = await S.listHistory(id);
    assert.equal(h.type, 'Cadastro de cliente');
    assert.equal(h.detail, '');
  });

  it('edição preserva id e createdAt, atualiza updatedAt e não repete o histórico de cadastro', async () => {
    const criado = await S.saveClient(novoClienteParaSalvar({ name: 'Maria Exemplo' }), null);
    const antes = await S.getClient(criado);
    const depois = await S.saveClient(novoClienteParaSalvar({ name: 'Maria Exemplo Silva' }), antes);
    assert.equal(depois, criado, 'editar não pode gerar novo id');
    const salvo = await S.getClient(criado);
    assert.equal(salvo.name, 'Maria Exemplo Silva');
    assert.equal(salvo.createdAt, antes.createdAt, 'createdAt é o do cadastro original');
    assert.ok(salvo.updatedAt >= antes.updatedAt);
    assert.equal((await S.listClients()).length, 1);
    const tipos = (await S.listHistory(criado)).map((h) => h.type);
    assert.ok(tipos.includes('Alteração de dados'));
    assert.equal(tipos.filter((t) => t === 'Cadastro de cliente').length, 1);
  });

  it('o histórico da edição lista só os rótulos dos campos que mudaram', async () => {
    const id = await S.saveClient(novoClienteParaSalvar(), null);
    const atual = await S.getClient(id);
    await S.saveClient({ ...atual, phone: TELEFONE_CELULAR, email: 'joao.teste@exemplo.invalid' }, atual);
    const [h] = (await S.listHistory(id)).filter((x) => x.type === 'Alteração de dados');
    assert.equal(h.detail, 'Telefone, E-mail');
  });

  it('edição sem mudança real não gera item de histórico', async () => {
    const id = await S.saveClient(novoClienteParaSalvar(), null);
    const atual = await S.getClient(id);
    await S.saveClient({ ...atual }, atual);
    assert.equal((await S.listHistory(id)).filter((x) => x.type === 'Alteração de dados').length, 0);
    assert.equal((await S.listHistory(id)).length, 1);
  });

  it('validação quebra lança .errs e não grava absolutamente nada', async () => {
    await assert.rejects(S.saveClient(novoClienteParaSalvar({ doc: '111.444.777-36' }), null),
      (e) => e.errs.doc === 'CPF inválido.');
    assert.deepEqual(await S.listClients(), []);
    assert.deepEqual(await db.getAll('history'), []);
    assert.equal((await db.getAll('clients')).length, 0);
  });

  it('CPF duplicado entre clientes é recusado citando quem já tem o documento', async () => {
    await S.saveClient(novoClienteParaSalvar({ name: 'Maria Exemplo' }), null);
    await assert.rejects(S.saveClient(novoClienteParaSalvar({ name: 'João Teste' }), null),
      (e) => /Já cadastrado para Maria Exemplo/.test(e.errs.doc));
  });

  it('getClient de id inexistente devolve undefined', async () => {
    assert.equal(await S.getClient('não-existe'), undefined);
  });
});

describe('clients: fotografia (ramo que depende de files/process.js)', () => {
  beforeEach(async () => { await setupVault() });
  after(() => lockNow());

  it('photo.file com arquivo que não é imagem é recusado e nada é gravado', async () => {
    await assert.rejects(S.saveClient(novoClienteParaSalvar(), null, { file: novoArquivo({ name: 'doc.txt' }) }),
      /Selecione uma imagem/);
    assert.equal((await S.listClients()).length, 0);
    assert.equal((await db.getAll('blobs')).length, 0);
  });

  it('photo.file com imagem exige createImageBitmap: em Node o app falha com "Não foi possível ler esta imagem."', async () => {
    // Conhecido LIMITES DO HARNESS: a conversão (resize + WebP, files/process.js:10-14) é camada (c) — o
    // stub de DOM não implementa canvas de propósito (helpers/dom.mjs, cabeçalho). Este teste documenta que o
    // ramo força=true lança em vez de degradar silenciosamente, e que a transação não deixa resíduo.
    await assert.rejects(S.saveClient(novoClienteParaSalvar(), null,
      { file: novoArquivo({ name: 'foto.png', type: 'image/png' }) }), /Não foi possível ler esta imagem/);
    assert.equal((await db.getAll('blobs')).length, 0);
  });

  it('photo.remove apaga o blob da foto, limpa photoId/photoType e registra no histórico', async () => {
    const id = await S.saveClient(novoClienteParaSalvar(), null);
    const comFoto = await semearFoto(id);
    assert.ok(comFoto.photoId && (await db.getAll('blobs')).length === 1);
    await S.saveClient({ ...comFoto }, comFoto, { remove: true });
    const final = await S.getClient(id);
    assert.equal(final.photoId, null);
    assert.equal(final.photoType, null);
    assert.equal((await db.getAll('blobs')).length, 0, 'o blob da foto removida tem de sumir');
    assert.ok((await S.listHistory(id)).some((h) => h.type === 'Fotografia removida'));
  });

  it('remove sem foto é no-op', async () => {
    const id = await S.saveClient(novoClienteParaSalvar(), null);
    const atual = await S.getClient(id);
    await S.saveClient({ ...atual }, atual, { remove: true });
    assert.equal((await S.getClient(id)).photoId, null);
    assert.equal((await db.getAll('blobs')).length, 0);
  });
});

describe('clients: counts e deleteClient em cascata', () => {
  let id;
  beforeEach(async () => {
    await setupVault();
    id = await S.saveClient(novoClienteParaSalvar(), null);
    await semearFoto(id);
    await S.addDoc(id, novoArquivo({ name: 'contrato.txt' }), 'Identificação');
    await S.addDoc(id, novoArquivo({ name: 'comprovante.txt', bytes: new Uint8Array([9, 9, 9, 9]) }), 'Comprovante de endereço');
  });
  after(() => lockNow());

  it('counts retorna documentos e dívidas do cliente', async () => {
    assert.deepEqual(await S.counts(id), { docs: 2, debts: 0 });
  });

  it('counts de cliente inexistente é zero (não lança)', async () => {
    assert.deepEqual(await S.counts('fantasma'), { docs: 0, debts: 0 });
  });

  it('deleteClient remove cliente, documentos, blobs dos documentos, foto, dívidas e histórico', async () => {
    assert.equal((await db.getAll('blobs')).length, 3, 'foto + 2 documentos');
    await S.deleteClient(id);
    assert.deepEqual(await S.listClients(), []);
    assert.deepEqual(await S.listDocs(id), []);
    assert.deepEqual(await S.listHistory(id), []);
    assert.equal((await db.getAll('documents')).length, 0);
    assert.equal((await db.getAll('debts')).length, 0);
    assert.equal((await db.getAll('blobs')).length, 0, 'nenhum blob pode sobreviver ao cliente (órfão)');
    assert.equal((await db.getAll('clients')).length, 0);
  });

  it('deleteClient não apaga o cofre nem as configurações', async () => {
    await db.put('settings', { key: 'dueWindow', value: 11 });
    await S.deleteClient(id);
    assert.ok(dumpStore('meta').some((m) => m.key === 'vault'), 'a senha do cofre sobrevive');
    assert.deepEqual(dumpStore('settings').find((s) => s.key === 'dueWindow').value, 11);
  });

  it('deleteClient de id inexistente é no-op silencioso', async () => {
    await S.deleteClient('fantasma');
    assert.equal((await S.listClients()).length, 1);
  });

  it('a cascata inteira acontece em UMA transação (um único data-changed)', async () => {
    let n = 0;
    const ouvinte = () => n++;
    globalThis.addEventListener('data-changed', ouvinte);
    await S.deleteClient(id);
    globalThis.removeEventListener('data-changed', ouvinte);
    assert.equal(n, 1, 'se alguém dividir a cascata em dois batch, a UI re-renderiza duas vezes');
  });

  it('a store documents guarda clientId em claro para permitir a cascata sem decifrar nada', async () => {
    const cruas = dumpStore('documents');
    assert.ok(cruas.length === 2 && cruas.every((d) => d.clientId === id));
    assert.ok(cruas.every((d) => d.data instanceof Uint8Array));
  });
});

describe('clients: catálogo e leitura', () => {
  beforeEach(async () => { await setupVault() });
  after(() => lockNow());

  it('CATS é o contrato de categorias de documento usado pela UI', () => {
    assert.deepEqual(S.CATS, ['Identificação', 'Comprovante de endereço', 'Comprovante de transferência', 'Outro']);
  });

  it('listDocs ordena do mais recente para o mais antigo', async () => {
    const idA = await S.saveClient(novoClienteParaSalvar(), null);
    await S.addDoc(idA, novoArquivo({ name: 'primeiro.txt' }), 'Identificação');
    await S.addDoc(idA, novoArquivo({ name: 'segundo.txt', bytes: new Uint8Array([1, 2, 3]) }), 'Outro');
    const datas = (await S.listDocs(idA)).map((d) => d.createdAt);
    assert.deepEqual(datas, [...datas].sort((a, b) => b - a));
  });

  it('ler, mutar o objeto devolvido e reler não altera o banco (structuredClone no put)', async () => {
    const id = await S.saveClient(novoClienteParaSalvar(), null);
    const salvo = await S.getClient(id);
    salvo.name = 'MUTADO';
    assert.notEqual((await S.getClient(id)).name, 'MUTADO', 'o registro lido é uma cópia');
  });
});
