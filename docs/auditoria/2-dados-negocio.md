# SCIPIONE CRED — Auditoria 2: camada de dados (IndexedDB) e regras de negócio

> **Trilha de evidência congelada.** Este relatório é a fonte bruta da auditoria de
> 2026-11-18, escrita contra o commit de referência `e78d776`. Ele é mantido como está,
> inclusive nos números de linha que depois mudaram: o valor do documento é justamente
> mostrar o que foi observado naquele commit. Ao corrigir S-02 e D-01, `api/cpf.js`,
> `src/services/apicpf.js`, `src/services/debts.js` e `src/ui/debts.js` mudaram de forma —
> as linhas vigentes desses arquivos (e de qualquer outro) estão nos documentos canônicos
> (`docs/SECURITY.md`, `docs/API.md`, `docs/ROADMAP.md`, `docs/TESTING.md`,
> `docs/PROJECT_MAP.md`), não aqui. Por isso `docs/auditoria/**` é isento da checagem de
> faixa do grupo `docs` de `scripts/check-static.mjs`: reescrever evidência histórica a cada
> refatoração destruiria exatamente o que a torna prova.


- **Projeto:** `/home/ubuntu/scipione-cred-offline`
- **Commit auditado:** `e78d776fd403b87b0009fd8a02c05fac280fbf3b`
- **Branch verificado:** `git rev-parse --abbrev-ref HEAD` = `chore/project-audit-and-test-infrastructure` (o commit é **idêntico** ao de `main` e `origin/main`, portanto o conteúdo auditado é o de `main`; a afirmação do enunciado "branch main" está **parcialmente incorreta** quanto ao ref checkout)
- **Escopo:** `src/db/idb.js`, `src/services/{clients,debts,records,settings,dashboard,search}.js`, `src/domain/{money,due,validators,address}.js`, `src/files/process.js` + callers em `src/ui/*.js` apenas para contrato. Criptografia/backup/integrações citados só como interface.
- **Modo:** READ-ONLY. Nenhum arquivo do projeto foi modificado; as execuções de verificação usaram harness em `/tmp/aud/` (stub de IndexedDB próprio, sem dependências).

Convenção deste documento: afirmações seguidas de `arquivo:linha` vêm do código; afirmações marcadas **[runtime]** foram reproduzidas contra os módulos reais do projeto com um stub de IndexedDB (anexo A); o que não pôde ser verificado está marcado **NÃO CONFIRMADO**.

---

## 1. Banco de dados

### 1.1 Identidade

| Item | Valor | Fonte |
|---|---|---|
| Nome do database | `scipione-cred` | `src/db/idb.js:13` |
| Versão pedida no `open()` | `DB_VERSION = MIGRATIONS.length` = **1** | `src/db/idb.js:10`, `src/db/idb.js:13` **[runtime]** |
| Nº de object stores | **7** | `src/db/idb.js:3-8` **[runtime]** |
| Nº de índices | **6** | `src/db/idb.js:6-8` **[runtime]** |
| `autoIncrement` | **não é usado em nenhum store** | `src/db/idb.js:3-8` (nenhuma opção além de `keyPath`) |
| Índice único (`unique:true`) | **não existe nenhum** | `src/db/idb.js:5` — `createIndex(x,x)` sem options |
| Conexão | singleton em memória via `let p` | `src/db/idb.js:11-17` |

> Stores, keyPaths, índices, relacionamentos e o que fica cifrado estão reunidos no bloco de esquema do **§8**.
| Durabilidade | `{durability:'strict'}` apenas em `readwrite` | `src/db/idb.js:20`, `src/db/idb.js:28` |

### 1.2 Transcrição exata dos stores e índices

Código-fonte do schema (`src/db/idb.js:2-9`):

```js
const MIGRATIONS=[db=>{
  db.createObjectStore('meta',{keyPath:'key'});      // :3
  db.createObjectStore('settings',{keyPath:'key'});  // :4
  const idx=(s,...n)=>{const o=db.createObjectStore(s,{keyPath:'id'});n.forEach(x=>o.createIndex(x,x));}; // :5
  idx('clients','createdAt');idx('debts','clientId','createdAt');idx('documents','clientId'); // :6
  db.createObjectStore('blobs',{keyPath:'id'});      // :7
  idx('history','clientId','at');                    // :8
}];
```

| # | Store | keyPath | autoIncrement | Índices (`nome = keyPath`) | Definido em |
|---|---|---|---|---|---|
| 1 | `meta` | `key` | não | — | `src/db/idb.js:3` |
| 2 | `settings` | `key` | não | — | `src/db/idb.js:4` |
| 3 | `clients` | `id` | não | `createdAt` | `src/db/idb.js:6` |
| 4 | `debts` | `id` | não | `clientId`, `createdAt` | `src/db/idb.js:6` |
| 5 | `documents` | `id` | não | `clientId` | `src/db/idb.js:6` |
| 6 | `blobs` | `id` | não | — | `src/db/idb.js:7` |
| 7 | `history` | `id` | não | `clientId`, `at` | `src/db/idb.js:8` |

Saída do **[runtime]** (stub que instrumenta `createObjectStore`/`createIndex` ao importar `src/db/idb.js`): 7 stores, 6 índices, exatamente como a tabela acima.

### 1.3 Achado central do schema: o índice `at` é morto

`src/db/idb.js:8` cria o índice `at` em `history`, mas **nenhum registro de `history` possui a propriedade `at`**: o construtor de registros é `src/services/records.js:10` (`hist()` grava `{id, clientId, createdAt, type, detail}`). O sort do histórico usa `createdAt` (`src/services/clients.js:37`). **[runtime]**: 0 de 3 registros de `history` tinham a chave `at`. Em IndexedDB, registros sem a keyPath do índice simplesmente não entram nele — o índice existe, ocupa espaço e nunca é populado.

### 1.4 Nenhum índice é usado por consulta

Busca por todo `src/`: **zero** ocorrências de `.index(`, `openCursor`, `getAllKeys` ou `IDBKeyRange` (verificado por `grep`). Toda leitura é `getAll`/`get` (`src/db/idb.js:22-23`) seguida de `filter`/`sort` em JavaScript: `src/services/clients.js:29-30`, `src/services/clients.js:36-37`, `src/services/debts.js:6`, `src/services/debts.js:26`, `src/services/dashboard.js:4`, `src/services/records.js:5`. Consequência de integridade+desempenho: cada listagem **decriptografa o store inteiro** (`src/services/records.js:5` chama `dec` para todos os registros).

### 1.5 Lógica de upgrade / `versionchange`

- **Loop de migração** (`src/db/idb.js:14`): `for(let v=e.oldVersion; v<MIGRATIONS.length; v++) MIGRATIONS[v](r.result, r.transaction)`. O índice do array `MIGRATIONS` é tratado como número de versão, e `DB_VERSION` é derivado do tamanho do array (`src/db/idb.js:10`).
  - **Passo a passo hoje:** existe apenas `MIGRATIONS[0]`. Com `oldVersion = 0` (banco novo) o loop executa `v=0` → cria os 7 stores e 6 índices acima. Com `oldVersion = 1` a condição `1 < 1` é falsa → **nenhum passo executado** (nada a fazer, banco já está no estado-alvo). **Não há transições intermediárias a tratar porque só existe uma versão.**
  - **Acoplamento frágil:** o esquema só funciona enquanto `DB_VERSION === MIGRATIONS.length` e enquanto `MIGRATIONS[v]` corresponder exatamente à transição `v → v+1`. Se alguém inserir uma migração no meio em vez de **acrescentar no fim** (a instrução está no comentário `src/db/idb.js:1`), o `open()` passaria a aplicar a transição errada para um dado `oldVersion`, sem nenhum mecanismo de detecção.
  - **Sem guarda de idempotência:** nada verifica `db.objectStoreNames.contains(...)` antes de `createObjectStore` (`src/db/idb.js:3-8`). Uma `MIGRATIONS[1]` que recrie um store existente aborta o upgrade (a especificação do IndexedDB lança `InvalidStateError`/`ErrExists`); **[runtime]** o stub reproduz isso ao replicar a API. **NÃO CONFIRMADO** em navegador real (ambiente sem IndexedDB).
  - **Sem tratamento de downgrade:** se o banco no aparelho estiver em versão maior que `DB_VERSION`, o `open()` falha com `VersionError` → cai em `r.onerror` (`src/db/idb.js:16`), que apenas rejeita com o erro cru; a UI mostra "Não foi possível abrir o banco local" (`src/main.js:63`). Não há mensagem específica nem recuperação.
  - **Bloqueio por outra aba:** `onblocked` (`src/db/idb.js:16`) rejeita com a mensagem "Feche as outras abas do SCIPIONE CRED e tente de novo."
  - **`versionchange`** (`src/db/idb.js:15`): fecha a conexão e zera o cache do singleton (`p=null`), sem reabrir. Transações em curso nessa conexão abortam → `run` rejeita com "Falha na operação do banco." (`src/db/idb.js:21`). A reabertura ocorre na próxima chamada de `openDB()`.
  - **Comentário de política:** "adicione uma função ao fim de MIGRATIONS para cada mudança de schema (nunca edite as antigas)" (`src/db/idb.js:1`) — convenção apenas documental, sem teste que a imponha (ver §7).

