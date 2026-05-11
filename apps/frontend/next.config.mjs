import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {
    root: projectRoot,
  },
  async rewrites() {
    const backendBase = process.env.BACKEND_INTERNAL_URL || "http://backend:8000";
    const grafanaBase = process.env.GRAFANA_INTERNAL_URL || "http://grafana:3000";
    return [
      {
        source: "/api/:path*",
        destination: `${backendBase}/:path*`,
      },
      {
        source: "/grafana/:path*",
        destination: `${grafanaBase}/grafana/:path*`,
      },
    ];
  },
};

export default nextConfig;
