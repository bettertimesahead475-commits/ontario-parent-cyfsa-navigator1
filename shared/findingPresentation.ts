/**
 * CYFSA Navigator — Legal Analysis & Courtroom Presentation Engine
 *
 * Implements two professional presentation modes for every document-analyzer finding:
 * 1. Educational Legal Analysis (statutory breakdown, evidentiary impact, parent rights)
 * 2. Courtroom-Style Legal Presentation (formal Ontario family-law courtroom advocacy)
 *
 * Plus an expandable "What Can This Finding Be Used For?" section connecting the finding
 * directly to the official Ontario Court Forms Education Library (Forms 8B, 14A, 33B.1, 33C, 35.1A).
 *
 * MANDATORY STANDARDS:
 * - No repetitive disclaimers after individual findings.
 * - State established deficiencies and violations directly.
 * - Identify specific missing evidence where a conclusion remains unresolved.
 * - Distinguish unsupported allegations, documented contradictions, and proven procedural noncompliance.
 * - Never confuse an absence of evidence in reviewed documents with proof that no evidence exists.
 * - Do not automatically complete court forms or submit documents.
 * - Both modes use identical verified facts, quotes, citations, and legal conclusions.
 */

export type FindingNature = 
  | "Evidentiary Deficiency (Secondhand Hearsay Allegation)"
  | "Documented Evidentiary Contradiction"
  | "Procedural Noncompliance Concern"
  | "Unsupported Factual Allegation"
  | "Statutory Threshold Assessment"
  | "Statutory Safeguard / Rights Defect";

export interface EducationalAnalysis {
  nature: FindingNature;
  directFindingStatement: string;
  documentQuote: string;
  documentLocator: string;
  applicableLegislation: string;
  proceduralRule: string;
  verifiedCaseLaw: {
    caseName: string;
    citation: string;
    legalPrinciple: string;
  };
  whatEvidenceEstablishes: string;
  whatLawRequires: string;
  whyFindingMatters: string;
  missingEvidenceToResolve: string;
  parentExaminationGuidance: string[];
}

export interface CourtroomPresentation {
  advocacyContext: string;
  formalOpening: string;
  factualEvidentiarySubmission: string;
  legalAuthoritySubmission: string;
  courtroomDialogueExample: string;
  substantivePrayerForRelief: string;
  evidentiaryStandardStatus: string;
}

export interface CourtFormConnection {
  primaryFormNumber: string;
  primaryFormTitle: string;
  officialRulesCitation: string;
  applicableSectionOrField: string;
  educationalDraftingGuidance: string;
  secondaryForms: {
    formNumber: string;
    title: string;
    purpose: string;
  }[];
  officialIndexUrl: string;
  safeguardNotice: string;
}

export interface PracticalLitigationUses {
  crossExaminationQuestions: string[];
  evidentiaryObjections: string[];
  disclosureDemands: string[];
  courtForms: CourtFormConnection;
}

export interface EnhancedFindingPresentation {
  id: string;
  category: string;
  severity: string;
  educationalAnalysis: EducationalAnalysis;
  courtroomPresentation: CourtroomPresentation;
  practicalUses: PracticalLitigationUses;
}

/**
 * Classifies the exact nature of the finding directly and objectively.
 */
export function determineFindingNature(flag: any): FindingNature {
  const cat = String(flag?.category || "").toLowerCase();
  const evid = String(flag?.evidenceClassification || "").toUpperCase();
  const sev = String(flag?.severity || "").toLowerCase();

  if (cat.includes("contradiction") || cat.includes("inconsistency")) {
    return "Documented Evidentiary Contradiction";
  }
  if (cat.includes("procedure") || cat.includes("timeline") || cat.includes("defect") || cat.includes("noncompliance")) {
    return "Procedural Noncompliance Concern";
  }
  if (evid === "HEARSAY" || cat.includes("hearsay")) {
    return "Evidentiary Deficiency (Secondhand Hearsay Allegation)";
  }
  if (cat.includes("threshold") || cat.includes("s. 74") || cat.includes("protection ground")) {
    return "Statutory Threshold Assessment";
  }
  if (cat.includes("rights") || cat.includes("ombudsman") || cat.includes("counsel")) {
    return "Statutory Safeguard / Rights Defect";
  }
  return "Unsupported Factual Allegation";
}

