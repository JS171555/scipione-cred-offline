# Arquitetura — SCIPIONE CRED

**Base:** commit `e78d776` (conteúdo idêntico a `main`) para o código de aplicação; esta documentação é escrita na branch `chore/project-audit-and-test-infrastructure`. São **39 módulos de aplicação** (`src/`, `api/`, `sw.js`, `vendor/`) e 74 nós no grafo completo, que inclui os 34 arquivos de teste e os 2 scripts de qualidade. O extrator canônico é `audit/deps.py` (fora do repositório) e as guardas reproduzíveis dentro dele são `tests/contracts/imports.test.mjs` e `node scripts/check-static.mjs`.
**Escopo:** estrutura, camadas, decisões e invariantes. Não repete o `README.md` (recursos, instalação, deploy).
**Convenção:** toda afirmação carrega `arquivo:linha` conferido no código. Sem evidência, marca-se `NÃO CONFIRMADO`. Nenhuma afirmação sobre histórico de git foi reexecutada aqui; o que vem de auditoria está atribuído como tal.

## Sumário

1. [Propósito e modelo de ameaça](#1-propósito-e-modelo-de-ameaça)
2. [Visão em camadas](#2-visão-em-camadas)
3. [Diagramas](#3-diagramas)
4. [Decisões arquiteturais](#4-decisões-arquiteturais)
5. [Fronteiras de confiança](#5-fronteiras-de-confiança)
6. [Concorrência e reatividade](#6-concorrência-e-reatividade)
7. [Ciclo de vida de dados](#7-ciclo-de-vida-de-dados)
8. [Pontos de extensão](#8-pontos-de-extensão)
9. [Invariantes](#9-invariantes)
10. [Limitações e dívidas arquiteturais](#10-limitações-e-dívidas-arquiteturais)

## 1. Propósito e modelo de ameaça

O sistema é um PWA offline-first de gestão de clientes e dívidas cuja única fonte de verdade persistente é o IndexedDB do próprio aparelho, cifrado em repouso por um cofre cuja chave deriva da senha do usuário: PBKDF2-HMAC-SHA-256 com `ITER=600000` gera uma KEK não extraível que embrulha uma DEK AES-GCM-256 (`src/security/crypto.js:4`, `:6`, `:8-11`), e os dados passam por `sealJSON`/`sealBytes` (`src/security/crypto.js:17-20`). O modelo de ameaça é o de **confidencialidade no repouso** contra quem obtenha o arquivo do banco, o ZIP de backup ou o cache do service worker: quem tiver o disco não lê nomes, CPF/CNPJ, valores nem anexos, porque todo payload passa por `enc()`/`blobOp()` antes de entrar na transação (`src/services/records.js:7-8`; instrução "Cifre os dados antes" em `src/db/idb.js:26`) e porque o cache é pré-listado sem nenhuma escrita em runtime (`sw.js:3-5`). Ficam explicitamente **fora** do modelo: a disponibilidade multi-dispositivo (não há sincronização), a existência e a linha de tempo dos registros (UUID, `createdAt` e `clientId` ficam em claro por serem as keyPaths dos índices, `src/db/idb.js:5-8`) e o atacante que age com a sessão já desbloqueada — a DEK mora em closure de módulo (`src/security/auth.js:6`) e é regravada como `CryptoKey` no registro `meta/session` (`src/security/auth.js:55`), de modo que qualquer XSS na mesma origem executa com material criptográfico disponível.

## 2. Visão em camadas

| # | Camada | Arquivos | Linhas | Papel |
|---|---|---|---:|---|
| 1 | Entrada | `index.html`, `src/main.js` | 11 + 65 | Documento, primitivo `h`, gate de boot, `authView`/`appView` |
| 2 | Shell/navegação | `src/ui/shell.js` | 64 | Monta `#nav`, injeta `.util`, deriva destaque do DOM renderizado |
| 3 | Telas | `src/ui/{clients,tools,debts,debtspage,clientlist,dashboard,settings,avatar,kit,icons}.js` | 758 | Construção de árvore, estado em closure, delegação a serviços |
| 4 | Serviços | `src/services/{records,clients,debts,dashboard,settings,search,viacep,apicpf,google-drive}.js` | 420 | Regra de negócio, transações, envelope cifrado, integrações |
| 5 | Domínio | `src/domain/{money,due,validators,address}.js` | 37 | Funções puras: centavos, datas ISO, CPF/CNPJ, endereço |
| 6 | Persistência | `src/db/idb.js` | 30 | Schema versionado e primitivos `get/getAll/put/del/batch` |
| 7 | Segurança | `src/security/{crypto,auth}.js` | 91 | KEK/DEK, sessão, lockout, bloqueio por inatividade |
| 8 | Exportação | `src/export/{backup,backup-format,reports,xlsx,lib}.js`, `src/files/process.js` | 134 | Backup ZIP, Excel, relatório, normalização de arquivos |
| 9 | PWA | `sw.js`, `src/pwa.js`, `manifest.json` | 5 + 11 + 1 | Pré-cache, estratégias, instalação |
| 10 | Serverless | `api/cpf.js` | 48 | Proxy `/api/cpf` da consulta de CPF |

**Regras de dependência pretendidas.** Camada N importa apenas N-1 ou inferior: telas falam com serviços (`src/ui/clientlist.js:1`), serviços falam com domínio, persistência e segurança (`src/services/clients.js:1-2`), persistência não conhece ninguém (`src/db/idb.js` tem zero imports), segurança só enxerga persistência (`src/security/auth.js:1-2`), domínio não enxerga nada além de domínio (`src/domain/address.js:1` é a única aresta do diretório), exportação compõe serviços, não UI (`src/export/reports.js:1-2`), PWA e shell de navegação são folhas sem dependências de negócio (`src/pwa.js` sem imports; `sw.js` é script clássico, sem imports). A função serverless compartilha só o validador de domínio com o cliente (`api/cpf.js:1`) e nada do bundle do navegador.

**O que o grafo real prova.** O extrator mecânico da auditoria (ad hoc, não versionado) mediu **74 nós e 204 arestas internas (107 do app + 95 de testes/scripts)** no commit de referência, com **0 ciclos e 0 imports quebrados**. Com as suítes desta branch o mesmo cálculo dá **205 arestas (107 do app + 98 de testes e ferramentas)**: o arco extra vem de `tests/apicpf.test.mjs:43`, que importa `handler, { __quota }` e é contado um arco por especificador. A peça versionada e reproduzível é a checagem `node scripts/check-static.mjs --only=deps`, que resolve cada especificador relativo e reprova qualquer quebrado. A primeira versão do extrator, que ancorava a regex no início da linha, submedia (47 nós / 57 arestas), porque `src/main.js:3`, `src/ui/clients.js:1` e `src/ui/tools.js:1` acumulam vários imports na mesma linha; a contagem foi corrigida e conferida por recálculo independente statement por statement. Dentro do app, as arestas são 107 e não mudaram entre as versões. As conclusões estruturais são estas:

- **Zero ciclos, na contagem completa.** Sem bundle circular, o carregamento ESM nativo sem build é determinístico.
- **Zero arestas ascendentes.** Não existe `src/services/* → src/ui/*`, nem `src/domain/* → src/services|ui|db`. Domínio é puramente reconputável e é o único código compartilhado com o servidor (`api/cpf.js:1`).
- **Zero imports quebrados e zero specifier externo em `src/`, `api/` e `sw.js`** (verificado por grep de `from '<não-ponto>`). Em `tests/` há `node:assert/strict` (7 arquivos) e `node:fs` (`tests/backup.test.mjs:1`) — correção ao resumo do grafo, que lista apenas `node:assert/strict`.
- **Uma única aresta UI→persistência e UI→crypto**, ambas na mesma tela: `src/ui/settings.js:2` (`../db/idb.js`) e `src/ui/settings.js:4` (`../security/crypto.js`), usadas no teste de integridade (`src/ui/settings.js:30-36`). É atalho real sobre a camada de serviço, não violação de segurança.
- **Uma aresta oculta que o grafo não vê:** `vendor/fflate.min.js` não é importado — é injetado como `<script>` e lido do global (`src/export/lib.js:2-4`), usado por `src/export/reports.js:2`, `src/export/backup-format.js:4` e `src/export/xlsx.js`. Por isso ele precisa estar em `FILES` (`sw.js:2`) apesar de não aparecer em nenhum grafo de import.

## 3. Diagramas

### 3.1 Sequência de boot

```text
1  browser ─ GET / ─────────────────► sw.js:5  cache-first puro: só existe o que está em FILES (sw.js:2)
2  index.html:10 css/app.css + css/ui.css   |   index.html:3 CSP  |   index.html:11 #nav[hidden] + #app vazio
3  index.html:11 ─ <script type="module" src="src/main.js">        (nenhum script inline, nenhum build)
4  main.js:1-3  avaliação dos imports — efeitos colaterais ANTES do corpo, nesta ordem:
      ├─ src/core/live.js:2        addEventListener('data-changed') global          (singleton vivo)
      ├─ src/ui/clients.js:4       A.onLock(clean)      → revoga object URLs e fecha <dialog>
      └─ src/ui/avatar.js:12       A.onLock(clearClientPhotos)
5  main.js:61   A.onLock(r => authView(false, aviso))   → todo lock (manual|idle|logout) cai na tela de senha
6  main.js:62   P.registerSW()                          → SEM await; falha vira console.warn (src/pwa.js:3)
7  main.js:63   IIFE de boot (gate de autenticação):
      A.hasVault() ──► auth.js:17 ──► db.get('meta','vault') ──► idb.js:22 ──► openDB() idb.js:12-17
        ├─ sem cofre .................................► authView(true)   main.js:11-43 (criar senha)
        ├─ cofre + restoreSession() true .............► appView()        main.js:44-60
        │     auth.js:38-48: exige sc.sid na MESMA aba (auth.js:5) e dentro da janela de inatividade
        ├─ cofre + sessão inválida ...................► authView(false)  (desbloquear)
        └─ erro do banco .............................► card "Não foi possível abrir o banco local"
8  main.js:65   initShell({...})  ── roda SÍNCRONO enquanto o await do passo 7 pendura a IIFE
      shell.js:28-36 monta #nav · shell.js:63 MutationObserver(#app)+rAF → sync()
      shell.js:49-50 decide "tela bloqueada?" por presença de DOM (.auth,.brand) — não por A.isUnlocked()
9  authView → A.setup/A.unlock (main.js:22-23) → crypto.js:7-16 → appView()
10 appView:46  unwatch() + P.requestPersist() → :47 await Dash.card(...) → :48 REVALIDA A.isUnlocked() → :50 show(...)
```

### 3.2 Ciclo de dados (UI → service → cifra → idb → batch → evento → re-render)

```text
[tela]                    [serviço]                    [records/crypto]              [idb]                [live/tela]
onclick / onsubmit ─► S.saveClient(d,old,photo)   src/ui/clients.js:46-47 → src/services/clients.js:16
   │                    ├─ validate(d,old,await listClients())  clients.js:17  ── leitura FORA da transação
   │                    ├─ toStored(file)  src/files/process.js:5  ── 15 MB, SHA-256, reencode (antes de gravar)
   │                    ├─ enc('clients',{...})    records.js:7  ─► sealJSON(DEK)  crypto.js:19 → data:Uint8Array
   │                    ├─ blobOp(bid,bytes)       records.js:8  ─► sealBytes      crypto.js:17
   │                    └─ hist(clientId,...)      records.js:10 ─► enc('history')  (auditoria junto, mesmo batch)
   │                 db.batch(ops)  clients.js:27 ─► idb.js:27-30: UMA transação readwrite
   │                                                 durability:'strict' · erro síncrono → t.abort()
   │                                                 t.oncomplete → res() + dispatchEvent('data-changed')  idb.js:30
   │                                                                                  │
   └────────────────────────────────────────────────────────────── live.js:2  cb?.() ◄┘
                                        clientlist.js:33 / debtspage.js:37 / dashboard.js:37 registraram o cb único
                                              load() → list(store) records.js:5 → getAll + dec() em TODOS os registros
                                              paint() → out.replaceChildren(...)   (clientlist.js:15, debtspage.js:15)

  Escrita que NÃO passa por db.batch (db.put/db.del: idb.js:24-25) NÃO dispara 'data-changed' e NÃO revalida tela:
    auth.setIdle auth.js:49 · setDueWindow services/settings.js:3 · meta/vault+guard auth.js:21,30,32 · probe ui/settings.js:32
```

### 3.3 Mapa de camadas

```text
                     index.html ─────────► src/main.js  (h, show, ctx, fmt)  ──► src/ui/shell.js (navegação)
                                            │  gate de boot / authView / appView
        ┌───────────────────────────────────┼──────────────────────────────────────────┐
        ▼ telas (src/ui/*.js)               ▼ exportação (src/export/*.js)              ▼ PWA
  clients · clientlist · debtspage    backup · backup-format · reports            sw.js · src/pwa.js
  debts · dashboard · settings        xlsx · lib (injeta vendor/fflate)           manifest.json
  avatar · kit · icons                     │
        │  ui→services (14 arestas)        │  export→services (4) · export→db (1) · export→crypto (1)
        ▼                                  ▼
   ┌──────────────────── src/services/*.js ────────────────────┐
   │ records (envelope cifrado) · clients · debts · dashboard  │
   │ settings · search · viacep · apicpf · google-drive        │
   └──────┬───────────────────┬───────────────────┬────────────┘
          ▼ services→domain   ▼ services→db      ▼ services→security (records.js:2 getKey)
   src/domain/*.js       src/db/idb.js       src/security/auth.js ──► src/security/crypto.js
   money · due ·         (zero imports)      (sessão, lockout)      KEK→DEK, PBKDF2, AES-GCM
   validators · address      ▲                    ▲
                             └── src/ui/settings.js:2 (única aresta ui→db)
   api/cpf.js ──► src/domain/validators.js          src/main.js ──► src/pwa.js, security/auth, ui/*
   (a função serverless só compartilha o domínio; nada do bundle do navegador é importado por ela)
```

## 4. Decisões arquiteturais

| Decisão | Motivação (evidência) | Benefício obtido | Custo / risco atual |
|---|---|---|---|
| **Sem framework e sem build** — ES Modules nativos servidos como estão | `package.json:1` é literalmente `{"type":"module","private":true}`; `index.html:11` carrega `src/main.js` direto; CSP sem `unsafe-eval` (`index.html:3`) | Nada a compilar, nada a instalar; o arquivo lido é o arquivo executado; debug no navegador é 1:1; auditoria estática é confiável | Custo de re-render pago por reconstrução total da árvore (`src/main.js:6` `root.replaceChildren`); escala depende de dataset pequeno (paginação 20/10/5 em `src/ui/clientlist.js:3`, `src/ui/debtspage.js:4`, `src/ui/clients.js:146`) |
| **`h` é injetado, não importado** — definido uma vez em `src/main.js:5` e entregue por `ctx()` (`src/main.js:7`) | Todas as telas recebem `h` pelo contexto ou pela fachada `U` (`src/ui/clients.js:12`; `src/ui/shell.js:11`; `src/ui/kit.js:8`, `:18` recebem `h` como parâmetro) | Um único ponto de mudança de semântica de atributos/eventos; telas ficam desacopladas do documento e testáveis sem global | O contrato é implícito: esquecer de repassar `h` produz `undefined is not a function` em runtime, não em análise estática; `src/ui/clients.js:2` mantém um singleton `X` com o último `ctx` |
| **DOM só por criação de nós** — `createElement`/`append`, sem `innerHTML` | Grep: zero ocorrências de `innerHTML`, `insertAdjacentHTML`, `eval(`, `new Function` em `src/`, `api/`, `sw.js`; `src/main.js:5` constrói tudo por nós | Compatível com a CSP restritiva (`index.html:3`); dado do usuário (nome, descrição, `detail` do histórico) nunca vira markup | Verbosidade e duplicação de fábricas locais: `top` tem 3 cópias (`src/ui/clients.js:9`, `src/ui/settings.js:12`, `src/ui/tools.js:3`) e `fld`/`field` tem 5 assinaturas incompatíveis (`src/ui/clients.js:27`, `src/ui/debts.js:21`, `src/ui/tools.js:5`, `src/ui/clientlist.js:22`, `src/main.js:9`) |
| **Envelope KEK → DEK** — a senha deriva uma KEK que só embrulha a DEK aleatória | `src/security/crypto.js:6` (PBKDF2-HMAC-SHA-256, `ITER=600000` em `:4`, KEK `extractable=false`), `:8-11` (DEK gerada e `wrapKey`), `:13-16` (`unwrapKey` na abertura), `:22` (derivação direta só para backup) | A senha nunca é guardada nem comparada: senha correta = a tag GCM do `unwrapKey` fecha (`:15`); troca de parâmetros de KDF sem re-cifrar os dados é possível em princípio | Não há troca de senha nem rotação de DEK implementada no código (nada em `src/security/auth.js` reembrulha a DEK); o comentário `crypto.js:2` diz "DEK é não extraível", mas a DEK **criada** em `crypto.js:9` é `extractable=true` (precisa ser embrulhada em `raw`) e depois é persistida como `CryptoKey` em `meta/session` (`auth.js:55`) |
| **Cache-first puro, sem runtime caching** | `sw.js:3` pré-cacha `FILES` (52 entradas) e `skipWaiting()`; `sw.js:4` apaga caches antigos e `clients.claim()`; `sw.js:5` só lê o cache; zero `cache.put` em `sw.js` (verificado por grep) | Nada de dado pessoal entra no cache — nem `/api/cpf` nem `viacep.com.br`; comportamento offline determinístico e auditável por lista | Só funciona offline o que está em `FILES`; `addAll` é tudo-ou-nada (`sw.js:3`); atualização depende 100% de disciplina manual no bump de `V` (`sw.js:1-2`) |
| **Ausência de roteador: estado derivado do DOM** | Grep: zero `pushState`, `popstate`, `location.hash`, `hashchange` em `src/`, `index.html`, `sw.js`; cada tela renderiza `header.top[data-page]` (`src/ui/clients.js:9`, `src/ui/tools.js:3`, `src/ui/settings.js:12`, `src/main.js:51`) e `src/ui/shell.js:52-54` lê esse atributo para o destaque | Zero estado de rota para sincronizar; nenhum back-forward inesperado sobre sessão bloqueada; shell nunca "desanda" por URL manually editada | Não há URL por tela (nada linkável/compartilhável, botão Voltar do navegador não volta); o mapeamento é regex ancorada (`src/ui/shell.js:53`) e perde `aria-current` em `new-client`, `edit-client` e `edit-debt`; a visibilidade da navegação é inferida por presença de DOM (`src/ui/shell.js:49`), não por `A.isUnlocked()` |
| **Sem npm scripts e sem dependências** — `vendor/` commitado | `package.json:1`; `vendor/fflate.min.js` versionado com `vendor/LICENSES.md`; testes por laço manual (`README.md:293`) | Supply chain mínima e reproduzível; nenhum lockfile para divergir | Nenhum gate automatizado em `e78d776`: sem CI (não existe `.github/`), sem `npm test`, sem checagem de `V`/`FILES`/schema — o único laço é humano e opcional |

## 5. Fronteiras de confiança

| Fonte | Confiável? | Como o código trata | Evidência |
|---|---|---|---|
| Resposta da ViaCEP | **Não** | Whitelist de 5 campos com default `''`, CEP remascarado, UF forçada a maiúsculas; nada é persistido automaticamente — só vira valor de `<input>`, e o que for gravado passa por `enc()` | `src/services/viacep.js:32`; aplicação em `src/ui/clients.js:106` (4 campos; `number`/`complement` intactos); gravação `src/ui/clients.js:46` → `src/services/clients.js:23` |
| Resposta da função `/api/cpf` | **Não** (é dado de terceiros sobre pessoa física) | `cache:'no-store'`, re-normalização defensiva: `name` só se string, `gender` só se `M|F|I`, `birth` só se `^\d{4}-\d{2}-\d{2}$`; preenchimento apenas de campos vazios | `src/services/apicpf.js:27`, `:31-38`; `src/ui/clients.js:87-88`; do lado do servidor, whitelist antes de responder: `api/cpf.js:32-36` |
| Resposta bruta da APICPF (upstream) | **Não** | Só o servidor a vê; campos extras (inclusive `message`) nunca são repassados; JSON inválido vira `503 UNAVAILABLE` | `api/cpf.js:30` (`try{...}catch{}`), `:38-42`; contrato de erro tratado em `src/services/apicpf.js:40-41` |
| Arquivo de backup escolhido pelo usuário | **Não** | Descompacta, exige `app==='SCIPIONE CRED'`, `formatVersion<=FORMAT`, confere SHA-256 de **cada** entrada e rejeita entrada não listada; só então `validate()` e, antes disso, nada é gravado | `src/export/backup-format.js:29-44`; `validate` em `:20-27`; restauração cifra e grava num único batch em `src/export/backup.js:29` |
| Dados já lidos do IndexedDB | **Parcialmente** — autenticados pelo GCM, mas sem garantias de esquema | `openJSON` falha se a tag não fechar; o envelope assume `id`/`createdAt`/`clientId` presentes; campos de negócio são tratados como existentes (`sort` por `date` sem guarda) | `src/security/crypto.js:18-20`; `src/services/records.js:4`; `src/services/debts.js:6`; `src/domain/due.js:2`; `src/services/records.js:9` (`TypeError` se o blob sumiu) |
| Cache do service worker / assets | **Sim, mas só por origem** — tudo vem de `default-src 'self'` e da lista `FILES` | Pré-cache fechado, sem escrita em runtime; `no-store` na função serverless; `nosniff` global | `sw.js:2-5`; `index.html:3`; `api/cpf.js:9`; `vercel.json:39-41` |
| Configuração OAuth do Google | **Sim quanto a segredo** (identificador público), **não quanto a conteúdo** | Se existir override no `localStorage` ele prevalece sobre o default versionado; `type!=='web'` é descartado; `client_secret` é rejeitado ao importar JSON | `src/services/google-drive.js:11`, `:18`, `:21-22`, `:41`, `:45`; default em `src/config/google.js:4-10` |
| Sessão do usuário | **Vive na aba, não no disco (em tese)** | DEK em closure de módulo (`auth.js:6`); identificador e timestamp em `sessionStorage` (`auth.js:5`, `:7-9`); espelho `meta/session` com `sid`, `dek`, `last`, `mins` (`auth.js:50-57`); só reabre na mesma aba e dentro da janela de inatividade (`auth.js:38-48`); token do Google só em memória (`google-drive.js:14`) | `src/security/auth.js:5-6`, `:34-35`, `:55`, `:66-68`; `src/services/google-drive.js:14`, `:19` |

Consequência estrutural: a **origem** é o elo fraco. Com sessão aberta, um script injetado lê e escreve pelo mesmo caminho que a UI legítima — por isso a CSP é a defesa primária (`index.html:3`), complementada pelo bloco global de cabeçalhos (`vercel.json:36-59`), sem `unsafe-inline` para script e com `object-src`/`base-uri`/`form-action` `none`. `frame-ancestors` não funciona em meta e por isso vive no cabeçalho (`vercel.json:55-56`).

## 6. Concorrência e reatividade

`src/core/live.js` tem três linhas e é inteiro: um `addEventListener('data-changed')` registrado no momento do import (`src/core/live.js:2`) e dois exportadores, `watch(f)` e `unwatch()`, que escrevem e zeram **um único** callback `cb` (`src/core/live.js:3`). Não há store, não há estado reativo e não há barramento de eventos: é um *slot* de observador.

O **único emissor** do evento é `db.batch`, em `src/db/idb.js:30` (`t.oncomplete=()=>{res();dispatchEvent(new Event('data-changed'))}`). As implicações, todas verificáveis no código:

1. **`db.put` e `db.del` são silenciosos** (`src/db/idb.js:24-25`). Gravações unitárias — `setIdle` (`src/security/auth.js:49`), `setDueWindow` (`src/services/settings.js:3`), `meta/vault`/`guard`/`session` (`src/security/auth.js:21`, `:30`, `:55`) e o `probe` (`src/ui/settings.js:32`) — **não revalidam nenhuma tela**. Mudar a janela de vencimento não atualiza a página de Dívidas que já tinha carregado `win` (`src/ui/debtspage.js:6`, `:11`).
2. **`db.batch([])` sai antes do dispatch** (`src/db/idb.js:27`) — um lote vazio não re-renderiza nada. Nenhum chamador atual passa lista vazia, mas o contrato existe.
3. **O slot é único, logo telas compostas se sobrescrevem.** Quem chama `watch` hoje: `src/ui/clientlist.js:33`, `src/ui/debtspage.js:37`, `src/ui/dashboard.js:37`. Quem chama `unwatch`: `src/main.js:12`, `:46`, `src/ui/clients.js:3`, `src/ui/settings.js:16`, `src/ui/tools.js:7`, `:32`. O último `watch` vence — é correto enquanto cada tela é um grafo de renderização único, e passa a ser armadilha se uma tela aninhar duas áreas reativas.
4. **Escrita e leitura não são atomicamente ligadas.** O padrão dominante é *ler fora, gravar dentro*: `saveClient` valida contra `await listClients()` e só depois abre a transação (`src/services/clients.js:17` → `:27`), `deleteClient` faz quatro leituras `readonly` antes do batch (`src/services/clients.js:32-35`), `applyBulk` relê e compara taxas antes de gravar (`src/services/debts.js:30-31`, `:34`). Entre a leitura e o commit não há bloqueio: duas abas podem produzir CPF duplicado (não existe índice `unique` — `src/db/idb.js:5`) ou deixar dívida órfã. `applyBulk` é o único que fecha a janela por deteção (`src/services/debts.js:31`).
5. **A concorrência entre abas é tratada só em upgrade de schema**: `onblocked` recusa com mensagem ("Feche as outras abas…", `src/db/idb.js:16`) e `versionchange` fecha a conexão e invalida o singleton (`src/db/idb.js:15`). Fora disso, abas múltiplas escrevem livremente.
6. **Efeito prático de correção**: como o re-render é disparado por `oncomplete` (`src/db/idb.js:30`, comentário em `:18`), a UI nunca pinta estado não confirmado em disco — ao custo de reler e decifrar o store inteiro a cada gravação (`src/services/records.js:5`).

## 7. Ciclo de vida de dados

```text
criar    <input type=file> escolhe o arquivo                     src/ui/clients.js:55 (foto) · :142/:176 (documento)
         toStored(): teto de 15 MB, SHA-256 dos bytes a gravar,   src/files/process.js:4-6, :7, :11-14
         reencode WebP/JPEG só se menor (ou force), PDF intocado   src/files/process.js:3, :9
cifrar   blobOp(bid,bytes) → sealBytes → IV(12)+ciphertext+tag    src/services/records.js:8 · src/security/crypto.js:5, :17
         registro de negócio → enc() → sealJSON(rest)             src/services/records.js:7 · src/security/crypto.js:19
gravar   um só db.batch com blob+registro+histórico               src/services/clients.js:42 (documento) · :20-27 (cliente/foto)
         transação readwrite strict, tudo-ou-nada                 src/db/idb.js:27-30
ler      list(store) para metadados (decifra o store inteiro)     src/services/records.js:5 · src/services/clients.js:36-37
         binário só sob demanda: blobBytes(blobId)                src/services/records.js:9 · src/services/clients.js:44
decifrar openBytes → GCM autentica; falha interrompe a leitura    src/security/crypto.js:18 · src/services/records.js:9
URL      URL.createObjectURL(new Blob([b],{type}))                src/ui/avatar.js:19 · src/ui/clients.js:5 (helper url)
         diálogos, PDF em aba nova, download, export de ZIP/XLSX  src/ui/clients.js:128, :144, :145 · src/export/lib.js:5
revogar  na troca de prévia (imediatamente)                       src/ui/clients.js:39-40
         no close do <dialog>                                     src/ui/clients.js:128
         por epoch + A.onLock em listas de avatar                 src/ui/avatar.js:6-12
         em clean(), empilhadas em urls[], via A.onLock(clean)    src/ui/clients.js:2-4
         por timer no download: 60 s · PDF em aba: 120 s          src/export/lib.js:5 · src/ui/clients.js:144-145
```

A regra implícita que sustenta o ciclo: **o binário nunca é lido junto do registro**. `documents` guarda `blobId` dentro do payload cifrado (`src/services/clients.js:42`), então listar documentos não decifra arquivo algum; a decifração binária acontece apenas em ação explícita do usuário (`src/ui/clients.js:143-145`, `src/ui/avatar.js:19`).

## 8. Pontos de extensão

| Extensão | Arquivos exatos, na ordem | Contrapartida obrigatória |
|---|---|---|
| **Nova tela** | 1) `src/ui/<nova>.js` copiando o molde de `src/ui/tools.js:6-30`; 2) import em `src/main.js:3`; 3) destino registrado em `src/main.js:65` (`initShell`); 4) item de menu em `src/ui/shell.js:28-36`; 5) `header.top[data-page]` como primeira criança (`src/ui/clients.js:9-11`); 6) `unwatch()` na entrada (`src/ui/settings.js:16`) ou `watch(load)` se reativa (`src/ui/clientlist.js:33`) | Adicionar o caminho em `FILES` **e** incrementar `V` (`sw.js:1-2`); se a chave de `data-page` não casar com o mapper de `src/ui/shell.js:53`, o menu perde o destaque |
| **Novo campo de cliente** | 1) campo em `src/ui/clients.js:57-68`; 2) inclusão no objeto enviado em `src/ui/clients.js:46`; 3) rótulo em `LABEL` (`src/services/clients.js:5`); 4) regra em `validate` (`src/services/clients.js:7-14`); 5) exibição no perfil (`src/ui/clients.js:170`); 6) pesquisabilidade em `src/services/search.js:3` | Nenhuma migração: o payload é JSON auto-descrito dentro de `data` (`src/services/records.js:7`). Registros antigos chegam sem a chave (`undefined`); ainda assim exige bump de `V` (`sw.js:2`) |
| **Novo campo de dívida** | A whitelist `rec()` de `src/services/debts.js:4` é obrigatória — campo fora dela é **descartado em silêncio**; depois `validate` (`:7-13`), `LABEL` (`:3`), formulário (`src/ui/debts.js:29-35`), agregações (`src/services/dashboard.js:4-6`) e colunas de relatório/Excel (`src/export/reports.js:16-18`) | idem |
| **Novo store ou índice** | 1) **acrescentar** `MIGRATIONS[k]` no fim (`src/db/idb.js:2-9`; política em `:1`), `DB_VERSION` sobe sozinho (`:10`); 2) usar `idx()` (`:5`) para manter `keyPath:'id'`; 3) guardar-se com `objectStoreNames.contains(...)` antes de criar (não existe hoje) | Só funciona se a chave do índice ficar **fora** de `data` (`src/services/records.js:7`): mover campo para o envelope em claro amplia a superfície exposta. Depois: `V`/`FILES` (`sw.js:2`), texto "versão N" (`src/ui/settings.js:50`) e backup (`LISTS` em `src/export/backup-format.js:5`; `src/export/backup.js:5-9`, `:14-29`) |
| **Nova integração com rede** | 1) `src/services/<nome>.js` no molde de `src/services/viacep.js`: validação antes da rede (`:6-10`), `AbortController` com teto (`:11-14`), erros tipificados por `code` (`:8-31`), mapeamento whitelisted (`:32`); 2) consumo na tela (`src/ui/clients.js:101-123`) | Se houver chave: função em `api/<nome>.js` lendo `process.env` (`api/cpf.js:19-20`), origem liberada em `connect-src` (`index.html:3`) e `Cache-Control: no-store` na resposta (`api/cpf.js:9`). Respostas de terceiros nunca vão para o cache (`sw.js:5` não escreve) |
| **Novo ícone** | chave em `P` (`src/ui/icons.js:2-41`, grade 24×24, traço 1.5) e, se quiser aparição automática em botão, regex em `MAP` (`src/ui/shell.js:5-9`) | Nome desconhecido cai em `info` silenciosamente (`src/ui/icons.js:47`); `V` deve subir (`sw.js:2`) |

