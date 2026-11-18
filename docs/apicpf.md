# Validação de CPF com a APICPF

A validação de CPF usa a API pública da APICPF, mas a chave **nunca** chega ao navegador. O frontend chama apenas a função serverless `api/cpf.js`, que lê a chave da variável de ambiente `APICPF_API_KEY` e repassa a consulta para `https://apicpf.com/api/consulta`.

## Como o recurso funciona hoje

1. O formulário valida o dígito verificador localmente antes de chamar o servidor. CPF estruturalmente inválido mostra **Inválido** em vermelho sem gastar consulta (`src/services/apicpf.js:8`).
2. O navegador envia **`POST /api/cpf`** com o corpo `{"cpf":"11 dígitos"}`. O número **não vai mais na URL** do trecho navegador→função: nada de `?cpf=` em log de intermediário, histórico do navegador ou APM nosso (`src/services/apicpf.js:28-33`).
3. A função confere método, `content-type`, origem e cota **antes** de gastar qualquer consulta paga (`api/cpf.js:94-100`), valida o CPF (`api/cpf.js:106`) e só então lê a chave (`api/cpf.js:108-109`).
4. A função repassa à APICPF por **`GET` com query string** (`api/cpf.js:114`). Esse é o contrato do provedor e não é nosso para mudar. A chave viaja apenas no header `X-API-KEY` desse salto servidor→provedor.
5. O app normaliza o que volta: `trim` no nome, gênero aceito só quando é `M`, `F` ou `I`, e data de nascimento só no formato `AAAA-MM-DD` (`src/services/apicpf.js:39-41`). Nome, nascimento e gênero entram apenas nos campos ainda vazios e continuam editáveis.

**O que a mudança não é.** A assimetria entre as duas pernas é deliberada e precisa continuar escrita: mover o CPF para o corpo elimina o número da URL **no trecho sob o nosso controle**; o número continua na URL do salto servidor→APICPF, porque o contrato do provedor é `GET` com query string. O `GET /api/cpf?cpf=` legado também continua aceito (`api/cpf.js:71-77`): bundles pré-cacheados em aparelhos já instalados chamam a forma antiga até o Service Worker atualizar. E nada disto é autenticação — a checagem de origem compara um header controlado pelo cliente.

## Configuração da chave

Na Vercel:

1. Abra o projeto em **Project Settings › Environment Variables**.
2. Crie `APICPF_API_KEY` com a chave fornecida pela APICPF.
3. Marque os ambientes desejados (Production, Preview e Development).
4. Faça um novo deploy.

Para desenvolvimento local com a função, use `vercel dev` com a variável definida no arquivo `.env` (não versionado). Em servidor estático puro, como o GitHub Pages, `/api/cpf` não existe: o formulário continua funcionando e a validação fica manual.

## Variáveis de ambiente da função

Todas são lidas **a cada requisição** (`api/cpf.js:15-17`), de modo que mudar o valor e redeployar basta — não há valor em estado de módulo. Os placeholders estão em `.env.example`. O default entre parênteses vale quando a variável está ausente, vazia, não numérica ou `<= 0` (`api/cpf.js:15`).

| Variável | Default | O que faz |
|---|---|---|
| `APICPF_API_KEY` | ausente → `503 UNAVAILABLE` | chave da APICPF. Sem ela nenhuma consulta sai para o provedor |
| `SCIPIONE_ALLOWED_ORIGINS` | vazio = só o host da requisição | origens extras aceitas na checagem de `Origin`/`Referer`, separadas por vírgula (URLs de preview fixas, outro domínio). O host do próprio deploy já é aceito sem listar |
| `CPF_QUOTA_WINDOW_MS` | `60000` (1 minuto) | largura da janela fixa da cota contada em memória |
| `CPF_QUOTA_PER_IP` | `30` | requisições por IP dentro da janela |
| `CPF_QUOTA_PER_INSTANCE` | `300` | requisições por instância aquecida dentro da janela — é o trava-custos contra quem rotaciona IP |

## O que aparece quando o teto é atingido

A função devolve `429` com `{"ok":false,"reason":"RATE_LIMITED"}` e header `Retry-After` em segundos (`api/cpf.js:100`). O cliente não conhece esse código: ele cai no mesmo caminho silencioso de `UNAVAILABLE` que já existia (`src/services/apicpf.js:47`) e o status apenas desaparece (`src/ui/clients.js:93`). **A interface não mudou** — o usuário vê o que sempre viu quando a consulta não acontece: nenhum aviso, preenchimento automático ausente, campos livres para digitação manual. O mesmo silêncio cobre `403` (origem), `413` (corpo acima de 1 KiB) e `415` (`content-type` errado).

O app faz uma chamada por CPF consultado e guarda o resultado 30 minutos na memória da aba (`src/services/apicpf.js:3,43`), então 30 pedidos por minuto por IP não apertam o uso real de quem digita cadastros.

## Teto de custo real: regra de rate limit na WAF (passo manual, fora do repositório)

