# SCIPIONE CRED — Auditoria READ-ONLY · Camada de UI, sistema de design e acessibilidade

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


**Escopo:** `src/ui/*`, `css/app.css`, `css/ui.css`, `index.html` (+ `src/main.js` lido apenas como fonte do primitivo `h()` e dos hooks de navegação).
**Estado do repositório:** branch `main`, HEAD `e78d776` ("Use the upload glyph and center icon with label in the photo picker"). Nenhum arquivo foi modificado.
**Método:** leitura integral dos arquivos + verificação programática (contagem de ícones, extração de `@media`, uso de tokens/classes, cálculo de contraste WCAG a partir dos valores hex dos tokens). Nada foi executado em navegador: afirmações sobre **comportamento** de tecnologia assistiva estão marcadas como *inferido* ou `NÃO CONFIRMADO`.
**Convenção:** toda afirmação carrega `arquivo:linha`. `NÃO CONFIRMADO` = não verificável neste ambiente.

---

## 1. Padrão de renderização

### 1.1 O primitivo `h(...)`

`h` é uma **única função, escrita em uma linha em `src/main.js:5`** (reformatada abaixo para leitura; o original é denso). Não existe outra implementação em `src/ui/` — todos os módulos recebem a mesma por injeção:

```js
const h=(t,a={},...k)=>{
  const e=document.createElement(t);
  for(const[n,v]of Object.entries(a)){
    if(n.startsWith('on')) e.addEventListener(n.slice(2),v);
    else if(v!==false&&v!=null) e.setAttribute(n, v===true?'':v);
  }
  e.append(...k.flat().filter(x=>x!=null&&x!==false));
  return e;
};
```

Assinatura: **`h(tag, attrs = {}, ...children)`** — `children` é *rest*, aceitando nós, strings, números, arrays e `null`/`false`.

Regras observáveis, com evidência:

| Preocupação | Comportamento | Evidência / uso |
|---|---|---|
| `class` | vai por `setAttribute('class', v)`. Não há DSL de classes, nem `clsx`, nem condicionais embutidas — a montagem é por concatenação de string. | `clients.js:27` `class:'field'+(full?' field--full':'')+(span2?' field--span2':'')`; `kit.js:33` `'pager-btn'+(n===page?' is-current':'')` |
| `for` | também vai por `setAttribute('for', …)`. Como o alvo é `<label>`, o atributo HTML `for` é o nome correto — funciona sem mapeamento para `htmlFor`. | `clients.js:53` `h('label',{for:'photo'},…)`; `kit.js:11` `h('label',{class:'file-pick',for:input.id},…)` |
| `id` | `setAttribute('id', …)`. | `clientlist.js:23` `h('input',{id:'cq',…})` |
| Eventos | qualquer chave que **comece com `on`** vira `addEventListener(n.slice(2), v)`. Isto é **case-sensitive**: `onclick`→`click`, mas `onClick`→`Click` (nunca dispara). Todas as 71 ocorrências no código usam minúsculas (`onclick` 55, `onchange` 9, `oninput` 3, `onsubmit` 4) — não há uso de `onClick`. | `clients.js:44` `onsubmit:async e=>{…}`; `clientlist.js:23` `oninput:e=>{…}` |
| Booleanos | `true` → atributo vazio (`setAttribute(n,'')`); **`false`/`null`/`undefined` → atributo omitido**. É o mecanismo usado para `hidden`, `disabled`, `checked`, `selected`, `novalidate`, `readonly`, `required`, `aria-current`. | `kit.js:33` `'aria-current':n===page?'page':false`; `clients.js:44` `novalidate:true`; `clients.js:32` `selected:!c.gender` |
| texto / números | `Element.append` converte primitivos em nós de texto. Arrays são achatados com `.flat()` (**profundidade 1**) e depois filtrados removendo `null` e `false`. Consequência: `0` e `''` **são** mantidos; `true` viraria o texto "true"; arrays de arrays não são achatados. | `debtspage.js:14` `sum.replaceChildren(\`${…}\`, h('span',…), ' · juros no mês ', h('span',…))` (mistura string + nó) |
| Injeção de HTML | inexistente: não há `innerHTML`/`insertAdjacentHTML` em nenhum `src/ui/*.js`. Toda construção é por `createElement`. Reduz superfície de XSS e é compatível com a CSP restritiva de `index.html:3` (sem `unsafe-eval`). | verificado por grep em `src/` |

### 1.2 Por que não há framework

Evidência direta no próprio repositório:

- **Stack declarado:** "HTML5, CSS3 e JavaScript (ES Modules)"; **"Build | Nenhum — site estático"** (`README.md:148-160`).
- `package.json` tem 1 dependência declarada de teste e nenhum framework (`package.json`, 33 bytes). `vendor/` contém apenas `fflate.min.js` (zip), usado por backup/relatório — não por UI.
- A CSP (`index.html:3`) não permite compilador em runtime; um framework com template string/JSX exigiria build step, que o projeto declara não ter.
- O custo de re-render é absorvido por reconstrução de subtrees (1.3) sobre datasets pequenos e já paginados (20/10/5 itens por página — `clientlist.js:3`, `debtspage.js:4`, `clients.js:146`). **Não há** virtualização, keying, diff ou reconciliação em lugar algum.

### 1.3 Convenções de re-render

Existem **três mecanismos distintos**, e eles não são a mesma coisa:

**(a) Substituição de tela inteira** — `show(...n) => root.replaceChildren(...n)` (`main.js:6`), onde `root` é `#app` (`main.js:4`). Toda troca de tela apaga a árvore inteira. Não existe router, URL, hash ou histórico (`NÃO CONFIRMADO` para o agente de navegação: aqui, confirma-se que `src/ui/` não toca em `history`/`location.hash`).

**(b) Reconstrução de subtree local (`paint`)** — a tela monta "casulos" vazios uma vez e os recria por filtro/ordenação/paginação, sem tocar no resto:
- `clientlist.js:5` cria `out=h('div')`, `pg=h('div')`; `paint()` faz `out.replaceChildren(...)` (`clientlist.js:15`) e `pg.replaceChildren(...)` (`clientlist.js:20`). O estado é um objeto mutável de closure `st={q,sort,rate,page}` (`clientlist.js:5`) e cada `oninput` chama `st.page=1; paint()` (`clientlist.js:23-25`).
- `debtspage.js:7` idem (`out`, `pg`, `sum`), `paint()` em `debtspage.js:9-24`, estado `st={sort,status,rate,client,page}`.
- `clients.js:147-158` `paintHistory()` com `histOut` + `histPage={page:1}`.
- `dashboard.js:8-36` `draw()` reconstrói o `box` inteiro (`box.replaceChildren(...parts.filter(Boolean))`, `dashboard.js:35`).

**(c) Re-render reativo por dados (`watch`)** — `src/core/live.js` mantém **um único callback**; `IndexedDB.transaction.oncomplete` dispara `new Event('data-changed')` (`src/db/idb.js:30`), que invoca esse callback (`live.js:2`). Convenção: a tela que entra chama `unwatch()` se não for reativa (`settings.js:16`, `tools.js:7`, `tools.js:32`, `main.js:12`, `main.js:46`) ou `watch(load)` se for (`clientlist.js:32`, `debtspage.js:37`, `dashboard.js:37`). Como é um slot único, telas aninhadas **sobrescrevem** o observador uma da outra — ver §10.

**(d) Reconciliador idempotente por MutationObserver (shell)** — `shell.js:63` observa `#app` com `{childList,subtree:true}` e roda `sync()` em `requestAnimationFrame` (`shell.js:63`). `sync()` é feita para ser chamada muitas vezes e **marcar o que já foi processado** em vez de reconstruir: `data-i` para ícones (`shell.js:57`), presença de `.util` (`shell.js:39`). Isso é o mais próximo de um "framework" que existe, e é puramente aditivo — o comentário de `shell.js:3` declara "NÃO altera nenhuma regra: apenas observa a tela renderizada".

### 1.4 O padrão `form()` / `fld()` / `media-field`

**`fld(id, …)`** é uma fábrica de campo: cria `<div class="field">` + `<label for=id>` + controle + `<small class="error">`, e **registra o `<small>` num dicionário de erros da closure**. Existem **5 variantes incompatíveis** entre si (ver §10):

- `clients.js:27` — `fld(id,label,type='text',ac,full=false,span2=false)`; adiciona `id:'f-'+id` ao invólucro e `autocomplete`. É a única que gera wrapper `#f-*`.
- `debts.js:21` — `fld(id,label,a,full)`; o terceiro argumento é um **objeto de attrs** espalhado no input (`h('input',{id,...a})`). Também popula `fe`.
- `tools.js:5` — `fld(h,id,l,el,full)`; recebe `h` e um **elemento já pronto**, sem slot de erro.
- `clientlist.js:22` — `fld(id,l,el)`; idem, sem erro.
- `main.js:9` — `field(id,label,ac)`; fixa `type:'password'` e `required:true`, sem erro de campo (só para o cofre).

**Contrato de formulário (`clients.js:17` / `debts.js:19`)** — sempre a mesma coreografia:
1. `const err=h('p',{class:'error',role:'alert'}),fe={}` (`clients.js:18`, `debts.js:20`).
2. `const btn=h('button',{class:'primary',type:'submit'}, …)` (`clients.js:43`, `debts.js:22`).
3. `h('form',{class:'card',novalidate:true,onsubmit:…})` (`clients.js:44`, `debts.js:23`) — **`novalidate` sempre ligado**: a validação nativa HTML está desativada de propósito; quem valida é o serviço (ver §6).
4. Corpo: `h('h2',…)` + campos em `div.form-grid` + `err` solto + `div.form-actions` com submit / Cancelar / (Excluir).
5. Depois de montado, o form é **incrementalmente enriquecido** por listeners imperativos sobre `f.elements.<nome>`: máscaras, debounce, autocomplete de endereço (`clients.js:96-123`, `debts.js:38-39`). Isto é possível porque `f.elements` resolve por `name` **ou** `id` — e os campos têm `id` (`clients.js:27`).
6. Render final: `U.render(U.top(...), f)` (`debts.js:40`) ou `render(top(...), f)` (`clients.js:124`).

**`media-field`** é o único layout de componente composto do form de cliente (`clients.js:52-56`, CSS em `ui.css:160-186`). Geometria declarada em grid com áreas nomeadas:

```
grid-template-areas: "preview pick" "actions actions"     /* ui.css:168 */
```

- `--photo-size` = diâmetro da prévia circular **e** altura mínima da caixa de upload (`ui.css:165`, `ui.css:171`, `ui.css:175`) — é o mecanismo que mantém os dois alinhados ("topo e base coincidem", comentário `ui.css:160-163`).
- `--photo-ratio:1.2` define a largura da caixa de upload no celular (`ui.css:166`); a partir de 560 px a caixa passa a ocupar `minmax(0,1fr)` — "largura máxima restante" (`ui.css:181-184`); a partir de 1000 px o diâmetro cresce (`ui.css:185-186`).
- Pré-requisito estrutural: `.media-field > .avatar` (prévia) e `.media-field .media-body` (contendo o `.file-pick`) — logo **o `filePicker` precisa estar dentro de `div.media-body`**, como em `clients.js:55`. É o único uso de `media-field` no app.

---

## 2. Componentes de UI reutilizáveis

**Contagem: 21 componentes/fábricas em JavaScript — 11 compartilhados entre arquivos + 10 locais (vários deles duplicados).** Além deles, ~26 componentes são **apenas CSS** (classes reutilizadas entre telas), listados em 2.3.

### 2.1 Compartilhados (exportados, usados por ≥2 arquivos)

