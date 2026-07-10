const fs = require('fs');

let code = fs.readFileSync('src/components/ParentChatBot.tsx', 'utf-8');

code = code.replace(/const handleClearChat = \(\) => \{\n\s*if \(\!resetConfirm\) \{\n\s*setResetConfirm\(true\);\n\s*setTimeout\(\(\) => setResetConfirm\(false\), 3000\);\n\s*return;\n\s*\}\n\s*setResetConfirm\(false\);\n\s*setMessages\([\s\S]*?\]\);\n\s*\};/,
`const handleClearChat = () => {
    if (!resetConfirm) {
      setResetConfirm(true);
      setTimeout(() => setResetConfirm(false), 3000);
      return;
    }
    setResetConfirm(false);
    resetAll();
  };`);

fs.writeFileSync('src/components/ParentChatBot.tsx', code);
