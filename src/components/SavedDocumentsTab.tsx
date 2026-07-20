import React, { useState, useEffect } from "react";
import { FolderHeart, FileText, Activity, Trash2, Calendar, FileSearch } from "lucide-react";
import { useLocation } from "wouter";
import { db, auth } from "../firebase";
import { collection, query, where, getDocs, deleteDoc, doc, orderBy } from "firebase/firestore";
import { SavedDocument } from "../types";

export default function SavedDocumentsTab() {
  const [location, setLocation] = useLocation();
  const [documents, setDocuments] = useState<SavedDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  useEffect(() => {
    loadDocuments();
  }, []);

  const loadDocuments = async () => {
    try {
      setLoading(true);
      setError(null);
      
      if (!auth.currentUser) {
        throw new Error("Must be logged in to view saved documents.");
      }

      const q = query(
        collection(db, "users", auth.currentUser.uid, "saved_documents"),
        orderBy("createdAt", "desc")
      );
      
      const querySnapshot = await getDocs(q);
      const docs: SavedDocument[] = [];
      querySnapshot.forEach((doc) => {
        docs.push({ id: doc.id, ...doc.data() } as SavedDocument);
      });
      
      setDocuments(docs);
    } catch (err: any) {
      console.error("Error loading documents:", err);
      setError(err.message || "Failed to load documents.");
    } finally {
      setLoading(false);
    }
  };
  const handleDelete = async (id: string) => {
    if (deleteConfirmId !== id) {
      setDeleteConfirmId(id);
      setTimeout(() => setDeleteConfirmId(null), 3000);
      return;
    }
    
    try {
      if (!auth.currentUser) return;
      await deleteDoc(doc(db, "users", auth.currentUser.uid, "saved_documents", id));
      setDocuments(documents.filter(d => d.id !== id));
      setDeleteConfirmId(null);
    } catch (err: any) {
      console.error("Error deleting document:", err);
      alert("Failed to delete document.");
    }
  };

  const handleOpen = (doc: SavedDocument) => {
    if (doc.type === 'template') {
      localStorage.setItem("OPA_TEMPLATES_PROGRESS", doc.content);
      setLocation("/templates");
    } else if (doc.type === 'analysis') {
      // Need a way to load analysis report into DocumentAnalyzerTab
      // Let's use localStorage to pass the data, and modify DocumentAnalyzerTab to check for it
      localStorage.setItem("OPA_LOAD_ANALYSIS_REPORT", doc.content);
      setLocation("/document-analyzer");
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Activity className="animate-spin h-8 w-8 text-slate-500" />
        <span className="ml-3 text-slate-600">Loading saved documents...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-16">
      <div className="bg-white rounded-xl p-6 md:p-8 shadow-sm border border-slate-200">
        <div className="flex items-center gap-4 mb-6">
          <div className="w-12 h-12 rounded-xl bg-purple-100 flex items-center justify-center text-purple-600">
            <FolderHeart className="h-6 w-6" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-slate-900">Saved Documents</h2>
            <p className="text-slate-600">Securely stored templates and analysis reports.</p>
          </div>
        </div>

        {error && (
          <div className="p-4 bg-red-50 text-red-800 rounded-lg border border-red-200 mb-6">
            {error}
          </div>
        )}

        {documents.length === 0 && !error ? (
          <div className="text-center py-12 border-2 border-dashed border-slate-200 rounded-xl bg-slate-50">
            <FolderHeart className="h-12 w-12 text-slate-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-slate-900 mb-2">No Saved Documents Yet</h3>
            <p className="text-slate-600 max-w-sm mx-auto">
              Draft a template or run a document analysis, then click "Save to Cloud" to keep your work securely stored here across sessions.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {documents.map((doc) => (
              <div key={doc.id} className="border border-slate-200 rounded-xl p-5 hover:border-purple-300 hover:shadow-md transition-all bg-white flex flex-col h-full">
                <div className="flex justify-between items-start mb-3">
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${doc.type === 'template' ? 'bg-brand-100 text-brand-600' : 'bg-emerald-100 text-emerald-600'}`}>
                      {doc.type === 'template' ? <FileText className="h-5 w-5" /> : <FileSearch className="h-5 w-5" />}
                    </div>
                    <div>
                      <h4 className="font-semibold text-slate-900 line-clamp-1">{doc.title}</h4>
                      <span className="text-xs font-medium uppercase tracking-wider text-slate-500">
                        {doc.type}
                      </span>
                    </div>
                  </div>
                </div>
                
                <div className="flex items-center gap-2 text-sm text-slate-500 mt-auto pt-4 mb-4">
                  <Calendar className="h-4 w-4" />
                  <span>Saved: {new Date(doc.createdAt).toLocaleDateString()}</span>
                </div>
                
                <div className="flex gap-2 border-t border-slate-100 pt-4">
                  <button
                    onClick={() => handleOpen(doc)}
                    className="flex-1 bg-slate-900 text-white hover:bg-slate-800 py-2 rounded-lg text-sm font-medium transition-colors"
                  >
                    Open Document
                  </button>
                  <button
                    onClick={() => handleDelete(doc.id)}
                    className={`p-2 rounded-lg transition-colors ${deleteConfirmId === doc.id ? "text-red-600 bg-red-100" : "text-slate-400 hover:text-red-600 hover:bg-red-50"}`}
                    aria-label="Delete document"
                  >
                    <Trash2 className="h-5 w-5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
