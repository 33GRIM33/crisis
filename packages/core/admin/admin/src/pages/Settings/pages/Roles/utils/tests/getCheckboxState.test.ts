import { getCheckboxState } from '../getCheckboxState';

describe('getCheckboxState', () => {
  it('should return an object with all the keys set to false if the object is empty', () => {
    const expected = { hasAllActionsSelected: false, hasSomeActionsSelected: false };

    // @ts-expect-error – test case
    expect(getCheckboxState(null)).toEqual(expected);
    expect(getCheckboxState({})).toEqual(expected);
  });

  it('should return an object with all the keys set to false when all the leafs of the object are falsy', () => {
    const complexeData = {
      f1: false,
      f2: {
        f21: false,
        f22: {
          f1: false,
          f2: {
            f1: false,
          },
        },
      },
    };

    const expected = { hasAllActionsSelected: false, hasSomeActionsSelected: false };

    expect(getCheckboxState(complexeData)).toEqual(expected);
  });

  it('should return an object with hasAllActionsSelected to false and hasSomeActionsSelected to true when some of the leafs of the object are falsy', () => {
    const complexeData = {
      f1: true,
      f2: {
        f21: true,
        f22: {
          f1: true,
          f2: {
            f1: false,
          },
        },
      },
    };
    const expected = { hasAllActionsSelected: false, hasSomeActionsSelected: true };

    expect(getCheckboxState(complexeData)).toEqual(expected);
  });
});
