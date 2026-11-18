# SCIPIONE CRED — Base de dados (IndexedDB)

Escopo: camada de persistência local (`src/db/idb.js`), formato de registro cifrado (`src/services/records.js`), serviços (`clients.js`, `debts.js`, `settings.js`, `dashboard.js`, `search.js`), cofre/sessão (`src/security/auth.js`, `src/security/crypto.js`) e backup (`src/export/backup-format.js`), com apoio de `src/domain/{money,due,validators,address}.js`, `src/files/process.js`, `sw.js` e da UI quando ela é a única guardiã de uma regra.

Método: todo fato abaixo foi **relido no código-fonte** deste repositório e citado como `arquivo:linha`. Quatro fatos foram reconfirmados por execução fora do repositório (script em `/tmp/qa/`, stub de IndexedDB + WebCrypto do Node): `DB_VERSION = 1`; 7 stores e 6 índices criados, todos com opções `null` (nenhum `unique`); `data` cifrada é `Uint8Array` de tamanho `12 + claro + 16`; a DEK aberta por `openVault` é `AES-GCM 256`, `extractable=false`. O que depende de navegador real (IndexedDB nativo, `QuotaExceededError`, `createImageBitmap`) está marcado **NÃO CONFIRMADO**. Nenhum campo ou versão foi inventado.

---

## 1. Identidade do banco

| Item | Valor | Fonte |
|---|---|---|
| Nome do database | `scipione-cred` | `src/db/idb.js:13` |
| Versão pedida no `open()` | `DB_VERSION = MIGRATIONS.length` = **1** | `src/db/idb.js:10` (derivação) + `src/db/idb.js:13` (uso); confirmado em execução |
| Nº de object stores | **7** (`meta`, `settings`, `clients`, `debts`, `documents`, `blobs`, `history`) | `src/db/idb.js:3-8` |
| Nº de índices | **6** | `src/db/idb.js:5-8` |
| Motor | IndexedDB via `indexedDB.open()`, com WebCrypto (PBKDF2-SHA256 + AES-GCM-256) por cima | `src/db/idb.js:13`, `src/security/crypto.js:3-6` |
| Origem / disponibilidade do motor | **Só navegador.** `indexedDB` aparece **uma única vez** em todo `src/` (`src/db/idb.js:13`). Em Node sem stub o `import` de `idb.js` funciona e `DB_VERSION` vale 1, mas `openDB()` rejeita com `ReferenceError: indexedDB is not defined` (confirmado em execução) | `src/db/idb.js:13,12-17` |
| Conexão | singleton em memória `let p`; a promessa é reutilizada e zerada em erro/`versionchange` | `src/db/idb.js:11-17` |
| Durabilidade | `{durability:'strict'}` apenas em `readwrite` | `src/db/idb.js:20` (`run`), `src/db/idb.js:28` (`batch`) |
| Persistência fora do banco | `google-drive.js` usa `localStorage` (nada a ver com IndexedDB); sessão/idle usam `sessionStorage` | `src/services/google-drive.js:18,45,48`, `src/security/auth.js:7-9` |
| Versão exibida ao usuário | "Banco local — versão `${db.DB_VERSION}`" | `src/ui/settings.js:50` |

`MIGRATIONS` é um array de funções; o comentário em `src/db/idb.js:1` fixa a política ("adicione uma função ao fim de MIGRATIONS para cada mudança de schema, nunca edite as antigas") — é convenção documental, sem código nem teste que a imponha.

## 2. Esquema

| # | Store | keyPath | autoIncrement | Índices (`nome` = keyPath, sem opções) | Definido em |
|---|---|---|---|---|---|
| 1 | `meta` | `key` | não | — | `src/db/idb.js:3` |
| 2 | `settings` | `key` | não | — | `src/db/idb.js:4` |
| 3 | `clients` | `id` | não | `createdAt` | `src/db/idb.js:6` |
| 4 | `debts` | `id` | não | `clientId`, `createdAt` | `src/db/idb.js:6` |
| 5 | `documents` | `id` | não | `clientId` | `src/db/idb.js:6` |
| 6 | `blobs` | `id` | não | — | `src/db/idb.js:7` |
| 7 | `history` | `id` | não | `clientId`, `at` | `src/db/idb.js:8` |

Nenhum store usa `autoIncrement` (só `{keyPath}` é passado, `src/db/idb.js:3-8`) e nenhum índice é `unique` — o helper `idx` chama `o.createIndex(x,x)` sem terceiro argumento (`src/db/idb.js:5`).

