// Needs to be wrapped in a component to have access to the form context via a hook.
import * as React from 'react';

import { Blocker as BaseBlocker, useForm } from '@strapi/admin/strapi-admin';

/**
 * Prevents users from leaving the page with unsaved form changes
 */
const Blocker = () => {
  const resetForm = useForm('Blocker', (state) => state.resetForm);
  const modified = useForm('Blocker', (state) => state.modified);

  /**
   * The form is only dirty while the user is editing the document that is currently open,
   * so we remember its state when the navigation was set up to tell those edits apart from
   * values left over by a previous document.
   */
  const hadPendingEdits = React.useRef(modified);

  // We reset the form to the published version to avoid errors like – https://strapi-inc.atlassian.net/browse/CONTENT-2284
  const handleProceed = () => {
    hadPendingEdits.current = false;
    resetForm();
  };

  const handleCancel = () => {
    if (!hadPendingEdits.current) {
      resetForm();
    }
  };

  return <BaseBlocker onProceed={handleProceed} onCancel={handleCancel} />;
};

export { Blocker };
