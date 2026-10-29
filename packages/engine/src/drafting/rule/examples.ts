import { RULE_LIMITS, type RuleExample, type RuleNode, type RuleSpec } from '@architect/shared';
import type { RuleCase } from './cases';
import { inputsOf } from './cases';
import {
  answerTakingOtherSide,
  answerWithout,
  categoryRefs,
  evaluate,
  nodesOf,
  numberRefs,
  reached,
  refKey,
  type ColumnRef,
  type Run,
} from './expression';
import type { RuleOutcome } from './outcome';
import * as q from './rational';
import { money, nameOf, numberText, phrase, sideLabel, stepsOf, type WordsContext } from './words';

/*
 * The examples a person confirms a rule by. Three, chosen on purpose: between them they take every
 * side of every condition, and one sits at a rounding edge. They come from the practice and
 * starting tasks only, never the check tasks or the final test. Where the records have nothing
 * near a rounding edge, Architect makes up numbers to show one and says so.
 */

/** Examples shown when three are enough, and the most that covering every branch may need. */
const WANTED = 3;
const MOST = RULE_LIMITS.maxExamples - 1;

/** What starts the name of a thing a case shows that is not a side of a condition. */
const ZERO = 'zero|';

type RoundNode = Extract<RuleNode, { op: 'round' }>;

/** The rounding edge of a step in a case: whether it changed the value, and how near an edge. */
interface Edge {
  changed: boolean;
  /** How far the value was from where the rounding flips; 0 when it sat on it. */
  distance: q.Q;
}

function edgeOf(run: Run): Edge | null {
  const { node, before } = run;
  if (node.op !== 'round' || before === undefined) return null;
  const step = q.fromText(node.increment);
  if (step === null) return null;
  const changed = !q.equal(before, run.value);
  if (q.isMultiple(before, step)) return { changed, distance: q.ZERO };
  // Where the rounding flips: at a multiple for up and down (a value a hair over one goes up a
  // whole step, a hair under the next goes down a whole step), and halfway for the nearest.
  const past = q.pastStep(before, step);
  const distance =
    node.mode === 'half_up'
      ? q.abs(q.sub(past, q.div(step, q.fraction(2n))))
      : node.mode === 'up'
        ? past
        : q.sub(step, past);
  return { changed, distance };
}

/** The decimal places an answer is written with: those of the last rounding step. */
function placesOfAnswer(spec: RuleSpec): number {
  const last = spec.expression.op === 'round' ? q.fromText(spec.expression.increment) : null;
  return last === null ? 2 : q.placesOf(last);
}

/** The answer as it is shown: with its decimal places, and its currency sign when it is money. */
export function answerShown(spec: RuleSpec, answer: q.Q): string {
  const places = placesOfAnswer(spec);
  const [whole = '0', fraction = ''] = q.toText(answer, places).text.split('.');
  return money(places > 0 ? `${whole}.${fraction.padEnd(places, '0')}` : whole, spec.currency);
}

function describedInput(
  ref: ColumnRef,
  item: RuleCase,
  words: WordsContext,
): { label: string; value: string } {
  // An empty cell has nothing to show but what the person said it counts as.
  if (item.zeroed.has(refKey(ref))) {
    return { label: nameOf(ref, words), value: 'empty (counted as 0)' };
  }
  const raw = item.cells.get(refKey(ref)) ?? '';
  const number = item.numbers.get(refKey(ref));
  const read = number === undefined ? null : numberText(number);
  return {
    label: nameOf(ref, words),
    value: read !== null && read !== raw ? `${raw} (read as ${read})` : raw,
  };
}

function exampleOf(
  outcome: RuleOutcome,
  item: RuleCase,
  covers: string[],
  made?: { request: string },
  taskId?: string,
): RuleExample {
  const { spec, words } = outcome;
  const refs = [...numberRefs(spec.expression), ...categoryRefs(spec.expression)];
  return {
    ...(taskId === undefined ? {} : { taskId }),
    request: made?.request ?? outcome.requestOf(item.key),
    inputs: refs.map((ref) => describedInput(ref, item, words)),
    steps: stepsOf(item.run, words),
    answer: answerShown(spec, item.answer),
    covers,
    ...(made === undefined ? {} : { madeUp: true }),
  };
}

/**
 * What a case takes of each condition, smaller or larger, and the order of nodes for naming. A
 * case shows a side only if the answer would be different on the other one, after the rounding.
 */
function coverage(item: RuleCase, ids: ReadonlyMap<RuleNode, number>, root: RuleNode): Set<string> {
  // An empty cell that counted as zero is something a case shows, since the person decided it.
  const covered = new Set<string>([...item.zeroed].map((key) => `${ZERO}${key}`));
  reached(item.run, (run) => {
    const id = ids.get(run.node);
    if (id === undefined) return;
    if (run.node.op === 'if' && run.choice) {
      const other = answerTakingOtherSide(root, item.inputs, run.node, run.choice.held);
      if (!q.equal(other, item.answer))
        covered.add(`${id}:${run.choice.held ? 'first' : 'second'}`);
    } else if ((run.node.op === 'min' || run.node.op === 'max') && run.winner?.alone) {
      const without = answerWithout(root, item.inputs, run.node, run.winner.index);
      if (!q.equal(without, item.answer)) covered.add(`${id}:${run.winner.index}`);
    }
  });
  return covered;
}

