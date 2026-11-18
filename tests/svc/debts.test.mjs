// src/services/debts.js — CRUD de dívidas, juros derivados e prévia em lote.
import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as db from '../../src/db/idb.js';
import * as DV from '../../src/services/debts.js';
import * as S from '../../src/services/clients.js';
import * as rec from '../../src/services/records.js';
import { dumpStore } from '../helpers/fake-idb.mjs';
import { setupVault, lockNow } from '../helpers/vault.mjs';
import { novoClienteParaSalvar, novaDividaParaSalvar, novaDividaFicticia } from '../helpers/fixtures.mjs';

describe('debts: saveDebt', () => {
  let cliente;
  beforeEach(async () => { await setupVault(); cliente = await S.saveClient(novoClienteParaSalvar(), null) });
  after(() => lockNow());

  it('round-trip: descreve o que foi salvo e deriva juros sempre do par principal×rate', async () => {
    const id = await DV.saveDebt(cliente, novaDividaParaSalvar());
    const [d] = await DV.listDebts(cliente);
    assert.equal(d.id, id);
    assert.equal(d.clientId, cliente);
    assert.equal(d.principal, 500000);
    assert.equal(d.rate, 1500);
    assert.equal(d.interest, 75000, 'interest não é gravado: vem de money.interest (debts.js:5)');
    assert.equal(d.notes, '');
  });

  it('edição preserva id/createdAt e grava no histórico o que mudou', async () => {
    const id = await DV.saveDebt(cliente, novaDividaParaSalvar());
    const antes = (await DV.listDebts(cliente))[0];
    await DV.saveDebt(cliente, { ...antes, principal: 600000 }, antes);
    const depois = (await DV.listDebts(cliente))[0];
    assert.equal(depois.id, id);
    assert.equal(depois.createdAt, antes.createdAt);
    assert.equal(depois.principal, 600000);
    assert.equal(depois.interest, 90000);
    // a taxa NÃO mudou (só o principal): sai "Dívida alterada", nunca "Juros alterados"
    const tipos = (await S.listHistory(cliente)).map((h) => h.type).sort();
    assert.deepEqual(tipos, ['Cadastro de cliente', 'Dívida alterada', 'Dívida cadastrada']);
  });

  it('mexer só nas observações não gera item "Juros alterados"', async () => {
    const id = await DV.saveDebt(cliente, novaDividaParaSalvar());
    const antes = (await DV.listDebts(cliente))[0];
    await DV.saveDebt(cliente, { ...antes, notes: 'renegociado por telefone' }, antes);
    const tipos = (await S.listHistory(cliente)).map((h) => h.type);
    assert.ok(!tipos.includes('Juros alterados'));
    assert.ok(tipos.includes('Dívida alterada'));
  });

  it('histórico de cadastro traz valor e taxa formatados pt-BR', async () => {
    await DV.saveDebt(cliente, novaDividaParaSalvar());
    const [h] = (await S.listHistory(cliente)).filter((x) => x.type === 'Dívida cadastrada');
    assert.equal(h.detail, 'Empréstimo pessoal: R$ 5.000,00 a 15% ao mês');
  });

  it('validação: principal > 0, taxa entre 0,01% e 1000%, datas ISO e vencimento >= registro', async () => {
    for (const [mut, campo, regex] of [
      [{ principal: 0 }, 'principal', /maior que zero/],
      [{ principal: -500000 }, 'principal', /maior que zero/],
      [{ principal: 1e13 + 1 }, 'principal', /maior que zero/],
      [{ rate: 0 }, 'rate', /entre 0,01% e 1000%/],
      [{ rate: 100001 }, 'rate', /entre 0,01% e 1000%/],
      [{ description: '' }, 'description', /descrição/],
      [{ date: '06/11/2026' }, 'date', /Data inválida/],
      [{ due: '' }, 'due', /Informe o vencimento/],
      [{ due: '2026-11-01' }, 'due', /anterior ao registro/],
    ]) {
      await assert.rejects(DV.saveDebt(cliente, { ...novaDividaParaSalvar(), ...mut }),
        (e) => regex.test(e.errs[campo]), `esperava erro em ${campo} para ${JSON.stringify(mut)}`);
    }
    assert.equal((await db.getAll('debts')).length, 0, 'nada pode ter sido gravado');
  });

  it('conhecido: saveDebt ACEITA clientId inexistente (dívida órfã passa na validação)', async () => {
    // ver docs/ROADMAP.md — debts.saveDebt valida o CONTEÚDO, não a referência. A dívida órfã aparece em
    // listDebts() sem cliente e findByRate() mostra '—' no nome (debts.js:26). É a mesma classe de furo que
    // backup-format.validate() fecha só na hora do restore (backup-format.js:24).
    const id = await DV.saveDebt('cliente-fantasma', novaDividaParaSalvar());
    assert.ok(id);
    const [d] = await DV.listDebts();
    assert.equal(d.clientId, 'cliente-fantasma');
    assert.equal((await DV.findByRate(1500))[0].clientName, '—');
    assert.equal((await S.getClient('cliente-fantasma')), undefined);
  });

  it('dívida órfã NÃO aparece no extrato do cliente real, mas aparece na lista global', async () => {
    await DV.saveDebt('cliente-fantasma', novaDividaParaSalvar());
    assert.deepEqual(await DV.listDebts(cliente), []);
    assert.equal((await DV.listDebts()).length, 1);
  });
});

