const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

// Noble Ed25519 imports Node's `crypto` module. Resolve that import to the
// native implementation installed by the Runner's Expo development build.
const upstreamResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'crypto' || moduleName === 'node:crypto') {
    return context.resolveRequest(context, 'react-native-quick-crypto', platform);
  }
  return upstreamResolveRequest
    ? upstreamResolveRequest(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};

/**
 * `input` is resolved against the project root, so it is written project-relative.
 * NativeWind compiles the Tailwind output per platform and injects it into the
 * bundle; nothing imports the CSS from JavaScript.
 */
module.exports = withNativeWind(config, { input: './global.css' });