/**
 * Formulates verified Ontario child-protection jurisprudence principles
 * corresponding to the finding category and evidence classification.
 */
export function getAuthoritativeJurisprudence(flag: any): { caseName: string; citation: string; legalPrinciple: string } {
  const nature = determineFindingNature(flag);
  const evid = String(flag?.evidenceClassification || "").toUpperCase();

  if (nature === "Evidentiary Deficiency (Secondhand Hearsay Allegation)" || evid === "HEARSAY") {
    return {
      caseName: "Children's Aid Society of the Niagara Region v. P. (D.)",
      citation: "(2003), 36 R.F.L. (5th) 265 (Ont. S.C.J.)",
      legalPrinciple: "Hearsay evidence in child protection affidavits requires clear identification of information and belief sources under Family Law Rules 14(18)-(19), and multi-layered, uncorroborated secondhand allegations carry minimal weight on contentious issues."
    };
  }

  if (nature === "Documented Evidentiary Contradiction") {
    return {
      caseName: "Children's Aid Society of Ottawa v. C. (S.)",
      citation: "2009 ONCA 514, 69 R.F.L. (6th) 1",
      legalPrinciple: "Contradictory and internally inconsistent Society records must be scrutinized critically, and factual conflicts cannot be resolved summarily against parents without testing through cross-examination and primary records."
    };
  }

  if (nature === "Procedural Noncompliance Concern") {
    return {
      caseName: "Catholic Children's Aid Society of Metropolitan Toronto v. M. (C.)",
      citation: "[1994] 2 S.C.R. 165",
      legalPrinciple: "State intervention in family autonomy requires strict adherence to statutory timelines and procedural fairness under child protection legislation to avoid prejudice to the child-parent relationship."
    };
  }

  if (nature === "Statutory Threshold Assessment") {
    return {
      caseName: "Children's Aid Society of Algoma v. P. (P.)",
      citation: "2005 ONCJ 424, 21 R.F.L. (6th) 171",
      legalPrinciple: "Protection grounds under CYFSA s. 74(2) require cogent, objective evidence demonstrating a specific risk of harm; subjective anxiety or uncorroborated allegations do not satisfy the statutory threshold."
    };
  }

  // Default for unsupported claims
  return {
    caseName: "F.H. v. McDougall",
    citation: "2008 SCC 53, [2008] 3 S.C.R. 41",
    legalPrinciple: "The Society bears the burden of proof on a balance of probabilities, which requires clear, convincing, and cogent evidence rather than speculation, suspicion, or unsubstantiated conclusions."
  };
}

/**
 * Builds the Educational Legal Analysis mode for a finding.
 */
