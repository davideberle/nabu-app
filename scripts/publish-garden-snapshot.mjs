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

function nextScheduledAt(scheduledTime, now = new Date()) {
  const [hourRaw, minuteRaw] = scheduledTime.split(':');
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  const candidate = new Date(now);
  candidate.setHours(hour, minute, 0, 0);
  if (candidate.getTime() <= now.getTime()) candidate.setDate(candidate.getDate() + 1);
  return candidate.toISOString();
}

function planActionForZone(plan, dryRun) {
  if (dryRun.decision === 'skip' || plan?.action === 'skip_zone') return 'skip-zone';
  if (!plan) return 'decide-at-runtime';
  return 'water';
}

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
      method: 'macOS LaunchAgents → Home Assistant → Gardena',
      visibleInGardenaApp: true,
      rainSuppression: true,
    },
    weather: dryRun.weather || null,
    season: dryRun.season || null,
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
        nextScheduledAt: nextScheduledAt(zone.scheduledTime),
        nextPlannedMinutes: typeof plan?.minutes === 'number' && plan.minutes > 0 ? plan.minutes : null,
        nextReason: plan?.reasons || dryRun.reasons || [],
        nextAction: planActionForZone(plan, dryRun),
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
