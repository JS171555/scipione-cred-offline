# SCIPIONE CRED — Auditoria de Segurança (AppSec)

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


**Área:** autenticação, criptografia, sessão e superfície de ataque
**Alvo:** `/home/ubuntu/scipione-cred-offline` @ `main` (`e78d776`, 2026-11-17)
**Modo:** somente leitura. Nenhum arquivo foi modificado. Working tree limpo (`git status --porcelain` vazio).
**Auditor:** Especialista em Segurança (AppSec) — subagente
**Data:** 2026-11-17 (UTC-3)

---

## 0. Método e evidências coletadas

Análise estática de todo o `src/`, `api/`, `sw.js`, `index.html`, `vercel.json`, `manifest.json`, `tests/`, `docs/` e `README.md`.

Comandos executados: `git log` (inclusive `--reverse`, `-S`, `-p` por arquivo), `grep`/`rg` sobre todos os sinks de XSS e de armazenamento, `node --check` em `src/**/*.js`, `api/*.js` e `sw.js`, `wc -c index.html`, leitura integral dos módulos citados.

**`node --check`: os 38 módulos de `src/` + `api/` e o `sw.js` (39 no total) aprovados, zero falha de sintaxe.**

Duas verificações *runtime* foram feitas contra a implantação pública (`https://scipione-cred-offline.vercel.app`) para confirmar cabeçalhos e o comportamento da função serverless. Transparência devida:

* `curl -sSI /` e `curl` em `/api/cpf` — apenas cabeçalhos observados.
* Uma sonda `/api/cpf?cpf=11144477735` (CPF de teste estruturalmente válido) **retornou HTTP 200 com corpo de 84 bytes**, o que significa que a função consultou a APICPF e consumiu 1 unidade de cota. O corpo foi descartado (`-o /dev/null`); **nenhum dado pessoal foi coletado ou registrado por esta auditoria**. As demais sondas usaram CPFs rejeitados pela validação local (`cpf=123`, `11111111111`, `<script>11111111111`, sem parâmetro → `422`; `POST` → `405`) e **não** atingiram o upstream.
* `wc -c index.html` = **1956** bytes, idêntico a `content-length: 1956` da resposta ao vivo ⇒ **a implantação reflete o HEAD auditado**; as conclusões abaixo valem para produção.

Convenção: `arquivo:linha` sempre apontando para o código real. Quando algo não foi verificado, está marcado **NÃO CONFIRMADO** ou listado como risco potencial.

---

## 1. Inventário: o que é cifrado e o que fica em claro

Este é o fato-base de toda a auditoria e ele **diverge do marketing habitual de "cofre cifrado"**.

| Store IndexedDB | Conteúdo | Em claro? | Evidência |
|---|---|---|---|
| `clients`, `debts`, `documents`, `history` | registro completo | **Cifrado**, exceto `id`, `createdAt`, `clientId` | `src/services/records.js:7`; índices em `src/db/idb.js:5-8` |
| `blobs` (fotos e documentos) | bytes do arquivo | **Cifrado** (IV + ciphertext + tag) | `src/services/records.js:8-9` |
| `meta` | parâmetros do cofre: `salt`, `iv`, `wrapped` DEK, `iter`, `kdf`, `cipher`, `v` | **Em claro** (necessário) | `src/security/auth.js:21` |
| `meta` | **`session` = a própria DEK (CryptoKey) + `sid` + `last` + `mins`** | **Objeto de chave gravado no disco, sem senha** | `src/security/auth.js:55` |
| `meta` | `guard` (contador de tentativas e `until`) | Em claro, editável por quem tem acesso ao banco | `src/security/auth.js:26,29` |
| `meta` | `probe` (teste de integridade de Configurações, nunca removido) | Cifrado | `src/ui/settings.js:32` |
| `settings` | `idleMinutes`, `dueWindow` | **Em claro** | `src/security/auth.js:21,33,49`; `src/export/backup.js:8` |
| sessionStorage | `sc.sid`, `sc.last` | Em claro (identificadores de sessão) | `src/security/auth.js:34,52,61` |
| localStorage | `scipione.google.oauth` (clientId, projectId, origens) | Em claro — **não contém segredo** | `src/services/google-drive.js:18,45` |

Confirmação positiva: a afirmação do `README.md:263` ("poucos metadados (`id`, `createdAt` e `clientId`) permanecem em claro") **bate com o código**. Um dump do banco revela, portanto, a *quantidade* de clientes, os UUIDs, as linhas de tempo de criação e o grafo dívida/documento/histórico → cliente — mas não nomes, CPFs, valores nem anexos.

---

## 2. Derivação de chave

**Valores numéricos reais verificados no código:**

* Algoritmo: **PBKDF2 com HMAC-SHA-256** — `src/security/crypto.js:6` (`{name:'PBKDF2',hash:'SHA-256',...}`).
* **Iterações: `600000`** — `src/security/crypto.js:4` (`export const ITER=600000;`), usado em `crypto.js:8` (criação) e consumido em `crypto.js:14` via `m.iter` (leitura).
* KDF de saída: **AES-GCM de 256 bits** como KEK — `crypto.js:6` (`{name:'AES-GCM',length:256}`), com `extractable=false` e usos `['wrapKey','unwrapKey']`.
* Salt: **16 bytes**, `crypto.getRandomValues` (`crypto.js:5` `rnd(16)`; usado em `crypto.js:8`), armazenado **em claro** no registro `meta/vault` (`auth.js:21`). Salt por cofre, único por instalação — correto.
* Arquitetura: **envelope de chave** — a senha deriva uma KEK que embrulha uma DEK aleatória gerada por `crypto.subtle.generateKey` (`crypto.js:9`); a DEK (256 bits, `extractable=false`, usos `['encrypt','decrypt']`) cifra os dados (`crypto.js:15`).

**Comparação com OWASP:** a *Password Storage Cheat Sheet* recomenda **600.000 iterações para PBKDF2-HMAC-SHA256**. O app usa exatamente 600.000 ⇒ **conforme com a recomendação atual** (e não apenas "acima de um piso antigo"). Verificado também que o `README.md:262` e `docs/README.md:15` declaram o mesmo número — **alegação verdadeira**. Histórico: `git log -p -- src/security/crypto.js` mostra que `ITER=600000` existe desde o primeiro commit do arquivo (`d58733d`, 2026-11-15); **não há cofres legados com 100k** neste repositório.

**A mesma chave protege todos os stores?** **Sim.** `getKey()` (`auth.js:14`) retorna uma única DEK usada em `records.js:4-10` para `clients`, `debts`, `documents`, `history` e `blobs`, e ainda no `probe` de `settings.js:31-32`. Não existe separação por tipo de dado, por cliente ou por store. Consequência honesta: **uma falha que exponha a DEK expõe 100% do cofre** — não há segmentação nem granularidade de revogação. Isso é aceitável num cofre monolítico de uso pessoal, mas deve ser dito, não implícito.

**Ponto fraco estrutural da derivação:** `openVault` usa `m.iter` lido do próprio banco (`crypto.js:14`) e o backup usa `m.iter` lido do `manifest.json` do arquivo (`backup-format.js:35`), **sem piso nem teto**. Ver §VULNERABILIDADE CONFIRMADA C3. Como efeito colateral, não há qualquer caminho de *upgrade* de parâmetros: se o OWASP subir para 1.000.000, cofres existentes continuam em 600k para sempre (`auth.js:20-22` só cria, nunca re-deriva).

---

## 3. Verificação de senha (desbloqueio)

**Mecanismo: desafio criptográfico real, não verificador de hash.** Não existe hash nem cópia da senha em lugar algum (`crypto.js:2`; confirmado por grep: nenhuma gravação de `pw`). O desbloqueio é validado por `crypto.subtle.unwrapKey('raw', m.wrapped, k, ...)` (`crypto.js:15`): a senha só "está certa" se a KEK derivada conseguir destrancar a DEK, o que a **tag de autenticação do AES-GCM** decide. Uma senha errada produz uma KEK errada, que produz falha de tag, que faz `unwrapKey` rejeitar. Não há comparação de string, não há verifier separável, não há atalho.

**Existe caminho que aceita senha errada?** **Não — nenhum encontrado.** A atribuição `key=await C.openVault(...)` (`auth.js:28`) só escreve em `key` na resolução da promessa; no `catch`, `key` permanece o valor anterior. `key` só é não-nulo após sucesso, e `isUnlocked()`/`getKey()` (`auth.js:13-14`) derivam dele. O estado é redefinido em `lock()` (`auth.js:66`). Também não há "modo offline sem senha", "PIN" ou fallback de decode. Sondas no `setup` (`auth.js:19`) impedem recriação silenciosa do cofre.

**Contagem de tentativas / lockout: **existe como *atraso exponencial local*, e **não** como lockout efetivo. Verificado em `auth.js:26-32`:

* Lê `meta/guard` (`{fails:0,until:0}`), `auth.js:26`.
* Antes de testar a senha, se `until > now`, recusa: `Aguarde N s` (`auth.js:27`).
* Em falha: `g.fails++` e, a partir de 5 falhas, `until = now + min(5000 * 2^(fails-5), 300000)` → 5s, 10s, 20s, 40s, 80s, 160s, 300s (teto) (`auth.js:29`).
* Zera o contador apenas em sucesso (`auth.js:32`). Não há reset por decurso de tempo.

**Limitações confirmadas:** o contador mora no **IndexedDB do próprio atacante** (`auth.js:29`, `db.put('meta',g)`): apagar/reescrever `meta/guard` reinicia o estado; um dump offline do `meta/vault` (`salt` + `wrapped`, `auth.js:21`) permite força bruta em GPU **sem nenhuma intervenção do app**; e `db.put` está dentro do `catch` sem tratamento de erro, então uma falha de escrita deixa o contador em fail-open. O projeto **documenta honestamente** essa limitação em `docs/README.md:9` e `README.md:267` ("o atraso é local e contornável; a defesa principal é o custo do PBKDF2"). Registrar isso é mérito de transparência — mas a UI ainda mostra "Aguarde 300 s" ao usuário desavisado, o que comunica uma proteção que não existe.

**Tratamento de erro — defeito confirmado:** `catch{...throw new Error('Senha incorreta.')}` (`auth.js:28-30`) é **nu**. Qualquer exceção de `openVault` — `m.salt`/`m.wrapped` corrompidos, `m.iter` ausente ou inválido, falha de transação, `DataError` — é rotulada como senha errada **e consome uma tentativa do lockout** (`auth.js:29`). Um usuário cujo banco foi truncado pelo iOS/Safari (`docs/README.md:9`) recebe "Senha incorreta." para a senha correta, e após 5 tentativas entra em espiral de atraso sem nunca ver a causa real. Ver §C4.

**Política de senha: só comprimento.** `main.js:19` exige `length>=8`; nada sobre complexidade, entropia, senhas comuns, comprimento máximo, nem normalização (NFKC/NFC). Uma senha `12345678` é aceita e, offline, 600k iterações de PBKDF2-SHA256 são quebráveis em GPU contra um espaço de senhas humano. A alavanca de entropia está 100% no usuário — e o app não ajuda. O campo usa `autocomplete:'current-password'` (`main.js:9,29`), o que permite ao gerenciador do navegador gravar a senha mestra: decisão de produto defensável, mas aumenta a superfície em dispositivo compartilhado. **NÃO CONFIRMADO:** se o dispositivo-alvo é compartilhado.