---

## 2. Formato de cada registro

### 2.1 Envelope híbrido (o ponto central do design)

`src/services/records.js:1` documenta e `src/services/records.js:4-10` implementa: **`id`, `createdAt` e `clientId` ficam em texto claro** (porque são as keyPaths/índices de `src/db/idb.js:5-8`); **todo o resto é JSON cifrado** no campo `data` (`sealJSON(getKey(), rest)` em `src/services/records.js:7`). A cifra acontece **antes** de o valor chegar ao `db.batch` — o comentário `src/db/idb.js:26` ("Cifre os dados antes") e o fato de `enc()` retornar um *op* já com `data` cifrado (`src/services/records.js:7`) confirmam que o IndexedDB nunca vê o payload em claro. **[runtime]** registro gravado de um cliente: chaves `id, createdAt, data`; `data` é `Uint8Array` (104 bytes) e o nome "Ana Souza" não aparece no registro cru.

Formatos observados **[runtime]**:

| Store | Chaves cruas do registro | Conteúdo cifrado em `data` |
|---|---|---|
| `clients` | `id`, `createdAt`, `data` | todo o resto do cliente |
| `debts` | `id`, `createdAt`, `clientId`, `data` | `description`, `principal`, `rate`, `date`, `due`, `notes`, `updatedAt` |
| `documents` | `id`, `createdAt`, `clientId`, `data` | `name`, `orig`, `category`, `type`, `size`, `originalSize`, `converted`, `hash`, `blobId` |
| `history` | `id`, `createdAt`, `clientId`, `data` | `type`, `detail` |
| `blobs` | `id`, `data` (cifrado binário) | — (o `data` **é** o arquivo cifrado) |
| `settings` | `key`, `value` | **nada cifrado** — texto puro (`src/services/settings.js:2-3`) |
| `meta` | `key` + campos de cofre | ver §2.5 |

### 2.2 Cliente

Campos gravados (montados em `src/services/clients.js:23`): `{...d, id, photoId, photoType, createdAt, updatedAt}`, onde `d` vem do formulário (`src/ui/clients.js:46`): `type` (`'PF'|'PJ'`), `name`, `doc`, `birth`, `gender`, `rg`, `phone`, `mobile`, `email`, `cep`, `state`, `street`, `number`, `complement`, `district`, `city`, `address`. Tipos: todos **string** exceto `createdAt`/`updatedAt` (número epoch-ms, `src/services/clients.js:19`) e `photoId`/`photoType` (string|null). Opcionais: todos os de endereço, `rg`, `birth`, `gender`, `email`, `phone`, `mobile`, `complement`, `number` (nenhum teste de obrigatoriedade além de `name` e `doc`, `src/services/clients.js:9-10`). `birth`/`gender`/`rg` são zerados pela UI quando `type==='PJ'` (`src/ui/clients.js:46`) — o serviço **não** impõe isso (**não validado**: `src/services/clients.js:7-14` não referencia `birth`, `gender`, `rg`, `cep`).
Detalhe de contrato **[runtime]**: a leitura (`dec`, `src/services/records.js:4`) sempre injeta a chave `clientId` no objeto — para clientes ela vale `undefined`, ou seja, o objeto devido por `getClient()`/`listClients()` contém uma propriedade `clientId: undefined` que não existe no registro gravado.

### 2.3 Dívida

Whitelist **explícita** em `src/services/debts.js:4` (`rec(d)`), que copia somente `id, clientId, createdAt, description, principal, date, due, notes, updatedAt` + `rate` — **qualquer campo extra enviado à função é descartado silenciosamente**. Tipos: `principal` inteiro em **centavos**, `rate` inteiro em centésimos de ponto percentual, `date`/`due` string `AAAA-MM-DD`, `notes` string (`d.notes||''`, `src/services/debts.js:4`), `createdAt`/`updatedAt` epoch-ms. `interest` **não é persistido**: é derivado a cada leitura (`withI`, `src/services/debts.js:5-6`, "juros sempre derivados: uma única fonte da verdade").

### 2.4 Documento, blob e fotografia

- Documento: `src/services/clients.js:42` grava `{id:uid(), clientId, createdAt:Date.now(), name, orig:file.name, category, type, size, originalSize, converted, hash, blobId}`. `category` pertence à lista fechada `CATS` (`src/services/clients.js:4`), mas **o serviço não valida** o valor recebido (`src/services/clients.js:38-42`); a UI só oferece as opções (`src/ui/clients.js:142,174`).
- Binário: vai para o store `blobs` como `{id, data}` cifrado (`src/services/records.js:8`). **[runtime]** 8 bytes de PDF viraram 36 bytes cifrados (12 IV + 8 + 16 tag GCM) → ~28 bytes de sobrecarga por arquivo.
- Foto de perfil: também é um blob (`src/services/clients.js:20-21`), com o `blobId`referenciado por `clients.photoId` **dentro do payload cifrado** (**[runtime]**: a string do id da foto não é legível no registro cru).
- Relação (tudo por convenção, sem constraint): `clients 1—N debts` por `clientId` (`src/services/debts.js:16`), `clients 1—N documents` (`src/services/clients.js:42`), `clients 1—N history` (`src/services/records.js:10`), `documents N—1 blobs` por `blobId`, `clients 1—1 blobs` por `photoId`. `debts` não referencia documentos, e `history` não referencia dívida nem documento (só `clientId` + texto, `src/services/records.js:10`) — **NÃO EXISTE** vínculo de auditoria entre um evento de histórico e a dívida específica que ele descreve.

### 2.5 Configurações e metadados (onde ficam)

- `settings` (`keyPath:'key'`), **texto claro**: `dueWindow` (`src/services/settings.js:2-3`) e `idleMinutes` (`src/security/auth.js:21,49`). **[runtime]**: `[{"key":"idleMinutes","value":5}]`.
- `meta` (`keyPath:'key'`), **texto claro exceto material criptográfico**: `vault` (`{salt, iv, wrapped, iter, kdf, cipher, v}` — `src/security/auth.js:21` + `src/security/crypto.js:11`), `guard` (`{fails, until}` — `src/security/auth.js:26,30,32`), `session` (`{sid, dek, last, mins}` — `src/security/auth.js:55`), `probe` (sonda de integridade gravada pela UI — `src/ui/settings.js:32`). **[runtime]** registro `session` contém um objeto `CryptoKey`. (Avaliar a segurança disso é da outra auditoria; aqui registro apenas que **`meta` e `settings` não passam por `enc()`** — gravação direta por `db.put` em `src/security/auth.js:21,30,32,49,55` e `src/services/settings.js:3`.)

### 2.6 Geração de IDs

`uid()` = `crypto.randomUUID()` → UUID v4 (`src/services/records.js:3`), usado para clientes (`src/services/clients.js:19`), dívidas (`src/services/debts.js:16`), documentos, blobs e fotos (`src/services/clients.js:20,41-42`) e eventos de histórico (`src/services/records.js:10`). **[runtime]** os ids gerados bateram com o regex de UUIDv4. Não há sequencialidade (o que torna a ordem de `getAll` — por chave — independente do tempo de criação, explicando por que a ordenação precisa ser refeita em JS).

