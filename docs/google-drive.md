# Backup no Google Drive

O SCIPIONE CRED pode enviar e restaurar backups diretamente no Google Drive, sem
substituir o backup local. A integração é feita no navegador com OAuth 2.0
(Google Identity Services) e a Drive API v3.

## Cliente OAuth configurado

O projeto já vem com um cliente OAuth do tipo **Aplicativo da Web** em
`src/config/google.js`. A origem de produção autorizada é
`https://scipione-cred-offline.vercel.app`; nela, basta clicar em
**Conectar Google Drive**.

Para testar em `localhost`, em um domínio próprio ou no GitHub Pages, adicione
a origem exata em **Origens JavaScript autorizadas** no Google Cloud. Também é
possível importar o JSON desse cliente em **Backup → Google Drive**.

O JSON inicialmente fornecido era de um cliente **instalado** (`installed`) e
não é usado no navegador. O `client_secret` não é usado pelo aplicativo e não
deve ser colocado no repositório; a interface usa apenas o `client_id` público.

## Configuração no Google Cloud

1. Abra o [Google Cloud Console](https://console.cloud.google.com/) e selecione
   o projeto do arquivo JSON.
2. Em **APIs e serviços → Biblioteca**, ative a **Google Drive API**.
3. Em **APIs e serviços → Tela de consentimento OAuth**, configure o app e
   adicione o escopo `https://www.googleapis.com/auth/drive.file`. Em modo de
   teste, inclua sua conta em **Usuários de teste**.
4. Em **APIs e serviços → Credenciais**, crie um **ID do cliente OAuth** do tipo
   **Aplicativo da Web**.
5. Em **Origens JavaScript autorizadas**, adicione todas as origens usadas:
   - `https://scipione-cred-offline.vercel.app` (já configurada no projeto);
   - `http://localhost` e a porta local, por exemplo `http://localhost:8120`;
   - o domínio do GitHub Pages, se for usado.
6. Baixe o JSON do cliente Web. Se for o mesmo cliente já configurado, não é
   necessário importar. Para outro cliente ou outra origem, importe-o em
   **Backup → Google Drive → Selecionar JSON do Google Cloud**.

## Como funciona

- O acesso usa o escopo mínimo `drive.file`: o app só vê os backups que ele
  mesmo criou.
- Os arquivos ficam na pasta `SCIPIONE CRED - Backups`.
- Antes de enviar, o app calcula o SHA-256 do ZIP e guarda o hash nos
  `appProperties` do arquivo. Ao restaurar, o hash é conferido novamente e o
  próprio backup valida o `manifest.json` e os arquivos internos.
- O token de acesso fica somente na memória da aba. Recarregar a página ou
  desconectar exige uma nova autorização.
- O backup local continua idêntico: geração do ZIP, criptografia opcional,
  arquivo escolhido, senha, modos mesclar/substituir e confirmação.

## Requisitos e limites

- É necessária conexão com a internet para autenticar, listar, enviar e baixar.
  O backup local continua disponível offline.
- A Drive API precisa estar ativada no projeto e a conta precisa autorizar o
  escopo.
- Se o navegador bloquear a janela de autorização, permita pop-ups para o site.
- A Vercel envia `Cross-Origin-Opener-Policy: same-origin-allow-popups` para
  manter a janela do Google Identity Services funcional.

## Erro 403 `access_denied` (app em teste)

Se o Google mostrar **“Acesso bloqueado”** e informar que o app está em teste,
significa que a conta usada no popup não está na lista de testadores do projeto
que possui o cliente OAuth ativo. Isso não é um erro do SCIPIONE CRED.

O cliente ativo hoje é:

`236359551321-aedlnkvretokom2516a4bq6m562b4shv.apps.googleusercontent.com`

O cliente atual pertence ao projeto **`optimum-habitat-447421-c4`**
(número `236359551321`). Ele é diferente do projeto antigo
`oval-turbine-457821-h3` (número `662732522717`). Testadores cadastrados no
projeto antigo **não valem** para este cliente.

1. No Google Cloud, selecione o projeto **`optimum-habitat-447421-c4`**.
2. Abra [Google Auth Platform → Audience](https://console.cloud.google.com/auth/audience?project=optimum-habitat-447421-c4)
   e confirme **External** e o status **Testing**.
3. Em **Test users**, adicione exatamente o e-mail usado no popup, por exemplo
   `js1715557@gmail.com`, e clique em **Save**.
4. Em **Data Access**, confirme o escopo
   `https://www.googleapis.com/auth/drive.file`.
5. Confirme que a **Google Drive API** está ativada nesse mesmo projeto.

No app, clique em **Backup → Google Drive → Trocar configuração** para remover
qualquer JSON antigo salvo neste navegador. Recarregue a página e conectar
novamente. O popup usa **seleção de conta**; escolha exatamente a conta
cadastrada como testadora.

### Se os testadores foram cadastrados no projeto antigo

Há duas saídas:

- **Continuar no cliente atual:** cadastre o testador no projeto que possui o
  cliente `236359551321-...`.
- **Voltar ao cliente do projeto antigo:** use o cliente
  `662732522717-8b9g4pk169fjgpji19q8chbhvf9bj06v.apps.googleusercontent.com`
  (projeto `oval-turbine-457821-h3`), onde os testadores já foram cadastrados.
  O JSON desse cliente pode ser importado em **Trocar configuração**.

Se o projeto estiver com **User type: Internal**, uma conta Gmail não poderá
autorizá-lo. Nesse caso, use um projeto com **External** ou publique o app.

Ainda com 403 depois disso? Aguarde alguns minutos e teste em uma janela
anônima. Se o erro continuar, o problema está na configuração do projeto no
Google Cloud, não no código do SCIPIONE CRED: o Google bloqueia antes de
qualquer chamada à Drive API.

## Erros comuns

| Erro | Causa provável | Correção |
| --- | --- | --- |
| `invalid_client` / `no registered origin` | Cliente instalado ou origem não autorizada | Usar o cliente Web configurado ou adicionar a origem |
| `origin_mismatch` | Origem atual fora da lista | Adicionar a origem exata no Google Cloud |
| `access_denied` / Erro 403 | App em teste e conta fora dos testadores, ou consentimento cancelado | Incluir o e-mail em **Usuários de teste** ou publicar o app |
| Drive API desativada | API não habilitada no projeto | Ativar a Google Drive API |
| Sessão expirada | Token de acesso venceu | Clicar em **Conectar Google Drive** novamente |
