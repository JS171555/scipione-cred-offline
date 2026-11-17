# Validação de CPF com a APICPF

A validação de CPF usa a API pública da APICPF, mas a chave **nunca** chega ao navegador. O frontend chama apenas a função serverless `api/cpf.js`, que lê a chave da variável de ambiente `APICPF_API_KEY` e repassa a consulta para `https://apicpf.com/api/consulta`.

## Configuração da chave

Na Vercel:

1. Abra o projeto em **Project Settings › Environment Variables**.
2. Crie `APICPF_API_KEY` com a chave fornecida pela APICPF.
3. Marque os ambientes desejados (Production, Preview e Development).
4. Faça um novo deploy.

Para desenvolvimento local com a função, use `vercel dev` com a variável definida no arquivo `.env` (não versionado). Em servidor estático puro, como o GitHub Pages, `/api/cpf` não existe: o formulário continua funcionando e a validação fica manual.

## Fluxo

- Apenas pessoas físicas consultam a API. Para CNPJ, o preenchimento é manual e nenhuma chamada é feita.
- O formulário valida o dígito verificador localmente antes de chamar o servidor. CPF estruturalmente inválido mostra **Inválido** em vermelho sem gastar consulta.
- Quando a API confirma o documento, aparece **Validado** em verde abaixo do CPF. Nome, data de nascimento e gênero são preenchidos somente se os campos ainda estiverem vazios, e continuam editáveis.
- A resposta da API é mantida em cache na memória da aba por 30 minutos. Digitar o mesmo CPF novamente não repete a consulta.
- Se o aparelho estiver offline, a API estiver indisponível, a chave estiver ausente ou o limite diário de 100 consultas for atingido, nenhum aviso de erro é exibido: o status desaparece e todos os campos permanecem livres para preenchimento manual.
- A função serverless aplica timeout de 8 segundos e devolve apenas dados normalizados. Erros da APICPF não são repassados ao navegador.

## Endpoint oficial

- Requisição: `GET https://apicpf.com/api/consulta?cpf=<11 dígitos>`
- Autenticação: cabeçalho `X-API-KEY`
- Resposta de sucesso: `data.nome`, `data.genero` (`M`, `F` ou `I`) e `data.data_nascimento` (`YYYY-MM-DD`)
- Erros relevantes: `400`/`404` para CPF inválido ou não encontrado; `401`/`403` para chave; `402` para créditos de base externa; `429` para limites diário, por minuto ou de consultas repetidas

Limites do plano gratuito: 100 consultas diárias e 6 por minuto. Consulte a [documentação oficial](https://www.apicpf.com/docs) e os [planos](https://www.apicpf.com/planos) para detalhes atualizados.

## Privacidade

O CPF consultado sai do aparelho apenas quando o usuário preenche o campo e há conexão. O cofre, os documentos, as dívidas e o histórico continuam locais e criptografados. A função serverless não registra a chave nem os dados retornados, e o cache do frontend existe apenas na memória da aba.