import type {Express,Request,Response,RequestHandler} from 'express';
import {verifyFirebaseToken} from './services/firebaseAdmin.js';
import {LifecycleError} from './services/lifecycleErrors.js';
import {uploadSource,readSource,analyzeSourcePage,type EvidenceProvider} from './services/documentSources.js';
import type {OCR} from './services/pageSources.js';

export function registerDocumentRoutes(app:Express,ocr:OCR,evidence:EvidenceProvider,costLimit:RequestHandler,evidenceAccess:RequestHandler) {
  const route=(action:(req:Request,uid:string)=>Promise<unknown>)=>async(req:Request,res:Response)=>{
    try {
      const identity=await verifyFirebaseToken(req.header('authorization'));
      if(!identity){res.status(401).json({code:'SIGN_IN_REQUIRED',error:'Authentication required.'});return;}
      res.json(await action(req,identity.uid));
    }catch(e){
      if(e instanceof LifecycleError)res.status(e.statusCode).json({code:e.code,error:e.message});
      else res.status(500).json({code:'SOURCE_FAILED',error:'Source operation failed.'});
    }
  };
  app.post('/api/matters/:matterId/documents',costLimit,route((req,uid)=>uploadSource(uid,req.params.matterId,req.body,ocr)));
  app.get('/api/matters/:matterId/document-versions/:versionId',route((req,uid)=>readSource(uid,req.params.matterId,req.params.versionId)));
  app.post('/api/matters/:matterId/document-versions/:versionId/pages/:pageId/evidence',costLimit,evidenceAccess,
    route((req,uid)=>analyzeSourcePage(uid,req.params.matterId,req.params.versionId,req.params.pageId,evidence)));
}
