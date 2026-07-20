import React, { useState, useEffect } from "react";
import { 
  Bookmark, 
  BookmarkCheck, 
  BookOpen, 
  Search, 
  Copy, 
  Check, 
  Plus, 
  Trash2, 
  X, 
  ChevronRight, 
  Sparkles, 
  Edit3, 
  Info,
  Calendar,
  Layers,
  ChevronLeft
} from "lucide-react";

// Types for the bookmarks
interface LegalItem {
  id: string;
  title: string;
  citation: string;
  category: "Statutory Section" | "Legal Definition" | "Custom Reference";
  content: string;
  isPreloaded?: boolean;
}

interface BookmarkItem extends LegalItem {
  userNotes: string;
  courtDate?: string;
  dateBookmarked: string;
}

// Preloaded data
const PRELOADED_ITEMS: LegalItem[] = [
  // Statutory Sections
  {
    id: "cyfsa-81",
    title: "Apprehension Without Warrant",
    citation: "CYFSA s. 81",
    category: "Statutory Section",
    content: "A children's aid worker or peace officer may apprehend a child without a warrant ONLY if there are reasonable and probable grounds to believe that there is an immediate risk of serious harm to the child, and that a warrant would take too long to obtain. Vague claims fail this high statutory threshold.",
    isPreloaded: true
  },
  {
    id: "cyfsa-94",
    title: "The Strict 5-Day Review Rule",
    citation: "CYFSA s. 94",
    category: "Statutory Section",
    content: "Immediately upon emergency removal, the child welfare agency must bring the matter before a judge within five (5) court days to justify why the child was taken and seek a temporary order. Failure to do so constitutes a major statutory procedural defect.",
    isPreloaded: true
  },
  {
    id: "cyfsa-74",
    title: "Child in Need of Protection Threshold",
    citation: "CYFSA s. 74(2)",
    category: "Statutory Section",
    content: "Defines specific sub-sections (physical risk, sexual abuse, severe emotional harm, or medical neglect) that must be met to assert that a child is in need of protection. General concerns like home clutter or poverty do not meet this legal standard.",
    isPreloaded: true
  },
  {
    id: "cyfsa-3",
    title: "Child's Right to be Heard & Counsel",
    citation: "CYFSA s. 3",
    category: "Statutory Section",
    content: "Guarantees children (especially those aged 12 and older) the right to receive notice of hearings, express their views to the court, and be represented by independent legal counsel through the Office of the Children's Lawyer (OCL).",
    isPreloaded: true
  },
  {
    id: "cyfsa-70",
    title: "Mandatory Indigenous Band Consultation",
    citation: "CYFSA s. 70",
    category: "Statutory Section",
    content: "The welfare agency is statutorily mandated to exhaustively explore Customary Care and consult with the child's designated Band, First Nations, Inuit, or Métis community before taking any intervention steps.",
    isPreloaded: true
  },
  {
    id: "clra-8",
    title: "300-Day Presumption of Parentage",
    citation: "CLRA s. 8",
    category: "Statutory Section",
    content: "Under the Children's Law Reform Act, a former spouse or cohabitant is legally presumed to be a parent if the child is born during the relationship or within 300 days after it ends. CAS must notify and assess both presumed parents.",
    isPreloaded: true
  },
  {
    id: "evid-35",
    title: "Hearsay limits under Business Records",
    citation: "Ontario Evidence Act s. 35",
    category: "Statutory Section",
    content: "While case logs may be admitted as business records, the hearsay assertions contained within them (e.g. 'anonymous neighbor told the worker...') cannot be relied upon as factual truth for final orders without direct testimony.",
    isPreloaded: true
  },
  {
    id: "flr-17",
    title: "Case Conferences Guidelines",
    citation: "Family Law Rules r. 17",
    category: "Statutory Section",
    content: "Mandatory conference before a judge to explore settlement, schedule disclosure, and narrow down legal issues. The Case Conference Brief (Form 17B) must be served and filed 7 days prior.",
    isPreloaded: true
  },
  {
    id: "flr-14",
    title: "Interim Motions for Access & Care",
    citation: "Family Law Rules r. 14",
    category: "Statutory Section",
    content: "Enables parents to bring motions before a judge to request temporary orders, such as increasing visitation access, obtaining records, or adjusting safety conditions before a full trial takes place.",
    isPreloaded: true
  },

  // Legal Definitions
  {
    id: "def-least-intrusive",
    title: "Least Intrusive Course of Action",
    citation: "Statutory Standard",
    category: "Legal Definition",
    content: "The legal principle dictating that child welfare interventions must interfere with the family as little as possible. CAS must prove that less disruptive support options were thoroughly tried and failed before taking the child.",
    isPreloaded: true
  },
  {
    id: "def-best-interests",
    title: "Best Interests of the Child",
    citation: "CYFSA s. 74(3)",
    category: "Legal Definition",
    content: "The ultimate judicial test. Weighs the child's physical, mental, and emotional safety, relationship with parent, cultural/heritage identity, and the child's expressed wishes based on their maturity.",
    isPreloaded: true
  },
  {
    id: "def-kinship-service",
    title: "Kinship Service vs. Kinship Care",
    citation: "CAS Placement Modes",
    category: "Legal Definition",
    content: "Kinship Service refers to placement with family members where the child is NOT in the legal custody of CAS (more parental control). Kinship Care means the child is in CAS legal custody but resides with family.",
    isPreloaded: true
  },
  {
    id: "def-supervision-order",
    title: "Supervision Order",
    citation: "CYFSA s. 102",
    category: "Legal Definition",
    content: "A court order returning the child to the parent's primary home under CAS supervision for 3 to 12 months, usually with agreed-upon supportive conditions like counseling or parenting classes.",
    isPreloaded: true
  },
  {
    id: "def-hearsay",
    title: "Hearsay Evidence",
    citation: "Evidence Rules",
    category: "Legal Definition",
    content: "An out-of-court statement made by someone else, offered as proof of that statement. While conditionally tolerated in early interim hearings, final child protection orders cannot rest on unverified hearsay.",
    isPreloaded: true
  },
  {
    id: "def-customary-care",
    title: "Customary Care",
    citation: "Indigenous Welfare",
    category: "Legal Definition",
    content: "The traditional care and protection of an Indigenous child by a person who is not the child's parent, in accordance with the customs of the child's Band or First Nations community.",
    isPreloaded: true
  },
  {
    id: "def-tcc",
    title: "Temporary Care and Custody (TCC)",
    citation: "Interim Orders",
    category: "Legal Definition",
    content: "A temporary custody order granted by a judge deciding where the child lives during the months leading up to a final trial or conference settlement.",
    isPreloaded: true
  }
];