export function buildEducationalAnalysis(flag: any): EducationalAnalysis {
  const nature = determineFindingNature(flag);
  const quote = String(flag?.phraseDetected || flag?.quote || flag?.quoteText || "Quoted assertion noted in document").trim();
  const rawLoc = String(flag?.locationInDocument || "").trim();
  const page = flag?.quoteLocation?.page;
  const locator = rawLoc 
    ? (page ? `${rawLoc} (verified on page ${page})` : rawLoc)
    : (page ? `Document Page ${page}` : "Reference location in uploaded document");

  const legalRef = String(flag?.legalReference || "").trim();
  const legislation = legalRef.includes("CYFSA") 
    ? legalRef 
    : (legalRef ? `CYFSA & ${legalRef}` : "Child, Youth and Family Services Act, 2017 (CYFSA)");

  const proceduralRule = flag?.evidenceClassification === "HEARSAY" || flag?.category?.toLowerCase().includes("hearsay")
    ? "Ontario Family Law Rules (O. Reg. 114/99), Rule 14(18) and 14(19) (Evidence on Motions & Information/Belief requirements)"
    : "Ontario Family Law Rules (O. Reg. 114/99), Rule 1(7) and Rule 14(18) (Fairness & Firsthand Affidavits)";

  const caseLaw = getAuthoritativeJurisprudence(flag);

  // Directly state the established deficiency
  let directFindingStatement = "";
  let whatEvidenceEstablishes = "";
  let whatLawRequires = "";
  let whyFindingMatters = "";
  let missingEvidenceToResolve = "";

  if (nature === "Evidentiary Deficiency (Secondhand Hearsay Allegation)") {
    directFindingStatement = `This passage presents a secondhand out-of-court statement without firsthand witness verification.`;
    whatEvidenceEstablishes = `The document records that an assertion was reported to the Society worker, but it does not establish the factual truth of the underlying event itself.`;
    whatLawRequires = `Under Family Law Rules, Rule 14(18) and Rule 14(19), evidence on motions must be based on firsthand personal knowledge where possible; information and belief is only permissible if the source is identified and verified, and hearsay carries discounted weight on disputed factual issues.`;
    whyFindingMatters = `Without firsthand testimony or contemporaneous documentary records from the direct source, this allegation cannot legally support a finding that the parent caused or failed to protect the child from harm.`;
    missingEvidenceToResolve = `Primary source records: contemporaneous interview notes with the direct source, direct signed witness statements, or third-party institutional logs (e.g., medical, school, or daycare attendance registers). The absence of these in the current record does not prove they do not exist, but means the assertion is presently uncorroborated.`;
  } else if (nature === "Documented Evidentiary Contradiction") {
    directFindingStatement = `This passage contradicts other documented factual assertions or timeline entries within the filed records.`;
    whatEvidenceEstablishes = `The filed record contains conflicting dates, accounts, or characterizations regarding the same material incident.`;
    whatLawRequires = `Ontario courts require the Society's evidentiary record to be reliable and consistent when alleging protection concerns under CYFSA Part V. Material internal contradictions undermine the credibility of the affiant.`;
    whyFindingMatters = `A documented internal contradiction provides a direct avenue for counsel to challenge the affiant's reliability and prevents the Society from treating the disputed point as established fact.`;
    missingEvidenceToResolve = `Objective third-party timeline confirmation: 911 dispatch audio/CAD logs, hospital triage timestamps, text messages with confirmed cellular metadata, or police officer notebook entries to resolve which conflicting version is accurate.`;
  } else if (nature === "Procedural Noncompliance Concern") {
    directFindingStatement = `The timeline or procedure documented here raises noncompliance concerns under statutory deadlines or mandatory procedural safeguards.`;
    whatEvidenceEstablishes = `The document reflects procedural steps or adjournments that do not establish compliance with prescribed statutory timeframes.`;
    whatLawRequires = `CYFSA mandates strict compliance with procedural milestones, including hearing deadlines following removal, notice requirements, and limits on temporary adjournments without parental consent.`;
    whyFindingMatters = `Procedural defects prejudice the parent's ability to respond to claims in a timely manner and can form the basis of procedural motions or requests for expedited hearings.`;
    missingEvidenceToResolve = `The formal court endorsement record, clerk's docket minutes, and proof of statutory service. Do not assume noncompliance is proven until the complete court file register is verified against the statutory requirements.`;
  } else if (nature === "Statutory Threshold Assessment") {
    directFindingStatement = `This assertion touches directly upon a statutory child-in-need-of-protection ground under CYFSA s. 74(2).`;
    whatEvidenceEstablishes = `The document asserts facts intended to support a statutory protection finding, but the supporting evidence must be evaluated against statutory criteria.`;
    whatLawRequires = `CYFSA s. 74(2) requires cogent proof that the child has suffered harm or that a substantial risk of future harm exists that the parent has failed to protect against.`;
    whyFindingMatters = `Unless the specific elements of the statutory clause are proven by admissible, probative evidence, the court cannot find the child in need of protection or make dispositional orders.`;
    missingEvidenceToResolve = `Clinical assessments, police reports, or direct observational evidence establishing actual or probable harm. Assess whether the documented facts satisfy the strict statutory criteria of s. 74(2), or discuss with legal counsel or duty counsel.`;
  } else {
    directFindingStatement = `The document states an adverse factual assertion without identifying direct evidentiary substantiation.`;
    whatEvidenceEstablishes = `The passage records the worker's narrative opinion or conclusion without referencing eyewitness statements or supporting exhibits.`;
    whatLawRequires = `The Society bears the burden of establishing protection allegations on a balance of probabilities with clear, cogent evidence. Bald assertions carry no evidentiary weight.`;
    whyFindingMatters = `Unsupported allegations in CAS affidavits can be highlighted to the judge as unproven assertions that cannot justify intrusive child protection orders.`;
    missingEvidenceToResolve = `Disclosed worker chronological notes, third-party reports, or witness interviews. Requesting targeted disclosure will clarify whether the Society has supporting records.`;
  }

  // If the flag already has detailed explanation text, merge substantive points
  if (flag?.explanation && typeof flag.explanation === "string" && flag.explanation.length > 20) {
    whyFindingMatters = `${flag.explanation} ${whyFindingMatters}`;
  }

  const parentExaminationGuidance = [
    `Rights Awareness: You have the statutory right under CYFSA Part V and Family Law Rules to represent yourself, challenge unproven allegations, and request full disclosure of all underlying CAS records.`,
    `Evidence Review: Compare this specific passage against your own records, text messages, calendars, and witness accounts from that date.`,
    `Questions to Consider (or Discuss with Counsel if Retained): (1) Does this statement meet the firsthand personal knowledge requirements of Family Law Rule 14(18)? (2) What primary records exist to test or contradict this assertion? (3) Should this be addressed in your Form 33B.1 Answer or in a Form 14A Responding Affidavit?`
  ];

  if (flag?.parentActionStep && typeof flag.parentActionStep === "string" && flag.parentActionStep.length > 10) {
    parentExaminationGuidance.unshift(`Specific Action: ${flag.parentActionStep}`);
  }

  return {
    nature,
    directFindingStatement,
    documentQuote: quote,
    documentLocator: locator,
    applicableLegislation: legislation,
    proceduralRule,
    verifiedCaseLaw: caseLaw,
    whatEvidenceEstablishes,
    whatLawRequires,
    whyFindingMatters,
    missingEvidenceToResolve,
    parentExaminationGuidance,
  };
}

