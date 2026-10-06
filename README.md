# Bardega do Baiano

Sistema de gestão desenvolvido por blocos. Os Blocos 0 a 17 incluem autenticação, catálogo, estoque, PDV, vendas, caixa, financeiro operacional, demonstrativo gerencial de lucro e prejuízo, dashboard consolidado, relatórios, fichas técnicas de produtos compostos, administração de usuários, auditoria consultável, preparação da integração bancária, revisão de segurança e preparação para produção/recuperação.

## Desenvolvimento

Requisitos: Node.js 22.12+ ou superior, npm. Para o banco local, os testes SQL e exportações via Supabase CLI, é necessário Docker em execução.

```bash
npm ci
cp .env.development.example .env.development.local
npm run dev
```

Preencha `.env.development.local` com a URL e a **chave publicável** do projeto Supabase de desenvolvimento, usando `.env.development.example` como modelo. O arquivo é ignorado pelo Git. A configuração local existente foi movida para esse arquivo no Bloco 17. Não recrie `.env.local`, pois ele também é carregado em builds de produção. Nunca use `service_role` ou secret key em variáveis `VITE_`.

```bash
npm run build
npm run lint
```

## Produção e recuperação

O projeto Supabase atual é de desenvolvimento. Antes de publicar, crie um projeto de produção separado e leia o [checklist de produção](docs/production-readiness.md) e o [procedimento de backup e recuperação](docs/backup-recovery.md). Use `.env.production.example` para criar `.env.production.local` com credenciais publicáveis do novo projeto; execute `npm run build:production` para validar os ambientes antes de gerar o pacote de liberação. `npm run build` continua disponível para checagem técnica local.

O [guia do Cloudflare Pages](docs/cloudflare-deploy.md) define a branch `main`, o build, as variáveis, o domínio HTTPS e a verificação das rotas da SPA. A publicação depende de um repositório GitHub remoto, conta Cloudflare e projeto Supabase de produção.

## Supabase

A migration [20261005164403_auth_rbac_foundation.sql](supabase/migrations/20261005164403_auth_rbac_foundation.sql) cria perfis, papéis e permissões. As migrations seguintes adicionam catálogo, estoque, PDV e gestão de vendas, incluindo finalização transacional em [20261005225003_pdv_atomic_checkout.sql](supabase/migrations/20261005225003_pdv_atomic_checkout.sql), restrição de leitura do custo em [20261005225936_restrict_sale_cost_column.sql](supabase/migrations/20261005225936_restrict_sale_cost_column.sql), histórico/cancelamento em [20261005230434_sales_history_and_cancellation.sql](supabase/migrations/20261005230434_sales_history_and_cancellation.sql), ordenação das solicitações em [20261005231417_cancellation_request_order.sql](supabase/migrations/20261005231417_cancellation_request_order.sql), abertura e fechamento de caixa em [20261005231738_cash_sessions_and_reconciliation.sql](supabase/migrations/20261005231738_cash_sessions_and_reconciliation.sql), financeiro em [20261005233212_finance_revenues_expenses_receivables.sql](supabase/migrations/20261005233212_finance_revenues_expenses_receivables.sql), [20261005234134_finance_manual_revenue_reversal.sql](supabase/migrations/20261005234134_finance_manual_revenue_reversal.sql), [20261005234326_finance_confirmed_dates.sql](supabase/migrations/20261005234326_finance_confirmed_dates.sql) e [20261005234431_fix_finance_date_guard.sql](supabase/migrations/20261005234431_fix_finance_date_guard.sql), indicadores em [20261005235155_financial_profitability_metrics.sql](supabase/migrations/20261005235155_financial_profitability_metrics.sql), dashboard em [20261006000326_dashboard_operational_metrics.sql](supabase/migrations/20261006000326_dashboard_operational_metrics.sql), corrigido por [20261006001021_fix_dashboard_cancellation_daily_sign.sql](supabase/migrations/20261006001021_fix_dashboard_cancellation_daily_sign.sql), relatórios em [20261006001843_operational_reports.sql](supabase/migrations/20261006001843_operational_reports.sql), e composição em [20261006075829_product_composition_and_atomic_sales.sql](supabase/migrations/20261006075829_product_composition_and_atomic_sales.sql), e usuários/permissões em [20261006081356_user_administration_and_permissions.sql](supabase/migrations/20261006081356_user_administration_and_permissions.sql), e auditoria em [20261006082714_audit_trail_and_admin_query.sql](supabase/migrations/20261006082714_audit_trail_and_admin_query.sql). Não há usuário privilegiado automático. Novas contas ficam inativas até ativação administrativa.

