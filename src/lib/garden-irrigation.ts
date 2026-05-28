import { head, put } from "@vercel/blob";

export type GardenZoneId = "entrance" | "gartenhalle" | "gym";

export type GardenZoneSnapshot = {
  id: GardenZoneId;
  name: string;
  entityId: string;
  planting: string;
  scheduledTime: string;
  state: string | null;
  remainingMinutes: number | null;
  lastStartedAt: string | null;
  lastMinutes: number | null;
  nextPlannedMinutes: number;
  nextReason: string[];
  nextAction: "water" | "skip-zone";
};

export type GardenWeatherSummary = {
  recent_24h_mm: number;
  next_12h_mm: number;
  next_24h_mm: number;
  next_48h_mm: number;
  next_72h_mm: number;
  max_precip_probability_24h: number;
  max_temp_today_c: number | null;
  avg_daylight_cloud_cover_pct: number | null;
  et0_today_mm: number | null;
};

export type GardenWateringLogEntry = {
  ts: string;
  decision: "water" | "skip" | string;
  zones?: GardenZoneId[];
  weather?: GardenWeatherSummary;
  reasons?: string[];
  results?: Array<{
    zone: GardenZoneId;
    action: string;
    minutes: number;
    reasons?: string[];
  }>;
};

export type GardenScheduleSnapshot = {
  ok: boolean;
  generatedAt: string;
  source: "live" | "snapshot" | "fallback";
  automation: {
    enabled: boolean;
    method: string;
    visibleInGardenaApp: boolean;
    rainSuppression: boolean;
  };
  weather: GardenWeatherSummary | null;
  skip: {
    active: boolean;
    reasons: string[];
  };
  zones: GardenZoneSnapshot[];
  recentLog: GardenWateringLogEntry[];
  error?: string;
};

type ScriptZoneResult = {
  zone: GardenZoneId;
  action: string;
  minutes: number;
  reasons?: string[];
};

type ScriptDryRun = {
  decision?: string;
  weather?: GardenWeatherSummary;
  reasons?: string[];
  results?: ScriptZoneResult[];
};

type SnapshotBlob = GardenScheduleSnapshot & { writtenAt?: string };

const SNAPSHOT_PATH = "garden-irrigation/latest.json";
const ZONES: Array<Omit<GardenZoneSnapshot, "state" | "remainingMinutes" | "lastStartedAt" | "lastMinutes" | "nextPlannedMinutes" | "nextReason" | "nextAction">> = [
  {
    id: "entrance",
    name: "Entrance",
    entityId: "valve.water_control_entrance_water_control_entrance",
    planting: "Rhododendron + hydrangea/hortensia beds",
    scheduledTime: "04:30",
  },
  {
    id: "gartenhalle",
    name: "Gartenhalle",
    entityId: "valve.water_control_gartenhalle_water_control_gartenhalle",
    planting: "Hedges + rhododendron + huge maple tree",
    scheduledTime: "05:45",
  },
  {
    id: "gym",
    name: "Gym/Wellness",
    entityId: "valve.water_control_gym_water_control_gym",
    planting: "Hedge + two trees",
    scheduledTime: "07:00",
  },
];

function token() {
  return process.env.BLOB_READ_WRITE_TOKEN;
}

function fallbackSnapshot(error?: string): GardenScheduleSnapshot {
  return {
    ok: false,
    generatedAt: new Date().toISOString(),
    source: "fallback",
    automation: {
      enabled: true,
      method: "OpenClaw cron → Home Assistant → Gardena",
      visibleInGardenaApp: true,
      rainSuppression: true,
    },
    weather: null,
    skip: { active: false, reasons: [] },
    zones: ZONES.map((zone) => ({
      ...zone,
      state: null,
      remainingMinutes: null,
      lastStartedAt: null,
      lastMinutes: null,
      nextPlannedMinutes: zone.id === "gym" ? 30 : 60,
      nextReason: ["Fallback plan; live garden snapshot unavailable"],
      nextAction: "water",
    })),
    recentLog: [],
    error,
  };
}

export async function getGardenSnapshotFromBlob(): Promise<GardenScheduleSnapshot> {
  if (!token()) return fallbackSnapshot("BLOB_READ_WRITE_TOKEN is not configured");

  try {
    const meta = await head(SNAPSHOT_PATH, { token: token() });
    const response = await fetch(meta.downloadUrl, { cache: "no-store" });
    if (!response.ok) throw new Error(`Snapshot fetch failed: ${response.status}`);
    const snapshot = (await response.json()) as SnapshotBlob;
    return {
      ...snapshot,
      source: snapshot.source === "live" ? "live" : "snapshot",
    };
  } catch (error) {
    return fallbackSnapshot(error instanceof Error ? error.message : "Garden snapshot unavailable");
  }
}

export async function publishGardenSnapshot(snapshot: GardenScheduleSnapshot) {
  if (!token()) throw new Error("BLOB_READ_WRITE_TOKEN is not configured");
  await put(
    SNAPSHOT_PATH,
    JSON.stringify({ ...snapshot, writtenAt: new Date().toISOString() }, null, 2),
    {
      access: "public",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
      token: token(),
    },
  );
}

export function buildSnapshotFromScript(input: {
  dryRun: ScriptDryRun;
  states?: Record<string, { state?: string | null; remainingMinutes?: number | null }>;
  wateringState?: Record<string, unknown>;
  recentLog?: GardenWateringLogEntry[];
}): GardenScheduleSnapshot {
  const byZone = new Map((input.dryRun.results || []).map((result) => [result.zone, result]));
  const stateZones = (input.wateringState?.zones || {}) as Record<string, { last_started_at?: string; last_minutes?: number }>;

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    source: "live",
    automation: {
      enabled: true,
      method: "OpenClaw cron → Home Assistant → Gardena",
      visibleInGardenaApp: true,
      rainSuppression: true,
    },
    weather: input.dryRun.weather || null,
    skip: {
      active: input.dryRun.decision === "skip",
      reasons: input.dryRun.reasons || [],
    },
    zones: ZONES.map((zone) => {
      const plan = byZone.get(zone.id);
      const live = input.states?.[zone.entityId];
      const zoneState = stateZones[zone.id] || {};
      return {
        ...zone,
        state: live?.state ?? null,
        remainingMinutes: live?.remainingMinutes ?? null,
        lastStartedAt: zoneState.last_started_at || null,
        lastMinutes: typeof zoneState.last_minutes === "number" ? zoneState.last_minutes : null,
        nextPlannedMinutes: plan?.minutes ?? 0,
        nextReason: plan?.reasons || input.dryRun.reasons || [],
        nextAction: plan?.action === "skip_zone" || input.dryRun.decision === "skip" ? "skip-zone" : "water",
      };
    }),
    recentLog: input.recentLog || [],
  };
}
