# SCIPIONE CRED — Auditoria 4: Backup, Restauração, Exportação e dependência vendorizada

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


Escopo: `/home/ubuntu/scipione-cred-offline` @ `e78d776` (branch `main`, `git status --porcelain` vazio ao encerrar — auditoria 100% read-only).
Método: leitura integral de `src/export/*.js`, `src/ui/tools.js`, `src/services/records.js`, `src/services/google-drive.js`, `src/files/process.js`, `tests/backup.test.mjs`, `tests/stage4.test.mjs`, `docs/README.md`, `vendor/*`; mais execução de `node tests/*.test.mjs` e de sondas em `/tmp/probe*.mjs` que chamam o **código real** do repositório contra **dados 100% fictícios** (nenhum arquivo do repo foi escrito; os artefatos `.zip` das sondas ficaram em `/tmp`).
Convenção: tudo que está aqui foi verificado em código ou executado. O que não foi verificado está marcado **NÃO CONFIRMADO**.

---

## 0. Depêndencia vendorizada: lib e versão REAL

| Item | Evidência |
|---|---|
| Biblioteca | **fflate** (ZIP/DEFLATE/inflate), build UMD com global `fflate` — `vendor/fflate.min.js:1` (`!function(f){...module.exports=f():...define(f):(typeof self...self).fflate=f()}`) |
| Tamanho real | **32.665 bytes** (`wc -c`, `ls -l vendor/fflate.min.js`) |
| MD5 | `aaea4e81b1ac4fd40187192d38bc66da` |
| **Versão confirmada** | **fflate 0.8.2**. O arquivo **não tem banner de versão** (`grep -o -E "0\.8\.[0-9]"` → 0 ocorrências; `wc -l` → 0 quebras de linha, bundle minificado de uma linha). A versão foi estabelecida por **identidade byte a byte**: `cmp` entre `vendor/fflate.min.js` e `package/umd/index.js` do tarball oficial `https://registry.npmjs.org/fflate/-/fflate-0.8.2.tgz` → **IDÊNTICOS** (mesmo md5 `aaea4e81…`, mesmo tamanho 32.665). `0.8.1` (32.173 B) e `0.8.3` (33.044 B) diferem. |
| Alegação da doc | `vendor/LICENSES.md:2` e `docs/README.md:15` dizem 0.8.2 → **correta** |
| Atualidade | `dist-tags.latest` do registry = **0.8.3** (CHANGELOG 0.8.3: "Fix buffer over-read for Zip64 extra fields", "Fix `zip`/`zipSync` when using cross-realm `Uint8Array`", "Improve Zip64 support"). Ou seja: a cópia vendorizada está **uma versão atrás** e o fix de Zip64/over-read é relevante para backups grandes (>4 GB por entrada ou archives mal dimensionados). |
| Renome | O arquivo publicado pelo upstream é `umd/index.js`; o repo o guarda como `vendor/fflate.min.js` (só nomenclatura; conteúdo íntegro). |
| Cache offline | `vendor/fflate.min.js` está em `FILES` do service worker (`sw.js:2`, `V='sc-v69'`) → carregável offline. |
| Licença | MIT, declarada em `vendor/LICENSES.md:2`. Sem verificação de integridade automática (SRI/hash) em lugar algum — ver R-07. |

---

## 1. Formato do backup

Constantes (`src/export/backup-format.js:5`): `FORMAT=1`, `ITER=600000`, `LISTS=['clients','debts','documents','history']`.

### 1.1 Backup sem senha — ZIP único (confirmado por execução)

`buildBackup` (`backup-format.js:10-18`) monta um dicionário de entradas e chama `f.zipSync(z)` **sem opção de nível** → deflate **nível 6 default** da fflate (default lido no fonte oficial 0.8.2, `esm/browser.js:812`: `opt.level == null ? 6`). Inspeção de um `.zip` gerado pelo código real com `python3 zipfile`:

```
entradas (ordem de gravação):            method=8 (deflate)   comp    raw
  data/clients.json                                          129     197
  data/debts.json                                            150     291
  data/documents.json                                        116     149
  data/history.json                                           86     104
  data/settings.json                                          17      15
  files/p-0001.bin                                           312    5000
  files/b-0001.bin                                           101     100
  manifest.json                                              483     800
```
Ordem: `data/*.json` na ordem de `LISTS` + `settings` (`:12`), depois `files/<id>.bin` na ordem de iteração do `Map` (`:13`), e **`manifest.json` por último** (`:15`, sobrescreve/insere a chave no fim do objeto). Cada entrada tem `extra` vazio e carimbo DOS com a data/hora local do momento da geração (`date_time=(2026,11,18,0,32,2)`).

Envelope do `manifest.json` **em claro** (ordem real dos campos, saída literal da sonda):
```json
{"app":"SCIPIONE CRED","formatVersion":1,"createdAt":"2026-11-18T00:32:02.016Z","dbVersion":1,
 "encrypted":false,
 "counts":{"clients":2,"debts":2,"documents":1,"history":1,"files":2},
 "sha256":{"data/clients.json":"b3de9db9…","data/debts.json":"9ccfda68…","data/documents.json":"1ecf4c2b…",
           "data/history.json":"eeebc82a…","data/settings.json":"bbb56355…",
           "files/p-0001.bin":"69dbee89…","files/b-0001.bin":"bce0aff1…"}}
```
`data/*.json` são **arrays JSON em claro** (registros já decifrados do cofre) — evidência: `data/clients.json` = `[{"id":"c-0001","name":"Ana Souza","doc":"529.982.247-25","photoId":"p-0001","createdAt":1700000000000},…]`. `files/<id>.bin` = bytes brutos do blob. Ou seja: **backup sem senha expõe PII + CPF/CNPJ + documentos em claro** (a UI avisa: `tools.js:39,135,203`).

