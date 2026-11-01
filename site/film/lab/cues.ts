/**
 * The film's timing, set from the narration: one take of the whole script, placed on film time,
 * its words timed to the character. Each scene starts as its narration does, and each beat on
 * screen lands on the word that names it. The walkthrough and the team scene are authored on
 * their own clocks; these pairs say when each authored moment is played, and the film moves
 * smoothly between them (time.ts, `smoothMap`).
 */

/** The film's length, in seconds. */
export const RUNTIME = 161.34;

/** The why scene: when it starts and ends, as played. */
export const WHY_AT = 8.89;
export const WHY_END = 38.32;

/** The team scene: when it starts and ends, as played. */
export const TEAM_AT = 130.95;
export const TEAM_END = 145.89;

/** [played, authored] for the walkthrough, which the two scenes interrupt. */
export const WALK: readonly (readonly [number, number])[] = [
  [0.0, 0], // film start
  [5.18, 6], // the cards dealt, their figures in
  [6.34, 10.2], // held; the line leaves
  [6.84, 10.8], // the cards fly into the sidebar: "Architect"
  [8.05, 12.4], // the Lab window, whole
  [8.89, 13.6], // the Lab window steps back for the why scene
  [38.32, 13.6], // the Lab window is back: "In Architect Lab"
  [40.64, 15.4], // the push onto the Lab page settles
  [43.1, 22.1], // held
  [44.47, 24.6], // Fields: "A field"
  [46.68, 26.8], // the push onto Fields settles
  [48.8, 29.7], // held
  [49.72, 31.1], // the academy field, Organizations
  [50.52, 31.9], // the academies it is taught on: "Glimmer learns on three"
  [53.18, 34.1], // the first never-seen academy locked: "sealed"
  [55.1, 36.7], // Harborview chosen: sealed until the final test: "final test"
  [57.28, 41.3], // held
  [58.64, 43.5], // Define: "First"
  [60.46, 45.8], // the brief in
  [61.64, 47.6], // held
  [62.9, 50.3], // the first scroll
  [63.48, 51.4], // the passages opening: "each rule tied to its source"
  [64.34, 52.9], // the passages open
  [64.44, 53.6], // held
  [66.41, 56.6], // the second scroll, to Confirm
  [66.91, 57.6], // Confirm pressed: "confirm"
  [68.89, 58.8], // Train: "Each round"
  [71.12, 60.6], // round 1 in: "failure"
  [73.64, 63.4], // round 2 in
  [75.28, 64.8], // round 2 reverted: "only"
  [76.88, 66.6], // round 3 in
  [78.52, 69.6], // the count starts
  [79.22, 70.7], // 97%, 35 of 36: "Thirty-five"
  [81.26, 72.4], // the drawer slides in: "When"
  [83.98, 74.4], // the table shrinks: "shrinks"
  [85.02, 75.7], // "4 rows": "four"
  [86.54, 78.6], // repaired, the cases kept: "test"
  [87.29, 80.2], // the cases in view
  [87.54, 82.2], // held
  [89.13, 84.6], // the experiment: "Comparisons"
  [90.38, 85.4], // Preregistered: "registered"
  [96.54, 90.7], // Harborview's arms land: "forty-three"
  [99.44, 90.9], // the real academy's arms land
  [102.22, 92.6], // the real academy's difference: "twelve"
  [104.36, 99], // held
  [105.27, 100.4], // Models: "A specialist"
  [108.94, 103.4], // the version panel, its certificate: "Architect can state"
  [112.62, 107], // Held, where it never trained: "check"
  [113.94, 108.2], // the checks in
  [113.99, 112.9], // held
  [114.55, 114], // Compute: "Compute"
  [116.54, 116.9], // the plan
  [116.74, 118.9], // held: the plan, passed over to the bundle
  [116.94, 119.15], // Slurm chosen in the bundle: "cluster"
  [119.17, 121.2], // the command typed
  [119.47, 122.6], // held
  [120.68, 124.6], // the academy desk: "Then"
  [121.86, 126], // Offline: "network"
  [125.38, 129], // the answer comes in: "works out why"
  [127.78, 132.4], // the practice card: "sets practice"
  [129.94, 134.9], // Allow once pressed, Saved: "saves"
  [130.95, 135.4], // the team scene leaves the chat
  [145.89, 143.8], // the first screen: "Architect teaches"
  [150.3, 147.7], // Architect Lab chosen: "Architect Lab"
  [152.79, 150.4], // the pull back over every screen: "A small model"
  [158.62, 157.3], // the lockup: "Architect"
  [161.34, 163], // end
];

/** [played, the team scene's own time]. */
export const TEAM: readonly (readonly [number, number])[] = [
  [130.95, 0], // Offline gives way to Fields
  [132.68, 1.15], // the academy's row lit: "one field"
  [133.96, 2.35], // the screening labs' desks lit: "screening lab"
  [135.68, 3.4], // the sidebar scrolls to the team
  [137.86, 4.6], // the request: "team"
  [139.72, 5.3], // Asking Assay desk: "asks"
  [141.24, 6.6], // Assay desk's two compounds: "compounds"
  [143.32, 10.6], // the hold row: "holds"
  [144.02, 11.5], // Allow once pressed
  [145.29, 13.6], // the first screen comes in
  [145.89, 14.2], // the team scene ends
];

/** The why scene's blocks of type, in seconds from its start: each on screen while it is said. */
export const WHY = {
  reason: { at: 0.37, until: 3.38 },
  answer: { at: 3.73, until: 7.54 },
  asked: { at: 7.89, until: 12.1 },
  requests: [
    { at: 12.4, until: 18.62 },
    { at: 18.92, until: 24.58 },
    { at: 24.88, until: 28.53 },
  ],
} as const;
