import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  output: 'export',
  // The published site lives under /home on GitHub Pages; local dev has no base path.
  basePath: process.env.DOCS_BASE_PATH || '',
  reactStrictMode: true,
  images: { unoptimized: true },
  agentRules: false,
};

export default withMDX(config);
