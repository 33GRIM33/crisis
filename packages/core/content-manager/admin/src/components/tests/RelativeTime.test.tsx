import { render, screen } from '@tests/utils';

import { RelativeTime } from '../RelativeTime';

const setDateNow = (now: number): jest.Spied<typeof Date.now> =>
  jest.spyOn(Date, 'now').mockReturnValue(now);

let spiedDateNow: ReturnType<typeof setDateNow> | undefined = undefined;

describe('RelativeTime', () => {
  afterAll(() => {
    if (spiedDateNow) {
      spiedDateNow.mockReset();
    }
  });

  it('handles when timestamp is exactly now', () => {
    const now = new Date('2015-10-01 08:00:00').getTime();
    spiedDateNow = setDateNow(now);

    render(<RelativeTime timestamp={new Date(now)} />);

    expect(screen.getByRole('time')).toHaveTextContent('now');
  });

  it('handles when timestamp is in the past', () => {
    const now = new Date('2015-10-01 08:05:00').getTime();
    spiedDateNow = setDateNow(now);

    render(<RelativeTime timestamp={new Date('2015-10-01 08:00:00')} />);

    expect(screen.getByRole('time')).toHaveTextContent('5 minutes ago');
  });

  it('handles when timestamp is in the future', () => {
    const now = new Date('2015-10-01 08:00:00').getTime();
    spiedDateNow = setDateNow(now);

    render(<RelativeTime timestamp={new Date('2015-10-01 08:05:00')} />);

    expect(screen.getByRole('time')).toHaveTextContent('in 5 minutes');
  });

  // Regression for https://github.com/strapi/strapi/issues/27382
  it('does not throw when the timestamp is an invalid Date', () => {
    render(<RelativeTime timestamp={new Date('')} />);

    expect(screen.getByRole('time')).toHaveTextContent('-');
  });
});
