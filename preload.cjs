// preload.cjs — loaded via NODE_OPTIONS=--require ./preload.cjs
// Runs before ANY module loads. Patches fs to redirect .data -> /tmp/.data on Vercel.

if (process.env.VERCEL || process.env.VERCEL_ENV) {
  const fs = require('fs');
  const path = require('path');

  var origMkdirSync = fs.mkdirSync;
  fs.mkdirSync = function(pathArg, options) {
    var s = typeof pathArg === 'string' ? pathArg : String(pathArg);
    if (s === '.data' || s.endsWith('/.data') || s.indexOf('/.data/') !== -1) {
      try { origMkdirSync('/tmp/.data', { recursive: true }); } catch (e) { /* ignore */ }
      return;
    }
    return origMkdirSync(pathArg, options);
  };

  try {
    var fsPromises = require('fs/promises');
    var origMkdir = fsPromises.mkdir;
    fsPromises.mkdir = async function(pathArg, options) {
      var s = typeof pathArg === 'string' ? pathArg : String(pathArg);
      if (s === '.data' || s.endsWith('/.data') || s.indexOf('/.data/') !== -1) {
        try { await origMkdir('/tmp/.data', { recursive: true }); } catch (e) { /* ignore */ }
        return;
      }
      return origMkdir(pathArg, options);
    };
  } catch (e) { /* fs/promises may not be available yet */ }
}
