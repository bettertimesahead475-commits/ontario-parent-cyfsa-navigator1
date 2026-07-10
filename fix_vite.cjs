const fs = require('fs');
let code = fs.readFileSync('vite.config.ts', 'utf-8');
code = code.replace(/rollupOptions: \{[\s\S]*?\}\s*\}\s*\},/, '');
fs.writeFileSync('vite.config.ts', code);
