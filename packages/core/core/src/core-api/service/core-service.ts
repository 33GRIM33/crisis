/**
 * Publication statuses the content API serves by default.
 */
const DEFAULT_STATUSES = ['published', 'draft'];

export abstract class CoreService {
  getFetchParams(params = {}): any {
    const { status } = params as { status?: unknown };
    const isServedStatus = typeof status === 'string' && DEFAULT_STATUSES.includes(status);

    return {
      ...params,
      status: isServedStatus ? status : DEFAULT_STATUSES[0],
    };
  }
}
