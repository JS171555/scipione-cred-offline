# SCIPIONE CRED — Auditoria 6: Integrações externas, função serverless e publicação

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


**Escopo:** `api/cpf.js`, `src/services/apicpf.js`, `src/services/viacep.js`, `src/config/google.js`, `src/services/google-drive.js`, `.env.example`, `vercel.json`, `package.json`, `manifest.json`, `docs/apicpf.md`, `docs/google-drive.md`, `docs/README.md`, `README.md` (raiz), chamadores em `src/ui/clients.js` e `src/ui/tools.js`, `sw.js`, `index.html`.
**Método:** leitura estática + `grep` + `git log`/`git show`. **Nenhuma chamada de rede foi feita** (nenhum endpoint externo foi verificado em produção). Repositório: `/home/ubuntu/scipione-cred-offline`, branch `main`, remote `https://github.com/JS171555/scipione-cred-offline.git`.

**Estado do checkout (verificado):** o working tree esta no commit `e78d776` na branch `chore/project-audit-and-test-infrastructure`, e **`main`, `origin/main` e essa branch apontam para o mesmo `e78d776`** (`git rev-parse main` = `e78d776`; `git diff main HEAD -- api src/services src/config vercel.json package.json manifest.json .env.example docs sw.js index.html .nojekyll tests` = vazio). **Todas as linhas citadas neste relatorio sao exatamente as de `main`** (a diferenca de nome de branch nao afeta nenhuma conclusao). Auditoria concluida sem nenhuma alteracao no projeto: `git status --porcelain` vazio.
**Data da auditoria:** 2026-11-17. **Modo:** read-only — nenhum arquivo foi modificado.

Convenção: `✔ confirmado` = lido no código; `⚠ potencial` = plausível mas não verificável estaticamente; `NÃO CONFIRMADO` = informação ausente.

---

## 1. Função serverless `/api/cpf`

Arquivo: `api/cpf.js` (48 linhas).

### 1.1 Formato e runtime

| Item | Valor | Evidência |
|---|---|---|
| Estilo | ESM: `import` no topo, `export default async function handler(req, res)` | `api/cpf.js:1`, `api/cpf.js:13` |
| Convenção de rota | `api/cpf.js` → `/api/cpf` (File System Functions da Vercel) | inferido do layout; NÃO CONFIRMADO (não há `functions`/rotas em `vercel.json`) |
| `type: module` | `"type":"module"` no `package.json` — compatível com o `import` da função | `package.json:1` |
| Runtime / versão do Node | **não declarado** | `vercel.json:1-62` não tem bloco `functions`; `api/` não tem `package.json` próprio → NÃO CONFIRMADO (padrão da plataforma) |
| Import fora de `api/` | `../src/domain/validators.js` — o bundler/tracing da Vercel precisa incluir esse arquivo na função | `api/cpf.js:1` → risco de quebrar no deploy se o tracing não capturar; NÃO CONFIRMADO em runtime real |
| Dependência global | usa `fetch` global do Node (precisa de Node ≥ 18) | `api/cpf.js:25` |

**Risco C-7 (potencial):** a versão do runtime não está pinada em lugar algum; o código depende de `fetch` global (Node ≥ 18). Se a Vercel mudar o default, a função quebra em tempo de execução, não em build.

### 1.2 Leitura do segredo

```
api/cpf.js:19   const key=process.env.APICPF_API_KEY;
api/cpf.js:20   if(!key)return send(res,503,{ok:false,reason:'UNAVAILABLE'});
```

* Nome **exato** da variável: **`APICPF_API_KEY`** (`api/cpf.js:19`).
* Único ponto de leitura; a chave é usada apenas como header `X-API-KEY` (`api/cpf.js:26`).
* Declaração pública: `.env.example:3` → `APICPF_API_KEY=` (valor **vazio**, placeholder) (`​.env.example:3`).
* Comportamento na ausência: **503 + `{ok:false,reason:'UNAVAILABLE'}`**, sem stack trace nem detalhe (`api/cpf.js:20`). O app continua 100% funcional com validação manual (`docs/apicpf.md:22`, `README.md:247`).
* Não existe fallback para outro nome de env, nem leitura de arquivo, nem default embutido — **confirmado por ausência** (grep `process.env` só retorna `api/cpf.js:19`).

### 1.3 Contrato de entrada

| Aspecto | Contrato | Evidência |
|---|---|---|
| Método | Somente `GET`; qualquer outro → **405** `{ok:false,reason:'METHOD'}` | `api/cpf.js:14` |
| Parâmetro | `?cpf=<qualquer string>`; é lido via `new URL(req.url,'https://local.invalid').searchParams.get('cpf')` | `api/cpf.js:15-16` |
| Sanitização | `digits()` remove **todos** os não-dígitos antes de qualquer uso (`String(v||'').replace(/\D/g,'')`) | `api/cpf.js:16`, `src/domain/validators.js:1` |
| Validação | exige exatamente 11 dígitos **e** dígitos verificadores válidos → **422** `{ok:false,reason:'INVALID'}` | `api/cpf.js:17`, `src/domain/validators.js:2-3` |
| CPF ausente/vazio | `null` → `''` → length 0 → 422 | `api/cpf.js:16-17` (coberto em `tests/apicpf.test.mjs:23-24`) |
| Corpo de requisição | nunca é lido | ausência em `api/cpf.js:13-48` |
| Autenticação/origem do chamador | **inexistente** — a função não verifica sessão, token, cookie, `Origin` nem `Referer` | `api/cpf.js:13-17` (não há nenhuma checagem antes de `:19`) |

### 1.4 Contrato de saída

`send()` (`api/cpf.js:6-11`) é o único caminho de resposta e sempre define:

* `Content-Type: application/json; charset=utf-8` (`api/cpf.js:8`)
* `Cache-Control: no-store` (`api/cpf.js:9`) — asserted em `tests/apicpf.test.mjs:30`
* **Nenhum header CORS** (sem `Access-Control-Allow-Origin`, sem `Vary`) — confirmado por ausência em `api/cpf.js:6-11` e `vercel.json:3-59`. Consequência: outro site não consegue **ler** a resposta via `fetch` (bloqueio de origem), mas ainda consegue **disparar** a requisição GET (sem credenciais) — ver Risco C-1.

| Situação | Status | Corpo | Evidência |
|---|---|---|---|
| Método ≠ GET | 405 | `{ok:false,reason:'METHOD'}` | `api/cpf.js:14` |
| CPF inválido/ausente | 422 | `{ok:false,reason:'INVALID'}` | `api/cpf.js:17` |
| `APICPF_API_KEY` ausente | 503 | `{ok:false,reason:'UNAVAILABLE'}` | `api/cpf.js:20` |
| Sucesso upstream | 200 | `{ok:true,data:{name,gender,birth}}` | `api/cpf.js:31-36` |
| Upstream 400/404 **ou** `body.code` 400/404 | 422 | `{ok:false,reason:'INVALID'}` | `api/cpf.js:38-39` |
| Upstream 401/402/403/429/5xx, JSON inválido, abort/timeout, exceção de rede | 503 | `{ok:false,reason:'UNAVAILABLE'}` | `api/cpf.js:41-42` (catch-all), `api/cpf.js:43-44` (`catch{`) |

Whitelist de saída (anti-injection de campos) em `api/cpf.js:32-36`:

* `name`: só se `typeof body.data.nome === 'string'`, senão `''`
* `gender`: só se ∈ `{M,F,I}`, senão `''`
* `birth`: só se `typeof body.data.data_nascimento === 'string'` (o formato `YYYY-MM-DD` é validado **no cliente**, `src/services/apicpf.js:35`)
* Campos extras da upstream (inclusive `message` de erro) **nunca** são repassados — `tests/apicpf.test.mjs:42` verifica que a string `message` não aparece no corpo.

### 1.5 Validação, sanitização, timeout

* Entrada sanitizada a dígitos puros antes de entrar na URL upstream → não há injeção de path/query (`api/cpf.js:16`, `api/cpf.js:25`).
* Timeout próprio: `TIMEOUT=8000` ms com `AbortController` (`api/cpf.js:4`, `api/cpf.js:22-23`), `clearTimeout` no `finally` (`api/cpf.js:45-46`).
* Parse tolerante do JSON upstream: `try{body=await r.json()}catch{}` (`api/cpf.js:30`) → resposta HTML/plain da upstream vira 503 silencioso, não exceção não tratada.

### 1.6 Exposição da chave

* A chave **não** aparece em nenhum arquivo versionado: grep por `AIza…` = zero ocorrências; grep por padrões `api_key|apikey|secret|token|bearer|password:` com valor ≥ 6 chars = zero ocorrências no working tree; `git log -S"APICPF_API_KEY"` mostra apenas a env declaration vazia, o uso em `process.env` e a documentação — **nunca um valor** (`​.env.example:3`, `api/cpf.js:19`).
* A chave **não** é enviada ao navegador: somente `api/cpf.js:26` a usa, e o bundle do cliente só contém o path relativo `/api/cpf` (`src/services/apicpf.js:24`).
* NÃO CONFIRMADO: se a Vercel pode registrar o valor do header `X-API-KEY` em logs de plataforma (comportamento do provedor, não verificável estaticamente).

### 1.7 Rate limit

**Não existe rate limiting em lugar algum do repositório.** Evidência por ausência:

* `api/cpf.js` — sem contador, sem IP, sem chave de usuário, sem cache de resposta (48 linhas lidas integralmente).
* `vercel.json` — sem `functions`, sem middleware, sem regras de velocidade.
* Não há `middleware.js` na raiz (listagem de arquivos do repo).
* Único amortecedor real é o cache do **navegador** (`src/services/apicpf.js:3,12`) — memória da aba, portanto ineficaz contra chamador externo direto à função.
* O plano gratuito da APICPF é de 100 consultas/dia e 6/min (`docs/apicpf.md:32`) — informação de doc, **NÃO CONFIRMADO** contra o provedor. Consequência confirmada: qualquer visitante do site publicado pode esgotar a cota diária.

### 1.8 Log de dados sensíveis

* **Nenhum `console.*` em `api/`, `src/services/` ou `src/config/`** — grep retornou zero ocorrências → o código não loga chave, CPF nem dados de retorno. ✔
* **Porém:** o CPF viaja como **query string de GET** (`api/cpf.js:15-16`; origem no cliente `src/services/apicpf.js:24`). Query strings são tipicamente capturadas em logs de borda/observabilidade da plataforma de hospedagem. Isso é um risco estrutural do desenho (GET com dado pessoal na URL), classificado como ⚠ potencial (depende do log da Vercel — NÃO CONFIRMADO).
* Mitigação parcial presente: `Referrer-Policy: no-referrer` em todas as rotas (`vercel.json:42-45`) evita vazamento do CPF via `Referer` a terceiros.

### 1.9 Fluxo de erro completo visto pelo cliente

