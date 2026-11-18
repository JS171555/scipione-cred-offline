# SCIPIONE CRED — Roadmap técnico

## 1. Objetivo, premissa e política de prioridade

**Objetivo.** Converter os achados verificados nas sete auditorias (`docs/auditoria/1-bootstrap-navegacao.md` a `docs/auditoria/7-testes-infra.md`) num backlog acionável: cada item abaixo é fechável por um agente de implementação sem decisão de projeto adicional, porque traz evidência `arquivo:linha`, impacto, correção mínima e critérios de aceite testáveis.

**Premissa inegociável: preservar o funcionamento atual.** Nenhuma item deste roadmap muda regra de negócio, layout, fluxo de telas, formato de dado ou política de segurança por iniciativa própria. Toda mudança de comportamento visível está marcada e condicionada a autorização. Itens que poderiam quebrar cofres existentes (normalização de senha no KDF, recriação de stores, bump de `FORMAT` sem migrador) estão na seção 5.

**Commit de referência:** `e78d776` (conteúdo idêntico em `main`/`origin/main`; as auditorias 2 e 6 registram que o checkout estava em `chore/project-audit-and-test-infrastructure` apontando para o mesmo commit). Todas as linhas citadas valem para esse commit; re-verificar antes de implementar.

**Fontes e convenção.** Cada item cita o arquivo-fonte da auditoria (por exemplo `3-seguranca.md:264` = vulnerabilidade C1). O que a auditoria marcou `NÃO CONFIRMADO` aparece aqui com um critério de confirmação explícito — o item não entra em implementação antes disso. Nada foi acrescentado a partir de opinião: se não há evidência, não há item.

**Política de prioridade — impacto × risco × esforço.**

- *Impacto*: dano real ao usuário (perda de dados, exposição de PII, indisponibilidade) e não probabilidade teórica. Itens com exploração verificada em produção (`/api/cpf`, cache obsoleto já concretizado em 4 commits) sobem na fila.
- *Risco da correção*: probabilidade de a correção quebrar cofre, dados gravados, identidade visual ou o fluxo offline. Risco alto exige rede de teste antes (seção 6), não elimina o item.
- *Esforço*: `S` até 2 h · `M` 2–6 h · `L` mais de 6 h, calibrado com os custos estimados em `3-seguranca.md:356-375` onde existem.
- **Ordem de decisão:** impacto alto + risco baixo primeiro; impacto alto + risco alto só depois dos testes de regressão (T5); impacto baixo só em onda final.

**Marcador `EXIGE AUTORIZAÇÃO`.** Aplicado quando o item toca **cofre** (inclui material de chave e credenciais persistentes), **schema** (IndexedDB ou formato de backup), **design** (algo visível ou fluxo do usuário) ou **dependência** (biblioteca/vendor/ferramenta de teste). Fora desses quatro casos, o item é implementável sozinho.

---

## 2. Tabela-resumo (66 itens — 62 originais + 4 abertos nesta revisão; 2 **[FEITO EM CÓDIGO]**)

**Legenda de status desta revisão.** Uma linha marcada **[FEITO EM CÓDIGO]** foi concluída na branch `fix/api-cpf-exposure-and-debt-integrity`. As quatro linhas novas (`S-02a`, `S-10`, `D-12`, `D-13`) nasceram do que essas correções deixaram em aberto — não são itens inventados: cada uma tem evidência `arquivo:linha` no próprio detalhe. **Exceção à premissa da seção 1:** todas as citações de `api/cpf.js`, `src/services/apicpf.js` e `src/services/debts.js` valem para o estado atual da branch, não para `e78d776`; foram re-pontadas nesta revisão.

| ID | Título | Severidade / categoria | Esforço | Depende de | Autorização |
|---|---|---|---|---|---|
| S-01 | DEK persistida em IndexedDB; `lock()` não aguarda o delete | Alta — cofre/sessão | M | Q-05 | Sim (cofre) |
| S-02 | `/api/cpf` é oráculo público sem auth nem rate limit — **[FEITO EM CÓDIGO]**; restam S-02a e S-10 | Alta — superfície remota | M | Q-01 | Não |
| S-02a | Criar regra de rate limit na WAF — **dashboard, fora do repo** | Alta — superfície remota | S | S-02 | Sim (painel do mantenedor) |
| S-03 | `iter`/`salt` do KDF vêm de dado não autenticado, sem clamp | Média — criptografia | S | Q-07 | Não |
| S-04 | Erro de integridade vira "Senha incorreta" e queima tentativa | Média — disponibilidade | S | Q-05 | Não |
| S-05 | Falha GCM em 1 registro derruba a store inteira, muda | Média — disponibilidade | M | Q-03 | Não |
| S-06 | Sem troca de senha nem rotação da DEK | Média — governança de credencial | L | S-03 | Sim (cofre) |
| S-07 | Retenção pós-bloqueio: blob URLs, caches de PII, token do Drive | Baixa — higiene | S | — | Não |
| S-08 | MIME/nome do arquivo sem verificação de conteúdo (magic bytes) | Baixa — entrada de arquivo | S | Q-06 | Não |
| S-09 | Header CSP só com `frame-ancestors`; sem SRI no bundle | Baixa — defense in depth | M | P-01 | Não |
| S-10 | `GET /api/cpf?cpf=` legado aceito — deprecado, remoção sob condição | Baixa — privacidade/higiene | S | S-02, P-01 | Sim (dono) |
| D-01 | `saveDebt` aceita `clientId` inexistente (dívida órfã) — **[FEITO EM CÓDIGO]**; restam D-12 e D-13 | Média — integridade referencial | S | Q-04 | Não |
| D-02 | Corrida de duplicidade de CPF/CNPJ fora da transação | Média — integridade | M | D-05, Q-03 | Sim (schema) |
| D-03 | `deleteClient` em 4 leituras + 1 escrita | Média — integridade | M | Q-03 | Não |
| D-04 | Índices nunca usados e `history.at` nunca gravado | Baixa — schema morto | S | — | Não |
| D-05 | Migrações sem `objectStoreNames.contains` e sem downgrade | Média — schema | M | Q-03, Q-05 | Sim (schema) |
| D-06 | `validate()` do backup aceita dados que quebram a leitura | Média — formato de dados | M | D-01 | Sim (formato) |
| D-07 | Regras de validação morando na UI | Média — entrada de dados | M | Q-06 | Não |
| D-08 | `address` recomposto só no form: dupla fonte da verdade | Baixa — consistência | S | — | Não |
| D-09 | Formato do backup: `MIGRATE` prometido inexistente, `dbVersion` lido por ninguém | Alto — compatibilidade | M | D-06 | Sim (formato) |
| D-10 | Rotas destrutivas sem backup prévio nem confirmação forte | Alto — perda de dados | M | Q-04 | Sim (design) |
| D-11 | Exportação: teto de 26 colunas no XLSX e `zipSync` síncrono | Baixa — exportação | M | Q-07 | Não |
| D-12 | `deleteDebt`/`applyBulk` escrevem histórico órfão em dado legado | Baixa — integridade | S | D-01 | Não |
| D-13 | Sem rota de reatribuição de dívida órfã na UI | Média — recuperação de dado | M | D-01 | Sim (design) |
| P-01 | `V`/`FILES` mantidos à mão: 4 commits serviram cache obsoleto | Média — publicação | S | Q-02 | Não |
| P-02 | `addAll` tudo-ou-nada sem catch; fallback só em falha de rede | Média — offline | M | Q-09 | Não |
| P-03 | `skipWaiting` + `clients.claim` trocam cache sob aba viva sem aviso | Média — atualização | M | P-01 | Sim (design) |
| P-04 | `db.put`/`db.del` não emitem `data-changed` | Baixa — reatividade | S | — | Não |
| P-05 | `fflate` sem fallback e promise de "Biblioteca inválida" cacheada | Média — exportação | S | — | Não |
| P-06 | `docs/` servido em produção por `outputDirectory: "."` | Média — exposição | S | I-05 | Não |
| P-07 | Flash da nav antes do gate de autenticação | Baixa — NÃO CONFIRMADO | S | Q-09 | Não |
| A-01 | Anel de foco suprimido por especificidade em campos de texto | Média — acessibilidade | S | — | Sim (design) |
| A-02 | Erro de campo sem `aria-describedby`/`aria-invalid`/`id` e sem `required` | Média — acessibilidade | M | — | Não |
| A-03 | `role="status"` recriado a cada pintura no `pager` | Média — acessibilidade | S | — | Não |
| A-04 | Colisão de breakpoint em exatamente 560 px | Baixa — CSS | S | — | Sim (design) |
| A-05 | Contrastes `--gold-deep` 3,47:1 e `.report-hint` 3,34:1 | Baixa — acessibilidade | S | — | Sim (design) |
| A-06 | `aria-current` do menu quebrado em 3 telas | Média — orientação | S | — | Não |
| A-07 | Código morto verificado (tokens, classes, `...a`, `day()`, ícones) | Baixa — manutenção | M | Q-02 | Não |
| A-08 | Duplicações `top()`/`fld()`/`row()`/`run()`/`dBR()`/`kb()`/`mb()` | Baixa — manutenção | L | A-07 | Não |
| A-09 | `watch` é slot único: gravação re-renderiza sob o form aberto | Baixa — NÃO CONFIRMADO | M | Q-09 | Não |
| A-10 | `icon()` silencioso em nome errado e rótulo textual como API | Baixa — acoplamento | M | A-07 | Sim (design) |
| Q-01 | `tests/apicpf.test.mjs:15` faz egress real e passa pela razão errada | Crítico — testes | S | — | Não |
| Q-02 | Sem `scripts` no `package.json` e sem CI; job estático proposto | Alta — infraestrutura | M | Q-01 | Não |
| Q-03 | Helpers de teste (fake IDB, globals, fixtures, fetch-mock) + meta-teste | Alta — infraestrutura | L | Q-02 | Não |
| Q-04 | Testes de `createBackup`/`restore` (a função que apaga tudo) | Crítico — risco de dados | L | Q-03 | Não |
| Q-05 | Testes de cofre: lockout, auto-lock, `restoreSession`, transações | Alta — risco de dados | L | Q-03 | Não |
| Q-06 | Testes de validadores de negócio, `TZ` fixado, agregações | Média — testes | M | Q-03 | Não |
| Q-07 | Normalizar os 7 scripts legados para `node:test` `describe`/`it` | Média — testes | M | Q-02 | Não |
| Q-08 | Gate de cobertura progressivo (21 módulos sem teste) | Média — gate | S | Q-01, Q-02 | Não |
| Q-09 | Smoke em navegador real (SW, durabilidade, OAuth, Excel), não bloqueante | Média — testes | L | Q-03 | Sim (dependência) |
| I-01 | CPF na query string nas duas pernas da consulta — *a perna do app saiu da URL com S-02; resta a do provedor, que não é nossa* | Média — privacidade | M | S-02 | Não |
| I-02 | Drive sem refresh token: sessão morre em ~1 h | Média — integração | M | — | Sim (credencial) |
| I-03 | Upload multipart sem cap de tamanho no cliente | Média — integração | S | — | Não |
| I-04 | Import de JSON do Google Cloud inalcançável (`configured` sempre true) | Média — doc inexecutável | M | — | Sim (design) |
| I-05 | 2 `client_id` + projetos GCP + e-mail pessoal commitados | Média — sobre-divulgação | M | I-04 | Sim (dono) |
| I-06 | `fflate` 0.8.2 com upstream em 0.8.3 (Zip64 buffer over-read) | Média — dependência | S | P-01 | Sim (dependência) |
| I-07 | Backup invisível fora do `client_id`; pasta homônima adotada | Média — recuperação | M | — | Sim (design) |
| I-08 | Falha de configuração é indistinguível de offline | Baixa — observabilidade | S | — | Não |
| I-09 | Sem opt-out nem aviso visível do envio do CPF a terceiro | Média — consentimento | S | — | Sim (design) |
| DOC-01 | `docs/README.md:28` diz trilho 720 px; o código é 768 px | Média — doc divergente | S | — | Não |
| DOC-02 | README:293 runner que engole falha e README:296 smoke test inexistente | Alta — doc falsa | S | Q-01 | Não |
| DOC-03 | Doc atribui `frame-ancestors`/`object-src` ao Vercel quando é meta | Baixa — doc imprecisa | S | S-09 | Não |
| DOC-04 | `LICENSE`: decisão já registrada, sem arquivo | Informativo — governança | S | — | Não |
| DOC-05 | Sem `CHANGELOG` antes desta branch | Baixa — governança | S | — | Não |
| DOC-06 | `engines` ausente: README pede Node 18+, suíte validada em 22 | Baixa — infraestrutura | S | Q-02 | Não |
| DOC-07 | Alegações "100% offline", "nada sai do aparelho", "Aguarde N s" | Média — comunicação | S | S-04 | Não |

---

## 3. Detalhe por trilha

### T1 — Segurança e cofre

