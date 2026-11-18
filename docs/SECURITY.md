# SCIPIONE CRED — Documento de Segurança (AppSec)

**Escopo:** autenticação local, criptografia do cofre, sessão, superfície de ataque, cabeçalhos/CSP, função serverless e saída de dados do aparelho.
**Alvo:** `/home/ubuntu/scipione-cred-offline`, commit de referência `e78d776` (branch `main`), conforme `/home/ubuntu/audit/3-seguranca.md:4` e `/home/ubuntu/audit/6-integracoes-infra.md:6`.
**Método:** revalidação linha a linha do relatório de segurança base contra o código desta branch, mais duas verificações por execução local (sem rede, sem escrita em banco): a semântica de `process.env` em `api/cpf.js` (`§3, V11`) e o inventário de sinks de DOM/armazenamento (`§5`).
**Modo deste documento:** **somente diagnóstico. Nada foi corrigido aqui.** Nenhum item da §3 ou §4 está resolvido nesta branch. Toda afirmação carrega `arquivo:linha`. Convenção de confiança: **CONFIRMADO** (lido/reproduzido no código), **POTENCIAL** (plausível, depende de suposição não verificada), **NÃO CONFIRMADO** (informação ausente).

> Regra declarativa deste documento: o fato de o app usar criptografia **não** é evidência de que o app é seguro. A primitiva criptográfica está correta (§2); a arquitetura de posse da chave e a camada de borda não estão (§3). As duas coisas são independentes e são avaliadas separadamente abaixo.

## 1. Escopo e modelo de ameaça

**O que o produto é.** Uma aplicação de navegador (PWA estática) que guarda clientes, dívidas, documentos e fotografias de terceiros no IndexedDB da própria origem, cifrados sob uma senha mestra escolhida pelo usuário. Não há servidor de dados, conta remota nem sincronização (`README.md:264`, `src/db/idb.js:13` — banco `scipione-cred`, local). A única persistência fora do aparelho é opcional e feita pelo próprio usuário via Google Drive (`src/services/google-drive.js:8`).

**Adversários plausíveis, do mais provável ao menos provável:**

| # | Adversário | Capacidade | O cofre resiste hoje? |
|---|---|---|---|
| A1 | Pessoa com o aparelho **destravado** (ou o próprio usuário sob coerção) | Ler a tela, operar a UI, aprovar `confirm()` | **Não.** Ver §6.6, §3/V1 |
| A2 | Script na mesma origem (XSS futuro, extensão com acesso à página, console) | Chamar `indexedDB.open('scipione-cred')` e `crypto.subtle` | **Não.** Ver §3/V1, §6.4 |
| A3 | Quem copia os arquivos do perfil do navegador (dump offline) | Ler `meta/vault`, `meta/session`, registros cifrados | Parcial: resiste enquanto a senha não cair; **não** resiste com sessão gravada (§3/V1) nem com `iter` rebaixado (§3/V3) |
| A4 | Visitante anônimo da URL publicada | Requisições HTTP a `/api/cpf` | **Não.** Proxy aberto (§3/V2) |
| A5 | Intermediário de rede / provedores de terceiros | Ver o que sai do aparelho | Mitigado em conteúdo (HTTPS, `connect-src` restrito), **não** mitigado em metadados: o CPF sai por design (§8) |
| A6 | Autor de um arquivo de backup forjado | Entregar um `.zip` que a UI incentiva a abrir | **Não.** Downgrade de KDF e DoS (§3/V3) |
| A7 | Malware/ransomware no aparelho, ou o próprio usuário por engano | Apagar ou substituir o banco | **Não.** Sem lixeira, sem versão anterior, sem backup automático (§6.8) |

**O que está protegido (enunciado estreito e defensável):** confidencialidade do **conteúdo em repouso** dos registros e dos blobs contra leitura do arquivo do banco sem a senha, dada senha de entropia adequada (§2, §3/V10); integridade do conteúdo pela tag AES-GCM (§2.6); ausência de telemetria oculta (§5.32, §8.1).

**O que NÃO está protegido:** o conteúdo com o cofre destravado; a chave de sessão, que é gravada em disco (§3/V1); a senha contra ofline em GPU (§3/V10, §6.5); a disponibilidade contra adulteração de 1 byte (§3/V5); a cota e a chave do titular da APICPF contra terceiros (§3/V2); a verdade das alegações de UI sobre a própria proteção (§3/V10, §9.5); a existência dos dados contra exclusão (§6.8). **Premissas do modelo:** Web Crypto disponível e não adulterada no dispositivo; origem servida por HTTPS; usuário único por perfil de navegador (não há controle de multiusuário — ver P3). Se qualquer premissa cair, as conclusões de confidencialidade em repouso caem com ela.

## 2. Mecanismo real de criptografia (o que o código faz, não o que o rótulo diz)

### 2.1 Parâmetros verificados
| Parâmetro | Valor no código | Onde é usado | Evidência |
|---|---|---|---|
| KDF | PBKDF2, HMAC interno **SHA-256** | derivação da KEK e da chave de backup | `src/security/crypto.js:6` (`{name:'PBKDF2',hash:'SHA-256',salt,iterations}`), `src/security/crypto.js:22` |
| Iterações do cofre | **600000** | `createVault` | `src/security/crypto.js:4` (`export const ITER=600000;`), aplicado em `src/security/crypto.js:8` |
| Iterações do backup | **600000** | `buildBackup` | `src/export/backup-format.js:5`, aplicado em `src/export/backup-format.js:17` e declarado no manifest `src/export/backup-format.js:18` |
| Iterações na leitura | **as que estiverem gravadas no dado** — sem piso nem teto | `openVault`, `readBackup` | `src/security/crypto.js:14` (`kek(pw,m.salt,m.iter)`), `src/export/backup-format.js:35` (`deriveAesKey(password,unhex(m.salt),m.iter)`) → **§3/V3** |
| Cipher de dados | **AES-GCM 256 bits** | DEK | `src/security/crypto.js:9` (`generateKey({name:'AES-GCM',length:256},...)`), `src/security/crypto.js:15,17,18,22` |
| Cipher da KEK | AES-GCM 256 (a KEK é uma chave AES usada só para wrap/unwrap) | `kek()` | `src/security/crypto.js:6` (`{name:'AES-GCM',length:256},false,['wrapKey','unwrapKey']`) |
| Salt | **16 bytes**, CSPRNG, um por cofre e outro por backup | `createVault`, `buildBackup` | `src/security/crypto.js:5,8`; `src/export/backup-format.js:17` |
| IV/nonce | **12 bytes, novo dentro de cada chamada** de cifra | toda gravação | `src/security/crypto.js:17` (`const iv=rnd(12)` dentro da função), chamado por `src/security/crypto.js:19` → `src/services/records.js:7` e `:8` |
| Formato em repouso | `[12 IV ‖ ciphertext ‖ tag GCM 16]`, IV prefixado | todo `data`/blob | `src/security/crypto.js:17` (`o.set(iv);o.set(ct,12)`), leitura em `src/security/crypto.js:18` |
| Extractability da KEK | `false`, usos `wrapKey/unwrapKey` | `kek()` | `src/security/crypto.js:6` |
| Extractability da DEK operacional | `false`, usos `encrypt/decrypt` | resultado de `unwrapKey` | `src/security/crypto.js:15`; teste `tests/crypto.test.mjs:8` |
| Compressão/aninhamento não autenticado | `manifest.json` externo do backup é **texto livre em claro**, não assinado | leitura do KDF | `src/export/backup-format.js:30-35` |

Nenhum uso de AES-CBC, de modo sem autenticação, de `length:128` ou de `Math.random` — verificados por grep (zero ocorrências em `src/`, `api/`, `sw.js`).

### 2.2 Comparação com a recomendação OWASP
A *OWASP Password Storage Cheat Sheet* lista, na seção PBKDF2, **`PBKDF2-HMAC-SHA256: 600.000 iterações (recommended)`** (cheatsheetseries.owasp.org, consultado em 2026-11-17). O código usa exatamente 600.000 (`src/security/crypto.js:4`, `src/export/backup-format.js:5`) ⇒ **conforme com o piso recomendado**, e a alegação pública bate com o código (`README.md:114`, `README.md:262`, `docs/README.md:5`).

Três ressalvas honestas, na ordem dura:

1. PBKDF2 é a **terceira** escolha da OWASP; Argon2id e scrypt vêm antes por serem *memory-hard*. O app **não** tem escolha: a Web Crypto API não expõe Argon2id, e um PBKDF2 em JS puro seria mais lento e auditável pior. Consequência real: a defesa contra GPU depende **da entropia da senha do usuário**, que o app não mede (§9.4).
2. 600.000 é um **piso**, não um teto nem uma garantia permanente. Como o `iter` é lido do dado (`src/security/crypto.js:14`) e nunca re-derivado, **não há caminho de upgrade** — se a recomendação subir, cofres existentes ficam em 600k para sempre (§3/V6).
3. A OWASP também exige salt único por segredo (✓ `src/security/crypto.js:8`) e proíbe armazenar a senha (✓ `src/security/crypto.js:2`, `src/security/auth.js:20-21` — só `salt/iv/wrapped/iter` são gravados).

### 2.3 Envelope KEK → DEK
`createVault` (`src/security/crypto.js:7-12`): salt 16 B + IV 12 B aleatórios → KEK por PBKDF2 (`:8`) → **DEK aleatória de 256 bits** gerada pelo CSPRNG do navegador (`:9`) → `wrapKey('raw', dek, kek, {AES-GCM, iv})` (`:10`) → grava `{salt, iv, wrapped, iter, kdf, cipher, v:1}` (`:11`). A senha nunca entra no banco; o que se grava é a DEK embrulhada. Vantagem real e verificável: trocar a senha exige apenas re-embrulhar 1 registro (a arquitetura já suporta) e não re-cifrar nada — capacidade que **não** foi exposta por nenhuma função (`§3/V6`). Nuance técnica que precisa ser dita: no instante da criação a DEK é gerada com `extractable=true` (`src/security/crypto.js:9`) porque `wrapKey('raw', …)` exige; a chave **operacional** — a que o app usa depois — vem de `unwrapKey(…, false, …)` (`src/security/crypto.js:15`) e é não-extrável, coberto por `tests/crypto.test.mjs:8`. A janela de extração existe só no escopo local de `createVault` e nenhuma chamada a `exportKey` existe em `src/` (grep: zero).

### 2.4 Onde ficam salt, iterações e o "verificador"
Tudo no registro `meta/vault`, **em claro**, store não cifrada (`src/db/idb.js:3`), gravado em `src/security/auth.js:21`. Isso é **correto por projeto**: salt e `iter` são públicos por definição. O ponto que importa para a ameaça: esses campos são o material de ataque offline — um dump de `meta/vault` entrega a um atacante `salt` + `wrapped` + `iter`, ou seja, uma instância de hash-cracker completa (`§3/V10`).

