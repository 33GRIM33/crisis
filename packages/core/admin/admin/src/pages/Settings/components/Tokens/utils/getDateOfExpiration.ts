import { addDays, format } from 'date-fns';
import * as locales from 'date-fns/locale';

import { getDateFnsLocaleName } from '../../../../../utils/locales';

const DURATION_UNITS = {
  millisecondsInSecond: 1000,
  secondsInMinute: 60,
  minutesInHour: 60,
  hoursInDay: 24,
};

const toDays = (durationInMilliseconds: number) => {
  const { millisecondsInSecond, secondsInMinute, hoursInDay } = DURATION_UNITS;

  return durationInMilliseconds / millisecondsInSecond / secondsInMinute / hoursInDay;
};

export const getDateOfExpiration = (
  createdAt: string,
  duration: number | null,
  language: string = 'en'
) => {
  if (duration && typeof duration === 'number') {
    return format(addDays(new Date(createdAt), toDays(duration)), 'PPP', {
      locale: locales[getDateFnsLocaleName(language)],
    });
  }

  return 'Unlimited';
};
