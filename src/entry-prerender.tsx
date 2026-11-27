import { renderToString } from "react-dom/server";
import { prerenderToNodeStream } from "react-dom/static";
import { Router } from "wouter";
import App from "./App";
export { NOINDEX_ROUTE_META, NOT_FOUND_META, PUBLIC_ROUTE_META, renderDocument, resolveRouteMeta } from "./components/SeoMetadata";

const tree = (path: string) => (
  <Router ssrPath={path}>
    <App />
  </Router>
);

/**
 * Signed-out HTML for one public route. The first pass only loads the route's lazy chunks; the second renders
 * them inline, so the output has no Suspense placeholders and no inline scripts (the CSP forbids them).
 */
export async function renderRoute(path: string): Promise<string> {
  const { prelude } = await prerenderToNodeStream(tree(path));
  for await (const _chunk of prelude) { /* drain */ }
  return renderToString(tree(path));
}
