import { NextRequest, NextResponse } from 'next/server';

/**
 * OAuth Success Page for Popup Flows
 *
 * This page is opened in the OAuth popup window after successful authorization.
 * It sends a postMessage to the opener window to signal success, then closes itself.
 *
 * Usage: Redirect here from the OAuth callback with ?provider=xxx&origin=yyy
 */

/**
 * Escape HTML special characters to prevent XSS
 */
function escapeHtml(text: string): string {
  const escapeMap: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#x27;',
    '/': '&#x2F;',
  };
  return text.replace(/[&<>"'/]/g, char => escapeMap[char]);
}

export async function GET(req: NextRequest) {
  const provider = req.nextUrl.searchParams.get('provider') || 'unknown';
  const origin = req.nextUrl.searchParams.get('origin') || '';

  // Validate origin to prevent XSS
  if (!origin || !origin.startsWith('http')) {
    return NextResponse.json({ error: 'Invalid origin' }, { status: 400 });
  }

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Connection Successful</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      color: #fff;
    }
    .container {
      text-align: center;
      padding: 40px;
    }
    .success-icon {
      width: 80px;
      height: 80px;
      margin: 0 auto 24px;
      background: linear-gradient(135deg, #10b981, #059669);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      animation: scaleIn 0.5s ease-out;
    }
    .success-icon svg {
      width: 40px;
      height: 40px;
      color: white;
    }
    h1 {
      font-size: 24px;
      font-weight: 600;
      margin-bottom: 8px;
      animation: fadeIn 0.5s ease-out 0.2s both;
    }
    p {
      color: #9ca3af;
      font-size: 14px;
      animation: fadeIn 0.5s ease-out 0.3s both;
    }
    @keyframes scaleIn {
      from { transform: scale(0); opacity: 0; }
      to { transform: scale(1); opacity: 1; }
    }
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="success-icon">
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7" />
      </svg>
    </div>
    <h1>Connected!</h1>
    <p>Your ${escapeHtml(provider)} account has been connected successfully.</p>
  </div>
  <script>
    (function() {
      // Get origin from URL parameter
      const urlParams = new URLSearchParams(window.location.search);
      const origin = urlParams.get('origin');
      const provider = ${JSON.stringify(provider)};

      if (origin && window.opener && !window.opener.closed) {
        // Send success message to opener
        window.opener.postMessage({ type: 'oauth_success', provider: provider }, origin);
      }

      // Close popup after a short delay
      setTimeout(() => {
        window.close();
      }, 1500);
    })();
  </script>
</body>
</html>
  `;

  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html' },
  });
}