```text
DATABASE "scipione-cred"  (version = 1 = MIGRATIONS.length)          src/db/idb.js:10,13
│
├─ meta        keyPath "key"   índices: —                             idb.js:3
│    registros: vault{key,salt,iv,wrapped,iter,kdf,cipher,v}          auth.js:21 · crypto.js:11
│              guard{key,fails,until}                                 auth.js:26,30,32
│              session{key,sid,dek:CryptoKey,last,mins}               auth.js:55
│              probe{key,data:Uint8Array cifrado}                     ui/settings.js:32
│
├─ settings    keyPath "key"   índices: —                             idb.js:4
│    registros: {key:"dueWindow",value}                               services/settings.js:3
│              {key:"idleMinutes",value}                               security/auth.js:21,49
│
├─ clients     keyPath "id"    índice: createdAt                      idb.js:6
│    registro claro: id, createdAt, data(Uint8Array)                  records.js:7
│    data cifra: type,name,doc,birth,gender,rg,phone,mobile,email,
│               cep,street,number,complement,district,city,state,
│               address,photoId,photoType,updatedAt                   clients.js:23 · ui/clients.js:46
│      │
│      ├─► debts.clientId        1:N  (convenção, sem constraint)     debts.js:16
│      ├─► documents.clientId    1:N                                  clients.js:42
│      ├─► history.clientId      1:N                                  records.js:10
│      └─► blobs.id              1:1 via data.photoId (cifrado,
│                                portanto não indexável)              clients.js:20-23
│
├─ debts       keyPath "id"    índices: clientId, createdAt           idb.js:6
│    registro claro: id, createdAt, clientId, data                    records.js:7
│    data cifra: description,principal(centavos int),rate(15%=1500),
│               date,due,notes,updatedAt                              debts.js:4
│    derivado e NUNCA persistido: interest                            money.js:9 · debts.js:5
│
├─ documents   keyPath "id"    índice: clientId                       idb.js:6
│    data cifra: name,orig,category,type,size,originalSize,
│               converted,hash(SHA-256 hex),blobId                    clients.js:42 · process.js:7-8
│    blobId ──► blobs.id  (N:1 em teoria, 1:1 na prática)             clients.js:41-42
│
├─ blobs       keyPath "id"    índices: —                             idb.js:7
│    registro: {id, data:Uint8Array = IV(12)+cifra+tag(16)}           records.js:8 · crypto.js:17
│    conteúdo: foto de perfil (force,maxSide=512) clients.js:20
│              documento (maxSide=1600,q=.8)       clients.js:39
│
└─ history     keyPath "id"    índices: clientId, at                  idb.js:8
     data cifra: type, detail                                         records.js:10
     ✗ índice "at" MORTO: hist() grava createdAt, nunca `at`
       (records.js:10; ordenação usa createdAt — clients.js:37)

CONVENÇÕES
  id / createdAt / clientId SEMPRE em claro (são keyPaths e índices)  records.js:1,7
  todo o resto dentro de data = sealJSON(DEK)                         records.js:7 · crypto.js:19
  nenhum índice único · nenhum cursor · nenhum IDBKeyRange · nenhuma
  consulta por índice (grep: 0 ocorrências de .index(/openCursor/
  getAllKeys/IDBKeyRange em src/)
  toda listagem = getAll + decrypt integral + filter/sort em JS       records.js:5
```

Os 7 stores: `meta` guarda cofre, trava de tentativas, sessão e sonda de integridade; `settings` guarda parâmetros globais; `clients`, `debts`, `documents` e `history` seguem o envelope cifrado de `src/services/records.js`; `blobs` guarda binários cifrados (fotos e documentos) referenciados por id. Dos 6 índices, **nenhum é usado por consulta** (ver §8) e **um deles (`history.at`) jamais seria usado**: nenhum registro carrega a chave `at` (`src/services/records.js:10`), e em IndexedDB registro sem a keyPath do índice não entra nele.

## 3. Formato de registro: o que fica em claro × o que vai cifrado

`src/services/records.js:1` declara e `src/services/records.js:4-9` implementa (transcrição literal):

```js
const dec=async r=>({...await openJSON(getKey(),r.data),id:r.id,createdAt:r.createdAt,clientId:r.clientId});
export const list=async s=>Promise.all((await db.getAll(s)).map(dec));
export const one=async(s,id)=>{const r=await db.get(s,id);return r&&dec(r)};
export const enc=async(s,o)=>{const{id,createdAt,clientId,...rest}=o;return['put',s,{id,createdAt,...(clientId?{clientId}:{}),data:await sealJSON(getKey(),rest)}]};
export const blobOp=async(id,bytes)=>['put','blobs',{id,data:await sealBytes(getKey(),bytes)}];
```

- **Em claro** (chaves do objeto gravado no IndexedDB): `id` (keyPath), `createdAt` (índice em `clients`/`debts`) e `clientId` (índice em `debts`/`documents`/`history`). `clientId` só aparece se for truthy — `...(clientId?{clientId}:{})` (`src/services/records.js:7`), o que explica registros gravados **sem** `clientId` quando um mapeamento falha no restore (`src/export/backup.js:24-27`).
- **Cifrado em `data`**: tudo o mais (`...rest`), ou seja, qualquer campo novo de negócio fica dentro do JSON cifrado e **não** precisa de migração de schema — mas também nunca pode virar índice.
- Consequência: `dec` injeta `clientId` em **todos** os registros decifrados (`src/services/records.js:4`), inclusive clientes, onde vale `undefined` — a leitura de `getClient()` devolve uma chave `clientId: undefined` que não existe no registro gravado.
- **Não passam por `enc()`**: `settings` (`src/services/settings.js:3`, `db.put('settings',{key:'dueWindow',value:n})`) e `meta` (`src/security/auth.js:21,30,32,55` e `src/ui/settings.js:32`). Para quem inspecionar o IndexedDB (DevTools → Application), isso significa ver em texto puro: **quais** chaves existem, o valor de `dueWindow` e `idleMinutes`, os campos do cofre (`salt`, `iv`, `iter`, `kdf`, `cipher`, `v` e o blob `wrapped`), o contador `guard.fails`/`until`, o `sid`/`last`/`mins` da sessão e um `CryptoKey` dentro de `meta.session`. O conteúdo de negócio (`data`) permanece cifrado — o IndexedDB **nunca** vê payload em claro, porque a cifra acontece antes de o valor chegar a `db.batch` (`src/services/records.js:7`, comentário em `src/db/idb.js:26`).

