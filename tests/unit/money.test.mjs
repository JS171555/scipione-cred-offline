// src/domain/money.js — dinheiro em CENTAVOS inteiros; taxa em centésimos de ponto percentual.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../../src/domain/money.js';

describe('money: unidade = centavo inteiro', () => {
  it('juros simples de 15% sobre R$ 5.000,00 = R$ 750,00', () => {
    assert.equal(M.interest(500000, 1500), 75000);
  });
  it('MAXR é 1000% em centésimos e é limite aceito por planRate', () => {
    assert.equal(M.MAXR, 100000);
    assert.equal(M.planRate([{ rate: 0, principal: 100000 }], 'set', M.MAXR)[0].ok, true);
    assert.equal(M.planRate([{ rate: 1, principal: 100 }], 'add', M.MAXR)[0].ok, false);
  });
  it('arredonda meio para cima ao centavo', () => {
    assert.equal(M.interest(333, 1000), 33);   // 33,30 -> 33
    assert.equal(M.interest(335, 1000), 34);   // 33,50 -> 34
    assert.equal(M.interest(1, 1), 0);
    assert.equal(M.interest(999, 1), 0);
  });
  it('não perde precisão em valores grandes (BigInt)', () => {
    assert.equal(M.interest(1e13, 100000), 1e14);
  });
  it('lança RangeError para valor fracionário em centavos (money.js:9)', () => {
    assert.throws(() => M.interest(100.5, 1500), { name: 'RangeError' });
  });
  it('lança RangeError para taxa fracionária (money.js:9)', () => {
    assert.throws(() => M.interest(500000, 15.5), { name: 'RangeError' });
  });
  it('valores negativos arredondam para longe de zero no módulo (não simétrico)', () => {
    // positivo: interest(500000,1500)=75000; negativo: -74999 — truncamento do BigInt + viés de +5000.
    // conhecido: ver docs/ROADMAP.md — arredondamento assimétrico para principal negativo
    assert.equal(M.interest(-500000, 1500), -74999);
  });
});

describe('money: formatação pt-BR', () => {
  it('num usa ponto de milhar e vírgula decimal', () => {
    assert.equal(M.num(5), '0,05');
    assert.equal(M.num(123456789), '1.234.567,89');
    assert.equal(M.num(0), '0,00');
    assert.equal(M.num(500000), '5.000,00');
  });
  it('sinal negativo vem antes do número', () => {
    assert.equal(M.num(-500000), '-5.000,00');
    assert.equal(M.brl(-5), 'R$ -0,05');
  });
  it('brl prefixa R$', () => {
    assert.equal(M.brl(75000), 'R$ 750,00');
  });
  it('cents descarta tudo que não é dígito (inclusive lixo sem valor)', () => {
    assert.equal(M.cents('R$ 5.000,00'), 500000);
    assert.equal(M.cents('1.2.3'), 123);
    assert.equal(M.cents('abc'), 0);
    assert.equal(M.cents(null), 0);
    assert.equal(M.cents(undefined), 0);
  });
  it('rate formata centésimos de ponto percentual com trim de zero à direita', () => {
    assert.equal(M.rate(1500), '15%');
    assert.equal(M.rate(1250), '12,5%');
    assert.equal(M.rate(1205), '12,05%');
    assert.equal(M.rate(5), '0,05%');
    assert.equal(M.rate(0), '0%');
    assert.equal(M.rate(100000), '1000%');
  });
  it('parseRate aceita 15% / 12,5 / 0.29 e rejeita o resto', () => {
    assert.equal(M.parseRate('15%'), 1500);
    assert.equal(M.parseRate('12,5'), 1250);
    assert.equal(M.parseRate('0.29'), 29);
    assert.equal(M.parseRate('0'), 0);
    assert.equal(M.parseRate('1,234'), null);
    assert.equal(M.parseRate(',5'), null);
    assert.equal(M.parseRate('x'), null);
    assert.equal(M.parseRate(''), null);
  });
  it('parseRate não aplica o teto MAXR (quem valida é debts.validate)', () => {
    // conhecido: ver docs/ROADMAP.md — parseRate('1001') devolve 100100 (> MAXR) sem avisar
    assert.equal(M.parseRate('1001'), 100100);
    assert.ok(M.parseRate('1001') > M.MAXR);
  });
});

describe('money: planRate (prévia de juros em lote)', () => {
  const ds = [{ rate: 1200, principal: 100000 }, { rate: 1200, principal: 250050 }];
  it("'add' soma pontos percentuais e recalcula os juros", () => {
    const p = M.planRate(ds, 'add', 100);
    assert.deepEqual(p.map((x) => x.nr), [1300, 1300]);
    assert.equal(p[0].ni, 13000);
  });
  it("'sub' pode gerar taxa inválida (<=0) e isso é marcado, não lançado", () => {
    assert.ok(M.planRate(ds, 'sub', 1200).every((x) => !x.ok && x.ni === null));
  });
  it("'set' fixa a nova taxa", () => {
    assert.ok(M.planRate(ds, 'set', 1500).every((x) => x.ok && x.nr === 1500));
  });
  it('lista vazia devolve lista vazia', () => {
    assert.deepEqual(M.planRate([], 'add', 100), []);
  });
});