| # | Componente | Definição | Assinatura | Quem usa |
|---|---|---|---|---|
| 1 | `h` (primitivo) | `main.js:5` | `h(tag, attrs, ...children)` | injetado via `ctx()` (`main.js:7`); `clients.js:2` o proxy via `X.h`; todos os arquivos de `src/ui/` |
| 2 | `icon` | `icons.js:43` | `icon(nome, tamanho=20) → SVGSVGElement` | `kit.js:2`, `shell.js:4`, `clientlist.js:1`, `clients.js:1`, `debts.js:1`, `debtspage.js:2`, `dashboard.js:1`, `settings.js:7`, `tools.js:1` |
| 3 | `initials` | `kit.js:3` | `initials(nome) → 'AB'` \| `'?'` | `avatar.js:4,14`; `clients.js:1,138` |
| 4 | `when` | `kit.js:4` | timestamp → `dd/mm/aaaa hh:mm` pt-BR | `clients.js:152,181`; `dashboard.js:20,24`; `tools.js:166,176` |
| 5 | `day` | `kit.js:5` | timestamp → `dd/mm/aaaa` | **nenhum** importador — ver §10 (export morto; `src/export/reports.js:3` redefine o próprio `dBR`) |
| 6 | `longDay` | `kit.js:6` | `Date` → "segunda-feira, 5 de maio" | `main.js:3,49` (hero do painel) |
| 7 | `plural` | `kit.js:7` | `plural(n, singular, plural) → "n item(ns)"` | `dashboard.js:13,27`; `debtspage.js:14,23`; `clients.js:153` |
| 8 | `filePicker` | `kit.js:8-16` | `filePicker(h, input, text='Escolher arquivo', glyph='upload') → HTMLLabelElement` | `clients.js:55` (foto, `accept:'image/*'`), `clients.js:176` (documento), `tools.js:88` (JSON OAuth), `tools.js:206` (ZIP) |
| 9 | `pager` | `kit.js:18-39` | `pager(h, {page,pages,total,from,to,singular,plural,label,onPage})` | `clientlist.js:20` (20/pág.), `clients.js:153` (5/pág.), `debtspage.js:23` (10/pág.) |
| 10 | `clientAvatar` | `avatar.js:13-29` | `clientAvatar(h, cliente) → span.avatar` | `clientlist.js:16`; `dashboard.js:19` |
| 11 | `initShell` | `shell.js:10-64` | `initShell({ctx,home,clients,debts,reports,backup,settings,lock})` | `main.js:65` (único ponto de montagem da navegação) |

`clearClientPhotos` (`avatar.js:7-11`) é o ciclo de vida do #10, não um componente visual; é registrado em `A.onLock` (`avatar.js:12`).

**Detalhes de contrato:**
- `filePicker` (**kit.js:8-16**) muta o input recebido: adiciona `.file-input` (`kit.js:9`), cria `<span class="file-name">`, e devolve um `<label class="file-pick" for=input.id>` envolvendo o input + ícone + nome (`kit.js:11-12`). O ícone vem de `icon(glyph,40)` dentro de `span.file-ico[aria-hidden=true]` (`kit.js:12`) — a decisão de design "ícone central e texto simples" do README:137. O `sync()` (`kit.js:13`) troca o texto para o nome real do arquivo e liga `has-file` (`kit.js:13`), que muda a cor do nome (`ui.css:129`). É chamado uma vez na construção para refletir pré-preenchimento (`kit.js:14`).
- `pager` (**kit.js:18-39**): retorna só o `<p class="pager-status" role="status" aria-live="polite">` quando `total===0 || pages<=1` (`kit.js:22`). Acima disso, janela de números com elipse: todos os números se `pages<=7`, senão `1 … p-1 p p+1 … last` (`kit.js:24-32`), com dedupe por `add()` (`kit.js:23`). Botões numéricos recebem `aria-label="Página n"` + `aria-current="page"` no atual (`kit.js:33`); prev/next recebem `disabled` nas bordas (`kit.js:35,37`) e rótulos acessíveis ("Página anterior"/"Próxima página"). O `<nav>` externo leva `aria-label` do chamador (`kit.js:38`). É paginação **só de exibição**: o array completo permanece no estado da tela (comentário `kit.js:17`; uso real em `clientlist.js:10-12`, `debtspage.js:11-13`).

### 2.2 Fábricas locais (definição única por arquivo — várias duplicadas)

| # | Nome | Definição(s) | Observação |
|---|---|---|---|
| 12 | `top` (cabeçalho de tela) | `clients.js:9-11`, `settings.js:12-13`, `tools.js:3-4` | 3 cópias. Só a de `clients.js` aceita ações extras (`...a` → `div.actions`, `clients.js:11`) — parâmetro **nunca usado** (ver §10). `settings.js` fixa `data-page:'settings'` e não aceita página |
| 13 | `fld` / `field` | `clients.js:27`, `debts.js:21`, `tools.js:5`, `clientlist.js:22`, `main.js:9` | 5 assinaturas incompatíveis |
| 14 | `U` (facade de tela) | `clients.js:12` | `{h, render, top}` — o contrato consumido por `clientlist`, `debts` e `debtspage` |
| 15 | `tile` (métrica) | `dashboard.js:5-7` | `tile(label,value,ico,sub,mods='')`; grade com áreas `ico/label/value/sub` (`ui.css:201`) |
| 16 | `row` (par dt/dd) | `clients.js:141`, `settings.js:26` | 2 cópias; a de `clients.js` tem `wide` → `.wide{grid-column:1/-1}` |
| 17 | `sel` (select filtrável) | `debtspage.js:8` | `sel(id,label,opcoes,chaveDoEstado)`; já religa `st[k]` + `paint()` |
| 18 | `item` (botão de nav) | `shell.js:16-17` | `item(k,label,icone,fn,classe)`; marca `data-i` para não receber ícone duplicado do `sync()` |
| 19 | `viewImg` (modal) | `clients.js:128` | único `<dialog>` do app; `showModal()` nativo |
| 20 | `flash` / toast | `settings.js:20-25` | único toast do app; auto-hide 3,4 s (ok) / 5 s (erro) |
| 21 | `run` (wraper try/catch→`err`) | `clients.js:137`, `tools.js:13` | `run(fn)=async(...a)=>{err.textContent='';try{await fn(...a);…}catch(x){err.textContent=x.message}}` |

### 2.3 Componentes CSS-only (classes reutilizadas; sem fábrica JS)

`.card` (`ui.css:53`; 18 usos em 8 arquivos) · `.section-head` (`ui.css:55-57`; `debts.js:7`, `dashboard.js:32,34`, `tools.js:195`) · `.badge` + `.badge.overdue/.soon/.ok/.badge--type` (`ui.css:374-379`; `clients.js:168`, `debtspage.js:18`, `tools.js:54`) · `.alert` / `.alert.bad` (`ui.css:228-236`; **1 único uso**, `dashboard.js:15`) · `.empty` (`ui.css:258-261`; 8 usos, sempre `h('p',{class:'empty'},icon(nome,26),texto)`) · `.list` / `.doc` / `.row` (`ui.css:239-246`, `293-299`) · `.events`/`.event` (`ui.css:401-407`) · `.search` (`ui.css:189-197`) · `.stats` (`ui.css:200`) · `.meta` (`ui.css:394-398`) · `.actions` / `.actions--grid` / `.form-actions` / `.inline-form` (`ui.css:80-87`, `151-157`) · `.form-section` + `.form-section-head` + `.form-section-icon` (`ui.css:135-140`) · `.form-grid` / `.address-grid` / `.field--full` / `.field--span2` (`ui.css:141-143`, `540`) · `.check` (`ui.css:131-134`) · `.subhead` (`ui.css:159`) · `.summary`/`.count` (`ui.css:265-267`) · `.split`/`.cols`/`.col` (`ui.css:532-536`) · `.iconbtn` (`ui.css:76`) · `.avatar` / `.avatar--lg` / `--xl` (`ui.css:248-252`) · `.skip` (`ui.css:13`) · `.sr` (`app.css:37`) · `.muted`/`.info`/`.error`/`.nowrap` (`ui.css:19-23`, `87`) · `.report` (`app.css:41-57`) · `.toast` (`ui.css:410`) · `dialog.viewer` (`ui.css:420-423`) · `.card--debts` (`ui.css:304-345`) · `.drive-card` (`ui.css:346-372`) · `.profile-*` (`ui.css:382-393`) · `.auth-*` (`ui.css:433-479`).

**Não existe componente de tabela reutilizável.** A única `<table>` do app é construída inline no relatório (`tools.js:16-19`) com `colgroup` nomeado (`c-client`, `c-interest`, …) e cabeçalho/rodapé; todo o resto do app é lista/cartão (`clientlist.js:15`, `debtspage.js:15`, `debts.js:8`, `clients.js:178`). O CSS de tabela vive **fora** de `ui.css`, em `app.css:50-57`, acoplado a `.report`.

---

## 3. Ícones

### 3.1 Mecanismo

- **Fonte única:** um objeto-literal `P` de *paths* SVG em `icons.js:2-41` ("spray" de 38 chaves), um path `d` por ícone.
- **Renderização:** `icon(n, s = 20)` (`icons.js:43`) cria `svg` + `path` via `createElementNS` (`icons.js:44`) e aplica os atributos por um loop sobre um objeto (`icons.js:45-46`): `viewBox:'0 0 24 24'`, `width/height:s`, `fill:'none'`, **`stroke:'currentColor'`**, **`stroke-width:1.5`**, `stroke-linecap/linejoin:'round'`, **`aria-hidden:'true'`**, **`focusable:'false'`**, **`class:'i'`**. O `d` vem de `P[n] || P.info` (`icons.js:47`) — **nome desconhecido cai silenciosamente em `info`**, sem aviso (`icons.js:47`).
- **Consequências de design:** ícone não precisa de CSS para funcionar (herda `color` do texto) e é invisível a leitores de tela por construção. Só existe um `<path>` por ícone — sem `circle`, `rect` ou múltiplos paths.
- **O wrapper `.i`:** a classe fixa `i` (`icons.js:46`) é o único gancho de estilização. Regras que a usam: `button .i{flex:none}` (`ui.css:69`), `.search>.i{color:var(--faint)}` (`ui.css:192`), `.tile-ico .i{width:24px;height:24px}` (`ui.css:206`), `.alert>.i` (`ui.css:229`), `.empty>.i` (`ui.css:260`), `.drive-card .section-head h2 .i` (`ui.css:361`), `.profile-edit-action .i`/`.profile-photo-action .i` (`ui.css:389,392`), `#nav .i{width:21px;height:21px}` (`ui.css:497`), `.media-field>.avatar svg.i{width:20%;height:20%}` (`ui.css:173`), `#nav button.is-loading>.i{opacity:0}` (`ui.css:495`).
- **Duas camadas de escolha automática:** (a) `shell.js:5-9` — tabela `MAP` de **regex sobre o texto do botão** → nome de ícone, aplicada por `sync()` a todo `button` sem `data-i` e sem `.iconbtn`, com `prepend(icon(m[1],18))` (`shell.js:57-61`); (b) `shell.js:60` ainda adiciona `.danger` a botões cujo texto comece com `Excluir`/`Remover`. Isso significa que **o rótulo textual do botão é API implícita do ícone** — renomear "Novo cliente" quebra o ícone, não o comportamento.

### 3.2 Inventário completo (38 nomes, `icons.js:2-41`)

`home`(3), `users`(4), `wallet`(5), `file`(6), `db`(7), `lock`(8), `logout`(9), `gear`(10), `plus`(11), `search`(12), `back`(13), `chevron`(14), `arrow`(15), `edit`(16), `trash`(17), `eye`(18), `download`(19), `upload`(20), `percent`(21), `print`(22), `alert`(23), `check`(24), `close`(25), `phone`(26), `mail`(27), `pin`(28), `id`(29), `camera`(30), `refresh`(31), `shield`(32), `clock`(33), `activity`(34), `user`(35), `calendar`(36), `image`(37), `info`(38), `filter`(39), `cloud`(40) — *(número = linha em `icons.js`)*.

