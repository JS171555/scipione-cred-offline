# SCIPIONE CRED — Auditoria 1: bootstrap, navegação e camada PWA

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


Escopo: `index.html`, `src/main.js`, `src/core/live.js`, `src/ui/shell.js`, `src/pwa.js`, `sw.js`, `manifest.json` e o mínimo de imports necessário para entender contratos. Modo **read-only**: nenhum arquivo foi modificado (`git status --short` vazio). Branch `main`, HEAD `e78d776`, 64 commits.

Convenção: toda afirmação traz `arquivo:linha`. O que não foi possível confirmar está marcado **NÃO CONFIRMADO** (nada foi executado em navegador; a análise é estática).

---

## 1. Sequência real de boot

### 1.1 O que `index.html` carrega

O documento tem 11 linhas e é denso (linhas longas). Conteúdo relevante:

| Item | Onde | O que faz |
|---|---|---|
| `lang="pt-BR"`, viewport com `viewport-fit=cover` | `index.html:1-2` | Idioma e área segura em iPhone com notch |
| CSP por `<meta http-equiv>` | `index.html:3` | `default-src 'self'`; `script-src 'self' https://accounts.google.com`; `style-src` inclui `'unsafe-inline'`; `connect-src` libera Google APIs e `viacep.com.br`; `object-src/base-uri/form-action` none |
| `<title>SCIPIONE CRED</title>` | `index.html:4` | Título do app (também em `manifest.json:1` `name`) |
| `preload` das duas fontes woff2 | `index.html:4` | `assets/fonts/cormorant-garamond-latin.woff2` e `dm-sans-latin.woff2`, `crossorigin` |
| `theme-color #080808` | `index.html:4` | Idem `manifest.json:1` |
| `description` | `index.html:5` | “Gestão de clientes e controle de dívidas, 100% offline e criptografado.” |
| `<link rel="manifest">` | `index.html:6` | `manifest.json` |
| `preload` de 3 imagens | `index.html:6` | `hat.webp`, `office.webp`, `office-desk.webp` (logo do cofre + duas cenas de login) |
| `icon` 192 + `apple-touch-icon` | `index.html:6-7` | Favicons |
| Metas iOS/desktop | `index.html:8-9` | `apple-mobile-web-app-capable`, `mobile-web-app-capable`, título iOS, status bar `black-translucent` |
| Duas folhas de estilo | `index.html:10` | `css/app.css` (tokens/identidade) e `css/ui.css` (componentes/layout) |
| Corpo | `index.html:11` | `<a class="skip" href="#app">`, `<nav id="nav" hidden>` , `<main id="app" tabindex="-1">` (vazio), `<script type="module" src="src/main.js">` |

Observações de bootstrap: não há `<noscript>` (`grep -c noscript index.html` = 0) nem skeleton — com JS desabilitado a página fica em branco. Também não há nenhum script inline: todo o JS vem de módulos. `index.html` não contém nenhuma marcação de tela; as telas são 100% construídas em DOM via JS (`src/main.js:5` `h()`).

### 1.2 Ordem de import e execução em `src/main.js`

Ordem de avaliação (ES Modules: os efeitos colaterais dos importados rodam antes do corpo do importador):

1. `main.js:1` `import * as A from './security/auth.js'`
2. `main.js:2` `import * as P from './pwa.js'`
3. `main.js:3` import agregado: `./ui/clients.js`, `./ui/dashboard.js`, `./ui/tools.js`, `./ui/settings.js`, `./ui/shell.js`, `./core/live.js`, `./ui/kit.js`. Por transitividade, `ui/clients.js:1` puxa validators/services/auth/debts/clientlist/debtspage/viacep/apicpf/address/live/icons/kit; `ui/settings.js:1-7` puxa auth, `db/idb.js`, `pwa.js`, `security/crypto.js`, `services/settings.js`, `core/live.js`, `ui/icons.js`.
   - Efeito colateral de ordem: `clients.js:4` executa `A.onLock(clean)` durante o import, **antes** de `main.js:61`, logo `clean()` (que chama `unwatch`, revoga object URLs e fecha diálogos) roda antes de `authView` no bloqueio.
   - `core/live.js:2` registra o listener global de `data-changed` no momento do import.
4. `main.js:4-9` definição de `root`, `h()`, `show()`, `ctx()`, `fmt()`, `field()`. `ctx()` (`main.js:7`) é o objeto de contexto compartilhado por todas as telas: `{h, show, fmt, home: appView}`.
5. `main.js:61` `A.onLock(r => authView(false, r==='idle'|'logout' ? aviso : null))` — inscrição no gate de bloqueio.
6. `main.js:62` `P.registerSW()` — **sem `await`**; registro de `sw.js` (contrato em `pwa.js:3`).
7. `main.js:63` IIFE assíncrona de boot — o **gate de autenticação**:
   ```js
   const has=await A.hasVault(); if(has&&await A.restoreSession()){await appView();return} authView(!has)
   ```
   - `A.hasVault()` (`auth.js:17`) lê `meta/vault` do IndexedDB.
   - `A.restoreSession()` (`auth.js:38-48`) só reabre a sessão na **mesma aba** (`sessionStorage` `sc.sid`, `auth.js:5`) e dentro da janela de inatividade; fora disso devolve `false`.
   - Sem cofre → `authView(true)` (criar senha). Com cofre e sessão morta → `authView(false)` (desbloquear). Com cofre e sessão viva → `appView()`.
   - Falha do banco → card de erro local (“Não foi possível abrir o banco local”), sem nav (`main.js:63`).
8. `main.js:65` `initShell({...})` — executada **sincronamente logo após disparar** a IIFE do item 7 (a IIFE cede o thread no primeiro `await`). Ou seja: o shell de navegação é montado enquanto `#app` ainda está vazio.

