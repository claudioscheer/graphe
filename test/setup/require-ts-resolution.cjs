const fs = require('fs');
const Module = require('module');

const originalResolveFilename = Module._resolveFilename;

Module._resolveFilename = function resolveTypescriptSource(request, parent, isMain, options) {
  try {
    return originalResolveFilename.call(this, request, parent, isMain, options);
  } catch (error) {
    if (!parent || !request.startsWith('.')) {
      throw error;
    }

    const candidates = [
      `${request}.ts`,
      `${request}.tsx`,
      `${request}/index.ts`,
    ];

    for (const candidate of candidates) {
      try {
        const resolved = originalResolveFilename.call(this, candidate, parent, isMain, options);
        if (fs.existsSync(resolved)) return resolved;
      } catch (_) {
        // Try the next TypeScript source candidate.
      }
    }

    throw error;
  }
};