`src/services/apicpf.js` + `src/ui/clients.js`:

1. `lookupCpf(value,{signal})` extrai dígitos e valida localmente; inválido → `throw fail('INVALID')` **sem tocar na rede** (`src/services/apicpf.js:7-8`).
2. `if(!navigator.onLine) throw fail('OFFLINE')` — bloqueia antes do fetch (`src/services/apicpf.js:9`).
3. Cache de memória (TTL 30 min) e dedupe de requisições em voo (`src/services/apicpf.js:11-13`).
4. `fetch('/api/cpf?cpf=…', {signal, Accept, cache:'no-store'})` (`src/services/apicpf.js:24-28`).
5. Sucesso: `r.ok && body.ok && body.data` → renormaliza (trim no nome, whitelist de gênero, regex `^\d{4}-\d{2}-\d{2}$` no nascimento) e grava em cache (`src/services/apicpf.js:31-38`).
6. `r.status===422 || body.reason==='INVALID'` → `throw fail('INVALID')` (`src/services/apicpf.js:40`).
7. Qualquer outro status (405, 503, 404 do GitHub Pages, HTML em vez de JSON) → `throw fail(timedOut?'TIMEOUT':'UNAVAILABLE')` (`src/services/apicpf.js:41`); o parse do corpo é protegido por `try/catch` (`src/services/apicpf.js:30`), então um 404 HTML vira `UNAVAILABLE` silencioso — exatamente o caso documentado para GitHub Pages (`docs/apicpf.md:14`).
8. `AbortError`: se o timer interno de **9000 ms** disparou → `TIMEOUT`; senão re-throw do abort do chamador (`src/services/apicpf.js:43-45`). O timeout do cliente (9 s) é **maior** que o do servidor (8 s), ordem correta — confirmado (`src/services/apicpf.js:20` vs `api/cpf.js:4`).
9. Erros sem `code` viram `UNAVAILABLE`; `finally` limpa timer, listener e o mapa `PENDING` (`src/services/apicpf.js:47-53`).
10. UI: `INVALID` → badge vermelho **Inválido**; `UNAVAILABLE`/`TIMEOUT`/`OFFLINE`/abort → `setDocStatus('')`, ou seja, **nenhum aviso visível** (`src/ui/clients.js:90-94`). Coerente com `docs/apicpf.md:22` e `docs/README.md:19`.

**Consequência de UX/ops (Risco C-9, confirmado):** se `APICPF_API_KEY` estiver ausente ou errada na Vercel, o sintoma é idêntico a "usuário offline" — o status simplesmente some. Não há nenhum sinal distinguível no app nem no console, e não há CI que valide o deploy (`§6.5`). Um erro de configuração se manifesta como feature silenciosamente morta.

---

## 2. APICPF no cliente: o que realmente sai do aparelho

### 2.1 Endpoint

* O navegador **nunca** chama `apicpf.com`. O único destino do fluxo é o **path relativo `/api/cpf`** — mesma origem (`src/services/apicpf.js:24`).
* `apicpf.com/api/consulta` é chamado **somente no servidor**, em `api/cpf.js:3` + `api/cpf.js:25`.
* Confirmação cruzada por CSP: `connect-src` permite `'self'`, `accounts.google.com`, `www.googleapis.com`, `oauth2.googleapis.com`, `viacep.com.br` — **`apicpf.com` não está listado**, então uma chamada direta do navegador seria bloqueada pelo navegador (`index.html:3`). ✔ Desenhado de forma consistente com `docs/apicpf.md:3`.
* Status do provedor em si: **NÃO CONFIRMADO** — nenhum teste de rede foi feito; o contrato upstream (`?cpf=`, `X-API-KEY`, `data.nome/genero/data_nascimento`, códigos 400/401/402/403/404/429) vem apenas de `docs/apicpf.md:27-32` e é consumido em `api/cpf.js:25-40`.

### 2.2 Quando é chamado na UI

Gatilho: campo CPF do formulário de cliente (`src/ui/clients.js`):

| Condição | Linha |
|---|---|
| `input` no campo do documento dispara `scheduleCpf()` (com máscara) | `src/ui/clients.js:97` |
| Troca PF/PJ também reavalia (PJ → aborta e limpa status) | `src/ui/clients.js:96`, `src/ui/clients.js:71-74` |
| Só consulta Pessoa Física (`type==='PJ'` retorna antes) | `src/ui/clients.js:74` |
| Exige 11 dígitos | `src/ui/clients.js:75-76` |
| Exige dígito verificador válido **localmente** primeiro | `src/ui/clients.js:77` |
| Exige `navigator.onLine` | `src/ui/clients.js:78` |
| Debounce de **700 ms** (`setTimeout(runCpf,700)`), com seqüência `cpfSeq` e abort da chamada anterior (`cpfController?.abort()`) | `src/ui/clients.js:73`, `src/ui/clients.js:80`, `src/ui/clients.js:83` |
| Guard pós-resposta: descarta se a sequência mudou, o form saiu do DOM, virou PJ, ou o CPF digitado mudou | `src/ui/clients.js:86` |

### 2.3 O que é enviado

**Apenas o CPF normalizado em 11 dígitos** (sem máscara, sem pontos/hífen), como query param: `src/services/apicpf.js:24` (`?cpf=${cpf}`, com `cpf = digits(value)` em `src/services/apicpf.js:7`). Nenhum outro dado do cliente é anexado à requisição — confirmado pela assinatura do `fetch` (`src/services/apicpf.js:25-28`: só `signal`, `Accept`, `cache`).

Sobre a pergunta explícita do escopo:

* **Número de telefone NÃO trafega para terceiros.** Campos `phone`/`mobile` existem no formulário (`src/ui/clients.js:61`) e são só mascarados localmente (`src/ui/clients.js:98`) e gravados no cofre (`src/ui/clients.js:46` → `src/services/clients.js:23`). Não há caminho de código que os envie à rede. ✔
* **O CPF (documento) TRAFEGA para terceiros**: aparelho → `https://scipione-cred-offline.vercel.app/api/cpf` (Vercel) → `https://apicpf.com/api/consulta` (provedor terceiro), com nome completo do titular voltando pelo mesmo caminho (`api/cpf.js:32-36`). ✔

### 2.4 Risco de privacidade (avaliação)

| Fator | Avaliação |
|---|---|
| Volume | Baixo por usuário: 1 consulta por CPF por 30 min por aba (`src/services/apicpf.js:3,12`) |
| Dados enviados | CPF isolado (sem pareamento com telefone/e-mail/nome no request) — minimizado ✔ |
| Dados que retornam de terceiros | nome completo, gênero e data de nascimento de terceiros (titulares que **não** são usuários do app) — dado pessoal tratado por fornecedor externo |
| Base legal/contrato | **NÃO CONFIRMADO**: não há DPA, registro de subprocessadores ou política de retenção no repositório |
| LGPD | CPF + nome + nascimento de pessoa física é dado pessoal sensível de terceiros processado por fornecedor não documentado no repo. Ausência de aviso à UI: o consultado (terceiro) não é o titular que autoriza; e o usuário do app não vê nenhum aviso de que o CPF será enviado a um terceiro (`docs/apicpf.md:34` só explica no doc técnico) |
| Trilha de log | CPF em query string de GET → pode aparecer em logs de borda da plataforma (§1.8) |
| Opt-out | **Não existe**开关: não há setting para desligar a consulta (nenhuma chave de config em `src/services/settings.js`) — apenas o efeito de ausência de rede/chave |

**Classificação:** risco de privacidade **real e confirmado quanto ao tráfego** (CPF + PII retornada saem do dispositivo), com severidade dependente do contrato com o provedor (NÃO CONFIRMADO). A escolha arquitetural correta (chave no servidor, whitelist de campos, `no-store`) está implementada; a lacuna é de **transparência/consentimento e controle**, não de vazamento de chave.

### 2.5 Cache/memória local e onde os resultados são gravados

* **Cache de consulta:** `Map` em memória de aba, TTL 30 min, chave = CPF (`src/services/apicpf.js:3`, `:11-12`, `:37`). Não persiste (reload esvazia). Alinhado com `docs/apicpf.md:21` e `docs/README.md:19`. **Nunca** vai para `localStorage`/IndexedDB. ✔
* **Não há mapa de "CPF já consultado" persistente** → recarregar a página repete a consulta (nulo impacto de privacidade, impacto de cota).
* **Aplicação dos resultados:** `put(k,v)` só escreve se o campo estiver **vazio**, mantendo editáveis (`src/ui/clients.js:87-88`) — confere com `docs/apicpf.md:20`.
* **Gravação em repouso:** os valores preenchidos seguem o fluxo normal de save — `src/ui/clients.js:44-46` → `S.saveClient` (`src/services/clients.js:16-27`) → `enc('clients', {...})` (`src/services/clients.js:23`) → `sealJSON(getKey(), rest)` **AES-GCM**, com apenas `id/createdAt/clientId` em claro (`src/services/records.js:7`, comentário em `src/services/records.js:1`). ✔ **Nome/gênero/nascimento vindos da APICPF ficam cifrados no IndexedDB, como qualquer outro campo.**
* Se o usuário **não** salvar o formulário, os dados da consulta ficam apenas na memória da aba e no cache `Map` (não cifrados, mas não persistidos).

---

## 3. ViaCEP

Arquivo: `src/services/viacep.js` (34 linhas).

### 3.1 Endpoint e chamada

* Base: `const ENDPOINT='https://viacep.com.br/ws/'` (`src/services/viacep.js:3`); URL final `https://viacep.com.br/ws/<8 dígitos>/json/` (`src/services/viacep.js:17`) — GET, `Accept: application/json`, `cache:'no-cache'`.
* Chamado **pelo navegador diretamente** (não passa pela função serverless) e **liberado na CSP** (`index.html:3`: `https://viacep.com.br` em `connect-src`). ✔
* Status do provedor em si: **NÃO CONFIRMADO** (nenhuma chamada de rede foi feita).

### 3.2 Gatilho na UI

| Condição | Linha |
|---|---|
| `input` no campo CEP aplica máscara e chama `schedule()` | `src/ui/clients.js:122` |
| Exige 8 dígitos; <8 limpa o aviso | `src/ui/clients.js:115-116` |
| Validação estrutural antes da rede | `src/ui/clients.js:117` |
| Exige `navigator.onLine`, senão aviso de preenchimento manual | `src/ui/clients.js:118` |
| Debounce **650 ms**, `lookupSeq` e abort da consulta anterior | `src/ui/clients.js:114`, `src/ui/clients.js:120`, `src/ui/clients.js:102` |
| Guard pós-resposta (sequência/DOM/CEP alterado) | `src/ui/clients.js:105` |
| `blur` com CEP incompleto → aviso | `src/ui/clients.js:123` |

### 3.3 Validação de CEP

