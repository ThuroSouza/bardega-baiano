import { Link } from "react-router";
import { ArrowRight } from "lucide-react";
export function SectionLinks({
  items,
}: {
  items: { label: string; path: string; description: string }[];
}) {
  return (
    <nav className="section-links" aria-label="Páginas relacionadas">
      {items.map((item) => (
        <Link to={item.path} className="section-link" key={item.path}>
          <span>
            <strong>{item.label}</strong>
            <small>{item.description}</small>
          </span>
          <ArrowRight size={17} />
        </Link>
      ))}
    </nav>
  );
}
