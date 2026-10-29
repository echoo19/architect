import { beforeEach, describe, expect, it } from 'vitest';
import { useUi } from '../../../src/renderer/src/state/ui';

describe('the row the settings open on when a person is sent there', () => {
  beforeEach(() => {
    useUi.setState({ settingsOpen: false, settingsTab: 'general', settingsFocus: null });
  });

  it('opens on the tab and the row asked for', () => {
    useUi.getState().openSettings('models', 'huggingface');
    expect(useUi.getState()).toMatchObject({
      settingsOpen: true,
      settingsTab: 'models',
      settingsFocus: 'huggingface',
    });
  });

  it('asks for nothing in particular when it is opened any other way', () => {
    useUi.getState().openSettings('models', 'huggingface');
    useUi.getState().setSettingsOpen(false);
    useUi.getState().openSettings('models');
    expect(useUi.getState()).toMatchObject({ settingsOpen: true, settingsFocus: null });
    // And one that names no tab keeps the tab it was on, with no row.
    useUi.getState().openSettings();
    expect(useUi.getState()).toMatchObject({ settingsTab: 'models', settingsFocus: null });
  });

  it('forgets the row once the settings close, so the next visit starts from where it left off', () => {
    useUi.getState().openSettings('models', 'huggingface');
    useUi.getState().setSettingsOpen(false);
    expect(useUi.getState()).toMatchObject({ settingsOpen: false, settingsFocus: null });
  });

  it('forgets the row when the person goes to another tab', () => {
    useUi.getState().openSettings('models', 'huggingface');
    useUi.getState().setSettingsTab('privacy');
    expect(useUi.getState()).toMatchObject({ settingsTab: 'privacy', settingsFocus: null });
  });
});