## 4. Envelope criptográfico

- **Payload:** `data` é `Uint8Array` com `IV(12 bytes) || ciphertext || tag(16 bytes)` — `sealBytes` gera IV aleatório, cifra com AES-GCM e monta `new Uint8Array(12+ct.length)` (`src/security/crypto.js:17`); `openBytes` corta `slice(0,12)` como IV e `slice(12)` como cifra (`src/security/crypto.js:18`). JSON é cifrado via `sealJSON` = `sealBytes(JSON.stringify)` (`src/security/crypto.js:19`). **Não há base64** no caminho de persistência: `grep btoa|atob|base64 src/` = 0 ocorrências (a única codificação textual é hex, para `hash` e `salt`: `src/files/process.js:4`, `src/export/backup-format.js:6`).
- **Duas chaves:** a senha deriva uma **KEK** por PBKDF2-SHA256 com `ITER = 600000` e salt de 16 bytes, não exportável, com usos `wrapKey/unwrapKey` (`src/security/crypto.js:4,6`); a **DEK** é AES-GCM-256 gerada aleatoriamente (`extractable:true` só para poder ser embrulhada) e guardada embrulhada em `wrapped` (`src/security/crypto.js:8-11`). `openVault` deriva a KEK de novo e desenrola a DEK com `extractable:false`, usos `encrypt,decrypt` (`src/security/crypto.js:13-15`) — **confirmado em execução**: `AES-GCM 256`, `extractable=false`; `wrapped` tem 48 bytes (32 de cifra + 16 de tag, com IV à parte).
- **O que `auth.js` grava em `meta`:** `{key:'vault', salt, iv, wrapped, iter, kdf:'PBKDF2-SHA256', cipher:'AES-GCM-256', v:1}` (`src/security/auth.js:21` + campos de `src/security/crypto.js:11`); `{key:'guard', fails, until}` nos acertos/erros de senha (`src/security/auth.js:26,30,32`); `{key:'session', sid, dek, last, mins}` em `saveSession` (`src/security/auth.js:55`); e `{key:'probe', data}` cifrado pela sonda de integridade da UI (`src/ui/settings.js:32`).
- **Vulnerabilidade objetiva (já levantada, descrita aqui sem juízo de valor):** a linha `src/security/auth.js:55` persiste a **DEK viva** em `meta.session` como objeto `CryptoKey` (structured clone). Ela não é exportável, logo seus bytes não são legíveis em DevTools; ainda assim, **qualquer código com acesso ao IndexedDB daquele perfil pode carregar `meta.session` e usar `dek` para decifrar todos os `data`**, sem a senha — o único pré-requiso de `restoreSession` é que `sessionStorage['sc.sid']` bata com `s.sid` e o prazo esteja dentro de `mins` (`src/security/auth.js:41-47`), condição que não se aplica a quem lê o banco diretamente e chama `openJSON(dek, ...)` (função de API: `src/security/crypto.js:20`). A gravação é periódica e throttled (`src/security/auth.js:53`, 1800 ms) e a limpeza ocorre em `lock` (`src/security/auth.js:67`) e em `restoreSession` inválida (`src/security/auth.js:43,46`); a DEK também mora em memória de módulo (`src/security/auth.js:6,14`). Se a sessão ficou retida por queda do navegador (sem `lock`), o par `meta.session` + registros cifrados permanece no disco. Detalhe complementar: o **backup** não leva cofre nem chaves (`src/export/backup-format.js:3`), mas grava os registros **já decifrados** em `data/*.json` (`src/export/backup.js:5,9` → `src/export/backup-format.js:12`), protegidos apenas pela senha opcional do ZIP externo (`src/export/backup-format.js:17-18`, `src/security/crypto.js:22`).
- **Ressalva de método:** o roundtrip do objeto `CryptoKey` por `db.put`/`db.get`, que sustenta o item acima, foi exercitado apenas sob structured clone do Node + WebCrypto com stub de IndexedDB; em navegador real — **NÃO CONFIRMADO**.

## 5. Chaves e IDs

```js
export const uid=()=>crypto.randomUUID();                                  // records.js:3
const newSid=()=>crypto.randomUUID?crypto.randomUUID():Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('');  // auth.js:10
```

- `uid()` gera **UUID v4** e é a origem de `id` de cliente (`src/services/clients.js:19`), dívida (`src/services/debts.js:16`), documento e blob/foto (`src/services/clients.js:20,41-42`) e evento de histórico (`src/services/records.js:10`). Diferente de `newSid`, `uid` **não tem fallback**: se `crypto.randomUUID` não existir (contexto não seguro), o cadastro quebra — **NÃO CONFIRMADO** em navegador.
- **Colisões:** não há verificação de unicidade de `id` em lugar algum, e `put` é *upsert* (`src/db/idb.js:24`): duas escritas com o mesmo `id` produzem substituição silenciosa. Probabilisticamente UUID v4 não colide; o risco prático vem de `restore`, que decide por id (`src/export/backup.js:22-27`) e por isso o registro existente prevalece.
- **Unicidade de documento (CPF/CNPJ):** é checagem em JavaScript, fora de transação e sem índice `unique` (`src/services/clients.js:11`, `src/db/idb.js:5`) — ver §6.
- **Ordenação natural:** a ordem de `getAll()` sem range é a ordem ascendente da chave (`src/db/idb.js:23`) — sendo a chave um UUID aleatório, ela **não** tem relação com o tempo de criação. Por isso toda exibição reordena em JS: `createdAt` desc para documentos e histórico (`src/services/clients.js:36,37`), `date` desc com empate em `createdAt` para dívidas (`src/services/debts.js:6`), `localeCompare(...,'pt-BR')` para nomes (`src/ui/clientlist.js:9`, `src/services/debts.js:26`), `createdAt` desc para os últimos clientes (`src/services/dashboard.js:7`).

