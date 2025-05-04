/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Add specific settings for error handling
  onDemandEntries: {
    // Keep the pages in memory longer
    maxInactiveAge: 60 * 60 * 1000,
    // Have more pages loaded at once
    pagesBufferLength: 5,
  },
};

module.exports = nextConfig; 