import assert from'node:assert/strict';
import{test}from'node:test';
import{debtsAtRate,startsWithLetter,sumDebtPrincipal}from'../src/domain/client-filters.js';
import{match}from'../src/services/search.js';

test('filtra pela inicial sem diferenciar maiúsculas ou acentos e combina com a busca',()=>{
  const clients=[{id:'a',name:'Álvaro Lima'},{id:'b',name:'Ana Souza'},{id:'c',name:'Bruna Alves'}];
  assert.deepEqual(clients.filter(c=>startsWithLetter(c.name,'a')).map(c=>c.id),['a','b']);
  assert.deepEqual(clients.filter(c=>match(c,'alv')&&startsWithLetter(c.name,'A')).map(c=>c.id),['a']);
  assert.deepEqual(clients.filter(c=>startsWithLetter(c.name,'')).map(c=>c.id),['a','b','c']);
});

test('seleciona somente a taxa exata e soma o principal das dívidas encontradas',()=>{
  const debts=[
    {id:'a',rate:2000,principal:125000},
    {id:'b',rate:2000,principal:50000},
    {id:'c',rate:1500,principal:90000}
  ];
  const original=structuredClone(debts),found=debtsAtRate(debts,2000);
  assert.deepEqual(found.map(d=>d.id),['a','b']);
  assert.equal(sumDebtPrincipal(found),175000);
  assert.deepEqual(debts,original);
});
