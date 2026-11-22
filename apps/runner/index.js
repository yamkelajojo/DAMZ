// Install native WebCrypto before Expo Router loads the app bundle. HPKE uses
// the WebCrypto API for X25519, HKDF-SHA256, and AES-GCM.
const { install } = require('react-native-quick-crypto');

install();
require('expo-router/entry');
