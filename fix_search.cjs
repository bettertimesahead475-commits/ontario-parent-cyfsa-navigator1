const fs = require('fs');
let code = fs.readFileSync('src/components/CYFSAGuideTab.tsx', 'utf-8');

const replacement = `  const filteredTopics = CYFSA_TOPICS.filter(t => {
    const matchesCategory = categoryFilter === "All" || t.category === categoryFilter;
    const normalizedSearch = searchQuery.toLowerCase().replace(/s\\.\\s*(\\d+)/g, 'section $1');
    const searchTerms = [
      t.title.toLowerCase(),
      t.summary.toLowerCase(),
      t.fullBody.toLowerCase(),
      ...t.primarySources.map(ps => ps.label.toLowerCase()),
      ...t.primarySources.map(ps => ps.url.toLowerCase()),
    ].join(' ');
    
    const matchesSearch = searchTerms.includes(normalizedSearch) || searchTerms.includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });`;

code = code.replace(/const filteredTopics = CYFSA_TOPICS\.filter\(t => \{[\s\S]*?return matchesCategory && matchesSearch;\s*\}\);/, replacement);

fs.writeFileSync('src/components/CYFSAGuideTab.tsx', code);