### 1.2 Backup com senha — ZIP externo autenticado

`backup-format.js:16-18`: o mesmo ZIP interno (bytes idênticos aos de `:16`) é **criptografado por inteiro**:
* KDF: **PBKDF2-SHA256, 600.000 iterações** (`ITER` em `backup-format.js:5` e `crypto.js:4`; `deriveAesKey` em `crypto.js:22` → `deriveKey({name:'PBKDF2',hash:'SHA-256',salt,iterations}, …, {name:'AES-GCM',length:256})`). Custo medido em Node 22: **136–137 ms** por derivação (sonda `probe2`).
* Salt: 16 bytes aleatórios (`rnd(16)`, `crypto.js:5`), gravado no manifest como hex de 32 caracteres.
* Cifra: **AES-GCM-256** sobre o ZIP interno; IV de 12 bytes aleatórios prefixado ao ciphertext (`sealBytes`, `crypto.js:17`). Chave **não extraível** (`extractable=false`).
* ZIP externo com `{level:0}` → **armazenado (method=0, sem compressão)**, 2 entradas, `manifest.json` primeiro e `payload.enc` depois. Evidência real:

```
manifest.json   method=0  comp=198   raw=198    dados=[43,241)
payload.enc     method=0  comp=2314  raw=2314   dados=[282,3053)
```
`2314 = 2286 (tamanho do ZIP interno) + 12 (IV) + 16 (tag GCM)` — aritmética confirmada comparando o zip plano e o cifrado do mesmo dataset.

Manifest cifrado (campos e ordem reais):
```json
{"app":"SCIPIONE CRED","formatVersion":1,"encrypted":true,"kdf":"PBKDF2-SHA256","iter":600000,
 "salt":"4e692937b76f14904d2c249c3b2a42c9","cipher":"AES-GCM-256","createdAt":"2026-11-18T00:32:02.025Z"}
```
Não contém `counts` nem `sha256`. Como `readBackup` recursa no ZIP interno (`backup-format.js:36`), o `{manifest,data}` devolvido à UI traz o **manifest interno** (com `counts`, `dbVersion` e `encrypted:false`) — é isso que `tools.js:45,49` lê; funciona, mas a UI **não consegue distinguir** se o arquivo era cifrado depois da leitura.
Confirmação de confidencialidade: `Buffer.from(criptoZip).includes('Ana') === false` (sonda `probe1`) e assertion equivalente em `tests/backup.test.mjs:15`.

### 1.3 Papel de `backup-format.js`

É o **codec do formato**: constantes de versão/ITER/`LISTS` (`:5`), montagem dos dois formatos de ZIP (`buildBackup` `:10-19`), **verificação de integridade e de esquema** (`readBackup` `:28-45`) e validação referencial (`validate` `:20-27`). Erros saem com `code` (`:8`): `INVALID`, `NEEDS_PASSWORD`, `BAD_PASSWORD`. `backup.js` só conhece o formato por meio dele (`backup.js:2-3`).
`docs/README.md:15` descreve o formato corretamente (ZIP + manifest + `data/*.json` + `files/<id>.bin` + PBKDF2 600 mil + AES-GCM). **Divergência:** o comentário `backup-format.js:3` promete `MIGRATE[v](data) -> v+1`; **não existe** nenhum `MIGRATE` no código (`grep -rn MIGRATE src tests` → só o comentário). Ver R-03.

---

## 2. Fluxo de exportação (gerar backup)

Gatilho: Home → "Backup e restauração" (`main.js:59`, `shell.js:33`) → `backupView` (`tools.js:31-51`) → botão **"Gerar backup"** (`tools.js:42`).

1. Validação de senha no cliente: mínimo **8 caracteres** e repetição idêntica (`tools.js:38`); se a caixa "Criptografar com senha" estiver desmarcada, `confirm()` explícito de que o arquivo conterrá dados legíveis (`tools.js:39`).
2. `B.createBackup(pass)` (`backup.js:4-10`):
   * lê `LISTS` inteiras via `list()` (`records.js:5`), que **decripta cada registro** com a DEK do cofre (`dec`/`openJSON`, `records.js:4`) → exige cofre destravado;
   * coleta blobs **apenas** referenciados: `clients[].photoId` + `documents[].blobId` (`backup.js:7`) → `blobBytes(id)` (`records.js:9`). Blob faltante/ilegível **cancela o backup** com mensagem explícita (`backup.js:7`), por design ("para não ficar incompleto");
   * inclui só um settings: `dueWindow` (default 7) (`backup.js:8`) — `idleMinutes` **não** entra;
   * injeta `dbVersion: db.DB_VERSION` (`backup.js:9`, `idb.js:10`).
3. Empacotamento síncrono: `zipSync`/`unzipSync` bloqueiam a thread (`backup-format.js:16-18`). Medido com o código real: dataset fictício de 30 clientes / 60 dívidas / 30 documentos (~15 MB de blobs) → **14,3 MB de .zip, 1.077 ms para criar, 183 ms para ler** (`probe3`). Sonda com 16 MB de blobs altamente compressíveis: 361 ms. Não há `await`/yield durante o `zipSync` e a UI **não desativa o botão antes** da coleta de blobs (desabilita em `tools.js:40` antes de `createBackup`, ok), mas não há feedback de progresso — **NÃO CONFIRMADO** em navegador real (auditoria sem browser).
4. Nome do arquivo (`tools.js:40-41`): `scipione-cred-backup-` + `new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')` + (`-criptografado` se senha) + `.zip` → ex.: `scipione-cred-backup-2026-11-18-00-32-02-criptografado.zip`.
5. Download: `save(new Blob([z],{type:'application/zip'}), name)` (`tools.js:41`) → `URL.createObjectURL` + `<a download>` + click + `revokeObjectURL` após 60 s (`lib.js:5`).
6. Sucesso: mensagem distinguindo cifrado/não cifrado e **limpeza dos campos de senha** (`tools.js:41-42`).
7. Cofre bloqueado: `getKey()` lança `'Sessão bloqueada.'` (`auth.js:14`) dentro do primeiro `list()`, a mensagem aparece em `err` (`tools.js:42`). Na prática a tela nem está alcançável: `A.onLock` troca para `authView` (`main.js:61`). **Se o bloqueio ocorrer no meio** (timeout de inatividade durante a leitura de 15 MB), o usuário vê "Sessão bloqueada." e nada é escrito.

