import type { NextConfig } from "next";

const ossImageHost = (
  process.env.ALI_OSS_ENDPOINT ||
  (
    process.env.ALI_OSS_BUCKET && process.env.ALI_OSS_REGION
      ? `${process.env.ALI_OSS_BUCKET}.${process.env.ALI_OSS_REGION}.aliyuncs.com`
      : ""
  )
).replace(/^https?:\/\//, "").replace(/\/+$/, "");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  images: {
    remotePatterns: ossImageHost
      ? [
          {
            protocol: "https",
            hostname: ossImageHost,
          },
          {
            protocol: "https",
            hostname: "upload.wikimedia.org",
          },
        ]
      : [
          {
            protocol: "https",
            hostname: "upload.wikimedia.org",
          },
        ],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
