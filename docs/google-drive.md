# Backup no Google Drive

O SCIPIONE CRED pode enviar e restaurar backups diretamente no Google Drive, sem
substituir o backup local. A integração é feita no navegador com OAuth 2.0
(Google Identity Services) e a Drive API v3.

## Por que é necessário um cliente OAuth “Aplicativo da Web”

O JSON fornecido para este projeto é de um cliente **instalado** (`installed`).
O Google bloqueia esse tipo no fluxo de navegador com o erro
`invalid_client / no registered origin`. Para a integração funcionar no
localhost e na Vercel, crie um cliente do tipo **Aplicativo da Web**.

O `client_secret` não é usado pelo aplicativo e não deve ser colocado no
repositório. A interface usa apenas o `client_id` público.

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
   - `http://localhost` e a porta local, por exemplo `http://localhost:8120`;
   - `https://SEU-PROJETO.vercel.app`;
   - o domínio do GitHub Pages, se for usado.
6. Baixe o JSON do cliente Web e importe-o em **Backup → Google Drive →
   Selecionar JSON do Google Cloud**.

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

## Erros comuns

| Erro | Causa provável | Correção |
| --- | --- | --- |
| `invalid_client` / `no registered origin` | Cliente instalado ou origem não autorizada | Criar cliente Web e adicionar a origem |
| `origin_mismatch` | Origem atual fora da lista | Adicionar a origem exata no Google Cloud |
| `access_denied` | Consentimento cancelado ou usuário fora dos testes | Autorizar novamente / incluir usuário de teste |
| Drive API desativada | API não habilitada no projeto | Ativar a Google Drive API |
| Sessão expirada | Token de acesso venceu | Clicar em **Conectar Google Drive** novamente |
