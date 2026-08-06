/**
 * Travel — deployable static projection of the travel domain.
 *
 * Trip semantics (constraints, itineraries, planning vocabulary) are owned by
 * `projects/travel/`. This file is the compact, read-only mirror the Companion
 * App renders: an overview of upcoming and past trips, concise archives for
 * completed trips, and the short usable plan for a finalized upcoming one. It
 * is intentionally not a planning board.
 *
 * Records reach this file by publication, not by drift: each one carries a
 * stable `id` so republishing updates in place, a `source` recording the
 * finalized conversation it was promoted from, and `factOwners` naming the
 * upstream systems whose facts it references but never restates.
 */

export type TripStatus = "upcoming" | "past";

export interface TripHighlight {
  title: string;
  detail: string;
}

export interface TripArchive {
  /** One or two sentences framing what the trip was. */
  snapshot: string;
  /** Confirmed, lived highlights worth remembering. */
  highlights: TripHighlight[];
  /** Genuinely useful places/ideas not reached — candidates for a return. */
  leftOpen: TripHighlight[];
}

/**
 * Promotion state of the conversation a trip record was projected from.
 *
 * Travel conversations are cheap and frequent; trips are not. Only a
 * conversation the domain owner explicitly finalized may be published, so an
 * ordinary travel-adjacent outing thread stays `not-promoted` and is dropped
 * by {@link publishTrips} rather than rendering as a trip.
 */
export type TripPromotion = "explicitly-finalized" | "not-promoted";

/**
 * A system that owns facts this projection deliberately does not restate.
 *
 * Booking records (flights, hotels, rentals, confirmation numbers) belong to
 * TripIt. The app may carry a constraint a booking imposes — a return
 * deadline, say — but never a second copy of the reservation itself.
 */
export interface TripFactOwner {
  /** Owning system, e.g. "TripIt". */
  system: string;
  /** What that system owns for this trip. */
  owns: string;
}

/** Stable provenance for a trip published out of a finalized conversation. */
export interface TripSource {
  /** Canonical source conversation. Kept for traceability, never rendered. */
  conversationId: string;
  /** ISO date this projection was published or last refreshed. */
  publishedOn: string;
  /** Explicit promotion gate — see {@link TripPromotion}. */
  promotion: TripPromotion;
  /** Upstream owners of facts referenced but not restated here. */
  factOwners: TripFactOwner[];
}

/** One anchor in the day's plan. Times are anchors, not a script. */
export interface TripPlanStop {
  /** Clock anchor for display, e.g. "13:00" or "15:00–15:30". */
  time: string;
  title: string;
  detail: string;
}

/** Conditions as checked before publication, plus the pre-departure gate. */
export interface TripConditions {
  /** When the readings below were taken. */
  checkedAt: string;
  /** Short, attributed readings — one line each. */
  readings: string[];
  /** What must be rechecked before leaving, and what calls the day off. */
  gate: string;
}

/**
 * The usable plan for a finalized trip: short enough to read on the way to the
 * launch, not a planning catalogue. Planning lives in `projects/travel/`.
 */
export interface TripPlan {
  /** The short finalized note framing what this day is. */
  note: string;
  /** Ordered anchors through the day. */
  schedule: TripPlanStop[];
  /** Places the plan is built around, with what is confirmed about each. */
  anchors: TripHighlight[];
  /** Choices left open to the day itself, in preference order. */
  decisions?: TripHighlight[];
  /** Conditions checked, and the recheck gate before departure. */
  conditions: TripConditions;
  /** Non-negotiables. */
  safety: string[];
}

export interface Trip {
  id: string;
  name: string;
  location: string;
  emoji: string;
  status: TripStatus;
  /** Human-readable date range for display. */
  dateLabel: string;
  /** ISO start/end for ordering. */
  startDate: string;
  endDate: string;
  /** Short overview line for the trip card. */
  summary: string;
  /** Detail route, when the trip has an archive or board. */
  href?: string;
  /** How work is handled on this trip, when it has been decided. */
  workPolicy?: string;
  /** Provenance, when the record was published from a conversation. */
  source?: TripSource;
  /** The usable plan for an upcoming trip. */
  plan?: TripPlan;
  /** Compact retrospective for a completed trip. */
  archive?: TripArchive;
}