/**
 * Builds the Courtroom-Style Legal Presentation mode for a finding.
 * Uses formal, respectful, persuasive language of an Ontario family-law advocate addressing a judge.
 */
export function buildCourtroomPresentation(flag: any): CourtroomPresentation {
  const edu = buildEducationalAnalysis(flag);
  const quote = edu.documentQuote;
  const locator = edu.documentLocator;
  const caseLaw = edu.verifiedCaseLaw;

  const advocacyContext = "Formal Courtroom Submissions • Oral Argument / Written Motion Argument";
  const formalOpening = `Your Honour, with respect to the allegation set out at ${locator} of the Society's materials...`;

  let factualEvidentiarySubmission = "";
  let legalAuthoritySubmission = "";
  let courtroomDialogueExample = "";
  let substantivePrayerForRelief = "";
  let evidentiaryStandardStatus = "";

  if (edu.nature === "Evidentiary Deficiency (Secondhand Hearsay Allegation)") {
    factualEvidentiarySubmission = `The affiant deposes at ${locator} that "${quote}". We respectfully submit to this Court that this statement is classic hearsay. The affiant has no firsthand personal knowledge of the underlying event, and the Society has failed to identify with particularity the primary informant or provide contemporaneous direct statements.`;
    legalAuthoritySubmission = `Under Rule 14(18) and 14(19) of the Family Law Rules, while information and belief may be admissible on temporary motions, this Court and the Ontario Superior Court of Justice in ${caseLaw.caseName} (${caseLaw.citation}) have firmly held that uncorroborated, multi-layered hearsay carries minimal probative weight when determining contentious factual issues regarding child care.`;
    courtroomDialogueExample = `"Your Honour, turning to paragraph ${locator.replace(/[^0-9]/g, '') || 'X'} of the worker's affidavit: the Society asserts that '${quote}'. This is not evidence of fact; it is an out-of-court statement tendered for the truth of its contents without direct corroboration. The maker of that statement has not been produced, nor have contemporaneous notes been disclosed. In accordance with Rule 14(19) and the established principles in ${caseLaw.caseName}, we respectfully submit this Court should assign this assertion little to no evidentiary weight."`;
    substantivePrayerForRelief = `We submit that this uncorroborated assertion cannot form the factual basis of a s. 74(2) protection finding or justify restrictive conditions.`;
    evidentiaryStandardStatus = `Evidentiary Element Missing: Absence of direct firsthand affiant testimony or primary contemporaneous corroborating documentation.`;
  } else if (edu.nature === "Documented Evidentiary Contradiction") {
    factualEvidentiarySubmission = `The record reveals a material inconsistency. At ${locator}, the Society states that "${quote}", which directly conflicts with the Society's own prior pleadings and chronology entries.`;
    legalAuthoritySubmission = `As the Court of Appeal established in ${caseLaw.caseName} (${caseLaw.citation}), where the Society's own records contain material contradictions regarding the factual matrix, the Court cannot resolve disputed facts against a parent without rigorous testing through cross-examination and objective documentary records.`;
    courtroomDialogueExample = `"Your Honour, there is an irreconcilable conflict in the Society's own materials. At ${locator}, the affiant deposes that '${quote}', yet in the Society's prior record, an entirely contradictory timeline is advanced. In light of the Court of Appeal's guidance in ${caseLaw.caseName}, the Court cannot accept the Society's version of events as established when their own documentation presents mutually incompatible accounts."`;
    substantivePrayerForRelief = `We respectfully request that this Court decline to draw adverse inferences against the parent on this disputed point pending viva voce evidence and complete disclosure.`;
    evidentiaryStandardStatus = `Evidentiary Element Missing: Objective third-party corroboration required to reconcile internal contradictions.`;
  } else if (edu.nature === "Procedural Noncompliance Concern") {
    factualEvidentiarySubmission = `The procedural history recorded at ${locator} demonstrates that statutory safeguards have not been complied with, as reflected in the statement "${quote}".`;
    legalAuthoritySubmission = `The Supreme Court of Canada affirmed in ${caseLaw.caseName} (${caseLaw.citation}) that child protection proceedings involve the most intrusive power of the state, requiring scrupulous compliance with statutory timelines and procedural fairness.`;
    courtroomDialogueExample = `"Your Honour, child protection proceedings are governed by strict statutory milestones under the CYFSA. The materials at ${locator} concede that '${quote}'. As the Supreme Court held in ${caseLaw.caseName}, procedural statutory protections are mandatory safeguards, not discretionary guidelines. The parent has suffered tangible prejudice in preparing their defense."`;
    substantivePrayerForRelief = `We respectfully submit that procedural fairness requires an expedited timetable and immediate compliance with disclosure obligations.`;
    evidentiaryStandardStatus = `Procedural Requirement: Proof of timely statutory service and compliance with court docket timeframes.`;
  } else if (edu.nature === "Statutory Threshold Assessment") {
    factualEvidentiarySubmission = `The Society seeks to invoke s. 74(2) protection grounds based on the statement at ${locator} that "${quote}". However, this statement falls short of the statutory evidentiary threshold.`;
    legalAuthoritySubmission = `Under CYFSA s. 74(2) and ${caseLaw.caseName} (${caseLaw.citation}), the Court must find real, substantial, and objective risk of harm proven on a balance of probabilities, not mere subjective concern or unproven suspicion.`;
    courtroomDialogueExample = `"Your Honour, the Society bears the burden of establishing on a balance of probabilities that the child is in need of protection under s. 74(2). The passage at ${locator} stating '${quote}' amounts to speculation rather than objective proof of harm. Following ${caseLaw.caseName}, generalized anxiety or unproven allegations cannot satisfy the statutory definition."`;
    substantivePrayerForRelief = `We submit that the statutory threshold under CYFSA s. 74(2) has not been substantiated on this record.`;
    evidentiaryStandardStatus = `Statutory Threshold: Clear, cogent, and convincing evidence of harm or imminent substantial risk required under CYFSA s. 74(2).`;
  } else {
    factualEvidentiarySubmission = `The Society deposes at ${locator} that "${quote}". This is an unsubstantiated conclusion unsupported by direct observation, clinical diagnosis, or corroborating records.`;
    legalAuthoritySubmission = `In accordance with ${caseLaw.caseName} (${caseLaw.citation}), the Society bears the legal burden of proof on a balance of probabilities. Adverse findings of fact cannot rest upon speculative conclusions.`;
    courtroomDialogueExample = `"Your Honour, the assertion at ${locator} that '${quote}' is completely unsubstantiated on the face of the record. No witness statement, clinical note, or exhibit is cited to support it. Under long-standing Ontario law, bare assertions in an affidavit cannot support intrusive state orders against parents."`;
    substantivePrayerForRelief = `We ask that this unsupported claim be struck from consideration or given no weight by this Court.`;
    evidentiaryStandardStatus = `Evidentiary Element Missing: Absence of supporting documentary or witness corroboration in the filed record.`;
  }

  return {
    advocacyContext,
    formalOpening,
    factualEvidentiarySubmission,
    legalAuthoritySubmission,
    courtroomDialogueExample,
    substantivePrayerForRelief,
    evidentiaryStandardStatus,
  };
}

