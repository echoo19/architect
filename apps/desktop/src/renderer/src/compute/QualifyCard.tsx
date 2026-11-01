import { useEffect, useId, useState } from 'react';
import { loopbackEndpointIssue, type Qualification } from '@architect/shared';
import { Badge, Button, Card, ErrorState, Field, Input, Select, Tooltip } from '@architect/ui';
import { BadgeCheck, TriangleAlert } from 'lucide-react';
import { computeApi } from '../api/compute';
import { useJobs } from '../api/hooks';
import { toError } from '../api/query';
import { bestCandidate, readField, type FieldSummary } from '../fields/model';
import { shortDate } from '../flow/format';
import { formatPercent } from '../lib/format';

const POLL_MS = 2000;

/** A finished run's frozen harness, as the person picks it. */
function versionLabel(field: FieldSummary, runId: string): string {
  const candidate = field.candidates.find((item) => item.run.id === runId);
  if (!candidate) return runId;
  const best = bestCandidate(field.candidates) === candidate ? ' · best' : '';
  return `Harness v${candidate.run.currentVersion} · ${shortDate(candidate.report.createdAt)}${best}`;
}

function resultText(item: Qualification): string {
  if (item.status === 'testing') return 'Testing';
  if (item.status === 'paused') return 'Paused';
  return item.card ? formatPercent(item.card.test.score) : 'Finished';
}

/**
 * Qualify a model trained elsewhere (decision 086): a field's frozen harness, its locked test and
 * its never-seen organizations, taken by a model the person serves on this computer. It costs no
 * money, and it uses this computer's GPU, which is the person's to spare.
 */
