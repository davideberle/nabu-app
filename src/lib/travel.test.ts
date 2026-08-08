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
//   5. **Archiving is honest** — a past trip lands in the archive exactly once,
//      keeps its plan as a record, and stops issuing pre-departure orders.
//
// The overview also has a layout contract that only shows up on a phone, so it
// is pinned here as source structure — see "the trip card survives a phone".
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
const CARD_PRIMITIVE = readFileSync(
  new URL("../components/ui/nabu.tsx", import.meta.url),
  "utf8",
);

/**
 * Page source with its comments stripped — roughly, what reaches the screen.
 * A comment may name a pre-trip instruction to explain why it is *not*
 * rendered; that must not read as the page still issuing it.
 */
function rendered(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

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

  it("does not mix a past trip into the upcoming list", () => {
    const upcomingIds = getUpcomingTrips().map((t) => t.id);
    const pastIds = getPastTrips().map((t) => t.id);

    ok(pastIds.includes(AARE_ID));
    ok(!upcomingIds.includes(AARE_ID));
  });
});

describe("the archived Aare day", () => {
  it("is past, so the overview leaves Upcoming empty", () => {
    equal(getTripById(AARE_ID)?.status, "past");
    deepStrictEqual(getUpcomingTrips(), []);
  });

  it("is the newest entry in the archive, ahead of San Sebastian", () => {
    deepStrictEqual(
      getPastTrips().map((t) => t.id),
      [AARE_ID, "san-sebastian"],
    );
  });

  it("appears in the archive exactly once, and nowhere else", () => {
    equal(getPastTrips().filter((t) => t.id === AARE_ID).length, 1);
    equal(trips.filter((t) => t.id === AARE_ID).length, 1);
  });

  it("keeps its detail route reachable from the card", () => {
    equal(getTripById(AARE_ID)?.href, `/travel/${AARE_ID}`);
  });

  it("carries a retrospective that does not invent a lived day", () => {
    const archive = getTripById(AARE_ID)?.archive;
    ok(archive, "an archived trip needs its archive record");
    match(archive.snapshot, /Uttigen/);
    ok(
      !archive.highlights?.length,
      "no account of the day was written back, so there are no lived highlights to claim",
    );
  });

  it("keeps the finalized plan as a record rather than deleting it", () => {
    const plan = getTripById(AARE_ID)?.plan;
    ok(plan, "the plan of record must survive archiving");
    equal(plan.schedule.length, 5);
    ok(plan.safety.length > 0);
  });

  it("drops the pre-departure launch gate from the projection", () => {
    equal(
      getTripById(AARE_ID)?.plan?.conditions.gate,
      undefined,
      "a past trip must not carry a gate that reads as still pending",
    );
    ok(
      (getTripById(AARE_ID)?.plan?.conditions.readings.length ?? 0) > 0,
      "the readings stay as the conditions on record",
    );
  });
});

