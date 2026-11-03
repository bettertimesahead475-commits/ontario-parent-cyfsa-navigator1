import { classifyCitation, resolveBundledCyfsaKey } from "../../shared/citationVerification";

/**
 * Statute text the analyzer screen may show. Each quotation is copied verbatim from the bundled CYFSA
 * text in legal-reference/CYFSA_full_text_2026-06-24_consolidation.txt. The notes describe only what
 * that text says. A citation with no entry here has no text in the app, and the screen says so.
 * The bundled file's header states a consolidation period from July 1, 2026. The 2026-06-24 in its
 * filename is unverified against e-Laws. That is not resolved here.
 */
export interface BundledStatuteEntry {
  citation: string;
  heading: string;
  text: string;
  note: string;
}

export const STATUTE_ROOT_URL = "https://www.ontario.ca/laws/statute/17c14";

export const BUNDLED_STATUTE_ENTRIES: Record<string, BundledStatuteEntry> = {
  "1(1)": {
    citation: "CYFSA s. 1(1)",
    heading: "Paramount purpose",
    text: "(1)  The paramount purpose of this Act is to promote the best interests, protection and well-being of children.",
    note: "Sets out the paramount purpose of the CYFSA.",
  },
  "1(2)": {
    citation: "CYFSA s. 1(2)",
    heading: "Other purposes",
    text: "(2)  The additional purposes of this Act, so long as they are consistent with the best interests, protection and well-being of children, are to recognize the following:\n  1.  While parents may need help in caring for their children, that help should give support to the autonomy and integrity of the family unit and, wherever possible, be provided on the basis of mutual consent.\n  2.  The least disruptive course of action that is available and is appropriate in a particular case to help a child, including the provision of prevention services, early intervention services and community support services, should be considered.",
    note: "Lists additional statutory purposes subject to consistency with the paramount purpose in subsection (1).",
  },
  "1(2), para. 1": {
    citation: "CYFSA s. 1(2), para. 1",
    heading: "Other purposes — Support to family autonomy and mutual consent",
    text: "1.  While parents may need help in caring for their children, that help should give support to the autonomy and integrity of the family unit and, wherever possible, be provided on the basis of mutual consent.",
    note: "Paragraph 1 of s. 1(2), recognizing support for the autonomy and integrity of the family unit and mutual consent wherever possible.",
  },
  "1(2), para. 2": {
    citation: "CYFSA s. 1(2), para. 2",
    heading: "Other purposes — Least disruptive course of action",
    text: "2.  The least disruptive course of action that is available and is appropriate in a particular case to help a child, including the provision of prevention services, early intervention services and community support services, should be considered.",
    note: "Paragraph 2 of s. 1(2), stating that the least disruptive course of action, including prevention, early intervention, and community support services, should be considered.",
  },
  "2(1)": {
    citation: "CYFSA s. 2(1)",
    heading: "Definitions",
    text: "(1)  In this Act,\n“agency” means a corporation; (“agence”)\n“band” has the same meaning as in the Indian Act (Canada); (“bande”)\n“Board” means the Child and Family Services Review Board continued under section 333; (“Commission”)\n“child” means a person younger than 18; (“enfant”)",
    note: "General definitions applicable across the CYFSA.",
  },
  "3": {
    citation: "CYFSA s. 3",
    heading: "Rights of children, young persons receiving services",
    text: "Every child and young person receiving services under this Act has the following rights:\n  1.  To express their own views freely and safely about matters that affect them.\n  2.  To be engaged through an honest and respectful dialogue about how and why decisions affecting them are made and to have their views given due weight, in accordance with their age and maturity.\n  3.  To be consulted on the nature of the services provided or to be provided to them, to participate in decisions about the services provided or to be provided to them and to be advised of the decisions made in respect of those services.\n  4.  To raise concerns or recommend changes with respect to the services provided or to be provided to them without interference or fear of coercion, discrimination or reprisal and to receive a response to their concerns or recommended changes.\n  5.  To be informed, in language suitable to their understanding, of their rights under this Part.",
    note: "Part II rights of every child and young person receiving services under the CYFSA.",
  },
  "9.1": {
    citation: "CYFSA s. 9.1",
    heading: "Right to be informed — Ombudsman",
    text: "A child in care has a right to be informed in language suitable to their understanding, of the information described in subsection 14.0.1 (1) of the Ombudsman Act. 2024, c. 17, s. 2.",
    note: "Enacted by S.O. 2024, c. 17, s. 2 (in force July 1, 2024), establishing a child in care's right to be informed regarding the Ombudsman.",
  },
  "13(1)": {
    citation: "CYFSA s. 13(1)",
    heading: "Right to plan of care",
    text: "(1)  A child in care has a right to a plan of care designed to meet their particular needs, which shall be prepared within 30 days of the child’s or young person’s admission to the residential placement.",
    note: "Requires an individual plan of care within 30 days of a child's admission to a residential placement.",
  },
  "35(1)": {
    citation: "CYFSA s. 35(1)",
    heading: "Functions of society",
    text: "(1)  The functions of a children’s aid society are to,\n  (a)  investigate allegations or evidence that children may be in need of protection;\n  (b)  protect children where necessary;\n  (c)  provide guidance, counselling and other services to families for protecting children or for the prevention of circumstances requiring the protection of children;\n  (d)  provide care for children assigned or committed to its care under this Act;\n  (e)  supervise children assigned to its supervision under this Act;\n  (f)  place children for adoption under Part VIII (Adoption and Adoption Licensing); and\n  (g)  perform any other duties given to it by this Act or the regulations or any other Act.",
    note: "Defines the statutory functions of a children's aid society, including clause (c) guidance, counselling and prevention services to families.",
  },
  "72": {
    citation: "CYFSA s. 72",
    heading: "Duty to consult bands and First Nations, Inuit or Métis communities",
    text: "A society, person or entity that provides services or exercises powers under this Act with respect to First Nations, Inuit or Métis children or young persons shall regularly consult with their bands and First Nations, Inuit or Métis communities about the provision of the services or the exercise of the powers and about matters affecting the children or young persons, including,\n  (a)  bringing children to a place of safety and the placement of children in residential care;\n  (b)  the provision of family support services;\n  (c)  the preparation of plans for the care of children;\n  (d)  status reviews under Part V (Child Protection);\n  (e)  temporary care agreements under Part V (Child Protection);\n  (f)  society agreements with 16 and 17 year olds under Part V (Child Protection);\n  (g)  adoption placements;\n  (h)  the establishment of emergency houses; and\n  (i)  any other matter that is prescribed.",
    note: "Requires regular consultation with bands and First Nations, Inuit or Métis communities on listed matters.",
  },
  "74(1)": {
    citation: "CYFSA s. 74(1)",
    heading: "Interpretation — Child protection definitions",
    text: "(1)  In this Part,\n“child protection worker” means a Director, a local director or a person who meets the prescribed requirements and who is authorized by a Director or local director for the purposes of section 81 (commencing child protection proceedings) and for other prescribed purposes; (“préposé à la protection de l’enfance”)",
    note: "Defines child protection worker, parent, and place of safety for Part V.",
  },
  "74(2)": {
    citation: "CYFSA s. 74(2)",
    heading: "Child in need of protection",
    text: "(2)  A child is in need of protection where,\n  (a)  the child has suffered physical harm, inflicted by the person having charge of the child or caused by or resulting from that person’s,\n  (i)  failure to adequately care for, provide for, supervise or protect the child, or\n  (ii)  pattern of neglect in caring for, providing for, supervising or protecting the child;\n  (b)  there is a risk that the child is likely to suffer physical harm inflicted by the person having charge of the child or caused by or resulting from that person’s,\n  (i)  failure to adequately care for, provide for, supervise or protect the child, or\n  (ii)  pattern of neglect in caring for, providing for, supervising or protecting the child;\n  (c)  the child has been sexually abused or sexually exploited, by the person having charge of the child or by another person where the person having charge of the child knows or should know of the possibility of sexual abuse or sexual exploitation and fails to protect the child;\n  (d)  there is a risk that the child is likely to be sexually abused or sexually exploited as described in clause (c);\n  (d.1)  the child has been sexually exploited as a result of being subjected to child sex trafficking;\n  (d.2)  there is a risk that the child is likely to be sexually exploited as a result of being subjected to child sex trafficking;\n  (e)  the child requires treatment to cure, prevent or alleviate physical harm or suffering and the child’s parent or the person having charge of the child does not provide the treatment or access to the treatment, or, where the child is incapable of consenting to the treatment under the *Health Care Consent Act, 1996 *and the parent is a substitute decision-maker for the child, the parent refuses or is unavailable or unable to consent to the treatment on the child’s behalf;\n  (f)  the child has suffered emotional harm, demonstrated by serious,\n  (i)  anxiety,\n  (ii)  depression,\n  (iii)  withdrawal,\n  (iv)  self-destructive or aggressive behaviour, or\n  (v)  delayed development,\n    and there are reasonable grounds to believe that the emotional harm suffered by the child results from the actions, failure to act or pattern of neglect on the part of the child’s parent or the person having charge of the child;\n  (g)  the child has suffered emotional harm of the kind described in subclause (f) (i), (ii), (iii), (iv) or (v) and the child’s parent or the person having charge of the child does not provide services or treatment or access to services or treatment, or, where the child is incapable of consenting to treatment under the Health Care Consent Act, 1996, refuses or is unavailable or unable to consent to the treatment to remedy or alleviate the harm;\n  (h)  there is a risk that the child is likely to suffer emotional harm of the kind described in subclause (f) (i), (ii), (iii), (iv) or (v) resulting from the actions, failure to act or pattern of neglect on the part of the child’s parent or the person having charge of the child;\n  (i)  there is a risk that the child is likely to suffer emotional harm of the kind described in subclause (f) (i), (ii), (iii), (iv) or (v) and that the child’s parent or the person having charge of the child does not provide services or treatment or access to services or treatment, or, where the child is incapable of consenting to treatment under the Health Care Consent Act, 1996, refuses or is unavailable or unable to consent to treatment to prevent the harm;\n  (j)  the child suffers from a mental, emotional or developmental condition that, if not remedied, could seriously impair the child’s development and the child’s parent or the person having charge of the child does not provide treatment or access to treatment, or where the child is incapable of consenting to treatment under the Health Care Consent Act, 1996, refuses or is unavailable or unable to consent to the treatment to remedy or alleviate the condition;\n  (k)  the child’s parent has died or is unavailable to exercise the rights of custody over the child and has not made adequate provision for the child’s care and custody, or the child is in a residential placement and the parent refuses or is unable or unwilling to resume the child’s care and custody;\n  (l)  the child is younger than 12 and has killed or seriously injured another person or caused serious damage to another person’s property, services or treatment are necessary to prevent a recurrence and the child’s parent or the person having charge of the child does not provide services or treatment or access to services or treatment, or, where the child is incapable of consenting to treatment under the Health Care Consent Act, 1996, refuses or is unavailable or unable to consent to treatment;\n  (m)  the child is younger than 12 and has on more than one occasion injured another person or caused loss or damage to another person’s property, with the encouragement of the person having charge of the child or because of that person’s failure or inability to supervise the child adequately;\n  (n)  the child’s parent is unable to care for the child and the child is brought before the court with the parent’s consent and, where the child is 12 or older, with the child’s consent, for the matter to be dealt with under this Part; or\n  (o)  the child is 16 or 17 and a prescribed circumstance or condition exists. 2017, c. 14, Sched. 1, s. 74 (2); 2020, c. 25, Sched. 1, s. 26 (1); 2021, c. 21, Sched. 3, s. 1 (2).",
    note: "Lists the grounds in clauses (a) to (o). The clauses are shown in full.",
  },
  "74(3)": {
    citation: "CYFSA s. 74(3)",
    heading: "Best interests of child",
    text: "(3)  Where a person is directed in this Part to make an order or determination in the best interests of a child, the person shall,\n  (a)  consider the child’s views and wishes, given due weight in accordance with the child’s age and maturity, unless they cannot be ascertained;\n  (b)  in the case of a First Nations, Inuk or Métis child, consider the importance, in recognition of the uniqueness of First Nations, Inuit and Métis cultures, heritages and traditions, of preserving the child’s cultural identity and connection to community, in addition to the considerations under clauses (a) and (c); and\n  (c)  consider any other circumstance of the case that the person considers relevant, including,\n  (i)  the child’s physical, mental and emotional needs, and the appropriate care or treatment to meet those needs,\n  (ii)  the child’s physical, mental and emotional level of development,\n  (iii)  the child’s race, ancestry, place of origin, colour, ethnic origin, citizenship, family diversity, disability, creed, sex, sexual orientation, gender identity and gender expression,\n  (iv)  the child’s cultural and linguistic heritage,\n  (v)  the importance for the child’s development of a positive relationship with a parent and a secure place as a member of a family,\n  (vi)  the child’s relationships and emotional ties to a parent, sibling, relative, other member of the child’s extended family or member of the child’s community,\n  (vii)  the importance of continuity in the child’s care and the possible effect on the child of disruption of that continuity,\n  (viii)  the merits of a plan for the child’s care proposed by a society, including a proposal that the child be placed for adoption or adopted, compared with the merits of the child remaining with or returning to a parent,\n  (ix)  the effects on the child of delay in the disposition of the case,\n  (x)  the risk that the child may suffer harm through being removed from, kept away from, returned to or allowed to remain in the care of a parent, and\n  (xi)  the degree of risk, if any, that justified the finding that the child is in need of protection. 2017, c. 14, Sched. 1, s. 74 (3).",
    note: "Sets out the mandatory best-interests factors for orders and determinations under Part V.",
  },
  "78": {
    citation: "CYFSA s. 78",
    heading: "Legal representation of child",
    text: "(1)  A child may have legal representation at any stage in a proceeding under this Part.",
    note: "Governs legal representation of a child in a Part V proceeding.",
  },
  "78(1)": {
    citation: "CYFSA s. 78(1)",
    heading: "Legal representation of child",
    text: "(1)  A child may have legal representation at any stage in a proceeding under this Part.",
    note: "Provides that a child may have legal representation at any stage in a Part V proceeding.",
  },
  "78(4)": {
    citation: "CYFSA s. 78(4)",
    heading: "Legal representation of child — Criteria",
    text: "(4)  Where,\n  (a)  the court is of the opinion that there is a difference of views between the child and a parent or a society, and the society proposes that the child be removed from a person’s care or be placed in interim or extended society care under paragraph 2 or 3 of subsection 101 (1);\n  (b)  the child is in the society’s care and,\n  (i)  no parent appears before the court, or\n  (ii)  it is alleged that the child is in need of protection within the meaning of clause 74 (2) (a), (c), (f), (g) or (j); or\n  (c)  the child is not permitted to be present at the hearing,\nlegal representation is deemed to be desirable to protect the child’s interests, unless the court is satisfied, taking into account the child’s views and wishes, given due weight in accordance with the child’s age and maturity, that the child’s interests are otherwise adequately protected.",
    note: "Sets out when legal representation for the child is deemed desirable unless the court is satisfied the child's interests are otherwise adequately protected.",
  },
  "81(1)": {
    citation: "CYFSA s. 81(1)",
    heading: "Application to determine whether child is in need of protection",
    text: "(1)  A society may apply to the court to determine whether a child is in need of protection.",
    note: "Authorizes a society to apply to the court for a child protection determination. Does not itself authorize warrantless removal.",
  },
  "81(2)": {
    citation: "CYFSA s. 81(2)",
    heading: "Warrant to bring child to place of safety",
    text: "(2)  A justice of the peace may issue a warrant authorizing a child protection worker to bring a child to a place of safety if the justice of the peace is satisfied on the basis of a child protection worker’s sworn information that there are reasonable and probable grounds to believe that,\n  (a)  the child is younger than 16;\n  (b)  the child is in need of protection; and\n  (c)  a less restrictive course of action is not available or will not protect the child adequately.",
    note: "Sets out the three-part test for a warrant to bring a child younger than 16 to a place of safety.",
  },
  "81(7)": {
    citation: "CYFSA s. 81(7)",
    heading: "Warrantless apprehension",
    text: "(7)  A child protection worker who believes on reasonable and probable grounds that,\n  (a)  a child is in need of protection;\n  (b)  the child is younger than 16; and\n  (c)  there would be a substantial risk to the child’s health or safety during the time necessary to bring the matter on for a hearing under subsection 90 (1) or obtain a warrant under subsection (2),\nmay without a warrant bring the child to a place of safety.",
    note: "Applies only to a child younger than 16, and only where a substantial risk would arise before a hearing or warrant could be obtained.",
  },
  "81(12)": {
    citation: "CYFSA s. 81(12)",
    heading: "Peace officer has powers of child protection worker",
    text: "(12)  Subsections (2), (6), (7), (10) and (11) apply to a peace officer as if the peace officer were a child protection worker.",
    note: "Applies the specified subsections of s. 81 to a peace officer as if the peace officer were a child protection worker.",
  },
  "81(13)": {
    citation: "CYFSA s. 81(13)",
    heading: "Protection from personal liability",
    text: "(13)  No action shall be instituted against a peace officer or child protection worker for any act done in good faith in the execution or intended execution of that person’s duty under this section or for an alleged neglect or default in the execution in good faith of that duty.",
    note: "Good-faith protection from personal liability for acts or alleged neglect or default under s. 81.",
  },
  "88": {
    citation: "CYFSA s. 88",
    heading: "Time in place of safety limited",
    text: "As soon as practicable, but in any event within five days after a child is brought to a place of safety under section 81, subclause 83 (1) (a) (ii) or subsection 136 (5),\n  (a)  the matter shall be brought before a court for a hearing under subsection 90 (1) (child protection hearing);\n  (b)  the child shall be returned to the person who last had charge of the child or, where there is an order for the child’s custody that is enforceable in Ontario, to the person entitled to custody under the order;\n  (c)  if the child is the subject of an extra-provincial child protection order, the child shall be returned to the child welfare authority or other person named in the order;\n  (d)  a temporary care agreement shall be made under subsection 75 (1); or\n  (e)  an agreement shall be made under section 77 (agreements with 16 and 17 year olds).",
    note: "The five-day rule. It is a different section from s. 94, which deals with adjournments.",
  },
  "90(1)": {
    citation: "CYFSA s. 90(1)",
    heading: "Child protection hearing",
    text: "(1)  Where an application is made under subsection 81 (1) or a matter is brought before the court to determine whether the child is in need of protection, the court shall hold a hearing to determine the issue and make an order under section 101.",
    note: "Requires the court to hold a child protection hearing and make an order under s. 101.",
  },
  "94(1)": {
    citation: "CYFSA s. 94(1)",
    heading: "Adjournment limit",
    text: "(1)  The court shall not adjourn a hearing for more than 30 days,\n  (a)  unless all the parties present and the person who will be caring for the child during the adjournment consent; or\n  (b)  if the court is aware that a party who is not present at the hearing objects to the longer adjournment.",
    note: "Limits how long a hearing may be adjourned. This is not the five-day rule, which is s. 88.",
  },
  "94(2)": {
    citation: "CYFSA s. 94(2)",
    heading: "Temporary care and custody during an adjournment",
    text: "(2)  Where a hearing is adjourned, the court shall make a temporary order for care and custody providing that the child,\n  (a)  remain in or be returned to the care and custody of the person who had charge of the child immediately before intervention under this Part;\n  (b)  remain in or be returned to the care and custody of the person referred to in clause (a), subject to the society’s supervision and on such reasonable terms and conditions as the court considers appropriate;\n  (c)  be placed in the care and custody of a person other than the person referred to in clause (a), with the consent of that other person, subject to the society’s supervision and on such reasonable terms and conditions as the court considers appropriate; or\n  (d)  remain or be placed in the care and custody of the society, but not be placed in a place of temporary detention, of open or of secure custody.",
    note: "The court must make one of the temporary orders in clauses (a) to (d). Clauses (c) and (d) are limited by subsection (4).",
  },
  "94(4)": {
    citation: "CYFSA s. 94(4)",
    heading: "Criteria for temporary removal during adjournment",
    text: "(4)  The court shall not make an order under clause (2) (c) or (d) unless the court is satisfied that there are reasonable grounds to believe that there is a risk that the child is likely to suffer harm and that the child cannot be protected adequately by an order under clause (2) (a) or (b).",
    note: "Prohibits temporary third-party or society custody during an adjournment unless the court is satisfied the child cannot be protected adequately under clause (2)(a) or (b).",
  },
  "94(6)": {
    citation: "CYFSA s. 94(6)",
    heading: "Terms and conditions in temporary order",
    text: "(6)  A temporary order for care and custody of a child under clause (2) (b) or (c) may impose,\n  (a)  reasonable terms and conditions relating to the child’s care and supervision;\n  (b)  reasonable terms and conditions on the child’s parent, the person who will have care and custody of the child under the order, the child and any other person, other than a foster parent, who is putting forward a plan or who would participate in a plan for care and custody of or access to the child; and\n  (c)  reasonable terms and conditions on the society that will supervise the placement, but shall not require the society to provide financial assistance or to purchase any goods or services.",
    note: "Authorizes reasonable terms on a temporary supervision order, while clause (c) provides that the order shall not require the society to provide financial assistance or to purchase any goods or services.",
  },
  "100": {
    citation: "CYFSA s. 100",
    heading: "Society's plan for child",
    text: "The court shall, before making an order under section 101, 102, 114 or 116, obtain and consider a plan for the child’s care prepared in writing by the society and including,\n  (a)  a description of the services to be provided to remedy the condition or situation on the basis of which the child was found to be in need of protection;\n  (b)  a statement of the criteria by which the society will determine when its care or supervision is no longer required;\n  (c)  an estimate of the time required to achieve the purpose of the society’s intervention;\n  (d)  where the society proposes to remove or has removed the child from a person’s care,\n  (i)  an explanation of why the child cannot be adequately protected while in the person’s care, and a description of any past efforts to do so, and\n  (ii)  a statement of what efforts, if any, are planned to maintain the child’s contact with the person;\n  (e)  where the society proposes to remove or has removed the child from a person’s care permanently, a description of the arrangements made or being made for the child’s long-term stable placement; and\n  (f)  a description of the arrangements made or being made to recognize the importance of the child’s culture and to preserve the child’s heritage, traditions and cultural identity.",
    note: "Requires the court to obtain and consider a written plan of care from the society containing clauses (a) to (f) before making an order under s. 101, 102, 114, or 116.",
  },
  "101(1)": {
    citation: "CYFSA s. 101(1)",
    heading: "Order where child in need of protection",
    text: "(1)  Where the court finds that a child is in need of protection and is satisfied that intervention through a court order is necessary to protect the child in the future, the court shall make one of the following orders or an order under section 102, in the child’s best interests:",
    note: "Governs disposition orders (supervision, interim society care, extended society care, or consecutive orders) when a child is found in need of protection.",
  },
  "101(1), para. 1": {
    citation: "CYFSA s. 101(1), para. 1",
    heading: "Supervision order",
    text: "1.  That the child be placed in the care and custody of a parent or another person, subject to the supervision of the society, for a specified period of at least three months and not more than 12 months.",
    note: "Paragraph 1 of s. 101(1), governing a supervision order for at least three months and not more than 12 months.",
  },
  "101(2)": {
    citation: "CYFSA s. 101(2)",
    heading: "Court to inquire into efforts to assist child",
    text: "(2)  In determining which order to make under subsection (1) or section 102, the court shall ask the parties what efforts the society or another person or entity has made to assist the child before intervention under this Part.",
    note: "Requires the court to ask the parties what efforts the society or another person or entity made to assist the child before intervention.",
  },
  "101(3)": {
    citation: "CYFSA s. 101(3)",
    heading: "Less disruptive alternatives preferred",
    text: "(3)  The court shall not make an order removing the child from the care of the person who had charge of the child immediately before intervention under this Part unless the court is satisfied that alternatives that are less disruptive to the child, including non-residential care and the assistance referred to in subsection (2), would be inadequate to protect the child.",
    note: "Prohibits a removal order unless the court is satisfied that less disruptive alternatives, including non-residential care and pre-intervention assistance, would be inadequate to protect the child.",
  },
  "101(4)": {
    citation: "CYFSA s. 101(4)",
    heading: "Community placement to be considered",
    text: "(4)  Where the court decides that it is necessary to remove the child from the care of the person who had charge of the child immediately before intervention under this Part, the court shall, before making an order under paragraph 2 or 3 of subsection (1), consider whether it is possible to place the child with a relative, neighbour or other member of the child’s community or extended family under paragraph 1 of subsection (1) with the consent of the relative or other person.",
    note: "Requires the court to consider placement with a consenting relative, neighbour, or community or extended-family member under a supervision order before ordering interim or extended society care.",
  },
  "101(5)": {
    citation: "CYFSA s. 101(5)",
    heading: "First Nations, Inuk or Métis child placement",
    text: "(5)  Where the child referred to in subsection (4) is a First Nations, Inuk or Métis child, unless there is a substantial reason for placing the child elsewhere, the court shall place the child with a member of the child’s extended family if it is possible or, if it is not possible,\n  (a)  in the case of a First Nations child, another First Nations family;\n  (b)  in the case of an Inuk child, another Inuit family; or\n  (c)  in the case of a Métis child, another Métis family.",
    note: "Establishes placement priority for a First Nations, Inuk or Métis child unless there is a substantial reason for placing the child elsewhere.",
  },
  "101(7)": {
    citation: "CYFSA s. 101(7)",
    heading: "Terms and conditions of supervision order",
    text: "(7)  If the court makes a supervision order under paragraph 1 of subsection (1), the court may impose,\n  (a)  reasonable terms and conditions relating to the child’s care and supervision;\n  (b)  reasonable terms and conditions on,\n  (i)  the child’s parent,\n  (ii)  the person who will have care and custody of the child under the order,\n  (iii)  the child, and\n  (iv)  any other person, other than a foster parent, who is putting forward or would participate in a plan for the care and custody of or access to the child; and\n  (c)  reasonable terms and conditions on the society that will supervise the placement, but shall not require the society to provide financial assistance or purchase any goods or services.",
    note: "Authorizes reasonable terms on a supervision order, while clause (c) provides that the order shall not require the society to provide financial assistance or purchase any goods or services.",
  },
  "102(1)": {
    citation: "CYFSA s. 102(1)",
    heading: "Custody order",
    text: "(1)  Subject to subsection (6), if a court finds that an order under this section instead of an order under subsection 101 (1) would be in a child’s best interests, the court may make an order granting custody of the child to one or more persons, other than a foster parent of the child, with the consent of the person or persons. 2017, c. 14, Sched. 1, s. 102 (1).",
    note: "Authorizes a custody order in favour of one or more consenting persons (other than a foster parent) instead of an order under s. 101(1).",
  },
  "104(1)": {
    citation: "CYFSA s. 104(1)",
    heading: "Access order",
    text: "(1)  The court may, in the child’s best interests,\n  (a)  when making an order under this Part; or\n  (b)  upon an application under subsection (2),\nmake, vary or terminate an order respecting a person’s access to the child or the child’s access to a person, and may impose such terms and conditions on the order as the court considers appropriate.",
    note: "Governs making, varying, or terminating access orders in the child's best interests.",
  },
  "109(2)": {
    citation: "CYFSA s. 109(2)",
    heading: "Residential placement",
    text: "(2)  The society having care of a child shall choose a residential placement for the child that,\n  (a)  represents the least restrictive alternative for the child;\n  (b)  where possible, respects the child’s race, ancestry, place of origin, colour, ethnic origin, citizenship, family diversity, creed, sex, sexual orientation, gender identity and gender expression;\n  (c)  where possible, respects the child’s cultural and linguistic heritage;\n  (d)  in the case of a First Nations, Inuk or Métis child, is with, if possible, a member of the child’s extended family or, if that is not possible,\n  (i)  in the case of a First Nations child, another First Nations family,\n  (ii)  in the case of an Inuk child, another Inuit family, or\n  (iii)  in the case of a Métis child, another Métis family; and\n  (e)  takes into account the child’s views and wishes, given due weight in accordance with the child’s age and maturity, and the views and wishes of any parent who is entitled to access to the child.",
    note: "Sets out the society's residential placement duties when a child is in interim or extended society care.",
  },
  "109(2)(d)": {
    citation: "CYFSA s. 109(2)(d)",
    heading: "Residential placement — First Nations, Inuk or Métis child",
    text: "(d)  in the case of a First Nations, Inuk or Métis child, is with, if possible, a member of the child’s extended family or, if that is not possible,\n  (i)  in the case of a First Nations child, another First Nations family,\n  (ii)  in the case of an Inuk child, another Inuit family, or\n  (iii)  in the case of a Métis child, another Métis family; and",
    note: "Clause (d) of s. 109(2), requiring extended-family or Indigenous family placement where possible for a First Nations, Inuk or Métis child in society care.",
  },
  "115(2)": {
    citation: "CYFSA s. 115(2)",
    heading: "Society to seek status review",
    text: "(2)  The society that has or had care, custody or supervision of the child,\n  (a)  may apply to the court at any time, subject to subsection (9), for a review of the child’s status;\n  (b)  shall apply to the court for a review of the child’s status before the order expires if the order is for society supervision, unless the expiry is by reason of section 123; and\n  (c)  shall apply to the court for a review of the child’s status within five days after removing the child, if the society has removed the child,\n  (i)  from the care of a person with whom the child was placed under an order for society supervision described in clause 116 (1) (a), or\n  (ii)  from the custody of a person who had custody of the child under a custody order described in clause 116 (1) (b).",
    note: "Governs when the society may or must apply for a status review, including the five-day deadline after removing a child under clause (c).",
  },
  "121(1)": {
    citation: "CYFSA s. 121(1)",
    heading: "Appeal",
    text: "(1)  An appeal from a court’s order under this Part may be made by,\n  (a)  the child, if the child is entitled to participate in the proceeding under subsection 79 (6) (child’s participation);\n  (b)  any parent of the child;\n  (c)  the person who had charge of the child immediately before intervention under this Part;\n  (d)  a Director or local director; or\n  (e)  in the case of a First Nations, Inuk or Métis child, a person described in clause (a), (b), (c) or (d) or a representative chosen by each of the child’s bands and First Nations, Inuit or Métis communities. 2017, c. 14, Sched. 1, s. 121 (1); 2020, c. 25, Sched. 2, s. 5 (1).",
    note: "Lists who may appeal a court order made under Part V.",
  },
  "121(2.1)": {
    citation: "CYFSA s. 121(2.1)",
    heading: "Appeal court",
    text: "(2.1)  The appeal shall be made to,\n  (a)  the Superior Court of Justice, if the order was made at the Ontario Court of Justice; or\n  (b)  the Divisional Court, if the order was made at the Family Court of the Superior Court of Justice. 2020, c. 25, Sched. 2, s. 5 (2).",
    note: "Added by S.O. 2020, c. 25, Sched. 2, s. 5(2) (in force March 1, 2021), specifying whether a Part V appeal lies to the Superior Court of Justice or the Divisional Court.",
  },
  "121(3)": {
    citation: "CYFSA s. 121(3)",
    heading: "Care and custody pending appeal",
    text: "(3)  Where a decision regarding the care and custody of a child is appealed under subsection (1), execution of the decision shall be stayed for the 10 days immediately following service of the notice of appeal on the court that made the decision, and where the child is in the society’s care and custody at the time the decision is made, the child shall remain in the care and custody of the society until,\n  (a)  the 10-day period of the stay has expired; or\n  (b)  an order is made under subsection (4),\nwhichever is earlier. 2017, c. 14, Sched. 1, s. 121 (3).",
    note: "Provides an automatic 10-day stay of execution following service of a notice of appeal of a care and custody decision.",
  },
  "123": {
    citation: "CYFSA s. 123",
    heading: "Expiry of orders",
    text: "An order under this Part expires when the child who is the subject of the order,\n  (a)  turns 18; or\n  (b)  marries,\nwhichever comes first.",
    note: "Provides that an order under Part V expires when the child turns 18 or marries, whichever comes first.",
  },
  "125(1)": {
    citation: "CYFSA s. 125(1)",
    heading: "Duty to report child in need of protection",
    text: "(1)  Despite the provisions of any other Act, if a person, including a person who performs professional or official duties with respect to children, has reasonable grounds to suspect one of the following, the person shall immediately report the suspicion and the information on which it is based to a society:",
    note: "Sets the 'reasonable grounds to suspect' reporting threshold. This is a duty to report, not the evidentiary threshold for a court finding under s. 74(2) or warrantless removal under s. 81(7).",
  },
  "136(5)": {
    citation: "CYFSA s. 136(5)",
    heading: "Police may bring child home or to place of safety",
    text: "(5)  Where a child who is actually or apparently younger than 16 is in a place to which the public has access between the hours of midnight and 6 a.m. and is not accompanied by a person described in clause (4) (b), a peace officer may bring the child to a place of safety without a warrant and proceed as if the child had been brought to a place of safety under subsection 84 (1).",
    note: "Authorizes a peace officer to bring an unaccompanied child younger than 16 in a public place between midnight and 6 a.m. to a place of safety without a warrant.",
  },
  "312(1)": {
    citation: "CYFSA s. 312(1)",
    heading: "Right of access to record of personal information",
    text: "(1)  An individual has a right of access to a record of personal information about the individual that is in a service provider’s custody or control and that relates to the provision of a service to the individual unless,\n  (a)  the record or the information in the record is subject to a legal privilege that restricts its disclosure to the individual;\n  (b)  another Act, an Act of Canada or a court order prohibits its disclosure to the individual;\n  (c)  the information in the record was collected or created primarily in anticipation of or for use in a proceeding, and the proceeding, together with all appeals or processes resulting from it, has not been concluded; or\n  (d)  granting the access could reasonably be expected to,\n  (i)  result in a risk of serious harm to the individual or another individual,\n  (ii)  lead to the identification of an individual who was required by law to provide information in the record to the service provider, or\n  (iii)  lead to the identification of an individual who provided information in the record to the service provider explicitly or implicitly in confidence if the service provider considers it appropriate in the circumstances that the identity of the individual be kept confidential.",
    note: "Part X right of an individual to access a record of personal information in a service provider's custody or control, subject to the exceptions in clauses (a) to (d). Distinct from s. 292, which governs disclosure without consent.",
  },
  "14": {
    citation: "CYFSA s. 14",
    heading: "Parental consent, etc.",
    text: "Subject to subsection 94 (7) and sections 110 and 111 (custody during adjournment, interim and extended society care), the parent of a child in care retains any right that the parent may have,\n  (a)  to direct the child’s or young person’s education and upbringing, in accordance with the child’s or young person’s creed, community identity and cultural identity; and\n  (b)  to consent to treatment on behalf of an incapable child or young person, if the parent is the child’s or young person’s substitute decision-maker in accordance with section 20 of the Health Care Consent Act, 1996.",
    note: "Preserves a parent's rights regarding education, upbringing, and Health Care Consent Act substitute decision-making for a child in care, subject to s. 94(7) and ss. 110–111.",
  },
  "15(2)": {
    citation: "CYFSA s. 15(2)",
    heading: "Children, young persons to be heard and represented",
    text: "(2)  Service providers shall ensure that children and young persons and their parents have an opportunity to be heard and represented when decisions affecting their interests are made and to be heard when they have concerns about the services they are receiving.",
    note: "Requires service providers to ensure children, young persons, and their parents have an opportunity to be heard and represented when decisions affecting their interests are made (subject to s. 15(3) good-cause exception). Reviewable by the CFSRB under s. 120(4), para. 4.",
  },
  "15(4)": {
    citation: "CYFSA s. 15(4)",
    heading: "Criteria and safeguards re decisions",
    text: "(4)  Service providers shall ensure that decisions affecting the interests and rights of children and young persons and their parents are made according to clear, consistent criteria and are subject to appropriate procedural safeguards.",
    note: "Requires service providers to make decisions affecting the interests and rights of children, young persons, and parents according to clear, consistent criteria and procedural safeguards.",
  },
  "35(2)": {
    citation: "CYFSA s. 35(2)",
    heading: "Prescribed standards, etc.",
    text: "(2)  A society shall,\n  (a)  provide the prescribed standard of services in its performance of its functions; and\n  (b)  follow the prescribed procedures and practices.",
    note: "Statutorily obligates every children's aid society to provide the prescribed standard of services and follow prescribed procedures and practices.",
  },
  "73": {
    citation: "CYFSA s. 73",
    heading: "Consultation in specified cases",
    text: "A society, person or entity that proposes to provide a prescribed service to a First Nations, Inuk or Métis child or young person, or to exercise a prescribed power under this Act in relation to such a child or young person, shall consult with a representative chosen by each of the child’s or young person’s bands and First Nations, Inuit or Métis communities in accordance with the regulations.",
    note: "Requires consultation with a representative chosen by each of a First Nations, Inuk or Métis child's bands and communities when proposing to provide a prescribed service or exercise a prescribed power.",
  },
  "75(1)": {
    citation: "CYFSA s. 75(1)",
    heading: "Temporary care agreement",
    text: "(1)  A person who is temporarily unable to care adequately for a child in the person’s custody, and the society having jurisdiction where the person resides, may make a written agreement for the society’s care and custody of the child.",
    note: "Authorizes a voluntary written temporary care agreement between a custodial parent/person temporarily unable to care adequately for a child and the society.",
  },
  "75(4)": {
    citation: "CYFSA s. 75(4)",
    heading: "Duty of society — Temporary care agreement",
    text: "(4)  A society shall not make a temporary care agreement unless the society,\n  (a)  has determined that an appropriate residential placement that is likely to benefit the child is available; and\n  (b)  is satisfied that no course of action less disruptive to the child, such as care in the child’s own home, is able to adequately protect the child.",
    note: "Prohibits a society from entering into a temporary care agreement unless satisfied that no less disruptive course of action, such as care in the child's own home, can adequately protect the child.",
  },
  "75(5)": {
    citation: "CYFSA s. 75(5)",
    heading: "Term of temporary care agreement limited",
    text: "(5)  No temporary care agreement shall be made for a term exceeding six months, but the parties to a temporary care agreement may, with a Director’s written approval, agree to extend it for a further period or periods if the total term of the agreement, as extended, does not exceed 12 months.",
    note: "Limits a temporary care agreement to an initial term of 6 months and a maximum extended term of 12 months with a Director's written approval.",
  },
  "75(6)": {
    citation: "CYFSA s. 75(6)",
    heading: "Time limit — Temporary care agreement",
    text: "(6)  No temporary care agreement shall be made or extended so as to result in a child being in a society’s care and custody, for a period exceeding,\n  (a)  12 months, if the child is younger than 6 on the day the agreement is entered into or extended; or\n  (b)  24 months, if the child is 6 or older on the day the agreement is entered into or extended.",
    note: "Sets cumulative time-in-care limits (12 months for children under 6; 24 months for children 6 or older) for temporary care agreements.",
  },
  "76(3)": {
    citation: "CYFSA s. 76(3)",
    heading: "Society response to notice of termination",
    text: "(3)  Where notice of a wish to terminate a temporary care agreement is given by or to a society under subsection (1), the society shall as soon as possible, and in any event before the agreement terminates under subsection (2),\n  (a)  cause the child to be returned to the person who made the agreement, or to a person who has obtained an order for the child’s custody since the agreement was made;\n  (b)  where the society is of the opinion that the child would be in need of protection if returned to the person referred to in clause (a), bring the child before the court under this Part to determine whether the child would be in need of protection in that case; or\n  (c)  where the child is 16 or 17 and the criteria set out in clauses 77 (1) (a), (b), (c) and (d) are met, make a written agreement with the child under subsection 77 (1).",
    note: "Requires a society receiving or giving notice of termination of a temporary care agreement to return the child or bring the matter before the court before the notice period (5 days, or up to 21 days if specified in the agreement) expires.",
  },
  "79(1)": {
    citation: "CYFSA s. 79(1)",
    heading: "Parties",
    text: "(1)  The following are parties to a proceeding under this Part:\n  1.  The applicant.\n  2.  The society having jurisdiction in the matter.\n  3.  The child’s parent.\n  4.  In the case of a First Nations, Inuk or Métis child, the persons described in paragraphs 1, 2 and 3 and a representative chosen by each of the child’s bands and First Nations, Inuit or Métis communities.",
    note: "Defines the statutory parties to a Part V child protection proceeding, including the child's parent and, for a First Nations, Inuk or Métis child, a representative chosen by each of the child's bands and communities.",
  },
  "80": {
    citation: "CYFSA s. 80",
    heading: "Customary care",
    text: "A society shall make all reasonable efforts to pursue a plan for customary care for a First Nations, Inuk or Métis child if the child,\n  (a)  is in need of protection;\n  (b)  cannot remain in or be returned to the care and custody of the person who had charge of the child immediately before intervention under this Part or, where there is an order for the child’s custody that is enforceable in Ontario, of the person entitled to custody under the order; and\n  (c)  is a member of or identifies with a band, or is a member of or identifies with a First Nations, Inuit or Métis community.",
    note: "Imposes a mandatory duty on a society to make all reasonable efforts to pursue a plan for customary care for a First Nations, Inuk or Métis child in need of protection who cannot remain with or return to the person who had charge.",
  },
  "93(1)": {
    citation: "CYFSA s. 93(1)",
    heading: "Evidence — Past conduct",
    text: `(1)  Despite anything in the Evidence Act, in any proceeding under this Part,
  (a)  the court may consider the past conduct of a person toward any child if that person is caring for or has access to or may care for or have access to a child who is the subject of the proceeding; and
  (b)  any oral or written statement or report that the court considers relevant to the proceeding, including a transcript, exhibit or finding or the reasons for a decision in an earlier civil or criminal proceeding, is admissible into evidence.`,
    note: "Governs admissibility of relevant past conduct towards a child and prior proceedings/reports at a Part V hearing.",
  },
  "94(10)": {
    citation: "CYFSA s. 94(10)",
    heading: "Evidence on adjournment",
    text: `(10)  For the purpose of this section, the court may admit and act on evidence that the court considers credible and trustworthy in the circumstances.`,
    note: "Sets the 'credible and trustworthy in the circumstances' evidentiary standard for temporary care and custody hearings under s. 94.",
  },
  "98(1)": {
    citation: "CYFSA s. 98(1)",
    heading: "Order for assessment",
    text: `(1)  In the course of a proceeding under this Part, the court may order that one or more of the following persons undergo an assessment within a specified time by a person appointed in accordance with subsections (3) and (4):
  1.  The child.
  2.  A parent of the child.
  3.  Any other person, other than a foster parent, who is putting forward or would participate in a plan for the care and custody of or access to the child.`,
    note: "Authorizes court-ordered assessments under s. 98 where necessary for the court to make a determination under Part V.",
  },
  "105(1)": {
    citation: "CYFSA s. 105(1)",
    heading: "Access: where child removed from person in charge",
    text: `(1)  Where an order is made under paragraph 1 or 2 of subsection 101 (1) removing a child from the person who had charge of the child immediately before intervention under this Part, the court shall make an order for access by the person unless the court is satisfied that continued contact with the person would not be in the child’s best interests.`,
    note: "Establishes a statutory presumption in favour of an access order for the person who had charge of the child when the child is removed under a supervision or interim society care order, unless continued contact would not be in the child's best interests.",
  },
  "105(5)": {
    citation: "CYFSA s. 105(5)",
    heading: "When court may order access to child in extended society care",
    text: `(5)  A court shall not make or vary an access order under section 104 with respect to a child who is in extended society care under an order made under paragraph 3 of subsection 101 (1) or clause 116 (1) (c) unless the court is satisfied that the order or variation would be in the child’s best interests.`,
    note: "Governs when the court may make or vary an access order under s. 104 for a child in extended society care (requiring satisfaction that the order or variation would be in the child's best interests).",
  },
  "113(1)": {
    citation: "CYFSA s. 113(1)",
    heading: "Status review — Application",
    text: `(1)  This section applies where a child is the subject of an order made under paragraph 1 or 4 of subsection 101 (1) for society supervision or under paragraph 2 of subsection 101 (1) for interim society care.`,
    note: "Specifies that section 113 status reviews apply where a child is subject to an order for society supervision or interim society care under s. 101(1).",
  },
  "113(2)": {
    citation: "CYFSA s. 113(2)",
    heading: "Society to seek status review",
    text: `(2)  The society having care, custody or supervision of a child,
  (a)  may apply to the court at any time for a review of the child’s status;
  (b)  shall apply to the court for a review of the child’s status before the order expires, unless the expiry is by reason of section 123; and
  (c)  shall apply to the court for a review of the child’s status within five days after removing the child, if the society has removed the child from the care of a person with whom the child was placed under an order for society supervision.`,
    note: "Requires the society to apply for a status review before a supervision or interim society care order expires, and within 5 days after removing a child from care under a supervision order.",
  },
  "114": {
    citation: "CYFSA s. 114",
    heading: "Court may vary, etc. on status review",
    text: `Where an application for review of a child’s status is made under section 113, the court may, in the child’s best interests,
  (a)  vary or terminate the original order made under subsection 101 (1), including a term or condition or a provision for access that is part of the order;
  (b)  order that the original order terminate on a specified future date;
  (c)  make a further order or orders under section 101; or
  (d)  make an order under section 102.`,
    note: "Sets out the court's dispositive powers on a status review application under s. 113.",
  },
  "116(1)": {
    citation: "CYFSA s. 116(1)",
    heading: "Court order on status review under s. 115",
    text: `(1)  If an application for review of a child’s status is made under section 115, the court may, in the child’s best interests,
  (a)  order that the child be placed in the care and custody of a parent or another person, subject to the supervision of the society, for a specified period of at least three months and not more than 12 months;
  (b)  order that custody be granted to one or more persons, including a foster parent, with the consent of the person or persons;
  (c)  order that the child be placed in extended society care until the order is terminated under this section or expires under section 123; or
  (d)  terminate or vary any order made under section 101 or this section.`,
    note: "Sets out the orders a court may make in the child's best interests on a status review application under s. 115.",
  },
  "116(4)": {
    citation: "CYFSA s. 116(4)",
    heading: "Terms and conditions of status review supervision order",
    text: `(4)  If the court makes a supervision order described in clause (1) (a), the court may impose,
  (a)  reasonable terms and conditions relating to the child’s care and supervision;
  (b)  reasonable terms and conditions on,
  (i)  the child’s parent,
  (ii)  the person who will have care and custody of the child under the order,
  (iii)  the child, and
  (iv)  any other person, other than a foster parent, who is putting forward a plan or who would participate in a plan for care and custody of or access to the child; and
  (c)  reasonable terms and conditions on the society that will supervise the placement, but shall not require the society to provide financial assistance or purchase any goods or services.`,
    note: "Authorizes reasonable terms and conditions on a status review supervision order under s. 116(1)(a), while clause (c) expressly prohibits requiring the society to provide financial assistance or purchase goods or services.",
  },
  "119(1)": {
    citation: "CYFSA s. 119(1)",
    heading: "Complaint to society",
    text: "(1)  A person may make a complaint to a society relating to a service sought or received by that person from the society in accordance with the regulations.",
    note: "Establishes the statutory right to make an internal complaint to a children's aid society regarding a service sought or received.",
  },
  "119(2)": {
    citation: "CYFSA s. 119(2)",
    heading: "Complaint review procedure",
    text: "(2)  Where a society receives a complaint under subsection (1), it shall deal with the complaint in accordance with the complaint review procedure established by regulation, subject to subsection 120 (2).",
    note: "Mandates that a society deal with a s. 119(1) complaint in accordance with the prescribed complaint review procedure (O. Reg. 155/18).",
  },
  "119(11)": {
    citation: "CYFSA s. 119(11)",
    heading: "No review if matter within purview of court",
    text: "(11)  A society shall not conduct a review of a complaint under this section if the subject of the complaint,\n  (a)  is an issue that has been decided by the court or is before the court; or\n  (b)  is subject to another decision-making process under this Act or the Labour Relations Act, 1995.",
    note: "Expressly bars a society from reviewing an internal complaint under s. 119 if the subject of the complaint is an issue that has been decided by the court or is currently before the court.",
  },
  "120(1)": {
    citation: "CYFSA s. 120(1)",
    heading: "Complaint to Board (CFSRB)",
    text: "(1)  If a complaint in respect of a service sought or received from a society relates to a matter described in subsection (4), the person who sought or received the service may,\n  (a)  decide not to make the complaint to the society under section 119 and make the complaint directly to the Board under this section; or\n  (b)  where the person first makes the complaint to the society under section 119, submit the complaint to the Board before the society’s complaint review procedure is completed.",
    note: "Allows a person seeking or receiving a society service to bring a complaint regarding a matter in s. 120(4) directly to the Child and Family Services Review Board (CFSRB) or before the society's internal review is completed.",
  },
  "120(4)": {
    citation: "CYFSA s. 120(4)",
    heading: "Matters for Board review",
    text: "(4)  The following matters may be reviewed by the Board under this section:\n  1.  Allegations that the society has refused to proceed with a complaint made by the complainant under subsection 119 (1) as required under subsection 119 (2).\n  2.  Allegations that the society has failed to respond to the complainant’s complaint within the timeframe required by regulation.\n  3.  Allegations that the society has failed to comply with the complaint review procedure or with any other procedural requirements under this Act relating to the review of complaints.\n  4.  Allegations that the society has failed to comply with subsection 15 (2).\n  5.  Allegations that the society has failed to provide the complainant with reasons for a decision that affects the complainant’s interests.\n  6.  Such other matters as may be prescribed.",
    note: "Enumerates the specific procedural and service matters within the CFSRB's review jurisdiction under s. 120, including failure to comply with s. 15(2) (opportunity to be heard) and failure to provide reasons for a decision.",
  },
  "120(8)": {
    citation: "CYFSA s. 120(8)",
    heading: "No review by Board if matter within purview of court",
    text: "(8)  The Board shall not conduct a review of a complaint under this section if the subject of the complaint,\n  (a)  is an issue that has been decided by the court or is before the court; or\n  (b)  is subject to another decision-making process under this Act or the Labour Relations Act, 1995.",
    note: "Expressly bars the CFSRB from reviewing a complaint if the subject of the complaint has been decided by the court or is before the court. The CFSRB cannot overturn a court order.",
  },
  "122(1)": {
    citation: "CYFSA s. 122(1)",
    heading: "Time limit — Interim society care",
    text: "(1)  Subject to subsections (4) and (5), the court shall not make an order for interim society care under paragraph 2 of subsection 101 (1) that results in a child being in the care and custody of a society for a period exceeding,\n  (a)  12 months, if the child is younger than 6 on the day the court makes the order; or\n  (b)  24 months, if the child is 6 or older on the day the court makes the order.",
    note: "Establishes the cumulative statutory time-in-care limits for interim society care (12 months if the child is under 6; 24 months if the child is 6 or older), counting prior temporary care agreements (s. 75(1)) and temporary society care orders (s. 94(2)(d)), subject to a discretionary 6-month extension under s. 122(5).",
  },
  "122(5)": {
    citation: "CYFSA s. 122(5)",
    heading: "Six-month extension of time limit",
    text: "(5)  Subject to paragraphs 2 and 4 of subsection 101 (1), the court may by order extend the period permitted under subsection (1) by a period not to exceed six months if it is in the child’s best interests to do so.",
    note: "Permits the court to extend the cumulative s. 122(1) time-in-care limit by up to 6 months where it is in the child's best interests.",
  },
  "126(1)": {
    citation: "CYFSA s. 126(1)",
    heading: "Society to assess and verify report of child in need of protection",
    text: "(1)  A society that receives a report under section 125 that a child, including a child in the society’s care or supervision, is or may be in need of protection shall as soon as possible carry out an assessment as prescribed and verify the reported information, or ensure that the information is assessed and verified by another society.",
    note: "Imposes a mandatory statutory duty on a society receiving a s. 125 report to carry out a prescribed assessment as soon as possible and verify the reported information.",
  },
  "306(1)": {
    citation: "CYFSA s. 306(1)",
    heading: "Steps to ensure accuracy, etc. of personal information",
    text: "(1)  A service provider that uses personal information for the purpose of providing a service shall take reasonable steps to ensure that the information is as accurate, complete and up-to-date as is necessary for the purposes for which it uses the information.",
    note: "Part X statutory obligation requiring service providers (including societies) to take reasonable steps to ensure personal information used to provide a service is accurate, complete, and up-to-date.",
  },
  "314(3)": {
    citation: "CYFSA s. 314(3)",
    heading: "Time for response to access request",
    text: "(3)  As soon as possible, but no later than 30 days after receiving the request, the service provider shall, by written notice to the individual, give the response required by subsection (1) or extend the deadline for responding by not more than 90 days if,\n  (a)  responding to the request within 30 days would unreasonably interfere with the operations of the service provider because the information consists of numerous pieces of information or locating the information would necessitate a lengthy search; or\n  (b)  the time required to undertake an assessment under subsection 312 (1) necessary to respond to the request within 30 days after receiving it would make it not reasonably practical to respond within that time.",
    note: "Requires a service provider to respond to a Part X personal information access request as soon as possible and no later than 30 days after receipt (subject to a noticed extension of up to 90 days).",
  },
  "315(2)": {
    citation: "CYFSA s. 315(2)",
    heading: "Correction to record — Written request",
    text: "(2)  If a service provider has granted an individual access to a record of personal information and if the individual believes that the record is inaccurate or incomplete, the individual may request in writing that the service provider correct the record. 2017, c. 14, Sched. 1, s. 315 (2).",
    note: "Establishes the Part X statutory right to request in writing that a service provider correct an inaccurate or incomplete record of personal information (with a 30-day response limit under s. 315(4) and a right to attach a statement of disagreement under s. 315(12)).",
  },
  "316(1)": {
    citation: "CYFSA s. 316(1)",
    heading: "Complaint to Information and Privacy Commissioner",
    text: "(1)  A person who has reasonable grounds to believe that another person has contravened or is about to contravene a provision of this Part or the regulations made for the purposes of this Part may make a complaint to the Commissioner.",
    note: "Authorizes a Part X privacy, access refusal, or correction refusal complaint to the Information and Privacy Commissioner of Ontario (IPC).",
  },
  "333(1)": {
    citation: "CYFSA s. 333(1)",
    heading: "Child and Family Services Review Board",
    text: "(1)  The Child and Family Services Review Board is continued under the name Child and Family Services Review Board in English and Commission de révision des services à l’enfance et à la famille in French.",
    note: "Continues the Child and Family Services Review Board (CFSRB) with the powers and duties conferred by the CYFSA and regulations.",
  },
};