**Ausência confirmada: não existe troca de senha / rotação da DEK.** `grep -riE 'trocar senha|alterar senha|changePassword|reencrypt|rewrap'` → **zero ocorrências** em `src/`, `README.md`, `docs/`. O cofre só tem `setup` (`auth.js:18`) e `unlock` (`auth.js:24`). Perder a senha para vazamento (não só esquecimento) exige apagar o cofre e reimportar backup. A arquitetura KEK/DEK **já permite rewrap barato** (trocar só `meta/vault`, sem re-cifrar nenhum registro) — a capacidade existe criptograficamente e não foi exposta. Ver §C6/R6.

---

## 4. AES-GCM

* **Tamanho da chave: 256 bits**, confirmado em `crypto.js:6` (KEK), `crypto.js:9` (DEK via `generateKey({name:'AES-GCM',length:256})`) e `crypto.js:22` (backup). `crypto.js:15` re-importa como AES-GCM. **Nenhum uso de AES-CBC, nenhum modo sem autenticação, nenhum `length:128`.**
* **IV por registro: sim, novo a cada gravação.** `sealBytes` faz `const iv=rnd(12)` **dentro** da função (`crypto.js:17`) — cada chamada gera 96 bits via `crypto.getRandomValues` (`crypto.js:5`). `sealJSON` delega para `sealBytes` (`crypto.js:19`), `enc` chama `sealJSON` por registro (`records.js:7`), `blobOp` chama `sealBytes` por arquivo (`records.js:8`). Não existe IV em escopo de módulo nem IV derivado de contador.
* **IV armazenado com o ciphertext:** sim, prefixado, formato `[12 IV | ciphertext | 16 tag]` (`crypto.js:17` `o.set(iv);o.set(ct,12)`), lido em `openBytes` por `b.slice(0,12)` / `b.slice(12)` (`crypto.js:18`). Padrão correto.
* **Reuso de IV: não encontrado.** O teste `tests/crypto.test.mjs:7` (`assert.notDeepEqual(s,await sealJSON(k,{a:1}))`) cobre justamente isso. Risco residual teórico: IVs aleatórios têm colisão por aniversário após ~2^32 cifrações com a mesma chave; o volume deste app (dezenas a milhares de registros) está ordens de magnitude abaixo do limite do GCM. **Aceitável.**
* **Autenticação de conteúdo e o que acontece na falha, no código real:** a tag GCM faz `crypto.subtle.decrypt` **rejeitar** com `DOMException` (`OperationError`) em caso de adulteração, truncamento ou chave errada. O teste `tests/crypto.test.mjs:6` bit-flipa o último byte e **confirma a rejeição**. A propagação real, porém, é frágil: `openJSON` → `dec` (`records.js:4`) → `list` usa `Promise.all` (`records.js:5`), então **um único registro corrompido faz rejeitar a lista inteira**. Daí:
  * `listClients()` → `clientlist.js:32` (`await Promise.all(...)` **sem `try`**) → rejeição não tratada, `paint()` nunca roda, tela em branco;
  * `stats()` → `dashboard.js:10` idem;
  * onde há `catch`, a mensagem é crua: `main.js:8` (`fmt`) repassa `e.message` do DOMException ao usuário final;
  * caminhos silenciosos: `clients.js:38` (`catch{return}` — foto some e mantém iniciais), `clients.js:139` (`.catch(()=>{})`).
  Ou seja: **detecção é garantida, mas a resposta é ou uma tela vazia sem explicação, ou um erro interno vazio.** Adulterar 1 byte de 1 registro de 1000 é suficiente para indisponibilizar a listagem — um vetor de negação de serviço trivial para qualquer um com acesso ao arquivo do banco. Ver §C5.
* **Limite de entrada:** `openBytes` não valida `b.length>=12`; um `data` truncado produz `IV` curto e a mesma exceção genérica. Sem verificação de formato/tamanho esperado (`crypto.js:18`).

---

## 5. Gerenciamento de sessão

* **Chave em memória:** variável de módulo `key` (`auth.js:6`), retornada por `getKey()` (`auth.js:14`). Nenhum `window.*` global, o que é bom contra conveniência — mas qualquer script same-origin acessa o escopo de módulo por closure/DevTools.
* **Auto-lock existe, e é configurável.** `mins` lido de `settings/idleMinutes` com default 5 (`auth.js:33`, `auth.js:44`, gravado em `auth.js:21`); UI com opções **1/5/15/30 min** (`settings.js:28-29`). Mecanismo: `setTimeout(check, mins*60000)` reiniciado por `pointerdown|keydown|touchstart|scroll` (`auth.js:11`, `auth.js:58-63`) + `visibilitychange` (`auth.js:11`) → `check` (`auth.js:64`) chama `lock('idle')` quando o intervalo expira. **Não há lock imediato ao perder o foco/alternar de aba**: `visibilitychange` invoca `check()`, que, dentro da janela, chama `touch()` e **reinicia o relógio** (`auth.js:64`). Consequência prática: a tela destravada (nomes, CPFs, valores, fotos) permanece legível na janela do navegador por até 30 minutos após o usuário se afastar, e a troca de aba não protege — só adia. Em dispositivo compartilhado, é a ameaça mais provável de todas (§10).
* **Bloqueio manual: presente e em três lugares.** Botão "Bloquear" e "Sair" na navegação (`shell.js:36`), ícones no cabeçalho (`shell.js:42-43`), e "Bloquear agora" em Configurações (`settings.js:54`). Ambos invocam `lock(reason)` (`auth.js:65`).
* **O que `lock()` faz:** `key=null`, cancela timer, limpa `sc.sid`/`sc.last` do sessionStorage, remove listeners, **deleta `meta/session`** e notifica assinantes (`auth.js:66-68`). O gate de UI em `main.js:61` mostra a tela de desbloqueio com a causa (`idle`/`logout`/`manual`).
* **O que vaza em IndexedDB ao bloquear — e aqui está o achado mais grave da área de sessão:** o `db.del('meta','session')` de `auth.js:67` é **fire-and-forget**: não é `await`ed (a função é síncrona) e o `.catch(()=>{})` engole qualquer falha. Duas consequências confirmadas: (a) entre o `lock()` e o commit da transação (`idb.js:24-25`, `durability:'strict'`) a DEK continua no disco; (b) se o delete falhar (quota, abort, aba fechada antes do `oncomplete`), **a DEK fica gravada indefinidamente** e ninguém avisa. Não existe `pagehide`/`beforeunload` que limpe a sessão (grep: nenhuma ocorrência) ⇒ fechar a aba destravada deixa `meta/session` no banco; a limpeza ocorre apenas de forma **oportunistica** na próxima inicialização, quando `restoreSession` valida o `sid` (`auth.js:41-43`). A janela fecha-se, mas só se o app for reaberto com JS executivo; um atacante que interrompa o bootstrap (`debugger`, `Pause on start`, requisição bloqueada no SW) mantém o estado antigo. O mesmo `saveSession` **reescreve a DEK no disco a cada 1,8 s** (`auth.js:50-56`) — persistência agressiva de material de chave em repouso.
* **Reassunção de sessão sem senha:** `restoreSession` (`auth.js:38-48`) retoma o cofre **sem pedir a senha** quando o `sid` do sessionStorage bate com o `sid` do registro e `Date.now()-seen < mins*60000` (`auth.js:42-46`). Recarregar a página na mesma aba (`F5`) reabre o cofre sozinho — o `README.md:116` apresenta isso como funcionalidade ("Sessão mantida ao recarregar a página"). É a mesma moeda de `auth.js:55`: a chave está no disco, o `sid` é o token de posse, e **os dois residem no mesmo perfil de navegador** — não há canal separado, binding a biometria, nem verificação de segunda fator. Proteções positivas: `sid` novo por desbloqueio (`auth.js:34`, `newSid` com `crypto.randomUUID` ou `getRandomValues` — `auth.js:10`); validação defensiva de que o objeto persistido é mesmo uma `CryptoKey` AES-GCM (`auth.js:42`); guardas contra corrida em `saveSession` (`auth.js:54-56`, relê `key`/`sid` após o `put`); ao expirar o prazo, o registro é removido (`auth.js:43,46`).
* **Listeners `onLock`: existem e são corretamente assinados.** `auth.js:16` (registro), `main.js:61` (gate de autenticação), `avatar.js:12` (`clearClientPhotos`), `clients.js:4` (`clean`). O gate de renderização é legítimo: `shell.js:49-50` esconde a navegação quando a tela `.auth/.brand` está presente, e **a proteção real não é a UI** — é `getKey()` lançar (`auth.js:14`), o que torna os botões de navegação inofensivos com o cofre trancado. Guardas de sessão em telas assíncronas: `main.js:48`, `dashboard.js:9,11`, `clientlist.js:32`, `clients.js:130-136`, `settings.js:19` — confirmam a correção alegada em `docs/auditoria-ui-ux-codigo.md:9`.
* **Retenção de dados decifrados:**
  * `avatar.js:5` mantém `Map` de object URLs; `clearClientPhotos` revoga todas, limpa `urls`/`pending` e incrementa `epoch` para descartar respostas em voo (`avatar.js:6-11`), assinado em `onLock` (`avatar.js:12`) — **boa prática, e o caso que a auditoria anterior alegava corrigido (`docs/auditoria-ui-ux-codigo.md:10`) está de fato tratado**.
  * `clients.js:3-5` guarda array `urls` e `clean()` revoga; `A.onLock(clean)` (`clients.js:4`). O array é **module-level e não esvazia quando a tela é trocada por caminhos que não chamam `render`** — atenuado pelo `splice(0)` em `clean()`.
  * **Janela de object URLs vivas:** `export/lib.js:5` (`save`) revoga após **60 s**; `clients.js:144` (PDF em nova aba) e `clients.js:145` (download) após **120 s**; `lib.js:5` idem. Durante esse intervalo, qualquer script same-origin (ou DevTools) pode reencontrar a URL no DOM e reler o documento/Blob **já decifrado**. Não é exploit remoto, é retenção desnecessária.
  * `apicpf.js:3` (`CACHE` 30 min) e `viacep.js:4` (`cache` sem TTL) acumulam PII de terceiros em memória **sem limpeza em `onLock`** — baixo impacto (dados redundantes com o cadastro), mas é retenção pós-bloqueio.
  * `records.js:5` + `clients.js:17,36,37`: **todas as listagens descriptografam a store inteira** a cada operação (`listClients()` é chamada dentro de `saveClient` para checar duplicidade — `clients.js:17`). O volume total de PII em texto puro existe no heap JavaScript de forma recorrente, não apenas sob demanda.

---

## 6. Repositório de credenciais e tokens

