import { createServer } from 'node:http';
import { shipmentEvent } from './delivery_policy.ts';
import { InfraiError, makeRelay } from './asset_relay.ts';

const apiKey = process.env.INFRAI_API_KEY;
const bucket = process.env.INFRAI_BUCKET;
if (!apiKey || !bucket) throw new Error('Set INFRAI_API_KEY and INFRAI_BUCKET');
const relay = makeRelay(apiKey, bucket);
if (process.argv.includes('--prepare-bucket')) {
  await relay.prepareBucket();
  console.log('Delivery asset bucket prepared');
} else {
  createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    const send = (status: number, body: unknown) => { res.writeHead(status); res.end(JSON.stringify(body)); };
    if (req.method !== 'POST' || req.url !== '/shipment-events') {
      send(404, { error: 'Route not found' }); return;
    }
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        size += Buffer.byteLength(chunk);
        if (size > 8_100_000) { send(413, { error: 'Proof exceeds request size' }); return; }
        chunks.push(Buffer.from(chunk));
      }
      let input: unknown;
      try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { send(400, { error: 'Expected JSON' }); return; }
      const parsed = shipmentEvent.safeParse(input);
      if (!parsed.success) { send(400, { error: 'Invalid shipment event', issues: parsed.error.issues }); return; }
      send(200, await relay.process(parsed.data));
    } catch (error) {
      if (error instanceof InfraiError) {
        send(error.status >= 400 && error.status < 500 ? error.status : 502, { error: error.code });
      } else { send(502, { error: 'Asset processing did not complete' }); }
    }
  }).listen(3000, '127.0.0.1', () => console.log('Delivery relay listening on 127.0.0.1:3000'));
}
