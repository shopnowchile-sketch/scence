import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const body = await request.json();

  console.log("[PayPal Influencer Webhook]", {
    event: body.event_type,
    subscriptionId: body.resource?.id,
    planId: body.resource?.plan_id,
  });

  return NextResponse.json({ received: true });
}
