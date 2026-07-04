const { NxAppWebpackPlugin } = require('@nx/webpack/app-plugin');
const { join, isAbsolute } = require('path');

module.exports = {
  output: {
    path: join(__dirname, 'dist'),
    clean: true,
    ...(process.env.NODE_ENV !== 'production' && {
      devtoolModuleFilenameTemplate: '[absolute-resource-path]',
    }),
  },
  // Bundle only workspace sources; every bare module specifier stays a
  // runtime require(). Bundling vendors broke class identity twice on
  // Windows: webpack included the same package under two path casings
  // (E:\ vs e:\), splitting @nestjs/common into two copies so
  // `instanceof HttpException` failed in the exception filter (429/409/400
  // all surfaced as 500), and pg split the same way, breaking
  // @prisma/adapter-pg's `pool instanceof pg.Pool` check. Externals also
  // keep swagger-ui-dist's __dirname-based asset path real (the /docs UI
  // 404s when it is bundled) and preserve Nest's try/catch fallbacks
  // around optional peers. Runtime resolution is guaranteed everywhere:
  // dev/e2e run inside the workspace, and the production image ships
  // node_modules next to the bundle (Dockerfile prod-deps stage).
  // A custom function instead of the plugin's externalDependencies option,
  // which does not reliably match packages in bun's isolated node_modules
  // layout.
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
    {
      // NxAppWebpackPlugin replaces top-level `externals` while applying,
      // so ours must be re-installed after it.
      apply(compiler) {
        compiler.options.externals = [
          ({ request }, callback) => {
            const isBare =
              request &&
              !request.includes('!') && // loader syntax
              !request.startsWith('.') &&
              !isAbsolute(request);
            if (isBare) {
              return callback(null, `commonjs ${request}`);
            }
            callback();
          },
        ];
      },
    },
  ],
};