### 1.3 Primeiro paint e estados bloqueado/desbloqueado

- **Estado bloqueado**: `authView` (`main.js:11-43`). Adiciona `document.body.classList.add('authing')` (`main.js:13`) — CSS correspondente em `css/ui.css:439-440` (layout full-bleed) e `css/ui.css:441` `.auth-shell`. Renderiza visual de login (`main.js:34-41`, com `hat.webp`, `office.webp`, `office-desk.webp`) + formulário. Em setup exige ≥8 caracteres, confirmação e checkbox de ciência (`main.js:19-21`) e chama `A.setup`; em desbloqueio chama `A.unlock` (`main.js:23`). Ao sucesso: `form.reset(); appView()` (`main.js:24`).
- **Estado desbloqueado**: `appView` (`main.js:44-60`). Remove `authing`, chama `unwatch()` e `P.requestPersist()` (`main.js:46`), busca o cartão de painel com `Dash.card({...})` (`main.js:47`, contrato em `ui/dashboard.js:3`), **revalida** `A.isUnlocked()` antes de pintar (`main.js:48` — proteção contra bloqueio durante o `await`) e então `show(header + hero + ...dash + card de Relatórios/Backup)` (`main.js:50-59`). O header da home usa `data-page:'home'` (`main.js:51`).
- **Quem renderiza o shell**: `initShell` (`shell.js:10`) monta `#nav` (`shell.js:28-36`) e injeta o grupo `.util` nos cabeçalhos (`shell.js:37-46`). Ele **não** renderiza telas; observa o DOM de `#app` com um `MutationObserver` + `requestAnimationFrame` (`shell.js:63`) e sincroniza visibilidade/destaque/ícones (`shell.js:47-62`).

Risco derivado do passo 1.2/1.3: como `initShell` roda com `#app` vazio, `sync()` (`shell.js:47`) avalia `auth = !!root.querySelector('.auth,.brand')` como `false` (`shell.js:49`), então `nav.hidden=false` e `body` ganha a classe `shell` (`shell.js:50`) **antes** de `hasVault()`/`restoreSession()` resolverem. O `#nav` (inicialmente `hidden` em `index.html:11`) fica visível por um intervalo igual ao tempo de abertura do IndexedDB. Consequência provável: flash da barra de navegação sobre a tela de login. **NÃO CONFIRMADO** visualmente (não executado em navegador); a cadeia de código é a descrita acima.

---

## 2. Mapa de navegação

### 2.1 Modelo

Não existe roteamento. Confirmado por ausência: `grep -rn "location.hash|pushState|popstate|hashchange" src/ index.html sw.js` não retorna nada. O estado de navegação é **derivado do DOM**: cada tela renderiza um `<header class="top" data-page="…">`, e `shell.js:52-54` lê `root.querySelector('header.top')?.dataset.page` para definir qual item do menu recebe `aria-current="page"`. Não há URL por tela, não há histórico do navegador, não há “voltar” do sistema — o botão Voltar de cada tela chama uma função JS (`clients.js:9-11`, `tools.js:3-4`, `settings.js:12-13`).

Mapeamento literal em `shell.js:53`:

```js
const k=/^client/.test(page)?'clients':/^debt/.test(page)?'debts':page==='bulk'?'clients':page||'home';
```

### 2.2 Todos os itens do menu (`shell.js:28-36`) e o que cada um chama

| Rótulo | `data-k` | Ícone | Handler (`shell.js`) | Função chamada | Tela implementada |
|---|---|---|---|---|---|
| Início | `home` | `home` | `shell.js:31` | `home()` → `main.js:65` passa `home:()=>appView()` | `appView` `src/main.js:44-60` |
| Clientes | `clients` | `users` | `shell.js:31` | `clients(ctx())` | `clientsView` `src/ui/clients.js:13` → `list` `clients.js:16` → `clientList` `src/ui/clientlist.js:4-34` (`data-page:'clients'` em `clientlist.js:26`) |
| Dívidas | `debts` | `wallet` | `shell.js:32` | `debts(ctx())` | `debtsPageView` `src/ui/clients.js:14` → `page` `src/ui/debtspage.js:5-38` (`data-page:'debts'` em `debtspage.js:25`) |
| Relatórios | `reports` | `file` | `shell.js:32` | `reports(ctx())` | `reportsView` `src/ui/tools.js:6-30` (`data-page:'reports'` em `tools.js:21`) |
| Backup | `backup` | `db` | `shell.js:33` | `backup(ctx())` | `backupView` `src/ui/tools.js:31-208` (`data-page:'backup'` em `tools.js:199`) |
| Configurações | `settings` | `gear`, classe `.settings` | `shell.js:35` | `settings(ctx())` | `settingsView` `src/ui/settings.js:15-64` (`data-page:'settings'` em `settings.js:12`) |
| (espaçador, sem rótulo) | — | — | `shell.js:34` | — | `div.sp` visível só ≥768px (`css/ui.css:509`) |
| Bloquear | `lock` | `lock`, classe `.lock` | `shell.js:36` | `lock('manual')` → `A.lock` `auth.js:65-69` | `authView` `src/main.js:11` (avisos em `main.js:61`) |
| Sair | `out` | `logout`, classe `.out` | `shell.js:36` | `lock('logout')` → idem | `authView` `src/main.js:11` com aviso “Sessão encerrada.” (`main.js:61`) |

Todo item de menu é criado por `item()` (`shell.js:16-17`), que anexa `data-i="1"` (marca “já tratado”) e envolve a chamada em indicador de carregamento com tempo mínimo de 320 ms e teto de 1800 ms (`shell.js:13-15`, `css/ui.css:494-496`).

### 2.3 Todas as telas nomeadas na interface

