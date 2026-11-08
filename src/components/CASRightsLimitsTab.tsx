import React, { useMemo, useState } from "react";
import { Link } from "wouter";

type Topic = { slug:string; title:string; concern:string; rights:string; limits:string; evidence:string };
const topics: Topic[] = [
  {slug:"mental-health",title:"Mental health",concern:"Current symptoms may affect supervision or the child's wellbeing.",rights:"A diagnosis is not itself a protection finding. Show current functioning, supports and accommodations.",limits:"CAS must connect the child's circumstances to a statutory ground; psychiatric history alone does not establish one.",evidence:"Caregiving observations, child impact, clinical records lawfully obtained, safety supports."},
  {slug:"substance-use",title:"Drug and alcohol use",concern:"Impairment, unsafe storage or substance-related neglect can create a safety concern.",rights:"Present evidence of safe care, treatment and reliable sober caregivers where appropriate.",limits:"Past use or a positive test alone does not resolve whether a child meets a statutory protection ground.",evidence:"Dated incidents, child exposure, supervision, treatment and protective arrangements."},
  {slug:"physical-abuse",title:"Physical abuse",concern:"Actual or likely physical harm can trigger protection proceedings.",rights:"Seek counsel, obtain records and respond to specific allegations without pressuring witnesses.",limits:"CAS must distinguish a report or suspicion from a judicial finding; urgent statutory powers may still apply.",evidence:"Injury records, medical opinions, photographs, witnesses, chronology and competing accounts."},
  {slug:"sexual-abuse",title:"Sexual abuse & exploitation",concern:"Actual or likely sexual abuse or exploitation requires careful protective assessment.",rights:"An accused parent retains procedural protections; a non-offending parent can document protective measures.",limits:"Avoid treating allegations as proven guilt, but do not minimize risk or interfere with a child's disclosure.",evidence:"Specialist interviews, disclosures, medical records when relevant, protective steps and independent evidence."},
  {slug:"domestic-violence",title:"Domestic violence",concern:"Violence, coercion or child exposure may raise protection concerns.",rights:"A survivor can present realistic protective actions, support arrangements and evidence of the perpetrator's conduct.",limits:"Being victimized is not equivalent to perpetrating abuse; CAS must examine child impact and feasible safeguards.",evidence:"Incidents, orders, police records, child exposure and safety planning."},
  {slug:"neglect",title:"Neglect & supervision",concern:"Unmet essential needs, unsafe supervision or patterns of neglect may prompt assessment.",rights:"Explain actual caregiving arrangements and access to community and family supports.",limits:"Poverty, a messy home or an imperfect choice alone is not automatically a statutory finding.",evidence:"Supervision records, child wellbeing, living conditions, referrals and alternatives."},
  {slug:"housing",title:"Housing & poverty",concern:"Housing instability may raise a concern if it creates actual danger or unmet needs.",rights:"Show safe temporary arrangements and requests for housing or financial assistance.",limits:"Financial hardship alone is not the same as neglect; analyze the child's actual circumstances.",evidence:"Housing records, child safety, available services, practical alternatives."},
  {slug:"disability",title:"Disability & accommodations",concern:"CAS may ask whether disability-related needs affect the child's care.",rights:"Request an individualized assessment and appropriate accessible communication or support.",limits:"A disability label alone does not establish parenting incapacity; accommodation duties may apply.",evidence:"Functional evidence, accommodations, support people and actual parenting observations."},
  {slug:"emotional-harm",title:"Emotional harm",concern:"Serious emotional harm or a legally specified risk may be alleged.",rights:"Ask for the precise statutory ground, observed child impact and evidence supporting causation.",limits:"A disagreement, diagnosis or generalized concern is not a substitute for the required statutory elements.",evidence:"Child assessments, reported symptoms, dates, causation and alternative explanations."},
  {slug:"medical-care",title:"Medical care",concern:"A child's unmet medical needs may raise a protection concern.",rights:"Provide care records, second opinions, referrals and reasons for any treatment disagreement.",limits:"A disagreement with a professional does not automatically satisfy a protection ground.",evidence:"Medical records, urgency, treatment access, recommendations and actual child impact."},
  {slug:"education",title:"Education & development",concern:"Serious unmet developmental or educational needs may require assessment.",rights:"Present school communications, service plans, referrals and barriers to obtaining services.",limits:"School concerns must be connected to an applicable statutory ground; attendance issues are not automatically protection findings.",evidence:"Attendance, assessments, accommodation plans and service availability."},
  {slug:"kinship",title:"Kinship & alternative care",concern:"CAS may consider family or community placements when a child cannot safely remain at home.",rights:"Identify suitable relatives and request consideration of less disruptive lawful arrangements.",limits:"Placement decisions are governed by statutory criteria and child safety, not a blanket right to a preferred relative.",evidence:"Relative availability, home suitability, child relationships and safety assessments."},
  {slug:"investigation",title:"Investigations & interviews",concern:"Reports of suspected protection concerns may lead to assessment and interviews.",rights:"Ask for the nature of concerns, seek legal advice and document requests and responses.",limits:"Investigation and entry powers are not unlimited; applicable legal authority and exceptions matter.",evidence:"Referral details, assessment records, consent, notices and interviews."},
  {slug:"safety-plans",title:"Safety plans & consent",concern:"A society may propose a voluntary arrangement to address an identified safety risk.",rights:"Request a written explanation, understand the terms and obtain advice before agreeing where possible.",limits:"A voluntary agreement and a court order have different legal consequences; assess whether consent was informed.",evidence:"Written plan, signatures, duration, safety basis and alternative arrangements."},
  {slug:"removal",title:"Emergency removal",concern:"Urgent danger can trigger warrant or warrantless statutory powers.",rights:"Seek immediate legal advice, obtain the removal documents and record dates and notices.",limits:"Different statutory removal pathways have distinct prerequisites; urgency cannot be presumed in every case.",evidence:"Warrant or statutory authority, facts of urgency, placement, notices and records."},
  {slug:"deadlines",title:"Court deadlines & hearings",concern:"Court applications and protection hearings follow prescribed procedures.",rights:"Track the removal date, application, service, first hearing and orders with counsel.",limits:"Do not treat the filing date as the first hearing or assume every case follows the same deadline.",evidence:"Filed application, endorsements, court notices, orders, service and chronology."},
  {slug:"disclosure",title:"Disclosure & evidence",concern:"CAS may rely on reports, records and sworn evidence in proceedings.",rights:"Ask counsel about disclosure, correcting factual errors and presenting contrary evidence.",limits:"Missing records in an uploaded file do not prove they do not exist in the court record.",evidence:"Affidavits, exhibits, disclosure logs, dates, contradictions and missing documents."},
  {slug:"complaints",title:"Complaints & oversight",concern:"Parents may have concerns about conduct, fairness, privacy or service decisions.",rights:"Identify the appropriate complaint, oversight or court process for the particular issue.",limits:"An administrative complaint does not automatically overturn a court order or suspend deadlines.",evidence:"Correspondence, complaint records, orders, dates and requested remedy."},
  {slug:"other",title:"Other protection grounds",concern:"Other specific statutory grounds may apply to the child's circumstances.",rights:"Ask CAS to identify the exact provision and factual basis for each allegation.",limits:"A general risk label does not replace the applicable legal test.",evidence:"The alleged ground, child impact, dates and corroboration."},
];