### 2.7 Arquivos antes de gravar

`toStored()` (`src/files/process.js:5-16`): limite rígido de 15 MB (`src/files/process.js:4,6`), `hash = SHA-256` dos **bytes que serão gravados** (`src/files/process.js:7`), `converted:true/`redução apenas se JPG/PNG/WebP/BMP e o resultado WebP (ou JPEG fallback) for menor ou `force=true` (`src/files/process.js:9-14`); PDFs e outros formatos são gravados **como vieram** (`src/files/process.js:3,9`). Fotos de perfil passam `force:true, maxSide:512` (`src/services/clients.js:20`); documentos usam os padrões `maxSide:1600, q:0.8` (`src/services/clients.js:39`). O `hash` é a chave anti-duplicidade por cliente (`src/services/clients.js:40`).

---

## 3. Transações

### 3.1 Primitivos (`src/db/idb.js:19-30`)

| Função | Loja(s) | Modo | Observações |
|---|---|---|---|
| `get(s,k)` | 1 | `readonly` | `src/db/idb.js:22`; resolve com `request.result` no `oncomplete` (`src/db/idb.js:21`) |
| `getAll(s)` | 1 | `readonly` | `src/db/idb.js:23` |
| `put(s,v)` | 1 | `readwrite` + `durability:'strict'` | `src/db/idb.js:24,20` |
| `del(s,k)` | 1 | `readwrite` + strict | `src/db/idb.js:25,20` |
| `batch(ops)` | **N (união das lojas dos ops)** | `readwrite` + strict | `src/db/idb.js:27-30`; único caminho com **`data-changed`** (`src/db/idb.js:30`) |

- **Atomicidade de `batch`:** todas as ops (`['put'|'delete', store, valor|chave]`) são emitidas numa só transação; erro síncrono chama `t.abort()` (`src/db/idb.js:29`). **[runtime]**: um `batch` com 1 `put` válido + 1 op apontando para store inexistente rejeitou e **nada foi gravado** (o `put` não chegou ao store) → tudo-ou-nada confirmado para erros síncronos de montagem.
- **Falha assíncrona** (ex.: `QuotaExceededError` durante o commit) cai em `onerror/onabort` → rejeita com `t.error` ou "Falha na gravação." (`src/db/idb.js:30`). **NÃO CONFIRMADO** em navegador real.
- **`batch([])` não dispara `data-changed`** e retorna `undefined` (`src/db/idb.js:27`). **[runtime]** confirmado. Nenhum chamador atual passa lista vazia, mas a reinicialização silenciosa da UI (`src/core/live.js:2`) depende só desse evento.
- **`put`/`del`/`get`/`getAll` nunca disparam `data-changed`** → gravações feitas fora de `batch` **não** revalidam as telas. Afeta `setDueWindow` (`src/services/settings.js:3`) e `auth.setIdle` (`src/security/auth.js:49`): depois de mudar a janela de vencimentos, a página de Dívidas (`src/ui/debtspage.js:34-37`, que só recarrega via `watch`) permanece com o valor antigo em memória. **[runtime]**: `db.put` gerou 1 transação e 0 eventos.

### 3.2 Operações multi-store atômicas (uma única transação)

| Operação | Lojas na transação | Fonte |
|---|---|---|
| `saveClient` (novo/edite/foto) | `clients` + `blobs` (só se houver foto) + `history` | `src/services/clients.js:20-27` |
| `addDoc` | `blobs` + `documents` + `history` | `src/services/clients.js:42` |
| `removeDoc` | `blobs` + `documents` + `history` | `src/services/clients.js:43` |
| `deleteClient` (cascata) | `documents` + `blobs` + `debts` + `history` + `clients` | `src/services/clients.js:33-35` **[runtime]**: 1 transação `readwrite` sobre as 5 lojas |
| `saveDebt` | `debts` + `history` | `src/services/debts.js:16-23` |
| `deleteDebt` | `debts` + `history` | `src/services/debts.js:24` |
| `applyBulk` | `debts` + `history` (N de cada) | `src/services/debts.js:33-34` |
| `restore('replace')` | `clients`,`debts`,`documents`,`history`,`blobs` + `settings` | `src/export/backup.js:15-18,29` (interface — detalhe na auditoria 1) |

Padrão positivo: **preparação antes da transação** — todo o cifrado/convertido acontece em `await` fora da transação e só então `db.batch(ops)` grava (`src/services/clients.js:16-27`, `src/export/backup.js:11`). Um erro de cifra impede qualquer escrita.

### 3.3 Leitura-escrita NÃO atômica (riscos de inconsistência)

| # | Fluxo | Transações | Janela de corrida | Consequência |
|---|---|---|---|---|
| A | `saveClient` → `validate(d, old, await listClients())` (`src/services/clients.js:17`) e depois `db.batch` (`:27`) | 1 `readonly` em `clients` + 1 `readwrite` | unicidade de CPF/CNPJ checada fora da transação, e **sem índice `unique`** (`src/db/idb.js:5`) | **Dois cadastros simultâneos com o mesmo CPF são gravados.** **[runtime]**: 2 linhas com `doc=644…` a partir de duas chamadas concorrentes |
| B | `deleteClient`: `getClient` + `listDocs` + `rel('debts')` + `rel('history')` (`src/services/clients.js:32-34`) antes do `batch` (`:35`) | **4 `readonly` separadas** (`clients`,`documents`,`debts`,`history`) + 1 `readwrite` **[runtime]** | dívida/documento gravado por outra aba entre a leitura e o batch | **Registro órfão permanente.** **[runtime]**: "Dívida criada durante a exclusão" sobreviveu; cliente `B` não existia mais |
| C | `counts(id)` (`src/services/clients.js:30`) lido para o texto do `confirm` e depois relido por `deleteClient` | 2+ `readonly` distintas | o número exibido ≠ o número excluído | Diálogo de confirmação enganoso: `src/ui/clients.js:42` mostra `cnt.docs/cnt.debts` lidos em `src/services/clients.js:30`; a exclusão usa outra leitura (`src/services/clients.js:33-34`) |
| D | `addDoc`: checa `hash` via `listDocs` (`src/services/clients.js:40`) e grava no `batch` (`:42`) | 1 `readonly` em `documents` + 1 `readwrite` | anexos simultâneos do mesmo arquivo | Documento+blob duplicados para o mesmo cliente (a checagem não é atômica) |
| E | `applyBulk`: lê `list('debts')` (`src/services/debts.js:30`), compara taxas e grava em `batch` (`:34`) | 1 `readonly` + 1 `readwrite` | escrita entre a comparação e o commit | A taxa definida por outra aba é perdida (**lost update**). O guarda `src/services/debts.js:31` estreita mas **não fecha** a janela **[runtime]**: re-aplicar um plano obsoleto é corretamente recusado ("Os dados mudaram desde a busca") |
| F | `saveDebt(clientId, …)` **não verifica a existência do cliente** (`src/services/debts.js:14-16`) | — | UI com lista obsoleta (`src/ui/debtspage.js:28` só checa no clique) | Dívida órfã criada sem nenhum erro. **[runtime]**: `saveDebt('cliente-inexistente', …)` aceito |
| G | `auth.setup`: `db.put('meta',vault)` + `db.put('settings',idleMinutes)` em duas transações (`src/security/auth.js:21`) | 2 `readwrite` | queda entre as duas | `meta` existente sem `settings.idleMinutes` (recai no default `5`, `src/security/auth.js:33`) |
| H | `restore` (merge) resolve `clientId` via `map.get(...)` (`src/export/backup.js:24-27`) e `enc()` omite `clientId` falsio (`src/services/records.js:7`) | 1 `readwrite` final | id não mapeado | Registro gravado **sem `clientId`** → invisível em `rel()`/`deleteClient` (ver B) e incluído nos totais globais |

### 3.4 Rollback e erros

