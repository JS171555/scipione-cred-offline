import assert from 'node:assert/strict';
import{createVault,openVault,sealJSON,openJSON}from '../src/security/crypto.js';
const{meta}=await createVault('Senha-Forte-1');const k=await openVault('Senha-Forte-1',meta);
await assert.rejects(openVault('errada',meta));
const s=await sealJSON(k,{a:1});assert.deepEqual(await openJSON(k,s),{a:1});
const t=s.slice();t[t.length-1]^=1;await assert.rejects(openJSON(k,t));      // adulteração detectada
assert.notDeepEqual(s,await sealJSON(k,{a:1}));                               // IV único por gravação
await assert.rejects(crypto.subtle.exportKey('raw',k));                       // chave não extraível
console.log('crypto: ok');