#### S-01 · DEK persistida no IndexedDB e remoção não garantida no bloqueio
- Contexto/evidência: a sessão grava a própria `CryptoKey` no store `meta` e o `lock()` dispara o delete sem aguardar: `src/security/auth.js:55`, `:67`, `:43`, `:47`; reescrita a cada 1,8 s em `:53`; sem `pagehide`/`beforeunload` (`3-seguranca.md:264-267`, C1, Alta).
- Impacto: dump do IndexedDB sozinho entrega o cofre em claro sem senha; se o delete falhar ou a aba fechar, a chave fica no disco indefinidamente e sem sinal.
- Correção mínima: `await` do `db.del('meta','session')` no `lock()` (com falha logada e visível); embrulhar a DEK por uma *session key* aleatória guardada só em `sessionStorage`, passando `restoreSession` a exigir o par `sid` + *session key*; elevar o intervalo de `saveSession` de 1,8 s para 15–30 s; limpar o registro em `pagehide`.
- Aceite: teste que (i) após `lock()` o registro `meta/session` não existe, (ii) se o delete rejeita, a UI acusa estado não seguro, (iii) um dump de IndexedDB isolado não abre o cofre sem o `sessionStorage` do mesmo navegador.
- Risco: alto (perde a conveniência de F5 destravado se mal implementado); exige corrida de sessão em navegador. Esforço M. **EXIGE AUTORIZAÇÃO (cofre)**.

#### S-02 · `/api/cpf` como oráculo público, sem autenticação nem rate limit — **FEITO EM CÓDIGO NESTA BRANCH**
- Estado: **concluído no repositório** — `api/cpf.js` foi reescrito, 48 → 138 linhas. O que não cabe no repositório virou **S-02a**; o que ficou aberto por compatibilidade virou **S-10**.
- O que foi executado: `POST` com `{"cpf":"11 dígitos"}` no corpo, lido nos três formatos que o runtime entrega (`api/cpf.js:73-91`), cliente já migrado (`src/services/apicpf.js:28-33`); recusa de método fora de GET/POST (`api/cpf.js:94`), de `content-type` não-JSON **antes** de tocar no corpo (`:95-96`), de origem estrangeira (`:48-56`, aplicada em `:98`) e de corpo acima de 1 KiB (`:13`, `:85`, `:103`); cota de janela fixa por IP e por instância (`:58-69`, aplicada em `:99-100`) com `429` + `Retry-After` (`:100`); nenhum eco do CPF em resposta alguma (`:104-106,118-122`); `Cache-Control: no-store` preservado (`:30`). Envs novas com default: `CPF_QUOTA_WINDOW_MS` 60000, `CPF_QUOTA_PER_IP` 30, `CPF_QUOTA_PER_INSTANCE` 300, `SCIPIONE_ALLOWED_ORIGINS` vazio (`:15-17`, declaradas em `.env.example`).
- O que **não** foi feito, sem rodeio: autenticação de chamador (a superfície continua anônima); leitura de `Sec-Fetch-Site` (grep: zero ocorrências em `api/`); **cache de resposta por CPF com TTL no servidor**, que o aceite original pedia — o cache continua sendo só o do navegador (`src/services/apicpf.js:3,43`); distribuição do limite entre instâncias e regiões (contador é estado de módulo: `api/cpf.js:19-25`); remoção do `GET` legado (**S-10**); teto de custo no edge (**S-02a**).
- Correções ao critério de aceite, à luz do que foi medido: "sonda sem header de origem recebe 401/403" **não vale** — sem header o pedido segue, decisão explícita em `api/cpf.js:50` com caso de teste próprio (`tests/apicpf.test.mjs:443`), porque o navegador não envia `Origin` em GET same-origin; o que existe é recusa de origem **estrangeira declarada**. "100 chamadas simultâneas do mesmo IP não consomem 100 cotas" vale **dentro de uma instância e da janela** (`api/cpf.js:66`), não entre instâncias/regiões. A terceira exigência foi cumprida: `tests/apicpf.test.mjs` cobre os caminhos novos (40 casos) e nenhum teste faz rede, asserido no próprio arquivo (`tests/apicpf.test.mjs:571,578`).
- Risco realizado: médio — mudou o contrato entre função e cliente nas duas pernas do mesmo PR; o amortecedor é o `GET` legado ainda aceito (`api/cpf.js:74-77`). **Nada visível para o usuário mudou**: o `429` cai no mesmo caminho silencioso de `UNAVAILABLE` (`src/services/apicpf.js:47`, `src/ui/clients.js:93`). Esforço M. Sem autorização de cofre/schema.

#### S-02a · Criar regra de rate limit na WAF — **dashboard, fora do repo**
- Contexto/evidência: a cota de `api/cpf.js:58-69` é estado de módulo de **cada instância aquecida**, e o contador da própria plataforma também é por região (comentário honesto em `api/cpf.js:19-22`). Não há como expressar isto no repositório: `vercel.json` não tem bloco `functions` nem regra de velocidade (`vercel.json:1-62`); o único canal de mitigação configurável como código (`routes[].mitigate`) aceita **somente `challenge` e `deny`** — rate limit, `log`, `bypass` e `redirect` não —; e o SDK `@vercel/firewall` é dependência externa, proibida pelo projeto (`README.md:157`, `package.json:1`).
- Impacto: sem a regra, o teto efetivo de custo é `per_instance × instâncias aquecidas`, grandeza **não medida** neste repositório, e rotação de IP circorna `per_ip`. É a única barreira que cobra antes de a requisição chegar à função.
- Ação, com os parâmetros sugeridos: Vercel → selecionar o projeto → **Firewall** na barra lateral → **Configure** → **+ New Rule**; condição `Request Path` · `Equals` · `/api/cpf`; ação **Rate Limit** · estratégia *Fixed Window* · **Time Window 60 s** · **Request Limit 60** · chave **IP** · ação final **`Too Many Requests (429)`**. Criar **primeiro como `Log`**, observar **10 minutos** no overview do Firewall e só então trocar para 429. Fechar com **Review Changes → Publish** — sem Publish a regra não vale em produção. Limites da plataforma: Hobby tem 1 regra de rate limit (dentro de 3 customizadas), chaves **IP** e **JA4 Digest**, janela de 10 s a 10 min.
- Aceite: a regra existe e está publicada; uma sonda de 61 pedidos em 60 s do mesmo IP é bloqueada na borda **sem** chegar à função; a UI continua inalterada.
- Risco: bloquear tráfego legítimo com teto baixo demais — daí o passo preliminar em `Log`. Esforço S (configuração; zero linha de código). **Não executável por agente: exige acesso ao painel do mantenedor.**

#### S-10 · `GET /api/cpf?cpf=` legado aceito — deprecado, remoção sob condição explícita
- Contexto/evidência: o ramo `GET` continua aceito e continua lendo `searchParams` (`api/cpf.js:74-77`) por um único motivo declarado no código (`:71-72`): bundles pré-cacheados em aparelhos já instalados chamam a forma antiga até o Service Worker atualizar. A versão canônica do cache é `V` em `sw.js:2` (`sc-v70`), mantida à mão — por isso o item depende de P-01.
- Impacto: enquanto o ramo existir, o CPF pode voltar a aparecer em URL de entrada, exatamente a exposição que S-02 fechou para os bundles atuais. Fica **limitada** pela cota (`api/cpf.js:58-69`), não removida.
- Condição de remoção (o que precisa ser verdade antes de apagar o ramo): nenhuma instalação servindo bundle anterior a `sc-v70`. Operacionalmente, o mantenedor observa os logs de acesso da plataforma e deixa de ver qualquer `GET /api/cpf?cpf=` por um período que **ele** fixa — **esse período não foi medido aqui, e não há telemetria no app que permita medi-lo** (zero canais de saída). Cumprida a condição: remover `api/cpf.js:74-77` e o teste de método em `:73-74`, deixando o `GET` cair no `405` de `:94`.
- Aceite: `GET /api/cpf?cpf=...` responde `405 {reason:'METHOD'}`; os casos de POST de `tests/apicpf.test.mjs` permanecem verdes; `docs/API.md` registra a data da remoção.
- Risco: médio — quebra o aparelho que nunca abriu o app desde o bundle antigo (sem SW novo, sem aviso). Esforço S. **EXIGE AUTORIZAÇÃO (dono: é decisão sobre instalação antiga, não sobre código).**

#### S-03 · Downgrade de força do KDF por `iter`/`salt` não autenticados
- Contexto/evidência: `src/export/backup-format.js:35` deriva com `m.iter` e `unhex(m.salt)` lidos do manifest do arquivo, sem piso/teto; `src/security/crypto.js:14` idem para o cofre; `unhex` aceita hex de qualquer comprimento (`backup-format.js:6`) — `3-seguranca.md:273-275` (C3), `4-backup-exportacao.md:261` (R-05).
- Impacto: zip forjado com `iter:1` transforma "Verificar arquivo" (`src/ui/tools.js:44-49`) em oracle de força bruta barato contra a senha do backup; `iter` gigante congela a aba antes de qualquer `confirm()`; `openBytes` também não valida `b.length>=12` (`crypto.js:18`).
- Correção mínima: rejeitar `iter` fora de 100.000–2.000.000 e salt com tamanho ≠ 16 (`/^[0-9a-f]{32}$/`) nos dois pontos; quando divergir, usar o `ITER` do código; validar o comprimento mínimo do blob antes de fatiar o IV.
- Aceite: testes com manifest `iter:1`, `iter:10^11`, `salt:"zz"`, `salt:""` → rejeitados com erro específico e não `BAD_PASSWORD`; o backup legítimo gerado pelo próprio app continua restaurando.
- Risco: baixo para cofres atuais (todos em 600.000 — `3-seguranca.md:59`), mas rejeita backups de terceiros com parâmetros fora da faixa: registrar em doc. Esforço S.

#### S-04 · Erro de integridade reportado como "Senha incorreta" e contabilizado
- Contexto/evidência: `src/security/auth.js:28` tem `catch{}` que rotula qualquer falha de `openVault` como senha errada e `:29-30` incrementa `g.fails` e aplica atraso; a escrita do guard não tem tratamento (fail-open) — `3-seguranca.md:277-279` (C4).
- Impacto: banco truncado pelo iOS/Safari (`docs/README.md:9`) faz a senha correta virar "Senha incorreta." cinco vezes e depois espiral de atraso, sem diagnóstico; quem editar `meta/vault` nega acesso ao dono com uma escrita.
- Correção mínima: separar por tipo de erro — `OperationError` ⇒ senha incorreta (conta tentativa); `DataError`/`NotSupportedError`/falha de transação ⇒ mensagem própria **sem** incrementar `g.fails`; aguardar o `db.put` do guard.
- Aceite: testes com `meta/vault` corrompido (salt faltando, `wrapped` truncado, `iter` ausente) mostram mensagem de integridade e `fails` inalterado; senha errada real mantém contagem e backoff. · **Risco**: baixo. Esforço S.

#### S-05 · Falha de descriptografia em um registro derruba a leitura da store
- Contexto/evidência: `src/services/records.js:5` usa `Promise.all` sobre `dec`, então um registro ilegível rejeita a lista inteira; chamadores sem `try` em `src/ui/clientlist.js:32` e `src/ui/dashboard.js:10`; `fmt` repassa `e.message` cru (`src/main.js:8`); blob ausente gera `TypeError` em `records.js:9` — `3-seguranca.md:281-283` (C5).
- Impacto: bit-flip em 1 byte de 1 registro de 1.000 produz lista vazia sem explicação — em produto de controle financeiro, "sem dados" e "dados corrompidos" ficam indistinguíveis; a adulteração é detectada (bom), a resposta é indisponibilidade muda.
- Correção mínima: `Promise.allSettled` retornando `{rows, unreadable:n}`; tela exibe "N registros ilegíveis — verifique Configurações › Integridade" reaproveitando a sonda existente (`src/ui/settings.js:31-36`); mensagens internas nunca cruas; guardar `data` ilegível como item não editável em vez de descartar.
- Aceite: teste com 1 registro adulterado devolve os demais + contagem `unreadable=1` e a UI mostra o aviso; teste com blob ausente idem; nenhuma `DOMException` chega à tela.
- Risco: médio — toca o caminho de leitura de todas as telas; precisa de Q-03/Q-05 antes. Esforço M.

#### S-06 · Ausência de troca de senha e rotação da DEK
- Contexto/evidência: `grep` negativo por `changePassword`/`reencrypt`/`rewrap` em `src/`, `README.md`, `docs/`; `auth.js` só expõe `setup` (`:18`), `unlock` (`:24`), `lock` (`:65`); a arquitetura envelope (`crypto.js:6-16`) já permite rewrap barato — `3-seguranca.md:285-287` (C6).
- Impacto: senha suspeita de vazamento só se resolve apagando o cofre e reimportando backup; e se o piso do OWASP subir, cofres antigos ficam em 600.000 para sempre porque `iter` é gravado uma vez.
- Correção mínima: `changeVaultPassword(old,novo)` em `crypto.js` — desembrulhar com a KEK antiga, reembrulhar com a nova, regravar `meta/vault` com `salt`/`iv`/`iter` novos (nenhum registro é re-cifrado) — e item em Configurações › Segurança junto de "Bloquear agora".
- Aceite: teste de propriedade: antes/depois da troca, todos os registros permanecem decifráveis com a senha nova e `meta/vault` registra o novo `iter`; senha antiga deixa de abrir; cofre intacto se a troca for abortada no meio.
- Risco: alto — é o cofre; obrigatório backup prévio e teste em cofre real antes de publicar. Esforço L. **EXIGE AUTORIZAÇÃO (cofre)**.