const sanSebastian: Trip = {
  id: "san-sebastian",
  name: "San Sebastian",
  location: "Basque Country, Spain",
  emoji: "🏖️",
  status: "past",
  dateLabel: "27 June – 24 July 2026",
  startDate: "2026-06-27",
  endDate: "2026-07-24",
  summary:
    "A month based in Antiguo/Ibaeta with the kids in summer camp — city days, coast trips, and a wine-country excursion into Rioja.",
  href: "/travel/san-sebastian",
  archive: {
    snapshot:
      "One month in San Sebastian over summer 2026, with the kids in camp on weekdays. The family used the city as a base for old-town days, coast outings along the Basque shore, and a single designed excursion into Rioja.",
    highlights: [
      {
        title: "Donostia old town & bay",
        detail:
          "Parte Vieja, Monte Urgull, the harbour and the Aquarium — the anchor walk the family did early and kept returning to.",
      },
      {
        title: "Aitana & POLKA",
        detail:
          "Two lived city dinners: Aitana near San Martín / Buen Pastor, and a polished sit-down at POLKA.",
      },
      {
        title: "Hondarribia & Hendaye",
        detail:
          "Old-town walk in Hondarribia, the cross-border ferry over to Grande Plage in Hendaye, and pintxos on San Pedro Kalea.",
      },
      {
        title: "Zarautz",
        detail:
          "A relaxed beach-town day on the long Zarautz strand along the coast west of the city.",
      },
      {
        title: "Chillida Leku",
        detail:
          "Eduardo Chillida's sculpture park in the meadows near Hernani — an easy cultural afternoon.",
      },
      {
        title: "Bilbao — Guggenheim & Ola",
        detail:
          "A Guggenheim morning followed by lunch at Ola Martín Berasategui, then a compact Casco Viejo loop.",
      },
      {
        title: "Rioja — Baigorri & Villa-Lucia",
        detail:
          "The month's designed wine-country day: a Baigorri winery visit and lunch, then the Villa-Lucia experience near Laguardia.",
      },
      {
        title: "Garbera",
        detail:
          "The practical family shopping stop for the everyday needs of a long stay.",
      },
    ],
    leftOpen: [
      {
        title: "Zumaia flysch",
        detail:
          "The San Telmo–Itzurun–Algorri flysch loop — best at low tide, saved for a return trip.",
      },
      {
        title: "French Basque coast",
        detail:
          "Beyond Hendaye, the wider French side is worth a dedicated day of its own.",
      },
      {
        title: "Gaztelugatxe & Urdaibai",
        detail:
          "The island hermitage and the Urdaibai estuary, best as a self-drive half-day with timed tickets.",
      },
    ],
  },
};