Consumo, por via de referência:
- **Direto** (`icon('nome',…)`): `back` (`clients.js:10`, `settings.js:13`, `tools.js:4`, `kit.js:35`), `chevron` (`kit.js:37`, `clientlist.js:17`, `dashboard.js:16,21,33`), `search` (`clientlist.js:28`, `dashboard.js:41`, `debts.js:52`), `users` (`clientlist.js:19`, `dashboard.js:21,29`), `wallet` (`debts.js:17`, `debtspage.js:22`, `dashboard.js:27`), `camera` (`clients.js:18,41,166`), `user`/`pin` (`clients.js:50,63`), `clock` (`clients.js:151,156`), `activity` (`dashboard.js:23,24`), `edit` (`clients.js:163`), `alert` (`dashboard.js:15`), `close` (`clients.js:128`), `arrow` (`dashboard.js:41`), `file` (`clients.js:184`), `cloud` (`tools.js:195`), `percent` (`dashboard.js:28`), `gear`/`lock`/`logout` (`shell.js:41-43`).
- **Dinâmico:** `icon(d.type==='application/pdf'?'file':d.type.startsWith('image/')?'image':'file',18)` (`clients.js:179`); `icon(c.photoId?'refresh':'camera',18)` (`clients.js:166`); `icon(glyph,40)` com `glyph` default `'upload'` (`kit.js:8,12`) — é o único chamador que usa o 4º argumento de `filePicker` (nenhum chamada passa `glyph`, então **todos os 4 pickers usam `upload`**).
- **Via `MAP` de texto** (`shell.js:5-9`): `home`, `db`, `plus`, `trash`, `eye`, `download`, `upload`, `print`, `shield`, `check`.
- **Nunca referenciados em `src/`:** `mail`, `calendar`, `filter` — 3 ícones mortos (`icons.js:27,36,39`). `info` só aparece como fallback em `icons.js:47`.

### 3.3 Como adicionar um ícone novo

1. **Adicionar a chave em `P`** (`icons.js:2-41`), respeitando as restrições do sistema: grade **24×24**, **um único** atributo `d`, traço **1.5**, sem `fill` (`icons.js:1`, `icons.js:45-46`). Manter a coordenada dentro da caixa para não ser cortada no `viewBox`.
2. Se o ícone deve aparecer automaticamente num botão existente, **adicionar a regex em `MAP`** (`shell.js:5-9`) — a âncora é `^`, então o padrão deve casar o **início** do `textContent` do botão (`shell.js:59`). Ordem importa: `MAP.find` devolve a **primeira** regex que casar (`shell.js:59`), e `/^Editar|/` antes de `/^Excluir|/` decide o resultado para textos ambíguos.
3. Se for usá-lo em marcação nova, importar `import{icon}from './icons.js'` e chamar `icon('nome', tamanho)`. Não é preciso CSS: `class:'i'` já herda cor; só ajustar tamanho dentro de um wrapper específico (`ui.css:206`, `ui.css:497`).
4. **Ritmo obrigatório:** adicionar/atualizar `sw.js` — `src/ui/icons.js` já está em `FILES` (`sw.js:2`), mas o comentário de `sw.js:1` e a prática do projeto exigem **incrementar `V`** (`sw.js:2`, hoje `sc-v69`), senão o cache antigo continua servindo o arquivo sem o ícone.

---

## 4. Design system

### 4.1 Tokens — `:root` transcrito literalmente (`css/app.css:5-19`)

```css
:root{
  --bg:#080808;--surface:#171717;--surface-2:#201e1b;--surface-3:#2a2723;
  --line:#34302a;--bronze:#34302a;
  --gold:#b89a62;--gold-strong:#d2b77f;--gold-deep:#8f7748;
  --gold-soft:rgba(184,154,98,.14);--gold-softer:rgba(184,154,98,.07);
  --ivory:#e8dfc9;--muted:#a9a08f;--faint:#8c8477;
  --danger:#d99a87;--danger-soft:rgba(217,154,135,.14);
  --ok:#9dbfa6;--ok-soft:rgba(157,191,166,.13);
  --shadow-1:0 22px 50px -40px rgba(0,0,0,.95);
  --r-xl:22px;--r-lg:16px;--r-md:12px;--r-sm:9px;
  --font-sans:'DM Sans',ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  --font-serif:'Cormorant Garamond','Playfair Display',"Iowan Old Style","Palatino Linotype",Palatino,Georgia,"Times New Roman",serif;
  --ease:cubic-bezier(.22,.7,.28,1);
  color-scheme:dark;
}
```

Base não-tokenizada de `app.css`: box-sizing universal (`app.css:20`), `[hidden]{display:none!important}` (`app.css:21`), barras de rolagem ocultas mantendo rolagem (`app.css:23-24`), `scroll-behavior:smooth` (`app.css:25`), `body` tipográfico 16px/1.6 (`app.css:26-27`), halo radial dourado de fundo via `body::before` (`app.css:28-29`), `::selection` (`app.css:30`), `h1,h2,h3` em serifa com `text-wrap:balance` (`app.css:31`), links `var(--gold)` (`app.css:33`), `img{max-width:100%}` (`app.css:34`).

**Tokens definidos e nunca usados:** `--line` e `--bronze` (0 ocorrências de `var(--line)`/`var(--bronze)` em `css/`), `--r-md` e `--r-sm` (0 ocorrências). Raio correspondente aparece como número solto: `border-radius:14px` (`ui.css:61,92,411`), `12px` (`ui.css:81`), `18px` (`ui.css:119`), `10px` (`ui.css:115`), `9px` inexistente, `999px` (`ui.css:13,189,374`). O "bronze escuro #34302A" citado como cor de identidade em `README.md:142` só existe como **hex literal** em `app.css:45` (`.report h1`) e `app.css:53` (`.report thead`).

**Cores literais que furam o sistema em `ui.css`** (não-tokenizadas): `#080808` em `ui.css:13,28,70,195,391,412,415,502` (deveria ser `--bg`), `#272420` (hover) em `ui.css:96,121,122,133,191,363`, `#2c2925` (foco) em `ui.css:97`, `#2a2723` em `ui.css:103` (idêntico a `--surface-3`), `#302c27` em `ui.css:104,117`, `#121211` em `ui.css:502`, `#000` em `ui.css:309,319,391,421,443,461`, e o par `rgba(184,154,98,.NN)` repetido à mão em `ui.css:175(não),205,212,214,306,307,309,318,325`. A paleta de **papel** do relatório (`#f7f3ea`, `#d8cfbe`, `#e8dfc9`, `#efe9dc`, `#b89a62`, `#34302a`, `#171717`, `#8c8477`) vive inteira em `app.css:41-57` sem token.

### 4.2 Tipografia e fontes locais

| Papel | Família | Arquivo | Definição |
|---|---|---|---|
| Interface (menus, tabelas, formulários, dados) | **DM Sans** (`--font-sans`) | `assets/fonts/dm-sans-latin.woff2` | `@font-face` `app.css:4`, `font-weight:400 600` (variável), `font-display:swap` |
| Institucional (logotipo, `h1/h2/h3`, citações, avatar) | **Cormorant Garamond** (`--font-serif`) | `assets/fonts/cormorant-garamond-latin.woff2` | `@font-face` `app.css:3`, `font-weight:500 700`, `font-display:swap` |

Ambas são `latin` subset, **locais** (sem Google Fonts), `preload`adas em `index.html:4` com `as="font" crossorigin`, e **caches no service worker** (`sw.js:2`). CSP restringe `font-src 'self'` (`index.html:3`). Licenças OFL versionadas em `assets/fonts/OFL-DMSans.txt` e `assets/fonts/OFL-CormorantGaramond.txt`. Escala tipográfica real: `body` 16px/1.6 (`app.css:26`); `h2` `1.34rem` (`ui.css:24`); `h3` `1.08rem` (`ui.css:25`); `header.top h1` `clamp(1.75rem,1.1rem+1.15vw,2rem)` (`ui.css:39`); `.hero h1` `clamp(2.2rem,1.35rem+2.4vw,3rem)` (`ui.css:46`); `.tile strong` `clamp(1.8rem,1.2rem+1.5vw,2.05rem)`→`1.85rem`→`clamp(2rem,1.7rem+.5vw,2.35rem)` (`ui.css:209,221,225`); rótulos micro em `.66–.78rem` com `letter-spacing` .02–.2em e `text-transform:uppercase` (`ui.css:18,91,208,396`); `font-variant-numeric:tabular-nums` em todo valor monetário/data (`ui.css:55,98,210,246,271,407`). O uso de `clamp()` é intenso: 23 ocorrências em `ui.css`, 1 em `app.css`.

### 4.3 Breakpoints reais (todas as `@media` de `css/ui.css` + `css/app.css`)

**Regra estrutural declarada em `ui.css:3`:** `< 768` celular (barra inferior) · `768–1099` tablet (trilho) · `≥ 1100` desktop (menu lateral). **10 larguras distintas** aparecem no CSS.

| Condição | Linha | O que muda |
|---|---|---|
| `(max-width:719px)` | `app.css:49` | `.report-hint{display:block}` — dica "deslize a tabela" só no celular |
| `print` | `app.css:59-74` | ver §8 |
| `(min-width:560px)` | `ui.css:84` | `.actions--grid` → 2 colunas |
| `(max-width:560px)` | `ui.css:130` | `.file-pick` mais alta (156px) e com menos padding; **`.card>.actions button{flex:1 1 100%}`** (botões empilham); `.card.install` empilha |
| `(min-width:560px)` | `ui.css:181-184` | `.media-field`: `--photo-size` `clamp(150px,20vw,176px)`, `--photo-gap` maior, coluna da pick → `minmax(0,1fr)` (caixa ocupa a largura restante) |
| `(min-width:1000px)` | `ui.css:185-186` | `.media-field`: `--photo-size` `clamp(184px,15vw,216px)`, gap 22px |
| `(min-width:720px)` | `ui.css:215-223` | `.stats` → 3 colunas; `.tile` passa de linha (ícone à esquerda) para **pilha vertical** (`areas:"ico" "label" "value" "sub"`), ícone 52px, label `min-height:2.5em` |
| `(min-width:1000px)` | `ui.css:224-226` | `.tile strong` cresce para `clamp(2rem,1.7rem+.5vw,2.35rem)` |
| `(max-width:380px)` | `ui.css:236` | `.alert` quebra; botão do alerta vira linha inteira alinhada à esquerda |
| `(max-width:560px)` | `ui.css:281-290` | `.pager` sai de flex para **bloco**; `.pager-nav` vira grade 2×`1fr` com Anterior/Próxima na linha 1 e números centralizados na linha 2; botões `min-width:44px` |
| `(max-width:719px)` | `ui.css:300-302` | `.doc>.actions` ocupa linha própria (`flex:1 0 100%`) e alinha à esquerda |
| `(max-width:719px)` | `ui.css:341-345` | `.card--debts` reduz padding do card (20/18), do `.doc` (16) e da linha financeira (10/12) |
| `(max-width:560px)` | `ui.css:364-369` | `.drive-card`: `.section-head` alinha no topo, `h2` 1.25rem, `.subhead` 22px, botões `.ghost` em linha cheia |
| `(max-width:360px)` | `ui.css:456` | `.brand h1` 1.6rem/.11em; `.brandtext .word` .74rem; `header.top h1` 1.4rem; `.util` gap 0 e `.iconbtn` 42px (único ponto em que o alvo cai abaixo de 44px) |
| `(min-width:760px)` | `ui.css:458-468` | **Login divide em 2 colunas** `1fr 1fr`; `.auth-visual` 100dvh; máscara do crossfade passa de vertical para horizontal; `.auth-quote` passa de `display:none` (`ui.css:450`) a visível; `.quote-line` 2.05rem |
| `(min-width:1000px)` | `ui.css:469-471` | `.brand h1` 1.95rem/.15em |
| `(min-width:1100px)` | `ui.css:472-479` | `.auth-shell` `1.05fr .95fr`; quote e painel ganham padding/margem maiores; `.brand .mark` 78px |
| `(min-width:768px)` | `ui.css:500-516` | **Tablet:** `#nav` sai da base e vira **trilho fixo de 96px** à esquerda (`top:0;bottom:0`), gradiente vertical, sem `backdrop-filter`; `.nb` (marca) aparece; `.brandbar .mark` some do header; `.lock`/`.out`/`.settings` aparecem; `main` ganha `margin-left:96px`, `padding:36px 34px 56px`, conteúdo limitado a 760px; **`.util` é ocultado** (engrenagem/lock/logout do header só existem no celular); toast vai para `bottom:28px` |
| `(min-width:1100px)` | `ui.css:519-529` | **Desktop:** trilho alarga para **264px**, botões viram linha (ícone + rótulo, .92rem); `.brandtext` volta; `header.top.brandbar` é ocultado; `main` `margin-left:264px`, `padding:44px 52px 64px`, conteúdo até **1100px** |
| `(min-width:720px)` | `ui.css:537-544` | **Grade de formulários:** `.form-grid` 2 colunas; `.address-grid` 3 colunas; `.field--span2` = `span 2`; `.meta` 2 colunas com `dt{min-height:2.8em}` (alinha valores multilinha) |
| `(min-width:1000px)` | `ui.css:545-549` | `.split` 2 colunas (Últimos clientes / Atividades lado a lado); `.list--grid` 2 colunas com **último ímpar ocupando a linha toda** (`:last-child:nth-child(odd)`) |
| `(min-width:1100px)` | `ui.css:550-553` | `.hero h1` fixo 3rem; gap de `.split`/`.cols` 18px |
| `(min-width:1200px)` | `ui.css:554-556` | `.cols` (Configurações) em 2 colunas |
| `(prefers-reduced-motion:reduce)` | `ui.css:559-563` | ver §7 |
| `print` | `ui.css:566-571` | ver §8 |

