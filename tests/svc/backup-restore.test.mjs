// src/export/backup.js — createBackup (snapshot do cofre) e restore (a ROTA QUE APAGA STORES).
//
// É o item Q-04 do docs/ROADMAP.md: o módulo nunca foi carregado por teste algum (--experimental-test-coverage
// não o listava) enquanto restore('replace') apaga clients/debts/documents/history/blobs em backup.js:15.
// Nada aqui reimplementa backup, cifra ou ZIP: semear é pelos services reais, a leitura do envelope é o
// backup-format.js real e o cofre é o REAL (helpers/vault.mjs) sobre o IndexedDB falso.
//
// CUSTO (deliberado): um único cofre-fonte é criado no `before` raiz (~150 ms de PBKDF2 600k) e o snapshot é
// reaproveitado; os cenários que precisam de cofre limpo recriam o cofre (nova DEK, mesma senha) — é exatamente
// o caso "restaurar noutro dispositivo", e é o que prova que o restore REMARCA os bytes com a chave da sessão.
// O grupo cifrado é o pesado: 1 derivação de 600k em createBackup + 1 por readBackup com senha.
import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import * as db from '../../src/db/idb.js';
import * as BR from '../../src/export/backup.js';                 // createBackup · restore · readBackup
import { buildBackup } from '../../src/export/backup-format.js';  // só para forjar backups impossíveis de gerar
import * as S from '../../src/services/clients.js';
import * as DV from '../../src/services/debts.js';
import * as SET from '../../src/services/settings.js';
import * as rec from '../../src/services/records.js';
import { installFFlate } from '../helpers/dom.mjs';
import { dumpStore, failNext } from '../helpers/fake-idb.mjs';
import { setupVault, unlock, lockNow, SENHA_TESTE } from '../helpers/vault.mjs';
import {
  novoClienteParaSalvar, novoClienteFicticio, novaDividaParaSalvar, novaDividaFicticia,
  novoDocumento, novoHistorico, novoArquivo, bytesFicticios, cpfFicticio, conjuntoBackup,
} from '../helpers/fixtures.mjs';
import { mask } from '../../src/domain/validators.js';

const F = installFFlate();                            // src/export/lib.js:2 resolve fflate pelo global
const SENHA_BACKUP = 'Senha-Do-Backup-Ficticia-9';    // DIFERENTE da senha do cofre: o backup não usa a DEK
// assert.rejects com RegExp testa a STRING do erro ('Error: …'), por isso o ^ não entra: ancora só no fim.
const ERRO_BLOB = /Um arquivo anexado está ausente ou ilegível; o backup foi cancelado para não ficar incompleto\.$/;

// ---------- apoio local (nenhum helper existente faz isso) ----------

// Cópia profunda de um `data` de backup (objeto + Map de Uint8Array): cada cenário mexe no seu sem vazar estado.
const copia = (d) => structuredClone(d);
const porId = (lista) => Object.fromEntries(lista.map((r) => [r.id, r]));

// Semeia um cofre fictício com as três classes de dado + anexos, tudo pelos services reais.
// Retorna o snapshot DO QUE ESTÁ NO BANCO (já decifrado) — é o gabarito do round-trip.
async function semearCofre() {
  const ids = [];
  for (let i = 0; i < 3; i++) {
    ids.push(await S.saveClient(novoClienteParaSalvar({ name: `Maria Exemplo ${i + 1}`, doc: mask.cpf(cpfFicticio(i)) }), null));
  }
  // foto de perfil sem passar por files/process.js: a conversão exige createImageBitmap (camada (c))
  await db.batch([
    await rec.blobOp('foto-cli-1', bytesFicticios(16, 7)),
    await rec.enc('clients', { ...(await S.getClient(ids[0])), photoId: 'foto-cli-1', photoType: 'image/webp' }),
  ]);
  const planos = [[100000, 1500], [250000, 2000], [500000, 1500], [123456, 50]];
  for (let i = 0; i < planos.length; i++) {
    await DV.saveDebt(ids[i % 3], novaDividaParaSalvar({ description: `Dívida fictícia ${i + 1}`, principal: planos[i][0], rate: planos[i][1] }));
  }
  for (let i = 0; i < 3; i++) {
    await S.addDoc(ids[i], novoArquivo({ name: `contrato-${i + 1}.txt`, bytes: bytesFicticios(24, i) }), 'Identificação');
  }
  await db.batch([await rec.hist(ids[2], 'Observação manual', 'nota de teste 1'), await rec.hist(ids[0], 'Observação manual', 'nota de teste 2')]);
  return { clients: await S.listClients(), debts: await DV.listDebts(), documents: await rec.list('documents'), history: await rec.list('history') };
}

