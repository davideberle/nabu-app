// ---------------------------------------------------------------------------
// San Sebastian 2026 — static trip data projection
// ---------------------------------------------------------------------------
// Canonical trip brief: projects/travel/SAN-SEBASTIAN-2026.md
// This file is the deployable data mirror for the Companion App board.
// Phase 2: enriched metadata, main-category structure.
// ---------------------------------------------------------------------------

export type TravelItemStatus = "idea" | "planned" | "done";

/** Price bracket for restaurants. */
export type PriceBracket = "$" | "$$" | "$$$" | "$$$$";

/** Hike-specific statistics. */
export interface HikeStats {
  /** Distance of the loop in km. */
  lengthKm: number;
  /** Estimated duration, e.g. "1.5h" or "3–4h". */
  duration: string;
  /** Total altitude gain in metres. */
  altitudeGainM: number;
  /** Distance from home to trailhead in km (approx). */
  distanceFromHomeKm: number;
  /** Where the recommendation came from. */
  sourceLabel?: string;
}

/** Excursion-specific metadata. */
export interface ExcursionMeta {
  /** Tags like "sunny", "rainy", "adults", "family". */
  tags: string[];
  /** Approximate distance from home in km. */
  distanceKm: number;
  /** Approximate time needed, e.g. "Full day" or "Half day". */
  timeNeeded: string;
}

export interface TravelItem {
  id: string;
  label: string;

  // -- general optional metadata --
  note?: string;
  /** Tags displayed as chips, e.g. ["pintxos","family"]. */
  tags?: string[];
  /** Opening/service hours, e.g. "Tue–Sat 13:00–15:30, 20:30–22:30". */
  hours?: string;
  /** Schedule info for yoga/classes. */
  schedule?: string;
  /** Price bracket for restaurants. */
  price?: PriceBracket;
  /** Michelin status, e.g. "1 Star", "Bib Gourmand", or undefined. */
  michelin?: string;
  /** Google Maps rating, e.g. 4.6. */
  googleRating?: number;
  /** Approximate distance from home base in km. */
  distanceFromHomeKm?: number;
  /** Google Maps link (search or place). */
  mapUrl?: string;
  /** Primary website link. */
  websiteUrl?: string;
  /** Source or further-info link (hike map, guide page, etc.). */
  sourceUrl?: string;
  /** Label for sourceUrl, e.g. "Michelin Guide", "Hiking Iberia". */
  sourceLabel?: string;
  /** Short category tag for display, e.g. "Museum", "Beach". */
  categoryTag?: string;

  // -- domain-specific blocks --
  hikeStats?: HikeStats;
  excursionMeta?: ExcursionMeta;