`validCep` = exatamente 8 dígitos **e** `!== '00000000'` (`src/domain/address.js:4`), após `digits()` (`src/domain/address.js:1`, `src/domain/validators.js:1`). Violação → `throw fail('CEP inválido.','INVALID')` sem rede (`src/services/viacep.js:8`). Na UI a mesma validação roda antes (`src/ui/clients.js:117`).

### 3.4 Fallback offline / de falha

* **Não há base local de CEP** — confirmado: nada de CEP em `sw.js:2` (`FILES`) e nenhum dataset no repo. O fallback é **100% manual**: toda mensagem de erro termina em "Preencha manualmente" e todos os campos permanecem editáveis (`src/services/viacep.js:20-23`, `:28`, `:30-31`; UI em `src/ui/clients.js:107`, `:110`, `:118`). Coerente com `docs/README.md:19`.
* `navigator.onLine === false` → `code:'OFFLINE'` antes do fetch (`src/services/viacep.js:10`); usa `===false` (tratamento defensivo para ambientes sem `navigator`) ✔.
* Timeout padrão **8000 ms**, parametrizável (`src/services/viacep.js:6`, `:11-12`, `:25`) com `AbortController`; abort externo preservado como `AbortError` puro (`src/services/viacep.js:19-22`).
* Taxonomia de erros (`code`): `INVALID` (`:8`), `OFFLINE` (`:10`), `TIMEOUT` (`:20`), `NETWORK` (`:23`), `UNAVAILABLE` (`:28`), `INVALID_RESPONSE` (`:30`), `NOT_FOUND` via `data.erro === true` ou `'true'` (`:31`).

### 3.5 Mapeamento para o endereço

`src/services/viacep.js:32`:

| ViaCEP | Campo interno | Fallback |
|---|---|---|
| `cep` | `cep` (remascarado `#####-###`) | `maskCep(data.cep || d)` — usa o CEP digitado se a upstream omitir |
| `logradouro` | `street` | `''` |
| `bairro` | `district` | `''` |
| `localidade` | `city` | `''` |
| `uf` | `state` | `''`, forçado `.toUpperCase()` |

Aplicação na UI: `street`/`district`/`city`/`state` sobrescritos; **`number` e `complement` não são tocados** — logo são preservados (`src/ui/clients.js:106`, confirmável porque a linha atribui apenas aqueles 4 campos). Composição final de exibição em `src/domain/address.js:6-12` (`composeAddress`), gravada no registro via `src/ui/clients.js:46` → cifrada (`src/services/records.js:7`).

### 3.6 Cache

`Map` **sem TTL e sem limite de tamanho** (`src/services/viacep.js:4`, `:9`, `:33`): acerto imediato por CEP, vida = vida da aba. Divergência de doc: `docs/README.md:19` menciona debounce e timeout mas **não** documenta o cache de CEP (omissão benigna). ⚠ Crescimento não limitado em sessão longa e intensiva em cadastros (baixo impacto; cada valor é ~100 bytes).

---

## 4. Google Drive

Arquivo: `src/services/google-drive.js` (227 linhas) + `src/config/google.js` + UI em `src/ui/tools.js:52-198`.

### 4.1 Fluxo OAuth real

Implementado com **Google Identity Services (GIS) token flow** (`initTokenClient`), não Authorization Code + PKCE escrito à mão:

1. Decide config: `getConfig()` = override salvo no `localStorage` **ou** default do repositório (`src/services/google-drive.js:18`, `:21-22`).
2. `configState()` computa `configured = type==='web' && !!clientId` e `originListed` comparando `location.origin` com a lista (`src/services/google-drive.js:23-27`).
3. `preload()` só tenta carregar a lib se `configured` (`src/services/google-drive.js:73`); a tela de backup chama `G.preload()` ao renderizar (`src/ui/tools.js:198`, `src/ui/tools.js:111-121`).
4. `loadGis()` injeta dinamicamente `<script src="https://accounts.google.com/gsi/client">` com `async`+`defer`, timeout de **20 s**, e rejeita com mensagens específicas se a lib não expõe `google.accounts.oauth2` (`src/services/google-drive.js:50-72`). Guard offline antes de injetar (`src/services/google-drive.js:55`).
5. `connect()`: exige config, reusa `pending` (single-flight), exige `navigator.onLine`, `await loadGis()`, depois `initTokenClient({client_id, scope, callback, error_callback})` e `requestAccessToken({prompt:'select_account'})` com watchdog de **120 s** (`src/services/google-drive.js:84-113`, especialmente `:94`, `:97-109`).
6. Callback: `r.access_token` → guarda token e expiração; caso contrário `authMessage(r)` mapeia o código de erro (`src/services/google-drive.js:100-107`).
7. `disconnect()` chama `google.accounts.oauth2.revoke(old)` em best-effort e limpa estado (`src/services/google-drive.js:114-117`).

Mapeamento de erros de consentimento (`src/services/google-drive.js:75-83`): `popup_failed_to_open`/`popup_blocked`, `popup_closed`, `access_denied` (com instrução longa de "Usuários de teste"), `origin_mismatch`, `invalid_client`. UI de origem não autorizada também é mostrada proativamente (`src/ui/tools.js:95`, usando `configState().originListed`).

### 4.2 De onde vem o client id — **valor hardcoded, sim**

`src/config/google.js` contém valores **reais**, não placeholders:

```
src/config/google.js:4   export const GOOGLE_OAUTH = {
src/config/google.js:5     clientId: '236359551321-aedlnkvretokom2516a4bq6m562b4shv.apps.googleusercontent.com',
src/config/google.js:8     projectId: 'optimum-habitat-447421-c4',
src/config/google.js:9     type: 'web',
src/config/google.js:10    origins: ['https://scipione-cred-offline.vercel.app']
```

* Consumido por `defaultConfig()` (`src/services/google-drive.js:21`) e, a partir daí, por `getConfig`/`configState`/`connect` (`src/services/google-drive.js:98`).
* Um **segundo** `client_id` real aparece na documentação: `662732522717-8b9g4pk169fjgpji19q8chbhvf9bj06v.apps.googleusercontent.com` (projeto antigo `oval-turbine-457821-h3`, número `662732522717`) em `docs/google-drive.md:121` (e o cliente atual reaparece em `docs/google-drive.md:93`).
* Histórico: 4 commits tocaram esse ID — `6884b97` (integração inicial), `ff247af`, `ef4b96f`, `7c4dae1` ("Set the current Google Cloud project"), `922f584` (via `git log -- src/config/google.js`).
* O `client_secret` **não** está no repositório: comentário explícito em `src/config/google.js:3`; `.gitignore:5` bloqueia `client_secret*.json`; `git log --all -S"client_secret"` não mostra **nenhum** valor de `client_secret:` em blob algum (apenas texto de doc/comentário). ✔

### 4.3 Escopos

* Único escopo: `https://www.googleapis.com/auth/drive.file` (`src/services/google-drive.js:8`, aplicado em `:99`).
* Nenhum outro escopo em lugar algum do repo (grep `.googleapis.com/auth` → 1 ocorrência). ✔ Confirma `docs/google-drive.md:42-43` e `docs/README.md:16`.
* Nuance não documentada: com `drive.file`, o app enxerga **todos** os arquivos que ele mesmo criou em qualquer dispositivo/aba — não apenas os daquela instalação. É o comportamento desejado (restaurar cross-device), mas a frase "só os backups que ele próprio criou" (`src/services/google-drive.js:2-3`) deve ser lida como "criados por este `clientId`", não "por este navegador".

### 4.4 Persistência do token

| Dado | Onde | Cifrado? | Evidência |
|---|---|---|---|
| `access_token` | **variável de módulo em memória** `let … token=null` | n/a (não persiste) | `src/services/google-drive.js:14`, `:102` |
| `tokenExpires` | memória | n/a | `src/services/google-drive.js:14`, `:103` |
| `folderId` | memória | n/a | `src/services/google-drive.js:14`, `:148`, `:157` |
| Config OAuth (`clientId`, `projectId`, `type`, `origins`) | **`localStorage`**, chave `scipione.google.oauth`, **JSON em claro** | **Não** (plaintext) | `src/services/google-drive.js:11`, `:18`, `:45` |
| Refresh token | **não existe** — nunca requisitado nem guardado | — | `src/services/google-drive.js:100-103` só lê `access_token`/`expires_in` |
| `client_secret` | em lugar nenhum; `parseClientJson` **descarta** tudo que não seja os 4 campos | — | `src/services/google-drive.js:41` |

Resposta direta à pergunta: **o token NÃO é persistido em localStorage nem em IndexedDB — vive apenas na memória da aba** (`src/services/google-drive.js:14`), exatamente como afirmam `docs/google-drive.md:48-49`, `docs/README.md:16` e `README.md:277`. ✔ Consequência confirmada: recarregar a página derruba a sessão (`docs/google-drive.md:49`). O que **fica** em claro no `localStorage` é somente a configuração pública do cliente OAuth — dado não sensível, mas vale registrar que `localStorage` é legível por qualquer XSS no mesmo origin (mitigações de XSS estão na área de outro auditor).

### 4.5 Expiração e refresh

* Expiração calculada com margem: `tokenExpires = now + max(60, (Number(expires_in) || 3600) - 60) * 1000` → renova "por dentro" 60 s antes do vencimento real, com piso de 60 s e default 3600 s (`src/services/google-drive.js:103`).
* `isConnected()` invalida e apaga o token vencido (`src/services/google-drive.js:29-32`).
* **Não há refresh automático.** Cada requisição checca `isConnected()` e, se falso, lança `AUTH` pedindo reconexão manual (`src/services/google-drive.js:130`). Um 401 da API faz `resetAuth()` e o mesmo pedido (`src/services/google-drive.js:139`).
* `resetAuth()` zera token/expiração/pending/folderId (`src/services/google-drive.js:19`) — inclusive ao importar/clear config (`src/services/google-drive.js:46`, `:48`).
* Impacto: uma restauração longa ou sessão após ~1 h exige novo popup + novo consentimento (Risco C-5). `docs/google-drive.md:141` documenta "Sessão expirada → clicar em Conectar novamente" — ou seja, **a doc está correta e o código assume o limite deliberadamente**.

### 4.6 Seleção de pasta

