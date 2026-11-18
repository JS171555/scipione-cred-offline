// src/domain/due.js — vencimentos em datas ISO sem fuso. Os testes SEMPRE injetam `today` explicitamente,
// porque todayISO() depende de getTimezoneOffset() (due.js:3) e o nome "hoje" muda de fuso para fuso.
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as D from '../../src/domain/due.js';

const TZ_ORIGINAL = process.env.TZ;
const COM_FUSO = (tz, fn) => { process.env.TZ = tz; try { return fn() } finally { if (TZ_ORIGINAL === undefined) delete process.env.TZ; else process.env.TZ = TZ_ORIGINAL } };

describe('due: daysUntil', () => {
  it('conta dias inteiros entre duas datas ISO', () => {
    assert.equal(D.daysUntil('2026-11-21', '2026-11-14'), 7);
    assert.equal(D.daysUntil('2026-11-14', '2026-11-14'), 0);
  });
  it('devolve negativo no passado', () => {
    assert.equal(D.daysUntil('2026-11-13', '2026-11-14'), -1);
  });
  it('atravessa a virada de ano', () => {
    assert.equal(D.daysUntil('2027-01-01', '2026-12-30'), 2);
  });
  it('trata ano bissexto (29/02 existe em 2028)', () => {
    assert.equal(D.daysUntil('2028-03-01', '2028-02-28'), 2);
  });
  it('usa Date.UTC: dias são de calendário, não de relógio local', () => {
    // due.js:2 constrói as duas datas com Date.UTC -> 86400 s exatos por dia, sem DST.
    assert.equal(D.daysUntil('2026-11-15', '2026-11-14'), 1);
  });
  it('lança TypeError quando falta `due` (due.js:2)', () => {
    assert.throws(() => D.daysUntil(undefined, '2026-11-14'), { name: 'TypeError' });
    assert.throws(() => D.daysUntil(null, '2026-11-14'), { name: 'TypeError' });
  });
  it('string vazia não lança: vira NaN-safe por rolagem de Date.UTC', () => {
    // conhecido: ver docs/ROADMAP.md — due.js:2 não valida formato; '+""' === 0 => janeiro de 1970.
    // '2026-13-45' também é ACEITO por rollover (mês 13 -> janeiro do ano seguinte).
    assert.ok(Number.isNaN(D.daysUntil('lixo', '2026-11-14')));
    assert.equal(D.daysUntil('', '2026-11-14'), -46370);
    assert.equal(D.daysUntil('2026-13-45', '2026-11-14'), 92);
  });
});

describe('due: status (janela de vencimento)', () => {
  const T = '2026-11-14';
  it('vencido: qualquer dia anterior a hoje', () => {
    assert.equal(D.status('2026-11-13', 7, T), 'overdue');
    assert.equal(D.status('2020-01-01', 7, T), 'overdue');
  });
  it('hoje é "soon" (a contar da própria data de vencimento)', () => {
    assert.equal(D.status(T, 7, T), 'soon');
  });
  it('limite da janela: hoje+win é "soon", hoje+win+1 é "ok"', () => {
    assert.equal(D.status('2026-11-21', 7, T), 'soon');
    assert.equal(D.status('2026-11-22', 7, T), 'ok');
  });
  it('janela maior amplia o "soon"', () => {
    assert.equal(D.status('2026-11-22', 30, T), 'soon');
  });
  it('janela 0 ainda marca hoje como "soon"', () => {
    assert.equal(D.status(T, 0, T), 'soon');
    assert.equal(D.status('2026-11-15', 0, T), 'ok');
  });
  it('sem `win` (indefinido) tudo que não está vencido vira "ok" — a janela some', () => {
    // conhecido: ver docs/ROADMAP.md — status(due, win, today) não tem default para win e a comparação
    // `n <= undefined` é sempre false, então um vencimento de hoje+1 sai classificado como "ok".
    assert.equal(D.status('2026-11-15', undefined, T), 'ok');
    assert.equal(D.status('2026-11-14', undefined, T), 'ok');   // nem "soon": 0 <= undefined também é false
    assert.equal(D.status('2026-11-13', undefined, T), 'overdue');
  });
  it('lança TypeError quando falta a data de vencimento (due.js:2)', () => {
    assert.throws(() => D.status(undefined, 7, T), { name: 'TypeError' });
  });
});

describe('due: todayISO e o limite da meia-noite por fuso', () => {
  // 2026-11-18T02:30:00Z  ==  23:30 de 2026-11-17 em São Paulo (UTC-3)  ==  18/11 02:30 em UTC.
  const INSTANTE = Date.UTC(2026, 10, 18, 2, 30, 0);
  const comHoje = (fn) => { const real = Date.now; Date.now = () => INSTANTE; try { return fn() } finally { Date.now = real } };

  it('em UTC o "hoje" ainda é 18/11', () => {
    const iso = COM_FUSO('UTC', () => comHoje(() => D.todayISO()));
    assert.equal(iso, '2026-11-18');
  });
  it('em America/Sao_Paulo o mesmo instante ainda é 17/11 (23:30 local)', () => {
    const iso = COM_FUSO('America/Sao_Paulo', () => comHoje(() => D.todayISO()));
    assert.equal(iso, '2026-11-17');
  });
  it('cruzar a meia-noite local muda o estado de um vencimento de hoje', () => {
    // Vencimento 2026-11-17 às 02:30Z: em UTC já é dia 18 (=> vencido); em São Paulo ainda é 17 às 23:30
    // (=> hoje, "soon"). É exatamente a classe de bug "vencimento de ontem" que a auditoria (§2.5) apontou
    // como nunca fixada por teste.
    const due = '2026-11-17';
    assert.equal(COM_FUSO('UTC', () => comHoje(() => D.status(due, 7))), 'overdue');
    assert.equal(COM_FUSO('America/Sao_Paulo', () => comHoje(() => D.status(due, 7))), 'soon');
  });
  it('em fuso UTC+14 o "hoje" já avançou', () => {
    const iso = COM_FUSO('Pacific/Kiritimati', () => comHoje(() => D.todayISO()));
    assert.equal(iso, '2026-11-18');
  });
  it('daysUntil é independente de fuso quando as duas datas são injetadas', () => {
    for (const tz of ['UTC', 'America/Sao_Paulo', 'Pacific/Kiritimati']) {
      assert.equal(COM_FUSO(tz, () => D.daysUntil('2026-12-06', '2026-11-06')), 30);
    }
  });
});
