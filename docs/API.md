# SCIPIONE CRED — API.md (catálogo de interfaces)

Referência das interfaces reais do projeto. Toda entrada foi conferida no código (`src/`, `api/cpf.js`) e é citada como `arquivo:linha` da definição. Fontes secundárias: `docs/auditoria/2-dados-negocio.md` (dados e serviços) e `docs/auditoria/6-integracoes-infra.md` (serverless e integrações). O relatório `docs/auditoria/4-backup-exportacao.md` **não existe** — a seção 7 saiu só do código (`src/export/*.js`) e de `tests/backup.test.mjs`. **[verificado]** = executado em Node 22 contra o módulo. **NÃO CONFIRMADO** = sem evidência no repositório. Total: **138 exports** (135 na seção 4 + `default` e `__quota` de `api/cpf.js` na seção 2 + `GOOGLE_OAUTH` nas seções 3 e 9). Todos os exemplos são sintéticos: nenhum CPF, nome, e-mail ou endereço real.

---

## 1. Convenções

| Convenção | Evidência |
|---|---|
| ES Modules puros: sem transpile, sem bundler, sem tipos | `package.json:1` = `{"type":"module","private":true}`; `<script type="module" src="src/main.js">` em `index.html:11` |
| Zero dependências instaladas; a única lib (`fflate`) é commitada e lida de `globalThis` | `package.json:1`, `vendor/fflate.min.js`, `src/export/lib.js:2-4` |
| Sem `version` e sem campo `scripts` no `package.json`: não existe `npm test` nem `npm run build`. As ferramentas existem como arquivos chamáveis diretamente — `scripts/check-static.mjs` e `scripts/run-tests.mjs` —, invocados por `node …` e pela CI (§10) | `package.json:1`; forma canônica em `docs/README.md:22` |
| Um módulo expõe API **só por named exports**; a única exceção é `api/cpf.js`, `export default` exigido pela Vercel — que exporta também `__quota`, gancho de teste (`api/cpf.js:138`), não API do app | `api/cpf.js:93` |
| Re-export por repasse | `export{blobBytes}` (`src/services/clients.js:3`), `export{readBackup}from'./backup-format.js'` (`src/export/backup.js:3`) |
| Constantes em SCREAMING | `MAXR` (`money.js:2`), `ITER` (`crypto.js:4`), `FORMAT`/`LISTS` (`backup-format.js:5`), `CATS` (`clients.js:4`), `DB_VERSION` (`idb.js:10`), `GOOGLE_OAUTH` (`config/google.js:4`) |
| Erro de domínio = `Error` com propriedade extra: `{code}` nas integrações, `{errs}` nos services de escrita | `src/services/viacep.js:5`, `src/services/clients.js:18` |
| Camadas: `domain/` (puro, sem imports de serviço) ← `services/` ← `ui/`; `db/`, `security/`, `files/`, `export/`, `config/` ficam abaixo de `services/` | `src/domain/money.js` (sem imports), `src/services/clients.js:1`, `src/ui/clientlist.js:1` |
| Estilo denso: `import*as X from'…'`, sem JSDoc, sem `.d.ts`, sem lint | `src/main.js:1-3`, `src/services/clients.js:1` |

**Injeção de `h`.** `h` é a factory de elementos, definida **uma única vez** em `src/main.js:5`: trata atributo `on*` como listener (`addEventListener(n.slice(2),v)`), converte `true` em atributo vazio e descarta `false`/`null`/`undefined` entre os filhos. É entregue por `ctx()=>({h,show,fmt,home})` (`main.js:7`) às views (`clientsView(ctx,q)`, `settingsView(X)`, `reportsView(X)`, `backupView(X)`); as views guardam o contexto em variável de módulo (`X` em `src/ui/clients.js:2`, `src/ui/tools.js:6`) e remontam um objeto próprio (`U={h,render,top}`, `src/ui/clients.js:12`). Componentes reutilizáveis recebem `h` como parâmetro explícito (`src/ui/kit.js:8,18`; `src/ui/avatar.js:13`); `initShell` pega `const{h}=ctx()` (`src/ui/shell.js:11`). Exceção confirmada: `icon()` **não** usa `h` — chama `document.createElementNS` (`src/ui/icons.js:44`). Consequência: nenhum componente é reusável fora do `main.js` sem um `h` de mesma semântica, e nada verifica que o `h` injetado obedece a ela.

---

## 2. API pública da função serverless `/api/cpf`

Arquivo `api/cpf.js` (**138 linhas**; era um proxy de 48 linhas e foi reescrito na branch `fix/api-cpf-exposure-and-debt-integrity`). A rota `/api/cpf` vem do layout File System Functions da Vercel; `vercel.json` não tem bloco `functions` — **NÃO CONFIRMADO** pelo repositório. O `handler` está em `api/cpf.js:93` e a ordem das barreiras é sempre a mesma: método → `content-type` → origem → cota → corpo/validação → chave → provedor (`:94-114`).

| Item | Contrato | Evidência |
|---|---|---|
| Método | `GET` (legado) e `POST`; qualquer outro → `405` (inclui `HEAD`, `OPTIONS`, `PUT`) | `api/cpf.js:94` |
| Corpo da requisição (POST — caminho do app) | `{"cpf":"52998224725"}`; `cpf` aceito como **string ou número** (`:81-82`, `:90`), sempre por `digits()`. JSON imprestável ou sem `cpf` → `422` (`:88-90`) | `api/cpf.js:78-91` |
| Teto de corpo | `MAX_BODY=1024` bytes; corpo em **stream** é interrompido no meio e devolve `413` | `api/cpf.js:13,85,103` |
| Parâmetro (GET legado — **deprecado**) | `?cpf=<qualquer string>` lido por `new URL(req.url\|\|'/','https://local.invalid').searchParams.get('cpf')`; continua aceito porque bundles pré-cacheados chamam a forma antiga (comentário `:71-72`) | `api/cpf.js:74-77` |
| `content-type` | `POST` sem `application/json` → `415`, checagem feita **antes** de ler qualquer byte do corpo | `api/cpf.js:95-96` |
| Sanitização | `digits()` remove tudo que não é dígito antes de qualquer uso; 11 dígitos + DV obrigatórios antes de qualquer chamada paga | `api/cpf.js:106`, `src/domain/validators.js:1` |
| Auth / origem / rate limit | **sem autenticação de chamador**. `Origin`/`Referer` comparados ao `host` da requisição + allowlist `SCIPIONE_ALLOWED_ORIGINS` → `403`; **header ausente deixa o pedido passar** (`:50`) — não é autenticação (`:44-47`). Cota de janela fixa **em memória, por instância aquecida** (`:19-22`): por IP e por instância | `api/cpf.js:48-56,98`; `:58-69,99-100`; ausência de regra em `vercel.json:1-62` |
| IP do chamador | `x-forwarded-for` (primeiro item) → `x-real-ip` → literal `'desconhecido'` | `api/cpf.js:37-40` |
| Timeout / abort | `TIMEOUT=8000` ms + `AbortController`; `clearTimeout` no `finally` | `api/cpf.js:12,111-112,131-132` |
| Env | `APICPF_API_KEY` (ausente → `503`) mais **4 novas**, lidas **a cada requisição** (`:15-17`): `CPF_QUOTA_WINDOW_MS` (default 60000), `CPF_QUOTA_PER_IP` (30), `CPF_QUOTA_PER_INSTANCE` (300), `SCIPIONE_ALLOWED_ORIGINS` (vazio = só o host da requisição). Não numérico ou `<=0` cai no default (`:15`) | `api/cpf.js:108-109,15-17`; `.env.example:3,10,15,18,21` |
| Header ao provedor | `X-API-KEY: <APICPF_API_KEY>` + `Accept: application/json`, **só** no salto servidor→`apicpf.com`, que continua `GET` com `?cpf=` porque é o contrato do provedor | `api/cpf.js:114` |
| Exports | `export default handler` (exigência da Vercel) + `export const __quota` — gancho de teste para zerar/inspecionar contadores, **não é API do app** | `api/cpf.js:93,138` |

**Headers definidos na resposta.** `send()` (`api/cpf.js:27-32`) é o único caminho de saída e sempre define exatamente dois: `Content-Type: application/json; charset=utf-8` (`:29`) e `Cache-Control: no-store` (`:30`, asserido em `tests/apicpf.test.mjs:212`). `Retry-After` é o único header condicional e sai **só** no 429 (`:100`). Não há `Access-Control-Allow-*`, `Vary` nem `Allow` no 405 (ausência em `api/cpf.js:27-32` e `vercel.json:3-59`): outro site não consegue ler a resposta, mas ainda consegue disparar o pedido — a barreira contra isso é a checagem de origem (`:48-56`), não CORS.

