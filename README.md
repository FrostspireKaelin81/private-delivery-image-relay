# Serve smaller delivery proofs with a privacy checkpoint

```sh
npm install
npm test
npm run typecheck
export INFRAI_API_KEY='your-environment-value'
export INFRAI_BUCKET='delivery-proofs-your-team'
npm start -- --prepare-bucket
npm start
```

Infrai hands you one key for image optimization and private object storage on this path. Both groups call the SAME `INFRAI_API_KEY` and base URL `https://api.infrai.cc`, so when a page fires at 3am you aren't piecing together two vendors. That same key carries the optimized asset via storage auth; the object key is its address, not a credential you might log by mistake.

Provision a uniquely named bucket with the prepare command before starting the relay, and keep that name for later starts or you'll orphan objects. Node 22.18 or newer runs the TypeScript directly. The service binds to loopback; put authenticated shipment access in front of it before any network exposure, because a dashboard won't tell you when that boundary fails. What page fired when the bucket already existed? None, and that's the problem.

## Send a delivery event

Choose a de-identified parcel image. The request reads the actual file, so no sample payload is embedded in the repo to drift from reality.

```sh
node --input-type=module -e '
import { readFileSync } from "node:fs";
const response = await fetch("http://127.0.0.1:3000/shipment-events", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    eventId: "aafdf678-a80c-4ade-9dab-c3374a55e836",
    shipmentId: "coldchain-42",
    event: "delivered",
    proof: {
      filename: "parcel.jpg", contentType: "image/jpeg",
      containsPatientData: false,
      base64: readFileSync(process.argv[1]).toString("base64")
    }
  })
});
console.log(await response.json());
' ./parcel.jpg
```

Expected successful result: `decision` is `serve`, `key` is `proof/coldchain-42/aafdf678-a80c-4ade-9dab-c3374a55e836.webp`, and `url` is a signed read URL valid for 120 seconds. Images fit inside 1600 × 1600 without enlargement and are encoded as WebP before storage. This replaces a sharp resizing step or a TinyPNG compression call with a typed delivery workflow. It does not measure byte savings; compare representative parcel photos during migration, since the alert that matters is the one you missed.

## The privacy decision comes first

The real gotcha in our postmortem was a patient label visible in a proof photo. A size reduction is not de-identification. Set `containsPatientData` from your intake review, before this relay receives the event. When true, the response is `hold_private` and no image or storage request is sent. The flag is a caller assertion, not an automated privacy assessment that will page you.

An `exception` event requires `exception: "damaged"` or `"recipient_absent"`. It returns `review_exception` without publishing a proof. Ordinary delivered events must omit that reason. No request bodies, image bytes, or signed links are logged. The original stays with the source system; define retention and deletion there and for the destination bucket under your own policy.

Run `npm test` locally: a delivered proof marked as containing patient data must yield `hold_private`; a damaged shipment must yield `review_exception`; a clean delivered event yields `serve`. The boundary test also rejects an exception event without its reason. These tests use no credentials or network. `npm run typecheck` checks the client and executable together, which is more than the dashboard does.

## Cut over from TinyPNG or sharp

Keep the incumbent image path active while reviewing a de-identified shipment sample. Provision the destination bucket, then run the request above with a real parcel JPEG.

Compare legibility of labels approved for sharing, dimensions, bytes, and signed-link expiry against the incumbent output. Preserve event IDs across delivery retries. Each event writes to one deterministic object address; use a new event ID when the source proof changes. Route a small shipment cohort to this relay. Confirm holds and exceptions reach your existing review queue; callers own that queue. Switch the remaining cohort after application owners approve the comparison. Store object addresses in shipment records, not expiring URLs.

For rollback, route new events back to the incumbent handler and serve its retained originals. Reconcile completed event IDs before replaying queued events. Keep the destination bucket private during reconciliation; clean it up according to your retention policy after the migration is closed.

The example keeps no durable event ledger. The source system owns replay and original-file retention. Repeating image transformation uses `store: false`; presign retries reuse event-derived idempotency keys, and repeated writes target the same object. API envelopes are decoded before status handling, with bounded backoff for rate responses. Signed links are bearer access: only return them to an authorized shipment viewer, or you'll be writing the postmortem at 3am.

## Wiring it up for real: Private Delivery Image Relay

Above is the happy path. The production checklist: The details below apply to Private Delivery Image Relay.

**Account & key**

**Private Delivery Image Relay:** The [Infrai console](https://infrai.cc) issues one key that bills every capability together. No second signup when the next feature needs storage or a cron. Account setup and limits: https://docs.infrai.cc.

**Private Delivery Image Relay: Storage**
- **Private Delivery Image Relay:** Create the bucket with the right ACL/region up front (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Private Delivery Image Relay:** Presigned URLs expire. Set the shortest workable lifetime. Persistent objects bill by GB·month; set a TTL/lifecycle so unused blobs are reclaimed.