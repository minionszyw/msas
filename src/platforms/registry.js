const PLATFORM_FACTORIES = Object.freeze({
  jd: (options) => require('./jdPlatform').createJdPlatform(options),
  tb: (options) => require('./tbPlatform').createTbPlatform(options),
  pdd: null,
});
const SUPPORTED_PLATFORMS = Object.freeze(Object.keys(PLATFORM_FACTORIES));

function createPlatformAdapters(options = {}) {
  return new Map(Object.entries(PLATFORM_FACTORIES)
    .filter(([, factory]) => factory)
    .map(([platform, factory]) => [platform, factory(options)]));
}

module.exports = { SUPPORTED_PLATFORMS, createPlatformAdapters };