## 9. Invariantes

1. **Todo registro de negócio passa por `enc()`.** Verificação mecânica: `grep -rn "\['put','\(clients\|debts\|documents\|history\|blobs\)'" src/` devolve somente `src/services/records.js:8`. As duas exceções são nominais e documentadas no próprio schema: `settings` em texto claro (`src/services/settings.js:3`) e `meta` (`src/security/auth.js:21`, `:55`).
2. **Só `id`, `createdAt` e `clientId` ficam em claro** (`src/services/records.js:1`, `:7`) porque são as keyPaths (`src/db/idb.js:5-8`).
3. **Toda preparação acontece antes da transação e toda escrita multi-op é um único `db.batch`** (`src/services/clients.js:16-27`, `src/services/debts.js:16-23`, `src/export/backup.js:11-29`); erro de cifra impede qualquer gravação.
4. **Toda escrita em lote é durável**: `durability:'strict'` (`src/db/idb.js:20`, `:28`) e resolução só em `oncomplete` (`src/db/idb.js:18-21`, `:30`).
5. **Todo arquivo novo do bundle entra em `FILES` com incremento de `V`** na mesma mudança (`sw.js:1-2`; hoje `V='sc-v69'` com 52 entradas). Um nome errado faz `c.addAll(FILES)` falhar e congela a instalação (`sw.js:3`).
6. **`h` é injetado.** Existe uma definição (`src/main.js:5`) e ela viaja por `ctx()` (`src/main.js:7`), pela fachada `U` (`src/ui/clients.js:12`) ou por parâmetro (`src/ui/kit.js:8`, `:18`). Nenhum módulo de `src/ui/` redefine o primitivo.
7. **Nenhum segredo no cliente.** `APICPF_API_KEY` aparece apenas em `api/cpf.js:19` e `.env.example:3`; não há bare import em `src/`, `api/` ou `sw.js`; a chave do Google no bundle é identificador público (`src/config/google.js:5`), sem `client_secret`.
8. **Dinheiro é inteiro.** Centavos e taxa em centésimos de ponto, com aritmética de `BigInt` (`src/domain/money.js:1`, `:9`); `interest` é derivado em cada leitura e nunca persistido (`src/services/debts.js:4-5`).
9. **Datas de vencimento são ISO sem fuso** e comparadas em UTC (`src/domain/due.js:2-4`); a entrada as valida por expressão e `Date.parse` (`src/services/debts.js:2`, `:11-12`).
10. **Toda tela expõe exatamente um `header.top[data-page]`** — é o único contrato entre telas e shell (`src/ui/shell.js:52-54`).
11. **Toda leitura exige sessão aberta e toda tela revalida o estado depois do `await`** (`src/security/auth.js:14`; `src/main.js:48`, `src/ui/clientlist.js:32`, `src/ui/debtspage.js:34`, `src/ui/clients.js:130-136`).
12. **`MIGRATIONS` é append-only** (`src/db/idb.js:1`) porque o índice do array é o número da versão (`src/db/idb.js:10`, `:14`).