export function QualifyCard({ initialJobId }: { initialJobId?: string | undefined }) {
  const ids = { address: useId(), model: useId() };
  const jobs = useJobs();
  // Opened from a field or one of its versions, the field is chosen already.
  const [jobId, setJobId] = useState<string | undefined>(initialJobId);
  const [field, setField] = useState<FieldSummary | null>(null);
  const [runId, setRunId] = useState<string | undefined>(undefined);
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [starting, setStarting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<Qualification[]>([]);

  useEffect(() => {
    if (jobId === undefined) return;
    let live = true;
    setField(null);
    setRunId(undefined);
    readField(jobId).then(
      (next) => {
        if (!live) return;
        setField(next);
        setRunId((bestCandidate(next.candidates) ?? next.candidates[0])?.run.id);
      },
      (error: unknown) => live && setProblem(toError(error).message),
    );
    return () => {
      live = false;
    };
  }, [jobId]);

  const busy = done.some((item) => item.status === 'testing');
  useEffect(() => {
    if (jobId === undefined) return;
    let live = true;
    const load = () =>
      computeApi.qualifications(jobId).then(
        (items) => live && setDone(items),
        (error: unknown) => live && setProblem(toError(error).message),
      );
    void load();
    const timer = busy ? setInterval(() => void load(), POLL_MS) : undefined;
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [jobId, busy]);

  const addressIssue = baseUrl.trim() === '' ? null : loopbackEndpointIssue(baseUrl.trim());
  const versionBlocker =
    jobId === undefined
      ? 'Choose a field first'
      : field === null
        ? 'Reading the field'
        : field.candidates.length === 0
          ? 'No version of this field has taken its sealed final test yet'
          : null;
  // What holds Qualify back, in the order the form is filled; null when it can start.
  const blocker =
    versionBlocker ??
    (runId === undefined
      ? 'Choose a harness version'
      : baseUrl.trim() === ''
        ? 'Enter the address of the server that serves the model'
        : addressIssue !== null
          ? addressIssue
          : model.trim() === ''
            ? 'Enter the model name'
            : busy
              ? 'Wait until the model being tested finishes'
              : null);
  const ready = blocker === null;

  const start = async () => {
    if (!ready || jobId === undefined || runId === undefined) return;
    setStarting(true);
    setProblem(null);
    try {
      await computeApi.qualify({
        runId,
        endpoint: { baseUrl: baseUrl.trim(), model: model.trim(), contextLength: 16_384 },
      });
      setDone(await computeApi.qualifications(jobId));
    } catch (error) {
      setProblem(toError(error).message);
    } finally {
      setStarting(false);
    }
  };

  return (
    <Card title="Qualify a fine-tuned model" icon={<BadgeCheck aria-hidden />}>
      <div className="flex flex-col gap-5">
        <p className="m-0 max-w-[640px] text-ui">
          A model you fine-tuned elsewhere and serve here takes a field&apos;s sealed final test and
          its never-seen organizations, under a frozen harness.
        </p>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Field" htmlFor="qualify-field">
            <Select
              aria-label="Field"
              value={jobId}
              placeholder="Choose a field"
              onValueChange={setJobId}
              options={(jobs.data ?? []).map((job) => ({ value: job.id, label: job.name }))}
              className="w-full"
            />
          </Field>
          <Field label="Harness version" htmlFor="qualify-version">
            {versionBlocker === null ? (
              <Select
                aria-label="Harness version"
                value={runId}
                placeholder="Choose"
                onValueChange={setRunId}
                options={(field?.candidates ?? []).map((item) => ({
                  value: item.run.id,
                  label: versionLabel(field as FieldSummary, item.run.id),
                }))}
                className="w-full"
              />
            ) : (
              // A disabled control takes no pointer, so what holds it back hangs on the span.
              <Tooltip content={versionBlocker}>
                <span tabIndex={0} className="block rounded-control">
                  <Select
                    aria-label="Harness version"
                    value={undefined}
                    placeholder={
                      field && field.candidates.length === 0 ? 'None tested yet' : 'Choose'
                    }
                    onValueChange={setRunId}
                    disabled
                    options={[]}
                    className="w-full"
                  />
                </span>
              </Tooltip>
            )}
          </Field>
          <Field label="Server address" htmlFor={ids.address}>
            <Input
              id={ids.address}
              value={baseUrl}
              placeholder="http://127.0.0.1:8000/v1"
              spellCheck={false}
              className="font-mono"
              aria-invalid={addressIssue ? true : undefined}
              onChange={(event) => setBaseUrl(event.target.value)}
            />
            {addressIssue && (
              <p role="alert" className="m-0 text-small text-pretty">
                {addressIssue}
              </p>
            )}
          </Field>
          <Field label="Model name" htmlFor={ids.model}>
            <Input
              id={ids.model}
              value={model}
              spellCheck={false}
              className="font-mono"
              onChange={(event) => setModel(event.target.value)}
            />
          </Field>
        </div>
        <p className="m-0 flex items-start gap-2 text-ui">
          <TriangleAlert size={16} className="mt-0.5 shrink-0" aria-hidden />
          It runs the whole sealed final test on this computer&apos;s GPU at no cost. Start it when
          the GPU is free.
        </p>
        {problem && <ErrorState layout="inline" title="Couldn't qualify" message={problem} />}
        <div>
          {blocker === null ? (
            <Button variant="primary" size="md" loading={starting} onClick={() => void start()}>
              Qualify
            </Button>
          ) : (
            <Tooltip content={blocker}>
              <span tabIndex={0} className="inline-flex rounded-control">
                <Button variant="primary" size="md" disabled>
                  Qualify
                </Button>
              </span>
            </Tooltip>
          )}
        </div>
        {done.length > 0 && (
          <ul aria-label="Qualified models" className="m-0 flex list-none flex-col p-0">
            {done.map((item) => (
              <li
                key={item.id}
                className="flex min-h-11 items-center gap-3 border-t border-line text-ui"
              >
                <span className="min-w-0 flex-1 truncate font-medium">{item.model}</span>
                <Badge>Fine-tuned elsewhere</Badge>
                <span className="w-24 text-right tabular-nums">{resultText(item)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