A cota acima vive na memória de **cada instância aquecida e por região** (`api/cpf.js:19-22`): não é limite distribuído. Quem rotaciona IP circorna o teto por IP, e o teto por instância só vale naquela instância. O teto de custo efetivo é uma regra de rate limit do **Vercel Firewall, criada no dashboard** — ela não cabe no repositório porque `vercel.json` só permite as ações `challenge` e `deny` como código (nada de rate limit, `log`, `bypass` ou `redirect`) e o SDK `@vercel/firewall` é dependência externa, que o projeto não admite.

Passos no painel da Vercel (documentação oficial da plataforma, consultada em 2026-11-18):

1. **Dashboard** → selecionar o projeto → **Firewall** na barra lateral.
2. **Configure** (canto superior direito) → **+ New Rule**.
3. Nome da regra: `rate-limit-api-cpf`. Condição **If**: `Request Path` · `Equals` · `/api/cpf`.
4. Ação **Then**: **Rate Limit** · estratégia **Fixed Window** · **Time Window** `60` s · **Request Limit** `60` · chave **IP**.
5. Ação final: **Too Many Requests (429)**.
6. **Criar primeiro como `Log`** — a ação `Log` não bloqueia nada e existe justamente para medir o efeito antes de ativar. Observar o tráfego **10 minutos** no overview do Firewall, filtrando pela regra customizada, e só então trocar para `429`.
7. **Save Rule** → **Review Changes** → **Publish**. Sem o Publish a regra não vale em produção: é passo de publicação, não de deploy.

Limites da plataforma que interferem na decisão: no plano Hobby são **1 regra de rate limit por projeto** (dentro do total de 3 regras customizadas), chaves disponíveis **IP** e **JA4 Digest**, janela fixa entre **10 s e 10 min**, e o contador de rate limit é **por região** — o mesmo tipo de lacuna da cota em código. Custo de requisições bloqueadas na borda é o que a regra elimina; a cota em código não elimina nada cobrado pelo provedor, porque ela decide antes de chamar o provedor e, por isso, também protege a cota.

## Fluxo

- Apenas pessoas físicas consultam a API. Para CNPJ, o preenchimento é manual e nenhuma chamada é feita.
- O formulário valida o dígito verificador localmente antes de chamar o servidor. CPF estruturalmente inválido mostra **Inválido** em vermelho sem gastar consulta.
- Quando a API confirma o documento, aparece **Validado** em verde abaixo do CPF. Nome, data de nascimento e gênero são preenchidos somente se os campos ainda estiverem vazios, e continuam editáveis.
- A resposta da API é mantida em cache na memória da aba por 30 minutos. Digitar o mesmo CPF novamente não repete a consulta.
- Se o aparelho estiver offline, a API estiver indisponível, a chave estiver ausente, o limite diário de 100 consultas do provedor for atingido ou a cota local estourar (`429`), nenhum aviso de erro é exibido: o status desaparece e todos os campos permanecem livres para preenchimento manual.
- A função serverless aplica timeout de 8 segundos (`api/cpf.js:12`) e devolve apenas dados normalizados. Erros da APICPF não são repassados ao navegador, e o CPF consultado nunca é ecoado em nenhuma resposta.

## Endpoint oficial do provedor

- Requisição: `GET https://apicpf.com/api/consulta?cpf=<11 dígitos>`
- Autenticação: cabeçalho `X-API-KEY`
- Resposta de sucesso: `data.nome`, `data.genero` (`M`, `F` ou `I`) e `data.data_nascimento` (`YYYY-MM-DD`)
- Erros relevantes: `400`/`404` para CPF inválido ou não encontrado; `401`/`403` para chave; `402` para créditos de base externa; `429` para limites diário, por minuto ou de consultas repetidas

Erros do provedor nunca chegam ao navegador como estão: `400`/`404` viram `422 INVALID` e todo o resto vira `503 UNAVAILABLE` (`api/cpf.js:124-130`).

Limites do plano gratuito: 100 consultas diárias e 6 por minuto. Consulte a [documentação oficial](https://www.apicpf.com/docs) e os [planos](https://www.apicpf.com/planos) para detalhes atualizados.

## Nossa rota

- `POST /api/cpf` com `Content-Type: application/json` e corpo `{"cpf":"52998224725"}` — caminho do app atual.
- `GET /api/cpf?cpf=...` — forma legada, ainda aceita; deprecada, sai de cena quando não houver mais instalação antiga com bundle pré-cacheado.
- Respostas: `200` com `{ok:true,data:{name,gender,birth}}`, ou `{ok:false,reason}` com `405 METHOD`, `415 TYPE`, `403 ORIGIN`, `429 RATE_LIMITED` (+ `Retry-After`), `413 TOO_BIG`, `422 INVALID`, `503 UNAVAILABLE`. Contrato completo em `docs/API.md`.
- Toda resposta sai com `Cache-Control: no-store` (`api/cpf.js:30`).

## Privacidade

O CPF consultado sai do aparelho apenas quando o usuário preenche o campo e há conexão. O cofre, os documentos, as dívidas e o histórico continuam locais e criptografados. A função serverless não registra a chave nem os dados retornados, e o cache do frontend existe apenas na memória da aba. Duas ressalvas que precisam continuar escritas aqui, porque a mudança de transporte não as resolveu: o número ainda aparece na URL da chamada que a função faz ao provedor (`api/cpf.js:114`), e a política de retenção de logs da plataforma de hospedagem está fora do controle e da medição deste repositório.
