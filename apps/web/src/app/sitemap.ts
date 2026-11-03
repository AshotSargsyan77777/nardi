import type { MetadataRoute } from 'next';

const SITE = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: `${SITE}/`, lastModified: now, changeFrequency: 'weekly', priority: 1 },
    { url: `${SITE}/rules`, lastModified: now, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${SITE}/leaderboard`, lastModified: now, changeFrequency: 'daily', priority: 0.6 },
    { url: `${SITE}/register`, lastModified: now, changeFrequency: 'yearly', priority: 0.5 },
    { url: `${SITE}/legal`, lastModified: now, changeFrequency: 'yearly', priority: 0.2 },
  ];
}