Em um ambiente local com Docker:

```bash
npx supabase start
npx supabase db reset
npx supabase test db
```

Para um projeto remoto, vincule o projeto de **desenvolvimento** pela CLI e aplique as migrations antes de testar login. Não execute desenvolvimento diretamente no banco que já atende clientes.

### Primeiro ADMIN

Após aplicar a migration, crie ou convide a primeira conta no painel `Authentication > Users`. Um administrador do projeto deve ativá-la pelo SQL Editor com o e-mail correto:

```sql
update public.profiles
set role = 'ADMIN', is_active = true
where id = (select id from auth.users where email = 'EMAIL_DO_ADMIN');
```

O frontend não guarda chave administrativa nem permite que alguém atribua o próprio papel. O convite de novos usuários é feito pela Edge Function `invite-user`, após validar uma sessão ADMIN.

### Configuração de Auth no painel

- Desative cadastro público por e-mail no projeto remoto.
- Defina o Site URL do ambiente.
- Permita como redirect a URL exata `https://SEU-DOMINIO/redefinir-senha`; em desenvolvimento, `http://localhost:5173/redefinir-senha` e `http://127.0.0.1:5173/redefinir-senha`.
- Configure SMTP próprio antes de usar recuperação de senha em produção. O serviço padrão tem limites baixos.

### Permissões

| Papel   | Acesso inicial                                                            |
| ------- | ------------------------------------------------------------------------- |
| ADMIN   | Todos os módulos                                                          |
| GERENTE | Dashboard, PDV, vendas, caixa, estoque, produtos, financeiro e relatórios |
| CAIXA   | PDV, vendas e caixa                                                       |
| ESTOQUE | Estoque e produtos                                                        |

O frontend filtra menus e rotas para melhorar a experiência. O banco usa `private.has_permission()`, grants e RLS para autorizar operações, consultando o papel e o estado atual da conta. O PDV usa `search_pdv_products` para consultar apenas dados comerciais e `checkout_sale` para registrar venda, itens, pagamento, estoque, caixa, receita e auditoria numa transação. A finalização exige caixa aberto do operador. Apenas ADMIN e GERENTE podem aplicar descontos, com motivo obrigatório, confirmar cancelamentos, visualizar todos os caixas e operar o financeiro (`finance.manage`). O CAIXA pode solicitar cancelamento e operar o próprio caixa. `mfa_required` prepara a exigência de MFA para contas privilegiadas; o cadastro e desafio de fatores ainda não estão implementados, então mantenha esse campo `false` até essa etapa.

## Estrutura

- `src/app`: rotas e providers
- `src/contexts`: estado de autenticação
- `src/components/ui`: componentes compartilhados
- `src/config`: navegação e permissões para a interface
- `src/layouts`: layout principal
- `src/pages`: páginas por módulo e fluxos de acesso
- `supabase/migrations`: estrutura reproduzível do banco
- `supabase/tests`: testes de RLS e RBAC

## Estado atual

Login, logout, recuperação e alteração de senha estão implementados. O catálogo e o estoque possuem telas de operação. Em `/pdv`, o operador pode pesquisar por nome, código interno ou código de barras, ajustar quantidades, escolher pagamento e finalizar uma venda com estoque disponível e caixa aberto. `/vendas` mostra histórico paginado e filtros por período, operador, pagamento e status. `/vendas/:id` mostra itens, descontos, pagamento, operador, data, caixa vinculado e fluxo de cancelamento. Aprovar o cancelamento devolve estoque e cria lançamentos negativos em caixa e financeiro, preservando o histórico original e registrando auditoria. Estorno externo de PIX/cartão não é automático; precisa ser realizado no provedor de pagamento.

