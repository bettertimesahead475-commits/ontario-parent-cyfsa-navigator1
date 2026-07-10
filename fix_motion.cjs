const fs = require('fs');
let code = fs.readFileSync('src/components/DocumentAnalyzerTab.tsx', 'utf-8');

if (!code.includes('import { motion, AnimatePresence } from "motion/react";')) {
  code = code.replace(/import \{ useAppReset \} from "\.\.\/hooks\/useAppReset";/, 'import { useAppReset } from "../hooks/useAppReset";\nimport { motion, AnimatePresence } from "motion/react";');
}

fs.writeFileSync('src/components/DocumentAnalyzerTab.tsx', code);