/** The edge of each rounding step a case went through, by node. */
function edgesOf(item: RuleCase): Map<RuleNode, Edge> {
  const edges = new Map<RuleNode, Edge>();
  reached(item.run, (run) => {
    const edge = edgeOf(run);
    if (edge !== null) edges.set(run.node, edge);
  });
  return edges;
}

const better = (a: Edge, b: Edge | undefined): boolean =>
  b === undefined || (a.changed !== b.changed ? a.changed : q.compare(a.distance, b.distance) < 0);

/**
 * Numbers that put one rounding step at an edge when no record does: the base case with one of
 * the inputs of that step moved to the value that sits nearest the edge and still gets rounded.
 */
function illustrate(
  outcome: RuleOutcome,
  base: RuleCase,
  node: RoundNode,
): { item: RuleCase; request: string } | null {
  const { spec, words } = outcome;
  const step = q.fromText(node.increment);
  if (step === null) return null;
  let best: { item: RuleCase; edge: Edge; ref: ColumnRef; value: q.Q } | null = null;
  for (const ref of numberRefs(node.arg)) {
    const start = base.numbers.get(refKey(ref));
    if (start === undefined) continue;
    // The input moved is a number now, even where the case had it empty.
    const zeroed = new Set(base.zeroed);
    zeroed.delete(refKey(ref));
    const at = (value: q.Q): Run => {
      const numbers = new Map(base.numbers);
      numbers.set(refKey(ref), value);
      return evaluate(node, inputsOf(numbers, base.categories, zeroed));
    };
    // How far the step's value moves when this input moves by one step: the input's scale.
    const slope = q.div(
      q.sub(at(q.add(start, step)).before ?? q.ZERO, at(start).before ?? q.ZERO),
      step,
    );
    if (q.isZero(slope)) continue;
    const grain = q.div(q.div(step, q.abs(slope)), q.fraction(10n));
    for (let offset = -9; offset <= 9; offset += 1) {
      const value = q.add(start, q.mul(grain, q.fraction(BigInt(offset))));
      if (q.isNegative(value) || q.isZero(value)) continue;
      const edge = edgeOf(at(value));
      if (edge !== null && edge.changed && better(edge, best?.edge)) {
        const numbers = new Map(base.numbers);
        numbers.set(refKey(ref), value);
        const cells = new Map(base.cells);
        cells.set(refKey(ref), numberText(value));
        const run = evaluate(spec.expression, inputsOf(numbers, base.categories, zeroed));
        best = {
          item: { ...base, numbers, cells, zeroed, run, answer: run.value },
          edge,
          ref,
          value,
        };
      }
    }
  }
  if (best === null) return null;
  return {
    item: best.item,
    request: `Like ${base.key}, but with ${nameOf(best.ref, words)} ${numberText(best.value)}`,
  };
}

/**
 * Chooses the examples of a rule from the cases that are practice or starting tasks, given in the
 * order they should be preferred. `taskIds` names the task each case is.
 */
