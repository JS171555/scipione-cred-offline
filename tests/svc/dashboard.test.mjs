// src/services/dashboard.js — stats(): totais e indicadores de vencimento do painel.
//
// docs/ROADMAP.md Q-06/Q-04: o módulo nunca foi carregado por teste algum (--experimental-test-coverage não o
// listava). Tudo aqui é calculado sobre o IndexedDB falso com o cofre REAL destravado, semeado pelos services
// reais; nenhuma regra é reimplementada — onde a expectativa precisa de um "hoje" ou de uma classificação,
// usa-se todayISO()/daysUntil()/status() do próprio src/domain/due.js.
//
// DATAS SEMPRE RELATIVAS a todayISO(): com datas fixas, o trio "vencida / prestes a vencer / futura" mudaria de
// classe sozinho conforme o calendário avança (a auditoria 7-testes-infra.md marca que TZ nunca é fixado).
import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import * as db from '../../src/db/idb.js';
import * as S from '../../src/services/clients.js';
import * as DV from '../../src/services/debts.js';
import * as SET from '../../src/services/settings.js';
import * as rec from '../../src/services/records.js';
import { stats } from '../../src/services/dashboard.js';
import { todayISO, status, daysUntil } from '../../src/domain/due.js';
import { setupVault, lockNow } from '../helpers/vault.mjs';
import {
  novoClienteParaSalvar, novoClienteFicticio, novaDividaParaSalvar, novaDividaFicticia, novoHistorico, cpfFicticio,
} from '../helpers/fixtures.mjs';
import { mask } from '../../src/domain/validators.js';

// ---------- apoio local (nenhum helper existente faz isso) ----------
const DIA = 864e5;
const CAL = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));  // mesmo cálculo de due.js:2
const ISO = (ms) => new Date(ms).toISOString().slice(0, 10);
const desdeHoje = (dias) => ISO(CAL(todayISO()) + dias * DIA);                     // calendário: +N dias
const antesDe = (iso, dias) => ISO(CAL(iso) - dias * DIA);
const porId = (lista) => Object.fromEntries(lista.map((r) => [r.id, r]));

// Clientes com createdAt explícito: os services usam Date.now(), o que deixaria empates e faria a ordem
// esperada ser a de inserção, não a que dashboard.js:7 calcula.
async function semearClientesComData(n, baseTs = 1700000000000) {
  const ops = [];
  for (let i = 0; i < n; i++) {
    ops.push(await rec.enc('clients', novoClienteFicticio({
      id: `cli-${String(i + 1).padStart(3, '0')}`, name: `Maria Exemplo ${i + 1}`,
      doc: mask.cpf(cpfFicticio(i)), createdAt: baseTs + i * 1000,
    })));
  }
  await db.batch(ops);
  return Array.from({ length: n }, (_, i) => `cli-${String(i + 1).padStart(3, '0')}`);
}

describe('dashboard: stats() com o cofre vazio', () => {
  before(async () => { await setupVault() });
  after(() => lockNow());

  it('cofre vazio devolve zeros, latest[] e recent[] vazios — nenhuma divisão por zero, nenhum NaN', async () => {
    const s = await stats();
    assert.deepEqual(s, { principal: 0, interest: 0, clients: 0, debts: 0, overdue: 0, soon: 0, latest: [], recent: [] });
    assert.deepEqual(Object.keys(s), ['principal', 'interest', 'clients', 'debts', 'overdue', 'soon', 'latest', 'recent']);
  });

  it('conhecido: stats() NÃO devolve contagem de "ok" (dashboard.js:6) — dívida futura fica invisível no painel', async () => {
    const s = await stats();
    assert.equal('ok' in s, false, 'só overdue e soon saem do map de status');
    assert.equal(s.ok, undefined);
  });

  it('stats() é recalculado do banco a cada chamada (nada em cache): uma dívida muda os números', async () => {
    assert.equal((await stats()).debts, 0);
    const cid = await S.saveClient(novoClienteParaSalvar(), null);
    await DV.saveDebt(cid, novaDividaParaSalvar({ date: desdeHoje(-40), due: desdeHoje(-1) }));
    const s = await stats();
    assert.deepEqual([s.clients, s.debts, s.overdue, s.soon], [1, 1, 1, 0]);
    assert.equal(s.latest.length, 1);
    assert.ok(s.recent.length >= 2, 'histórico do cadastro do cliente + da dívida');
  });
});

