/**
 * The scoped web-image refresh (`scripts/refresh-web-images.mjs`).
 *
 * Run with: npm test  (node --test; Node 24 strips types natively)
 *
 * The parts under test are the ones that decide whether production data is
 * touched: argument parsing, the fail-closed environment check, and the
 * surgical edit to a persisted week. The network and database halves are
 * exercised by running the script itself in dry-run.
 */

import { equal, ok, deepStrictEqual, throws } from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertEnvironment,
  parseArgs,
  planWithRefreshedImage,
} from "../../scripts/refresh-web-images.mjs";

const parse = parseArgs as (argv: string[]) => {
  week: string;
  recipes: string[];
  yes: boolean;
  json: boolean;
  help: boolean;
};
const checkEnvironment = assertEnvironment as (options: { write: boolean }) => void;
const refreshPlanImage = planWithRefreshedImage as (
  plan: unknown,
  recipeId: string,
  image: string,
) => Record<string, unknown> | null;

function withEnv<T>(env: Record<string, string | undefined>, run: () => T): T {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe("refresh arguments", () => {
  it("requires a well-formed week", () => {
    throws(() => parse([]), /--week must look like YYYY-Www/);
    throws(() => parse(["--week", "W33"]), /--week must look like YYYY-Www/);
    equal(parse(["--week", "2026-W33"]).week, "2026-W33");
  });

  it("is a dry run unless writes are asked for explicitly", () => {
    equal(parse(["--week", "2026-W33"]).yes, false);
    equal(parse(["--week", "2026-W33", "--yes"]).yes, true);
  });

  it("can be narrowed to named recipes", () => {
    deepStrictEqual(parse(["--week", "2026-W33", "--recipe", "a", "--recipe", "b"]).recipes, ["a", "b"]);
  });

  it("refuses an argument it does not understand rather than ignoring it", () => {
    throws(() => parse(["--week", "2026-W33", "--force"]), /Unknown argument/);
  });
});

describe("fail-closed environment", () => {
  it("refuses a remote database with no auth token", () => {
    withEnv({ TURSO_DATABASE_URL: "libsql://example", TURSO_AUTH_TOKEN: undefined }, () => {
      throws(() => checkEnvironment({ write: false }), /TURSO_AUTH_TOKEN/);
    });
  });

  it("refuses to write against a remote database with no blob token", () => {
    withEnv(
      { TURSO_DATABASE_URL: "libsql://example", TURSO_AUTH_TOKEN: "t", BLOB_READ_WRITE_TOKEN: undefined },
      () => {
        throws(() => checkEnvironment({ write: true }), /BLOB_READ_WRITE_TOKEN/);
        // A dry run against the same environment is still allowed: it writes
        // nothing, and reporting what *would* change is the point.
        checkEnvironment({ write: false });
      },
    );
  });

  it("allows a fully configured remote write and a plain local run", () => {
    withEnv(
      { TURSO_DATABASE_URL: "libsql://example", TURSO_AUTH_TOKEN: "t", BLOB_READ_WRITE_TOKEN: "b" },
      () => checkEnvironment({ write: true }),
    );
    withEnv({ TURSO_DATABASE_URL: undefined, TURSO_AUTH_TOKEN: undefined }, () =>
      checkEnvironment({ write: true }),
    );
  });
});

describe("editing a persisted week", () => {
  const plan = {
    week: "2026-W33",
    status: "finalized",
    updatedAt: "2026-08-08T10:00:00.000Z",
    days: [{ date: "2026-08-10", recipeId: "green-goddess", recipeName: "Green Goddess" }],
    candidateSet: {
      generatedAt: "2026-08-06T05:30:00.000Z",
      policyVersion: "planner-shelf-1",
      items: [
        { recipeId: "green-goddess", image: "/recipes/green-goddess.jpg", reason: "Editor-curated pick", role: "main" },
        { recipeId: "dhal", image: "https://blob.example/recipes/dhal.jpg", role: "main" },
      ],
    },
  };

  it("replaces only the matching card's image", () => {
    const next = refreshPlanImage(plan, "dhal", "https://blob.example/recipes/dhal-v2.jpg");
    ok(next);
    const items = (next.candidateSet as { items: { recipeId: string; image: string }[] }).items;
    equal(items[0].image, "/recipes/green-goddess.jpg", "the other card is untouched");
    equal(items[1].image, "https://blob.example/recipes/dhal-v2.jpg");
  });

  it("moves nothing else about the week", () => {
    const next = refreshPlanImage(plan, "dhal", "https://blob.example/recipes/dhal-v2.jpg");
    ok(next);
    deepStrictEqual(next.days, plan.days, "day assignments are untouched");
    equal(next.status, "finalized");
    equal(next.updatedAt, plan.updatedAt, "the week's updatedAt is not bumped");
    const set = next.candidateSet as { items: unknown[]; generatedAt: string; policyVersion: string };
    equal(set.items.length, 2, "no card is added or removed");
    equal(set.generatedAt, "2026-08-06T05:30:00.000Z", "the shelf was prepared then, not now");
    equal(set.policyVersion, "planner-shelf-1");
  });

  it("keeps the internal selector reason on the persisted item", () => {
    // It stays in the contract for diagnostics; what changed is that the card
    // no longer renders it.
    const next = refreshPlanImage(plan, "dhal", "https://blob.example/recipes/dhal-v2.jpg");
    ok(next);
    const items = (next.candidateSet as { items: { reason?: string }[] }).items;
    equal(items[0].reason, "Editor-curated pick");
  });

  it("is idempotent: an unchanged image produces no edit", () => {
    equal(refreshPlanImage(plan, "dhal", "https://blob.example/recipes/dhal.jpg"), null);
  });

  it("reports nothing to do for a recipe the week never showed", () => {
    equal(refreshPlanImage(plan, "not-on-this-shelf", "https://blob.example/x.jpg"), null);
    equal(refreshPlanImage({ week: "2026-W33" }, "dhal", "https://blob.example/x.jpg"), null);
  });
});