// FONTE: um único snapshot do cofre A (claro e cifrado), reaproveitado por todos os grupos.
const FONTE = {};
before(async () => {
  await setupVault();                          // cofre A, destravado com SENHA_TESTE
  await SET.setDueWindow(30);                  // valor NÃO default, para ser asserido no round-trip
  FONTE.antes = await semearCofre();
  FONTE.zip = await BR.createBackup(null);     // caminho em claro
  FONTE.lido = await BR.readBackup(FONTE.zip);
  FONTE.bytes = new Map();                     // bytes originais lidos ANTES de qualquer reset de banco
  for (const id of FONTE.lido.data.files.keys()) FONTE.bytes.set(id, Uint8Array.from(await rec.blobBytes(id)));
  FONTE.cifrado = await BR.createBackup(SENHA_BACKUP);   // caminho cifrado do MESMO cofre (PBKDF2 600k)
});
after(() => lockNow());

describe('backup: createBackup fotografa o cofre', () => {
  it('produz um ZIP com as 4 listas + settings e um files/<blobId>.bin por anexo do banco', () => {
    const entradas = Object.keys(F.unzipSync(FONTE.zip)).sort();
    const esperadas = ['manifest.json', 'data/clients.json', 'data/debts.json', 'data/documents.json',
      'data/history.json', 'data/settings.json', ...[...FONTE.lido.data.files.keys()].map((id) => `files/${id}.bin`)].sort();
    assert.deepEqual(entradas, esperadas);
    assert.deepEqual(FONTE.lido.manifest.counts, { clients: 3, debts: 4, documents: 3, history: 12, files: 4 },
      'history = 3 cadastros + 4 dívidas + 3 documentos + 2 notas manuais');
    assert.equal(FONTE.lido.manifest.encrypted, false, 'sem senha o envelope se declara em claro');
  });

  it('os registros do backup são os que os services leem do banco, com campos e tipos preservados', () => {
    const clients = porId(FONTE.lido.data.clients), debts = porId(FONTE.lido.data.debts);
    assert.equal(clients[FONTE.antes.clients[0].id].name, 'Maria Exemplo 1');
    assert.equal(debts[FONTE.antes.debts[0].id].principal, FONTE.antes.debts[0].principal);
    const doc = FONTE.lido.data.documents[0];
    assert.equal(typeof doc.size, 'number');
    assert.match(doc.hash, /^[0-9a-f]{64}$/);
    assert.equal('interest' in doc, false);
    assert.equal(FONTE.lido.data.debts.some((d) => 'interest' in d), false, 'interest é derivado, nunca gravado');
    assert.equal(typeof debts[FONTE.antes.debts[0].id].due, 'string');
  });

  it('cada anexo sai do banco com os bytes idênticos aos gravados (foto do cliente inclusive)', () => {
    for (const [id, esperado] of FONTE.bytes) {
      assert.deepEqual([...FONTE.lido.data.files.get(id)], [...esperado], `bytes de ${id}`);
    }
    assert.ok(FONTE.lido.data.files.has('foto-cli-1'), 'photoId do cliente também entra como files/<id>.bin');
    assert.equal(FONTE.lido.data.files.size, 4);
  });

  it('settings.dueWindow é lido do banco e viaja no backup (aqui 30, não o default 7)', () => {
    assert.deepEqual(FONTE.lido.data.settings, { dueWindow: 30 });
  });

  it('dueWindow ausente no banco vira 7 no snapshot (o default de backup.js:8)', async () => {
    await setupVault();                                   // cofre novo: settings só tem idleMinutes
    const lido = await BR.readBackup(await BR.createBackup(null));
    assert.equal(lido.data.settings.dueWindow, 7);
    assert.deepEqual(lido.data.clients, []);
  });

  it('conhecido: photoId que aponta para blob ausente cancela o backup inteiro, com mensagem que não diz qual arquivo', async () => {
    // backup.js:7 envolve qualquer falha de leitura de blob numa mensagem única, sem distinguir foto de
    // documento e sem nomear o anexo podre (docs/ROADMAP.md Q-04/S-05). Characterization do texto real.
    await setupVault();
    const cid = await S.saveClient(novoClienteParaSalvar(), null);
    await db.batch([await rec.blobOp('foto-orfa', bytesFicticios(8, 1)),
      await rec.enc('clients', { ...(await S.getClient(cid)), photoId: 'foto-orfa', photoType: 'image/webp' })]);
    await db.batch([['delete', 'blobs', 'foto-orfa']]);    // some o bytes, fica a referência
    await assert.rejects(BR.createBackup(null), ERRO_BLOB);
    assert.equal((await db.getAll('blobs')).length, 0, 'createBackup não apaga nada ao desistir');
  });

  it('blob de DOCUMENTO ausente no banco cancela o backup com a mesma mensagem (foto e anexo são iguais para o erro)', async () => {
    // O coletor de backup.js:7 concatena photoId + blobId num único loop: o texto não diz qual dos dois falhou,
    // e a causa raiz (TypeError em records.js:9 sobre db.get(...) === undefined) é engolida pelo catch.
    await setupVault();
    const cid = await S.saveClient(novoClienteParaSalvar(), null);
    await S.addDoc(cid, novoArquivo({ name: 'prova.txt', bytes: bytesFicticios(9, 4) }), 'Comprovante de transferência');
    const [doc] = await S.listDocs(cid);
    await db.batch([['delete', 'blobs', doc.blobId]]);
    await assert.rejects(BR.createBackup(null), ERRO_BLOB);
    assert.equal((await rec.list('documents')).length, 1, 'o documento podre continua no banco');
    assert.equal((await db.getAll('blobs')).length, 0);
  });
});