export function chooseExamples(
  outcome: RuleOutcome,
  visible: readonly RuleCase[],
  taskIds: ReadonlyMap<string, string>,
): { examples: RuleExample[]; uncovered: string[] } {
  const { spec, words } = outcome;
  const nodes = nodesOf(spec.expression);
  const ids = new Map(nodes.map((node, at) => [node, at] as const));
  // A rounding written twice, once on each side of a condition, is one rounding to show.
  const rounding = new Map<string, RoundNode[]>();
  for (const node of nodes) {
    if (node.op !== 'round') continue;
    const signature = JSON.stringify([node.arg, node.increment, node.mode]);
    rounding.set(signature, [...(rounding.get(signature) ?? []), node]);
  }

  // Every side that could be shown, and which visible cases show it.
  const showing = new Map(
    visible.map((item) => [item, coverage(item, ids, spec.expression)] as const),
  );
  const sides = [...showing.values()].flatMap((covered) => [...covered]);
  const wanted = [...new Set(sides)].sort();
  const uncovered: string[] = [];
  const unseen = outcome.details.branches
    .map((branch) => branch.label)
    .filter((label) => !visible.some((item) => coverageLabels(item, ids, outcome).includes(label)));
  for (const label of unseen) uncovered.push(`No practice task shows ${label}.`);
  for (const ref of spec.emptyMeansZero ?? []) {
    const used = outcome.cases.some((item) => item.zeroed.has(refKey(ref)));
    if (used && !visible.some((item) => item.zeroed.has(refKey(ref)))) {
      uncovered.push(
        `No practice task has an empty ${nameOf(ref, words)}, so none shows it counted as 0.`,
      );
    }
  }

  // The best case for each rounding step that any visible case rounds.
  const edges = new Map(visible.map((item) => [item, edgesOf(item)] as const));
  const edgeIn = (item: RuleCase, group: readonly RoundNode[]): Edge | undefined =>
    group.map((node) => edges.get(item)?.get(node)).find((edge) => edge !== undefined);
  const edgeCase = new Map<string, RuleCase>();
  for (const [signature, group] of rounding) {
    let best: { item: RuleCase; edge: Edge } | undefined;
    for (const item of visible) {
      const edge = edgeIn(item, group);
      if (edge?.changed && better(edge, best?.edge)) best = { item, edge };
    }
    if (best) edgeCase.set(signature, best.item);
  }
  const whatRounds = (group: readonly RoundNode[]): string => {
    const first = group[0];
    return first === undefined || first === spec.expression
      ? 'the result'
      : phrase(first.arg, words).text;
  };

  const picked: { item: RuleCase; covers: string[] }[] = [];
  const left = new Set(wanted);
  const edgesLeft = new Set(edgeCase.keys());
  while ((left.size > 0 || edgesLeft.size > 0) && picked.length < MOST) {
    let best: { item: RuleCase; score: number } | null = null;
    for (const item of visible) {
      if (picked.some((entry) => entry.item === item)) continue;
      const covered = showing.get(item) ?? new Set<string>();
      const score =
        [...covered].filter((id) => left.has(id)).length +
        [...edgesLeft].filter((signature) => edgeCase.get(signature) === item).length;
      if (score > (best?.score ?? 0)) best = { item, score };
    }
    if (best === null) break;
    const covers: string[] = [];
    for (const id of showing.get(best.item) ?? []) {
      if (!left.delete(id)) continue;
      if (id.startsWith(ZERO)) {
        covers.push(zeroLabel(id, spec, words));
        continue;
      }
      const [index, side = ''] = id.split(':');
      const node = nodes[Number(index)];
      if (node !== undefined) covers.push(sideLabel(node, side, words));
    }
    for (const signature of [...edgesLeft]) {
      if (edgeCase.get(signature) !== best.item) continue;
      edgesLeft.delete(signature);
      covers.push(
        rounding.size > 1
          ? `A rounding edge (${whatRounds(rounding.get(signature) ?? [])})`
          : 'A rounding edge',
      );
    }
    picked.push({ item: best.item, covers });
  }

  // Up to three examples: more of different sizes when the sides were all shown by fewer.
  const bySize = [...visible].sort((a, b) => q.compare(a.answer, b.answer));
  for (const fraction of [0.5, 0.15, 0.85]) {
    if (picked.length >= WANTED) break;
    const item = bySize[Math.round(fraction * (bySize.length - 1))];
    if (item !== undefined && !picked.some((entry) => entry.item === item)) {
      picked.push({ item, covers: [] });
    }
  }
  for (const item of bySize) {
    if (picked.length >= WANTED) break;
    if (!picked.some((entry) => entry.item === item)) picked.push({ item, covers: [] });
  }

  const examples = picked.map(({ item, covers }) =>
    exampleOf(outcome, item, covers, undefined, taskIds.get(item.key)),
  );

  // A rounding the records never need is shown with made-up numbers, and said to be. The ones
  // inside the rule come first, the last step after them.
  const base = picked[0]?.item;
  const idle = [...rounding]
    .filter(([signature]) => !edgeCase.has(signature))
    .map(([, group]) => group)
    .reverse();
  for (const group of idle) {
    const node = group[0];
    if (node === undefined) continue;
    const what = whatRounds(group);
    const made = base === undefined ? null : illustrate(outcome, base, node);
    if (made === null || examples.length >= RULE_LIMITS.maxExamples) {
      uncovered.push(`No practice task needs ${what} rounded, so none shows it.`);
      continue;
    }
    examples.push(
      exampleOf(outcome, made.item, [`A rounding edge (${what})`], { request: made.request }),
    );
  }
  return { examples, uncovered };
}

/** What an example of an empty cell counted as zero is called: "An empty parts cost counts as 0". */
function zeroLabel(id: string, spec: RuleSpec, words: WordsContext): string {
  const key = id.slice(ZERO.length);
  const ref = (spec.emptyMeansZero ?? []).find((item) => refKey(item) === key);
  return `An empty ${ref === undefined ? key : nameOf(ref, words)} counts as 0`;
}

/** The labels of the branches a case shows, to find the ones no visible case shows. */
function coverageLabels(
  item: RuleCase,
  ids: ReadonlyMap<RuleNode, number>,
  outcome: RuleOutcome,
): string[] {
  const nodes = nodesOf(outcome.spec.expression);
  return [...coverage(item, ids, outcome.spec.expression)].flatMap((id) => {
    if (id.startsWith(ZERO)) return [];
    const [index, side = ''] = id.split(':');
    const node = nodes[Number(index)];
    return node === undefined ? [] : [sideLabel(node, side, outcome.words)];
  });
}
