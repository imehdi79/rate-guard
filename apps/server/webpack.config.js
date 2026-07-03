const { NxAppWebpackPlugin } = require('@nx/webpack/app-plugin');
const { join } = require('path');

module.exports = {
  output: {
    path: join(__dirname, 'dist'),
    clean: true,
    ...(process.env.NODE_ENV !== 'production' && {
      devtoolModuleFilenameTemplate: '[absolute-resource-path]',
    }),
  },
  plugins: [
    new NxAppWebpackPlugin({
      target: 'node',
      compiler: 'tsc',
      main: './src/main.ts',
      tsConfig: './tsconfig.app.json',
      assets: [
        './src/assets',
        // Lua scripts are not compiled by tsc; copy them to dist/scripts so
        // the rate limiter can read them next to the bundle at runtime.
        {
          input: './src/modules/rate-limiter/scripts',
          glob: '**/*.lua',
          output: 'scripts',
        },
      ],
      optimization: false,
      outputHashing: 'none',
      generatePackageJson: false,
      sourceMap: true,
    }),
  ],
};