describe('dashboard: três situações de vencimento (janela default de 7 dias)', () => {
  let cid, vencida, perto, longe;
  before(async () => {
    await setupVault();
    cid = await S.saveClient(novoClienteParaSalvar(), null);
    vencida = await DV.saveDebt(cid, novaDividaParaSalvar({ description: 'Vencida há 5 dias', principal: 100000, rate: 1500, date: desdeHoje(-40), due: desdeHoje(-5) }));
    perto = await DV.saveDebt(cid, novaDividaParaSalvar({ description: 'Dentro da janela', principal: 250000, rate: 2000, date: desdeHoje(-40), due: desdeHoje(5) }));
    longe = await DV.saveDebt(cid, novaDividaParaSalvar({ description: 'Bem futura', principal: 500000, rate: 1500, date: desdeHoje(-40), due: desdeHoje(20) }));
  });
  after(() => lockNow());

  it('overdue=1 e soon=1 contra todayISO(); a terceira é futura e não aparece em contador algum', async () => {
    const w = await SET.getDueWindow();
    assert.equal(w, 7, 'default de settings.js:2');
    assert.deepEqual([daysUntil(desdeHoje(-5)), daysUntil(desdeHoje(5)), daysUntil(desdeHoje(20))], [-5, 5, 20],
      'as datas relativas do cenário conferem com o calendário de hoje');
    const s = await stats();
    assert.deepEqual([s.debts, s.overdue, s.soon], [3, 1, 1]);
    assert.equal(s.debts - s.overdue - s.soon, 1, 'a futura só é percebível por subtração: "ok" não é devolvido');
    // gabarito real (due.js), com o "hoje" injetado
    assert.deepEqual([status(desdeHoje(-5), w, todayISO()), status(desdeHoje(5), w, todayISO()), status(desdeHoje(20), w, todayISO())],
      ['overdue', 'soon', 'ok']);
  });

  it('principal e interest são somas em centavos, com interest derivado por dívida (o modelo não tem parcelas)', async () => {
    const s = await stats();
    assert.equal(s.principal, 850000, 'R$ 8.500,00 em centavos');
    assert.equal(s.interest, 140000, '15000 + 50000 + 75000: um juro mensal por dívida (debts.js:5)');
    assert.deepEqual([s.clients, s.debts], [1, 3]);
    const por = porId(await DV.listDebts(cid));
    assert.deepEqual([por[vencida].interest, por[perto].interest, por[longe].interest], [15000, 50000, 75000]);
    assert.equal('parcelas' in por[vencida], false);
    assert.equal('installment' in por[vencida], false);
  });

  it('a janela de vencimento vem de settings: 3 vs 7 vs 30 reclassificam as MESMAS dívidas', async () => {
    for (const [w, e] of [[3, { overdue: 1, soon: 0 }], [7, { overdue: 1, soon: 1 }], [30, { overdue: 1, soon: 2 }]]) {
      await SET.setDueWindow(w);
      const s = await stats();
      assert.equal(await SET.getDueWindow(), w);
      assert.deepEqual({ overdue: s.overdue, soon: s.soon }, e, `janela de ${w} dias`);
      assert.equal(s.debts, 3, 'o total não muda com a janela: muda só a distribuição');
    }
    await SET.setDueWindow(7);
  });
});

