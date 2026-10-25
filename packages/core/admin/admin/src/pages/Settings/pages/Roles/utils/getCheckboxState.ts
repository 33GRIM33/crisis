import { createArrayOfValues } from './createArrayOfValues';
import { removeConditionKeyFromData } from './removeConditionKeyFromData';

interface RecursiveRecordOfBooleans extends Record<string, boolean | RecursiveRecordOfBooleans> {}

interface CheckboxState {
  hasAllActionsSelected: boolean;
  hasSomeActionsSelected: boolean;
}

const getCheckboxState = (dataObj: RecursiveRecordOfBooleans): CheckboxState => {
  const dataWithoutCondition = removeConditionKeyFromData(dataObj);

  const arrayOfValues = createArrayOfValues(dataWithoutCondition);

  if (!arrayOfValues.length) {
    return { hasAllActionsSelected: false, hasSomeActionsSelected: false };
  }

  return arrayOfValues.reduce<CheckboxState>(
    (state, value) => ({
      hasAllActionsSelected: state.hasAllActionsSelected && Boolean(value),
      hasSomeActionsSelected: state.hasSomeActionsSelected || Boolean(value),
    }),
    { hasAllActionsSelected: true, hasSomeActionsSelected: false }
  );
};

export { getCheckboxState };
export type { RecursiveRecordOfBooleans };
