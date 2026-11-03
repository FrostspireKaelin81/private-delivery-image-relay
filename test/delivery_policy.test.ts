import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shipmentEvent, deliveryDecision } from '../src/delivery_policy.ts';

const proof = { filename: 'parcel.jpg', contentType: 'image/jpeg', containsPatientData: false, base64: 'YWJj' };
const event = { eventId: 'aafdf678-a80c-4ade-9dab-c3374a55e836', shipmentId: 'coldchain-42', event: 'delivered', proof };
test('patient-bearing proof is held before any remote processing', () => {
  const input = shipmentEvent.parse({ ...event, proof: { ...proof, containsPatientData: true } });
  assert.equal(deliveryDecision(input), 'hold_private');
});
test('exceptions enter review while a clean delivery may be served', () => {
  assert.equal(deliveryDecision(shipmentEvent.parse(event)), 'serve');
  assert.equal(deliveryDecision(shipmentEvent.parse({ ...event, event: 'exception', exception: 'damaged' })), 'review_exception');
  assert.equal(shipmentEvent.safeParse({ ...event, event: 'exception' }).success, false);
});