describe('debts: listagem, busca e exclusão', () => {
  let cliente;
  beforeEach(async () => {
    await setupVault();
    cliente = await S.saveClient(novoClienteParaSalvar(), null);
    await DV.saveDebt(cliente, novaDividaParaSalvar({ description: 'Empréstimo antigo', date: '2026-10-01', due: '2026-11-01' }));
    await DV.saveDebt(cliente, novaDividaParaSalvar({ description: 'Empréstimo novo', date: '2026-11-10', due: '2026-12-10', rate: 2000 }));
  });
  after(() => lockNow());

  it('lista mais recente primeiro (por data de registro, depois createdAt)', async () => {
    assert.deepEqual((await DV.listDebts(cliente)).map((d) => d.description), ['Empréstimo novo', 'Empréstimo antigo']);
  });

  it('findByRate retorna só quem tem aquela taxa, com o nome do cliente resolvido', async () => {
    const achadas = await DV.findByRate(2000);
    assert.equal(achadas.length, 1);
    assert.equal(achadas[0].description, 'Empréstimo novo');
    assert.equal(achadas[0].clientName, 'Maria Exemplo');
  });

  it('deleteDebt remove a dívida e registra no histórico', async () => {
    const [alvo] = await DV.listDebts(cliente);
    await DV.deleteDebt(alvo);
    assert.equal((await DV.listDebts(cliente)).length, 1);
    assert.ok((await S.listHistory(cliente)).some((h) => h.type === 'Dívida excluída'));
  });

  it('o que vai para a store debts é cifrado, exceto id/clientId/createdAt', async () => {
    const cruas = dumpStore('debts');
    assert.equal(cruas.length, 2);
    for (const r of cruas) {
      assert.deepEqual(Object.keys(r).sort(), ['clientId', 'createdAt', 'data', 'id']);
      assert.ok(r.data instanceof Uint8Array);
    }
    assert.equal(JSON.stringify(cruas).includes('Empréstimo'), false);
  });
});

describe('debts: applyBulk (juros em lote)', () => {
  let cliente, d1, d2;
  beforeEach(async () => {
    await setupVault();
    cliente = await S.saveClient(novoClienteParaSalvar(), null);
    d1 = await DV.saveDebt(cliente, novaDividaParaSalvar({ description: 'Primeira', rate: 1000 }));
    d2 = await DV.saveDebt(cliente, novaDividaParaSalvar({ description: 'Segunda', rate: 1200 }));
  });
  after(() => lockNow());

  it('aplica a prévia inteira em uma transação e grava um histórico por dívida', async () => {
    const alvo = (await DV.listDebts(cliente)).find((d) => d.id === d1);
    await DV.applyBulk([{ d: alvo, nr: 1500, ok: true, ni: 0 }]);
    const depois = await DV.listDebts(cliente);
    assert.equal(depois.find((d) => d.id === d1).rate, 1500);
    assert.equal(depois.find((d) => d.id === d2).rate, 1200);
    assert.equal((await S.listHistory(cliente)).filter((h) => h.type === 'Juros alterados em lote').length, 1);
  });

  it('recusa prévia com item inválido sem alterar nada', async () => {
    const alvo = (await DV.listDebts(cliente))[0];
    await assert.rejects(DV.applyBulk([{ d: alvo, nr: 999999, ok: false, ni: null }]), /taxas inválidas/);
    assert.deepEqual((await DV.listDebts(cliente)).map((d) => d.rate).sort(), [1000, 1200]);
  });

  it('recusa quando os dados mudaram desde a busca (update otimista)', async () => {
    const envelhecida = novaDividaFicticia({ id: d1, clientId: cliente, rate: 1000 });
    await DV.saveDebt(cliente, { ...envelhecida, rate: 1100 }, { ...envelhecida, createdAt: 1 });
    await assert.rejects(DV.applyBulk([{ d: envelhecida, nr: 1500, ok: true, ni: 0 }]), /dados mudaram/);
    assert.equal((await DV.listDebts(cliente)).find((d) => d.id === d1).rate, 1100);
  });

  it('lista vazia é recusada', async () => {
    await assert.rejects(DV.applyBulk([]), /taxas inválidas/);
  });
});

describe('debts: contrato com o banco', () => {
  beforeEach(async () => { await setupVault() });
  after(() => lockNow());

  it('saveDebt grava exatamente 1 registro em debts + 1 em history por operação', async () => {
    const cliente = await S.saveClient(novoClienteParaSalvar(), null);
    await DV.saveDebt(cliente, novaDividaParaSalvar());
    assert.equal((await db.getAll('debts')).length, 1);
    assert.equal((await db.getAll('history')).length, 2, 'cadastro do cliente + cadastro da dívida');
  });

  it('os campos de um registro decifrado são exatamente os de rec() (debts.js:4)', async () => {
    const cliente = await S.saveClient(novoClienteParaSalvar(), null);
    await DV.saveDebt(cliente, novaDividaParaSalvar());
    const [d] = await rec.list('debts');
    assert.deepEqual(Object.keys(d).sort(),
      ['clientId', 'createdAt', 'date', 'description', 'due', 'id', 'notes', 'principal', 'rate', 'updatedAt']);
  });
});