Fluxo Drive (mesma coleta, destino diferente): `tools.js:131-145` → `createBackup` idêntico → `G.uploadBackup(z,{name,encrypted})` → recarrega a lista (`loadDrive`).

---

## 3. Fluxo de restauração

Gatilho: `tools.js:43-50` — `<input type=file accept=".zip,application/zip">` + campo de senha + botão **"Verificar arquivo"** (`tools.js:44`). Só depois da verificação bem-sucedida aparece o `<select>` de modo e o botão **"Restaurar"** (`tools.js:45-49`), ou seja **a validação sempre precede a escrita**.

Cadeia de verificação (`readBackup`, `backup-format.js:29-45`), cada resultado confirmado por execução:

| Caso | Comportamento medido |
|---|---|
| não é ZIP / 0 bytes / bytes aleatórios / **truncado (50%, 70%, 99%)** | `INVALID` "O arquivo não é um ZIP válido." (`:29`) |
| bit flip no meio do stream comprimido | `INVALID` "O arquivo não é um ZIP válido." |
| bit flip no cabeçalho local (região de CRC/carimbo) | passa o ZIP e falha depois na checagem de nome/`app` (`INVALID` "…não é um backup do SCIPIONE CRED.") — a fflate **não valida CRC-32**: flips nos bytes 14–17 do primeiro local header foram **ACEITOS** sem alterar o conteúdo extraído (sonda `probe5`) |
| `manifest.json` ausente/JSON inválido | `INVALID` "Arquivo corrompido: manifest.json" (`:9`) |
| `app !== 'SCIPIONE CRED'` | `INVALID` (`:31`) |
| `formatVersion` = 2, 0 ou ausente | `INVALID` "Backup criado por uma versão mais nova (ou desconhecida) do sistema." (`:32`) — nota: a mesma mensagem cobre versão *mais nova* e *desconhecida/antiga*; `formatVersion=1.5` é aceito (`!(x>=1)` e `>1` não pegam frações) e **não há MIGRATE** |
| `dbVersion` = 99 | **ACEITO** — `dbVersion` é escrito (`:15`) mas **nunca lido** (`grep`: sem leitura; só `settings.js:50` exibe o `DB_VERSION` local) |
| cifrado sem senha | `NEEDS_PASSWORD` (`:34`) |
| cifrado, senha errada | `BAD_PASSWORD` (`:35`) |
| cifrado adulterado | **AES-GCM rejeita 100% dos offsets**: varredura de bit flip em todos os 428 bytes do `payload.enc` (IV+dados+tag) → **428 rejeições, 0 aceitações** (sonda `probe5`) |
| `sha256` ausente no manifest plano | `INVALID` "Backup sem verificação de integridade." (`:38`) — a checagem é **obrigatória** |
| entrada não declarada no zip plano | `INVALID` "Arquivo inesperado no backup: extras.txt" (`:39`) |
| arquivo declarado ausente / corrompido | `INVALID` "Arquivo corrompido ou ausente: files/b-0001.bin" (`:40`) |
| inconsistência referencial | `INVALID` "Backup inconsistente: …" (até 5 mensagens) (`:43`) |
| `cipher` falsificado p/ `AES-CBC`, `kdf` mentiroso | **ACEITO** — os campos são informativos; o algoritmo real é fixo no código (`:17-18,35`). Idem `iter:"600000"` como string (aceito) |
| `iter` ausente / `iter=1` / salt inválido com senha correta | `BAD_PASSWORD` (a derivação falha dentro do `try` de `:35`) — mensagem enganosa, mas segura |

Validação de conteúdo (`validate`, `:20-27`): `LISTS` devem ser arrays; cliente precisa `id`+`name`; `photoId` precisa estar em `files`; dívida precisa `clientId` existente, `principal>0` **e** `rate>0` (consistente com `services/debts.js:9-10`, que também exige `>0`); documento precisa cliente existente **e** `blobId` em `files`; histórico precisa cliente existente.

