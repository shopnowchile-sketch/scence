import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const body = await request.json();

  console.log("[PayPal Influencer Webhook]", body.event_type);

  return NextResponse.json({ received: true });
}
