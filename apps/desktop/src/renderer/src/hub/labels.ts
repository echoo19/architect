import type { HubTokenStatus, HubVisibility, PublishProgress } from '@architect/shared';
import { formatBytes } from '../lib/format';

/** Where to make a Hugging Face token. */
export const HUB_TOKENS_PAGE = 'https://huggingface.co/settings/tokens';

/** Where the Hugging Face token comes from, said on one line. Never the token. */
export function tokenSourceText(source: HubTokenStatus['source']): string {
  switch (source) {
    case 'saved':
      return 'Token saved';
    case 'HF_TOKEN':
    case 'HUGGING_FACE_HUB_TOKEN':
      return `Uses ${source} from this computer`;
    case 'token_file':
      return 'Uses the token from hf auth login';
    case null:
      return 'No token';
  }
}

export const VISIBILITY_CHOICES: readonly { value: HubVisibility; label: string }[] = [
  { value: 'private', label: 'Private' },
  { value: 'public', label: 'Public' },
];

/** What each visibility means for a new repository; an existing one keeps its own. */
export const VISIBILITY_MEANINGS: Record<HubVisibility, string> = {
  private: 'Only accounts you allow on Hugging Face can see it',
  public: 'Anyone can see and download it',
};

/** The first characters of a commit, as the Hub shows one. */
export function shortCommit(commit: string): string {
  return commit.slice(0, 7);
}

/** A repository's address without its scheme: "huggingface.co/jake/service-desk". */
export function bareUrl(url: string): string {
  return url.replace(/^https?:\/\//, '');
}

/** The command that installs a publication at its commit, as its model card gives it. */
export function installCommand(repository: string, commit: string): string {
  return `architect install hf://${repository} --revision ${commit}`;
}

/** What a publication is doing now, from the stage it reported. */
export function stageText(progress: PublishProgress): string {
  switch (progress.stage) {
    case 'connecting':
      return `Checking ${progress.repository} on Hugging Face`;
    case 'uploading':
      return 'Sending the package';
    case 'verifying':
      return 'Checking the copy on Hugging Face';
    case 'describing':
      return 'Adding the model card';
  }
}

/** "61 MB of 118 MB": the package's bytes the upload has sent. */
export function sentText(progress: PublishProgress): string {
  const sent = progress.sentBytes === 0 ? '0 KB' : formatBytes(progress.sentBytes);
  return `${sent} of ${formatBytes(progress.totalBytes)}`;
}
