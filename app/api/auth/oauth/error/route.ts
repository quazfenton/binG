import { NextRequest, NextResponse } from 'next/server';

/**
 * OAuth Error/Cancel Page for Popup Flows
 *
 * This page is opened in the OAuth popup window when authorization fails or is cancelled.
 * It sends a postMessage to the opener window to signal cancellation/error, then closes itself.
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
  const error = req.nextUrl.searchParams.get('error') || 'unknown';
  const origin = req.nextUrl.searchParams.get('origin') || '';

  // Validate origin to prevent XSS
  if (!origin || !origin.startsWith('http')) {
    return NextResponse.json({ error: 'Invalid origin' }, { status: 400 });
  }

  const errorMessages: Record<string, string> = {
    access_denied: 'You denied the authorization request.',
    invalid_state: 'Invalid state parameter. Please try again.',
    token_exchange_failed: 'Failed to obtain access token.',
    unsupported_provider: 'This provider is not supported.',
    provider_not_configured: 'This integration is not properly configured. Please contact the administrator.',
    missing_params: 'Authorization parameters are missing.',
    unknown: 'Authorization was not completed.',
  };

  const errorMessage = errorMessages[error] || errorMessages.unknown;

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Connection Failed</title>
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
    .error-icon {
      width: 80px;
      height: 80px;
      margin: 0 auto 24px;
      background: linear-gradient(135deg, #ef4444, #dc2626);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      animation: scaleIn 0.5s ease-out;
    }
    .error-icon svg {
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
    <div class="error-icon">
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M6 18L18 6M6 6l12 12" />
      </svg>
    </div>
    <h1>Connection Failed</h1>
    <p>${escapeHtml(errorMessage)}</p>
  </div>
  <script>
    (function() {
      const urlParams = new URLSearchParams(window.location.search);
      const origin = urlParams.get('origin');
      const error = ${JSON.stringify(error)};

      if (origin && window.opener && !window.opener.closed) {
        // Send cancel message to opener
        window.opener.postMessage({ type: 'oauth_cancel', error: error }, origin);
      }

      // Close popup after a short delay
      setTimeout(() => {
        window.close();
      }, 2000);
    })();
  </script>
</body>
</html>
  `;

  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html' },
  });
}
