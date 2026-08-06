// Contract tests for the travel projection and its publication path.
//
// `src/data/travel.ts` is a static projection, not the travel domain owner, so
// what is worth pinning here is not itinerary content but the publication
// rules that keep the projection trustworthy:
//
//   1. **Ordering** — upcoming trips read soonest-first, past trips newest-first.
//   2. **Stable identity** — republishing a trip under the same id updates the
//      existing record in place instead of adding a second one.
//   3. **Explicit promotion** — a travel-adjacent conversation that was never
//      finalized does not become a trip.
//   4. **One source of truth** — booking facts are attributed upstream, not
//      redefined here, and the source conversation slug never reaches the UI.
//
// Run with: npm test  (node --test; Node 24 strips types natively)

import { readFileSync } from "node:fs";
import { deepStrictEqual, equal, match, doesNotMatch, ok } from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getPastTrips,
  getTripById,
  getUpcomingTrips,
  publishTrips,
  trips,
  type Trip,
} from "../data/travel.ts";

const AARE_ID = "aareboeoetle-2026-08-07";

const DETAIL_PAGE = readFileSync(
  new URL(`../app/travel/${AARE_ID}/page.tsx`, import.meta.url),
  "utf8",
);
const INDEX_PAGE = readFileSync(
  new URL("../app/travel/page.tsx", import.meta.url),
  "utf8",
);

function stubTrip(id: string, startDate: string, extra: Partial<Trip> = {}): Trip {
  return {
    id,
    name: id,
    location: "Somewhere",
    emoji: "🧭",
    status: "upcoming",
    dateLabel: startDate,
    startDate,
    endDate: startDate,
    summary: "Stub.",
    ...extra,
  };
}

describe("trip ordering", () => {
  it("reads upcoming trips soonest-first", () => {
    const ordered = getUpcomingTrips([
      stubTrip("c", "2026-12-01"),
      stubTrip("a", "2026-08-07"),
      stubTrip("b", "2026-09-15"),
    ]);

    deepStrictEqual(
      ordered.map((t) => t.id),
      ["a", "b", "c"],
    );
  });

  it("reads past trips newest-first", () => {
    const ordered = getPastTrips([
      stubTrip("old", "2025-01-01", { status: "past" }),
      stubTrip("recent", "2026-06-27", { status: "past" }),
    ]);

    deepStrictEqual(
      ordered.map((t) => t.id),
      ["recent", "old"],
    );
  });

  it("does not mix an upcoming trip into the past archive", () => {
    const upcomingIds = getUpcomingTrips().map((t) => t.id);
    const pastIds = getPastTrips().map((t) => t.id);

    ok(upcomingIds.includes(AARE_ID));
    ok(!pastIds.includes(AARE_ID));
  });
});

describe("stable identity and republication", () => {
  it("publishes each stable id exactly once", () => {
    const ids = trips.map((t) => t.id);
    deepStrictEqual(ids, [...new Set(ids)]);
  });

  it("shows the Aare trip exactly once under Upcoming", () => {
    const matches = getUpcomingTrips().filter((t) => t.id === AARE_ID);
    equal(matches.length, 1);
  });

  it("updates in place when the same trip is republished", () => {
    const first = stubTrip(AARE_ID, "2026-08-07", { summary: "First cut." });
    const other = stubTrip("other", "2026-09-01");
    const republished = stubTrip(AARE_ID, "2026-08-07", { summary: "Revised." });

    const published = publishTrips([first, other, republished]);

    equal(published.length, 2, "republishing must not duplicate the record");
    deepStrictEqual(
      published.map((t) => t.id),
      [AARE_ID, "other"],
      "the updated record keeps its original position",
    );
    equal(published[0].summary, "Revised.");
  });

  it("is idempotent when the identical record is published twice", () => {
    const trip = stubTrip(AARE_ID, "2026-08-07");
    deepStrictEqual(publishTrips([trip, trip]), publishTrips([trip]));
  });

  it("resolves the trip by its stable id, matching its detail href", () => {
    const trip = getTripById(AARE_ID);
    ok(trip, "the published trip must be resolvable by its stable id");
    equal(trip.href, `/travel/${AARE_ID}`);
  });
});