#### S-07 · Retenção pós-bloqueio: blob URLs, caches de PII e token do Drive
- Contexto/evidência: `src/export/lib.js:5` revoga blob URLs após 60 s e `src/ui/clients.js:144-145` após 120 s, com dados já decifrados; os caches de consulta (`src/services/apicpf.js:3`, `src/services/viacep.js:4`) não são limpos em `onLock`; `lock()` não desconecta o Drive (`src/security/auth.js:65-69`) — `3-seguranca.md:293-295` (C8), `:119`, `:128`.
- Impacto: por até 2 minutos após baixar um comprovante o conteúdo decifrado continua alcançável por script da mesma origem/DevTools; o token de acesso sobrevive ao bloqueio na memória da aba.
- Correção mínima: revogar no `pagehide`/fechamento da janela em vez de temporizador, baixar o teto para ~5 s; assinar `onLock` para limpar os dois caches de consulta; chamar a revogação do Drive no `lock()`.
- Aceite: teste que, após `lock()`, nenhum `blob:` de documento continua em nó vivo e `isConnected()` do Drive é `false`; bloqueio durante download não vaza erro. · **Risco**: baixo, com atenção a downloads que ainda estão em curso. Esforço S.

#### S-08 · MIME e nome de arquivo aceitos sem verificação de conteúdo
- Contexto/evidência: `src/files/process.js:8` grava `type:file.type||'application/octet-stream'` (tipo declarado pelo cliente) com apenas regex de imagem em `:9`; o botão "Abrir" navega num `blob:` de mesma origem (`src/ui/clients.js:144`); `fname` usa `d.orig` cru quando o MIME não está na tabela (`clients.js:127`) — `3-seguranca.md:297-299` (C9), R11.
- Impacto: documento gravado ou restaurado de zip de terceiros com tipo/nome forjados produz download incoerente (`nota.html` sob MIME genérico) e navegação `blob:` para conteúdo controlado; PoC de execução não foi feita (`NÃO CONFIRMADO`).
- Correção mínima: verificar assinatura de bytes para PDF/PNG/JPEG/WebP em `process.js:8-9` e rejeitar/normalizar o `type`; forçar extensão coerente com o tipo verificado em `fname`.
- Aceite: testes: PNG com `type:'application/pdf'` rejeitado ou reclassificado; PDF real aceito; arquivo restaurado de backup com tipo forjado não oferece "Abrir" como PDF. · **Risco**: baixo, mas pode recusar arquivos hoje aceitos — documentar. Esforço S.

#### S-09 · CSP efetiva mora em meta tag; sem SRI no bundle
- Contexto/evidência: o header define só `frame-ancestors 'none'` (`vercel.json:54-57`) enquanto a CSP rica está em `<meta>` (`index.html:3`), verificado ao vivo; sem `Permissions-Policy`, `Cross-Origin-Resource-Policy` ou `Strict-Transport-Security` declarado no repo; nenhum SRI sobre `vendor/fflate.min.js` — `3-seguranca.md:289-291` (C7), `:161`, `:319` (P9).
- Impacto: onde a meta não existe (resposta da função, páginas de erro da plataforma, GitHub Pages) não há restrição de script; host ou repositório comprometido serve JS alterado e a CSP de `'self'` não ajuda.
- Correção mínima: espelhar a CSP no header de `vercel.json` (mantendo a meta como redundância), declarar HSTS, adicionar `Permissions-Policy` negando câmera/microfone/geolocalização, `Cross-Origin-Resource-Policy: same-origin`; SRI em `vendor/fflate.min.js` (ou import ES, ver P-05).
- Aceite: `curl -sSI` mostra o CSP completo no header; app continua funcionando em Vercel e GitHub Pages; teste de fumaça das 14 telas sem erro de CSP no console.
- Risco: médio — CSP errada quebra silenciosamente popup OAuth e GIS; testar em navegador. Esforço M.

### T2 — Integridade de dados e IndexedDB

#### D-01 · `saveDebt` aceita `clientId` inexistente (dívida órfã) — **FEITO EM CÓDIGO NESTA BRANCH**
- O que foi executado: guarda em `src/services/debts.js:20` — `if(!clientId||!(await getClient(clientId)))` lança `Error('Cliente não encontrado. Atualize a tela e tente de novo.')` com `code:'NO_CLIENT'`. `getClient` passou a ser importado em `src/services/debts.js:1`.
- **A ordem importa e foi mantida:** a checagem vem **depois** de `validate()` (`src/services/debts.js:15`), para que erro de campo continue voltando como `{errs}` e a UI pinte por campo; integridade referencial só é testada com payload já válido.
- Efeito colateral encontrado em teste e corrigido: dívida **órfã legada** (dado anterior à guarda) fazia `src/ui/debtspage.js:16` resolver o cliente como `undefined`, e o submit estourava `TypeError: … reading 'id'` cru no parágrafo de erro — a mensagem nova nunca apareceria. Hoje `src/ui/debts.js:27` passa `c?.id`, o `undefined` chega ao serviço e vira a mensagem legível. Nenhuma linha de CSS, rótulo de botão, ícone ou estrutura de tela foi tocada.
- Aceite cumprido (medido): `tests/svc/debts.test.mjs` com 23 casos (antes 17); teste de navegador contra a função serverless real — mensagem amigável, nenhum `TypeError`, store `debts` inalterada e **zero** linhas novas em `history`.
- Aceite **não** cumprido: o "script de diagnóstico que lista órfãos existentes" não foi escrito — virou parte de **D-13**. E a guarda cobre criação/edição de dívida, não o histórico órfão — **D-12**.
- Risco: baixo — só estreitou a escrita; telas que dependiam de lista obsoleta ganharam erro explícito. Esforço S. Sem `EXIGE AUTORIZAÇÃO`.

#### D-02 · Corrida de duplicidade de documento fora da transação
- Contexto/evidência: a unicidade é checada em `src/services/clients.js:11` usando `await listClients()` de `:17`, antes do `db.batch` de `:27`; nenhum índice `unique` (`src/db/idb.js:5`); duplicação reproduzida em runtime (`2-dados-negocio.md:163`, `:420`).
- Impacto: dois cadastros simultâneos com o mesmo CPF/CNPJ são gravados; o mesmo vale para `hash` de documento (`clients.js:40`). Como o merge do backup dedupe por documento (`backup.js:22`), a duplicidade passa a afetar restauração.
- Correção mínima: mover a checagem para dentro da transação de escrita (relê `clients` no escopo do `batch`) e/ou criar índice `unique` sobre um campo de índice em claro; tratar `ConstraintError` com mensagem própria — hoje os erros de transação são genéricos (`idb.js:21`, `:30`).
- Aceite: teste com duas chamadas concorrentes do mesmo documento produz exatamente 1 registro e 1 erro nomeado; idem para dois anexos do mesmo arquivo.
- Risco: alto — índice único é mudança de schema e exige migração (D-05) mais retrofit dos documentos já gravados. Esforço M. **EXIGE AUTORIZAÇÃO (schema)**.

#### D-03 · `deleteClient` lê em 4 transações e escreve numa quinta
- Contexto/evidência: `src/services/clients.js:32-35` — `getClient` + `listDocs` + `rel('debts')` + `rel('history')` antes do `batch`; órfão permanente reproduzido em runtime (`2-dados-negocio.md:164` caso B); a contagem do `confirm` vem de outra leitura (`:30`) e o retorno é `undefined` silencioso se o cliente não existe (`:32`).
- Impacto: dívida ou anexo gravado por outra aba entre a leitura e o batch sobrevive para sempre sem dono; o número exibido na confirmação pode ser diferente do excluído.
- Correção mínima: ler as quatro lojas dentro da mesma transação `readwrite` (o `batch` já suporta multi-store) e apagar por cursor/`getAll` daquela transação; retornar contagem real e usá-la na confirmação; deixar de silenciar "não havia nada a excluir".
- Aceite: teste de concorrência: escrita durante a exclusão termina ou apagada ou visível, nunca órfã; contagem do diálogo = registros apagados; exclusão de id inexistente devolve sinal.
- Risco: médio — toques em transação multi-store; exige fake IDB honesto (Q-03) antes. Esforço M.

#### D-04 · Índices criados e nunca usados; `history.at` nunca gravado
- Contexto/evidência: `src/db/idb.js:8` cria índice `at`, mas `hist()` grava `createdAt` (`src/services/records.js:10`) e a ordenação usa `createdAt` (`clients.js:37`) — 0 de 3 registros com `at` em runtime; zero ocorrências de `.index(`/`openCursor`/`IDBKeyRange` em `src/` (`2-dados-negocio.md:57-69`, `:421`).
- Impacto: índice morto ocupando espaço e escondendo regressões de schema; toda listagem decriptografa a store inteira (`records.js:5`), custo que cresce com a biblioteca de fotos.
- Correção mínima: escrever `at` em `hist()` (sem tocar no schema — o índice já existe) ou declarar o índice como intencional; documentar em `docs/DATABASE.md` que nenhuma consulta usa índices hoje; opcionalmente mover `clientId` de `rel()` para consulta por índice.
- Aceite: teste asserta que todo índice declarado no schema corresponde a campo realmente gravado (é o teste que faltou para `at` sobreviver); contagem de registros sem a chave do índice = 0. · **Risco**: baixo para gravar `at`; remover índice é mudança de schema e fica fora desta correção. Esforço S.

#### D-05 · Migrações sem guarda de idempotência e sem tratamento de downgrade
- Contexto/evidência: o loop `for(let v=e.oldVersion; v<MIGRATIONS.length; v++)` (`src/db/idb.js:14`) depende de `DB_VERSION === MIGRATIONS.length` (`:10`); nenhum `objectStoreNames.contains` antes de `createObjectStore` (`:3-8`); `VersionError` de banco mais novo cai em `r.onerror` cru (`:16`) e a UI só diz "Não foi possível abrir o banco local" (`src/main.js:63`) — `2-dados-negocio.md:65-74`, `:423`.
- Impacto: uma migração inserida no meio ou re-executada aborta o upgrade e inutiliza o banco sem rota de recuperação (restore também não tem teste — Q-04).
- Correção mínima: envolver cada `createObjectStore` em guarda `contains`; detectar `VersionError` e mostrar mensagem específica ("o banco é de versão mais nova; não abra com este build"); acrescentar teste que roda a cadeia de migrações 0→1→2 em cofre novo e existente.
- Aceite: teste de upgrade a partir de `oldVersion` 0 e 1; re-executar a mesma migração não lança; downgrade abre mensagem própria sem corromper dados.
- Risco: alto — é o caminho que pode quebrar cofres de usuários; obrigatório ter Q-03/Q-05 verdes e backup de teste antes. Esforço M. **EXIGE AUTORIZAÇÃO (schema)**.

#### D-06 · `validate()` do backup aceita dados que quebram a leitura
- Contexto/evidência: `src/export/backup-format.js:24` exige `clientId` existente e `principal>0`/`rate>0`, mas aceita dívida sem `date`/`due`, `principal` fracionário e `settings.dueWindow` não numérico; em leitura isso explode em `src/domain/due.js:2` (`TypeError`, derruba `stats()`), `src/domain/money.js:9` (`RangeError` com não inteiro) e ordenação não determinística em `src/services/debts.js:6` — `2-dados-negocio.md:199`, `:422`.
- Impacto: um zip de terceiros ou de versão antiga entra no cofre legítimo e derruba painel/lista na primeira leitura — indisponibilidade com dado já persistido.
- Correção mínima: endurecer `validate()`: `date`/`due` presentes, `iso()` válido e `due>=date`, `principal`/`rate` inteiros positivos, `dueWindow` inteiro 1–365, `type` ∈ `{PF,PJ}`, `category` ∈ `CATS`; dar entrada defensiva em `due.js`/`money.js` para registros já gravados.
- Aceite: testes negativos para cada campo acima (`INVALID` com mensagem específica) e testes de tolerância: registro já gravado com `due` ausente não derruba `stats()`, aparece marcado como ilegível (ligado a S-05).
- Risco: médio — pode recusar backups hoje aceitos: comunicar em doc e oferecer pré-visualização do erro. Esforço M. **EXIGE AUTORIZAÇÃO (formato de dados)**.

