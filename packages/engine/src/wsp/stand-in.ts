import type { WspBrief } from '@architect/shared';
import type { BriefContext, StepContext, WspMentorClient, WspStep } from './mentor';

/*
 * A scripted mentor for Architect WSP's tests and its unbilled demonstrations (decision 109). It
 * writes the same kind of programs Astra is asked for, from a fixed recipe: read hidden states
 * of outputs that failed and that passed, then remove the direction between them from the 64
 * output columns of each middle layer's MLP down projection that write most along it (the form
 * of the published 50-pass repair, which touched 64 columns in two layers). It never calls a model, costs nothing, and every experiment it runs is
 * marked as a stand-in's, never as Astra's result.
 */

const ZERO = { usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 }, costUsd: 0 };

function brief(context: BriefContext): WspBrief {
  const checked = context.practice.some((example) => example.check !== undefined);
  return {
    objective: `Move the model toward the goal by a targeted weight edit: ${context.experiment.goal.task}`,
    baseline: 'Measure the base on practice and dev at greedy decoding, with the two controls beside it.',
    investigation:
      'Read hidden states for the outputs that fail and the ones that pass, find the direction that separates them in the middle layers, and remove it from the 64 MLP output columns of each of those layers that write most along it.',
    successCriteria: [
      checked
        ? 'The candidate passes more dev examples than the base and than both controls.'
        : 'The candidate repeats itself on fewer dev examples than the base and both controls.',
    ],
    regressionChecks: ['No dev example the base passed is failed by the candidate.'],
    expectedOutput: 'A candidate of a few replaced tensors over the read-only base, or no candidate if no edit gains.',
    target: { metric: checked ? 'pass_rate' : 'loop_rate', minPoints: 5 },
    controls: {
      decoding: { temperature: 0, topP: 1, repetitionPenalty: 1.15, maxNewTokens: 192 },
      instructions: 'Answer briefly and directly, and do not repeat yourself.',
    },
  };
}

const READ = `bad = [p["prompt"] + "\\n" + p["output"] for p in practice if p["passed"] is False or p["looped"]]
good = [p["prompt"] + "\\n" + p["output"] for p in practice if p["passed"] is not False and not p["looped"]]
layers = weights.config["num_hidden_layers"]
band = list(range(layers // 3, (2 * layers) // 3 + 1))
print(f"{len(bad)} failing and {len(good)} passing practice outputs; reading layers {band[0]} to {band[-1]}")
if bad and good:
    request_read("bad", bad[:32], [l + 1 for l in band])
    request_read("good", good[:32], [l + 1 for l in band])
    np.save(scratch + "/band.npy", np.array(band))
else:
    print("Nothing to contrast: every practice output is on one side.")
`;

const EDIT = `band = [int(i) for i in np.load(scratch + "/band.npy")]
bad = load_read("bad")
good = load_read("good")
for layer in band:
    u = torch.from_numpy(bad[f"mean_{layer + 1}"].mean(0) - good[f"mean_{layer + 1}"].mean(0)).float()
    norm = float(u.norm())
    if norm == 0:
        continue
    u = u / norm
    name = f"model.layers.{layer}.mlp.down_proj.weight"
    W = weights.get(name)
    columns = torch.topk((u @ W).abs(), 64).indices
    W[:, columns] -= torch.outer(u, u @ W[:, columns])
    save_edit(name, W)
    print(f"layer {layer}: removed a direction of norm {norm:.3f} from 64 columns")
`;

export function standInMentor(): WspMentorClient {
  return {
    standIn: true,
    brief: (context) => Promise.resolve({ value: brief(context), completion: ZERO }),
    step(context: StepContext) {
      const done = context.experiment.iterations;
      const last = done[done.length - 1];
      let value: WspStep;
      if (done.length === 0) {
        value = {
          hypothesis: 'Failing and passing outputs differ along one direction in the middle layers.',
          expected: 'Hidden states for both groups, to find that direction.',
          action: 'program',
          program: READ,
          summary: 'Reading hidden states of failing and passing practice outputs.',
        };
      } else if (done.length === 1 && last?.outcome === 'read') {
        value = {
          hypothesis: 'Removing that direction from the MLP outputs of the middle layers moves outputs toward the passing ones.',
          expected: 'A candidate that gains on the target over the base on dev.',
          action: 'program',
          program: EDIT,
          summary: 'Removing the separating direction from the middle layers.',
        };
      } else {
        value = {
          hypothesis: last?.decision === 'kept' ? 'The edit helped on dev.' : 'This recipe found no edit that helps.',
          expected: 'Nothing more from this recipe.',
          action: 'finish',
          program: '',
          summary: 'The scripted recipe has no further step.',
        };
      }
      return Promise.resolve({ value, completion: ZERO });
    },
    worstCaseUsd: () => 0,
  };
}