14 telas/estados renderizados em `#app`, mais 1 diálogo modal:

| # | Tela | `data-page` | Implementação | Como se chega |
|---|---|---|---|---|
| 1 | Criar cofre (first run) | — (nav oculta, `shell.js:49-50`) | `authView(true)` `src/main.js:11-43` | boot sem vault (`main.js:63`) |
| 2 | Desbloquear cofre | — | `authView(false)` idem | boot com sessão inválida; `lock('manual'|'logout'|'idle')` (`main.js:61`, `auth.js:64`) |
| 3 | Início / painel | `home` | `appView` `src/main.js:44-60`; cartão em `src/ui/dashboard.js:3-43` | item Início; `home()` como alvo de “voltar” de todas as telas |
| 4 | Clientes (lista) | `clients` | `src/ui/clientlist.js:4-34` | item Clientes; busca da home (`main.js:47` → `clientsView(ctx,q)`); “Ver todos os clientes” (`dashboard.js:33`) |
| 5 | Novo cliente | `new-client` | `form({})` `src/ui/clients.js:17-125`, render em `:124` | botão “Novo cliente” (`clientlist.js:30`) |
| 6 | Editar cliente | `edit-client` | mesma `form(c)` `src/ui/clients.js:17` | botão de edição do perfil (`clients.js:163`) |
| 7 | Perfil do cliente | `client` | `profile(id)` `src/ui/clients.js:129-186` | linha da lista (`clientlist.js:16`), tile do painel (`dashboard.js:18`), “Abrir perfil” (`debtspage.js:21`), `openProfile` exportado (`clients.js:15`, usado em `main.js:47`) |
| 8 | Dívidas (página) | `debts` | `src/ui/debtspage.js:5-38` | item Dívidas; “Ver dívidas” do alerta (`dashboard.js:16`); `openDebts` (`main.js:47`) |
| 9 | Nova dívida | `edit-debt` | `form(U,c,null,back)` `src/ui/debts.js:19-41` | “Nova dívida” (`debtspage.js:28`, `debts.js:7` no perfil) |
| 10 | Editar dívida | `edit-debt` | mesma `form` `src/ui/debts.js:19` | “Editar” (`debtspage.js:21`, `debts.js:16`) |
| 11 | Juros em lote | `bulk` | `bulk(U,back)` `src/ui/debts.js:43-70`, render em `:63` | botão “Juros em lote” (`clientlist.js:30` → `clients.js:16`) |
| 12 | Relatórios | `reports` | `reportsView` `src/ui/tools.js:6-30` | item Relatórios; botão “Relatórios e Excel” (`main.js:59`) |
| 13 | Backup e restauração | `backup` | `backupView` `src/ui/tools.js:31-208` | item Backup; botão “Backup e restauração” (`main.js:59`) |
| 14 | Configurações | `settings` | `settingsView` `src/ui/settings.js:15-64` | item Configurações (`shell.js:35`); engrenagem no cabeçalho (`shell.js:41`) |
| — | Diálogo “Visualizar” imagem de documento | — (fora de `#app`) | `viewImg` cria `<dialog class="viewer">` em `document.body` (`src/ui/clients.js:128`) | botão “Abrir” de documento de imagem (`clients.js:182`) |

Fontes de tela adicionais: a seção de dívidas do perfil é um bloco, não uma tela (`src/ui/debts.js:4-18`); o card “Relatórios e backup” da home (`main.js:57-59`) é um atalho, não uma rota.

### 2.4 Mecanismo de ícones/estilos por texto (acoplamento a observar)

`shell.js:5-9` define `MAP`, uma lista de regexs ancoradas no **texto** do botão → nome de ícone. `shell.js:57-61` aplica o ícone ao primeiro botão sem `data-i`, e marca `.danger` em botões que começam com “Excluir”/“Remover”. Portanto mudar um rótulo de botão (p. ex. “Gerar backup” → “Baixar backup”) troca silenciosamente o ícone; e `MAP` só cobre 18 padrões — rótulos novos ficam sem ícone. Há também um segundo mecanismo de feedback assíncrono: listeners globais de `click`/`submit` (`shell.js:24-26`) que ligam spinner quando o botão fica `disabled`, com teto de 4500 ms (`shell.js:23`).

---

## 3. Estado global (`src/core/live.js`)

O arquivo tem 3 linhas e é inteiro:

```js
// live.js:1  comentário: toda gravação em lote (db.batch) dispara 'data-changed'; a tela ativa registra UM observador
// live.js:2  let cb=null; addEventListener('data-changed',()=>{try{cb?.()}catch(e){console.warn(e)}});
// live.js:3  export const watch=f=>{cb=f}; export const unwatch=()=>{cb=null};
```

