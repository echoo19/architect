import { useState } from 'react';
import { loopbackEndpointIssue } from '@architect/shared';
import { Input } from '@architect/ui';
import { InspectorRow } from './fields';
import type { InspectorTabProps } from './inspector-tabs';
import { TYPING_PAUSE_MS } from './use-job-editor';

/**
 * An OpenAI-compatible server on this computer as the agent's model: a trained model the person
 * serves themselves. The address must be this computer's, with a port (decision 086); anything
 * else is refused here and again wherever a graduate opens.
 */
export function LocalServer({ editor, change }: InspectorTabProps) {
  const { local } = editor.job.student;
  const own = local.runtime === 'openai_compatible';
  const [baseUrl, setBaseUrl] = useState(own ? local.baseUrl : '');
  const [model, setModel] = useState(own ? local.model : '');
  const issue = baseUrl.trim() === '' ? null : loopbackEndpointIssue(baseUrl.trim());

  const save = (nextUrl: string, nextModel: string) => {
    const url = nextUrl.trim();
    const name = nextModel.trim();
    if (url === '' || name === '' || loopbackEndpointIssue(url) !== null) return;
    change(
      'Server on this computer',
      (current) => ({
        ...current,
        student: {
          ...current.student,
          local: {
            runtime: 'openai_compatible',
            baseUrl: url,
            model: name,
            contextLength: current.student.local.contextLength,
          },
        },
      }),
      TYPING_PAUSE_MS,
    );
  };

  return (
    <section aria-label="Server on this computer" className="flex flex-col gap-1">
      <h3 className="m-0 text-small font-medium">Server on this computer</h3>
      <InspectorRow label="Address" error={issue ?? undefined}>
        <Input
          aria-label="Server address"
          aria-invalid={issue ? true : undefined}
          placeholder="http://127.0.0.1:8000/v1"
          spellCheck={false}
          value={baseUrl}
          className="h-9 w-56 font-mono"
          onChange={(event) => {
            setBaseUrl(event.target.value);
            save(event.target.value, model);
          }}
        />
      </InspectorRow>
      <InspectorRow label="Model name">
        <Input
          aria-label="Server model name"
          spellCheck={false}
          value={model}
          className="h-9 w-56 font-mono"
          onChange={(event) => {
            setModel(event.target.value);
            save(baseUrl, event.target.value);
          }}
        />
      </InspectorRow>
    </section>
  );
}