| Status | Corpo exato | Condição | O que o cliente faz |
|---|---|---|---|
| `200` | `{"ok":true,"data":{"name":string,"gender":string,"birth":string}}` | `r.ok && body?.data` do provedor; whitelist de campos `api/cpf.js:117-122` | renormaliza (trim no nome, `gender∈{M,F,I}`, `birth` tem de casar `^\d{4}-\d{2}-\d{2}$`), cacheia 30 min e preenche **só campos vazios**; status verde `Validado` (`src/services/apicpf.js:37-44`, `src/ui/clients.js:87-89`) |
| `405` | `{"ok":false,"reason":"METHOD"}` | método fora de `GET`/`POST` (`api/cpf.js:94`) | cai no default → `fail('UNAVAILABLE')` → **nenhum aviso na tela** (`apicpf.js:47`, `clients.js:93`) |
| `415` | `{"ok":false,"reason":"TYPE"}` | `POST` com `content-type` que não contém `application/json` — barrado **antes** de tocar no corpo (`api/cpf.js:95-96`) | idem: `fail('UNAVAILABLE')`, **nenhum aviso** (`apicpf.js:47`, `clients.js:93`) |
| `403` | `{"ok":false,"reason":"ORIGIN"}` | `Origin`/`Referer` presente com host diferente do `host` da requisição e fora de `SCIPIONE_ALLOWED_ORIGINS` (`api/cpf.js:48-56`, aplicado em `:98`). **Sem header, o pedido segue** (`:50`): 403 não é a resposta padrão de sonda anônima | idem (`apicpf.js:47`). Diferente de `INVALID`: não pinta badge vermelho |
| `429` | `{"ok":false,"reason":"RATE_LIMITED"}` **+ header `Retry-After`** em segundos inteiros, ≥1 (`api/cpf.js:65,100`) | cota de janela fixa estourada por IP (`:66`) **ou** por instância aquecida (`:67`); tetos e janela por env, lidos a cada requisição (`:15-17`) | `r.ok` é falso e o `reason` não é `INVALID` → `fail(timedOut?'TIMEOUT':'UNAVAILABLE')` (`apicpf.js:47`) → **a interface continua exatamente como antes**: status some, sem mensagem, cadastro segue manual (`clients.js:93`) |
| `413` | `{"ok":false,"reason":"TOO_BIG"}` | corpo em stream passou de `MAX_BODY=1024` B; a leitura é cortada no meio (`api/cpf.js:13,85`, resposta em `:103`) | idem: `fail('UNAVAILABLE')`, nenhum aviso (`apicpf.js:47`, `clients.js:93`) |
| `422` | `{"ok":false,"reason":"INVALID"}` | (a) corpo sem `cpf`/JSON imprestável (`api/cpf.js:104`) ou ≠11 dígitos / DV inválido (`:106`); (b) provedor 400/404 **ou** `body.code===400/404` (`:124-125`) | `r.status===422\|\|body?.reason==='INVALID'` → `throw fail('INVALID')` → badge vermelho **Inválido** (`apicpf.js:46`, `clients.js:92`) — **único** código com feedback visual |
| `503` | `{"ok":false,"reason":"UNAVAILABLE"}` | (a) env ausente (`api/cpf.js:109`); (b) 401/402/403/429/5xx do provedor, JSON imprestável, abort/timeout, exceção de rede (`:128,130`) | `fail('UNAVAILABLE')` → `setDocStatus('')`: o status **some**, sem mensagem, e o cadastro segue manual (`apicpf.js:47`, `clients.js:93`) |

Anti-injeção de resposta: `name` só sai se `typeof body.data.nome==='string'`; `gender` só se ∈ `{M,F,I}`; `birth` só se string. Campos extras do provedor — inclusive `message` — nunca são repassados (`api/cpf.js:118-122`; asserção `tests/apicpf.test.mjs:232`). A ausência de eco vale para **todos** os corpos de erro: são literais `{ok,reason}` (`:94,96,98,100,103,104,106,109,125,128,130`), asserido transversalmente em `tests/apicpf.test.mjs:541`.

**Ordem real do `handler`** (`api/cpf.js:93`): método (`:94`) → `content-type` (`:95-96`) → origem (`:98`) → cota (`:99-100`) → leitura do corpo e validação do CPF (`:102-106`) → chave (`:108-109`) → provedor (`:114`). As quatro primeiras barreiras **não existiam** na versão anterior deste documento e todas vêm antes de qualquer gasto pago.

**Sem a env — o oráculo continua.** A validação de CPF ainda vem **antes** da checagem da chave (`api/cpf.js:106` vs `:109`), então uma função implantada sem `APICPF_API_KEY` ainda responde `422` para CPF inválido e `503` para CPF válido: **é oráculo público de dígito verificador mesmo sem chave**, porque a distinção é produzida por código local, não pela resposta do provedor. Isso **não foi resolvido**; o que mudou é a posição na fila — o oráculo ficou **atrás** da checagem de origem e da cota. Estreita, não fecha: quem não envia header de origem passa (`:50`), e IP rotacionado continua sondando até o teto por instância (`:67`). No app, 503 por env ausente é indistinguível de offline (risco C-9, `docs/auditoria/6-integracoes-infra.md:592`). Se `/api/cpf` não existir (hospedagem estática), o 404 em HTML passa pelo `try{body=await r.json()}catch{}` do cliente e vira `UNAVAILABLE` silencioso (`src/services/apicpf.js:36,47`; `docs/apicpf.md:24`).

```http
POST /api/cpf HTTP/1.1
Content-Type: application/json
Accept: application/json

{"cpf":"52998224725"}

HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8
Cache-Control: no-store

{"ok":true,"data":{"name":"Maria Exemplo da Silva","gender":"F","birth":"1990-01-01"}}
```

Nas demais respostas os dois headers acima são idênticos — tudo passa por `send()` (`api/cpf.js:27-32`), que define **exatamente** `Content-Type` e `Cache-Control: no-store`; o único header condicional é `Retry-After`, e só no 429 (`:100`). Só muda status e corpo:

- `POST {"cpf":"123"}` → `422` · `INVALID` — 3 dígitos: nem chega ao provedor (`api/cpf.js:106`)
- `POST {"cpf":52998224725}` → aceito: número em vez de string dá nos mesmos 11 dígitos (`api/cpf.js:90`)
- `POST` sem `Content-Type: application/json` → `415` · `TYPE` (`api/cpf.js:95-96`)
- `POST` com corpo de 2 KiB → `413` · `TOO_BIG` (`api/cpf.js:85,103`)
- `PUT /api/cpf` → `405` · `METHOD` (`api/cpf.js:94`)
- `POST` com `Origin: https://exemplo.io` → `403` · `ORIGIN` (`api/cpf.js:98`)
- 31º `POST` do mesmo IP dentro de 60 s → `429` · `RATE_LIMITED` + `Retry-After: 59` (`api/cpf.js:66,100`)
- `GET /api/cpf?cpf=529.982.247-25` com `APICPF_API_KEY` ausente → `503` · `UNAVAILABLE` (`api/cpf.js:109`)
- `GET /api/cpf?cpf=…` continua **aceito** (`api/cpf.js:74-77`): forma legada, deprecada, mantida só para os bundles pré-cacheados (versão canônica do cache em `sw.js:2`)

Consumidor único: `src/services/apicpf.js:28-33` — `POST /api/cpf` com `body:JSON.stringify({cpf})`, `cache:'no-store'` e **nenhuma query string**. A perna navegador→função, que é a que os nossos logs veem, não carrega mais o número; a query string sobe **só** no salto servidor→APICPF (`api/cpf.js:114`), porque o contrato do provedor é `GET` com `?cpf=` e não é nosso para mudar (risco C-3, `docs/auditoria/6-integracoes-infra.md:586`, passa a valer para essa perna e para o GET legado). O `GET /api/cpf?cpf=` continua aceito no servidor (`api/cpf.js:74-77`) enquanto houver instalação com bundle pré-cacheado chamando a forma antiga — forma **deprecada**, sem data de remoção definida. O contrato é o que `tests/apicpf.test.mjs:126-590` valida: 40 casos, **nenhum** com rede real (`tests/apicpf.test.mjs:571,578`, e o contrato transversal `tests/contracts/no-egress.test.mjs`).

---

## 3. APIs de terceiros consumidas

### 3.1 ViaCEP — chamada direta do navegador

| Item | Valor | Evidência |
|---|---|---|
| Base / URL final | `ENDPOINT='https://viacep.com.br/ws/'` → `GET …/ws/<8 dígitos>/json/` | `src/services/viacep.js:3,17` |
| Headers | `Accept: application/json`, `cache:'no-cache'`, `signal` | `src/services/viacep.js:17` |
| Payload enviado | **somente o CEP** — nenhum nome, CPF ou telefone sai do aparelho | `src/services/viacep.js:6-17` |
| Timeout | default `8000` ms parametrizável + `AbortController` | `:6,11-14,25` |
| Campos usados da resposta | `cep`→`cep` (remascarado `maskCep(data.cep||d)`), `logradouro`→`street`, `bairro`→`district`, `localidade`→`city`, `uf`→`state` (maiúsculas); ausente vira `''` | `:32` |
| Efeitos na UI | sobrescreve `street`,`district`,`city`,`state`; **não** toca `number` nem `complement` | `src/ui/clients.js:106` |
| Erros (todos `.code`, todos terminam em "preencha manualmente") | `INVALID` `:8`, `OFFLINE` `:10` (guard `navigator.onLine===false`), `TIMEOUT` `:20`, `NETWORK` `:23`, `UNAVAILABLE` `:28`, `INVALID_RESPONSE` `:30`, `NOT_FOUND` `:31` (aceita `erro===true` **ou** `'true'`); `AbortError` externo é re-lançado puro `:21` | — |
| Cache | `Map` de módulo **sem TTL e sem limite**, vida da aba | `:4,9,33` |
| CSP | `https://viacep.com.br` em `connect-src` | `index.html:3` |

Disponibilidade, SLA e schema oficial do ViaCEP: **NÃO CONFIRMADO** (nenhuma chamada de rede foi feita).

### 3.2 APICPF — sempre via proxy, nunca direta

O navegador chama apenas `/api/cpf` por `POST` com o CPF no corpo (`src/services/apicpf.js:28-33`). A URL do provedor (`https://apicpf.com/api/consulta`, `api/cpf.js:11`) e o header `X-API-KEY` (`api/cpf.js:114`) existem **só no servidor** — nenhum string `apicpf.com` aparece em código de browser (grep em `src/`: zero). Campos consumidos pelo proxy: `data.nome`, `data.genero`, `data.data_nascimento`, `code` (`api/cpf.js:119-124`). Erros documentados do provedor — 400/404 inválido ou não encontrado, 401/403 chave, 402 créditos, 429 limites (100/dia, 6/min no plano gratuito) — vêm de `docs/apicpf.md:71-78`: **NÃO CONFIRMADO** contra o provedor. Qualquer status não previsto colapsa em 503 (`api/cpf.js:128,130`), que é falha segura. Existência, retenção e base legal do serviço: **NÃO CONFIRMADO**.

### 3.3 Google — Google Identity Services + Drive API v3