describe('dashboard: interest soma o arredondado POR DÍVIDA (não o arredondamento da soma)', () => {
  before(async () => {
    await setupVault();
    const cid = await S.saveClient(novoClienteParaSalvar(), null);
    for (let i = 0; i < 3; i++) {
      await DV.saveDebt(cid, novaDividaParaSalvar({ description: `Miúdo ${i + 1}`, principal: 100, rate: 50, date: desdeHoje(-40), due: desdeHoje(3) }));
    }
  });
  after(() => lockNow());

  it('3 dívidas de R$ 1,00 a 0,5%: 3 × arred(0,5 centavo) = 3 centavos; arredondar a soma daria 1', async () => {
    const s = await stats();
    assert.equal(s.principal, 300);
    assert.equal(s.interest, 3, 'money.interest (BigInt, meio para cima) é por dívida ANTES de somar (dashboard.js:4)');
    assert.deepEqual([s.debts, s.soon], [3, 3], 'as três caem dentro da janela de 7 dias');
  });
});

describe('dashboard: dívida órfã legada (cliente inexistente)', () => {
  let cid;
  before(async () => {
    await setupVault();
    cid = await S.saveClient(novoClienteParaSalvar(), null);
    await DV.saveDebt(cid, novaDividaParaSalvar({ description: 'Dívida real', principal: 100000, rate: 1500, date: desdeHoje(-40), due: desdeHoje(-5) }));
    // docs/ROADMAP.md D-01 FECHADO nesta branch: saveDebt recusa clientId inexistente (debts.js:20), então o
    // órfão não pode mais SEMEAR pelo service — entra por escrita direta (rec.enc + db.batch, como em
    // tests/svc/records.test.mjs:41 e no `latest/recent` abaixo), representando cofre/backup de versão anterior.
    await db.batch([
      await rec.enc('debts', novaDividaFicticia({
        id: 'dvd-orfa-legado', clientId: 'cliente-que-nao-existe', description: 'Dívida órfã',
        principal: 200000, rate: 1000, date: desdeHoje(-40), due: desdeHoje(5),
      })),
      // a linha de histórico que o saveDebt de antes escrevia para o clientId fantasma: é o que vira "—" no painel
      await rec.hist('cliente-que-nao-existe', 'Dívida cadastrada', 'Dívida órfã: R$ 2.000,00 a 10% ao mês'),
    ]);
  });
  after(() => lockNow());

  it('conhecido: a dívida órfã LEGADA ENTRA nos totais do painel e não aparece em lugar nenhum por cliente', async () => {
    // O painel é onde o dado legado vira número: 2 dívidas para 1 cliente. dashboard.js:4 soma listDebts() SEM
    // cruzar com clients — isso NÃO mudou com D-01 (a guarda está na ESCRITA, não na leitura) e não mudamos.
    const s = await stats();
    assert.deepEqual([s.clients, s.debts], [1, 2]);
    assert.equal(s.principal, 300000, 'o principal órfão foi somado');
    assert.equal(s.interest, 15000 + 20000, 'os juros órfãos também');
    assert.deepEqual([s.overdue, s.soon], [1, 1], 'e a dívida fantasma até dispara alerta de vencimento');
    assert.equal((await DV.listDebts(cid)).length, 1, 'no extrato do cliente real ela não existe');
    assert.equal((await DV.listDebts()).length, 2, 'na lista global (a do painel) ela existe');
    assert.ok(s.recent.some((r) => r.client === '—'), 'no histórico do painel a referência quebrada vira só "—"');
  });

  it('conhecido: stats() não denuncia a inconsistência — é o validate() do backup que a barra depois (D-06)', async () => {
    const s = await stats();
    assert.equal(s.latest.length, 1, 'o painel só mostra clientes vivos; a dívida órfã não tem dono visível');
    assert.equal(s.recent.every((r) => typeof r.client === 'string'), true, 'nenhum erro, nenhum aviso: só números');
    // ver tests/svc/backup-restore.test.mjs: o mesmo dado faz readBackup lançar INVALID
    // D-01: o painel NUNCA dependeu de saveDebt com cliente inexistente — ele só lê o banco. Quem escreve por
    // service hoje seria barrado; o que alimenta estes números é exclusivamente o dado herdado injetado acima.
    await assert.rejects(DV.saveDebt('cliente-que-nao-existe', novaDividaParaSalvar({ description: 'Tentativa', principal: 100000, rate: 1000, date: desdeHoje(-1), due: desdeHoje(5) })),
      (e) => e.code === 'NO_CLIENT');
    const depois = await stats();
    assert.deepEqual([depois.debts, depois.principal, (await db.getAll('debts')).length], [2, 300000, 2],
      'a tentativa recusada não mexeu em nenhum número do painel');
  });
});

