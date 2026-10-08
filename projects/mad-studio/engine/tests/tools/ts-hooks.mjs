// Lets plain Node (>= 22.15) import the app's TypeScript sources directly:
//   node --experimental-transform-types --import ./ts-hooks.mjs script.mjs
// The app uses extensionless relative imports ("../model/timing"), which Node's
// ESM resolver rejects, so this hook retries them with a ".ts" suffix.
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (err) {
      const relative = specifier.startsWith('./') || specifier.startsWith('../');
      if (relative && !/\.[cm]?[jt]sx?$/.test(specifier)) return nextResolve(`${specifier}.ts`, context);
      throw err;
    }
  },
});
