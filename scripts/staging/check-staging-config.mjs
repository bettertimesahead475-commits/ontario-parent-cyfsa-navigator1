#!/usr/bin/env node
// Reports whether the staging credit tests can run, without printing any secret.
// Prints presence and the project ref only. Exit 0 = ready; 1 = not set or unsafe.
const PRODUCTION_REF = "qboidsfpjuxeqtfotryj"; // cyfsa-navigator live: must never be the staging target
const url = process.env.STAGING_SUPABASE_URL || "";
const key = process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY || "";
let ok = true;
const ref = (url.match(/^https:\/\/([a-z0-9]+)\.supabase\.co\/?$/) || [])[1] || null;
if (!url) { console.log("STAGING_SUPABASE_URL: NOT SET"); ok = false; }
else if (!ref) { console.log("STAGING_SUPABASE_URL: set, but not a https://<ref>.supabase.co URL"); ok = false; }
else if (ref === PRODUCTION_REF) { console.log("STAGING_SUPABASE_URL: points at the PRODUCTION project. Refusing."); ok = false; }
else console.log(`STAGING_SUPABASE_URL: set (project ref ${ref}, not production)`);
console.log(key ? "STAGING_SUPABASE_SERVICE_ROLE_KEY: set (value not shown)" : "STAGING_SUPABASE_SERVICE_ROLE_KEY: NOT SET");
if (!key) ok = false;
console.log(ok ? "Ready: the six staging tests can run." : "Not ready. Set the variables as environment secrets, then re-run.");
process.exit(ok ? 0 : 1);
