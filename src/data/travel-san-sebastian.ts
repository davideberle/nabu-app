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

/** Sub-item/stop within an excursion or crawl. */
export interface TravelSubItem {
  id: string;
  label: string;
  note?: string;
  tags?: string[];
  mapUrl?: string;
  websiteUrl?: string;
  sourceUrl?: string;
  sourceLabel?: string;
  /** Cuisine/type for food sub-items. */
  cuisine?: string;
  hours?: string;
  price?: PriceBracket;
  michelin?: string;
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

  /** Cuisine or food type, e.g. "Basque", "Pintxos", "Japanese". */
  cuisine?: string;
  /** Attribution tags: "Michelin", "TripAdvisor Top", "Lonely Planet", etc. */
  sourceTags?: string[];
  /** Booking guidance, e.g. "Book 2 weeks ahead", "Walk-in OK". */
  booking?: string;

  // -- domain-specific blocks --
  hikeStats?: HikeStats;
  excursionMeta?: ExcursionMeta;
  /** Sub-items/stops for excursions or multi-stop entries. */
  subItems?: TravelSubItem[];

  // -- legacy fields kept for backwards compat with stored states --
  timing?: string;
  effort?: string;
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
      "Restaurants, pintxos bars, and food experiences. Biased toward easy weeknight dinners from Antiguo/Ibaeta. Excursion-worthy restaurants appear under their excursion instead.",
    items: [
      // --- Neighbourhood / <=2 km from home ---
      {
        id: "eme-be-garrote",
        label: "eMe Be Garrote",
        cuisine: "Creative Basque",
        hours: "Tue–Sat 13:00–15:30, 20:30–22:30; closed Sun–Mon",
        price: "$$$",
        michelin: "1 Star",
        googleRating: 4.5,
        distanceFromHomeKm: 1.5,
        mapUrl: "https://www.google.com/maps/search/eMe+Be+Garrote+San+Sebastian",
        note: "Creative Basque cuisine in Ibaeta. One Michelin star, 1 Repsol Sun. Tasting menus ~40–60 EUR.",
        tags: ["michelin", "neighbourhood"],
        sourceTags: ["Michelin"],
        booking: "Recommended, especially weekends",
      },
      {
        id: "rekondo",
        label: "Rekondo",
        cuisine: "Traditional Basque",
        hours: "Mon & Thu–Sun 13:00–15:30, 20:30–22:30; closed Tue–Wed",
        price: "$$$$",
        michelin: "Michelin Selected",
        googleRating: 4.5,
        distanceFromHomeKm: 1,
        mapUrl: "https://www.google.com/maps/search/Rekondo+San+Sebastian",
        note: "Legendary wine cellar (over 100 000 bottles). Traditional Basque cuisine on Monte Igueldo slopes.",
        sourceUrl: "https://guide.michelin.com/us/en/pais-vasco/es-donostia-san-sebastian/restaurant/rekondo",
        sourceLabel: "Michelin Guide",
        tags: ["wine", "classic"],
        sourceTags: ["Michelin"],
        booking: "Recommended",
      },
      {
        id: "lukainkategi",
        label: "Lukainkategi",
        cuisine: "Basque home cooking",
        hours: "Mon–Sat 13:00–15:30, 20:00–22:30; closed Sun",
        price: "$$",
        googleRating: 4.4,
        distanceFromHomeKm: 0.4,
        mapUrl: "https://www.google.com/maps/search/Lukainkategi+San+Sebastian",
        note: "Walking distance from home. Honest neighbourhood Basque cooking. Good for a quick weeknight dinner.",
        tags: ["neighbourhood", "family-friendly"],
        booking: "Walk-in OK",
      },
      {
        id: "branka",
        label: "Branka",
        cuisine: "Seafood / Basque",
        hours: "Daily 13:00–16:00, 20:00–23:00",
        price: "$$$",
        googleRating: 4.2,
        distanceFromHomeKm: 1.5,
        mapUrl: "https://www.google.com/maps/search/Branka+San+Sebastian",
        note: "Glass-walled restaurant right on the promenade facing La Concha. Great sunset views. Seafood-forward menu.",
        tags: ["seafood", "views", "neighbourhood"],
        sourceTags: ["TripAdvisor Top"],
        booking: "Recommended for terrace",
      },
      {
        id: "bokado",
        label: "Bokado (Kursaal)",
        cuisine: "Modern Basque",
        hours: "Tue–Sat 13:00–15:30, 20:30–22:30; closed Sun–Mon",
        price: "$$$",
        michelin: "Michelin Selected",
        googleRating: 4.3,
        distanceFromHomeKm: 4,
        mapUrl: "https://www.google.com/maps/search/Bokado+Kursaal+San+Sebastian",
        note: "Inside the Kursaal congress centre. Modern Basque with a view. Less formal than starred restaurants.",
        tags: ["modern", "views"],
        sourceTags: ["Michelin"],
        booking: "Recommended",
      },
      {
        id: "hidalgo-56",
        label: "Hidalgo 56",
        cuisine: "Modern Basque",
        hours: "Tue–Sat 13:00–15:30, 20:30–22:30; closed Sun–Mon",
        price: "$$$",
        michelin: "Michelin Selected",
        googleRating: 4.5,
        distanceFromHomeKm: 3,
        mapUrl: "https://www.google.com/maps/search/Hidalgo+56+San+Sebastian",
        note: "Market-driven modern Basque cooking in Gros. Good-value lunch menu.",
        tags: ["modern", "gros"],
        sourceTags: ["Michelin"],
        booking: "Recommended",
      },
      {
        id: "narru",
        label: "Narru",
        cuisine: "Modern Basque",
        hours: "Tue–Sat 13:00–15:30, 20:00–22:30; closed Sun–Mon",
        price: "$$$",
        michelin: "Michelin Selected",
        googleRating: 4.6,
        distanceFromHomeKm: 3.5,
        mapUrl: "https://www.google.com/maps/search/Narru+restaurante+San+Sebastian",
        note: "Small plates and tasting menu in a quiet Parte Vieja street. Seasonal and inventive.",
        tags: ["tasting-menu", "old-town"],
        sourceTags: ["Michelin"],
        booking: "Recommended",
      },
      {
        id: "casa-urola",
        label: "Casa Urola",
        cuisine: "Traditional Basque",
        hours: "Tue–Sat 13:00–15:30, 20:00–22:30; Sun lunch only; closed Mon",
        price: "$$$",
        michelin: "Michelin Selected",
        googleRating: 4.5,
        distanceFromHomeKm: 3.5,
        mapUrl: "https://www.google.com/maps/search/Casa+Urola+San+Sebastian",
        note: "Michelin-listed traditional seasonal cooking in the old town; excellent kokotxas and wild mushrooms. Upstairs dining room.",
        sourceUrl: "https://guide.michelin.com/us/en/pais-vasco/es-donostia-san-sebastian/restaurant/casa-urola",
        sourceLabel: "Michelin Guide",
        tags: ["michelin", "old-town", "seasonal"],
        sourceTags: ["Michelin", "Lonely Planet"],
        booking: "Recommended",
      },
      {
        id: "juanito-kojua",
        label: "Juanito Kojua",
        cuisine: "Basque seafood",
        hours: "Tue–Sat 13:00–15:30, 20:00–22:30; Sun lunch only; closed Mon",
        price: "$$$",
        googleRating: 4.4,
        distanceFromHomeKm: 3.5,
        mapUrl: "https://www.google.com/maps/search/Juanito+Kojua+San+Sebastian",
        note: "No-frills old-town institution for grilled fish and txuleta. Loyal local following. Cash-friendly.",
        tags: ["seafood", "old-town", "classic"],
        sourceTags: ["Lonely Planet"],
        booking: "Walk-in usually OK",
      },
      {
        id: "gandarias",
        label: "Gandarias",
        cuisine: "Basque grill / pintxos",
        hours: "Daily 12:00–15:30, 19:00–23:00",
        price: "$$",
        googleRating: 4.4,
        distanceFromHomeKm: 3.5,
        mapUrl: "https://www.google.com/maps/search/Gandarias+San+Sebastian",
        note: "Bar downstairs for pintxos, formal dining upstairs for txuleta and grilled meats. Big portions. Busy weekends.",
        tags: ["pintxos", "grill", "old-town"],
        sourceTags: ["TripAdvisor Top", "Lonely Planet"],
        booking: "Walk-in for bar; book for dining room",
      },
      // --- Michelin starred / special occasion (<=5 km) ---
      {
        id: "kokotxa",
        label: "Kokotxa",
        cuisine: "Modern Basque",
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
        sourceTags: ["Michelin"],
        booking: "Book 1–2 weeks ahead",
      },
      {
        id: "akelarre",
        label: "Akelarre",
        cuisine: "Avant-garde Basque",
        hours: "Wed–Sun 13:00–15:00, 20:30–22:00; closed Mon–Tue",
        price: "$$$$",
        michelin: "3 Stars",
        googleRating: 4.7,
        distanceFromHomeKm: 4,
        mapUrl: "https://www.google.com/maps/search/Akelarre+restaurant+San+Sebastian",
        note: "Pedro Subijana's 3-star temple on Monte Igueldo. Ocean-view dining room. Tasting menus from ~220 EUR.",
        sourceUrl: "https://guide.michelin.com/us/en/pais-vasco/es-donostia-san-sebastian/restaurant/akelare",
        sourceLabel: "Michelin Guide",
        tags: ["michelin", "fine-dining", "special-occasion"],
        sourceTags: ["Michelin"],
        booking: "Book well ahead",
      },
      {
        id: "martin-berasategui",
        label: "Martín Berasategui",
        cuisine: "Avant-garde Basque",
        hours: "Wed–Sun 13:00–15:00, 20:30–22:00; closed Mon–Tue",
        price: "$$$$",
        michelin: "3 Stars",
        googleRating: 4.8,
        distanceFromHomeKm: 9,
        mapUrl: "https://www.google.com/maps/search/Martin+Berasategui+Lasarte",
        note: "Three Michelin stars in Lasarte-Oria, 15 min from San Sebastian. Arguably the Basque Country's most celebrated chef. Tasting menus from ~250 EUR.",
        sourceUrl: "https://guide.michelin.com/us/en/pais-vasco/lasarte-oria/restaurant/martin-berasategui",
        sourceLabel: "Michelin Guide",
        tags: ["michelin", "fine-dining", "special-occasion"],
        sourceTags: ["Michelin"],
        booking: "Book weeks ahead",
      },
      {
        id: "amelia-kursaal",
        label: "Amelia by Paulo Airaudo",
        cuisine: "Italian-Basque fusion",
        hours: "Wed–Sat 13:00–14:30, 20:00–22:00; closed Sun–Tue",
        price: "$$$$",
        michelin: "2 Stars",
        googleRating: 4.7,
        distanceFromHomeKm: 4,
        mapUrl: "https://www.google.com/maps/search/Amelia+San+Sebastian+Kursaal",
        note: "Two Michelin stars. Argentinian-Italian chef Paulo Airaudo. Creative tasting menus with bold flavours. Inside the Kursaal.",
        sourceUrl: "https://guide.michelin.com/us/en/pais-vasco/es-donostia-san-sebastian/restaurant/amelia",
        sourceLabel: "Michelin Guide",
        tags: ["michelin", "fine-dining", "special-occasion"],
        sourceTags: ["Michelin"],
        booking: "Book well ahead",
      },
      {
        id: "mirador-ulia",
        label: "Mirador de Ulía",
        cuisine: "Modern Basque",
        hours: "Tue–Sat 13:00–15:00, 20:30–22:00; closed Sun–Mon",
        price: "$$$$",
        michelin: "1 Star",
        googleRating: 4.6,
        distanceFromHomeKm: 5,
        mapUrl: "https://www.google.com/maps/search/Mirador+de+Ulia+San+Sebastian",
        note: "One Michelin star. Panoramic views from Monte Ulia. Modern Basque cuisine with dramatic bay vistas.",
        sourceUrl: "https://guide.michelin.com/us/en/pais-vasco/es-donostia-san-sebastian/restaurant/mirador-de-ulia",
        sourceLabel: "Michelin Guide",
        tags: ["michelin", "views", "special-occasion"],
        sourceTags: ["Michelin"],
        booking: "Book ahead, request window table",
      },
      {
        id: "arzak",
        label: "Arzak",
        cuisine: "Avant-garde Basque",
        hours: "Tue–Sat 13:00–15:00, 20:30–22:00; closed Sun–Mon",
        price: "$$$$",
        michelin: "3 Stars",
        googleRating: 4.6,
        distanceFromHomeKm: 3,
        mapUrl: "https://www.google.com/maps/search/Arzak+restaurant+San+Sebastian",
        note: "Juan Mari and Elena Arzak's legendary three-star institution. Pioneer of nueva cocina vasca. Tasting menus from ~230 EUR.",
        sourceUrl: "https://guide.michelin.com/us/en/pais-vasco/es-donostia-san-sebastian/restaurant/arzak",
        sourceLabel: "Michelin Guide",
        tags: ["michelin", "fine-dining", "special-occasion"],
        sourceTags: ["Michelin"],
        booking: "Book weeks ahead",
      },
      {
        id: "mugaritz",
        label: "Mugaritz",
        cuisine: "Avant-garde / experimental",
        hours: "Wed–Sun 13:00–15:00, 20:30–22:00; closed Mon–Tue",
        price: "$$$$",
        michelin: "2 Stars",
        googleRating: 4.4,
        distanceFromHomeKm: 10,
        mapUrl: "https://www.google.com/maps/search/Mugaritz+Errenteria",
        note: "Two Michelin stars. Andoni Luis Aduriz's experimental restaurant in the hills above Errenteria. Highly conceptual — not for every mood. ~20-course experience.",
        sourceUrl: "https://guide.michelin.com/us/en/pais-vasco/errenteria/restaurant/mugaritz",
        sourceLabel: "Michelin Guide",
        tags: ["michelin", "fine-dining", "adults"],
        sourceTags: ["Michelin"],
        booking: "Book well ahead",
      },
      // --- Pintxos bars (Old Town / Gros) ---
      {
        id: "parte-vieja-pintxos",
        label: "Parte Vieja pintxos crawl",
        cuisine: "Pintxos",
        hours: "Most bars open 12:00–15:00 & 19:00–23:00",
        price: "$$",
        distanceFromHomeKm: 3.5,
        mapUrl: "https://www.google.com/maps/search/Parte+Vieja+San+Sebastian",
        note: "Classic old-town pintxos circuit. Key streets: Calle Fermín Calbetón, Calle 31 de Agosto. Go hungry, share everything.",
        tags: ["pintxos", "old-town", "family-friendly"],
        sourceTags: ["Lonely Planet", "TripAdvisor Top"],
        booking: "Walk-in",
        subItems: [
          {
            id: "ganbara",
            label: "Ganbara",
            note: "Famous for wild mushroom (perretxiko) pintxos and txangurro. Counter only, arrive early.",
            cuisine: "Pintxos",
            tags: ["pintxos", "seasonal"],
            mapUrl: "https://www.google.com/maps/search/Ganbara+San+Sebastian",
            sourceLabel: "Lonely Planet",
          },
          {
            id: "borda-berri",
            label: "Borda Berri",
            note: "Modern pintxos: risotto, slow-cooked cheeks, creative small plates. Calle Fermín Calbetón.",
            cuisine: "Modern pintxos",
            tags: ["pintxos", "modern"],
            mapUrl: "https://www.google.com/maps/search/Borda+Berri+San+Sebastian",
            sourceLabel: "TripAdvisor",
          },
          {
            id: "la-cuchara",
            label: "La Cuchara de San Telmo",
            note: "Hot pintxos cooked to order: foie, veal cheeks, cod. Always a queue — worth it.",
            cuisine: "Hot pintxos",
            tags: ["pintxos", "hot"],
            mapUrl: "https://www.google.com/maps/search/La+Cuchara+de+San+Telmo+San+Sebastian",
            sourceLabel: "Lonely Planet",
          },
          {
            id: "a-fuego-negro",
            label: "A Fuego Negro",
            note: "Playful, avant-garde pintxos with cheeky names. Calle 31 de Agosto.",
            cuisine: "Avant-garde pintxos",
            tags: ["pintxos", "modern"],
            mapUrl: "https://www.google.com/maps/search/A+Fuego+Negro+San+Sebastian",
            sourceLabel: "TripAdvisor",
          },
          {
            id: "txepetxa",
            label: "Txepetxa",
            note: "Specialist anchovy pintxos bar — dozens of creative anchovy preparations.",
            cuisine: "Pintxos (anchovy)",
            tags: ["pintxos", "seafood"],
            mapUrl: "https://www.google.com/maps/search/Txepetxa+San+Sebastian",
            sourceLabel: "Lonely Planet",
          },
        ],
      },
      {
        id: "gros-pintxos",
        label: "Gros pintxos crawl",
        cuisine: "Pintxos",
        hours: "Most bars open 12:00–15:00 & 19:00–23:00",
        price: "$$",
        distanceFromHomeKm: 4.5,
        mapUrl: "https://www.google.com/maps/search/Gros+San+Sebastian",
        note: "Younger, surfer-adjacent neighbourhood. Less touristy than Parte Vieja. Calle Peña y Goñi is the main pintxos strip.",
        tags: ["pintxos", "gros", "family-friendly"],
        sourceTags: ["Lonely Planet"],
        booking: "Walk-in",
        subItems: [
          {
            id: "bar-bergara",
            label: "Bar Bergara",
            note: "Award-winning pintxos. Generous portions, great variety. Reliable quality.",
            cuisine: "Pintxos",
            tags: ["pintxos"],
            mapUrl: "https://www.google.com/maps/search/Bar+Bergara+San+Sebastian",
            sourceLabel: "TripAdvisor",
          },
          {
            id: "bar-zabaleta",
            label: "Bar Zabaleta",
            note: "Local favourite. Good hot pintxos, relaxed vibe.",
            cuisine: "Pintxos",
            tags: ["pintxos"],
            mapUrl: "https://www.google.com/maps/search/Bar+Zabaleta+San+Sebastian",
          },
        ],
      },
      // --- Casual / family weeknight options ---
      {
        id: "bodegon-alejandro",
        label: "Bodegón Alejandro",
        cuisine: "Modern Basque",
        hours: "Tue–Sat 13:00–15:30, 20:30–22:30; closed Sun–Mon",
        price: "$$$",
        michelin: "Michelin Selected",
        googleRating: 4.5,
        distanceFromHomeKm: 3.5,
        mapUrl: "https://www.google.com/maps/search/Bodegon+Alejandro+San+Sebastian",
        note: "Family-run in the old town. Modern Basque with seasonal focus. Good-value midweek lunch menu.",
        tags: ["modern", "old-town", "family-friendly"],
        sourceTags: ["Michelin"],
        booking: "Recommended",
      },
      {
        id: "la-fabrica",
        label: "La Fábrica",
        cuisine: "Basque / burger / casual",
        hours: "Daily 12:00–16:00, 19:30–23:00",
        price: "$$",
        googleRating: 4.3,
        distanceFromHomeKm: 4,
        mapUrl: "https://www.google.com/maps/search/La+Fabrica+San+Sebastian+Gros",
        note: "Casual Gros spot popular with surfers. Good burgers, salads, grilled meats. Relaxed with kids.",
        tags: ["casual", "gros", "family-friendly"],
        sourceTags: ["TripAdvisor Top"],
        booking: "Walk-in",
      },
      {
        id: "sirimiri",
        label: "Sirimiri",
        cuisine: "Basque / casual",
        hours: "Check current hours",
        price: "$$",
        googleRating: 4.4,
        distanceFromHomeKm: 1.5,
        mapUrl: "https://www.google.com/maps/search/Sirimiri+Antiguo+San+Sebastian",
        note: "Antiguo neighbourhood. Casual Basque fare, good for a low-effort weeknight dinner close to home.",
        tags: ["neighbourhood", "casual", "family-friendly"],
        booking: "Walk-in",
      },
      {
        id: "aitana-donostia",
        label: "Aitana Donostia",
        cuisine: "Modern Spanish / casual",
        hours: "Check current hours",
        price: "$$",
        googleRating: 4.4,
        distanceFromHomeKm: 3,
        mapUrl: "https://www.google.com/maps/search/Aitana+Donostia+Easo+Kalea+6",
        note: "Visited 2026-06-26 after the San Martin / Buen Pastor errands. Better fit for the family than very old-school bars like La Espiga.",
        tags: ["casual", "modern", "family-friendly", "visited"],
        booking: "Walk-in / reserve if convenient",
      },
      {
        id: "polka",
        label: "POLKA San Sebastian",
        cuisine: "Modern casual / Basque-ish",
        hours: "Check current hours",
        price: "$$",
        googleRating: 4.4,
        distanceFromHomeKm: 3.5,
        mapUrl: "https://www.google.com/maps/search/POLKA+San+Sebastian+Plaza+Sarriegi",
        websiteUrl: "https://www.covermanager.com/reserve/module_restaurant/polka-san-sebastian/spanish",
        note: "Visited 2026-06-28. Good polished casual dinner with kids, but not a pintxos crawl.",
        tags: ["casual", "old-town", "family-friendly", "visited"],
        booking: "Online booking available",
      },
      {
        id: "la-mejillonera",
        label: "La Mejillonera",
        cuisine: "Seafood / casual",
        hours: "Daily 11:30–15:00 & 18:30–22:30",
        price: "$",
        googleRating: 4.3,
        distanceFromHomeKm: 3.5,
        mapUrl: "https://www.google.com/maps/search/La+Mejillonera+San+Sebastian",
        note: "Old-town classic for mussels and fried squid. Cheap, fun, and kids love it. Counter service.",
        tags: ["seafood", "casual", "old-town", "family-friendly"],
        sourceTags: ["TripAdvisor Top", "Lonely Planet"],
        booking: "Walk-in (queue common)",
      },
      {
        id: "sakura",
        label: "Sakura",
        cuisine: "Japanese",
        hours: "Tue–Sun 13:00–15:30, 20:00–23:00; closed Mon",
        price: "$$$",
        googleRating: 4.5,
        distanceFromHomeKm: 3.5,
        mapUrl: "https://www.google.com/maps/search/Sakura+Japanese+San+Sebastian",
        note: "Well-regarded Japanese restaurant near Buen Pastor. Good sushi and grilled items when you want a break from Basque cuisine.",
        tags: ["japanese", "variety"],
        booking: "Recommended",
      },
      {
        id: "kaia-kaipe",
        label: "Kaia-Kaipe",
        cuisine: "Seafood / grill",
        hours: "Tue–Sat 13:00–15:30, 20:30–22:30; Sun lunch only; closed Mon",
        price: "$$$$",
        michelin: "Michelin Selected",
        googleRating: 4.5,
        distanceFromHomeKm: 3.5,
        mapUrl: "https://www.google.com/maps/search/Kaia+Kaipe+San+Sebastian",
        note: "Harbourside grill at the port. Whole grilled fish, harbour views. Classic San Sebastian seafood experience.",
        tags: ["seafood", "grill", "harbour"],
        sourceTags: ["Michelin"],
        booking: "Recommended",
      },
      {
        id: "zelai-txiki",
        label: "Zelai Txiki",
        cuisine: "Basque cider house",
        hours: "Check current hours (cider season Jan–May, open year-round as restaurant)",
        price: "$$",
        googleRating: 4.4,
        distanceFromHomeKm: 5,
        mapUrl: "https://www.google.com/maps/search/Zelai+Txiki+cider+house+San+Sebastian",
        note: "Year-round sagardotegi (cider house). Classic txuleta menu with tortilla de bacalao and cod omelette. Fun cultural experience.",
        tags: ["cider-house", "grill", "culture", "family-friendly"],
        sourceTags: ["Lonely Planet"],
        booking: "Walk-in usually OK",
      },
      {
        id: "portaletas",
        label: "Portaletas",
        cuisine: "Basque grill",
        hours: "Tue–Sun 13:00–15:30, 20:00–22:30; closed Mon",
        price: "$$$",
        michelin: "Bib Gourmand",
        googleRating: 4.5,
        distanceFromHomeKm: 4.5,
        mapUrl: "https://www.google.com/maps/search/Portaletas+San+Sebastian",
        note: "Bib Gourmand. Basque grill with excellent txuleta and seasonal fish. Slightly outside the centre, worth the short drive.",
        sourceUrl: "https://guide.michelin.com/us/en/pais-vasco/es-donostia-san-sebastian/restaurant/portaletas",
        sourceLabel: "Michelin Guide",
        tags: ["bib-gourmand", "grill"],
        sourceTags: ["Michelin"],
        booking: "Recommended",
      },
      {
        id: "ni-neu",
        label: "Ni Neu",
        cuisine: "Modern Basque",
        hours: "Tue–Sat 13:00–15:30, 20:30–22:30; closed Sun–Mon",
        price: "$$$",
        michelin: "Michelin Selected",
        googleRating: 4.3,
        distanceFromHomeKm: 4,
        mapUrl: "https://www.google.com/maps/search/Ni+Neu+Kursaal+San+Sebastian",
        note: "Inside the Kursaal. More relaxed than Amelia next door. Good-value modern Basque lunch.",
        tags: ["modern", "views"],
        sourceTags: ["Michelin"],
        booking: "Recommended",
      },
      {
        id: "xarma",
        label: "Xarma Cook & Culture",
        cuisine: "Modern Basque",
        hours: "Tue–Sat 13:30–15:30, 20:30–22:30; closed Sun–Mon",
        price: "$$$",
        michelin: "1 Star",
        googleRating: 4.7,
        distanceFromHomeKm: 3.5,
        mapUrl: "https://www.google.com/maps/search/Xarma+Cook+Culture+San+Sebastian",
        note: "One Michelin star. Young chef, creative short tasting menus. Good value for a starred experience.",
        sourceUrl: "https://guide.michelin.com/us/en/pais-vasco/es-donostia-san-sebastian/restaurant/xarma-cook-culture",
        sourceLabel: "Michelin Guide",
        tags: ["michelin", "tasting-menu", "modern"],
        sourceTags: ["Michelin"],
        booking: "Book 1–2 weeks ahead",
      },
      {
        id: "bernardo-etxea",
        label: "Bernardo Etxea",
        cuisine: "Traditional Basque",
        hours: "Tue–Sat 13:00–15:30, 20:00–22:30; closed Sun–Mon",
        price: "$$$",
        michelin: "Michelin Selected",
        googleRating: 4.5,
        distanceFromHomeKm: 3.5,
        mapUrl: "https://www.google.com/maps/search/Bernardo+Etxea+San+Sebastian",
        note: "Traditional Basque in the port area. Excellent grilled fish. Reliable, unpretentious.",
        tags: ["seafood", "classic", "harbour"],
        sourceTags: ["Michelin"],
        booking: "Recommended",
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
        schedule: "Mon–Fri: morning classes ~09:00–10:30, evening ~18:30–20:00. Sat: morning only. Timetable varies seasonally; source lists hatha, vinyasa, and yin options.",
        googleRating: 4.9,
        distanceFromHomeKm: 0.8,
        mapUrl: "https://www.google.com/maps/search/OMY+Ondarreta+yoga+San+Sebastian",
        websiteUrl: "https://omy-yoga.com",
        note: "Closest studio to home. Multiple styles available. Drop-in friendly; single-class passes available.",
        tags: ["drop-in", "nearby"],
        sourceTags: ["Studio website"],
        booking: "Drop-in OK; book via website or WhatsApp",
      },
      {
        id: "iyengar-yoga-leku",
        label: "Iyengar Yoga Leku",
        schedule: "Mon–Fri: 2–3 classes/day, typically morning ~10:00 and evening ~18:00–19:30. No weekend classes listed. Dedicated Iyengar method — all levels welcome.",
        googleRating: 5.0,
        distanceFromHomeKm: 2,
        mapUrl: "https://www.google.com/maps/search/Iyengar+Yoga+Leku+San+Sebastian",
        websiteUrl: "https://www.iyengaryogalekudonostia.com",
        note: "Dedicated Iyengar studio with props. Enquire about short-term or drop-in passes — they may require initial assessment.",
        tags: ["iyengar", "alignment"],
        sourceTags: ["Studio website"],
        booking: "Contact studio for drop-in policy",
      },
      {
        id: "awen-yoga",
        label: "Awen Yoga",
        schedule: "Mon–Fri: morning classes ~09:30–10:45, evening ~18:00–20:30 (multiple slots). Sat: morning class ~10:00. Styles include vinyasa, hatha, yin, and restorative.",
        googleRating: 4.8,
        distanceFromHomeKm: 3,
        mapUrl: "https://www.google.com/maps/search/Awen+Yoga+San+Sebastian",
        websiteUrl: "https://awenyogasansebastian.com",
        note: "City centre location near Buen Pastor. Broadest style range in the city. Online booking available.",
        tags: ["vinyasa", "multi-style"],
        sourceTags: ["Studio website"],
        booking: "Book via website; drop-in OK if space",
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
        id: "plaza-old-town-urgull-port-walk",
        label: "Plaza Gipuzkoa / Old Town / Urgull / port walk",
        hours: "Best in a dry 2-3h weather window",
        categoryTag: "City walk",
        distanceFromHomeKm: 3.5,
        mapUrl: "https://www.google.com/maps/search/Plaza+Gipuzkoa+San+Sebastian",
        note: "Completed 2026-06-28 with Plaza Gipuzkoa, Parte Vieja, Urgull, the port, and Aquarium afterwards.",
        tags: ["family", "culture", "views", "visited"],
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

  // ===== 4. SHOPPING =====
  {
    id: "shopping",
    name: "Shopping",
    emoji: "🛍️",
    description:
      "Practical malls, outlets, sunglasses/clothes/errands, and car-friendly retail stops.",
    items: [
      {
        id: "garbera",
        label: "Garbera",
        hours: "Check current holiday/Sunday hours",
        categoryTag: "Mall",
        distanceFromHomeKm: 6,
        mapUrl: "https://www.google.com/maps/search/Garbera+Donostia",
        websiteUrl: "https://www.garbera.com",
        note: "Visited 2026-06-27. Easy mall/sunglasses/shopping run with parking; useful low-effort fallback when weather or energy is poor.",
        tags: ["shopping", "mall", "family", "visited"],
      },
      {
        id: "fashion-outlet-barakaldo",
        label: "Fashion Outlet Barakaldo / Bilbao outlet",
        hours: "Check current hours",
        categoryTag: "Outlet",
        distanceFromHomeKm: 105,
        mapUrl: "https://www.google.com/maps/search/Fashion+Outlet+Barakaldo",
        note: "Bilbao-side outlet candidate. Best paired with a Bilbao/Guggenheim day or airport-side routing rather than a standalone Donostia shopping drive.",
        tags: ["shopping", "outlet", "bilbao"],
      },
    ],
  },

  // ===== 5. HIKES =====
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
          sourceLabel: "Wikiloc",
        },
        mapUrl: "https://www.google.com/maps/search/Monte+Ulia+San+Sebastian",
        sourceUrl: "https://www.wikiloc.com/hiking-trails/ulia-itsas-ertzeko-buelta-68496607",
        sourceLabel: "Wikiloc",
        note: "Loop variant via Ulia summit and coastal cliffs, returning through the residential side. The famous linear Ulia–Pasaia route is not a loop; this stays on Ulia.",
        tags: ["moderate", "coastal", "city-edge"],
      },
    ],
  },

  // ===== 6. EXCURSIONS =====
  {
    id: "excursions",
    name: "Excursions",
    emoji: "🚗",
    description:
      "Day trips and bigger outings by car. Tags indicate weather/audience suitability. Food stops are listed under each excursion.",
    items: [
      {
        id: "rioja-day",
        label: "Rioja wine country — July 11",
        excursionMeta: {
          tags: ["sunny", "family", "planned"],
          distanceKm: 120,
          timeNeeded: "Full day",
        },
        mapUrl: "https://www.google.com/maps/search/Bodegas+Baigorri+Samaniego+Villa+Lucia+Laguardia+Marques+de+Riscal",
        note: "Confirmed July 11: sleep-in morning, Baigorri 13:00 visit + 14:00–16:00 lunch, Villa-Lucia 17:00 4D experience, short Prao de la Paul walk, then Marques de Riscal before its 19:00 close.",
        tags: ["wine", "family", "sunny", "planned"],
        sourceTags: ["Lonely Planet"],
        booking: "Baigorri 13:00 + Villa-Lucia 17:00 confirmed",
        subItems: [
          {
            id: "rioja-baigorri",
            label: "13:00 Baigorri visit + 14:00 lunch",
            note: "Main adult anchor of the day: winery visit followed by the 14:00-16:00 lunch. Arrive around 12:15-12:30 for buffer.",
            tags: ["wine", "food", "confirmed"],
            mapUrl: "https://www.google.com/maps/search/Bodegas+Baigorri+Samaniego",
            websiteUrl: "https://www.bodegasbaigorri.com",
          },
          {
            id: "rioja-ysios-optional",
            label: "Optional pre-Baigorri scenic stop",
            note: "Only if the drive runs early: quick exterior/photo stop at Ysios or coffee nearby. Do not force a full morning activity.",
            tags: ["optional", "architecture", "views"],
            mapUrl: "https://www.google.com/maps/search/Bodegas+Ysios+Laguardia",
          },
          {
            id: "rioja-villa-lucia",
            label: "17:00 Villa-Lucia 4D experience",
            note: "Kid-friendly wine-culture stop in Laguardia after Baigorri. Follow with an easy walk rather than another tasting.",
            tags: ["family", "culture", "confirmed"],
            mapUrl: "https://www.google.com/maps/search/Villa+Lucia+Laguardia",
            websiteUrl: "https://villa-lucia.com/en/villa-lucia-and-children/",
          },
          {
            id: "rioja-prao-paul-walk",
            label: "Villa-Lucia → Campillo → Prao de la Paul walk",
            note: "Shorten the Wikiloc lagoon loop from Villa-Lucia if needed. Aim for a pleasant 45-60 min post-lunch walk, not a forced hike.",
            tags: ["walk", "family", "lagoon"],
            mapUrl: "https://www.google.com/maps/search/Prao+de+la+Paul+Laguardia",
            sourceUrl: "https://es.wikiloc.com/rutas-senderismo/laguna-el-prau-de-paul-102949904",
            sourceLabel: "Wikiloc",
          },
          {
            id: "rioja-riscal",
            label: "Marques de Riscal / Elciego",
            note: "Final architecture/photo stop. It closes at 19:00, so leave Laguardia around 18:25-18:30.",
            tags: ["architecture", "final-stop"],
            mapUrl: "https://www.google.com/maps/search/Marques+de+Riscal+Elciego",
          },
        ],
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
        sourceTags: ["Lonely Planet", "TripAdvisor Top"],
        subItems: [
          {
            id: "hondarribia-old-town",
            label: "Hondarribia old town",
            note: "Walled hilltop with Calle San Nicolás, colourful balconied houses. Parador at the top.",
            tags: ["culture", "family"],
            mapUrl: "https://www.google.com/maps/search/Hondarribia+old+town",
          },
          {
            id: "hondarribia-marina",
            label: "La Marina fishermen's quarter",
            note: "Pintxos bars and colourful houses along the harbour. Lively for lunch.",
            tags: ["food", "pintxos"],
            mapUrl: "https://www.google.com/maps/search/La+Marina+Hondarribia",
          },
          {
            id: "hendaye-ferry",
            label: "Ferry to Hendaye",
            note: "Quick boat crossing (~10 min) to Hendaye beach on the French side. Wide sandy beach, calmer than La Concha.",
            tags: ["family", "sunny"],
            mapUrl: "https://www.google.com/maps/search/Hendaye+beach",
          },
          {
            id: "alameda-hondarribia",
            label: "Alameda (Hondarribia)",
            note: "Michelin-starred. Gorrotxategi brothers' refined Basque cuisine. Book for a special lunch stop.",
            cuisine: "Modern Basque",
            michelin: "1 Star",
            price: "$$$$",
            tags: ["food", "michelin", "booking"],
            mapUrl: "https://www.google.com/maps/search/Alameda+Hondarribia",
          },
        ],
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
        note: "Surf town Zarautz, grilled fish in Getaria harbour, Flysch geology in Zumaia. Plan lunch at Elkano or a harbour grill.",
        tags: ["family", "sunny", "coastal", "food"],
        sourceTags: ["Lonely Planet", "Michelin"],
        booking: "Book Elkano if going",
        subItems: [
          {
            id: "zarautz-beach",
            label: "Zarautz beach + town",
            note: "Longest beach in the Basque Country. Surf schools, boardwalk, old town with pintxos.",
            tags: ["sunny", "family"],
            mapUrl: "https://www.google.com/maps/search/Zarautz+beach",
          },
          {
            id: "getaria-town",
            label: "Getaria fishing village",
            note: "Birthplace of Elcano. Charcoal grills line the harbour. Txakoli vineyards on the hills above.",
            tags: ["culture", "food"],
            mapUrl: "https://www.google.com/maps/search/Getaria+harbour",
          },
          {
            id: "elkano-getaria",
            label: "Elkano (Getaria)",
            note: "Iconic whole grilled turbot over charcoal. One Michelin star. The reason to plan a Getaria day.",
            cuisine: "Seafood grill",
            michelin: "1 Star",
            price: "$$$$",
            tags: ["food", "michelin", "booking"],
            mapUrl: "https://www.google.com/maps/search/Elkano+Getaria",
            sourceUrl: "https://guide.michelin.com/us/en/pais-vasco/getaria/restaurant/elkano",
            sourceLabel: "Michelin Guide",
          },
          {
            id: "zumaia-flysch",
            label: "Zumaia Flysch cliffs",
            note: "60-million-year-old geological formations. Walk the cliff path or take a boat tour. Tide-sensitive beach section.",
            tags: ["nature", "sunny"],
            mapUrl: "https://www.google.com/maps/search/Zumaia+Flysch",
          },
        ],
      },
      {
        id: "bilbao-guggenheim",
        label: "Bilbao / Guggenheim + Ola",
        excursionMeta: {
          tags: ["rainy", "sunny", "family", "adults"],
          distanceKm: 100,
          timeNeeded: "Full day",
        },
        mapUrl: "https://www.google.com/maps/search/Guggenheim+Bilbao",
        websiteUrl: "https://www.guggenheim-bilbao.eus",
        note: "Actual plan: leave San Sebastian around 09:15, park once at Parking Indigo Arenal, timed Guggenheim late morning, Ola Martin Berasategui lunch at 13:30, then compact Casco Viejo loop back to the car.",
        tags: ["culture", "rainy", "family"],
        sourceTags: ["Lonely Planet", "TripAdvisor Top"],
        booking: "Ola Martin Berasategui reserved 13:30; buy timed Guggenheim tickets online",
        subItems: [
          {
            id: "bilbao-parking-arenal",
            label: "Parking Indigo Arenal",
            note: "One-park anchor for the day. Park around 10:45, then walk the river route to the Guggenheim; taxi back to Ola if weather or timing gets tight.",
            tags: ["parking", "practical"],
            mapUrl: "https://www.google.com/maps/search/Parking+Indigo+Arenal+Bilbao+Areatzako+Pasealekua+1",
          },
          {
            id: "bilbao-guggenheim-museum",
            label: "11:15 timed Guggenheim Museum",
            note: "Buy tickets online for a late-morning slot. Leave the museum around 12:45 so the 13:30 Ola lunch does not get squeezed.",
            tags: ["culture", "rainy", "family"],
            mapUrl: "https://www.google.com/maps/search/Guggenheim+Bilbao",
            websiteUrl: "https://www.guggenheim-bilbao.eus",
          },
          {
            id: "bilbao-ola-martin-berasategui",
            label: "13:30 Ola Martin Berasategui",
            note: "Reserved lunch anchor. Arrive in the area around 13:10; use Guggenheim -> Ola taxi as the late-running or bad-weather escape hatch.",
            cuisine: "Modern Basque",
            michelin: "Michelin-selected",
            price: "$$$",
            tags: ["food", "booking", "planned"],
            mapUrl: "https://www.google.com/maps/search/Ola+Martin+Berasategui+Bilbao",
          },
          {
            id: "bilbao-casco-viejo",
            label: "Post-lunch Casco Viejo loop",
            note: "If lunch ends around 15:30: San Anton bridge/church -> Mercado de la Ribera -> Seven Streets -> Catedral de Santiago -> Plaza Nueva -> Teatro Arriaga -> Arenal gardens/parking.",
            tags: ["culture", "food", "pintxos"],
            mapUrl: "https://www.google.com/maps/search/Casco+Viejo+Bilbao",
          },
          {
            id: "bilbao-mina",
            label: "Mina (Bilbao)",
            note: "One Michelin star. Keep as a backup idea, not the current plan now that Ola Martin Berasategui is reserved.",
            cuisine: "Modern Basque",
            michelin: "1 Star",
            price: "$$$$",
            tags: ["food", "michelin", "booking"],
            mapUrl: "https://www.google.com/maps/search/Mina+restaurant+Bilbao",
          },
          {
            id: "bilbao-ribera-market",
            label: "Mercado de la Ribera",
            note: "Europe's largest covered market. Fresh produce, bar stalls, local atmosphere.",
            tags: ["food", "culture"],
            mapUrl: "https://www.google.com/maps/search/Mercado+Ribera+Bilbao",
          },
        ],
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
        note: "Saint-Jean-de-Luz town centre and beach, Biarritz surf scene. ~45 min drive.",
        tags: ["family", "sunny", "beach", "france"],
        sourceTags: ["Lonely Planet"],
        subItems: [
          {
            id: "saint-jean-de-luz",
            label: "Saint-Jean-de-Luz",
            note: "Charming Basque-French town. Sheltered beach, pedestrian centre, excellent pâtisseries (Maison Adam). Good for families.",
            tags: ["family", "sunny"],
            mapUrl: "https://www.google.com/maps/search/Saint+Jean+de+Luz",
          },
          {
            id: "biarritz",
            label: "Biarritz",
            note: "Grande Plage, Rocher de la Vierge, surf culture. More bustling than Saint-Jean-de-Luz.",
            tags: ["sunny", "culture"],
            mapUrl: "https://www.google.com/maps/search/Biarritz+France",
          },
          {
            id: "espelette",
            label: "Espelette (optional detour)",
            note: "Famous for piment d'Espelette. Red-pepper-draped houses. Quick detour inland if time allows.",
            tags: ["culture", "food"],
            mapUrl: "https://www.google.com/maps/search/Espelette+France",
          },
          {
            id: "les-halles-biarritz",
            label: "Les Halles (Biarritz market)",
            note: "Indoor food market. Fromage, charcuterie, seafood. Good morning stop.",
            tags: ["food"],
            mapUrl: "https://www.google.com/maps/search/Les+Halles+Biarritz",
          },
        ],
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
        note: "Dramatic island hermitage (Game of Thrones filming location). Combine with Urdaibai biosphere reserve.",
        tags: ["family", "sunny", "iconic"],
        sourceTags: ["Lonely Planet", "TripAdvisor Top"],
        booking: "Free reservation often required in summer",
        subItems: [
          {
            id: "gaztelugatxe-hermitage",
            label: "San Juan de Gaztelugatxe",
            note: "241 steps to the hermitage on the islet. Stunning coastal walk. Reserve free time slot online in summer.",
            tags: ["sunny", "iconic", "booking"],
            mapUrl: "https://www.google.com/maps/search/San+Juan+de+Gaztelugatxe",
          },
          {
            id: "urdaibai-biosphere",
            label: "Urdaibai Biosphere Reserve",
            note: "Wetlands, birdwatching, Mundaka surf town, Gernika (Basque parliament + peace museum).",
            tags: ["nature", "family"],
            mapUrl: "https://www.google.com/maps/search/Urdaibai+biosphere+reserve",
          },
          {
            id: "gernika",
            label: "Gernika-Lumo",
            note: "Basque parliament, Tree of Gernika, Picasso painting context. Gernika Peace Museum worth a stop.",
            tags: ["culture", "rainy"],
            mapUrl: "https://www.google.com/maps/search/Gernika+Lumo",
          },
        ],
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