describe('dashboard: latest (5 clientes) e recent (8 itens de histórico)', () => {
  const T0 = 1700000000000, T1 = 1700500000000;
  let ids;
  before(async () => {
    await setupVault();
    ids = await semearClientesComData(7);
    const ops = [];
    for (let i = 0; i < 11; i++) {
      ops.push(await rec.enc('history', novoHistorico({
        id: `his-${String(i + 1).padStart(3, '0')}`,
        clientId: i === 10 ? 'cliente-que-nao-existe' : ids[i % 2],
        type: 'Evento de teste', detail: `evento ${i + 1}`, createdAt: T1 + i * 1000,
      })));
    }
    await db.batch(ops);
  });
  after(() => lockNow());

  it('latest traz no máximo 5 clientes, do createdAt mais novo para o mais antigo', async () => {
    const s = await stats();
    assert.equal(s.clients, 7);
    assert.equal(s.latest.length, 5, 'slice(0,5) em dashboard.js:7');
    assert.deepEqual(s.latest.map((c) => c.id), ['cli-007', 'cli-006', 'cli-005', 'cli-004', 'cli-003']);
    assert.deepEqual(s.latest.map((c) => c.createdAt), [T0 + 6000, T0 + 5000, T0 + 4000, T0 + 3000, T0 + 2000]);
    assert.equal(s.latest[0].name, 'Maria Exemplo 7');
    assert.equal(s.latest.every((c) => !('data' in c)), true, 'são registros decifrados, não a linha crua da store');
  });

  it('recent traz no máximo 8 itens, do createdAt mais novo para o mais antigo, com `client` resolvido', async () => {
    const s = await stats();
    assert.equal(s.recent.length, 8, 'slice(0,8) em dashboard.js:7 sobre 11 eventos');
    assert.deepEqual(s.recent.map((h) => h.id), ['his-011', 'his-010', 'his-009', 'his-008', 'his-007', 'his-006', 'his-005', 'his-004']);
    assert.deepEqual(s.recent.map((h) => h.createdAt), [10, 9, 8, 7, 6, 5, 4, 3].map((i) => T1 + i * 1000));
    assert.deepEqual(s.recent.map((h) => h.client),
      ['—', 'Maria Exemplo 2', 'Maria Exemplo 1', 'Maria Exemplo 2', 'Maria Exemplo 1', 'Maria Exemplo 2', 'Maria Exemplo 1', 'Maria Exemplo 2']);
    assert.deepEqual(Object.keys(s.recent[1]), ['type', 'detail', 'id', 'createdAt', 'clientId', 'client']);
  });

  it('recent usa names.get(clientId) || "—": cliente apagado deixa traço, nunca undefined', async () => {
    const s = await stats();
    assert.equal(s.recent[0].client, '—', 'his-011 aponta para cliente inexistente');
    assert.equal(s.recent.slice(1).every((h) => /^Maria Exemplo \d$/.test(h.client)), true);
    assert.equal(s.recent.every((h) => h.detail === `evento ${11 - s.recent.indexOf(h)}`), true, 'campos originais preservados');
  });
});