describe('backup: restore em modo replace (num cofre limpo, com outra DEK)', () => {
  let contadores;
  before(async () => {
    await setupVault();                    // cofre B: banco vazio + nova DEK + MESMA senha de cofre
    contadores = await BR.restore(FONTE.lido.data, 'replace');
  });

  it('devolve os contadores das 4 listas (o que o backup declara, não o que havia no destino)', () => {
    assert.deepEqual(contadores, { clients: 3, debts: 4, documents: 3, history: 12 });
  });

  it('round-trip completo: ids, campos e tipos voltam exatamente iguais em clientes, dívidas, documentos e histórico', async () => {
    const depois = { clients: await S.listClients(), debts: await DV.listDebts(), documents: await rec.list('documents'), history: await rec.list('history') };
    for (const k of ['clients', 'debts', 'documents', 'history']) {
      assert.deepEqual(Object.keys(porId(depois[k])).sort(), Object.keys(porId(FONTE.antes[k])).sort(), `${k}: mesmos ids`);
      assert.deepEqual(porId(depois[k]), porId(FONTE.antes[k]), `${k}: conteúdo idêntico campo a campo`);
    }
  });

  it('blobs são reidratados byte a byte e RELIDOS com a chave do cofre novo (re-criptografia)', async () => {
    assert.deepEqual((await db.getAll('blobs')).map((b) => b.id).sort(), [...FONTE.bytes.keys()].sort());
    for (const [id, esperado] of FONTE.bytes) {
      assert.deepEqual([...await rec.blobBytes(id)], [...esperado], `${id} reidrata com os mesmos bytes`);
    }
    assert.equal(JSON.stringify(dumpStore('clients')).includes('Maria Exemplo'), false, 'o restore recriptografa');
  });

  it('settings.dueWindow sobrevive ao round-trip (voltou 30, não o default 7)', async () => {
    assert.equal(await SET.getDueWindow(), 30);
  });

  it('replace não encosta no cofre: meta permanece e a MESMA senha continua abrindo', async () => {
    assert.ok(dumpStore('meta').some((r) => r.key === 'vault'), 'restore apaga as 5 stores de dados, nunca meta');
    lockNow();
    await unlock(SENHA_TESTE);
    assert.equal((await S.listClients()).length, 3, 'dados relidos com a DEK original depois de reabrir o cofre');
    lockNow();                                            // cancela o timer de inatividade de unlock()
  });

  it('replace apaga as 5 stores: o que não está no backup some, inclusive os blobs órfãos', async () => {
    // É o único ponto do app em que dados do usuário são destruídos em massa (backup.js:15); o efeito tem que
    // ser asserido, não presumido. docs/ROADMAP.md D-10 registra que não há backup prévio nem lixeira.
    await setupVault();
    const sobra = await S.saveClient(novoClienteParaSalvar({ name: 'João Sobrante', doc: mask.cpf(cpfFicticio(40)) }), null);
    await DV.saveDebt(sobra, novaDividaParaSalvar({ description: 'Dívida sobrante' }));
    await S.addDoc(sobra, novoArquivo({ name: 'sobrou.txt', bytes: bytesFicticios(11, 3) }), 'Outro');
    await db.batch([await rec.hist(sobra, 'Nota sobrante')]);
    assert.equal((await db.getAll('blobs')).length, 1, 'um anexo local antes do restore');
    assert.deepEqual(await BR.restore(FONTE.lido.data, 'replace'), { clients: 3, debts: 4, documents: 3, history: 12 });
    assert.equal(await S.getClient(sobra), undefined, 'cliente órfão do backup foi apagado');
    assert.deepEqual((await S.listClients()).map((c) => c.name).sort(), FONTE.antes.clients.map((c) => c.name).sort());
    assert.equal((await DV.listDebts()).length, 4);
    assert.equal((await rec.list('documents')).length, 3);
    assert.equal((await rec.list('history')).length, 12);
    assert.deepEqual((await db.getAll('blobs')).map((b) => b.id).sort(), [...FONTE.bytes.keys()].sort(),
      'blob do cliente apagado não sobra como lixo');
  });

  it('conhecido: replace com settings null reescreve dueWindow como 7 e perde a preferência local', async () => {
    // backup.js:18 faz `d.settings?.dueWindow ?? 7` e validate() não olha settings (docs/ROADMAP.md D-06/Q-04):
    // um backup sem settings (ou de versão antiga) reseta a janela de vencimento em silêncio.
    await setupVault();
    await SET.setDueWindow(1);
    await BR.restore({ ...copia(FONTE.lido.data), settings: null }, 'replace');
    assert.equal(await SET.getDueWindow(), 7);
  });

  it('replace de um backup vazio apaga tudo e ainda assim reescreve settings (dueWindow volta a 7)', async () => {
    await setupVault();
    await SET.setDueWindow(3);
    const vazio = conjuntoBackup({ clientes: 0, dividas: 0, documentos: 0, historicos: 0 });
    assert.deepEqual(await BR.restore(vazio, 'replace'), { clients: 0, debts: 0, documents: 0, history: 0 });
    assert.equal(await SET.getDueWindow(), 7);
    assert.deepEqual(await S.listClients(), []);
  });
});

