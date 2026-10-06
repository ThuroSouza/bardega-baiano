import type { ReactNode } from "react";
import { Link } from "react-router";
import { ArrowLeft, Construction } from "lucide-react";
import { Badge } from "../components/ui/Badge";
import { Card } from "../components/ui/Card";

export function ModulePage({
  title,
  description,
  category = "Módulo",
  backTo,
  children,
}: {
  title: string;
  description: string;
  category?: string;
  backTo?: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-stack">
      {backTo && (
        <Link to={backTo} className="back-link">
          <ArrowLeft size={17} /> Voltar
        </Link>
      )}
      <div className="page-heading">
        <div>
          <div className="eyebrow">{category}</div>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        <Badge tone="amber">Em preparação</Badge>
      </div>
      {children}
      <Card className="empty-module">
        <div className="empty-module-icon">
          <Construction size={25} strokeWidth={1.6} />
        </div>
        <h2>Área pronta para receber o módulo</h2>
        <p>
          Esta página já tem uma rota própria. Os dados e as operações serão
          adicionados no bloco correspondente.
        </p>
      </Card>
    </div>
  );
}
