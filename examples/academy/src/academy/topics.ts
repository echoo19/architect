import type { Random } from '../lib/random';

/**
 * The twelve kinds of question every synthetic academy teaches, six of math and six of grammar
 * and usage. A kind knows how to write a question with full text, its answer and, for every wrong
 * choice, the constructed error that produced it. Academies name the kinds their own way; the
 * error names and hint texts are the same everywhere, and their ids are each academy's own.
 */

export type Section = 'Math' | 'Reading and Writing';

export interface ErrorKind {
  /** Stable across academies; each academy gives the error an id of its own. */
  code: string;
  name: string;
  /** The approved first hint written for a student whose choice came from this error. */
  hint: string;
}

export interface Item {
  kind: string;
  stem: string;
  /** Four choices, A to D. */
  choices: string[];
  /** Index of the right choice. */
  correct: number;
  /** For each choice, the codes of the constructed errors that give it (none for the right one). */
  errors: string[][];
  /** Math only: the answer and the key intermediate value. */
  answer?: number;
  step?: number;
}

export interface TopicKind {
  kind: string;
  section: Section;
  /** Ways academies name the topic. */
  names: readonly string[];
  /** The domain a topic sits in, for academies that label topics by domain. */
  domain: string;
  /** The approved first hint that fits any wrong choice. */
  generalHint: string;
  errors: readonly ErrorKind[];
  /** A question; `phrasing` picks one of the academy's ways of wording it. */
  make(random: Random, phrasing: number): Item;
}

/** A math kind: numbers drawn in the order the question text gives them. */
interface MathSpec {
  kind: string;
  names: readonly string[];
  domain: string;
  generalHint: string;
  /** What the key intermediate value is, for a request that asks for it. */
  stepLabel(numbers: readonly number[]): string;
  draw(random: Random): { numbers: number[]; words: string[] };
  stems: readonly ((numbers: readonly number[], words: readonly string[]) => string)[];
  answer(numbers: readonly number[]): number;
  step(numbers: readonly number[]): number;
  errors: readonly (ErrorKind & { value(numbers: readonly number[]): number | null })[];
  /** Recognizes this kind's question text. */
  pattern: RegExp;
}

const whole = (value: number): number | null => (Number.isInteger(value) ? value : null);

