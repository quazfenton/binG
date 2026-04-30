import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const { email, text, encryptedBlob } = await req.json();

    // In a real implementation, you would resolve room ID based on the email/matrixId
    // For this slim implementation, we assume a relayed relay bot/server approach
    const response = await fetch(`https://matrix.org/_matrix/client/v3/rooms/!your_room_id:matrix.org/send/m.room.message`, {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${process.env.MATRIX_ACCESS_TOKEN}`,
        'Content-Type': 'application/json' 
      },
      body: JSON.stringify({ 
        msgtype: "m.text", 
        body: encryptedBlob || text 
      })
    });

    return NextResponse.json({ success: response.ok });
  } catch (err) {
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