describe('backup: restore em modo merge (nada é apagado)', () => {
  let base;
  beforeEach(async () => {
    await setupVault();
    base = conjuntoBackup({ clientes: 2, dividas: 1, documentos: 1, historicos: 1 });
    await BR.restore(base, 'replace');       // cofre local = cli-001/cli-002, dvd-1, doc-1 (hash 'a'*64), his-1
  });

  it('merge acrescenta só o que não existe por id e devolve as contações do que entrou', async () => {
    const novo = copia(base);
    novo.clients.push(novoClienteFicticio({ id: 'cli-900', name: 'Ana Exemplo', doc: mask.cpf(cpfFicticio(7)) }));
    novo.debts.push(novaDividaFicticia({ id: 'dvd-900', clientId: 'cli-900' }));
    novo.documents.push(novoDocumento({ id: 'doc-900', clientId: 'cli-900', blobId: 'blb-900', hash: 'f'.repeat(64) }));
    novo.files.set('blb-900', bytesFicticios(20, 4));
    novo.history.push(novoHistorico({ id: 'his-900', clientId: 'cli-900' }));
    assert.deepEqual(await BR.restore(novo, 'merge'), { clients: 1, debts: 1, documents: 1, history: 1 });
    assert.equal((await S.listClients()).length, 3);
    assert.equal((await DV.listDebts()).length, 2);
    assert.equal((await rec.list('documents')).length, 2);
    assert.equal((await rec.list('history')).length, 2);
    assert.deepEqual([...novo.files.get('blb-900')], [...await rec.blobBytes('blb-900')], 'só o blob novo entrou');
    assert.equal((await db.getAll('blobs')).length, 2);
  });

  it('merge não apaga NADA: o registro local ausente no backup permanece, mesmo vindo de um backup menor', async () => {
    const extra = await S.saveClient(novoClienteParaSalvar({ name: 'João Local', doc: mask.cpf(cpfFicticio(41)) }), null);
    const outro = copia(base);
    outro.clients = [outro.clients[0]];                       // backup que não menciona nem dvd-1 nem cli-002
    assert.deepEqual(await BR.restore(outro, 'merge'), { clients: 0, debts: 0, documents: 0, history: 0 });
    assert.equal((await S.getClient(extra)).name, 'João Local');
    assert.equal((await S.getClient('cli-002')).name, base.clients[1].name, 'cliente fora do backup sobrevive');
    assert.equal((await DV.listDebts()).length, 1, 'dívida fora do backup NÃO é apagada');
    assert.deepEqual((await db.getAll('blobs')).map((b) => b.id).sort(), ['blb-1'], 'o blob do backup permanece: nada foi destruído');
  });

  it('conhecido: no merge o registro LOCAL com o mesmo id prevalece em silêncio — backup não atualiza campo algum', async () => {
    // backup.js:22 faz `continue` quando o id já existe: restaurar um backup mais NOVO sobre um cofre usado não
    // traz as edições nem desfaz exclusões (docs/ROADMAP.md Q-04). Characterization.
    const atual = await S.getClient(base.clients[0].id);
    await S.saveClient({ ...atual, name: 'Maria Editada Local' }, atual);
    const d = copia(base);
    d.clients[0].name = 'Maria Vem Do Backup';
    assert.equal((await BR.restore(d, 'merge')).clients, 0);
    assert.equal((await S.getClient(base.clients[0].id)).name, 'Maria Editada Local');
  });

  it('merge casa cliente por CPF/CNPJ quando o id difere e remarra clientId de dívidas, documentos e histórico', async () => {
    const d = copia(base);
    d.clients = [novoClienteFicticio({ id: 'cli-OUTRO', name: 'Maria Exemplo 01', doc: base.clients[0].doc })];
    d.debts = [novaDividaFicticia({ id: 'dvd-OUTRA', clientId: 'cli-OUTRO' })];
    d.documents = [novoDocumento({ id: 'doc-OUTRO', clientId: 'cli-OUTRO', blobId: 'blb-OUTRO', hash: 'e'.repeat(64) })];
    d.files = new Map([['blb-OUTRO', bytesFicticios(9, 2)]]);
    d.history = [novoHistorico({ id: 'his-OUTRO', clientId: 'cli-OUTRO' })];
    assert.deepEqual(await BR.restore(d, 'merge'), { clients: 0, debts: 1, documents: 1, history: 1 },
      'o cliente não entrou (mesmo documento), as referências entraram remapeadas');
    assert.equal(await S.getClient('cli-OUTRO'), undefined, 'não nasceu cliente duplicado');
    const cid = base.clients[0].id;
    assert.deepEqual((await DV.listDebts(cid)).map((x) => x.id).sort(), ['dvd-1', 'dvd-OUTRA']);
    assert.deepEqual((await S.listDocs(cid)).map((x) => x.id).sort(), ['doc-1', 'doc-OUTRO']);
    assert.deepEqual([...d.files.get('blb-OUTRO')], [...await rec.blobBytes('blb-OUTRO')]);
    assert.equal((await S.listHistory(cid)).find((h) => h.id === 'his-OUTRO').clientId, cid);
  });

  it('conhecido: merge pula documento duplicado por clientId+hash mesmo com id diferente (e não escreve o blob dele)', async () => {
    // backup.js:26 dedupra por `clientId+hash`, não por conteúdo do blob nem por id: um documento reempacotado
    // com bytes DIFERENTES mas mesmo hash é descartado em silêncio (docs/ROADMAP.md Q-04/D-02).
    const d = copia(base);
    d.debts = [];
    d.history = [];
    d.documents = [novoDocumento({ id: 'doc-DUP', clientId: base.clients[0].id, blobId: 'blb-DUP', hash: base.documents[0].hash })];
    d.files = new Map([['blb-DUP', bytesFicticios(6, 8)]]);
    assert.deepEqual(await BR.restore(d, 'merge'), { clients: 0, debts: 0, documents: 0, history: 0 });
    assert.equal((await rec.list('documents')).length, 1);
    assert.equal(await db.get('blobs', 'blb-DUP'), undefined, 'o blob do documento pulado não entra como lixo');
    assert.equal((await db.getAll('blobs')).length, 1);
  });

  it('conhecido: merge NÃO restaura settings.dueWindow (só replace escreve em settings — R-11 do Q-04)', async () => {
    await SET.setDueWindow(1);
    const d = copia(base);
    d.settings = { dueWindow: 21 };
    await BR.restore(d, 'merge');
    assert.equal(await SET.getDueWindow(), 1, 'o merge ignorou o dueWindow do backup');
  });
});