**Não existe verificador de senha separado** (nem hash, nem PBKDF2 comparado a um valor gravado). O verificador é o próprio teste criptográfico de desembrulho: `crypto.subtle.unwrapKey` (`src/security/crypto.js:15`), cuja **tag de autenticação do AES-GCM** decide o sucesso. Senha errada ⇒ KEK errada ⇒ falha de tag ⇒ promessa rejeitada. Confirmado por teste: `tests/crypto.test.mjs:4` (`assert.rejects(openVault('errada',meta))`). Não há caminho no código que atribua `key` sem essa promessa resolver: a única atribuição é `src/security/auth.js:28` (`key=await C.openVault(...)`), e em `catch` a variável fica como estava. Não há fallback de PIN, "modo offline sem senha" nem decode alternativo (busca manual em `src/security/auth.js:24-36` e `src/main.js:15-24`).

### 2.5 Não-extratabilidade da DEK — e o que ela **não** significa
`extractable:false` (`src/security/crypto.js:15`) impede `exportKey` — a aplicação não consegue imprimir os bytes da chave, e `tests/crypto.test.mjs:8` trava esse comportamento. **Isso não impede o uso da chave.** Enquanto o objeto `CryptoKey` estiver alcançável, `crypto.subtle.decrypt` funciona. Duas rotas alcançam a chave sem a senha:

- a variável de módulo `key` (`src/security/auth.js:6`), alcançável por qualquer código same-origin por closure em runtime;
- o registro **`meta/session`**, que contém a própria `CryptoKey` persistida (`src/security/auth.js:55`) e é relida como credencial de sessão em `src/security/auth.js:47` (`key=s.dek`).

Portanto o comentário `crypto.js:2` ("DEK é não extraível") é **tecnicamente exato e operacionalmente enganoso**: a chave é não-extrável, mas é **utilizável por qualquer script da mesma origem** enquanto o registro existir, e **está em repouso no disco**. É a diferença entre "ninguém consegue copiar a chave" e "ninguém consegue usar a chave" — o código entrega a primeira e o texto sugere a segunda. Ver §3/V1.

### 2.6 Autenticação de conteúdo e falha
A tag GCM faz `crypto.subtle.decrypt` **rejeitar** (`OperationError`) em adulteração, truncamento ou chave errada — detectado por teste com bit-flip real em `tests/crypto.test.mjs:6`. `openBytes` **não** valida `b.length>=12` antes de fatiar o IV (`src/security/crypto.js:18`), então um registro truncado produz a mesma exceção genérica de chave errada — confunde corrupção com ataque. A propagação dessa exceção é o problema: §3/V5.

### 2.7 Segmentação de chave
**Não há.** Uma única DEK serve `clients`, `debts`, `documents`, `history`, `blobs` (`src/services/records.js:7,8,9`) e o teste de integridade (`src/ui/settings.js:31-32`), sempre via `getKey()` (`src/security/auth.js:14`). Consequência direta: qualquer rota que obtenha a DEK obtém 100 % do cofre; não há revogação parcial. Aceitável num cofre pessoal monolítico, mas deve ser lido como decisão, não como proteção.

### 2.8 Em claro por design (inventário)
| Dado | Estado | Evidência |
|---|---|---|
| `id`, `createdAt`, `clientId` de cada registro | em claro (são as chaves/índices) | `src/services/records.js:1,7`; índices `src/db/idb.js:5-8`; alegação `README.md:263` confere |
| `meta/vault` (`salt`,`iv`,`wrapped`,`iter`) | em claro | `src/security/auth.js:21` |
| `meta/session` (**a DEK**), `meta/guard`, `settings` | em claro | `src/security/auth.js:55,26-30,49` |
| `sc.sid` / `sc.last` no sessionStorage | em claro | `src/security/auth.js:5,7-9` |
| Configuração OAuth (`clientId`,`projectId`,`origins`) no localStorage | em claro, **sem segredo** | `src/services/google-drive.js:11,45`; os 4 campos são o único output de `parseClientJson` (`:41`) |
| Nome, CPF, RG, valores, fotos, PDFs | **cifrados** | `src/services/records.js:7,8` |

Um dump do banco revela, portanto, **quantos** clientes existem, os UUIDs, as datas de criação e o grafo dívida/documento→cliente — dado suficiente para afirmar "fulano mantém N operações, a mais recente em tal data" — mas não nomes, documentos, valores nem anexos.

## 3. VULNERABILIDADES CONFIRMADAS

Severidades: Crítica / Alta / Média / Baixa. **Status de todas: NÃO CORRIGIDO NESTA BRANCH** — este documento só descreve; nenhuma linha de código foi alterada. V1–V10 correspondem a C1–C10 de `/home/ubuntu/audit/3-seguranca.md§12`, revalidadas uma a uma no código desta branch (todas procedem; duas citações do relatório base foram corrigidas — ver notas em V8 e V9). V11 é nova, confirmada por execução.

### V1 — (Alta) A DEK de dados é gravada no IndexedDB e sua remoção no bloqueio não é garantida
- **Evidência:** gravação `src/security/auth.js:55` (`db.put('meta',{key:'session',sid:s,dek:k,last:now,mins})`), reuso como credencial `src/security/auth.js:47` (`key=s.dek`), reescrita periódica a cada 1,8 s `src/security/auth.js:53,62`, remoção **não aguardada e com erro engolido** `src/security/auth.js:67` (`db.del('meta','session').catch(()=>{})` dentro de `lock()` **síncrono**, `:65`), limpeza apenas oportunística na próxima inicialização `src/security/auth.js:43,46`. Ausência confirmada de `pagehide`/`beforeunload` (grep em `src/` + `sw.js`: zero ocorrências). Store não cifrada: `src/db/idb.js:3`.
- **Pré-condição do atacante:** código executando na mesma origem (extensão com page access, XSS futuro, `javascript:` no console, DevTools) **ou** cópia dos arquivos do perfil do navegador feita enquanto houve sessão destravada.
- **Impacto:** leitura integral do cofre em claro **sem a senha** (`indexedDB.open('scipione-cred')` → `get('meta','session')` → `crypto.subtle.decrypt` com os `data` de `src/services/records.js:4`). Anula a premissa central do produto contra A2 e A3. Duas falhas secundárias confirmadas: (i) entre `lock()` e o `oncomplete` da transação (`src/db/idb.js:21`) a chave continua no disco; (ii) se o `delete` falhar (quota, abort, aba fechada), fica lá indefinidamente, sem sinal — e o `catch{}` em `src/security/auth.js:55` silencia até a falha de **gravação**. **Status: não corrigido nesta branch.**

### V2 — (Alta) `api/cpf.js` é um proxy aberto: sem autenticação de chamador, sem rate limit, sem controle de origem
- **Evidência:** único gate é o método (`api/cpf.js:14`); lê o segredo do ambiente (`api/cpf.js:19`) e consulta o terceiro (`api/cpf.js:25-26`) para qualquer CPF estruturalmente válido (`api/cpf.js:16-17`). Nenhuma checagem de `Origin`/`Referer`/sessão/nonce/IP em `api/cpf.js:13-48`; nenhum `middleware.js` no repo; nenhum bloco `functions`/regra de velocidade em `vercel.json` (lido integralmente, 62 linhas). Cota citada pelo próprio projeto: 100 consultas/dia e 6/min (`docs/apicpf.md:32`). O amortecedor existente é só o cache da aba (`src/services/apicpf.js:3,12`), inútil contra chamador externo.
- **Pré-condição do atacante:** estar online. Nada mais — nenhuma credencial, nenhum header de navegador.
- **Impacto:** esgotamento da cota (que a UI **silencia**: `api/cpf.js:41-42` + `src/ui/clients.js:90-94`), custo em plano pago, uso da chave do titular como credencial anônima para consultar PII de terceiros, e **oracle** de existência de registro pela diferença 200/422 (`api/cpf.js:31-39`). A ausência de CORS e o `Referrer-Policy` (`vercel.json:43-44`) não protegem clientes não-browser. **Status: não corrigido nesta branch.**

### V3 — (Média) Parâmetros do KDF (`iter`, `salt`) vêm de dado **não autenticado**, sem piso nem teto
- **Evidência:** `src/security/crypto.js:14` usa `m.iter` lido do IndexedDB; `src/export/backup-format.js:35` usa `m.iter` e `m.salt` lidos do `manifest.json` do arquivo. O `ITER` do código (`src/export/backup-format.js:5`) é usado **só na escrita** (`:17,18`); a leitura nunca o compara. `unhex` aceita string hex de qualquer comprimento (`src/export/backup-format.js:6`). O manifest externo é carregado antes de qualquer autenticação — `src/export/backup-format.js:30-33` só verifica `app` e `formatVersion`, e a `catch` de `:35` não distingue chave inválida de parâmetro inválido.
- **Pré-condição do atacante:** entregar um `.zip` que finja ser backup (`{encrypted:true, salt:"<32 hex>", iter:1, payload.enc:<bytes>}`) e a vítima usar "Verificar arquivo" (`src/ui/tools.js:44-50`), fluxo que a UI **incentiva**. Não exige cofre destravado nem rede.
- **Impacto:** (a) a UI de restauração vira **oracle de força bruta de custo quase nulo** — o teste com `iter:1` é reproduzível offline por quem forneceu o arquivo, eliminando as 600k iterações por palpite; (b) DoS: `iter` enorme congela a *main thread* dentro de `deriveKey` (`src/security/crypto.js:22`) **antes** de qualquer `confirm()` (`src/ui/tools.js:47`); (c) para o cofre, quem escreve no banco pode rebaixar `m.iter` (`src/security/auth.js:21`) e reduzir o custo de guess. **Status: não corrigido nesta branch.**

### V4 — (Média) Erro de integridade/banco é reportado como "Senha incorreta" e **consome tentativa**
- **Evidência:** `src/security/auth.js:28` — `try{key=await C.openVault(pw,m)}catch{ ... }` sem inspecionar `e.name`; a seguir `:29-30` incrementa `g.fails`, aplica atraso e lança `'Senha incorreta.'`. Falha de escrita do contador é fail-open: `db.put('meta',g)` está dentro do caminho de erro e qualquer rejeição ali é engolida pelo gate de UI (`src/main.js:25` → `err.textContent=fmt(x)`), que mostra a mesma frase.
- **Pré-condição do atacante:** uma escrita em `meta/vault` (registro truncado, `wrapped` alterado, `iter` ausente) — acessível a A2/A3 — ou simples corrupção acidental (Safari/iOS descrito em `docs/README.md:9`).
- **Impacto:** negação de acesso com uma única escrita; e o usuário legítimo recebe "Senha incorreta." para a senha **correta**, cinco vezes, entrando em atraso crescente (`src/security/auth.js:29`, teto 300 s) sem jamais ver a causa real. O erro verdadeiro é destruído pelo `catch{}` — diagnóstico impossível. **Status: não corrigido nesta branch.**

