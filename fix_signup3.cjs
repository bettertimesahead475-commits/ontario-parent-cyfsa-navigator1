const fs = require('fs');

let code = fs.readFileSync('src/components/SignUpTab.tsx', 'utf-8');

code = code.replace(/export default function SignUpTab\(\) \{\n\s*const \{ resetAll \} = useAppReset\(\);/, 'export default function SignUpTab() {');

// Fix deleteNote
code = code.replace(/const deleteNote = \(id: string\) => \{\n\s*if \(deleteConfirmId !== id\) \{\n\s*setDeleteConfirmId\(id\);\n\s*setTimeout\(\(\) => setDeleteConfirmId\(null\), 3000\);\n\s*return;\n\s*\}\n\s*setDeleteConfirmId\(null\);\n\s*const updated = notes\.filter\(n => n\.id !== id\);\n\s*setNotes\(updated\);\n\s*localStorage\.setItem\("OPA_PASSPORT_NOTES", JSON\.stringify\(updated\)\);\n\s*\};/,
`const deleteNote = (id: string) => {
    if (confirm("Are you sure you want to permanently delete this memo note from your private local database?")) {
      const updated = notes.filter(n => n.id !== id);
      setNotes(updated);
      localStorage.setItem("OPA_PASSPORT_NOTES", JSON.stringify(updated));
    }
  };`);

// Fix button UI for delete note
code = code.replace(/<button\n\s*onClick=\{\(\) => deleteNote\(note\.id\)\}\n\s*className=\{\`p-1 transition-colors rounded \$\{deleteConfirmId === note\.id \? "bg-red-100 text-red-600" : "text-slate-400 hover:text-rose-500"\}\`\}\n\s*title="Delete Memo"\n\s*>\n\s*<Trash2 className="w-4 h-4" \/>\n\s*<\/button>/,
`<button
                              onClick={() => deleteNote(note.id)}
                              className="p-1 text-slate-400 hover:text-rose-500 transition-colors"
                              title="Delete Memo"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>`);

// Fix handleLogout
code = code.replace(/const handleLogout = \(\) => \{\n\s*if \(\!logoutConfirm\) \{\n\s*setLogoutConfirm\(true\);\n\s*setTimeout\(\(\) => setLogoutConfirm\(false\), 3000\);\n\s*return;\n\s*\}\n\s*setLogoutConfirm\(false\);\n\s*try \{/,
`const handleLogout = () => {
    if (confirm("Are you sure you want to log out of your Advocate Passport? Your stored worksheets will remain locally encrypted but locked until you re-authenticate.")) {
      try {`);

code = code.replace(/window\.dispatchEvent\(new CustomEvent\("opa-user-profile-updated"\)\);\n\s*\} catch \(e\) \{\n\s*console\.warn\(e\);\n\s*\}/,
`window.dispatchEvent(new CustomEvent("opa-user-profile-updated"));
      } catch (e) {
        console.warn(e);
      }
    }`);

// Fix logout button
code = code.replace(/<button \n\s*onClick=\{handleLogout\}\n\s*className=\{\`w-full py-3 border font-sans font-bold text-sm rounded-xl cursor-pointer transition-all shadow-xs \$\{logoutConfirm \? "bg-red-50 hover:bg-red-100 border-red-200 text-red-600" : "bg-white hover:bg-slate-50 border-slate-200 text-slate-700"\}\`\}\n\s*>\n\s*\{logoutConfirm \? "Confirm Lock Vault" : "Lock Vault & Log Out"\}\n\s*<\/button>/,
`<button 
                    onClick={handleLogout}
                    className="w-full py-3 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 font-sans font-bold text-sm rounded-xl cursor-pointer transition-all shadow-xs"
                  >
                    Lock Vault & Log Out
                  </button>`);

// Remove any lingering import of useAppReset
code = code.replace(/import \{ useAppReset \} from "\.\.\/hooks\/useAppReset";\n/, '');

fs.writeFileSync('src/components/SignUpTab.tsx', code);
