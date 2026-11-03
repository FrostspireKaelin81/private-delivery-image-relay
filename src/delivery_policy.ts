import { z } from 'zod';

export const shipmentEvent = z.object({
  eventId: z.string().uuid(),
  shipmentId: z.string().regex(/^[a-zA-Z0-9-]{1,64}$/),
  event: z.enum(['delivered', 'exception']),
  exception: z.enum(['damaged', 'recipient_absent']).optional(),
  proof: z.object({
    filename: z.string().regex(/^[a-zA-Z0-9_-]+\.(jpg|jpeg|png)$/i),
    contentType: z.enum(['image/jpeg', 'image/png']),
    containsPatientData: z.boolean(),
    base64: z.string().min(4).max(8_000_000).regex(/^[A-Za-z0-9+/]+={0,2}$/)
  }).strict()
}).strict().superRefine((event, ctx) => {
  if ((event.event === 'exception') !== Boolean(event.exception)) {
    ctx.addIssue({ code: 'custom', message: 'Exception events need a reason; delivered events omit it.' });
  }
});
export type ShipmentEvent = z.infer<typeof shipmentEvent>;

export function deliveryDecision(event: ShipmentEvent): 'hold_private' | 'review_exception' | 'serve' {
  if (event.proof.containsPatientData) return 'hold_private';
  return event.event === 'exception' ? 'review_exception' : 'serve';
}