**Não-`@media` condicionais relevantes:** `@supports (-webkit-touch-callout:none)` em `ui.css:110-113` (Safari/iOS: `-webkit-appearance:none` em date/month para não estourar o card) e `ui.css:370-372` (font-size 16px em inputs do Drive para evitar zoom automático no iOS). `@page port`/`@page land` em `app.css:40`.

**Observação factual:** `main` tem três larguras máximas por faixa — `660px` abaixo de 768 (`ui.css:9`), `760px` no tablet (`ui.css:513`) e `1100px` no desktop (`ui.css:528`), com `body:not(.shell)` (login/sem shell) em 420px (`ui.css:428,437`).

### 4.4 Identidade visual que NÃO deve ser alterada

Fontes documentadas (contratos explícitos no repositório):

1. **Paleta e tipografia nomeadas** — preto `#080808`, grafite `#171717`, dourado envelhecido `#B89A62`, marfim `#E8DFC9`, bronze `#34302A`; Cormorant Garamond para logotipo/títulos/institucional e DM Sans para menus/tabelas/formulários/dados; fontes locais em `assets/fonts` entrando no cache offline (`README.md:141-145`).
2. **Direção** — "interface escura, dourado moderado, ícones minimalistas, sem divisórias decorativas e com animações discretas" (`README.md:146`).
3. **Estética estrutural** — "sem bordas, linhas divisórias ou separadores; hierarquia por espaçamento, superfícies e contraste; botões e campos sem contorno em repouso" (`docs/README.md:40`; ecoado no cabeçalho `ui.css:2-3`). Concretamente: `button{border:0}` (`ui.css:61`), `input,select,textarea{border:0}` (`ui.css:92`). A **única** borda permitida em repouso é a tracejada da área de upload (`ui.css:119`) e o `box-shadow inset` do checkbox (`ui.css:102`).
4. **Marca** — "imagem original do chapéu **inteira e sem recorte**, com a moldura dourada original… **sem contorno adicional, sombra ou cantos arredondados**" (`docs/README.md:39`). Implementação: `.mark{border-radius:0;overflow:visible;background:#080808}` (`ui.css:28`), `.brand .mark{border-radius:0;box-shadow:none}` (`ui.css:430`), `object-fit:contain` (`ui.css:29`), e o mesmo `<img src="assets/img/hat.webp">` em `shell.js:29`, `main.js:35,52`.
5. **Ordem e composição do perfil** — "dados, dívidas, documentos e histórico, nessa ordem; o card de documentos fica abaixo do card de dívidas; a edição fica no ícone superior direito do card, a troca de foto no botão circular sobre o avatar e a exclusão dentro de 'Editar perfil', após 'Cancelar'" (`docs/README.md:30`) — implementado exatamente em `clients.js:159-185` (`err`, `profile-card`, `dsec`, Documentos, Histórico).
6. **Formulário em dois blocos** com título + ícone + espaçamento próprio, **sem bordas** (`docs/README.md:31`; `clients.js:49-68` com `.form-section-head`/`.form-section-icon` `ui.css:137-140`), e a regra PF/PJ de rótulo dinâmico CPF↔CNPJ e Nome↔Razão social, ocultando nascimento/gênero/RG para PJ e não fazendo consulta (`docs/README.md:31`; implementado em `clients.js:71`).
7. **Endereço** — CEP → rua → número → complemento → bairro → cidade → UF "nessa ordem", máscara + debounce + preenchimento preservando número/complemento (`docs/README.md:32`; `clients.js:64-68`, `clients.js:101-123`).
8. **Paginação 20/10/5** com "Anterior, Próxima e números, além de 'Mostrando X–Y de Z'", exibição pura, dados intactos (`docs/README.md:34`; `clientlist.js:3`, `debtspage.js:4`, `clients.js:146`, `kit.js:20`).
9. **Barras de rolagem ocultas em todos os tamanhos** (`docs/README.md:35`; `app.css:23-24`).
10. **Login com duas cenas em crossfade de ciclo 18 s**, banner no celular / painel dividido a partir de 760px, primeira cena estática com reduced-motion (`docs/README.md:38`; `ui.css:443-447`, `ui.css:458-467`, `ui.css:559-563`).
11. **Áreas de upload pontilhadas com ícone central e texto simples** (`README.md:137`; `ui.css:118-129`).
12. **Ícones**: traço fino, grade 24×24, herdando `currentColor`, sem bibliotecas (`icons.js:1`).

---

## 5. Mapa tela → arquivo → função de render

Não há rota nem URL: a "tela" é o que estiver dentro de `#app` (`index.html:11`, `main.js:4`).

| Tela | Arquivo:linha | Função de entrada | Bloco de render | `data-page` |
|---|---|---|---|---|
| Cofre / criar senha | `main.js:11-43` | `authView(setup, notice)` | `main.js:42` `show(h('div',{class:'auth-shell'}, visual, panel))` | *(sem header; detectada por `.auth,.brand` em `shell.js:49`)* |
| Painel (Início) | `main.js:44-60` | `appView()` | `main.js:50-59` (`header.top.brandbar`, `.hero`, busca, `.stats`, `.split`, card Relatórios/backup) | `home` (`main.js:51`) |
| Cards do painel (busca + métricas + alertas + listas) | `dashboard.js:3-43` | `card({h,search,openClient,openDebts,openClients})` → `Promise<[form, box]>` | `dashboard.js:38-42` retorna o par `[search, box]`; `draw()` (`dashboard.js:8`) monta `tile`/`alert`/`list`/`events` | — |
| Lista de clientes | `clientlist.js:4-34` | `clientList(U, {home,open,newClient,bulk}, q0)` | `clientlist.js:26-31` `U.render(U.top('clients','Clientes',home), card-busca, cnt, out, pg)`; `paint()` em `clientlist.js:6` | `clients` |
| Novo/Editar cliente | `clients.js:17-125` | `form(c={})` (via `list()`→`newClient` `clientlist.js:30` ou `clients.js:124`) | `clients.js:124` `render(top(c.id?'edit-client':'new-client',…), f)`; `paint()` da prévia em `clients.js:36-41` | `new-client` / `edit-client` |
| Perfil do cliente | `clients.js:129-186` | `profile(id)`, exposta por `openProfile(ctx,id)` (`clients.js:15`) | `clients.js:159-185`: `profile-card` (avatar + ações + `dl.meta`), `dsec` (dívidas, `debts.js:4`), Documentos, Histórico (`clients.js:147`) | `client` |
| Dívidas (página) | `debtspage.js:5-38` | `page(U,{home,open,reopen})`, exposta por `debtsPageView(ctx)` (`clients.js:14`) | `debtspage.js:25-33` (`Registrar dívida` inline-form, `Filtros`, `sum`, `out`, `pg`, `err`); `paint()` `debtspage.js:9` | `debts` |
| Nova/Editar dívida | `debts.js:19-41` | `form(U,c,d,back)` — chamada de `debtspage.js:21,28`, `debts.js:7`, `clients.js` via `D.section` | `debts.js:40` `U.render(U.top('edit-debt',…), f)` | `edit-debt` |
| Juros em lote | `debts.js:43-70` | `bulk(U,back)` — chamada de `clientlist.js:30` | `debts.js:63-69`; prévia em `prev` (`debts.js:59`) | `bulk` (→ highlight do item `clients` em `shell.js:53`) |
| Relatórios | `tools.js:6-30` | `reportsView(X)` | `tools.js:21-29`: card "Período e formato" + `div.report[role=region]` (`tools.js:8`), documento em `report()` (`tools.js:14-20`) | `reports` |
| Backup e restauração (local + Drive) | `tools.js:31-208` | `backupView(X)` | `tools.js:199-207`: 3 cards (`Novo backup`, `Restaurar ou importar`, `.drive-card`); Drive em `renderDrive()` (`tools.js:63-192`) | `backup` |
| Configurações | `settings.js:15-64` | `settingsView(X)` (`async`) | `settings.js:46-63`: `.cols.settings-grid` com 2 `.col` (Sistema, Segurança / Instalação, Vencimentos) + `.toast` | `settings` |
| Navegação persistente (fora de `#app`) | `shell.js:10-64` | `initShell({ctx,home,clients,debts,reports,backup,settings,lock})` | `shell.js:28-36` `nav.replaceChildren(...)`; utilitários injetados no header por `util()` (`shell.js:37-46`) | — |

**Hooks de navegação — exatamente dois pontos de ligação:**

1. **`main.js:65`** — `initShell({ctx, home:()=>appView(), clients:clientsView, debts:debtsPageView, reports:reportsView, backup:backupView, settings:settingsView, lock:A.lock})`. É a **única** forma de trocar de tela pelo `#nav` (`shell.js:16-17`: `item(k,label,icone,fn)` → `click` → `fn()`).
2. **Adaptadores em `clients.js:13-16`** — `clientsView`, `debtsPageView`, `openProfile` publicam o `ctx` para o módulo que guarda estado de formulário (`let X` em `clients.js:2`), e os callbacks internos (`home`, `open`, `newClient`, `bulk`, `reopen`) são passados a `clientList`/`page`. Voltar sempre é `top(page, título, back)` (`clients.js:9`, `settings.js:12`, `tools.js:3`) — o botão `iconbtn.back` com `aria-label:'Voltar'`.

**Feedback de navegação (`shell.js:12-27`)** — `navStart`/`navStop` marcam o botão clicado e `#app` com `aria-busy="true"` e `.is-loading` (`shell.js:15`), com **piso de 320 ms** e teto de 1800 ms (`shell.js:14-15`); `busyStart`/`busyStop` fazem o mesmo para botões assíncronos fora da nav, descobertos por delegation em `document click` (`shell.js:25`) e `submit` em fase de captura (`shell.js:26`), detectando o fim por `MutationObserver` no atributo `disabled` (`shell.js:22`) com teto de 4500 ms e **piso de 340 ms**. A exclusão é feita por `asyncTarget` (`shell.js:24`): ignora `#nav`, `.row` e `.iconbtn`. `data-changed` força a limpar spins remanescentes após 650 ms (`shell.js:27`).

---

## 6. Formulários

### 6.1 Cliente (`clients.js:17-125`)

Campos gerados por `fld()` (`clients.js:27`) produzem **input `id=<nome>` e wrapper `id=f-<nome>`**:

| Rótulo | `id` real | Wrapper `#f-*` | Tipo / `autocomplete` | Linha |
|---|---|---|---|---|
| CPF (ou CNPJ) | `doc` | `#f-doc` | text / `off` | `clients.js:28` |
| Nome completo (ou Razão social) | `name` | `#f-name` | text / `name`, `field--full` | `clients.js:59` |
| Data de nascimento | `birth` | `#f-birth` | date / `bday` | `clients.js:60` |
| RG | `rg` | `#f-rg` | text / `off` | `clients.js:61` |
| Telefone | `phone` | `#f-phone` | tel / `tel` | `clients.js:61` |
| Celular | `mobile` | `#f-mobile` | tel / `tel` | `clients.js:61` |
| E-mail | `email` | `#f-email` | email / `email` | `clients.js:61` |
| CEP | `cep` | `#f-cep` | text / `postal-code` | `clients.js:65` |
| Rua | `street` | `#f-street` | text / `address-line1` (span2) | `clients.js:65` |
| Número | `number` | `#f-number` | text / `address-line2` | `clients.js:66` |
| Complemento | `complement` | `#f-complement` | text / `address-line3` | `clients.js:66` |
| Bairro | `district` | `#f-district` | text / `address-level3` | `clients.js:67` |
| Cidade | `city` | `#f-city` | text / `address-level2` (span2) | `clients.js:67` |
| Estado (UF) | `state` | `#f-state` | text / `address-level1`, `maxLength=2`, `autocapitalize='characters'` | `clients.js:68,99` |

Campos montados à mão, **sem wrapper `#f-*`**: `type` (select PF/PJ, `clients.js:57`), `gender` (select, wrapper `#f-gender` criado manualmente em `clients.js:30` — o único dos "não-`fld`" que tem wrapper), `photo` (file dentro de `media-field`, `clients.js:55`).

Extras dentro do wrapper `#f-doc`: `<p class="cpf-status" role="status" aria-live="polite">` inserido antes do `<small class="error">` (`clients.js:23-29`). Dentro de `#f-state`…`note`: `<p class="field-note" role="status" aria-live="polite">` como último item do grid de endereço (`clients.js:20,68`).

Comportamento por campo (tudo em listeners imperativos pós-render):
- **PF/PJ** (`sync()` `clients.js:71`): troca o texto de `label[for=doc]` (CPF↔CNPJ) e `label[for=name]` (Nome completo↔Razão social), oculta `#f-rg`, `#f-birth`, `#f-gender` via `.hidden`, reaplica a máscara e chama `clearCpf()` se PJ. Disparado na montagem (`clients.js:124`) e em `type.onchange` (`clients.js:96`).
- **doc** (`clients.js:97`): máscara em tempo real (`V.mask.cpf|cnpj`, `validators.js:6-8`) + `scheduleCpf()` (`clients.js:72-81`): debounce **700 ms**, exige 11 dígitos, valida o dígito verificador localmente antes de gastar rede, respeita `navigator.onLine` (`clients.js:78`), mostra `Validando…`/`Validado`/`Inválido` (`clients.js:24,77,79,89`), e **preenche só campos vazios** via `put()` (`clients.js:87`) — nunca sobrescreve digitação do usuário. Cancelado por `AbortController` + `cpfSeq` (`clients.js:73,86`).
- **phone/mobile** (`clients.js:98`): `V.mask.phone` (`validators.js:9`).
- **state** (`clients.js:100`): maiúsculas, só A–Z, 2 caracteres.
- **cep** (`clients.js:122-123`): `maskCep` em `input`, `blur` avisa CEP incompleto; `schedule()` (`clients.js:113-121`) com debounce **650 ms** chama ViaCEP; `runLookup` (`clients.js:101-112`) preenche **rua, bairro, cidade e UF** preservando número/complemento (só escreve nesses 4), e trata `NOT_FOUND`/`OFFLINE` com aviso em `.is-warn` (`clients.js:110`).
- **photo** (`clients.js:55,41`): guarda `{file}` ou `{remove:true}`; `paint()` (`clients.js:36-41`) resolve a prévia com **sequência anti-corrida** (`previewSeq`), revoga a URL anterior e só escreve se o nó continua conectado.

### 6.2 Dívida (`debts.js:19-41`)

`description` (`field--full`), `principal` (`inputmode:numeric`), `rate` (`inputmode:decimal`), `interest` (**readonly**, "Juros por mês (calculado)", `debts.js:32`), `date` (`type:date`, default hoje em fuso local, `debts.js:2,33`), `due` (`type:date`), `notes` (`<textarea rows=3>`, `debts.js:35`). `interest` **não é um campo de estado**: é recalculado por `upd()` (`debts.js:38`) a partir de `M.interest(cents,rate)` em cada `input` (`debts.js:39`) — coerente com `services/debts.js:5` ("juros sempre derivados: uma única fonte da verdade"). `principal` é normalizado para centavos formatados a cada tecla (`debts.js:39`).

### 6.3 Configurações (`settings.js`) e Ferramentas (`tools.js`)

Configurações **não usa `<form>`**: são controles isolados com handler próprio e feedback por `flash()`. `idle` (select 1/5/15/30 min, `settings.js:28`), `wd` (number 1–365 com validação manual em `saveWin`, `settings.js:42-44`), `test` (botão que grava/lê um probe criptografado, `settings.js:30-36`), `inst` (bloco de instalação re-renderizado, `settings.js:38-40`).

Ferramentas/backup: `pm`/`pd`/`pn`/`po` no relatório (`tools.js:9-11`) — `pd` e `pn` são alternados por `hidden` conforme o modo (`tools.js:9,10`). Em backup: `be` (checkbox criptografar), `bp`/`bp2`, `rf`, `rp`, `rm` (select criado dentro do handler de sucesso, `tools.js:45`); no Drive: `gcfg`, `ge`, `gp`, `gp2`, `gdf`, `gdp`, `gdm` (`tools.js:34,80,128,146-148`). Padrão recorrente: `enc.onchange=()=>{bp.hidden=bp2.hidden=!enc.checked}` (`tools.js:36`, idêntico `tools.js:130`).

### 6.4 Como o erro é exibido

**Três canais, todos por `textContent`** (nunca `innerHTML`):

1. **Erro de campo** → `<small class="error">` **dentro do wrapper `.field`**, criado por `fld()` (`clients.js:27`, `debts.js:21`) e indexado em `fe[id]`. No `catch`: `for(const[k,m]of Object.entries(x.errs||{}))fe[k].textContent=m` (`clients.js:47`, `debts.js:26`). Os **chaves de `errs` são exatamente os `id` dos campos** — contrato verificado em `services/clients.js:8-14` (`name`, `doc`, `phone`, `mobile`, `email`) e `services/debts.js:8-12` (`description`, `principal`, `rate`, `date`, `due`). Nenhum outro identificador é usado, então o mapeamento é direto.
2. **Erro global** → `<p class="error" role="alert">` no fim do formulário (`clients.js:44,69`, `debts.js:20,26,36`), recebendo `x.message` (que para falha de validação é sempre "Corrija os campos destacados." — `services/clients.js:17`, `services/debts.js:15`).
3. **Estado não-bloqueante** → `.field-note` (CEP) e `.cpf-status` (CPF), `role="status"` + `aria-live="polite"` (`clients.js:20,23`), e `.info`/`.toast` em bulk/backup/configurações (`debts.js:45`, `tools.js:33`, `settings.js:20`).

**Sobre a pergunta "campos `.err`?"** — A classe é **`.error`**, e não o input nem o wrapper: não existe regra CSS para `.err` nem para `.field:has(.error)` (grep em `css/`). Consequência factual verificada: **o campo com erro não muda visualmente** — não ganha borda, contorno, cor de fundo, nem `aria-invalid`. A única mudança é o texto vermelho de `.error` abaixo do campo (`ui.css:21-23`, `.error{color:var(--danger);font-size:.88rem}` + `.error:empty{display:none}`). Não há `aria-describedby` nem `aria-invalid` **em todo o repositório** (grep: zero ocorrências). Ver §7.

**Interação estado ↔ serviço:** o formulário **não mantém estado de domínio**. Estado de UI vive em closures (`st`, `sel`, `parsed`, `photo`, `histPage`) e o valor "real" de cada campo é lido sob demanda do DOM em `f.elements[k].value.trim()` (`clients.js:45`, `debts.js:24`). O ciclo é: limpar erros → `btn.disabled=true` (`clients.js:44`, `debts.js:23`) → montar payload puro → chamar serviço → **em sucesso, re-renderizar a partir do banco** (`profile(await S.saveClient(…))` `clients.js:46`; `back()` `debts.js:25`; `profile(id)` após cada ação em `clients.js:137`) → em falha, preencher `fe`/`err` → `finally btn.disabled=false`. Persistência emite `data-changed` (`db/idb.js:30`), que religa as telas reativas (`core/live.js:2`). Botões só são reabilitados depois da operação; não há otimista nem fila offline.

---

## 7. Acessibilidade

### 7.1 O que está implementado (positivo, com evidência)

- **`prefers-reduced-motion`** — `ui.css:559-563`: zera `animation-duration`, `animation-delay`, `transition` e `scroll-behavior` para `*,*::before,*::after` com `!important`, e força a **primeira** cena do login a ficar estática (`opacity:0!important` em `.auth-photo`, `opacity:1!important` na `first-of-type`) — comportamento prometido em `docs/README.md:38`. `app.css:25` liga `scroll-behavior:smooth` na raiz, neutralizado por essa regra.
- **Foco visível** — regra base `:where(button,input,select,textarea,a,[tabindex]):focus-visible{outline:2px solid var(--gold);outline-offset:2px}` (`app.css:36`); checkbox reforçado (`ui.css:106`); skip link que aparece em foco (`.skip:focus{transform:none}`, `ui.css:13-15`); botão de arquivo com `:focus-within` (`ui.css:122`); campo de busca com `:focus-within` dourado de 2px (`ui.css:191`).
- **Skip link + alvo** — `<a class="skip" href="#app">Ir para o conteúdo</a>` e `<main id="app" tabindex="-1">` (`index.html:11`).
- **Semântica de região** — `<nav id="nav" aria-label="Navegação principal">` (`index.html:11`), `<nav class="pager" aria-label=…>` (`kit.js:38`), `header.top` por tela (`clients.js:9`, `settings.js:12`, `tools.js:3`), `form[role="search"]` (`dashboard.js:39`), `div.report[role="region"][aria-label]` (`tools.js:8`), `<h1>` em todas as telas (via `top()` ou `main.js:54`).
- **Estados ao vivo** — `role="alert"` em 10 pontos de erro/confirmação; `role="status"` em 9 (`pager` `kit.js:21`, `field-note` `clients.js:20`, `cpf-status` `clients.js:23`, `toast` `settings.js:20` com `aria-live`+`aria-atomic`, `summary` `debtspage.js:7`, `info` `debts.js:45`/`tools.js:33,53`, `notice` `main.js:27`); `aria-busy` no botão de navegação e no `#app` (`shell.js:13-15`) e durante preload do Google (`tools.js:109,114,118`).
- **`aria-current`** — item ativo da nav (`shell.js:54`) e página atual da paginação (`kit.js:33`), ambos com CSS dedicado (`ui.css:78,493`).
- **Rótulos** — 29 pontos de construção de `<label>` em `src/ui/*.js` + `src/main.js`, e todos os 29 estão associados a um controle. Distribuição: **24 com `for` explícito** — 15 literais (`clients.js:30,53,57,174,175,176`; `debts.js:32,35,65,68`; `debtspage.js:27,31,32`; `settings.js:53,61`), **6 em fábricas de campo** com `for:id` (`main.js:9`, `clientlist.js:22`, `clients.js:27`, `debts.js:21`, `debtspage.js:8`, `tools.js:5`), **2 rótulos visualmente ocultos** `.sr` (`clientlist.js:28` → `cq`, `dashboard.js:40` → `gq`) e **1 wrapper de upload** `label.file-pick[for=input.id]` (`kit.js:11`) — mais **5 rótulos implícitos** `<label class="check">` que envolvem o próprio checkbox (`main.js:31`, `debts.js:50,51`, `tools.js:184,201`). Verificado campo a campo: nenhum `input`/`select`/`textarea` de dado ficou sem rótulo. Defeito colateral: `#cq` (`clientlist.js:23`) e `#gq` (`dashboard.js:4`) carregam `for` **e** `aria-label` ao mesmo tempo — duas fontes de nome acessível para o mesmo controle (ver lacuna 6).
- **Imagens** — 100% dos `<img>` têm `alt`. Decorativas com `alt=""` e/ou `aria-hidden` na embalagem: chapéu da marca (`shell.js:29`, `main.js:35,52`), fotos do login dentro de `section[aria-hidden=true]` (`main.js:37-39`), avatar da lista (`avatar.js:14,26` — o nome já está em `.row-title`). Descritivas: prévia do form (`alt:'Fotografia do cliente'`, `clients.js:41`), perfil (`alt:'Fotografia de '+c.name`, `clients.js:139`), visualizador (`alt:name`, `clients.js:128`).
- **Ícones decorativos fora da árvore de acessibilidade por construção** — `aria-hidden` + `focusable:false` (`icons.js:46`); wrappers `.file-ico` (`kit.js:12`), `.form-section-icon` (`clients.js:50,63`), `.mark` (`shell.js:29`).
- **Alvos de toque** — `button{min-height:46px;min-width:46px}` (`ui.css:61`), `.iconbtn` 44×44 (`ui.css:76`), `.pager-btn` 44×44 (`ui.css:274`), ações do perfil 44×44 (`ui.css:388,391`), botões de nav 52/64/48px (`ui.css:489,508,510,525`). `README.md:135` e `docs/auditoria-ui-ux-codigo.md` registram medições em 320/390/834/1280 px.
- **Teclado** — toda interação é feita em `<button>`/`<a>`/`<input>`/`<select>` nativos (`clients.js:16` usa `h('button',{class:'row'})` dentro de `<li>`, não `<li onclick>`), então Enter/Espaço funcionam sem JS extra. O único modal usa `<dialog>` + `showModal()` (`clients.js:128`), o que dá **Esc, armadilha de foco e `aria-modal` nativos**. `confirm()` nativo é usado para as 5 ações destrutivas (`clients.js:42,184`, `debts.js:17`, `debtspage.js:22`, `tools.js:39,47,104,135,161`).
- **Cor de sistema e tema** — `color-scheme:dark` (`app.css:19`), `theme-color:#080808` (`index.html:4`), `meta name="description"` (`index.html:5`), `lang="pt-BR"` (`index.html:1`).