## 6. Transações

Primitivos: `get`/`getAll` abrem transação `readonly` de 1 store; `put`/`del` abrem `readwrite` + `strict` de 1 store; `batch(ops)` abre **uma** transação `readwrite` sobre a **união** das lojas dos ops (`src/db/idb.js:22-30`), com `t.abort()` em erro síncrono (`src/db/idb.js:29`) e `dispatchEvent('data-changed')` só no `oncomplete` (`src/db/idb.js:30`). `batch([])` retorna `undefined` sem transação nem evento (`src/db/idb.js:27`).

| Operação | Stores tocados | Modo | Transações | Fonte |
|---|---|---|---|---|
| `listClients` / `getClient` | `clients` | readonly | 1 | `src/services/clients.js:6` → `src/services/records.js:5,6` |
| `saveClient` | `clients` (leitura) → `clients`+`blobs`+`history` | RO depois RW | **1 + 1** | `src/services/clients.js:17,27` |
| `counts` | `documents`, `debts` | readonly | 2 | `src/services/clients.js:29-30` |
| `deleteClient` | `clients`,`documents`,`debts`,`history` (leitura) → `documents`,`blobs`,`debts`,`history`,`clients` | RO depois RW | **4 + 1** | `src/services/clients.js:32-35` |
| `listDocs` / `listHistory` | `documents` / `history` | readonly | 1 cada | `src/services/clients.js:36-37` |
| `addDoc` | `documents` (leitura p/ hash) → `blobs`,`documents`,`history` | RO depois RW | **1 + 1** | `src/services/clients.js:40-42` |
| `removeDoc` | `blobs`,`documents`,`history` | RW | 1 | `src/services/clients.js:43` |
| `docBytes`/`blobBytes` | `blobs` | readonly | 1 por arquivo | `src/services/records.js:9` |
| `listDebts` | `debts` | readonly | 1 | `src/services/debts.js:6` |
| `saveDebt` / `deleteDebt` | `debts`,`history` | RW | 1 cada | `src/services/debts.js:23,24` |
| `findByRate` | `clients`+`debts` | readonly | 2 | `src/services/debts.js:25-26` |
| `applyBulk` | `debts` (leitura) → `debts`,`history` (N ops) | RO depois RW | **1 + 1** | `src/services/debts.js:30-34` |
| `getDueWindow` / `setDueWindow` | `settings` | RO / RW | 1 cada; **sem `data-changed`** | `src/services/settings.js:2-3` |
| `stats` | `clients`,`debts`,`history`,`settings` | readonly | 4 concorrentes (`Promise.all`) | `src/services/dashboard.js:4` |
| `auth.setup` | `meta` → `settings` → (`meta`+`settings` reads) | RW | **2 RW separadas** + leituras de `unlock` | `src/security/auth.js:21` |
| `auth.unlock` | `meta`,`settings` | RO/RW | ~5 | `src/security/auth.js:25,26,30,32,33,35→55` |
| `auth.setIdle` | `settings` → `meta` | RW | 2 | `src/security/auth.js:49` |
| `createBackup` | `clients`,`debts`,`documents`,`history`,`settings` + **1 tx por blob** | readonly | 5 + N | `src/export/backup.js:5,7,8` |
| `restore('replace')` | 5 lojas (`LISTS`+`blobs`) leitura → as 5 + `settings` escrita | RO depois RW | 5 + **1** | `src/export/backup.js:15-18,29` |
| `restore('merge')` | `LISTS` leitura → `clients`,`debts`,`documents`,`history`,`blobs` | RO depois RW | 4 + **1** | `src/export/backup.js:20-27,29` |

Padrão positivo: **toda a cifra e conversão de arquivo acontece antes da transação** (`src/services/clients.js:16-27`, `src/export/backup.js:11-29`), então erro de cifra não deixa escrita parcial; e `batch` é tudo-ou-nada para erros síncronos de montagem.

Três destaques estruturais:

1. **`deleteClient`: leitura em 4 transações, escrita em 1** (`src/services/clients.js:32-35`): `getClient` (`:32`), `listDocs` (`:33`), `rel('debts')` e `rel('history')` (`:34`) são `readonly` independentes; só depois `db.batch` (`:35`) apaga tudo numa transação de 5 lojas. Entre a leitura e o commit, outra aba pode inserir dívida ou documento — ele **não** entra na lista de deleção.
2. **Checagem de duplicidade fora da transação** (`src/services/clients.js:11` e `:17`): `validate` recebe `await listClients()` (transação `readonly` encerrada) e a escrita vem depois (`:27`), sem índice `unique` (`src/db/idb.js:5`). Duas gravações concorrentes com o mesmo CPF/CNPJ são aceitas. O mesmo vale para `hash` de documento (`src/services/clients.js:40`).
3. **Ausências em `idb.js`:** não existe `objectStoreNames.contains` em `src/` (grep: 0) — `MIGRATIONS[v]` chama `createObjectStore` sem guarda (`src/db/idb.js:14` e `:3-8`), e uma migração que recrie um store aborta o upgrade; e não existe tratamento de **downgrade**: se o banco do aparelho estiver em versão maior, `open()` falha em `r.onerror` (`src/db/idb.js:16`) e a UI só mostra "Não foi possível abrir o banco local" (`src/main.js:63`).