### V5 — (Média) Falha de autenticação GCM em **um** registro derruba a leitura da **store inteira**, sem mensagem
- **Evidência:** `src/services/records.js:5` (`list` = `Promise.all(...map(dec))`) com `dec` propagando a rejeição (`:4`); ausência de `try` em `src/ui/clientlist.js:32` (`[cs,ds]=await Promise.all([S.listClients(),DS.listDebts()])`, chamado por `:33`) e em `src/services/dashboard.js:3-4` (`stats()` = `Promise.all([listClients(),listDebts(),list('history'),…])`), consumido sem `try` em `src/ui/dashboard.js:10`. Onde há tratamento, ele é genérico (`src/main.js:8` repassa `e.message` cru) ou **silencioso** (`src/ui/clients.js:38` `catch{return}`, `src/ui/clients.js:139` `.catch(()=>{})`).
- **Pré-condição do atacante:** alterar 1 byte de 1 registro (ou remover 1 blob) no arquivo do banco — A2/A3. Nenhum ataque remoto é necessário nem possível.
- **Impacto:** indisponibilidade muda: a listagem aparece **vazia**, indistinguível de "não cadastrei nada" — o pior modo de falha possível num produto de controle financeiro, porque o usuário age (cadastra, cobra) sobre um estado que lê errado. A detecção criptográfica é correta; a **resposta** do app é que falha. O teste existente cobre a detecção, não a experiência: `tests/crypto.test.mjs:6`. **Status: não corrigido nesta branch.**

### V6 — (Média) Não existe troca de senha nem rotação da DEK; não existe upgrade de parâmetros de KDF
- **Evidência:** grep por `changePassword|alterar senha|trocar senha|reencrypt|rewrap` em `src/`, `README.md`, `docs/` → **zero ocorrências**. A API de `src/security/auth.js` expõe apenas `setup` (`:18`), `unlock` (`:24`), `lock` (`:65`), `setIdle` (`:49`), `restoreSession` (`:38`); `src/security/crypto.js` só tem `createVault` (`:7`) e `openVault` (`:13`) — nenhum rewrap. `iter` é escrito uma vez (`src/security/crypto.js:11`) e lido do banco para sempre (`:14`).
- **Pré-condição do atacante:** conhecimento prévio (ou suspeita) da senha — vazamento por reuso, observação por cima do ombro, gravação do teclado.
- **Impacto:** sem reação proporcional. A única medida disponível é apagar o cofre e reimportar backup (`src/ui/tools.js:44-50`), o que perde o histórico se não houver cópia e **mantém a mesma DEK** se o backup for reimportado com o mesmo material. Também fica impossível migrar para 1 M de iterações quando a OWASP subir o piso (§2.2.2). A arquitetura envelope (§2.3) torna o rewrap uma operação de 1 registro; a capacidade existe e não foi exposta. **Status: não corrigido nesta branch.**

### V7 — (Baixo) O header CSP de produção entrega **apenas** `frame-ancestors`; o hardening real mora em `<meta>` — e a documentação atribui isso ao canal errado
- **Evidência:** `vercel.json:55-56` (`Content-Security-Policy: frame-ancestors 'none'`, e nada mais) contra `index.html:3` (CSP completa em `http-equiv`). Onde só o header se aplica, não há `script-src`: respostas de `api/cpf.js:6-11` e qualquer HTML gerado pela plataforma. Alegação documental imprecisa em `docs/auditoria-ui-ux-codigo.md:14`, que credita "`object-src 'none'`" ao Vercel — essa diretiva **só** existe em `index.html:3`.
- **Pré-condição do atacante:** servir conteúdo HTML na origem por um caminho sem a meta (página de erro/redirect da plataforma, deploy alternativo, rota futura), ou operar no GitHub Pages (§7.4).
- **Impacto:** *defense-in-depth* quebrada e ponto único de falha disciplinar: quem edita `vercel.json` não vê o hardening, quem edita `index.html` pode removê-lo sem perceber que ali mora a proteção real. Não é explorável hoje (§6.1, §5.5). **Status: não corrigido nesta branch.**

### V8 — (Baixo) Object URLs de conteúdo **decifrado** continuam válidas por 60–120 s após o uso
- **Evidência:** `src/export/lib.js:5` (`setTimeout(()=>URL.revokeObjectURL(u),6e4)` = 60 s), `src/ui/clients.js:144` (PDF aberto em nova aba, `12e4` = **120 s**), `src/ui/clients.js:145` (download de documento, `6e4` = **60 s**). Em contraste, os ciclos guiados por `onLock` estão corretos: `src/ui/avatar.js:7-12`, `src/ui/clients.js:3-4`. *Correção ao relatório base:* ele atribuía `120 s` a `clients.js:145`; a linha 145 usa `6e4` (60 s) — verificado byte a byte nesta branch.
- **Pré-condição do atacante:** acesso à origem (A2) ou ao aparelho (A1) durante a janela; a URL usa UUID não adivinhável, então o ataque é por releitura do DOM (`src/ui/clients.js:144` mantém `w.location.href` apontando para o blob) e não por enumeração.
- **Impacto:** janela de retenção desnecessária de PII em claro alcançável por script same-origin, mesmo depois de o usuário bloquear o cofre — cenário composto com V1. **Status: não corrigido nesta branch.**

### V9 — (Baixo) MIME e nome de arquivo do usuário são confiados sem verificação de conteúdo, e a rota "Abrir" navega num `blob:` de mesma origem
- **Evidência:** `src/files/process.js:8` grava `type:file.type||'application/octet-stream'` — o tipo vem **do cliente**; a única checagem é regex de imagem em `:9`. A gravação de `orig:file.name` e `type:f.type` acontece em `src/services/clients.js:42`. O botão "Abrir" é habilitado por esse tipo (`src/ui/clients.js:182`) e navega `w.location.href = blob:` (`src/ui/clients.js:144`). `fname` usa `d.orig` cru quando o MIME não está na tabela `EXT` (`src/ui/clients.js:126-127`). O `accept=` do input (`src/ui/clients.js:142`) é conveniência de UI, não controle. *Correção ao relatório base:* a gravação de `orig` está em `src/services/clients.js:42`, não em `src/ui/clients.js:42` (que é a exclusão de cliente).
- **Pré-condição do atacante:** entregar um documento (ou um `.zip` restaurado, §10.4) com `type`/`orig` forjados, e o usuário anexá-lo ou restaurá-lo.
- **Impacto:** download com nome/tipo incoerentes (ex.: nome `contrato.pdf` sobre conteúdo HTML, ou `nota.html` com MIME `application/octet-stream`) — vetor clássico de engenharia social em arquivo salvo em disco; e navegação same-origin para bytes controlados por terceiro. A execução de script nesse `blob:` é o item **NÃO CONFIRMADO** — ver P11. **Status: não corrigido nesta branch.**

### V10 — (Baixa) O anti-tentativas é local, apagável e inócuo, mas é **apresentado ao usuário como proteção**
- **Evidência:** contador em `meta/guard` — no banco do próprio alvo (`src/security/auth.js:26`, escrita em `:30`), verificação antes da senha (`:27`) e mensagem "`Aguarde N s para tentar novamente.`"; atraso exponencial com teto de 300 s (`:29`); reset apenas em sucesso (`:32`), sem reset temporal, sem wipe após N falhas, sem detecção de adulteração. Como a senha não é armazenada (`src/security/crypto.js:2`), a ofline real roda contra `meta/vault` (`src/security/auth.js:21`). O projeto **admite** isso em `docs/README.md:9` e `README.md:267` — mérito de transparência que não anula a UI.
- **Pré-condição do atacante:** acesso ao aparelho ou cópia do banco; apaga/reescreve `meta/guard` e o contador desaparece, ou roda o ataque fora do navegador, onde o contador nunca existiu.
- **Impacto:** a tela comunica uma proteção que não existe contra o adversário relevante (A3), o que induz o usuário a aceitar senhas fracas (§9.5). Classificado Baixo como falha e **Alto como desinformação**. **Status: não corrigido nesta branch.**

### V11 — (Média) `tests/apicpf.test.mjs` **não exerce** a guarda de chave ausente: atribuir `undefined` a `process.env` produz a string `"undefined"` (truthy) e a função dispara a chamada real ao terceiro
- **Evidência do código:** `tests/apicpf.test.mjs:7` faz `process.env.APICPF_API_KEY=key;` e `:15` chama `call('/api/cpf?cpf='+CPF, undefined)`. Em Node, atribuir `undefined` a `process.env` converte para a **string** `"undefined"`, de modo que `if(!key)` em `api/cpf.js:20` é **falso** e a guarda não barra. O stub de `globalThis.fetch` só é instalado em `tests/apicpf.test.mjs:26` — depois do caso de 503 (`:15-17`) —, então `api/cpf.js:25` usa o `fetch` global real e emite `GET https://apicpf.com/api/consulta?cpf=11144477735` (mesma linha 25; `ENDPOINT` em `api/cpf.js:3`) com header `X-API-KEY: undefined` (`api/cpf.js:26`). O `assert` de 503 (`:16`) é satisfeito **pelo `catch`** de `api/cpf.js:43-44` (falha de rede/`503` do upstream), não pela guarda.
- **Evidência por execução (esta auditoria, ambiente isolado, `fetch` stubado para não tocar a rede):** `process.env.SC_DEMO = undefined` ⇒ valor observado `"undefined"`, truthy `true`; com `APICPF_API_KEY=undefined`, `handler` retornou **200** e **1 chamada de rede** para `https://apicpf.com/api/consulta?cpf=11144477735` com `{"X-API-KEY":"undefined"}`; refazendo com `delete process.env.APICPF_API_KEY`, retornou **503** `{"ok":false,"reason":"UNAVAILABLE"}` com **0 chamadas**. O CPF `11144477735` é o CPF de teste estruturalmente válido já presente no repositório (`tests/apicpf.test.mjs:4`) — dado fictício, sem titular real.
- **Pré-condição do atacante:** nenhuma para o efeito de teste; para o efeito de produto, o cenário é uma implantação em que a variável seja definida **literalmente** como a string `"undefined"`/`"null"` (erro de configuração comum em templates de ambiente) — nesse caso a função não falha fechada: envia a chave inválida ao terceiro e gasta cota a cada consulta.
- **Impacto:** (i) o teste que deveria provar o *fail-closed* de `api/cpf.js:20` prova outra coisa e cria **cobertura falsa** (o `assert` passa pelo `catch`, que é o mesmo caminho de V2); (ii) cada execução da suíte faz tráfego de saída real para um terceiro pago com credencial inválida, consumindo cota e expondo o CPF de teste em logs de borda do provedor (§8.3); (iii) o padrão `if(!process.env.X)` não distingue "não configurada" de "configurada com o texto `undefined`", que é exatamente o modo de falha que a guarda existe para impedir. **Status: não corrigido nesta branch.**

## 4. RISCOS POTENCIAIS (não confirmados)

Nada nesta seção foi reproduzido nem refutado: cada item é **plausível** e explicita **o que falta para confirmar**. Severidade indicada é a provável *se confirmado*.