export default function StatutoryBookmarkSidebar() {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<"bookmarks" | "browse">("bookmarks");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [categoryFilter, setCategoryFilter] = useState<string>("All");
  
  // Bookmarks state (loads from localStorage)
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>(() => {
    try {
      const stored = localStorage.getItem("OPA_STATUTE_BOOKMARKS");
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  // Custom reference creator states
  const [customTitle, setCustomTitle] = useState("");
  const [customCitation, setCustomCitation] = useState("");
  const [customContent, setCustomContent] = useState("");
  const [customCategory, setCustomCategory] = useState<"Statutory Section" | "Legal Definition" | "Custom Reference">("Statutory Section");
  const [showCustomCreator, setShowCustomCreator] = useState(false);

  // Notes editing states
  const [editingNotesId, setEditingNotesId] = useState<string | null>(null);
  const [editingNotesText, setEditingNotesText] = useState("");
  const [editingDateId, setEditingDateId] = useState<string | null>(null);
  const [editingDateText, setEditingDateText] = useState("");

  // Copy feedback states
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Sync to localStorage
  useEffect(() => {
    localStorage.setItem("OPA_STATUTE_BOOKMARKS", JSON.stringify(bookmarks));
  }, [bookmarks]);

  // Handle bookmark action
  const toggleBookmark = (item: LegalItem) => {
    const exists = bookmarks.find(b => b.id === item.id);
    if (exists) {
      setBookmarks(bookmarks.filter(b => b.id !== item.id));
    } else {
      const newBookmark: BookmarkItem = {
        ...item,
        userNotes: "",
        dateBookmarked: new Date().toLocaleDateString("en-CA")
      };
      setBookmarks([...bookmarks, newBookmark]);
    }
  };

  // Add a fully custom legal reference
  const handleAddCustomReference = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customTitle || !customContent) {
      alert("Please fill out Title and Factual Text.");
      return;
    }

    const newCustomItem: LegalItem = {
      id: "custom-" + Date.now(),
      title: customTitle,
      citation: customCitation || "Custom Reference",
      category: customCategory,
      content: customContent
    };

    // Automatically bookmark it
    const newBookmark: BookmarkItem = {
      ...newCustomItem,
      userNotes: "Personally added legal citation reference.",
      dateBookmarked: new Date().toLocaleDateString("en-CA")
    };

    setBookmarks([...bookmarks, newBookmark]);
    
    // Clear form
    setCustomTitle("");
    setCustomCitation("");
    setCustomContent("");
    setCustomCategory("Statutory Section");
    setShowCustomCreator(false);
    setActiveTab("bookmarks");
  };

  // Save customized notes under a bookmark
  const handleSaveNotes = (id: string) => {
    setBookmarks(bookmarks.map(b => {
      if (b.id === id) {
        return { ...b, userNotes: editingNotesText };
      }
      return b;
    }));
    setEditingNotesId(null);
  };

  // Save target court date
  const handleSaveCourtDate = (id: string) => {
    setBookmarks(bookmarks.map(b => {
      if (b.id === id) {
        return { ...b, courtDate: editingDateText };
      }
      return b;
    }));
    setEditingDateId(null);
  };

  // Copy citation details to clipboard
  const handleCopyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  // Filter browse list
  const filteredBrowse = PRELOADED_ITEMS.filter(item => {
    const matchesSearch = item.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          item.citation.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          item.content.toLowerCase().includes(searchQuery.toLowerCase());
    
    if (categoryFilter === "All") return matchesSearch;
    return item.category === categoryFilter && matchesSearch;
  });

  // Helper to highlight matching text
  const highlightText = (text: string, query: string) => {
    if (!query.trim()) return text;
    
    // Escape regex special characters in query to prevent regex errors
    const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const parts = text.split(new RegExp(`(${escapedQuery})`, 'gi'));
    
    return (
      <>
        {parts.map((part, i) => 
          part.toLowerCase() === query.toLowerCase() ? (
            <mark key={i} className="bg-amber-200 text-slate-900 rounded-sm px-0.5">
              <span className="sr-only">Highlighted: </span>
              {part}
            </mark>
          ) : (
            part
          )
        )}
      </>
    );
  };

  // Filter bookmarked list
  const filteredBookmarks = bookmarks.filter(item => {
    const matchesSearch = item.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          item.citation.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          item.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          item.userNotes.toLowerCase().includes(searchQuery.toLowerCase());
    
    if (categoryFilter === "All") return matchesSearch;
    return item.category === categoryFilter && matchesSearch;
  });

  return (
    <>
      {/* PERSISTENT FLOATING SIDEBAR TOGGLE TAB (aligned cleanly on the right) */}
      <button
        onClick={() => setIsOpen(true)}
        className="fixed right-0 top-1/3 transform -translate-y-1/2 bg-brand-950 hover:bg-brand-900 text-white font-sans font-bold text-[11px] tracking-wider uppercase py-4 px-2 rounded-l-xl shadow-xl z-40 border-l border-y border-brand-700 flex flex-col items-center gap-2 cursor-pointer transition-all hover:pl-3 group hover:shadow-brand-900/20 no-print"
        title="Open CYFSA Statutory Bookmarks Sidebar Desk"
        id="statutory-bookmark-toggle-tab"
      >
        <Bookmark className="w-4 h-4 text-amber-400 group-hover:scale-110 transition-transform shrink-0" />
        <span className="[writing-mode:vertical-lr] tracking-widest mt-1">
          Statute Desk
        </span>
        {bookmarks.length > 0 && (
          <span className="w-5 h-5 rounded-full bg-amber-500 text-brand-950 text-[10px] font-mono font-extrabold flex items-center justify-center animate-bounce shadow-xs mt-1 shrink-0">
            {bookmarks.length}
          </span>
        )}
      </button>

      {/* DRAWER SIDEBAR CONTAINER */}
      <div 
        className={`fixed inset-0 z-50 overflow-hidden font-sans no-print transition-opacity duration-300 ${
          isOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
      >
        {/* Backdrop overlay */}
        <div 
          onClick={() => setIsOpen(false)}
          className="absolute inset-0 bg-slate-900/50 backdrop-blur-xs transition-opacity" 
        />

        <div className="absolute inset-y-0 right-0 max-w-full flex">
          <div 
            className={`w-screen max-w-md bg-white shadow-2xl flex flex-col border-l border-slate-150 transform transition-transform duration-300 ease-in-out ${
              isOpen ? "translate-x-0" : "translate-x-full"
            }`}
          >
            {/* Sidebar Header */}
            <div className="p-4 bg-brand-950 text-white flex items-center justify-between border-b border-brand-900">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded bg-amber-400/20 text-amber-300 flex items-center justify-center">
                  <BookmarkCheck className="w-5 h-5 animate-pulse" />
                </div>
                <div>
                  <h3 className="font-display font-extrabold text-xs uppercase tracking-wide">Statutory Desk</h3>
                  <p className="text-[10px] text-brand-300 font-medium leading-none mt-0.5">Bookmarks & Court Citations</p>
                </div>
              </div>
              <button 
                onClick={() => setIsOpen(false)}
                className="w-8 h-8 rounded-full hover:bg-white/10 flex items-center justify-center text-white/80 hover:text-white transition-colors cursor-pointer"
                title="Collapse sidebar desk"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Quick Context Tip Banner */}
            <div className="bg-amber-50/50 border-b border-amber-100 p-3 flex gap-2 items-start text-[11px] text-amber-900">
              <Info className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
              <p className="leading-normal">
                <strong>Court Room Tip:</strong> Keep this sidebar open as a quick reference while completing your brief templates or testifying before a judge to cite specific sections.
              </p>
            </div>

            {/* Tab Swapping Header */}
            <div className="border-b border-slate-150 p-3 bg-slate-50 flex items-center justify-between gap-2 shrink-0">
              <div className="flex bg-slate-200 p-0.5 rounded-lg w-full">
                <button
                  onClick={() => {
                    setActiveTab("bookmarks");
                    setShowCustomCreator(false);
                  }}
                  className={`flex-1 py-1.5 text-[10.5px] font-bold tracking-wide uppercase rounded-md transition-all cursor-pointer ${
                    activeTab === "bookmarks" && !showCustomCreator
                      ? "bg-white text-brand-950 shadow-xs" 
                      : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  My Bookmarks ({bookmarks.length})
                </button>
                <button
                  onClick={() => {
                    setActiveTab("browse");
                    setShowCustomCreator(false);
                  }}
                  className={`flex-1 py-1.5 text-[10.5px] font-bold tracking-wide uppercase rounded-md transition-all cursor-pointer ${
                    activeTab === "browse" && !showCustomCreator
                      ? "bg-white text-brand-950 shadow-xs" 
                      : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  Statute Library
                </button>
              </div>

              <button
                onClick={() => setShowCustomCreator(!showCustomCreator)}
                className={`p-2 rounded-lg border transition-all cursor-pointer shrink-0 ${
                  showCustomCreator 
                    ? "bg-amber-500 text-brand-950 border-amber-400" 
                    : "bg-white text-slate-700 hover:bg-slate-100 border-slate-200"
                }`}
                title="Add Custom Statute or Case Citation"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>

            {/* Active Content Area */}
            <div className="flex-1 overflow-y-auto bg-slate-50/50">
              
              {showCustomCreator ? (
                /* CUSTOM REFERENCE FORM CREATOR */
                <form onSubmit={handleAddCustomReference} className="p-4 space-y-4 bg-white m-3 rounded-xl border border-slate-150 shadow-xs">
                  <div className="flex items-center justify-between border-b pb-2">
                    <span className="text-[11px] font-mono font-bold text-brand-950 uppercase tracking-wide flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-brand-600 animate-pulse" />
                      Add Custom Reference
                    </span>
                    <button 
                      type="button"
                      onClick={() => setShowCustomCreator(false)}
                      className="text-slate-400 hover:text-slate-600 text-xs font-bold"
                    >
                      Cancel
                    </button>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-mono font-bold text-slate-600 uppercase tracking-wide">Category</label>
                    <select
                      value={customCategory}
                      onChange={(e) => setCustomCategory(e.target.value as any)}
                      className="w-full text-xs border border-slate-250 rounded-lg p-2.5 bg-white text-slate-850"
                    >
                      <option value="Statutory Section">Statutory Section (e.g. CYFSA, CLRA)</option>
                      <option value="Legal Definition">Legal Glossary Definition</option>
                      <option value="Custom Reference">Custom Case Citation (CanLII)</option>
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-mono font-bold text-slate-600 uppercase tracking-wide">Title / Name *</label>
                    <input
                      type="text"
                      required
                      value={customTitle}
                      onChange={(e) => setCustomTitle(e.target.value)}
                      placeholder="e.g. Mandatory Access Order Review"
                      className="w-full text-xs border border-slate-250 rounded-lg p-2.5 bg-white text-slate-850 outline-none focus:ring-1 focus:ring-brand-500"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-mono font-bold text-slate-600 uppercase tracking-wide">Official Citation / Section</label>
                    <input
                      type="text"
                      value={customCitation}
                      onChange={(e) => setCustomCitation(e.target.value)}
                      placeholder="e.g. CYFSA s. 102(3) or [2012] ONCA 12"
                      className="w-full text-xs border border-slate-250 rounded-lg p-2.5 bg-white text-slate-850 outline-none focus:ring-1 focus:ring-brand-500"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-mono font-bold text-slate-600 uppercase tracking-wide">Legal Text / Factual Summary *</label>
                    <textarea
                      required
                      rows={4}
                      value={customContent}
                      onChange={(e) => setCustomContent(e.target.value)}
                      placeholder="Enter the statutory clause, definition text, or key ratio of the CanLII judgment..."
                      className="w-full text-xs border border-slate-250 rounded-lg p-2.5 bg-white text-slate-850 outline-none focus:ring-1 focus:ring-brand-500 font-sans"
                    />
                  </div>

                  <button
                    type="submit"
                    className="w-full py-2 bg-brand-950 hover:bg-brand-900 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer"
                  >
                    Save & Bookmark Reference
                  </button>
                </form>
              ) : (
                /* MAIN LIST VIEW */
                <div className="p-3 space-y-3">
                  
                  {/* Search and Filters */}
                  <div className="bg-white p-2.5 rounded-xl border border-slate-150 space-y-2">
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 transform -translate-y-1/2" />
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder={`Search ${activeTab === "bookmarks" ? "bookmarks" : "statutes"}...`}
                        className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg outline-none focus:bg-white focus:ring-1 focus:ring-brand-500"
                      />
                      {searchQuery && (
                        <button 
                          type="button"
                          onClick={() => setSearchQuery("")}
                          className="absolute right-2.5 top-1/2 transform -translate-y-1/2 text-slate-400 hover:text-slate-600"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </div>

                    {/* Filter badges */}
                    <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-none">
                      {["All", "Statutory Section", "Legal Definition", "Custom Reference"].map((cat) => (
                        <button
                          key={cat}
                          onClick={() => setCategoryFilter(cat)}
                          className={`px-2 py-0.5 text-[9px] font-mono font-bold uppercase rounded-md tracking-wider border shrink-0 cursor-pointer transition-all ${
                            categoryFilter === cat 
                              ? "bg-brand-900 text-white border-brand-900" 
                              : "bg-slate-50 text-slate-500 hover:bg-slate-100 border-slate-200"
                          }`}
                        >
                          {cat === "Statutory Section" ? "Sections" : cat === "Legal Definition" ? "Glossary" : cat === "Custom Reference" ? "Custom" : "All"}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Empty States */}
                  {activeTab === "bookmarks" && filteredBookmarks.length === 0 && (
                    <div className="bg-white p-8 rounded-xl border border-dashed border-slate-300 text-center space-y-3">
                      <Bookmark className="w-8 h-8 text-slate-300 mx-auto" />
                      <div>
                        <h4 className="font-display font-bold text-xs text-slate-700">No Bookmarks Found</h4>
                        <p className="text-[10px] text-slate-400 max-w-[220px] mx-auto mt-1 leading-normal">
                          {searchQuery 
                            ? "Try broadening your keywords or clearing the category filter badges." 
                            : "Click 'Statute Library' above to browse essential sections and bookmark them for fast retrieval."}
                        </p>
                      </div>
                      {!searchQuery && (
                        <button
                          onClick={() => setActiveTab("browse")}
                          className="px-3 py-1.5 bg-brand-50 hover:bg-brand-100 border border-brand-200 text-brand-950 font-bold text-[10px] uppercase rounded-lg cursor-pointer transition-colors"
                        >
                          Explore Library
                        </button>
                      )}
                    </div>
                  )}

                  {activeTab === "browse" && filteredBrowse.length === 0 && (
                    <div className="bg-white p-8 rounded-xl border border-dashed border-slate-300 text-center space-y-3">
                      <Search className="w-8 h-8 text-slate-300 mx-auto" />
                      <div>
                        <h4 className="font-display font-bold text-xs text-slate-700">No Matches</h4>
                        <p className="text-[10px] text-slate-400 max-w-[220px] mx-auto mt-1 leading-normal">
                          We couldn't find any statutory sections matching "{searchQuery}".
                        </p>
                      </div>
                    </div>
                  )}

                  {/* List Renderings */}
                  <div className="space-y-3">
                    {activeTab === "bookmarks" ? (
                      /* BOOKMARKS DASHBOARD WITH CUSTOM USER NOTES */
                      filteredBookmarks.map((bookmark) => {
                        const isNotesEditing = editingNotesId === bookmark.id;
                        const isDateEditing = editingDateId === bookmark.id;
                        
                        return (
                          <div 
                            key={bookmark.id}
                            className="bg-white rounded-xl border border-slate-200 p-3.5 space-y-3 shadow-2xs hover:shadow-xs hover:border-slate-300 transition-all text-left"
                          >
                            <div className="flex items-start justify-between gap-2 border-b border-slate-100 pb-2">
                              <div className="space-y-0.5">
                                <span className={`px-1.5 py-0.5 text-[8px] font-mono font-extrabold uppercase rounded tracking-wider border ${
                                  bookmark.category === "Statutory Section" 
                                    ? "bg-brand-50 text-brand-950 border-brand-100" 
                                    : bookmark.category === "Legal Definition"
                                    ? "bg-emerald-50 text-emerald-950 border-emerald-100"
                                    : "bg-amber-50 text-amber-950 border-amber-100"
                                }`}>
                                  {bookmark.category}
                                </span>
                                <h4 className="font-display font-bold text-slate-900 text-xs mt-1 leading-tight">{highlightText(bookmark.title, searchQuery)}</h4>
                                <span className="text-[10px] text-brand-700 font-mono font-bold block">{highlightText(bookmark.citation, searchQuery)}</span>
                              </div>
                              
                              {/* Top Quick Actions */}
                              <div className="flex items-center gap-1.5 shrink-0">
                                <button
                                  onClick={() => handleCopyToClipboard(`${bookmark.title} (${bookmark.citation}): "${bookmark.content}"`, bookmark.id)}
                                  className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-700 cursor-pointer"
                                  title="Copy legal citation text"
                                >
                                  {copiedId === bookmark.id ? (
                                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                                  ) : (
                                    <Copy className="w-3.5 h-3.5" />
                                  )}
                                </button>
                                <button
                                  onClick={() => toggleBookmark(bookmark)}
                                  className="p-1 rounded hover:bg-rose-50 text-slate-400 hover:text-rose-600 cursor-pointer"
                                  title="Remove from bookmarks"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>

                            {/* Official clause text */}
                            <p className="text-[10.5px] text-slate-600 leading-normal bg-slate-50 border border-slate-150 p-2.5 rounded-lg select-all">
                              {highlightText(bookmark.content, searchQuery)}
                            </p>

                            {/* Parent Specific Notes / Court Date */}
                            <div className="bg-amber-50/40 border border-amber-100 rounded-lg p-2.5 space-y-2">
                              {/* Header & Date */}
                              <div className="flex items-center justify-between text-[9px] font-mono font-bold uppercase tracking-wider text-amber-800">
                                <span>My Case Strategy Notes</span>
                                <div className="flex items-center gap-1">
                                  <Calendar className="w-3 h-3 text-amber-600" />
                                  {isDateEditing ? (
                                    <div className="flex items-center gap-1">
                                      <input
                                        type="date"
                                        value={editingDateText}
                                        onChange={(e) => setEditingDateText(e.target.value)}
                                        className="text-[9px] border border-amber-300 p-0.5 rounded bg-white text-slate-800"
                                      />
                                      <button 
                                        type="button"
                                        onClick={() => handleSaveCourtDate(bookmark.id)}
                                        className="text-[9px] text-emerald-700 underline font-bold"
                                      >
                                        Save
                                      </button>
                                    </div>
                                  ) : (
                                    <span 
                                      onClick={() => {
                                        setEditingDateId(bookmark.id);
                                        setEditingDateText(bookmark.courtDate || "");
                                      }}
                                      className="cursor-pointer hover:underline text-amber-900"
                                      title="Click to tag a target court date"
                                    >
                                      {bookmark.courtDate ? `Court Date: ${bookmark.courtDate}` : "+ Tag Court Date"}
                                    </span>
                                  )}
                                </div>
                              </div>

                              {/* Notes Content */}
                              {isNotesEditing ? (
                                <div className="space-y-1.5">
                                  <textarea
                                    value={editingNotesText}
                                    onChange={(e) => setEditingNotesText(e.target.value)}
                                    rows={3}
                                    placeholder="Enter your case notes, e.g. 'Use this to contest the emergency removal on July 15'"
                                    className="w-full text-xs p-2 bg-white border border-amber-250 rounded-lg outline-none focus:ring-1 focus:ring-amber-500 text-slate-850"
                                  />
                                  <div className="flex justify-end gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() => setEditingNotesId(null)}
                                      className="px-2 py-0.5 text-[9px] font-bold text-slate-500 hover:text-slate-800 cursor-pointer"
                                    >
                                      Cancel
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleSaveNotes(bookmark.id)}
                                      className="px-2 py-0.5 bg-brand-900 text-white font-bold text-[9px] rounded uppercase cursor-pointer"
                                    >
                                      Save Notes
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <div 
                                  onClick={() => {
                                    setEditingNotesId(bookmark.id);
                                    setEditingNotesText(bookmark.userNotes);
                                  }}
                                  className="group cursor-pointer hover:bg-amber-100/50 p-1.5 rounded transition-all"
                                  title="Click to write case notes"
                                >
                                  {bookmark.userNotes ? (
                                    <p className="text-xs text-amber-950 font-sans leading-relaxed flex items-start gap-1.5">
                                      <Edit3 className="w-3 h-3 text-amber-700 mt-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                                      <span>{highlightText(bookmark.userNotes, searchQuery)}</span>
                                    </p>
                                  ) : (
                                    <span className="text-[10px] text-amber-600/70 italic flex items-center gap-1.5">
                                      <Edit3 className="w-3 h-3 text-amber-500" />
                                      <span>Click to write case notes or arguments...</span>
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      /* ESSENTIAL LEGAL LIBRARY BROWSER WITH ONE-CLICK BOOKMARKING */
                      filteredBrowse.map((item) => {
                        const isBookmarked = bookmarks.some(b => b.id === item.id);
                        
                        return (
                          <div 
                            key={item.id}
                            className="bg-white rounded-xl border border-slate-200 p-3.5 space-y-2.5 shadow-2xs hover:shadow-xs transition-all text-left relative overflow-hidden group"
                          >
                            <div className="flex items-start justify-between gap-2 border-b border-slate-100 pb-1.5">
                              <div>
                                <span className={`px-1.5 py-0.5 text-[8px] font-mono font-extrabold uppercase rounded tracking-wider border ${
                                  item.category === "Statutory Section" 
                                    ? "bg-brand-50 text-brand-950 border-brand-100" 
                                    : "bg-emerald-50 text-emerald-950 border-emerald-100"
                                }`}>
                                  {item.category}
                                </span>
                                <h4 className="font-display font-bold text-slate-900 text-xs mt-1 leading-tight">{highlightText(item.title, searchQuery)}</h4>
                                <span className="text-[10px] text-brand-700 font-mono font-bold block">{highlightText(item.citation, searchQuery)}</span>
                              </div>

                              <button
                                type="button"
                                onClick={() => toggleBookmark(item)}
                                className={`p-1.5 rounded-lg border transition-all cursor-pointer ${
                                  isBookmarked 
                                    ? "bg-amber-500 text-brand-950 border-amber-400" 
                                    : "bg-slate-50 text-slate-400 hover:text-slate-700 border-slate-200"
                                }`}
                                title={isBookmarked ? "Remove Bookmark" : "Add Bookmark to Case Strategy Workspace"}
                              >
                                <Bookmark className="w-3.5 h-3.5 shrink-0" />
                              </button>
                            </div>

                            <p className="text-[10.5px] text-slate-600 leading-normal">
                              {highlightText(item.content, searchQuery)}
                            </p>

                            <div className="flex items-center justify-between text-[9px] font-mono font-bold pt-1.5 border-t border-slate-50 text-slate-400">
                              <span>Ontario e-Laws Resource</span>
                              <button
                                onClick={() => handleCopyToClipboard(`${item.title} (${item.citation}): "${item.content}"`, item.id)}
                                className="text-brand-650 hover:text-brand-800 flex items-center gap-1 cursor-pointer"
                              >
                                {copiedId === item.id ? (
                                  <span className="text-emerald-600">Copied!</span>
                                ) : (
                                  <>
                                    <Copy className="w-3 h-3" />
                                    <span>Copy Text</span>
                                  </>
                                )}
                              </button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}

            </div>

            {/* Sidebar Footer */}
            <div className="p-3 bg-slate-50 border-t border-slate-150 flex items-center justify-between shrink-0">
              <span className="text-[9px] text-slate-400 font-mono uppercase tracking-wider">
                S.O. 2017 c. 14 / R.S.O. 1990 c. C.12
              </span>
              <button
                onClick={() => setIsOpen(false)}
                className="px-3 py-1 bg-slate-800 hover:bg-slate-900 text-white rounded font-sans text-[10px] font-bold uppercase tracking-wide cursor-pointer"
              >
                Close Desk
              </button>
            </div>

          </div>
        </div>
      </div>
    </>
  );
}
