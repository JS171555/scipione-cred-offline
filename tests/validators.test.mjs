import assert from 'node:assert/strict';import{validCPF,validCNPJ,mask,digits}from '../src/domain/validators.js';
assert(validCPF('529.982.247-25'));assert(!validCPF('529.982.247-26'));assert(!validCPF('111.111.111-11'));
assert(validCNPJ('11.222.333/0001-81'));assert(!validCNPJ('11.222.333/0001-80'));assert(!validCNPJ('00000000000000'));
assert.equal(mask.cpf('52998224725'),'529.982.247-25');assert.equal(mask.cnpj('11222333000181'),'11.222.333/0001-81');
assert.equal(mask.phone('11987654321'),'(11) 98765-4321');assert.equal(mask.phone('1133334444'),'(11) 3333-4444');assert.equal(digits('(11) 9'),'119');
console.log('validators: ok');