## 10. Limitações e dívidas arquiteturais

1. **Atualização de cache sem nenhum guardião.** `V` e `FILES` são mantidos à mão (`sw.js:1-2`); em `e78d776` nenhum arquivo de `tests/` menciona `sw.js`, `FILES` ou `V` (grep = 0 ocorrências), `package.json:1` não define `scripts` e não existe `.github/`. O cache-first é absoluto (`sw.js:5`, sem escrita nem revalidação por entrada), portanto um asset pré-cacheado alterado sem bump de `V` fica obsoleto indefinidamente em instalações existentes. A auditoria de bootstrap registrou 4 commits assim (`docs/auditoria/1-bootstrap-navegacao.md` §4.3); não reexecutei git para confirmar.
2. **Ativação agressiva sobre página viva.** `skipWaiting()` (`sw.js:3`) + `clients.claim()` (`sw.js:4`) sem `message` listener (grep: zero) nem UI de "atualização disponível": módulos já avaliados convivem com assets servidos do cache novo — o caso concreto é o `vendor/fflate.min.js` carregado tarde (`src/export/lib.js:2-4`).
3. **Sem plano B para erro HTTP.** `sw.js:5` só cai no `index.html` do cache quando o `fetch` rejeita (rede ausente); um 500/502 da borda é devolvido cru, e uma tela esquecida em `FILES` quebra em silêncio offline (`Response.error()`).
4. **A DEK persiste em disco durante a sessão.** `src/security/auth.js:55` grava o `CryptoKey` em `meta/session`; a remoção é best-effort (`src/security/auth.js:43`, `:56`, `:67`). Não há troca de senha nem rotação de DEK em nenhum lugar de `src/security/`. O `unwrapKey` aceita `m.iter` e `m.salt` do registro sem piso nem teto (`src/security/crypto.js:14`), permitindo downgrade do custo de força bruta para quem puder editar `meta/vault`.
5. **Um registro ilegível derruba a store inteira.** `list()` decifra tudo com `Promise.all` (`src/services/records.js:5`); uma falha de tag GCM num único `data` interrompe a listagem com mensagem crua, sem isolar o item.
6. **Índices existentes são decorativos.** `src/db/idb.js:8` cria o índice `at`, mas `hist()` grava `createdAt` (`src/services/records.js:10`) — o índice nunca é populado. Além disso não há uma única chamada a `.index(`, `openCursor` ou `IDBKeyRange` em `src/`: toda listagem é `getAll` + decifração total + `filter`/`sort` em JS (`src/services/records.js:5`, `src/services/clients.js:36-37`). Escala linear com o volume já cifrado no aparelho.
7. **Não existe integridade referencial.** `saveDebt` aceita `clientId` inexistente (`src/services/debts.js:14-16`), a exclusão em cascata lê em quatro transações antes de gravar (`src/services/clients.js:32-35`) e `validate()` do backup não barra esses estados (`src/export/backup-format.js:20-27`). Em restauração modo merge, um `clientId` não mapeado gera registro sem a chave, invisível por cliente (`src/export/backup.js:24-27` combinado com `src/services/records.js:7`).
8. **Fragilidade numérica na fronteira do backup.** `validate` aceita `principal` fracionário (`src/export/backup-format.js:24`), e `interest` usa `BigInt` (`src/domain/money.js:9`), que lança em não inteiro — um backup restaurado pode tornar a listagem de dívidas injogável. `listDebts` ordena por `date` sem guarda (`src/services/debts.js:6`), lançando `TypeError` conforme a posição do registro defeituoso.
9. **`/api/cpf` é um proxy aberto.** Nenhum controle de origem, sessão ou cota (`api/cpf.js:13-20`; não há `middleware` nem bloco `functions` em `vercel.json`), e o CPF trafega na query string de um GET (`api/cpf.js:15-16`, `src/services/apicpf.js:24`). O desenho da chave no servidor está correto; o que falta é controle de uso e aviso de consentimento.
10. **Duas camadas atravessadas por uma tela.** `src/ui/settings.js:2` (persistência) e `src/ui/settings.js:4` (crypto) são o único caso em que UI fala direto com `db` e `crypto` (ver §2); o teste de integridade (`src/ui/settings.js:30-36`) é a razão, e não há serviço que o abstrai.
11. **Estado compartilhado por closure, não por import.** O singleton `X` de `src/ui/clients.js:2` guarda o último `ctx` e é consumido por lista, formulário e perfil; o `watch` de `src/core/live.js:3` é um slot único. Nenhum dos dois aparece no grafo de dependências, mas ambos ditam a ordem em que telas podem ser montadas.
12. **Cobertura de teste não alcança a arquitetura.** os 7 arquivos `tests/*.test.mjs` de `e78d776` importam apenas domínio, `src/security/crypto.js`, `src/export/*`, `api/cpf.js` e `src/services/search.js`; nenhum importa `src/db/idb.js`, `src/security/auth.js` nem os serviços de escrita (arestas em `deps.md`). Schema, transações, cascata, restauração, reatividade e o contrato cifrado/claro estão sem exercício. Todo o comportamento descrito aqui é **análise estática**: NÃO CONFIRMADO em navegador (nada foi executado em ambiente de execução real nesta revisão).
