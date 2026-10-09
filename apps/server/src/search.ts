import { Client } from '@elastic/elasticsearch';
import { config } from './config.js';
import type { EmailRecord } from './types.js';

const indexName = 'reachinbox-emails';
let client: Client | null = null;
let available = false;

export async function initializeSearch() {
  try {
    client = new Client({ node: config.elasticsearchUrl, requestTimeout: 1500 });
    await client.indices.create({ index: indexName, mappings: { properties: { userId: { type: 'keyword' }, status: { type: 'keyword' }, recipientEmail: { type: 'text' }, subject: { type: 'text' }, body: { type: 'text' }, scheduledAt: { type: 'date' }, sentAt: { type: 'date' } } } });
  } catch (error: any) {
    if (error?.meta?.statusCode !== 400) console.warn('Elasticsearch unavailable; SQL search fallback will be used.');
  }
  try { if (client) { await client.cluster.health(); available = true; } } catch { available = false; }
  return available;
}

export async function indexEmail(email: EmailRecord) {
  if (!client || !available) return;
  try {
    await client.index({ index: indexName, id: email.id, document: { userId: email.userId, status: email.status, recipientEmail: email.recipientEmail, subject: email.subject, body: email.body, scheduledAt: email.scheduledAt, sentAt: email.sentAt } });
  } catch (error) { console.warn('Email index update failed:', error); }
}

export async function searchEmails(userId: string, query: string) {
  if (!client || !available) return null;
  const response = await client.search<{ id: string; userId: string; status: string; recipientEmail: string; subject: string; body: string; scheduledAt: string; sentAt?: string }>({ index: indexName, query: { bool: { must: [{ multi_match: { query, fields: ['recipientEmail', 'subject', 'body'] } }], filter: [{ term: { userId } }] } } });
  return response.hits.hits.map((hit) => ({ id: hit._id, ...hit._source }));
}

export function searchIsAvailable() { return available; }
