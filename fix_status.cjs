const fs = require('fs');
let code = fs.readFileSync('src/components/DocumentAnalyzerTab.tsx', 'utf-8');

code = code.replace(/analysisStatus: "unprocessed"/g, 'analysisStatus: "pending"');

fs.writeFileSync('src/components/DocumentAnalyzerTab.tsx', code);
