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
  vintage: number;
  color: "red" | "white" | "rosé";
  style: string;
  pairingUse: string;
  imageUrl?: string;
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
    style:
      "Robust Tuscan red blend; 75% Merlot / 25% Sangiovese, cherry-cola/dark-cherry, toasted/nutty and spice notes.",
    pairingUse:
      "Richer tomato, lamb, grilled meat, umami-heavy dishes; a bit much for delicate coconut/seafood-style plates.",
  },
  {
    id: "domaine-des-evigneaux-rasteau-2024",
    producer: "Domaine des Evigneaux",
    wine: "Rasteau",
    appellation: "Rasteau",
    country: "France",
    region: "Southern Rhône",
    vintage: 2024,
    color: "red",
    style:
      "Southern Rhône red based around Grenache/Syrah/Carignan; dark/red fruit, garrigue, spice, balsamic warmth, moderate-to-firm tannin.",
    pairingUse:
      "Good weekday red for Moroccan/North African vegetable stews, harissa, sweet potato, chickpeas/beans, grilled vegetables, sausages or lamb.",
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
    style:
      "Bold Argentine red blend; dark fruit, spice, ripe/silky tannins, broad body.",
    pairingUse:
      "Best for bigger food: steak, grilled meats, rich stews, barbecue, mature cheese.",
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
    style:
      "Approachable Tuscan red blend; fresh berry/cherry fruit, silky tannins, fresh herbal/stony notes.",
    pairingUse:
      "Flexible red for weekday/smart-casual dinners: tomato sauces, roasted vegetables, mushrooms, lighter meat.",
  },
];