#### D-07 · Regras de validação morando na UI
- Contexto/evidência: `src/services/settings.js:3` grava `dueWindow` sem validar (o runtime aceitou `'abc'` e o status passou a errar); a faixa 1–365 só existe em `src/ui/settings.js:42-44`; `validCep` (`src/domain/address.js:4`) nunca é chamado pelo `validate()` de `src/services/clients.js:7-14`; a regex de e-mail mora no service (`:13`) e `type` não é validado contra `{PF,PJ}` — `2-dados-negocio.md:210`, `:230`, `:422`.
- Impacto: qualquer caminho que não seja a tela (restauração, futuras integrações, erro de UI) grava configuração que silencia regras de vencimento — o pior defeito num app de cobrança.
- Correção mínima: mover as regras para o domínio (`dueWindow`, CEP, tipo PF/PJ, categoria de documento) e chamá-las nos services; `getDueWindow()` normaliza/coage na leitura com default explícito.
- Aceite: testes unitários por regra; `setDueWindow('abc')` rejeita; cadastro com CEP `00000000` rejeita no service mesmo com a UI burlada.
- Risco: baixo/médio — pode passar a recusar dados que hoje passam; rodar diagnóstico antes. Esforço M.

#### D-08 · `address` gravado como texto composto junto dos campos brutos
- Contexto/evidência: a UI envia `address` já calculado por `composeAddress` (`src/ui/clients.js:45-46`) e o service não recompõe (`src/services/clients.js:16-27`) — `2-dados-negocio.md:240`.
- Impacto: editar rua/número sem reabrir o formulário deixa o texto de exibição defasado em relação aos campos, e relatórios/visualizações mostram endereço errado.
- Correção mínima: recompor `address` no `saveClient` a partir dos campos recebidos (fonte única), mantendo o campo gravado para compatibilidade de leitura.
- Aceite: teste: alterar `street` mantendo os demais atualiza `address` no registro gravado; leitura de registro antigo inalterada. · **Risco**: baixo. Esforço S.

#### D-09 · Formato do backup promete `MIGRATE` e não tem; `dbVersion` nunca é verificado
- Contexto/evidência: o comentário `src/export/backup-format.js:3` promete `MIGRATE[v](data) -> v+1`, inexistente no código; a gate aceita `formatVersion` fracionário (`:32`, `1.5` passa); `dbVersion` é gravado (`:15`) e nunca lido; `manifest.dbVersion=99` foi aceito em teste — `4-backup-exportacao.md:257-258` (R-03/R-04), `:270` (R-12).
- Impacto: o primeiro bump de `FORMAT` inutiliza a restauração de todos os backups existentes, e um backup de schema futuro entra no banco atual sem detecção. Nota de risco adicional: no backup sem senha o `sha256` está em claro dentro do mesmo zip, logo a garantia é anti-corrupção, não anti-adulteração (`R-06`).
- Correção mínima: implementar o mapa de migração e chamar antes de `validate`; trocar a gate por `formatVersion !== FORMAT` + migrador; comparar `dbVersion` com `DB_VERSION` local e exigir confirmação explícita em divergência.
- Aceite: testes com manifest `formatVersion` 0/1/2/1.5 e `dbVersion` 0/1/99; fixture de backup v1 restaura após a mudança; nada é escrito quando a versão é incompatível.
- Risco: alto — formato de backup é o único seguro do usuário contra iOS/limpeza; precisa de Q-04 antes e de validação manual em cofre real. Esforço M. **EXIGE AUTORIZAÇÃO (formato/schema)**.

#### D-10 · Rotas destrutivas sem backup prévio e com confirmação de texto simples
- Contexto/evidência: `restore('replace')` apaga `clients,debts,documents,history,blobs` numa transação (`src/export/backup.js:15`) precedido apenas de `confirm()` (`src/ui/tools.js:47,161`); não há lixeira, soft-delete, undo nem confirmação forte (grep negativo) e nenhum backup automático — `4-backup-exportacao.md:256` (R-02), `3-seguranca.md:251-254`, R9.
- Impacto: um clique com o aparelho destravado substitui o cofre inteiro por um zip antigo ou forjado, sem ponto de retorno; é também o cenário de ransomware/exclusão maliciosa dominante do relatório 3.
- Correção mínima: gerar `pre-restore-<timestamp>.zip` automaticamente e oferecer download antes de aplicar `replace`; exigir digitação do nome do cliente na exclusão (`src/ui/clients.js:42`) e "SUBSTITUIR" na restauração.
- Aceite: teste: restaurar sem cofre prévio gerado é impossível pelo fluxo da UI; arquivo prévio existe e é íntegro (round-trip via Q-04); exclusão cancelada não apaga nada.
- Risco: médio — é fluxo/UX: redação das confirmações precisa da aprovação do dono. Esforço M. **EXIGE AUTORIZAÇÃO (design)**.

#### D-11 · Exportação: teto de 26 colunas no XLSX e empacotamento síncrono
- Contexto/evidência: `src/export/xlsx.js:5` gera nome de coluna com `String.fromCharCode(65+i)`, inválido a partir da 27ª; a coluna "Data" mostra vencimento (`reports.js:17`) enquanto o filtro usa data de registro (`:10`) e o rodapé explicativo só existe no HTML (`src/ui/tools.js:20`); `zipSync`/`unzipSync` bloqueiam a thread — 14,3 MB em 1,08 s medido — sem progresso (`4-backup-exportacao.md:159`, `:163`, `:265`).
- Impacto: hoje não acionado (as duas abas têm 6 e 4 colunas), mas é teto estrutural para qualquer aba nova; em celular antigo o congelamento de ~1 s durante backup é perceptível (efeito em navegador: `NÃO CONFIRMADO`).
- Correção mínima: função de nome de coluna com suporte a múltiplas letras; explicitar "Data (vencimento)" no cabeçalho da aba; mover o empacotamento para `Worker` só se medi congelamento real em navegador (Q-09), mantendo o mesmo formato de arquivo.
- Aceite: teste gera 27+ colunas e as referências continuam válidas por regex; teste de regressão de formato: o zip gerado continua idêntico ao atual para o mesmo dataset (o `sha256` é do conteúdo, não do zip).
- Risco: baixo para as duas primeiras; worker é arriscado (muda `FILES`/SW) e só entra com medição. Esforço M.

### T3 — Confiabilidade do PWA e publicação

#### P-01 · Cache obsoleto: `V` não é bumpado junto do código
- Contexto/evidência: 4 commits alteraram arquivos pré-cacheados sem tocar `sw.js` — `ef4b96f`, `ff247af`, `922f584` (`src/config/google.js`) e `ba6227b` (`css/ui.css`, `src/ui/clients.js`); os outros 55 commits que tocaram `sw.js` bumparam `V` (`1-bootstrap-navegacao.md:162-198`, `:293`).
- Impacto: com cache-first puro (`sw.js:5`) e nomes de arquivo sem fingerprint, um app instalado serve o módulo/CSS velho indefinidamente; no caso concreto, `client_id` velho do Google continua instalado e a autenticação quebra silenciosamente (`6-integracoes-infra.md:573`).
- Correção mínima: script `scripts/check-sw.mjs` (~40 linhas, sem dependências) impondo: `V` no formato `^sc-v[0-9]+$`, cada item de `FILES` existe no disco, todo `src/**/*.js` referenciado está em `FILES`, e **se `FILES` mudou, `V` mudou**; rodar no job estático (Q-02).
- Aceite: o script falha quando se remove um `src/*.js` de `FILES` ou quando se edita arquivo cacheado sem bump; verde no estado atual (52/52 entradas existem, medido).
- Risco: baixo — checagem nova, nada em runtime. Esforço S.

#### P-02 · Estratégia de fetch: `addAll` tudo-ou-nada, sem escrita em runtime, fallback só em rejeição de rede
- Contexto/evidência: `sw.js:3` faz `c.addAll(FILES)` sem `.catch` (uma entrada 404 derruba a instalação em silêncio, o `waitUntil` rejeita e só sobra um `console.warn` em `src/pwa.js:3`); `sw.js:5` não faz `cache.put`; o fallback de navegação só dispara no `catch` do `fetch`, nunca em 4xx/5xx; a requisição do SW não tem timeout (`6-integracoes-infra.md:603` P-4) — `1-bootstrap-navegacao.md:297`, `:299`.
- Impacto: arquivo esquecido em `FILES` faz o app abrir e quebrar offline silenciosamente; 502 da plataforma devolve página de erro crua em vez da casca local; e a ausência de escrita em runtime é justamente o que impede PII de entrar em Cache Storage — comportamento a preservar.
- Correção mínima: pré-cachear por entrada com `Promise.allSettled` em vez de `addAll` atômico; `respondWith` com `catch` que também trata `!response.ok` em navegação; adicionar `AbortController` com teto na requisição; manter "sem `cache.put`" explícito em comentário-contrato para não virar cache de PII.
- Aceite: teste de serviço que remove uma entrada do disco e a instalação ainda assim conclui com as demais; smoke em navegador (Q-09): servir 500 e conferir que a casca local aparece; conferir que nenhuma resposta de `/api/cpf` ou `viacep` entra em cache.
- Risco: médio — mexer em SW afeta todos os aparelhos; exige smoke antes. Esforço M.

#### P-03 · `skipWaiting` + `clients.claim` trocam o cache sob uma aba viva, sem aviso
- Contexto/evidência: `sw.js:3-4`; nenhum listener de `message` no SW e nenhum aviso de "atualização disponível"; dois carregamentos tardios existem de fato (`vendor/fflate.min.js` por `src/export/lib.js:2-4` e o script do Google) — `1-bootstrap-navegacao.md:296`.
- Impacto: uma aba aberta durante o deploy passa a misturar módulos velhos em memória com assets novos do cache — estado inconsistente no meio de um cadastro com cofre destravado.
- Correção mínima: manter `skipWaiting`, mas emitir `message` do SW novo para os clientes e mostrar aviso discreto "Atualização disponível — recarregue" com botão que faz `location.reload()`; não aplicar troca automática.
- Aceite: smoke: deploy com aba aberta não troca módulos sem interação; clique no aviso recarrega e o `V` em uso bate com o do servidor.
- Risco: médio — é UI nova. Esforço M. **EXIGE AUTORIZAÇÃO (design)**.

#### P-04 · `db.put`/`db.del` não emitem `data-changed`
- Contexto/evidência: só `db.batch` emite (`src/db/idb.js:30`); `put`/`del` (`:24-25`) não, e o comentário de `src/core/live.js:1` declara a restrição; afetam `setDueWindow` (`src/services/settings.js:3`), `setIdle` e gravações de sessão (`src/security/auth.js:49`, `:55`) — `1-bootstrap-navegacao.md:298`, `2-dados-negocio.md:142`.
- Impacto: mudar a janela de vencimentos deixa a página de Dívidas com valor velho em memória até nova navegação; é armadilha para qualquer tela nova que espere atualização ao gravar individualmente.
- Correção mínima: emitir `data-changed` também em `put`/`del`, ou (menor risco) converter as duas escritas de configuração em `batch` de 1 op; documentar o contrato em `live.js`.
- Aceite: teste que conta despachos por operação; na tela: alterar janela com a página de Dívidas aberta atualiza o resumo. · **Risco**: médio para a primeira opção (todas as telas re-escutam; pode causar re-render extra); preferir a conversão para `batch`. Esforço S.

#### P-05 · `fflate` sem fallback e promise de "Biblioteca inválida" cacheada
- Contexto/evidência: `src/export/lib.js:2-4` injeta `<script>` com URL relativa ao documento e guarda a promise num cache; em `s.onload` sem global válido rejeita "Biblioteca inválida" **sem** descartar a promise do cache (só `onerror` descarta) — `4-backup-exportacao.md:208-211` (R-07, R-18).
- Impacto: uma resposta não-JS no caminho (fallback de rota, MIME barrado por `nosniff`, cache corrompido) deixa backup e Excel indisponíveis para toda a aba até recarregar, sem recuperação.
- Correção mínima: descartar `cache[g]` em todo caminho de rejeição; tentar um segundo candidato de URL (absoluta a partir de `import.meta.url`) antes de falhar; mensagem final distinguível em Configurações.
- Aceite: teste de unidade sobre `load()` com `onload` sem global: segunda chamada tenta de novo; smoke: backup funciona offline (arquivo está em `FILES`). · **Risco**: baixo. Esforço S.

#### P-06 · `docs/` servidos publicamente em produção
- Contexto/evidência: `vercel.json:61` usa `outputDirectory: "."`, então a raiz do repo é o documento raiz do site: `docs/auditoria-ui-ux-codigo.md`, `docs/google-drive.md` (com `client_id` legado, projeto GCP e e-mail de testador) e os 14 screenshots ficam acessíveis no mesmo domínio — `6-integracoes-infra.md:487`, `:589`.
- Impacto: mapa de infraestrutura e dado pessoal publicados; também amplia o valor do item I-05.
- Correção mínima: mover a documentação interna para fora da raiz servida ou criar `docs/` público apenas com o necessário (por exemplo servir de um subdiretório de build ou negar os caminhos via `vercel.json`); manter `README.md` público.
- Aceite: `curl -I https://…/docs/google-drive.md` retorna 404/401; os caminhos do app e `manifest.json` inalterados; o app continua instalável e offline. · **Risco**: médio — `outputDirectory` é o mecanismo do deploy sem build; validar em preview antes de promover. Esforço S.