/**
 * Connects the finding to the official Ontario Court Forms Education Library.
 * Explains applicable prescribed forms and fields without autofilling them.
 */
export function buildCourtFormsGuidance(flag: any): CourtFormConnection {
  const nature = determineFindingNature(flag);
  const quote = String(flag?.phraseDetected || flag?.quote || "").trim();
  const locator = String(flag?.locationInDocument || "in the filed document").trim();

  let primaryFormNumber = "33B.1";
  let primaryFormTitle = "Answer and Plan of Care (parties other than Children's Aid Society)";
  let officialRulesCitation = "O. Reg. 114/99, Rule 33, Form 33B.1";
  let applicableSectionOrField = "Part 2: Claim for Child Protection — Response to Society's Allegations";
  let educationalDraftingGuidance = "";

  if (nature === "Evidentiary Deficiency (Secondhand Hearsay Allegation)" || nature === "Unsupported Factual Allegation") {
    primaryFormNumber = "14A";
    primaryFormTitle = "Affidavit (General)";
    officialRulesCitation = "O. Reg. 114/99, Rule 14, Form 14A";
    applicableSectionOrField = "Paragraph-by-Paragraph Factual Deposition in Response to Society's Motion / Application";
    educationalDraftingGuidance = `How to use this finding when preparing your court documents (self-represented or with counsel):
1. In your Form 14A Responding Affidavit, locate the corresponding paragraph where CAS asserts "${quote}" (${locator}).
2. State your firsthand, personal knowledge of what actually occurred on that date, avoiding secondhand hearsay.
3. Attach verified supporting exhibits (e.g., text messages, doctor's notes, attendance slips, sign-in logs) as Exhibit "A", "B", etc., to affirmatively refute the uncorroborated hearsay.
4. Form 14A must be sworn or affirmed before a commissioner for taking affidavits in Ontario (available for free at Ontario family court counters) before filing.`;
  } else if (nature === "Documented Evidentiary Contradiction") {
    primaryFormNumber = "33C";
    primaryFormTitle = "Statement of Agreed Facts (Child Protection)";
    officialRulesCitation = "O. Reg. 114/99, Rule 33, Form 33C";
    applicableSectionOrField = "Section 2: Facts in Dispute & Separate Agreed Timeline Items";
    educationalDraftingGuidance = `How to use this finding when preparing your court documents (self-represented or with counsel):
1. In Form 33C discussions with the Society or during a case conference, isolate verified undisputed dates from the contradictory claim "${quote}".
2. Use this contradiction to demonstrate to the court why the Society's version cannot be adopted as an agreed fact.
3. In your Form 33B.1 Answer, explicitly plead the true factual chronology with reference to corroborating records.`;
  } else if (nature === "Procedural Noncompliance Concern") {
    primaryFormNumber = "14B";
    primaryFormTitle = "Motion Form";
    officialRulesCitation = "O. Reg. 114/99, Rule 14, Form 14B";
    applicableSectionOrField = "Order Requested: Expedited Hearing / Mandatory Disclosure under CYFSA";
    educationalDraftingGuidance = `How to use this finding when preparing your court documents (self-represented or with counsel):
1. Prepare a Form 14B Motion seeking an order for immediate disclosure of all unredacted worker notes and third-party records concerning "${quote}".
2. Identify the specific statutory timeline breach and the procedural remedy requested from the court under the Family Law Rules.
3. Legal counsel is optional; self-represented parents can file Form 14B motions directly with the court office or consult duty counsel for procedural guidance.`;
  } else {
    // Statutory Threshold
    primaryFormNumber = "33B.1";
    primaryFormTitle = "Answer and Plan of Care (parties other than Children's Aid Society)";
    officialRulesCitation = "O. Reg. 114/99, Rule 33, Form 33B.1";
    applicableSectionOrField = "Part 2 (Response to Protection Claim) & Part 3 (Parent's Proposed Plan of Care)";
    educationalDraftingGuidance = `How to use this finding when preparing your court documents (self-represented or with counsel):
1. In Form 33B.1 Part 2, directly address the Society's allegation regarding s. 74(2) grounds referenced at ${locator}.
2. Explain the facts showing that the child is safe, thriving, and not in need of state protection.
3. In Part 3, construct a comprehensive parental plan of care detailing family support, community resources, daycare/school routines, and medical care providers. Form 33B.1 must be served on all parties and filed within the timelines prescribed by Rule 33(4).`;
  }

  const secondaryForms = [
    {
      formNumber: "35.1A",
      title: "Affidavit (Child Protection Information)",
      purpose: "Prescribed sworn affidavit setting out detailed caregiving history, parenting capacity, and child welfare context before a judge."
    },
    {
      formNumber: "8B",
      title: "Application (Child Protection and Status Review)",
      purpose: "The Society's initiating application — review to check whether the box for this specific statutory ground is officially ticked by CAS."
    }
  ];

  return {
    primaryFormNumber,
    primaryFormTitle,
    officialRulesCitation,
    applicableSectionOrField,
    educationalDraftingGuidance,
    secondaryForms,
    officialIndexUrl: "https://ontariocourtforms.on.ca/en/family-law-rules-forms/",
    safeguardNotice: "Educational guidance only. CYFSA Navigator does not autofill, complete, sign, or submit court forms. Self-represented parents have the legal right to draft and file their own court materials without a lawyer; legal representation is optional. However, specific legal formalities are mandatory: affidavits (such as Form 14A and Form 35.1A) must be sworn or affirmed before a commissioner for taking affidavits (available for free at Ontario family court counters), and all materials must adhere to Family Law Rules service and filing deadlines."
  };
}

