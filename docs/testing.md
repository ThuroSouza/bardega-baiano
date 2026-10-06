# Bloco 19 — testes críticos

## Teste automatizado de banco

`npm run test:db:critical` executa [`003_critical_flows.sql`](../supabase/tests/003_critical_flows.sql) no projeto Supabase **de desenvolvimento** `jahyjzgdsgmtdutqhcea`. O comando fixa a referência do projeto para não atingir produção por engano. Exige login válido no Supabase CLI. O teste envolve `BEGIN` e `ROLLBACK`, e cada falha lança uma exceção que faz o comando sair com erro. O CLI `supabase test db --linked` ainda depende de Docker/Podman; esta máquina não possui nenhum dos dois, por isso o teste novo usa `supabase db query` via Management API.

O teste cria três usuários fictícios com papéis ADMIN, CAIXA e ESTOQUE, um produto e movimentos dentro da transação. Verifica:

| Fluxo | Verificações |
| --- | --- |
| Venda | Total calculado no banco, preço enviado pelo cliente rejeitado, desconto não autorizado rejeitado, estoque insuficiente bloqueado, itens/pagamento/financeiro gravados juntos. |
| Cancelamento | Solicitação repetida retorna o mesmo registro, CAIXA não aprova, ADMIN aprova, estoque retorna, caixa e financeiro se anulam, segunda aprovação é recusada. |
| Estoque | Entrada e reenvio idempotente; alteração de parâmetros com a mesma chave é recusada; saldo diminui na venda e retorna no cancelamento. |
| Caixa | Abertura, suprimento e fechamento idempotentes; sangria acima do saldo é recusada; fechamento confere valor esperado. |
| Financeiro e lucro | Despesa e receita manual idempotentes; reuso da chave com valor alterado é recusado; CMV, lucro bruto e resultado obedecem às fórmulas e o cancelamento reverte custo. |
| RLS e permissões | Todas as tabelas de `public` têm RLS; `anon` não lê perfis/vendas nem executa checkout; papéis limitados não acessam usuários, financeiro ou contexto de venda; custo do item e escrita direta de venda/financeiro não ficam expostos. |
| Alteração de ID e endpoint direto | ESTOQUE não obtém venda informando ID na rota/RPC; ID inexistente devolve erro; `invite-user` e `product-image` devolvem HTTP 401 sem JWT. |

O acesso à venda existente por CAIXA segue a permissão atual `sales.read`, que permite consultar o histórico geral. A proteção aqui é contra acesso de papéis sem `sales.read` e contra edição direta; a URL não é uma barreira de autorização por si só.

## Execução e limites

```bash
npm run test:db:critical
npm run lint
npm run build
```

Após a execução, confirme que não restaram contas `*@test.invalid`, produto `BLOCO19-TEST`, vendas ou despesas com os IDs do arquivo. Nesta verificação, os contadores foram zero. O `ROLLBACK` remove as linhas, mas sequências PostgreSQL (como número de venda/caixa) **podem avançar**; por isso o teste jamais deve ser executado em produção.

Os testes anteriores [`001_auth_rbac.sql`](../supabase/tests/001_auth_rbac.sql) (pgTAP) e [`002_security_hardening.sql`](../supabase/tests/002_security_hardening.sql) continuam disponíveis. `001` deve ser executado com `supabase test db` quando houver Docker/Podman; `db query` não expõe adequadamente todas as linhas de resultado pgTAP como gate. `002` usa exceções e pode ser executado por `db query` no desenvolvimento. A verificação HTTP sem JWT e a consulta REST anônima foram feitas contra o projeto de desenvolvimento em 06/10/2026 e retornaram 401.

Os testes deste bloco não substituem um ensaio de navegador no site publicado, teste de carga nem recuperação de backup. Essas verificações dependem do deploy e das pendências do [Bloco 18](cloudflare-deploy.md).