#### P-07 · Flash do shell antes do gate de autenticação
- Contexto/evidência: `initShell` roda em `src/main.js:65` com `#app` vazio, `sync()` (`src/ui/shell.js:47-50`) infere "não é auth" pela ausência de `.auth`/`.brand` e revela `#nav` antes de `hasVault()`/`restoreSession()` resolverem (`src/main.js:63`) — `1-bootstrap-navegacao.md:60`, `:295`. Estado: `NÃO CONFIRMADO` visualmente.
- Impacto provável: barra de navegação piscando sobre a tela de desbloqueio — percepção de app já destravado numa tela de senha.
- Critério de confirmação antes de implementar: gravação de tela/frame-by-frame em navegador real (Q-09) mostrando `#nav` visível com sessão inexistente.
- Correção mínima (se confirmado): derivar o estado "bloqueado" de `A.isUnlocked()` em vez de presença de DOM, ou adiar `initShell` para depois do gate.
- Aceite: com cofre trancado, `#nav` permanece `hidden` até o desbloqueio, sem mudar o tempo de boot. · **Risco**: baixo. Esforço S.

### T4 — Acessibilidade e UI

#### A-01 · Anel de foco suprimido por especificidade em campos de texto
- Contexto/evidência: `css/app.css:36` usa `:where(...)` (especificidade 0,1,0) e `css/ui.css:97` declara `input:focus,select:focus,textarea:focus{…outline:none…}` (0,1,1) em arquivo posterior — o `outline:2px solid var(--gold)` nunca aparece em campos; sobra halo a 16 % de alfa sobre `#2c2925` — `5-ui-design.md:411`.
- Impacto: foco de teclado indistinguível de foco de mouse em todos os formulários; contradiz "foco visível" de `README.md:135` e `docs/README.md:41`.
- Correção mínima: trocar `:where(...)` por seletor explícito de mesma ou maior especificidade, ou remover o `outline:none` de `ui.css:97` mantendo o halo; manter o comportamento existente em checkbox (`ui.css:106`).
- Aceite: teste de navegador: `Tab` até `#doc` produz outline visível com contraste ≥3:1 contra a superfície; nenhum estado de foco muda em repouso.
- Risco: baixo tecnicamente, mas é mudança visual declarada. Esforço S. **EXIGE AUTORIZAÇÃO (design)**.

#### A-02 · Erro de campo sem ligação programática e campos obrigatórios sem marcação
- Contexto/evidência: `<small class="error">` não tem `id` (`src/ui/clients.js:27`, `src/ui/debts.js:21`), os inputs não têm `aria-describedby`/`aria-invalid` (grep: zero ocorrências no repo) e `novalidate:true` (`clients.js:44`) desliga a checagem nativa sem que `required` seja definido — só `main.js:9` usa `required` — `5-ui-design.md:412-413`.
- Impacto: leitor de tela que foca o campo inválido não recebe a mensagem; obrigatoriedade não é anunciada nem indicada.
- Correção mínima: dar `id` ao `<small>` e referenciá-lo por `aria-describedby` no input; alternar `aria-invalid` ao escrever/limpar a mensagem; marcar `required`/`aria-required` nos campos que o service trata como obrigatórios (`name`, `doc`, `description`, `principal`, `rate`, `date`, `due`).
- Aceite: teste com `fake-h` asserta os atributos por campo e a troca de estado quando `fe[id].textContent` muda; nada muda no layout.
- Risco: baixo — invisível por construção. Esforço M.

#### A-03 · Região viva do `pager` recriada a cada pintura
- Contexto/evidência: `src/ui/kit.js:21` constrói um novo `statusEl` em cada chamada e os chamadores fazem `pg.replaceChildren(pager(...))` (`clientlist.js:20`, `debtspage.js:23`, `clients.js:153`) — `5-ui-design.md:414`. Inferido (não confirmado): anúncio "Mostrando 21–40 de 63" provavelmente não ocorre porque o próprio nó muda.
- Impacto: o principal feedback de paginação fica silencioso para tecnologia assistiva, nas três listas do app.
- Critério de confirmação: teste de navegador com NVDA/VoiceOver ou inspeção da árvore de acessibilidade antes/depois de virar página (Q-09).
- Correção mínima: manter o nó `status` estável e atualizar apenas `textContent` (o mesmo padrão dos nós persistentes corretos: `clients.js:20`, `debtspage.js:7`).
- Aceite: teste asserta identidade do nó entre pinturas; smoke confirmam o anúncio. · **Risco**: baixo. Esforço S.

#### A-04 · Colisão de media query em exatamente 560 px
- Contexto/evidência: `@media(max-width:560px)` (`css/ui.css:130`, `:281`, `:364`) e `@media(min-width:560px)` (`:84`, `:181`) são ambos verdadeiros em `width:560px`; em 560 o `.file-pick` recebe `min-height:156px` e a grade do tablet ao mesmo tempo — `5-ui-design.md:475`.
- Impacto: layout indefinido numa largura real de aparelhos; os pares complementares corretos já existem no mesmo arquivo (719/720), o que indica descuido de convenção.
- Correção mínima: mover os `max-width:560px` para `max-width:559.98px` (ou os `min-width` para `min-width:561px`), padronizando em um único breakpoint por componente.
- Aceite: teste de CSS que enumera as `@media` e asserta que nenhum valor aparece nas duas pontas; smoke em 560 px com screenshot de referência.
- Risco: mudança visual em uma largura. Esforço S. **EXIGE AUTORIZAÇÃO (design)**.

#### A-05 · Contraste abaixo do AA
- Contexto/evidência: `--gold-deep` `#8f7748` sobre `--surface-3` = 3,47:1 (`.doc-ico`, `css/ui.css:373`) e sobre `--surface-2` = 3,88:1 (`.event .ev-ico`, `:403`); `.report-hint` `#8c8477` sobre `#f7f3ea` = 3,34:1 (`css/app.css:48`) — pior caso de texto real do app; `--faint` sobre `--surface-2` exatamente 4,50:1 em placeholders (`5-ui-design.md:400-407`).
- Impacto: texto de instrução do relatório ilegível em ambiente claro/luminação alta; glifos informativos de documento/evento abaixo de 3:1.
- Correção mínima: escurecer/aligeiro apenas esses usos (`--gold-deep` → valor que alcance 4,5:1 sobre a própria superfície; `.report-hint` → `#34302a` ou `--muted` invertido no papel); nenhum token de identidade é tocado.
- Aceite: teste programático de contraste (mesmo cálculo da auditoria) acima de 4,5:1 para texto e 3:1 para glifos informativos; diff visual confirmado em screenshot.
- Risco: é paleta da marca. Esforço S. **EXIGE AUTORIZAÇÃO (design)**.

#### A-06 · Destaque do menu quebrado em `new-client`, `edit-client`, `edit-debt`
- Contexto/evidência: `src/ui/shell.js:53` ancora as regexs no início de `data-page` (`/^client/`, `/^debt/`), mas os valores reais são `new-client`/`edit-client` (`clients.js:124`) e `edit-debt` (`debts.js:40`); o mapper devolve a própria chave e o loop remove `aria-current` de todos — `1-bootstrap-navegacao.md:294`.
- Impacto: em três das 14 telas o menu perde o item ativo — desorientação visual e ausência de anúncio em leitor de tela.
- Correção mínima: normalizar o prefixo antes do mapa (`page.replace(/^(new|edit)-/,'')`) ou usar `/client/`/`/debt/` sem âncora, mantendo `bulk → clients`.
- Aceite: teste de unidade sobre o mapper com as 14 chaves conhecidas devolvendo o `data-k` esperado; smoke: `aria-current="page"` presente em Novo cliente. · **Risco**: baixo. Esforço S.

#### A-07 · Código morto verificado
- Contexto/evidência: tokens sem uso `--line`, `--bronze`, `--r-md`, `--r-sm` (0 ocorrências de `var(--…)`, conferido por grep; a cor reaparece literal em `app.css:45,53`); classes sem uso `.btn-block` (`ui.css:79`), `.window-form` (`:158`), `.avatar--xl` (`:252`), `.row .chev` (`:247`, nunca casa porque o chevron é `svg.i`); bloco inteiro de `input[type=file]` (`ui.css:114-117`, invisível porque `filePicker` esconde o input); parâmetro `...a` de `top()` (`clients.js:9-11`) sem uso; export `day()` (`kit.js:5`) sem importador; ícones `mail`/`calendar`/`filter` inalcançáveis (`icons.js:27,36,39`) — `5-ui-design.md:485-489`, `:465`, `:469`.
- Impacto: superfície de manutenção e falsos contratos visuais (ex.: chevron de linha sem a cor pretendida).
- Correção mínima: remover o que é removível sem tocar identidade; para `.row .chev`, decidir com o dono entre a regra ou o `color` herdado; adicionar checagem de tokens/classes mortos ao job estático (Q-02) para não voltar.
- Aceite: grep zero para cada item removido; diff visual vazio em screenshots das 14 telas (exceto o chevron, se aprovado). · **Risco**: baixo desde que verificado por grep antes de cada remoção. Esforço M.

#### A-08 · Duplicações de fábrica de UI
- Contexto/evidência: `top()` em 3 cópias (`clients.js:9`, `settings.js:12`, `tools.js:3`), `fld()`/`field()` em 5 assinaturas incompatíveis (`clients.js:27`, `debts.js:21`, `tools.js:5`, `clientlist.js:22`, `main.js:9`), `row()` em 2 (`clients.js:141`, `settings.js:26`), `run()` em 2 com efeitos diferentes (`clients.js:137`, `tools.js:13`), `dBR` reescrito 4 vezes (`debts.js:3`, `debtspage.js:4`, `tools.js:2`, `export/reports.js:3`) — e a cópia de `debtspage.js:4` **lança** em `undefined` enquanto as outras devolvem `'—'` — `5-ui-design.md:465-470`.
- Impacto: cada campo novo exige descobrir qual variante está em jogo; divergência silenciosa de comportamento no mesmo app.
- Correção mínima: consolidar primeiro o trivial e de risco zero (`dBR` → `day()` já exportado em `kit.js:5`, unificando a regra de vazio) e `row()`; deixar `fld()`/`top()`/`run()` para um passo separado, com testes de pintura por tela (fake `h`).
- Aceite: teste por variante consolidada; diff de HTML serializado antes/depois por tela (mesmo markup).
- Risco: médio (tocar 6 arquivos de UI); por isso o corte em duas etapas. Esforço L.

#### A-09 · `watch` é slot único e re-renderiza por baixo do formulário aberto
- Contexto/evidência: `src/core/live.js:2` guarda um só callback; `debtspage.js:37` registra `load()` e o form de dívida (`debts.js:40`) não o dessregistra — uma gravação enquanto o form está aberto dispara a pintura da página por baixo. Estado: `NÃO CONFIRMADO` (`5-ui-design.md:493`).
- Impacto: perda de digitação/re-render inesperado no formulário de dívida (e padrão frágil para telas novas).
- Critério de confirmação: smoke em navegador gravando a sequência "abrir form de dívida → gravar em outra origem de `data-changed`" e observar se o form é substituído.
- Correção mínima (se confirmado): `watch` returning disposer e/ou dessregistro na entrada do formulário, seguindo o padrão de `clean()` em `clients.js:3-4`.
- Aceite: teste de unidade com dois inscritos; smoke confirma que o form permanece intacto após `data-changed`.
- Risco: médio. Esforço M.

#### A-10 · Ícone escolhido pelo texto do botão e `icon()` silencioso
- Contexto/evidência: `shell.js:5-9` faz `MAP` de regexs sobre `textContent` (`:59`) para escolher ícone e aplicar `.danger`; `icons.js:47` cai em `P.info` para nome desconhecido sem erro; hoje 18 padrões cobertos — rótulo novo fica sem ícone — `1-bootstrap-navegacao.md:118`, `5-ui-design.md:494-495`.
- Impacto: renomear um botão troca silenciosamente o ícone ou remove o estilo destrutivo; um typo de ícone imprime "ℹ" na interface.
- Correção mínima: fazer `icon()` falhar (ou logar erro) em nome inexistente em builds de teste; migrar gradualmente para `data-icon` explícito nos botões, mantendo `MAP` como fallback para não alterar a aparência.
- Aceite: teste: `icon('nao-existe')` lança/loga; smoke com todos os botões das 14 telas comparando ícone/render antes e depois da migração (diff vazio).
- Risco: médio — é visual se a migração falhar. Esforço M. **EXIGE AUTORIZAÇÃO (design)**.

### T5 — Testes e infraestrutura

