import type { ReportKey } from "./api";

export type Column = { key: string; label: string; kind?: "money" | "qty" | "date" | "datetime" | "status" | "type" | "bool" | "percent" };
export type Summary = { key: string; label: string; kind?: "money" | "qty" };
export type ReportConfig = { description: string; note: string; columns: Column[]; summary: Summary[] };

export const reportConfig: Record<ReportKey, ReportConfig> = {
  sales: {
    description: "Vendas finalizadas no período, inclusive as canceladas depois.",
    note: "A data é a finalização da venda. O total concluído exclui vendas atualmente canceladas; o faturamento por evento está no relatório Financeiro.",
    summary: [{ key: "sales_count", label: "Vendas", kind: "qty" }, { key: "gross_sales", label: "Subtotal", kind: "money" }, { key: "discounts", label: "Descontos", kind: "money" }, { key: "completed_total", label: "Total concluído", kind: "money" }],
    columns: [{ key: "sale_number", label: "Venda" }, { key: "created_at", label: "Data", kind: "datetime" }, { key: "operator", label: "Operador" }, { key: "status", label: "Situação", kind: "status" }, { key: "subtotal", label: "Subtotal", kind: "money" }, { key: "discount_amount", label: "Desconto", kind: "money" }, { key: "total", label: "Total", kind: "money" }],
  },
  products: {
    description: "Produtos vendidos e não cancelados, com custo histórico e lucro bruto.",
    note: "A categoria exibida é a atual. Quantidade, receita e CMV usam itens de vendas não canceladas finalizadas no período.",
    summary: [{ key: "products_count", label: "Produtos", kind: "qty" }, { key: "quantity", label: "Unidades", kind: "qty" }, { key: "revenue", label: "Receita", kind: "money" }, { key: "cmv", label: "CMV", kind: "money" }],
    columns: [{ key: "product", label: "Produto" }, { key: "category", label: "Categoria" }, { key: "quantity", label: "Quantidade", kind: "qty" }, { key: "revenue", label: "Receita", kind: "money" }, { key: "cmv", label: "CMV", kind: "money" }, { key: "gross_profit", label: "Lucro bruto", kind: "money" }],
  },
  stock: {
    description: "Saldo atual dos produtos ativos e valor estimado pelo custo cadastrado.",
    note: "Fotografia do estoque atual: o filtro de período não altera esta seção. O valor usa o custo atual do produto, não o custo histórico de uma venda.",
    summary: [{ key: "products_count", label: "Produtos ativos", kind: "qty" }, { key: "low_stock_count", label: "Estoque baixo", kind: "qty" }, { key: "stock_value", label: "Valor estimado", kind: "money" }],
    columns: [{ key: "product", label: "Produto" }, { key: "category", label: "Categoria" }, { key: "quantity", label: "Saldo", kind: "qty" }, { key: "minimum_stock", label: "Mínimo", kind: "qty" }, { key: "cost_price", label: "Custo atual", kind: "money" }, { key: "stock_value", label: "Valor", kind: "money" }, { key: "low_stock", label: "Baixo", kind: "bool" }],
  },
  movements: {
    description: "Histórico de todas as movimentações de estoque.",
    note: "O período considera quando o movimento foi registrado no sistema, no horário de São Paulo. Custo registrado pode estar vazio.",
    summary: [{ key: "movements_count", label: "Movimentos", kind: "qty" }, { key: "quantity", label: "Volume movimentado", kind: "qty" }, { key: "recorded_cost", label: "Custo registrado", kind: "money" }],
    columns: [{ key: "created_at", label: "Data", kind: "datetime" }, { key: "product", label: "Produto" }, { key: "type", label: "Tipo", kind: "type" }, { key: "quantity", label: "Variação", kind: "qty" }, { key: "new_quantity", label: "Saldo após", kind: "qty" }, { key: "operator", label: "Operador" }, { key: "reason", label: "Motivo" }],
  },
  entries: {
    description: "Entradas registradas no estoque.",
    note: "Considera movimentos do tipo Entrada pela data do registro. O custo é o valor informado no movimento.",
    summary: [{ key: "movements_count", label: "Entradas", kind: "qty" }, { key: "quantity", label: "Quantidade", kind: "qty" }, { key: "recorded_cost", label: "Custo registrado", kind: "money" }],
    columns: [{ key: "created_at", label: "Data", kind: "datetime" }, { key: "product", label: "Produto" }, { key: "quantity", label: "Quantidade", kind: "qty" }, { key: "unit_cost", label: "Custo unitário", kind: "money" }, { key: "total_cost", label: "Custo total", kind: "money" }, { key: "supplier", label: "Fornecedor" }, { key: "operator", label: "Operador" }],
  },
  losses: {
    description: "Perdas e avarias lançadas no estoque.",
    note: "Quantidade total usa valor absoluto. O módulo atual não grava o custo de perdas ou avarias; este relatório não avalia financeiramente essas ocorrências.",
    summary: [{ key: "movements_count", label: "Ocorrências", kind: "qty" }, { key: "quantity", label: "Quantidade perdida", kind: "qty" }],
    columns: [{ key: "created_at", label: "Data", kind: "datetime" }, { key: "product", label: "Produto" }, { key: "type", label: "Tipo", kind: "type" }, { key: "quantity", label: "Variação", kind: "qty" }, { key: "reason", label: "Motivo" }, { key: "operator", label: "Operador" }],
  },
  finance: {
    description: "Composição financeira do período conforme o demonstrativo gerencial.",
    note: "Vendas pela finalização, cancelamentos pelo estorno, outras receitas pela confirmação e despesas operacionais pelo vencimento.",
    summary: [{ key: "net_sales", label: "Faturamento líquido", kind: "money" }, { key: "other_revenue", label: "Outras receitas", kind: "money" }, { key: "operating_expenses", label: "Despesas", kind: "money" }, { key: "result", label: "Resultado", kind: "money" }],
    columns: [{ key: "label", label: "Componente" }, { key: "amount", label: "Valor", kind: "money" }],
  },
  expenses: {
    description: "Títulos de despesas com vencimento no período.",
    note: "Títulos cancelados aparecem para conferência, mas não entram nos totais operacionais. Compras de Mercadorias são mostradas separadamente do CMV.",
    summary: [{ key: "expenses_count", label: "Títulos", kind: "qty" }, { key: "operating_amount", label: "Operacionais", kind: "money" }, { key: "inventory_amount", label: "Mercadorias", kind: "money" }, { key: "pending_amount", label: "Pendentes", kind: "money" }],
    columns: [{ key: "due_on", label: "Vencimento", kind: "date" }, { key: "description", label: "Descrição" }, { key: "category", label: "Categoria", kind: "type" }, { key: "supplier_name", label: "Fornecedor" }, { key: "amount", label: "Valor", kind: "money" }, { key: "status", label: "Situação", kind: "status" }, { key: "paid_on", label: "Pagamento", kind: "date" }],
  },
  revenues: {
    description: "Lançamentos de receitas e estornos confirmados.",
    note: "O período considera a data de confirmação do lançamento. Valores negativos representam estornos.",
    summary: [{ key: "entries_count", label: "Lançamentos", kind: "qty" }, { key: "sales_net", label: "Vendas líquidas", kind: "money" }, { key: "other_net", label: "Outras receitas", kind: "money" }, { key: "total_net", label: "Total líquido", kind: "money" }],
    columns: [{ key: "received_on", label: "Data", kind: "date" }, { key: "type", label: "Tipo", kind: "type" }, { key: "description", label: "Descrição" }, { key: "payment_method", label: "Pagamento", kind: "type" }, { key: "amount", label: "Valor", kind: "money" }],
  },
  profit: {
    description: "Ponte do faturamento ao resultado e à margem de lucro.",
    note: "Usa custo histórico do item vendido; o vencimento aproxima a competência das despesas. Não substitui um DRE contábil formal.",
    summary: [{ key: "net_sales", label: "Faturamento líquido", kind: "money" }, { key: "cmv", label: "CMV", kind: "money" }, { key: "gross_profit", label: "Lucro bruto", kind: "money" }, { key: "result", label: "Resultado", kind: "money" }],
    columns: [{ key: "label", label: "Componente" }, { key: "amount", label: "Valor", kind: "money" }],
  },
  cash: {
    description: "Sessões de caixa abertas no período selecionado.",
    note: "A data do filtro é a abertura. Diferença aparece apenas após o fechamento e pode ocorrer fora do período filtrado.",
    summary: [{ key: "sessions_count", label: "Sessões", kind: "qty" }, { key: "open_count", label: "Abertas", kind: "qty" }, { key: "closed_count", label: "Fechadas", kind: "qty" }, { key: "total_difference", label: "Diferença", kind: "money" }],
    columns: [{ key: "session_number", label: "Caixa" }, { key: "opened_at", label: "Abertura", kind: "datetime" }, { key: "operator", label: "Operador" }, { key: "status", label: "Situação", kind: "status" }, { key: "opening_amount", label: "Inicial", kind: "money" }, { key: "expected_amount", label: "Esperado", kind: "money" }, { key: "counted_amount", label: "Contado", kind: "money" }, { key: "difference_amount", label: "Diferença", kind: "money" }],
  },
  payments: {
    description: "Distribuição das formas de pagamento em vendas não canceladas.",
    note: "Considera vendas finalizadas no período que continuam concluídas; estornos de vendas antigas não entram nesta distribuição.",
    summary: [{ key: "methods_count", label: "Formas usadas", kind: "qty" }, { key: "sales_count", label: "Pagamentos", kind: "qty" }, { key: "amount", label: "Valor", kind: "money" }],
    columns: [{ key: "method", label: "Forma", kind: "type" }, { key: "sales_count", label: "Pagamentos", kind: "qty" }, { key: "amount", label: "Valor", kind: "money" }],
  },
  operators: {
    description: "Vendas e faturamento por operador.",
    note: "Agrupa pelo operador que finalizou a venda. O total concluído exclui vendas atualmente canceladas.",
    summary: [{ key: "operators_count", label: "Operadores", kind: "qty" }, { key: "sales_count", label: "Vendas", kind: "qty" }, { key: "completed_amount", label: "Total concluído", kind: "money" }],
    columns: [{ key: "operator", label: "Operador" }, { key: "sales_count", label: "Vendas", kind: "qty" }, { key: "cancelled_count", label: "Canceladas", kind: "qty" }, { key: "completed_amount", label: "Total concluído", kind: "money" }],
  },
};
