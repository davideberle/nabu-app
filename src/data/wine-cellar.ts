/**
 * Wine cellar seed data.
 *
 * This is a bundled mirror for the companion-app MVP.
 * Canonical domain ownership: projects/kitchen/wine-cellar.json
 */

export interface WineBottle {
  id: string;
  producer: string;
  wine: string;
  appellation: string;
  country: string;
  region: string;
  vintage: number | null;
  color: "red" | "white" | "rosé";
  grapes?: string;
  style: string;
  pairingUse: string;
  imageUrl?: string;
  imageKind?: "product" | "photo";
  sourceNote?: string;
  sourceUrl?: string;
}

export const wineBottles: WineBottle[] = [
  {
    id: "tenuta-luce-lucente-toscana-2021",
    producer: "Tenuta Luce",
    wine: "Lucente",
    appellation: "Toscana IGT",
    country: "Italy",
    region: "Tuscany",
    vintage: 2021,
    color: "red",
    grapes: "Merlot, Sangiovese",
    style:
      "Robust Tuscan red blend with cherry-cola, blackberry, violet, toasted hazelnut and smooth spice.",
    pairingUse:
      "Richer tomato, lamb, grilled meat, umami-heavy dishes; a bit much for delicate coconut/seafood-style plates.",
    imageUrl: "/wine/lucente-2021.jpg",
    sourceUrl: "https://vintus.com/wines/lucente/luce-lucente-2021/",
  },
  {
    id: "domaine-des-evigneaux-rasteau-2024",
    producer: "Domaine Les Evigneaux",
    wine: "Rasteau",
    appellation: "Rasteau",
    country: "France",
    region: "Southern Rhône",
    vintage: 2024,
    color: "red",
    grapes: "Grenache, Syrah, Mourvedre, Carignan",
    style:
      "Southern Rhône red based around Grenache/Syrah/Carignan; dark/red fruit, garrigue, spice, balsamic warmth, moderate-to-firm tannin.",
    pairingUse:
      "Good weekday red for Moroccan/North African vegetable stews, harissa, sweet potato, chickpeas/beans, grilled vegetables, sausages or lamb.",
    imageUrl: "/wine/rasteau-evigneaux.png",
    sourceUrl: "https://boutinot.com/wines/domaine-les-evigneaux-rasteau/",
  },
  {
    id: "michel-rolland-clos-de-los-siete-2021",
    producer: "Clos de los Siete / Michel Rolland",
    wine: "Clos de los Siete",
    appellation: "Valle de Uco, Mendoza",
    country: "Argentina",
    region: "Mendoza",
    vintage: 2021,
    color: "red",
    grapes: "Malbec-led Bordeaux blend",
    style:
      "Bold Argentine red blend; dark fruit, spice, ripe/silky tannins, broad body.",
    pairingUse:
      "Best for bigger food: steak, grilled meats, rich stews, barbecue, mature cheese.",
    imageUrl: "/wine/clos-de-los-siete-2021.png",
    sourceUrl: "https://www.closdelossiete.com/",
  },
  {
    id: "ornellaia-le-volte-dell-ornellaia-2023",
    producer: "Ornellaia",
    wine: "Le Volte dell'Ornellaia",
    appellation: "Toscana IGT",
    country: "Italy",
    region: "Tuscany",
    vintage: 2023,
    color: "red",
    grapes: "Merlot, Sangiovese, Cabernet Sauvignon",
    style:
      "Approachable Tuscan red blend; fresh berry/cherry fruit, silky tannins, fresh herbal/stony notes.",
    pairingUse:
      "Flexible red for weekday/smart-casual dinners: tomato sauces, roasted vegetables, mushrooms, lighter meat.",
    imageUrl: "/wine/le-volte-ornellaia-2023.png",
    sourceUrl: "https://www.ornellaia.com/en/wines/le-volte-dellornellaia-2023/",
  },
  {
    id: "vale-de-camelos-viola-campanica-branco",
    producer: "Vale de Camelos",
    wine: "Viola Campaniça Branco",
    appellation: "Vinho Regional Alentejano",
    country: "Portugal",
    region: "Alentejo",
    vintage: null,
    color: "white",
    grapes: "Campaniça",
    style:
      "Fresh organic Alentejo white with citrus, pale stone fruit and a lightly herbal local-grape character.",
    pairingUse:
      "Aperitif, salads, grilled vegetables, simple seafood, roast chicken, lemony pasta or lighter Portuguese-style plates.",
    imageUrl: "/wine/vale-de-camelos-viola-campanica-branco.jpg",
    imageKind: "photo",
    sourceNote:
      "Vintage not visible in David's 2026-05-18 bottle photo.",
  },
  {
    id: "pfaffl-hund-gruner-veltliner-reserve",
    producer: "Weingut R&A Pfaffl",
    wine: "Hund Grüner Veltliner Reserve",
    appellation: "Weinviertel DAC Reserve",
    country: "Austria",
    region: "Weinviertel",
    vintage: null,
    color: "white",
    grapes: "Grüner Veltliner",
    style:
      "Structured Grüner Veltliner Reserve with citrus, orchard fruit, white pepper and enough weight for richer food.",
    pairingUse:
      "Strong all-round white for schnitzel, pork, asparagus, herbs, creamy sauces, spicy vegetables and salty snacks.",
    imageUrl: "/wine/pfaffl-hund-gruner-veltliner-reserve.jpg",
    imageKind: "photo",
    sourceNote:
      "Vintage not visible in David's 2026-05-18 bottle photo; the 2025 medal is an award year, not the vintage.",
  },
];