| # | Risco | O que falta para confirmar | Onde atuaria |
|---|---|---|---|
| P1 | Custo financeiro e plano real da APICPF; se o abuso de V2 é monetário ou só funcional | Acesso ao painel APICPF/Vercel + contrato com o provedor (fora do repo) | `api/cpf.js:19-26`, `docs/apicpf.md:32` |
| P2 | O CPF aparece nos **logs de acesso da plataforma** (query string de GET), contradizendo a leitura de `docs/apicpf.md:36` ("não registra… os dados") | Política de retenção de logs da Vercel Observability. Confirmado **apenas** que o código não loga: zero `console.*` em `api/`, `src/services/`, `src/config/` | `api/cpf.js:15-16`, `src/services/apicpf.js:24` |
| P3 | Uso em **dispositivo compartilhado** (funcionário, familiar) — a ameaça dominante do modelo (A1) | Perfil de uso real do titular. Não existe nenhum controle de multiusuário no código | `src/security/auth.js:6-48` |
| P4 | Deploy no **GitHub Pages** elimina todos os headers e a função serverless | Verificar a implantação efetiva usada em produção (`README.md:249-258`, `docs/auditoria-ui-ux-codigo.md:23`) | §7.4 |
| P5 | `access-control-allow-origin: *` observado no `/` estático (default da plataforma para assets) vira problema se um futuro arquivo público contiver segredo | Confirmação de qual origem aplica o header e da política de assets; nenhum segredo existe hoje | `vercel.json:36-58` |
| P6 | Extensões com `debugger`/host permissions usando a DEK persistida **sem a senha** | Conjunto de extensões do aparelho-alvo. A capacidade técnica é a de V1; o que não se confirmou é a presença do atacante | `src/security/auth.js:55` |
| P7 | Senha mestra fraca (mínimo 8, sem medida de entropia, sem recusa de senhas comuns, sem normalização NFKC) | Hábito do usuário. Ausência de medidor é confirmada (`src/main.js:19`) | `src/main.js:19`, `src/security/crypto.js:6` |
| P8 | `settings/idleMinutes` e `meta/*` editáveis por quem tem o banco: `mins` arbitrário ⇒ `setTimeout` de horas (`src/security/auth.js:60`); `guard.until` no futuro ⇒ negação de acesso (`:27`) | Definir se "acesso de escrita ao IndexedDB" está fora do modelo de ameaça assumido pelo produto | `src/security/auth.js:26-33,60,64` |
| P9 | Ausência de SRI sobre `vendor/fflate.min.js` e sobre os assets precacheados: host/CDN comprometido serve JS alterado, e `script-src 'self'` (`index.html:3`) **não** ajuda | Integridade da Vercel e do repositório — fora do escopo estático | `src/export/lib.js:2-4`, `sw.js:2-3` |
| P10 | iOS/Safari apagar o IndexedDB de site **não instalado** em ~7 dias ⇒ perda total de dados | Aparelho-alvo e se o app é instalado de fato; o risco é admitido em `docs/README.md:9` | `src/pwa.js:4`, `docs/README.md:9` |
| P11 | Navegação num `blob:` de PDF forjado **executar script na mesma origem** em algum navegador-alvo (Safari, versões legadas) de forma diversa do Chrome | **Prova de conceito não executada** (nenhum dado foi escrito em navegador real). O caminho do código é o de V9 | `src/ui/clients.js:144` |
| P12 | `autocomplete:'current-password'` (`src/main.js:29`) permitir que o gerenciador do navegador grave a senha mestra em claro no perfil | Política do produto sobre gerenciadores; o atributo está lá e é decisão defensável | `src/main.js:9,29` |
| P13 | Restauração de backup malicioso injetar PII falsa/anexos no cofre legítimo **sem nova autenticação** (a restauração exige só a sessão destravada) | Interesse/oportunidade de distribuir `.zip` — o canal existe (V3) e a injeção de dados é consequência lógica, não observada | `src/ui/tools.js:44-50`, `src/export/backup.js:12-29` |
| P14 | Colisão de IV aleatório por aniversário sob a mesma DEK (~2³² cifrações) | Volume real de cifrações por instalação. Teórico: o app está ordens de grandeza abaixo do limite do GCM; `IV` é novo por chamada (`src/security/crypto.js:17`) | `src/security/crypto.js:17` |
| P15 | Sobre-divulgação de metadados de conta em repositório público: `clientId` + `projectId` reais (`src/config/google.js:5,8`) e um segundo cliente legado documentado | Nenhum — é **confirmado** que os valores estão no repo; o que é potencial é o uso deles em phishing da tela de consentimento | `src/config/google.js:4-11`, `docs/google-drive.md:93-121` |
| P16 | Versão do runtime da função não pinada, com dependência de `fetch` global (Node ≥ 18) e import de `../src/domain/validators.js` fora de `api/` | Teste em runtime real de deploy. Confirmado apenas que `vercel.json` não declara bloco `functions` | `api/cpf.js:1,25`, `vercel.json:1-62` |

## 5. BOAS PRÁTICAS PRESENTES (verificáveis linha a linha)

1. **Zero sinks de parsing de HTML/JS no app.** `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval(`, `srcdoc`, `javascript:` e `new Function`: **0 ocorrências** em `src/`, `api/`, `sw.js`, `index.html` e `vendor/` (reexecutado nesta branch). A única ocorrência de `new Function` no repositório está fora do app: `tests/backup.test.mjs:2`, carregando o UMD local em Node.
2. **DOM construído por criação de nós**, nunca por parsing: `src/main.js:5` (`createElement` + `setAttribute` + `append`), limpeza por `replaceChildren` (`src/main.js:6`, `src/ui/clients.js:41`); strings viram nós de texto (`src/ui/clients.js:180`).
3. **Nenhum nome de atributo derivado de dado** nos call sites de `h()` (todos passam objeto literal) e **nenhum `style:` vindo de dado**; o único `.style.` é atribuição literal em `src/ui/settings.js:24`.
4. **Nome de arquivo renderizado por `textContent`**: `src/ui/kit.js:13` (`name.textContent=f?f.name:text`).
5. **CSP de documento sem `unsafe-inline` em `script-src`** e sem `unsafe-eval`: `index.html:3` (`script-src 'self' https://accounts.google.com`), com `object-src 'none'`, `base-uri 'none'`, `form-action 'none'`, `frame-src` restrito e `connect-src` em allowlist exatamente igual ao tráfego real (§8). Único `script` do documento é externo: `index.html:11`.
6. **PBKDF2-HMAC-SHA256 a 600.000 iterações, cofre e backup**, igual ao piso OWASP: `src/security/crypto.js:4`, `src/export/backup-format.js:5,17`.
7. **AES-GCM-256 em todos os caminhos de dados**, sem modo não autenticado: `src/security/crypto.js:6,9,15,17,18,22`.
8. **Aleatoriedade sempre de CSPRNG, zero `Math.random`**: `src/security/crypto.js:5`; salt 16 B por cofre e por backup (`:8`, `src/export/backup-format.js:17`); IV 12 B novo **dentro** de cada cifra (`src/security/crypto.js:17`).
9. **Envelope KEK→DEK** com DEK aleatória embrulhada pela KEK derivada: `src/security/crypto.js:7-12`; senha nunca armazenada: `src/security/crypto.js:2`, `src/security/auth.js:20-21`.
10. **Desbloqueio por verificador criptográfico** (tag GCM do `unwrapKey`), não por comparação de string: `src/security/crypto.js:15`; senha errada rejeitada por teste: `tests/crypto.test.mjs:4`; **não há rota que aceite senha errada** (única atribuição em `src/security/auth.js:28`) e sondas impedem recriação silenciosa do cofre (`src/security/auth.js:19`).
11. **Adulteração e reuso de IV cobertos por teste real**, com bit-flip e comparação de duas cifrações do mesmo claro: `tests/crypto.test.mjs:6,7`; não-extratabilidade: `:8`.
12. **Proteção real de sessão não é cosmética**: `getKey()` lança quando trancado (`src/security/auth.js:14`), e as telas assíncronas conferem antes de renderizar (`src/main.js:48`, `src/ui/dashboard.js:9,11`, `src/ui/clientlist.js:32`, `src/ui/settings.js:19`). Esconder a navegação (`src/ui/shell.js:49-50`) é redundância, não a barreira.
13. **Auto-lock existe e é configurável (1/5/15/30 min)** com listeners de atividade e `visibilitychange`: `src/security/auth.js:11,58-64`, `src/ui/settings.js:28-29`; bloqueio manual em três pontos (`src/ui/shell.js:36,42-43`, `src/ui/settings.js:54`).
14. **Revogação de object URLs no bloqueio**, com `epoch` para descartar respostas em voo — o caso clássico de retenção de texto puro: `src/ui/avatar.js:6-12`, assinado em `:12`; `src/ui/clients.js:3-4`.
15. **Token do Google só em memória, nunca persistido**: `src/services/google-drive.js:14` (`let … token=null`), atribuído apenas no callback (`:102`), usado como Bearer (`:134`), zerado por `resetAuth()` (`:19`) e em 401 (`:139`); **sem refresh token e sem cookie**. Verificação cruzada: nenhuma ocorrência de `token` em `localStorage`/`sessionStorage`/IndexedDB.
16. **`client_secret` é recusado e estruturalmente impossível de persistir**: tipo `installed` rejeitado (`src/services/google-drive.js:39-40`) e `parseClientJson` devolve **somente** `{clientId,projectId,type,origins}` (`:41`), de modo que o `localStorage.setItem` de `:45` não pode gravar segredo nem com JSON malicioso.
17. **Escopo OAuth mínimo** `drive.file` (`src/services/google-drive.js:8`) + marcação `appProperties.app` na criação (`:154,187`) e filtro na listagem (`:171`).
18. **Segredo da APICPF só no servidor**: lido apenas em `api/cpf.js:19` e usado só no header interno (`:26`); zero ocorrências no bundle do navegador (o cliente conhece apenas o path relativo `/api/cpf`, `src/services/apicpf.js:24`); `.env.example` com valor vazio; `apicpf.com` **não** está em `connect-src` (`index.html:3`), então uma chamada direta do navegador seria bloqueada pelo próprio navegador.
19. **`Cache-Control: no-store` na função** (`api/cpf.js:9`, asserido em `tests/apicpf.test.mjs:30`) e **nenhum `caches.put` em runtime** no service worker (`sw.js:3-5`) — PII não entra em Cache Storage nem em cache intermediário; o cache é pré-carga estática de `sw.js:2`.
20. **`no-cache` em `/` e `/index.html`, `no-cache, no-store, must-revalidate` em `/sw.js` com `Service-Worker-Allowed: /`**: `vercel.json:8-14,21-23,30-32`. Isso é o que faz a atualização do SW chegar a um app instalado.
21. **Headers de defesa presentes** para `/(.*)`: `X-Content-Type-Options: nosniff` (`vercel.json:39-40`), `Referrer-Policy: no-referrer` (`:43-44`), `X-Frame-Options: DENY` (`:47-48`), `Cross-Origin-Opener-Policy: same-origin-allow-popups` (`:51-52`, necessário ao popup OAuth), CSP `frame-ancestors 'none'` (`:55-56`).
22. **Entrada da função validada e saída em whitelist**: normalização a dígitos (`src/domain/validators.js:1`), exigência de 11 dígitos + dígitos verificadores com bloqueio de repetidos (`:2-3`, aplicado em `api/cpf.js:17`), `URL` com base absoluta (`api/cpf.js:15`), timeout com `AbortController` (`:4,22-23`) e `clearTimeout` em `finally` (`:45-46`); resposta restrita a 3 campos tipados (`api/cpf.js:32-36`) — nenhum campo extra do upstream é repassado, verificado em `tests/apicpf.test.mjs:42`.
23. **Integridade de backup em quatro camadas**: SHA-256 por arquivo escrito (`src/export/backup-format.js:11`) e recomparido na leitura (`:40`), rejeição de entrada inesperada (`:39`) e de manifest estranho (`:31`), recusa de versão mais nova (`:32`), tag GCM sobre o payload (`:35`); no Drive, hash gravado em `appProperties` (`:187`), validado (`:208-210`) e **recomputado no download** (`:215-216`) com conferência de `size` nas duas pontas e **delete do upload** em divergência (`:199-202`).
24. **Ambiguidade deliberada e correta na senha de backup:** "Senha do backup incorreta **ou arquivo corrompido**" (`src/export/backup-format.js:35`) não revela a um atacante se a senha bateu.
25. **Separação de segredos no backup:** senha do backup independente da do cofre e nem a senha nem as chaves entram no arquivo (`src/export/backup-format.js:3`, `src/ui/tools.js:42,186`).
26. **Aviso de não-cifração em três camadas:** checkbox padrão cifrado (`src/ui/tools.js:34,128`), `confirm()` explícito com a palavra "legível" (`:39,135`), sufixo `-criptografado` no nome (`:41,139`) e nota permanente (`:203`).
27. **Restauração atômica "ou tudo ou nada"** com `durability:'strict'` e troca numa única transação: `src/export/backup.js:11-29`, `src/db/idb.js:20,27-30`; mensagem "Nada foi alterado." em falha (`src/ui/tools.js:48,164`). Sem *zip path traversal* possível: `unzipSync` devolve objeto em memória (`src/export/backup-format.js:29`) e nada toca disco.
28. **Recompressão obrigatória de imagem antes de gravar** (canvas → WebP/JPEG, teto de 15 MB, SHA-256 por arquivo): `src/files/process.js:4,6,7,11-14`, com `force:true` nas fotos de perfil (`src/services/clients.js:20`) — neutraliza payloads de parser nesse caminho.
29. **Sem injeção de fórmula em planilha:** o gerador xlsx emite só `t="inlineStr"` ou `<v>` numérico, escapa XML (`src/export/xlsx.js:2,6`) e nunca produz `<f>`; sem dependência externa de planilha.
30. **Higiene de repositório:** `.gitignore` bloqueia `client_secret*.json` e `.env*`; `package.json` sem `dependencies` (nada de supply chain por install); o único vendor é commitado com licença própria.
31. **Documentação de segurança honesta e coerente com o código:** `docs/README.md:9` e `README.md:266-267` declaram explicitamente que a criptografia protege repouso e **não** protege aparelho comprometido/malware/XSS, e que o atraso é local e contornável; os números alegados (`README.md:114,262,263`) batem com `src/security/crypto.js:4` e `src/services/records.js:7`.
32. **Zero telemetria:** nenhuma ocorrência de `XMLHttpRequest`, `WebSocket`, `sendBeacon`, `EventSource`, `importScripts` ou `new Worker` em `api/`, `src/`, `sw.js`, `index.html`; nenhum `console.*` em `api/` e `src/services/`.