* **Token OAuth do Google: só em memória, nunca persistido.** `let token=null` (`google-drive.js:14`), atribuído apenas dentro do callback do `initTokenClient` (`google-drive.js:101-103`), usado como `Authorization: Bearer ${token}` (`google-drive.js:134`), e zerado por `resetAuth()` (`google-drive.js:19`, `115`, `139` em 401). Grep confirma: `token` não aparece em `localStorage`, `sessionStorage`, IndexedDB nem em log (`google-drive.js` não tem `console.*`). A doc `docs/README.md:16` e `README.md:277` dizem o mesmo — **alegação verdadeira**. Consequência honesta: recarregar a aba exige reconexão, o que também significa que **não há refresh token nem cookie** — superfície mínima.
* **Escopo: mínimo.** `SCOPE='https://www.googleapis.com/auth/drive.file'` (`google-drive.js:8`), que restringe o app a arquivos que ele mesmo criou; reforçado por `appProperties:{app:'SCIPIONE CRED'` (`google-drive.js:154,187`) e filtro `f.appProperties?.app===APP` (`google-drive.js:171`). A alegação em `google-drive.js:2-3` e `docs/README.md:16` **confere**.
* **Expiração:** o app confia em `expires_in` e antecipa 60 s (`google-drive.js:103`), com `isConnected()` revalidando por relógio (`google-drive.js:29-32`) e `401 → resetAuth` (`google-drive.js:139`). **Ponto fraco de sessão:** `lock()` do cofre **não desconecta o Drive** (sem chamada a `G.disconnect` em `auth.js:65-69` nem em `main.js:61`) — o token de acesso sobrevive ao bloqueio na memória da aba, disponível para qualquer código same-origin enquanto a aba viver. Ver §C1-adjacente / R1.
* **`client_secret`: não usado nem armazenado — confirmado.** O tipo "installed" é recusado explicitamente (`google-drive.js:39-40`) e `parseClientJson` devolve **apenas** `{clientId, projectId, type, origins}` (`google-drive.js:41`), de modo que o `localStorage.setItem(STORE, JSON.stringify(c))` de `google-drive.js:45` **não pode** persistir um segredo, mesmo que o usuário importe um JSON com `client_secret`. `.gitignore` ainda bloqueia `client_secret*.json` e `.env*` (verificado), e `git log --all --diff-filter=A --name-only` **não mostra nenhum arquivo de segredo adicionado na história**. O que vai para `localStorage` (`clientId`, `projectId`, `origins`) é informação pública por natureza. `src/config/google.js:5-10` contém `clientId`, `projectId` e origem reais — aceitável para cliente OAuth "Web" (não-confidencial por design), mas o projectId fica exposto e serve de isca para phishing de "troque o JSON".
* **Superfície de indução a JSON malicioso:** o app aceita importar um arquivo do Google Cloud escolhido pelo usuário (`tools.js:80-85`) e passa a roteiar backups para o `clientId` dele (`google-drive.js:22` `getConfig()`), com UI que detecta divergência e oferece "Usar cliente atual" (`tools.js:70-73`). Não é XSS, é **configuração substituível por quem tem o aparelho destravado** — redireciona a OAuth para um projeto do atacante e os backups para a conta dele. Mitigação parcial: a OAuth continua exigindo consentimento humano do Google (`google-drive.js:109`).
* **APICPF `X-API-KEY`: corretamente do lado do servidor** — `process.env.APICPF_API_KEY` apenas em `api/cpf.js:19,26`; `.env.example:22` com valor vazio; zero ocorrências no bundle do navegador (grep). Ver §C2 sobre o *proxy aberto*, que é o problema real aqui.

---

## 7. Superfície XSS

**Varredura completa de sinks** (grep sobre todo o repositório, incluindo `index.html`, `manifest.json`, `vercel.json`, `sw.js`, `vendor/`, `tests/`):

`innerHTML` → **0 ocorrências**. `outerHTML` → 0. `insertAdjacentHTML` → 0. `document.write` → 0. `eval()` → 0. `srcdoc` → 0. `javascript:` → 0. Handler inline vindo de dados → 0. `new Function` → **1 ocorrência, em `tests/backup.test.mjs:2`** (carrega o UMD local `vendor/fflate.min.js` em Node, fora do app). `vendor/fflate.min.js` e `sw.js`: 0 ocorrências de `innerHTML`.

**O app usa exclusivamente criação de nós.** O helper é `main.js:5`:

`const h=(t,a={},...k)=>{const e=document.createElement(t);for(const [n,v] of Object.entries(a)){if(n.startsWith('on')) e.addEventListener(n.slice(2),v); else if(v!==false&&v!=null) e.setAttribute(n, v===true?'':v)} e.append(...k.flat().filter(x=>x!=null&&x!==false)); return e}`

* Strings viram **nós de texto** via `append` (nunca parsing de HTML) — é isso que torna seguro injetar `c.name`, `d.name`, `x.notes` etc. como filhos (`clients.js:160`, `clients.js:180-181`, `tools.js:18`, `dashboard.js:20`).
* `src/ui/kit.js` é consistente com isso: `filePicker` escreve o nome do arquivo por `name.textContent = f?f.name:text` (`kit.js:13`); `pager` usa `String(n)` (`kit.js:33`) e `replaceChildren` (`kit.js:38`); `initials` só fatia texto (`kit.js:3`).
* Limpeza por `replaceChildren` (`main.js:6`, `settings.js:46`, `clients.js:41`, `tools.js:49`), não por `innerHTML=''`.
* `setAttribute` nunca recebe nome de atributo derivado de dado: todos os call sites passam objeto literal (`grep` de atributos espalhados retornou apenas `...a` de **listas de nós**, `h('input',{id,...a})` em `debts.js:21` com `a` literal de código, e `{value:f.id,...}` em `tools.js:176`). Não há `style:` vindo de dado (`grep` vazio); o único `.style.` é `settings.js:24` (CSSOM, valor literal `'none'`/`''`).
* **`javascript:` como URL construída:** inexistente. Os `href`/`src` do app são literais (`tools.js:90` `https://console.cloud.google.com/...` com `rel:'noopener noreferrer'`; `shell.js:29` e `main.js:35-41` assets locais; `avatar.js:26` e `clients.js:41,139` `blob:`), e `window.open('about:blank')` (`clients.js:143`) é o único `window.open`. `postMessage`/`message` listener: **0 ocorrências** (nada a cassar).

**Avaliação dos dados controláveis pelo usuário (vetores pedidos):**

| Dado controlável | Onde é usado | Vetor |
|---|---|---|
| Nome do arquivo (`file.name` → `orig`) | `clients.js:42` (gravado), `kit.js:13` (`textContent`), `clients.js:127` (`fname` → `download`), `clients.js:180` (título via `append`) | **Nulo para XSS.** Só texto ou nome de download. `fname` usa `d.orig` cru quando o MIME não está em `EXT` (`clients.js:126-127`) ⇒ confusão de tipo de arquivo, não execução |
| Fotografia (`photoId`/`photoType`) | `clients.js:38,139`; `avatar.js:19` → `new Blob([b],{type})` + `<img src=blob:>` | **Não executável**: `<img>` com blob de tipo forjado não roda script. `createImageBitmap`/canvas re-encode em `process.js:11-14` neutraliza payloads de parser para fotos (recomprime para WebP/JPEG, `maxSide` 512/1600) |
| Documento (`d.type` vindo de `file.type`, cliente-controlado em `process.js:8-9`) | `clients.js:144`: se `application/pdf` ⇒ `w.location.href = blob:` (**navegação same-origin** para conteúdo de arquivo); botão "Abrir" só aparece para `application/pdf` ou `image/*` (`clients.js:182`) | **Melhor vetor identificável.** Um blob: herda a origem do documento que o criou ⇒ um documento ativo de mesmo-origem teria acesso a IndexedDB e a `meta/session`. Chrome/Firefox renderizam PDF no viewer isolado (origem `chrome-extension://…`), e o MIME declarado `application/pdf` faz o navegador tratar como PDF — **por isso classifico como risco, não como vulnerabilidade confirmada**: **NÃO CONFIRMADO** em browser-alvo real (não executei prova de conceito) |
| CEP/endereço/telefone/e-mail/RG/observações | `clients.js:106` (`.value=` do ViaCEP), `clients.js:88` (`.value=` da APICPF), `clients.js:45-46` (`.value.trim()`), render sempre como texto | **Nulo.** Preenchimento por `.value`/`textContent`; nenhum parsing HTML |
| Nome/`detail` do histórico | `clients.js:152` via `append`; `tools.js:18` (`x.notes`) em célula de texto | **Nulo.** |

**Veredito de XSS:** superfície **baixa e bem construída**, com duas ressalvas honestas: (1) o helper `h()` transforma qualquer chave começando por `on` em listener (`main.js:5`) — um futuro `h('input',{...dadosDoUsuario})` criaria handler a partir de dado; um whitelist de atributos fecharia essa porta. (2) **Não há Trusted Types** (`require-trusted-types-for 'script'` ausente em `index.html:3` e `vercel.json`) nem `nonce`/hash por script, então a defesa é 100% estrutural/disciplinar — a CSP de `index.html:3` ainda permite `'unsafe-inline'` em `style-src`, o que habilita CSS-injection/exfiltração por seletor em cenários avançados (baixo aqui, pois não há dados em atributos de estilo).

---

## 8. Cabeçalhos e CSP (transcrição literal de `vercel.json`)

```
/sw.js            Cache-Control: no-cache, no-store, must-revalidate
                  Service-Worker-Allowed: /
/                 Cache-Control: no-cache
/index.html       Cache-Control: no-cache
/(.*)             X-Content-Type-Options: nosniff
                  Referrer-Policy: no-referrer
                  X-Frame-Options: DENY
                  Cross-Origin-Opener-Policy: same-origin-allow-popups
                  Content-Security-Policy: frame-ancestors 'none'
```
(`vercel.json:3-62`; `outputDirectory: "."` em `vercel.json:61`.)

**Confirmação: a instrução do escopo está correta — o CSP do header contém apenas `frame-ancestors 'none'`, sem `default-src` e sem `script-src`** (`vercel.json:55-56`). Isso foi verificado **ao vivo**: `content-security-policy: frame-ancestors 'none'` na resposta de `/` e também na de `/api/cpf`.

**Confirmação em `index.html`: existe uma CSP rica, mas ela é uma *meta tag*, `index.html:3`:**

```
default-src 'self'; script-src 'self' https://accounts.google.com;
style-src 'self' https://accounts.google.com 'unsafe-inline'; font-src 'self';
img-src 'self' data: blob:;
connect-src 'self' https://accounts.google.com https://www.googleapis.com https://oauth2.googleapis.com https://viacep.com.br;
frame-src https://accounts.google.com; object-src 'none'; base-uri 'none'; form-action 'none'
```

Leitura de `index.html` para o que a CSP precisa acomodar: **um único `<script type="module" src="src/main.js">` (`index.html:11`) — nenhum script inline, nenhum `onclick=` inline, nenhum `style=` inline, nenhum `eval`;** dois `<link rel="stylesheet">` locais (`index.html:10`), `preload` de fontes com `crossorigin` (`index.html:4`), e `manifest.json` com `start_url`/`scope` relativos (`manifest.json:1`). A CSP de meta é **coerente com o tráfego real** do app: `google-drive.js:6-7` (`www.googleapis.com`), `google-drive.js:65` (`accounts.google.com/gsi/client`), `viacep.js:3` (`viacep.com.br`), `apicpf.js:24` (`/api/cpf`, same-origin), `avatar.js:26`/`clients.js:41` (`blob:` em `img-src`). Não falta nenhuma origem funcional — e não sobra nenhuma permissiva além de `'unsafe-inline'` em estilos.

