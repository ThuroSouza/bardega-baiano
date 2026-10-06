# Bloco 17 — preparação para produção

Este documento é um checklist de liberação, não uma declaração de que o sistema já está em produção. Em 06/10/2026, o projeto Supabase `jahyjzgdsgmtdutqhcea` está vinculado ao desenvolvimento. Ainda não existe aqui um projeto Supabase de produção nem um domínio publicado.

## Ambientes

| Ambiente | Banco e Auth | Arquivo Vite | Uso |
| --- | --- | --- | --- |
| Desenvolvimento | Projeto atual `jahyjzgdsgmtdutqhcea` | `.env.development.local` | Testes e evolução do sistema |
| Produção | **Novo projeto Supabase, com ref diferente** | `.env.production.local` | Dados reais após liberação |

Copie `.env.development.example` e `.env.production.example` para os respectivos arquivos `.local`, preenchendo somente URL e chave **publicável**. A credencial local existente foi movida de `.env.local` para `.env.development.local` neste bloco. Não recrie `.env.local`: ele é comum aos dois modos do Vite. Rode `npm run build:production` para confirmar URL HTTPS, chave de produção e refs distintas antes de gerar o pacote de liberação. Em CI, passe as duas variáveis `VITE_` pelo ambiente de build em vez de criar `.env.production.local`; o verificador compara a URL de produção com a referência versionada de desenvolvimento. O script não exibe as chaves. Os arquivos `.local` e `backups/` são ignorados pelo Git. Nunca coloque `service_role`, secret key, senha do banco ou token de acesso em variável `VITE_`.

O projeto de produção deve receber as migrations versionadas, as duas Edge Functions e os segredos próprios. Faça mudanças de esquema primeiro em desenvolvimento e aplique a mesma migration em produção após revisão. Não vincule o CLI de trabalho diário ao projeto de produção. O [guia de ambientes do Supabase](https://supabase.com/docs/guides/deployment/maturity-model) recomenda separar desenvolvimento, homologação e produção.

## Checklist de liberação

| Área | Estado em 06/10/2026 | Ação antes da liberação |
| --- | --- | --- |
| Banco | 24 migrations locais correspondem às 24 remotas no projeto de desenvolvimento. PostgreSQL 17.11. | Criar projeto de produção separado; aplicar migrations em ordem, conferir advisors e índices. |
| Autenticação | Cadastro público desativado no projeto de desenvolvimento; login ADMIN validado anteriormente. | Configurar URL do site e redirects HTTPS no Auth do projeto de produção; SMTP próprio; confirmar email, política de senha e recuperação; trocar a senha inicial do ADMIN, compartilhada durante a configuração. |
| Secrets | Frontend usa URL e chave publicável. Edge Functions usam chave administrativa apenas no servidor. | Definir `APP_ORIGIN` como origem HTTPS exata no projeto de produção; manter secrets do Supabase e SMTP fora do repositório; revisar acessos e rotação. |
| RLS e permissões | Revisão do Bloco 16 documentada em [security-hardening.md](security-hardening.md). | Reexecutar Security Advisor em produção; confirmar RLS e grants após migrations. Os avisos existentes de RPCs `SECURITY DEFINER` exigem revisão contínua. |
| Storage | Bucket `product-images` privado; a listagem remota estava vazia nesta verificação. | Confirmar políticas e bucket no novo projeto; incluir **arquivos** de imagens na rotina de backup, além dos metadados do banco. |
| Domínio e HTTPS | Sem deploy público. | Configurar domínio, certificado e redirects no Bloco 18; testar login, recuperação, convite, CORS e CSP na URL final. |
| Backups | Plano de backups gerenciados do projeto atual não foi confirmado; nenhum backup foi criado neste bloco. | Definir plano, retenção, cópia externa e responsáveis; executar uma cópia real e um teste de restauração em projeto descartável conforme [runbook](backup-recovery.md). |
| Logs e erros | Auditoria de negócio existe; logs de Auth/Functions dependem do painel Supabase. | Definir responsável e rotina de inspeção de Auth, API, Storage, Functions e Postgres; testar erro de login e falha controlada sem expor dados ao usuário. |
| Auditoria | Tela de auditoria e eventos de negócio implementados. | Conferir retenção, acesso ADMIN e conciliação de uma venda, cancelamento e movimentação em produção. |
| Variáveis de ambiente | Exemplos separados foram criados; projeto de produção ainda não existe. | Rodar `npm run build:production` com arquivos reais; configurar as mesmas variáveis no host do Bloco 18 e verificar o build publicado. |

## Bloqueios de liberação

1. Projeto Supabase de produção separado e credenciais de produção próprias.
2. Backup real do banco **e** dos arquivos de Storage, seguido de restauração ensaiada.
3. Domínio HTTPS, redirects de Auth, `APP_ORIGIN` e SMTP validados.
4. Senha inicial do ADMIN trocada. Habilitar proteção de senhas vazadas quando o plano permitir e implementar MFA de usuário antes de exigir `mfa_required`.
5. Plano de observabilidade, responsáveis por incidentes e objetivos de recuperação definidos.

O [checklist oficial de produção do Supabase](https://supabase.com/docs/guides/deployment/going-into-prod) inclui SSL, restrições de rede, MFA da conta Supabase, SMTP, advisors, carga e disponibilidade. Revise esses controles no painel de **cada** ambiente; `supabase/config.toml` descreve sobretudo a instância local e não comprova as configurações remotas.