describe('dashboard: stats() sob dois fusos (mesmo cofre, mesma dívida)', () => {
  // Pacific/Midway (UTC-11) e Pacific/Kiritimati (UTC+14) estão a 25 h um do outro: o leste está SEMPRE 1 ou 2
  // dias de calendário à frente, sem horário de verão nos dois. Uma dívida vencendo "hoje no oeste" é passado
  // vista do leste — é exatamente o que a tela de alertas mostra (ou esconde). Ver docs/ROADMAP.md Q-06.
  const TZ_OESTE = 'Pacific/Midway', TZ_LESTE = 'Pacific/Kiritimati';
  const tzOriginal = process.env.TZ;
  let cid, dueOeste;
  before(async () => { await setupVault(); cid = await S.saveClient(novoClienteParaSalvar(), null) });
  after(() => {
    if (tzOriginal === undefined) delete process.env.TZ; else process.env.TZ = tzOriginal;
    lockNow();
  });

  it('a mesma dívida é "prestes a vencer" num fuso e "vencida" no outro; recarregar o módulo não é necessário', async () => {
    process.env.TZ = TZ_OESTE;
    const hojeOeste = todayISO();
    const offsetOeste = new Date().getTimezoneOffset();
    dueOeste = hojeOeste;
    await DV.saveDebt(cid, novaDividaParaSalvar({ description: 'Fronteira de fuso', principal: 100000, rate: 1500, date: antesDe(hojeOeste, 10), due: hojeOeste }));
    assert.equal(todayISO(), hojeOeste, 'guarda: o dia do oeste não virou durante o caso');
    const sOeste = await stats();

    process.env.TZ = TZ_LESTE;
    const hojeLeste = todayISO();
    assert.notEqual(new Date().getTimezoneOffset(), offsetOeste, 'se o runtime ignorar process.env.TZ o caso perde o sentido');
    assert.ok(hojeLeste > hojeOeste, 'o leste está 1-2 dias de calendário à frente do oeste');
    const sLeste = await stats();

    assert.deepEqual([sOeste.soon, sOeste.overdue], [1, 0], 'visto do oeste: alerta de "prestes a vencer"');
    assert.deepEqual([sLeste.soon, sLeste.overdue], [0, 1], 'visto do leste: a mesma dívida já está vencida');
    // gabarito: status(due, janela, hoje) do próprio due.js, com o "hoje" de cada fuso injetado
    assert.equal(status(dueOeste, 7, hojeOeste), 'soon');
    assert.equal(status(dueOeste, 7, hojeLeste), 'overdue');
    assert.deepEqual([sLeste.debts, sLeste.principal, sLeste.interest, sLeste.clients], [1, 100000, 15000, 1],
      'os totais são invariantes ao fuso: só a classificação de vencimento depende dele');

    // Registro do experimento (Node v22.23.4): NÃO foi preciso reimportar nada. todayISO() lê
    // `new Date().getTimezoneOffset()` na HORA da chamada e o Node reavalia process.env.TZ a cada acesso, então
    // o módulo já importado — inclusive o due.js estático de dashboard.js — muda de comportamento sozinho.
    // O cache-busting por query string serve só para PROVAR isso: instância nova, mesma resposta.
    const dueRecarregado = await import(`../../src/domain/due.js?v=${TZ_LESTE}`);
    assert.notEqual(dueRecarregado.todayISO, todayISO, '?v= contorna o cache ESM: são instâncias distintas');
    assert.equal(dueRecarregado.todayISO(), hojeLeste, 'e o valor coincide com o do módulo cacheado');
    assert.equal(dueRecarregado.status(dueOeste, 7, hojeLeste), 'overdue');
    // Alternativa (também funciona, mais cara): subprocesso com TZ no ambiente, ex.
    // `node --env-file /dev/null` com `TZ=Pacific/Kiritimati node --test ...`. Ficamos com o caminho in-process.
  });

  it('daysUntil() compara CALENDÁRIOS, não instantes (depende da dívida criada no caso anterior)', async () => {
    process.env.TZ = TZ_LESTE;
    assert.equal(daysUntil(todayISO()), 0, 'mesma data ⇒ zero dias, nunca -0,4');
    assert.equal(daysUntil(antesDe(todayISO(), 1)), -1);
    assert.equal(daysUntil(desdeHoje(8)), 8, 'um dia fora da janela de 7 some do alerta sem estar vencida');
    assert.equal(daysUntil(dueOeste) < 0, true, 'no leste, o vencimento do oeste já é ontem ou anteontem');
    const s = await stats();
    assert.deepEqual([s.debts, s.soon, s.overdue], [1, 0, 1]);
    process.env.TZ = TZ_OESTE;
    assert.deepEqual([await SET.getDueWindow(), (await stats()).soon], [7, 1]);
  });
});