**Avaliação crítica do arranjo:**

1. **Quando o documento principal é servido, a proteção existe de fato.** Header e meta CSP são **ambos** aplicados pelo navegador (interseção). Logo, `script-src 'self'` está em vigor para `index.html`, mesmo ausente do header. O risco não é "não há mitigação de XSS" — há, e é boa.
2. **Onde o header é a única política, não há `script-src`.** Respostas servidas pelo mesmo origem **sem** a meta: `api/cpf.js:6-11` (`application/json`, `Cache-Control: no-store`) e qualquer documento gerado/intermediado por terceiros. Um JSON não é executável; mas **páginas de erro/redirect geradas pela plataforma, listagens ou um deploy futuro de HTML sem a meta ficam sem restrição de script.** É uma falha de *defense-in-depth*, não uma breach explorável hoje.
3. **A meta CSP não pode impor `frame-ancestors`** (o browser ignora essa diretiva em `http-equiv`) — por isso o header atual é exatamente o que a meta não consegue entregar. Ou seja: **a divisão é funcional e deliberada, não um esquecimento** — mas é frágil por documentação: basta alguém editar `index.html` sem perceber que *ali* mora o hardening real. E há um cenário concreto de perda: `docs/auditoria-ui-ux-codigo.md:23` admite que no **GitHub Pages** os headers não existem; nesse canal, além de cair o `frame-ancestors`/`X-Frame-Options`, tudo passa a depender de a meta tag estar presente.
4. **Imprecisão de alegação confirmada:** `docs/auditoria-ui-ux-codigo.md:14` afirma que a correção foi "`X-Frame-Options: DENY` e `frame-ancestors 'none'` **no Vercel**" e "CSP com `object-src 'none'`". `object-src 'none'` **não está no header** — só em `index.html:3`. A tabela da auditoria anterior mistura os dois canais. Ver §C7.
5. **Presente e correto:** `X-Content-Type-Options: nosniff` (mitiga um `blob:`/upload interpretado como script), `Referrer-Policy: no-referrer` (evita vazar `?cpf=` como referrer — ver §C2/P2), `X-Frame-Options: DENY` + `frame-ancestors 'none'` (cliqujacking), `COOP: same-origin-allow-popups` (necessário para o popup OAuth de `google-drive.js:109`), `Service-Worker-Allowed: /` + `no-store` no `sw.js`, HSTS ao vivo (`strict-transport-security: max-age=63072000; includeSubDomains; preload`, default da Vercel, **não** declarado em `vercel.json`).
6. **Ausentes:** `Cross-Origin-Resource-Policy`, `Permissions-Policy` (câmera/mic/geolocalização não são negados — qualquer script injetado poderia pedir câmera; o app em si nunca pede), `Report-To`/`report-uri`/`Reporting-Endpoints` (sem telemetria de violação), `Trusted-Types`, `X-DNS-Prefetch-control`, `Clear-Site-Data` (relevante §10), `require-trusted-types-for`. Observação ao vivo: `access-control-allow-origin: *` aparece no `/` estático (comportamento default da Vercel para assets) — **NÃO CONFIRMADO** o impacto além do óbvio (arquivos públicos legíveis cross-origin; nenhum segredo neles). Ver §P5.
7. **Service worker (`sw.js:5`)**: *cache-first* com `ignoreSearch:true` sobre a lista `FILES` de `sw.js:2`; **não há `caches.put` em tempo de execução**, logo nenhuma resposta dinâmica (nem `/api/cpf?cpf=…`) entra no cache — **não há poisoning de cache nem vazamento de PII em Cache Storage**, o que era um risco óbvio nesse padrão. Fallback de `index.html` só para `mode==='navigate'` (`sw.js:5`), conforme alegado em `docs/auditoria-ui-ux-codigo.md:13`. Ressalva: o cache não tem integridade (sem SRI/hash), então um host/CDN comprometido serve JS alterado e a CSP de `'self'` não ajuda. Ver §P9.

**Classificação do item:** **VULNERABILIDADE CONFIRMADA (Baixa)** pela lacuna do header + alegação documental imprecisa; **não** crítica porque a meta CSP de `index.html:3` cobre o documento principal.

---

## 9. Função serverless `api/cpf.js`

* **Exposição da `APICPF_API_KEY`:** correta. `process.env.APICPF_API_KEY` (`api/cpf.js:19`) usada apenas no header `X-API-KEY` do request interno (`api/cpf.js:26`). Ausente → `503 {ok:false,reason:'UNAVAILABLE'}` (`api/cpf.js:20`), sem revelar a configuração. Zero `console.*` no arquivo (grep: apenas `src/core/live.js:2`, `src/pwa.js:3`, `src/ui/tools.js:90` que é texto de UI) ⇒ **nada é logado pela função**; o segredo não aparece no corpo, em cabeçalho de resposta, nem em mensagem de erro.
* **Validação de entrada: boa e verificada.** `digits()` extrai só `[0-9]` (`domain/validators.js:1`), e `api/cpf.js:17` recusa se `length!==11 || !validCPF` (`validators.js:2-3`, com bloqueio de dígitos repetidos `^(\d)\1+$`) → `422`. Confirmado **ao vivo**: `?cpf=123` → 422; `?cpf=11111111111` → 422; `?cpf=%3Cscript%3E11111111111` → **422** (injeção neutralizada pela normalização, e o CPF nunca chega ao upstream com caracteres estranhos). Saída estritamente normalizada por whitelist de tipos/valores (`api/cpf.js:32-36`, com `['M','F','I']` e `typeof === 'string'`) e **nenhum campo extra do upstream é repassado** — boa contenção de resposta. `URL` construída com base absoluta (`api/cpf.js:15`) em vez de `req.url` crua.
* **CORS:** a função **não** emite `Access-Control-Allow-Origin` (confirmado ao vivo nos headers da resposta de `/api/cpf`) ⇒ um site arbitrário no navegador **não consegue ler** o resultado. Mas isso **não protege contra nada não-browser**: `curl` leu 200 sem problema (ver §0).
* **Cache/segredo em logs:** `Cache-Control: no-store` (`api/cpf.js:9`) impede cache intermediário do resultado com PII — correto. Ressalva séria: **o CPF viaja na query string** (`api/cpf.js:16` lê `searchParams`), e as URLs de requisição são o principal conteúdo dos logs de acesso de plataforma serverless. O `docs/apicpf.md:36` alega que "a função serverless não registra a chave nem os dados retornados" — verdade quanto ao *código*, **NÃO CONFIRMADO** quanto à plataforma (Vercel Observability retém a URL da requisição). `Referrer-Policy: no-referrer` (`vercel.json:41`) não afeta logs de servidor. Ver §P2.
* **Rate limit / autenticação do chamador: **não existe nenhuma.**** O único gate é `req.method!=='GET'` (`api/cpf.js:14`). Não há controle de origem (`Origin`/`Sec-Fetch-Site`), nonce, cookie de sessão, challenge, captcha, chave por instalação, trava por IP, nem cota global. O resultado: **a função é um proxy aberto e gratuito para um serviço de terceiros pago**, consultável por qualquer pessoa na internet, a partir de qualquer IP, sem credencial, contra **qualquer CPF** — inclusive CPFs que o dono do cofre não conhece. Consequências: (a) esgotamento da cota (plano gratuito: 100 consultas/dia e 6/min, `docs/apicpf.md:32`, informação de terceiros); (b) custo financeiro se o plano for pago; (c) a chave do proprietário serve de **credencial compartilhada anônima** para consulta de dados pessoais de terceiro, o que tem leitura LGPD desconfortável; (d) a própria função é um *oracle* que confirma se um CPF tem registro na base da APICPF (200 vs 422, `api/cpf.js:38-39`). **Confirmado empiricamente** pela sonda ao vivo (HTTP 200, corpo de 84 bytes sem qualquer credencial ou header de navegador). Ver §C2.
* **Timeout e falha silenciosa:** `AbortController` com 8 s (`api/cpf.js:4,22-23,27`), `clearTimeout` em `finally` (`api/cpf.js:46`) — correto. `401/402/403/429/timeout` viram um genérico `503 UNAVAILABLE` sem detalhe do upstream (`api/cpf.js:41-44`), comportamento intencional e documentado (`docs/README.md:19`, `docs/apicpf.md:22`): não vaza estado do plano nem mensagens do provedor, e o cadastro segue manual.

---

## 10. Backup e restauração (apenas o ângulo de segurança)

* **Senha e iterações do backup criptografado:** PBKDF2-HMAC-**SHA-256 com 600.000 iterações** (`src/export/backup-format.js:5` — `ITER=600000`, declarado e efetivamente usado em `backup-format.js:17` `deriveAesKey(password,salt,ITER)` e no `manifest.json` escrito em `backup-format.js:18`) → **mesmo custo do cofre**, conforme OWASP. Salt **novo de 16 bytes** por backup (`backup-format.js:17` `rnd(16)`, gravado em hex no manifest). Chave final: **AES-GCM 256** (`crypto.js:22`). Mínimo de senha: 8 caracteres (`tools.js:38` e `tools.js:134`, local e Drive) — mesma política fraca do cofre. **Boa prática:** a senha do backup é **independente** da do cofre (`backup-format.js:3`, `tools.js:42,186`) e a DEK/KEK/salt do cofre **não entram no backup** (`backup-format.js:3`) — um backup não compromete o cofre do aparelho nem vice-versa. Criptografia de backup usa uma chave direta da senha (não envelope) — aceitável aqui, porque o backup é um artefato autônomo.
* **O zip pode vazar dados? Sim, e por decisão explícita.** Com a caixa "Criptografar" desmarcada, o ZIP contém `data/clients.json`, `data/debts.json`, `data/documents.json`, `data/history.json`, `data/settings.json` e **todos os bytes de `files/<id>.bin`** em claro (`backup-format.js:12-16`, `manifest.json` com `encrypted:false`). Mitigação presente: um `confirm()` com texto forte ("conterá **todos os dados e documentos em formato legível**", `tools.js:39` local e `tools.js:135` Drive), o aviso permanente no rodapé (`tools.js:203`), **e o nome do arquivo distingue os modos** (`scipione-cred-backup-…-criptografado.zip`, `tools.js:41,139`) — três camadas de bom senso. A opção *enviada ao Google Drive* sem senha (`tools.js:135-140`) é o caso mais sensível: PII de terceiros sobe para a nuvem em claro. O próprio projeto registra isso como aceito em `docs/auditoria-ui-ux-codigo.md:27`. Ver §R11.
* **Validação de integridade: presente, em quatro camadas.**
  1. SHA-256 de cada arquivo interno gravado no manifest na criação (`backup-format.js:11`, `add`) e reverificado na leitura (`backup-format.js:40`), com rejeição de **arquivo ausente ou diferente**;
  2. rejeição de **entrada inesperada** no zip (`backup-format.js:39`) e de `manifest.json` que não seja do app (`backup-format.js:31`);
  3. recusa de formato de **versão mais nova** (`backup-format.js:32`) — previne restaurar backup de build futuro com schema desconhecido;
  4. tag GCM sobre o `payload.enc` inteiro (`crypto.js:18` em `backup-format.js:35`) ⇒ o backup criptografado é autenticado; senha errada ou arquivo alterado viram o mesmo erro (abaixo).
  Adicional no canal Drive: `sha256` gravado em `appProperties` e **recomputado no download** (`google-drive.js:183,187,208-216`), conferência de `size` nas duas pontas (`google-drive.js:199-202`, que **apaga** o upload se o tamanho divergir, e `google-drive.js:213-214`), além da checagem de formato do hash antes de aceitar o arquivo (`google-drive.js:209`). **Nível de integridade acima da média** para um app deste porte.
