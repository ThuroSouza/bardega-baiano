import { ArrowRight, Building2, FileUp, Link2, ShieldCheck } from "lucide-react";
import { Badge } from "../../components/ui/Badge";
import { Card } from "../../components/ui/Card";

export default function IntegracoesPage() {
  return (
    <div className="page-stack integrations-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">SISTEMA · INTEGRAÇÕES</div>
          <h1>Integrações bancárias</h1>
          <p>Acompanhe a disponibilidade de conexões e conciliação bancária.</p>
        </div>
        <Badge tone="neutral">Não configurada</Badge>
      </div>

      <Card className="integration-overview">
        <div className="integration-overview-icon"><Building2 size={28} strokeWidth={1.6} /></div>
        <div>
          <div className="integration-kicker">CONEXÃO BANCÁRIA</div>
          <h2>Nenhuma conta conectada</h2>
          <p>A integração automática será disponibilizada após a escolha e configuração de um provedor compatível com Open Finance Brasil.</p>
        </div>
        <Badge tone="neutral">Não configurada</Badge>
      </Card>

      <div className="integration-grid">
        <Card className="integration-feature">
          <div className="integration-feature-icon"><Link2 size={21} /></div>
          <h2>Conexão autorizada</h2>
          <p>Quando disponível, a conexão seguirá o processo oficial de autorização do provedor. Nenhuma senha bancária será solicitada nesta página.</p>
          <span>Disponível em uma etapa futura</span>
        </Card>
        <Card className="integration-feature">
          <div className="integration-feature-icon"><FileUp size={21} /></div>
          <h2>Importação e conciliação</h2>
          <p>O planejamento inclui importação manual de extratos e comparação entre transações bancárias e lançamentos do sistema.</p>
          <span>Disponível em uma etapa futura</span>
        </Card>
      </div>

      <Card className="integration-flow">
        <div className="integration-flow-heading"><ShieldCheck size={20} /><h2>Como a conexão funcionará</h2></div>
        <div className="integration-flow-steps">
          <span>Sistema</span><ArrowRight size={16} aria-hidden="true" />
          <span>Serviço seguro</span><ArrowRight size={16} aria-hidden="true" />
          <span>Provedor Open Finance</span><ArrowRight size={16} aria-hidden="true" />
          <span>Banco</span>
        </div>
        <p>A conexão bancária não é feita diretamente pelo navegador. A autorização e o acesso aos dados dependerão da implantação segura do provedor escolhido.</p>
      </Card>
    </div>
  );
}
