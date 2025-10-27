/** @type {import('next').NextConfig} */

import type { Metadata } from 'next';
import { IMAGES } from './next.config';

const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'vercel.app',
      },
      {
        protocol: 'https',
        hostname: 'vercel-storage.com',
      },
    ],
  },
};

export default nextConfig;