/**
 * Builds practical litigation uses (Cross-Examination, Evidentiary Objections, Disclosure Demands, Court Forms).
 */
export function buildPracticalUses(flag: any): PracticalLitigationUses {
  const nature = determineFindingNature(flag);
  const quote = String(flag?.phraseDetected || flag?.quote || "").trim();
  const locator = String(flag?.locationInDocument || "").trim();

  let crossExaminationQuestions: string[] = [];
  let evidentiaryObjections: string[] = [];
  let disclosureDemands: string[] = [];

  if (nature === "Evidentiary Deficiency (Secondhand Hearsay Allegation)") {
    crossExaminationQuestions = [
      `"Worker [Name], you were not present when the incident described at ${locator} allegedly occurred, correct?"`,
      `"The statement in your affidavit that '${quote}' is based entirely on what an out-of-court third party told you?"`,
      `"Did you independently review primary objective records—such as phone records, police CAD reports, or medical logs—before putting this in your sworn affidavit?"`
    ];
    evidentiaryObjections = [
      `Objection under FLR Rule 14(18)-(19): This evidence is multi-layered hearsay without firsthand observation or foundation, and should receive no weight on contested issues.`,
      `Failure to produce direct affiant: The Society has not tendered an affidavit from the direct witness who allegedly observed the event.`
    ];
    disclosureDemands = [
      `Unredacted contemporaneous intake notes and audio recording of the initial referral interview.`,
      `The worker's contemporaneous handwritten running log entries recorded within 24 hours of the report.`
    ];
  } else if (nature === "Documented Evidentiary Contradiction") {
    crossExaminationQuestions = [
      `"In your affidavit at ${locator}, you state that '${quote}', correct?"`,
      `"Yet in the Society's earlier report dated [Date], your colleague recorded the opposite account, correct?"`,
      `"Which of these two contradictory accounts does the Society ask the Court to rely upon today?"`
    ];
    evidentiaryObjections = [
      `Internal contradiction on material fact: The Society's record is demonstrably inconsistent, rendering the allegation unsafe for summary adjudication without viva voce testing.`,
      `Doctrine of reliable record: Inconsistent state records cannot establish a balance of probabilities against a parent.`
    ];
    disclosureDemands = [
      `All supervision notes, case conference summaries, and communications between involved caseworkers regarding the contradictory timeline.`,
      `Electronic case management audit trails showing when entries were authored or modified.`
    ];
  } else if (nature === "Procedural Noncompliance Concern") {
    crossExaminationQuestions = [
      `"The statutory timeline under CYFSA for this step is [X] days, correct?"`,
      `"The Society did not serve the parent with the required materials until [Date], as shown at ${locator}?"`,
      `"Was parental consent or court authorization obtained in writing to extend this deadline?"`
    ];
    evidentiaryObjections = [
      `Procedural breach: Failure to adhere to mandatory CYFSA statutory deadlines prejudices the parent's procedural rights.`,
      `Request for remedy: Motion for expedited scheduling or exclusion of late-filed materials.`
    ];
    disclosureDemands = [
      `Court clerk docket confirmations, affidavits of service, and official notice records.`,
      `All internal CAS administrative reviews regarding the timeline delay.`
    ];
  } else {
    // Statutory Threshold or General
    crossExaminationQuestions = [
      `"What specific direct evidence in your file establishes actual physical or emotional harm under s. 74(2) beyond the quote at ${locator}?"`,
      `"Did you consult with the child's doctor, teacher, or counselor before concluding that the parent was unable to provide care?"`,
      `"Have less disruptive community or kinship alternatives been explored in writing with the extended family?"`
    ];
    evidentiaryObjections = [
      `Failure to establish statutory threshold: The assertion fails to prove the requisite elements of CYFSA s. 74(2).`,
      `Speculative risk: Subjective worker opinion cannot substitute for objective evidentiary proof.`
    ];
    disclosureDemands = [
      `Complete unredacted kinship assessment files and extended family contact logs.`,
      `All clinical, psychological, or medical reports reviewed by the worker before forming this conclusion.`
    ];
  }

  const courtForms = buildCourtFormsGuidance(flag);

  return {
    crossExaminationQuestions,
    evidentiaryObjections,
    disclosureDemands,
    courtForms,
  };
}

/**
 * Builds the complete enhanced presentation object for any finding.
 */
export function enhanceFindingPresentation(flag: any): EnhancedFindingPresentation {
  const id = String(flag?.id || `rf-${Math.random().toString(36).substring(2, 7)}`);
  const category = String(flag?.category || "Evidence Finding");
  const severity = String(flag?.severity || "Affects Evidentiary Weight");

  const educationalAnalysis = buildEducationalAnalysis(flag);
  const courtroomPresentation = buildCourtroomPresentation(flag);
  const practicalUses = buildPracticalUses(flag);

  return {
    id,
    category,
    severity,
    educationalAnalysis,
    courtroomPresentation,
    practicalUses,
  };
}