## 6. Superfície de ataque (avaliação por vetor)

### 6.1 XSS
A disciplina de DOM (§5.1-4) torna o parsing de HTML como dado **impossível** no código atual: todo dado controlável vira nó de texto. Avaliação dado a dado:

| Dado controlável | Uso | Veredicto |
|---|---|---|
| Nome de arquivo (`file.name`) | gravado em `src/services/clients.js:42`; exibido por `textContent` (`src/ui/kit.js:13`) e por `append` (`src/ui/clients.js:180`); vira nome de download em `:127` | **Sem XSS.** Risco residual é confusão de tipo de arquivo (V9), não execução |
| Nome, CPF/CNPJ, telefone, e-mail, RG, endereço, observações | vindos do usuário, do ViaCEP (`.value=`, `src/ui/clients.js:106`) ou da APICPF (`.value=`, `src/ui/clients.js:88`); renderizados por `append` | **Sem XSS.** `src/ui/tools.js:18` desenha as observações em célula de texto |
| Texto de backup restaurado | entra sem sanitização de texto, mas com validação estrutural de ids/FK/valores (`src/export/backup-format.js:20-27`) | **Sem XSS**; produz **dados falsos/PII alheia** no cofre legítimo (P13) |
| `detail`/`type` do histórico | `src/ui/clients.js:152` via `append` | **Sem XSS** |
| Fotografia | `new Blob([b],{type})` + `<img src=blob:>` (`src/ui/avatar.js:19,26`) | **Não executável**; re-encode em `src/files/process.js:11-14` |
| Documento (MIME forjado) | navegação `blob:` em `src/ui/clients.js:144` | **Risco, não vulnerabilidade** — V9 + P11 |

Portas residuais honestas: (i) `h()` converte qualquer chave iniciada por `on` em listener (`src/main.js:5`) — um futuro `h('input',{...dadosDoUsuario})` criaria handler a partir de dado; (ii) não há **Trusted Types** (`require-trusted-types-for` ausente de `index.html:3` e `vercel.json`) nem `nonce`/hash, então a defesa é 100 % estrutural e disciplinar; (iii) `style-src … 'unsafe-inline'` (`index.html:3`) permite CSS inline, habilitando CSS-injection em cenários avançados — decisão documentada e necessária porque o Google Identity Services injeta estilos inline (`docs/README.md:17`).

### 6.2 DOM por `h()` e `replaceChildren`
Ver §5.2. Adicional: `document.querySelectorAll('dialog.viewer')` é fechado em `clean()` (`src/ui/clients.js:3`), e não há `postMessage`/listener de `message` em nenhum lugar (nada a cassar), nem `window.open` além de `about:blank` (`src/ui/clients.js:143`).

### 6.3 `blob:` navegável
`src/ui/clients.js:144` faz `w.location.href = <blob:>`. Um `blob:` **herda a origem** do documento que o criou, então o documento resultante é same-origin e teria acesso a IndexedDB (inclusive `meta/session`, V1). Em Chrome/Firefox o MIME declarado `application/pdf` faz o viewer renderizar em origem isolada, e é **por isso** que isto é risco (P11) e não vulnerabilidade confirmada: nenhuma prova de conceito foi executada em navegador-alvo. Mitigação estrutural presente: `X-Content-Type-Options: nosniff` (`vercel.json:39-40`).

### 6.4 Extensões de navegador
Extensão com permissão de host ou acesso ao contexto da página roda JS na origem e, portanto, alcança `meta/session` (V1) e `getKey()` por closure (`src/security/auth.js:6,14`). A CSP de `index.html:3` não protege contra execução no contexto da própria origem. Ausência de `Cross-Origin-Embedder-Policy` e de restrição por extensão é inerente ao modelo de navegador: o que reduziria o dano é tirar a DEK do disco (R1).

### 6.5 DevTools com o app desbloqueado
Acesso total: leitura de todas as stores decifradas via `list()` (`src/services/records.js:5`), exfiltração do heap, e — crucialmente — **não precisa da senha nem mesmo bloqueado**, por V1. `extractable:false` impede exportar os bytes, **não** impede `crypto.subtle.decrypt` com o objeto persistido (§2.5). Nenhuma medida anti-DevTools existe nem é recomendável como controle de segurança; o controle real é não ter a chave em repouso.

### 6.6 Dump de IndexedDB
Com sessão ativa (ou com delete de `lock()` malsucedido — V1): cofre inteiro legível no navegador, sem quebrar nada. Sem sessão: material de ofline (`salt`+`wrapped`+`iter`, `src/security/auth.js:21`) + metadados estruturais em claro (§2.8). Nenhum mecanismo de detecção de adulteração: nada autentica o bundle, nada marca `meta/vault` substituído, `meta/guard` é apagável (§3/V10). O `probe` (`src/ui/settings.js:31-36`) testa cifra+leitura sob demanda, mas **nunca é executado automaticamente** e seu resultado não é comparado a um valor anterior.

### 6.7 Dispositivo compartilhado ou roubado
É a ameaça mais provável (A1) e a menos coberta. **Com o cofre destravado, a proteção é nula**: nenhuma re-autenticação para operações destrutivas (`src/ui/clients.js:42`, `src/ui/tools.js:47`), sem biometria/WebAuthn, sem bloqueio por perda de foco. Pior: `visibilitychange` chama `check()`, que, **dentro** da janela, chama `touch()` e reinicia o relógio (`src/security/auth.js:64` + `:11`) — trocar de aba não tranca, só adia. Na tela, nomes, CPFs, valores e fotos ficam legíveis por até 30 minutos (§9.1). Roubado com tela destrancada: idem. Roubado trancado: §3/V10 + qualidade da senha.

### 6.8 Ransomware / exclusão
Praticamente nenhuma proteção defensiva. `confirm()` de texto é o único freio nas rotas destrutivas (`src/ui/clients.js:42`, `src/ui/tools.js:39,47,135,161`); não há lixeira, soft-delete, versão anterior, undo nem confirmação por digitação (grep: zero ocorrências). Não há backup automático — o fluxo é 100 % manual (`src/ui/tools.js:37-42`); `requestPersist()` (`src/pwa.js:4`) ajuda contra evicção, não contra exclusão; o cache do SW (`sw.js:2`) não protege dados. Limpar dados do navegador derruba IndexedDB e sessionStorage sem réplica em servidor — por design (`README.md:264`). Um atacante com o aparelho destravado pode restaurar um `.zip` antigo (ou forjado, V3) e **substituir o cofre inteiro** (`src/export/backup.js:14-18`). A única defesa real é o usuário manter cópias fora do aparelho.
**O que a arquitetura de fato mitiga** (para calibrar, sem vender): exfiltração passiva do conteúdo cifrado (snapshot, backup do SO, sincronização de perfil) — o texto fica cifrado (§2.8); leitura de fotos/PDF sem a senha; interceptação de rede do conteúdo (HTTPS + `connect-src` restrito + `no-store` na função); e a ausência total de telemetria (§5.32) significa que não há canal de saída para abstrair.

## 7. Cabeçalhos e CSP

### 7.1 Transcrição literal de `vercel.json` (`vercel.json:3-60`)
```
/sw.js        Cache-Control: no-cache, no-store, must-revalidate        (vercel.json:8-9)
              Service-Worker-Allowed: /                                 (vercel.json:12-13)
/             Cache-Control: no-cache                                   (vercel.json:21-22)
/index.html   Cache-Control: no-cache                                   (vercel.json:30-31)
/(.*)         X-Content-Type-Options: nosniff                           (vercel.json:39-40)
              Referrer-Policy: no-referrer                              (vercel.json:43-44)
              X-Frame-Options: DENY                                     (vercel.json:47-48)
              Cross-Origin-Opener-Policy: same-origin-allow-popups      (vercel.json:51-52)
              Content-Security-Policy: frame-ancestors 'none'           (vercel.json:55-56)
```
`outputDirectory: "."` (`vercel.json:61`) ⇒ a raiz do repositório é a raiz do site, ou seja, `docs/`, `tests/` e `README.md` são publicamente acessíveis.