* **Confusão "senha errada / arquivo corrompido":** `backup-format.js:35` envolve o `openBytes` num `catch{}` que lança `BAD_PASSWORD` com a mensagem única "Senha do backup incorreta **ou arquivo corrompido**" — a ambiguidade aqui é *deliberada* (não revela ao atacante se a senha bateu) e está bem documentada em `tools.js:49` ("Verificar arquivo" antes de restaurar). **Boa prática não óbvia.**
* **Válvula de downgrade (grave, §C3):** a leitura usa `m.iter` e `m.salt` **diretamente do manifest fornecido pelo arquivo**, sem piso (`backup-format.js:35`: `deriveAesKey(password,unhex(m.salt),m.iter)`). Consequências exploráveis: (a) um zip forjado com `iter:1` transforma a UI de restauração num **oracle de força bruta de custo quase nulo** contra a senha do backup — o atacante distribui o arquivo, a vítima digita a senha real, e o resultado "senha incorreta" do teste com `iter:1` é verificável offline pelo atacante em segundos com regras de dicionário, sem precisar de 600k iterações por guess; (b) `unhex` aceita string de qualquer comprimento e `salt` não é validado; (c) `iter` sem teto permite **travar a aba** (PBKDF2 com `iter` = 10^11 congela a main thread dentro de `deriveKey`, `crypto.js:22`) antes de qualquer `confirm()` (`tools.js:47`). **Confirmado no código**; o cenário (a) depende de a vítima abrir um zip de terceiros, o que a UI incentiva ("Verificar arquivo", `tools.js:44-50`).
* **Restauração é transacional e não destrutiva por acidente:** tudo é preparado e cifrado antes, e a troca acontece em `db.batch` com `durability:'strict'` (`backup.js:29`, `idb.js:27-30`) — `replace` apaga e reescreve numa única transação (`backup.js:15-18`), com `confirm()` específico de destruição (`tools.js:47,161`) e mensagem "Nada foi alterado. ..." em falha (`tools.js:48,164`). Não há *zip path traversal* possível: `unzipSync` só devolve um objeto em memória (`backup-format.js:29`) e nada toca disco — **confirmado**.
* **Conteúdo restaurado entra no banco sem sanitização de texto**, mas com validação estrutural (`backup-format.js:20-27`: ids, FK de `clientId`, `principal>0`, `rate>0`, presença de blobs). Como a renderização é 100% por `textContent`/`append` (§7), **um backup malicioso não produz XSS** — produz, isto sim, dados falsos/PII alheia no cofre legítimo e MIME/nomes controlados (§C10). Nota: a restauração **não** exige cofre pré-existente nem re-autenticação (só a sessão destravada), então é uma rota de *data injection* para qualquer pessoa com o aparelho destravado.

---

## 11. Ameaças específicas deste modelo (sem romantizar)

Enunciado do escopo: *não afirmar segurança por causa do uso de criptografia*. Segue a leitura dura.

**a) Pessoa com acesso físico ao dispositivo/app — a ameaça dominante.**
* **Com o cofre destravado: proteção nenhuma.** Toda a PII (nome, CPF, RG, nascimento, telefone, e-mail, endereço completo, dívidas, juros, histórico) e **todas as fotos e documentos** estão acessíveis na tela e no heap. Não há *re-auth* para operações destrutivas (excluir cliente `clients.js:42`, restaurar `replace` `tools.js:47`, enviar ao Drive `tools.js:131`), não há bloqueio por biometria/WebAuthn, e o auto-lock **só opera por relógio de inatividade** (§5). Um `lock()` **não** limpa o token do Google (auth.js:65-69) nem a memória de `apicpf.js:3`/`viacep.js:4`.
* **Com o cofre trancado:** a defesa real é (i) PBKDF2 600k por guess, (ii) a qualidade da senha do usuário, (iii) o fato de a senha nunca estar armazenada. O "lockout" é decorativo (§3). Uma senha de 8 caracteres alfanuméricos humanos é factível em GPU. Não há limite de tentativas *efetivo*, não há alerta de violação, não há detecção de tampers, não há `Clear-Site-Data`/wipe após N falhas. O iOS pode ainda **evadir** tudo ao apagar dados de sites não instalados em ~7 dias (`docs/README.md:9`) — perda total, não ataque.

**b) DevTools com o app destravado.** Acessa `key` no escopo de módulo (`auth.js:6`) via closure, chama `getKey()`, pode ler todas as stores já decifradas (`records.js:4-5`), e **não precisa da senha**: `await indexedDB.open('scipione-cred')…get('meta','session')` devolve uma `CryptoKey` **usável** — `extractable:false` impede extrair os bytes, **não impede o uso** de `crypto.subtle.decrypt`. Consequência que precisa ser dita com todas as letras: **`crypto.js:2` ("DEK é não extraível") comunica uma proteção mais forte do que a realidade em cenário de mesmo-origem.** A chave é não-extrável mas é **não-revocável e utilizável por qualquer script da origem enquanto o registro existir**. Não há proteção: isso é inerente a criptografia client-side, e o `docs/README.md:9` admite. **Ressalva honesta:** a mitigação barata existe (§C1) e ainda não foi aplicada — ver R1.

**c) Dump do IndexedDB (cópia dos arquivos / roubo do perfil).**
* Registros cifrados: **resistente**, mas apenas até a senha ser quebrada offline. Um dump **enquanto há sessão ativa** entrega `meta/session.dek` ⇒ decrypt completo no navegador, sem quebrar nada.
* Mesmo sem sessão ativa, o dump **revela metadados estruturais em claro**: quantidade de clientes, UUIDs, timestamps de criação, vínculo dívida↔cliente (`idb.js:5-8`, `records.js:7`, `README.md:263`), a configuração de inatividade (`meta/settings`/`settings`), o `clientId` OAuth e as origens (`localStorage`). É o suficiente para dizer *"fulano mantém N operações de crédito, a mais recente em tal data"* — dado pessoal por si só sob LGPD, e um *timing oracle* para engenharia social.
* Não há **qualquer** detecção de alteração: nada authenticate o bundle, nada marca `meta/vault` substituído, e `meta/guard` pode ser apagado (`auth.js:26`).

**d) Ransomware / exclusão maliciosa.** Praticamente **nenhuma proteção**:
* A exclusão de cliente é um clique + `confirm()` de texto (`clients.js:42`), a restauração `replace` apaga tudo com um `confirm()` (`tools.js:47`, `backup.js:15`) e **não há lixeira, soft-delete, versão anterior, undo nem confirmação forte (digitar nome)** em nenhuma rota destrutiva (grep: zero ocorrências). `db.batch` é atômico (§10), o que ajuda integridade mas não defesa lógica.
* Não há backup automático/agendado: `backupView` é 100% manual (`tools.js:37-42`), o `requestPersist()` (`pwa.js:4`) não impede exclusão, e o `sw.js:2` **precacheia assets mas não protege dados**. Um atacante com o aparelho destravado pode restaurar um zip antigo e válido (ou um forjado conforme §C3) e substituir o cofre inteiro.
* Não existe qualquer proteção contra *wipe* do site pelo navegador (Clear browsing data derruba IndexedDB + sessionStorage; nada é replicado no servidor — por design, `README.md:264`). A única defesa real contra ransomware/exclusão é o usuário manter cópias fora do aparelho. Ver R11.

**e) Ameaças que a arquitetura, de fato, mitiga bem** (para calibrar, não para vender): exfiltração passiva do conteúdo em repouso (disco, snapshot, backup em nuvem do SO, sincronização de perfil), leitura do `blobs` (fotos/PDF) sem senha, e interceptação de rede do conteúdo (HTTPS + HSTS ao vivo, `connect-src` restrito, `no-store` na função). Não há telemetria — confirmado: **zero chamadas de saída além das quatro origens intencionais** (`google-drive.js:6-7,65`, `viacep.js:3`, `apicpf.js:24`, `api/cpf.js:25`).

---

## 12. VULNERABILIDADES CONFIRMADAS

Todas com evidência `arquivo:linha` e cenário de exploração. Ordem de severidade.

### C1 — (Alto) A DEK do cofre é persistida no IndexedDB e sua remoção no bloqueio não é garantida
**Evidência:** `src/security/auth.js:55` (`db.put('meta',{key:'session',sid:s,dek:k,...})`), `src/security/auth.js:67` (`db.del('meta','session').catch(()=>{})` dentro de `lock()` síncrono), `src/security/auth.js:43` (limpeza só oportunística na próxima inicialização), `src/security/auth.js:53` (reescrita a cada 1,8 s). Ausência confirmada de `pagehide`/`beforeunload` (grep em `src/` e `sw.js`). Uso real da chave persistida: `restoreSession` faz `key=s.dek` (`auth.js:47`) sem senha.
**Por que "confirmada":** não é inferência — o objeto de chave em si está gravado na origem, no store `meta` não cifrado (`idb.js:3`), e o código o reutiliza como credencial de sessão.
**Cenário:** *(1)* Qualquer script same-origin (um XSS futuro, uma extensão com page-context, o `javascript:` do console) executa `indexedDB.open('scipione-cred')` → `get('meta','session')` → `crypto.subtle.decrypt(...)` com `data` de `records.js` e obtém todo o cofre em claro **sem senha e sem interação do usuário**. *(2)* Dono destrava o cofre, um erro de transação ou o fechamento da aba impede o delete do registro → a chave fica no disco até a próxima abertura bem-sucedida do app, sem qualquer sinal. *(3)* Atacante com o dispositivo e o histórico de abas do Chrome: `Ctrl+Shift+T` restaura aba com sessionStorage **e** encontra `meta/session` no disco → cofre aberto dentro da janela de inatividade, sem senha. **Severidade: Alta** (não é remota, mas anula a premissa central do produto em origem-same e persiste material de chave em repouso).

### C2 — (Alto) `api/cpf.js` é um proxy aberto, sem autenticação de chamador e sem rate limit
**Evidência:** `api/cpf.js:14` (único gate é o método), `api/cpf.js:16-17` (valida CPF mas não valida *quem*), `api/cpf.js:19-26` (lê o segredo do ambiente e consulta a APICPF), `docs/apicpf.md:32` (plano gratuito: 100/dia, 6/min). **Verificado ao vivo:** `GET /api/cpf?cpf=11144477735` de `curl`, sem header de navegador nem credencial, retornou **200** com corpo de 84 bytes; as demais sondas retornaram 422/405 conforme o esperado.
**Cenário:** script rodando `for cpf in 00000000000..99999999999: GET /api/cpf?cpf=…` a partir de um IP rotativo → consome a cota diária do dono (negando a funcionalidade ao app legítimo, que **silencia** o erro por escolha: `api/cpf.js:41-42` + `docs/apicpf.md:22`), gera custo em plano pago, e usa a chave do dono para consultar PII de CPFs alheios e como **oracle de existência de registro** (200 vs 422, `api/cpf.js:38-39`). A CSP, o `Referrer-Policy` e a ausência de `Access-Control-` não impedem nada disso (clientes não-browser). **Severidade: Alta** (exploração remota trivial, impacto financeiro e LGPD; não afeta o cofre).