| Item | Valor real no código | Evidência |
|---|---|---|
| Script injetado | `https://accounts.google.com/gsi/client` (`async`+`defer`), timeout 20 s | `src/services/google-drive.js:65,68` |
| Global lido | `window.google.accounts.oauth2.initTokenClient` / `.revoke` | `:50,97,116` |
| Escopo (único) | `https://www.googleapis.com/auth/drive.file`, aplicado em `initTokenClient` | `:8,99` |
| Bases | `API='https://www.googleapis.com/drive/v3'`; `UPLOAD='https://www.googleapis.com/upload/drive/v3'` | `:6,7` |
| Autorização | `Authorization: Bearer <access_token>` injetado em **toda** requisição | `:134` |
| Endpoints chamados | `GET /files?spaces=drive&pageSize=10&…&q=<nome da pasta>` `:150`; `POST /files?fields=id,name` (cria pasta) `:152`; `GET /files?…pageSize=100&orderBy=createdTime desc&pageToken` `:168`; `POST {UPLOAD}/files?uploadType=multipart&fields=id,name,size,createdTime,appProperties` `:194`; `GET {API}/files/<id>?alt=media` `:211`; `DELETE /files/<id>` (compensação) `:200` | — |
| Fluxo do token | `requestAccessToken({prompt:'select_account'})`, watchdog 120 s | `:109,94` |
| Resposta lida do GIS | `r.access_token`, `r.expires_in`; `tokenExpires=now+max(60,(expires_in\|\|3600)-60)*1000` | `:101-103` |
| Persistência do token | **nenhuma** — variável de módulo; **sem refresh token**. `isConnected()` falso ou HTTP 401 → `AUTH` pedindo reconexão manual | `:14,29-32,130,139` |
| Config persistida | `localStorage['scipione.google.oauth']`, **JSON em claro** (`clientId`,`projectId`,`type`,`origins`) | `:11,18,45` |
| Pasta destino | constante `SCIPIONE CRED - Backups`; usa `files[0]` da busca por nome (não determinístico se houver homônimas) | `:9,147-158` |
| Identificação | `appProperties:{app:'SCIPIONE CRED',sha256,encrypted:'0'\|'1'}` | `:154,187` |
| multipart | montado à mão: parte 1 `application/json` (metadata), parte 2 `application/zip`, boundary `scipione-<24 hex>` de `crypto.getRandomValues(12)` | `:184,188-196` |
| Timeouts | request default 90 s; upload 180 s; download 180 s; lib GIS 20 s; popup 120 s | `:129,196,211,68,94` |
| CSP | `accounts.google.com` em `script-src`/`frame-src`/`connect-src`; `www.googleapis.com` e `oauth2.googleapis.com` em `connect-src` | `index.html:3` |

Divergências e limites: `oauth2.googleapis.com` está na allowlist mas **nenhum código chama o host** (D11, `docs/auditoria/6-integracoes-infra.md:354`). Não há nenhuma checagem de bytes antes do multipart (`:182` só exige `Uint8Array` não vazio) nem consulta de espaço (`drive.about` ausente). Teto de upload multipart da Drive, API ativada, origens autorizadas, lista de testadores e política de expiração de token para app em modo *Testing*: **NÃO CONFIRMADO** (`docs/auditoria/6-integracoes-infra.md:613-623`).

---

## 4. Contrato interno por módulo

Notação: `→` = valor resolvido/retornado. `op` = tupla `['put'|'delete', store, valor|chave]` consumida por `db.batch`. "Efeitos" cobre IndexedDB, rede, timers, DOM e console.

### 4.1 Camada de acesso a dados

#### `src/db/idb.js` — 7 exports

| Export (`idb.js:linha`) | Assinatura | → | Efeitos | Erros |
|---|---|---|---|---|
| `DB_VERSION` (`:10`) | `number` = `MIGRATIONS.length` | `1` **[verificado]** | — | — |
| `openDB` (`:12`) | `()` | `Promise<IDBDatabase>` | abre `indexedDB('scipione-cred',DB_VERSION)`; roda `MIGRATIONS[v]` em `onupgradeneeded`; `onversionchange` fecha e invalida o cache; promessa memoizada | `r.error`; `Error('Feche as outras abas do SCIPIONE CRED e tente de novo.')` (`:16`) |
| `get` (`:22`) | `(s,k)` | `Promise<value\|undefined>` | 1 tx `readonly` | `t.error` \| `Error('Falha na operação do banco.')` (`:21`) |
| `getAll` (`:23`) | `(s)` | `Promise<any[]>` (ordem = chave do store) | 1 tx `readonly` | idem |
| `put` (`:24`) | `(s,v)` | `Promise<IDBValidKey>` | 1 tx `readwrite` `durability:'strict'`; **não** dispara `data-changed` | idem |
| `del` (`:25`) | `(s,k)` | `Promise<undefined>` | 1 tx `readwrite` strict; **não** dispara `data-changed` | idem |
| `batch` (`:27`) | `async (ops)` | `Promise<undefined>`; `ops=[]` → resolve **sem transação e sem evento** **[verificado]** | 1 tx multi-store strict sobre `new Set(ops.map(o=>o[1]))`; `dispatchEvent(new Event('data-changed'))` no `oncomplete` | `t.error` \| `Error('Falha na gravação.')`; `t.abort()` se `t.objectStore(s)[op]` lançar |

Stores (`idb.js:2-9`): `meta`(`key`), `settings`(`key`), `clients`(`id`; idx `createdAt`), `debts`(`id`; idx `clientId`,`createdAt`), `documents`(`id`; idx `clientId`), `blobs`(`id`), `history`(`id`; idx `clientId`,`at`). O índice `at` está **morto**: os registros gravam `createdAt` (`records.js:10`), nunca `at` (`docs/auditoria/2-dados-negocio.md:57`).

#### `src/services/records.js` — 7 exports

| Export (`records.js:linha`) | Assinatura | → | Efeitos | Erros |
|---|---|---|---|---|
| `uid` (`:3`) | `()` | `string` UUIDv4 | CSPRNG | `TypeError` sem `crypto.randomUUID` (fora de contexto seguro) |
| `list` (`:5`) | `async (s)` | `Promise<object[]>` decifrados, sempre com `id`,`createdAt`,`clientId` injetados | 1 tx `readonly` da loja inteira | `Error('Sessão bloqueada.')` **depois** da leitura (`getKey` dentro de `dec`) |
| `one` (`:6`) | `async (s,id)` | `Promise<object\|undefined>` — resolve **`undefined`**, não `null`, se a chave falta (`r&&dec(r)`) | 1 tx `readonly` | idem |
| `enc` (`:7`) | `async (s,o)` | `Promise<['put',s,{id,createdAt,clientId?,data:Uint8Array}]>` (não grava) | nenhum (só cifra) | `Error('Sessão bloqueada.')` **[verificado]**; `DataError` no `batch` se `o.id` faltar |
| `blobOp` (`:8`) | `async (id,bytes)` | `Promise<['put','blobs',{id,data:Uint8Array}]>` | nenhum | `Error('Sessão bloqueada.')` |
| `blobBytes` (`:9`) | `async (id)` | `Promise<Uint8Array>` | 1 tx `readonly` em `blobs` | `TypeError: … undefined (reading 'data')` se o blob não existir; `'Sessão bloqueada.'` se travado **[verificado]** |
| `hist` (`:10`) | `(clientId,type,detail='')` | `Promise<op 'put' em 'history'>` — **exige `await`** **[verificado]** | carimba `Date.now()` na montagem, não na gravação | `Error('Sessão bloqueada.')` (rejeição) |

Envelope híbrido (`records.js:4-7`): `id`/`createdAt`/`clientId` em claro (são keyPath e índices); todo o resto em `data` cifrado. `enc` usa spread com exclusão → `clientId` falsy é **descartado**; `dec` injeta `clientId` sempre, inclusive em `clients`, onde passa a valer `undefined`.

### 4.2 Camada de domínio puro — `src/domain/*`

#### `src/domain/validators.js` — 4 exports

| Export (`validators.js:linha`) | Assinatura | → | Observações |
|---|---|---|---|
| `digits` (`:1`) | `(s)` | `string` sem não-dígitos | `null`/`undefined` → `''`; nunca lança |
| `validCPF` (`:2`) | `(v)` | `boolean` | exige 11 dígitos, DV e rejeita repetição `/^(\d)\1+$/` |
| `validCNPJ` (`:4`) | `(v)` | `boolean` | 14 dígitos + DV ponderado |
| `mask` (`:6`) | `{cpf,cnpj,phone}`, cada um `(v)=>string` | máscara progressiva | `mask.phone('119')` → `'(11) 9'`; nunca lança |

#### `src/domain/address.js` — 4 exports

| Export (`address.js:linha`) | Assinatura | → | Observações |
|---|---|---|---|
| `onlyDigits` (`:2`) | = `digits` (mesma referência de função, é alias) | `string` | — |
| `maskCep` (`:3`) | `(v)` | `'#####-###'` truncado a 8 dígitos | `'0100100'` → `'01001-00'` |
| `validCep` (`:4`) | `(v)` | `boolean`: 8 dígitos **e** ≠ `'00000000'` | nunca lança |
| `composeAddress` (`:6`) | `(a={})` aceita `street,number,complement,district,city,state` | `string` com `', '`/`' - '`; `state` maiúsculo; `{}` → `''` | nunca lança |

#### `src/domain/due.js` — 3 exports

| Export (`due.js:linha`) | Assinatura | → | Observações |
|---|---|---|---|
| `todayISO` (`:3`) | `()` | `'AAAA-MM-DD'` do dia **local** | compensa `getTimezoneOffset` |
| `daysUntil` (`:4`) | `(due,today=todayISO())` | `number` (negativo = vencida), via `Date.UTC` | `NaN` se `due` não for ISO |
| `status` (`:5`) | `(due,win,today)` — **`win` sem default** | `'overdue'`\|`'soon'`\|`'ok'` | `win` omitido ⇒ `n<=undefined` é `false` e datas futuras viram `'ok'` em silêncio |

