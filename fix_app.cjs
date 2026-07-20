const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf-8');

if (!code.includes('import { Redirect }')) {
  code = code.replace(/import \{ Link, Route, Switch, useLocation \} from "wouter";/, 'import { Link, Route, Switch, useLocation, Redirect } from "wouter";');
}

code = code.replace(/<Route>\s*<div className="text-center py-20">[\s\S]*?<\/div>\s*<\/Route>/, '<Route><Redirect to="/cyfsa-guide" /></Route>');

fs.writeFileSync('src/App.tsx', code);
