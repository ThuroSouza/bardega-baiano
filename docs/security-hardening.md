# Bloco 16 — revisão de segurança

## Controles aplicados

| Área | Estado após a revisão |
| --- | --- |
| Auth e sessão | O aplicativo valida o usuário com Auth, verifica perfil ativo e MFA exigido ao carregar/voltar à aba e acompanha mudanças da sessão. A configuração local mantém rotação de refresh token e proíbe cadastro público. |
| RLS, RBAC e grants | Tabelas de negócio expostas usam RLS e grants específicos; autorização é consultada no banco por operação. Nenhuma função `SECURITY DEFINER` em `public` é executável por `anon` no projeto vinculado. A coluna `products.image_path` deixou de ser gravável por `authenticated`. |
| Validação | Formulários usam Zod quando aplicável. Convites e metadados de upload são validados com Zod na Edge Function; assinaturas de JPG, PNG e WebP e limite de 3 MB são verificados no servidor. Constraints e FKs continuam protegendo os dados no banco. |
| Operações financeiras | O fechamento de venda calcula preços, descontos e total no RPC e compara com o total esperado; grava snapshots e lançamentos na mesma transação. Caixa e financeiro usam funções com checagem de permissão e idempotência. O estoque agora compara todos os parâmetros do pedido em reenvios. |
| Edge Functions | `invite-user` e `product-image` exigem JWT verificado pela plataforma, validam o usuário e a permissão no servidor, restringem origem e tamanho da requisição e retornam erros controlados. Convites estão limitados a um por minuto e cinco por hora por administrador. |
| Storage | O bucket de imagens é privado, aceita apenas JPG/PNG/WebP até 3 MB; inserção e exclusão diretas foram fechadas. A leitura exige `products.read` e referência do objeto por um produto. A função de imagem usa chave administrativa somente no servidor e grava a mudança do caminho com auditoria em uma transação de banco. |
| Auditoria e erros | A trilha existente permanece imutável para a aplicação. Trocas de imagem geram `PRODUCT_IMAGE_UPDATED`. Erros desconhecidos de banco e API deixam de ser exibidos literalmente ao usuário. |
| Cabeçalhos | `public/_headers` configura CSP, proteção contra framing, `nosniff`, política de referência e de recursos do navegador para **futura hospedagem estática no Cloudflare Pages**. Vite local não aplica esse arquivo como cabeçalhos HTTP. |
| Índices e datas | Índice único para `products.image_path`; `updated_at` automático nos títulos financeiros. Tabelas de eventos imutáveis conservam a data de criação; sessões e solicitações usam datas próprias do fluxo. |

## Validação realizada

- `npm run build` e `npm run lint` passaram após as mudanças de frontend.
- Migrations `20261006084548`, `20261006085513` e `20261006085755` aplicadas ao projeto vinculado.
- O teste transacional [`002_security_hardening.sql`](../supabase/tests/002_security_hardening.sql) verificou reenvio de estoque, limite de convite, bloqueio de não administrador, grants da função de imagem e ausência de política de escrita direta no Storage. O teste usa `ROLLBACK`.
- As duas Edge Functions estão ativas com verificação de JWT. A consulta final aos advisors retornou 35 avisos de RPCs `SECURITY DEFINER` destinadas a usuários autenticados e um aviso de proteção de senhas vazadas desativada. Os RPCs são parte da API de negócio e validam identidade, papel ou permissão internamente; o aviso genérico permanece para revisão contínua.

## Dependências de produção

- [Proteção de senhas vazadas](https://supabase.com/docs/guides/auth/password-security) e [limites de duração/inatividade de sessão](https://supabase.com/docs/guides/auth/sessions) exigem plano Pro ou superior no Supabase. O advisor do projeto ainda indica proteção de senhas vazadas desativada. Essas opções precisam ser ativadas no Auth do projeto quando disponíveis; o arquivo local não altera a configuração remota.
- A senha inicial do administrador foi compartilhada durante a configuração. O titular deve trocá-la por uma senha única e forte na tela **Alterar senha** antes de uso real. A conta deve adotar MFA quando a inscrição e o desafio de fatores estiverem implementados; atualmente `mfa_required` fica desativado para evitar bloqueio sem fluxo de MFA.
- Os cabeçalhos só terão efeito quando a hospedagem Cloudflare Pages usar `dist/_headers`. Confirmar o cabeçalho CSP na resposta HTTPS do domínio após o deploy e ajustar `connect-src` caso sejam adicionados outros serviços.
- O projeto ainda não tem Docker no host para executar `supabase test db` localmente. O teste SQL transacional acima foi executado no projeto remoto de desenvolvimento.
