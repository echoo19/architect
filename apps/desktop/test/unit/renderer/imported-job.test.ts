import { describe, expect, it } from 'vitest';
import { replacedText } from '../../../src/renderer/src/flow/describe/replaced';

describe("an imported job file's replaced models", () => {
  it('says each model it could not keep, and what took its place', () => {
    expect(
      replacedText([
        { role: 'mentor', from: 'GPT-6 Luna', to: 'Muse Spark 1.3' },
        { role: 'student', from: 'qwen3:32b', to: 'qwen3:8b' },
        { role: 'hosted', from: 'served-copy', to: null },
      ]),
    ).toBe(
      "GPT-6 Luna isn't connected here, so Spark teaches. qwen3:32b doesn't run on this computer, so the agent uses qwen3:8b. served-copy isn't connected here, so it practices on this computer.",
    );
  });

  it('names the hosted copy that took the place of the one the file named', () => {
    expect(replacedText([{ role: 'hosted', from: 'served-copy', to: 'other-copy' }])).toBe(
      "served-copy isn't connected here, so it practices on other-copy.",
    );
  });
});
