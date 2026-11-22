import assert from'node:assert/strict';
import{test}from'node:test';
import{addMonths,splitInstallments,validDate}from'../src/domain/installments.js';

test('divide o principal em centavos e distribui o resto sem alterar o total',()=>{
  const rows=splitInstallments(1001,3,'2026-12-22');
  assert.deepEqual(rows.map(x=>x.amountCents),[334,334,333]);
  assert.equal(rows.reduce((s,x)=>s+x.amountCents,0),1001);
});

test('aceita o limite de 60 parcelas e soma exatamente o saldo',()=>{
  const rows=splitInstallments(123456,60,'2026-11-22');
  assert.equal(rows.length,60);
  assert.equal(rows.reduce((s,x)=>s+x.amountCents,0),123456);
  assert.equal(rows[0].number,1);
  assert.equal(rows.at(-1).number,60);
});

test('mantém a soma exata para 1, 2, 12, 24 e 60 parcelas',()=>{
  for(const count of[1,2,12,24,60]){
    const rows=splitInstallments(98765,count,'2026-11-22');
    assert.equal(rows.length,count);
    assert.equal(rows.reduce((s,x)=>s+x.amountCents,0),98765);
  }
});

test('gera vencimentos mensais a partir do dia de referência sem acumular desvio',()=>{
  assert.deepEqual([0,1,2,3].map(i=>addMonths('2026-01-31',i)),['2026-01-31','2026-02-28','2026-03-31','2026-04-30']);
  assert.deepEqual([0,1,2].map(i=>addMonths('2024-01-31',i)),['2024-01-31','2024-02-29','2024-03-31']);
  assert.deepEqual([0,1,2].map(i=>addMonths('2026-01-30',i)),['2026-01-30','2026-02-28','2026-03-30']);
  assert.deepEqual([0,1,2].map(i=>addMonths('2026-03-29',i)),['2026-03-29','2026-04-29','2026-05-29']);
  assert.equal(addMonths('2026-11-22',2),'2027-01-22');
});

test('rejeita quantidades, saldos e datas inválidas',()=>{
  assert.equal(validDate('2026-02-29'),false);
  assert.equal(validDate('2024-02-29'),true);
  assert.throws(()=>splitInstallments(100,0,'2026-11-22'));
  assert.throws(()=>splitInstallments(100,61,'2026-11-22'));
  assert.throws(()=>splitInstallments(0,1,'2026-11-22'));
  assert.throws(()=>splitInstallments(100,1,'2026-02-30'));
});
