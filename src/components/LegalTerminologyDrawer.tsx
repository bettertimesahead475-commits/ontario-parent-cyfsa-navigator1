import React, { useState, useEffect, useRef } from "react";
import { 
  Book, 
  Search, 
  X, 
  Copy, 
  Check, 
  HelpCircle, 
  ChevronRight, 
  Sparkles, 
  ArrowRight,
  ExternalLink,
  ShieldAlert,
  FileText
} from "lucide-react";

export interface TerminologyItem {
  id: string;
  term: string;
  shortDefinition: string;
  fullDefinition: string;
  sectionReference: string;
  category: "Agreements & Plans" | "Court Orders" | "Rights & Standards" | "Procedure";
  implications: string; // What this actually means for the parent
  tips: string; // Strategic coaching tips for the parent
}

const GLOSSARY_ITEMS: TerminologyItem[] = [
  {
    id: "term-plan-of-care",
    term: "Plan of Care",
    shortDefinition: "A written design outlining specific support services, daily goals, and cultural guidelines for a child in care.",
    fullDefinition: "Under s. 74(1) of the CYFSA, a Plan of Care is a legally mandated document prepared by a Children's Aid Society (CAS) or care provider. It details the physical, mental, emotional, educational, and cultural/religious services that will be provided to a child who is either in the society's care or under a supervision order. The plan must be reviewed regularly and should be developed with active input from the parents and the child (subject to age/maturity).",
    sectionReference: "CYFSA s. 74(1)",
    category: "Agreements & Plans",
    implications: "The Plan of Care dictates your child's daily life, therapy, education, and family contact. If you do not agree with elements of the plan, you have the right to request a review or raise objections at the Child and Family Services Review Board (CFSRB).",
    tips: "Always request a copy of the Plan of Care immediately. Insist on written changes if the promised services (like counseling or cultural connections) are not being delivered, and use it as evidence of CAS's compliance or failure."
  },
  {
    id: "term-temporary-care-agreement",
    term: "Temporary Care Agreement (TCA)",
    shortDefinition: "A voluntary contract where parents temporarily place their child in CAS physical care while retaining full legal guardianship.",
    fullDefinition: "Governed by s. 75 of the CYFSA, a Temporary Care Agreement (TCA) is a voluntary agreement entered into by a parent and CAS. It permits CAS to assume physical care of the child for a short period (initially up to 6 months) while the parent addresses a temporary crisis (such as medical treatment or severe short-term hardship). Crucially, the parent retains full legal guardianship, and the child is NOT placed under a court-ordered wardship.",
    sectionReference: "CYFSA s. 75",
    category: "Agreements & Plans",
    implications: "Unlike an apprehension or court order, entering a TCA is consensual. However, CAS often uses TCAs to avoid seeking a formal apprehension warrant. You can technically terminate the agreement, but doing so without CAS agreement may trigger them to file an emergency apprehension court application.",
    tips: "Treat a TCA as a high-stakes legal contract. Never sign one without consulting a lawyer first. Ensure the contract has a strict, documented return date, and do not sign extension amendments without independent legal advice."
  },
  {
    id: "term-society-care-order",
    term: "Society Care Order",
    shortDefinition: "A temporary court order placing a child in CAS legal custody for up to 12 months.",
    fullDefinition: "Defined under s. 101(1) of the CYFSA, a Society Care Order is an interim or final order made by a judge. It places the child in the temporary legal custody and care of the Children's Aid Society for a specified duration (not exceeding 12 aggregate months). During this time, CAS acts as the legal guardian, deciding where the child lives, but parents typically retain residual rights and must be consulted on major decisions (religion, critical health).",
    sectionReference: "CYFSA s. 101(1)",
    category: "Court Orders",
    implications: "This is a serious judicial intervention. While temporary, the ultimate goal is to return the child to the parents once safety criteria are met. The 12-month limit is strict; if the child remains in care beyond this cumulative limit, CAS must either return the child or apply for Extended Society Care.",
    tips: "Focus entirely on meeting the conditions in the court order or Plan of Care. Keep a meticulous diary of your compliance, and ensure your lawyer files regular status reports to show the judge you are ready for a return."
  },
  {
    id: "term-extended-society-care",
    term: "Extended Society Care",
    shortDefinition: "A permanent court order transferring full legal custody and guardianship of a child to CAS, ending parent rights.",
    fullDefinition: "Under s. 102 of the CYFSA, Extended Society Care (previously known as a 'Crown Wardship Order') is the most severe order a child protection court can make. It permanently terminates the parent's legal rights and transfers full legal custody, care, and guardianship of the child to the Children's Aid Society. This order is typically made when the court concludes there is no reasonable prospect of the child safely returning to the parent's care.",
    sectionReference: "CYFSA s. 102",
    category: "Court Orders",
    implications: "If this order is granted, CAS can place the child for adoption without parental consent, and all access/visitation rights are legally severed unless the court explicitly orders 'access with openness'.",
    tips: "This is the 'legal death penalty' of family law. If CAS signals they are seeking Extended Society Care, you must act immediately. Work with your lawyer to present kin or community placement options (Kinship Service/Care) as a superior, less intrusive alternative to permanent wardship."
  },
  {
    id: "term-apprehension",
    term: "Emergency Apprehension",
    shortDefinition: "The immediate removal of a child by CAS or police without a prior warrant under strict imminent danger conditions.",
    fullDefinition: "Under s. 81(1) of the CYFSA, a child protection worker or peace officer may apprehend a child without a warrant ONLY if they have reasonable and probable grounds to believe the child is in immediate danger of serious harm, and that waiting to obtain a warrant from a judge would jeopardize the child's safety. This is an extraordinary emergency power.",
    sectionReference: "CYFSA s. 81(1)",
    category: "Procedure",
    implications: "CAS must prove that there was a genuine emergency. S. 81 does not allow removals based on historical, vague, or slow-moving concerns. Once a child is apprehended, a formal court review must be initiated within 5 days.",
    tips: "If an apprehension occurs, remain completely calm in front of workers to avoid 'hostility' allegations. Demand to know the exact 'imminent risk' grounds, write down every detail immediately, and contact a child welfare lawyer to prepare for the 5-Day Temporary Care Hearing."
  },
  {
    id: "term-five-day-hearing",
    term: "5-Day Temporary Care Hearing",
    shortDefinition: "The mandatory initial court review that must happen within five court days after an emergency removal.",
    fullDefinition: "Section 94 of the CYFSA dictates that if a child is apprehended without a warrant, CAS must bring the matter before a judge of the Ontario Court of Justice within five (5) court days. At this first appearance (often called the 'Five-Day Hearing' or 'Temporary Care and Custody Hearing'), the judge must decide if the child should remain in temporary CAS care or be returned to the parent pending a full trial.",
    sectionReference: "CYFSA s. 94",
    category: "Procedure",
    implications: "This is your first opportunity to contest the removal. The onus is on CAS to present clear, credible evidence showing that returning the child to you poses an immediate, unmanageable safety risk that cannot be mitigated with a supervision order or safety plan.",
    tips: "Do not agree to temporary CAS custody 'by consent' out of fear. Consult your lawyer. If you have stable family members who can act as safety supervisors, present them immediately as kinship placement alternatives to keep your child out of foster care."
  },
  {
    id: "term-least-intrusive",
    term: "Least Intrusive Intervention",
    shortDefinition: "The fundamental statutory principle that agency actions must interfere with families as little as possible.",
    fullDefinition: "A core governing principle of Ontario child welfare law. It dictates that Children's Aid Societies must choose the 'least intrusive course of action' that is consistent with the child’s safety and well-being. Before removing a child, CAS must demonstrate they have made active, exhaustive efforts to support the family in the home, using community resources, counseling, or voluntary agreements.",
    sectionReference: "CYFSA s. 1 & s. 74",
    category: "Rights & Standards",
    implications: "This is a powerful defensive shield for parents. If CAS initiates a court application to remove your child, they must prove to the judge why supportive supervision in your home (or a kinship safety plan) is completely inadequate to protect the child.",
    tips: "Always challenge CAS workers to explain why they cannot offer support services in your home rather than demanding a placement. Keep records of every service you have voluntarily requested or participated in to prove your cooperation."
  },
  {
    id: "term-child-protection-grounds",
    term: "Child in Need of Protection",
    shortDefinition: "The rigorous legal definition containing 12 statutory risk thresholds required to justify CAS legal intervention.",
    fullDefinition: "Defined under s. 74(2) of the CYFSA, a child is 'in need of protection' only if they meet at least one of 12 highly specific statutory categories. These include: physical harm, risk of physical harm, sexual abuse, emotional harm, mental or emotional neglect, medical neglect, and abandonment. CAS bears the legal burden of proving these grounds on a 'balance of probabilities' (more likely than not).",
    sectionReference: "CYFSA s. 74(2)",
    category: "Rights & Standards",
    implications: "CAS cannot intervene simply because they dislike your parenting style, housekeeping, or financial status. They must tie their allegations directly to one of these 12 strict legal grounds and provide solid factual evidence, not speculation.",
    tips: "Read the exact protection grounds cited in your CAS court papers. Work with your lawyer to systematically audit the CAS allegations. Point out hearsay, opinions, and unsubstantiated claims that fail to meet these high statutory thresholds."
  },
  {
    id: "term-customary-care",
    term: "Customary Care (First Nations / Métis / Inuit)",
    shortDefinition: "A culturally integrated placement model where physical care is provided in accordance with Indigenous customs.",
    fullDefinition: "Designed specifically for First Nations, Métis, and Inuit children, Customary Care is the traditional care and protection of an Indigenous child by a person who is not the child's parent, in accordance with the customs of the child's Band, tribe, or community. Under the CYFSA, Customary Care is highly prioritized to keep Indigenous children connected to their culture, language, and family heritage without transferring legal guardianship to CAS.",
    sectionReference: "CYFSA s. 1 & s. 80",
    category: "Agreements & Plans",
    implications: "If your child has Indigenous heritage, the law grants your Band or Indigenous governing body (IGB) the right to be formally notified and to actively participate in all child welfare decisions. They can facilitate Customary Care to prevent foster care placements.",
    tips: "If you or your child has Indigenous ancestry, notify CAS immediately and contact your Band Representative or Indigenous Child and Family Services Agency. They can intervene in court, advocate for your family rights, and help set up a culturally safe Customary Care plan."
  },
  {
    id: "term-alternative-dispute-resolution",
    term: "Alternative Dispute Resolution (ADR)",
    shortDefinition: "A collaborative, non-adversarial process to resolve child welfare conflicts without a formal court trial.",
    fullDefinition: "Section 125 of the CYFSA encourages Children's Aid Societies to utilize Alternative Dispute Resolution (ADR) to resolve disputes. ADR processes include child welfare mediation, family group conferencing (FGC), or Indigenous circle processes. These are confidential, structured meetings facilitated by an independent professional to help parents, extended family, and CAS reach a consensual safety plan.",
    sectionReference: "CYFSA s. 125",
    category: "Procedure",
    implications: "Participating in ADR can divert your case away from highly stressful, adversarial court battles. It gives you a seat at the table to co-design solutions and safety plans, rather than having a judge make rigid, top-down orders.",
    tips: "Ask your lawyer or CAS worker about initiating an ADR or Family Group Conference early in your case. It is a highly effective way to propose family safety supervisors and demonstrate your commitment to child protection while maintaining parental input."
  },
  {
    id: "term-kinship-service",
    term: "Kinship Service",
    shortDefinition: "A voluntary arrangement where relatives care for a child while parents retain legal custody.",
    fullDefinition: "Kinship Service is an out-of-care safety plan where a child is placed temporarily with family members or close community connections, but the child is NOT in the legal care or custody of the Children's Aid Society. The placement relative is assessed by CAS, but legal guardianship remains with the parents or is voluntarily shared under a safety plan.",
    sectionReference: "CAS Placement Policy",
    category: "Agreements & Plans",
    implications: "This is a far less intrusive option than foster care. Because the child is not in CAS legal custody, parents retain more control and residual rights, and it does not count toward the strict 12-month cumulative limit of a Society Care Order.",
    tips: "If CAS insists that your child cannot stay in your home, immediately propose a relative, grandparent, or close friend for a Kinship Service assessment. This keeps your child safe within their family circle while you work to resolve the concerns."
  },
  {
    id: "term-kinship-care",
    term: "Kinship Care",
    shortDefinition: "An arrangement where a child is in CAS legal custody but resides in an approved family relative's home.",
    fullDefinition: "Unlike Kinship Service, Kinship Care is an 'in-care' placement. The child is in the formal, legal custody of the Children's Aid Society (either through a court order or agreement) but is placed in the home of a relative who is formally approved and monitored as a foster home by CAS.",
    sectionReference: "CAS Foster Policy",
    category: "Agreements & Plans",
    implications: "The relative receives foster care funding and intensive supervision from CAS. However, because the child is in CAS custody, it counts toward the strict 12-month legal limit of a Society Care Order, and CAS controls visitation and daily decisions.",
    tips: "Always try to secure Kinship Service first, as it keeps more power in the family's hands. However, Kinship Care is still vastly superior to placing your child in a foster home with strangers, as it maintains family bonds and reduces child trauma."
  },
  {
    id: "term-supervision-order",
    term: "Supervision Order",
    shortDefinition: "A court order returning the child to the parent's home under formal CAS monitoring and conditions.",
    fullDefinition: "Under s. 101(1) of the CYFSA, a Supervision Order returns the child to the care of the parent or another person, subject to the supervision of the Children's Aid Society for a period of 3 to 12 months. The order always includes mandatory conditions that the parent and CAS must follow, such as attending counseling, allowing home visits, or completing parenting classes.",
    sectionReference: "CYFSA s. 101(1)",
    category: "Court Orders",
    implications: "Your child stays in your home, which is a major victory. However, you are under strict legal obligation to comply with all conditions. Violating a supervision order gives CAS immediate grounds to apply to a judge to upgrade to a Society Care Order.",
    tips: "Treat every supervision condition as a non-negotiable directive. Document your completion of every single class or session in writing. Keep a calendar of worker visits and maintain a clean, cooperative, and organized home environment."
  },
  {
    id: "term-office-childrens-lawyer",
    term: "Office of the Children's Lawyer (OCL)",
    shortDefinition: "An Ontario government agency providing independent lawyers to represent a child's voice and legal interests.",
    fullDefinition: "The Office of the Children's Lawyer (OCL) is an independent branch of the Ministry of the Attorney General of Ontario. In child welfare court cases, a judge can order that an OCL lawyer be appointed to represent the child. The OCL lawyer meets with the child, assesses their needs and wishes, and presents independent legal arguments to the judge regarding what is in the child's best interests.",
    sectionReference: "CYFSA s. 79 & CLRA s. 30",
    category: "Rights & Standards",
    implications: "The OCL lawyer does not represent you or CAS; they represent only your child. Their assessment and recommendation hold immense weight with judges. If your child is older, the OCL lawyer will advocate directly for the child's expressed wishes.",
    tips: "Never try to coach or influence what your child tells the OCL lawyer, as this will backfire severely and be reported to the judge as 'parental alienation' or pressure. Respect the OCL lawyer, facilitate their visits with your child, and cooperate fully."
  }
];