describe("stable identity and republication", () => {
  it("publishes each stable id exactly once", () => {
    const ids = trips.map((t) => t.id);
    deepStrictEqual(ids, [...new Set(ids)]);
  });

  it("shows the Aare trip exactly once across the whole overview", () => {
    const shown = [...getUpcomingTrips(), ...getPastTrips()].filter(
      (t) => t.id === AARE_ID,
    );
    equal(shown.length, 1);
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

  it("keeps the readings the day was judged against", () => {
    ok(trip?.plan);
    const readings = trip.plan.conditions.readings.join(" ");

    equal(trip.plan.conditions.checkedAt, "Thursday 6 August, morning");
    match(readings, /meteoblue/);
    match(readings, /FOEN/);
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
    equal(
      trip?.source?.publishedOn,
      "2026-08-06",
      "archiving records a second date, it does not rewrite the first",
    );
    equal(trip?.source?.archivedOn, "2026-08-08");
  });

  it("never leaks the source conversation slug into the rendered page", () => {
    for (const page of [DETAIL_PAGE, INDEX_PAGE]) {
      doesNotMatch(page, /thread-\d/);
      doesNotMatch(page, /conversationId/);
    }
  });
});

describe("the detail page renders from the projection", () => {
  it("resolves the trip by the same stable id the data publishes", () => {
    ok(DETAIL_PAGE.includes(`getTripById("${AARE_ID}")`));
  });

  it("maps the plan out of data rather than hardcoding the itinerary", () => {
    for (const list of ["schedule", "anchors", "decisions", "conditions.readings"]) {
      ok(
        DETAIL_PAGE.includes(`${list}.map(`),
        `the page must render ${list} from the trip plan`,
      );
    }

    for (const content of ["Hunzigenbrücke", "Bernmobil", "meteoblue", "life vest", "13:00"]) {
      ok(
        !DETAIL_PAGE.includes(content),
        `"${content}" is plan content and belongs in the projection, not the page`,
      );
    }
  });

  it("reads as a past trip, not a briefing", () => {
    ok(DETAIL_PAGE.includes('eyebrow="Past trip"'));
    ok(DETAIL_PAGE.includes("trip.archive"), "the page must render the archive record");
    doesNotMatch(DETAIL_PAGE, /Upcoming trip/);
  });

  it("renders neither the launch gate nor the packing checklist", () => {
    doesNotMatch(
      rendered(DETAIL_PAGE),
      /Before leaving|conditions\.gate|safety\.map\(/,
      "the gate and the safety list are pre-departure material",
    );
  });

  it("gives no order the day has already outrun", () => {
    // The page renders almost nothing of its own, so the register that matters
    // is the projection's. A past trip may record that a recheck *was* a
    // commitment; it may not still be telling anyone to go and do one.
    const trip = getTripById(AARE_ID);
    ok(trip?.plan && trip.archive);
    const shown = [
      trip.summary,
      trip.archive.snapshot,
      trip.plan.note,
      ...trip.plan.schedule.flatMap((s) => [s.title, s.detail]),
      ...trip.plan.anchors.flatMap((a) => [a.title, a.detail]),
      ...(trip.plan.decisions ?? []).flatMap((d) => [d.title, d.detail]),
      trip.plan.conditions.checkedAt,
      ...trip.plan.conditions.readings,
    ].join(" ");

    doesNotMatch(shown, /Do not launch|Before leaving/i);
    doesNotMatch(
      shown,
      /\bRecheck\b/,
      "the imperative form is the gate; the past-tense noun is just history",
    );
    doesNotMatch(shown, /\byou\b/i, "a record narrates, it does not instruct");
  });

  it("does not claim any optional stop actually happened", () => {
    for (const optional of ["Serini", "Dampfzentrale", "picnic"]) {
      ok(
        !DETAIL_PAGE.includes(optional),
        `"${optional}" was never confirmed — the page must not name it as lived`,
      );
    }
  });
});

// The overview's phone layout has no browser in this test run, so the two
// things that actually broke it at ~335 px are pinned as source structure.
// Treat these as a floor, not a substitute for looking at a real viewport.
describe("the trip card survives a phone", () => {
  it("stacks its cards in a plain block container", () => {
    ok(
      INDEX_PAGE.includes('<div className="space-y-3">'),
      "the cards are not flex or grid children, so nothing blockifies them for free",
    );
  });

  it("gives a linked card an explicit block box", () => {
    // A `NabuCard` with an href renders as an <a>, which is inline by default.
    // A bordered inline box fragments across line boxes and lets its block
    // children escape — that is the detached border slivers with the text
    // spilling outside them.
    match(
      CARD_PRIMITIVE,
      /href &&\s*\n?\s*"block /,
      "a linked card must not be left as an inline <a>",
    );
  });

  it("lets a long trip name wrap instead of truncating it away", () => {
    const title = INDEX_PAGE.match(/<h3 className="([^"]+)"/)?.[1];
    ok(title, "the trip card must have a title");
    ok(!title.includes("truncate"), "truncation crushes the name on a phone");
    ok(title.includes("break-words"), "a long unbroken name must not overflow");
    ok(title.includes("min-w-0"), "the title must be allowed to shrink");
  });

  it("keeps the status pill from crushing the title", () => {
    const row = INDEX_PAGE.match(/<div className="(flex[^"]+)">\s*<h3/)?.[1];
    ok(row, "the title and its pill share a row");
    ok(row.includes("flex-wrap"), "the pill drops below the title when space runs out");
    ok(row.includes("min-w-0"));
    ok(
      INDEX_PAGE.includes('<NabuPill tone={trip.status === "past" ? "stone" : "green"} className="shrink-0">'),
      "the pill keeps its own width rather than being squeezed",
    );
  });

  it("renders the empty state when nothing is upcoming", () => {
    equal(getUpcomingTrips().length, 0);
    ok(INDEX_PAGE.includes("<NabuEmptyState"));
  });
});