// Statutory grounds checked against Ontario e-Laws, CYFSA consolidation current July 1, 2026.
// These are issue-specific entry points, not findings about an individual parent.
type LegalSource = { label: string; url: string; note: string };
const statuteUrl = "https://www.ontario.ca/laws/statute/17c14";
const legalSources: Record<string, LegalSource[]> = {
 "mental-health": [
  {label:"CYFSA s. 74(2)(a), (b), (f)–(i)",url:statuteUrl,note:"Official Ontario e-Laws statute; locate s. 74(2) on the page"},
  {label:"2023 ONCJ 213 — Children's Aid Society of Toronto v. I.L.",url:"https://www.minicounsel.ca/oncj/2023/213",note:"Published judgment reproduction; mental-health concerns were considered alongside evidence of parenting and child needs"}
 ],
 "substance-use": [
  {label:"CYFSA s. 74(2)(a), (b), (f)–(i)",url:statuteUrl,note:"Official Ontario e-Laws statute; applicable grounds depend on the evidence"},
  {label:"2019 ONCJ 916 — Dilico Anishinabek Family Care v. E.J.",url:"https://www.minicounsel.ca/ocj/2019/916",note:"Published judgment reproduction; discusses evidence and the likely-harm test under s. 74(2)(b)(i), not a rule that drug use alone proves harm"}
 ],
 "sexual-abuse": [
  {label:"CYFSA s. 74(2)(c)–(d.2) — sexual abuse, exploitation and trafficking",url:statuteUrl,note:"Official Ontario e-Laws; see each distinct statutory ground"},
  {label:"Windsor-Essex CAS v. E.W., 2020 ONCA 682, paras. 5–7",url:"https://www.minicounsel.ca/oca/2020/682",note:"Published Ontario Court of Appeal judgment; discusses s. 74(2)(c) and the separate best-interests inquiry"}
 ],
 "domestic-violence": [
  {label:"CYFSA s. 74(2)(a)–(b), (f)–(i) — harm and risk",url:statuteUrl,note:"Official Ontario e-Laws; domestic violence is not itself a separately named ground"},
  {label:"Windsor-Essex CAS v. E.W., 2020 ONCA 682, paras. 5–7",url:"https://www.minicounsel.ca/oca/2020/682",note:"Published Ontario Court of Appeal judgment; identifies emotional harm from exposure to domestic violence as potentially relevant"}
 ],
 "neglect": [
  {label:"CYFSA s. 74(2)(a)(i)–(ii), (b)(i)–(ii)",url:statuteUrl,note:"Official Ontario e-Laws; actual physical harm and likely physical harm have different tests"},
  {label:"Windsor-Essex CAS v. E.W., 2020 ONCA 682, paras. 5–7",url:"https://www.minicounsel.ca/oca/2020/682",note:"Published Ontario Court of Appeal judgment; discusses likely harm from inadequate care or patterns of neglect"}
 ],
 "housing": [
  {label:"CYFSA s. 74(2)(a)–(b) — actual or likely physical harm",url:statuteUrl,note:"Official Ontario e-Laws. Housing or poverty is not a standalone child-protection ground; any alleged harm must satisfy the specific statutory elements."},
  {label:"CYFSA s. 74(3) — best interests of the child",url:statuteUrl,note:"Official Ontario e-Laws. Applies when the statute directs a best-interests determination; distinct from the threshold protection-ground inquiry."}
 ],
 "disability": [
  {label:"CYFSA s. 74(2) — statutory protection grounds",url:statuteUrl,note:"Official Ontario e-Laws. A parent's disability alone is not a listed protection ground."},
  {label:"CYFSA s. 74(3)(c)(iii) — disability in best-interests factors",url:statuteUrl,note:"Official Ontario e-Laws. Disability is among the characteristics listed for consideration in the applicable best-interests assessment."},
  {label:"Ontario Human Rights Code",url:"https://www.ontario.ca/laws/statute/90h19",note:"Official Ontario e-Laws. Disability discrimination and accommodation duties depend on the facts and applicable services."}
 ],
 "emotional-harm": [
  {label:"CYFSA s. 74(2)(f) — serious emotional harm",url:statuteUrl,note:"Official Ontario e-Laws. Includes specified serious manifestations and a connection to caregiver actions, omissions or neglect."},
  {label:"CYFSA s. 74(2)(g) — treatment or services for existing harm",url:statuteUrl,note:"Official Ontario e-Laws. Distinct treatment-access ground."},
  {label:"CYFSA s. 74(2)(h)–(i) — likely emotional harm",url:statuteUrl,note:"Official Ontario e-Laws. Distinguishes anticipated harm from anticipated failure to provide services or treatment."}
 ],
 "medical-care": [
  {label:"CYFSA s. 74(2)(j) — child's mental, emotional or developmental condition",url:statuteUrl,note:"Official Ontario e-Laws. Applies to the specific statutory condition and caregiver response; not a general rule covering every medical disagreement."},
  {label:"CYFSA s. 74(2)(a)–(b) — physical harm or likely harm",url:statuteUrl,note:"Official Ontario e-Laws. May be relevant where failure to obtain necessary care meets the statutory harm test."},
  {label:"Health Care Consent Act, 1996",url:"https://www.ontario.ca/laws/statute/96h02",note:"Official Ontario e-Laws. Treatment consent and capacity rules require separate analysis; do not assume a parent can consent for every capable minor."}
 ],
 "education": [
  {label:"CYFSA s. 74(2)(j) — developmental condition and treatment or services",url:statuteUrl,note:"Official Ontario e-Laws. Only applicable where its particular elements are met; not a general truancy provision."},
  {label:"CYFSA s. 74(2)(a)–(b) — harm or likely harm",url:statuteUrl,note:"Official Ontario e-Laws. May apply if facts establish the separate physical-harm tests."},
  {label:"Education Act (Ontario)",url:"https://www.ontario.ca/laws/statute/90e02",note:"Official Ontario e-Laws. School attendance, special education and educational duties require analysis under the applicable education provisions."},
  {label:"CYFSA s. 13(2)(e) — education for a child in care",url:statuteUrl,note:"Official Ontario e-Laws. A right of children in care, distinct from grounds for taking a child into protection."}
 ],
 "kinship": [
  {label:"CYFSA s. 1(2) — least disruptive course and family participation",url:statuteUrl,note:"Official Ontario e-Laws. Statutory purposes favour appropriate less disruptive options, subject to the child's best interests and protection."},
  {label:"CYFSA s. 74(3) — best-interests factors",url:statuteUrl,note:"Official Ontario e-Laws. Includes relationships with relatives and extended family, cultural continuity and proposed care plans where a best-interests decision is required."},
  {label:"CYFSA s. 97 — orders and placement considerations",url:statuteUrl,note:"Official Ontario e-Laws. Read the actual order-making provisions and court-stage conditions before relying on a proposed kinship arrangement."},
  {label:"Ontario Bar Association — What is a Kinship Placement?",url:"https://oba.org/what-is-a-kinship-placement-b6ce6d35e6c253bddd785d6a551021d1/",note:"Secondary legal commentary, not legislation or a court judgment; explains differences between voluntary kinship arrangements and court orders."}
 ],
 "investigation": [
  {label:"CYFSA s. 72 — duty to report protection concerns",url:statuteUrl,note:"Official Ontario e-Laws. A report or referral triggers assessment; it is not a judicial finding."},
  {label:"CYFSA s. 81 — child-protection applications and protective powers",url:statuteUrl,note:"Official Ontario e-Laws. Read the precise subsection for warrants, protective steps and the circumstances of the particular investigation."},
  {label:"CYFSA s. 74(2) — statutory grounds",url:statuteUrl,note:"Official Ontario e-Laws. Identify the specific ground under investigation; an allegation alone does not prove it."}
 ],
 "safety-plans": [
  {label:"CYFSA s. 75 — temporary care agreements",url:statuteUrl,note:"Official Ontario e-Laws. A written temporary care agreement transfers care and custody to the society under specified conditions; it is not equivalent to every informal safety plan."},
  {label:"CYFSA s. 76 — termination of temporary care agreements",url:statuteUrl,note:"Official Ontario e-Laws. Written notice and the statutory response period apply to s. 75 agreements; do not assume the same termination rule applies to an informal plan."},
  {label:"CYFSA s. 77 — agreements with 16- and 17-year-olds",url:statuteUrl,note:"Official Ontario e-Laws. Separate statutory agreement framework; the child's age and participation matter."}
 ],
 "removal": [
  {label:"CYFSA s. 81(2) — warrant to bring a child to safety",url:statuteUrl,note:"Official Ontario e-Laws. For children younger than 16, the statute specifies reasonable and probable grounds and the inadequacy of a less restrictive course."},
  {label:"CYFSA s. 81(7) — bringing a child to safety without a warrant",url:statuteUrl,note:"Official Ontario e-Laws. Distinct warrantless statutory test; read its actual conditions and age restrictions."},
  {label:"CYFSA s. 88 — five-day limit after specified removals",url:statuteUrl,note:"Official Ontario e-Laws. Lists alternative lawful steps within five days; it does not simply say every child must receive a completed hearing within five days."},
  {label:"CYFSA s. 90 — child-protection hearing",url:statuteUrl,note:"Official Ontario e-Laws. Governs a hearing to determine whether a child needs protection."},
  {label:"Anishinaabe Abinoojii Family Services v. S.B.-M., 2024 ONCJ 89",url:"https://www.minicounsel.ca/ocj/2024/89",note:"Published third-party judgment reproduction discussing s. 88 timing and consent disputes. Outcome and subsequent treatment must be independently reviewed before citing it as a rule."}
 ],
 "deadlines": [
 {label:"CYFSA s. 88 — five-day action following specified removals",url:statuteUrl,note:"Official Act. Requires one of the listed steps as soon as practicable and within five days in cases to which s. 88 applies."},
 {label:"CYFSA s. 90 — protection hearing",url:statuteUrl,note:"Official Act. Sets out the court's determination of whether the child needs protection."},
 {label:"Family Law Rules, rule 33 — child-protection timetable",url:"https://www.ontario.ca/laws/regulation/990114",note:"Official current regulation. Distinguishes the first hearing, answers and plans, temporary care hearing, settlement conference and hearing; read extension provisions."},
 {label:"Ontario Court of Justice — child-protection guide",url:"https://www.ontariocourts.ca/ocj/family-court/child-protection/",note:"Official court guidance on stages, court documents and procedure."},
 {label:"Ontario Court Forms — family-law forms",url:"https://ontariocourtforms.on.ca/en/family-law-rules-forms/",note:"Official forms and revision dates; use the current form for the specific step."}
 ],
 "physical-abuse": [
  {label:"CYFSA s. 74(2)(a) — physical harm",url:statuteUrl,note:"Official Ontario e-Laws statute"},
  {label:"CYFSA s. 74(2)(b) — likely physical harm",url:statuteUrl,note:"Official Ontario e-Laws statute"},
  {label:"2019 ONCJ 916 — Dilico Anishinabek Family Care v. E.J.",url:"https://www.minicounsel.ca/ocj/2019/916",note:"Published judgment reproduction; discusses physical harm and likely risk, with citations to other Ontario decisions"}
 ]
};
const reviewedGrounds: Record<string, {grounds: string; procedure: string; review: string}> = {
 "mental-health": {
  grounds:"A parent's mental-health diagnosis is not itself listed as a standalone protection ground. Where evidence supports it, the relevant grounds may concern physical harm or likely physical harm (s. 74(2)(a)–(b)), or specified serious emotional harm or risk (s. 74(2)(f)–(i)). Section 74(2)(j) concerns a condition of the CHILD and access to treatment, not merely a parent's diagnosis.",
  procedure:"Identify the particular pleaded paragraph and evidence of the child's actual harm or legally specified risk. Compare parenting observations, support arrangements and available services. Do not infer incapacity from treatment history alone.",
  review:"Statutory mapping reviewed against Ontario e-Laws (2026-11-08). Published judgment link checked; pinpoint paragraphs and precedential treatment not yet verified."
 },
 "substance-use": {
  grounds:"Substance use is not a standalone paragraph in s. 74(2). Depending on the facts, physical harm or likely harm through inadequate care, supervision or neglect may engage s. 74(2)(a)–(b); serious emotional harm or risk may engage s. 74(2)(f)–(i). These provisions require their own factual elements.",
  procedure:"Check whether there is evidence of impairment affecting supervision, unsafe exposure or unmet needs, and whether sober caregivers or other safeguards address the alleged risk. A test result is evidence to evaluate, not itself a protection order.",
  review:"Statutory mapping reviewed against Ontario e-Laws (2026-11-08). Published judgment link checked; pinpoint paragraphs and precedential treatment not yet verified."
 },
 "sexual-abuse": {
  grounds:"Section 74(2)(c) concerns sexual abuse or exploitation by a person having charge of the child, or by another person when the caregiver knows or should know of the possibility and fails to protect the child. Section 74(2)(d) addresses the corresponding likelihood of future abuse or exploitation. Sections 74(2)(d.1)–(d.2) separately address child sex trafficking and its risk.",
  procedure:"Determine which specific paragraph is alleged and whether the concern involves an alleged perpetrator, a caregiver's failure to protect, or trafficking. Protect the child and preserve independent evidence; do not coach or repeatedly question the child. Seek counsel about disclosure and protective orders.",
  review:"Statutory text and Ontario Court of Appeal reference checked (2026-11-08); judgment linked to published reproduction, not an official court-hosted copy."
 },
 "domestic-violence": {
  grounds:"Domestic violence is not a separately enumerated s. 74(2) ground. Depending on the evidence, physical harm or likely harm may engage s. 74(2)(a)–(b), and serious emotional harm or risk may engage s. 74(2)(f)–(i). The legal test concerns the child's circumstances, not a presumption that a victimized parent caused harm.",
  procedure:"Identify the alleged acts, child's exposure or impact, protective actions and feasible supports. Distinguish the alleged perpetrator from a survivor. Ask which specific protection ground is pleaded and whether the statutory elements are supported.",
  review:"Statutory text and Ontario Court of Appeal reference checked (2026-11-08); case link is a published reproduction."
 },
 "neglect": {
  grounds:"Sections 74(2)(a)(i)–(ii) concern physical harm from inadequate care, provision, supervision or protection, or a pattern of neglect. Sections 74(2)(b)(i)–(ii) address a risk of likely physical harm under corresponding circumstances. Other grounds can apply where their separate elements are established.",
  procedure:"Compare actual child needs, supervision, health, living conditions and dated incidents against the precise allegation. Document available supports and reasonable alternatives. Do not treat poverty alone as proof of neglect.",
  review:"Statutory text and Ontario Court of Appeal reference checked (2026-11-08); case link is a published reproduction."
 },
 "housing": {
  grounds:"Housing instability or low income is not a standalone ground under s. 74(2). If housing conditions allegedly cause physical harm or make it likely, CAS must identify the relevant elements under s. 74(2)(a) or (b), including inadequate care, supervision or protection or a pattern of neglect. Section 74(3) addresses best-interests decisions and is not itself a protection ground.",
  procedure:"Identify the alleged unsafe condition and its effect on the child. Document rent or housing applications, temporary safe accommodation, financial assistance requests, community supports and practical alternatives. Ask which exact ground is alleged rather than assuming poverty proves neglect.",
  review:"Statutory text checked against Ontario e-Laws (2026-11-08). No topic-specific court holding has been verified."
 },
 "disability": {
  grounds:"A parent's disability is not a standalone ground in s. 74(2). CAS must identify evidence satisfying an applicable child-protection ground rather than infer risk from diagnosis or disability. Section 74(3)(c)(iii) lists disability among characteristics relevant to best-interests assessments when that test applies. Human-rights accommodation issues require their own contextual analysis.",
  procedure:"Identify any communication, accessibility or service barriers; request appropriate accommodations; document actual parenting capacity with supports. Distinguish a child's disability and unmet treatment needs from a parent's disability. Obtain legal advice on any discrimination or procedural fairness issue.",
  review:"CYFSA and Ontario Human Rights Code sources checked (2026-11-08). No topic-specific court holding has been verified."
 },
 "emotional-harm": {
  grounds:"Section 74(2)(f) requires serious emotional harm manifested by specified symptoms, with reasonable grounds linking the harm to caregiver action, inaction or neglect. Section 74(2)(g) addresses failures to provide services or treatment for existing harm. Sections 74(2)(h) and (i) concern likely future emotional harm and distinguish caregiver conduct from treatment or service failures.",
  procedure:"Identify the precise pleaded paragraph, the child's symptoms and severity, the causal basis, any professional assessment, available treatment and alternative explanations. Do not treat ordinary distress, disagreement or an allegation as automatically meeting the statutory test.",
  review:"Statutory text checked against Ontario e-Laws (2026-11-08). No topic-specific court holding has been verified."
 },
 "medical-care": {
  grounds:"Section 74(2)(j) concerns a child's mental, emotional or developmental condition that could seriously impair development, together with the caregiver's failure to provide or consent to treatment or services as specified by the Act. Physical harm or likely physical harm from inadequate care may separately engage s. 74(2)(a)–(b). Not every disagreement over a treatment plan is a child-protection ground. Treatment consent is governed by its own legal rules.",
  procedure:"Obtain the exact diagnosis or clinical concern, recommended care, urgency, informed-consent records, referrals, access barriers, second opinions and evidence of actual child impact. Identify whether the dispute concerns capacity, consent, availability or neglect. Seek legal advice urgently where a child faces immediate danger.",
  review:"Official CYFSA and Health Care Consent Act links supplied. No case-specific judicial holding has been verified; section-level anchors remain unverified."
 },
 "education": {
  grounds:"Poor grades, missed school or a disability do not automatically establish a CYFSA protection ground. Section 74(2)(j) can be relevant to a qualifying child's mental, emotional or developmental condition and the statutory treatment or services requirements. Sections 74(2)(a)–(b) require their separate physical-harm elements. The Education Act governs school obligations, while CYFSA s. 13(2)(e) addresses education for a child already in care.",
  procedure:"Review attendance and school communications, learning assessments, individualized education plans, accommodation requests, service referrals, transportation or access barriers, and actual developmental impact. Keep school-law remedies separate from a child-protection court application.",
  review:"Official CYFSA and Education Act links supplied. No topic-specific court decision or pinpoint section anchors have been verified."
 },
 "kinship": {
  grounds:"Kinship placement is an alternative care option, not itself a s. 74(2) protection ground. CYFSA s. 1(2) calls for consideration of the least disruptive appropriate course and family involvement. Section 74(3) addresses family relationships and continuity when a best-interests decision is required. The legal effect of a voluntary kinship arrangement differs from a protection order or placement with a society.",
  procedure:"Identify willing relatives, their relationship to the child, location, safety and capacity to care, existing cultural or community ties, and any proposed supervision or support. Ask CAS to explain which legal arrangement is proposed, who holds decision-making authority, whether it is voluntary, and how review or return home works. Get advice before signing an agreement.",
  review:"Official CYFSA source and separately identified secondary Ontario Bar Association commentary linked. A specific court judgment has not yet been verified."
 },
 "investigation": {
  grounds:"A duty to report suspected child-protection concerns under CYFSA s. 72 is distinct from a finding that a child needs protection under s. 74(2). Section 81 provides court-application and protective powers, subject to its separate requirements. A home visit, interview, request for records, court order and urgent protective action do not all rest on the same legal authority.",
  procedure:"Ask which protection concern and legal authority apply; distinguish a voluntary interview or visit from an action supported by a warrant or other statutory power. Record dates, persons present, requests for consent, documents provided and any written notices. Seek counsel promptly before refusing a lawful direction or signing a substantive agreement. Preserve the child's independent account; do not coach witnesses.",
  review:"CYFSA ss. 72, 74 and 81 cross-referenced to official Ontario e-Laws; specific entry/interview powers and any judicial case law still require paragraph-level legal review."
 },
 "safety-plans": {
  grounds:"An informal safety plan, a written temporary care agreement under CYFSA s. 75, an agreement with a 16- or 17-year-old under s. 77, and a court order are legally distinct. Section 75 includes conditions for a temporary care agreement and requires a child aged 12 or older to be a party unless the statutory developmental-disability exception applies. Section 76 sets out written termination notice for a s. 75 agreement, including the applicable notice period and the society's obligation to respond.",
  procedure:"Obtain a complete copy of any proposed plan before signing. Identify whether it is voluntary, who has legal care and custody, the precise restrictions, review date, contact arrangements and the route to change or terminate it. Ask what CAS proposes if consent is declined or withdrawn. A s. 75 termination notice does not automatically prevent the society from seeking a protection order if statutory grounds exist.",
  review:"CYFSA ss. 75–77 checked against Ontario e-Laws. No verified judgment is yet linked; informal safety plans must not be presented as having the same statutory termination rights as a s. 75 agreement."
 },
 "removal": {
  grounds:"CYFSA s. 81 distinguishes a court application, a warrant to bring a child under 16 to a place of safety, and specified warrantless powers. The statutory criteria depend on age, urgency, reasonable and probable grounds and whether less restrictive protection is adequate. Section 88 applies after specified removals and requires action as soon as practicable and within five days, with several listed alternatives including a court hearing, return or qualifying agreement. Section 90 concerns the protection hearing. Do not confuse the s. 88 five-day limit with a blanket deadline for every CAS investigation or with the date of final disposition.",
  procedure:"Record the exact date and time of removal, child's age, whether a warrant existed, the specific statutory subsection relied upon, what less restrictive alternatives were considered, the court application date, hearing date, notices, any agreement and all endorsements. Obtain immediate legal advice about available remedies; a timing dispute does not by itself establish that the court lacks jurisdiction or that the child must automatically be returned.",
  review:"CYFSA ss. 81, 88 and 90 cross-checked against Ontario e-Laws. One published decision linked as an example, but its holding, subsequent treatment and applicability remain to be verified."
 },
 "deadlines": {
 grounds:"The CYFSA s. 88 five-day rule applies following specified ways a child is brought to a place of safety; it requires one of the statutory outcomes, not necessarily a final protection trial. Section 90 governs the protection hearing. Family Law Rules r. 33 provides a separate child-protection timetable, including the first hearing, answers and plans of care, temporary care and custody, settlement conference and later hearing. Court extensions and case-specific orders must be examined before alleging a breach.",
 procedure:"Create a dated chronology with the child's age, removal authority, date and time, service, court filing, first hearing, endorsements, adjournments, orders and any consent. Identify which deadline actually applies, whether the court varied it and what remedy is sought. Use current official forms; seek counsel immediately if a hearing is imminent.",
 review:"Official CYFSA, Family Law Rules, Ontario Court of Justice and court forms linked; case-specific procedural effect requires review of actual orders."
 },
 "physical-abuse": {
  grounds:"Section 74(2)(a) addresses physical harm inflicted by a person having charge or caused by that person's inadequate care, supervision, protection or pattern of neglect. Section 74(2)(b) addresses likely future physical harm under corresponding circumstances. The statute distinguishes harm already suffered from risk of likely harm.",
  procedure:"Identify the alleged injury, responsible conduct, chronology and supporting evidence. Compare medical findings, witness accounts and alternative explanations. An investigation or allegation is not the same as a court finding; statutory emergency powers may apply when their tests are met.",
  review:"Statutory grounds checked against Ontario e-Laws (2026-11-08). Published judgment link checked; pinpoint paragraphs and precedential treatment not yet verified."
 }
};

