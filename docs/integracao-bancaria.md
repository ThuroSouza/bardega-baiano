# Integração bancária — arquitetura preparada

**Estado no Bloco 15:** a rota `/integracoes` é informativa e mostra **Não configurada**. Não existe conexão bancária, provedor contratado, fluxo OAuth, importador de extratos, webhook ou conciliação executável. Nenhuma credencial ou token bancário foi criado ou armazenado.

## Limite de confiança

```text
Aplicativo web → backend seguro / Edge Function → provedor Open Finance → banco
```

O navegador apenas inicia a autorização e consulta status e resultados permitidos ao usuário. Toda comunicação com o provedor, troca de códigos, renovação e revogação de tokens, importação de transações e processamento de webhooks pertence ao backend. O aplicativo nunca chama a API bancária diretamente nem recebe tokens do provedor. Senha do Internet Banking, PIN, senha de cartão e demais credenciais bancárias não entram no sistema. Scraping de Internet Banking não é uma alternativa.

## Decisões necessárias antes de implementar

1. Escolher um provedor oficial ou compatível com Open Finance Brasil, verificar participação, contrato, disponibilidade das contas necessárias, sandbox e modelo de consentimento.
2. Confirmar as especificações e versões **vigentes** no [Portal do Desenvolvedor do Open Finance Brasil](https://openfinancebrasil.atlassian.net/wiki/spaces/OF/overview?atl_f=content-tree) e na documentação do provedor. Os detalhes do fluxo de autorização e das APIs dependem dessa escolha. Não fixar endpoints ou parâmetros presumidos nesta fase.
3. Definir quais dados financeiros são necessários, prazo de retenção, frequência de atualização, política de revogação e tratamento de falhas. Validar essas decisões com o responsável pelo negócio antes de ativar a coleta.

## Contrato de implementação futura

- **Autorização:** endpoint autenticado para ADMIN, com verificação de permissão no servidor; iniciar somente o processo OAuth/oficial disponibilizado pelo provedor. Validar `state` e os demais mecanismos exigidos pelo provedor no retorno. Persistir conexão apenas após validar o consentimento e a resposta.
- **Segredos e tokens:** credenciais do aplicativo e chaves privadas apenas em ambiente seguro, como [segredos de Edge Functions do Supabase](https://supabase.com/docs/guides/functions/secrets). Tokens de acesso e renovação por conexão devem ficar protegidos no servidor, com acesso mínimo, expiração, renovação controlada, revogação e trilha de auditoria. Nenhum deles deve aparecer em respostas, URLs, logs ou variáveis `VITE_`.
- **Webhooks:** caso usados, validar assinatura e origem conforme a especificação do provedor antes de processar o corpo; aplicar janela temporal e proteção contra replay, chaves de idempotência, deduplicação e limites de tamanho. Respostas a eventos inválidos não devem revelar segredos.
- **Transações:** normalizar identificador externo, conta, data/hora, valor, moeda, descrição e direção. Importações repetidas não podem duplicar movimentos. Manter o dado de origem e histórico de sincronização para permitir reprocessamento e auditoria.
- **Conciliação:** comparar transações importadas com vendas, recebimentos, despesas e movimentos do sistema; apresentar candidatos com valor e data compatíveis para confirmação humana. Registrar vínculo, operador, data e eventuais desfeitos. Uma sugestão de conciliação não deve criar, cancelar ou alterar automaticamente lançamentos financeiros.
- **Importação manual:** oferecer futuramente um caminho independente de Open Finance para CSV ou outros formatos suportados. Validar estrutura, codificação, colunas, datas, valores, tamanho e duplicidade; mostrar prévia antes de gravar. Aplicar a mesma normalização, idempotência e conciliação das transações automáticas.
- **Segurança operacional:** permitir desconectar e revogar acesso, limitar consultas por papel, registrar ações sensíveis em auditoria, ocultar dados desnecessários e tratar falhas sem expor respostas do provedor. Os endpoints devem validar sessão e permissão por requisição; a visibilidade da rota no frontend não substitui a autorização no backend.

## Critério de ativação

Só substituir o status **Não configurada** quando houver provedor configurado, fluxo oficial testado em sandbox, segredos provisionados no servidor, regras de acesso e persistência aplicadas, renovação/revogação verificadas, webhooks validados (se houver) e trilha de auditoria. A importação manual e a conciliação podem ser entregues separadamente; sua disponibilidade precisa refletir o estado real na interface.
