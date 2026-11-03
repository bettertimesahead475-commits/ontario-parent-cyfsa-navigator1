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
