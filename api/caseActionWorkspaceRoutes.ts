/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Post-Launch Case-Action Workspace Express Routes (Batch 1)
 */

import type { Express, Request, Response } from 'express';
import { verifyFirebaseToken } from './services/firebaseAdmin.js';
import { LifecycleError } from './services/lifecycleErrors.js';
import {
  listRequirements,
  getRequirement,
  createRequirement,
  updateRequirement,
  confirmRequirement,
  rejectRequirement,
  archiveRequirement,
  setRequirementDispute,
  resolveRequirementDispute,
  listActions,
  createAction,
  completeAction,
  reopenAction,
  attachEvidenceLink,
  unlinkEvidenceLink,
} from './services/caseActionWorkspace.js';

export function registerCaseActionWorkspaceRoutes(app: Express) {
  const authenticated = (action: (req: Request, uid: string) => Promise<unknown>) => async (req: Request, res: Response) => {
    res.set('Cache-Control', 'no-store');
    try {
      const authHeader = req.header('authorization');
      const identity = await verifyFirebaseToken(authHeader);
      if (!identity) {
        res.status(401).json({ code: 'SIGN_IN_REQUIRED', error: 'Authentication required.' });
        return;
      }
      res.json(await action(req, identity.uid));
    } catch (e: any) {
      if (e instanceof LifecycleError) {
        res.status(e.statusCode).json({ code: e.code, error: e.message });
      } else {
        res.status(500).json({ code: 'WORKSPACE_ERROR', error: e.message || 'Case-Action Workspace endpoint failure.' });
      }
    }
  };

  // Requirements
  app.get('/api/matters/:matterId/case-actions/requirements', authenticated((r, u) => {
    const { reviewState, completionState, disputeState, authorityType } = r.query;
    return listRequirements(u, r.params.matterId, {
      reviewState: reviewState as any,
      completionState: completionState as any,
      disputeState: disputeState as any,
      authorityType: authorityType as any,
    });
  }));

  app.post('/api/matters/:matterId/case-actions/requirements', authenticated((r, u) => {
    return createRequirement(u, r.params.matterId, r.body);
  }));

  app.get('/api/matters/:matterId/case-actions/requirements/:requirementId', authenticated((r, u) => {
    return getRequirement(u, r.params.matterId, r.params.requirementId);
  }));

  app.patch('/api/matters/:matterId/case-actions/requirements/:requirementId', authenticated((r, u) => {
    return updateRequirement(u, r.params.matterId, r.params.requirementId, r.body);
  }));

  app.post('/api/matters/:matterId/case-actions/requirements/:requirementId/confirm', authenticated((r, u) => {
    return confirmRequirement(u, r.params.matterId, r.params.requirementId);
  }));

  app.post('/api/matters/:matterId/case-actions/requirements/:requirementId/reject', authenticated((r, u) => {
    return rejectRequirement(u, r.params.matterId, r.params.requirementId);
  }));

  app.post('/api/matters/:matterId/case-actions/requirements/:requirementId/archive', authenticated((r, u) => {
    return archiveRequirement(u, r.params.matterId, r.params.requirementId);
  }));

  app.post('/api/matters/:matterId/case-actions/requirements/:requirementId/dispute', authenticated((r, u) => {
    const { disputeType, disputeNote } = r.body;
    return setRequirementDispute(u, r.params.matterId, r.params.requirementId, disputeType, disputeNote);
  }));

  app.post('/api/matters/:matterId/case-actions/requirements/:requirementId/resolve-dispute', authenticated((r, u) => {
    const { resolutionNote } = r.body;
    return resolveRequirementDispute(u, r.params.matterId, r.params.requirementId, resolutionNote);
  }));

  // Actions
  app.get('/api/matters/:matterId/case-actions/requirements/:requirementId/actions', authenticated((r, u) => {
    return listActions(u, r.params.matterId, r.params.requirementId);
  }));

  app.post('/api/matters/:matterId/case-actions/requirements/:requirementId/actions', authenticated((r, u) => {
    return createAction(u, r.params.matterId, r.params.requirementId, r.body);
  }));

  app.post('/api/matters/:matterId/case-actions/actions/:actionId/complete', authenticated((r, u) => {
    return completeAction(u, r.params.matterId, r.params.actionId);
  }));

  app.post('/api/matters/:matterId/case-actions/actions/:actionId/reopen', authenticated((r, u) => {
    return reopenAction(u, r.params.matterId, r.params.actionId);
  }));

  // Evidence Links
  app.post('/api/matters/:matterId/case-actions/requirements/:requirementId/evidence', authenticated((r, u) => {
    return attachEvidenceLink(u, r.params.matterId, r.params.requirementId, r.body);
  }));

  app.delete('/api/matters/:matterId/case-actions/evidence/:linkId', authenticated((r, u) => {
    return unlinkEvidenceLink(u, r.params.matterId, r.params.linkId);
  }));
}