### 7.2 Contraste medido (WCAG 2.1, calculado a partir dos hex dos tokens)

Pareamentos corretos — texto claro sobre **fundo escuro**, razão = (L1+0.05)/(L2+0.05):

| Par (classe → `css`) | Cálculo | Razão | Limite |
|---|---|---|---|
| `--ivory` sobre `--bg` (corpo) | `#e8dfc9`/`#080808` | **15.10** | AA texto ✓ |
| `--ivory` sobre `--surface` (`.card`) | `#e8dfc9`/`#171717` | **13.51** | ✓ |
| `--ivory` sobre `--surface-2` (`.doc`) | | **12.53** | ✓ |
| `--muted` sobre `--surface` (`.empty`, `.pager-btn`, `.doc-meta`) | `#a9a08f`/`#171717` | **6.93** | ✓ |
| `--muted` sobre `--surface-2` (`.file-name`) | | **6.42** | ✓ |
| `--faint` sobre `--bg` (`#nav button`, `.count`) | `#8c8477`/`#080808` | **5.42** | ✓ |
| `--faint` sobre `--surface` (`.tile .label`, `.meta dt`) | | **4.85** | ✓ (só 4.5) |
| `--faint` sobre `--surface-2` (`input::placeholder`) | | **4.50** | no limite exato de AA |
| `--gold` sobre `--bg` (`.brandtext .word`, link) | `#b89a62`/`#080808` | **7.47** | ✓ |
| `--gold-strong` sobre `--surface` (`.info`, `.field-note.is-warn`) | `#d2b77f`/`#171717` | **9.24** | ✓ |
| `--gold-strong` sobre `--gold-soft`+surface (`.badge.soon`, `.pager-btn.is-current`) | comp. `#2e2922` | **7.42** | ✓ |
| `--gold-strong` sobre `--gold-softer`+bg (`#nav [aria-current=page]`) | comp. `#14120e` | **9.62** | ✓ |
| `--gold-strong` sobre `--tile--accent` (aprox. 16% dourado) | comp. `#312c23` | **7.15** | ✓ |
| `--danger` sobre `--surface` (`.error`) | `#d99a87`/`#171717` | **7.62** | ✓ |
| `--danger` sobre `--danger-soft`+surface (`.badge.overdue`) | comp. `#322927` | **6.00** | ✓ |
| `--ok` sobre `--ok-soft`+`--surface-3` (`.badge.ok`) | comp. `#393b34` | **5.66** | ✓ |
| `#080808` sobre `--gold` (`button.primary`, `.toast`, `.search button`) | | **7.47** | ✓ |
| `#080808` sobre `--gold-strong` (`.primary:hover`) | | **10.32** | ✓ |
| `#080808` sobre `--danger` (`.toast.bad`) | | **8.51** | ✓ |
| relatório: `#171717` sobre `#f7f3ea` | | **16.19** | ✓ |
| relatório `thead`: `#34302a` sobre `#e8dfc9` | | **9.88** | ✓ |

**Abaixo de 4.5:1 (texto pequeno) — 4 ocorrências, todas com evidência:**

| Par | Onde | Razão | Notas |
|---|---|---|---|
| `--gold-deep` `#8f7748` sobre `--surface-3` `#2a2723` | `.doc-ico` (`ui.css:373`) | **3.47** | ícone decorativo/`aria-hidden` — não é texto; mas é o único glifo do item de documento. Não conta como falha de texto AA; é falha de 1.4.11 (não-Texto) se considerado informativo? **NÃO CONFIRMADO** (julgamento de conformidade). |
| `--gold-deep` sobre `--surface-2` | `.event .ev-ico` (`ui.css:403`) | **3.88** | idem |
| `--faint` sobre `--surface-2` | `input::placeholder` (`ui.css:95` via `--faint` `app.css:10`) | **4.50** | exatamente no limite; placeholders **não** devem ser o único rótulo — aqui todos os inputs têm `<label>`, exceto os de `aria-label` (§7.3) |
| `--faint` sobre `#f7f3ea` | `.report-hint` (`app.css:48`) | **3.34** | texto de instrução **real** (`.78rem`) — o pior caso de texto no app |

### 7.3 Lacunas, com evidência

1. **Foco de teclado é removido em campos de texto.** `app.css:36` usa `:where(…)`, que **não contribui especificidade**: o seletor vale (0,1,0). `ui.css:97` — `input:focus,select:focus,textarea:focus{…outline:none…}` — vale (0,1,1) **e** está em arquivo carregado depois (`index.html:10`). Portanto, em foco de teclado, `outline:none` vence e o `outline:2px solid var(--gold)` nunca aparece em `input`/`select`/`textarea`. O indicador remanescente é `box-shadow:0 0 0 3px rgba(184,154,98,.16)` sobre `#2c2925` (`ui.css:97`) — um halo a 16% de alfa. `checkbox` se salva porque `ui.css:106` (`input[type=checkbox]:focus-visible`, especificidade (0,2,1)) vence `ui.css:97`. Consequência prática **inferida** (não testada em navegador): foco de teclado e de mouse são indistinguíveis em todos os campos de texto do app — contradizendo `README.md:135` ("foco visível") e `docs/README.md:41`.
2. **Erro de campo não está programaticamente ligado ao campo.** `<small class="error">` não tem `id` (`clients.js:27`, `debts.js:21`), o input não tem `aria-describedby` nem `aria-invalid`, e o `<div class="field">` não muda de estilo com erro (não há seletor `.err`/`:has(.error)` em `css/`). Um leitor de tela que foque o campo **não** recebe a mensagem. Grep: **zero** ocorrências de `aria-describedby`/`aria-invalid` em `src/`.
3. **Dois campos obrigatórios não marcados.** `novalidate:true` (`clients.js:44`, `debts.js:23`, `main.js:15`) desliga a checagem nativa e só `field()` de `main.js:9` usa `required:true`. Nome/razão social, CPF/CNPJ, descrição, valor, taxa e datas são obrigatórios pela validação do serviço (`services/clients.js:8-9`, `services/debts.js:8-12`), mas nenhum input tem `required`, `aria-required` ou qualquer indicação visual de obrigatoriedade.
4. **A região viva do `pager` é recriada a cada pintura.** `kit.js:21` constrói um **novo** `statusEl` em toda chamada, e os chamadores fazem `pg.replaceChildren(pager(…))` (`clientlist.js:20`, `debtspage.js:23`, `clients.js:153`). Regiões `aria-live` normalmente só anunciam quando o **nó já estava no DOM** e seu conteúdo muda — aqui o próprio nó muda. Anúncio de "Mostrando 21–40 de 63 clientes" **provavelmente não ocorre** (*inferido*; os demais live regions do app — `note` `clients.js:20`, `docStatus` `clients.js:23`, `sum` `debtspage.js:7`, `toast` `settings.js:20`, `cnt` `clientlist.js:5` — são nós persistentes e portanto corretos).
5. **`role="alert"` usado em contexto não-alerta.** `clientlist.js:5` cria `cnt=h('p',{class:'count',role:'alert',hidden:true})` para a mensagem "Taxa inválida…". `role="alert"` é *assertivo* e interrompe; para aviso de filtro, `status`/`polite` seria o correspondente. Também não há associação do `cnt` com o campo `#cr` que o origina (sem `aria-describedby`).
6. **Nome acessível duplicado/concorrente nos campos de busca.** `clientlist.js:23` dá `aria-label:'Buscar clientes'` **e** `clientlist.js:28` um `<label class="sr" for="cq">` com texto mais longo — dois rótulos para o mesmo controle. `dashboard.js:4,40` repete o padrão. Em `clientlist.js:24`, `#cr` (taxa) tem `<label for="cr">` via `fld()` (`clientlist.js:29`) mas **`#cq` não é coberto pelo wrapper `.sr` do `clientlist.js:28`** — o `<label>` está no bloco `.search`, então funciona, mas a ordenação DOM (label antes do input) difere do restante do app.
7. **`cr` e `fr` (filtros de taxa) não descrevem o estado do filtro para AT além do texto livre**, e o caso inválido só aparece no `#f-*`… na verdade **sem wrapper**: `clientlist.js:24` cria o input sem `fld()` de erro (o `fld` local, `clientlist.js:22`, não tem slot de erro) — a mensagem "Taxa inválida" vive no `cnt` separado e distante (`clientlist.js:13-14`).
8. **Dois mecanismos de busca com semântica diferente.** Painel: `<form role="search">` com botão submit (`dashboard.js:39-41`). Clientes: `<div class="search">` sem `role` e sem `form` (`clientlist.js:28`). Não há `aria-expanded`/`aria-controls` nem `role="listbox"` nas listas; o resultado da busca de clientes **não** é uma região viva — `out` é `h('div')` puro (`clientlist.js:5`), então atualizações da lista após cada tecla são silenciosas.
9. **Sem navegação por setas em listas ou na paginação.** Não há **nenhum** handler de teclado na UI — `grep keydown|keyup|keypress|Escape` em `src/` só retorna `src/security/auth.js:11-12` (listeners de atividade para bloqueio por inatividade, `passive:true`, sem `preventDefault`). Toda navegação é Tab. `clientlist.js:15-18` renderiza `<ul><li><button class="row">`: 20 abas por página no celular, mais 10+ da paginação. `<dialog>` (`clients.js:128`) herda Esc do navegador; nada mais tem atalho.
10. **Feedback de foco da área de upload é baixo contraste e sem outline.** `ui.css:122` `.file-pick:focus-within{outline:none;border-color:var(--gold)}`, contra a borda tracejada de repouso `rgba(184,154,98,.42)` (`ui.css:119`), 1.5px (`ui.css:119`). O input real está a `opacity:0`, 1×1px e `pointer-events:none` (`ui.css:124`), então o outline de `app.css:36` sobre ele é invisível. Usuário de teclado vê apenas a cor da borda tracejada mudar.
11. **Duas etiquetas `alt` inconsistentes para a mesma fotografia.** Prévia do formulário: `alt:'Fotografia do cliente'` genérico (`clients.js:41`); perfil: `alt:'Fotografia de '+c.name` (`clients.js:139`). Nenhum dos dois é errado, mas a duplicação de código (dois caminhos de prévia) gera dois contratos de texto.
12. **`scrollIntoView({behavior:'smooth'})` não respeita reduced-motion.** `tools.js:61` (erro do Google Drive) pede suavização explicitamente; `ui.css:560` só neutraliza a **propriedade CSS** `scroll-behavior`, que não se aplica quando o comportamento é declarado na API. *Inferido pela especificação; NÃO CONFIRMADO em navegador.*
13. **Limpeza de pré-visualização está acoplada à navegação por `clients.js`, não à saída da tela.** `clean()` (`clients.js:3`) só roda em `render()` (`clients.js:4`) e `A.onLock` (`clients.js:4`). `settings.js:16` e `tools.js:7,32` chamam apenas `unwatch()`. Sair do formulário de cliente direto para Configurações deixa `previewUrl` e o array `urls` com `createObjectURL` vivos até a próxima tela de cliente ou o bloqueio (`clients.js:5,40`). Não afeta AT; é fuga de memória com evidência.
14. **Zoom de texto não verificado.** `app.css:26` fixa `font-size:16px` no `body` e a maioria das escalas é em `rem` (bom), mas muitos `min-height` são em `px` (`ui.css:61,92,118,274,388`) e `main` tem `max-width` fixo (`ui.css:9`). Com 200% de zoom de texto o layout provavelmente cresce verticalmente — **NÃO CONFIRMADO** (nenhum navegador disponível nesta auditoria). `docs/auditoria-ui-ux-codigo.md` registra que **a tela de login já ultrapassa a altura da janela** em vários aparelhos (1121px em 320×480; 1129px em 390×844) e foi deixada de propósito por decisão de design.