### C3 — (Médio) Parâmetros do KDF (`iter`, `salt`) vêm de dado não autenticado, sem piso nem teto — downgrade de força bruta e DoS
**Evidência:** `src/security/crypto.js:14` (`kek(pw, m.salt, m.iter)` com `m` do IndexedDB); `src/export/backup-format.js:35` (`deriveAesKey(password, unhex(m.salt), m.iter)` com `m` do `manifest.json` do zip). `unhex` (`backup-format.js:6`) aceita string de qualquer comprimento; nenhuma comparação com `ITER` de `backup-format.js:5`; nenhum clamp. O manifest externo do backup criptografado **não é autenticado antes** do uso de `m.iter` (`backup-format.js:33-35` só checa `m.encrypted`).
**Cenário:** adversário distribui (ou planta no Drive/`Arquivos`) um `.zip` que se passa por backup com `{encrypted:true, salt:"<32 hex>", iter:1, payload.enc:<bytes aleatórios>}`. A UI oferece "Verificar arquivo" (`tools.js:44-49`) antes de qualquer confirmação destrutiva. A vítima digita sua senha do backup; o teste com `iter:1` falha; o adversário, dono do arquivo, reproduz o teste offline com um dicionário de milhões de senhas **sem o custo das 600k iterações** e recupera a senha. Variante de DoS: `iter:100000000000` congela a aba em `deriveKey` (`crypto.js:22`) antes de todo `confirm()` (`tools.js:47`). Para o cofre, o mesmo `m.iter` editável em `meta/vault` permite a quem escreve no banco rebaixar o custo por guess. **Severidade: Média** (baixo custo de correção, explorável por arquivo de terceiros — canal que o app ativamente incentiva).

### C4 — (Médio) Desbloqueio trata erro de integridade/banco como "senha incorreta" e queima tentativas de lockout
**Evidência:** `src/security/auth.js:28` (`try{key=await C.openVault(pw,m)}catch{ ... g.fails++; ... throw new Error('Senha incorreta.')}`) — `catch` sem inspeção de `name`/tipo; contagem e atraso em `auth.js:29-30`; escrita do guard com `.catch` ausente (falha silenciosa, fail-open).
**Cenário:** `meta/vault` truncado, `wrapped` alterado, `iter`/`salt` corrompidos, transação abortada (`idb.js:21`) ou `QuotaExceededError` → usuário que digita a senha **correta** recebe "Senha incorreta." cinco vezes e depois fica sob atraso crescente (`until`) sem diagnóstico possível; o erro real é destruído pelo `catch{}`. Em combined com §11(c), um atacante que edite `meta/vault` tem como negar o acesso do dono com uma única escrita. **Severidade: Média** (disponibilidade + suporte cego).

### C5 — (Médio) Falha de autenticação GCM em um único registro derruba a leitura da store inteira, sem mensagem
**Evidência:** `src/security/crypto.js:18` (decrypt rejeita em adulteração — comportamento correto); `src/services/records.js:4-5` (`dec` propaga e `list` usa `Promise.all`, sem `allSettled`); ausência de `try` em `src/ui/clientlist.js:32` (`[cs,ds]=await Promise.all([S.listClients(),DS.listDebts()])`) e `src/ui/dashboard.js:10` (`await stats()`); `src/main.js:8` (`fmt` repassa `e.message` cru). Caminhos silenciosos: `src/ui/clients.js:38` (`catch{return}`), `src/ui/clients.js:139` (`.catch(()=>{})`). Cobertura do teste existente: `tests/crypto.test.mjs:6` prova a detecção mas não a experiência de falha.
**Cenário:** bit-flip de 1 byte em 1 de 500 registros (ou um blob faltando) ⇒ `paint()` nunca roda, o usuário vê lista vazia sem aviso, e o rejection não tem handler no console; alternativamente, `err.textContent` mostra o texto interno do `DOMException`. A adulteração **é detectada** (o bom), mas a resposta do app é indisponibilidade muda — e indistinguível de "usuário não cadastrou nada", o que é perigoso num produto de controle financeiro. **Severidade: Média** (integridade preservada, disponibilidade e confiabilidade comprometidas).

### C6 — (Médio) Não existe troca de senha nem rotação da DEK; também não há upgrade de parâmetros de KDF
**Evidência:** `grep -rniE 'trocar senha|alterar senha|mudar senha|changePassword|reencrypt|rewrap'` em `src/`, `README.md`, `docs/` → **zero ocorrências**; a API de `auth.js` só expõe `setup` (`auth.js:18`), `unlock` (`auth.js:24`), `lock` (`auth.js:65`); `crypto.js` só tem `createVault` (`:7`) e `openVault` (`:13`) — nenhum rewrap. `iter` é gravado uma vez (`crypto.js:11`) e sempre relido de `m.iter` (`crypto.js:14`).
**Cenário:** senha suspeita de vazamento (digitada em outro aparelho, vista por alguém, reutilizada) ⇒ a única reação possível é apagar o cofre e reimportar backup, perdendo histórico se não houver cópia. E se a OWASP elevar o piso (1M), cofres antigos permanecem em 600k indefinidamente. A arquitetura envelope (`crypto.js:6-16`) torna o rewrap barato: trocar 1 registro `meta/vault`, **sem re-cifrar nenhum dado**. **Severidade: Média** (governança de credencial, custo de exploração alto, ausência verificada).

### C7 — (Baixo) O header CSP de produção só tem `frame-ancestors`; o hardening real está em meta tag — e a documentação atribui isso ao Vercel
**Evidência:** `vercel.json:55-56` (header = `frame-ancestors 'none'`), `index.html:3` (CSP completa em `http-equiv`), `vercel.json:38-53` (demais headers presentes), `docs/auditoria-ui-ux-codigo.md:14` ("CSP com `object-src 'none'`; ... **no Vercel**"), `docs/auditoria-ui-ux-codigo.md:23` (GitHub Pages sem headers). **Verificado ao vivo** nas respostas de `/` e `/api/cpf`: `content-security-policy: frame-ancestors 'none'` somente; HSTS presente por default da Vercel, não pelo repo.
**Cenário/impacto:** onde o header é a única política (respostas de `/api/cpf`, páginas de erro/redirect da plataforma, qualquer HTML servido sem a meta) não há restrição de script; em deploy no GitHub Pages (§`docs/auditoria:23`) caem `frame-ancestors` e `X-Frame-Options` (a meta **não pode** entregar `frame-ancestors`), sobrando apenas o que está em `index.html:3`. Impacto prático hoje é **baixo** (a meta protege o documento principal; não há XSS conhecido — §7), mas é *single point of failure* disciplinar e a alegação documental está errada quanto ao canal. **Severidade: Baixa.**

### C8 — (Baixo) Blob/object URLs de dados **decifrados** permanecem válidas por 60–120 s
**Evidência:** `src/export/lib.js:5` (`setTimeout(()=>URL.revokeObjectURL(u),6e4)`), `src/ui/clients.js:144` (PDF em nova aba, `12e4` ms), `src/ui/clients.js:145` (download, `12e4` ms). Em contraste, os ciclos de vida guiados por `onLock` estão corretos: `src/ui/avatar.js:7-12`, `src/ui/clients.js:3-4`.
**Cenário:** usuário baixa um comprovante e bloqueia o cofre; durante até 2 minutos, o `blob:` continua no `src`/DOM de elementos vivos e em `about:blank` recém-aberto, e script same-origin/DevTools pode reler o documento. Baixo: exige acesso à origem/destravado, e `URL.createObjectURL` usa UUID não-adivinhável. **Severidade: Baixa** (higiene).

### C9 — (Baixo) MIME e nome de arquivo do usuário são confiados sem verificação de conteúdo, e o caminho "Abrir" navega num `blob:` de mesma origem
**Evidência:** `src/files/process.js:8` (`type:file.type||'application/octet-stream'` — tipo **do cliente**, apenas regex de imagem em `:9`); `src/ui/clients.js:144` (`w.location.href = blob:` quando `d.type==='application/pdf'`); `src/ui/clients.js:127` (`fname`: usa `d.orig` cru se o MIME não está em `EXT`); gate do botão em `src/ui/clients.js:182`; `accept=` do `file input` em `src/ui/clients.js:142` (adversário de UI, não controle).
**Cenário:** um documento gravado (ou **restaurado de um zip de terceiros**, §10) com `type` e `orig` forjados gera download com nome/tipo incoerentes (ex.: `nota.html` com conteúdo real HTML sob MIME `application/octet-stream`) — vetor de engenharia social clássico; e a rota "Abrir" faz navegação `blob:` mesma-origem para conteúdo controlado. Em Chrome/Firefox o MIME declarado `application/pdf` evita execução (o **NÃO CONFIRMADO** aqui é o comportamento em Safari e em versões antigas — nenhuma PoC foi executada, por restrição de não escrever dados). **Severidade: Baixa.**

### C10 — (Baixo) O atraso anti-tentativas é local, apagável e inócuo, mas é apresentado ao usuário como proteção
**Evidência:** `src/security/auth.js:26` (estado em `meta/guard`, **no banco do alvo**), `auth.js:27` (mensagem `Aguarde N s`), `auth.js:29-30` (cap em 300 s, sem reset temporal, sem wipe). Como a senha não é armazenada em lugar nenhum (`crypto.js:2`, gravação em `auth.js:21`), a ofline é conduzida contra o `meta/vault` (`salt` + `wrapped` + `iter`, `crypto.js:11`). Admissão do próprio projeto: `docs/README.md:9`, `README.md:267`.
**Cenário:** atacante com o aparelho remove `meta/guard` (ou restaura um snapshot do banco / usa cópia dos arquivos para rodar hashcat fora do navegador) e desfaz o único controle interativo. **Severidade: Baixa como falha, mas é o item que mais desinforma o usuário final** — a tela sugere que a senha está "protegida contra tentativas".

---

## 13. RISCOS POTENCIAIS (dependem de suposição não verificada)