- **Não há store, não há estado reativo, não há event bus generalista.** `live.js` é um singleton de um único callback (`cb`) sobre um `Event` global do `window` chamado `data-changed`.
- **Quem emite**: apenas `db.batch` em `src/db/idb.js:30` (`t.oncomplete=()=>{res();dispatchEvent(new Event('data-changed'))}`). `db.put` (`idb.js:24`) e `db.del` (`idb.js:25`) **não** emitem. Exemplos de escrita por `put` sem `data-changed`: `auth.js:21-22`, `auth.js:32`, `auth.js:55`, `settings.js:32`, `auth.js:49` (`setIdle`).
- **Quem consome**: `watch` em `src/ui/clientlist.js:33`, `src/ui/debtspage.js:37`, `src/ui/dashboard.js:37`. `unwatch` em `main.js:12` e `main.js:46` (auth/home), `clients.js:3` (via `clean`), `settings.js:16`, `tools.js:7`, `tools.js:32`. Uma emissão extra do mesmo evento é ouvida em `shell.js:27` (para liberar spinners após 650 ms).
- **Padrão de re-render**: substituição total de `#app`. `show(...)` é `root.replaceChildren(...)` (`main.js:6`), e `clients.js:12`/`:3` envolvem isso em `render()`, que primeiro executa `clean()` (para `watch`, `unwatch`, revoga `URL.createObjectURL` em `clients.js:2-3` e fecha diálogos). Não há diff, não há virtual DOM, não há reconciliação: cada navegação reconstrói a árvore inteira. A tela “ativa” é, na prática, o conteúdo de `#app` mais o último `cb` registrado por `watch`.
- **Outros estados fora de `live.js`**: (a) chave de dados/sessão dentro de closures de `src/security/auth.js:6` (`key,timer,last,mins,sid,saveAt,markAt,subs`), com espelho em `sessionStorage` (`auth.js:5`) e IndexedDB `meta/session` (`auth.js:50-57`); (b) contexto de UI `ctx()` recriado a cada chamada em `main.js:7`; (c) estado por tela em closures locais (`st` em `clientlist.js:5` e `debtspage.js:6`, `histPage` em `clients.js:146`, `mode` em `tools.js:7`); (d) módulo-singleton `X` em `clients.js:2` que guarda o último `ctx` — compartilhado entre lista, formulário e perfil; (e) estado do PWA em `pwa.js:1` (`cbs`, `deferred`); (f) token do Google somente em memória (fora deste escopo; ver `docs/README.md:16`).

---

## 4. Service Worker (`sw.js`)

### 4.1 Identidade e pré-cache

- Nome/chave do cache: `const V='sc-v69'` (`sw.js:2`). Um único cache versionado, sem cache secundário.
- `FILES` (`sw.js:2`): **52 entradas** = 51 arquivos + o marcador de raiz `'./'`. Ordem literal: `./`, `index.html`, `manifest.json`, `css/app.css`, `css/ui.css`, `src/config/google.js`, `src/services/google-drive.js`, `src/ui/icons.js`, `src/ui/shell.js`, `src/ui/kit.js`, `src/main.js`, `src/pwa.js`, `vendor/fflate.min.js`, `src/export/lib.js`, `src/export/xlsx.js`, `src/export/backup-format.js`, `src/export/backup.js`, `src/export/reports.js`, `src/ui/tools.js`, `src/ui/settings.js`, `src/core/live.js`, `src/domain/due.js`, `src/services/search.js`, `src/services/settings.js`, `src/services/dashboard.js`, `src/ui/dashboard.js`, `src/ui/avatar.js`, `src/ui/clientlist.js`, `src/ui/debtspage.js`, `src/ui/debts.js`, `src/services/debts.js`, `src/domain/money.js`, `src/ui/clients.js`, `src/services/clients.js`, `src/services/viacep.js`, `src/services/apicpf.js`, `src/services/records.js`, `src/domain/validators.js`, `src/domain/address.js`, `src/files/process.js`, `src/db/idb.js`, `src/security/crypto.js`, `src/security/auth.js`, 2 fontes woff2, 3 imagens webp, 4 PNGs de ícone.
- Cobertura: todos os `.js` de `src/` estão listados (ver §8.1). Ausentes de forma justificada: `sw.js` (o navegador busca separadamente), `api/cpf.js` (função serverless Vercel, ver `api/cpf.js:1-3` e `.env.example:3`), `vercel.json`, `package.json`, `docs/**` (screenshots), `tests/*.mjs`, `vendor/LICENSES.md`, `.nojekyll`, `.env.example`, `.gitignore`.
- Contrato declarado com o dev no comentário `sw.js:1`: “Ao adicionar arquivos nas próximas etapas: inclua-os em FILES e incremente V.” Repetido em `docs/README.md:21`.

### 4.2 Estratégias

- **install** (`sw.js:3`): `caches.open(V).then(c=>c.addAll(FILES)).then(()=>skipWaiting())`. `addAll` é atômico: **uma única entrada 404 faz a instalação inteira falhar** (o SW fica em `installing`/rejeita). `skipWaiting()` presente → o novo SW ativa imediatamente, sem esperar recarga.
- **activate** (`sw.js:4`): apaga todo cache cujo nome ≠ `V` e depois `clients.claim()` → passa a controlar as abas já abertas sem recarregá-las.
- **fetch** (`sw.js:5`): só `GET`; **cache-first puro**, sem escrita em runtime:
  ```js
  caches.match(e.request,{ignoreSearch:true}).then(r=>r||fetch(e.request).catch(()=>
      e.request.mode==='navigate'?caches.match('index.html'):Response.error()))
  ```
  - Não há `cache.put` em lugar algum do `sw.js`: respostas de rede nunca entram no cache. Consequência boa: nada de dados pessoais (ex.: `/api/cpf?cpf=…`, `viacep.com.br`) é persistido no cache. Consequência dura: **só funciona offline o que estiver em FILES**.
  - Fallback de navegação: em falha de rede de uma requisição `mode==='navigate'`, serve `index.html` do cache (`sw.js:5`). Não há fallback para HTTP 5xx/4xx — o fallback dispara apenas no `catch` do `fetch` (falha de rede/abort). Não há estratégia para `Presentation`/notificações/sync/push; não há listener de `message`.
  - `ignoreSearch:true` na leitura: qualquer requisição com query só pode acertar uma entrada gravada sem query. Como nada é escrito, isso só beneficia `index.html`/assets.

### 4.3 Incremento de versão — evidência em git

O repo tem 64 commits no total; **55** tocaram `sw.js`, e a comparação commit a commit (`git show <c>:sw.js` vs `git show <c^:sw.js`) mostra que **os 55 alteraram a constante `V`** — nenhum commit mexeu em `sw.js` preservando `V`. Extração programática de `V` e do tamanho de `FILES` na história de `sw.js`:

