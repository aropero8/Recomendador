import type { ItemType } from "../types";

// Iconos de trazo: heredan el color del texto
const svg = { width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export const IconBack = () => (
  <svg {...svg} aria-hidden>
    <path d="M15 18l-6-6 6-6" />
  </svg>
);

export const IconRefresh = () => (
  <svg {...svg} aria-hidden>
    <path d="M21 12a9 9 0 0 1-15.5 6.2L3 16" />
    <path d="M3 21v-5h5" />
    <path d="M3 12a9 9 0 0 1 15.5-6.2L21 8" />
    <path d="M21 3v5h-5" />
  </svg>
);

export const IconData = () => (
  <svg {...svg} aria-hidden>
    <ellipse cx="12" cy="5" rx="8" ry="3" />
    <path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5" />
    <path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
  </svg>
);

export const IconSettings = () => (
  <svg {...svg} aria-hidden>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </svg>
);

export const IconHome = () => (
  <svg {...svg} aria-hidden>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5 9v11h5v-6h4v6h5V9" />
  </svg>
);

export const IconSearch = () => (
  <svg {...svg} aria-hidden>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
);

export const IconPlus = () => (
  <svg {...svg} aria-hidden>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const IconImage = () => (
  <svg {...svg} aria-hidden>
    <rect x="3" y="3" width="18" height="18" rx="3" />
    <circle cx="9" cy="9" r="2" />
    <path d="m21 15-4.5-4.5L6 21" />
  </svg>
);

export const IconEdit = () => (
  <svg {...svg} aria-hidden>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
  </svg>
);

export const IconCheck = () => (
  <svg {...svg} aria-hidden>
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

export const IconTrash = () => (
  <svg {...svg} aria-hidden>
    <path d="M3 6h18" />
    <path d="M8 6V4h8v2" />
    <path d="M19 6l-1 14H6L5 6" />
  </svg>
);

export const IconExternal = () => (
  <svg {...svg} aria-hidden>
    <path d="M14 4h6v6" />
    <path d="M20 4 10 14" />
    <path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />
  </svg>
);

export const IconClose = () => (
  <svg {...svg} aria-hidden>
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);

export const IconSort = () => (
  <svg {...svg} aria-hidden>
    <path d="M7 4v16M3 16l4 4 4-4" />
    <path d="M17 20V4M13 8l4-4 4 4" />
  </svg>
);

export const IconChevron = () => (
  <svg {...svg} aria-hidden>
    <path d="m9 6 6 6-6 6" />
  </svg>
);

// Categorías: anime (tele), manga (libro abierto), películas (película), libros (libro)
const CATEGORY: Record<ItemType, JSX.Element> = {
  anime: (
    <>
      <rect x="2" y="7" width="20" height="14" rx="2.5" />
      <path d="m17 2-5 5-5-5" />
    </>
  ),
  manga: (
    <>
      <path d="M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2z" />
      <path d="M22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z" />
    </>
  ),
  movie: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2.5" />
      <path d="M7.5 3v18M16.5 3v18M3 12h18M3 7.5h4.5M3 16.5h4.5M16.5 7.5H21M16.5 16.5H21" />
    </>
  ),
  book: (
    <>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </>
  ),
};

export const IconCategory = ({ type }: { type: ItemType }) => (
  <svg {...svg} aria-hidden>
    {CATEGORY[type]}
  </svg>
);

export const IconShuffle = () => (
  <svg {...svg} aria-hidden>
    <path d="M16 3h5v5" />
    <path d="M4 20 21 3" />
    <path d="M21 16v5h-5" />
    <path d="m15 15 6 6" />
    <path d="m4 4 5 5" />
  </svg>
);

/** Ruleta: rueda con seis radios. */
export const IconWheel = () => (
  <svg {...svg} aria-hidden>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="2" />
    <path d="M12 3v7M12 14v7M13.7 11l6.1-3.5M13.7 13l6.1 3.5M10.3 11 4.2 7.5M10.3 13l-6.1 3.5" />
  </svg>
);

export const IconSparkle = () => (
  <svg {...svg} aria-hidden>
    <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
    <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" />
  </svg>
);