Merge × replace (`restore`, `backup.js:12-29`):
* **Confirmção dupla**: `tools.js:47` descreve exatamente o efeito ("todos … serão APAGADOS" / "dados adicionados, clientes com mesmo CPF/CNPJ não duplicados").
* **replace** (`backup.js:14-18`): apaga todas as entradas de `clients,debts,documents,history,blobs` (`db.getAll`), regrava os registros do backup **com os IDs originais** (`enc(k,r)` preserva `r.id`, `records.js:7`), regrava todos os blobs, e escreve `settings/dueWindow` (default 7). Nada de `meta`/cofre → **a senha do cofre local é preservada** e os dados são recriptografados com a DEK local.
* **merge** (`backup.js:19-27`): cliente existente vence por **ID igual** ou por **CPF/CNPJ igual** (`digits(c.doc)`, `backup.js:21-22`); dívida/histórico são pulados se o `id` já existir (`:24,:27`); documento é pulado por `id` ou por chave `(clientId+hash)` (`:25-26`). Filhos são reamarrados ao ID vencedor via `map`.
* **IDs são mantidos?** Sim, nos dois modos, quando não há colisão. Round-trip com o código real (30 clientes/60 dívidas/30 docs/30 históricos, 60 blobs): `data.files` idêntico byte a byte nos 60 blobs, e `JSON.stringify(data.clients|debts|documents|history) === ` original → **IDs e campos preservados** (sonda `probe3`).
* **Transação de escrita**: uma única `db.batch(ops)` (`backup.js:29`, `idb.js:27-30`) com `durability:'strict'`, resolvendo só em `transaction.oncomplete`, e dispatch de `data-changed`. **Tudo ou nada** (comentário `backup.js:11` confere com o código). Toda criptografia ocorre **antes** da transação (`enc`/`blobOp` constroem ops), então falha de cofre/quota estourada aborta sem parcialidade; a UI diz "Nada foi alterado. " + mensagem (`tools.js:48,164`).
* **Backup de segurança antes de restaurar?** **Não existe automático.** Só o texto do `confirm()` pede ao usuário que gere um (`tools.js:47,161`). Ver R-02.
* **Contagem devolvida**: `{clients,debts,documents,history}` — em replace = total gravado; em merge = só o que foi efetivamente adicionado (`backup.js:13-27`), exibida em `tools.js:48`.
* **Pontos assimétricos**: `settings` só é restaurado no modo replace, e só `dueWindow`; no merge nenhuma configuração é restaurada (`backup.js:18` vs. ausência no ramo `:19-27`). Blobs **órfãos** (sem referência) nunca entram no backup (`backup.js:7`) e são apagados no replace (`backup.js:15`).

---

## 4. Exportação XLSX

Gerador **próprio, mínimo, OOXML** (`src/export/xlsx.js`), sem biblioteca de planilha — a justificativa está em `vendor/LICENSES.md:3` (ExcelJS descartado por usar `new Function` vs. CSP sem `unsafe-eval`) e `docs/README.md:13`. Só usa a fflate para o `zipSync` final (`xlsx.js:16`).

Partes geradas (`xlsx.js:10-15`): `[Content_Types].xml`, `_rels/.rels`, `xl/workbook.xml` (abas por ordem), `xl/_rels/workbook.xml.rels`, `xl/styles.xml`, `xl/worksheets/sheet{N}.xml`. Células: `inlineStr` para texto (sem `sharedStrings`), `<v>` para número, `{v,s}` para estilo (`xlsx.js:4-6`); primeira linha congelada (`pane ySplit="1"`), larguras de coluna customizadas (`xlsx.js:4`).

Estilos (`xlsx.js:7-8`, `cellXfs` com 6 entradas — índice usado pela doc inline `xlsx.js:1`): `1` cabeçalho (bold + fill sólido `FFB89A62`, o dourado da marca), `2` `R$ #,##0.00` (numFmt 164), `3` `0.00%` (numFmt 165), `4` negrito, `5` R$ negrito.

Abas e colunas (`reports.js:16-20`), larguras `[30,20,20,10,12,40]` e `[20,30,28,50]`:
* **"Dívidas"**: `Nome do cliente | Juros valor no mês | Valor emprestado | % | Data | Observações`; linha de totais `TOTAL | juros | principal`. Conversões de unidade: centavos→reais `/100` (`reports.js:17`, `money.js:1`), taxa em centésimos de ponto percentual → fração `/10000` (`1500 → 0,15 → 15,00%`, `money.js:1`).
* **"Movimentações"**: `Data e hora | Cliente | Operação | Detalhe`, `toLocaleString('pt-BR')`.
Gatilho na UI: botão "Exportar Excel" (`tools.js:26-27`), recusa período vazio ("Nenhum registro neste período."), nome `scipione-cred-${p.value}.xlsx` (ex.: `scipione-cred-2026-11.xlsx`), MIME `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`.

