import { create } from 'zustand';
import type { AdvancedTab } from './AdvancedDialog';

/*
 * A way for another screen to send the person into a job's Advanced settings: it asks, goes to
 * the job, and the Define screen of that job takes the request when it opens. Kept outside the
 * screens, as the agent settings are (`useAgentSettingsUi`), since the screen that asks is gone
 * by the time the one that answers is there.
 */

interface AdvancedRequest {
  jobId: string;
  tab: AdvancedTab;
}

interface AdvancedRequestStore {
  request: AdvancedRequest | null;
}

const useAdvancedRequest = create<AdvancedRequestStore>()(() => ({ request: null }));

/** Asks for a job's Advanced settings to open on a tab the next time its Define screen opens. */
export function askForAdvanced(jobId: string, tab: AdvancedTab): void {
  useAdvancedRequest.setState({ request: { jobId, tab } });
}

/**
 * The tab that was asked for on this job, once: asking is answered by the first screen of the job
 * that takes it. A request for another job is left where it is, and null means nobody asked.
 */
export function takeAdvanced(jobId: string): AdvancedTab | null {
  const { request } = useAdvancedRequest.getState();
  if (request === null || request.jobId !== jobId) return null;
  useAdvancedRequest.setState({ request: null });
  return request.tab;
}