```
d58733d 2026-11-15 Add files via upload                                    V='sc-v10' FILES=42
bd325ed 2026-11-15 Make logo square and configure Vercel deployment        V='sc-v11' FILES=42
0a5c679 2026-11-15 Use the complete uncropped logo artwork                V='sc-v12' FILES=42
2b23ef0 2026-11-15 Fix stacked card spacing and blend login artwork       V='sc-v13' FILES=42
1075512 2026-11-15 Improve toast feedback and auto-dismiss                V='sc-v14' FILES=42
f491a7c 2026-11-15 Hide scrollbars across all devices                     V='sc-v15' FILES=42
fa501ce 2026-11-15 Show client photos in client lists                     V='sc-v16' FILES=43
51b131c 2026-11-15 Add light transitions and loading feedback             V='sc-v19' FILES=43   ← saltou v18
2ef404e 2026-11-15 Add responsive settings page and move system cards     V='sc-v30' FILES=46   ← saltou v29
09ab709 2026-11-16 Rebuild login as an editorial image-led experience     V='sc-v42' FILES=47   ← saltou v41
6884b97 2026-11-16 Add Google Drive backup and restore integration        V='sc-v53' FILES=49   ← saltou v52
87bedb0 2026-11-16 Revert "Align profile action labels to the left"       V='sc-v33' FILES=47   ← regrediu de v34 para v33
fd6bc3c 2026-11-17 Add APICPF validation and reorder client fields        V='sc-v64' FILES=52
40dd7d6 2026-11-17 Group client form into personal data and address…      V='sc-v66' FILES=52
e78d776 2026-11-17 Use the upload glyph and center icon with label…       V='sc-v69' FILES=52   ← HEAD
```

Padrão: incremento manual, sequencial, com saltos ocasionais (ex.: v18, v29, v41, v52) e um retrocesso (`87bedb0`, revert, voltou de `sc-v34` para `sc-v33`). Não há script, hook, CI nem geração automática de V (`package.json` inteiro: `{"type":"module","private":true}`; não há `scripts`). Não há `tests/*.test.mjs` que valide V ou FILES — **NÃO CONFIRMADO** nenhum guardião automatizado (nenhum teste menciona `sw.js`; o único lugar onde `sw.js` aparece em documentação é `docs/README.md:5`, `:21` e `docs/auditoria-ui-ux-codigo.md:13`).

### 4.4 Comportamento offline e atualização

- `index.html` é servido com `Cache-Control: no-cache` (`vercel.json:27-34`) e `/` idem (`vercel.json:17-25`), e `sw.js` com `no-cache, no-store, must-revalidate` + `Service-Worker-Allowed: /` (`vercel.json:5-15`). Isso faz o navegador revalidar o HTML a cada visita e **verificar atualização do SW a cada carga** — a peça que falta para o `skipWaiting()` ter efeito. `README.md:243` descreve isso.
- Risco de cache obsoleto **concretizado**: 4 commits alteraram arquivos que estão em `FILES` **sem** tocar `sw.js`/`V`:

| Commit | Arquivos alterados | Em FILES? |
|---|---|---|
| `ef4b96f` Change Google OAuth clientId | `src/config/google.js` | sim (`sw.js:2`) |
| `ff247af` Update Google OAuth clientId | `src/config/google.js` | sim |
| `922f584` Clarify OAuth project ownership… | `src/config/google.js`, `src/services/google-drive.js`, `src/ui/tools.js`, `docs/google-drive.md` | sim (3 de 4) |
| `ba6227b` Refine mobile profile action alignment | `css/ui.css`, `src/ui/clients.js` | sim (ambos) |

Nesses casos um app já instalado serve o asset velho do cache `sc-vNN` indefinidamente (nada no SW revalida entrada por entrada), porque a URL não tem query e o cache-first (`sw.js:5`) tem prioridade absoluta. Em app aberto no momento da ativação, `skipWaiting()`+`clients.claim()` (`sw.js:3-4`) trocam o cache debaixo de uma página viva: os módulos já importados continuam da versão antiga em memória, enquanto um carregamento tardio pode vir do cache novo — mistura de versões. Dois carregamentos tardios existem de fato: `vendor/fflate.min.js` via `<script>` injetado em `src/export/lib.js:2-4` (usado por `src/export/reports.js:2`,`:20` e `src/export/backup-format.js:4`) e o script do Google Identity Services (`src/services/google-drive.js:57-69`, fora do escopo e fora do cache, falha offline — `google-drive.js:55` trata isso).

---

## 5. Manifest e PWA

### 5.1 `manifest.json` (linha 1, JSON único)

| Campo | Valor | Observação |
|---|---|---|
| `name` / `short_name` | `SCIPIONE CRED` / `SCIPIONE` | `short_name` é o rótulo do atalho no Android |
| `description` | “Gestão de clientes e controle de dívidas, 100% offline.” | difere do `description` do `index.html:5`, que acrescenta “e criptografado” |
| `lang` | `pt-BR` | coerente com `index.html:1` |
| `start_url` / `scope` | `"."` / `"."` | relativos → funcionam em subdiretório (GitHub Pages), como afirma `README.md:258` |
| `display` | `standalone` | |
| `background_color` / `theme_color` | `#080808` / `#080808` | iguais a `index.html:4` e ao token de `css/app.css` |
| `icons` | 192, 512, e 512 `purpose:"maskable"` | os três existem no disco; `apple-touch-icon.png` **não** entra no manifest, é link separado (`index.html:7`) |

Ausentes: `id`, `orientation`, `categories`, `screenshots`, `shortcuts`, `share_target`, `protocol_handlers`. **NÃO CONFIRMADO** se algum deles é exigido pelo público-alvo; nada no código depende desses campos.

