const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf-8');

// Replace the fallback arrays with just an empty string or error message
code = code.replace(/const fallbacks = \[[\s\S]*?\];\s*const randomFallback = fallbacks\[Math\.floor\(Math\.random\(\) \* fallbacks\.length\)\];/,
`const randomFallback = "[Transcription unavailable: Could not connect to transcription service]";`);

fs.writeFileSync('server.ts', code);