const tabs = ["CAS concern", "Parent rights", "CAS powers & limits", "Evidence", "Court & next steps"] as const;
type Tab = typeof tabs[number];
const resources = [
 {label:"Ontario CYFSA — official statute",url:"https://www.ontario.ca/laws/statute/17c14"},
 {label:"Ontario Court of Justice — child protection",url:"https://www.ontariocourts.ca/ocj/family-court/child-protection/"},
 {label:"Ontario family court forms",url:"https://ontariocourtforms.on.ca/en/family-law-rules-forms/"}
];
export default function CASRightsLimitsTab() {
 const [search,setSearch]=useState("");
 const [selected,setSelected]=useState("mental-health");
 const [tab,setTab]=useState<Tab>("Parent rights");
 const filtered=useMemo(()=>topics.filter(t=>t.title.toLowerCase().includes(search.trim().toLowerCase())),[search]);
 const topic=topics.find(t=>t.slug===selected) ?? topics[0];
 const reviewed=reviewedGrounds[topic.slug];
 const text=tab==="CAS concern"?topic.concern:tab==="Parent rights"?topic.rights:tab==="CAS powers & limits"?topic.limits:tab==="Evidence"?topic.evidence:reviewed?reviewed.procedure:"Identify the exact allegation, statutory ground, court stage and relevant documents. Seek legal advice about deadlines, disclosure and the appropriate response. No case-specific court decision has yet been verified for this topic.";
 return <main id="main-content" className="mx-auto max-w-5xl px-4 sm:px-6 py-6 space-y-4">
  <header className="space-y-1"><h1 className="text-2xl font-bold text-slate-900">CAS Powers, Limits & Parents' Rights</h1><p className="text-sm text-slate-600">Explore common child-protection concerns. These are general explanations, not findings about your case or legal advice.</p></header>
  <div className="space-y-1"><label htmlFor="cas-topic-search" className="block text-sm font-semibold text-slate-700">Find a topic</label><input id="cas-topic-search" type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search topics" className="w-full max-w-md rounded-lg border border-slate-300 px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-blue-700" /></div>
  <nav aria-label="CAS concern topics" className="flex flex-wrap gap-2">{filtered.map(t=><button key={t.slug} type="button" aria-pressed={selected===t.slug} onClick={()=>{setSelected(t.slug);setTab("Parent rights")}} className={`rounded-full border px-3 py-1.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 ${selected===t.slug?"bg-slate-900 text-white border-slate-900":"bg-white text-slate-700 border-slate-300 hover:bg-slate-100"}`}>{t.title}</button>)}{filtered.length===0&&<span className="text-sm text-slate-600">No matching topics.</span>}</nav>
  <section aria-labelledby="cas-selected-heading" className="rounded-xl border border-slate-200 p-4 space-y-4">
   <h2 id="cas-selected-heading" className="text-lg font-bold">{topic.title}</h2>
   <div aria-label="Topic sections" className="flex flex-wrap gap-2 border-b border-slate-200 pb-2">{tabs.map(t=><button key={t} type="button" aria-pressed={tab===t} onClick={()=>setTab(t)} className={`rounded-md px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-blue-700 ${tab===t?"bg-blue-100 text-blue-900 font-semibold":"text-slate-700 hover:bg-slate-100"}`}>{t}</button>)}</div>
   <p className="min-h-16 text-sm leading-6 text-slate-800" aria-live="polite">{text}</p>
   {reviewed&&<div className="rounded-lg bg-slate-50 border border-slate-200 p-3 space-y-2 text-sm"><h3 className="font-semibold">Applicable statutory grounds</h3><p>{reviewed.grounds}</p><ul className="space-y-2">{(legalSources[topic.slug]??[]).map(source=><li key={source.label}><a href={source.url} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline font-medium focus-visible:outline-2 focus-visible:outline-blue-700">{source.label} (opens new tab)</a><p className="text-xs text-slate-600">{source.note}</p></li>)}</ul><p className="text-xs text-slate-600">{reviewed.review} Case examples are fact-specific and do not establish an outcome in another case.</p></div>}
   <div className="text-xs text-slate-600 border-t border-slate-200 pt-3"><strong>Legal source status:</strong> {reviewed?"Statutory grounds linked; example published judgments are linked for context, but paragraph-level holdings and subsequent treatment require further review.":"Topic-specific subsections and case-law holdings are pending legal verification."} These sources do not establish that a particular ground applies to your case.</div>
   <details className="border-t border-slate-200 pt-3 text-sm"><summary className="cursor-pointer font-semibold">Official law, court procedure and forms</summary><ul className="mt-2 space-y-2">{resources.map(r=><li key={r.url}><a className="text-blue-700 underline focus-visible:outline-2 focus-visible:outline-blue-700" href={r.url} target="_blank" rel="noopener noreferrer">{r.label} (opens new tab)</a></li>)}</ul></details>
  </section>
  <p className="text-xs text-slate-600">An allegation, an investigation and a court finding are different. Urgent safety concerns require prompt professional assistance.</p>
  <Link href="/cyfsa-guide" className="text-sm font-semibold text-blue-700 underline">Detailed CYFSA guide</Link>
 </main>;
}