### 5.2 `src/pwa.js` — contrato e UI de instalação

- `pwa.js:1-2`: guarda `cbs` e `deferred`; captura `beforeinstallprompt`, chama `preventDefault()` e notifica os callbacks registrados.
- `pwa.js:3` `registerSW()`: registra `'sw.js'` (relativo) se `'serviceWorker' in navigator`, engole falha com `console.warn`. Chamado em `main.js:62` sem `await`.
- `pwa.js:4` `requestPersist()`: pede `navigator.storage.persist()`; chamado a cada entrada na home (`main.js:46`).
- `pwa.js:5` `storageInfo()`: `{persisted, usage, quota}`; consumido em `settings.js:18` e exibido em `settings.js:50-51` (linhas “Armazenamento persistente” e “Espaço usado”).
- `pwa.js:6` `offlineReady()`: considera offline pronto se há SW `active`; exibido em `settings.js:51` como “Funciona offline: Sim / Após o primeiro carregamento”.
- `pwa.js:7-9` `canInstall()` / `onInstallable(f)` / `install()`. `onInstallable` **zera a lista antes de registrar** (`cbs.length=0;cbs.push(f)`) — mantém só o callback mais recente (correção registrada em `docs/auditoria-ui-ux-codigo.md:16`). `install()` chama `deferred.prompt()` e zera `deferred`.
- `pwa.js:10-11` `isStandalone()` (media query `display-mode: standalone` ou `navigator.standalone`) e `isIOS()` (UA + fallback MacIntel com touch).

Onde a UI de instalação aparece: **só** na tela Configurações, card “Instalação” (`settings.js:58`), com o conteúdo pintado por `paintInst` (`settings.js:39`) e assinatura em `settings.js:40`. Três estados: (a) já instalado → texto “O aplicativo já está instalado.”; (b) `canInstall()` → botão “Instalar aplicativo” (que também ganha ícone de download via `MAP` em `shell.js:7`); (c) sem prompt → instrução textual diferenciada para iOS (`isIOS()`) ou navegador desktop/Android. Não existe banner de instalação em outra tela, nem `beforeinstallprompt` tratado fora de `pwa.js:2`. Detalhe: `settings.js:40` descarta a função de descarte retornada por `onInstallable`, então o callback registrado continua apontando para o nó `inst` após sair da tela — inofensivo porque `cbs` é truncado a 1, mas é retenção de referência.

---

## 6. Dependências de terceiros em runtime

| Item | Estado | Evidência |
|---|---|---|
| CDNs de scripts/estilos | **Inexistentes** no bundle. `grep` por `https?://` em `src/`, `css/`, `index.html`, `manifest.json` só retorna: CSP/origens (`index.html:3`), `src/config/google.js:10` (origem autorizada), namespaces XML do `xlsx` (`src/export/xlsx.js:3,10-13`), endpoints de API (`src/services/google-drive.js:6-8`, `src/services/viacep.js:3`), `console.cloud.google.com` como link âncora (`src/ui/tools.js:90`) e SVG `data:` inline em `css/ui.css:99,105` |
| Bibliotecas locais | `vendor/fflate.min.js` (ZIP) — único vendor; carregado **lazy** por injeção de `<script>` e global `window.fflate` (`src/export/lib.js:2-4`); listado em `FILES` (`sw.js:2`); licenças em `vendor/LICENSES.md` |
| Fontes | **Locais**: `assets/fonts/cormorant-garamond-latin.woff2` e `dm-sans-latin.woff2`, declaradas em `@font-face` com `font-display:swap` (`css/app.css:3-4`), preloaded em `index.html:4` e cacheadas (`sw.js:2`). Licenças OFL no próprio diretório. Não há Google Fonts |
| Ícones da UI | SVG inline gerado por `src/ui/icons.js` — 38 nomes definidos em `src/ui/icons.js:2-41`; comentário `icons.js:1` “Sem imagens, fontes ou bibliotecas” |
| Terceiros chamados em runtime (fora do cache) | Google Identity Services `https://accounts.google.com/gsi/client` injetado sob demanda (`src/services/google-drive.js:65`) e APIs REST `www.googleapis.com` / `oauth2.googleapis.com` (`google-drive.js:6-8`); `https://viacep.com.br/ws/` (`src/services/viacep.js:3`); `https://apicpf.com/api/consulta` apenas na função serverless `api/cpf.js:2`. Nada disso é cacheado |
| Build/dependências de produção | Nenhuma (`README.md:158`); `package.json` sem `dependencies` |

---

## 7. Onde modificar X