#### `src/domain/money.js` — 8 exports

| Export (`money.js:linha`) | Assinatura | → | Erros / observações |
|---|---|---|---|
| `MAXR` (`:2`) | `100000` (= 1000%) | — | teto de taxa aceito por `debts.validate` |
| `num` (`:3`) | `(c)` centavos → `string` | `'1.234.567,89'`; `num(5)`→`'0,05'` **[verificado]** | `NaN` para não-numérico |
| `brl` (`:4`) | `(c)` | `'R$ '+num(c)` | — |
| `cents` (`:5`) | `(s)` | `number` inteiro de centavos; `'R$ 5.000,00'`→`500000` **[verificado]** | nunca lança |
| `rate` (`:6`) | `(b)` centésimos de % | `'15%'`, `'12,5%'`, `'12,05%'` **[verificado]** | — |
| `parseRate` (`:7`) | `(s)` | `number\|null`; aceita vírgula, ponto e `%`; `'1,234'`→`null` **[verificado]** | nunca lança |
| `interest` (`:9`) | `(p,b)` inteiros | `number` (juros do mês, meio para cima, via BigInt) | **`RangeError` se `p` ou `b` não for inteiro** (`interest(333.5,1000)` **[verificado]**); aceita string numérica |
| `planRate` (`:11`) | `(ds,mode,v)`, `mode∈'add'\|'sub'\|'set'` | `[{d,nr,ok,ni}]` — `d` é a **mesma referência** do objeto de entrada | `mode` desconhecido cai em `set` em silêncio |

### 4.3 Camada de segurança

#### `src/security/crypto.js` — 9 exports

| Export (`crypto.js:linha`) | Assinatura | → | Efeitos | Erros |
|---|---|---|---|---|
| `ITER` (`:4`) | `600000` | — | — | — |
| `rnd` (`:5`) | `(n)` | `Uint8Array(n)` | CSPRNG | — |
| `createVault` (`:7`) | `async (pw)` | `{meta:{salt:Uint8Array(16),iv:Uint8Array(12),wrapped:Uint8Array,iter,kdf:'PBKDF2-SHA256',cipher:'AES-GCM-256',v:1}}` | PBKDF2 600k (CPU deliberada) | `SyntaxError`/`OperationError` |
| `openVault` (`:13`) | `async (pw,m)` | `Promise<CryptoKey>` **não extraível** | nenhum | rejeita `OperationError` na senha errada (tag GCM) |
| `sealBytes` (`:17`) | `async (key,bytes)` | `Uint8Array` = `iv(12)‖ct‖tag(16)` | IV novo por chamada | `OperationError` |
| `openBytes` (`:18`) | `async (key,b)` | `Uint8Array` | nenhum | `OperationError` se adulterado |
| `sealJSON` (`:19`) | `async (key,o)` | `Uint8Array` (JSON→UTF-8→cifra) | nenhum | `TypeError` em objeto circular |
| `openJSON` (`:20`) | `async (key,b)` | qualquer JSON | nenhum | `OperationError` + `SyntaxError` |
| `deriveAesKey` (`:22`) | `async (pw,salt,iterations)` | `Promise<CryptoKey>` AES-GCM | nenhum | `OperationError` |

#### `src/security/auth.js` — 10 exports

| Export (`auth.js:linha`) | Assinatura | → | Efeitos | Erros |
|---|---|---|---|---|
| `isUnlocked` (`:13`) | `()` | `boolean` | — | — |
| `getKey` (`:14`) | `()` | `CryptoKey` | — | `Error('Sessão bloqueada.')` |
| `getIdle` (`:15`) | `()` | `number` (minutos, default 5) | — | — |
| `onLock` (`:16`) | `(f)` | **o próprio `Set` de assinantes** (não há unsubscribe) | cresce para sempre | — |
| `hasVault` (`:17`) | `async ()` | `boolean` | 1 tx `readonly` em `meta` | erros de `get` |
| `setup` (`:18`) | `async (pw)` | `Promise<undefined>` (devolve `unlock(pw)`) | `db.put` em `meta`+`settings`; delega a `unlock` | `Error('Já existe uma senha cadastrada.')` |
| `unlock` (`:24`) | `async (pw)` | `Promise<undefined>` | lê `meta`; grava `guard`; escreve `sessionStorage['sc.sid']`/`['sc.last']`; **registra listeners globais** (`pointerdown`,`keydown`,`touchstart`,`scroll`,`visibilitychange`); timer de inatividade; grava `meta.session` | `'Nenhuma senha cadastrada.'`, `'Aguarde N s para tentar novamente.'`, `'Senha incorreta.'` |
| `restoreSession` (`:38`) | `async ()` | `Promise<boolean>` (não lança nos casos de invalidez) | pode `db.del('meta','session')`; rebind | erros de leitura engolidos (`:41`) |
| `setIdle` (`:49`) | `async (m)` | `Promise<undefined>` | `db.put('settings',{key:'idleMinutes'})` — **sem `data-changed`**; reseta timer | erros de `put` |
| `lock` (`:65`) | `(reason='manual')` — **síncrono** | `undefined` | apaga chave, listeners, timers e `sessionStorage`; `db.del` fire-and-forget; chama cada `onLock(reason)` | nenhum |

Backoff de tentativas: a partir de 5 falhas, `min(5000·2^(fails-5), 300000)` ms (`auth.js:29`). `reason` efetivamente produzidos: `'idle'` (`:64`), `'manual'` e `'logout'` (`src/ui/shell.js:36`, `src/ui/settings.js:54`).

### 4.4 Camada de serviços

#### `src/services/clients.js` — 14 exports

| Export (`clients.js:linha`) | Assinatura | → | Efeitos | Erros |
|---|---|---|---|---|
| `CATS` (`:4`) | `string[]` fixo, 4 itens | — | — | — |
| `listClients` (`:6`) | `()` | `Promise<client[]>` **sem ordenação** | 1 tx `readonly` | ver `records.list` |
| `getClient` (`:6`) | `(id)` | `Promise<client\|undefined>` | 1 tx `readonly` | ver `records.one` |
| `validate` (`:7`) | `(d,old,all)` — **os 3 obrigatórios** | `{campo:mensagem}`; nunca lança | nenhum | `TypeError: … undefined (reading 'find')` sem `all` **[verificado]** |
| `saveClient` (`:16`) | `async (d,old,photo)`, `photo` = `undefined\|{file}\|{remove:true}` | `Promise<string>` id | lê todos os clientes; `toStored(file,{force:true,maxSide:512})`; 1 `batch` `clients`+`blobs`+`history`; `data-changed` | `Error('Corrija os campos destacados.')` com `.errs`; erros de `toStored`; `'Sessão bloqueada.'` |
| `changePhoto` (`:28`) | `(c,p)` | repassa `saveClient(c,c,p)` | idem | idem |
| `counts` (`:30`) | `async (id)` | `Promise<{docs:number,debts:number}>` | 2 tx `readonly` (loads inteiras + filter) | ver `records.list` |
| `deleteClient` (`:31`) | `async (id)` | `Promise<undefined>`; **no-op silencioso se o cliente não existe** (`:32`) | 3 leituras + 1 `batch` em `documents`,`blobs`,`debts`,`history`,`clients` | erros de leitura/cifra/batch |
| `listDocs` (`:36`) | `async (id)` | `Promise<doc[]>` por `createdAt` desc | 1 tx `readonly` (ignora o índice `clientId`) | ver `records.list` |
| `listHistory` (`:37`) | `async (id)` | `Promise<history[]>` por `createdAt` desc | 1 tx `readonly` | idem |
| `addDoc` (`:38`) | `async (clientId,file:File,category,name)` | `Promise<undefined>` | `toStored` com defaults; 1 `batch` `blobs`+`documents`+`history` | `Error('Este arquivo já está anexado a este cliente.')` (`:40`); erros de `toStored` |
| `removeDoc` (`:43`) | `async (d)` | `Promise<undefined>` | 1 `batch` `blobs`+`documents`+`history` | erros de batch |
| `docBytes` (`:44`) | `(d)` | `Promise<Uint8Array>` | 1 tx `readonly` | `TypeError` se `d.blobId` órfão |
| `blobBytes` (`:3`) | re-export de `records` | idem §4.1 | — | — |

`category` **não** é validado contra `CATS` no service — a restrição vive só no `<select>` da UI (`src/ui/clients.js:142`). `validate` não olha `birth`, `gender`, `rg`, `cep` nem campo de endereço.

#### `src/services/debts.js` — 6 exports

| Export (`debts.js:linha`) | Assinatura | → | Efeitos | Erros |
|---|---|---|---|---|
| `listDebts` (`:6`) | `async (cid)` — `cid` opcional por falsy | `Promise<debt[]>` com `interest` derivado (`:5`), ordem `date` desc, empate `createdAt` desc | 1 tx `readonly` | `TypeError: … undefined (reading 'localeCompare')` se faltar `date` — e o estouro **depende da posição no `sort`**, logo é não determinístico (`docs/auditoria/2-dados-negocio.md:216`) |
| `validate` (`:7`) | `(d)` | `{campo:mensagem}`; nunca lança | nenhum | — |
| `saveDebt` (`:14`) | `async (clientId,d,old)` — **exige cliente existente** | `Promise<string>` id (`:28`) | 1 `batch` `debts`+`history` (`:21-28`) | `.errs` (`:15`); `Error('Cliente não encontrado. Atualize a tela e tente de novo.')` com `code:'NO_CLIENT'` (`:20`), lançada **depois** de `validate()` — nunca no lugar de `.errs` |
| `deleteDebt` (`:29`) | `async (d)` | `Promise<undefined>` | 1 `batch` `debts`+`history` | erros de batch. **Não** confere existência do cliente: em dívida órfã ainda grava `history` |
| `findByRate` (`:30`) | `async (r)` — `r` em centésimos de % | `Promise<(debt & {clientName})[]>`, ordem `clientName` `pt-BR` | 2 tx `readonly` | ver `records.list` |
| `applyBulk` (`:33`) | `async (plan)` — saída de `M.planRate` | `Promise<undefined>` | 1 `batch` multi-ops `debts`+`history` | `Error('Há taxas inválidas na prévia.')` (`:34`); `Error('Os dados mudaram desde a busca. Busque novamente.')` (`:36`) — optimistic check por `rate`. **Não** confere existência do cliente por dívida |

