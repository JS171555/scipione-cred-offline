// Cofre pronto para os testes de serviço: usa os módulos REAIS de segurança sobre o IndexedDB falso.
//
// Nada aqui reimplementa criptografia nem sessão: delega para src/security/crypto.js (PBKDF2-SHA256 600k →
// KEK → DEK AES-GCM-256 não extraível) e src/security/auth.js (setup/unlock/lock/sessão em sessionStorage).
// Copiar a lógica do app para um helper de teste seria exatamente o falso-positivo que a auditoria pede para
// evitar (7-testes-infra.md §6.3: "um harness sem teste é passivo de silenciosamente não testar nada").
//
// Requisitos de ambiente (importar estes arquivos já instala, de forma idempotente):
//  - helpers/fake-idb.mjs → globalThis.indexedDB + EventTarget global (src/db/idb.js);
//  - helpers/dom.mjs      → addEventListener/document (bind() em src/security/auth.js:11 usa ambos) e
//                           sessionStorage (read/store em auth.js:7-9). SEM o stub de sessionStorage,
//                           auth.js:38 restoreSession() devolve false engolido pelo try/catch de auth.js:7 —
//                           o teste "passaria sem testar nada" (armadilha apontada na auditoria §4.3).
//  - helpers.assertStubAtivo() abaixo prova que os stubs estão vivos antes de qualquer asserção de sessão.
//
// ATENÇÃO (custo e timers): cada setupVault() deriva chave com 600.000 iterações (~150 ms) — de propósito,
// para exercitar os parâmetros reais. Por isso use UM cofre por arquivo de teste (before()) e só force um
// reset por caso quando o caso depender de banco vazio. src/security/auth.js:60 agenda um setTimeout de
// `mins*60000` ao destravar: lockNow() cancela esse timer (auth.js:66). Chame lockNow() no after() do arquivo,
// senão o processo do teste fica vivo esperando o timer.

import * as A from '../../src/security/auth.js';
import { installFakeIndexedDB, resetFakeIndexedDB } from './fake-idb.mjs';
import { installDom, resetDom } from './dom.mjs';
import { SENHA_TESTE } from './fixtures.mjs';

export { SENHA_TESTE };
export const auth = A;

export function assertStubAtivo() {
  if (!globalThis.indexedDB) throw new Error('vault: globalThis.indexedDB ausente — importe helpers/fake-idb.mjs');
  if (!globalThis.sessionStorage) throw new Error('vault: sessionStorage ausente — sem ele auth.js:7 engole tudo');
  if (!globalThis.document) throw new Error('vault: document ausente — auth.js:11 bind() precisa de document.addEventListener');
  if (typeof globalThis.dispatchEvent !== 'function') throw new Error('vault: dispatchEvent global ausente — idb.js:30 emite data-changed nele');
  return true;
}

// Cria um cofre do zero (banco vazio) e devolve a sessão destravada.
// {reset:false} reaproveita o banco atual — só para quando o teste já preparou estado de propósito.
export async function setupVault(password = SENHA_TESTE, { reset = true } = {}) {
  installFakeIndexedDB(); installDom(); assertStubAtivo();
  if (reset) {
    if (A.isUnlocked()) A.lock('reset');       // limpa key/timer/sessão do teste anterior
    resetDom(); resetFakeIndexedDB();
  }
  await A.setup(password);
  return { password, key: A.getKey(), isUnlocked: A.isUnlocked() };
}

export async function unlock(password = SENHA_TESTE) {
  installFakeIndexedDB(); installDom();
  await A.unlock(password);
  return A.getKey();
}

// Bloqueio síncrono: zera a DEK em memória e cancela o timer de inatividade (auth.js:65-69).
// NÃO espera o db.del('meta','session') — é fire-and-forget no app; aguardar é responsabilidade do teste
// (ver characterization em tests/unit/security.test.mjs).
export function lockNow(reason = 'teste') {
  return A.lock(reason);
}

export const isUnlocked = () => A.isUnlocked();
export const getKey = () => A.getKey();