- Não há `try/finally` com compensação nem `t.commit()` explícito — o commit é automático quando as requisições sincronas terminam (`src/db/idb.js:19-21`), e o "rollback" existe apenas via abort dentro de `batch` (`src/db/idb.js:29`).
- `deleteClient` **retorna `undefined` silenciosamente** se o cliente não existe (`src/services/clients.js:32`): a UI chama `list()` logo após (`src/ui/clients.js:42`) e o usuário não recebe nenhum sinal de "não havia nada a excluir". **[runtime]** confirmado.
- `deleteClient` apaga `blobs` por `blobId` mesmo quando o blob já não existe (`src/services/clients.js:33`) — delete de chave inexistente é no-op, então **não gera erro** **[runtime]**, mas também **não detecta** inconsistência prévia. Já a leitura de um documento com blob ausente explode: `blobBytes` acessa `.data` sem guarda (`src/services/records.js:9`) → `TypeError` (**[runtime]**; a UI captura e exibe a mensagem, `src/ui/clients.js:144-145`).
- **Nenhum blob órfão** foi produzido nos caminhos normais testados **[runtime]** (substituir e remover foto apagam o blob antigo: `src/services/clients.js:21-22`). Órfãos surgem pelo caminho de backup, que grava todos os `files` do ZIP sem checar referência (`src/export/backup.js:17-18`; `validate` não vistoria arquivos não referenciados — **[runtime]**: mapa `files` com chave `orphan` passou sem erros em `src/export/backup-format.js:20-27`).
- Erro de transação é sempre rejeitado (nunca engolido) em `run`/`batch` (`src/db/idb.js:21,30`); a UI converte em mensagem (`src/ui/clients.js:42,47`, `src/main.js:8`).

---

## 4. Regras de negócio

### 4.1 Dinheiro — `src/domain/money.js`

| Regra | Implementação | Observação verificada |
|---|---|---|
| **Unidade: centavos inteiros** | `src/domain/money.js:1` (comentário) e uso em `src/services/debts.js:16` | **[runtime]** dívidas gravadas com `principal:150000` = R$ 1.500,00 |
| Taxa em **centésimos de ponto percentual** (`15% = 1500`) | `src/domain/money.js:1`, limite `MAXR=100000` (1000%) `src/domain/money.js:2` | `src/services/debts.js:10` aceita apenas `0 < rate ≤ MAXR` → **taxa 0% é recusada** **[runtime]** ("Informe uma taxa entre 0,01% e 1000%.") |
| Entrada de valor | `cents(s)` remove tudo que não é dígito (`src/domain/money.js:5`) | **[runtime]** `cents('1.500,00') = 150000` (correto) mas `cents('1.500') = 1500` → **R$ 15,00**, não R$ 1.500,00. Convenção "dígitos = centavos" é auto-reforçada pelo máscara no `input` (`src/ui/debts.js:39`), mas um valor digitado com separador de milhar é lido como centavos |
| Formatação | `num(c)`/`brl(c)` constroem a partir da string de inteiros, milhar com `.` e centavos após `,` (`src/domain/money.js:3-4`) | **[runtime]** `brl(18750) = 'R$ 187,50'`; negativo → `-5,00` (`Math.abs` + sinal, `src/domain/money.js:3`) |
| **Juros simples mensais, aritmética inteira** | `interest=(p,b)=>Number((BigInt(p)*BigInt(b)+5000n)/10000n)` (`src/domain/money.js:9`) — arredonda **meio para cima** ao centavo | **[runtime]** `interest(150000,1250)=18750`; `tests/money.test.mjs:3` cobre `333→33`, `335→34`, `1→0`; `tests/money.test.mjs:4` cobre `interest(1e13,100000)=1e14` (dentro de `Number.MAX_SAFE_INTEGER`, verificado) |
| **Fragilidade:** `BigInt()` lança em não-inteiro | `src/domain/money.js:9` | **[runtime]** `interest(1.5,1000)` → `RangeError: The number 1.5 cannot be converted to a BigInt`. Uma dívida com `principal` fracionário (possível via restauração de backup, ver §4.1.1) **quebra** `listDebts`/`stats`/relatórios |
| Exibição de taxa | `rate(b)` corta zeros-trailing (`src/domain/money.js:6`) | **[runtime]** `rate(1250)='12,5%'`, `rate(1505)='15,05%'`, `rate(1510)='15,1%'` |
| Parse de taxa | `parseRate` aceita `^\d+(\.\d{1,2})?$` → senão `null` (`src/domain/money.js:7`) | **[runtime]** `parseRate('12,555')=null`, `parseRate('1.234')=null`, `parseRate('15%')=1500` (coberto em `tests/money.test.mjs:6`) |
| Alteração em lote | `planRate(ds,mode,v)` com `mode∈{'add','sub','set'}` e `ok = 0<nr≤MAXR` (`src/domain/money.js:11`) | Recusada em `src/services/debts.js:29-30`; **[runtime]** `applyBulk` com uma `ok:false` no plano → "Há taxas inválidas na prévia." |
| **Soma de valores arredondados** | `src/services/dashboard.js:4` (`sum('interest')`) e `src/ui/debtspage.js:13` (`sm`) | O total é a **soma dos juros já arredondados por dívida**, não o arredondamento da soma. Como cada dívida arredonda individualmente, o total pode divergir do valor "exato" em fração de centavo por dívida. Não há "parcelas" no modelo (**NÃO EXISTE** campo de parcelas em `src/services/debts.js:4`), então o análogo real deste risco é a soma de `interest` |

**4.1.1 Validação do backup (interface com a auditoria 1).** `validate()` (`src/export/backup-format.js:20-27`) checa `id`/`name` de cliente, presença de `clientId` em dívida/documento/histórico, `principal>0`, `rate>0` e existência dos arquivos referenciados. **[runtime]** ela **não** rejeita: dívida sem `date`/`due` (retorna `[]`), `principal` fracionário (`1.5`), `settings.dueWindow` não numérico, e arquivo em `files` sem referência. Os itens 1 e 2 são a porta de entrada dos dois crashes de leitura descritos em §4.2/§4.1.

### 4.2 Vencimentos e indicadores — `src/domain/due.js`

| Regra | Fonte | Verificação |
|---|---|---|
| Datas em **ISO `AAAA-MM-DD`, sem fuso** | `src/domain/due.js:1-2` (`D(s)` monta `Date.UTC`) | Comparação sempre UTC → imune a horário de verão. **[runtime]** `daysUntil('2026-02-16','2026-02-15')=1` com `TZ=America/Sao_Paulo` |
| "Hoje" local | `todayISO()` desloca pelo `getTimezoneOffset()` e corta a ISO (`src/domain/due.js:3`); a UI repete a mesma expressão (`src/ui/debts.js:2`) | **[runtime]** no sandbox (TZ=UTC) retornou `2026-11-18` quando o relógio local do enunciado marcava `2026-11-17T21:26-03:00` — comportamento esperado, não é bug, mas **a definição de "hoje" depende do fuso do aparelho** |
| **Vencida**: `n < 0` | `src/domain/due.js:5` | **[runtime]** `daysUntil('2026-11-21','2026-11-14')=7` e `status(...)` coberto em `tests/stage4.test.mjs:2-3` |
| **Prestes a vencer**: `0 ≤ n ≤ janela` (inclui o próprio dia) | `src/domain/due.js:5` | **[runtime]** com `janela=0`, uma dívida que vence hoje ainda é `soon` |
| **Em dia**: `n > janela` | `src/domain/due.js:5` | idem |
| Janela configurável, default 7 | `src/services/settings.js:2` (`??7`); UI limita 1–365 (`src/ui/settings.js:42-44`) | **O serviço não valida** (`src/services/settings.js:3`). **[runtime]** `setDueWindow('abc')` gravou `{"key":"dueWindow","value":"abc"}` e `getDueWindow()` devolveu `'abc'` → `status()` passou a retornar `ok` para dívida que deveria ser `soon` (`n<=win` com `win='abc'` é `false`) |
| Legenda na UI | `src/ui/debtspage.js:16-17` (`Vencida há N dias` / `Vence em N dias` / `Vence hoje`), `src/ui/dashboard.js:13-15` | — |
| **Sem tolerância a dado ruim** | `D(s)` não valida nada (`src/domain/due.js:2`) | **[runtime]** `status('2026-11',7,…)` → `'overdue'` (o `slice(8,10)` vazio vira dia 0 → 31/out), `daysUntil('')` → `-46373`, `daysUntil('2026-02-30')` → `60` (rola para 2/mar), `daysUntil('2026-13-01')` → `45` (rola para jan/2027). E `status(undefined,…)` → **`TypeError: Cannot read properties of undefined (reading 'slice')`**, que **derruba `dashboard.stats()`** **[runtime]** |
| Entrada protegida só no cadastro | `iso()` em `src/services/debts.js:2` exige `^\d{4}-\d{2}-\d{2}$` **e** `!isNaN(Date.parse())` → `2026-02-30` é rejeitado (`src/services/debts.js:12`) | A proteção **não** se aplica ao caminho de restauração nem a registros já gravados |
| Sem "quitada" | `src/services/dashboard.js:2` (comentário: "não há quitação no escopo") | Todas as dívidas contam como ativas para sempre; `stats().debts = total gravado` (`src/services/dashboard.js:6`) |

