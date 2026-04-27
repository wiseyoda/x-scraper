/** @type {import('next').NextConfig} */
const nextConfig = {
  // Workspace packages ship as raw TS source via tsconfig paths; transpile
  // them through Next so the server-runtime sees compiled JS.
  transpilePackages: ['@x-scraper/core', '@x-scraper/vault', '@x-scraper/synthesizer'],
  // Native node modules + simple-git's child_process spawn don't bundle —
  // keep them external so Next loads them at runtime.
  serverExternalPackages: ['simple-git', 'better-sqlite3'],
};

export default nextConfig;
