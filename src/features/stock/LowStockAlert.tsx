import { useQuery } from "@tanstack/react-query";
import { TriangleAlert } from "lucide-react";
import { Link } from "react-router";
import { Card } from "../../components/ui/Card";
import { can } from "../../config/permissions";
import { useAuth } from "../../hooks/useAuth";
import { listStockItems } from "./api";

export function LowStockAlert() {
  const auth = useAuth();
  const allowed = Boolean(auth.profile && can(auth.permissions, "stock.read"));
  const query = useQuery({ queryKey: ["stock"], queryFn: listStockItems, enabled: allowed });
  if (!allowed || !query.data) return null;
  const low = query.data.filter((item) => item.is_active && item.minimum_stock > 0 && item.quantity <= item.minimum_stock);
  if (low.length === 0) return null;
  return <Card className="stock-alert"><TriangleAlert size={19} /><div><strong>Estoque baixo: {low.length} produto{low.length === 1 ? "" : "s"}</strong>
    <p>{low.slice(0, 3).map((item) => `${item.name} (${item.quantity}/${item.minimum_stock} ${item.unit})`).join(" · ")}</p>
    <Link to="/estoque" className="stock-alert-link">Ver estoque →</Link></div></Card>;
}