describe("explicit promotion", () => {
  it("drops a travel-adjacent conversation that was never finalized", () => {
    const outing = stubTrip("day-out-idea", "2026-08-20", {
      source: {
        conversationId: "thread-travel-adjacent",
        publishedOn: "2026-08-06",
        promotion: "not-promoted",
        factOwners: [],
      },
    });

    const published = publishTrips([outing]);

    deepStrictEqual(published, []);
    equal(getTripById("day-out-idea"), undefined);
  });

  it("requires every conversation-sourced trip in the projection to be finalized", () => {
    for (const trip of trips) {
      if (!trip.source) continue;
      equal(
        trip.source.promotion,
        "explicitly-finalized",
        `${trip.id} reached the projection without explicit promotion`,
      );
    }
  });
});

describe("the published Aare trip", () => {
  const trip = getTripById(AARE_ID);

  it("carries its dates, summary, and work policy", () => {
    ok(trip);
    equal(trip.name, "Aareböötle — Uttigen to Bern");
    equal(trip.location, "Aare, Canton of Bern");
    equal(trip.dateLabel, "Friday, 7 August 2026");
    equal(trip.startDate, "2026-08-07");
    equal(trip.endDate, "2026-08-07", "a one-day trip starts and ends the same day");
    equal(trip.workPolicy, "No calls");
    match(trip.summary, /Uttigen to Bern Eichholz/);
  });

  it("carries a usable plan with the confirmed anchors", () => {
    ok(trip?.plan);
    const { schedule, anchors, decisions } = trip.plan;

    deepStrictEqual(
      schedule.map((s) => s.time),
      ["13:00", "15:00–15:30", "16:00", "16:45–17:30", "18:00"],
      "the day's anchors must stay in order",
    );

    const anchorTitles = anchors.map((a) => a.title);
    for (const place of [
      "Uttigen",
      "Hunzigenbrücke",
      "Bern Eichholz",
      "Restaurant Serini Eichholz",
    ]) {
      ok(anchorTitles.includes(place), `missing confirmed anchor: ${place}`);
    }

    ok(decisions && decisions.length > 0, "the Bern finish is a decision, not a fixed plan");
    match(
      decisions.map((d) => d.detail).join(" "),
      /Bernmobil line 19/,
      "the go-home route must survive as the low-energy option",
    );
  });

  it("gates the launch on a Friday-morning recheck", () => {
    ok(trip?.plan);
    const { conditions } = trip.plan;

    match(conditions.gate, /Friday morning/);
    match(conditions.gate, /MeteoSwiss/);
    match(conditions.gate, /FOEN/);
    match(conditions.gate, /Do not launch/);
    ok(conditions.readings.length > 0, "the gate needs the readings it is judged against");
  });

  it("keeps the life vest and the rental deadline non-negotiable", () => {
    ok(trip?.plan);
    const safety = trip.plan.safety.join(" ");

    match(safety, /life vest for every person/);
    match(safety, /18:00 rental return/);
  });
});

describe("one source of truth", () => {
  it("attributes booking facts upstream instead of redefining them", () => {
    const trip = getTripById(AARE_ID);
    ok(trip?.source);

    const tripIt = trip.source.factOwners.find((o) => o.system === "TripIt");
    ok(tripIt, "booking facts must name their owning system");
    match(tripIt.owns, /[Bb]ooking records/);
  });

  it("keeps the canonical source conversation traceable in data", () => {
    const trip = getTripById(AARE_ID);
    equal(trip?.source?.conversationId, "thread-1785962531986-h8xj18");
    equal(trip?.source?.publishedOn, "2026-08-06");
  });

  it("never leaks the source conversation slug into the rendered page", () => {
    doesNotMatch(DETAIL_PAGE, /thread-\d/);
    doesNotMatch(INDEX_PAGE, /thread-\d/);
  });
});

describe("the detail page renders from the projection", () => {
  it("resolves the trip by the same stable id the data publishes", () => {
    ok(DETAIL_PAGE.includes(`getTripById("${AARE_ID}")`));
  });

  it("maps the plan out of data rather than hardcoding the itinerary", () => {
    for (const list of ["schedule", "anchors", "decisions", "safety", "conditions.readings"]) {
      ok(
        DETAIL_PAGE.includes(`${list}.map(`),
        `the page must render ${list} from the trip plan`,
      );
    }
    ok(DETAIL_PAGE.includes("conditions.gate"), "the recheck gate must come from data");

    for (const content of ["Hunzigenbrücke", "Bernmobil", "meteoblue", "life vest", "13:00"]) {
      ok(
        !DETAIL_PAGE.includes(content),
        `"${content}" is plan content and belongs in the projection, not the page`,
      );
    }
  });
});
