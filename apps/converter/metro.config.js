const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

/**
 * `input` is resolved against the project root, so it is written project-relative.
 * NativeWind compiles the Tailwind output per platform and injects it into the
 * bundle; nothing imports the CSS from JavaScript.
 */
module.exports = withNativeWind(config, { input: './global.css' });