* **Não há seleção de pasta pelo usuário** (no `Picker` do Google): o nome é constante `SCIPIONE CRED - Backups` (`src/services/google-drive.js:9`).
* `folder()` (`src/services/google-drive.js:147-158`): cache em `folderId` → `GET /files?spaces=drive&pageSize=10&fields=files(id,name)&q=name = '…' and mimeType = 'application/vnd.google-apps.folder' and trashed = false` (`:149-150`) → se existir pega **o primeiro** (`:151`); senão `POST /files` criando a pasta com `appProperties:{app:'SCIPIONE CRED'}` (`:152-155`); sem `id` no retorno → erro `DRIVE` (`:156`).
* ⚠ Se houver **duas** pastas homônimas na conta, o app usa a primeira do `pageSize=10` de forma não determinística e passa a gravar só ali (`src/services/google-drive.js:150-151`). Não documentado.
* Query do Drive escapada manualmente por `escapeQ` (escape de `\` e `'`) (`src/services/google-drive.js:144`, usado em `:149`, `:162`). Como os valores interpolados são constantes internas (`FOLDER`) ou IDs retornados pela própria API, não há vetor de injeção hoje. ⚠ Frágil por construção se um dia interpolar texto do usuário (Risco P-7).

### 4.7 Listar / upload / download

**`listBackups()`** (`src/services/google-drive.js:160-172`): lista paginada (`pageSize=100`, `orderBy:'createdTime desc'`, loop `nextPageToken`) filtrando por `parents`, `trashed=false`, `mimeType='application/zip'` (`:162-170`), depois filtro de cliente no cliente: `appProperties.app === 'SCIPIONE CRED'` (`:171`). UI preenche um `<select>` com nome/data/tamanho (`src/ui/tools.js:170-180`).

**`uploadBackup(bytes,{name,encrypted})`** (`src/services/google-drive.js:181-204`):

* Guarda: precisa de `Uint8Array` não-vazio (`:182`).
* SHA-256 calculado **antes** do envio (`:183` + `:175-179`, exige `crypto.subtle`, senão erro `SECURE`) ✔ confere com `docs/google-drive.md:45-47`.
* Nome: default timestampado, sufixo `-criptografado` quando `encrypted`, `/` e `\` trocados por `-`, truncado a 180 chars (`:185`).
* Metadata enviada: `mimeType:'application/zip'`, `parents:[pasta]`, `appProperties:{app, sha256, encrypted:'0'|'1'}` (`:186-187`).
* Corpo: `multipart/related` montado manualmente com boundary aleatório de `crypto.getRandomValues(12)` (`:184`, `:188-193`).
* Envio: `POST https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=…` com timeout de **180 s** (`:194-196`).
* Verificação de tamanho: se `file.size !== bytes.byteLength` → **DELETE** do arquivo enviado e erro `INTEGRITY` (`:199-202`). ✔ Comportamento transacional raro e bem implementado.
* UI: senha com mínimo de 8 chars e confirmação; desmarcar "criptografar" exige `confirm()` explícito de que o ZIP contém tudo legível (`src/ui/tools.js:131-144`, `:128-130`). O ZIP é gerado por `B.createBackup(pass)` (`src/ui/tools.js:138`).

**`downloadBackup(file)`** (`src/services/google-drive.js:206-218`):

* Exige `file.id` (`:207`) e um `appProperties.sha256` com `^[a-f0-9]{64}$` — arquivos de outras origens são recusados com erro `INTEGRITY` (`:208-210`).
* `GET /files/<id>?alt=media` com 180 s (`:211`), checagem de tamanho (`:213-214`) e **recomparação do SHA-256** (`:215-216`). ✔
* UI: baixa, faz `B.readBackup(bytes, senha)` e só então oferece restaurar, com `confirm()` no modo "substituir tudo" (`src/ui/tools.js:150-168`).

**Transporte:** todas as chamadas passam por `request()` (`src/services/google-drive.js:129-142`) que injeta `Authorization: Bearer <token>` (`:134`), usa `AbortController` com timeout default de **90 s** (`:129`, `:131`), e classifica: abort → `NETWORK` "demorou demais", exceção → `NETWORK`, 401 → `AUTH` + `resetAuth`, outro `!ok` → `responseError()` → `DRIVE` (`:136-141`). `responseError()` (`src/services/google-drive.js:119-128`) traduz 403 "API não ativada", 403 "escopo/permission insuficiente" e 404 "não encontrado".

### 4.8 Limites

| Limite | Estado | Evidência |
|---|---|---|
| Tamanho máximo de upload no **cliente** | **inexistente** — não há checagem de bytes antes do multipart | `src/services/google-drive.js:181-196` (só `byteLength` ≠ 0) |
| Limite do tipo multipart do Google | **NÃO CONFIRMADO** no repo (conhecimento externo: upload multipart costuma ter teto bem menor que os 5 TB do resuminal) | ⚠ Risco P-5: backup > ~10 MiB falha com 4xx e a mensagem genérica vem de `responseError` |
| Tamanho de documento anexado | 15 MB por arquivo (`MAX=15*1048576`) — isso **reduz** mas não limita o ZIP final | `src/files/process.js:4`, `src/files/process.js:6` |
| `pageSize` | 10 na busca de pasta, 100 na lista de backups com paginação completa | `src/services/google-drive.js:150`, `src/services/google-drive.js:165-170` |
| Timeouts | lib GIS 20 s; popup de consentimento 120 s; request default 90 s; upload/download 180 s | `:68`, `:94`, `:129`, `:196`, `:211` |
| Espaço na conta do usuário | **não consultado** (sem `drive.about/getUsage`) | ausência em `src/services/google-drive.js` |
| Tamper de `formatSize`/exibição | n/a | `src/services/google-drive.js:220-226` |

### 4.9 `docs/google-drive.md` vs código — divergências

| # | A doc diz | O código faz | Veredicto |
|---|---|---|---|
| D1 | `docs/google-drive.md:16` e `:38`: "Também é possível **importar o JSON** desse cliente em **Backup → Google Drive**" / "importe-o em Backup → Google Drive → Selecionar JSON do Google Cloud" | O bloco de importação (file input `#gcfg`, botão "Selecionar JSON do Google Cloud") só é renderizado dentro de `if(!st.configured)` (`src/ui/tools.js:76-93`). Como `src/config/google.js:5-9` traz `clientId` real + `type:'web'`, `configState().configured` é **sempre `true`** (`src/services/google-drive.js:26`) — o `defaultConfig()` entra mesmo sem nada no `localStorage` (`src/services/google-drive.js:22`). Pior: "Trocar configuração" só faz `clearConfig()` (`src/ui/tools.js:104`), que apaga o override e **devolve ao default**, mantendo `configured === true` (`src/services/google-drive.js:48`). | **DIVERGÊNCIA CONFIRMADA (funcionalidade de doc inalcançável).** Para trocar de cliente em localhost/outro domínio, hoje só resta editar `src/config/google.js` ou inserir manualmente na chave `scipione.google.oauth` do `localStorage` — nenhum caminho de UI existe. Impacto: a doc que orienta testadores é inexequível, e o aviso de "cliente importado diferente" (`src/ui/tools.js:70-74`) também é inalcançável (o import é o único produtor de overrides, `src/services/google-drive.js:43-46`). |
| D2 | `docs/google-drive.md:60`: "A Vercel envia `Cross-Origin-Opener-Policy: same-origin-allow-popups`" | Exatamente isso, aplicado a `/(.*)` | ✔ coerente (`vercel.json:50-53`) |
| D3 | `docs/google-drive.md:48-49`: token "fica somente na memória da aba" | ✔ (`src/services/google-drive.js:14`, `:102`) | coerente |
| D4 | `docs/google-drive.md:42-43`: escopo mínimo `drive.file` | ✔ (`src/services/google-drive.js:8`, `:99`) | coerente |
| D5 | `docs/google-drive.md:44`: arquivos ficam na pasta `SCIPIONE CRED - Backups` | ✔ criada/locada automaticamente; mas seleção é "primeiro match" e não há escolha de pasta | coerente, com nuance não documentada (Risco P-6) |
| D6 | `docs/google-drive.md:45-47`: SHA-256 no `appProperties` e conferido ao restaurar | ✔ (`:183`, `:187`, `:208-216`) | coerente (código é **mais** rigoroso: também confere `size`) |
| D7 | `docs/google-drive.md:19-20`: `client_secret` não é usado nem deve estar no repo | ✔ ausente no repo e no histórico; `parseClientJson` o descarta (`:41`) | coerente |
| D8 | `docs/google-drive.md:53-59` "Requisitos e limites" | Não menciona **nenhum limite de tamanho** de upload nem ausência de refresh automático (`:49` diz só que recarregar exige nova autorização) | **lacuna de doc** (potencial falha silenciosa em contas grandes) |
| D9 | `docs/google-drive.md:104` cita o e-mail de testador `js1715557@gmail.com` | Dado real embutido em doc público no repo (`README.md:315` também revela o autor/username GitHub) | **divergência de higiene**: informação de conta em repositório público (Risco C-6) |
| D10 | `docs/google-drive.md:11` "na [origem de produção] basta clicar em Conectar Google Drive" | ✔ (`src/ui/tools.js:96-102`) e o `origins` do config bate com a URL publicada (`src/config/google.js:10`) | coerente |
| D11 | — | CSP `connect-src` inclui `https://oauth2.googleapis.com` (`index.html:3`), mas **nenhum código chama esse host** (o token flow do GIS resolve via `accounts.google.com`) | **allowlist morta/inecessária** (endurecimento possível, não é risco) |
| D12 | `README.md:277` / `docs/README.md:16` repetem as mesmas garantias | consistentes com código | ✔ |

---

## 5. Configuração, segredos e publicação

### 5.1 `.env.example` — transcrição integral

```
1  # Chave da APICPF. Usada somente pela função serverless /api/cpf.
2  # Na Vercel, cadastre esta variável em Project Settings > Environment Variables.
3  APICPF_API_KEY=
```

Única variável do projeto. Valor **vazio = placeholder**, não segredo (`​.env.example:3`).

### 5.2 `.gitignore` — transcrição integral

```
1  .vercel
2  node_modules
3  .DS_Store
4  *.log
5  client_secret*.json
6  .env
7  .env.local
8  .env.*.local
```

Cobre os três vetores relevantes: credencial do Google (`:5`), env local (`:6-8`) e estado do CLI da Vercel (`:1`). ✔

### 5.3 `package.json` — transcrição integral

```json
{"type":"module","private":true}
```

**Confirmado:** zero `dependencies`, zero `devDependencies`, zero `scripts` (1 linha, `package.json:1`). Consequências: não há `npm test`/`npm run build`/`vercel deploy` scriptável; os testes rodam por laço manual documentado em `docs/README.md:22`; `type:"module"` é o que faz `api/cpf.js` e os ESM do app funcionarem; `vendor/fflate.min.js` é **commitado em vez de instalado** (`vendor/`, `vendor/LICENSES.md`), coerente com `README.md:159` "Build — Nenhum — site estático".

### 5.4 `vercel.json` — transcrição integral (todos os headers)

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "headers": [
    { "source": "/sw.js", "headers": [
        { "key": "Cache-Control", "value": "no-cache, no-store, must-revalidate" },
        { "key": "Service-Worker-Allowed", "value": "/" } ] },
    { "source": "/",           "headers": [ { "key": "Cache-Control", "value": "no-cache" } ] },
    { "source": "/index.html", "headers": [ { "key": "Cache-Control", "value": "no-cache" } ] },
    { "source": "/(.*)", "headers": [
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "Referrer-Policy",        "value": "no-referrer" },
        { "key": "X-Frame-Options",        "value": "DENY" },
        { "key": "Cross-Origin-Opener-Policy", "value": "same-origin-allow-popups" },
        { "key": "Content-Security-Policy",    "value": "frame-ancestors 'none'" } ] }
  ],
  "outputDirectory": "."
}
```

Matriz de headers por caminho:

| Header | `/sw.js` | `/` | `/index.html` | `/(.*)` (todo o resto) |
|---|---|---|---|---|
| `Cache-Control` | `no-cache, no-store, must-revalidate` (`vercel.json:7-10`) | `no-cache` (`:20-23`) | `no-cache` (`:29-32`) | **não definido** |
| `Service-Worker-Allowed` | `/` (`:12-15`) | — | — | — |
| `X-Content-Type-Options: nosniff` | sim | sim | sim | sim (`:37-41`) |
| `Referrer-Policy: no-referrer` | sim | sim | sim | sim (`:42-45`) |
| `X-Frame-Options: DENY` | sim | sim | sim | sim (`:46-49`) |
| `Cross-Origin-Opener-Policy: same-origin-allow-popups` | sim | sim | sim | sim (`:50-53`) |
| `Content-Security-Policy: frame-ancestors 'none'` | sim | sim | sim | sim (`:54-57`) |

Ausências relevantes (confirmadas): sem `Strict-Transport-Security`, sem `Permissions-Policy`, sem `Cross-Origin-Resource-Policy`, sem `Cache-Control` para `/src/*`, `/css/*`, `/assets/*`, sem `rewrites`/`redirects`, sem `cleanUrls`, sem `functions`, sem `trailingSlash`. ⚠ Não há redirect de `http→https` (a Vercel faz isso por default — NÃO CONFIRMADO no repo).

CSP em duas camadas, e **a mais forte é a do `<meta>`**: `index.html:3` define `default-src 'self'; script-src 'self' https://accounts.google.com; style-src 'self' https://accounts.google.com 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob:; connect-src 'self' https://accounts.google.com https://www.googleapis.com https://oauth2.googleapis.com https://viacep.com.br; frame-src https://accounts.google.com; object-src 'none'; base-uri 'none'; form-action 'none'`. A CSP de `vercel.json` só adiciona `frame-ancestors`.
⚠ **P-3:** `frame-ancestors` **não funciona em CSP aplicada via `<meta>`** (só via header) — e por isso a versão boa está no header (`vercel.json:54-57`); `X-Frame-Options: DENY` é redundância saudável. Nota de design: `'unsafe-inline'` em `style-src` é deliberado e documentado (`docs/README.md:17`) porque o GIS injeta estilos inline.

### 5.5 `manifest.json` — transcrição integral

```json
{"name":"SCIPIONE CRED","short_name":"SCIPIONE","description":"Gestão de clientes e controle de dívidas, 100% offline.","lang":"pt-BR","start_url":".","scope":".","display":"standalone","background_color":"#080808","theme_color":"#080808","icons":[{"src":"assets/icons/icon-192.png","sizes":"192x192","type":"image/png"},{"src":"assets/icons/icon-512.png","sizes":"512x512","type":"image/png"},{"src":"assets/icons/icon-maskable-512.png","sizes":"512x512","type":"image/png","purpose":"maskable"}]}
```

* `start_url:"."` e `scope:"."` (relativos) → funciona em subdiretório (GitHub Pages) e casa com `Service-Worker-Allowed: /` (`manifest.json:1`, `vercel.json:12-15`, `README.md:258`).
* Registro do SW: `navigator.serviceWorker.register('sw.js')` em `src/pwa.js:3`, chamado em `src/main.js:62`. Falha é engolida em `console.warn` (`src/pwa.js:3`).
* Não há `short_link`, `protocol_handlers` nem `share_target`. Descrição "100% offline" é **materialmente falsa** em sentido estrito (há 3 destinos de rede de terceiros + a função serverless) — ver §7; mas correta quanto ao núcleo de dados (nada essencial exige rede).

### 5.6 Inventário de segredos/IDs no repositório

| Padrão procurado | Resultado |
|---|---|
| `AIza…` (API key do Google) | **0 ocorrências** (working tree, todo tipo de arquivo) ✔ |
| `client_secret` com valor | **0** — só comentários/docs (`.gitignore:5`, `src/config/google.js:3`, `docs/google-drive.md:19-20`, `src/ui/tools.js:79`); no histórico `git log --all -S"client_secret"` não retorna nenhum par `client_secret:` |
| `APICPF_API_KEY` com valor | **0** — `.env.example:3` vazio; histórico mostra só a chave de declaração |
| `api_key/apikey/secret/token/bearer/password` com valor literal ≥6 chars | **0 ocorrências** |
| `*.apps.googleusercontent.com` (client_id) | **3 ocorrências, todas reais**: `src/config/google.js:5`; `docs/google-drive.md:93`; `docs/google-drive.md:121` (cliente antigo) |
| `googleusercontent` em JS | além dos IDs, só a regex de validação em `src/services/google-drive.js:36` |
| `.env` / `client_secret.json` no histórico | **nenhum** — `git log --all --name-only` filtrado por `env\|secret\|token` retorna apenas `.env.example` |
| Arquivos não versionados presentes | nenhum `.env` no filesystem do clone (listagem completa) |
| Tokens de acesso/refresh em storage | nenhum valor hardcoded em código; `localStorage` só recebe config em runtime (`src/services/google-drive.js:45`) |
| PII em repo | 1 e-mail real de testador: `docs/google-drive.md:104` |
| IDs de projeto GCP | `optimum-habitat-447421-c4` (`src/config/google.js:8`, `docs/google-drive.md:95`, `:100-101`), número `236359551321` (`docs/google-drive.md:95`), projeto antigo `oval-turbine-457821-h3`/`662732522717` (`docs/google-drive.md:96-98`, `:121`) |

### 5.7 Um `client_id` real commitado é aceitável para OAuth de SPA/JS?

**Sim, em princípio — e o código está correto ao tratá-lo como público.** Evidência e raciocínio:

1. O fluxo usado é **token flow de navegador** via GIS (`src/services/google-drive.js:97-109`): `initTokenClient` + `requestAccessToken`, sem `client_secret`, sem troca de code por POST. Nesse modelo o cliente OAuth é um **cliente público**: por definição do próprio OAuth 2.0 para agentes USER-AGENT, a credencial não é confidencial e a proteção vem da **origem** e do consentimento do usuário, não do segredo.
2. O código afirma e faz isso: `src/config/google.js:3` (secret nunca no repo), `src/config/google.js:7` ("A autenticação usa o clientId"), `src/services/google-drive.js:41` (ao importar um JSON, só extrai `client_id`/`project_id`/`origins` e **descarta** `client_secret`), `src/ui/tools.js:79` e `:89` ("O aplicativo usa apenas o ID público do cliente").
3. A doc repete: `docs/google-drive.md:19-20`, `docs/README.md:16`.
4. A validação de origem é dupla: `google.accounts.oauth2` no lado do Google (origens autorizadas na conta GCP) e `configState().originListed` + aviso no app (`src/services/google-drive.js:25`, `src/ui/tools.js:95`). O `origins` no repo (`src/config/google.js:10`) é apenas **informativo/UX** — não é o controle de segurança (o controle real está no Google Cloud, e a própria doc diz isso em `docs/google-drive.md:32-35`).
5. O escopo mais grave que se poderia acusar — alguém extrair o `client_id` do bundle e usá-lo para obter tokens — **não é mitigável por segredo**: com `drive.file` + popup de consentimento, o atacante precisaria de credenciais Google da vítima e de uma origem autorizada. A superfície adicional criada pelo ID commitado é a **usabilidade do ID para phishing** (a tela de consentimento mostrará a marca do projeto real) e a **enumeração do projeto**.

**Conclusão: aceitável. Classifico como risco BAIXO / informational, não como "segredo vazado"** — com duas ressalvas que **são** problemas reais e por isso marco como confirmado:

* **⚠→C-6 confirmado:** commitar `client_id` + `projectId` + número do projeto + **dois** clientes (o ativo e o legado) + um **e-mail de testador** (`docs/google-drive.md:93-98`, `:104`, `:121`) num repositório **público** é sobre-divulgação de metadados de conta: mapeia a infraestrutura, revela um endereço pessoal, e fornece a um atacante o nome do projeto a impersonar na tela de consentimento. Não é segredo; é exposição desnecessária e um dado pessoal de terceiro.
* **C-6 confirmado (governança):** o único segredo *de fato* confidencial do projeto é `APICPF_API_KEY`, e a sua gestão está correta — mas **não há segredo nem controle no lado Google**: o app depende de o cliente `web` nunca ter ganho uma `client_secret` "necessária" e de a lista de origens autorizadas permanecer igual a `https://scipione-cred-offline.vercel.app` (`src/config/google.js:10`). Se um preview deploy (`*.vercel.app` de outra subdomínio ou `–git.vercel.app`) for adicionado às origens, `originListed` passa a divergir do ambiente real — o app **alerta** (`src/ui/tools.js:95`) em vez de silenciar, o que é bom. NÃO CONFIRMADO: quais origens estão realmente registradas no Google Cloud (exige console).

### 5.8 Como um deploy é feito — **ausência de CI confirmada**

* **Nenhum arquivo de CI/CD**: `ls -a | grep -iE 'github|gitlab|circle|travis|jenkins|netlify'` → vazio; busca por `*.yml`/`*.yaml` em todo o repo (fora de `.git`) → **zero arquivos**. Não existe `.github/workflows`.
* **Nenhum script npm**: `package.json:1` não tem `scripts` → nada é automatizável por `npm run`.
* Deploy é **manual, via dashboard**, documentado em `README.md:230-238`: importar o repo em `vercel.com/new`, preset **Other**, Build/Install Command **vazios**, Output Directory `.`, criar `APICPF_API_KEY` em Environment Variables, publicar. Alternativa GitHub Pages em `README.md:249-258`.
* Consequência: push em `main` **não** publica necessariamente (a menos que a Vercel tenha Git integration ativa — NÃO CONFIRMADO, fora do repo; `.vercel` estar gitignoreado em `.gitignore:1` sugere deploy por CLI local). Não há teste automatizado, não há checagem de env, não há rollback orquestrado, e o `V` do cache do SW (`sw.js:2`) é bumpado **à mão** — um `V` esquecido deixa usuários instalados em versão antiga (mitigado parcialmente por `skipWaiting()` `sw.js:3` + `no-store` em `/sw.js` `vercel.json:7-10`).

---

## 6. Publicação e cache

### 6.1 Servimento estático

* `outputDirectory: "."` (`vercel.json:61`) → a **raiz do repositório é o documento raiz do site**. Consequências: todo arquivo commitado vira **publicamente acessível** — inclusive `docs/`, `README.md`, `tests/`, `.env.example` (não `.env`, gitignoreado) e `api/cpf.js` só não é servido como estático porque a convenção `api/` o converte em função. ⚠ `docs/auditoria-ui-ux-codigo.md` e os screenshots em `docs/screenshots/` estão publicados no mesmo dominio (informação, não segredo).
* Todos os caminhos do app são **relativos** (`index.html:4-10`, `manifest.json:1` `start_url:"."`), o que torna o mesmo build portátil entre `/` da Vercel e subdiretório do GitHub Pages (`README.md:258`).

### 6.2 `.nojekyll` — por quê existe

`.nojekyll` é um arquivo de **zero bytes** (blob `e69de29bb2d1d6434b8b29ae775ad8c2e48c5391`, 0 bytes) na raiz. Motivo documentado: `README.md:258` — "O arquivo `.nojekyll` mantém os arquivos servidos exatamente como estão", porque o GitHub Pages processa a árvore com **Jekyll**, que **ignora** arquivos/diretórios iniciados com `_` ou `.` e pode reescrever/omitir assets. Não tem efeito na Vercel, mas é inofensivo e necessário para o segundo ambiente de hospedada documentado (`README.md:249-258`). ✔ Justificativa: dual-hosting Vercel + GitHub Pages sem build step.

### 6.3 Rotativos de cache e implicações para o service worker

Estratégia real é **duas camadas**:

1. **HTTP (Vercel):** `Cache-Control` só para `/sw.js` (`no-store`), `/` e `/index.html` (`no-cache`) (`vercel.json:4-34`). `/(.*)` **não** define `Cache-Control` (`vercel.json:35-59`) → vale o default da plataforma (NÃO CONFIRMADO; tipicamente `public, max-age=0, must-revalidate`), o que é **compatível** com a camada 2, mas significa que o comportamento dos assets **não é controlado pelo repo** (Risco P-2).
2. **Service worker:** `sw.js` é **cache-first** para `GET` e **só escreve** no `install` — `caches.open(V).addAll(FILES)` (`sw.js:3`); `activate` apaga caches de outra versão e faz `clients.claim()` (`sw.js:4`); `fetch` responde de `caches.match(e.request,{ignoreSearch:true})` e, em miss, cai na rede, com fallback de navegação para o `index.html` cacheado (`sw.js:5`). **Não há `cache.put` no caminho de `fetch`** → nada de runtime caching, nada de PII em cache (importante para `§1.8`: a resposta de `/api/cpf` **não** é persistida no Cache Storage).

Implicações:

* `no-store` + `Service-Worker-Allowed: /` em `/sw.js` (`vercel.json:7-15`) é **o que faz o update chegar** ao app instalado: o navegador revalida o byte a byte a cada navegação, e uma diferença de conteúdo dispara `install` → `skipWaiting` (`sw.js:3`). Sem esse header, um `sw.js` em `max-age` atrasaria atualizações indefinidamente.
* `no-cache` em `/` e `/index.html` (`vercel.json:20-23`, `:29-32`) evita boot de um HTML velho apontando para módulos velhos — necessário porque os **módulos JS em `/src/` não têm fingerprint nem header próprio** (nomes fixos, `sw.js:2`).
* `ignoreSearch:true` (`sw.js:5`) é **inocente hoje** (nenhum path em `FILES` difere por query string), mas significa que dois URLs que diferem só por query compartilharão uma entrada de cache. ⚠ **P-8:** se um futuro arquivo com variação por query for adicionado a `FILES`, isto serve conteúdo errado. Especificamente para `/api/cpf?cpf=…`: como `caches.match` só consulta o cache `V` (que nunca contém `/api/cpf`), não há risco de servir CPF de outro titular — **confirmado** pela ausência de `cache.put`.
* Manutenção manual: incluir cada novo arquivo em `FILES` e incrementar `V` está documentado como obrigação (`docs/README.md:21`, `sw.js:1`), e `V='sc-v69'` (`sw.js:2`). ⚨ Um arquivo novo **esquecido** em `FILES` funciona online (fallback de rede em `sw.js:5`) mas **quebra offline** — e nada no repo verifica isso (sem CI, §5.8). Risco C-8.

### 6.4 Hospedagem dupla: Vercel vs GitHub Pages

| Capacidade | Vercel | GitHub Pages |
|---|---|---|
| Headers de cache do SW | sim (`vercel.json:4-16`) | **não** — `README.md:258` admite |
| Função `/api/cpf` | sim | **não** → 404 → silencioso (`src/services/apicpf.js:41`, `src/ui/clients.js:93`; `docs/apicpf.md:14`) |
| OAuth Google | funciona só na origem autorizada (`src/config/google.js:10`) | exige autorizar a origem nova no Google Cloud (`docs/google-drive.md:32-35`) + o import de JSON que está **inalcável** (D1) |
| Cofres | por origem: `localhost`, Vercel e Pages são cofres separados (`README.md:284`) | idem |

Conclusão: a superfície de deploy está correta mas o **docs/UX assumem caminhos que o código não expõe** (D1) e cada origem é um cofre isolado, o que multiplica a chance de um `client_id`/origem dessincronizado.

---

## 7. Inventário completo de chamadas de rede do app

### 7.1 `fetch()` — todas as ocorrências (grep em `api/`, `src/`, `sw.js`, `index.html`)

| # | Arquivo:linha | Origem (quem executa) | Destino | Método | Dados enviados | Headers | Timeout/abort | Offline guard |
|---|---|---|---|---|---|---|---|---|
| R1 | `api/cpf.js:25` | **Servidor** (Vercel) | `https://apicpf.com/api/consulta?cpf=<11 dígitos>` (`api/cpf.js:3`) | GET | **CPF em 11 dígitos** na query string | `X-API-KEY: <APICPF_API_KEY>`, `Accept: application/json` (`api/cpf.js:26`) | `AbortController` 8000 ms (`api/cpf.js:4,22-23`) | n/a (lado servidor) |
| R2 | `src/services/apicpf.js:24` | Navegador | `/api/cpf?cpf=<11 dígitos>` (mesma origem → R1) | GET | **CPF em 11 dígitos** | `Accept: application/json`, `cache:'no-store'`, `signal` (`src/services/apicpf.js:25-28`) | 9000 ms + `signal` externo (`src/services/apicpf.js:15-20`) | `navigator.onLine` (`src/services/apicpf.js:9`) + debounce/abort em `src/ui/clients.js:73-80` |
| R3 | `src/services/viacep.js:17` | Navegador | `https://viacep.com.br/ws/<8 dígitos>/json/` (`src/services/viacep.js:3`) | GET | **APENAS o CEP** (8 dígitos). Nenhum nome/CPF/telefone | `Accept: application/json`, `cache:'no-cache'`, `signal` (`src/services/viacep.js:17`) | default 8000 ms + `signal` (`src/services/viacep.js:6,11-14`) | `navigator.onLine===false` (`src/services/viacep.js:10`) |
| R4 | `src/services/google-drive.js:134` (via `api()` `:143` ← `folder()` `:150`/`:152`, `listBackups()` `:168`, `delete` `:200`, e `downloadBackup` `:211`) | Navegador | `https://www.googleapis.com/drive/v3/files…` (`src/services/google-drive.js:6`) | GET / POST / DELETE | Query de pasta/arquivo (nome da pasta, `id`s), `appProperties`; no `?alt=media` só o `id` | `Authorization: Bearer <access_token>` (`src/services/google-drive.js:134`), `Content-Type: application/json` (`:153`) | default 90000 ms (`src/services/google-drive.js:129`); download 180000 ms (`:211`) | **não** checa `onLine` — depende de `isConnected()` + `NETWORK` (`src/services/google-drive.js:130-137`) |
| R5 | `src/services/google-drive.js:134` via `uploadBackup` `:194` | Navegador | `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart` (`src/services/google-drive.js:7`) | POST multipart/related | **ZIP inteiro do backup** (todos os registros, documentos e blobs — cifrado **apenas se** o usuário marcou "criptografar" e definiu senha, `src/ui/tools.js:128-135`) + metadata `{name,parents,mimeType,appProperties:{app,sha256,encrypted}}` | `Authorization: Bearer`, `Content-Type: multipart/related; boundary=…` (`src/services/google-drive.js:195`) | 180000 ms (`src/services/google-drive.js:196`) | idem R4 |
| R6 | `src/services/google-drive.js:65` (`document.createElement('script')`) | Navegador | `https://accounts.google.com/gsi/client` | GET (script) | Nenhum dado do app; apenas headers do navegador + o `client_id` é usado **dentro** do fluxo do popup (`src/services/google-drive.js:97-109`) | n/a | 20000 ms (`src/services/google-drive.js:68`) | `navigator.onLine` (`src/services/google-drive.js:55`) |
| R7 | `sw.js:5` | **Service worker** (rede aberta em nome da página) | qualquer `GET` não cacheado do mesmo origin (e, na falta de cache, `index.html` como fallback de navegação) | GET | o próprio recurso; **nenhum dado do usuário** | n/a | **NENHUM** — sem `AbortController`, sem timeout (Risco P-4) | é a própria camada de offline |
| R8 | `src/export/lib.js:2-4` (`createElement('script')`) | Navegador | `vendor/fflate.min.js` (**local**) | GET | n/a | n/a | nenhum (fallback de erro via `s.onerror`) | **OK offline** — está em `FILES` (`sw.js:2`) |

Total: **8 pontos de rede** — dos quais **5 fazem rede externa a terceiros** (R1 `apicpf.com`, R3 `viacep.com.br`, R4/R5 `www.googleapis.com`, R6 `accounts.google.com`), 1 é mesma origem iniciada pelo navegador (R2), 1 é o próprio SW (R7) e 1 é asset local (R8). **Chamadas de rede que um usuário sem querer faz sem autenticar nada: no máximo R2+R3** (só com dado digitado por ele).

### 7.2 Confirmado: **nenhum** outro mecanismo de rede

Grep por `XMLHttpRequest`, `WebSocket`, `sendBeacon`, `importScripts`, `new Worker`, `EventSource`, `window.open`:

* `XMLHttpRequest`, `WebSocket`, `navigator.sendBeacon`, `importScripts`, `new Worker`, `EventSource` → **0 ocorrências** em `api/`, `src/`, `sw.js`, `index.html` ✔ (portanto **nenhuma telemetria, nenhum analytics, nenhum erro-reporter remoto**).
* `window.open('about:blank', …)` em `src/ui/clients.js:143` — abre popup local para PDF, **não** é chamada de rede.
* `document.createElement('a')` + `a.download` em `src/export/lib.js:5` — download local via `blob:`/`URL.createObjectURL`, não rede.
* `src/ui/tools.js:90` — link `<a target="_blank" rel="noopener noreferrer" href="https://console.cloud.google.com/apis/credentials">`: navegação do usuário, não chamada do app.
* URLs `http://schemas.openxmlformats.org/…` em `src/export/xlsx.js:10-13` e `http://www.w3.org/2000/svg` em `src/ui/icons.js:42` são **namespaces XML/SVG**, não requisições ✔.
* Badges em `README.md:13-16` (`img.shields.io`) são de **documentação**, não do app.

### 7.3 O que quebra sem rede

| Funcionalidade | Comportamento offline | Evidência |
|---|---|---|
| Cadastro/login/consultas/dívidas/relatórios/XLSA/backup local/restauração | **Funciona** — dados em IndexedDB + cache SW; `fflate` local | `sw.js:2-5`, `src/export/lib.js:4`, `db/idb.js` |
| Validação de CPF (APICPF) | **Silenciosa**: status some, preenchimento manual livre, sem erro na tela | `src/services/apicpf.js:9`; `src/ui/clients.js:78`, `:93` |
| Consulta de CEP (ViaCEP) | **Aviso explícito** "Sem conexão. Preencha o endereço manualmente." + campos editáveis | `src/services/viacep.js:10`; `src/ui/clients.js:110`, `:118` |
| Google Drive (autenticar/listar/enviar/baixar) | **Indisponível com mensagens claras**: lib não carrega offline (`OFFLINE`), `connect()` bloqueia antes do popup; upload/download viram `NETWORK` | `src/services/google-drive.js:55`, `:89`, `:136-137` |
| Primeira carga sem nunca ter instalado o SW | Falha (nada em cache) — exige HTTPS/localhost (`docs/README.md:2`) | — |
| Assets esquecidos em `FILES` | Funciona online, **quebra offline** | `sw.js:2`, `sw.js:5` |

**Timeout/abort — matriz de cobertura:** R2 ✔ (9 s + `signal` do form), R3 ✔ (8 s default, parametrizável + `signal`), R4 ✔ (90 s; download 180 s), R5 ✔ (180 s), R6 ✔ (20 s), R1 ✔ (8 s, lado servidor), R7 **✘ sem timeout**, R8 **✘ sem timeout** (asset local — risco baixo). Todo caminho de terceiros tem abort explícito (`AbortController` + `clearTimeout` em `finally`): `src/services/apicpf.js:15-20,49-53`, `src/services/viacep.js:11-14,24-27`, `src/services/google-drive.js:131-138`, `api/cpf.js:22-23,45-46`.

---

## 8. Onde modificar X (mapa de mudança)

| # | Objetivo | Arquivo:linha a mexer | O que mais precisa mudar | Armadilhas |
|---|---|---|---|---|
| **8.1** | **Trocar o provedor de CPF** | `api/cpf.js:3` (URL `ENDPOINT`), `api/cpf.js:26` (nome do header `X-API-KEY`), `api/cpf.js:31-36` (mapeamento dos campos `nome/genero/data_nascimento`) | Se o novo provedor exigir outro segredo, trocar `api/cpf.js:19` (`APICPF_API_KEY`) e a linha 3 do `.env.example`; atualizar `docs/apicpf.md:27-32` (contrato), `docs/apicpf.md:3` (URL), `docs/README.md:19`, `README.md:247`; ajustar `api/cpf.js:38-39` (máquina de status → 422/503) | **O contrato público `/api/cpf` (query `cpf`, corpo `{ok,data:{name,gender,birth}}`, reasons `INVALID/UNAVAILABLE/METHOD`) NÃO pode mudar** — `src/services/apicpf.js:31-41` depende dele; `src/config/google.js`-like cache do cliente só aceita `birth` no formato `YYYY-MM-DD` (`src/services/apicpf.js:35`). Manter o teste `tests/apicpf.test.mjs` como contrato (linhas 15-50). |
| **8.2** | **Adicionar uma nova integração externa** | 1) criar `src/services/<novo>.js` no padrão de `viacep.js` (`:5` `fail(message,code)`, `:10` guard `navigator.onLine`, `:11-14` `AbortController`+timeout, `:33` cache `Map`); 2) **adicionar o host a `connect-src`** em `index.html:3` (sem isto o navegador bloqueia silenciosamente); 3) se usar segredo → criar função em `api/<nome>.js` no padrão `api/cpf.js:6-20`; 4) **incluir o arquivo novo em `FILES` e incrementar `V`** em `sw.js:2`; 5) chamar da UI com debounce+abort como `src/ui/clients.js:113-121`; 6) documentar em `docs/README.md` | A CSP (`index.html:3`) é o ponto de falha mais fácil de esquecer; se a integração for server-side, não esquecer o novo nome de env em `.env.example` + Vercel (`README.md:238`) |
| **8.3** | **Mudar o escopo do Google Drive** (ex.: `drive.readonly`, `drive` completo) | `src/services/google-drive.js:8` (`SCOPE`) | **Consentimento/verificação do Google Cloud**: o escopo novo precisa ser adicionado na tela de consentimento (`docs/google-drive.md:28-29`); app em **Testing** só autoriza usuários de teste. Se sair de `drive.file`, `listBackups()` precisa trocar o filtro `appProperties.app` (`:171`) por `ownersByMe`/similar; `folder()` (`:149`) pode precisar de `corpora`; **atualizar as 5 ocorrências de "drive.file" nas docs** (`docs/google-drive.md:28`, `:42-43`, `:106`; `docs/README.md:16`; `src/services/google-drive.js:2-3`; `src/ui/tools.js:89`) | Escopo maior = mais dado do usuário exposto; `drive.file` é justamente a minimização. **Nenhum refresh token** é guardado (`:100-103`), então a nova autorização será pedida de tempos em tempos |
| **8.4** | **Adicionar um header de segurança** | `vercel.json:35-59` (bloco `/(.*)`, ex. `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`, `Permissions-Policy`, `Cross-Origin-Resource-Policy`) | Se o header **alterar HTML** (CSP), precisa espelhar em `index.html:3` (a CSP effective é a mais restritiva das duas) — e lembrar que `frame-ancestors` só funciona via header (`vercel.json:54-57`), não em `<meta>`; se o header **for CORS** para a função, adicionar em `api/cpf.js:6-11` (`send()`) para cobrir todos os caminhos de resposta | GitHub Pages **ignora** `vercel.json` (`README.md:258`) → o header só vale na Vercel. Não definir `Cache-Control` em `/(.*)` sem bumpar `V` no SW, senão cria-se cache HTTP e cache SW dessincronizados |
| **8.5** | **Rotacionar um segredo** — (a) `APICPF_API_KEY` | 1) gerar nova chave no provedor; 2) Vercel **Project Settings › Environment Variables** (`README.md:238`, `docs/apicpf.md:8-12`); 3) **novo deploy** (env não se aplica a functions já em execução); 4) revogar a chave antiga no provedor | **Nada no código muda** (`api/cpf.js:19` lê o nome, não o valor); não existe segredo no repo, portanto não há histórico para limpar (`git log -S` confirmado vazio). O nome da variável é **contrato** com `.env.example:3` e com as docs (`docs/apicpf.md:10`) | Se `Vercel env` for marcada só em Production, previews ficam com validação **silenciosamente morta** (`api/cpf.js:20` + `src/ui/clients.js:93`) — nenhum sinal de erro. Considerar um `reason:'CONFIG'` distinto para env ausente |
| **8.5b** | **Rotacionar um segredo** — (b) `client_id` OAuth do Google | 1) criar/rotacionar o cliente no Google Cloud; 2) editar `src/config/google.js:5` (+ `:8` `projectId`, `:10` `origins`); 3) **incluir o novo cliente nos testadores** (`docs/google-drive.md:100-104`); 4) autorizar a origem; 5) bumpar `V` em `sw.js:2` (o `src/config/google.js` está **cacheado**!) | 1) limpar o override no `localStorage` de cada navegador (`scipione.google.oauth`, `src/services/google-drive.js:11`) — o app já detecta divergência e oferece "Usar cliente atual" (`src/ui/tools.js:70-74`), **mas essa UI é inalcançável enquanto o import não existir (D1)**; 2) atualizar `docs/google-drive.md:93`, `:95-98`, `:121`; 3) revogar o cliente antigo no console | **Armadilha principal:** `src/config/google.js` está na lista do cache SW (`sw.js:2`) com **nenhum** `Cache-Control` próprio (`vercel.json:35-59`) → sem bump de `V`, navegadores instalados continuam com o `client_id` velho e quebram silenciosamente. **Não commitar o JSON com `client_secret`** (`.gitignore:5`) |
| **8.6** | (extra) **Adicionar rate limit à função** | `api/cpf.js:13` (antes de `:19`) — por ex. cache de contagem por `req.headers['x-real-ip']`/`x-forwarded-for` em Upstash, ou `Vercel WAF`/middleware novo na raiz (`middleware.js`) | Documentar o limite em `docs/apicpf.md:22-32` para a UI continuar traduzindo 503 corretamente | Não logar IP+CPF juntos (`§1.8`); `x-forwarded-for` é falsificável, então o limite é mitigação, não controle |

---

## 9. Riscos classificados

### CONFIRMADOS (lidos no código)

| ID | Sev | Risco | Evidência |
|---|---|---|---|
| **C-1** | **Alta** | **`/api/cpf` é um oráculo de PII e queimador de cota, sem autenticação.** Qualquer visitante da URL publicada pode chamar `GET /api/cpf?cpf=<11 dígitos>` (sem cookie, sem sessão, sem checagem de origem) e receber **nome completo, gênero e data de nascimento** do titular, esgotando a cota do plano (100/dia). A resposta tem `no-store`, mas isso não impede nada. | `api/cpf.js:13-17` (nenhuma checagem antes de `:19`), `api/cpf.js:32-36` (PII retornada), `api/cpf.js:14` (GET liberado), ausência de CORS/auth em `vercel.json` |
| **C-2** | **Alta** | **Zero rate limiting em qualquer camada** (função, config, middleware ausente) — o único amortecedor existe só no navegador da vítima legítima. | ausência em `api/cpf.js:1-48`, `vercel.json:1-62`, inexistência de `middleware.js`; `docs/apicpf.md:32` (cota baixa do plano) |
| **C-3** | Média | **CPF trafega na query string de GET** em duas pernas (mesma origem e para o provedor) → exposto a logs de acesso/observabilidade, histórico do navegador em `no-store` não cobre logs de servidor, e à cota de URL. `Referrer-Policy: no-referrer` mitiga só o vazamento por Referer. | `src/services/apicpf.js:24`, `api/cpf.js:15-16`, `api/cpf.js:25`; mitigação `vercel.json:42-45`, `api/cpf.js:9` |
| **C-4** | Média | **Divergência doc↔código que inutiliza um fluxo documentado:** o import de JSON do Google Cloud (`docs/google-drive.md:16`, `:38`, `:123`) é inalcançável, porque a UI está atrás de `!st.configured` e o `defaultConfig()` hardcoded (`src/config/google.js:4-11`) torna `configured` sempre `true` — inclusive depois de "Trocar configuração". Trocar cliente exige editar código. | `src/ui/tools.js:76-93`, `src/services/google-drive.js:21-22`, `:26`, `:48`, `src/config/google.js:5` |
| **C-5** | Média | **Sem refresh token:** a sessão do Drive morre no `expires_in` (~1 h) e qualquer upload/download exige novo popup + consentimento. Interrompe backup agendado/restauração longa; doc só o revela como "erro comum". | `src/services/google-drive.js:14`, `:100-103`, `:130`, `:139`, `:19`; `docs/google-drive.md:48-49`, `:141` |
| **C-6** | Média | **Sobre-divulgação em repositório público:** dois `client_id` OAuth reais, IDs e números de projeto GCP (atual e legado), um **e-mail pessoal** de testador, e o próprio domínio `vercel.app`/usuário GitHub do autor — e, como `outputDirectory` é a raiz (`vercel.json:61`), os `docs/` com esses dados são **servidos publicamente em produção**, não ficam apenas no repositório. Nada disso é segredo (§5.7), mas é mapa de infraestrutura + dado pessoal que facilita phishing na tela de consentimento. | `src/config/google.js:5`, `:8`, `:10`; `docs/google-drive.md:93`, `:95-98`, `:104`, `:121`; `vercel.json:61`; `README.md:315` |
| **C-7** | Média | **Nenhuma automação de build/deploy e ambiente não pinado:** sem CI (nenhum `*.yml`/`*.yaml`, nenhum `.github/`), sem `scripts`/`dependencies`, sem `functions`/runtime no `vercel.json`, dependência de `fetch` global do Node e de um import fora de `api/`. Deploy = CLI/dashboard manual; a falha de config só aparece em runtime. | `package.json:1`, `vercel.json:1-62` (sem `functions`), `api/cpf.js:1`, `api/cpf.js:25`, `README.md:230-247`, ausência de arquivos de CI |
| **C-8** | Média | **Cache do SW é mantido à mão:** `sw.js` fica em `no-store` (`vercel.json:7-10`), mas os **módulos** dependem de `FILES`+`V` (`sw.js:2`, `sw.js:3-4`) e não têm `Cache-Control` próprio (`vercel.json:35-59`). Arquivo novo esquecido = app quebrado offline (`sw.js:5`); `V` esquecido após mexer em `src/config/google.js` = `client_id` velho instalado. | `sw.js:1-5`, `docs/README.md:21`, `vercel.json:7-10`, `:35-59` |
| **C-9** | Baixa/UX | **Falha de config é indistinguível de offline:** env ausente, upstream 401/402/403/429, 404 do GitHub Pages e timeout viram todos o mesmo "status some, sem aviso". A feature morre silenciosamente e o suporte não tem sinal. | `api/cpf.js:20`, `api/cpf.js:41-44`, `src/services/apicpf.js:41`, `src/ui/clients.js:90-94`; doc assume isso conscientemente (`docs/apicpf.md:22`) |
| **C-10** | Baixa | **Cache de CEP sem TTL nem limite** (`Map` crescente por aba) e cache de CPF cresce com TTL 30 min sem cap de tamanho. | `src/services/viacep.js:4`, `:9`, `:33`; `src/services/apicpf.js:3`, `:37` |
| **C-11** | Média | **O backup no Drive fica órfão fora do próprio cliente OAuth:** `listBackups()` filtra por `mimeType='application/zip'` **e** `appProperties.app` (`:162`, `:171`) e `downloadBackup()` exige `appProperties.sha256` com 64 hex (`:208-210`). Se o `appProperties` se perder (duplicação/cópia do arquivo, migração de conta, ou troca de `client_id` — o escopo `drive.file` só dá visibilidade aos arquivos criados **por aquele cliente**) o usuário fica com backup real no Drive **invisível e irrecuperável pelo app**, sem nenhum caminho alternativo na UI. | `src/services/google-drive.js:162`, `:171`, `:208-210`; semântica de `drive.file` por cliente → ver P-11 |

### POTENCIAIS (plausíveis, não verificáveis estaticamente)

| ID | Sev | Risco | Evidência / por que não confirmado |
|---|---|---|---|
| **P-1** | Média | Existência/comportamento reais de `apicpf.com/api/consulta`, dos seus códigos de erro e da cota 100/dia–6/min. Se o provedor divergir, a máquina de status de `api/cpf.js:31-42` classifica tudo como 503 (falha segura, mas a doc mente). | `api/cpf.js:3`, `docs/apicpf.md:27-32` — **NÃO CONFIRMADO** (nenhuma chamada de rede feita; nenhum contrato/schema no repo além da doc) |
| **P-2** | Média | `Cache-Control` ausente para `/src/*`, `/css/*`, `/assets/*` → se o default da Vercel for `max-age>0`, assets ficam dual-cached (HTTP + SW) e um bump de `V` pode não refrescar o HTTP cache do navegador. | `vercel.json:35-59` (sem `Cache-Control`) — NÃO CONFIRMADO, depende do default da plataforma |
| **P-3** | Baixa | Logs de plataforma podem reter a query string com CPF (ou o header da chave). | `api/cpf.js:15-16`, `api/cpf.js:26` — comportamento da Vercel, NÃO CONFIRMADO |
| **P-4** | Baixa | **`sw.js` não tem timeout/abort** na requisição de rede de fallback (`sw.js:5`): um recurso que pendura (conexão instável) deixa a navegação pendurada até o navegador desistir, sem cair no `index.html` cacheado antes disso. | `sw.js:5` |
| **P-5** | Média | Upload multipart sem cap local (`src/services/google-drive.js:181-196`) vs limites de tamanho da Drive API: backup grande falha no meio do fluxo, com mensagem genérica de `responseError` (`:127`). | limite do provedor NÃO CONFIRMADO; nenhum cap no repo. Só há cap de **documento** (15 MB, `src/files/process.js:4`, `:6`) |
| **P-6** | Baixa | `folder()` pega `files[0]` de uma busca por nome: duas pastas homônimas → escrita em destino arbitrário; `appProperties.app` na criação (`:154`) não é usado na busca por nome (`:149-150`). | `src/services/google-drive.js:149-151` |
| **P-7** | Baixa | `escapeQ` (`:144`) escapa só `\` e `'`; hoje inofensivo (constantes), frágil se um nome/editável for interpolado na query OData do Drive. | `src/services/google-drive.js:144`, `:149`, `:162` |
| **P-8** | Baixa | `caches.match(..., {ignoreSearch:true})` (`sw.js:5`) ignora query strings no match: inofensivo hoje porque `/api/cpf` nunca é escrito em cache, mas pode servir conteúdo errado para qualquer recurso futuro que dependa de query. | `sw.js:5`, `sw.js:3` (sem `cache.put`) |
| **P-9** | Baixa | `frame-ancestors` ignorado quando CSP vem de `<meta>`; felizmente está no header (`vercel.json:54-57`) e há `X-Frame-Options: DENY`. Se alguém "mover" a CSP só para o meta, a proteção some. | `index.html:3`, `vercel.json:54-57` |
| **P-10** | Baixa | `connect-src` permite `oauth2.googleapis.com` que o código nunca chama → superfície desnecessária (e `script-src`/`style-src` dão `accounts.google.com` amplo, incluindo `unsafe-inline` em styles). | `index.html:3`; grep: nenhum uso do host |
| **P-11** | Média | Uso de `drive.file` com app em **mode Testing**: tokens expiram em 7 dias para apps não verificados/verificação pendente do Google (além do `expires_in` de 1 h) → backups podem ficar irrecuperáveis até re-consentir. | `docs/google-drive.md:100-104` (app em teste) — regra do provedor, NÃO CONFIRMADO |
| **P-12** | Baixa | `description` do manifest e o marketing afirmam "100% offline" enquanto 4 hosts externos são chamados em rotas de cadastro — legível como expectativa enganosa por um auditor de compliance. | `manifest.json:1` vs R1/R3/R4/R5/R6 |

### NÃO CONFIRMADO (ausência de informação no repo)

1. Runtime/versão do Node da function e se `fetch` global existe no ambiente (`vercel.json` sem `functions`; `api/cpf.js:25`).
2. Quais **origens JavaScript** estão realmente autorizadas no cliente OAuth do Google Cloud (`src/config/google.js:10` é só o reflexo local; só o console confirma).
3. Se a **Google Drive API está ativada** no projeto e se `js1715557@gmail.com` está na lista de testadores (`docs/google-drive.md:26`, `:100-104`).
4. Existência, contrato, SLA, retenção e base legal da APICPF (`api/cpf.js:3`, `docs/apicpf.md:27-32`).
5. Se a `APICPF_API_KEY` está de fato definida na Vercel — se não estiver, CPF está morto em produção (`api/cpf.js:19-20`).
6. Se a Vercel tem Git integration ativa (deploy automático em push) ou se o deploy é CLI manual (`README.md:230-247`, `.gitignore:1`).
7. Comportamento de logs da plataforma para query strings/headers (`api/cpf.js:15-16`, `:26`).
8. Limites numéricos de upload/quotas do Drive (`src/services/google-drive.js:181-196`).
9. Se o site publicado hoje é `https://scipione-cred-offline.vercel.app` (a única evidência é o repo; não foi feito acesso HTTP).

---

## 10. Respostas diretas às perguntas do escopo

**Segredos no repo:** **NÃO** no sentido de credencial confidencial (zero API key, zero `client_secret`, zero token, nenhum `.env` no histórico). **SIM** para identificadores públicos: 2 `client_id` OAuth + IDs/números de projeto GCP + 1 e-mail pessoal, sendo o `client_id` ativo **hardcoded** em `src/config/google.js:5`. Para OAuth de cliente público/token-flow de navegador isso é **aceitável por design** (§5.7); o problema é a sobre-divulgação (C-6), não o vazamento.

**Chamadas de rede:** **8 pontos** (5 a terceiros + 1 same-origin + 1 SW + 1 asset local). Telefones **não** saem do aparelho; CPF e CEP saem.

**Top 5 conclusões:** (1) `/api/cpf` é um endpoint público sem auth nem rate limit que devolve PII de terceiros e consome cota — o único vetor de abuso real do projeto (C-1/C-2); (2) o CPF vai na query string de GET em ambas as pernas, com falha configurada para ser silenciosa (C-3/C-9); (3) a integração do Drive é sólida em integridade (SHA-256, verificação de tamanho com DELETE transacional, whitelist de campos, token só em memória, secret descartado no import), mas **não faz refresh** e tem **cap de tamanho inexistente** (C-5/P-5); (4) há uma divergência doc↔código que torna o **import de JSON do Google Cloud impossível pela UI** tal como publicado, o que quebra o procedimento de rotação de `client_id` e o uso em localhost (C-4/8.5b); (5) a infraestrutura não tem CI, nem runtime pinado, nem headers de cache para os módulos — todo o controle de atualização mora em `FILES`/`V` mantidos à mão, o que é o ponto único de falha dos deploys (C-7/C-8).
