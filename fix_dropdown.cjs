const fs = require('fs');
let code = fs.readFileSync('src/components/DocumentAnalyzerTab.tsx', 'utf-8');

const replacement = `        {/* Action tabs switcher & Session persistence */}
        <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center self-start">
          <div className="flex items-center gap-2 bg-slate-100 rounded-xl p-1.5 border border-slate-200">
            <span className="text-[10px] text-slate-500 font-mono pl-1 shrink-0 flex items-center gap-1 font-bold uppercase tracking-wider">
              AI Intelligence
            </span>
            <select
              value={claudeModel}
              onChange={(e) => setClaudeModel(e.target.value)}
              className="text-[10px] font-mono bg-white border border-slate-200 rounded px-2 py-1 outline-none text-slate-700 cursor-pointer hover:border-brand-300 transition-colors"
            >
              <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
              <option value="gemini-1.5-pro">Gemini 1.5 Pro</option>
              <option value="claude-3-5-sonnet-20241022">Claude 3.5 Sonnet</option>
              <option value="claude-3-5-haiku-20241022">Claude 3.5 Haiku</option>
            </select>
          </div>
          
          {/* Active Session status & manual save controller */}
          <div className="flex items-center gap-2 bg-slate-100 rounded-xl p-1.5 border border-slate-200">`;

code = code.replace(/\{\/\* Action tabs switcher & Session persistence \*\/\}\s*<div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center self-start">\s*\{\/\* Active Session status & manual save controller \*\/\}\s*<div className="flex items-center gap-2 bg-slate-100 rounded-xl p-1\.5 border border-slate-200">/, replacement);

fs.writeFileSync('src/components/DocumentAnalyzerTab.tsx', code);
