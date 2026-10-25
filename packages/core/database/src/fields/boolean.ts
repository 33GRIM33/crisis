import { toString } from 'lodash';
import Field from './field';

function isStringOrNumber(value: unknown): value is string | number {
  return typeof value === 'string' || typeof value === 'number';
}

export default class BooleanField extends Field {
  toDB(value: unknown) {
    if (typeof value === 'boolean') {
      return value;
    }

    // Handle null/undefined values explicitly
    if (value === null || value === undefined) {
      return null;
    }

    if (isStringOrNumber(value)) {
      const normalized = `${value}`.trim().toLowerCase();

      // Query strings carry booleans in their compact spellings: `1`/`0` or a
      // single letter.
      if (normalized.length === 1) {
        return ['t', '1'].includes(normalized);
      }

      if (normalized === 'true') {
        return true;
      }
    }

    return Boolean(value);
  }

  fromDB(value: unknown) {
    if (typeof value === 'boolean') {
      return value;
    }

    const strVal = toString(value);

    if (strVal === '1') {
      return true;
    }
    if (strVal === '0') {
      return false;
    }
    return null;
  }
}
