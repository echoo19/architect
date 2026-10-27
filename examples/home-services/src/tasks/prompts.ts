import { longDate } from '../lib/calendar';
import { BUSINESS_DATE } from '../policy/rules';

/** "Thursday, November 5, 2026" */
export const TODAY = longDate(BUSINESS_DATE);

/** Every prompt ends with the exact answer line its task type expects. */
export function withAnswerLine(request: string, answerShape: string): string {
  return `${request}\nEnd with: ANSWER: ${answerShape}`;
}