### 7.2 Transcrição literal da meta CSP (`index.html:3`)
```
default-src 'self'; script-src 'self' https://accounts.google.com;
style-src 'self' https://accounts.google.com 'unsafe-inline'; font-src 'self';
img-src 'self' data: blob:;
connect-src 'self' https://accounts.google.com https://www.googleapis.com
            https://oauth2.googleapis.com https://viacep.com.br;
frame-src https://accounts.google.com; object-src 'none'; base-uri 'none'; form-action 'none'
```
Coerência com o tráfego real verificada: `www.googleapis.com` (`src/services/google-drive.js:6,7`), `accounts.google.com` (`:65`), `viacep.com.br` (`src/services/viacep.js:3`), `/api/cpf` same-origin (`src/services/apicpf.js:24`), `blob:` em `img-src` (`src/ui/avatar.js:26`). Falha menor de higiene: `oauth2.googleapis.com` está na allowlist sem que nenhum código o chame no fluxo de token do GIS — allowlist morta, endurecimento disponível, não é risco.

### 7.3 Header × meta: por que a divisão existe e onde ela dói
- `frame-ancestors` é uma diretiva que o navegador **ignora quando aplicada via `<meta http-equiv>`** — só tem efeito como cabeçalho HTTP. É exatamente por isso que o header de `vercel.json:55-56` existe: ele entrega a única coisa que a meta **não pode** entregar, e `X-Frame-Options: DENY` (`:47-48`) é a redundância legada.
- Para o documento principal, header e meta se aplicam **ambos**, e o navegador impõe a **interseção**. Logo, `script-src 'self'` de `index.html:3` está de fato em vigor na página, e não é verdade que "não há CSP". A proteção contra XSS existe e é boa (§5.5).
- Onde o header é a **única** política, não há `script-src`: as respostas da função (`api/cpf.js:6-11`) e qualquer HTML/erro/redirect gerado pela plataforma. JSON não é executável, então o impacto hoje é *defense-in-depth*, não exploração (V7).

### 7.4 GitHub Pages: o que cai
Nenhum dos headers acima existe fora da Vercel — `vercel.json` é específico da plataforma, e o próprio projeto registra a limitação (`docs/auditoria-ui-ux-codigo.md:23`, `README.md:249-258`). Nesse canal: **`frame-ancestors` e `X-Frame-Options` desaparecem e a meta não pode substituí-los** ⇒ a origem passa a ser enquadrável, e o clique-jacking contra um cofre **destravado** (que é o estado em que a PII está visível, §6.7) deixa de ter mitigação de transporte. Também desaparecem `nosniff` (relevante para V9/P11), `no-referrer` (o `?cpf=` pode vazar por `Referer`) e o `no-store`/`no-cache` do SW (`vercel.json:8-14,21-31`), podendo servir `sw.js` antigo. A função `/api/cpf` não existe em Pages: vira 404 e é silenciada (`src/services/apicpf.js:41`, `src/ui/clients.js:90-94`) — falha funcional muda, não de segurança. O que **permanece** é a meta CSP de `index.html:3`, que continua restringindo script no documento.

### 7.5 Matriz header → status
| Header | Valor esperado | Onde | Status |
|---|---|---|---|
| `Content-Security-Policy` (script/object/base/form) | a política de `index.html:3` | só `<meta>` | **Presente no documento; ausente no header** → V7 |
| `Content-Security-Policy` (`frame-ancestors 'none'`) | header obrigatório | `vercel.json:55-56` | Presente (Vercel) / **Inexistente em Pages** |
| `X-Frame-Options: DENY` | `vercel.json:47-48` | sim | Presente |
| `X-Content-Type-Options: nosniff` | `vercel.json:39-40` | sim | Presente |
| `Referrer-Policy: no-referrer` | `vercel.json:43-44` | sim | Presente |
| `Cross-Origin-Opener-Policy` | `vercel.json:51-52` | sim | Presente (necessário ao popup OAuth) |
| `Cache-Control` no `sw.js` | `vercel.json:8-9` | sim | Presente |
| `Service-Worker-Allowed` | `vercel.json:12-13` | sim | Presente |
| `Cache-Control: no-store` na função | `api/cpf.js:9` | sim | Presente (asserido por teste, `tests/apicpf.test.mjs:30`) |
| `Strict-Transport-Security` | declarar explicitamente | — | **Ausente no repo**; observado ao vivo por default da Vercel (relatório base) — NÃO CONFIRMADO como controle do projeto |
| `Permissions-Policy` | negar camera/mic/geolocation | — | **Ausente** |
| `Cross-Origin-Resource-Policy` | `same-origin` nos assets | — | **Ausente** |
| `report-uri`/`Reporting-Endpoints` | telemetria de violação | — | **Ausente** (nenhuma notificação de quebra de CSP) |
| `Require-Trusted-Types` | `require-trusted-types-for 'script'` | — | **Ausente** |
| `Clear-Site-Data` | wipe em logout | — | **Ausente** |

## 8. Privacidade: o que sai do aparelho

### 8.1 Inventário exato de chamadas de rede (recontado nesta branch)
| # | Quem chama | Destino | Método | O que vai | O que volta | Evidência |
|---|---|---|---|---|---|---|
| N1 | **Servidor** (função), nunca o navegador | `https://apicpf.com/api/consulta?cpf=<11 dígitos>` | GET | **CPF puro** na query string + header `X-API-KEY` | nome completo, gênero, data de nascimento | `api/cpf.js:3,16,25-26,32-36` |
| N2 | Navegador | `/api/cpf?cpf=<11 dígitos>` (mesma origem → N1) | GET | **CPF puro**; headers só `Accept` e `cache:'no-store'` | `{ok,data:{name,gender,birth}}` | `src/services/apicpf.js:24-28` |
| N3 | Navegador | `https://viacep.com.br/ws/<8 dígitos>/json/` | GET | **Somente o CEP**; nenhum nome, CPF ou telefone | logradouro, bairro, cidade, UF | `src/services/viacep.js:3,17` |
| N4 | Navegador | `https://www.googleapis.com/drive/v3/files…` | GET/POST/DELETE | `Bearer` token, nome da pasta, ids, `appProperties` | metadados de arquivo | `src/services/google-drive.js:6,134,150,152,168,200` |
| N5 | Navegador | `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart` | POST | **ZIP inteiro do backup** — cifrado **apenas se** o usuário marcou "criptografar" (`src/ui/tools.js:134`); senão, todos os dados e documentos **em claro** (`src/export/backup-format.js:12-15`) + metadata com `sha256` | `id/name/size` | `src/services/google-drive.js:7,186-196` |
| N6 | Navegador | `https://accounts.google.com/gsi/client` | GET (script) | nada do app | a biblioteca OAuth | `src/services/google-drive.js:65` |
| N7 | Service worker | GETs same-origin não pré-carregados | GET | nada do usuário | recurso | `sw.js:5` |
| N8 | Navegador | `vendor/fflate.min.js` (**local**) | GET | nada | biblioteca | `src/export/lib.js:4` |

Confirmado por grep: nenhum `XMLHttpRequest`, `WebSocket`, `sendBeacon`, `EventSource`, `importScripts` ou `new Worker` — **nenhuma telemetria, analytics ou reportador de erro remoto** (§5.32). As URIs `schemas.openxmlformats.org` (`src/export/xlsx.js:3`) e `www.w3.org/2000/svg` (`src/ui/icons.js`) são namespaces XML, não requisições.

### 8.2 O CPF vai a um terceiro — e o retorno é PII de um terceiro que nunca consentiu
O fluxo N2→N1 é o único ponto em que dado pessoal do cadastro sai do aparelho, dispara sozinho **700 ms** depois de o CPF ficar válido e online (`src/ui/clients.js:77-80`), e só existe para **confirmar** o que a validação de dígitos já sabe (`src/domain/validators.js:2`). O que volta (`api/cpf.js:32-36`) é nome completo, gênero e data de nascimento de uma **pessoa física que não é usuária do app** e não autorizou nada; esses valores são gravados cifrados no cofre (`src/services/clients.js:23` → `src/services/records.js:7`). Ausências relevantes, confirmadas por inspeção: **não há nenhum interruptor para desligar a consulta** (nenhuma chave de configuração em `src/services/settings.js`; o seletor de Configurações trata só de inatividade, janela de vencimento, integridade e instalação — `src/ui/settings.js:28-44,52-56`); **não há aviso no momento da ação** — a frase visível na tela do cadastro é "Validando…"/"Validado" (`src/ui/clients.js:79,89`), enquanto a divulgação do envio está em `docs/apicpf.md:36` e `README.md:264`. Consequência: o app **não** é "100% offline" no sentido literal (`index.html:5`, `manifest.json:1`), embora o núcleo de dados seja — a ressalva está em `README.md:264`.

Contradição documental **confirmada**: o rodapé da tela de acesso afirma "nada sai do aparelho" (`src/main.js:33`), proposição falsa exatamente no cenário que a função serverless implementa, e contradita pelo próprio `README.md:264`. Não é um vazamento; é uma alegação de segurança errada na interface.

### 8.3 Risco de log de plataforma (e por que `no-referrer` não resolve)
O CPF viaja como **query string de GET** — `api/cpf.js:15-16` lê `searchParams`, `src/services/apicpf.js:24` a constrói. URLs de requisição são o principal conteúdo dos logs de acesso de plataformas serverless, de CDNs e de proxies intermediários. Confirmado neste documento: **o código não loga nada** (zero `console.*` em `api/`, `src/services/`, `src/config/`), a resposta é `no-store` (`api/cpf.js:9`) e o SW **não** escreve em runtime (`sw.js:3-5`). **NÃO CONFIRMADO:** a retenção pela plataforma — a alegação de `docs/apicpf.md:36` ("a função serverless não registra… os dados retornados") é verdadeira sobre o arquivo e indistinguível sobre a infraestrutura (P2). `Referrer-Policy: no-referrer` (`vercel.json:43-44`) protege contra vazamento do `?cpf=` pelo `Referer` do navegador e **não** afeta logs de servidor. Mitigação estrutural: mover o CPF para o corpo de um `POST` (R2).

### 8.4 LGPD (leitura técnica, não parecer jurídico)
Três pontos objetivos: (i) dado pessoal de **terceiros** é processado por fornecedor externo sem que o repo registre contrato, DPA, subprocessadores ou política de retenção (grep: nada disso no repositório) — P1; (ii) a base 6 registra que a base legal não está documentada; (iii) os princípios de minimização e transparência estão parcialmente atendidos (só o CPF sai, §5.22; a exceção está no README) e parcialmente violados (§8.2). Adicional: a conta Google real do titular aparece em `src/config/google.js:5,8` num repo público, e um e-mail pessoal de testador aparece em `docs/google-drive.md:104` (P15).

## 9. Sessão e bloqueio