#### Q-01 · `tests/apicpf.test.mjs:15` faz egress real e o 503 vem da razão errada
- Contexto/evidência: `process.env.APICPF_API_KEY = undefined` coage para a string `"undefined"` (truthy), então a guarda `api/cpf.js:20` não dispara e o handler chama `fetch` real em `api/cpf.js:25` — provado por spy: 1 tentativa contra `https://apicpf.com/api/consulta?cpf=11144477735`; é o motivo do arquivo custar 1.385–5.821 ms — `7-testes-infra.md:282-318` (D1, crítico).
- Impacto: a guarda "sem chave" tem 0 % de cobertura; o teste depende de ausência de internet, pode enviar CPF a terceiro em CI com egress e registrar a URL em log de falha.
- Correção mínima: `delete process.env.APICPF_API_KEY` em vez de atribuir `undefined`, instalar o stub de `globalThis.fetch` **antes** do primeiro caso e asserir que ele **não** foi chamado nesse cenário.
- Aceite: rodar com `HTTPS_PROXY`/sem egress e com egress livre dá o mesmo resultado; tempo do arquivo cai para a faixa dos testes puros (~50 ms); asserção explícita "fetch não chamado".
- Risco: nenhum (só teste). Esforço S. **Pré-requisito de Q-02/Q-08.**

#### Q-02 · Sem `npm test`, sem CI e sem checagem estática; job `estatico` proposto
- Contexto/evidência: `package.json:1` é `{"type":"module","private":true}` (sem `scripts`, sem `engines`); nenhum `.github/`, nenhum `*.yml` no repo; `node --check` passa em 47/47 arquivos e `FILES` está 52/52 íntegro **hoje**, mas nada garante isso — `7-testes-infra.md:711-726`, `:998-1011`.
- Impacto: push não verifica nada; a checagem do SW (P-01) e a do runner (DOC-02) não têm onde rodar.
- Correção mínima: adicionar `scripts` (`test`, `test:unit`, `test:coverage`, `check:syntax`, `check:sw`) e o workflow `.github/workflows/test.yml` com os dois jobs (`estatico` → `testes`) e `permissions: contents: read`, exatamente na forma de `7-testes-infra.md:728-876`, incluindo `set -euo pipefail` e o `grep '^# fail 0$'`.
- Aceite: PR de teste vermelho bloqueia merge; remover `V` após editar `FILES` quebra o job; prova de que falha não vira aprovação (caso sintaxe quebrada).
- Risco: baixo, mas CI novo pode expor verde-falso antigo — por isso Q-01 primeiro. Esforço M.

#### Q-03 · Helpers de teste: fake IndexedDB, globals, fixtures e fetch-mock (com meta-teste)
- Contexto/evidência: nenhum teste cria `indexedDB`, `document`, `sessionStorage`, `caches`; a superfície de IDB realmente usada são 13 métodos/props, sem cursores/`IDBKeyRange`/`.index()`; `structuredClone(CryptoKey)` funciona em Node 22; `mock.timers` existe; recomenda-se escrever o fake (~120–150 linhas) em vez de instalar `fake-indexeddb` — `7-testes-infra.md:322-337`, `:478-492`, `:625-644`.
- Impacto: sem harness, cofre, transações, cascade e restore ficam impossíveis de testar; sem fetch-mock, o caso D1 se repete.
- Correção mínima: criar `tests/helpers/{fake-idb,globals,fixtures,fetch-mock,timers,assert-no-net,vault}.mjs` cumprindo o contrato de 8 pontos de `7-testes-infra.md:636-644`, incluindo expor `dispatchEvent`/`Event` globais (sem isso `idb.js:30` nunca dispara) e um `fake-idb.test.mjs` que testa o próprio fake.
- Aceite: meta-teste verde (abort reverte, `oncomplete` só depois de todos os requests, migrações em cascata); comentário explícito no fake sobre o que **não** simula (`durability:'strict'`); nenhum teste faz rede.
- Risco: médio — harness errado produz testes que não testam; daí o meta-teste obrigatório. Esforço L. **Pré-requisito de Q-04/Q-05/D-02/D-03/D-05.**

#### Q-04 · Testes de `createBackup`/`restore` (merge, replace, reamarração, tudo-ou-nada)
- Contexto/evidência: `src/export/backup.js` (30 linhas) nunca é importado por teste algum, e `restore('replace')` apaga as 5 stores em `backup.js:15`; `4-backup-exportacao.md:255` classifica como ALTO; lacunas detalhadas em `:232-236`.
- Impacto: a função mais destrutiva do app está sem nenhuma asserção; um regresso aqui perde os dados do usuário sem volta (ver D-10).
- Correção mínima: `tests/svc/backup-restore.test.mjs` cobrindo: round-trip byte-a-byte de todos os blobs; replace preserva senha do cofre e apaga órfãos; merge dedupe por `id` **ou** CPF/CNPJ e reamarra `clientId`; documento pulado por `clientId+hash`; contagens devolvidas por modo; abort no meio não escreve nada; `settings.dueWindow` só no replace (R-11); backups de escala (N clientes/dívidas/anexos) e vazio.
- Aceite: casos acima como `it()` nomeados; teste de golden-file do formato v1 (o arquivo de hoje restaura sempre); suíte roda com TZ fixado.
- Risco: nenhum em produção (só teste), mas é o que libera D-06/D-09/D-10. Esforço L.

#### Q-05 · Testes de cofre e de transações: lockout, auto-lock, `restoreSession`, `batch` multi-store
- Contexto/evidência: `src/security/auth.js:26-32` (backoff exponencial com teto de 300 s), `:38-48` (reassunção por `sid`), `:50-56` (reescrita periódica) e `src/db/idb.js:27-30` não têm teste; `restoreSession` retorna `false` silencioso sem stub de `sessionStorage` — armadilha documentada (`7-testes-infra.md:466-474`, `:535-541`).
- Impacto: a máquina de estados de segurança (a defesa primária do produto) é exercitada só por leitura de código.
- Correção mínima: `tests/svc/auth-lockout.test.mjs`, `auth-idle.test.mjs`, `idb-tx.test.mjs` usando `mock.timers` + fake IDB + fake `document`, com asserção de que o stub de `sessionStorage` está ativo em cada teste de sessão.
- Aceite: sequência de falhas produz a tabela 5 s/10 s/…/300 s; sucesso zera contador; `visibilitychange` reagenda; `batch` com uma op inválida não persiste nada; `batch([])` não emite evento.
- Risco: baixo/médio (harness). Esforço L. **Pré-requisito de S-01/S-04/D-05.**

#### Q-06 · Testes de regras de negócio e de integrações do cliente
- Contexto/evidência: `validate()` de dívidas (`debts.js:7-13`) e clientes (`clients.js:7-14`) são puros e sem teste; `dueWindow` não numérico, `interest` com `principal` fracionário (`RangeError`), `cents('1.000')=1500`-ou-`150000`, soma de arredondados (`dashboard.js:4`), `viacep.js` (6 códigos) e `src/services/apicpf.js` (TTL 30 min, `PENDING`, timeout 9 s) estão descobertos; `TZ` nunca é fixado — `2-dados-negocio.md:324-343`, `7-testes-infra.md:217-221`, `:928-936`.
- Impacto: dinheiro e vencimento — o núcleo do produto — sem rede; e a sensibilidade a fuso é a classe clássica de bug "vencimento de ontem".
- Correção mínima: testes unitários puros (validadores de negócio, `money` com negativos e `cents('abc')`, propriedades de arredondamento com RNG de `node:crypto`), `due.test.mjs`/`search.test.mjs` separados rodando com `TZ` fixado, e `viacep.test.mjs`/`apicpf-client.test.mjs` com `fetch-mock` + `navigator.onLine`.
- Aceite: cada regra das tabelas de `2-dados-negocio.md:§4.1-§4.3` com pelo menos um caso positivo e um negativo; a matriz de CI com dois fusos fica verde.
- Risco: nenhum. Esforço M.

#### Q-07 · Normalizar os 7 scripts legados para `node:test` `describe`/`it`
- Contexto/evidência: nenhum arquivo usa `describe`/`it`/`test` — o veredicto é "o processo morreu em 0?", `# tests 7` nunca muda e um assert quebrado na linha 2 esconde os 21 restantes (`money.test.mjs` tem 23); `stage4.test.mjs` é nome ininteligível; o loader UMD da fflate vive dentro de `backup.test.mjs:2`; `crypto.test.mjs:8` referencia o global `crypto` nu; `apicpf.test.mjs` não testa o módulo homônimo `src/services/apicpf.js` — `7-testes-infra.md:105-117`, `:943-976`.
- Impacto: a suíte não comunica *o que* quebrou e incentiva passo-vazio.
- Correção mínima: migrar arquivo a arquivo (mantendo verde) para `tests/unit/`, um `describe` por módulo, um `it` por propriedade; renomear `stage4` → `due`/`search`; mover o loader para `helpers/fflate.mjs`; renomear `apicpf.test.mjs` → `api-cpf.test.mjs`; travar `meta.iter===ITER`, `kdf`, `cipher`, `v` no teste de cripto (D6) e asserir os bytes do XLSX em vez de gravar `/tmp/amostra.xlsx` (D7), incluindo `esc()` com o fixture `'Manoel Junior <&>'`.
- Aceite: `# tests` reflete casos (~180 esperados); remover um `export` de `money.js` quebra teste específico; `node --test --experimental-test-coverage` reporta `src/domain/*` ≥95 %. · **Risco**: baixo. Esforço M.

#### Q-08 · Gate de cobertura progressivo
- Contexto/evidência: **21 dos 37 módulos `src/`** não são alcançados por teste algum, somando **1.291 de 1.624 linhas = 79,5 %** sem teste; somando "sem teste" + "indireto sem asserção", 28 de 39 módulos (72 %) não têm nenhuma asserção; a flag nativa de cobertura funciona e mediu `money.js` em 100 % de linha (`7-testes-infra.md:394-406`).
- Impacto: a sensação de suíte verde não acompanha o risco real, que se concentra justamente em `src/ui/*` (833 linhas) e nos services.
- Correção mínima: `scripts/coverage-gate.mjs` (~35 linhas, sem dependências) começando por falhar se `src/domain/*.js` ou `src/security/crypto.js` cair abaixo de 95 % de linha, com lista de permissão por módulo que só cresce (progressivo, sem congelar desenvolvimento).
- Aceite: número agregado publicado como artefato do CI; reduzir cobertura de `domain/` quebra o build; subir o piso a cada onda. · **Risco**: nenhum. Esforço S.

#### Q-09 · Smoke em navegador real — IndexedDB nativo, service worker, OAuth e Excel
- Contexto/evidência: itens que só significam em navegador: `durability:'strict'` e commit em disco, ativação de SW com `skipWaiting`/`clients.claim`, `caches.*` (`sw.js:3-5`), conversão de imagem em `src/files/process.js:11-14` (`createImageBitmap` não existe em Node), abrir o XLSX em Excel/LibreOffice e o popup OAuth (`7-testes-infra.md:533-551`, `:561`). No sandbox há Playwright-python 1.64.1 + `/usr/bin/chromium`, mas **nada fixa isso no repo** (sem `requirements.txt`/lockfile).
- Impacto: sem camada (c), os itens P-02, P-03, P-05, P-07, A-03, A-09, S-01, D-11 e S-09 não têm como serem confirmados — vários estão marcados `NÃO CONFIRMADO` exatamente por isso.
- Correção mínima: roteiro de smoke fora do gate (`continue-on-error`), servindo a raiz com `python3 -m http.server` como em `7-testes-infra.md:861-875`: instalar o app, verificar `V`/cache, forçar deploy novo, conferir `#nav` antes do desbloqueio (P-07), rodar cadastro com foto (conversão real) e abrir o XLSX gerado.
- Aceite: relatório HTML/PNG arquivado por execução; falha de navegador não bloqueia merge; checklist dos itens `NÃO CONFIRMADO` deste roadmap encerrado (cada um vira confirmado ou descartado).
- Risco: flakiness; e introduz ferramenta de teste nova. Esforço L. **EXIGE AUTORIZAÇÃO (dependência de teste).**

### T6 — Integrações e privacidade

#### I-01 · CPF na query string nas duas pernas
- Contexto/evidência: `src/services/apicpf.js:24` envia `?cpf=` e `api/cpf.js:15-16` lê `searchParams` e repete `?cpf=` para o provedor (`api/cpf.js:25`); query strings são o principal conteúdo de logs de plataforma; `docs/apicpf.md:36` alega que nada é registrado, o que só vale para o código — `6-integracoes-infra.md:586` (C-3), `3-seguranca.md:312` (P2).
- Impacto: documento pessoal de terceiro pode ficar retido em logs de borda, fora do controle do app.
- Correção mínima: mover para `POST` com corpo JSON nas duas pernas (mesmo PR de S-02), mantendo o contrato `{ok,data}` do cliente e atualizando `docs/apicpf.md`.
- Aceite: teste de unidade asserta ausência de `cpf` na URL; grep nenhum `?cpf=` em `src/`/`api/`; cadastro continua funcionando online e offline (silêncio atual preservado).
- Risco: médio — muda contrato interno; testar junto com Q-01/Q-06. Esforço M.

