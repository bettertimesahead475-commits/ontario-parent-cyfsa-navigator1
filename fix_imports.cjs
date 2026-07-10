const fs = require('fs');

const files = [
  'src/components/DocumentAnalyzerTab.tsx',
  'src/components/TemplatesTab.tsx',
  'src/components/ParentChatBot.tsx'
];

for (const file of files) {
  let code = fs.readFileSync(file, 'utf-8');
  if (!code.includes('import { useAppReset } from "../hooks/useAppReset";')) {
    code = code.replace(/import React/, 'import { useAppReset } from "../hooks/useAppReset";\nimport React');
    fs.writeFileSync(file, code);
  }
}
