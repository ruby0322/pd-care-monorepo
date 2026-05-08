/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    const backendBase = process.env.BACKEND_INTERNAL_URL || "http://backend:8000";
    return [
      {
        source: "/api/:path*",
        destination: `${backendBase}/:path*`,
      },
    ];
  },
};

export default nextConfig;