| Risco de integridade | Causa (linha) | Efeito observável |
|---|---|---|
| **Órfãos** de dívida/documento/histórico | janela leitura→escrita em `deleteClient` (`src/services/clients.js:32-35`) e `saveDebt` que **não** verifica existência do cliente (`src/services/debts.js:14-16`) | registro sem cliente entra nos totais (`src/services/dashboard.js:6`), fica invisível por cliente (`src/services/debts.js:6`) e faz `validate` do backup recusar a restauração (`src/export/backup-format.js:24-26`) |
| **Registro sem `clientId`** | `enc` omite `clientId` falsio (`src/services/records.js:7`) quando `map.get(...)` não resolve no merge (`src/export/backup.js:24-27`) | invisível para `rel()`/`listDocs`/`deleteClient` (`src/services/clients.js:29,33,36`), mas presente em `getAll` e nos totais |
| **Duplicidade de documento** (CPF/CNPJ e hash) | checagem fora de transação, sem `unique` (`src/services/clients.js:11,17,40`; `src/db/idb.js:5`) | duas linhas com o mesmo `doc`; dois registros `documents`+`blobs` para o mesmo arquivo |
| **Dado restaurado que quebra a leitura** | `validate` não exige `date`/`due` nem integridade inteira de `principal` (`src/export/backup-format.js:24`) | `due.js:2` lança `TypeError` (derruba `stats`), `money.js:9` lança `RangeError` com centavo fracionário, `debts.js:6` alterna entre crash e ordenação errada |
| **Blob órfão** | `restore('replace')` grava todos os `files` do ZIP sem checar referência (`src/export/backup.js:17`); `validate` não vistoria arquivos não referenciados (`src/export/backup-format.js:23-26`) | espaço consumido para sempre; em caminhos normais de UI os blobs antigos são apagados (`src/services/clients.js:21-22,33,43`) |
| **Índices nunca usados** | zero `.index(`/cursor/`IDBKeyRange` (`src/db/idb.js:5-8` vs `src/services/records.js:5`) | custo de escrita/espaço sem benefício; regressões de schema ficam invisíveis |
| **`history.at` nunca gravado** | `idx('history','clientId','at')` (`src/db/idb.js:8`) vs `hist()` que grava `createdAt` (`src/services/records.js:10`) | índice morto; ordenação real é `createdAt` (`src/services/clients.js:37`) |
| **Escrita fora de `batch` não revalida a tela** | `put`/`del` não disparam `data-changed` (`src/db/idb.js:24-25` vs `:30`) | `setDueWindow` (`src/services/settings.js:3`) e `setIdle` (`src/security/auth.js:49`) deixam a página com valor antigo em memória (`src/ui/debtspage.js:34,37`) |
| **Duas transações onde bastaria uma** | `auth.setup` (`src/security/auth.js:21`) | queda entre elas deixa `meta.vault` sem `settings.idleMinutes`; `unlock` recai no default 5 (`src/security/auth.js:33`) |

## 7. Migrações: como adicionar um store/índice com segurança hoje

Com o código atual (`src/db/idb.js:2-14`), o procedimento realista é:

1. **Acrescentar** `MIGRATIONS[1]` **no fim** do array, nunca editar `MIGRATIONS[0]` (política em `src/db/idb.js:1`). A função recebe `(db, tx)` (`src/db/idb.js:14`) e deve assumir que só roda para `oldVersion < 1`.
2. **Guardar-se contra re-execução**: hoje não há `objectStoreNames.contains`; a nova migração precisa checar `if(!db.objectStoreNames.contains('x'))` antes de `createObjectStore`, e o mesmo vale para `indexNames.contains` antes de `createIndex` — sem isso, um store já existente aborta o upgrade.
3. Manter a convenção do envelope: usar o helper `idx(s,...campos)` (`src/db/idb.js:5`) para stores de negócio, o que fixa `keyPath:'id'`. Lembre que o índice só funciona sobre campo **em claro** do envelope: campos que hoje moram dentro de `data` cifrado (`src/services/records.js:7`) não podem ser indexados sem antes migrar o campo para o envelope claro — o que aumenta a superfície exposta (ver §3).
4. **Retrofit**: preencher a chave de índice nos registros já gravados, com cursor sobre a `r.transaction` do upgrade (`src/db/idb.js:14`), porque um índice sem a chave nos registros fica morto — é exatamente o bug atual de `history.at` (`src/db/idb.js:8` vs `src/services/records.js:10`).
5. **`DB_VERSION` sobe sozinha**, por ser `MIGRATIONS.length` (`src/db/idb.js:10`) — não edite o valor à mão.
6. **Cache do PWA**: adicionar o arquivo alterado em `FILES` e incrementar `V` em `sw.js:1-2` (`V='sc-v69'`), senão aparelhos já instalados continuam servindo o `idb.js` antigo do cache.
7. **Backup**: se o novo store entra no backup, inclua em `LISTS` (`src/export/backup-format.js:5`), nos loops de `buildBackup`/`restore` (`src/export/backup.js:12-18`) e **bemplace `FORMAT`** (`src/export/backup-format.js:5`), porque `readBackup` recusa `formatVersion > FORMAT` (`src/export/backup-format.js:32`) e o `manifest.json` leva `formatVersion` e `dbVersion` (`src/export/backup-format.js:15`).
8. **Texto da UI**: "versão `${db.DB_VERSION}`" (`src/ui/settings.js:50`) reflete a mudança automaticamente; nada fixo a atualizar ali.