const aareboeoetle: Trip = {
  id: "aareboeoetle-2026-08-07",
  name: "Aareböötle — Uttigen to Bern",
  location: "Aare, Canton of Bern",
  emoji: "🛶",
  status: "upcoming",
  dateLabel: "Friday, 7 August 2026",
  startDate: "2026-08-07",
  endDate: "2026-08-07",
  summary:
    "A one-day family float from Uttigen to Bern Eichholz, with a late gravel-bank picnic and swim and an optional easy riverside aperitif before the train home.",
  href: "/travel/aareboeoetle-2026-08-07",
  workPolicy: "No calls",
  source: {
    conversationId: "thread-1785962531986-h8xj18",
    publishedOn: "2026-08-06",
    promotion: "explicitly-finalized",
    factOwners: [
      {
        system: "TripIt",
        owns: "Booking records. None are restated here — the boat rental appears only as the 18:00 return deadline it imposes on the plan.",
      },
    ],
  },
  plan: {
    note: "Finalized as a single float day, not a planning board. The times below are anchors rather than a script; the only hard commitments are the 18:00 rental return and the Friday-morning conditions recheck.",
    schedule: [
      {
        time: "13:00",
        title: "Launch at Uttigen",
        detail: "Put in around 13:00. Everything after this is timed from here.",
      },
      {
        time: "15:00–15:30",
        title: "Picnic and swim",
        detail:
          "The main stop of the day, on a safely approachable gravel bank after Hunzigenbrücke.",
      },
      {
        time: "16:00",
        title: "Relaunch",
        detail:
          "Back on the water no later than 16:00 — this is what protects the exit and the rental return.",
      },
      {
        time: "16:45–17:30",
        title: "Exit at Bern Eichholz",
        detail: "Take out at Eichholz, beside the camping area.",
      },
      {
        time: "18:00",
        title: "Rental equipment returned",
        detail:
          "A hard deadline. If the day is running behind, the picnic stop is what gets cut, not this.",
      },
    ],
    anchors: [
      {
        title: "Uttigen",
        detail: "The launch point for the Uttigen–Bern stretch.",
      },
      {
        title: "Hunzigenbrücke",
        detail:
          "The marker for the picnic stop — the gravel bank comes after the bridge, not before it.",
      },
      {
        title: "Bern Eichholz",
        detail: "The exit, next to the camping area at the end of the float.",
      },
      {
        title: "Restaurant Serini Eichholz",
        detail:
          "Right beside the exit and camping area. Official summer high-season hours are daily 08:00–23:00.",
      },
    ],
    decisions: [
      {
        title: "Decide the Bern finish after the boat is returned",
        detail:
          "Not before. The right call depends on how much energy is left once the equipment is handed back.",
      },
      {
        title: "Default — one drink at Serini Eichholz",
        detail:
          "If you are done by about 17:20 and everyone still has energy, take one appetizer and a drink at Serini, a few steps from the exit.",
      },
      {
        title: "If late or tired — go straight home",
        detail:
          "Via Tierpark and Bernmobil line 19 to Bern Hauptbahnhof, then the next direct train toward Basel.",
      },
      {
        title: "Higher energy only — Dampfzentrale",
        detail:
          "Walking downstream to Dampfzentrale works, but it is not the default after a 20 km river day.",
      },
    ],
    conditions: {
      checkedAt: "Thursday 6 August, morning",
      readings: [
        "meteoblue: sunny, 18–28 °C, 0–5% precipitation, UV index 8.",
        "Wind: northerly 10–20 km/h, gusts around 30 km/h.",
        "FOEN Bern–Schönau: 130 m³/s and 21.3 °C at 09:00 Thursday.",
      ],
      gate: "Recheck on Friday morning before leaving: MeteoSwiss warnings and radar, plus FOEN Aare conditions. Do not launch on a thunderstorm warning or a sharp overnight rise in the river.",
    },
    safety: [
      "A worn life vest for every person, adults included.",
      "Water, sunscreen, hats, UV shirts, water shoes, and dry clothes.",
      "Boat marked with a name and phone number.",
      "Protect the 18:00 rental return — skip the picnic stop if progress is slow.",
    ],
  },
};

/**
 * Fold a publication list into the rendered projection.
 *
 * A trip is identified by its stable `id`, so republishing the same trip
 * updates the existing record in place — same position, new content — instead
 * of adding a second copy. Conversation-sourced records that were not
 * explicitly finalized are dropped rather than published.
 */
export function publishTrips(published: Trip[]): Trip[] {
  const byId = new Map<string, Trip>();
  for (const trip of published) {
    if (trip.source && trip.source.promotion !== "explicitly-finalized") {
      continue;
    }
    byId.set(trip.id, trip);
  }
  return [...byId.values()];
}

export const trips: Trip[] = publishTrips([sanSebastian, aareboeoetle]);

export function getUpcomingTrips(from: Trip[] = trips): Trip[] {
  return from
    .filter((t) => t.status === "upcoming")
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
}

export function getPastTrips(from: Trip[] = trips): Trip[] {
  return from
    .filter((t) => t.status === "past")
    .sort((a, b) => b.startDate.localeCompare(a.startDate));
}

export function getTripById(id: string, from: Trip[] = trips): Trip | undefined {
  return from.find((t) => t.id === id);
}
