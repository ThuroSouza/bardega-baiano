import { Button } from "../../components/ui/Button";

export function FinancePagination({ total, page, pageSize, onPage }: {
  total: number; page: number; pageSize: number; onPage: (page: number) => void;
}) {
  if (total <= pageSize) return null;
  const pages = Math.ceil(total / pageSize);
  return <div className="cash-pagination"><Button variant="secondary" disabled={page === 0} onClick={() => onPage(page - 1)}>Anterior</Button><span>Página {page + 1} de {pages}</span><Button variant="secondary" disabled={page + 1 >= pages} onClick={() => onPage(page + 1)}>Próxima</Button></div>;
}