| Funcionalidade | Arquivo(s) e linha(s) de referência | O que tocar |
|---|---|---|
| **Adicionar uma tela** | `src/ui/<nova>.js` (modelo: `src/ui/tools.js:6-30`); registrar em `index.html`? não; importar em `src/main.js:3`; expor função `X(ctx)`; renderizar com `X.show(...)` e um `header.top` com `data-page:'<chave>'` (padrões em `clients.js:9-11`, `settings.js:12-13`); chamar `unwatch()`/`watch()` como `settings.js:16` / `clientlist.js:33`; **adicionar o caminho em `sw.js:2` `FILES` e incrementar `V`** | se a tela tiver item de menu, ver linha abaixo; se só existir como sub-tela, adicione o prefixo do `data-page` ao mapper de `shell.js:53`, senão o destaque do menu desaparece |
| **Mudar o menu** | `src/ui/shell.js:28-36` (itens, rótulos, ícones, ordem; `item()` em `shell.js:16-17`); destino real de cada clique vem do map de `initShell` (`src/main.js:65`); ícone deve existir em `src/ui/icons.js`; visibilidade/estilos por faixa em `css/ui.css:483-529` (mobile `<768`, rail `≥768`, sidebar `≥1100`); destaque atual em `shell.js:52-54` | para renomear sem quebrar o mapper, mude o rótulo do `item()` mas mantenha `data-k` igual a uma chave aceita por `shell.js:53` |
| **Mudar estratégia de cache offline** | `sw.js:3` (install/pre-cache), `sw.js:4` (limpeza de caches + `clients.claim`), `sw.js:5` (fetch: cache-first, sem runtime write, fallback de navegação) | qualquer mudança aqui exige incrementar `V` em `sw.js:2`; cabeçalhos HTTP de revalidação ficam em `vercel.json:5-34` |
| **Adicionar arquivo ao PWA** | `sw.js:2` `FILES` **+ incremento de `V`** na mesma linha (instrução em `sw.js:1` e `docs/README.md:21`). Se for imagem/font/icon usada no boot, considerar `preload` em `index.html:4-6` e CSP em `index.html:3` (`font-src`/`img-src` são `'self'`/`data:`/`blob:`). Se for asset do manifest, listar também em `manifest.json:1` | um nome errado em `FILES` faz `c.addAll(FILES)` (`sw.js:3`) falhar e o app inteiro ficar sem atualização offline |
| **Mudar título / ícone / tema** | título: `index.html:4` (`<title>`) + `index.html:9` (`apple-mobile-web-app-title`) + `manifest.json:1` (`name`/`short_name`) + texto da marca em `src/main.js:36` e `src/main.js:53` + `src/ui/shell.js:30`. Ícone: arquivos em `assets/icons/*.png` + `manifest.json:1` (`icons`) + `index.html:6-7`; o `logo` visual usado na UI é `assets/img/hat.webp` (`main.js:35`, `main.js:52`, `shell.js:29`). Tema: `index.html:4` (`theme-color`), `manifest.json:1` (`theme_color`/`background_color`) e tokens em `css/app.css` (`docs/README.md:6` lista `#080808`, `#171717`, `#B89A62`, `#E8DFC9`, `#34302A`) | o tema/`theme-color` aparece em **quatro** lugares distintos; todos precisam mudar juntos |
| Contrato de dados (referência, fora do escopo) | `src/db/idb.js:2-9` (`MIGRATIONS`, 5 stores: meta, settings, clients, debts, documents+blobs, history), `idb.js:10` `DB_VERSION`, `idb.js:27-30` `batch` | serviços de dados/criptografia/backup pertencem a outros auditores |

---

## 8. Riscos e inconsistências observados

### 8.1 Checagem automatizada de `FILES` vs disco (resultado real)

Script: `docs/auditoria/check_files.mjs` (parseia `sw.js`, extrai `V` e `FILES`, verifica `existsSync` de cada entrada e varre o disco em busca de `.js/.css/.html/.json/.woff2/.webp/.png` não listados). Saída salva em `docs/auditoria/check_files_output.txt`:

```text
V = sc-v69
FILES count = 52 (inclui "./")
MISSING (em FILES, ausente no disco): nenhum
EXTRAS no disco (código/asset) não listados em FILES:
   ./api/cpf.js 1755B
   ./docs/screenshots/backup-desktop.webp 30728B
   ./docs/screenshots/clients-desktop.webp 23888B
   ./docs/screenshots/clients-mobile.webp 14742B
   ./docs/screenshots/dashboard-desktop.webp 46574B
   ./docs/screenshots/dashboard-mobile.webp 19270B
   ./docs/screenshots/debts-desktop.webp 36560B
   ./docs/screenshots/debts-mobile.webp 12200B
   ./docs/screenshots/login-desktop.webp 81430B
   ./docs/screenshots/login-mobile.webp 26830B
   ./docs/screenshots/profile-desktop.webp 34564B
   ./docs/screenshots/profile-mobile.webp 18618B
   ./docs/screenshots/reports-desktop.webp 46218B
   ./docs/screenshots/settings-desktop.webp 28652B
   ./docs/screenshots/settings-mobile.webp 13454B
   ./package.json 33B
   ./sw.js 1797B
   ./vercel.json 1219B
```

Interpretação: **zero arquivos apontados no cache que não existem** (portanto `c.addAll(FILES)` em `sw.js:3` não falha por 404 neste snapshot). Dos 18 extras, 14 são screenshots de documentação (`ls docs/screenshots | wc -l` = 14) e 3 são infraestrutura do deploy (`sw.js`, `vercel.json`, `package.json`) — todos corretamente fora do cache. `api/cpf.js` é a única peça de código ausente de `FILES`, e é intencional (função serverless; ver `.env.example:3`). Nenhum `src/**.js` está fora de `FILES`: a cobertura de módulos está completa, inclusive os carregados de forma lazy (`vendor/fflate.min.js` está listado, `sw.js:2`).

### 8.2 Riscos ordenados por impacto

