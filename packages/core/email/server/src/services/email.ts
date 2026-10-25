import * as _ from 'lodash';
import { template } from '@strapi/utils';

import type {
  EmailConfig,
  EmailOptions,
  EmailTemplate,
  EmailTemplateData,
  SendOptions,
} from '../types';

const { createStrictInterpolationRegExp } = template;

const getProviderSettings = (): EmailConfig => strapi.config.get('plugin::email');

const send = async (options: SendOptions) => strapi.plugin('email').provider.send(options);

/**
 * fill subject, text and html using lodash template
 * @param {object} emailOptions - to, from and replyto...
 * @param {object} emailTemplate - object containing attributes to fill
 * @param {object} data - data used to fill the template
 * @returns {{ subject, text, subject }}
 */
const sendTemplatedEmail = (
  emailOptions: EmailOptions,
  emailTemplate: EmailTemplate,
  data: EmailTemplateData
) => {
  const attributes = ['subject', 'text', 'html'];
  const missingAttributes = _.difference(attributes, Object.keys(emailTemplate));

  if (missingAttributes.length > 0) {
    throw new Error(
      `Following attributes are missing from your email template : ${missingAttributes.join(', ')}`
    );
  }

  const collectVariableNames = (value: Record<string, unknown>, prefix = ''): string[] =>
    Object.entries(value).flatMap(([key, nested]) => {
      const name = prefix ? `${prefix}.${key}` : key;

      // Nested values are expanded so a template can read `user.firstname` as well as `user`.
      return nested !== null && typeof nested === 'object'
        ? [name, ...collectVariableNames(nested as Record<string, unknown>)]
        : [name];
    });

  const allowedInterpolationVariables = collectVariableNames(data as Record<string, unknown>);
  const interpolate = createStrictInterpolationRegExp(allowedInterpolationVariables, 'g');

  const templatedAttributes = attributes.reduce(
    (compiled, attribute) =>
      emailTemplate[attribute]
        ? Object.assign(compiled, {
            [attribute]: _.template(emailTemplate[attribute], {
              interpolate,
            })(data),
          })
        : compiled,
    {}
  );

  return strapi.plugin('email').provider.send({ ...emailOptions, ...templatedAttributes });
};

const emailService = () => ({
  getProviderSettings,
  send,
  sendTemplatedEmail,
});

export default emailService;