---

## 8. Impressão e exportação visual

**`@page` com nome** (`app.css:40`): `@page port{size:A4 portrait;margin:12mm}` e `@page land{size:A4 landscape;margin:10mm}`. O documento escolhe a página pelo token `page:` — `.report{page:port}` (`app.css:41`) e `.report.land{page:land}` (`app.css:44`). A troca é feita em JS trocando a classe: `paper.className='report '+po.value` (`tools.js:25` para visualizar, `tools.js:28` para imprimir), com opções `'Retrato (A4)'`/`'Paisagem (A4)'` (`tools.js:11`).

**"Documento de papel" como componente próprio** — `.report` (`app.css:41-57`) inverte deliberadamente a paleta para `background:#f7f3ea;color:#171717` (`app.css:41`), radius 14px, `padding:clamp(1.1rem,3vw,2rem)`, `font-size:.92rem`, com `h1` em serifa `.letter-spacing:.12em` (`app.css:45`), `thead` em marfim com borda dourada e `text-transform:uppercase` (`app.css:53`), `tfoot` em `#efe9dc` (`app.css:56`), números com `tabular-nums` (`app.css:55`). `.report:empty{display:none}` (`app.css:43`) faz a pré-visualização sumir antes do primeiro `Visualizar relatório` — que é a razão de `if(!paper.childElementCount) throw new Error('Visualize o relatório antes de imprimir.')` (`tools.js:28`). A tabela é fixa com `colgroup` (`tools.js:16`, larguras em `app.css:51`) dentro de `.tw{overflow-x:auto}` (`app.css:47`) e `min-width:600px` (`app.css:50`); a dica de rolagem `.report-hint` só aparece abaixo de 720px (`app.css:48-49`) e some na impressão (`app.css:67`).

**`@media print` — duas camadas complementares:**
- `app.css:59-74`: fundo branco (`html,body`), desliga o halo dourado (`body::before{display:none}`), `main` sem largura/padding (`app.css:62`) e — a regra central — **`main>*:not(.report){display:none!important}`** (`app.css:63`): tudo que não for o documento é removido. Depois reajusta tipografia para papel (`font-size:10pt`), `word-break`, `padding:5.5pt 6pt`, `thead{display:table-header-group}` (repete cabeçalho entre páginas) e `tr{break-inside:avoid}` (`app.css:64-73`).
- `ui.css:566-571`: esconde `#nav`, `.skip`, `.util`, `.pager` (`ui.css:568`) e neutraliza `margin`/`padding`/`max-width` do shell (`ui.css:569-570`).

**Observação estrutural:** o mecanismo de impressão depende do `.report` ser um **filho direto de `#app`** — é exatamente o que `tools.js:29` garante (`show(top, section.card, paper)`). Qualquer refatoração que embrulhe o preview num card faria `app.css:63` **ocultar** o relatório na impressão. Não há `body.printing`, nem `window.onbeforeprint`.

**Exportação que não é impressão:** Excel `.xlsx` por gerador próprio (`tools.js:26-27` → `export/reports.js` + `vendor/fflate`), com download via `save()` de `src/export/lib.js`; backup `.zip` local (`tools.js:40-41`) e envio ao Drive (`tools.js:140`); PDF **não** é gerado pelo app — o botão `Imprimir` (`tools.js:28`) delega ao diálogo do navegador, e documentos PDF anexados são abertos em nova aba (`clients.js:144`) com aviso caso o bloqueador de pop-up intervenha.

---

## 9. Onde modificar X

| Objetivo | Arquivo | Linha/ancora | Passo a passo verificado |
|---|---|---|---|
| **Novo campo no form de CLIENTE** | `src/ui/clients.js` | `clients.js:59-68` (bloco), `clients.js:46` (payload) | 1) chamar `fld('chave','Rótulo','tipo','autocomplete'[,full[,span2]])` dentro de `form-grid`/`address-grid`; o wrapper `#f-<chave>` e o slot de erro são automáticos (`clients.js:27`). 2) adicionar `chave:g('chave')` ao objeto enviado em `S.saveClient` (`clients.js:46`) — `g()` lê `f.elements[chave].value.trim()` (`clients.js:45`). 3) se deve aparecer/ocultar por PF/PJ, adicionar o `querySelector('#f-chave').hidden` em `sync()` (`clients.js:71`). 4) se persiste, entrar em `LABEL` do serviço (`services/clients.js:6`) para o histórico de alterações e no `validate`/`rec` do serviço. 5) se usa máscara, `src/domain/validators.js:6-9` |
| **Novo campo no form de DÍVIDA** | `src/ui/debts.js` | `debts.js:28-35`, `debts.js:25` | mesma sequência com `fld(id,label,{attrs},full)` (`debts.js:21`); adicionar a chave em `saveDebt` payload (`debts.js:25`) e em `services/debts.js:3` (`LABEL`) / `:7` (`validate`) / `:4` (`rec`) |
| **Novo campo em CONFIGURAÇÕES ou BACKUP/DRIVE** | `src/ui/settings.js`, `src/ui/tools.js` | `settings.js:46-62`, `tools.js:5` | aqui `fld` **não tem slot de erro** — feedback é `flash()` (`settings.js:23`) ou `err`/`ok` (`tools.js:33`). O serviço de preferência é o padrão `get*/set*` de `src/services/settings.js` (ex.: `getDueWindow`/`setDueWindow`, `settings.js:5`) |
| **Nova TELA** | `src/ui/` (arquivo novo) + `src/main.js` + `src/ui/shell.js` + `sw.js` | `main.js:3`, `main.js:65`; `shell.js:28-36`, `shell.js:53` | 1) criar `src/ui/x.js` exportando `xView(ctx)` que usa `ctx().h` e `ctx().show`; montar cabeçalho com `h('header',{class:'top','data-page':'x'}, …)` seguindo `tools.js:3-4`. 2) importar e registrar o callback em `initShell` (`main.js:65`). 3) adicionar `item('x','Rótulo','icone',()=>x(ctx()))` no `nav.replaceChildren` (`shell.js:28-36`) e, se a tela tem pai lógico, mapear `data-page`→`data-k` no regex de `shell.js:53`. 4) **chamar `unwatch()`** na entrada (`settings.js:16` é o modelo). 5) **acrescentar o módulo a `FILES` em `sw.js:2` e incrementarm `V`** (`sw.js:1`). 6) se o botão de ação precisa de ícone automático, registrar a regex em `shell.js:5-9` |
| **Novo COMPONENTE compartilhado** | `src/ui/kit.js` | `kit.js:1-39` | seguir o contrato dos vizinhos: receber **`h` como 1º argumento** (`filePicker` `kit.js:8`) **ou** receber o agregado `U`/`{h}` (`pager` usa `h` externo; `clientList`/`page`/`section`/`form`/`bulk` usam `U` — `clientlist.js:4`, `debtspage.js:5`, `debts.js:4,19,43`). Exportar named function + JSDoc de 1 linha em português. Importar `icon` de `./icons.js` se precisar de glifo (`kit.js:2`). Depois: mesma atualização de `sw.js` |
| **Componente com estado próprio** | `src/ui/` | `dashboard.js:3` (via props), `avatar.js:13` (via módulo) | dois padrões possíveis: **(a)** injeção de callbacks (`{h,search,openClient,…}` — `main.js:47`) ou **(b)** módulo com cache próprio e `U`-facade (`avatar.js:5-12`, `clients.js:12`). Não misturar: `clients.js` depende do singleton `X` (`clients.js:2`), que só é preenchido por `clientsView`/`debtsPageView`/`openProfile` (`clients.js:13-15`) |
| **Mudar TOKEN DE COR** | `css/app.css` | `app.css:5-19` | alterar a variável. **Antes disso, verificar se o valor pretendido não está hardcoded**: `#080808` em `ui.css:13,28,70,195,391,412,415,502`; `#272420` (hover) em `ui.css:96,121,122,133,191,363`; `#2c2925` (focus) em `ui.css:97`; `#2a2723` em `ui.css:103`; `#302c27` em `ui.css:104,117`; `#121211` em `ui.css:502`; `rgba(184,154,98,…)` à mão em `app.css:29,99` e `ui.css:205,212,214,306,307,309,318,325`. Cor do papel do relatório **não** vem de token (`app.css:41-57`). Cor do ícone do `<select>` é SVG embutido em data-URI (`ui.css:99`), igual ao check do checkbox (`ui.css:105`) — ambos precisam de edição manual do `stroke='%23…'`. Atualizar também `theme-color` (`index.html:4`), `background_color`/`theme_color` (`manifest.json`) e as capturas/README (`README.md:142`) se a paleta for oficial |
| **Novo BREAKPOINT** | `css/ui.css` | cabeçalho `ui.css:3`; faixas em `500`, `519`, `537`, `545`, `550`, `554` | decidir se é breakpoint **estrutural** (muda shell/nav — então precisa casar com `ui.css:500`/`ui.css:519` e com o comentário de `ui.css:3` e `docs/README.md:28`) ou **componente** (só a regra local). Usar `min-width` mobile-first; se criar um `max-width:X`, **não** usar também `min-width:X` para o mesmo componente (colisão em X exato — ver §10). Lembre-se de que `main` tem três larguras máximas (`ui.css:9,513,528`) e que `ui.css:513`/`ui.css:528` limitam os filhos de `main` — um breakpoint acima de 1100px pode não ter efeito sobre o conteúdo |
| **Adicionar ÍCONE** | `src/ui/icons.js` | `icons.js:2-41` (novo par `nome:'d'`), `icons.js:43-47` | 1) um único `d`, grade 24×24, traço 1.5, sem `fill` (`icons.js:1`). 2) opcional: regex de auto-aplicação em `shell.js:5-9` (âncora `^`, primeira que casar vence). 3) **incrementarm `V` em `sw.js:2`**. Nome inexistente cai em `info` silenciosamente (`icons.js:47`) — sem erro de runtime |
| **Mudar tamanho de página de listagem** | `src/ui/…` | `clientlist.js:3` (20), `debtspage.js:4` (10), `clients.js:146` (5) | valor isolado por arquivo; sincronizar com `docs/README.md:34` |

---

## 10. Inconsistências e dívidas técnicas observadas

**A. Camada de componente duplicada (mesmo conceito, N implementações)**

