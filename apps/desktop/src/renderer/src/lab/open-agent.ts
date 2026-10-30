import type { GraduateSummary } from '@architect/shared';
import { attempt } from '../lib/notify';
import { navigate, paths } from '../lib/router';
import { latestChat } from '../workspace/store';

/** Opens an agent at the chat it was used in last, or a new one when it has none. */
export function openAgent(graduate: Pick<GraduateSummary, 'id' | 'name'>): void {
  void attempt(`Couldn't open ${graduate.name}`, async () => {
    const chat = await latestChat([graduate.id]);
    navigate(paths.chat(graduate.id, chat.id));
  });
}