**Ordenação por vencimento — achado:** `listDebts` ordena por `date` (data do registro) e não por `due` (`src/services/debts.js:6`); a página de Dívidas mantém essa ordenação por `date`/`createdAt` com opção "mais recentes/mais antigas" (`src/ui/debtspage.js:11`) e usa `due` apenas para filtro de situação e badge. **Não existe ordenação por vencimento em lugar algum** do app. Além disso, o comparator `b.date.localeCompare(a.date)` **lança `TypeError`** se algum registro não tiver `date` — **[runtime]** o resultado depende da posição do registro na lista: quando ele aparece como 2º argumento da comparação (caso geral com chaves UUID) o `sort` explode; quando V8 o usa apenas como 1º argumento (inserção binária, registro por último) o erro é **silenciado** e a ordenação fica errada, porque `localeCompare(undefined)` coerciona para a string `"undefined"`. Como a ordem de `getAll` é por chave (`src/db/idb.js:23`), o comportamento é **não determinístico**.

### 4.3 Validadores

**O que existe** em `src/domain/validators.js`:

| Validador | Regra | Fonte |
|---|---|---|
| `digits` | remove tudo que não é dígito | `src/domain/validators.js:1` |
| `validCPF` | 11 dígitos, rejeita repetição (`/^(\d)\1+$/`), 2 dígitos verificadores módulo 11 (`s*10%11)%10`) | `src/domain/validators.js:2-3` — **[runtime]**: `''`→false, `'abc'`→false, 12 dígitos→false, `11111111111`→false, `12345678901`→false |
| `validCNPJ` | 14 dígitos, pesos decrescentes 5..2/6..2 com reinício em 9, dígito `s%11<2?0:11-s%11` | `src/domain/validators.js:4-5` — **[runtime]**: CPF passado em `validCNPJ` → false; 13 dígitos → false |
| `mask.cpf` / `mask.cnpj` / `mask.phone` | truncam silenciosamente (`slice(0,11)`/`slice(0,14)`) | `src/domain/validators.js:7-9` — **[runtime]**: `mask.cpf('11222333000181')` → `112.223.330-00`; `mask.phone(12 dígitos)` → descarta o último |
| **E-mail** | `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` — mora no **service**, não no domínio | `src/services/clients.js:13` |
| **Telefone/celular** | exige 10 ou 11 dígitos (`src/services/clients.js:12`) | **[runtime]** validado em `saveClient`; mensagem "Informe DDD e número." |
| **CEP** | `validCep` = 8 dígitos e ≠ `00000000` (`src/domain/address.js:4`) | ⚠️ **não é chamado por `validate()`** (`src/services/clients.js:7-14`): um CEP inválido/incompleto pode ser gravado — só a UI avisa (`src/ui/clients.js:117`) |
| **CPF/CNPJ cruzado** | a checagem de tipo usa `d.type==='PJ'` (`src/services/clients.js:8-10`); `type` **não** é validado contra `{PF,PJ}` | Qualquer string que não `'PJ'` cai no caminho PF |

Regras de unicidade: **só CPF/CNPJ** (`src/services/clients.js:11`, comparando `V.digits`), e **só dentro do mesmo cliente para documentos repetidos** (`src/services/clients.js:40`, por `hash`). Nome/e-mail/RG podem se repetir sem aviso, e a unicidade de documento **não é garantida no banco** (índices sem `unique`, `src/db/idb.js:5`; ver §3.3-A).

Regras de dívida: `description` obrigatória, `0 < principal ≤ 1e13`, `0 < rate ≤ MAXR`, `date` ISO válida, `due` ISO obrigatório e `due ≥ date` (`src/services/debts.js:7-13`). Não há limite de tamanho para `description`/`notes`, nem validação de `notes` (`src/services/debts.js:4`).

### 4.4 Endereço — `src/domain/address.js`

- `composeAddress(a)` (`src/domain/address.js:6-12`): linha 1 = `rua, número` (ou só um deles) + `, complemento`; linha 2 = `bairro, cidade/UF` (ou só um); junta com `' - '`; `state` é normalizado para maiúsculas (`src/domain/address.js:7`). Campos vazios são removidos por `filter(Boolean)` — **[runtime]**: `{}` → `''`; `{number:'25',city:'Santos',state:'SP'}` → `'25 - Santos/SP'`; `{complement:'Fundos',city:'Santos',state:'SP'}` → `'Fundos - Santos/SP'`; só `{state:'sp'}` → `'SP'`; cobertura de testes em `tests/address.test.mjs:9-16`.
- O texto composto é gravado **junto com** os campos individuais (`src/ui/clients.js:45-46` envia `address` já calculado + os campos brutos) → **dupla fonte da verdade**: editar `street` depois sem reabrir o formulário deixa `address` desatualizado. Não há nada no service que recomponha `address` (`src/services/clients.js:16-27`).
- `maskCep`/`validCep`/`onlyDigits` (`src/domain/address.js:2-4`) são usados pela UI (`src/ui/clients.js:122-123`) e por `src/services/viacep.js:1-2`.
- ViaCEP (interface): `lookupCep(cep,{signal,timeout=8000})` (`src/services/viacep.js:6`) → `{cep,street,district,city,state}` (`src/services/viacep.js:32`), cache `Map` em memória por CEP (`src/services/viacep.js:4,9`), erros com `code` (`INVALID/OFFLINE/TIMEOUT/NETWORK/UNAVAILABLE/INVALID_RESPONSE/NOT_FOUND`, `src/services/viacep.js:8-31`); a UI preenche `street/district/city/state` e **não** reescreve `address` até submeter (`src/ui/clients.js:106-107` → `composeAddress` roda no `submit`, `src/ui/clients.js:45`). Os dados do ViaCEP **não são persistidos** — só os campos que o usuário salvar.
- APICPF (interface): `lookupCpf(value,{signal})` (`src/services/apicpf.js:6`) devolve `{name,birth,gender}` usados pela UI para **preencher campos vazios** sem sobrescrever (`src/ui/clients.js:87-88`); nada é gravado automaticamente.

### 4.5 Busca — `src/services/search.js`

`match(c,q)` (`src/services/search.js:3-4`): `q` vazio casa tudo; normaliza acento/caixa (`src/services/search.js:1`) para `name`, `email`, `rg`; busca numérica (dígitos) em `doc`, `rg`, `phone`, `mobile`, **mas só se** a query inteira contiver apenas `[\d\s.\-\/()+]` (`src/services/search.js:4`). Não procura em endereço/cidade/CEP nem em dívidas. Coberto por `tests/stage4.test.mjs:4-6`.

---

## 5. Contratos de serviço (`src/services/*.js`)

### 5.1 `src/services/records.js` (primitivos de registro cifrado)

| Função | Assinatura | Retorno | Efeitos colaterais |
|---|---|---|---|
| `uid` | `()` | `string` UUIDv4 (`:3`) | usa `crypto.randomUUID` |
| `list` | `(store:string)` | `Promise<Array<object>>` — **todos** os registros da loja decriptados, com `id/createdAt/clientId` injetados (`:5,4`) | 1 tx `readonly`; lança se a sessão estiver bloqueada (`getKey`) |
| `one` | `(store,id)` | `Promise<object\|null>` (`:6`) | 1 tx `readonly` |
| `enc` | `(store, obj)` | `Promise<['put', store, {id,createdAt,...clientId?,data:Uint8Array}]>` (`:7`) | cifra JSON (sem escrever); **descarta** `clientId` falsio |
| `blobOp` | `(id, bytes:Uint8Array)` | `Promise<['put','blobs',{id,data:Uint8Array}]>` (`:8`) | nenhum (só monta o op) |
| `blobBytes` | `(id)` | `Promise<Uint8Array>` (`:9`) | 1 tx `readonly`; **`TypeError` se o blob não existir** **[runtime]** |
| `hist` | `(clientId, type, detail='')` | `Promise<op 'put' em 'history'>` (`:10`) | timestamp `Date.now()` no momento da montagem |

