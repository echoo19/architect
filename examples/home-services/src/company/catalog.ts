import type { License, Part, Rate, Skill, TaxRate, Technician, TravelTime, Zone } from './types';

/** The fixed side of Ferncliff Home Services: places, prices, people and the kinds of work. */

export const ZONES: readonly Zone[] = ['Harbor', 'Old Town', 'Millbrook', 'Ridge', 'Lakeside'];

interface City {
  name: string;
  rateBp: number;
  zones: readonly Zone[];
  /** Relative share of customers. */
  weight: number;
}

export const CITIES: readonly City[] = [
  { name: 'Ferncliff', rateBp: 825, zones: ['Harbor', 'Old Town'], weight: 30 },
  { name: 'Alder Bay', rateBp: 775, zones: ['Lakeside'], weight: 14 },
  { name: 'Marlow', rateBp: 850, zones: ['Millbrook'], weight: 15 },
  { name: 'Kestrel Point', rateBp: 800, zones: ['Harbor', 'Lakeside'], weight: 12 },
  { name: 'Stonebridge', rateBp: 875, zones: ['Ridge', 'Millbrook'], weight: 15 },
  { name: 'Westvale', rateBp: 725, zones: ['Ridge'], weight: 14 },
];

export const TAX_RATES: readonly TaxRate[] = CITIES.map((city) => ({
  city: city.name,
  rate_bp: city.rateBp,
}));

/** Driving minutes between zones, same zone included. Symmetric, and it obeys the triangle rule. */
const TRAVEL_MATRIX: Readonly<Record<Zone, Readonly<Record<Zone, number>>>> = {
  Harbor: { Harbor: 10, 'Old Town': 20, Millbrook: 35, Ridge: 45, Lakeside: 25 },
  'Old Town': { Harbor: 20, 'Old Town': 10, Millbrook: 20, Ridge: 30, Lakeside: 35 },
  Millbrook: { Harbor: 35, 'Old Town': 20, Millbrook: 10, Ridge: 20, Lakeside: 45 },
  Ridge: { Harbor: 45, 'Old Town': 30, Millbrook: 20, Ridge: 10, Lakeside: 55 },
  Lakeside: { Harbor: 25, 'Old Town': 35, Millbrook: 45, Ridge: 55, Lakeside: 10 },
};

export const TRAVEL_TIMES: readonly TravelTime[] = ZONES.flatMap((from) =>
  ZONES.map((to) => ({ from_zone: from, to_zone: to, minutes: TRAVEL_MATRIX[from][to] })),
);

export const RATES: readonly Rate[] = [
  { tier: 'apprentice', hourly_rate_cents: 8400 },
  { tier: 'journeyman', hourly_rate_cents: 11400 },
  { tier: 'lead', hourly_rate_cents: 13800 },
];

/**
 * Twelve technicians. Licenses are scarce on purpose: two people can test backflow and two hold a
 * master electrician license, and only heating and electrical crews work Saturdays.
 */
