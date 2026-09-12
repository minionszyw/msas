const fs = require('fs');
const path = require('path');

function createFakePage(finalUrl, options = {}) {
  return {
    goto: async (url) => {
      if (options.onGoto) options.onGoto(url);
    },
    waitForTimeout: async () => {},
    title: async () => options.title || '',
    url: () => finalUrl,
  };
}

function createFakeContext(page, onClose = () => {}) {
  return {
    pages: () => [page],
    newPage: async () => page,
    storageState: async (options = {}) => {
      const state = {
        cookies: [{ name: 'session', value: 'saved', domain: '.taobao.com', path: '/' }],
        origins: [],
      };
      if (options.path) {
        fs.mkdirSync(path.dirname(options.path), { recursive: true });
        fs.writeFileSync(options.path, JSON.stringify(state));
      }
      return state;
    },
    addCookies: async () => {},
    close: async () => onClose(),
  };
}

module.exports = { createFakeContext, createFakePage };
