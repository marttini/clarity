import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Permite rodar mais de um servidor local em paralelo (agentes e testes).
  distDir: process.env.NEXT_DIST_DIR || ".next",
  serverExternalPackages: ["postgres"],
  experimental: { serverActions: { bodySizeLimit: "26mb" } },
  turbopack: {
    rules: {
      "*.css": { loaders: ["@tailwindcss/turbopack"], as: "*.css" },
    },
  },
};

export default nextConfig;
