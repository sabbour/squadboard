if (typeof Function.prototype.resolveWeak !== 'function') {
  Object.defineProperty(Function.prototype, 'resolveWeak', {
    configurable: true,
    value(request) {
      return request;
    },
  });
}

const Module = require('node:module');
const originalLoad = Module._load;

Module._load = function loadWithDocusaurusSsrShims(request, parent, isMain) {
  if (
    typeof request === 'string' &&
    (request.endsWith('.css') ||
      request.includes('@docusaurus/theme-classic/lib/prism-include-languages') ||
      request.includes('@docusaurus/theme-classic/lib/nprogress'))
  ) {
    return {};
  }

  return originalLoad.call(this, request, parent, isMain);
};

require.extensions['.css'] = (module) => {
  module.exports = {};
};