export const MATH_SPECS: readonly MathSpec[] = [
  {
    kind: 'linear',
    names: ['Linear Equations', 'Solving linear equations', 'One-variable equations'],
    domain: 'Algebra',
    generalHint: 'Undo the operations one at a time, doing the same thing to both sides.',
    stepLabel: ([a, b]) => `the value of ${a}x once the ${b} is moved to the other side`,
    draw: (r) => {
      const a = r.int(2, 9);
      const x = r.int(2, 15);
      const b = a * r.int(1, 6);
      return { numbers: [a, b, a * x + b], words: [] };
    },
    stems: [
      ([a, b, c]) => `If ${a}x + ${b} = ${c}, what is the value of x?`,
      ([a, b, c]) => `Solve ${a}x + ${b} = ${c} for x.`,
    ],
    answer: ([a, b, c]) => (c! - b!) / a!,
    step: ([, b, c]) => c! - b!,
    errors: [
      {
        code: 'linear-sign',
        name: 'Moved the constant with the wrong sign',
        hint: 'When a number crosses to the other side, check whether you add it or take it away.',
        value: ([a, b, c]) => whole((c! + b!) / a!),
      },
      {
        code: 'linear-no-divide',
        name: 'Stopped before dividing by the coefficient',
        hint: 'Once the x term is alone, is x itself alone yet?',
        value: ([, b, c]) => c! - b!,
      },
      {
        code: 'linear-divide-first',
        name: 'Divided only the first term',
        hint: 'Dividing both sides means dividing every term on each side.',
        value: ([a, b, c]) => whole(c! / a! - b!),
      },
      {
        code: 'linear-subtract-coefficient',
        name: 'Subtracted the coefficient instead of dividing',
        hint: 'The number in front of x multiplies it. Which operation undoes that?',
        value: ([a, b, c]) => c! - b! - a!,
      },
    ],
    pattern: /^(If|Solve) \d+x \+ \d+ = \d+/,
  },
  {
    kind: 'percent',
    names: ['Percent Change', 'Percents and discounts', 'Percentages'],
    domain: 'Problem solving',
    generalHint: 'Find the percent of the original amount first, then decide what to do with it.',
    stepLabel: () => 'the discount in dollars',
    draw: (r) => {
      const price = 20 * r.int(2, 20);
      const rate = r.pick([10, 15, 20, 25, 30, 35, 40]);
      return { numbers: [price, rate], words: [r.pick(['jacket', 'lamp', 'backpack', 'bike'])] };
    },
    stems: [
      ([p, rate], [item]) =>
        `A ${item} costs $${p}. It is on sale for ${rate}% off. What is the sale price, in dollars?`,
      ([p, rate], [item]) =>
        `The regular price of a ${item} is $${p}. During a sale the price is reduced by ${rate}%. What is the sale price of the ${item}, in dollars?`,
    ],
    answer: ([p, rate]) => p! - (p! * rate!) / 100,
    step: ([p, rate]) => (p! * rate!) / 100,
    errors: [
      {
        code: 'percent-discount-only',
        name: 'Gave the discount, not the price',
        hint: 'Read the last sentence again: is it asking for the amount saved or the amount paid?',
        value: ([p, rate]) => (p! * rate!) / 100,
      },
      {
        code: 'percent-added',
        name: 'Added the discount instead of subtracting it',
        hint: 'A sale makes the price go down. Does your answer?',
        value: ([p, rate]) => p! + (p! * rate!) / 100,
      },
      {
        code: 'percent-as-dollars',
        name: 'Took the percent off as dollars',
        hint: 'A percent is a part of the price, not a number of dollars.',
        value: ([p, rate]) => p! - rate!,
      },
      {
        code: 'percent-twice',
        name: 'Took the discount off twice',
        hint: 'Count how many times the price is reduced.',
        value: ([p, rate]) => p! - (2 * p! * rate!) / 100,
      },
    ],
    pattern: /costs \$\d+|regular price/,
  },
  {
    kind: 'system',
    names: ['Systems of Equations', 'Systems of linear equations', 'Two-equation systems'],
    domain: 'Algebra',
    generalHint: 'Combine the two equations so that one of the variables disappears.',
    stepLabel: () => 'the value of 2x after you add the two equations',
    draw: (r) => {
      const x = r.int(5, 20);
      const y = r.int(1, x - 1);
      return { numbers: [x + y, x - y], words: [] };
    },
    stems: [
      ([s, d]) => `If x + y = ${s} and x - y = ${d}, what is the value of x?`,
      ([s, d]) => `In the system x + y = ${s} and x - y = ${d}, what is the value of x?`,
    ],
    answer: ([s, d]) => (s! + d!) / 2,
    step: ([s, d]) => s! + d!,
    errors: [
      {
        code: 'system-other-variable',
        name: 'Solved for the other variable',
        hint: 'Check which variable the question asks for.',
        value: ([s, d]) => (s! - d!) / 2,
      },
      {
        code: 'system-no-halve',
        name: 'Forgot to halve after adding',
        hint: 'After adding the equations, how many x are there?',
        value: ([s, d]) => s! + d!,
      },
      {
        code: 'system-subtracted',
        name: 'Subtracted the equations and stopped',
        hint: 'Which way of combining the equations leaves only x?',
        value: ([s, d]) => s! - d!,
      },
      {
        code: 'system-sum-as-x',
        name: 'Took the sum as the value of x',
        hint: 'The first equation gives x and y together, not x by itself.',
        value: ([s]) => s!,
      },
    ],
    pattern: /x \+ y = \d+ and x - y = \d+/,
  },
  {
    kind: 'ratio',
    names: ['Ratios and Proportions', 'Ratios', 'Part-to-part ratios'],
    domain: 'Problem solving',
    generalHint: 'Add the parts of the ratio to see how many equal shares make the whole.',
    stepLabel: () => 'the size of one share of the ratio',
    draw: (r) => {
      const a = r.int(1, 7);
      let b = r.int(1, 7);
      while (b === a) b = r.int(1, 7);
      const part = r.int(3, 15);
      const [one, two] = r.pick([
        ['juniors', 'seniors'],
        ['red marbles', 'blue marbles'],
        ['fiction books', 'nonfiction books'],
        ['cats', 'dogs'],
      ]) as [string, string];
      return { numbers: [a, b, part * (a + b)], words: [one, two] };
    },
    stems: [
      ([a, b, n], [one, two]) =>
        `The ratio of ${one} to ${two} in a group is ${a} to ${b}. There are ${n} in all. How many are ${two}?`,
      ([a, b, n], [one, two]) =>
        `A collection has ${one} and ${two} in the ratio ${a}:${b}, ${n} items in total. How many ${two} are there?`,
    ],
    answer: ([a, b, n]) => (n! * b!) / (a! + b!),
    step: ([a, b, n]) => n! / (a! + b!),
    errors: [
      {
        code: 'ratio-other-group',
        name: 'Found the other group',
        hint: 'Match each number in the ratio to the group it describes.',
        value: ([a, b, n]) => (n! * a!) / (a! + b!),
      },
      {
        code: 'ratio-one-share',
        name: 'Stopped at one share',
        hint: 'You found one share. How many shares belong to the group asked about?',
        value: ([a, b, n]) => n! / (a! + b!),
      },
      {
        code: 'ratio-scaled-total',
        name: 'Multiplied the total by the ratio',
        hint: 'The total is already the whole group. Should it get bigger?',
        value: ([, b, n]) => n! * b!,
      },
      {
        code: 'ratio-divided-by-part',
        name: 'Divided the total by one number of the ratio',
        hint: 'A share comes from dividing by all the parts together.',
        value: ([, b, n]) => whole(n! / b!),
      },
    ],
    pattern: /ratio/,
  },
  {
    kind: 'function',
    names: ['Linear Functions', 'Evaluating functions', 'Function notation'],
    domain: 'Algebra',
    generalHint: 'Put the input in place of x, then follow the order of operations.',
    stepLabel: ([m, , k]) => `the value of ${m} times ${k}`,
    draw: (r) => {
      const m = r.int(2, 9);
      const b = r.int(1, 12);
      const k = r.int(2, 9);
      return { numbers: [m, b, k], words: [] };
    },
    stems: [
      ([m, b, k]) => `If f(x) = ${m}x + ${b}, what is the value of f(${k})?`,
      ([m, b, k]) => `The function f is defined by f(x) = ${m}x + ${b}. What is f(${k})?`,
    ],
    answer: ([m, b, k]) => m! * k! + b!,
    step: ([m, , k]) => m! * k!,
    errors: [
      {
        code: 'function-no-constant',
        name: 'Left out the constant',
        hint: 'Check that every term of the function made it into your work.',
        value: ([m, , k]) => m! * k!,
      },
      {
        code: 'function-added-first',
        name: 'Added before multiplying',
        hint: 'Which comes first, the multiplication or the addition?',
        value: ([m, b, k]) => m! * (k! + b!),
      },
      {
        code: 'function-swapped',
        name: 'Swapped the slope and the constant',
        hint: 'Which number multiplies x, and which is added on?',
        value: ([m, b, k]) => b! * k! + m!,
      },
      {
        code: 'function-added-input',
        name: 'Added the input instead of multiplying',
        hint: 'A number written next to x multiplies it.',
        value: ([m, b, k]) => m! + k! + b!,
      },
    ],
    pattern: /f\(x\) = \d+x \+ \d+/,
  },
  {
    kind: 'rectangle',
    names: ['Area and Perimeter', 'Rectangles', 'Perimeter and area of rectangles'],
    domain: 'Geometry',
    generalHint: 'Use the perimeter to find the missing side before you find the area.',
    stepLabel: () => 'the width of the rectangle',
    draw: (r) => {
      const length = r.int(4, 20);
      const width = r.int(2, length - 1);
      return { numbers: [2 * (length + width), length], words: [] };
    },
    stems: [
      ([p, l]) =>
        `A rectangle has a perimeter of ${p} and a length of ${l}. What is the area of the rectangle?`,
      ([p, l]) =>
        `The perimeter of a rectangular garden is ${p} meters and its length is ${l} meters. What is its area, in square meters?`,
    ],
    answer: ([p, l]) => l! * (p! / 2 - l!),
    step: ([p, l]) => p! / 2 - l!,
    errors: [
      {
        code: 'rectangle-width-only',
        name: 'Stopped at the width',
        hint: 'You have both sides now. What does the question ask for?',
        value: ([p, l]) => p! / 2 - l!,
      },
      {
        code: 'rectangle-no-halve',
        name: 'Forgot to halve the perimeter',
        hint: 'The perimeter goes around all four sides. How many lengths does it hold?',
        value: ([p, l]) => l! * (p! - l!),
      },
      {
        code: 'rectangle-added',
        name: 'Added the sides instead of multiplying',
        hint: 'Area counts the squares inside. Which operation does that?',
        value: ([p]) => p! / 2,
      },
      {
        code: 'rectangle-perimeter-side',
        name: 'Used the perimeter as a side',
        hint: 'The perimeter is a distance around, not one side.',
        value: ([p, l]) => p! * l!,
      },
    ],
    pattern: /perimeter/,
  },
];