| # | Risco | Suposição NÃO verificada | Onde atuaria |
|---|---|---|---|
| P1 | Custo real e plano da APICPF; se a cota compartilhada (§C2) é financeira ou só funcional | Painel da Vercel/APICPF fora do escopo | `api/cpf.js:19-26` |
| P2 | **O CPF aparece nos logs de acesso da plataforma** (URL com query string), contrariando a leitura de `docs/apicpf.md:36` ("não registra... os dados") | Retenção de logs da Vercel Observability; nenhum `console.log` no código (confirmado) | `api/cpf.js:16`, `src/services/apicpf.js:24` |
| P3 | Uso em **dispositivo compartilhado** (funcionário, familiar) — a ameaça dominante do §11(a,b) | Perfil de uso real; nenhum controle de sessão multiusuário existe | `auth.js:6-48` |
| P4 | Deploy no GitHub Pages elimina os headers (§C7) e a função serverless | Destino de produção efetivo | `README.md:255-259`, `docs/auditoria:23` |
| P5 | `access-control-allow-origin: *` observado ao vivo em `/` (default Vercel para assets) vira problema se um arquivo público futuro contiver segredo | Qual origem exata da Vercel aplica o header, e a política de arquivos | `vercel.json:36-59` |
| P6 | Extensões de navegador com `debugger`/host permissions usando a DEK persistida sem a senha | Conjunto de extensões instaladas no aparelho-alvo | `auth.js:55` |
| P7 | Senha mestra fraca escolhida pelo usuário (mínimo 8, sem checagem de entropia/dicionário, sem normalização NFKC) | Hábitos do usuário; nenhum medidor existe | `src/main.js:19`, `crypto.js:6` |
| P8 | `settings/idleMinutes` e `meta/*` editáveis por quem tem o banco (valor arbitrário de `mins` ⇒ `setTimeout` de horas, ou `guard.until` no futuro ⇒ negação de acesso) | Se a barreira "acesso ao banco" é considerada aceitável no modelo | `auth.js:33,60,64`, `auth.js:26-27` |
| P9 | Ausência de SRI/hash sobre `vendor/fflate.min.js` e sobre os assets precacheados ⇒ host/CDN comprometido serve JS alterado (e a CSP de `'self'` não ajuda) | Integridade da Vercel e do repositório | `src/export/lib.js:2-4`, `sw.js:2-3` |
| P10 | iOS/Safari apagar IndexedDB de site não instalado em ~7 dias (perda total de dados) | Aparelho-alvo e se o app é instalado | `docs/README.md:9`, `pwa.js:4` |
| P11 | `autocomplete:'current-password'` (`src/main.js:29`) permitir que o gerenciador do navegador grave a senha mestra | Política do produto sobre gerenciadores | `src/main.js:9,29` |
| P12 | Restauração de backup malicioso injeta PII falsa/anexos no cofre legítimo sem nova autenticação | Interesse/oportunidade de distribuir zips | `tools.js:44-50`, `backup.js:12-29` |
| P13 | Navegação `blob:` de PDF com conteúdo forjado executar script em mesma origem em algum browser-alvo (Safari/legados) | **NÃO CONFIRMADO**; nenhuma PoC executada | `src/ui/clients.js:144` |
| P14 | Colisão de IV aleatório por aniversário com a mesma DEK | Volume real de cifrações por instalação (teórico) | `crypto.js:17` |

---

## 14. BOAS PRÁTICAS PRESENTES (verificadas, com evidência)

1. **Envelope de chave KEK→DEK** com DEK aleatória gerada por `crypto.subtle.generateKey` e embrulhada pela KEK derivada: `crypto.js:6,8-16`. Senha nunca armazenada: `crypto.js:2`, `auth.js:20-21`.
2. **PBKDF2-HMAC-SHA256 com 600.000 iterações** — igual à recomendação OWASP atual: `crypto.js:4`; mesma força no backup: `backup-format.js:5,17`.
3. **AES-GCM-256** em todos os caminhos de dados: `crypto.js:6,9,15,17,22`; nenhum modo não autenticado.
4. **Salt de 16 bytes de CSPRNG por cofre e por backup**, IV de 12 bytes **novo por gravação**, prefixado ao ciphertext: `crypto.js:5,8,17`; `backup-format.js:17`. Zero `Math.random` (grep: nenhuma ocorrência).
5. **Sem reuso de IV e com detecção de adulteração, ambos cobertos por teste**: `tests/crypto.test.mjs:6-7`; não-extratabilidade testada: `tests/crypto.test.mjs:8`.
6. **Verificador criptográfico em vez de comparação de senha**: só `unwrapKey` bem-sucedido libera a chave; nenhuma rota aceita senha errada: `auth.js:28`, `crypto.js:15`.
7. **Gates de sessão antes de renderizar** em todas as telas assíncronas: `main.js:48`, `dashboard.js:9,11`, `clientlist.js:32`, `clients.js:130-136`, `settings.js:19`; e a proteção real é `getKey()` lançar quando trancado (`auth.js:14`), não apenas esconder a UI (`shell.js:49-50`).
8. **Auto-lock implementado e configurável (1/5/15/30 min)** com listeners de atividade + `visibilitychange`: `auth.js:11,33,58-64`; `settings.js:28-29`; bloqueio manual em três pontos: `shell.js:36,42-43`, `settings.js:54`.
9. **Revogação de object URLs no bloqueio** (caso clássico de retenção de texto puro): `avatar.js:6-12` (com `epoch` para descartar respostas em voo), `clients.js:3-4`.
10. **Superfície XSS estruturalmente mínima:** zero `innerHTML`/`eval`/`srcdoc`/`javascript:`/`document.write` no app; DOM só por `createElement`/`setAttribute`/`append`/`replaceChildren` (`main.js:5,6`, `kit.js:8-38`); `textContent` para nomes de arquivo (`kit.js:13`).
11. **CSP rica e correta no documento:** `script-src 'self' https://accounts.google.com` sem `unsafe-inline`/`unsafe-eval`, `object-src 'none'`, `base-uri 'none'`, `form-action 'none'`, `frame-src` restrito, `connect-src` com allowlist exatamente igual às origens que o app usa, `img-src … blob:` para os avatares: `index.html:3` vs `google-drive.js:6-7,65`, `viacep.js:3`, `apicpf.js:24`, `avatar.js:19`.
12. **Headers de proteção presentes no header:** `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `COOP: same-origin-allow-popups` (`vercel.json:38-56`), todos confirmados na resposta ao vivo; `sw.js` com `no-cache, no-store, must-revalidate` (`vercel.json:5-14`).
13. **OAuth do Google exemplar para um app de navegador:** escopo mínimo `drive.file` (`google-drive.js:8`), `client_secret` recusado no import e nunca persistido (`google-drive.js:39-41,45`), token apenas em memória sem refresh (`google-drive.js:14,19,101-103`), revogação no disconnect (`google-drive.js:114-116`), 401 derruba o token (`google-drive.js:139`), timeouts em todas as chamadas (`google-drive.js:68,94,129,196,211`).
14. **Integridade de backup acima da média:** SHA-256 por arquivo na criação e verificação na leitura (`backup-format.js:11,40`), rejeição de entrada inesperada (`backup-format.js:39`), rejeição de formato mais novo (`backup-format.js:32`), tag GCM sobre o payload (`backup-format.js:17,35`); no Drive, hash recomputado no download, conferência de `size` nas duas pontas e **delete do upload em divergência**: `google-drive.js:183,199-202,208-216`.
15. **Segurança de separação de segredos no backup:** a senha do backup é independente da do cofre, e nem a senha nem as chaves entram no arquivo: `backup-format.js:3`, `tools.js:42,186`.
16. **Aviso de não-cifração em três camadas** (checkbox padrão-cifrado, `confirm()` explícito, sufixo `-criptografado` no nome, nota permanente): `tools.js:36-42,134-141,201-203`.
17. **Restauração atômica e "ou tudo ou nada"** com `durability:'strict'`: `backup.js:11-29`, `idb.js:20,27-30`; mensagens "Nada foi alterado." em falha (`tools.js:48,164`).
18. **Sem injeção de planilha:** o gerador xlsx escreve **somente** `t="inlineStr"`/`<v>` numérico, escapa XML e nunca emite elemento `<f>` — dados como `=cmd|...` ficam texto; `xlsx.js:2,6`, `reports.js:17-19`, sem dependência externa de planilha (`package.json` sem deps).
19. **Recompressão obrigatória de imagem antes de gravar** (re-encode canvas → WebP/JPEG, teto de 15 MB, SHA-256 por arquivo): `process.js:4-16`, `clients.js:20` (foto com `force:true, maxSide:512`) — neutraliza payloads de parser para fotos.
20. **Validação estrita e normalização na função serverless, com saída em whitelist:** `api/cpf.js:16-17,32-36`, `validators.js:1-5`; confirmado ao vivo que um CPF com `<script>` vira 422 sem tocar o upstream; sem segredo no bundle: `api/cpf.js:19`.
21. **`Cache-Control: no-store`** na função (`api/cpf.js:9`) e **nenhum `caches.put` em runtime** no service worker (`sw.js:5`) — PII não é armazenada em Cache Storage nem em CDN.
22. **Documentação de segurança honesta e coerente com o código:** `docs/README.md:9` ("a criptografia protege dados em repouso; **não** protege contra aparelho comprometido, malware ou XSS com o app desbloqueado. O atraso após tentativas erradas é local e contornável"), `README.md:262-267`, `docs/auditoria-ui-ux-codigo.md:27` — e os números alegados (600k, AES-GCM 256, metadata em claro) **batem** com `crypto.js:4`, `crypto.js:6`, `records.js:7`.
23. **Higiene de repositório:** `.gitignore` bloqueia `.env*` e `client_secret*.json`; `git log --all --diff-filter=A --name-only` **não** revela nenhum segredo adicionado na história; `tests/` cobre KDF/GCM/IV/extratabilidade e backup.

---

## 15. Recomendações priorizadas

Custo estimado em esforço de desenvolvimento (horas de programação + teste) para alguém que já conhece o código. Marcações: **"mudança compatível"** = não toca cofre, schema de dados, nem design; **"exige autorização (altera cofre/schema)"** = precisa de decisão explícita do dono do projeto.

| # | Pri | Recomendação | Custo | Trava |
|---|---|---|---|---|
| R1 | **Crítico** | **Parar de persistir a DEK.** Alternativa mínima sem perder a funcionalidade de "recarregar a aba mantém a sessão": derivar um *session key* aleatório **só** em `sessionStorage` (`crypto.js:17` já tem `sealBytes`) e gravar `meta/session` como DEK embrulhada por essa chave; `restoreSession` (`auth.js:38-48`) passa a exigir o par `sid`+`sessionKey` do sessionStorage, e um dump de IndexedDB sozinho vira lixo. Complementos: `await` do delete em `lock()`, remover o registro em `pagehide`/`visibilitychange:hidden`, e baixar `saveSession` de 1,8 s (`auth.js:53`) para algo como 15–30 s. | ~4–6 h + teste de corrida de sessão | **exige autorização (altera o registro `meta/session` — não altera stores de dados nem o cofre)** |
| R2 | **Crítico** | **Fechar `/api/cpf`:** exigir `POST` com corpo (tira o CPF da URL e dos logs — resolve P2), validar `Origin`/`Sec-Fetch-Site: same-origin`, cache de resposta por CPF no servidor com TTL (elimina consultas repetidas), e rate-limit por IP (Upstash/Vercel WAF ou `Vercel Attack Challenge Mode`). Sem isso, no mínimo publicar o limite na doc para que o dono dimensione a cota. | ~3–5 h | **mudança compatível** (frontend `apicpf.js:24` acompanha; não toca cofre) |
| R3 | **Alto** | **Clampar o KDF:** rejeitar `iter` fora de 100.000–2.000.000 e salt de tamanho ≠ 16 em `crypto.js:14` e `backup-format.js:35`; usar `ITER` do código (não o do arquivo) sempre que divergência for inaceitável. Também validar `b.length>=12` antes de fatiar IV em `openBytes` (`crypto.js:18`). | ~1–2 h | **mudança compatível** |
| R4 | **Alto** | **Diferenciar erros no desbloqueio** (`auth.js:28`): `OperationError` ⇒ "Senha incorreta."; outros (`DataError`, `NotSupportedError`, falha de banco) ⇒ mensagem específica **sem** incrementar `g.fails`. Fazer o `db.put('meta',g)` ser aguardado e logar localmente a falha de escrita. | ~1–2 h | **mudança compatível** |
| R5 | **Alto** | **Falha de descriptografia por registro, não por store:** `records.js:5` com `Promise.allSettled`, retornando `{rows, unreadable:n}`; `clientlist.js:32`/`dashboard.js:10` com `try/catch` exibindo "N registros ilegíveis — verifique o banco em Configurações › Integridade"; reaproveitar o `probe` de `settings.js:31-36` como auto-teste. Nunca repassar `e.message` cru de `DOMException` (endurecer `main.js:8`). | ~3–4 h | **mudança compatível** |
| R6 | **Alto** | **Trocar a senha do cofre via rewrap da DEK:** novo `changeVaultPassword(old,new)` em `crypto.js` (desembrulhar com KEK antiga, embrulhar com nova, gravar `meta/vault` com `salt`/`iv`/`iter` novos — `crypto.js:10-11`) + item em Configurações › Segurança ao lado de "Bloquear agora" (`settings.js:52-56`). **Nenhum registro é re-cifrado.** Resolve C6 e cria o veículo de upgrade do `iter` (R3). | ~4–6 h | **exige autorização (altera conteúdo de `meta/vault`; não altera stores de dados)** |
| R7 | **Médio** | **Espelhar a CSP no header** de `vercel.json` (`default-src 'self'; script-src 'self' https://accounts.google.com; object-src 'none'; base-uri 'none'; form-action 'none'; …`) mantendo a meta como redundância; declarar `Strict-Transport-Security` explicitamente em vez de depender do default da plataforma; adicionar `Permissions-Policy` negando camera/mic/geolocation (o app não usa) e `Cross-Origin-Resource-Policy: same-origin` sobre os assets (testar com o popup GIS). Corrigir a alegação de `docs/auditoria-ui-ux-codigo.md:14`. | ~2 h | **mudança compatível** |
| R8 | **Médio** | **Mínimo de senha mestra e da senha de backup acima de 8 caracteres**, com medidor de entropia e recusa de senhas de lista comum (a lista pode ir truncada como *wordlist* local — não quebra cofre nenhum). **NÃO** adicionar normalização NFKC/NFC ao KDF sem migração: isso altera a chave derivada e **torna cofres existentes inacessíveis** (`crypto.js:6,14`). | ~2–3 h | política de senha: **mudança compatível**; normalização: **exige autorização (altera cofre)** |
| R9 | **Médio** | **Defesa contra exclusão/ransomware:** confirmação forte nas rotas destrutivas (digitar o nome do cliente em `clients.js:42`; exigir backup prévio **gerado e confirmado** antes de `restore replace` em `tools.js:47,161`), e lembrete periódico não bloqueante de backup (o app já tem `P.storageInfo()` em `settings.js:18`). Sem lixeira/soft-delete, qualquer apagamento é definitivo. | ~4–6 h | **mudança compatível** (fluxo/UX — aprovar redação das confirmações com o dono) |
| R10 | **Baixo** | **Endurecer `h()`** (`main.js:5`): whitelist de atributos (rejeitar chaves `on*` vindas de objetos construídos com dados) e, se desejar, `require-trusted-types-for 'script'` no header + `trustedTypes.createPolicy('nohtml')` — elimina DOM-clobbering e a classe inteira de sinks de parsing. | ~2–4 h (a parte Trusted Types exige teste em todas as telas) | **mudança compatível** |
| R11 | **Baixo** | **Fechar as janelas de object URL** (`lib.js:5`: revogar ao invés de 60 s, ou 5 s; `clients.js:144-145`: revogar em `pagehide`/ao fechar a janela, não 120 s) e **verificar MIME por assinatura de bytes** no upload (`process.js:8-9`, magic bytes para PDF/PNG/JPEG/WebP) com `fname` (`clients.js:127`) forçando extensão coerente com o MIME verificado. | ~2–3 h | **mudança compatível** |
| R12 | **Baixo** | **Reconhecimento de integridade do bundle:** SRI/hash em `vendor/fflate.min.js` (ou converter em import ES e eliminar o carregamento dinâmico de `lib.js:2-4`, hoje o único ponto que injeta `<script>` com `src` variável) e bump obrigatório de `sw.js:2` `V` com verificação de versão na inicialização. | ~2 h | **mudança compatível** |
| R13 | **Baixo** | **Trancar ao esconder:** opção "Bloquear ao trocar de aba" (chamar `lock('manual')` em `visibilitychange` oculto, hoje apenas `check()` em `auth.js:11,64`), mitigando o cenário dominante do §11(a). Padrão desligado para não contrariar o fluxo atual. | ~1 h | **mudança compatível** (altera comportamento de UX — aprovar com o dono) |
| R14 | **Baixo** | **Comunicação honesta de risco:** a tela de bloqueio diz "Aguarde N s" (`auth.js:27`) como se houvesse proteção contra ofline; e o rodapé de login afirma "nada sai do aparelho" (`main.js:33`) embora CPF saia para a APICPF quando online (`api/cpf.js:25`, `README.md:264`). Ajustar redação (sem tocar layout) para: "proteção local contra tentativas repetidas" e remover/qualificar o "nada sai do aparelho". | ~1 h | **mudança compatível** (texto) |

