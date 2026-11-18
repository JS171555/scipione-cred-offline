// src/domain/address.js — normalização de endereço e máscaras de CEP.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { onlyDigits, maskCep, validCep, composeAddress } from '../../src/domain/address.js';

describe('address: CEP', () => {
  it('onlyDigits é o digits de validators (mesma referência)', () => {
    assert.equal(onlyDigits('01001-000'), '01001000');
    assert.equal(onlyDigits(null), '');
  });
  it('maskCep completa e parcial', () => {
    assert.equal(maskCep('01001000'), '01001-000');
    assert.equal(maskCep('0100100'), '01001-00');
    assert.equal(maskCep(''), '');
    assert.equal(maskCep('010010009'), '01001-000');   // corta em 8 dígitos
  });
  it('validCep exige 8 dígitos e não pode ser tudo zero', () => {
    assert.equal(validCep('01001-000'), true);
    assert.equal(validCep('01001000'), true);
    assert.equal(validCep('0100100'), false);
    assert.equal(validCep('010010009'), false);
    assert.equal(validCep('00000000'), false);
    assert.equal(validCep(''), false);
    assert.equal(validCep(null), false);
  });
});

describe('address: composeAddress', () => {
  it('rua + número + bairro + cidade/UF', () => {
    assert.equal(composeAddress({ street: 'Praça da Sé', number: '100', district: 'Sé', city: 'São Paulo', state: 'sp' }),
      'Praça da Sé, 100 - Sé, São Paulo/SP');
  });
  it('complemento entra na primeira linha', () => {
    assert.equal(composeAddress({ street: 'Praça da Sé', number: '100', complement: 'Apto 12', district: 'Sé', city: 'São Paulo', state: 'SP' }),
      'Praça da Sé, 100, Apto 12 - Sé, São Paulo/SP');
  });
  it('sem número, sem complemento', () => {
    assert.equal(composeAddress({ street: 'Rua A', district: 'Centro', city: 'Campinas', state: 'SP' }), 'Rua A - Centro, Campinas/SP');
  });
  it('só número ainda aparece', () => {
    assert.equal(composeAddress({ number: '25', city: 'Santos', state: 'SP' }), '25 - Santos/SP');
  });
  it('só complemento ainda aparece', () => {
    assert.equal(composeAddress({ complement: 'Fundos', city: 'Santos', state: 'SP' }), 'Fundos - Santos/SP');
  });
  it('cidade/UF com UF normalizada para maiúsculas', () => {
    assert.equal(composeAddress({ city: 'Campinas', state: 'sp' }), 'Campinas/SP');
    assert.equal(composeAddress({ state: 'sp' }), 'SP');           // sem cidade: só a UF
    assert.equal(composeAddress({ city: 'Campinas' }), 'Campinas');
  });
  it('objeto vazio e undefined viram string vazia', () => {
    assert.equal(composeAddress({}), '');
    assert.equal(composeAddress(), '');
  });
  it('espaços nas pontas são aparados (clean)', () => {
    assert.equal(composeAddress({ street: '  Rua A ', number: ' 10 ', city: '  Campinas ', state: ' sp ' }), 'Rua A, 10 - Campinas/SP');
  });
  it('null/undefined nos campos não vazam "undefined" para a string', () => {
    assert.equal(composeAddress({ street: null, number: undefined, city: null, state: null }), '');
  });
  it('conhecido: um complemento sem rua/número não gera vírgula pendente', () => {
    // ver docs/ROADMAP.md — linha 1 é `[street+number, complement].filter(Boolean).join(', ')`;
    // sem rua, o complemento sozinho ocupa a linha 1 e a cidade/UF vai para a linha 2.
    assert.equal(composeAddress({ complement: 'Casa', city: 'Santos', state: 'SP' }), 'Casa - Santos/SP');
  });
});