function mathKind(spec: MathSpec): TopicKind {
  return {
    kind: spec.kind,
    section: 'Math',
    names: spec.names,
    domain: spec.domain,
    generalHint: spec.generalHint,
    errors: spec.errors,
    make(random, phrasing) {
      for (;;) {
        const { numbers, words } = spec.draw(random);
        const answer = spec.answer(numbers);
        const groups = new Map<number, string[]>();
        for (const error of spec.errors) {
          const value = error.value(numbers);
          if (value === null || value === answer || value <= 0) continue;
          groups.set(value, [...(groups.get(value) ?? []), error.code]);
        }
        if (groups.size < 3 || !Number.isInteger(answer)) continue;
        const wrong = random.sample([...groups.entries()], 3);
        const choices = random.shuffle([
          { value: answer, errors: [] as string[] },
          ...wrong.map(([value, errors]) => ({ value, errors })),
        ]);
        const stem = spec.stems[phrasing % spec.stems.length]!;
        return {
          kind: spec.kind,
          stem: stem(numbers, words),
          choices: choices.map((choice) => String(choice.value)),
          correct: choices.findIndex((choice) => choice.errors.length === 0),
          errors: choices.map((choice) => choice.errors),
          answer,
          step: spec.step(numbers),
        };
      }
    },
  };
}

