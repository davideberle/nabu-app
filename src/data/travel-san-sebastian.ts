// ---------------------------------------------------------------------------
// San Sebastian 2026 — static trip data projection
// ---------------------------------------------------------------------------
// Canonical trip brief: projects/travel/SAN-SEBASTIAN-2026.md
// This file is the deployable data mirror for the Companion App board.
// ---------------------------------------------------------------------------

export type TravelItemStatus = "idea" | "planned" | "done";

export interface TravelItem {
  id: string;
  label: string;
  timing?: string;
  effort?: string;
  note?: string;
  booking?: string;
}

export interface TravelCategory {
  id: string;
  name: string;
  emoji: string;
  description: string;
  items: TravelItem[];
}

export const TRIP_ID = "san-sebastian-2026";

export const categories: TravelCategory[] = [
  {
    id: "surf-week-dinners",
    name: "Surf-week dinners",
    emoji: "🏄",
    description:
      "Low-friction restaurant or home options after 19:00 during weeks 1 and 2, when kids finish surf late.",
    items: [
      {
        id: "lukainkategi",
        label: "Lukainkategi",
        timing: "Walking distance from Aingeru Zaindaria Bidea",
        note: "Close to home — check menu and whether reservation helps on weeknights",
      },
      {
        id: "eme-be-garrote",
        label: "eMe Be Garrote",
        timing: "Ibaeta, short drive or walk",
        note: "Basque classics in a casual neighbourhood setting",
      },
      {
        id: "ondarreta-antiguo-scan",
        label: "Ondarreta / Antiguo casual dinner scan",
        timing: "Nearby on the way home from surf",
        note: "Walk the strip and note which places look good for a quick family dinner",
      },
      {
        id: "home-dinner-simple",
        label: "Simple home dinner after surf",
        timing: "After 19:00",
        effort: "Low",
        note: "Pasta, tortilla, or something quick — kids will be tired",
      },
    ],
  },
  {
    id: "nearby-food",
    name: "Nearby food",
    emoji: "🍽️",
    description:
      "Restaurants around Antiguo, Ibaeta, Ondarreta, and the home route worth trying across the stay.",
    items: [
      {
        id: "parte-vieja-pintxos",
        label: "Parte Vieja pintxos evening",
        timing: "Any evening, especially weekends",
        effort: "Medium — drive or bus to old town",
        note: "Classic pintxos crawl through the old town bars",
      },
      {
        id: "gros-pintxos",
        label: "Gros neighbourhood dinner",
        timing: "Any evening",
        note: "Gros has a more local, less touristy food scene — worth exploring",
      },
      {
        id: "sidrerias",
        label: "Sidreria experience",
        timing: "Book ahead, typically evening",
        effort: "Medium — most are outside the city centre",
        booking: "Check availability and whether kids are welcome",
        note: "Traditional cider house meal with txotx ritual",
      },
      {
        id: "market-bretxa",
        label: "La Bretxa market visit",
        timing: "Morning",
        note: "Fresh produce, local cheese, and a feel for Basque ingredients",
      },
    ],
  },
  {
    id: "yoga-wellness",
    name: "Yoga and wellness",
    emoji: "🧘",
    description: "Studios or classes to investigate and try during the stay.",
    items: [
      {
        id: "omy-ondarreta",
        label: "OMY Ondarreta",
        timing: "Check schedule — close to the house",
        booking: "Look up class timetable and drop-in policy",
      },
      {
        id: "iyengar-yoga-leku",
        label: "Iyengar Yoga Leku",
        booking: "Check if they offer drop-in or short-term passes",
      },
      {
        id: "yoga-shala-calma",
        label: "Yoga Shala / Calma",
        timing: "City centre options",
        booking: "Check schedule and style",
        note: "Might suit mornings or adult flex days",
      },
    ],
  },
  {
    id: "after-school",
    name: "After-school adventures",
    emoji: "🎒",
    description:
      "Weeks 3 and 4: kids are out at 15:00, so there is time for an afternoon activity before dinner.",
    items: [
      {
        id: "ondarreta-beach",
        label: "Ondarreta / La Concha beach afternoon",
        timing: "After 15:00",
        effort: "Low — walking distance",
      },
      {
        id: "urgull-after-school",
        label: "Monte Urgull quick loop",
        timing: "After 15:00, ~1–1.5h",
        effort: "Low–medium",
        note: "Views over the bay, castle at the top",
      },
      {
        id: "aquarium",
        label: "San Sebastian Aquarium",
        timing: "Afternoon",
        effort: "Low",
        booking: "Check opening hours",
      },
      {
        id: "igeldo-funicular",
        label: "Monte Igueldo funicular + amusement park",
        timing: "Afternoon, ~2h",
        effort: "Low",
        booking: "Check if funicular and rides are running",
        note: "Retro amusement park with great views — kids may love it",
      },
      {
        id: "skatepark-zubieta",
        label: "Zubieta skatepark / sports afternoon",
        timing: "After 15:00",
        effort: "Low",
      },
    ],
  },
  {
    id: "hikes",
    name: "Hikes",
    emoji: "🥾",
    description:
      "From city micro-hikes to larger coastal walks. Check weather and tide where noted.",
    items: [
      {
        id: "ulia-pasaia",
        label: "Monte Ulia to Pasaia",
        timing: "Half day",
        effort: "Medium — some elevation, exposed sections",
        note: "Dramatic coastal path ending in the fishing village of Pasaia. Can bus back",
      },
      {
        id: "urgull-loop",
        label: "Urgull loop",
        timing: "1–2h",
        effort: "Low",
        note: "City hike with harbour views and the Sagrado Corazon statue",
      },
      {
        id: "zumaia-flysch",
        label: "Zumaia Flysch coastal walk",
        timing: "Half day + drive",
        effort: "Medium",
        booking: "Check tide — the beach section is tide-sensitive",
        note: "Spectacular geological formations along the coast",
      },
      {
        id: "jaizkibel-talaia",
        label: "Jaizkibel / Talaia short section",
        timing: "Half day + drive",
        effort: "Medium",
        note: "Coastal ridge with wide views over the Basque coast. Pick a shorter section for kids",
      },
      {
        id: "igeldo-camino",
        label: "Igueldo / Camino coastal bits",
        timing: "2–3h",
        effort: "Low–medium",
        note: "Starts near the house — follow the coastal path west",
      },
    ],
  },
  {
    id: "weekend-excursions",
    name: "Weekend excursions",
    emoji: "🚗",
    description:
      "Full-family car days for weekends. Three bigger weekend windows across the stay.",
    items: [
      {
        id: "pasaia-albaola",
        label: "Pasaia + Albaola maritime museum",
        timing: "Half day",
        effort: "Low–medium",
        note: "Colourful fishing village and the historic Basque whaling ship replica",
      },
      {
        id: "zarautz-getaria-zumaia",
        label: "Zarautz / Getaria / Zumaia coastal day",
        timing: "Full day",
        effort: "Low — car + walking",
        note: "Surf town, grilled fish in Getaria, and Flysch geology in Zumaia",
      },
      {
        id: "hondarribia-hendaye",
        label: "Hondarribia + Hendaye",
        timing: "Half to full day",
        effort: "Low",
        note: "Beautiful walled town on the French border. Ferry across to Hendaye for the beach",
      },
      {
        id: "saint-jean-biarritz",
        label: "Saint-Jean-de-Luz / Biarritz",
        timing: "Full day",
        effort: "Low — car, ~45 min",
        note: "French Basque coast — town centre, beach, and Biarritz surfing vibe",
      },
      {
        id: "bilbao-guggenheim",
        label: "Bilbao / Guggenheim",
        timing: "Full day",
        effort: "Medium — ~1h drive each way",
        booking: "Check exhibition schedule and book tickets online",
        note: "Guggenheim museum plus the Casco Viejo for pintxos",
      },
      {
        id: "gaztelugatxe-urdaibai",
        label: "Gaztelugatxe / Urdaibai",
        timing: "Full day",
        effort: "Medium — drive + stairs",
        booking: "Gaztelugatxe often requires a free reservation in summer",
        note: "Dramatic island hermitage (Game of Thrones location) and the Urdaibai biosphere",
      },
    ],
  },
  {
    id: "adult-flex",
    name: "Adult / flex days",
    emoji: "🌿",
    description:
      "Bigger or less child-centred outings for the last two weeks when schedules loosen up.",
    items: [
      {
        id: "adult-pintxos-evening",
        label: "Adults-only pintxos evening in Parte Vieja",
        timing: "Evening",
        note: "Longer, more adventurous pintxos run without kid-pace constraints",
      },
      {
        id: "txakoli-winery",
        label: "Txakoli winery visit near Getaria",
        timing: "Half day",
        booking: "Check visiting hours and reservation",
        note: "Local Basque white wine straight from the source",
      },
      {
        id: "spa-la-perla",
        label: "La Perla spa / thalassotherapy",
        timing: "Morning or afternoon",
        booking: "Check availability",
        note: "Historic spa on La Concha — salt water pools and views",
      },
    ],
  },
  {
    id: "rioja",
    name: "Rioja",
    emoji: "🍷",
    description:
      "Dedicated full-day wine-country plan. Rioja Alavesa is about 1.5h south.",
    items: [
      {
        id: "rioja-full-day",
        label: "Rioja full day: Haro Barrio de la Estacion + Laguardia / Briones",
        timing: "Full day — leave early, ~1.5h drive",
        effort: "Medium — long day with driving",
        booking: "Book winery visits in advance — Barrio de la Estacion bodegas often require reservation",
        note: "Visit 1–2 bodegas in Haro's historic wine district, then Laguardia for the medieval walled town or Briones for the Vivanco wine museum. Lunch in Laguardia or Haro",
      },
      {
        id: "rioja-overnight",
        label: "Rioja overnight option",
        timing: "Two days / one night",
        effort: "Higher — needs accommodation",
        booking: "Book hotel and winery visits",
        note: "More relaxed pace — Haro day one, Laguardia/Elciego day two. Could include Marques de Riscal in Elciego",
      },
    ],
  },
  {
    id: "rainy-day",
    name: "Rainy-day / city",
    emoji: "🌧️",
    description:
      "Indoor or weather-resilient options for when the coast is not appealing.",
    items: [
      {
        id: "san-telmo-museum",
        label: "San Telmo Museum",
        timing: "2–3h",
        effort: "Low",
        note: "Basque culture and history in a converted convent in the old town",
      },
      {
        id: "aquarium-rainy",
        label: "San Sebastian Aquarium",
        timing: "1–2h",
        effort: "Low",
        booking: "Check opening hours",
      },
      {
        id: "cinema-day",
        label: "Cinema afternoon",
        timing: "Afternoon",
        note: "Check local listings for Spanish-dubbed or original-language screenings",
      },
      {
        id: "indoor-pool",
        label: "Municipal pool / indoor swimming",
        timing: "Afternoon",
        booking: "Check public session times",
      },
      {
        id: "cooking-class",
        label: "Basque cooking class",
        timing: "Half day",
        effort: "Low",
        booking: "Book in advance — popular with tourists",
        note: "Several schools offer pintxos or Basque cuisine workshops",
      },
    ],
  },
];

// Flat lookup for validation
const _itemIndex = new Map<string, TravelItem>();
for (const cat of categories) {
  for (const item of cat.items) {
    _itemIndex.set(item.id, item);
  }
}

export function getItemById(id: string): TravelItem | undefined {
  return _itemIndex.get(id);
}

export function getAllItemIds(): string[] {
  return [..._itemIndex.keys()];
}
