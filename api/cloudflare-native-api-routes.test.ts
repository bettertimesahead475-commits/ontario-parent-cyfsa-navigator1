import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { NATIVE_API_ROUTES, nativeRouteMethods } from '../functions/api/_native-api-routes';

// Every routable module under functions/api (no leading underscore, not a [[catch-all]]).
function routeModules(dir = 'functions/api', base = '/api'): Array<{ file: string; route: string }> {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name.startsWith('[') || entry.name === 'analyze' || entry.name === 'professional-workspace' ? [] : routeModules(full, `${base}/${entry.name}`);
    if (!entry.name.endsWith('.ts') || entry.name.startsWith('_') || entry.name.startsWith('[')) return [];
    return [{ file: full, route: `${base}/${entry.name.replace(/\.ts$/, '')}` }];
  });
}

const METHOD_EXPORTS: Record<string, string> = {
  onRequestGet: 'GET', onRequestPost: 'POST', onRequestPut: 'PUT', onRequestDelete: 'DELETE', onRequestPatch: 'PATCH', onRequestOptions: 'OPTIONS', onRequestHead: 'HEAD',
};

describe('native API route map', () => {
  it('lists every functions/api route with exactly the methods its module exports', async () => {
    const modules = routeModules();
    expect(modules.length).toBeGreaterThan(5);
    for (const { file, route } of modules) {
      const mod = await import(path.resolve(file));
      const methods = 'onRequest' in mod ? ['ALL'] : Object.keys(METHOD_EXPORTS).filter((k) => k in mod).map((k) => METHOD_EXPORTS[k]).sort();
      expect({ route, methods }).toEqual({ route, methods: [...(NATIVE_API_ROUTES[route] ?? ['<missing from map>'])].sort() });
    }
    expect(Object.keys(NATIVE_API_ROUTES).sort()).toEqual(modules.map((m) => m.route).sort());
  });
});

describe('nativeRouteMethods trailing-slash handling (S8786 linear rewrite)', () => {
  it('ignores any number of trailing slashes, as before', () => {
    expect(nativeRouteMethods('/api/health')).toEqual(['GET']);
    expect(nativeRouteMethods('/api/health///')).toEqual(['GET']);
    expect(nativeRouteMethods('/api/analyze/job/abc/')).toEqual(['GET']);
    expect(nativeRouteMethods('/')).toBeNull();
    expect(nativeRouteMethods('//api/health')).toBeNull();
  });

  it('is linear on a path with 50,000 slashes in the middle', () => {
    const t0 = performance.now();
    expect(nativeRouteMethods('/api' + '/'.repeat(50_000) + 'x')).toBeNull();
    expect(performance.now() - t0).toBeLessThan(100);
  });
});