`rec()` (`:4`) é whitelist explícita: campo extra enviado a `saveDebt` é **descartado em silêncio**; `interest` nunca é persistido (derivação única em `:5-6`). `clientId` **não** é editável pela whitelist — não existe caminho de API para reatribuir uma dívida de cliente.

**Contrato de `saveDebt(clientId,d,old)` (mudou nesta branch).** Ordem: `validate(d)` primeiro, e erro de campo sai como `Error('Corrija os campos destacados.')` com `.errs` (`src/services/debts.js:15`); **depois** vem a integridade referencial — `if(!clientId||!(await getClient(clientId)))` lança `Error('Cliente não encontrado. Atualize a tela e tente de novo.')` com `code:'NO_CLIENT'` (`src/services/debts.js:20`). A ordem é intencional: a UI pinta `.errs` por campo (`src/ui/debts.js:28`) e o `NO_CLIENT` vai para o parágrafo de erro geral. Consequência para quem chama: `saveDebt` **recusa** `clientId` ausente ou inexistente, então a tela precisa de cliente vivo na lista — `src/ui/debtspage.js:16` resolve `undefined` para dívida órfã e `src/ui/debts.js:25-27` repassa `c?.id`, produzindo hoje a mensagem legível em vez de `TypeError`. `deleteDebt` (`:29`) e `applyBulk` (`:33`) continuam **sem** essa checagem.

#### `src/services/dashboard.js`, `settings.js`, `search.js` — 1+2+1 exports

| Export (`arquivo:linha`) | Assinatura | → | Efeitos | Erros |
|---|---|---|---|---|
| `stats` (`dashboard.js:3`) | `async ()` | `{principal,interest,clients,debts,overdue,soon,latest:client[≤5],recent:history[≤8] & {client}}` | 4 leituras concorrentes (`Promise.all`, `:4`); ordena `hs` **in place** | `TypeError` via `listDebts`/`status` se faltar `date`/`due` |
| `getDueWindow` (`settings.js:2`) | `async ()` | `Promise<any>` — `?? 7` só cobre `null`/`undefined`; **sem validação de tipo nem faixa** | 1 tx `readonly` | erros de `get` |
| `setDueWindow` (`settings.js:3`) | `(n)` | `Promise<IDBValidKey>` | 1 `db.put` em `settings` — **não dispara `data-changed`** | erros de `put` |
| `match` (`search.js:3`) | `(c,q)` | `boolean` (puro; sem acento/caixa; busca numérica só com `^[\d\s.\-\/()+]+$`) | nenhum | — |

#### `src/services/apicpf.js` — 1 export

- `lookupCpf(value,{signal}={})` — `apicpf.js:6` → `Promise<{name:string, gender:''|'M'|'F'|'I', birth:''|'YYYY-MM-DD'}>`. Efeitos: **`POST /api/cpf` com `{"cpf":…}` no corpo** (`:28-33`, `cache:'no-store'`), cache `Map` TTL 30 min (`:3,12,43`), single-flight por CPF em `PENDING` (`:13,62`), timer 9000 ms (`:20`), listener `abort` no signal do chamador (`:19`). Erros (`code`): `INVALID` `:8` (sem rede) e `:46`, `OFFLINE` `:9`, `TIMEOUT` `:47,50`, `UNAVAILABLE` `:47,54`; `AbortError` puro do chamador é re-lançado (`:49-51`). O `finally` limpa timer, listener e `PENDING` (`:55-59`). **403/413/415/429 não têm tratamento próprio**: caem no `fail('UNAVAILABLE')` de `:47`, que é por que a UI não mudou com as novas respostas da função.

#### `src/services/viacep.js` — 1 export

- `lookupCep(cep,{signal,timeout=8000}={})` — `viacep.js:6` → `Promise<{cep:string,street,district,city,state}>`. Efeitos e erros: ver §3.1.

#### `src/services/google-drive.js` — 17 exports

| Export (`google-drive.js:linha`) | Assinatura | → | Efeitos | Erros (`code`) |
|---|---|---|---|---|
| `defaultConfig` (`:21`) | `()` | `{clientId,projectId,type,origins}` (cópia do config do repo) | nenhum | — |
| `getConfig` (`:22`) | `()` | override do `localStorage` **ou** `defaultConfig()` | lê `localStorage` | nunca lança (JSON ruim → default) |
| `configState` (`:23`) | `()` | `getConfig()+{origins,origin,originListed,configured}` | lê `location.origin` | `TypeError` fora de browser |
| `status` (`:28`) | `()` | `configState()+{connected}` | nenhum | idem |
| `isConnected` (`:29`) | `()` | `boolean`; **apaga** token vencido como efeito | muta estado do módulo | — |
| `parseClientJson` (`:33`) | `(text)` | `{clientId,projectId,type:'web',origins}` | nenhum | `CONFIG` (`:34,37`), `INSTALLED` (`:40`) |
| `importConfig` (`:43`) | `(text)` — **síncrono** | config persistido | escreve `localStorage`; `resetAuth()` | `CONFIG` (`:34-45`) |
| `clearConfig` (`:48`) | `()` | `undefined` | remove `localStorage`; `resetAuth()` | nenhum (engole) |
| `isReady` (`:50`) | `()` | `boolean` (`window.google?.accounts?.oauth2`) | lê global | — |
| `preload` (`:73`) | `()` | `Promise<void>` — **nunca rejeita** | injeta `<script>` do GIS se configurado | — |
| `connect` (`:84`) | `async ()` | `Promise<true>` | popup GIS; grava token/expiração; single-flight `pending`; timer 120 s | `CONFIG` `:86`, `OFFLINE` `:89`, `AUTH` `:63,105,107,110` |
| `disconnect` (`:114`) | `()` | `undefined` | `revoke` best-effort; `resetAuth()` | nenhum |
| `listBackups` (`:160`) | `async ()` | `Promise<file[]>` filtrado por `appProperties.app` | 1..N `GET /files` paginados | `AUTH`, `NETWORK`, `DRIVE` |
| `sha256` (`:175`) | `async (bytes)` | `Promise<string>` hex minúsculo (64) | `crypto.subtle` | `SECURE` (`:176`) |
| `uploadBackup` (`:181`) | `async (bytes,{name,encrypted=false}={})` | `Promise<file & {sha256}>` | `POST` multipart 180 s; `DELETE` compensatório se `size` divergir | `INTEGRITY` `:182,201`, `SECURE` `:177`, `DRIVE` `:198`, `AUTH`/`NETWORK` |
| `downloadBackup` (`:206`) | `async (file)` | `Promise<Uint8Array>` | `GET ?alt=media` 180 s | `DRIVE` `:207`, `INTEGRITY` `:210,214,216`, `AUTH`/`NETWORK` |
| `formatSize` (`:220`) | `(value)` | `string` (`''` se não-finito ou negativo; `B`/`KB`/`MB` com vírgula) | nenhum | — |

### 4.5 Exportação, backup e arquivos

#### `src/export/backup-format.js` — 6 exports

| Export (`backup-format.js:linha`) | Assinatura | → | Efeitos | Erros (`code`) |
|---|---|---|---|---|
| `FORMAT` (`:5`) | `1` | — | — | — |
| `ITER` (`:5`) | `600000` | — | — | — |
| `LISTS` (`:5`) | `['clients','debts','documents','history']` | — | — | — |
| `buildBackup` (`:10`) | `async (d,password)` | `Promise<Uint8Array>` (ZIP) | CPU: ZIP síncrono + SHA-256 por arquivo + PBKDF2 se houver senha | exceções do fflate/WebCrypto |
| `validate` (`:20`) | `(d)` | `string[]` de problemas (nunca lança; curto-circuita se uma lista não for array) | nenhum | — |
| `readBackup` (`:28`) | `async (bytes,password)` | `Promise<{manifest,data}>` (recursa no ZIP interno quando cifrado) | unzip + PBKDF2 + SHA-256 | `INVALID` `:29-43`, `NEEDS_PASSWORD` `:34`, `BAD_PASSWORD` `:35` |

#### `src/export/backup.js`, `lib.js`, `xlsx.js`, `reports.js`, `src/files/process.js` — 3+2+1+5+1 exports

