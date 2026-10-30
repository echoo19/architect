import { describe, expect, it } from 'vitest';
import { HIDDEN_ARGUMENT, runtimeFrom } from '../../../src/common/runtime';

describe('runtimeFrom', () => {
  it('says a page runs hidden when the main process passed the switch', () => {
    expect(runtimeFrom(['electron', '--type=renderer', HIDDEN_ARGUMENT])).toEqual({ hidden: true });
  });

  it('says a normal run is not hidden, so its pages animate', () => {
    expect(runtimeFrom(['electron', '--type=renderer'])).toEqual({ hidden: false });
    expect(runtimeFrom([])).toEqual({ hidden: false });
  });

  it('takes only the exact switch', () => {
    expect(runtimeFrom(['--architect-hidden-ish', 'architect-hidden'])).toEqual({ hidden: false });
  });
});