describe('backup: ida e volta CIFRADA com senha (grupo lento: PBKDF2 600k por leitura)', () => {
  it('createBackup com senha não deixa dado algum em claro e a leitura com a senha reidrata o cofre inteiro', async () => {
    assert.equal(Buffer.from(FONTE.cifrado).includes(Buffer.from('Maria Exemplo')), false);
    assert.deepEqual(Object.keys(F.unzipSync(FONTE.cifrado)).sort(), ['manifest.json', 'payload.enc']);
    const lido = await BR.readBackup(FONTE.cifrado, SENHA_BACKUP);          // 600k iterações
    assert.deepEqual(lido.data.clients, FONTE.lido.data.clients);
    assert.deepEqual([...lido.data.files.keys()].sort(), [...FONTE.bytes.keys()].sort());
    await setupVault();                                                     // cofre novo, sem dados
    assert.deepEqual(await BR.restore(lido.data, 'replace'), { clients: 3, debts: 4, documents: 3, history: 12 });
    for (const [id, esperado] of FONTE.bytes) {
      assert.deepEqual([...await rec.blobBytes(id)], [...esperado], `${id} idêntico após o caminho cifrado`);
    }
    assert.equal(await SET.getDueWindow(), 30);
  });

  it('senha errada é BAD_PASSWORD — nunca INVALID (backup-format.js:35)', async () => {
    await assert.rejects(BR.readBackup(FONTE.cifrado, 'senha-errada-ficticia'), (e) => {
      assert.equal(e.code, 'BAD_PASSWORD');
      assert.match(e.message, /Senha do backup incorreta ou arquivo corrompido/);
      return true;
    });
  });

  it('backup cifrado aberto SEM senha é NEEDS_PASSWORD', async () => {
    await assert.rejects(BR.readBackup(FONTE.cifrado), (e) => e.code === 'NEEDS_PASSWORD');
  });

  it('conhecido: backup SEM senha aberto COM senha é aceito — a senha é ignorada em silêncio', async () => {
    // O caminho claro de readBackup (backup-format.js:38+) nunca olha o argumento `password`: quem fornece uma
    // senha para um backup que NÃO está cifrado abre o arquivo sem aviso de que a proteção pedida não existia.
    const lido = await BR.readBackup(FONTE.zip, SENHA_BACKUP);
    assert.equal(lido.manifest.encrypted, false);
    assert.equal(lido.data.clients.length, 3);
  });

  it('arquivo truncado, lixo e bytes que não são ZIP são INVALID', async () => {
    await assert.rejects(BR.readBackup(FONTE.cifrado.slice(0, Math.floor(FONTE.cifrado.length * 0.6)), SENHA_BACKUP),
      (e) => e.code === 'INVALID');
    await assert.rejects(BR.readBackup(new Uint8Array([7, 8, 9, 10])), (e) => e.code === 'INVALID');
    await assert.rejects(BR.readBackup(F.strToU8('isto nao e um zip')), (e) => e.code === 'INVALID');
  });

  it('conhecido: a dívida órfã que debts.js grava (D-01) torna o backup IRRESTAURÁVEL — o erro é no backup.js de leitura', async () => {
    // validate() mora em backup-format.js:24 e é chamada por readBackup (re-exportado por backup.js:3), então a
    // mensagem chega como INVALID antes de qualquer restore. Characterization do efeito em cadeia.
    const d = copia(FONTE.lido.data);
    d.debts[0].clientId = 'cliente-que-nao-existe';
    await assert.rejects(BR.readBackup(await buildBackup(d, null)), (e) => {
      assert.equal(e.code, 'INVALID');
      assert.match(e.message, /Backup inconsistente/);
      return true;
    });
    await assert.rejects(BR.readBackup(await buildBackup(d, SENHA_BACKUP), SENHA_BACKUP), (e) => e.code === 'INVALID');
  });
});