1. **Atualização sem bump de `V` (concretizado).** 4 commits (`ef4b96f`, `ff247af`, `922f584`, `ba6227b`) alteraram arquivos pré-cacheados sem incrementar `sc-vNN` (tabela em §4.3). Com cache-first puro e sem escrita em runtime (`sw.js:5`), um app instalado serve o módulo/CSS antigo indefinidamente. Não há verificação automatizada (sem CI, sem teste, `package.json` sem scripts). Mitigação estrutural seria hash no build ou checagem de `V` em CI; hoje o controle é 100% manual e falho.
2. **`aria-current` perdido em 3 telas.** `shell.js:53` ancora as regexs no início do `data-page` (`/^client/`, `/^debt/`), mas os valores reais são `'new-client'`/`'edit-client'` (`clients.js:124`) e `'edit-debt'` (`debts.js:40`). Simulação do mapper: `new-client → 'new-client'`, `edit-client → 'edit-client'`, `edit-debt → 'edit-debt'` — nenhuma dessas chaves corresponde a um `data-k` do menu (`home, clients, debts, reports, backup, settings, lock, out`, `shell.js:31-36`), então o loop de `shell.js:54` remove `aria-current` de todos os botões. Efeito: ao abrir/cadastrar um cliente ou editar uma dívida, o menu fica sem item ativo (perda de orientação e de anúncio para leitor de tela), embora a nav continue visível. Correção mínima: `/client/` e `/debt/` sem âncora, ou normalizar `page.replace(/^(new|edit)-/,'')`.
3. **Flash do shell antes do gate de autenticação.** `initShell` roda em `main.js:65` com `#app` vazio, e `sync()` (`shell.js:47-63`, chamado imediatamente no fim de `:63`) considera `auth=false` porque não há `.auth`/`.brand` no DOM (`shell.js:49`), revelando `#nav` e aplicando `body.shell` antes de `A.hasVault()`/`A.restoreSession()` (`main.js:63`) resolverem. O estado “bloqueado” é inferido por presença de DOM, não por estado de sessão — seria mais robusto usar `A.isUnlocked()`. **NÃO CONFIRMADO** empiricamente (sem execução em navegador).
4. **Ativação agressiva sobre página viva.** `skipWaiting()` (`sw.js:3`) + `clients.claim()` (`sw.js:4`) sem qualquer mensagem de “atualização disponível, recarregue” e sem listener de `message` no SW. Uma aba aberta durante um deploy troca de cache sem recarregar: módulos antigos em memória + `vendor/fflate.min.js` (`export/lib.js:2-4`) e `index.html` servidos do cache novo podem coexistir momentaneamente.
5. **`addAll` é tudo-ou-nada.** Basta uma entrada desatualizada em `FILES` para a instalação falhar em silêncio (`sw.js:3`, sem `.catch`, o `waitUntil` rejeita) e o app ficar preso à versão anterior do cache. O erro só aparece como `console.warn` no `registerSW` de `pwa.js:3`. Não há health-check nem UI de diagnóstico de SW (Configurações mostra apenas `offlineReady()`, `settings.js:18`/`:51`).
6. **Reatividade não cobre escritas unitárias.** `data-changed` é emitido só por `db.batch` (`idb.js:30`). `setIdle` (`auth.js:49`), gravações de `probe` (`settings.js:32`) e escrita de sessão (`auth.js:55`) usam `db.put`/`del` e não disparam refresh. Não é um bug hoje (essas telas usam `unwatch`, `settings.js:16`), mas é uma armadilha para qualquer tela nova que espere live-update de escrita individual. O comentário de `live.js:1` descreve exatamente essa restrição.
7. **Sem fallback de página em HTTP de erro.** `sw.js:5` só cai no `index.html` cacheado quando a requisição de navegação **rejeita** (offline). Um 500/502 da Vercel com rede disponível é devolvido ao navegador como está de erro, sem UI local. E uma tela nova cujo arquivo for esquecido em `FILES` falha com `Response.error()` offline — ou seja, o app abre mas quebra silenciosamente.
8. **Divergência doc ↔ código (breakpoint de navegação).** `docs/README.md:28` afirma “barra inferior até 719 px, rail de 96 px de 720 a 1099 px”. O código usa `@media(min-width:768px)` (`css/ui.css:500`) para o trilho e `min-width:1100px` (`css/ui.css:519`) para o menu lateral. Na faixa **720–767 px** o app está em barra inferior com `.util` visível (`css/ui.css:514` só oculta `.util` a partir de 768 px), contradizendo também `README.md:126-127` (“no tablet e no desktop, acesso pelo item Configurações”). Os `@media(max-width:719px)` de `css/ui.css:300` e `:341` referem-se a outros componentes (perfil/ação), não à nav — provável origem da confusão.
9. **CSP por `<meta>` não cobre `frame-ancestors`.** `index.html:3` é meta CSP; `frame-ancestors` é ignorado em meta por especificação — por isso o `vercel.json:55-57` o define via cabeçalho. Em GitHub Pages (`README.md:130-138`, `README.md:258`) não há cabeçalho, então essa proteção não existe nesse deploy. `script-src 'self' https://accounts.google.com` + `style-src 'unsafe-inline'` (`index.html:3`) abrem a exceção necessária ao Google Identity Services (documentado em `docs/README.md:17`).
10. **Retenções menores de ciclo de vida.** `settings.js:40` ignora o disposer de `P.onInstallable`; `shell.js:25-26` registra listeners em `document` sem nunca remover (só há uma chamada de `initShell`, `main.js:65`, então não vaza hoje); `main.js:63` não trata `visibilitychange`/foco para revalidar sessão — quem trata é `auth.js:11`.
11. **Nada no repo garante consistência entre `V`, `FILES` e disco.** A checagem deste relatório (§8.1) é externa e ad hoc. Não existe teste, script npm ou CI que a rode.

### 8.3 O que não foi possível confirmar

- Comportamento visual (flash do §8.2-3, tempos reais de abertura do IndexedDB, efeito do `aria-busy`): **NÃO CONFIRMADO** — análise estática, nenhuma execução em navegador foi feita nesta auditoria.
- Se os 4 commits sem bump de `V` chegaram a ser publicados em produção (deploy Vercel por push): **NÃO CONFIRMADO** — não há registro de deploy no repositório.
- Presença/ausência de `orientation`, `id`, `shortcuts` no manifest ser necessária para algum requisito de loja/instalação: **NÃO CONFIRMADO** — nenhuma referência no código ou docs.
- Desempenho de `MutationObserver` com `subtree:true` sobre `#app` (`shell.js:63`) em listas grandes: **NÃO CONFIRMADO** — não medido.
