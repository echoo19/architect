import {
  GuardError,
  type ChatMessage,
  type MentorAdapter,
  type StudyState,
} from '@architect/shared';
import { formatUsd } from '../loop/budget';
import type { Clock, LoopDeps } from '../loop/deps';
import type { JobLibrary } from '../loop/jobs';
import type { DataPaths } from '../loop/paths';
import { connectTeacher } from '../loop/setup';
import { isoNow } from '../loop/time';
import { MentorGate } from '../mentor/gate';
import { describeAttached } from './files';
import { fixMessage, STUDY_MAX_OUTPUT_TOKENS, studyMessage, studySystemPrompt } from './prompts';
import {
  checkStudy,
  isStudied,
  readMaterial,
  studyJsonSchema,
  studyStateOf,
  transferDetector,
} from './study';

/** The most one study may cost the teacher, in dollars, as drafting a job may. */
export const STUDY_CAP_USD = 1;

export interface StudyOptions {
  jobs: JobLibrary;
  paths: DataPaths;
  deps: Pick<LoopDeps, 'adapters' | 'secrets' | 'vault'>;
  clock: Clock;
  /** Dollars one study may cost the teacher, at most. */
  capUsd?: number;
}

/**
 * The teacher's study of a field job's material (decision 069): one call, and one more with the
 * reasons when the reply can't be used. The brief is kept beside the job, so opening the job
 * again shows it without another call, and nothing trains until the person confirms it.
 */
export class JobStudy {
  private readonly busy = new Set<string>();

  constructor(private readonly options: StudyOptions) {}

  async study(jobId: string): Promise<StudyState> {
    const { jobs, paths, deps, clock } = this.options;
    const job = await jobs.get(jobId);
    if (!isStudied(job)) throw new Error('This job lists no organizations to study.');
    const current = await jobs.studyState(jobId);
    if (current !== null && (current.state === 'needed' || current.state === 'confirmed')) {
      return current;
    }
    if (this.busy.has(jobId)) {
      throw new Error(`${job.mentor.label} is already studying this job. Wait for its brief.`);
    }
    this.busy.add(jobId);
    try {
      const files = await jobs.studiedFiles(job);
      const material = await readMaterial(job, (orgId) => paths.orgDataDir(jobId, orgId));
      const opening = studyMessage(
        job,
        material.map(({ org, attached }) => ({
          id: org.id,
          name: org.name,
          files: describeAttached(attached),
        })),
      );
      // A transfer organization's name in what would be sent stops the study before any call,
      // and the gate holds to the same test for every call (invariant 1).
      const leaks = transferDetector(job, await deps.vault.transferIdentifiers(jobId));
      if (leaks.scan(`${studySystemPrompt()}\n${opening}`).leaked) {
        throw new GuardError(
          'split',
          "The material names an organization kept for the final test, so it can't be sent to the teacher. Take the name out of the train organizations' files, then study again.",
        );
      }
      const spend = { calls: 0, inputTokens: 0, outputTokens: 0, usd: 0 };
      const cap = this.options.capUsd ?? STUDY_CAP_USD;
      const gate = new MentorGate({
        leakDetector: leaks,
        authorize: (maxUsd) => {
          if (maxUsd === null) {
            throw new GuardError(
              'budget',
              "Architect doesn't know what the teacher costs, so it can't keep the study under its limit. Enter the model's price in Settings, or pick a model with a known price.",
            );
          }
          if (spend.usd + maxUsd > cap + 1e-9) {
            throw new GuardError(
              'budget',
              `Studying the material may cost the teacher at most ${formatUsd(cap)}. The next step could cost up to ${formatUsd(maxUsd)}${spend.usd > 0 ? `, with ${formatUsd(spend.usd)} already spent` : ''}.`,
            );
          }
          return maxUsd;
        },
        onRefusal: () => undefined,
      });
      const mentor: MentorAdapter = await connectTeacher(deps, job.mentor);
      let messages: ChatMessage[] = [{ role: 'user', content: opening }];
      for (let attempt = 1; ; attempt += 1) {
        const { completion, costUsd } = await gate.complete(
          mentor,
          {
            system: studySystemPrompt(),
            messages,
            json: { name: 'study_brief', schema: studyJsonSchema() },
            maxOutputTokens: STUDY_MAX_OUTPUT_TOKENS,
          },
          {
            onSpent: (charge) => {
              spend.calls += 1;
              spend.inputTokens += charge.usage.inputTokens;
              spend.outputTokens += charge.usage.outputTokens;
              spend.usd += charge.costUsd;
            },
          },
        );
        spend.calls += 1;
        spend.inputTokens += completion.usage.inputTokens;
        spend.outputTokens += completion.usage.outputTokens;
        spend.usd += costUsd;
        const checked = checkStudy(completion.json, job, material);
        if (checked.ok) {
          const record = {
            format: 1 as const,
            createdAt: isoNow(clock),
            teacher: {
              label: job.mentor.label,
              model: job.mentor.kind === 'model' ? job.mentor.model : job.mentor.label,
            },
            cost: spend,
            files,
            brief: checked.brief,
          };
          await jobs.writeStudy(jobId, record);
          return studyStateOf(record, files);
        }
        if (attempt === 2) {
          throw new Error(
            `The study couldn't be used: ${checked.problems.slice(0, 3).join(' ')} Try again.`,
          );
        }
        messages = [
          ...messages,
          { role: 'assistant', content: completion.text },
          { role: 'user', content: fixMessage(checked.problems) },
        ];
      }
    } finally {
      this.busy.delete(jobId);
    }
  }
}
