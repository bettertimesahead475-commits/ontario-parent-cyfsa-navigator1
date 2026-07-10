const fs = require('fs');

let code = fs.readFileSync('src/components/ParentChatBot.tsx', 'utf-8');

code = code.replace(/export default function ParentChatBot\(\) \{/, 'export default function ParentChatBot() {\n  const { resetAll } = useAppReset();\n  const [resetConfirm, setResetConfirm] = useState(false);');

fs.writeFileSync('src/components/ParentChatBot.tsx', code);
