const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf-8');

code = code.replace(/express\.json\(\{\s*limit:\s*"25mb"\s*\}\)/g, 'express.json({ limit: "100mb" })');
code = code.replace(/express\.urlencoded\(\{\s*limit:\s*"25mb"\s*,\s*extended:\s*true\s*\}\)/g, 'express.urlencoded({ limit: "100mb", extended: true })');

code = code.replace(/errMsg\.includes\("temporary"\);/g, 'errMsg.includes("temporary") || errMsg.includes("fetch failed") || errMsg.includes("timeout") || errMsg.includes("network");');

code = code.replace(/\["gemini-2\.5-flash", "gemini-1\.5-pro", "gemini-1\.5-flash"\]/g, '["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash", "gemini-2.0-pro-exp-02-05"]');

code = code.replace(/"gemini-3\.5-flash"/g, '"gemini-2.5-flash"');

fs.writeFileSync('server.ts', code);
console.log("Fixed server.ts!");