/** A grammar kind writes an item from slots: the right phrase and each error's phrase. */
function grammarKind(
  kind: Omit<TopicKind, 'make' | 'section'>,
  write: (
    random: Random,
    phrasing: number,
  ) => { stem: string; right: string; wrong: [string, string][] },
): TopicKind {
  return {
    ...kind,
    section: 'Reading and Writing',
    make(random, phrasing) {
      const { stem, right, wrong } = write(random, phrasing);
      const choices = random.shuffle([
        { text: right, errors: [] as string[] },
        ...wrong.map(([code, text]) => ({ text, errors: [code] })),
      ]);
      return {
        kind: kind.kind,
        stem,
        choices: choices.map((choice) => choice.text),
        correct: choices.findIndex((choice) => choice.errors.length === 0),
        errors: choices.map((choice) => choice.errors),
      };
    },
  };
}

const AGREEMENT_VERBS = [
  ['is', 'are', 'was', 'being', 'on the front desk'],
  ['needs', 'need', 'needed', 'needing', 'a new label'],
  ['has', 'have', 'had', 'having', 'a torn cover'],
  ['sits', 'sit', 'sat', 'sitting', 'near the window'],
  ['stays', 'stay', 'stayed', 'staying', 'in the main office'],
] as const;

const TENSE_VERBS = [
  ['win', 'wins', 'won', 'won', 'its first regional prize'],
  ['build', 'builds', 'built', 'built', 'a new stage'],
  ['write', 'writes', 'wrote', 'written', 'a short history of the town'],
  ['choose', 'chooses', 'chose', 'chosen', 'a new name'],
  ['begin', 'begins', 'began', 'begun', 'a weekly podcast'],
  ['draw', 'draws', 'drew', 'drawn', 'a record crowd'],
  ['break', 'breaks', 'broke', 'broken', 'the old record'],
] as const;