### 9.1 Auto-lock por ociosidade, configurável
`mins` vem de `settings/idleMinutes` (default 5) em `src/security/auth.js:33` (no desbloqueio), `:44` (na retomada), `:49` (`setIdle`) e é escrito no setup em `:21`; as opções da UI são **1/5/15/30 min** (`src/ui/settings.js:28-29`). Mecanismo: `setTimeout(check, mins*60000)` reiniciado por `pointerdown|keydown|touchstart|scroll` (`src/security/auth.js:11,58-60`); `touch()` também persiste o carimbo de atividade (`:61`) e reescreve a sessão com throttle de 1,8 s (`:62,53`); `check()` tranca quando o prazo venceu (`:64`). Bloqueio manual: `src/ui/shell.js:36,42-43` e `src/ui/settings.js:54` chamam `lock(reason)` (`:65`).

**Defeito de comportamento confirmado:** `visibilitychange` está ligado a `check` (`src/security/auth.js:11`), e `check` chama `touch()` — reiniciando o relógio — quando ainda dentro da janela (`src/security/auth.js:64`). Esconder a aba/minimizar, portanto, **não tranca: adia**. Somado à opção de 30 min, a tela com nomes, CPFs, valores e fotos pode ficar legível por muito tempo depois de o usuário se afastar (§6.7). Não há bloqueio por perda de foco nem por tempo absoluto de sessão.

### 9.2 O que `lock()` limpa
`src/security/auth.js:65-69`: zera `key`, cancela o timer, limpa `sid`, remove `sc.sid`/`sc.last` do sessionStorage (`:7-9`), desliga os listeners (`:12`) e notifica os assinantes (`:68`); `onLock` (`:16`) tem três assinantes reais: `src/main.js:61` (troca para a tela de desbloqueio com a causa), `src/ui/avatar.js:12` (`clearClientPhotos`) e `src/ui/clients.js:4` (`clean`, que revoga object URLs e fecha `<dialog>`). A barreira de leitura é legítima: `getKey()` lança (`src/security/auth.js:14`).

### 9.3 O que `lock()` **não** limpa
- **A DEK no disco:** o `db.del('meta','session')` de `src/security/auth.js:67` não é aguardado (função síncrona) e engole erro (`catch(()=>{})`) → V1. Não existe limpeza em `pagehide`/`beforeunload` (grep: zero), então **fechar a aba destravada deixa a chave no banco**; a faxina só ocorre oportunisticamente na próxima inicialização (`src/security/auth.js:43,46`).
- **O token do Google:** nenhuma chamada a `G.disconnect()`/`resetAuth()` em `src/security/auth.js:65-69`. O Bearer de `src/services/google-drive.js:14` sobrevive ao bloqueio na memória da aba enquanto ela viver, acessível a qualquer código same-origin (A2) e utilizável para listar/baixar/apagar os backups da conta (escopo `drive.file`, `:8`).
- **Cache de PII de terceiros:** `CACHE` de 30 min (`src/services/apicpf.js:3`) e o `Map` de CEP sem TTL nem limite (`src/services/viacep.js:4`) não são limpos no bloqueio — baixo impacto (redundante com o cadastro), mas é retenção pós-bloqueio.
- **PII já decifrada no heap:** toda listagem descriptografa a store inteira (`src/services/records.js:5`), inclusive dentro de `saveClient` para checar duplicidade (`src/services/clients.js:17`).
- **Object URLs recentes:** §3/V8.

### 9.4 Reassunção de sessão sem senha
`restoreSession` (`src/security/auth.js:38-48`) reabre o cofre sem pedir senha quando o `sid` do sessionStorage bate (`:42`), o objeto persistido é mesmo uma `CryptoKey` AES-GCM (`:42`), e `Date.now()-seen < mins*60000` (`:45-46`). Pressionar F5 reabre o cofre sozinho — apresentado como funcionalidade (`README.md:116`). Honestamente: `sid` é novo a cada desbloqueio (`:34`, `:10`), a validação é defensiva e o registro vencido é removido (`:43,46`). O problema não é a lógica de sessão, é o **material**: posse de `sid` (sessionStorage) e chave (IndexedDB) residem no **mesmo** perfil de navegador, sem canal separado, biometria ou segundo fator — e é a mesma raiz de V1.

### 9.5 Tentativas de senha
Contador `{fails,until}` em `meta/guard` (`src/security/auth.js:26,30,32`): bloqueio prévio com mensagem "`Aguarde N s`" (`:27`) e atraso exponencial a partir da 5ª falha, `min(5000·2^(fails-5), 300000)` (`:29`), zerado só em sucesso (`:32`). Limitações confirmadas: mora no banco do atacante, é apagável, não tem reset temporal, não faz wipe, e a escrita do contador é fail-open — §3/V10. **Defeito adicional:** qualquer erro de integridade produz "Senha incorreta." **e conta como tentativa** — §3/V4. **Política de senha:** só comprimento ≥ 8 (`src/main.js:19`), sem complexidade, sem entropia medida, sem recusa de senhas comuns, sem comprimento máximo e sem normalização (NFKC/NFC) — `12345678` é aceita, e 600k iterações de PBKDF2-SHA256 não salvam um espaço de senhas humano em GPU (P7).

### 9.6 Troca de senha e rotação de chave
**Inexistentes** — §3/V6. Consequência prática sobre a sessão: como a DEK **nunca muda**, não há como revogar o material gravado em `meta/session` de outro aparelho/aba sem apagar o cofre.

## 10. Backup e restauração sob o ângulo de segurança

### 10.1 Força criptográfica
`buildBackup` com senha: salt novo de 16 B (`src/export/backup-format.js:17`), **PBKDF2-HMAC-SHA256 com 600.000 iterações** (`:5,17`), chave **AES-GCM-256** direta da senha (`src/security/crypto.js:22`), `payload.enc` autenticado pela tag GCM. Manifest externo declarado com `kdf:'PBKDF2-SHA256'`, `iter`, `salt` (hex), `cipher:'AES-GCM-256'` (`src/export/backup-format.js:18`). Mínimo de senha: 8 caracteres, local (`src/ui/tools.js:38`) e Drive (`:134`) — mesma política fraca do cofre (§9.5). Decisão correta e verificada: a senha do backup é **independente** da do cofre e nenhuma chave/salt do cofre entra no arquivo (`src/export/backup-format.js:3`, `src/ui/tools.js:42,186`) — um backup comprometido não compromete o aparelho, e vice-versa.

### 10.2 O downgrade por manifest não autenticado
A leitura usa `m.iter` e `m.salt` **do arquivo** (`src/export/backup-format.js:35`) sem piso, sem teto e sem comparação com o `ITER` do código, antes de qualquer autenticação (`:33` só olha `m.encrypted`). Isto **é** a vulnerabilidade V3 e o seu efeito de rede: quem cria o `.zip` controla o custo de um palpite contra a senha de backup do destinatário. Complemento honesto: o **clear** do backup continua protegido pela tag GCM — o downgrade não quebra a cifragem, quebra a **política de custo do KDF**.

### 10.3 Zip de terceiros: o que a UI faz com ele
"Verificar arquivo" (`src/ui/tools.js:44-50`) abre o zip, lê o manifest (`src/export/backup-format.js:30-32`), e se `encrypted` pede a senha e **deriva a chave antes de qualquer confirmação destrutiva** — o `confirm()` de substituir só vem depois (`:47`). É o ponto do fluxo onde V3 é acionável e onde `iter` gigante congela a aba (`src/security/crypto.js:22`). O que **existe** de defesa e merece crédito: recusa de manifest que não seja do app (`:31`), recusa de versão mais nova (`:32`), rejeição de entrada inesperada (`:39`), SHA-256 recomparido por arquivo (`:40`), validação estrutural de ids/FK/valores (`:20-27`), e restauração atômica com "Nada foi alterado." em falha (`src/export/backup.js:29`, `src/ui/tools.js:48`). No Drive, `appProperties.sha256` precisa casar com `^[a-f0-9]{64}$` (`src/services/google-drive.js:208-210`) e é recomputado (`:215-216`). O que **não** existe: qualquer origem confiável do arquivo — o app restaura o que o usuário escolher, sem nova autenticação (P13).

### 10.4 Caminhos de decisão (árvore real)
1. backup **sem** criptografia → `confirm()` forte ("todos os dados e documentos em formato legível", `src/ui/tools.js:39`), nome **sem** sufixo `-criptografado` (`:41`), conteúdo em claro dentro do zip (`src/export/backup-format.js:12-15`). Se o destino for o Drive (`:135-140`), PII de terceiros sobe em claro para um provedor externo — **aceito explicitamente pelo projeto** (`docs/auditoria-ui-ux-codigo.md:27`) e o único ponto deste documento em que a decisão de produto importa mais que o código.
2. backup **com** senha → cifrado, manifest só com parâmetros públicos (`:18`).
3. restauração **mesclar** → dedupe por id/CPF-CNPJ/hash (`src/export/backup.js:20-27`), aditivo.
4. restauração **substituir** → apaga `clients/debts/documents/history/blobs` e reescreve numa única transação (`:14-18`) com `confirm()` específico (`src/ui/tools.js:47,161`) — a rota de maior impacto sob a ameaça A7 (§6.8).
5. destino Google Drive → OAuth `drive.file` com token volátil (§5.15) e conferência de tamanho com **delete** em divergência (`src/services/google-drive.js:199-202`).

## 11. Recomendações priorizadas

Nenhuma recomendação é implementada aqui; não há código de correção neste documento. Marcações: **[COMPATÍVEL]** = compatível com as travas do projeto (não toca cofre, stores de dados nem design); **[EXIGE AUTORIZAÇÃO (altera cofre/schema)]**.

**Crítico**

- **R1 — Tirar a DEK do disco; embrulhá-la por chave de sessão não persistida. [EXIGE AUTORIZAÇÃO (altera o registro `meta/session`; não altera stores de dados)]** Gera-se uma *session key* aleatória guardada **só** no sessionStorage; `meta/session` passa a conter a DEK embrulhada (o app já tem a primitiva: `sealBytes`/`openBytes`, `src/security/crypto.js:17-18`), e `restoreSession` (`src/security/auth.js:38-48`) exige o par `sid`+`sessionKey`. Complementos obrigatórios: `await` do delete em `lock()` (`:67`), remoção também em `pagehide`/`visibilitychange:hidden`, e folga da reescrita periódica de 1,8 s (`:53`) para 15–30 s. *Critério de aceite:* (a) com o cofre destravado, uma cópia dos arquivos do perfil + `indexedDB.open` não produz nenhum byte em claro; (b) `lock()` seguida de reabertura do perfil não deixa `meta/session` no banco (verificação automatizada no `probe` de Configurações); (c) F5 na mesma aba continua restaurando a sessão.
- **R2 — Fechar o `/api/cpf`: `POST` com o CPF no corpo, validação de `Origin`/`Sec-Fetch-Site`/`Referer`, rate limit por IP e cache de resposta por CPF com TTL no servidor. [COMPATÍVEL]** Elimina V2 e a causa de P2/P3 de §8.3 (o CPF sai da URL e dos logs de borda). Sem rate limit disponível na plataforma, publicar o limite na doc para o titular dimensionar a cota. *Critério de aceite:* `curl` sem header de navegador recebe 403/405; a cota diária não é consumível por um laço externo; nenhum `?cpf=` aparece em log de acesso.
- **R3 — Fazer a função **falhar fechada** também contra valores literais de configuração. [COMPATÍVEL]** A guarda atual (`api/cpf.js:20`, `if(!key)`) aceita `"undefined"`/`"null"`/`""` como chave válida (V11). *Critério de aceite:* teste unitário que (i) usa `delete process.env.APICPF_API_KEY` e (ii) instala o stub de `fetch` **antes** de qualquer caso, asserindo **zero** chamadas de rede quando a chave está ausente ou é texto-sentinel — e uma asserção explícita de contagem de chamadas, não apenas do status.

