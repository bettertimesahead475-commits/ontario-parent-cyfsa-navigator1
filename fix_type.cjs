const fs = require('fs');
let code = fs.readFileSync('src/components/DocumentAnalyzerTab.tsx', 'utf-8');

code = code.replace(/categoryIndex = "Third-Party Professional Records";/g, 'categoryIndex = "Children Services";');
code = code.replace(/uploadDate: new Date\(\)\.toISOString\(\),/g, 'uploadedAt: new Date().toISOString(),\n        mimeType: finalMimeType,');

fs.writeFileSync('src/components/DocumentAnalyzerTab.tsx', code);
