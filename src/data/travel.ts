/**
 * Travel — deployable static projection of the travel domain.
 *
 * Trip semantics (constraints, itineraries, planning vocabulary) are owned by
 * `projects/travel/`. This file is the compact, read-only mirror the Companion
 * App renders: an overview of upcoming and past trips, plus concise archives
 * for completed trips. It is intentionally not a planning board.
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

export const trips: Trip[] = [sanSebastian];

export function getUpcomingTrips(): Trip[] {
  return trips
    .filter((t) => t.status === "upcoming")
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
}

export function getPastTrips(): Trip[] {
  return trips
    .filter((t) => t.status === "past")
    .sort((a, b) => b.startDate.localeCompare(a.startDate));
}

export function getTripById(id: string): Trip | undefined {
  return trips.find((t) => t.id === id);
}