1. **`top()` em 3 cópias divergentes** — `clients.js:9-11` (aceita `...a` e renderiza `div.actions`), `settings.js:12-13` (sem `page`, fixa `'settings'`), `tools.js:3-4` (com `page`, sem ações). O parâmetro `...a` de `clients.js:9` **nunca é usado**: as duas chamadas (`clients.js:124`, `clients.js:159`) passam apenas 3 argumentos → `clients.js:11` é código morto, assim como `header.top>.actions` em `ui.css:41`. `dashboard`/`auth` (`main.js:51-53`, `main.js:34-36`) montam cabeçalhos **ad hoc**, sem `top()`.
2. **`fld()`/`field()` em 5 assinaturas incompatíveis** — `clients.js:27`, `debts.js:21`, `tools.js:5`, `clientlist.js:22`, `main.js:9`. Duas delas registram erros (`fe`), três não registram. Uma delas recebe `h` como argumento (`tools.js:5`), as outras capturam por closure. Adicionar um campo novo exige ler qual variante está em jogo.
3. **`row()` (par `dt`/`dd`) em 2 cópias** — `clients.js:141` (com `wide`) vs `settings.js:26` (sem). A coluna `wide` só existe no primeiro (`ui.css:398`).
4. **`dBR` (ISO → `dd/mm/aaaa`) reescrito 4 vezes** — `debts.js:3`, `debtspage.js:4`, `tools.js:2`, `src/export/reports.js:3`, **apesar de** `kit.js:5` já exportar `day()` exatamente para isso. Consequência: `day` é o único export de `kit.js` com **zero importadores** (`clients.js:1`, `clientlist.js:1`, `dashboard.js:1`, `debtspage.js:2`, `tools.js:1` — nenhum importa `day`) e as 4 cópias divergem na regra de vazio: `debts.js:3`/`tools.js:2` aceitam `''`→`'—'`, `debtspage.js:4` **lança** em `undefined`.
5. **Formatação de bytes duplicada com comportamento diferente** — `kb()` em `clients.js:6` (KB/MB, sem decimal em KB, sem vírgula) vs `mb()` em `settings.js:11` (MB/GB, com `,` decimal, caso `null`→`indisponível`). Dois formatos para o mesmo dado na mesma aplicação.
6. **`run(fn)` em 2 cópias** — `clients.js:137` (re-renderiza `profile(id)` após) vs `tools.js:13` (só captura). Mesma assinatura, efeitos diferentes.
7. **Dois contratos de "props de tela" coexistem** — o facade `U = {h, render, top}` (`clients.js:12`), usado por `clientlist`/`debts`/`debtspage`; e o `ctx` cru `X = {h, show, fmt, home}` (`main.js:7`), consumido diretamente por `settings.js:17` e `tools.js:7,32`. Diferença observável: `U.render` passa por `clean()` (`clients.js:4`) — `X.show` **não** (`main.js:6`). Por isso Configurações e Backup nunca liberam os object URLs da tela anterior (§7.3 item 13).

**B. Duplicação e sobreposição de CSS**

8. **Colisão de breakpoints em exatamente 560px** — `@media(max-width:560px)` (`ui.css:130`, `281`, `364`) **e** `@media(min-width:560px)` (`ui.css:84`, `181`) são ambos verdadeiros em `width:560px`. Em 560px o `.file-pick` recebe simultaneamente `min-height:156px` (`ui.css:130`) e a grade do tablet `minmax(0,1fr)` (`ui.css:184`). Os pares complementares corretos existem no mesmo arquivo (`max-width:719` `ui.css:300`/`341` vs `min-width:720` `ui.css:215`/`537`), o que torna o 560 claramente um descuido de convenção.
9. **Documentação do breakpoint da navegação diverge do código** — `docs/README.md:28` afirma "barra inferior até **719** px, rail de 96px de **720** a 1099 px"; `ui.css:500` é `@media(min-width:768px)` e o cabeçalho do próprio `ui.css:3` diz "< 768". Entre **720–767px** o app tem formulários de 2 colunas, `.stats` de 3 colunas e `.meta` de 2 colunas (`ui.css:215`, `ui.css:537`) dentro da **barra inferior de celular** de 5 itens a 46px (`ui.css:489`).
10. **Especificidade/ordem decidindo sobreposição de regra de foco** — descrito em §7.3 item 1: `app.css:36` (`:where`, especificidade 0,1,0) vs `ui.css:97` (`input:focus`, 0,1,1, em arquivo posterior). Não há camada de sobreposição: é a ordem de `index.html:10` que resolve.
11. **Modificador de tamanho de avatar anulado dentro do `media-field`** — o nó de prévia nasce com `class:'avatar avatar--lg'` (`clients.js:18`), mas `.media-field>.avatar` (`ui.css:171`, especificidade 0,2,0) declara `width`/`height`/`border-radius` e **vence** `.avatar--lg` (`ui.css:251`, especificidade 0,1,0) independentemente da ordem no arquivo. Resultado: dentro de `.media-field`, os 88px de `--lg` nunca se aplicam — apenas `font-size:1.6rem` escapa, porque `ui.css:171` não declara `font-size`. O mesmo nó é estilizado por duas regras concorrentes e o tamanho efetivo vem de `--photo-size` (`ui.css:165`), de modo que a classe `--lg` é enganosa nesse contexto.
12. **Seletor global que vaza entre telas** — `ui.css:24-25` (`h2{font-size:1.34rem}`, `h3{…}`) e `ui.css:92` (`input,select,textarea{…}`), `ui.css:101` (`textarea{min-height:120px}`), `ui.css:114-117` (`input[type=file]`) são **element selectors sem escopo de tela**. Como não há prefixo por rota, `ui.css:81` (`.actions button{min-height:44px;…}`) e `ui.css:130` (`.card>.actions button{flex:1 1 100%}` abaixo de 560px) valem para **qualquer** card de **qualquer** tela. O `dialog.viewer` (`ui.css:420`) é o único elemento montado fora de `#app` (`clients.js:128`), e por isso é estilizado por classe específica — bom — mas `body.shell`/`body:not(.shell)`/`body.authing` (`ui.css:11,426,439`) são três estados globais de `body` que se sobrepõem sem um mapa declarando o que cada um significa.
13. **Superfícies de hover/foco fora do sistema** — `#272420`, `#2c2925`, `#302c27` aparecem 9 vezes como hex solto (`ui.css:96,97,104,117,121,122,133,191,363`) sem token `--surface-hover`/`--surface-focus`. Uma mudança da escala de grafite hoje exige caça a 9 literais.
14. **Override de `.drive-card` compensando regras globais** — `ui.css:362-363` redeclara `background`/`color` para `button.ghost` dentro de `.drive-body`, exatamente porque `ui.css:72` (`.ghost{background:transparent;color:var(--muted)}`) não satisfaz o layout do cartão. É override de componente por componente, sem camada de tema.

**C. Regras e exports mortos (verificado por grep em `src/` + `index.html`)**

15. **Tokens nunca referenciados:** `--line` e `--bronze` (`app.css:7`, 0 usos) e `--r-md`/`--r-sm` (`app.css:14`, 0 usos) — enquanto a mesma cor do `--bronze` está escrita como literal `#34302a` em `app.css:45,53`.
16. **Classes CSS sem uso:** `.btn-block` (`ui.css:79`), `.window-form` (`ui.css:158`), `.avatar--xl` (`ui.css:252`), `.row .chev` (`ui.css:247`) — esta última nunca casa: `chevron` é renderizado como `svg.i` (`icons.js:46`), e nenhum `h('…',{class:'chev'})` existe. Consequência real: o chevron das linhas de cliente (`clientlist.js:17`, `dashboard.js:21`) fica com `color` herdado do `.row`, não o `--faint` pretendido.
17. **Bloco de estilo de `<input type=file>` inteiro morto** — `ui.css:114-117` estiliza o controle nativo, mas **todos** os inputs de arquivo do app passam por `filePicker`, que os esconde com `.file-input{opacity:0;position:absolute;width:1px;height:1px}` (`kit.js:9`, `ui.css:124`). Os 4 usos estão em `clients.js:55,176`, `tools.js:88,206`; o quinto (`rep`, `clients.js:140`) é `hidden:true`. `input::file-selector-button` (`ui.css:115`) nunca renderiza.
18. **3 ícones definidos e inalcançáveis:** `mail` (`icons.js:27`), `calendar` (`icons.js:36`), `filter` (`icons.js:39`). Não há chamada `icon('mail')`, `icon('calendar')`, `icon('filter')` nem regex em `MAP` (`shell.js:5-9`) que os referencie. Nota: `phone` (`icons.js:26`) e `id` (`icons.js:29`) só aparecem como *nomes de campo* em `clients.js`, nunca como ícone — também inalcançáveis na prática.
19. **Export `day` sem consumidor** (`kit.js:5`) — ver A.4.

**D. Fragilidades de contrato / race**

20. **`watch` é um slot único** (`live.js:2`: `let cb=null`). `clients.js` renderiza dívida→perfil→lista aninhando chamadas, e `debts.js:4` (`section`) é `await`ado dentro de `profile` (`clients.js:135`) sem registrar watch — mas `clientlist.js:32` e `debtspage.js:37` registram. Como `debtsPageView` (`clients.js:14`) chama `P.page` que faz `watch(load)`, e abrir o formulário de dívida **não** dessregistra, uma gravação enquanto o form de dívida está aberto dispara `load()` da **página de dívidas por baixo** do formulário. `NÃO CONFIRMADO` em execução; o mecanismo é legível em `live.js:2` + `debtspage.js:37` + `debts.js:40`.
21. **`icon()` silencioso em nome errado** (`icons.js:47`): `P[n]||P.info`. Um typo produz um `ℹ` no meio da interface em vez de um erro. Sem teste cobrindo UI (`tests/` contém apenas `address`, `apicpf`, `backup`, `crypto`, `money`, `stage4`, `validators` — nenhum teste de componente/ícone).
22. **Textos literais são a chave do sistema de ícones e de `.danger`** — `shell.js:5-9` casa `^Novo cliente`, `^Excluir|Remover`, `^Confirmar`, `^Salvar janela`, `^Juros em lote` etc. contra `b.textContent` (`shell.js:59`). Renomear um rótulo em `clients.js:70`/`debts.js:58`/`settings.js:62` **silencia** o ícone e/ou remove o estilo destrutivo. Exemplo concreto: o botão `'Restaurar'` (`tools.js:48,165`) recebe `upload` (`shell.js:8`), a mesma régua que `'Verificar arquivo'`.
23. **Sombra do `.mark` e `overflow:visible` competem com a identidade** — `ui.css:28` usa `overflow:visible` **junto** com `border-radius:0` para cumprir `docs/README.md:39` ("sem contorno, sombra ou cantos arredondados"). Qualquer futuro `border-radius` no `.mark` recortará a moldura dourada do chapéu; o comportamento está garantido apenas por dois valores numéricos sem teste.
24. **`shell.js:37`/`shell.js:40` — `util` declarado duas vezes** (função externa e `const util=h('div',…)` interno ao `for`). Funciona por sombreamento de bloco, mas o `hd.append(util)` (`shell.js:44`) depende de leitura atenta para saber qual `util` é. Mesma função roda **em cada MutationObserver** (`shell.js:47-63`), protegida só por `querySelector(':scope > .util')` (`shell.js:39`).

---

### Anexo — arquivos lidos nesta auditoria

`index.html` (11 l.), `css/app.css` (74), `css/ui.css` (571), `src/ui/kit.js` (39), `src/ui/icons.js` (47), `src/ui/shell.js` (64), `src/ui/avatar.js` (29), `src/ui/clientlist.js` (34), `src/ui/clients.js` (186), `src/ui/debts.js` (70), `src/ui/debtspage.js` (38), `src/ui/dashboard.js` (43), `src/ui/settings.js` (64), `src/ui/tools.js` (208). Apoio lido por dependência direta: `src/main.js` (65), `src/core/live.js` (2), `src/db/idb.js:30`, `src/services/clients.js:1-32`, `src/services/debts.js:1-20`, `src/domain/validators.js`, `src/domain/money.js`, `sw.js` (5), `manifest.json`, `README.md:104-160`, `docs/README.md:24-43`, `docs/auditoria-ui-ux-codigo.md`.