const TOWNS = ['Ashby', 'Corran', 'Delford', 'Elmont', 'Fenwick', 'Harlow', 'Kessington', 'Marlow'];

const BOUNDARY_CLAUSES = [
  ['The rain finally', 'stopped', 'the', 'crowd returned to the field.'],
  ['The museum', 'reopened', 'its', 'new wing drew long lines.'],
  ['Our team', 'practiced', 'every', 'drill took twice as long as planned.'],
  ['The power', 'failed', 'most', 'students kept reading by window light.'],
  ['The ferry', 'arrived', 'the', 'passengers hurried down the ramp.'],
  ['The bakery', 'closed', 'its', 'owners moved to the coast.'],
  ['The snow', 'melted', 'the', 'river rose by noon.'],
  ['The bell', 'rang', 'every', 'hallway filled at once.'],
  ['The play', 'ended', 'the', 'audience stood and cheered.'],
  ['The storm', 'passed', 'its', 'damage was worse than expected.'],
  ['The shop', 'expanded', 'its', 'second floor now sells books.'],
  ['The bus', 'broke down', 'most', 'riders walked the last mile.'],
  ['The garden', 'flooded', 'the', 'tomatoes did not survive.'],
  ['The lights', 'flickered', 'the', 'speaker kept going anyway.'],
  ['The class', 'voted', 'the', 'trip will be to the science center.'],
  ['The river', 'froze', 'every', 'skater in town came out.'],
  ['The printer', 'jammed', 'the', 'flyers were late for the fair.'],
  ['The market', 'opened', 'its', 'stalls sold out by ten.'],
] as const;

const TRANSITIONS = {
  contrast: 'However',
  result: 'Therefore',
  example: 'For example',
  addition: 'In addition',
} as const;
type Relation = keyof typeof TRANSITIONS;

