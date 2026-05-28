#!/usr/bin/env node
import fs from 'node:fs/promises';
import { put } from '@vercel/blob';

const SNAPSHOT_PATH = 'garden-irrigation/latest.json';
const ZONES = [
  {
    id: 'entrance',
    name: 'Entrance',
    entityId: 'valve.water_control_entrance_water_control_entrance',
    planting: 'Rhododendron + hydrangea/hortensia beds',
    scheduledTime: '04:30',
  },
  {
    id: 'gartenhalle',
    name: 'Gartenhalle',
    entityId: 'valve.water_control_gartenhalle_water_control_gartenhalle',
    planting: 'Hedges + rhododendron + huge maple tree',
    scheduledTime: '05:45',
  },
  {
    id: 'gym',
    name: 'Gym/Wellness',
    entityId: 'valve.water_control_gym_water_control_gym',
    planting: 'Hedge + two trees',
    scheduledTime: '07:00',
  },
];

function buildSnapshot(input) {
  const dryRun = input.dryRun || {};
  const stateZones = input.wateringState?.zones || {};
  const byZone = new Map((dryRun.results || []).map((result) => [result.zone, result]));

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    source: 'live',
    automation: {
      enabled: true,
      method: 'OpenClaw cron → Home Assistant → Gardena',
      visibleInGardenaApp: true,
      rainSuppression: true,
    },
    weather: dryRun.weather || null,
    skip: {
      active: dryRun.decision === 'skip',
      reasons: dryRun.reasons || [],
    },
    zones: ZONES.map((zone) => {
      const plan = byZone.get(zone.id);
      const live = input.states?.[zone.entityId] || {};
      const zoneState = stateZones[zone.id] || {};
      return {
        ...zone,
        state: live.state ?? null,
        remainingMinutes: live.remainingMinutes ?? null,
        lastStartedAt: zoneState.last_started_at || null,
        lastMinutes: typeof zoneState.last_minutes === 'number' ? zoneState.last_minutes : null,
        nextPlannedMinutes: plan?.minutes ?? 0,
        nextReason: plan?.reasons || dryRun.reasons || [],
        nextAction: plan?.action === 'skip_zone' || dryRun.decision === 'skip' ? 'skip-zone' : 'water',
      };
    }),
    recentLog: input.recentLog || [],
    writtenAt: new Date().toISOString(),
  };
}

const inputPath = process.argv[2];
if (!inputPath) {
  console.error('Usage: publish-garden-snapshot.mjs <payload.json>');
  process.exit(2);
}
if (!process.env.BLOB_READ_WRITE_TOKEN) {
  console.error('BLOB_READ_WRITE_TOKEN is required');
  process.exit(2);
}

const input = JSON.parse(await fs.readFile(inputPath, 'utf8'));
const snapshot = buildSnapshot(input);
await put(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2), {
  access: 'public',
  contentType: 'application/json',
  addRandomSuffix: false,
  allowOverwrite: true,
  token: process.env.BLOB_READ_WRITE_TOKEN,
});
console.log(JSON.stringify({ ok: true, path: SNAPSHOT_PATH, generatedAt: snapshot.generatedAt }));
