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
  // Ensure environment variables are available
  env: {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  },
};

module.exports = nextConfig; 