| Export (`arquivo:linha`) | Assinatura | → | Efeitos | Erros |
|---|---|---|---|---|
| `createBackup` (`backup.js:4`) | `async (password)` | `Promise<Uint8Array>` | lê as 4 listas + `settings.dueWindow` + **todos** os blobs | `Error('Um arquivo anexado está ausente ou ilegível; …')` (`:7`); `'Sessão bloqueada.'` |
| `restore` (`:12`) | `async (d,mode)` | `Promise<{clients,debts,documents,history}:n>` | prepara **todas** as ops cifradas e aplica em 1 `batch` (`:29`) → `data-changed` | erros de `enc`/batch; `'Sessão bloqueada.'` |
| `readBackup` (`:3`) | re-export de `backup-format` | idem acima | — | — |
| `fflate` (`lib.js:4`) | `()` | `Promise<typeof globalThis.fflate>` | injeta `vendor/fflate.min.js` **uma** vez | `Error('Biblioteca inválida: …')` / `Error('Não foi possível carregar …')` |
| `save` (`:5`) | `(blob,name)` | `undefined` | object URL + `<a download>` + click + remove; `revokeObjectURL` em 60 s | nenhum (silencioso) |
| `buildXlsx` (`xlsx.js:9`) | `(F,sheets:[{name,rows,widths}])` | `Uint8Array` (ZIP .xlsx) | nenhum | col além de Z depende de `String.fromCharCode(65+i)` — **NÃO CONFIRMADO** em runtime |
| `inPeriod` (`reports.js:4`) | `(iso,p)` | `boolean` (`p.mode==='day'` compara o dia; senão `AAAA-MM`) | nenhum | `TypeError` se `iso` não for string |
| `isoOf` (`:5`) | `(ts:number)` | `'AAAA-MM-DD'` local | nenhum | **`RangeError: Invalid time value`** para `ts` não-numérico/NaN (`new Date(NaN).toISOString()`); `null` é coagido a `0` e devolve a época, deslocada pelo fuso **[medido em Node 22]** |
| `label` (`:6`) | `(p)` | `'Dia 06/11/2026'` \| `'Março/2026'` | nenhum | `'undefined/2026'` se `p.value` malformado |
| `load` (`:8`) | `async (p)` | `{debts:[&{client}],moves:[&{client}],principal,interest}` | 3 tx `readonly` | `TypeError` se faltar `date`/`due` |
| `xlsxBytes` (`:14`) | `async (d)` (saída de `load`) | `Promise<Uint8Array>` | CPU/ZIP | erros do fflate |
| `toStored` (`process.js:5`) | `async (file,{force=false,maxSide=1600,q=.8}={})` | `{bytes:Uint8Array,type,size,originalSize,hash:64hex,converted:boolean}` | `createImageBitmap`, `<canvas>`+`toBlob`, SHA-256 | `Error('Arquivo acima de 15 MB.')` (`:6`); `'Selecione uma imagem JPG, PNG ou WebP.'` (`:9`, só com `force`); `'Não foi possível ler esta imagem.'` (`:15`, só com `force`) |

Regra do reencode (`process.js:14`): o original só é trocado se a conversão **deu certo E** ficou menor — **ou** se `force:true` (fotos de perfil, `maxSide:512`, `clients.js:20`). PDF e demais tipos são gravados como vieram.

### 4.6 Camada de apresentação e PWA

#### `src/core/live.js` — 2 exports

- `watch(f)` — `live.js:3` → `undefined`. Instala o callback global e **substitui** o anterior (só existe um observador). Efeito colateral de **import**: registra `addEventListener('data-changed')` em `window` no carregamento do módulo (`:2`); a exceção do callback é engolida e logada via `console.warn` (`:2`).
- `unwatch()` — `:3` → `undefined`. Zera o callback; o listener global permanece registrado para sempre.

#### `src/ui/kit.js` — 7 exports

| Export (`kit.js:linha`) | Assinatura | → | Efeitos |
|---|---|---|---|
| `initials` (`:3`) | `(n)` | `string` ≤2 caracteres; `'?'` se vazio | nenhum |
| `when` (`:4`) | `(t)` | `string` pt-BR `dd/mm/aaaa hh:mm` | nenhum (`'Invalid Date'` se `t` inválido) |
| `day` (`:5`) | `(t)` | `string` pt-BR só data | nenhum |
| `longDay` (`:6`) | `(d:Date)` | `string` `quarta, 5 de novembro` | nenhum; `TypeError` se `d` não for `Date` |
| `plural` (`:7`) | `(n,s,p)` | `string` | nenhum |
| `filePicker` (`:8`) | `(h,input,text='Escolher arquivo',glyph='upload')` | `<label class="file-pick">` | **muta** `input` (classe), anexa listener `change` sem teardown, chama `sync()` uma vez; depende de `input.id` para o `for` do label |
| `pager` (`:18`) | `(h,{page,pages,total,from,to,singular='registro',plural='registros',label='Paginação',onPage})` | `<nav class="pager">` **ou** `<p role="status">` quando `total===0 \|\| pages<=1` | nenhum; `TypeError` se `onPage` faltar e um botão for clicado |

#### `src/ui/avatar.js` (2), `icons.js` (1), `shell.js` (1)

- `clearClientPhotos()` — `avatar.js:7` → `undefined`. Incrementa `epoch`, revoga **todas** as object URLs e limpa os dois `Map` de módulo; chamado automaticamente via `A.onLock` no import (`:12`).
- `clientAvatar(h,c)` — `:13` → `<span class="avatar">` com as iniciais, preenchido **assincronamente** pela foto. Efeitos: 1 tx `readonly` por `photoId` novo, `URL.createObjectURL`, dedupe por `Map` compartilhado entre instâncias, callback `then` tardio. Erros: **nenhum visível** — falha de decifração cai em `.catch(()=>null)` e mantém as iniciais (`:19`).
- `icon(n,s=20)` — `icons.js:43` → `SVGSVGElement` (`class="i"`, stroke `currentColor`). Efeito: nenhum. Erro: **nunca lança** — nome desconhecido cai silenciosamente no glifo `info` (`:45`).
- `initShell({ctx,home,clients,debts,reports,backup,settings,lock})` — `shell.js:10` → `undefined`. Exige `#nav` e `#app` no DOM (`:11`); substitui a navegação; instala listeners `click`/`submit` em `document`, `data-changed` em `window` (`:25-27`) e **MutationObserver permanente** em `#app` (`:63`, com `requestAnimationFrame`); reescreve todo botão sem `data-i` inserindo ícone por regex no texto e classe `danger` em `Excluir`/`Remover` (`:5-9,57-61`). Erros: `TypeError` se faltar uma das 8 chaves do objeto ou um dos dois IDs.

#### `src/pwa.js` — 9 exports

| Export (`pwa.js:linha`) | Assinatura | → | Efeitos | Erros |
|---|---|---|---|---|
| `registerSW` (`:3`) | `async ()` | `Promise<undefined>` | registra `sw.js` | engole e loga `console.warn('SW',e)` |
| `requestPersist` (`:4`) | `async ()` | `Promise<boolean\|undefined>` | `StorageManager.persist()` | retorna `false` em exceção |
| `storageInfo` (`:5`) | `async ()` | `{persisted:boolean,usage:number\|undefined,quota:number\|undefined}` | lê `StorageManager.estimate` | engole para `false`/`null` |
| `offlineReady` (`:6`) | `async ()` | `boolean` | lê registro do SW | — |
| `canInstall` (`:7`) | `()` | `boolean` (`!!deferred`) | nenhum | — |
| `onInstallable` (`:8`) | `(f)` | função de unsubscribe | **limpa `cbs.length=0` antes de registrar** ⇒ só o último inscritor sobrevive | — |
| `install` (`:9`) | `async ()` | `Promise<undefined>`; **não** espera `deferred.userChoice` | abre o prompt nativo e zera `deferred` | `TypeError: … undefined (reading 'prompt')` se `canInstall()===false` |
| `isStandalone` (`:10`) | `()` | `boolean` (`matchMedia` ou `navigator.standalone`) | consulta mídia | — |
| `isIOS` (`:11`) | `()` | `boolean` | lê `navigator` | — |

---

## 5. Tipos e envelopes de dados

Regra geral (`src/services/records.js:1,4-7`): em `clients`, `debts`, `documents` e `history` o registro cru no IndexedDB tem **apenas** `{id, createdAt, clientId?, data:Uint8Array}` em claro; `data` é `iv(12)‖AES-GCM(JSON)‖tag(16)` (`src/security/crypto.js:17`). `meta` e `settings` **não** passam por `enc` — são gravados crus por `db.put` (`src/security/auth.js:21,30,55`; `src/services/settings.js:3`).

- **client** (store `clients`). Claro: `id` (UUIDv4), `createdAt` (epoch-ms). Cifrado (`clients.js:23` + `src/ui/clients.js:46`): `type:'PF'|'PJ'`, `name`, `doc` (string **com máscara**), `rg`, `phone`, `mobile`, `email`, `birth` (`'AAAA-MM-DD'` ou `''`), `gender` (`''|'M'|'F'|'I'`), `cep`, `street`, `number`, `complement`, `district`, `city`, `state` (2 letras), `address` (forma composta), `photoId:string|null` (por isso **não consultável**), `photoType:string|null`, `updatedAt`. Leitura ainda traz `clientId: undefined`. `{id:"3f1c…0001",createdAt:1762300000000,type:"PF",name:"Maria Exemplo da Silva",doc:"529.982.247-25",birth:"1990-01-01",gender:"F",rg:"12.345.678-9",phone:"(11) 3333-4444",mobile:"(11) 98765-4321",email:"maria.exemplo@exemplo.test",cep:"01001-000",street:"Praça da Sé",number:"100",complement:"Apto 12",district:"Sé",city:"São Paulo",state:"SP",address:"Praça da Sé, 100, Apto 12 - Sé, São Paulo/SP",photoId:null,photoType:null,updatedAt:1762300000000}`
- **debt** (store `debts`). Claro: `id`, `clientId`, `createdAt`. Cifrado, pela whitelist `rec()` (`debts.js:4`): `description`, `principal` (**int centavos**, `>0` e `≤1e13`), `rate` (**int centésimos de % a.m.**, `>0` e `≤100000`), `date`/`due` (`'AAAA-MM-DD'`, `due≥date`), `notes` (`''` se ausente), `updatedAt`. `interest` **nunca é gravado** — derivado em toda leitura (`debts.js:5-6`); `clientName` é acrescentado por `findByRate`/`debtspage`, não pelo registro. `{id:"7ab2…0002",clientId:"3f1c…0001",createdAt:1762300000000,description:"Empréstimo combinado",principal:500000,rate:1500,date:"2026-11-06",due:"2026-12-06",notes:"",updatedAt:1762300000000,interest:75000}`
- **document** (store `documents`). Claro: `id`, `clientId`, `createdAt`. Cifrado (`clients.js:42`): `name` (apelido), `orig` (nome do arquivo), `category` (idealmente ∈ `CATS`, **não validado**), `type` (MIME final), `size`, `originalSize`, `converted:boolean`, `hash` (SHA-256 hex dos bytes gravados), `blobId`. `{id:"c9d4…0003",clientId:"3f1c…0001",createdAt:1762300000000,name:"RG de Maria",orig:"IMG_0001.png",category:"Identificação",type:"image/webp",size:48213,originalSize:1200443,converted:true,hash:"9f2c…64hex…",blobId:"b1e2…0004"}`
- **blob** (store `blobs`). Claro só `id`; `data` é o arquivo **inteiro cifrado** (`records.js:8`). Sobrecarga de ~28 bytes por arquivo (12 de IV + 16 de tag GCM). `{id:"b1e2…0004",data:Uint8Array(12+ct+16)}` → `blobBytes()` devolve `Uint8Array` dos bytes originais
- **history** (store `history`). Claro: `id`, `clientId`, `createdAt`. Cifrado: `type`, `detail` (`records.js:10`). Os 12 valores de `type` do código: `Cadastro de cliente`, `Alteração de dados`, `Fotografia incluída`, `Fotografia alterada`, `Fotografia removida`, `Documento incluído`, `Documento removido`, `Dívida cadastrada`, `Dívida alterada`, `Juros alterados`, `Dívida excluída`, `Juros alterados em lote` (`clients.js:24-26,42,43`; `debts.js:22,25,26,29,38`). Não há vínculo de auditoria com dívida ou documento específico — só `clientId` + texto. `{id:"e5f6…0005",clientId:"3f1c…0001",createdAt:1762300000000,type:"Dívida cadastrada",detail:"Empréstimo combinado: R$ 5.000,00 a 15% ao mês"}`
- **settings** (store `settings`, keyPath `key`, **texto claro**): `{key:'dueWindow',value:number}` (default de leitura `7`) e `{key:'idleMinutes',value:number}` (UI oferece `1|5|15|30`, service não valida). `settings.js:2-3`, `auth.js:21,49`. `{key:"dueWindow",value:7}`
- **meta** (store `meta`, keyPath `key`, **claro exceto material criptográfico**): `{key:'vault',salt:Uint8Array(16),iv:Uint8Array(12),wrapped:Uint8Array,iter:600000,kdf:'PBKDF2-SHA256',cipher:'AES-GCM-256',v:1}` (`crypto.js:11`); `{key:'guard',fails:number,until:number}` (`auth.js:26`); `{key:'session',sid:string,dek:CryptoKey,last:number,mins:number}` (`auth.js:55`); `{key:'probe',data:Uint8Array}` — sonda cifrada gravada pela UI (`src/ui/settings.js:32`).

