import assert from 'node:assert/strict';import{status,daysUntil}from '../src/domain/due.js';import{match}from '../src/services/search.js';
const T='2026-11-14';assert.equal(daysUntil('2026-11-21',T),7);assert.equal(daysUntil('2027-01-01','2026-12-30'),2);
assert.equal(status('2026-11-13',7,T),'overdue');assert.equal(status(T,7,T),'soon');assert.equal(status('2026-11-21',7,T),'soon');assert.equal(status('2026-11-22',7,T),'ok');assert.equal(status('2026-11-22',30,T),'soon');
const c={name:'João da Conceição',doc:'529.982.247-25',rg:'12.345.678-9',phone:'(11) 3333-4444',mobile:'(11) 98765-4321',email:'Joao@Ex.com'};
for(const q of['joao','CONCEICAO','52998224725','529.982','987654321','joao@ex','12345678','33334444',''])assert(match(c,q),q);
for(const q of['maria','999','João 2'])assert(!match(c,q),q);
console.log('etapa4: ok');
