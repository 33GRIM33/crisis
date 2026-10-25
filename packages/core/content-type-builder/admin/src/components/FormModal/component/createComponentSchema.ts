import { translatedErrors as errorsTrads } from '@strapi/admin/strapi-admin';
import snakeCase from 'lodash/snakeCase';
import * as yup from 'yup';

import { getTrad } from '../../../utils/getTrad';
import { createComponentUid } from '../utils/createUid';

const CATEGORY_PART_SEPARATOR = '_';
const CATEGORY_PART_REGEX = /^[A-Za-z0-9]+$/;

const isValidCategoryName = (value: string) => {
  const parts = value.split(CATEGORY_PART_SEPARATOR);

  if (!parts.every((part) => CATEGORY_PART_REGEX.test(part))) {
    return false;
  }

  return /^[A-Za-z]/.test(value);
};

export const createComponentSchema = (
  usedComponentNames: Array<string>,
  reservedNames: Array<string>,
  category: string,
  takenCollectionNames: Array<string>,
  currentCollectionName: string
) => {
  const shape = {
    displayName: yup
      .string()
      .test({
        name: 'nameAlreadyUsed',
        message: errorsTrads.unique.id,
        test(value) {
          if (!value) {
            return false;
          }

          const name = createComponentUid(value, category);

          const snakeCaseKey = snakeCase(name);
          const snakeCaseCollectionName = snakeCase(currentCollectionName);

          return (
            usedComponentNames.every((reserved) => {
              return snakeCase(reserved) !== snakeCaseKey;
            }) &&
            takenCollectionNames.every(
              (collectionName) => snakeCase(collectionName) !== snakeCaseCollectionName
            )
          );
        },
      })
      .test({
        name: 'nameNotAllowed',
        message: getTrad('error.contentTypeName.reserved-name'),
        test(value) {
          if (!value) {
            return false;
          }

          const snakeCaseKey = snakeCase(value);
          return reservedNames.every((reserved) => {
            return snakeCase(reserved) !== snakeCaseKey;
          });
        },
      })
      .required(errorsTrads.required.id),
    category: yup
      .string()
      .test({
        name: 'categoryNameFormat',
        message: getTrad('error.category.format'),
        test(value) {
          if (!value) {
            return true;
          }

          return isValidCategoryName(value);
        },
      })
      .required(errorsTrads.required.id),

    icon: yup.string(),
  };

  return yup.object(shape);
};
