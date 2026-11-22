module.exports = function (api) {
  api.cache(true);

  return {
    presets: [
      // `jsxImportSource` routes JSX through NativeWind's runtime, which is what
      // makes `className` meaningful on React Native components.
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
      'nativewind/babel',
    ],
    // No explicit worklets/reanimated plugin: `babel-preset-expo` adds
    // `react-native-worklets/plugin` itself whenever the package is installed,
    // and adding it again here would run the worklet transform twice.
    //
    // `babel-preset-expo` is a *direct* devDependency even though `expo` depends
    // on it, and `@babel/plugin-transform-react-jsx` (a phantom dependency of
    // `react-native-css-interop`) is declared at the repository root: this
    // repository installs with bun's isolated linker, which — unlike npm/yarn —
    // links only declared dependencies, so hoisted-only packages are not
    // resolvable here.
  };
};