**Nada nesta lista exige reescrita do app, mudança de design, mudança de stores de dados ou alteração do funcionamento do cofre** — exceto R1 (registro `meta/session`), R6 (`meta/vault`) e a parte de normalização de R8, explicitamente marcadas como "exige autorização".

---

## 16. Tabela final consolidada

| # | Tipo | Achado | Evidência | Severidade |
|---|---|---|---|---|
| C1 | **Vulnerabilidade confirmada** | DEK persistida em IndexedDB; limpeza de `lock()` não aguardada; sem limpeza em `pagehide`; registro utilizável sem senha | `auth.js:55`, `auth.js:67`, `auth.js:43`, `auth.js:47`, `idb.js:3` | **Alta** |
| C2 | **Vulnerabilidade confirmada** | `/api/cpf` aberto: sem autenticação de chamador, sem rate limit; consumo de cota e oracle de CPF (verificado ao vivo: 200 sem credencial) | `api/cpf.js:14-27`; `docs/apicpf.md:32` | **Alta** |
| C3 | **Vulnerabilidade confirmada** | `iter`/`salt` do KDF lidos de dado não autenticado, sem piso/teto ⇒ downgrade de força bruta do backup e DoS | `backup-format.js:35`, `crypto.js:14,22`, `backup-format.js:6` | **Média** |
| C4 | **Vulnerabilidade confirmada** | Erro de integridade/banco reportado como "senha incorreta" e contabilizado como tentativa | `auth.js:28-31` | **Média** |
| C5 | **Vulnerabilidade confirmada** | Falha GCM em um registro derruba a store inteira, sem catch e sem mensagem | `records.js:4-5`, `clientlist.js:32`, `dashboard.js:10`, `main.js:8` | **Média** |
| C6 | **Vulnerabilidade confirmada** | Sem troca de senha/rotação de DEK e sem upgrade de parâmetros de KDF (rewrap barato já suportado pela arquitetura) | grep negativo; `auth.js:18-48`; `crypto.js:7-16` | **Média** |
| C7 | **Vulnerabilidade confirmada** | Header CSP só com `frame-ancestors`; hardening real mora em meta tag; doc atribui ao Vercel incorretamente | `vercel.json:55-56`, `index.html:3`, `docs/auditoria:14` | **Baixa** |
| C8 | **Vulnerabilidade confirmada** | Blob URLs de dados decifrados vivas por 60–120 s | `lib.js:5`, `clients.js:144-145` | **Baixa** |
| C9 | **Vulnerabilidade confirmada** | MIME/nome do arquivo confiados sem verificação; "Abrir" navega em `blob:` de mesma origem | `process.js:8-9`, `clients.js:144`, `clients.js:127` | **Baixa** |
| C10 | **Vulnerabilidade confirmada** | Anti-tentativas local e apagável apresentado como proteção ao usuário | `auth.js:26-30`, `docs/README.md:9` | **Baixa** |
| P1–P14 | **Risco potencial** | Ver §13 (14 itens) — inclui CPF em logs de plataforma, dispositivo compartilhado, GitHub Pages sem headers, extensões com debugger, senha fraca, SRI ausente, iOS 7 dias, PDF `blob:` em Safari, `iter`/`guard` manipuláveis | — | **Indeterminada (média no agregado)** |
| B1–B23 | **Boa prática presente** | Ver §14 (23 itens) — envelope KEK/DEK, PBKDF2 600k OWASP, AES-GCM-256, IV/salt corretos, verifier criptográfico, gates de sessão, auto-lock, revogação de object URLs, zero `innerHTML`, CSP de documento rica, OAuth mínimo e sem segredo, integridade de backup em 4 camadas, restauração atômica, sem injeção de planilha, recompressão de imagem, docs honestos | — | **Positivo** |

**Totais: 10 vulnerabilidades confirmadas (2 Alta, 4 Média, 4 Baixa) · 14 riscos potenciais · 23 boas práticas verificadas.**

---

## 17. Posição final

A primitiva criptográfica está **correta e atualizada** (PBKDF2-SHA256 600.000 iterações, envelope KEK→DEK, AES-GCM-256, IV/salt bem geridos, tag autenticando tudo, `extractable:false`, teste cobrindo adulteração/reuso de IV/extratabilidade), e a disciplina de DOM é genuinamente boa — **zero** `innerHTML`/`eval`/`srcdoc` num app com essa quantidade de dados controláveis, com CSP de documento que não permite script inline. Não há vulnerabilidade remota conhecida na superfície de renderização.

O problema não é a criptografia: é a **arquitetura de posse da chave** e a **camada de borda**. A DEK fica gravada no IndexedDB com limpeza não garantida (C1), a senha errada e o banco corrompido viram a mesma mensagem (C4), um byte adulterado derruba a listagem sem aviso (C5), o KDF aceita parâmetros do arquivo adversário (C3), não existe troca de senha (C6), a função serverless é um proxy aberto (C2) e o header CSP entrega apenas `frame-ancestors` (C7). Nenhum desses pontos é difícil de fechar, e quase nenhum encosta nas travas do projeto.

Seja explícito com o produto, como o projeto já faz em `docs/README.md:9`: **contra pessoa com o dispositivo, com DevTools, com o dump do banco ou contra exclusão maliciosa, este cofre não oferece proteção real enquanto a chave de sessão estiver persistida na mesma origem** — a criptografia em repouso protege o *disco*, não o *usuário ativo*. As duas ações que valem mais esforço são R1 (a chave fora do disco, embrulhada por material não persistido) e R2 (fechar o `/api/cpf`).