Em `/caixa`, cada operador abre seu caixa com valor inicial; a data e a identidade são registradas automaticamente. Suprimentos e sangrias exigem valor e motivo. O fechamento registra valor contado, saldo esperado e diferença. O saldo esperado é o dinheiro físico: abertura + vendas em dinheiro + suprimentos − sangrias − devoluções em dinheiro. PIX e cartões aparecem separados na conferência e não aumentam o dinheiro esperado na gaveta. O histórico mostra sessões e movimentos; ADMIN e GERENTE podem consultar e operar caixas de outros operadores. O fechamento fixa o resultado daquela sessão. Se uma venda for cancelada depois do fechamento, uma devolução em dinheiro requer caixa aberto do aprovador e saldo suficiente nesse caixa. Vendas anteriores à implantação do Bloco 7 continuam no histórico sem sessão vinculada.

Em `/financeiro`, alertas apontam contas vencidas e links levam às seções. `/financeiro/receitas` reúne receita automática de venda, seu estorno, baixa de valores a receber e receita manual. Receitas manuais diretas podem ser estornadas uma vez, com motivo, sem apagar o original. `/financeiro/despesas` e `/financeiro/contas-pagar` usam o mesmo registro: descrição, categoria, fornecedor opcional, valor, vencimento e observação; o pagamento informa data e forma. `/financeiro/contas-receber` registra entradas futuras e gera receita somente na baixa. Títulos pendentes podem ser cancelados; títulos baixados permanecem no histórico. O status **ATRASADA** é calculado quando um título pendente passa do vencimento, considerando a data de São Paulo. Datas futuras não são aceitas para receitas confirmadas nem para baixas. Operações são auditadas e tentativas repetidas de criação/baixa não duplicam lançamentos. Pagamentos em dinheiro retirados da gaveta também exigem sangria em `/caixa`; o lançamento financeiro não movimenta automaticamente uma sessão de caixa.

`/financeiro/resultado` oferece períodos prontos e personalizados (até 10 anos) e usa o horário de São Paulo. A metodologia do demonstrativo gerencial é:

- **Faturamento bruto:** soma dos subtotais das vendas finalizadas no período. **Faturamento líquido:** bruto − descontos dessas vendas − valor líquido das vendas canceladas no período; cancelamentos antigos afetam a data do estorno.
- **CMV:** soma do custo unitário histórico gravado em cada item × quantidade, arredondado por item, menos o custo das vendas estornadas no período. Alterar o custo atual de um produto não altera o CMV passado. Custos cadastrados como zero produzem CMV zero para esses itens.
- **Lucro bruto:** faturamento líquido − CMV. **Resultado gerencial:** lucro bruto + receitas manuais/contas recebidas líquidas de estornos, pela data do recebimento, − despesas operacionais não canceladas pelo vencimento. Despesas pagas e pendentes aparecem separadas.
- **Mercadorias:** compras classificadas nessa categoria aparecem à parte e não são subtraídas outra vez como despesa operacional. Classifique as compras de estoque corretamente para evitar duplicação com o CMV.
- **Margem:** resultado ÷ faturamento líquido, exibida somente se o faturamento líquido for positivo. **Ticket médio na venda:** valor das vendas após descontos ÷ quantidade de vendas finalizadas no período, antes dos cancelamentos.

O relatório é gerencial e usa o vencimento como aproximação para a competência das despesas; não substitui um demonstrativo contábil formal nem um extrato de caixa.

Em `/dashboard`, oito cards mostram faturamento líquido, lucro bruto estimado, vendas e ticket médio de hoje, além de dinheiro físico nos caixas abertos, despesas operacionais e resultado do mês e contagem de produtos com estoque baixo. Há uma série de faturamento líquido dos últimos sete dias, formas de pagamento do mês, cinco produtos e categorias mais vendidos e cinco produtos com estoque baixo. Os indicadores são atualizados a cada minuto e podem ser atualizados manualmente. O saldo de caixa soma apenas movimentos em dinheiro das sessões abertas; PIX e cartões não compõem esse saldo. Rankings e formas de pagamento excluem vendas canceladas e consideram as vendas iniciadas no mês; o gráfico de sete dias lança cancelamentos na data do estorno. A categoria dos rankings é a categoria **atual** do produto, então uma recategorização pode alterar a leitura histórica. Os cálculos de lucro e resultado seguem a metodologia do demonstrativo gerencial descrita acima. A consulta do dashboard exige `dashboard.read` e `finance.read` no banco; atualmente ambos são concedidos a ADMIN e GERENTE.

