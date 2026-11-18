// src/domain/validators.js (puro) + as regras de e-mail/telefone que moram em src/services/clients.js:12-13.
// Nada aqui precisa de IndexedDB/DOM: clients.validate é uma função pura, embora viva num módulo que importa o banco.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validCPF, validCNPJ, mask, digits } from '../../src/domain/validators.js';
import { validate } from '../../src/services/clients.js';

const BASE = { type: 'PF', name: 'Maria Exemplo', doc: '111.444.777-35' };

describe('validators: CPF', () => {
  it('aceita o CPF fictício com e sem máscara', () => {
    assert.equal(validCPF('111.444.777-35'), true);
    assert.equal(validCPF('11144477735'), true);
    assert.equal(validCPF('111.444777-35'), true);   // só dígitos importam
  });
  it('aceita até um número (String() antes dos dígitos)', () => {
    assert.equal(validCPF(11144477735), true);
  });
  it('rejeita dígito verificador errado', () => {
    assert.equal(validCPF('111.444.777-36'), false);
  });
  it('rejeita sequências repetidas mesmo com DV "matematicamente" válido', () => {
    assert.equal(validCPF('111.111.111-11'), false);
    assert.equal(validCPF('00000000000'), false);
  });
  it('rejeita comprimento errado', () => {
    assert.equal(validCPF('1114447773'), false);
    assert.equal(validCPF('111444777359'), false);
  });
  it('rejeita vazio, null e undefined sem lançar', () => {
    assert.equal(validCPF(''), false);
    assert.equal(validCPF(null), false);
    assert.equal(validCPF(undefined), false);
  });
});

describe('validators: CNPJ', () => {
  it('aceita o CNPJ fictício válido (com e sem máscara)', () => {
    assert.equal(validCNPJ('11.222.333/0001-81'), true);
    assert.equal(validCNPJ('11222333000181'), true);
  });
  it('rejeita o mesmo corpo com o dígito verificador errado', () => {
    assert.equal(validCNPJ('11.222.333/0001-44'), false);
    assert.equal(validCNPJ('11.222.333/0001-80'), false);
  });
  it('rejeita zeros e repetidos e comprimento errado', () => {
    assert.equal(validCNPJ('00000000000000'), false);
    assert.equal(validCNPJ('11111111111111'), false);
    assert.equal(validCNPJ('1122233300018'), false);
    assert.equal(validCNPJ(null), false);
  });
});

describe('validators: digits e máscaras progressivas', () => {
  it('digits só aceita string e devolve os dígitos', () => {
    assert.equal(digits('(11) 9'), '119');
    assert.equal(digits(''), '');
    assert.equal(digits(null), '');
    assert.equal(digits(undefined), '');
    assert.equal(digits(0), '');                       // String(0) -> '0'? não: `s||''` troca 0 por ''
  });
  it('mask.cpf funciona dígito a dígitos (digitação incremental)', () => {
    assert.equal(mask.cpf(''), '');
    assert.equal(mask.cpf('12'), '12');
    assert.equal(mask.cpf('529982'), '529.982');
    assert.equal(mask.cpf('52998224725'), '529.982.247-25');
    assert.equal(mask.cpf('52998224725999'), '529.982.247-25');   // corta em 11 dígitos
  });
  it('mask.cnpj funciona dígito a dígitos', () => {
    assert.equal(mask.cnpj('1122'), '11.22');
    assert.equal(mask.cnpj('1122233300'), '11.222.333/00');
    assert.equal(mask.cnpj('11222333000181'), '11.222.333/0001-81');
  });
  it('mask.phone cobre os 4 ramos (<=2, <=6, <=10, >10)', () => {
    assert.equal(mask.phone(''), '');
    assert.equal(mask.phone('11'), '11');
    assert.equal(mask.phone('113'), '(11) 3');
    assert.equal(mask.phone('11333344'), '(11) 3333-44');
    assert.equal(mask.phone('1133334444'), '(11) 3333-4444');       // fixo
    assert.equal(mask.phone('11987654321'), '(11) 98765-4321');     // celular
    assert.equal(mask.phone('11333344445555666'), '(11) 33334-4445'); // conhecido: recorte em 11 dígitos
  });
});

describe('regras de cadastro (clients.validate) — e-mail e telefone', () => {
  it('cadastro mínimo válido não gera erros', () => {
    assert.deepEqual(validate(BASE, null, []), {});
  });
  it('nome é obrigatório e a mensagem depende de PF/PJ', () => {
    assert.match(validate({ ...BASE, name: '' }, null, []).name, /nome completo/);
    assert.match(validate({ ...BASE, type: 'PJ', name: '' }, null, []).name, /razão social/);
  });
  it('PJ exige CNPJ e PF exige CPF', () => {
    assert.match(validate({ type: 'PF', name: 'Maria Exemplo', doc: '11.222.333/0001-81' }, null, []).doc, /CPF inválido/);
    assert.match(validate({ type: 'PJ', name: 'João Teste', doc: '111.444.777-35' }, null, []).doc, /CNPJ inválido/);
  });
  it('doc duplicado é recusado citando o dono, mas o próprio registro é permitido', () => {
    const outro = [{ id: 'z', name: 'João Teste', doc: '11144477735' }];
    assert.match(validate(BASE, { id: 'outro-id' }, outro).doc, /Já cadastrado para João Teste/);
    assert.deepEqual(validate(BASE, { id: 'z' }, outro), {});
    assert.deepEqual(validate(BASE, null, []), {});
  });
  it('telefone exige 10 ou 11 dígitos quando preenchido', () => {
    assert.match(validate({ ...BASE, phone: '123456789' }, null, []).phone, /DDD e número/);
    assert.deepEqual(validate({ ...BASE, phone: '(11) 3333-4444' }, null, []), {});
    assert.deepEqual(validate({ ...BASE, mobile: '(11) 98765-4321' }, null, []), {});
    assert.deepEqual(validate({ ...BASE, phone: '' }, null, []), {});   // vazio é opcional
  });
  it('e-mail exige "@", domínio e TLD', () => {
    assert.match(validate({ ...BASE, email: 'maria@ex' }, null, []).email, /E-mail inválido/);
    assert.match(validate({ ...BASE, email: 'maria ex@exemplo.invalid' }, null, []).email, /E-mail inválido/);
    assert.deepEqual(validate({ ...BASE, email: 'maria@exemplo.invalid' }, null, []), {});
    assert.deepEqual(validate({ ...BASE, email: '' }, null, []), {});
  });
});
