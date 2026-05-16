/**
 * House asset seed data.
 *
 * This is a bundled mirror for the companion-app MVP.
 * Canonical domain ownership: projects/house-assets/
 */

export interface MaintenanceTask {
  task: string;
  frequency: string;
  notes?: string;
}

export interface StatusArea {
  label: string;
  status: "available" | "pending" | "not-tracked";
  detail?: string;
}

export interface HouseAsset {
  id: string;
  name: string;
  category: string;
  brand: string;
  model: string;
  description: string;
  acquiredYear: number;
  maintenance: MaintenanceTask[];
  statusAreas: StatusArea[];
  warnings?: string[];
}

export const houseAssets: HouseAsset[] = [
  {
    id: "quamar-q50e",
    name: "Quamar Q50E",
    category: "Kitchen",
    brand: "Quamar",
    model: "Q50E",
    description: "Espresso grinder with 54 mm flat burrs and stepless adjustment.",
    acquiredYear: 2025,
    maintenance: [
      {
        task: "Run grinder cleaning pellets",
        frequency: "Monthly to every 1–2 months",
        notes:
          "Use Grindz, Puly Grind, or Cafetto-style grinder pellets. Purge with a small dose of beans afterward to clear residue.",
      },
      {
        task: "Brush and vacuum burr chamber",
        frequency: "Quarterly",
        notes:
          "Remove upper burr carrier, brush out fines, vacuum the chamber. Do not use water.",
      },
      {
        task: "Deep inspect burrs and alignment",
        frequency: "Annually",
        notes:
          "Check burr wear, clean retention path, inspect worm-gear adjustment mechanism.",
      },
    ],
    statusAreas: [
      { label: "Receipt", status: "pending", detail: "Not yet uploaded" },
      { label: "Warranty", status: "pending", detail: "Check manufacturer terms" },
      { label: "Service history", status: "not-tracked" },
      { label: "Resale value", status: "not-tracked" },
    ],
    warnings: [
      "Never wash the burr chamber or burrs with water — moisture causes corrosion and clumping.",
      "Cafiza / Cafetto espresso cleaner is for the espresso machine group head, not the grinder.",
      "The hopper can be hand-washed with mild soap and must be fully dry before reattaching.",
    ],
  },
];
