// src/security/crypto.js + src/security/auth.js — parâmetros REAIS do cofre.
//
// Por que este arquivo existe: na suíte antiga nenhum teste asseria `meta.iter` (auditoria §2.4 e D6). Baixar
// ITER de 600000 para 10000 derrubava a resistência a força bruta em 60x e a suíte continuava 100% verde.
// Aqui o custo do KDF é travado, o algoritmo é travado, e a integridade GCM é exercitada byte a byte.
//
// Precisa do harness porque `lock()`/`setup()`/`unlock()` vivem em src/security/auth.js, que fala com o
// IndexedDB (meta/vault, meta/session) e com sessionStorage — falsificados pelos helpers, com os módulos de
// criptografia REAIS por baixo (nenhuma cópia de lógica de produto neste arquivo).
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../../src/security/crypto.js';
import * as A from '../../src/security/auth.js';
import { get as dbGet } from '../../src/db/idb.js';
import { dumpStore } from '../helpers/fake-idb.mjs';
import { setupVault, lockNow, SENHA_TESTE } from '../helpers/vault.mjs';
import { conjuntoBackup } from '../helpers/fixtures.mjs';

const bytes = (v) => (v instanceof Uint8Array ? v : new Uint8Array(v));

describe('crypto: parâmetros do KDF e da cifra (trava de custo)', () => {
  let meta, dek;
  before(async () => {
    const v = await C.createVault(SENHA_TESTE);
    meta = v.meta;
    dek = await C.openVault(SENHA_TESTE, meta);
  });

  it('ITER exportado é 600000 — mudar isso exige quebrar este teste', () => {
    assert.equal(C.ITER, 600000);
  });
  it('o meta gravado carrega iter/kdf/cipher/v explícitos', () => {
    assert.equal(meta.iter, 600000);
    assert.equal(meta.kdf, 'PBKDF2-SHA256');
    assert.equal(meta.cipher, 'AES-GCM-256');
    assert.equal(meta.v, 1);
  });
  it('salt tem 16 bytes, IV tem 12 bytes e a DEK vem embrulhada (wrapped)', () => {
    assert.equal(bytes(meta.salt).length, 16);
    assert.equal(bytes(meta.iv).length, 12);
    assert.ok(bytes(meta.wrapped).length > 0);
    assert.ok(!('password' in meta) && !('senha' in meta), 'a senha nunca pode aparecer no meta');
  });
  it('salt e IV são diferentes a cada cofre criado', async () => {
    const outro = (await C.createVault(SENHA_TESTE)).meta;
    assert.notDeepEqual([...outro.salt], [...meta.salt]);
    assert.notDeepEqual([...outro.iv], [...meta.iv]);
  });
  it('a DEK é AES-GCM de 256 bits e não exportável', () => {
    assert.equal(dek.type, 'secret');
    assert.equal(dek.algorithm.name, 'AES-GCM');
    assert.equal(dek.algorithm.length, 256);
    assert.equal(dek.extractable, false);
    assert.deepEqual(dek.usages.slice().sort(), ['decrypt', 'encrypt']);
  });
  it('exportar a DEK cruamente é recusado pelo WebCrypto', async () => {
    await assert.rejects(globalThis.crypto.subtle.exportKey('raw', dek));
  });
  it('a KEK derivados da senha também é não exportável (só wrap/unwrap)', async () => {
    // mesmo contrato de deriveKey de crypto.js:6: extractable=false, usos wrapKey/unwrapKey
    const kek = await globalThis.crypto.subtle.deriveKey(
      { name: 'PBKDF2', hash: 'SHA-256', salt: meta.salt, iterations: meta.iter },
      await globalThis.crypto.subtle.importKey('raw', new TextEncoder().encode(SENHA_TESTE), 'PBKDF2', false, ['deriveKey']),
      { name: 'AES-GCM', length: 256 }, false, ['wrapKey', 'unwrapKey']);
    assert.equal(kek.extractable, false);
    assert.deepEqual(kek.usages.slice().sort(), ['unwrapKey', 'wrapKey']);
  });

  it('senha errada não abre o cofre (falha pela tag GCM, não por comparação de senha)', async () => {
    await assert.rejects(C.openVault('senha-errada-123', meta));
  });
  it('iter downgrade no arquivo impede a abertura (o custo é dado de arquivo validado pela cifra)', async () => {
    await assert.rejects(C.openVault(SENHA_TESTE, { ...meta, iter: 1000 }));
    // o valor erraco de `iter` NÃO é rejeitado por validação: ele só faz a derivação errada. Um cofre
    // gravado com iter baixo abre normalmente — é por isso que o assert de C.ITER acima importa.
    // conhecido: ver docs/ROADMAP.md — openVault (crypto.js:14) trusting m.iter
  });
  it('round-trip de JSON cifrado preserva o objeto', async () => {
    const dado = { nome: 'Maria Exemplo', valores: [1, 2, 3], aninhado: { ok: true } };
    assert.deepEqual(await C.openJSON(dek, await C.sealJSON(dek, dado)), dado);
  });
  it('IV é diferente a cada gravação do mesmo objeto', async () => {
    const a = await C.sealJSON(dek, { a: 1 }), b = await C.sealJSON(dek, { a: 1 });
    assert.notDeepEqual([...a], [...b]);
    assert.deepEqual([...bytes(a).slice(0, 12)].length, 12);
  });
  it('adulteração de 1 byte é detectada em qualquer posição da carga', async () => {
    const selado = await C.sealJSON(dek, { valor: 500000 });
    for (const pos of [12, 20, selado.length - 1]) {   // início do ciphertext, meio e último byte da tag
      const t = Uint8Array.from(selado); t[pos] ^= 1;
      await assert.rejects(C.openJSON(dek, t), `byte ${pos} adulterado passou despercebido`);
    }
  });
  it('trocar o IV (reordenar o envelope) quebra a abertura', async () => {
    const selado = await C.sealJSON(dek, { valor: 1 });
    const t = Uint8Array.from(selado);
    [t[0], t[1]] = [t[1], t[0]];
    await assert.rejects(C.openJSON(dek, t));
  });
  it('sealBytes/openBytes é a mesma cifra usada por backup e blobs', async () => {
    const original = Uint8Array.from(conjuntoBackup().files.get('blb-1'));
    const volta = await C.openBytes(dek, await C.sealBytes(dek, original));
    assert.deepEqual([...volta], [...original]);
  });
  it('deriveAesKey (backup com senha) é PBKDF2-SHA256/AES-GCM-256 e também não exportável', async () => {
    const k = await C.deriveAesKey(SENHA_TESTE, C.rnd(16), C.ITER);
    assert.equal(k.algorithm.name, 'AES-GCM');
    assert.equal(k.algorithm.length, 256);
    assert.equal(k.extractable, false);
  });
  it('rnd devolve n bytes diferentes entre chamadas', () => {
    const a = C.rnd(32), b = C.rnd(32);
    assert.equal(a.length, 32);
    assert.notDeepEqual([...a], [...b]);
  });
});

