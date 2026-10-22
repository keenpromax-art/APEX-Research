import type { NextConfig } from "next";

const DATA_HOST = process.env.DATA_HOST ?? "127.0.0.1";
const DATA_PORT = process.env.DATA_PORT ?? "8010";

const nextConfig: NextConfig = {
  // `next dev` cannot execute the Python serverless function, so development
  // requests for /api/fetch/<TICKER> are proxied to the local data server
  // (`python_lib/serve.py`). Production runs the Python function on Vercel.
  async rewrites() {
    if (process.env.NODE_ENV !== "development") return [];
    return [
      {
        source: "/api/fetch/:ticker",
        destination: `http://${DATA_HOST}:${DATA_PORT}/api/fetch/:ticker`,
      },
    ];
  },
};

export default nextConfig;
