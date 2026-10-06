# Bloco 17 — backup e recuperação

## Escopo e frequência

O backup precisa cobrir banco (inclusive usuários de Auth, histórico e metadados do Storage), arquivos do bucket privado `product-images`, migrations/código versionados, configuração de Auth, Edge Functions e a lista dos segredos necessários para reinstalação. **Não** coloque valores de secrets no backup versionado. O backup de banco do Supabase [não contém os arquivos do Storage](https://supabase.com/docs/guides/platform/backups).

Defina com o responsável pelo negócio a perda máxima aceitável de dados (RPO), o tempo máximo de retorno (RTO), a retenção e quem recebe alertas de falha. Sem esses números e sem ensaio de restauração, não há garantia de recuperação. Em projetos Pro, Team e Enterprise, o Supabase oferece backups diários com retenção conforme o plano; PITR é opção paga para pontos mais frequentes. Para Free, a [documentação recomenda exportações regulares com CLI e cópias externas](https://supabase.com/docs/guides/platform/backups). Confirme o plano e a aba **Database > Backups** no painel antes da liberação.

## Exportação manual de um projeto

Execute em máquina segura com Supabase CLI autenticado, Docker em execução e espaço livre suficiente. O CLI de backup requer Docker. Confira o projeto vinculado com `npx supabase projects list` antes de cada comando. Use uma pasta fora do repositório ou `backups/` (ignorada pelo Git), com permissão restrita, e copie o resultado para armazenamento externo criptografado. Não compartilhe arquivos SQL ou objetos do bucket por link público.

```bash
umask 077
mkdir -p backups/AAAA-MM-DD
chmod 700 backups backups/AAAA-MM-DD
npx supabase db dump --linked --role-only -f backups/AAAA-MM-DD/roles.sql
npx supabase db dump --linked -f backups/AAAA-MM-DD/schema.sql
npx supabase db dump --linked --data-only --use-copy \
  -x storage.buckets_vectors -x storage.vector_indexes \
  -f backups/AAAA-MM-DD/data.sql
npx supabase storage cp --linked --experimental --recursive \
  ss:///product-images backups/AAAA-MM-DD/product-images
```

O comando de Storage usa recurso marcado como experimental no CLI 2.119.0; confirme `npx supabase storage cp --help` após upgrades. Registre data, ref de origem, tamanho dos arquivos, quantidade de objetos e checksum, sem registrar senha nem chave. Verifique que `roles.sql`, `schema.sql` e `data.sql` não estão vazios. Na data deste documento, o bucket remoto ainda não tinha objetos e o host não tinha Docker, então os comandos acima **não** foram executados. A [rotina oficial de exportação/restauração com CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore) detalha os três dumps e dependências.

## Ensaio de recuperação

1. Crie um projeto Supabase **descartável**, em uma organização controlada. Nunca use o projeto de produção para ensaio.
2. Restaure `roles.sql`, `schema.sql` e `data.sql` no projeto novo conforme o [procedimento oficial](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore). Esse procedimento usa `psql --single-transaction` e exige cuidado com chaves de criptografia, extensões, publicações e histórico de migrations; siga a seção correspondente à origem do backup. Para backup gerenciado, use o fluxo de restauração do painel ou “Restore to a new project” se disponível no plano.
3. Recrie as configurações de Auth (URL, redirects, SMTP e políticas), segredos, funções e permissões que não fazem parte do dump. Publique `invite-user` e `product-image` a partir do código versionado.
4. Restaure os **arquivos** de `product-images` na nova instância. Confirme que os caminhos referenciados em `products.image_path` abrem para um usuário autorizado.
5. Valide login com conta de teste, perfis/RLS, leitura do catálogo, uma venda de teste, saldo de estoque, caixa, financeiro e trilha de auditoria. Compare contagens e totais com o manifesto do backup; descarte os lançamentos de teste junto com o projeto ensaiado.
6. Anote tempo gasto, divergências e correções. Repita periodicamente e após mudanças relevantes de banco, Auth ou Storage.

## Incidente real

Preserve evidências e identifique o último ponto íntegro antes de restaurar. Pause novas escritas na aplicação e comunique o período estimado de indisponibilidade. Se houver backup/PITR gerenciado, confirme no painel o ponto de restauração e o impacto: a restauração torna o projeto indisponível durante o processo. Prefira recuperar em projeto novo quando for preciso comparar dados ou preservar o estado atual. Após o retorno, valide Auth, funções, Storage, vendas, estoque, caixa e auditoria; só então reabra o acesso. Troque credenciais comprometidas conforme a causa do incidente.
