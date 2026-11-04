import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  WSP_DEFAULT_LIMITS,
  WSP_MIN_EXAMPLES,
  type WspExperiment,
  type WspModel,
} from '@architect/shared';
import {
  keepExperiment,
  useWspComputeTargets,
  useWspMentor,
  useWspWorker,
  wspApi,
} from '../api/wsp';
import { attempt } from '../lib/notify';
import { navigate, paths } from '../lib/router';
import { FlowShell } from '../shell/FlowShell';
import { BriefStep, briefHeld, type BriefForm } from './BriefStep';
import { ComputeStep, computeHeld, type ComputeForm } from './ComputeStep';
import { GoalStep, type GoalForm } from './GoalStep';
import { examplesOf } from './model';
import { ModelStep } from './ModelStep';
import { GoOn, StepFooter, WSP_STEPS, type WspStep } from './parts';

/** Why the goal can't go on yet, or null when it can. */
export function goalHeld(form: GoalForm): string | null {
  if (form.task.trim() === '') return 'Describe the goal';
  const { examples, incomplete } = examplesOf(form.rows);
  if (incomplete > 0) return 'Finish or remove the rows that need it';
  if (examples.length < WSP_MIN_EXAMPLES) {
    const more = WSP_MIN_EXAMPLES - examples.length;
    return `Add ${more} more ${more === 1 ? 'example' : 'examples'}`;
  }
  return null;
}

/** The problems the limit fields hold, by row, so the way on waits until they are fixed. */
function useProblems() {
  const [problems, setProblems] = useState<Record<string, string>>({});
  const onProblem = useCallback((row: string, problem: string | null) => {
    setProblems((current) => {
      if ((current[row] ?? null) === problem) return current;
      const next = { ...current };
      if (problem === null) delete next[row];
      else next[row] = problem;
      return next;
    });
  }, []);
  return { broken: Object.keys(problems).length > 0, onProblem };
}

/**
 * A new experiment, from its base model to its goal, compute and limits. Drafting the brief makes
 * the experiment, whose own page then holds the brief until it starts.
 */
export function NewExperiment() {
  const [step, setStep] = useState<WspStep>('Model');
  const [model, setModel] = useState<WspModel | null>(null);
  const [goal, setGoal] = useState<GoalForm>({ task: '', constraints: '', rows: [] });
  const [compute, setCompute] = useState<ComputeForm>({
    compute: 'local-cpu',
    limits: WSP_DEFAULT_LIMITS,
    effort: null,
  });
  const [drafting, setDrafting] = useState(false);
  const { broken, onProblem } = useProblems();
  const targets = useWspComputeTargets();
  const worker = useWspWorker();
  const mentor = useWspMentor();

  // Until the person picks one, the mentor's own reasoning effort is the choice.
  const effort = compute.effort ?? mentor.data?.mentor.reasoningEffort ?? 'high';

  const draft = async () => {
    if (!model) return;
    setDrafting(true);
    const constraints = goal.constraints.trim();
    const experiment = await attempt("Couldn't start drafting the brief", () =>
      wspApi.draft({
        modelPath: model.path,
        goal: {
          task: goal.task.trim(),
          ...(constraints === '' ? {} : { constraints }),
          examples: examplesOf(goal.rows).examples,
        },
        compute: compute.compute,
        limits: compute.limits,
        reasoningEffort: effort,
      }),
    );
    setDrafting(false);
    if (experiment) navigate(paths.wspExperiment(keepExperiment(experiment).id), { replace: true });
  };

  let body;
  let footer;
  if (step === 'Model') {
    body = <ModelStep chosen={model} onChoose={setModel} />;
    footer = (
      <StepFooter>
        <GoOn
          label="Continue"
          held={model?.compatibility.supported ? null : 'Choose a supported model'}
          onClick={() => setStep('Goal')}
        />
      </StepFooter>
    );
  } else if (step === 'Goal') {
    body = <GoalStep form={goal} onChange={setGoal} />;
    footer = (
      <StepFooter back={() => setStep('Model')}>
        <GoOn label="Continue" held={goalHeld(goal)} onClick={() => setStep('Compute')} />
      </StepFooter>
    );
  } else {
    const target = targets.data?.find((item) => item.id === compute.compute);
    body = (
      <ComputeStep form={{ ...compute, effort }} onChange={setCompute} onProblem={onProblem} />
    );
    footer = (
      <StepFooter back={() => setStep('Goal')}>
        <GoOn
          label="Draft brief"
          held={computeHeld(target, worker.data, mentor.data, broken)}
          loading={drafting}
          onClick={() => void draft()}
        />
      </StepFooter>
    );
  }

  return (
    <FlowShell<WspStep> title="New experiment" step={step} steps={WSP_STEPS} footer={footer}>
      {body}
    </FlowShell>
  );
}

