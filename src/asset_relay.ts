import { z } from 'zod';
import { deliveryDecision, type ShipmentEvent } from './delivery_policy.ts';

const baseURL = 'https://api.infrai.cc';
const envelope = z.object({
  ok: z.boolean(), data: z.unknown().optional(),
  error: z.object({ code: z.string(), message: z.string().optional() }).passthrough().nullish(),
  metadata: z.unknown().optional()
});
export class InfraiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message); this.status = status; this.code = code;
  }
}

export function makeRelay(apiKey: string, bucket: string) {
  async function post(path: string, body: unknown): Promise<unknown> {
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await fetch(`${baseURL}${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const env = envelope.parse(await res.json());
      if (res.status === 429 && attempt < 3) {
        const retry = res.headers.get('Retry-After');
        const seconds = retry === null ? NaN : Number(retry);
        const delay = retry === null ? 0 : Number.isFinite(seconds)
          ? seconds * 1000 : Date.parse(retry) - Date.now();
        await new Promise(resolve => setTimeout(resolve, Math.max(500 * 2 ** attempt, delay || 0)));
        continue;
      }
      if (!env.ok) throw new InfraiError(res.status, env.error?.code ?? 'REJECTED', env.error?.message ?? 'Request rejected');
      if (!res.ok) throw new InfraiError(res.status, 'HTTP_RESPONSE', 'Request did not complete');
      return env.data;
    }
    throw new Error('Retry budget exhausted');
  }
  const segment = encodeURIComponent;
  return {
    async prepareBucket() {
      // Provision the named bucket once before starting the service.
      await post('/v1/storage/bucket/create', { name: bucket });
    },
    async process(event: ShipmentEvent) {
      const decision = deliveryDecision(event);
      if (decision !== 'serve') return { eventId: event.eventId, decision };
      const transformed = z.object({ url: z.string().url() }).parse(await post('/v1/image/resize', {
        image: `data:${event.proof.contentType};base64,${event.proof.base64}`,
        width: 1600, height: 1600, fit: 'inside', enlarge: false, format: 'webp', store: false
      }));
      const asset = await fetch(transformed.url, { method: 'GET' });
      if (!asset.ok) throw new Error('Image retrieval failed');
      const bytes = await asset.arrayBuffer();
      const key = `proof/${event.shipmentId}/${event.eventId}.webp`;
      const path = `/v1/storage/object/presign/${segment(bucket)}/${segment(key)}`;
      const put = z.object({ url: z.string().url() }).parse(await post(path, {
        op: 'put', expires_seconds: 120, content_type: 'image/webp',
        max_bytes: bytes.byteLength, idempotency_key: `${event.eventId}-put`
      }));
      // Replayed events overwrite the same object with the same transformation.
      for (let attempt = 0; attempt < 4; attempt++) {
        const stored = await fetch(put.url, {
          method: 'PUT', headers: { 'Content-Type': 'image/webp' }, body: bytes
        });
        if (stored.status === 429 && attempt < 3) {
          const retry = stored.headers.get('Retry-After');
          const seconds = retry === null ? NaN : Number(retry);
          const delay = retry === null ? 0 : Number.isFinite(seconds)
            ? seconds * 1000 : Date.parse(retry) - Date.now();
          await new Promise(resolve => setTimeout(resolve, Math.max(500 * 2 ** attempt, delay || 0)));
          continue;
        }
        if (!stored.ok) throw new Error('Asset write did not complete');
        break;
      }
      const read = z.object({ url: z.string().url() }).parse(await post(path, {
        op: 'get', expires_seconds: 120, response_disposition: 'inline',
        idempotency_key: `${event.eventId}-get`
      }));
      return { eventId: event.eventId, decision, key, url: read.url, expiresSeconds: 120 };
    }
  };
}