`/relatorios` oferece 13 relatórios: vendas, produtos, estoque, movimentações, entradas, perdas, financeiro, despesas, receitas, lucro, caixas, formas de pagamento e operadores. Os filtros Hoje, Ontem, Semana (segunda-feira até hoje), Mês (primeiro dia até hoje) e Personalizado usam datas de São Paulo; o período máximo é de 10 anos. As tabelas são paginadas em 25 registros, com totais calculados para o período inteiro. **Estoque** mostra o saldo atual e ignora o período, com aviso na tela. Vendas, pagamentos, produtos e operadores usam a data de finalização da venda; estoques usam a data de registro do movimento; despesas usam vencimento; receitas usam a data de confirmação; caixas usam a abertura. Os relatórios Financeiro e Lucro seguem a metodologia do demonstrativo gerencial. Perdas e avarias ainda não recebem custo histórico no lançamento, portanto o relatório mostra quantidades sem avaliar financeiramente essas ocorrências. A API retorna dados estruturados e paginados para permitir futura exportação PDF, CSV e Excel; a exportação ainda não está implementada. A consulta exige `reports.read`, `sales.read`, `stock.read`, `finance.read` e `cash.view_all` no banco, atualmente concedidas juntas a ADMIN e GERENTE.

## Ficha técnica e produtos compostos

Cadastre primeiro os ingredientes como produtos físicos, com sua unidade, custo e saldo. Depois cadastre o produto final com unidade UN, CX ou PCT, estoque mínimo zero e saldo físico zero. Na página do produto, adicione os ingredientes e informe a quantidade de cada um na unidade cadastrada. Exemplo: 50 ml de uma garrafa cadastrada em L corresponde a **0,05 L**. A ficha aceita até 30 ingredientes distintos e não permite composição dentro de outra composição.

A disponibilidade no PDV é calculada pelo ingrediente que limita a receita. Ao finalizar uma venda, o banco agrega o consumo do carrinho inteiro, valida o saldo e desconta os ingredientes numa única transação. O custo histórico do produto composto é gravado na venda a partir dos custos dos ingredientes naquele momento; a tela mostra uma estimativa com os custos atuais. Uma alteração posterior da ficha ou do custo não altera o histórico. O cancelamento devolve exatamente os ingredientes e quantidades registrados na venda. Produtos compostos não recebem movimentação física manual e não aparecem no relatório de estoque físico. Para voltar ao produto padrão, remova todos os ingredientes da ficha técnica.

Para conferir: cadastre dois ingredientes com saldo, crie um produto composto com ambos, venda-o em `/pdv` com caixa aberto e confira o consumo em `/vendas/:id` e os saldos em `/estoque`. Depois altere a ficha e cancele a venda: os ingredientes originais devem ser devolvidos. Essas operações persistem dados; use um ambiente de desenvolvimento.

## Usuários e permissões

Em `/usuarios`, somente ADMIN pode pesquisar contas, convidar por e-mail, editar nome e função, ativar/desativar e configurar as permissões operacionais de GERENTE, CAIXA e ESTOQUE. A função ADMIN mantém acesso integral. A interface não exclui contas: desative quem saiu para preservar o histórico. O próprio administrador não pode se desativar nem remover sua função ADMIN.

O convite é enviado pela Edge Function [`invite-user`](supabase/functions/invite-user/index.ts), publicada com verificação de JWT. A chave `SUPABASE_SERVICE_ROLE_KEY` permanece no ambiente da função, nunca no frontend. O convidado define a própria senha no link enviado e só ganha acesso depois da ativação por ADMIN. A função aceita as origens locais `http://127.0.0.1:5173` e `http://localhost:5173`; para produção, configure o segredo `APP_ORIGIN` com a origem HTTPS exata do site, cadastre `https://SEU-DOMINIO/redefinir-senha` nos redirects de Auth e configure SMTP próprio. Não configure `APP_ORIGIN` com barra final. Um convite já enviado não pode ser desfeito por esta interface; se necessário, mantenha a conta inativa.