**O que falta para migração segura:** guarda `objectStoreNames`/`indexNames` (inexistente em `src/db/idb.js:3-14`); teste de `versionchange`/`onblocked`/downgrade (nenhum teste em `tests/` importa `src/db/idb.js` — ver `docs/auditoria-ui-ux-codigo.md` §7 da auditoria); proteção contra edição de migração antiga (só comentário, `src/db/idb.js:1`); tratamento de `VersionError` com mensagem acionável (`src/db/idb.js:16`, `src/main.js:63`); e um caminho real de migração de formato de backup — `MIGRATE[v](data) -> v+1` é **apenas citado no comentário** `src/export/backup-format.js:3` e **não existe implementação** (grep `MIGRATE` em `src/` retorna só essa linha).

## 8. Consultas e custo

- Toda listagem é `getAll` do store inteiro + decifração de **todos** os registros: `list()` faz `Promise.all(getAll(s).map(dec))` (`src/services/records.js:5`) e `dec` chama `openJSON` → `crypto.subtle.decrypt` por registro (`src/security/crypto.js:19-20`). Complexidade por listagem: **O(N) operações AES-GCM**, mesmo para exibir uma página de 20 itens (`src/ui/clientlist.js:3,12`).
- Exceção barata: `rel()` (`src/services/clients.js:29`) filtra `getAll` cru pela chave em claro `clientId` **sem decifrar** — é por aí que `counts()` fica leve; já `listDocs`/`listHistory` (`src/services/clients.js:36-37`) usam `list()` e decifram tudo.
- `stats()` (`src/services/dashboard.js:4`) dispara 4 leituras concorrentes (`clients`, `debts`, `history`, `settings`) e o dashboard as refaz a cada `data-changed` (`src/ui/dashboard.js:10,37`, evento em `src/db/idb.js:30` / `src/core/live.js:2`). A página de Clientes lê `clients` **e** `debts` inteiros para permitir filtro por taxa (`src/ui/clientlist.js:32`). A página de Dívidas também (`src/ui/debtspage.js:34`). `createBackup` abre **uma transação `readonly` por arquivo** além das 4 listas (`src/export/backup.js:5-7`).
- **Os 6 índices existem e nenhum é usado**: não há `.index(`, `openCursor`, `getAllKeys` nem `IDBKeyRange` em `src/`. Em N grande o app paga o custo de escrita/espaço dos índices e o custo de leitura integral, sem nenhum ganho — e o retrofit necessário para usar `debts.clientId` seria exatamente mover a filtragem para o banco.
- `search.js` é **pura e em memória**: `match(c,q)` (`src/services/search.js:3-4`) normaliza acento/caixa (`NFD` + remoção de combining, `src/services/search.js:1`) e casa `name`, `email`, `rg`; a busca numérica (dígitos) sobre `doc`, `rg`, `phone`, `mobile` só entra se a query inteira couber em `^[\d\s.\-\/()+]+$` (`src/services/search.js:4`). Query vazia casa tudo (`src/services/search.js:3`). Não pesquisa endereço, cidade, CEP, dívidas nem documentos; o filtro por taxa é feito na UI com `listDebts()` já carregado (`src/ui/clientlist.js:7-10`).

## 9. Histórico (`history`)

- **Quem escreve:** sempre `hist(clientId, type, detail)` (`src/services/records.js:10`), que monta um op `['put','history',{id,clientId,createdAt,data}]` com `createdAt = Date.now()` **no momento da montagem** (antes do commit — se o `batch` falhar, o evento não existe, mas o timestamp já foi fixado).
- **Quando:** nas operações de negócio, nunca em login/backup/restauração. Clientes: `Cadastro de cliente` (`src/services/clients.js:24`), `Alteração de dados` com a lista de rótulos alterados via `LABEL` (`src/services/clients.js:5,25`), `Fotografia incluída/alterada/removida` (`src/services/clients.js:21-22,26`). Documentos: `Documento incluído` com `nome (categoria)` (`src/services/clients.js:42`) e `Documento removido` (`:43`). Dívidas: `Dívida cadastrada` (`src/services/debts.js:17`), `Dívida alterada` (`:20`), `Juros alterados` (`:21`), `Dívida excluída` (`:24`), `Juros alterados em lote` (`:33`).
- **O que é gravado:** em claro `id`, `clientId`, `createdAt`; cifrado `type` e `detail` (`src/services/records.js:10`). **Não** há referência à dívida ou ao documento descrito — só `clientId` e texto, e o índice `at` permanece vazio (§2). Restauração de backup **não** gera evento de histórico: `restore` usa `enc` diretamente (`src/export/backup.js:16,23-27`).
- **O que a UI mostra:** a ficha do cliente chama `listHistory(id)` (`src/services/clients.js:37`) em `src/ui/clients.js:133` e renderiza `e.type` em negrito, `e.detail` se existir, e a data formatada de `e.createdAt`, 5 por página (`src/ui/clients.js:146-153`); o dashboard pega os 8 mais recentes já em `stats()` (`src/services/dashboard.js:7`) e exibe 4, com o nome do cliente resolvido por mapa (`src/ui/dashboard.js:22`, `src/services/dashboard.js:4`). Os relatórios também leem `history` (`src/export/reports.js:11`).