**Alto**

- **R4 — Clampar o KDF em toda leitura. [COMPATÍVEL]** Rejeitar `iter` fora de 100.000–2.000.000 e `salt` com tamanho ≠ 16 em `src/security/crypto.js:14` e `src/export/backup-format.js:35`; preferir o `ITER` do código quando divergir; validar `b.length>=12` antes de fatiar o IV em `openBytes` (`src/security/crypto.js:18`). Fecha V3. *Critério de aceite:* `.zip` forjado com `iter:1` é recusado **antes** de qualquer derivação; `iter:10^11` não congela a aba; `tests/backup.test.mjs` cobre ambos.
- **R5 — Diferenciar erro de senha de erro de banco no desbloqueio. [COMPATÍVEL]** Em `src/security/auth.js:28`, tratar `OperationError` como senha errada e os demais (`DataError`, `NotSupportedError`, falha de transação) como mensagem específica **sem** increment `g.fails`; aguardar a escrita do contador e reportar falha dela. Fecha V4. *Critério de aceite:* corromper `meta/vault` produz aviso de "banco inconsistente" com saída para o teste de integridade, e cinco tentativas nesse estado não geram atraso.
- **R6 — Falha de descriptografia por registro, não por store. [COMPATÍVEL]** `list()` com `Promise.allSettled` devolvendo `{rows, unreadable:n}` (`src/services/records.js:5`); `try/catch` com contagem visível em `src/ui/clientlist.js:32` e `src/ui/dashboard.js:10`; nunca repassar `e.message` de `DOMException` ao usuário (`src/main.js:8`); acionar o `probe` de `src/ui/settings.js:30-36` automaticamente. Fecha V5. *Critério de aceite:* bit-flip em 1 de 500 registros lista os outros 499 e diz "1 ilegível — verifique Integridade".
- **R7 — Troca de senha por rewrap da DEK. [EXIGE AUTORIZAÇÃO (altera o conteúdo de `meta/vault`; não re-cifra nenhum registro)]** Novo `changeVaultPassword(old,new)` que desembrulha com a KEK antiga e reembrulha com a nova, gravando `salt`/`iv`/`iter` novos (`src/security/crypto.js:10-11`), com item na seção Segurança de Configurações (`src/ui/settings.js:52-56`). Fecha V6 e cria o veículo de upgrade do `iter` (R4). *Critério de aceite:* após a troca, todos os registros pré-existentes abrem sem re-cifragem, `meta/vault` tem `salt`/`iv` novos, e a senha antiga para de funcionar inclusive contra o dump anterior.

**Médio**

- **R8 — Espelhar a CSP completa no header e declarar o que hoje é default. [COMPATÍVEL]** Copiar `index.html:3` para `vercel.json` (mantendo a meta como redundância), explicitar `Strict-Transport-Security`, adicionar `Permissions-Policy` negando camera/microfone/geolocalização (o app não usa) e `Cross-Origin-Resource-Policy` nos assets; corrigir a atribuição em `docs/auditoria-ui-ux-codigo.md:14`. Mitiga V7 e §7.4. *Critério de aceite:* `curl -I` mostra a política completa; nenhuma requisição funcional quebra (testar popup GIS); a doc não credita ao header diretiva que só existe na meta.
- **R9 — Desconectar o Drive no `lock()` e amarrar o token à sessão do cofre. [COMPATÍVEL]** Chamar `G.disconnect()` (`src/services/google-drive.js:114-116`) a partir de `lock()` (`src/security/auth.js:65`) ou ao menos de `resetAuth` no `reason==='logout'`. *Critério de aceite:* após bloquear, `isConnected()` é `false` e nenhuma chamada de API do Drive é possível sem novo consentimento.
- **R10 — Endurecer a política de senha sem quebrar cofres existentes. [COMPATÍVEL na política; EXIGE AUTORIZAÇÃO (altera cofre) para qualquer normalização]** Subir o mínimo (`src/main.js:19`) para ~12, medir entropia e recusar senhas de lista comum por *wordlist* local. **Não** adicionar NFKC/NFC ao KDF sem plano de migração: isso altera a chave derivada e **inutiliza cofres existentes** (`src/security/crypto.js:6,14`). *Critério de aceite:* `12345678` é recusada em nova criação; cofre antigo criado com a política anterior desbloqueia normalmente.
- **R11 — Defesa contra exclusão e ransomware. [COMPATÍVEL]** Confirmação forte nas rotas destrutivas (digitação do nome em `src/ui/clients.js:42`; exigir backup **gerado e confirmado** antes do `replace` em `src/ui/tools.js:47,161`), lembrete periódico não bloqueante de backup (o app já mede armazenamento, `src/ui/settings.js:18`) e registro de contagem de registros por data para detectar substituição em massa. *Critério de aceite:* nenhum caminho apaga dados com um único clique mais `confirm()` de texto.
- **R12 — Bloquear ao esconder a aba. [COMPATÍVEL — muda comportamento de UX, aprovar redação e padrão]** Opção para chamar `lock('manual')` em `visibilitychange` oculto, em vez de `touch()` (o defeito de `src/security/auth.js:64`), padrão desligado. Mitiga §6.7 e P3. *Critério de aceite:* com a opção ligada, alternar de aba exige senha de novo; com desligada, o comportamento atual é preservado.

**Baixo**

- **R13 — Endurecer `h()` com whitelist de atributos. [COMPATÍVEL]** Rejeitar chaves `on*` vindas de objetos construídos com dado (§6.1) e, opcionalmente, adotar Trusted Types no header + política única. *Critério de aceite:* teste que passe um objeto com `onerror` vindo de dado e afirme que nenhum listener é criado.
- **R14 — Fechar as janelas de object URL e verificar tipo por assinatura de bytes. [COMPATÍVEL]** Revogar em `pagehide`/fechamento de janela em vez de 60–120 s (`src/export/lib.js:5`, `src/ui/clients.js:144-145`) e conferir magic bytes no upload com extensão coerente no download (`src/files/process.js:8-9`, `src/ui/clients.js:127`). Mitiga V8 e V9. *Critério de aceite:* nenhuma `blob:` de conteúdo decifrado sobrevive ao `lock()`; um arquivo com conteúdo HTML e MIME `application/pdf` é rejeitado na entrada.
- **R15 — SRI sobre `vendor/fflate.min.js` e acoplamento de versão do SW. [COMPATÍVEL]** Eliminar a injeção dinâmica de `<script>` com `src` variável (`src/export/lib.js:2-3`) — hoje o único ponto do app que faz isso — e amarrar `V` (`sw.js:2`) a uma verificação na inicialização. Mitiga P9.
- **R16 — Comunicação honesta de risco na interface. [COMPATÍVEL — texto]** A tela de bloqueio diz "Aguarde N s" como se houvesse proteção contra ofline (V10) e o rodapé diz "nada sai do aparelho" (`src/main.js:33`) embora o CPF saia (§8.2). Ajustar para "proteção local contra tentativas repetidas" e "nada dos seus dados sai do aparelho, exceto o CPF que você consultar online". *Critério de aceite:* nenhuma frase da UI afirma proteção que o código não entrega.
- **R17 — Retirar dados de conta pessoal de repositório público. [COMPATÍVEL]** Remover o e-mail de testador de `docs/google-drive.md:104` e o cliente legado de `:121`; revisar `src/config/google.js` para manter só o necessário (P15). *Critério de aceite:* nenhum endereço pessoal nem identificador de projeto morto no conteúdo publicado.

Itens acima de prioridade **Crítica/Alta** que exigem autorização: R1, R7 (e a parte de normalização de R10). Todo o resto é compatível com as travas do projeto: não muda stores de dados, não muda design, não muda o funcionamento do cofre.

## 12. O que este documento NÃO prova

1. **Não prova que o app é seguro.** Prova coisas menores e verificáveis: os parâmetros criptográficos são os declarados (§2.1), a senha não é armazenada (§2.4), a tag GCM detecta adulteração (§2.6), a disciplina de DOM existe hoje (§5.1-4) e o tráfego de saída é o listado (§8.1). Segurança é propriedade de processo, não de instantâneo.
2. **Não há prova de execução de ataque.** As vulnerabilidades de V1 a V6 e V8 a V10 são **confirmadas por leitura de código** (o caminho de execução existe e não tem guarda), não por exploração bem-sucedida. As duas únicas verificações por execução desta auditoria foram de semântica/falha em `api/cpf.js` (V11), em ambiente isolado e **com `fetch` stubado** — nenhuma chamada de rede real foi feita por este documento, nenhum dado pessoal foi coletado, e nenhum arquivo do repositório foi modificado além deste.
3. **Não prova o comportamento dos navegadores-alvo.** P11 (navegação `blob:` de PDF forjado), P10 (evicção do iOS em ~7 dias) e o enquadramento em GitHub Pages (§7.4) dependem de navegador/plataforma e não foram executados.
4. **Não prova nada sobre a infraestrutura.** O que a Vercel loga (P2), o plano e o custo da APICPF (P1), quais origens estão realmente autorizadas no Google Cloud, o runtime da função e a versão do `fetch` global (P16), o `Strict-Transport-Security` e o `access-control-allow-origin: *` observado ao vivo — tudo **NÃO CONFIRMADO** aqui: painel de terceiros está fora do escopo.
5. **Não prova a ausência de vulnerabilidades.** A varredura de §5 é por padrões conhecidos (`innerHTML`, `eval`, sinks de parsing, mecanismos de rede). Ela não cobre lógica de negócio, nem o conteúdo de `vendor/fflate.min.js` (biblioteca commitada, não auditada neste passe), nem ataques de canal lateral no navegador, nem o que for introduzido depois deste commit.
6. **Não prova o cenário de uso.** Se o aparelho é compartilhado (P3), se o app é instalado (P10) e se algum `.zip` de terceiros será realmente aberto (V3) são premissas de ameaça que só o titular responde; a severidade de V1, V8 e §6.7 sobe ou desce conforme a resposta.
7. **Não é parecer jurídico (LGPD).** O §8.4 lista fatos verificáveis no repositório (ausência de DPA/registro de subprocessadores, ausência de aviso no momento da ação) e nada afirma sobre conformidade.
8. **Não mede a resistência da senha.** O custo por palpite de 600k PBKDF2-SHA256 é verificável no código; a entropia real da senha do titular é **desconhecida** e é, conforme §2.2.1, a principal variável de segurança em repouso deste produto.
9. **Nada foi corrigido.** Nenhuma linha de código foi alterada por este trabalho; todas as 11 vulnerabilidades da §3 e os 16 riscos da §4 permanecem como estão nesta branch.