#### I-02 · Drive sem refresh token
- Contexto/evidência: `src/services/google-drive.js:100-103` só lê `access_token`/`expires_in` e `:130` exige reconexão manual quando vence; `:19` zera o estado; doc assume o limite (`docs/google-drive.md:141`) — `6-integracoes-infra.md:588` (C-5).
- Impacto: restauração longa ou sessão após ~1 h exige novo popup/consentimento; backup recorrente fica impraticável.
- Correção mínima (opções, decidir com o dono): (a) pedir `access_type=offline` + refresh guardado cifrado em `meta` (novo registro, sem nova store) com renovação silenciosa; ou (b) manter o desenho atual e documentar o limite no card do Drive. Preferida: (b) como padrão e (a) só com autorização, porque persistir credencial é mudança de modelo de segurança.
- Aceite: se (a): teste de renovação com `expires_in` pequeno e ausência do token em claro no dump do banco; se (b): texto na UI e doc alinhados.
- Risco: alto se (a). Esforço M. **EXIGE AUTORIZAÇÃO (cofre/credencial).**

#### I-03 · Upload multipart sem cap de tamanho
- Contexto/evidência: `src/services/google-drive.js:181-196` só rejeita lista vazia; o único cap existente é de documento (15 MB, `src/files/process.js:4,6`); limite real do multipart do Drive não foi confirmado (`6-integracoes-infra.md:332-333`, `:604` P-5).
- Impacto: backup grande falha no meio do envio com mensagem genérica, depois de gastar a coleta inteira.
- Correção mínima: medir `bytes.byteLength` antes de enviar e avisar acima de um limite configurado (valor a confirmar contra a API antes de fixar); se acima do limite, sugerir backup local.
- Aceite: teste de unidade com blob acima do cap (nenhuma chamada de rede); mensagem específica. · **Risco**: baixo. Esforço S.

#### I-04 · Import do JSON do Google Cloud é inalcançável
- Contexto/evidência: a doc promete o fluxo (`docs/google-drive.md:16`, `:38`), mas o bloco está atrás de `if(!st.configured)` (`src/ui/tools.js:76-93`) e `configured` é sempre `true` porque o default vem de `src/config/google.js:5-9` (`src/services/google-drive.js:22`, `:26`); "Trocar configuração" só limpa o override (`:48`) — `6-integracoes-infra.md:344` (D1/C-4).
- Impacto: trocar `client_id` (localhost, novo domínio) exige editar código ou `localStorage` na mão; o aviso de "cliente importado diferente" (`tools.js:70-74`) também é inalcançável.
- Correção mínima: oferecer "Usar outro cliente Google" sempre visível (o bloco de import é existente, só inacessível) e/ou condicionar `configured` a `localStorage` vazio; manter o default hardcoded para não quebrar o app publicado.
- Aceite: smoke: em `localhost`, o import fica alcançável e o override passa a valer; "Trocar configuração" volta ao default com aviso; doc passa a ser executável.
- Risco: médio — abre caminho para configuração substituível por quem tem o aparelho destravado (risco já registrado em `3-seguranca.md:130`): manter o aviso de divergência. Esforço M. **EXIGE AUTORIZAÇÃO (design).**

#### I-05 · Sobre-divulgação: 2 `client_id`, IDs de projeto GCP e e-mail pessoal
- Contexto/evidência: `src/config/google.js:5` (`clientId` ativo) e `:8` (`projectId`), `docs/google-drive.md:93` (mesmo cliente), `:121` (cliente legado `662732522717-…`), `:104` (e-mail de testador) — nenhum segredo, mas mapa de infraestrutura e dado pessoal num repo público (`6-integracoes-infra.md:456-457`, `:471` C-6).
- Impacto: facilita phishing na tela de consentimento (o golpista conhece o nome do projeto) e expõe endereço pessoal de terceiro.
- Correção mínima: remover o cliente legado e o e-mail das docs (referenciar "o projeto atual" sem valores literais); manter o `clientId` em uso, que é público por natureza no token flow.
- Aceite: grep zero pelo `client_id` legado e pelo e-mail no working tree; doc continua descrevendo o procedimento corretamente.
- Risco: histórico do git mantém os valores — a limpeza de histórico é decisão do dono (fora do escopo deste item, que é de conteúdo atual). Esforço M. **EXIGE AUTORIZAÇÃO (dono — inclui ações fora do repo).**

#### I-06 · `fflate` 0.8.2 com upstream em 0.8.3
- Contexto/evidência: identidade byte a byte com o tarball `fflate-0.8.2` (md5 `aaea4e81…`, 32.665 B) confirma a versão; `dist-tags.latest` é 0.8.3 com "Fix buffer over-read for Zip64 extra fields" e "Improve Zip64 support" — `4-backup-exportacao.md:9-21`, `:264` (R-08).
- Impacto: `unzipSync` sobre zip adversário é justamente o cenário do fix; probabilidade baixa, mas é leitura de arquivo de terceiros.
- Correção mínima: substituir `vendor/fflate.min.js` pelo `umd/index.js` de 0.8.3, atualizar `vendor/LICENSES.md:2` e `docs/README.md:15`, **incrementar `V` em `sw.js:2`** e registrar o md5 novo.
- Aceite: `cmp` com o tarball oficial idêntico; os testes de backup/redondo passam sem mudança de formato (nivel 0/6 preservados); checagem de `FILES`/`V` (P-01) verde.
- Risco: médio — é a única dependência de runtime e produz o backup. Esforço S. **EXIGE AUTORIZAÇÃO (dependência).**

#### I-07 · Backup invisível fora do `client_id` e pasta homônima adotada
- Contexto/evidência: `listBackups()` filtra por `appProperties.app` (`src/services/google-drive.js:162`, `:171`) e `downloadBackup()` exige `appProperties.sha256` hex-64 (`:208-210`); o escopo `drive.file` dá visibilidade por cliente, não por conta; `folder()` pega `files[0]` de uma busca por nome sem `appProperties` (`:149-151`) — `6-integracoes-infra.md:594` (C-11), `4-backup-exportacao.md:274` (R-16).
- Impacto: se o `client_id` muda ou o arquivo é copiado, o backup real da vítima fica **invisível e irrecuperável pelo app**, sem caminho alternativo na UI; e uma pasta criada pelo usuário com o mesmo nome passa a receber os envios.
- Correção mínima: filtrar a busca de pasta por `appProperties.app` também; na listagem, oferecer "arquivos não reconhecidos" com download pelo Drive e restauração por arquivo local (rota existente).
- Aceite: smoke: arquivo copiado manualmente na pasta aparece como "não reconhecido, baixe pelo Drive"; teste de unidade sobre a query; pasta homônima do usuário não é adotada.
- Risco: médio. Esforço M. **EXIGE AUTORIZAÇÃO (design).**

#### I-08 · Falha de configuração indistinguível de offline
- Contexto/evidência: `api/cpf.js:20` (sem env) e `:41-44` (401/402/403/429/timeout) viram o mesmo 503; `src/services/apicpf.js:41` mapeia tudo em `UNAVAILABLE` e `src/ui/clients.js:90-94` simplesmente apaga o status — `6-integracoes-infra.md:592` (C-9).
- Impacto: se a env não estiver na Vercel (ou só em Production), a validação de CPF morre silenciosamente em produção e o suporte não tem sinal.
- Correção mínima: distinguir `reason:'CONFIG'` na função (sem revelar detalhes do provedor) e expor um diagnóstico em Configurações › Integridade ("consulta de CPF indisponível neste ambiente"), preservando o silêncio na tela de cadastro.
- Aceite: teste de unidade com env ausente → 503/`CONFIG`; diagnóstico visível quando a função responde `CONFIG`, invisível quando offline. · **Risco**: baixo. Esforço S.

#### I-09 · Sem opt-out nem aviso visível do envio do CPF a terceiro
- Contexto/evidência: o CPF e o retorno (nome, gênero, nascimento) saem do aparelho para `apicpf.com` via proxy (`6-integracoes-infra.md:157`, `:166-169`); não há chave de configuração para desligar a consulta (nenhuma em `src/services/settings.js`) e a informação só existe em `docs/apicpf.md:34`.
- Impacto: dado pessoal de terceiro processado por fornecedor externo sem controle nem aviso ao operador do app — leitura LGPD desconfortável e contradição prática com "100% offline" (ver DOC-07).
- Correção mínima: preferência "Consultar CPF em serviços externos" (padrão ligado para não mudar o comportamento atual) em Configurações, respeitada em `clients.js:78`; uma linha de explicação no próprio campo.
- Aceite: com a preferência desligada, nenhuma requisição a `/api/cpf` (asserido por `fetch` mock); preferência persistida em `settings` e sem efeito em outros fluxos.
- Risco: baixo; é feature nova — confirmar com o dono a redação. Esforço S. **EXIGE AUTORIZAÇÃO (design).**

### T7 — Documentação e governança

#### DOC-01 · Breakpoint da navegação documentado errado
- Contexto/evidência: `docs/README.md:28` afirma barra inferior até 719 px e rail de 96 px de 720 a 1099 px; o código usa `@media(min-width:768px)` (`css/ui.css:500`) e oculta `.util` a partir de 768 px (`:514`), com o cabeçalho do próprio arquivo dizendo "< 768" (`:3`) — `1-bootstrap-navegacao.md:300`, `5-ui-design.md:476`.
- Impacto: na faixa 720–767 px a doc e o app divergem, e quem ajusta layout parte de uma premissa falsa.
- Correção mínima: reescrever a linha 28 com 768/1100 e registrar a origem da confusão (`max-width:719px` de `ui.css:300`/`:341` são de outros componentes).
- Aceite: as três faixas da doc batem com os `@media` extraídos programaticamente; nada no código muda. · **Risco**: nenhum. Esforço S.

#### DOC-02 · README documenta runner que engole falha e um smoke test que não existe
- Contexto/evidência: `README.md:293` (e `docs/README.md:22`) prescrevem `for t in … ; do node tests/$t.test.mjs; done` — o exit code de um `for` é o do último comando, então falha em `money` com `apicpf` verde retorna 0 (`7-testes-infra.md:911-917` D2); `README.md:296` promete "smoke test de ponta a ponta cobrindo clientes, documentos, dívidas, juros em lote, Excel, backup, bloqueio e desbloqueio" — não há arquivo, script, pasta `e2e/` ou `smoke/`, e nenhum dos itens citados tem teste (`:921-925` D3).
- Impacto: o único "como testar" publicado trata falha como aprovação e a cobertura reportada a stakeholders é maior que a real.
- Correção mínima: apontar para `npm test` (Q-02) e reescrever o parágrafo 296 com o que existe de fato, marcando o smoke como planejado (Q-09) em vez de existente.
- Aceite: quebrar um assert e o comando do README retornar != 0; grep nenhum texto alegando smoke sem que `tests/smoke/` exista.
- Risco: nenhum. Esforço S. **Depende de Q-01 para o comando ser confiável.**

#### DOC-03 · Doc atribui ao Vercel o que a meta tag entrega
- Contexto/evidência: `docs/auditoria-ui-ux-codigo.md:14` registra a correção como "`X-Frame-Options: DENY` e `frame-ancestors 'none'` **no Vercel**" e "CSP com `object-src 'none'`", mas `object-src` só existe em `index.html:3` e o header tem apenas `frame-ancestors` (`vercel.json:54-57`) — `3-seguranca.md:199`, `:289-291`.
- Impacto: quem endurecer CSP a partir da doc pode mover a política inteira para o meta e perder `frame-ancestors`, ou confiar num `script-src` que o header não tem.
- Correção mínima: reescrever a linha separando canais (meta: `default-src`/`script-src`/`object-src`; header: `frame-ancestors` e por que só ele pode ir no header), e atualizar após S-09.
- Aceite: cada diretiva citada na doc existe no canal indicado, verificado por script de diff entre doc e `vercel.json`/`index.html`. · **Risco**: nenhum. Esforço S.

#### DOC-04 · `LICENSE`: verificação feita, sem ação por conta própria
- Contexto/evidência: não existe arquivo `LICENSE` na raiz (verificado por listagem; as únicas licenças versionadas são `assets/fonts/OFL-*.txt` e `vendor/LICENSES.md`) e `package.json` não tem campo `license`. Mas a ausência **já é decisão documentada**: `README.md:309-311` diz "Este é um projeto pessoal. Não há licença de código aberto definida neste repositório".
- Impacto: nenhum funcional; o risco seria adicionar uma licença sem o dono querer (licenciamento é ato jurídico).
- Correção mínima: nenhuma por padrão. Se o dono decidir por uma licença, adicionar `LICENSE` + campo `license` e revisitar `README.md:311`; caso contrário, manter como está e considerar um `SECURITY.md` de canal de contato.
- Aceite: decisão registrada aqui ou arquivo presente coerente com o README — nunca os dois em conflito.
- Risco: nenhum. Esforço S. **Sem `EXIGE AUTORIZAÇÃO` porque a ação recomendada é não agir.**

