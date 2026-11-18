// src/services/debts.js — CRUD de dívidas, juros derivados e prévia em lote.
import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as db from '../../src/db/idb.js';
import * as DV from '../../src/services/debts.js';
import * as S from '../../src/services/clients.js';
import * as rec from '../../src/services/records.js';
import { dumpStore } from '../helpers/fake-idb.mjs';
import { setupVault, lockNow } from '../helpers/vault.mjs';
import { novoClienteParaSalvar, novaDividaParaSalvar, novaDividaFicticia, cpfFicticio } from '../helpers/fixtures.mjs';
import { mask } from '../../src/domain/validators.js';

// createdAt/updatedAt do registro e createdAt do histórico saem de Date.now() (debts.js:21, records.js:10). Sem
// avançar o relógio, cadastro e edição podem cair no MESMO milissegundo e a asserção de que updatedAt avançou
// viraria flaky. Mesmo padrão de tests/unit/due.test.mjs:76.
async function noInstante(ms, fn) {
  const real = Date.now;
  Date.now = () => ms;
  try { return await fn() } finally { Date.now = real }
}

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
    const depoisDoRelogio = Date.now() + 60000;
    await noInstante(depoisDoRelogio, () => DV.saveDebt(cliente, { ...antes, principal: 600000 }, antes));
    const depois = (await DV.listDebts(cliente))[0];
    assert.equal(depois.id, id);
    assert.equal(depois.createdAt, antes.createdAt);
    assert.equal(depois.updatedAt, depoisDoRelogio, 'updatedAt é o Date.now() da operação (debts.js:21)');
    assert.ok(depois.updatedAt > antes.updatedAt, 'editar avança updatedAt sem tocar em createdAt');
    assert.equal(await db.get('debts', id).then((r) => r.id), id, 'a edição reescreve o MESMO registro, não um novo');
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

  it('mexer só na taxa escreve APENAS "Juros alterados", com o antes → depois formatado', async () => {
    // rate não está em LABEL (debts.js:3), então a taxa sozinha não conta como "Dívida alterada" (debts.js:26).
    await DV.saveDebt(cliente, novaDividaParaSalvar());            // 15% a.m.
    const antes = (await DV.listDebts(cliente))[0];
    await DV.saveDebt(cliente, { ...antes, rate: 2000 }, antes);
    const hs = await S.listHistory(cliente);
    assert.deepEqual(hs.map((h) => h.type).sort(), ['Cadastro de cliente', 'Dívida cadastrada', 'Juros alterados']);
    assert.equal(hs.find((h) => h.type === 'Juros alterados').detail, 'Empréstimo pessoal: 15% → 20%');
    assert.equal((await DV.listDebts(cliente))[0].interest, 100000, 'juros continuam derivados do par principal×rate');
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

  it('guarda D-01: clientId inexistente é recusado com NO_CLIENT, sem escrever dívida nem histórico', async () => {
    // ver docs/ROADMAP.md — D-01 FECHADO nesta branch: saveDebt passou a conferir a referência (debts.js:20),
    // então a dívida órfã deixou de ser criável pela camada de serviço. Era caracterização do furo; é a guarda.
    await assert.rejects(DV.saveDebt('cliente-fantasma', novaDividaParaSalvar()), (e) => {
      assert.match(e.message, /Cliente não encontrado/);
      assert.equal(e.code, 'NO_CLIENT');
      assert.equal(e.errs, undefined, 'não é erro de campo: o formulário não tem nada a destacar');
      return true;
    });
    assert.deepEqual(await db.getAll('debts'), [], 'nenhum registro fantasma pode ficar na store debts');
    const hs = await rec.list('history');
    assert.deepEqual(hs.map((h) => h.type), ['Cadastro de cliente'], 'a recusa não escreve histórico: só sobra o do próprio cliente');
    assert.equal(hs.some((h) => h.clientId === 'cliente-fantasma'), false, 'nem uma linha apontando para cliente inexistente');
    assert.equal(await S.getClient('cliente-fantasma'), undefined, 'a recusa não pode criar cliente de consolo');
  });

  it('guarda D-01: clientId ausente ("", undefined, null, 0) rejeita com NO_CLIENT antes de qualquer escrita', async () => {
    for (const cid of ['', undefined, null, 0]) {
      await assert.rejects(DV.saveDebt(cid, novaDividaParaSalvar()), (e) => {
        assert.match(e.message, /Cliente não encontrado/);
        assert.equal(e.code, 'NO_CLIENT');
        return true;
      }, `clientId ${String(cid)} não pode gerar dívida`);
    }
    assert.deepEqual(await db.getAll('debts'), []);
    assert.equal((await S.listHistory(cliente)).length, 1, 'só o cadastro do cliente, nenhum evento da tentativa');
  });

  it('guarda D-01: a validação de conteúdo vem ANTES da guarda de referência', async () => {
    // debts.js:15 (validate) → debts.js:20 (getClient): campo inválido continua respondendo com `errs`,
    // nunca com NO_CLIENT — é o que a UI usa para pintar o campo (src/ui/debts.js:26).
    await assert.rejects(DV.saveDebt('cliente-fantasma', novaDividaParaSalvar({ principal: 0 })), (e) => {
      assert.equal(e.code, undefined, 'erro de campo não vira erro de referência');
      assert.match(e.errs.principal, /maior que zero/);
      return true;
    });
    assert.deepEqual(await db.getAll('debts'), []);
  });

  it('guarda D-01: perfil excluído em outra aba não aceita cadastro nem edição (o caso real da UI)', async () => {
    // src/ui/debts.js:25 chama saveDebt(c.id, ..., d) com o cliente que estava na tela; se ele foi excluído
    // enquanto o formulário estava aberto, a tela passa a mostrar a mensagem em vez de gravar um órfão.
    await DV.saveDebt(cliente, novaDividaParaSalvar());
    const [aberta] = await DV.listDebts(cliente);
    await S.deleteClient(cliente);
    await assert.rejects(DV.saveDebt(cliente, novaDividaParaSalvar()), (e) => e.code === 'NO_CLIENT');
    await assert.rejects(DV.saveDebt(cliente, { ...aberta, principal: 600000 }, aberta), (e) => e.code === 'NO_CLIENT');
    assert.deepEqual(await db.getAll('debts'), [], 'a cascata de deleteClient já tinha levado a dívida');
  });

  it('dívida órfã NÃO aparece no extrato do cliente real, mas aparece na lista global', async () => {
    // D-01 fechou a PORTA (saveDebt), não o DADO: cofre de versão anterior ou backup antigo ainda pode trazer
    // órfão. Por isso ele entra por ESCRITA DIRETA, como em tests/svc/records.test.mjs:41 — NÃO por saveDebt.
    await db.batch([await rec.enc('debts', novaDividaFicticia({ id: 'dvd-legado-orfa', clientId: 'cliente-fantasma' }))]);
    assert.deepEqual(await DV.listDebts(cliente), [], 'o extrato do cliente real não vê a herança');
    assert.equal((await DV.listDebts()).length, 1, 'a lista global vê: é assim que ela infla o painel');
    assert.equal((await DV.findByRate(1500))[0].clientName, '—',
      'findByRate resolve o nome só para cliente vivo (debts.js:31)');
    await db.batch([await rec.hist('cliente-fantasma', 'Dívida cadastrada', 'herança de backup antigo')]);
    assert.equal((await S.listHistory(cliente)).length, 1, 'o histórico do cliente real não recebe a linha órfã');
  });

  it('regressão D-01: deleteClient continua cascateando as dívidas (e o histórico) do cliente', async () => {
    await DV.saveDebt(cliente, novaDividaParaSalvar());
    await DV.saveDebt(cliente, novaDividaParaSalvar({ description: 'Segunda', rate: 2000 }));
    assert.equal((await db.getAll('debts')).length, 2, 'dívida de cliente existente entra normalmente');
    await S.deleteClient(cliente);
    assert.equal(await S.getClient(cliente), undefined);
    assert.equal((await db.getAll('debts')).length, 0, 'dívida não pode sobreviver ao dono (clients.js:34)');
    assert.deepEqual(await rec.list('history'), [], 'as linhas do histórico do cliente saem junto');
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

  it('regressão D-01: applyBulk segue operando sobre dívidas de clientes EXISTENTES (2 clientes, 1 transação)', async () => {
    // A guarda de saveDebt não pode ter atravessado o caminho em lote: a prévia vem de findByRate (debts.js:30)
    // e o histórico é escrito por cliente (debts.js:38).
    const outro = await S.saveClient(novoClienteParaSalvar({ name: 'João Teste', doc: mask.cpf(cpfFicticio(9)) }), null);
    const d3 = await DV.saveDebt(outro, novaDividaParaSalvar({ description: 'Terceira', rate: 1000 }));
    const alvo1 = (await DV.listDebts(cliente)).find((d) => d.id === d1);
    const alvo3 = (await DV.listDebts(outro)).find((d) => d.id === d3);
    assert.deepEqual((await DV.findByRate(1000)).map((d) => d.clientName).sort(), ['João Teste', 'Maria Exemplo']);
    await DV.applyBulk([{ d: alvo1, nr: 1500, ok: true, ni: 0 }, { d: alvo3, nr: 1500, ok: true, ni: 0 }]);
    assert.equal((await DV.listDebts(cliente)).find((d) => d.id === d1).rate, 1500);
    assert.equal((await DV.listDebts(outro)).find((d) => d.id === d3).rate, 1500);
    assert.equal((await DV.listDebts(cliente)).find((d) => d.id === d2).rate, 1200, 'quem não estava na prévia fica intacta');
    assert.equal((await S.listHistory(cliente)).filter((h) => h.type === 'Juros alterados em lote').length, 1);
    assert.equal((await S.listHistory(outro)).filter((h) => h.type === 'Juros alterados em lote').length, 1);
    assert.equal((await db.getAll('debts')).length, 3, 'nada órfão nem duplicado depois do lote');
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