## 10. Dados de exemplo (FICTÍCIOS)

Valores fabricados; o CPF `111.444.777-35` passa em `validCPF` (`src/domain/validators.js:2-3`) — verificado em execução. Abaixo está a **visão de serviço** (objeto devolvido por `dec`, `src/services/records.js:4`); o registro físico correspondente tem apenas `id`, `createdAt`, `clientId` e `data` (bytes cifrados).

Cliente — `clients`:

```json
{
  "type": "PF", "name": "Maria Exemplo", "doc": "111.444.777-35",
  "birth": "1980-03-12", "gender": "Feminino", "rg": "12.345.678-9",
  "phone": "(13) 3333-0000", "mobile": "(13) 99999-0000",
  "email": "maria.exemplo@exemplo.test", "cep": "11010-000",
  "state": "SP", "street": "Rua Exemplo", "number": "25",
  "complement": "Apto 1", "district": "Centro", "city": "Santos",
  "address": "Rua Exemplo, 25, Apto 1 - Centro, Santos/SP",
  "id": "3f1c2a58-7b6d-4e1a-9c2f-0a1b2c3d4e5f",
  "photoId": "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
  "photoType": "image/webp",
  "createdAt": 1763017200000, "updatedAt": 1763190000000,
  "clientId": null
}
```
Campos de `type` a `address` vêm do formulário (`src/ui/clients.js:46`); `photoId`/`photoType`/`createdAt`/`updatedAt` são acrescentados em `src/services/clients.js:19-23`. `clientId` aparece como `undefined` na leitura de cliente (`src/services/records.js:4`).

Dívida — `debts` (registro físico + conteúdo decifrado):

```json
{
  "id": "7d9e0f1a-2b3c-4d5e-8f60-1a2b3c4d5e6f",
  "createdAt": 1763190000000,
  "clientId": "3f1c2a58-7b6d-4e1a-9c2f-0a1b2c3d4e5f",
  "data": "<Uint8Array: IV(12) || cifra || tag(16) — 222 bytes>",
  "___data_decifrado___": {
    "description": "Empréstimo pessoal de exemplo",
    "principal": 150000,
    "rate": 1250,
    "date": "2026-11-15",
    "due": "2026-12-15",
    "notes": "Cadastro fictício para documentação.",
    "updatedAt": 1763190000000
  }
}
```
`principal` em centavos (R$ 1.500,00) e `rate` em centésimos de ponto percentual (12,5% ao mês) por `src/domain/money.js:1`; `interest` (R$ 187,50) **não** é persistido — é derivado por `src/services/debts.js:5` via `src/domain/money.js:9`. Campos válidos são exatamente os da whitelist `rec()` (`src/services/debts.js:4`).

Documento — `documents`:

```json
{
  "id": "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e",
  "createdAt": 1763190500000,
  "clientId": "3f1c2a58-7b6d-4e1a-9c2f-0a1b2c3d4e5f",
  "data": "<Uint8Array cifrado>",
  "___data_decifrado___": {
    "name": "contrato-maria.pdf",
    "orig": "Contrato Maria.pdf",
    "category": "Comprovante de transferência",
    "type": "application/pdf",
    "size": 184320, "originalSize": 184320, "converted": false,
    "hash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "blobId": "c3d4e5f6-a7b8-4c9d-0e1f-2a3b4c5d6e7f"
  }
}
```
`category` vem da lista fechada `CATS` (`src/services/clients.js:4`), mas o serviço não a valida (`src/services/clients.js:38-42`); o `blobId` aponta para `blobs` como `{id, data}` cifrado (`src/services/records.js:8`); `hash` é SHA-256 hex dos bytes gravados (`src/files/process.js:7`) e PDF é guardado como veio, sem conversão (`src/files/process.js:3,9`).

Histórico — `history`:

```json
{
  "id": "d4e5f6a7-b8c9-4d0e-1f2a-3b4c5d6e7f80",
  "createdAt": 1763190500000,
  "clientId": "3f1c2a58-7b6d-4e1a-9c2f-0a1b2c3d4e5f",
  "data": "<Uint8Array cifrado>",
  "___data_decifrado___": {
    "type": "Documento incluído",
    "detail": "contrato-maria.pdf (Comprovante de transferência)"
  }
}
```
Repare que **não existe chave `at`** — o índice `history.at` (`src/db/idb.js:8`) nunca é populado (`src/services/records.js:10`).

## 11. Onde vivem as regras de validação e o que acontece com dado inválido