### 5.2 `src/services/clients.js`

| Função | Assinatura | Retorno | Efeitos / falhas |
|---|---|---|---|
| `CATS` | `string[]` (`:4`) | 4 categorias fixas | — |
| `listClients` | `()` (`:6`) | `Promise<client[]>` (sem ordenação) | tx `readonly` em `clients` |
| `getClient` | `(id)` (`:6`) | `Promise<client\|null>` | tx `readonly` |
| `validate` | `(d, old, all)` (`:7-14`) | `{campo:mensagem}` — **nunca lança** | nenhum |
| `saveClient` | `(d, old, photo)`; `photo` = `undefined \| {file} \| {remove:true}` (`:16-27`) | `Promise<string id>` | lança `Error` com `.errs` se inválido (`:18`); 1 op `put clients` + `put/delete blobs` + `put history`; **uma** tx `readwrite` (`:27`) |
| `changePhoto` | `(c, p)` (`:28`) | repassa para `saveClient(c,c,p)` | idem |
| `counts` | `(id)` (`:30`) | `Promise<{docs:number,debts:number}>` | 2 tx `readonly` (`documents`,`debts`) com `getAll` + filter (`:29`) |
| `deleteClient` | `(id)` (`:31-35`) | `Promise<undefined>`; **no-op silencioso se o cliente não existe** (`:32`) **[runtime]** | 4 `readonly` + 1 `readwrite` multi-loja (`:33-35`) |
| `listDocs` | `(id)` (`:36`) | `Promise<doc[]>` por `createdAt` desc | 1 `readonly` (getAll, ignora o índice `clientId`) |
| `listHistory` | `(id)` (`:37`) | `Promise<hist[]>` por `createdAt` desc (não `at`, ver §1.3) | 1 `readonly` |
| `addDoc` | `(clientId, file:File, category, name)` (`:38-42`) | `Promise<undefined>` | lança se `>15MB`/imagem ilegível (`src/files/process.js:6,9,15`), lança se hash repetido (`:40`); 1 `readwrite` com `blobs+documents+history` |
| `removeDoc` | `(d)` (`:43`) | `Promise<undefined>` | 1 `readwrite` (`blobs`,`documents`,`history`) |
| `docBytes` | `(d)` (`:44`) | `Promise<Uint8Array>` | `TypeError` se blob ausente |
| `blobBytes` | re-export (`:3`) | idem §5.1 | — |

### 5.3 `src/services/debts.js`

| Função | Assinatura | Retorno | Efeitos / falhas |
|---|---|---|---|
| `listDebts` | `(cid?)` (`:6`) | `Promise<debt[]>` com `interest` derivado (`:5`), ordenadas por `date` desc, empate `createdAt` desc | 1 `readonly`; **lança/silencia** com `date` ausente (ver §4.2) |
| `validate` | `(d)` (`:7-13`) | `{campo:mensagem}` | nenhum |
| `saveDebt` | `(clientId, d, old)` (`:14-23`) | `Promise<string id>` | lança `.errs`; **não checa existência do cliente** **[runtime]**; 1 `readwrite` (`debts`+`history`) |
| `deleteDebt` | `(d)` (`:24`) | `Promise<undefined>` | 1 `readwrite` (`debts`+`history`) |
| `findByRate` | `(r:number em unidades de taxa interna)` (`:25-26`) | `Promise<debt[] + clientName>`, ordem `clientName` pt-BR | 2 `readonly` (clients+debts) |
| `applyBulk` | `(plan)` (saída de `M.planRate`) (`:28-34`) | `Promise<undefined>` | lança se `!plan.length` ou `some(!ok)`; lança se os dados mudaram desde a prévia (`:31`); 1 `readwrite` multi-ops |

### 5.4 `src/services/settings.js`, `dashboard.js`, `search.js`

| Função | Assinatura | Retorno | Efeitos |
|---|---|---|---|
| `getDueWindow` | `()` (`settings.js:2`) | `Promise<number\|string\|any>` — default `7` | 1 `readonly`; **sem validação de tipo/intervalo** |
| `setDueWindow` | `(n)` (`settings.js:3`) | `Promise<key>` | 1 `readwrite` em `settings`; **não dispara `data-changed`** |
| `stats` | `()` (`dashboard.js:3-7`) | `{principal, interest, clients, debts, overdue, soon, latest:client[≤5], recent:hist[≤8]+client}` | 4 leituras concorrentes (`Promise.all`, `dashboard.js:4`); lança `TypeError` se alguma dívida não tiver `due` **[runtime]** |
| `match` | `(c, q)` (`search.js:3`) | `boolean` | nenhum (função pura) |

### 5.5 Interface com as outras áreas (sem auditoria aqui)

- Segurança: `getKey()` (`src/security/auth.js:14`) é pré-requisito de `enc/dec/blobOp/blobBytes` — **toda** leitura de negócio lança `'Sessão bloqueada.'` se a sessão estiver travada; as UIs se protegem com `isUnlocked()` (`src/ui/clients.js:130-136`, `src/ui/debtspage.js:34`).
- Backup: `createBackup(pass)` (`src/export/backup.js:4-10`) lê as 4 listas + `settings.dueWindow` + todos os blobs; `restore(data, mode)` (`src/export/backup.js:12-30`) prepara todas as ops cifradas e aplica em **um** `db.batch` (`:29`); `validate()` (`src/export/backup-format.js:20-27`) é a única barreira de integridade prévia (lacunas em §4.1.1).
- Integrações: `viacep.lookupCep`, `apicpf.lookupCpf`, `google-drive.{uploadBackup,downloadBackup,listBackups}` — nenhuma grava no IndexedDB fora de `blobs`/`settings` (`src/services/google-drive.js:21-220` usa `localStorage`, não o banco — **NÃO CONFIRMADO em detalhe**, área da auditoria de integrações).

---

## 6. Onde modificar X

