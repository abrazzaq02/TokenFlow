// Netlify Function serving the whole TokenFlow API at /api/*.
// Data is kept in the site's Netlify Blobs store "tokenflow" (no external database needed).
import { getStore } from '@netlify/blobs';
import { createApp } from '../lib/app.mjs';
import { BlobStore } from '../lib/store.mjs';

let handler;

export default async (req, context) => {
  handler ??= createApp({
    store: new BlobStore(getStore({ name: 'tokenflow', consistency: 'strong' })),
    env: process.env,
  });
  return handler(req, context);
};

export const config = { path: '/api/*' };