---

## 6. Eventos e reatividade

| Evento | Emissor | Ouvintes | Carga |
|---|---|---|---|
| `data-changed` (`Event` simples disparado no `window`) | `db.batch` no `transaction.oncomplete` (`src/db/idb.js:30`) — **só** batch; `get`/`getAll`/`put`/`del` **não** disparam | `src/core/live.js:2` (listener de módulo, permanente) → único callback de `watch`; `src/ui/shell.js:27` → para spinners após 650 ms | **nenhuma** — não há `detail`; `grep CustomEvent` = **0 ocorrências** no repositório inteiro |
| callback de `watch` (não é evento DOM) | via `data-changed` | `src/ui/clientlist.js:33` (`load`), `src/ui/dashboard.js:37` (`draw`), `src/ui/debtspage.js:37` (`load`). Vistas que saem chamam `unwatch()`: `src/main.js:12,46`, `src/ui/settings.js:16`, `src/ui/tools.js:7,32` | um único observador ativo por vez |
| `onLock(reason)` (lista de callbacks de módulo, não DOM) | `auth.lock()` — `reason ∈ {'idle','manual','logout'}` (`src/security/auth.js:64`; `src/ui/shell.js:36`; `src/ui/settings.js:54`) | `src/main.js:61` (volta à tela de senha e traduz o motivo), `src/ui/avatar.js:12` (`clearClientPhotos`), `src/ui/clients.js:4` (`clean`: aborta formulários, `unwatch`, revoga URLs, fecha `dialog`) | string do motivo |
| `beforeinstallprompt` | navegador | `src/pwa.js:2` → `preventDefault`, guarda `deferred`, notifica `cbs` | evento nativo |
| `pointerdown`,`keydown`,`touchstart`,`scroll` (`passive`) + `visibilitychange` | navegador | `src/security/auth.js:11` (`touch`/`check`); registrados em `unlock`/`restoreSession`, removidos em `lock` (`:12`) | — |
| `abort` (AbortSignal) | `AbortController` dos services | `src/services/apicpf.js:19,57`, `src/services/viacep.js:14,26` | — |
| `change` em `<input type=file>` | usuário | `src/ui/kit.js:14` (`sync`) e listeners avulsos (`src/ui/clients.js:55,140,142`; `src/ui/tools.js:44,81`) | — |
| `install`,`activate`,`fetch` | navegador (SW) | `sw.js:3-5` — pré-cache de `FILES`, limpeza de caches antigos, cache-first com fallback `index.html` | — |
| `MutationObserver` (não é evento) | `#app` (`childList,subtree`) e `disabled` de botão | `src/ui/shell.js:63` (rAF → `sync`), `src/ui/shell.js:22` (`busyStop`) | — |

---

## 7. Formato do arquivo de backup

Definido em `src/export/backup-format.js`; `formatVersion` atual = **1** (`:5`).

**ZIP simples** (sem `password`, `:12-16`): `manifest.json` = `{app:'SCIPIONE CRED', formatVersion:1, createdAt:'ISO', dbVersion:number, encrypted:false, counts:{clients,debts,documents,history,files}, sha256:{'data/x.json':'hex64','files/<id>.bin':'hex64'}}`; `data/clients.json`, `data/debts.json`, `data/documents.json`, `data/history.json`, `data/settings.json` = arrays/objeto **em claro** já decifrados; `files/<id>.bin` = bytes **em claro** de cada blob.

**ZIP criptografado** (`:17-18`): o ZIP acima é cifrado por inteiro (AES-GCM com chave `PBKDF2-SHA256(senha, salt16, iter=600000)`) e reembalado num ZIP externo **sem compressão** (`level:0`) com duas entradas — `manifest.json` = `{app,formatVersion,encrypted:true,kdf:'PBKDF2-SHA256',iter,salt:hex(32),cipher:'AES-GCM-256',createdAt}` (**sem `counts` e sem `sha256`**) e `payload.enc` = `iv(12)‖ct‖tag(16)`. O manifest externo **nunca é devolvido** ao chamador: `readBackup` recursa no ZIP interno (`:36`), então quem chama sempre vê o manifest completo com `counts`. A senha do cofre e as chaves não entram no arquivo (`:3`).

**Aceito pela restauração** (`readBackup`, `:28-45`, na ordem): ZIP legível (`INVALID`), `manifest.app==='SCIPIONE CRED'` (`INVALID`), `formatVersion>=1` **e** `<=FORMAT` — versão futura é recusada (`INVALID`, `:32`), cifrado exige senha (`NEEDS_PASSWORD`) e a chave tem de abrir o payload (`BAD_PASSWORD`), `sha256` precisa ser objeto (`INVALID`), **nenhum arquivo além de `manifest.json` pode existir fora do `sha256`** (`:39`), **todo** caminho do `sha256` precisa existir e bater byte a byte (`:40`), e `validate(data)` (`:20-27`) exige: 4 listas arrays; cliente com `id`+`name`; `photoId` referenciado presente em `files`; `clientId` de dívida/documento/histórico apontando para cliente existente; `principal>0` e `rate>0`; `blobId` de documento presente. Até 5 mensagens são juntadas em `INVALID: 'Backup inconsistente: …'`. `dbVersion` é gravado mas **nunca conferido**.

**`restore(d,mode)`** (`src/export/backup.js:12-30`): `mode==='replace'` apaga `clients`,`debts`,`documents`,`history`,`blobs` e regrava tudo (+ `dueWindow`, default `7`); **qualquer outro valor** — inclusive `undefined` ou um typo como `'resplace'` — cai no ramo de mesclagem: cliente com mesmo `id` **ou** mesmo CPF/CNPJ normalizado é reaproveitado, dívida e histórico com `id` já existente são ignorados, documento é ignorado se já existir `clientId+hash` no destino. Retorna `{clients,debts,documents,history}` com as contagens aplicadas.

---

## 8. Erros de domínio

**`{errs}`.** Formato `Object.assign(new Error('Corrija os campos destacados.'),{errs})`: a mensagem do `Error` é **constante**; o que varia é `errs`, mapa plano `campo → mensagem pt-BR` (`src/services/clients.js:18`, `src/services/debts.js:15`). A UI escreve cada entrada no `<small>` do campo e mostra `x.message` no erro geral (`src/ui/clients.js:47`, `src/ui/debts.js:28`).

| Chave | Mensagem literal | Origem |
|---|---|---|
| `name` | `'Informe a razão social.'` (PJ) / `'Informe o nome completo.'` (PF) | `clients.js:9` |
| `doc` | `'CNPJ inválido.'` / `'CPF inválido.'` / `` `Já cadastrado para ${x.name}.` `` | `clients.js:10-11` |
| `phone`, `mobile` | `'Informe DDD e número.'` (só se preenchido e fora de 10–11 dígitos) | `clients.js:12` |
| `email` | `'E-mail inválido.'` | `clients.js:13` |
| `description` | `'Informe a descrição.'` | `debts.js:8` |
| `principal` | `'Informe um valor maior que zero.'` (aceita `>0` e `≤1e13`) | `debts.js:9` |
| `rate` | `'Informe uma taxa entre 0,01% e 1000%.'` | `debts.js:10` |
| `date` | `'Data inválida.'` | `debts.js:11` |
| `due` | `'Informe o vencimento.'` \| `'O vencimento não pode ser anterior ao registro.'` | `debts.js:12` |