/** The brief as it was saved, ready to edit. */
function formOf(experiment: WspExperiment): BriefForm | null {
  return experiment.brief === null ? null : { title: experiment.title, brief: experiment.brief };
}

/**
 * The brief of an experiment not yet started: the mentor drafting it, the draft to edit, or the
 * failed draft with a way to draft again. Start experiment saves any edit, approves the brief as
 * it stands and starts.
 */
export function BriefFlow({ experiment }: { experiment: WspExperiment }) {
  const drafted = useMemo(() => formOf(experiment), [experiment]);
  // What the person changed, once they change anything; until then the brief as drafted.
  const [edited, setEdited] = useState<BriefForm | null>(null);
  const form = edited ?? drafted;
  const [busy, setBusy] = useState<'start' | 'redraft' | null>(null);

  // An edit is saved once React has the field's last value: a field left, or a choice made.
  const latest = useRef(edited);
  const saved = useRef<BriefForm | null>(null);
  const [saveAsked, setSaveAsked] = useState(0);
  useEffect(() => {
    latest.current = edited;
  });

  const save = useCallback(
    async (next: BriefForm | null): Promise<boolean> => {
      if (next === null || next === saved.current) return true;
      if (briefHeld(next.brief, next.title) !== null) return false;
      const updated = await attempt("Couldn't save the brief", () =>
        wspApi.revise(experiment.id, next.brief, next.title.trim()),
      );
      if (!updated) return false;
      saved.current = next;
      keepExperiment(updated);
      return true;
    },
    [experiment.id],
  );

  useEffect(() => {
    if (saveAsked > 0) void save(latest.current);
  }, [saveAsked, save]);

  const start = async () => {
    setBusy('start');
    const started =
      (await save(latest.current)) &&
      (await attempt("Couldn't start the experiment", () => wspApi.start(experiment.id)));
    setBusy(null);
    if (started) keepExperiment(started);
  };

  const redraft = async () => {
    setBusy('redraft');
    const next = await attempt("Couldn't draft the brief again", () =>
      wspApi.redraft(experiment.id),
    );
    setBusy(null);
    if (next) keepExperiment(next);
  };

  const held =
    experiment.status === 'briefing'
      ? 'The brief is being drafted'
      : form === null
        ? 'Draft the brief first'
        : briefHeld(form.brief, form.title);

  return (
    <FlowShell<WspStep>
      title={form?.title.trim() || experiment.title}
      step="Brief"
      steps={WSP_STEPS}
      footer={
        <StepFooter>
          <GoOn
            label="Start experiment"
            held={held}
            loading={busy === 'start'}
            onClick={() => void start()}
          />
        </StepFooter>
      }
    >
      <BriefStep
        experiment={experiment}
        form={form}
        onChange={setEdited}
        onSave={() => setSaveAsked((count) => count + 1)}
        onRedraft={() => void redraft()}
        redrafting={busy === 'redraft'}
      />
    </FlowShell>
  );
}
