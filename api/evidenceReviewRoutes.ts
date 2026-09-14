import type {Express,Request,Response} from 'express';
import {verifyFirebaseToken} from './services/firebaseAdmin.js';
import {LifecycleError} from './services/lifecycleErrors.js';
import {listReviewMatters,listEvidence,reviewEvidence,evidenceSource} from './services/evidenceReview.js';

export function registerEvidenceReviewRoutes(app:Express){
  const authenticated=(action:(req:Request,uid:string)=>Promise<unknown>)=>async(req:Request,res:Response)=>{
    res.set('Cache-Control','no-store');
    try{
      const identity=await verifyFirebaseToken(req.header('authorization'));
      if(!identity){res.status(401).json({code:'SIGN_IN_REQUIRED',error:'Authentication required.'});return;}
      res.json(await action(req,identity.uid));
    }catch(e){
      if(e instanceof LifecycleError)res.status(e.statusCode).json({code:e.code,error:e.message});
      else res.status(503).json({code:'REVIEW_UNAVAILABLE',error:'Evidence review is unavailable.'});
    }
  };
  app.get('/api/review-matters',authenticated((r,u)=>listReviewMatters(u,r.query)));
  app.get('/api/matters/:matterId/evidence',authenticated((r,u)=>listEvidence(u,r.params.matterId,r.query)));
  app.patch('/api/matters/:matterId/evidence/:evidenceId/review',authenticated((r,u)=>reviewEvidence(u,r.params.matterId,r.params.evidenceId,r.body)));
  app.get('/api/matters/:matterId/evidence/:evidenceId/source',authenticated((r,u)=>evidenceSource(u,r.params.matterId,r.params.evidenceId,r.query)));
}