| Regra | Onde vive | Guardião real | Dado inválido → | Fonte |
|---|---|---|---|---|
| Janela de vencimento (1–365 dias, default 7) | `src/services/settings.js:2-3` | **só a UI** (`src/ui/settings.js:42-44`) | `setDueWindow('abc')` grava `"abc"`; `status()` compara `n<=win` com string e passa a chamar de `ok` o que seria `soon` — **sem crash, com ordenação/classificação errada** | `src/services/settings.js:3`, `src/domain/due.js:5` |
| Nome e CPF/CNPJ obrigatórios + unicidade | `src/services/clients.js:9-11` | service (`validate` nunca lança; retorna mapa) | `saveClient` lança `Error` com `.errs` e a UI destaca os campos (`src/services/clients.js:18`) | `src/services/clients.js:7-14` |
| Telefone 10–11 dígitos, e-mail por regex | `src/services/clients.js:12-13` | service | erro de campo | `src/services/clients.js:12-13` |
| CEP 8 dígitos ≠ `00000000` | `src/domain/address.js:4` | **só a UI** (`src/ui/clients.js:117`) — `validate` não chama `validCep` | CEP inválido **é gravado** | `src/services/clients.js:7-14` |
| Dívida: descrição, `0 < principal ≤ 1e13`, `0 < rate ≤ 1000%`, `date`/`due` ISO, `due ≥ date` | `src/services/debts.js:7-13` (com `iso()` em `:2`) | service | erro de campo; taxa `0%` é recusada | `src/services/debts.js:9-12` |
| Cálculo de juros | `src/domain/money.js:9` (`BigInt`) | — | `principal` não inteiro (possível via restore) → **crash** `RangeError`, que derruba `listDebts`, `stats` e relatórios | `src/services/debts.js:5`, `src/export/backup-format.js:24` |
| Situação de vencimento | `src/domain/due.js:5` | — | `due` ausente → **crash** `TypeError: ... reading 'slice'` (`src/domain/due.js:2`) em `stats()`; `due` malformado (`2026-02-30`) → **sem erro, data rolada** por `Date.UTC` | `src/domain/due.js:2` |
| Ordenação de dívidas por `date` | `src/services/debts.js:6` | — | registro sem `date` → `localeCompare(undefined)`: **crash ou ordenação errada conforme a posição no sort** (não determinístico) | `src/services/debts.js:6`, `src/db/idb.js:23` |
| `category` de documento | `src/services/clients.js:4` | **só a UI** (`src/ui/clients.js:142,174`) | categoria fora da lista é gravada | `src/services/clients.js:38-42` |
| Integridade do backup | `src/export/backup-format.js:20-27` | service | aceita dívida sem `date`/`due`, `principal` fracionário, `dueWindow` não numérico e arquivo sem referência — que explodem depois na leitura | `src/export/backup-format.js:24` |
| Campos extras em dívida | whitelist `rec()` | service | **descartados em silêncio** | `src/services/debts.js:4` |
| Pré-requisito de sessão | `getKey()` | service | qualquer leitura/escrita de negócio lança `Sessão bloqueada.` | `src/security/auth.js:14`, `src/services/records.js:4-9` |

## 12. Checklist de alteração de schema

1. `src/db/idb.js`: **nova função no fim** de `MIGRATIONS`, nunca editar as antigas (`:1-9`); checar `objectStoreNames`/`indexNames` antes de criar (não existe hoje); não tocar em `DB_VERSION`, que deriva de `MIGRATIONS.length` (`:10`).
2. Retrofit dos registros existentes na mesma transação de upgrade (`:14`) — índice sobre chave ausente fica morto como `history.at` (`:8`).
3. `src/services/records.js`: se o campo novo precisa ser consultado/indexado, ele tem de entrar no envelope **claro** (`:7`) — decisão de exposição de dados, não só de schema; se for só payload, nada muda aqui.
4. Serviços: whitelist de persistência (`src/services/debts.js:4`), montagem de registro (`src/services/clients.js:23`), `LABEL` de auditoria (`src/services/clients.js:5`, `src/services/debts.js:3`) para o histórico aparecer correto.
5. Validação no **service**, não apenas na UI (§11) — lembrar que `enc`/`dec` (`src/services/records.js:4,7`) não validam nada.
6. `src/export/backup-format.js`: adicionar store em `LISTS` (`:5`), em `buildBackup` (`:12-13`) e **bumpar `FORMAT`** (`:5`), com `validate()` ajustado (`:20-27`); `readBackup` recusa formato maior (`:32`).
7. `src/export/backup.js`: `createBackup` (`:5-9`) e `restore` nos dois modos (`:15-27`) — inclusive a regra de merge por CPF/CNPJ (`:22`) e a possibilidade de gravar sem `clientId` (`:24-27`).
8. `src/services/dashboard.js` (`stats`) e `src/services/search.js` (`match`) se o campo muda agregação ou busca; telas em `src/ui/*.js` que só chamam `getAll`/`list`.
9. `sw.js`: acrescentar o módulo em `FILES` e incrementar `V` (`:1-2`) — sem isso o `idb.js` antigo continua servido do cache.
10. Texto "Banco local — versão N" (`src/ui/settings.js:50`) e `manifest.json` do backup (`dbVersion`, `src/export/backup-format.js:15`).
11. Testes: nada cobre o schema, `batch`, cascatas ou migrações (`tests/*.test.mjs` não importam `src/db/idb.js`); ao mexer aqui, criar o teste junto — e um teste que assevere que **todo índice do schema corresponde a uma chave realmente gravada** (é como `history.at` sobreviveu órfão).
12. Revisar riscos de concorrência se a mudança envolver escrita multi-store (§6): preferir `db.batch` a múltiplos `db.put`, porque `put`/`del` não disparam `data-changed` (`src/db/idb.js:24-25,30`) e a UI não se revalida.

---

*Cobertura das asserções*: os itens verificados **em execução** foram `DB_VERSION`, contagem de stores/índices e suas opções, formato e tamanho do payload cifrado, campos e tamanho de `vault.wrapped`, `extractable=false` da DEK e a validade do CPF de exemplo. O que exige navegador real — IndexedDB nativo, abort de upgrade por store existente, `QuotaExceededError`, conversão de imagem em `src/files/process.js:11-14` — permanece **NÃO CONFIRMADO**.
