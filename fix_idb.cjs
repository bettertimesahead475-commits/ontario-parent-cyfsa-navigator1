const fs = require('fs');

let code = fs.readFileSync('src/hooks/useAppReset.ts', 'utf-8');

code = code.replace(/dbs\.forEach\(db => \{\n\s*if \(db\.name\) window\.indexedDB\.deleteDatabase\(db\.name\);\n\s*\}\);/,
`await Promise.all(dbs.map(db => {
          return new Promise<void>((resolve) => {
            if (db.name) {
              const req = window.indexedDB.deleteDatabase(db.name);
              req.onsuccess = () => resolve();
              req.onerror = () => resolve();
              req.onblocked = () => resolve();
            } else {
              resolve();
            }
          });
        }));`);

fs.writeFileSync('src/hooks/useAppReset.ts', code);
