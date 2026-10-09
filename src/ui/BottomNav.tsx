import { ITEM_TYPES, ItemType, TYPE_LABEL } from "../types";
import { IconCategory, IconHome } from "./icons";

interface Props {
  active: ItemType | "home";
  onSelect: (t: ItemType | "home") => void; // pulsar la pestaña en la que ya estás vuelve arriba
}

/** Barra de navegación inferior (al alcance del pulgar): Inicio y las cuatro categorías. */
export default function BottomNav({ active, onSelect }: Props) {
  const tabs: [ItemType | "home", string][] = [["home", "Inicio"], ...ITEM_TYPES.map((t): [ItemType, string] => [t, TYPE_LABEL[t]])];
  return (
    <nav className="bottom-nav" aria-label="Secciones">
      {tabs.map(([t, label]) => (
        <button key={t} className={`nav-item ${t}`} aria-current={active === t ? "page" : undefined} onClick={() => onSelect(t)}>
          <span className="nav-pill">{t === "home" ? <IconHome /> : <IconCategory type={t} />}</span>
          <span className="nav-label">{label}</span>
        </button>
      ))}
    </nav>
  );
}
