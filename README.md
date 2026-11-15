# SCIPIONE CRED — offline

PWA para gestão de clientes e dívidas, com os registros criptografados e armazenados apenas no aparelho. Não há backend, conta remota ou envio de dados.

## Rodar localmente

O projeto é estático e não tem etapa de build. Sirva a raiz por HTTP:

```sh
python3 -m http.server 8080
```

Abra `http://localhost:8080`. Para instalar como aplicativo e usar o service worker, use HTTPS ou `localhost`.

## Publicar na Vercel

1. Importe este repositório em [vercel.com/new](https://vercel.com/new).
2. Use o preset **Other**.
3. Deixe **Build Command** e **Install Command** vazios.
4. Em **Output Directory**, use `.` (a raiz do repositório).
5. Faça o deploy.

O arquivo `vercel.json` já define:

- `sw.js` sem cache HTTP e com escopo na raiz, para o aplicativo instalado receber atualizações;
- `index.html` e `/` sem cache, para evitar uma versão antiga da interface;
- `X-Content-Type-Options` e `Referrer-Policy` como cabeçalhos de segurança.

Não são necessárias variáveis de ambiente. A Vercel entrega o site por HTTPS, que é o contexto exigido para o service worker e para o Web Crypto.

## Dados e backup

O cofre fica no IndexedDB do navegador. Cada origem (por exemplo, `localhost` e o domínio da Vercel) tem um cofre próprio; para levar dados de um ambiente a outro, gere um backup na tela **Backup e restauração** e restaure no novo endereço.

## Documentação

Detalhes de arquitetura, criptografia, backups, relatórios e testes estão em [docs/README.md](docs/README.md).

## Testes

```sh
for t in money validators crypto stage4 backup; do node tests/$t.test.mjs; done
```