#### DOC-05 · Sem `CHANGELOG` antes desta branch
- Contexto/evidência: não há `CHANGELOG*`/`HISTORY*` no repositório (verificado por listagem da raiz e de `docs/`), e o controle de atualização hoje é a constante `V` de `sw.js:2`, que salta (`sc-v18`, `v29`, `v41`, `v52` nunca existiram) e até regride (`87bedb0` voltou de `sc-v34` para `sc-v33`) — `1-bootstrap-navegacao.md:164-182`.
- Impacto: impossível saber qual conteúdo serviu em qual versão publicada; diagnóstico de "usuário preso em versão velha" (P-01) fica sem referência.
- Correção mínima: criar `CHANGELOG.md` com `V` ↔ data ↔ resumo a partir de agora, e declarar `V` como versão canônica do app (a UI já mostra `DB_VERSION` em `src/ui/settings.js:50`).
- Aceite: entradas contíguas de `V`, sem lacunas novas; o guard de P-01 recusa `V` repetido. · **Risco**: nenhum. Esforço S.

#### DOC-06 · Node: README pede 18+, a suíte é validada em 22
- Contexto/evidência: `README.md:210` declara "Node.js 18+ apenas para executar os testes"; o ambiente validado é `v22.23.4`, e `structuredClone(CryptoKey)` (necessário para testes de sessão) é "duvidoso" em Node 18; `package.json` não tem `engines` — `7-testes-infra.md:983-984` (D14).
- Impacto: colaborador em Node 18/20 roda uma suíte que depende de `mock.timers`/`structuredClone` e não sabe por que falha.
- Correção mínima: fixar `"engines": {"node":">=20"}` (ou 22, conforme o que os testes de Q-03/Q-05 exigirem) e alinhar README + CI.
- Aceite: `npm test` com warning de engines fora da faixa; CI roda na versão declarada; doc coerente. · **Risco**: nenhum. Esforço S.

#### DOC-07 · Alegações de risco e de offline que o código não sustenta
- Contexto/evidência: o rodapé de login afirma "nada sai do aparelho" (`src/main.js:33`) enquanto CPF sai para a APICPF online (`api/cpf.js:25`); `manifest.json:1` e `index.html:5` dizem "100% offline" havendo 5 destinos externos; a tela de bloqueio diz "Aguarde N s" como se houvesse proteção efetiva contra força bruta (`src/security/auth.js:27`) — `3-seguranca.md:375` (R14), `6-integracoes-infra.md:441`, `:611` (P-12).
- Impacto: expectativa errada do usuário sobre a principal ameaça (dispositivo compartilhado / cota / proveniência de dados), e risco de leitura de compliance.
- Correção mínima: ajustes de redação apenas — "proteção local contra tentativas repetidas", "funciona offline; consulta de CPF e CEP exigem internet" — sem tocar layout.
- Aceite: nenhuma frase do app ou do manifest atribui proteção que o código não implementa; diff de texto revisado pelo dono. · **Risco**: nenhum técnico; é comunicação de produto. Esforço S.

---

## 4. Não fazer / fora de escopo

Cada recusa abaixo está ligada a uma trava explícita do cliente/documentada no repo, não a preferência do roadmap.

| Recusa | Justificativa e trava |
|---|---|
| Migrar para framework (React/Vue/Svelte) | O repo declara a stack e "Build — Nenhum — site estático" (`README.md:148-160`) e a CSP não permite compilador em runtime (`index.html:3`). O custo de re-render é absorvido por reconstrução de subtree sobre datasets paginados de 20/10/5 itens (`5-ui-design.md:42-49`). Trocar de framework reescreveria as 14 telas e todo o contrato `h()`/`ctx()`. |
| Adotar TypeScript | Exige etapa de build, que o projeto declara não ter (`README.md:159`), e a premissa "sem dependências externas" também vale para testes (`README.md:157`). Nenhum achado das auditorias depende de tipos; os riscos de dado foram tratados em D-01..D-07. |
| Adicionar bundler (Vite/esbuild) | O hash de arquivo é a mitigação natural do problema P-01, mas o serviço é um conjunto de ESM commitado e pré-cacheado por nome (`sw.js:2`); empacotar mudaria `FILES`, `manifest.json`, CSP e o mecanismo de deploy duplo (Vercel + GitHub Pages, `6-integracoes-infra.md:508-517`). Preferido: guard de `V` sem build (P-01). |
| Trocar o IndexedDB (SQLite/idb/OPFS/`fake-indexeddb`) | O motor é a única dependência de persistência e está coberto por 13 métodos/props, sem cursores nem `IDBKeyRange` (`7-testes-infra.md:478-492`). Biblioteca de terceiros no bundle violaria a trava de dependência única (`vendor/` só tem fflate). O fake próprio (~140 linhas) mantém o harness auditável. |
| Reescrever a UI | A identidade visual é contrato documentado: sem bordas/hierarquia por espaçamento (`docs/README.md:40`), chapéu inteiro sem recorte/contorno (`docs/README.md:39`), ordem fixa do perfil (`docs/README.md:30`), form em dois blocos, paginação 20/10/5 (`docs/README.md:34`). Os defeitos reais de UI deste roadmap são pontuais (A-01..A-10) e resolvíveis em <20 linhas cada. |
| Trocar a `fflate` por outra lib de ZIP | Além da trava de dependência, a ExcelJS já foi descartada por usar `new Function` contra a CSP sem `unsafe-eval` (`vendor/LICENSES.md:3`); os 4 símbolos usados (`zipSync`, `unzipSync`, `strToU8`, `strFromU8`) são o mínimo do contrato (`4-backup-exportacao.md:193-206`). O que cabe é atualizar 0.8.2 → 0.8.3 (I-06). |
| Normalizar senha com NFKC/NFC no KDF | Muda a chave derivada e **torna cofres existentes inacessíveis** (`3-seguranca.md:369`); qualquer política de senha entra por S-06 (rewrap) e por medidor de entropia, sem tocar derivação. |
| Bumpar `FORMAT` do backup agora | Sem `MIGRATE` implementado (D-09), o bump inutiliza a restauração de todos os backups existentes (`4-backup-exportacao.md:245`). Ordem: D-09 → depois bump. |
| Lock imediato ao trocar de aba como padrão | Mitigação válida, mas muda comportamento diário do produto; entra só como opção desligada por padrão (`3-seguranca.md:374`, R13) e fora deste roadmap até decisão do dono. |
| Adicionar lixeira/soft-delete | Modelo atual não tem campo de estado em dívida nem flag de remoção em cliente (`src/services/debts.js:4`, `dashboard.js:2` "não há quitação no escopo"); é feature nova, não correção. A mitigação disponível é D-10 (backup prévio + confirmação forte). |
| "Melhorar experiência" sem achado | Itens de desejo sem evidência não entram. Exemplos explicitamente não listados porque não há evidência nos relatórios: tema claro, notificações, multiusuário, parcelas de dívida, campo `type` em dívida, sincronização em tempo real. |

---

## 5. Dependências entre itens

**Trava geral: nenhum item de cofre/schema/formato entra antes da sua rede de teste.**

| Precisa vir antes | Porque | Libera |
|---|---|---|
| Q-01 (corrigir D1) | Sem isso o CI fica dependente de egress, lento, e "verde" cobrindo a guarda errada — inclusive mandando CPF a terceiro a cada build (`7-testes-infra.md:724-726`). | Q-02, Q-08, S-02, I-01 |
| Q-02 (`scripts` + job estático) | O guard de `V`/`FILES` e o gate de cobertura não têm onde rodar; hoje não existe forma canônica de rodar a suíte. | P-01, A-07, DOC-02, DOC-06, Q-07, Q-08 |
| Q-03 (helpers + meta-teste) | Sem fake IDB honesto (`oncomplete`, abort reverte) qualquer teste de transação seria teatro; sem `assert-no-net` o padrão D1 se repete. | Q-04, Q-05, Q-06, D-02, D-03, D-05, S-01, S-05 |
| Q-04 (testes de `restore`) | `restore('replace')` é a rota que apaga as 5 stores; mexer em backup/formato sem teste é mexer no único seguro do usuário. | D-06, D-09, D-10, I-06 |
| Q-05 (testes de cofre/transações) | S-01 e S-04 alteram a máquina de estados de sessão/lockout; D-05 altera upgrade de schema. | S-01, S-04, D-05, S-06 |
| Teste de regressão de migração antes de mexer em `MIGRATIONS` | O loop depende de nunca editar migração antiga (`idb.js:1`); hoje nada verifica os 7 stores/6 índices. | D-05, D-02 |
| D-05 (guardas de migração) antes de D-02 (índice `unique`) | Criar índice único sem upgrade protegido aborta o `open()` em aparelhos existentes. | D-02 |
| D-06 antes de D-09 | Endurecer `validate()` é compatível; mudar formato/migradores é outra classe de risco e precisa das asserções anteriores. | D-09 |
| S-03 antes de S-06 | O rewrap é o veículo de upgrade de `iter`; clampar primeiro evita regravar cofre com parâmetro rebaixado. | S-06 |
| P-01 antes de I-06 e antes de qualquer troca em `src/config/google.js` | Bump de dependência/config sem guard de `V` reproduz exatamente o cache obsoleto já concretizado nos 4 commits. | I-06, S-09 |
| I-04 antes de I-05 | Trocar/rotacionar `client_id` sem o import de JSON acessível é procedure inexecutável (doc D1). | I-05 |
| Q-09 antes de P-02, P-03, P-07, A-03, A-09 | Todos os cinco têm premissa `NÃO CONFIRMADO` que só navegador real encerra. | esses itens |
| A-07 antes de A-08/A-10 | Remover o que está morto reduz a superfície a consolidar; o mapper de ícones precisa do inventário limpo antes de virar `data-icon`. | A-08, A-10 |

---

## 6. Ordem de execução sugerida (4 ondas)

Escala de esforço: `S` ≈ 1,5 h · `M` ≈ 4 h · `L` ≈ 8 h (pontos médios; os custos de T1 são os de `3-seguranca.md:356-375`).

**Onda 1 — Portas abertas de baixo risco, sem tocar cofre (14 itens · ~18–26 h)**
`Q-01`, `S-03`, `S-04`, `D-04`, `A-06`, `A-03`, `P-04`, `I-03`, `I-08`, `S-07`, `DOC-01`, `DOC-03`, `DOC-06`, `DOC-04`.
Critério de saída: suíte confiável e offline (nenhum egress em teste), nenhum cofre atual afetado, doc de breakpoint/canal de CSP corrigida.

**Onda 2 — Guardrails de CI, exposição e integridade não destrutiva (18 itens · ~45–62 h)**
`Q-02`, `P-01`, `I-06`, `Q-07`, `Q-08`, `Q-03`, `D-01`, `D-08`, `D-07`, `S-02`, `S-08`, `P-05`, `P-06`, `A-01`, `A-02`, `A-07`, `I-04`, `DOC-02`.
Critério de saída: `V`/`FILES` protegidos por CI, `/api/cpf` fechado com CPF fora da URL, foco/ARIA de erro funcionando, docs de teste refletindo a realidade.

**Onda 3 — Cofre, schema e rotas destrutivas (19 itens · ~70–100 h)**
`Q-04`, `Q-05`, `Q-06`, `S-01`, `S-05`, `S-06`, `D-05`, `D-02`, `D-03`, `D-06`, `D-09`, `D-10`, `P-02`, `P-03`, `P-07`, `A-04`, `A-05`, `A-09`, `A-08`.
Critério de saída: DEK não recuperável por dump isolado, troca de senha disponível, restore e migrações cobertos por teste antes de qualquer mudança de formato; confirmação das mudanças visuais (A-01/A-04/A-05/P-03) aprovada pelo dono.

**Onda 4 — Integrações, navegador e governança (11 itens · ~30–45 h)**
`S-09`, `I-01`, `I-02`, `I-05`, `I-07`, `I-09`, `Q-09`, `D-11`, `A-10`, `DOC-05`, `DOC-07`.
Nota: `Q-09` (smoke em navegador) está listado aqui por ser o mais caro, mas **as correções que dependem dele (P-02, P-03, P-07, A-03, A-09) só fecham depois dele** — se o dono quiser confirmar antes os itens `NÃO CONFIRMADO`, adiantar `Q-09` para o fim da Onda 2.

Total: 62 itens, ~163–233 h de implementação, distribuídos em 4 ondas; 19 deles só podem ser implementados com autorização explícita do dono.

---

## 7. Como usar este roadmap

1. Antes de implementar, re-verificar as linhas citadas: `e78d776` é a referência e o repo muda `sw.js`/`V` com frequência.
2. Um item por PR, com os critérios de aceite copiados na descrição e verificados por teste ou por script — nunca por inspeção visual apenas.
3. Itens `NÃO CONFIRMADO` (P-07, A-03, A-09, e o efeito de navegador em D-11) exigem o critério de confirmação da própria entrada antes de qualquer mudança.
4. Itens marcados `EXIGE AUTORIZAÇÃO` não começam sem confirmação do dono; se a resposta for "não", mover o item para a seção 4 com a justificativa registrada.