| Funcionalidade a estender | Arquivos e linhas a tocar | Observações / armadilhas |
|---|---|---|
| **Novo campo de cliente** | 1) formulário: `src/ui/clients.js:59-68` (campos) e o objeto enviado em `src/ui/clients.js:46`; 2) rótulos de auditoria: `src/services/clients.js:5` (`LABEL`) — sem isso a mudança não aparece no histórico (`src/services/clients.js:25`); 3) regras: `src/services/clients.js:7-14` (`validate`); 4) exibição no perfil: `src/ui/clients.js:170` (`row(...)`); 5) lista/busca: `src/services/search.js:3-4` se quiser que o campo seja pesquisável | **Não precisa de migração**: o payload é JSON cifrado e auto-descrito (`src/services/records.js:7`). Só precisa de `createObjectStore/createIndex` se o campo for **chave de índice** (caso abaixo). Cuidado: registros antigos não terão a chave (`undefined`), e `validate` recebe `d` sem defaults (`src/services/clients.js:8-14`) |
| **Novo tipo de dívida** | 1) o campo **precisa** entrar na whitelist `rec()` em `src/services/debts.js:4` — fora dela é **descartado em silêncio**; 2) validação `src/services/debts.js:7-13`; 3) `LABEL` `src/services/debts.js:3` (histórico de alterações `:19-21`); 4) formulário `src/ui/debts.js:29-35`; 5) exibição `src/ui/debts.js:9-15` e `src/ui/debtspage.js:17-20`; 6) se muda agregações: `src/services/dashboard.js:4-6`, `src/ui/debtspage.js:13-14`; 7) relatório/Excel: `src/export/reports.js:16-18` (colunas) e `src/ui/tools.js:17` (cabeçalhos) | Não existe campo `type` em dívida hoje (**NÃO EXISTE**); os tipos de documento usam `CATS` (`src/services/clients.js:4`) como lista fechada **não validada** no service (`src/services/clients.js:38-42`) — replicar esse padrão deixaria a regra só na UI |
| **Novo indicador no dashboard** | 1) cálculo: `src/services/dashboard.js:3-7` (`stats()` — campos `principal/interest/clients/debts/overdue/soon/latest/recent`); 2) tile: `src/ui/dashboard.js:5-7` (`tile`) e lista de partes `src/ui/dashboard.js:26-29`; 3) se precisar da janela de vencimento, já vem por `getDueWindow` (`src/services/dashboard.js:1,4`) | `stats()` é a única fonte numérica; o padrão "derive, não armazene" está em `src/services/debts.js:5-6` |
| **Migração de schema (novo store ou índice) com segurança** | 1) **acrescentar** `MIGRATIONS[k]` no fim de `src/db/idb.js:2-9` — **nunca** editar as anteriores (`src/db/idb.js:1`); `DB_VERSION` sobe sozinha (`src/db/idb.js:10`); 2) usar o helper `idx(store, ...campos)` (`src/db/idb.js:5`) para manter `keyPath:'id'`; 3) guardar-se contra re-execução: hoje **não há** `objectStoreNames.contains(...)` — adicione essa guarda na nova migração; 4) preencher/retrofitar os campos de índice nos registros existentes dentro da mesma migração (cursor sobre `r.transaction`); 5) depois bumpar `V` e `FILES` do service worker (`sw.js:1-2`); 6) atualizar o texto "versão N" exibido (`src/ui/settings.js:50`); 7) se o store entra no backup, adicionar em `LISTS` (`src/export/backup-format.js:5`) e no `buildBackup/restore` (`src/export/backup.js:5-9,15-18`) | Armadilhas concretas: (a) índice com keyPath inexistente nos registros fica **morto** — é o bug atual do `at` (`src/db/idb.js:8` vs `src/services/records.js:10`); (b) `unique:true` é viável mas **nenhum** índice hoje usa options (`src/db/idb.js:5`) e os serviços não tratam `ConstraintError` (`src/db/idb.js:21,30` só mostram mensagem genérica); (c) campos novos precisam ser **decifráveis** — `dec` (`src/services/records.js:4`) injeta sempre `id/createdAt/clientId`, então um índice novo sobre campo que hoje mora dentro de `data` cifrado **não funciona**: é preciso mover o campo para o envelope em claro, o que muda a superfície de exposição (§2.1) |
| **Mudar regra de vencimento** | 1) critério: `src/domain/due.js:5` (`status`: `n<0` vencida, `n<=win` soon); 2) contagem de dias: `src/domain/due.js:4` e "hoje" `src/domain/due.js:3`; 3) janela/default: `src/services/settings.js:2` (+ validação de intervalo, hoje só na UI `src/ui/settings.js:42-44`); 4) contadores: `src/services/dashboard.js:5-6`; 5) filtro/legenda: `src/ui/debtspage.js:11,16-17,30` (`Vencidas`/`Prestes a vencer`); 6) alerta: `src/ui/dashboard.js:13-16`; 7) **atualizar** `tests/stage4.test.mjs:2-3` | Se a regra exigir novo estado persistido (ex. "quitada"), é preciso: campo em `rec()` (`src/services/debts.js:4`), validação (`src/services/debts.js:7-13`), e um lugar no `stats()` (`src/services/dashboard.js:2` diz que quitação está fora do escopo) |

---

## 7. Lacunas de teste observadas

Os 7 arquivos em `tests/` rodam com `node tests/X.test.mjs` (sem script no `package.json`, que contém apenas `{"type":"module","private":true}` — `package.json:1`; laço de execução documentado em `README.md:293`). **[runtime]** todos passaram nesta auditoria. Módulos importados pelos testes: `src/domain/{money,validators,address,due}.js`, `src/services/search.js`, `src/security/crypto.js`, `src/export/{backup-format,xlsx,reports}.js`, `api/cpf.js` (grep em `tests/*.test.mjs`). **Nenhum teste referencia IndexedDB** (`grep -rln "indexedDB" tests/` → nada) e **nenhum** importa `src/db/idb.js`, `src/services/{records,clients,debts,settings,dashboard}.js`, `src/files/process.js`, `src/security/auth.js`.

Invariantes críticos sem nenhum exercício:

1. **Schema e upgrade.** Nada verifica os 7 stores/6 índices (`src/db/idb.js:3-8`), o valor de `DB_VERSION` (`:10`), o loop de migração (`:14`), o fechamento em `versionchange` (`:15`) ou a mensagem de `onblocked` (`:16`). Adicionar/remover um store pode quebrar silenciosamente.
2. **Transações e atomicidade.** `batch` multi-store tudo-ou-nada (`src/db/idb.js:27-30`), `durability:'strict'` (`:20,28`) e o disparo de `data-changed` (`:30`) não são testados — nem o fato de `batch([])` **não** disparar (`:27`).
3. **Contagem e exclusão em cascata.** `counts()` (`src/services/clients.js:30`) e `deleteClient()` (`:31-35`) não têm teste: nada garante que dívidas+documentos+blobs+histórico somem com o cliente, que blobs não fiquem órfãos, nem que o `confirm` da UI (`src/ui/clients.js:42`) reporte o mesmo número que será excluído. Os cenários de corrida reproduzidos em §3.3-B/F são exatamente os que faltam.
4. **Unicidade de CPF/CNPJ sob concorrência.** `tests/validators.test.mjs` cobre o dígito verificador, mas nada cobre `src/services/clients.js:11` (regra + exclusão de `old.id`) nem a ausência de índice único. **[runtime]** duas escritas concorrentes duplicam o documento.
5. **Ordenação por vencimento / por data.** Nenhuma assertion sobre `src/services/debts.js:6` (empate por `createdAt`) nem sobre o filtro/ordenação de `src/ui/debtspage.js:11`. O caso "registro sem `date`" — que alterna entre `TypeError` e ordenação errada — é invisível hoje.
6. **Arredondamento em agregações.** `tests/money.test.mjs:3-4` cobre `interest` individual, mas **nada** cobre a soma (`src/services/dashboard.js:4`, `src/ui/debtspage.js:13`): a divergência entre "soma dos arredondados" e "arredondamento da soma" não é exercitada. (Não há parcelas no modelo, então esse é o análogo real.)
7. **Fragilidade numérica.** `interest` com `principal` não-inteiro (`src/domain/money.js:9`) → `RangeError` **[runtime]**; `cents('1.000')` = 1000 **[runtime]** — nenhum teste documenta essa semântica.
8. **Validadores de negócio fora do domínio.** A regex de e-mail (`src/services/clients.js:13`), a regra de telefone 10–11 dígitos (`:12`), `due ≥ date` (`src/services/debts.js:12`) e o teto `principal ≤ 1e13` (`:9`) nunca são exercitados — os testes só cobrem CPF/CNPJ/máscaras.
9. **Regra de vencimento com janela não numérica / `due` ausente.** `tests/stage4.test.mjs:3` usa `win=7` e `win=30` e datas válidas; não cobre `win` vindo de `settings` como string (`src/services/settings.js:3` **[runtime]** aceita `'abc'`), `win=0`, `due` indefinido (crash em `src/domain/due.js:2` **[runtime]**) nem datas inválidas que `Date.UTC` rola em silêncio (`2026-02-30` → 60 dias **[runtime]**).
10. **Índices usados.** Não há teste assertando que um índice do schema corresponde a um campo realmente gravado — foi assim que o índice `at` (`src/db/idb.js:8`) sobreviveu órfão (`src/services/records.js:10`).
11. **Contratos cifrado/claro.** `tests/crypto.test.mjs` exercita `sealJSON/openJSON` isolados, mas nada verifica que `enc()` exponha exatamente `id/createdAt/clientId` em claro (`src/services/records.js:7`) nem que `blobOp` cifra o binário (`:8`) — ou seja, uma regressão que passasse a gravar campos sensíveis em claro seria invisível aos testes.
12. **Restauração.** `validate()` de backup (`src/export/backup-format.js:20-27`) é testada só para `clientId` inexistente e arquivo ausente (`tests/backup.test.mjs:17-18`); merge/replace (`src/export/backup.js:12-30`) **não** têm teste — nem o mapeamento de cliente por CPF (`:22`), nem a criação de registros sem `clientId` (`:24-27` + `src/services/records.js:7`).
13. **Processamento de arquivos.** `src/files/process.js` (teto de 15 MB `:6`, recusa de não-imagem com `force` `:9`, `converted` só se menor `:14`) não é testado — só há execução **[runtime]** parcial aqui.
14. **Sem gate automatizado.** Como `package.json:1` não define `scripts`, nada impede que um `node --test tests/` (que sequer pegaria as asserções top-level dos arquivos atuais) ou um CI substitua o laço manual do `README.md:293`.

