import assert from 'node:assert/strict';import*as M from '../src/domain/money.js';
assert.equal(M.interest(500000,1500),75000);assert.equal(M.brl(75000),'R$ 750,00');assert.equal(M.brl(500000),'R$ 5.000,00');
assert.equal(M.interest(333,1000),33);assert.equal(M.interest(335,1000),34);assert.equal(M.interest(1,1),0);       // arredonda ao centavo, meio para cima
assert.equal(M.interest(1e13,100000),1e14);                                                                          // sem perda em valores grandes
assert.equal(M.num(5),'0,05');assert.equal(M.num(123456789),'1.234.567,89');assert.equal(M.cents('R$ 5.000,00'),500000);
assert.equal(M.parseRate('12,5'),1250);assert.equal(M.parseRate('0.29'),29);assert.equal(M.parseRate('15%'),1500);assert.equal(M.parseRate('1,234'),null);assert.equal(M.parseRate('x'),null);
assert.equal(M.rate(1500),'15%');assert.equal(M.rate(1250),'12,5%');assert.equal(M.rate(1205),'12,05%');
const ds=[{rate:1200,principal:100000},{rate:1200,principal:250050}];
let p=M.planRate(ds,'add',100);assert.deepEqual(p.map(x=>x.nr),[1300,1300]);assert.equal(p[0].ni,13000);
assert(M.planRate(ds,'sub',1200).every(x=>!x.ok));assert(M.planRate(ds,'set',1500).every(x=>x.ok&&x.nr===1500));
assert(!M.planRate(ds,'add',M.MAXR)[0].ok);
console.log('money: ok');