Limitações verificadas no código:
* **Colunas > 26 quebram**: `String.fromCharCode(65+i)` (`xlsx.js:5`) gera `A..Z,[,\]…` — referência de célula inválida a partir da 27ª coluna. As duas abas atuais usam 6 e 4 colunas, então não é acionado hoje; é um teto estrutural.
* Datas **não** são células de data (sem `numFmt` de data nem conversão serial): saem como texto `dd/mm/aaaa` (`reports.js:3,17,19`) — não ordenáveis/filtráveis como data no Excel.
* Sem fórmulas (totais são valores pré-computados), sem cabeçalho repetido/impressão configurada, sem `dimension`, sem congelamento de colunas, sem Hiperlinks, sem `docProps` (Excel mostra metadados vazios).
* `esc()` remove `U+0000–U+001F` (exceto tab/newline) e escapa `<>&"` (`xlsx.js:2`), então nomes de aba e textos são XML-seguros; **não** há validação de limite de 31 caracteres nem de caracteres inválidos de nome de aba (`[]:*?/\`) — nome é gravado como vem (`xlsx.js:12`).
* A coluna "Data" mostra **vencimento** (`dBR(x.due)`) enquanto o filtro do período usa **data de registro** (`reports.js:17` vs. `:10`); o rodapé do relatório HTML explicita "Data: vencimento de cada dívida." (`tools.js:20`) mas o cabeçalho do XLSX diz só "Data".
* **NÃO CONFIRMADO**: abertura real em Excel/LibreOffice. O teste só escreve `/tmp/amostra.xlsx` "para validação externa" (`tests/backup.test.mjs:26-27`) e não verifica o resultado.

---

## 5. Relatórios (`src/export/reports.js`)

Dois produtos a partir do mesmo `load(periodo)`:
* `load(p)` (`:8-13`): `listDebts()` filtradas por `inPeriod(d.date,p)` (registro no período) com `client` resolvido por `listClients()` (`:9-10`), e `list('history')` filtrada por `inPeriod(isoOf(e.createdAt),p)` — `isoOf` converte o timestamp para a **data local** antes de comparar (`:5`); ordena dívidas por `date`+nome pt-BR (`:10`) e movimentos por `createdAt` (`:11`). `principal`/`interest` = soma **apenas das dívidas** do período (`:12`) — `interest` não é campo gravado: é derivado em `services/debts.js:5` (`M.interest(p,rate)` BigInt, `money.js:9`), fonte única de verdade.
* `xlsxBytes(d)` (`:14-21`) → as duas abas da seção 4.
* `label(p)`/`inPeriod` (`:4,:6`) suportam modo `day` e `month`; a UI (`tools.js:6-29`) tem seletor de período, orientação de impressão, "Visualizar relatório" (HTML A4 com `@page` retrato/paisagem, `tools.js:14-20,28`), "Exportar Excel" e "Imprimir" (exige visualização prévia, `tools.js:28`).
Origem dos números: **somente IndexedDB local** via `services/debts.js`/`clients.js`/`records.js` — nenhum cálculo no servidor, nenhum dado de API externa. `docs/README.md:13-14` confere com o código (abas e período por data de registro).

---

## 6. Google Drive como destino de backup (`src/services/google-drive.js`)

* **OAuth**: Google Identity Services (`https://accounts.google.com/gsi/client`, carregado sob demanda `:51-72`), `initTokenClient` com escopo mínimo **`drive.file`** (`:8,:99`) e `prompt:'select_account'` (`:109`). `client_secret` nunca é usado/armazenado (`:2-3,`: `parseClientJson` aceita só `web`, rejeita `installed` com mensagem clara `:39-40`). **Token só em memória de módulo** (`:14`, `:102-103`) com expiração `expires_in-60s`; `isConnected()` (`:29-32`) o invalida no vencimento; `disconnect()` revoga (`:114-117`). Persistência local: **apenas o JSON de configuração** (`clientId`, `projectId`, `origins`, `type`) em `localStorage['scipione.google.oauth']` (`:11,:43-47`) — nenhum byte de backup em storage local; o `clientId` default vem de `src/config/google.js:4-11`. A UI detecta config antiga de outro cliente e oferece "Usar cliente atual" (`tools.js:70-74`).
* **Pasta**: `SCIPIONE CRED - Backups` (`:9`), procurada por nome+mimeType e **criada** se não existir com `appProperties:{app:'SCIPIONE CRED'}` (`:147-158`); `folderId` cacheado em memória.
* **Nomes**: gerados na UI — `scipione-cred-backup-<AAAA-MM-DD-HH-mm-ss>[-criptografado].zip` (`tools.js:139`), sanitizados no serviço (`/[\\/]/g,'-'`, corte em 180 chars) (`:185`).
* **Upload**: `uploadType=multipart` com parte JSON (`name`, `parents`, `mimeType:'application/zip'`, `appProperties{app,sha256,encrypted}`) + parte binária (`:181-196`); timeout 180 s; **verificação pós-envio**: se `file.size ≠ bytes.byteLength`, o arquivo remoto é **apagado** e o envio falha com `INTEGRITY` (`:199-202`). Recusa backup vazio (`:182`).
* **Listagem**: query por `parents`, `trashed=false`, `mimeType='application/zip'`, `pageSize=100`, paginação por `nextPageToken` e filtro extra por `appProperties.app` (`:160-172`) — o app enxerga só o que criou (efeito do escopo `drive.file`).
* **Download**: exige `appProperties.sha256` hex-64 senão recusa (`:208-210`); baixa `alt=media`, confere tamanho e **SHA-256** (`:211-217`), erros com código `INTEGRITY`. Depois passa por `B.readBackup(bytes, senha)` normalmente (`tools.js:156-157`), ou seja o manifest interno + SHA-256 por entrada **também** são verificados.
* **Erros**: mapeamento específico — API desativada, escopo insuficiente, 404, origem não autorizada, pop-up bloqueado/fechado, `access_denied` (usuário fora de "test users"), `invalid_client` (`:75-83,:119-128`); 401 derruba a sessão e pede reconexão (`:139`); offline é detectado antes de tentar carregar o GIS (`:55,:89`); timeout de 20 s para o script e 120 s para a autorização (`:68,:94`). A UI centraliza em `driveFail` e re-render se desconectado (`tools.js:57-62`).
* CSP: `script-src 'self' https://accounts.google.com`, `connect-src` inclui `accounts.google.com`, `www.googleapis.com`, `oauth2.googleapis.com` (`index.html:3`) — compatível com o serviço.
* Riscos próprios: o hash de integridade fica em `appProperties` **do mesmo** arquivo (quem altera o arquivo pode regravar o hash; a proteção real é o escopo `drive.file` + GCM quando cifrado); a busca da pasta não filtra por `appProperties`, então um `SCIPIONE CRED - Backups` **criado pelo usuário** pode ser adotado (`:149`); backup não cifrado no Drive = PII em claro na nuvem de terceiros (o app avisa, `tools.js:135`); token sem refresh → reconexão a cada aba/sessão.
* **NÃO CONFIRMADO**: o caminho de rede do Drive (OAuth real, upload/download contra a API) não foi exercido nesta auditoria — análise estática apenas. `docs/google-drive.md` existe e descreve a configuração, não foi usado como evidência de comportamento.

---

## 7. Contrato com a fflate

Uso real no código (`grep -rn fflate src`):

| Local | Símbolo usado | Existe no vendor? |
|---|---|---|
| `src/export/lib.js:4` | `load('vendor/fflate.min.js','fflate')` (retorna a lib) | — |
| `src/export/backup-format.js:11,15,18` | `f.strToU8`, `f.zipSync` | sim |
| `src/export/backup-format.js:9` (`P`) | `f.strFromU8` | sim |
| `src/export/backup-format.js:29` | `f.unzipSync` | sim |
| `src/export/xlsx.js:16` (recebe `F` por parâmetro) | `F.strToU8`, `F.zipSync` | sim |
| `src/export/reports.js:20` | `await fflate()` → injeta em `buildXlsx` | — |

Os 4 nomes usados (`zipSync`, `unzipSync`, `strToU8`, `strFromU8`) aparecem na lista de exports do bundle verificado por `grep -o -E "_e\.[A-Za-z0-9_]+="` (que também expõe `Deflate`, `Zip`, `UnzipInflate`, etc.).

Carregamento: **não é import ESM**. `lib.js:2-4` resolve `globalThis.fflate` se já existir; senão injeta `<script src="vendor/fflate.min.js">` no `<head>` e guarda a Promise num cache de módulo (evita injeção dupla). Consequências verificadas:
* A URL é **relativa ao documento**, não ao módulo (`lib.js:4`). O app não usa pushState/rotas no URL (navegação por funções de view, `main.js:44-65`, `src/ui/shell.js`), então hoje resolve sempre para `<origem>/vendor/fflate.min.js`. Se alguém servir o app num subdiretório com URL "navigável" diferente, o script falha com "Não foi possível carregar vendor/fflate.min.js". **NÃO CONFIRMADO** em browser.
* **Fallback ausente**: não há import dinâmico do ESM da fflate, nem CDN, nem segunda rota de compressão. Se a carga falhar (cache corrompido, MIME bloqueado por `nosniff` em `vercel.json`, HTML de fallback devolvido para `/vendor/fflate.min.js`), a mensagem é genérica e **todo backup/exportação fica indisponível**. O ramo `s.onload` ainda confere `globalThis[g]` e rejeita "Biblioteca inválida" se o global não aparecer (`lib.js:3`) — proteção razoável contra respostas não-JS, mas o cache de Promise **não é invalidado nesse ramo** (só em `onerror`, `lib.js:3`): um "Biblioteca inválida" persiste até recarregar a página.
* Os testes **não exercitam `lib.js`**: injetam a lib via `new Function` direto em `globalThis.fflate` (`tests/backup.test.mjs:2`), portanto caminho de resolução, CSP e o próprio loader estão fora da cobertura.

---

## 8. O que os testes cobrem de fato (e as lacunas)

### `tests/backup.test.mjs` (28 linhas) — transcrição das asserções
* `:5-7` fixture: 2 clientes fictícios (`c1` Ana com `photoId p1`, `c2` Bia sem foto), 1 dívida (`d1`, `principal 500000`, `rate 1500`, `date 2026-11-06`, `due 2026-12-06`), 1 documento (`x1`, `blobId b1`), 1 histórico (`h1`), `settings.dueWindow 7`, 2 blobs (`p1` 5000 bytes, `b1` 100 bytes), `dbVersion 1`.
* `:9-10` ida e volta sem senha: `assert.equal(r.manifest.counts.clients,2)`; `assert.deepEqual(r.data.debts[0].principal,500000)`; `assert.deepEqual([...r.data.files.get('p1')],[...bytes])` (integridade de **1** blob).
* `:12-15` cifrado: `assert.rejects(readBackup(e), x=>x.code==='NEEDS_PASSWORD')`; **`assert.rejects(readBackup(e,'errada'), x=>x.code==='BAD_PASSWORD')` (senha errada coberta)**; `assert.equal((await readBackup(e,'senha-backup-1')).data.clients.length,2)`; `assert(!Buffer.from(e).includes(Buffer.from('Ana')))` — nomes não podem aparecer em claro.
* `:17-18` inconsistência: dívida órfã (`clientId='zzz'`) → `INVALID`; `files.delete('b1')` → `INVALID`.
* `:19` adulteração do cifrado: 1 bit no byte do meio → `assert.rejects(...)` (**sem** verificação de código/mensagem).
* `:20` lixo: `new Uint8Array([1,2,3])` → `INVALID`.
* `:21` manifest com `{"app":"x"}` → `INVALID`.
* `:23-24` período/label: `inPeriod` mês/dia, `label` "Março/2026" e "Dia 06/11/2026".
* `:26-27` `buildXlsx` com 2 abas é apenas **gravado em `/tmp/amostra.xlsx`** "para validação externa" — **nenhuma asserção sobre o XLSX**.

### `tests/stage4.test.mjs` (7 linhas)
Nada de backup/exportação: cobre `daysUntil`/`status` de vencimento (`:2-3`) e `match()` de busca por nome/CPF/CNPJ/telefone/e-mail/RG (`:4-6`). **Não contribui para esta área.**

### Lacunas (as 5 maiores)
1. **`restore()` nunca é testado** — merge, replace, reamarração por CPF/CNPJ, `map`, dedupe de documentos por `hash`, contadores `S`, e o "tudo ou nada" de `db.batch` estão totalmente descobertos (nenhum teste importa `src/export/backup.js`; `grep` nos `tests/` mostra só `backup-format`, `xlsx`, `reports`).
2. **Versão incompatível não é testada** — o caminho `formatVersion > FORMAT` (`backup-format.js:32`) é o único guarda de compatibilidade e não há um único caso com manifest v2/v0/ausente; também não há teste de `dbVersion` (que nem é verificado).
3. **Arquivo truncado/parcial não é testado** — só 3 bytes aleatórios (`:20`). Não há corte em `%` do ZIP válido, corte no meio de `files/*.bin`, nem verificação de que a mensagem é a correta. (Medido nesta auditoria: truncamento a 50/70/99% → `INVALID` "O arquivo não é um ZIP válido." — comportamento correto, mas sem regressão automatizada.)
4. **Integridade de blobs é coverage de 1 item** — `:10` checa `files.get('p1')`; não há teste de muitos blobs, blob grande, blob ausente no meio do restore, `files` vazio com `photoId` presente, ou comparação byte-a-byte de todos os blobs num round-trip (o que `validate` deveria garantir com `sha256`).
5. **Round-trip completo em escala não existe** — nada com N clientes/dívidas/documentos/históricos; também faltam: backup vazio (0 registros), acentos/`<>&"`/emoji em nomes e observações, `iter`/`salt` adulterados no manifest cifrado, entradas inesperadas no ZIP, `sha256` ausente, `settings` ausente, e a UI (`tools.js`) — nada de `save()`, nome de arquivo, `createBackup` cancelando por blob ilegível, ou Drive (zero testes em `google-drive.js`; `apicpf.test.mjs` é a única prova de integração de serviço).

---

## 9. Onde modificar X

| Objetivo | Arquivo(s) e linha(s) | Passos / cuidados |
|---|---|---|
| **Adicionar campo ao backup** | Gravação: `src/export/backup-format.js:15` (manifest) e/ou `:12` (nova entrada `data/x.json`); coleta: `src/export/backup.js:5-9` + `LISTS` em `backup-format.js:5`; leitura: `backup-format.js:42` (laço `LISTS+'settings'`) e `:12`; se for blob, `backup.js:7`; validação: `backup-format.js:20-27`; UI/contagem: `tools.js:45,49,166` e `backup.js:13-16`. Como `sha256` é calculado por entrada (`backup-format.js:11-13`), toda entrada nova entra assinada automaticamente. Se adicionar nome a `LISTS`, o **replace** (`backup.js:15-18`) precisa apagar/gravar o novo store e o **merge** precisa de um ramo em `backup.js:19-27`; campos opcionais exigem tolerância a `null` (leitura usa `?? default`, ex. `backup.js:18`). Um campo novo **sem bump** de `FORMAT` mantém compatibilidade de leitura (manifest é JSON) — o leitor antigo simplesmente o ignora. |
| **Bumpar versão de formato** | `src/export/backup-format.js:5` (`FORMAT=1`). A gate está em `:32` (`formatVersion > FORMAT` → rejeita). Falta implementar o mapa de migração prometido em `:3` (`MIGRATE[v]`) e chamar algo como `MIGRATE[m.formatVersion]` antes de `:42`; hoje bumpar `FORMAT` para 2 **inutiliza restauração de qualquer backup existente** (nenhum migrador, nenhum teste de upgrade). Registrar também em `docs/README.md:15`, `vendor/LICENSES` não, e `tests/backup.test.mjs` precisa de casos v-1 → v. Decidir se `FORMAT` entra no manifest cifrado externo (`:18`) também — está nos dois. |
| **Mudar compressão** | `src/export/backup-format.js:16` (`f.zipSync(z)` → nível default 6) e `:18` (`{level:0}` do ZIP externo). Para nível 9/0 por entrada, usar o array de opções da fflate (`zipSync(obj, {level})` ou `{name, level}`); o método resultante é derivado de `level==0 ? store : deflate` (bundle fflate, linha de `p.level == 0 ? 0 : 8`). Manter `level:0` no externo se houver cifração (ciphertext não comprime e comprimir antes de criptografar não é seguro). Atenção: **não há teste de golden-file**, mas o nível muda o `sha256` por entrada? Não — o `sha256` é calculado sobre o **conteúdo** antes do ZIP (`backup-format.js:11`), logo a mudança de nível não invalida backups antigos. |
| **Adicionar aba no XLSX** | `src/export/reports.js:20` (array de `{name,rows,widths}`) e os dados em `reports.js:8-13`; estilos em `src/export/xlsx.js:7-8` (índices de `cellXfs`, doc inline em `xlsx.js:1`). O writer já trata N abas (`xlsx.js:12-15` gera `sheet{i+1}.xml` + rels + Content_Types por aba), então nada em `xlsx.js` precisa mudar — exceto se a aba passar de 26 colunas (**bug de referência**, `xlsx.js:5`) ou exigir tipos novos (data como número serial). |
| **Mudar destino do Drive** | Pasta: `src/services/google-drive.js:9` (`FOLDER`) e a query/criação em `:147-158` (mudar nome exige migrar/conviver com a pasta antiga; `folderId` é cacheado em `:14`). Identificação do app: `:10` (`APP`) + `appProperties` em `:154,:186-187,:171`. Escopo: `:8`. API base: `:6-7` (ex.: `drive.appdata` exigiria outra URI e não permitiria ver arquivos de outros apps). Nome do arquivo: `src/ui/tools.js:139` (e o default redundante em `google-drive.js:185`). Config/OAuth: `src/config/google.js:4-11`, `localStorage` key em `google-drive.js:11`, CSP em `index.html:3`, cache/origens em `vercel.json`. UI de status/mensagens: `src/ui/tools.js:53-192`. |

---

## 10. Riscos identificados (classificados)

**ALTO**
* **R-01 — Ausência total de teste da restauração** `src/export/backup.js:12-29` (nenhum `tests/*.mjs` a importa; cf. §8). O modo `replace` apaga `clients,debts,documents,history,blobs` inteiros (`backup.js:15`). Um erro de regressão aqui é destrutivo e irreversível.
* **R-02 — Nenhum backup de segurança automático antes de restaurar** `src/ui/tools.js:47,161` (só texto de `confirm()`), `src/export/backup.js:14-18`. Se o usuário escolhe "substituir tudo" com um backup antigo/parcial, perde o estado atual. Mitigação recomendada: gerar `pre-restore-<ts>.zip` automaticamente na mesma tela.
* **R-03 — Bump de `formatVersion` sem qualquer `MIGRATE`** `src/export/backup-format.js:3` (promessa) vs. `:32` (gate dura). Combinado com R-04, significa que **não há caminho de upgrade** verificado: a primeira mudança de formato quebra restauração de todos os backups existentes, e nenhum teste pega isso (`tests/backup.test.mjs` não testa versão).
* **R-04 — `manifest.dbVersion` gravado e nunca verificado** `backup-format.js:15` (escrita) / ausência de leitura (só `settings.js:50` exibe o `DB_VERSION` local; `idb.js:10`). Restaurar um backup gerado sob schema futuro não é detectado.

**MÉDIO**
* **R-05 — `iter` (e salt) são lidos do arquivo sem limites** `backup-format.js:17,35` (`deriveAesKey(password, unhex(m.salt), m.iter)`). Um manifest adversário com `iter` gigante faz a derivação travar a UI sem aviso (DoS local); `kdf`/`cipher` são decorativos — **verificado por execução**: um manifest com `cipher:"AES-CBC"` é aceito normalmente (`probe2`). Recomenda-se `Math.min(Math.max(m.iter|0, ITER), teto)` ou simplesmente ignorar e usar `ITER`, e validar `salt` com `/^[0-9a-f]{32}$/`.
* **R-06 — ZIP/CRC não autenticados em backups **sem senha*** `backup-format.js:38-40` exige `sha256` do próprio arquivo, mas o `sha256` está **em claro** dentro do mesmo ZIP → um atacante que altera `files/*.bin` recalcula o manifest. Integridade real (autenticada) só existe no modo cifrado via tag GCM — **confirmado**: varredura integral de bit-flip no `payload.enc` deu 428/428 rejeições; já a fflate **não** checa CRC-32 (flips nos bytes 14-17 do local header foram aceitos; `probe5`). Para backups planos a garantia é só "anti-corrupção", não "anti-adulteração".
* **R-07 — Sem SRI/verificação da lib vendorizada e sem fallback de carregamento** `src/export/lib.js:2-4`, `vendor/fflate.min.js`. Backup/XLSX ficam indisponíveis se o `<script>` falhar (cache corrompido, MIME/`nosniff`, rota de fallback), e uma troca silenciosa do arquivo não é detectada por teste nem runtime. `docs/README.md:21` manda atualizar `sw.js` manualmente — não há guarda automatizada.
* **R-08 — fflate 0.8.2 enquanto 0.8.3 corrige "buffer over-read" em campos Zip64** (`vendor/fflate.min.js` md5 == 0.8.2; CHANGELOG 0.8.3). Baixa probabilidade de gatilho com `zipSync` próprio, mas `unzipSync` sobre arquivo malicioso é justamente o cenário do fix. Atualizar o vendor + `sw.js` + `LICENSES.md`.
* **R-09 — Empacotamento síncrono em memória** `backup-format.js:16-18`, `xlsx.js:16`; medida com dados fictícios: 14,3 MB de .zip (15 MB de blobs) em **1,08 s** de CPU bloqueante; crescimento linear com a biblioteca de fotos. Sem worker/progresso; em celulares antigos é congelamento perceptível (e risco de OOM em cofres grandes).
* **R-10 — Blobs órfãos ficam fora do backup** `backup.js:7` (lista apenas `photoId`+`blobId` referenciados). Se algum fluxo deixar um blob sem referência (ex.: escrita interrompida entre `blobOp` e `enc` — improvável pois `db.batch` é atômico, `idb.js:27-30`), ele não é exportado e é apagado num replace (`backup.js:15`). **NÃO CONFIRMADO** que existam órfãos no mundo real.
* **R-11 — Assimetria de `settings`** `backup.js:18` (só replace restaura `dueWindow`; merge não restaura nada; `idleMinutes` nunca é exportado, `backup.js:8`). Um restore "substituir tudo" zera a janela de vencimento para o default se o backup não tinha a chave (`?? 7`).

**BAIXO**
* **R-12 — `formatVersion` fracionário passa** `backup-format.js:32` (`1.5` aceito sem migrador). Usar `m.formatVersion !== FORMAT` + migrações.
* **R-13 — `unhex` silente com hex ímpar/invaldo** `backup-format.js:6` → salt truncado, e o erro aparece como "Senha do backup incorreta" (`:35`), induzindo o usuário a tentar outras senhas (**verificado**: `salt:"zz"`, `salt:""` → `BAD_PASSWORD`).
* **R-14 — Coluna "Data" do XLSX é vencimento, filtro é data de registro** `reports.js:10,17`; rodapé só existe na versão HTML (`tools.js:20`).
* **R-15 — 27ª coluna em diante gera referência XML inválida** `xlsx.js:5`.
* **R-16 — Busca da pasta do Drive não filtra por `appProperties`** `google-drive.js:149` → pasta homônima criada pelo usuário pode ser adotada.
* **R-17 — Backup sem senha no Drive = PII em claro em terceiros** `tools.js:135` (aviso existe), `google-drive.js:186-187` (metadados `name` revelam data/nº de backups).
* **R-18 — `Promise` de lib não é descartada no ramo "Biblioteca inválida"** `lib.js:3` (só `onerror` faz `delete cache[g]`): se o global faltar sem erro de rede, a falha fica cacheada até recarregar.
* **R-19 — doc/código**: `docs/README.md:15,20` estão corretos quanto a formato e modos de restauração, mas nenhuma das alegações sobre "backup regular" (linha 9, iOS) tem teste; `tests/stage4.test.mjs` não cobre a área apesar de o script de testes (`docs/README.md:22`) sugerir que a etapa 4 é testada.
