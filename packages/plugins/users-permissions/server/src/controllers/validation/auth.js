'use strict';

const { yup, validateYupSchema } = require('@strapi/utils');

const callbackSchema = yup.object({
  identifier: yup.string().required(),
  password: yup.string().required(),
});

const createRegisterSchema = (config) =>
  yup.object({
    email: yup.string().email().required(),
    username: yup.string().required(),
    password: yup
      .string()
      .required()
      .test(function validateRegisterPasswordMaxLength(value) {
        if (!value) return true;
        const isValid = new TextEncoder().encode(value).length <= 72;
        if (!isValid) {
          return this.createError({ message: 'Password must be less than 73 bytes' });
        }
        return true;
      })
      .test(async function validateRegisterPassword(value) {
        if (typeof config?.validatePassword === 'function') {
          try {
            const isValid = await config.validatePassword(value);
            if (!isValid) {
              return this.createError({ message: 'Password validation failed.' });
            }
          } catch (error) {
            return this.createError({ message: error.message || 'An error occurred.' });
          }
        }
        return true;
      }),
  });

const sendEmailConfirmationSchema = yup.object({
  email: yup.string().email().required(),
});

const validateEmailConfirmationSchema = yup.object({
  confirmation: yup.string().required(),
});

const passwordConfirmationField = yup
  .string()
  .required()
  .test(function passwordsMatch(value) {
    // A reset only carries the new password, a change also carries the one in place.
    const { password, currentPassword } = this.parent;
    const expected = currentPassword ?? password;

    if (value !== expected) {
      return this.createError({ message: 'Passwords do not match' });
    }

    return true;
  });

const forgotPasswordSchema = yup
  .object({
    email: yup.string().email().required(),
  })
  .noUnknown();

const createResetPasswordSchema = (config) =>
  yup
    .object({
      password: yup
        .string()
        .required()
        .test(function validateResetPasswordMaxLength(value) {
          if (!value) return true;
          const isValid = new TextEncoder().encode(value).length <= 72;
          if (!isValid) {
            return this.createError({ message: 'Password must be less than 73 bytes' });
          }
          return true;
        })
        .test(async function validateResetPassword(value) {
          if (typeof config?.validatePassword === 'function') {
            try {
              const isValid = await config.validatePassword(value);
              if (!isValid) {
                return this.createError({ message: 'Password validation failed.' });
              }
            } catch (error) {
              return this.createError({ message: error.message || 'An error occurred.' });
            }
          }
          return true;
        }),
      passwordConfirmation: passwordConfirmationField,

      code: yup.string().required(),
    })
    .noUnknown();

const createChangePasswordSchema = (config) =>
  yup
    .object({
      password: yup
        .string()
        .required()
        .test(function validateChangePasswordMaxLength(value) {
          if (!value) return true;
          const isValid = new TextEncoder().encode(value).length <= 72;
          if (!isValid) {
            return this.createError({ message: 'Password must be less than 73 bytes' });
          }
          return true;
        })
        .test(async function validateChangePassword(value) {
          if (typeof config?.validatePassword === 'function') {
            try {
              const isValid = await config.validatePassword(value);
              if (!isValid) {
                return this.createError({ message: 'Password validation failed.' });
              }
            } catch (error) {
              return this.createError({ message: error.message || 'An error occurred.' });
            }
          }
          return true;
        }),
      passwordConfirmation: passwordConfirmationField,
      currentPassword: yup.string().required(),
    })
    .noUnknown();

module.exports = {
  validateCallbackBody: validateYupSchema(callbackSchema),
  validateRegisterBody: (payload, config) =>
    validateYupSchema(createRegisterSchema(config))(payload),
  validateSendEmailConfirmationBody: validateYupSchema(sendEmailConfirmationSchema),
  validateEmailConfirmationBody: validateYupSchema(validateEmailConfirmationSchema),
  validateForgotPasswordBody: validateYupSchema(forgotPasswordSchema),
  validateResetPasswordBody: (payload, config) =>
    validateYupSchema(createResetPasswordSchema(config))(payload),
  validateChangePasswordBody: (payload, config) =>
    validateYupSchema(createChangePasswordSchema(config))(payload),
};