export const TECHNICIANS: readonly Technician[] = [
  {
    technician_id: 'T-01',
    name: 'Marta Quill',
    tier: 'lead',
    skills: ['plumbing', 'heating'],
    licenses: ['gas', 'backflow'],
    work_days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    start_time: '07:30',
    end_time: '16:00',
  },
  {
    technician_id: 'T-02',
    name: 'Desmond Ruiz',
    tier: 'journeyman',
    skills: ['plumbing'],
    licenses: ['backflow'],
    work_days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    start_time: '08:00',
    end_time: '16:30',
  },
  {
    technician_id: 'T-03',
    name: 'Priya Halvorsen',
    tier: 'journeyman',
    skills: ['heating'],
    licenses: ['gas'],
    work_days: ['Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    start_time: '08:00',
    end_time: '16:30',
  },
  {
    technician_id: 'T-04',
    name: 'Owen Achterberg',
    tier: 'lead',
    skills: ['electrical'],
    licenses: ['master_electrician'],
    work_days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    start_time: '07:30',
    end_time: '16:00',
  },
  {
    technician_id: 'T-05',
    name: 'Sofia Brandt',
    tier: 'apprentice',
    skills: ['plumbing'],
    licenses: [],
    work_days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    start_time: '08:00',
    end_time: '16:30',
  },
  {
    technician_id: 'T-06',
    name: 'Theo Nakamura',
    tier: 'journeyman',
    skills: ['electrical'],
    licenses: [],
    work_days: ['Mon', 'Tue', 'Wed', 'Thu'],
    start_time: '07:00',
    end_time: '17:30',
  },
  {
    technician_id: 'T-07',
    name: 'Rosa Finch',
    tier: 'journeyman',
    skills: ['plumbing', 'heating'],
    licenses: ['gas'],
    work_days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    start_time: '09:00',
    end_time: '17:30',
  },
  {
    technician_id: 'T-08',
    name: 'Caleb Mortimer',
    tier: 'apprentice',
    skills: ['electrical'],
    licenses: [],
    work_days: ['Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    start_time: '07:30',
    end_time: '16:00',
  },
  {
    technician_id: 'T-09',
    name: 'Nadia Petrov',
    tier: 'lead',
    skills: ['heating', 'plumbing'],
    licenses: ['gas'],
    work_days: ['Mon', 'Tue', 'Wed', 'Thu'],
    start_time: '07:00',
    end_time: '17:30',
  },
  {
    technician_id: 'T-10',
    name: 'Hugo Lindqvist',
    tier: 'journeyman',
    skills: ['electrical'],
    licenses: ['master_electrician'],
    work_days: ['Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    start_time: '08:00',
    end_time: '16:30',
  },
  {
    technician_id: 'T-11',
    name: 'Ines Carvalho',
    tier: 'apprentice',
    skills: ['heating'],
    licenses: [],
    work_days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    start_time: '08:30',
    end_time: '17:00',
  },
  {
    technician_id: 'T-12',
    name: 'Wes Okafor',
    tier: 'journeyman',
    skills: ['plumbing'],
    licenses: ['gas'],
    work_days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    start_time: '07:00',
    end_time: '15:30',
  },
];

export const PARTS: readonly Part[] = [
  part('P-101', 'Faucet cartridge', 1235, 35),
  part('P-102', 'Kitchen faucet', 14850, 30),
  part('P-103', 'Braided supply line', 895, 45),
  part('P-104', 'Wax ring', 389, 50),
  part('P-105', 'Toilet fill valve', 1465, 40),
  part('P-106', 'Toilet flapper', 645, 50),
  part('P-107', '40 gallon gas water heater', 61875, 25),
  part('P-108', 'Expansion tank', 4875, 35),
  part('P-109', 'Gas flex connector', 2215, 40),
  part('P-110', 'Plumbing permit', 7500, 0, false),
  part('P-111', 'Haul-away and disposal', 4500, 0, false),
  part('P-112', 'Copper pipe per foot', 485, 40),
  part('P-113', 'Copper fitting', 315, 50),
  part('P-114', 'Quarter-turn shutoff valve', 1725, 40),
  part('P-115', 'Sump pump', 18990, 30),
  part('P-116', 'Check valve', 2645, 35),
  part('P-117', 'Backflow test filing', 3500, 0, false),
  part('P-118', 'Furnace filter', 1450, 50),
  part('P-119', 'Hot surface igniter', 3725, 40),
  part('P-120', 'Flame sensor', 1995, 45),
  part('P-121', 'Furnace control board', 21450, 30),
  part('P-122', 'Smart thermostat', 13999, 25),
  part('P-123', 'Pressure relief valve', 3185, 40),
  part('P-124', 'Run capacitor', 2450, 45),
  part('P-125', 'Contactor', 2975, 40),
  part('P-126', 'Refrigerant per pound', 2825, 35),
  part('P-127', 'Refrigerant recovery fee', 2500, 0, false),
  part('P-128', '20 amp breaker', 1145, 40),
  part('P-129', 'GFCI outlet', 1875, 40),
  part('P-130', 'Standard outlet', 365, 50),
  part('P-131', 'Wire connector pack', 495, 50),
  part('P-132', 'Electrical box', 645, 45),
  part('P-133', '200 amp panel', 32900, 30),
  part('P-134', 'Electrical permit', 9500, 0, false),
  part('P-135', '50 amp breaker', 3290, 40),
  part('P-136', '6/3 copper wire per foot', 415, 35),
  part('P-137', '50 amp outlet', 2185, 40),
  part('P-138', 'Garbage disposal', 11250, 30),
  part('P-139', 'Ceiling fan bracket', 1590, 40),
];

function part(
  part_id: string,
  name: string,
  unit_cost_cents: number,
  markup_pct: number,
  taxable = true,
): Part {
  return { part_id, name, unit_cost_cents, markup_pct, taxable };
}

interface PartUse {
  partId: string;
  /** Quantity range, both ends included. */
  qty: readonly [number, number];
  /** Chance the part is used on a job of this kind. */
  chance: number;
}

export interface WorkType {
  name: string;
  skill: Skill;
  license: License | null;
  /** Minutes on site, both ends included. */
  minutes: readonly [number, number];
  afterHoursChance: number;
  /** Relative frequency among jobs of the same skill. */
  weight: number;
  parts: readonly PartUse[];
}

export const WORK_TYPES: readonly WorkType[] = [
  work('Kitchen faucet replacement', 'plumbing', null, [55, 130], 0.02, 5, [
    use('P-102', 1, 1, 1),
    use('P-103', 2, 2, 0.7),
    use('P-114', 1, 2, 0.2),
  ]),
  work('Faucet repair', 'plumbing', null, [35, 90], 0.03, 5, [
    use('P-101', 1, 2, 0.9),
    use('P-103', 1, 2, 0.3),
  ]),
  work('Toilet repair', 'plumbing', null, [40, 100], 0.06, 6, [
    use('P-105', 1, 1, 0.5),
    use('P-106', 1, 1, 0.6),
    use('P-104', 1, 1, 0.3),
  ]),
  work('Water heater replacement', 'plumbing', 'gas', [150, 320], 0.06, 3, [
    use('P-107', 1, 1, 1),
    use('P-108', 1, 1, 0.6),
    use('P-109', 1, 1, 0.8),
    use('P-110', 1, 1, 0.9),
    use('P-111', 1, 1, 0.85),
  ]),
  work('Drain clearing', 'plumbing', null, [45, 150], 0.18, 6, [use('P-113', 1, 2, 0.1)]),
  work('Burst pipe repair', 'plumbing', null, [60, 240], 0.55, 2, [
    use('P-112', 2, 8, 1),
    use('P-113', 2, 6, 0.9),
    use('P-114', 1, 2, 0.4),
  ]),
  work('Backflow test', 'plumbing', 'backflow', [35, 75], 0, 2, [use('P-117', 1, 1, 1)]),
  work('Sump pump replacement', 'plumbing', null, [90, 200], 0.25, 2, [
    use('P-115', 1, 1, 1),
    use('P-116', 1, 1, 0.7),
  ]),
  work('Garbage disposal install', 'plumbing', null, [50, 120], 0.02, 3, [
    use('P-138', 1, 1, 1),
    use('P-103', 1, 2, 0.3),
    use('P-111', 1, 1, 0.3),
  ]),
  work('Shutoff valve replacement', 'plumbing', null, [50, 120], 0.1, 3, [
    use('P-114', 1, 3, 1),
    use('P-113', 1, 4, 0.5),
  ]),
  work('Furnace tune-up', 'heating', null, [50, 110], 0, 6, [
    use('P-118', 1, 2, 0.8),
    use('P-120', 1, 1, 0.15),
  ]),
  work('No heat call', 'heating', 'gas', [50, 180], 0.45, 5, [
    use('P-119', 1, 1, 0.5),
    use('P-120', 1, 1, 0.4),
    use('P-121', 1, 1, 0.12),
    use('P-118', 1, 1, 0.3),
  ]),
  work('Thermostat install', 'heating', null, [45, 110], 0.02, 3, [
    use('P-122', 1, 1, 1),
    use('P-131', 1, 1, 0.3),
  ]),
  work('Boiler service', 'heating', 'gas', [80, 200], 0.08, 2, [
    use('P-123', 1, 1, 0.4),
    use('P-108', 1, 1, 0.25),
  ]),
  work('Heat pump repair', 'heating', null, [60, 210], 0.2, 3, [
    use('P-124', 1, 1, 0.6),
    use('P-125', 1, 1, 0.4),
    use('P-126', 1, 4, 0.5),
    use('P-127', 1, 1, 0.3),
  ]),
  work('Breaker replacement', 'electrical', null, [40, 100], 0.15, 4, [use('P-128', 1, 2, 1)]),
  work('GFCI outlet install', 'electrical', null, [40, 120], 0.02, 4, [
    use('P-129', 1, 4, 1),
    use('P-132', 1, 2, 0.3),
  ]),
  work('Outlet repair', 'electrical', null, [35, 90], 0.08, 4, [
    use('P-130', 1, 3, 0.9),
    use('P-131', 1, 1, 0.4),
  ]),
  work('Light fixture install', 'electrical', null, [45, 150], 0.02, 3, [
    use('P-132', 1, 2, 0.6),
    use('P-131', 1, 1, 0.6),
  ]),
  work('Ceiling fan install', 'electrical', null, [60, 150], 0.01, 2, [
    use('P-139', 1, 1, 0.9),
    use('P-131', 1, 1, 0.5),
  ]),
  work('Panel upgrade', 'electrical', 'master_electrician', [300, 540], 0, 1, [
    use('P-133', 1, 1, 1),
    use('P-128', 4, 10, 0.9),
    use('P-134', 1, 1, 1),
    use('P-111', 1, 1, 0.6),
  ]),
  work('EV charger circuit', 'electrical', 'master_electrician', [150, 300], 0, 2, [
    use('P-135', 1, 1, 1),
    use('P-136', 20, 60, 1),
    use('P-137', 1, 1, 0.8),
    use('P-134', 1, 1, 0.9),
  ]),
];

function work(
  name: string,
  skill: Skill,
  license: License | null,
  minutes: readonly [number, number],
  afterHoursChance: number,
  weight: number,
  parts: readonly PartUse[],
): WorkType {
  return { name, skill, license, minutes, afterHoursChance, weight, parts };
}

function use(partId: string, minQty: number, maxQty: number, chance: number): PartUse {
  return { partId, qty: [minQty, maxQty], chance };
}

export const FIRST_NAMES = list(`
  Avery, Blake, Camila, Dorian, Elena, Felix, Greta, Harlan, Imogen, Jasper, Keira, Leon, Mabel,
  Nico, Odette, Pierce, Quinn, Rhea, Silas, Tamsin, Ulric, Vera, Wren, Xavier, Yara, Zane, Adele,
  Bram, Cora, Dexter, Elise, Flynn, Gemma, Hollis, Ingrid, Joel, Kenji, Lila, Marco, Nell, Orla,
  Petra, Rafael, Sienna, Tobias, Una, Vaughn, Willa, Yusuf, Zelda, Arlo, Bianca, Cyrus, Daphne,
  Emil, Freya, Gideon, Hazel, Idris, June
`);

export const LAST_NAMES = list(`
  Ashgrove, Barlowe, Calloway, Dunmore, Ellery, Fairbanks, Galloway, Hartwell, Ingram, Jessup,
  Kettering, Lockhart, Merriweather, Northcott, Okonkwo, Pemberton, Quarles, Ravenscroft, Stroud,
  Thackeray, Underhill, Valdivia, Whitlock, Yardley, Zabinski, Alcott, Brennan, Coyle, Delacroix,
  Esterhazy, Fenwick, Gallagher, Holloway, Iverson, Jankowski, Kowalczyk, Lindgren, Moreau,
  Nakashima, Oyelaran, Prescott, Quintero, Rasmussen, Sorensen, Tremblay, Ueda, Vasquez, Wexler,
  Ybarra, Zielinski, Bergstrom, Cardenas, Dalgaard, Ekwueme, Ferreira, Haverford, Ishikawa,
  Jovanovic, Kaplan, Lachance, Mbatha, Novak, Ostrowski, Pacheco, Rowntree, Szabo, Tolliver, Uribe,
  Varga, Winslow, Yilmaz, Zamora
`);

export const BUSINESS_PREFIXES = list(`
  Harborview, Old Mill, Cedar Row, Lakeshore, Ridgeline, Copperleaf, Bluegill, Granite Hill,
  Maple Court, Juniper, Tidewater, Foxglove, Larkspur, Ironwood, Briar Lane, Sandpiper, Northgate,
  Willow Bend, Thistle, Beacon, Pinecrest, Saltmarsh, Orchard Hill, Riverstone, Hollow Oak
`);

export const BUSINESS_KINDS = list(`
  Apartments, Bakery, Laundry, Cafe, Fitness Studio, Property Group, Diner, Hardware, Bookshop,
  Brewing Company, Motel, Florist, Auto Body, Yoga Studio, Barbershop, Pizza Kitchen, Condominiums,
  Marina, Garden Center, Print Shop
`);

function list(text: string): readonly string[] {
  return text.split(',').map((item) => item.trim());
}