const TRANSITION_PAIRS: readonly [Relation, string, string][] = [
  ['contrast', 'The trail looked short on the map.', 'it took us four hours to finish.'],
  ['contrast', 'The first draft ran to ten pages.', 'the final essay fit on one.'],
  ['contrast', 'The forecast promised sun.', 'we spent the afternoon under umbrellas.'],
  ['contrast', 'The recipe called for an hour of baking.', 'the bread was done in forty minutes.'],
  ['contrast', 'Most critics praised the film.', 'it sold few tickets.'],
  ['result', 'The bridge was closed for repairs.', 'the bus took the long road around the lake.'],
  ['result', 'The library extended its hours.', 'more students studied there in the evening.'],
  ['result', 'The orchestra lost its conductor.', 'the spring concert was postponed.'],
  ['result', 'The well ran dry in August.', 'the farm bought water by the truckload.'],
  ['result', 'The tickets sold out in a day.', 'the theater added a second show.'],
  ['example', 'Many desert plants store water.', 'the barrel cactus can go months without rain.'],
  ['example', 'The museum offers free programs.', 'it hosts a drawing class every Saturday.'],
  ['example', 'Some birds use tools.', 'crows bend wire into hooks to reach food.'],
  ['example', 'The town keeps old traditions.', 'it still rings the noon bell by hand.'],
  ['example', 'Several streets were renamed.', 'Mill Road is now Founders Way.'],
  ['addition', 'The new park has a large playground.', 'it includes a quiet reading garden.'],
  ['addition', 'The coach planned extra practices.', 'she arranged two games with nearby schools.'],
  ['addition', 'The town repaved Main Street.', 'it planted trees along both sidewalks.'],
  [
    'addition',
    'The club raised money for the shelter.',
    'its members spent weekends walking dogs.',
  ],
  ['addition', 'The new bus line runs every ten minutes.', 'it stops at both high schools.'],
  ['contrast', 'The puzzle looked easy at first.', 'nobody in the class could solve it.'],
  ['contrast', 'The old bridge seemed fragile.', 'it carried trucks for ninety years.'],
  ['result', 'The roads iced over before dawn.', 'the schools opened two hours late.'],
  ['result', 'The bakery doubled its prices.', 'many regulars started baking at home.'],
  ['example', 'Some metals resist rust.', 'stainless steel stays bright for decades.'],
  ['example', 'Our library lends more than books.', 'members can borrow telescopes and tools.'],
  ['addition', 'The museum added evening hours.', 'it opened a cafe on the roof.'],
  ['addition', 'The team won the regional final.', 'its captain was named player of the year.'],
];