interface LegalTerminologyDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function LegalTerminologyDrawer({ isOpen, onClose }: LegalTerminologyDrawerProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>("All");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<TerminologyItem | null>(null);
  
  const drawerRef = useRef<HTMLDivElement>(null);

  // Listen to the custom global window event to open terminology glossary
  useEffect(() => {
    const handleGlobalTrigger = (e: Event) => {
      const customEvent = e as CustomEvent<{ term?: string }>;
      if (customEvent.detail && customEvent.detail.term) {
        const termToFind = customEvent.detail.term.toLowerCase().trim();
        // Try to find matching item
        const matched = GLOSSARY_ITEMS.find(
          item => 
            item.term.toLowerCase().includes(termToFind) || 
            termToFind.includes(item.term.toLowerCase()) ||
            item.id.includes(termToFind)
        );
        if (matched) {
          setSelectedItem(matched);
        } else {
          setSelectedItem(null);
        }
      } else {
        setSelectedItem(null);
      }
    };

    window.addEventListener("open-terminology-glossary", handleGlobalTrigger);
    return () => {
      window.removeEventListener("open-terminology-glossary", handleGlobalTrigger);
    };
  }, []);

  const handleCopyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const filteredItems = GLOSSARY_ITEMS.filter(item => {
    const matchesSearch = item.term.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          item.shortDefinition.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          item.fullDefinition.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          item.sectionReference.toLowerCase().includes(searchQuery.toLowerCase());
    
    if (activeCategory === "All") return matchesSearch;
    return item.category === activeCategory && matchesSearch;
  });

  const categories = ["All", "Agreements & Plans", "Court Orders", "Rights & Standards", "Procedure"];

  return (
    <>
      {/* DRAWER SIDEBAR CONTAINER */}
      <div 
        className={`fixed inset-0 z-[100] overflow-hidden font-sans no-print transition-opacity duration-300 ${
          isOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
        id="terminology-drawer-wrapper"
      >
        {/* Backdrop overlay */}
        <div 
          onClick={onClose}
          className="absolute inset-0 bg-slate-900/50 backdrop-blur-xs transition-opacity" 
          id="terminology-drawer-backdrop"
        />

        <div className="absolute inset-y-0 right-0 max-w-full flex">
          <div 
            ref={drawerRef}
            className={`w-screen max-w-lg bg-black shadow-2xl flex flex-col border-l border-slate-150 transform transition-transform duration-300 ease-in-out ${
              isOpen ? "translate-x-0" : "translate-x-full"
            }`}
            id="terminology-drawer-panel"
          >
            {/* Drawer Header */}
            <div className="p-4 bg-brand-950 text-white flex items-center justify-between border-b border-brand-900 shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded bg-brand-500/20 text-brand-300 flex items-center justify-center border border-brand-500/35">
                  <Book className="w-4 h-4 animate-pulse" />
                </div>
                <div>
                  <h3 className="font-display font-extrabold text-xs uppercase tracking-wide">CYFSA Legal Glossary</h3>
                  <p className="text-[10px] text-brand-300 font-medium leading-none mt-0.5">Demystifying Complex Child Welfare Terms</p>
                </div>
              </div>
              <button 
                onClick={onClose}
                className="w-8 h-8 rounded-full hover:bg-black/10 flex items-center justify-center text-white/80 hover:text-white transition-colors cursor-pointer"
                title="Collapse Glossary Desk"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Inner Content Layout: Double state (Detail View vs Search List View) */}
            {selectedItem ? (
              /* DETAILED VIEW FOR SINGLE TERM */
              <div className="flex-1 overflow-y-auto p-5 space-y-5 animate-fadeIn" id="glossary-detail-view">
                {/* Back button */}
                <button
                  onClick={() => setSelectedItem(null)}
                  className="flex items-center gap-1 text-[11px] font-semibold text-brand-700 hover:text-brand-950 transition-colors uppercase font-mono cursor-pointer"
                >
                  ← Back to Glossary List
                </button>

                {/* Term title card */}
                <div className="bg-brand-50/50 rounded-2xl border border-brand-100 p-4 space-y-2">
                  <div className="flex justify-between items-start gap-2">
                    <span className="px-2 py-0.5 text-[8.5px] font-mono font-extrabold bg-brand-100 text-brand-950 rounded uppercase border border-brand-200">
                      {selectedItem.category}
                    </span>
                    <span className="text-[10px] text-brand-800 font-mono font-bold">
                      {selectedItem.sectionReference}
                    </span>
                  </div>
                  <h2 className="text-lg font-display font-extrabold text-slate-900 tracking-tight leading-tight">
                    {selectedItem.term}
                  </h2>
                  <p className="text-xs text-slate-500 italic leading-normal">
                    {selectedItem.shortDefinition}
                  </p>
                </div>

                {/* Extended Legal Definition */}
                <div className="space-y-1.5">
                  <h4 className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1.5 select-none">
                    <FileText className="w-3.5 h-3.5 text-slate-350" />
                    <span>Statutory Full Definition</span>
                  </h4>
                  <div className="bg-slate-50 p-4 rounded-xl border border-slate-150 text-xs text-slate-700 leading-relaxed font-sans whitespace-pre-wrap">
                    {selectedItem.fullDefinition}
                  </div>
                </div>

                {/* What this means for parent */}
                <div className="space-y-1.5">
                  <h4 className="text-[10px] font-mono font-bold text-amber-600 uppercase tracking-widest flex items-center gap-1.5 select-none">
                    <ShieldAlert className="w-3.5 h-3.5 text-amber-500" />
                    <span>Parental Implications & Rights</span>
                  </h4>
                  <div className="bg-amber-50/30 p-4 rounded-xl border border-amber-100 text-xs text-slate-750 leading-relaxed font-sans">
                    {selectedItem.implications}
                  </div>
                </div>

                {/* Strategic Advice Tips for parenting */}
                <div className="space-y-1.5">
                  <h4 className="text-[10px] font-mono font-bold text-emerald-600 uppercase tracking-widest flex items-center gap-1.5 select-none">
                    <Sparkles className="w-3.5 h-3.5 text-emerald-500" />
                    <span>Advisory Shield • Coaching Tips</span>
                  </h4>
                  <div className="bg-emerald-50/20 p-4 rounded-xl border border-emerald-100 text-xs text-slate-750 leading-relaxed font-sans">
                    {selectedItem.tips}
                  </div>
                </div>

                {/* Footer copy text action */}
                <div className="flex gap-2.5 pt-2 border-t border-slate-100">
                  <button
                    onClick={() => handleCopyToClipboard(`${selectedItem.term} (${selectedItem.sectionReference}): ${selectedItem.shortDefinition} - ${selectedItem.fullDefinition}`, selectedItem.id)}
                    className="flex-1 py-2 bg-brand-950 hover:bg-brand-900 text-white rounded-lg text-xs font-bold transition flex items-center justify-center gap-2 cursor-pointer"
                  >
                    {copiedId === selectedItem.id ? (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        <span>Copied Definition!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy Glossary Text</span>
                      </>
                    )}
                  </button>
                  
                  <button
                    onClick={() => setSelectedItem(null)}
                    className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold cursor-pointer"
                  >
                    Close Detail
                  </button>
                </div>
              </div>
            ) : (
              /* GLOSSARY LIST VIEW WITH FILTERS & SEARCH */
              <div className="flex-1 overflow-hidden flex flex-col" id="glossary-list-view">
                {/* Search Bar Block */}
                <div className="p-4 bg-slate-50 border-b border-slate-150 space-y-3 shrink-0">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 transform -translate-y-1/2" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search legal terms (e.g., Plan of Care, TCA)..."
                      className="w-full pl-9 pr-8 py-2 text-xs bg-black border border-slate-250 rounded-xl outline-none focus:ring-1 focus:ring-brand-500 text-slate-800 font-medium"
                    />
                    {searchQuery && (
                      <button 
                        type="button"
                        onClick={() => setSearchQuery("")}
                        className="absolute right-3 top-1/2 transform -translate-y-1/2 text-slate-400 hover:text-slate-600"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  {/* Horizontal Category Pill Scrollbar */}
                  <div className="flex gap-1 overflow-x-auto pb-0.5 scrollbar-none">
                    {categories.map((cat) => (
                      <button
                        key={cat}
                        onClick={() => setActiveCategory(cat)}
                        className={`px-2.5 py-1 text-[9px] font-mono font-bold uppercase rounded-md tracking-wider border shrink-0 cursor-pointer transition-all ${
                          activeCategory === cat 
                            ? "bg-brand-900 text-white border-brand-900 shadow-2xs" 
                            : "bg-black text-slate-500 hover:bg-slate-100 border-slate-200"
                        }`}
                      >
                        {cat === "Agreements & Plans" ? "Agreements" : cat === "Rights & Standards" ? "Rights" : cat}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Scrollable list items */}
                <div className="flex-1 overflow-y-auto p-4 space-y-3" id="glossary-items-viewport">
                  {filteredItems.length === 0 ? (
                    <div className="text-center py-12 px-6 bg-slate-50 border border-slate-150 rounded-2xl space-y-2">
                      <HelpCircle className="w-8 h-8 text-slate-300 mx-auto" />
                      <h4 className="font-display font-bold text-xs text-slate-700">No Terminology Found</h4>
                      <p className="text-[10.5px] text-slate-400 max-w-[280px] mx-auto mt-1 leading-normal">
                        No matches found for "{searchQuery}". Try refining your keywords or searching under "All" categories.
                      </p>
                    </div>
                  ) : (
                    filteredItems.map((item) => (
                      <div
                        key={item.id}
                        onClick={() => setSelectedItem(item)}
                        className="bg-black border border-slate-200 hover:border-brand-250 hover:bg-brand-50/10 p-3.5 rounded-xl text-left cursor-pointer transition-all group relative flex flex-col justify-between shadow-2xs hover:shadow-xs"
                      >
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between gap-2 border-b border-slate-50 pb-1">
                            <span className="text-[8px] font-mono font-extrabold uppercase bg-slate-100 text-slate-600 rounded px-1.5 py-0.5 border border-slate-200/50">
                              {item.category}
                            </span>
                            <span className="text-[9px] text-brand-750 font-mono font-bold shrink-0">
                              {item.sectionReference}
                            </span>
                          </div>
                          
                          <h4 className="font-display font-extrabold text-xs text-slate-900 tracking-tight leading-none group-hover:text-brand-900 transition-colors">
                            {item.term}
                          </h4>
                          
                          <p className="text-[10.5px] text-slate-500 leading-normal line-clamp-2">
                            {item.shortDefinition}
                          </p>
                        </div>

                        <div className="flex items-center justify-between text-[9px] font-mono font-bold text-brand-600 mt-2.5 pt-1.5 border-t border-slate-50 opacity-0 group-hover:opacity-100 transition-opacity">
                          <span>Review Full Rights & Advisory Guide</span>
                          <ArrowRight className="w-3.5 h-3.5 transform group-hover:translate-x-1 transition-transform" />
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* Drawer Footer */}
            <div className="p-3 bg-slate-50 border-t border-slate-150 flex items-center justify-between shrink-0">
              <span className="text-[9px] text-slate-400 font-mono uppercase tracking-wider select-none">
                ParentShield Glossary Desk • Ontario S.O. 2017
              </span>
              <button
                onClick={onClose}
                className="px-3 py-1 bg-slate-850 hover:bg-slate-900 text-white rounded font-sans text-[10px] font-bold uppercase tracking-wide cursor-pointer"
              >
                Close Glossary
              </button>
            </div>

          </div>
        </div>
      </div>
    </>
  );
}
