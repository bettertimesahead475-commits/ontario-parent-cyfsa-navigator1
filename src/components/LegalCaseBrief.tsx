import React from 'react';
import { AnalysisReport } from '../types';
import { FileText, AlertTriangle, ShieldAlert, Scale, Clock } from 'lucide-react';

interface LegalCaseBriefProps {
  report: AnalysisReport;
}

export const LegalCaseBrief: React.FC<LegalCaseBriefProps> = ({ report }) => {
  return (
    <div className="bg-white p-8 rounded-lg shadow-sm border border-gray-200 text-gray-900 font-sans space-y-6">
      <div className="border-b border-gray-300 pb-4">
        <h2 className="text-2xl font-bold tracking-tight">Legal Case Brief: {report.documentTitle}</h2>
        <p className="text-sm text-slate-600 mt-1">Analysis Date: {report.analysisDate}</p>
      </div>

      {report.lawyerCaseBrief && report.lawyerCaseBrief.length > 0 && (
        <section>
          <h3 className="flex items-center text-lg font-semibold mb-3">
            <Scale className="w-5 h-5 mr-2" />
            Core Legal Brief
          </h3>
          <ul className="list-disc pl-5 space-y-2">
            {report.lawyerCaseBrief.map((point, index) => (
              <li key={index} className="text-gray-700">{point}</li>
            ))}
          </ul>
        </section>
      )}

      {report.redFlags && report.redFlags.length > 0 && (
        <section>
          <h3 className="flex items-center text-lg font-semibold mb-3 text-red-700">
            <ShieldAlert className="w-5 h-5 mr-2" />
            Critical Legal Flags
          </h3>
          <div className="space-y-3">
            {report.redFlags.map((flag) => (
              <div key={flag.id} className="bg-red-50 p-4 rounded-md border border-red-100">
                <p className="font-medium text-red-900">{flag.category}: {flag.severity}</p>
                <p className="text-sm text-red-800 mt-1">{flag.explanation}</p>
                <p className="text-xs font-mono text-red-600 mt-2">Legal Reference: {flag.legalReference}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {report.proceduralTimelineViolations && report.proceduralTimelineViolations.length > 0 && (
        <section>
          <h3 className="flex items-center text-lg font-semibold mb-3 text-amber-700">
            <Clock className="w-5 h-5 mr-2" />
            Procedural & Timeline Issues
          </h3>
          <ul className="list-disc pl-5 space-y-2">
            {report.proceduralTimelineViolations.map((violation, index) => (
              <li key={index} className="text-gray-700">
                <span className="font-medium">{violation.timelineRule}</span>: {violation.evaluation}
              </li>
            ))}
          </ul>
        </section>
      )}
      
      <div className="text-xs text-slate-500 pt-4 border-t border-gray-100">
        * This document is a structured educational analysis and does not constitute formal legal advice.
      </div>
    </div>
  );
};
