//@ts-check

const { join } = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Self-contained production server (apps/client/.next/standalone) so the
  // Docker image ships only traced files, not the whole workspace.
  output: 'standalone',
  // Monorepo: trace files from the workspace root, where bun.lock lives.
  outputFileTracingRoot: join(__dirname, '../..'),
};

module.exports = nextConfig;