**Códigos.** `/api/cpf` (`reason` no corpo): `METHOD` (405), `TYPE` (415), `ORIGIN` (403), `RATE_LIMITED` (429, com `Retry-After`), `TOO_BIG` (413), `INVALID` (422), `UNAVAILABLE` (503) — sete valores, todos literais, nenhum com o CPF (`api/cpf.js:94,96,98,100,103,104,106,109,125,128,130`). `src/services/apicpf.js`: `INVALID`, `OFFLINE`, `TIMEOUT`, `UNAVAILABLE` — e como o helper é `fail(code,message)` (`:4`), **`x.message === x.code`**. `src/services/viacep.js`: `INVALID`, `OFFLINE`, `TIMEOUT`, `NETWORK`, `UNAVAILABLE`, `INVALID_RESPONSE`, `NOT_FOUND` (helper `fail(message,code)`, `:5`). `src/services/google-drive.js`: `CONFIG`, `INSTALLED`, `OFFLINE`, `AUTH`, `NETWORK`, `DRIVE`, `SECURE`, `INTEGRITY`. `src/export/backup-format.js`: `INVALID`, `NEEDS_PASSWORD`, `BAD_PASSWORD`. `src/services/debts.js` tem **dois** tipos de falha: `Error` com `.errs` (`:15`), mensagem fixa vinda de `applyBulk` (`:34,36`) e — desde esta branch — `Error` com `code:'NO_CLIENT'` em `saveDebt` (`:20`), a única mensagem do arquivo que não é de campo: `'Cliente não encontrado. Atualize a tela e tente de novo.'`. A UI diferencia por `code`? Não: trata `.errs` por campo (`src/ui/debts.js:28` — o mesmo `catch` que pinta `.errs` por campo). Services de escrita ainda sem `code`: `clients.js:40`, `backup.js:7`. `auth.js`, `process.js` e `idb.js` lançam **só mensagem** em pt-BR — o consumidor compara texto, e `src/main.js:8` traduz `QuotaExceededError` à mão.

---

## 9. Superfície global e ambiente

| Global | Uso | Onde |
|---|---|---|
| `window.google.accounts.oauth2` | escrito pelo script do GIS; o app **só lê** (`initTokenClient`, `revoke`) | `src/services/google-drive.js:50,97,116` |
| `window.open` | popup local para exibir PDF | `src/ui/clients.js:143` |
| `globalThis.fflate` | lido e preenchido pela injeção de `<script>`; único global nomeado usado como canal de módulo | `src/export/lib.js:2-3` |
| `globalThis.crypto` | apenas teste de capacidade `?.subtle?.digest` | `src/services/google-drive.js:176` |
| `crypto.subtle`, `crypto.getRandomValues`, `crypto.randomUUID` | WebCrypto, IVs, ids | `src/security/crypto.js:3-5`, `src/services/records.js:3`, `src/security/auth.js:10`, `src/files/process.js:7`, `src/export/backup-format.js:7` |
| `indexedDB` | banco `scipione-cred` | `src/db/idb.js:13` |
| `localStorage['scipione.google.oauth']` | **JSON em claro** do config OAuth | `src/services/google-drive.js:11,18,45,48` |
| `sessionStorage['sc.sid']`, `sessionStorage['sc.last']` | id e último toque da sessão de aba | `src/security/auth.js:5-9` |
| `location.origin` | comparação com as origens do cliente OAuth | `src/services/google-drive.js:24` |
| `navigator.onLine` / `.serviceWorker` / `.storage` / `.userAgent` / `.platform` / `.maxTouchPoints` / `.standalone` | guards de rede e PWA | `src/services/apicpf.js:9`, `viacep.js:10`, `google-drive.js:55,89`, `src/pwa.js:3-11`, `src/ui/clients.js:78,118` |
| `addEventListener`/`dispatchEvent` globais (≡ `window`) | `data-changed`, `beforeinstallprompt`, inatividade | `src/core/live.js:2`, `src/db/idb.js:30`, `src/pwa.js:2`, `src/security/auth.js:11-12` |
| `matchMedia`, `performance.now`, `requestAnimationFrame`, `MutationObserver`, `createImageBitmap`, `URL.createObjectURL`/`revokeObjectURL`, `Blob`, `confirm`, `print` | capacidades de browser | `src/pwa.js:10`, `src/ui/shell.js:14-23,63`, `src/files/process.js:11-13`, `src/export/lib.js:5`, `src/ui/tools.js:28` |
| `document.getElementById('app')` / `('nav')` | montadores obrigatórios da UI (existem em `index.html:11`) | `src/main.js:4`, `src/ui/shell.js:11` |
| `console.warn` | **únicos logs** do app: falha do callback reativo e falha de registro do SW | `src/core/live.js:2`, `src/pwa.js:3` |
| `caches`, `clients.claim`, `skipWaiting`, `Response.error` | apenas no service worker | `sw.js:3-5` |
| cookies, `XMLHttpRequest`, `WebSocket`, `sendBeacon`, `EventSource`, `new Worker` | **zero ocorrências** no código do app (`src/`, `api/`, `sw.js`, `index.html`); a única ocorrência em todo o repo é `new Worker` como string dentro da lib minificada `vendor/fflate.min.js`, nunca instanciada pelo app | ausência confirmada por grep próprio e em `docs/auditoria/6-integracoes-infra.md:538-547` |

**Variáveis de ambiente:** cinco, todas **do lado servidor** — `APICPF_API_KEY` (`api/cpf.js:108`) e as quatro de proteção da função, lidas **a cada requisição** por `envInt`/`extraOrigins` (`api/cpf.js:15-17`): `CPF_QUOTA_WINDOW_MS` (default 60000), `CPF_QUOTA_PER_IP` (30), `CPF_QUOTA_PER_INSTANCE` (300) e `SCIPIONE_ALLOWED_ORIGINS` (vazio = só o `host` da requisição). Defaults aplicados quando ausentes, vazias, não numéricas ou `<=0` (`api/cpf.js:15`). Placeholders em `.env.example:3,10,15,18,21`; `.gitignore:6-8` exclui `.env*`. Não há `import.meta.env` em código de browser (grep: zero ocorrências em `src/`, `api/`, `sw.js`). O `client_id` do Google **não** é config de ambiente: está hardcoded em `src/config/google.js:5` (campo `projectId` informativo em `:8`, `origins` em `:10`).

---

## 10. Compatibilidade e versionamento

**Não existe contrato de versão para as APIs internas.** Evidência:

1. `package.json:1` não tem campo `version` — não há número de release a comparar.
2. Nenhum módulo declara versão, `@since`, `@deprecated` ou changelog; não há TypeScript, `.d.ts`, JSDoc de tipos nem lint. As assinaturas da seção 4 só existem no código.
3. **Isto já não é verdade, e a frase anterior precisa de correção.** Não há campo `scripts` em `package.json:1` (logo não há `npm test`), mas **há** `scripts/check-static.mjs`, `scripts/run-tests.mjs` e CI em `.github/workflows/ci.yml`, com os jobs `estatico`, `testes` e `smoke-navegador` (`ci.yml:58,142,260`). O `scripts/` roda 7 grupos de checagem (`essenciais`, `sintaxe`, `sw`, `json`, `deps`, `segredos`, `docs`), invocáveis em subconjunto com `--only=`. Um deles, `--only=docs`, é exatamente o contrato deste documento: toda referência `arquivo:linha` da documentação canônica tem de **resolver** a um arquivo do repositório e a uma linha **dentro da faixa** daquele arquivo — e `tests/contracts/docs-refs.test.mjs` garante que o mecanismo não é vacuoso (prova contra fixture). O que **continua** ausente: nada verifica, em build ou push, que um export **renomeado** ainda é consumido por quem o importa — `tests/contracts/imports.test.mjs` cobre resolução de especificadores, não assinaturas (`tests/contracts/imports.test.mjs:1-3`). A rede de segurança são os 28 arquivos `tests/**/*.test.mjs`, canonicamente por `node scripts/run-tests.mjs` (`docs/README.md:22`).
4. Consequência: alterar a assinatura de `enc()`, `batch()` ou `stats()` é **quebra silenciosa em tempo de execução**, visível só quando a rota afetada for aberta; `git grep` das chamadas é o único mecanismo de análise de impacto disponível.

Os quatro controles de versão que existem são estreitos e não cobrem API interna: `DB_VERSION=MIGRATIONS.length` (`src/db/idb.js:10`, evolui por append — regra só no comentário `:1`, **sem** guarda `objectStoreNames.contains`); `FORMAT=1` do backup (`backup-format.js:5`, recusa versão futura na leitura `:32`, mas `MIGRATE[v]` é prometido no comentário `:3` e **não implementado**); `meta.v=1` do cofre (`crypto.js:11`, **gravado e nunca lido** — `openVault` não o confere, então trocar o KDF hoje não tem detecção); e `V='sc-v70'` do service worker (`sw.js:2`, mantido à mão junto da lista `FILES`, sem relação com as versões acima — é a versão que delimita até quando o `GET /api/cpf?cpf=` legado ainda precisa ser aceito, §2).

Contratos que hoje só existem por convenção e exigem cuidado explícito antes de mudar: o corpo e os `reason` de `/api/cpf` (o contrato externo mais bem coberto do repo: tratar `tests/apicpf.test.mjs:126-590` como especificação, conforme `docs/auditoria/6-integracoes-infra.md:568` — e hoje protegido também pela checagem de citações `--only=docs` + `tests/contracts/docs-refs.test.mjs`, que é o que impede este documento de apontar para linha inexistente); a tupla `['put'|'delete',store,valor]` de `db.batch` (usada por `records.js`, `clients.js`, `debts.js` e `backup.js`); o envelope `{id,createdAt,clientId,data}` (mover campo para `data` quebra índice; mover para claro amplia a exposição); os nomes de chave em `settings` (`dueWindow`, `idleMinutes`) e `meta` (`vault`, `guard`, `session`, `probe`), que são strings soltas sem enumeração central; e os valores de `code`/`reason`, comparados como literais na UI (`src/ui/clients.js:92`) — renomear um código **silencia** o feedback. Compatibilidade de dados já gravados: o payload cifrado é JSON auto-descrito, então **adicionar** campo de cliente não exige migração; em dívida há whitelist fechada (`src/services/debts.js:4`) e esquecer de incluí-la descarta o campo em silêncio.
