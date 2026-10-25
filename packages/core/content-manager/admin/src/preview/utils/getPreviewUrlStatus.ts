import type { GetPreviewUrl } from '../../../../shared/contracts/preview';

/**
 * The preview URL endpoint only accepts the draft and published statuses.
 * A modified document is a draft with changes that are not published yet, so its preview is the draft.
 */
export function getPreviewUrlStatus(
  status: string | undefined
): GetPreviewUrl.Request['query']['status'] {
  if (!status) {
    return undefined;
  }

  const hasPublishedVersion = status === 'published' || status === 'modified';
  const hasDraftVersion = status === 'draft' || status === 'modified';

  if (hasPublishedVersion) {
    return 'published';
  }

  if (hasDraftVersion) {
    return 'draft';
  }

  return undefined;
}