---

## 8. Esquema (entregável b)

```text
DATABASE "scipione-cred"   version = 1 (= MIGRATIONS.length)          src/db/idb.js:10,13
│
├── STORE meta          keyPath "key"   autoIncrement=false   idx: —   src/db/idb.js:3
│     records: vault{key,salt,iv,wrapped,iter,kdf,cipher,v}  auth.js:21  crypto.js:11
│              guard{key,fails,until}                         auth.js:26,30,32
│              session{key,sid,dek:CryptoKey,last,mins}        auth.js:55
│              probe{key,data:Uint8Array(cifrado)}             ui/settings.js:32
│     ⇒ texto claro (só wrapped/data cifrados)
│
├── STORE settings      keyPath "key"   autoIncrement=false   idx: —   src/db/idb.js:4
│     records: {key:"dueWindow",  value:number}               services/settings.js:3
│              {key:"idleMinutes",value:number}               security/auth.js:21,49
│     ⇒ 100% texto claro (não passa por enc())
│
├── STORE clients       keyPath "id"    autoIncrement=false            src/db/idb.js:6
│     idx createdAt  → "createdAt"        UNIQUE? não
│     record: { id:uuid, createdAt:number, data:Uint8Array(AES-GCM) }   records.js:7
│        └─ data (cifrado): type,name,doc,birth,gender,rg,phone,mobile,
│                           email,cep,street,number,complement,district,
│                           city,state,address,photoId,photoType,updatedAt
│        montado em clients.js:19-23 · validado em clients.js:7-14
│     PK ──┬──► debts.clientId (1:N)   debts.js:16
│          ├──► documents.clientId (1:N) clients.js:42
│          ├──► history.clientId (1:N)   records.js:10
│          └──► blobs.id  (1:1 via data.photoId, NAO indexável) clients.js:20-23
│
├── STORE debts         keyPath "id"    autoIncrement=false            src/db/idb.js:6
│     idx clientId   → "clientId"       idx createdAt → "createdAt"    UNIQUE? não
│     record: { id, createdAt, clientId, data:Uint8Array }
│        └─ data: description,principal(¢ int),rate(15%=1500),date,
│                 due,notes,updatedAt                                   debts.js:4
│        derived (NAO persistido): interest = money.js:9 · debts.js:5-6
│
├── STORE documents     keyPath "id"    autoIncrement=false            src/db/idb.js:6
│     idx clientId   → "clientId"
│     record: { id, createdAt, clientId, data:Uint8Array }
│        └─ data: name,orig,category,type,size,originalSize,
│                 converted,hash(SHA-256 hex),blobId                   clients.js:42
│     blobId ──► blobs.id  (N:1 em teoria, 1:1 na prática)
│
├── STORE blobs         keyPath "id"    autoIncrement=false   idx: —   src/db/idb.js:7
│     record: { id:uuid, data:Uint8Array = IV(12)+cifra+tag(16) }      records.js:8
│     ⊲ foto de perfil (force,maxSide=512)   clients.js:20-21
│     ⊲ documento (maxSide=1600,q=.8)        clients.js:39
│     +28 bytes de sobrecarga por arquivo [runtime]
│
└── STORE history       keyPath "id"    autoIncrement=false            src/db/idb.js:8
      idx clientId   → "clientId"
      idx at         → "at"        ✗ ÍNDICE MORTO: nenhum registro tem "at"
                                      (hist() grava "createdAt"  records.js:10;
                                       listHistory ordena por createdAt clients.js:37)
      record: { id, createdAt, clientId, data:Uint8Array }
         └─ data: type, detail                                          records.js:10
      eventos: Cadastro de cliente | Alteração de dados | Fotografia incluída/
               alterada/removida | Documento incluído/removido | Dívida cadastrada/
               alterada/excluída | Juros alterados | Juros alterados em lote
               clients.js:24-26,42,43 · debts.js:17-24,33

CONVENÇÕES
  id/createdAt/clientId SEMPRE em claro (são as keyPaths)  records.js:1,7
  todo o resto dentro de data = sealJSON(DEK)              records.js:7 · crypto.js:19
  nenhum índice único · nenhum cursor · nenhum IDBKeyRange (grep: 0 ocorrências)
  todas as listagens = getAll + filter/sort em JS + decrypt total  records.js:5
```

---

## 9. Cinco maiores riscos de integridade

1. **Ausência total de integridade referencial + janela de corrida em `deleteClient`.** `saveDebt` aceita `clientId` inexistente (`src/services/debts.js:14-16`) e a cascata lê em 4 transações separadas antes de gravar em uma (`src/services/clients.js:32-35`): uma dívida criada no meio da exclusão fica órfã **para sempre** ( **[runtime]** ). Órfãos entram nos totais do dashboard (`src/services/dashboard.js:6`) e são invisíveis por cliente (`src/services/debts.js:6`), e o `validate` do backup passa a rejeitar a restauração (`src/export/backup-format.js:24`).
2. **Duplicidade de CPF/CNPJ garantível.** A checagem acontece fora da transação (`src/services/clients.js:11,17`) e não existe índice `unique` (`src/db/idb.js:5`): duas gravações concorrentes com o mesmo documento são aceitas ( **[runtime]** , 2 linhas). Idem para `hash` de documento (`src/services/clients.js:40`).
3. **Índices criados, nunca usados, e um deles morto.** Zero consultas por índice (grep `.index(`/`openCursor`/`IDBKeyRange` = 0), `getAll` + decrypt integral em toda listagem (`src/services/records.js:5`), e `history.at` nunca é gravado (`src/db/idb.js:8` vs `src/services/records.js:10`, **[runtime]** 0/3 registros). Além do custo linear, isso esconde regressões de schema.
4. **Dados inválidos restauráveis que derrubam a leitura.** `validate()` do backup não exige `date`/`due` nem integridade de `principal` (`src/export/backup-format.js:24`, **[runtime]**), enquanto `due.js:2` lança `TypeError` com `due` ausente (derruba `stats()`, **[runtime]**), `money.js:9` lança `RangeError` com `principal` fracionário e `debts.js:6` alterna entre crash e ordenação errada. Regras de entrada vivem na UI em vários pontos (ex. `dueWindow`: `src/services/settings.js:3` vs `src/ui/settings.js:42-44`; CEP nunca validado no service, `src/services/clients.js:7-14`).
5. **Migrações sem guarda e sem cobertura de teste.** O upgrade depende de `DB_VERSION === MIGRATIONS.length` e de nunca editar migrações antigas (`src/db/idb.js:10,14`) sem `objectStoreNames.contains` (`:3-8`) e sem tratamento de downgrade (`:16`); nenhum teste toca o IndexedDB (`tests/*.test.mjs`, `package.json:1` sem `scripts`), logo a camada inteira de transações/cascata/agregação monetária está sem rede de segurança (§7).

---

## Anexo A — Como as marcações **[runtime]** foram obtidas

Os módulos reais do projeto foram importados por um harness Node fora do repositório (`docs/auditoria/harness/`, 5 arquivos): um stub de IndexedDB que registra `createObjectStore`/`createIndex`/transações e aplica escritas só no `oncomplete` (tudo-ou-nada), mais shims de `sessionStorage`/`addEventListener`/`document`, com desbloqueio real de cofre via `auth.setup()` (WebCrypto do Node). Cada linha marcada **[runtime]** veio da saída desses runs; nada no projeto foi alterado (`git status --porcelain` vazio ao final). O que exige navegador real (IndexedDB nativo, `createImageBitmap`/`canvas` em `src/files/process.js:11-14`, `QuotaExceededError`) está marcado **NÃO CONFIRMADO**.