As permissões efetivas são carregadas do banco a cada validação de sessão; mudanças de papel, permissão e ativação são verificadas pelo banco nas operações seguintes. A interface pode atualizar após reabrir ou recarregar a página. Permissões de usuários, auditoria, integrações e configurações são reservadas a ADMIN. A matriz exige as permissões de leitura necessárias para cada gestão e relatório. Alterações de acesso são registradas na tabela de auditoria.

## Auditoria

A página `/auditoria` é exclusiva de ADMIN e permite filtrar registros por data, ação, usuário/e-mail ou ID da entidade, além de examinar os valores anteriores e novos. Ações de venda, cancelamento, estoque, caixa, financeiro, fichas técnicas e permissões já eram gravadas pelas operações transacionais. O Bloco 14 acrescenta o registro de **LOGIN** após o login web bem-sucedido (uma vez por sessão), alterações de preço de produto e alterações cadastrais de despesas. As baixas e os cancelamentos de despesa mantêm eventos específicos. Nenhuma conexão bancária foi implementada e, por isso, não há eventos bancários.

## Integrações bancárias

Em `/integracoes`, somente ADMIN vê o estado **Não configurada** e o planejamento da conexão autorizada e da conciliação. O Bloco 15 não conecta bancos nem solicita dados de acesso. A arquitetura e os requisitos para escolher um provedor, manter tokens no backend, processar webhooks e futuramente importar CSV estão em [docs/integracao-bancaria.md](docs/integracao-bancaria.md).

A tabela de auditoria concede apenas leitura ao papel autenticado com `audit.read`; nenhuma operação do frontend recebe permissão direta de inserir, editar ou excluir logs. Um trigger bloqueia `UPDATE`, `DELETE` e `TRUNCATE` inclusive em consultas administrativas comuns. Cada novo evento guarda um retrato do nome do operador e, quando disponíveis na requisição, user-agent e ID da requisição. Esses dados de contexto são informativos, não prova de IP ou identidade. O identificador de sessão usado para evitar duplicidade de LOGIN não é devolvido pela consulta administrativa.

O registro de LOGIN no aplicativo cobre acessos bem-sucedidos pela tela de senha após esta migração. Tentativas recusadas e outros métodos de autenticação pertencem aos [logs de Auth do Supabase](https://supabase.com/docs/guides/auth/audit-logs); o armazenamento desses eventos na tabela `auth.audit_log_entries` é opcional; essa tabela não continha eventos na verificação deste projeto. A interface de auditoria não substitui esses logs de Auth. O registro de LOGIN é enviado pelo cliente após a confirmação de Auth; se essa chamada falhar, o login continua e a tela mostra um aviso. Para verificar um registro novo, saia e entre novamente com sua própria conta, depois abra `/auditoria`.

## Segurança

O Bloco 16 restringiu a escrita de imagens de produto ao backend, validou arquivos no servidor, limitou convites e reforçou a idempotência do estoque. A revisão e as dependências do plano Supabase e da futura hospedagem estão em [docs/security-hardening.md](docs/security-hardening.md). Para alterar uma imagem, a aplicação usa a Edge Function `product-image`; o navegador não grava diretamente no Storage nem na coluna `image_path`.

No projeto Supabase vinculado, as migrations até o Bloco 16 foram aplicadas, o cadastro público foi desativado, as URLs locais de Auth foram configuradas e a primeira conta ADMIN foi ativada. Em outra instância, repita a configuração descrita acima. Para testar o caixa: abra `/caixa`, informe o dinheiro inicial, registre suprimento e sangria, faça uma venda em `/pdv`, confira os movimentos e feche o caixa. Para testar o financeiro e o resultado: cadastre uma despesa, uma conta a receber e uma receita manual; faça as baixas, confira `/financeiro/resultado` e altere o período. Uma venda com custo, desconto e cancelamento mostra o efeito no CMV e no lucro bruto. Para testar o dashboard, abra `/dashboard` e compare os cards com o demonstrativo, o caixa e o estoque. Para testar os relatórios, abra `/relatorios`, alterne os tipos e os períodos e compare os totais com as telas de origem. Essas operações gravam dados persistentes; use um ambiente de desenvolvimento para testes que possam gerar lançamentos.
