/**
 * The film's timing, set from the narration: one take of the whole script, placed on film time,
 * its words timed to the character. Each scene starts as its narration does, and each beat on
 * screen lands on the word that names it. The walkthrough and the team scene are authored on
 * their own clocks; these pairs say when each authored moment is played, and the film moves
 * smoothly between them (time.ts, `smoothMap`).
 */

/** The film's length, in seconds. */
export const RUNTIME = 157.85;

/** The why scene: when it starts and ends, as played. */
export const WHY_AT = 8.98;
export const WHY_END = 39.28;

/** The team scene: when it starts and ends, as played. */
export const TEAM_AT = 131.78;
export const TEAM_END = 142.25;

/** [played, authored] for the walkthrough, which the two scenes interrupt. */
export const WALK: readonly (readonly [number, number])[] = [
  [0.0, 0], // film start
  [5.26, 6], // the cards dealt, their figures in
  [6.5, 10.2], // held; the line leaves
  [7.0, 10.8], // the cards fly into the sidebar: "Architect"
  [8.21, 12.4], // the Lab window, whole
  [8.98, 13.6], // the Lab window steps back for the why scene
  [39.28, 13.6], // the Lab window is back: "In Architect Lab"
  [41.52, 15.4], // the push onto the Lab page settles
  [44.05, 22.1], // held
  [45.51, 24.6], // Fields: "A field"
  [47.6, 26.8], // the push onto Fields settles
  [49.52, 29.7], // held
  [50.84, 31.1], // the academy field, Organizations
  [51.64, 31.9], // the academies it is taught on: "Glimmer learns on three"
  [54.46, 34.1], // the first never-seen academy locked: "sealed"
  [56.22, 36.7], // Harborview chosen: sealed until the final test: "final test"
  [58.44, 41.3], // held
  [59.9, 43.5], // Define: "First"
  [61.72, 45.8], // the brief in
  [62.9, 47.6], // held
  [64.16, 50.3], // the first scroll
  [64.74, 51.4], // the passages opening: "each rule tied to its source"
  [65.6, 52.9], // the passages open
  [65.7, 53.6], // held
  [66.89, 56.6], // the second scroll, to Confirm
  [67.39, 57.6], // Confirm pressed: "confirm"
  [69.45, 58.8], // Train: "Each round"
  [71.68, 60.6], // round 1 in: "failure"
  [74.28, 63.4], // round 2 in
  [75.92, 64.8], // round 2 reverted: "only"
  [77.6, 66.6], // round 3 in
  [79.48, 69.6], // the count starts
  [80.18, 70.7], // 97%, 35 of 36: "Thirty-five"
  [82.46, 72.4], // the drawer slides in: "When"
  [85.18, 74.4], // the table shrinks: "shrinks"
  [86.22, 75.7], // "4 rows": "four"
  [87.98, 78.6], // repaired, the cases kept: "test"
  [88.73, 80.2], // the cases in view
  [88.98, 82.2], // held
  [90.41, 84.6], // the experiment: "Comparisons"
  [91.94, 85.4], // Preregistered: "registered"
  [97.9, 90.7], // Harborview's arms land: "forty-three"
  [100.72, 90.9], // the real academy's arms land
  [103.66, 92.6], // the real academy's difference: "no gain"
  [105.05, 99], // held
  [105.91, 100.4], // Models: "A specialist"
  [109.58, 103.4], // the version panel, its certificate: "Architect can state"
  [113.18, 107], // Held, where it never trained: "check"
  [114.58, 108.2], // the checks in
  [114.91, 112.9], // held
  [115.43, 114], // Compute: "Compute"
  [117.42, 116.9], // the plan
  [117.7, 118.9], // held: the plan, passed over to the bundle
  [117.9, 119.15], // Slurm chosen in the bundle: "cluster"
  [119.65, 121.2], // the command typed
  [119.76, 122.6], // held
  [120.86, 124.6], // the academy desk: "Then"
  [122.16, 126], // Offline: "network"
  [125.92, 129], // the answer comes in: "works out why"
  [128.32, 132.4], // the practice card: "sets practice"
  [130.48, 134.9], // Allow once pressed, Saved: "saves"
  [131.78, 135.4], // the team scene leaves the chat
  [142.25, 143.8], // the first screen: "Architect teaches"
  [146.74, 147.7], // Architect Lab chosen: "Architect Lab"
  [149.48, 150.4], // the pull back over every screen: "A small model"
  [155.26, 157.3], // the lockup: "Architect"
  [157.85, 163], // end
];

/** [played, the team scene's own time]. */
export const TEAM: readonly (readonly [number, number])[] = [
  [131.78, 0], // the sidebar scrolls to the team
  [132.78, 1.2], // the request: "Specialists"
  [136.02, 1.9], // Asking Assay desk: "asks"
  [137.62, 3.2], // Assay desk's two compounds: "compounds"
  [139.78, 7.2], // the hold row: "holds"
  [140.48, 8.1], // Allow once pressed
  [141.65, 10.2], // the first screen comes in
  [142.25, 10.8], // the team scene ends
];

/** The why scene's blocks of type, in seconds from its start: each on screen while it is said. */
export const WHY = {
  reason: { at: 0.36, until: 3.37 },
  answer: { at: 3.72, until: 7.45 },
  asked: { at: 7.8, until: 12.33 },
  requests: [
    { at: 12.63, until: 18.85 },
    { at: 19.15, until: 25.05 },
    { at: 25.35, until: 29.4 },
  ],
} as const;
