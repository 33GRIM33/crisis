import _ from 'lodash';
import { contentTypes, errors } from '@strapi/utils';
import type { Schema } from '@strapi/types';

const { ApplicationError } = errors;

export const isConfigurable = (attribute: Schema.Attribute.AnyAttribute) =>
  _.get(attribute, 'configurable', true);

export const isRelation = (attribute: Schema.Attribute.AnyAttribute) =>
  attribute.type === 'relation';

/**
 * Formats a component's attributes
 */
export const formatAttributes = (model: any) => {
  const { getVisibleAttributes } = contentTypes;

  // only get attributes that can be seen in the CTB
  return getVisibleAttributes(model).reduce((acc: any, key) => {
    acc[key] = formatAttribute(model.attributes[key]);
    return acc;
  }, {});
};

type MediaKinds = string | (string | undefined)[] | undefined;

const MEDIA_TYPES = ['images', 'videos', 'files', 'audios'];

/**
 * The allowed types are part of the payload only when they narrow what the
 * field takes; a field that accepts every kind of media is unrestricted.
 */
const mediaRestriction = (allowedTypes: MediaKinds) => {
  const kinds = (Array.isArray(allowedTypes) ? allowedTypes : [allowedTypes]).filter(
    (kind): kind is string => typeof kind === 'string'
  );

  if (kinds.length === 0 || kinds.every((kind) => MEDIA_TYPES.includes(kind))) {
    return {};
  }

  return { allowedTypes };
};

/**
 * Formats a component attribute
 */
export const formatAttribute = (attribute: Schema.Attribute.AnyAttribute & Record<string, any>) => {
  const { configurable, required, autoPopulate, pluginOptions } = attribute;

  if (attribute.type === 'media') {
    return {
      type: 'media',
      multiple: !!attribute.multiple,
      required: !!required,
      configurable: configurable === false ? false : undefined,
      private: !!attribute.private,
      ...mediaRestriction(attribute.allowedTypes),
      pluginOptions,
    };
  }

  if (attribute.type === 'relation') {
    return {
      ...attribute,
      type: 'relation',
      target: attribute.target,
      targetAttribute: attribute.inversedBy || attribute.mappedBy || null,
      configurable: configurable === false ? false : undefined,
      required: !!required,
      private: !!attribute.private,
      pluginOptions,
      // TODO: remove
      autoPopulate,
    };
  }

  return attribute;
};

// TODO: move to schema builder
export const replaceTemporaryUIDs = (uidMap: any) => (schema: any) => {
  return {
    ...schema,
    attributes: Object.keys(schema.attributes).reduce((acc: any, key) => {
      const attr = schema.attributes[key];
      if (attr.type === 'component') {
        if (_.has(uidMap, attr.component)) {
          acc[key] = {
            ...attr,
            component: uidMap[attr.component],
          };

          return acc;
        }

        if (!_.has(strapi.components, attr.component)) {
          throw new ApplicationError('component.notFound');
        }
      }

      if (
        attr.type === 'dynamiczone' &&
        _.intersection(attr.components, Object.keys(uidMap)).length > 0
      ) {
        acc[key] = {
          ...attr,
          components: attr.components.map((value: any) => {
            if (_.has(uidMap, value)) return uidMap[value];

            if (!_.has(strapi.components, value)) {
              throw new ApplicationError('component.notFound');
            }

            return value;
          }),
        };

        return acc;
      }

      acc[key] = attr;
      return acc;
    }, {}),
  };
};