export const GRAMMAR_KINDS: readonly TopicKind[] = [
  grammarKind(
    {
      kind: 'agreement',
      names: ['Subject-Verb Agreement', 'Agreement', 'Subjects and verbs'],
      domain: 'Grammar',
      generalHint:
        'Cross out the phrase between the subject and the verb, then read them together.',
      errors: [
        {
          code: 'agreement-nearer-noun',
          name: 'Made the verb agree with the nearer noun',
          hint: 'The noun right before the blank may not be the subject. Which noun is doing the action?',
        },
        {
          code: 'agreement-tense-shift',
          name: 'Shifted the tense',
          hint: 'Look at the time words at the start of the sentence.',
        },
        {
          code: 'agreement-no-main-verb',
          name: 'Left the sentence without a main verb',
          hint: 'Read the sentence with your choice. Is it a complete sentence?',
        },
      ],
    },
    (r, phrasing) => {
      const [singular, plural, past, ing, rest] = r.pick(AGREEMENT_VERBS);
      const head = r.pick(['list', 'box', 'collection', 'stack', 'basket', 'folder']);
      const noun = r.pick(['supplies', 'old letters', 'photos', 'receipts', 'maps', 'notes']);
      const open = phrasing % 2 === 0 ? 'Right now, the' : 'Today the';
      return {
        stem: `${open} ${head} of ${noun} ___ ${rest}.`,
        right: singular,
        wrong: [
          ['agreement-nearer-noun', plural],
          ['agreement-tense-shift', past],
          ['agreement-no-main-verb', ing],
        ],
      };
    },
  ),
  grammarKind(
    {
      kind: 'pronoun',
      names: ['Pronoun Agreement', 'Pronouns', 'Pronoun-antecedent agreement'],
      domain: 'Grammar',
      generalHint: 'Find the noun the pronoun stands for and ask whether it is one thing or many.',
      errors: [
        {
          code: 'pronoun-plural',
          name: 'Used a plural pronoun for a singular group',
          hint: 'A group acting together counts as one thing.',
        },
        {
          code: 'pronoun-contraction',
          name: 'Used a contraction where a possessive belongs',
          hint: 'Read the apostrophe out as two words. Does the sentence still make sense?',
        },
        {
          code: 'pronoun-person',
          name: 'Used a pronoun for a person to stand for a thing',
          hint: 'Is the noun a person, or a thing?',
        },
      ],
    },
    (r, phrasing) => {
      const group = r.pick(['committee', 'team', 'band', 'jury', 'company', 'club', 'council']);
      const action = r.pick([
        'announced ___ decision',
        'posted ___ schedule for the spring',
        'changed ___ rules for new members',
        'moved ___ office across town',
        'celebrated ___ tenth anniversary',
      ]);
      const stem =
        phrasing % 2 === 0
          ? `After a long meeting, the ${group} ${action}.`
          : `Last week the ${group} ${action}.`;
      return {
        stem,
        right: 'its',
        wrong: [
          ['pronoun-plural', 'their'],
          ['pronoun-contraction', "it's"],
          ['pronoun-person', 'his or her'],
        ],
      };
    },
  ),
  grammarKind(
    {
      kind: 'comparison',
      names: ['Parallel Comparisons', 'Comparisons', 'Logical comparisons'],
      domain: 'Grammar',
      generalHint: 'Check that the sentence compares the same kind of thing on both sides.',
      errors: [
        {
          code: 'comparison-illogical',
          name: 'Compared a thing with a place',
          hint: 'What exactly is being compared on the left side of than?',
        },
        {
          code: 'comparison-number',
          name: 'Did not match one thing or many',
          hint: 'Is the thing being compared one thing or several?',
        },
        {
          code: 'comparison-double-possessive',
          name: 'Doubled the possessive',
          hint: 'Of already shows belonging. Does the name need more?',
        },
      ],
    },
    (r, phrasing) => {
      const [attribute, pronoun] = r.pick([
        ['population', 'that'],
        ['climate', 'that'],
        ['rainfall', 'that'],
        ['museums', 'those'],
        ['parks', 'those'],
        ['streets', 'those'],
      ] as const);
      const [a, b] = r.sample(TOWNS, 2) as [string, string];
      const other = pronoun === 'that' ? 'those' : 'that';
      const verb = pronoun === 'that' ? 'is' : 'are';
      const stem =
        phrasing % 2 === 0
          ? `Visitors often say that the ${attribute} of ${a} ${verb} more interesting than ___.`
          : `According to the guidebook, the ${attribute} of ${a} ${verb} more varied than ___.`;
      return {
        stem,
        right: `${pronoun} of ${b}`,
        wrong: [
          ['comparison-illogical', b],
          ['comparison-number', `${other} of ${b}`],
          ['comparison-double-possessive', `${pronoun} of ${b}'s`],
        ],
      };
    },
  ),
  grammarKind(
    {
      kind: 'tense',
      names: ['Verb Tense', 'Tense consistency', 'Verb tenses'],
      domain: 'Grammar',
      generalHint: 'Find the words that say when the action happened.',
      errors: [
        {
          code: 'tense-present',
          name: 'Used the present for a past event',
          hint: 'Is the action happening now, or did it already happen?',
        },
        {
          code: 'tense-perfect',
          name: 'Used the present perfect with a finished time',
          hint: 'A specific year in the past calls for a simple form of the verb.',
        },
        {
          code: 'tense-future',
          name: 'Used the future for a past event',
          hint: 'Check the date in the sentence against today.',
        },
      ],
    },
    (r, phrasing) => {
      const [base, present, past, perfect, rest] = r.pick(TENSE_VERBS);
      const group = r.pick(['the school band', 'the robotics team', 'the drama club', 'the town']);
      const year = r.int(1995, 2019);
      const stem =
        phrasing % 2 === 0
          ? `In ${year}, ${group} ___ ${rest}.`
          : `Back in ${year}, ${group} ___ ${rest}.`;
      return {
        stem,
        right: past,
        wrong: [
          ['tense-present', present],
          ['tense-perfect', `has ${perfect}`],
          ['tense-future', `will ${base}`],
        ],
      };
    },
  ),
  grammarKind(
    {
      kind: 'boundary',
      names: ['Sentence Boundaries', 'Run-ons and comma splices', 'Joining clauses'],
      domain: 'Punctuation',
      generalHint: 'Check whether each side of the blank could stand alone as a sentence.',
      errors: [
        {
          code: 'boundary-comma-splice',
          name: 'Joined two sentences with only a comma',
          hint: 'A comma alone is not strong enough to join two complete sentences.',
        },
        {
          code: 'boundary-fused',
          name: 'Ran two sentences together with no punctuation',
          hint: 'Read the sentence aloud. Where would you pause?',
        },
        {
          code: 'boundary-semicolon-conjunction',
          name: 'Used a semicolon and a conjunction together',
          hint: 'A semicolon already joins the sentences. Does it need help?',
        },
      ],
    },
    (r) => {
      const [start, verb, next, rest] = r.pick(BOUNDARY_CLAUSES);
      const when = r.pick(['', 'By evening, ', 'Late that week, ']);
      const opening =
        when === '' ? start : `${when}${start.charAt(0).toLowerCase()}${start.slice(1)}`;
      return {
        stem: `${opening} ___ ${rest}`,
        right: `${verb}; ${next}`,
        wrong: [
          ['boundary-comma-splice', `${verb}, ${next}`],
          ['boundary-fused', `${verb} ${next}`],
          ['boundary-semicolon-conjunction', `${verb}; and ${next}`],
        ],
      };
    },
  ),
  grammarKind(
    {
      kind: 'transition',
      names: ['Transitions', 'Transition words', 'Logical transitions'],
      domain: 'Expression of ideas',
      generalHint:
        'Decide how the second sentence relates to the first before reading the choices.',
      errors: [
        {
          code: 'transition-contrast',
          name: 'Chose a contrast transition',
          hint: 'Does the second sentence go against the first?',
        },
        {
          code: 'transition-result',
          name: 'Chose a cause-and-effect transition',
          hint: 'Is the second sentence caused by the first?',
        },
        {
          code: 'transition-example',
          name: 'Chose an example transition',
          hint: 'Is the second sentence one case of the first?',
        },
        {
          code: 'transition-addition',
          name: 'Chose an adding-on transition',
          hint: 'Does the second sentence simply add another point?',
        },
      ],
    },
    (r) => {
      const [relation, first, second] = r.pick(TRANSITION_PAIRS);
      const others = (Object.keys(TRANSITIONS) as Relation[]).filter((key) => key !== relation);
      return {
        stem: `${first} ___, ${second}`,
        right: TRANSITIONS[relation],
        wrong: others.map((key): [string, string] => [`transition-${key}`, TRANSITIONS[key]]),
      };
    },
  ),
];

export const MATH_KINDS: readonly TopicKind[] = MATH_SPECS.map(mathKind);

/** Every kind, math first, in a fixed order. */
export const TOPIC_KINDS: readonly TopicKind[] = [...MATH_KINDS, ...GRAMMAR_KINDS];

export function kindOf(kind: string): TopicKind {
  const found = TOPIC_KINDS.find((topic) => topic.kind === kind);
  if (!found) throw new Error(`No topic kind ${kind}`);
  return found;
}

export function mathSpecOf(kind: string): MathSpec {
  const found = MATH_SPECS.find((spec) => spec.kind === kind);
  if (!found) throw new Error(`No math kind ${kind}`);
  return found;
}

/** A new math question for a `solve` request, with its words for the key intermediate value. */
export function makeSolveItem(
  random: Random,
  kind: string,
  phrasing: number,
): Item & { stepLabel: string } {
  const item = kindOf(kind).make(random, phrasing);
  return { ...item, stepLabel: mathSpecOf(kind).stepLabel(numbersIn(item.stem)) };
}

/** The numbers of a math question, in the order its text gives them. */
export function numbersIn(stem: string): number[] {
  return (stem.match(/\d+/g) ?? []).map(Number);
}
