import type { NextConfig } from "next";
import path from "node:path";

/**
 * Next.js configuration for sms-notify-app.
 *
 * We pin the Turbopack/Next.js workspace root to *this* project to prevent
 * Next.js 16 from walking up and finding the parent's package.json
 * (Documents/Workspace is a separate monorepo and shares the same drive).
 */
const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