describe('dashboard: dado corrompido no banco', () => {
  beforeEach(async () => { await setupVault() });
  after(() => lockNow());

  it('conhecido: dívida sem `due` derruba TODO o painel com TypeError de due.js:2, sem dizer qual registro', async () => {
    // docs/ROADMAP.md D-06: backup-format.js:24 aceita dívida sem `due`; ao voltar no cofre, stats() morre.
    const cid = await S.saveClient(novoClienteParaSalvar(), null);
    await DV.saveDebt(cid, novaDividaParaSalvar({ description: 'Sadia', date: desdeHoje(-40), due: desdeHoje(3) }));
    await db.batch([await rec.enc('debts', { id: 'dvd-sem-due', clientId: cid, createdAt: Date.now(), description: 'Corrompida', principal: 500000, rate: 1500, date: desdeHoje(-40), notes: '' })]);
    assert.equal((await DV.listDebts()).length, 2, 'a listagem de dívidas convive com o registro podre');
    await assert.rejects(stats(), (e) => {
      assert.ok(e instanceof TypeError, `esperava TypeError, veio ${e && e.constructor && e.constructor.name}`);
      assert.match(String(e.message), /Cannot read properties of undefined \(reading 'slice'\)/);
      assert.equal(String(e.message).includes('Corrompida'), false, 'a mensagem crua não identifica a dívida (S-05)');
      return true;
    });
  });

  it('conhecido: `due` vazio ("") não explode — vira dívida VENCIDA há 46 mil dias e infla o alerta', async () => {
    // due.js:2 faz Date.UTC(+'' .slice(0,4), +'' .slice(5,7)-1, +'' .slice(8,10)) = Date.UTC(0,-1,0), ou seja
    // "início do ano 0": n < 0 dispara. O painel alarma uma dívida que não tem vencimento nenhum, e o texto do
    // alerta não distingue isso de um atraso real. Characterization; docs/ROADMAP.md D-06.
    const cid = await S.saveClient(novoClienteParaSalvar(), null);
    await db.batch([await rec.enc('debts', { id: 'dvd-due-vazio', clientId: cid, createdAt: Date.now(), description: 'Due vazio', principal: 400000, rate: 2000, date: '2026-01-01', due: '', notes: '' })]);
    assert.equal(status('', 7, todayISO()), 'overdue', 'gabarito: "" é tratado como data, e é antiga');
    assert.ok(daysUntil('') < -46000, `dias até o "vencimento" deveria ser absurdo, veio ${daysUntil('')}`);
    const s = await stats();
    assert.deepEqual([s.debts, s.overdue, s.soon], [1, 1, 0]);
    assert.deepEqual([s.principal, s.interest], [400000, 80000], 'os totais entram normalmente');
  });

  it('conhecido: `due` não numérico ("abc") gera NaN e a dívida fica INVISÍVEL (0 alerta, 0 vencida)', async () => {
    // NaN escapa das duas comparações de due.js:5 (n < 0 e n <= win): pior que o caso acima, porque não deixa
    // sinal nenhum — nem erro, nem alerta. Characterization; docs/ROADMAP.md D-06/S-05.
    const cid = await S.saveClient(novoClienteParaSalvar(), null);
    await db.batch([await rec.enc('debts', { id: 'dvd-due-abc', clientId: cid, createdAt: Date.now(), description: 'Due podre', principal: 300000, rate: 1000, date: '2026-01-01', due: 'abc', notes: '' })]);
    assert.ok(Number.isNaN(daysUntil('abc')), 'gabarito: NaN de Date.UTC(NaN, NaN, NaN)');
    assert.equal(status('abc', 7, todayISO()), 'ok');
    const s = await stats();
    assert.deepEqual([s.debts, s.overdue, s.soon], [1, 0, 0], 'cadastrada, somada e invisível no vencimento');
    assert.deepEqual([s.principal, s.interest], [300000, 30000]);
  });
});