describe('backup: cofre bloqueado e atomicidade', () => {
  let antes;
  beforeEach(async () => {
    await setupVault();
    await semearCofre();
    antes = { clients: dumpStore('clients').length, debts: dumpStore('debts').length, blobs: dumpStore('blobs').length };
    lockNow();
  });

  it('createBackup com o cofre bloqueado lança exatamente "Sessão bloqueada." (auth.js:14)', async () => {
    await assert.rejects(BR.createBackup(null), (e) => e.message === 'Sessão bloqueada.');
    await assert.rejects(BR.createBackup(SENHA_BACKUP), (e) => e.message === 'Sessão bloqueada.');
  });

  it('restore replace com o cofre bloqueado falha ANTES de apagar qualquer store (tudo-ou-nada de backup.js:11)', async () => {
    await assert.rejects(BR.restore(FONTE.lido.data, 'replace'), (e) => e.message === 'Sessão bloqueada.');
    assert.deepEqual({ clients: dumpStore('clients').length, debts: dumpStore('debts').length, blobs: dumpStore('blobs').length }, antes,
      'a rota destrutiva nem pode começar sem chave: nada foi apagado');
  });

  it('falha injetada no meio do batch derruba TODO o replace (rollback das 5 stores, sem escrita parcial)', async () => {
    await unlock(SENHA_TESTE);
    failNext('delete', new Error('falha injetada'));
    await assert.rejects(BR.restore(FONTE.lido.data, 'replace'), /falha injetada/);
    assert.deepEqual({ clients: dumpStore('clients').length, debts: dumpStore('debts').length, blobs: dumpStore('blobs').length }, antes,
      'os puts do backup também foram descartados junto com os deletes');
    lockNow();
  });
});