  // -- legacy fields kept for backwards compat with stored states --
  timing?: string;
  effort?: string;
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

// ---------------------------------------------------------------------------
// Home base reference: Aingeru Zaindaria Bidea 45, Antiguo/Ibaeta area.
// Distances are approximate (driving unless noted).
// ---------------------------------------------------------------------------

export const categories: TravelCategory[] = [
  // ===== 1. FOOD =====
  {
    id: "food",
    name: "Food",
    emoji: "🍽️",
    description:
      "Restaurants, pintxos bars, and food experiences. Checked against the Michelin Guide where applicable.",
    items: [
      {
        id: "eme-be-garrote",
        label: "eMe Be Garrote",
        hours: "Tue–Sat 13:00–15:30, 20:30–22:30; closed Sun–Mon",
        price: "$$$",
        michelin: "1 Star",
        googleRating: 4.5,
        distanceFromHomeKm: 1.5,
        mapUrl: "https://www.google.com/maps/search/eMe+Be+Garrote+San+Sebastian",
        note: "Creative Basque cuisine in Ibaeta. One Michelin star, 1 Repsol Sun. Tasting menus ~40–60 EUR. Star/Repsol info verified via external sources.",
        tags: ["michelin", "neighbourhood"],
      },
      {
        id: "rekondo",
        label: "Rekondo",
        hours: "Mon & Thu–Sun 13:00–15:30, 20:30–22:30; closed Tue–Wed",
        price: "$$$$",
        michelin: "Michelin Selected",
        googleRating: 4.5,
        distanceFromHomeKm: 1,
        mapUrl: "https://www.google.com/maps/search/Rekondo+San+Sebastian",
        note: "Legendary wine cellar (over 100 000 bottles). Traditional Basque cuisine on Monte Igueldo slopes. Michelin Guide recommended (not starred).",
        sourceUrl: "https://guide.michelin.com/us/en/pais-vasco/es-donostia-san-sebastian/restaurant/rekondo",
        sourceLabel: "Michelin Guide",
        tags: ["wine", "classic"],
      },
      {
        id: "lukainkategi",
        label: "Lukainkategi",
        hours: "Mon–Sat 13:00–15:30, 20:00–22:30; closed Sun",
        price: "$$",
        googleRating: 4.4,
        distanceFromHomeKm: 0.4,
        mapUrl: "https://www.google.com/maps/search/Lukainkategi+San+Sebastian",
        note: "Walking distance from home. Honest neighbourhood Basque cooking. Good for a quick weeknight dinner.",
        tags: ["neighbourhood", "family-friendly"],
      },
      {
        id: "kokotxa",
        label: "Kokotxa",
        hours: "Tue–Sat 13:00–15:00, 20:00–22:30; closed Sun–Mon",
        price: "$$$$",
        michelin: "1 Star",
        googleRating: 4.6,
        distanceFromHomeKm: 3.5,
        mapUrl: "https://www.google.com/maps/search/Kokotxa+restaurant+San+Sebastian",
        note: "One Michelin star in the heart of Parte Vieja. Modern Basque cuisine; tasting menus from ~85 EUR.",
        sourceUrl: "https://guide.michelin.com/us/en/pais-vasco/es-donostia-san-sebastian/restaurant/kokotxa",
        sourceLabel: "Michelin Guide",
        tags: ["michelin", "old-town"],
      },
      {
        id: "akelarre",
        label: "Akelarre",
        hours: "Wed–Sun 13:00–15:00, 20:30–22:00; closed Mon–Tue",
        price: "$$$$",
        michelin: "3 Stars",
        googleRating: 4.7,
        distanceFromHomeKm: 4,
        mapUrl: "https://www.google.com/maps/search/Akelarre+restaurant+San+Sebastian",
        note: "Pedro Subijana's 3-star temple on Monte Igueldo. Ocean-view dining room. Tasting menus from ~220 EUR. Book well ahead.",
        sourceUrl: "https://guide.michelin.com/us/en/pais-vasco/es-donostia-san-sebastian/restaurant/akelare",
        sourceLabel: "Michelin Guide",
        tags: ["michelin", "fine-dining", "special-occasion"],
      },
      {
        id: "elkano-getaria",
        label: "Elkano (Getaria)",
        hours: "Tue–Sat 13:00–15:30, 20:30–22:30; closed Sun dinner & Mon",
        price: "$$$$",
        michelin: "1 Star",
        googleRating: 4.5,
        distanceFromHomeKm: 25,
        mapUrl: "https://www.google.com/maps/search/Elkano+Getaria",
        note: "Iconic whole grilled turbot over charcoal in the fishing port of Getaria. One Michelin star. Combine with a Zarautz/Getaria coastal day.",
        sourceUrl: "https://guide.michelin.com/us/en/pais-vasco/getaria/restaurant/elkano",
        sourceLabel: "Michelin Guide",
        tags: ["michelin", "seafood", "day-trip"],
      },
      {
        id: "parte-vieja-pintxos",
        label: "Parte Vieja pintxos crawl",
        hours: "Most bars open 12:00–15:00 & 19:00–23:00",
        price: "$$",
        googleRating: 4.7,
        distanceFromHomeKm: 3.5,
        mapUrl: "https://www.google.com/maps/search/Parte+Vieja+San+Sebastian",
        note: "Classic old-town pintxos circuit. Key stops: Calle Fermín Calbetón, Calle 31 de Agosto. Go hungry, share everything.",
        tags: ["pintxos", "old-town", "family-friendly"],
      },
    ],
  },

  // ===== 2. YOGA =====
  {
    id: "yoga",
    name: "Yoga",
    emoji: "🧘",
    description:
      "Studios near the house. Check drop-in policies before showing up.",
    items: [
      {
        id: "omy-ondarreta",
        label: "OMY Ondarreta",
        schedule: "Morning & evening classes; check timetable for drop-in slots",
        googleRating: 4.9,
        distanceFromHomeKm: 0.8,
        mapUrl: "https://www.google.com/maps/search/OMY+Ondarreta+yoga+San+Sebastian",
        websiteUrl: "https://omy-yoga.com",
        note: "Closest studio to home. Various styles. Drop-in friendly.",
        tags: ["drop-in", "nearby"],
      },
      {
        id: "iyengar-yoga-leku",
        label: "Iyengar Yoga Leku",
        schedule: "Mon–Fri classes; check website for weekly timetable",
        googleRating: 5.0,
        distanceFromHomeKm: 2,
        mapUrl: "https://www.google.com/maps/search/Iyengar+Yoga+Leku+San+Sebastian",
        websiteUrl: "https://www.iyengaryogalekudonostia.com",
        note: "Dedicated Iyengar studio. Enquire about short-term or drop-in passes.",
        tags: ["iyengar", "alignment"],
      },
      {
        id: "awen-yoga",
        label: "Awen Yoga",
        schedule: "Mon–Sat; varied morning & evening schedule",
        googleRating: 4.8,
        distanceFromHomeKm: 3,
        mapUrl: "https://www.google.com/maps/search/Awen+Yoga+San+Sebastian",
        websiteUrl: "https://awenyogasansebastian.com",
        note: "Multiple styles (vinyasa, hatha, yin). City centre location.",
        tags: ["vinyasa", "multi-style"],
      },
    ],
  },

  // ===== 3. SMALL ADVENTURES =====
  {
    id: "small-adventures",
    name: "Small adventures",
    emoji: "🎒",
    description:
      "Things to do in and around the city. Afternoon-sized or rainy-day-proof.",
    items: [
      {
        id: "aquarium",
        label: "San Sebastian Aquarium",
        hours: "Daily 10:00–20:00 (summer); check for reduced winter hours",
        categoryTag: "Museum",
        distanceFromHomeKm: 3.5,
        mapUrl: "https://www.google.com/maps/search/Aquarium+San+Sebastian",
        websiteUrl: "https://www.aquariumss.com",
        note: "Walk-through ocean tunnel, touch pools for kids. Good rainy-day option.",
        tags: ["rainy", "family"],
      },
      {
        id: "igeldo-funicular",
        label: "Monte Igueldo funicular + amusement park",
        hours: "Summer: daily 10:00–21:00; funicular runs every 15 min",
        categoryTag: "Attraction",
        distanceFromHomeKm: 2,
        mapUrl: "https://www.google.com/maps/search/Monte+Igueldo+funicular+San+Sebastian",
        websiteUrl: "https://www.monteigueldo.es",
        note: "Retro amusement park with incredible views. Kids love the old-school rides.",
        tags: ["sunny", "family", "views"],
      },
      {
        id: "san-telmo-museum",
        label: "San Telmo Museum",
        hours: "Tue–Sun 10:00–20:00; closed Mon",
        categoryTag: "Museum",
        distanceFromHomeKm: 3.5,
        mapUrl: "https://www.google.com/maps/search/San+Telmo+Museum+San+Sebastian",
        websiteUrl: "https://www.santelmomuseoa.eus",
        note: "Basque culture and history in a converted 16th-century convent. Free on Tuesdays.",
        tags: ["rainy", "culture"],
      },
      {
        id: "la-perla-spa",
        label: "La Perla thalassotherapy",
        hours: "Daily 08:00–22:00 (check seasonal hours)",
        categoryTag: "Wellness",
        distanceFromHomeKm: 2.5,
        mapUrl: "https://www.google.com/maps/search/La+Perla+spa+San+Sebastian",
        websiteUrl: "https://www.la-perla.net",
        note: "Historic spa on La Concha. Salt-water pools with bay views. Good for an adult morning.",
        tags: ["rainy", "adults", "wellness"],
      },
      {
        id: "ondarreta-la-concha-beach",
        label: "Ondarreta / La Concha beach",
        hours: "Open access; lifeguards ~11:00–19:00 summer",
        categoryTag: "Beach",
        distanceFromHomeKm: 0.5,
        mapUrl: "https://www.google.com/maps/search/Ondarreta+beach+San+Sebastian",
        note: "Walking distance from home. Shallow, sheltered, great for kids.",
        tags: ["sunny", "family", "free"],
      },
      {
        id: "albaola-pasaia",
        label: "Albaola maritime museum (Pasaia)",
        hours: "Tue–Sat 10:00–14:00, 16:00–19:00; Sun 10:00–14:00; closed Mon",
        categoryTag: "Museum",
        distanceFromHomeKm: 8,
        mapUrl: "https://www.google.com/maps/search/Albaola+Pasaia",
        websiteUrl: "https://www.albaola.com",
        note: "Historic Basque whaling ship replica. Colourful fishing village. Combine with a Pasaia harbour walk.",
        tags: ["rainy", "family", "culture"],
      },
    ],
  },

  // ===== 4. HIKES =====
  {
    id: "hikes",
    name: "Hikes",
    emoji: "🥾",
    description:
      "Loop hikes only (car stays at trailhead). Distances/durations are approximate.",
    items: [
      {
        id: "urgull-loop",
        label: "Urgull loop",
        hikeStats: {
          lengthKm: 3,
          duration: "1–1.5h",
          altitudeGainM: 120,
          distanceFromHomeKm: 3.5,
          sourceLabel: "Local classic",
        },
        mapUrl: "https://www.google.com/maps/search/Monte+Urgull+San+Sebastian",
        sourceUrl: "https://www.sansebastianturismoa.eus",
        sourceLabel: "San Sebastian Tourism",
        note: "City-centre loop. Harbour views, Sagrado Corazon statue at the top. Paved paths, fine for kids.",
        tags: ["easy", "family", "city"],
      },
      {
        id: "igeldo-camino-loop",
        label: "Igueldo / Camino coastal loop",
        hikeStats: {
          lengthKm: 7,
          duration: "2–3h",
          altitudeGainM: 250,
          distanceFromHomeKm: 1,
          sourceLabel: "Local path network",
        },
        mapUrl: "https://www.google.com/maps/search/Monte+Igueldo+trail+San+Sebastian",
        note: "Starts near the house. Coastal path west then loops back via Igueldo summit road. Views over the bay.",
        tags: ["moderate", "nearby", "views"],
      },
      {
        id: "zumaia-flysch-loop",
        label: "Zumaia Flysch circular route",
        hikeStats: {
          lengthKm: 12.7,
          duration: "3–4h",
          altitudeGainM: 320,
          distanceFromHomeKm: 35,
          sourceLabel: "Hiking Iberia / Zumaia Tourism",
        },
        mapUrl: "https://www.google.com/maps/search/Zumaia+Flysch+trail",
        sourceUrl: "https://www.hikingiberia.com/resources/routes/en/cantabrian-mountains-basque-mountains-zumaia-flysch.pdf",
        sourceLabel: "Hiking Iberia",
        note: "Spectacular geological flysch formations. Full loop via cliffs and inland return. Tide-sensitive beach section — check tides.",
        tags: ["moderate", "geology", "coastal"],
      },
      {
        id: "jaizkibel-short-loop",
        label: "Jaizkibel short loop",
        hikeStats: {
          lengthKm: 8,
          duration: "2.5–3h",
          altitudeGainM: 350,
          distanceFromHomeKm: 18,
          sourceLabel: "Gipuzkoa tourism / local GPX tracks",
        },
        mapUrl: "https://www.google.com/maps/search/Jaizkibel+Hondarribia",
        sourceUrl: "https://zumaia.eus/en/tourism/what-to-do/trekking/zumaia-hikes-2019",
        sourceLabel: "Regional hiking guides",
        note: "Coastal ridge loop from the Guadalupe sanctuary area. Wide views over the Basque coast and France. Pick shorter variants for kids.",
        tags: ["moderate", "coastal", "views"],
      },
      {
        id: "ulia-loop",
        label: "Ulia coastal loop",
        hikeStats: {
          lengthKm: 6,
          duration: "2–2.5h",
          altitudeGainM: 200,
          distanceFromHomeKm: 5,
          sourceLabel: "San Sebastian Tourism",
        },
        mapUrl: "https://www.google.com/maps/search/Monte+Ulia+San+Sebastian",
        sourceUrl: "https://www.sansebastianturismoa.eus",
        sourceLabel: "San Sebastian Tourism",
        note: "Loop variant via Ulia summit and coastal cliffs, returning through the residential side. The famous linear Ulia–Pasaia route is not a loop; this stays on Ulia.",
        tags: ["moderate", "coastal", "city-edge"],
      },
    ],
  },

  // ===== 5. EXCURSIONS =====
  {
    id: "excursions",
    name: "Excursions",
    emoji: "🚗",
    description:
      "Day trips and bigger outings by car. Tags indicate weather/audience suitability.",
    items: [
      {
        id: "rioja-day",
        label: "Rioja wine country",
        excursionMeta: {
          tags: ["sunny", "adults"],
          distanceKm: 120,
          timeNeeded: "Full day",
        },
        mapUrl: "https://www.google.com/maps/search/Haro+Rioja+Alavesa",
        note: "Haro Barrio de la Estacion bodegas + Laguardia medieval town or Briones/Vivanco museum. Book winery visits ahead. ~1.5h drive each way.",
        tags: ["wine", "adults", "sunny"],
      },
      {
        id: "hondarribia-hendaye",
        label: "Hondarribia + Hendaye",
        excursionMeta: {
          tags: ["sunny", "rainy", "family"],
          distanceKm: 22,
          timeNeeded: "Half to full day",
        },
        mapUrl: "https://www.google.com/maps/search/Hondarribia",
        note: "Walled old town, colourful fishermen's quarter. Ferry across to Hendaye beach on the French side.",
        tags: ["family", "sunny", "border"],
      },
      {
        id: "zarautz-getaria-zumaia",
        label: "Zarautz / Getaria / Zumaia coastal day",
        excursionMeta: {
          tags: ["sunny", "family"],
          distanceKm: 25,
          timeNeeded: "Full day",
        },
        mapUrl: "https://www.google.com/maps/search/Getaria+Gipuzkoa",
        note: "Surf town Zarautz, grilled fish in Getaria harbour, Flysch geology in Zumaia. Can combine with Elkano lunch if booked.",
        tags: ["family", "sunny", "coastal", "food"],
      },
      {
        id: "bilbao-guggenheim",
        label: "Bilbao / Guggenheim",
        excursionMeta: {
          tags: ["rainy", "sunny", "family", "adults"],
          distanceKm: 100,
          timeNeeded: "Full day",
        },
        mapUrl: "https://www.google.com/maps/search/Guggenheim+Bilbao",
        websiteUrl: "https://www.guggenheim-bilbao.eus",
        note: "Guggenheim museum + Casco Viejo pintxos. ~1h drive. Book tickets online to skip queues.",
        tags: ["culture", "rainy", "family"],
      },
      {
        id: "french-basque-coast",
        label: "French Basque coast (Saint-Jean / Biarritz)",
        excursionMeta: {
          tags: ["sunny", "family"],
          distanceKm: 50,
          timeNeeded: "Full day",
        },
        mapUrl: "https://www.google.com/maps/search/Saint+Jean+de+Luz",
        note: "Saint-Jean-de-Luz town centre and beach, Biarritz surf scene. ~45 min drive. Good patisseries.",
        tags: ["family", "sunny", "beach", "france"],
      },
      {
        id: "gaztelugatxe-urdaibai",
        label: "Gaztelugatxe / Urdaibai",
        excursionMeta: {
          tags: ["sunny", "family"],
          distanceKm: 75,
          timeNeeded: "Full day",
        },
        mapUrl: "https://www.google.com/maps/search/Gaztelugatxe",
        note: "Dramatic island hermitage (Game of Thrones). Free reservation often required in summer. Combine with Urdaibai biosphere reserve.",
        tags: ["family", "sunny", "iconic"],
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