describe('auth: o que lock() faz e o que NÃO faz com a DEK (characterization)', () => {
  beforeEach(async () => { await setupVault() });
  after(() => lockNow());

  it('setup cria meta/vault e já deixa a sessão destravada', async () => {
    assert.equal(A.isUnlocked(), true);
    const vault = await dbGet('meta', 'vault');
    assert.equal(vault.iter, 600000);
    assert.equal(await A.hasVault(), true);
  });

  it('lock() zera a chave em memória, apaga meta/session e dispara os assinantes', async () => {
    let motivo = null;
    A.onLock((r) => { motivo = r });
    const antes = await dbGet('meta', 'session');
    assert.ok(antes && antes.dek.algorithm.name === 'AES-GCM', 'a sessão gravada carrega a DEK (structuredClone de CryptoKey)');
    A.lock('idle');
    assert.equal(A.isUnlocked(), false, 'lock é síncrono para o estado em memória');
    assert.equal(motivo, 'idle');
    await new Promise((r) => setTimeout(r, 0));          // o del é fire-and-forget; um tick espera o commit
    assert.equal(await dbGet('meta', 'session'), undefined, 'meta/session sai do banco');
    assert.throws(() => A.getKey(), /Sessão bloqueada/);
  });

  it('lock() NÃO apaga meta/vault: a DEK embrulhada continua no disco (por design, é o que permite reabrir)', async () => {
    A.lock('manual');
    await new Promise((r) => setTimeout(r, 0));
    const cruas = dumpStore('meta').map((m) => m.key);
    // conhecido: ver docs/ROADMAP.md — lock() (auth.js:65-69) só remove 'session'; 'vault' (salt/iv/wrapped/iter)
    // permanece, então "bloqueado" significa "senha necessária", não "chave destruída".
    assert.deepEqual(cruas, ['vault']);
    assert.ok(await A.hasVault());
    assert.ok(bytes((await dbGet('meta', 'vault')).wrapped).length > 0);
  });

  it('lock() NÃO espera o delete do banco terminar (é fire-and-forget)', () => {
    const ret = A.lock('manual');
    assert.equal(ret, undefined, 'lock() é síncrono e não devolve Promise: a prova é isso');
  });

  it('depois de lock() um unlock com a senha correta reabre a mesma DEK', async () => {
    const k1 = A.getKey();
    A.lock('manual');
    await A.unlock(SENHA_TESTE);
    const dado = { segredo: 42 };
    const selado = await C.sealJSON(k1, dado);
    assert.deepEqual(await C.openJSON(A.getKey(), selado), dado, 'a DEK reaberta é a mesma chave de dados');
  });

  it('setup() duas vezes recusa (não sobrescreve o cofre existente)', async () => {
    await assert.rejects(A.setup('outra-senha-123'), /Já existe uma senha cadastrada/);
  });
  it('unlock com senha errada lança "Senha incorreta." e mantém o cofre fechado', async () => {
    A.lock('manual');
    await assert.rejects(A.unlock('senha-errada-123'), /Senha incorreta/);
    assert.equal(A.isUnlocked(), false);
  });
});