/**
 * Maps a citation to a bundled entry. Only a citation the shared classifier matches to the internal reference text
 * (a CYFSA citation naming a single verified section or a verified clause pinpoint within a bundled section) returns
 * an entry. Other Acts, regulations, mixed citations and unlisted sections return null, so their text is never shown
 * as if it were the CYFSA's.
 */
export function findBundledStatute(citation: string): BundledStatuteEntry | null {
  const c = classifyCitation(citation);
  if (c.status !== "INTERNAL_REFERENCE_MATCH" || c.sections.length !== 1) return null;
  const resolvedKey = resolveBundledCyfsaKey(c.sections[0]);
  if (!resolvedKey) return null;
  return BUNDLED_STATUTE_ENTRIES[resolvedKey] ?? null;
}

export interface StatuteDetails {
  title: string;
  subtitle: string;
  /** Verbatim bundled text, or null when the app holds none for this citation. */
  exactText: string | null;
  explanation: string;
}

export function statuteDetailsFor(citation: string): StatuteDetails {
  const entry = findBundledStatute(citation);
  if (entry) {
    return { title: entry.citation, subtitle: entry.heading, exactText: entry.text, explanation: entry.note };
  }
  return {
    title: citation,
    subtitle: "No bundled text",
    exactText: null,
    explanation: "The app holds no text for this citation, so it has not been checked against the statute. Confirm it with counsel.",
  };
}
