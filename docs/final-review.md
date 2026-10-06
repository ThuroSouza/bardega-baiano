# Bloco 20 — revisão final

Revisão executada em 06/10/2026 sobre o código local e o projeto Supabase **de desenvolvimento** `jahyjzgdsgmtdutqhcea`. Este registro separa o que foi verificado do que exige a publicação preparada no [Bloco 18](cloudflare-deploy.md). Não representa aprovação para usar dados reais.

## Matriz de verificação

| Área | Resultado | Evidência e limite |
| --- | --- | --- |
| TypeScript, lint e build | Aprovado localmente | `npm run lint` e `npm run build` passaram; o build inclui `tsc -b`. `npm run build` é uma checagem técnica e pode gerar um pacote sem configuração de produção. |
| Dependências | Aprovado na consulta atual | `npm audit --json` não reportou vulnerabilidades. É uma consulta pontual ao banco de advisories. |
| Rotas e acesso | Aprovado localmente | Uma rota interna sem sessão redirecionou ao login; recuperação abriu. Com sessão ADMIN, as 21 rotas principais e subrotas verificadas carregaram títulos esperados em 390 px. O preview do pacote respondeu HTTP 200 para sete URLs diretas de SPA. |
| Celular, tablet e desktop | Aprovado nas telas verificadas | Dashboard e nove módulos principais foram verificados em 390, 768 e 1440 px; outras 11 subrotas foram verificadas em 390 px. Não houve rolagem horizontal da página após corrigir a grade de `page-stack`. Tabelas largas mantêm rolagem interna. Login, recuperação, dashboard, Relatórios, Usuários e Auditoria foram inspecionados visualmente. |
| Supabase e banco | Aprovado em desenvolvimento | As 24 migrations locais constam no projeto remoto, sem diferenças na lista. `invite-user` e `product-image` estão ativas com `verify_jwt=true`. Não há projeto de produção para comparar. |
| RLS, permissões e segurança | Aprovado com pendências conhecidas | A suíte crítica cobre RLS de todas as tabelas públicas, grants, papéis e acesso anônimo. Os advisors ainda mostram 35 avisos de RPCs `SECURITY DEFINER` autenticadas e um aviso de proteção de senhas vazadas desativada; ver [revisão de segurança](security-hardening.md). |
| Estoque, PDV, vendas e caixa | Aprovado nos testes transacionais | A [suíte crítica](testing.md) cobriu saldo, checkout, custo, idempotência, caixa e cancelamento com `ROLLBACK`. Ainda não houve ensaio ponta a ponta no domínio publicado. |
| Financeiro, lucro e relatórios | Aprovado nos testes transacionais; visual pendente | A suíte cobriu lançamentos, estornos, CMV e resultado. Os relatórios foram revisados em código; conferência visual autenticada e dados reais da produção seguem pendentes. |
| Edge Functions e Storage | Aprovado no desenvolvimento | Requisições sem JWT para ambas as funções retornaram HTTP 401. Políticas de bucket e validação de imagem constam da [revisão de segurança](security-hardening.md). |
| Cloudflare Pages e HTTPS | Pendente | Não há repositório remoto, projeto Pages, domínio, nem build com Supabase de produção. CSP, redirects, autenticação e recuperação precisam ser verificados no endereço final. |
| Performance | Revisão estática aprovada; carga pendente | O build divide páginas por rota. O bundle principal mediu aproximadamente 461 kB minificado (142 kB gzip). Listagens grandes e uso simultâneo precisam de medição com dados representativos após a publicação. |
| Backup e restauração | Pendente | O [runbook](backup-recovery.md) está escrito, mas ainda não foi executada uma restauração real, inclusive dos arquivos de Storage. |

## Antes da liberação

1. Concluir os bloqueios do [checklist de produção](production-readiness.md): projeto Supabase separado, credenciais, migrations, funções, SMTP, URL de Auth, domínio HTTPS e `APP_ORIGIN`.
2. Trocar a senha inicial do ADMIN, que foi compartilhada na configuração, e decidir o plano para proteção de senhas vazadas e MFA. Não definir `mfa_required=true` antes de existir inscrição e desafio de fatores na aplicação.
3. Executar `npm run build:production` com URL e chave publicável do projeto de produção, publicar o pacote e repetir o teste de rotas, login, recuperação, convite, CORS e cabeçalhos no domínio.
4. Realizar backup do banco e dos arquivos de Storage e ensaiar restauração em projeto descartável.
5. Repetir uma passagem visual e operacional com dados representativos no domínio publicado, incluindo PDV, caixa, estoque, financeiro, relatórios e administração. A revisão local cobriu carregamento e largura das telas, sem criar lançamentos operacionais.

O [README](../README.md) contém instalação local, configuração de ambiente, migrations, estrutura, permissões, tabelas e fluxos operacionais. O [guia de deploy](cloudflare-deploy.md), a [matriz de testes](testing.md) e o [runbook de recuperação](backup-recovery.md) completam a documentação de entrega.
