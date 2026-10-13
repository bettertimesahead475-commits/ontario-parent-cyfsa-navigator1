/**
 * Filing-safety preflight for official Ontario court-form exports.
 * A successful preflight does not certify filing acceptance or legal sufficiency.
 */
export type OfficialExportInput = {
  formNumber: string;
  officialTemplate: boolean;
  sourceVerified: boolean;
  versionCurrent: boolean;
  templateHashVerified: boolean;
  fieldMapValidated: boolean;
  populatedFromExactTemplate: boolean;
  userReviewed: boolean;
  unresolvedFields: string[];
  affidavitRequiresCommissioner?: boolean;
  commissioned?: boolean;
};
export type OfficialExportPreflight = {
  canExportAsOfficial: boolean;
  canDescribeAsFilingReady: boolean;
  blockers: string[];
  warnings: string[];
};
export function checkOfficialCourtFormExport(input: OfficialExportInput): OfficialExportPreflight {
  const blockers: string[] = [];
  if (!input.officialTemplate) blockers.push("Not an official Ontario court-form template.");
  if (!input.sourceVerified) blockers.push("Official source has not been verified.");
  if (!input.versionCurrent) blockers.push("Current version has not been verified.");
  if (!input.templateHashVerified) blockers.push("Template integrity hash has not been verified.");
  if (!input.fieldMapValidated) blockers.push("Field mapping has not been validated for this exact template.");
  if (!input.populatedFromExactTemplate) blockers.push("Output has not been populated from the verified official template.");
  if (!input.userReviewed) blockers.push("The completed form has not been reviewed by the user.");
  if (input.unresolvedFields.length) blockers.push("Unresolved form fields: " + input.unresolvedFields.join(", "));
  const warnings = ["Court acceptance, service requirements and legal sufficiency are not certified by this tool."];
  if (input.affidavitRequiresCommissioner && !input.commissioned) warnings.push("Affidavit has not been sworn or affirmed before an authorized commissioner; do not present as executed.");
  return { canExportAsOfficial: blockers.length === 0, canDescribeAsFilingReady: blockers.length === 0 && (!input.affidavitRequiresCommissioner || !!input.commissioned), blockers, warnings };
}
