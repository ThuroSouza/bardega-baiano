# Bloco 18 — Cloudflare Pages e deploy

## Estado

Este repositório usa Vite e React Router com rotas no navegador. A branch de produção é `main`. O build gera `dist/`; o arquivo `public/_headers` é copiado para `dist/_headers` e define CSP e outros cabeçalhos. O site ainda não está publicado, pois o repositório não tem remoto GitHub e ainda falta o projeto Supabase de produção.

## Pré-requisitos de liberação

Conclua os bloqueios do [checklist de produção](production-readiness.md): projeto Supabase de produção separado, backup e ensaio de recuperação, credenciais próprias, SMTP, Auth redirects e troca da senha inicial do administrador. A chave `VITE_SUPABASE_PUBLISHABLE_KEY` pode estar no pacote público; `service_role`, secret key, senha de banco e tokens pessoais não podem estar no GitHub nem nas variáveis `VITE_`.

## GitHub → Cloudflare Pages

1. Crie um repositório **privado** no GitHub e conecte `origin` a ele. Revise `git status` e `git diff --cached` antes do primeiro push. `*.local`, `.env.*` reais, `backups/`, `node_modules/` e `dist/` estão ignorados.
2. Envie a branch `main` para o GitHub. Nas mudanças futuras, desenvolva em outra branch e integre à `main` após revisão.
3. Em **Cloudflare > Workers & Pages > Create application > Pages > Import an existing Git repository**, conecte o repositório GitHub. Escolha `main` como production branch e desative previews públicos ou proteja-os com Cloudflare Access até haver um Supabase de teste próprio para preview.
4. Configure **Build command** `npm run build:production`, **Build output directory** `dist`, **Root directory** `/`. O arquivo `.node-version` fixa Node `22.16.0` no build da Cloudflare. O npm instala dependências do `package-lock.json` antes do comando.
5. Em **Settings > Environment variables**, no ambiente **Production**, cadastre `VITE_SUPABASE_URL` com a URL HTTPS do **novo** projeto Supabase e `VITE_SUPABASE_PUBLISHABLE_KEY` com a chave publicável dele. O verificador do build recusa a URL do projeto de desenvolvimento. Configure apenas os valores necessários para preview no ambiente Preview; previews não devem apontar ao banco de produção.
6. Publique a branch `main` e confira a URL `*.pages.dev` gerada. Configure `APP_ORIGIN` nas duas Edge Functions do **Supabase de produção** com a origem HTTPS exata que os operadores usarão, sem barra final. No Auth, defina Site URL e Redirect URL `https://DOMINIO/redefinir-senha`; mantenha a URL `pages.dev` somente se for origem de acesso permitida. Configure SMTP no projeto de produção.
7. Em **Pages > Custom domains**, associe o domínio desejado. Para domínio raiz, os nameservers precisam apontar à Cloudflare; para subdomínio, siga o CNAME indicado no painel. Espere o certificado HTTPS ficar ativo antes de definir a URL final em Auth/Edge Functions. Evite dois domínios de login ativos sem necessidade, pois o fluxo de convite usa `APP_ORIGIN` fixo.

## Rotas da SPA

O Vite produz `dist/index.html` e **não** produz `dist/404.html`. Nesse caso, a Cloudflare Pages [serve `index.html` para caminhos sem arquivo](https://developers.cloudflare.com/pages/configuration/serving-pages/); o React Router resolve a rota depois. Não adicione `404.html` na raiz nem uma regra `_redirects` genérica que intercepte os arquivos de `/assets/`.

Após publicar, abra diretamente em uma aba nova `https://DOMINIO/financeiro`, `https://DOMINIO/vendas` e `https://DOMINIO/produtos/123`. A resposta deve carregar o aplicativo (um visitante sem sessão pode ser redirecionado pelo **React Router** para `/login`). Confira também `https://DOMINIO/assets/ARQUIVO-INEXISTENTE.js`: esse caminho não deve devolver HTML de login como JavaScript. Confirme que `/redefinir-senha` abre corretamente por link de Auth.

## Verificação pós-deploy

- Confirme HTTPS e certificado válido em `pages.dev` e no domínio próprio.
- Confira no DevTools que o navegador conecta ao **projeto Supabase de produção**, sem `service_role` ou secret key no pacote.
- Verifique `Content-Security-Policy`, `X-Content-Type-Options`, `X-Frame-Options`, `Strict-Transport-Security` e `X-Robots-Tag` nas respostas HTML. O arquivo `_headers` só surte efeito na Cloudflare Pages, não no servidor Vite local.
- Faça login com conta de teste, acesse rotas diretamente, saia, recupere senha e teste convite; valide funções, Storage e RLS.
- Examine logs de build da Cloudflare e Auth/Functions no Supabase. Se uma rota retornar 404, confira a ausência de `404.html`, as regras de redirect e a configuração do projeto Pages.

Referências: [integração Git da Pages](https://developers.cloudflare.com/pages/configuration/git-integration/), [build e variáveis](https://developers.cloudflare.com/pages/configuration/build-configuration/), [domínios personalizados](https://developers.cloudflare.com/pages/configuration/custom-domains/) e [cabeçalhos](https://developers.cloudflare.com/pages/configuration/headers/).
