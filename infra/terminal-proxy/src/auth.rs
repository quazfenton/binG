//! JWT Authentication for WebSocket connections

use anyhow::{Result, anyhow};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String,          // user_id
    pub exp: usize,           // expiration time
    pub iat: usize,           // issued at
    #[serde(default)]
    pub iss: Option<String>,  // issuer
    #[serde(default)]
    pub sandbox_ids: Vec<String>,  // allowed sandbox IDs for this user
}

impl Claims {
    pub fn user_id(&self) -> &str {
        &self.sub
    }
    
    pub fn can_access_sandbox(&self, sandbox_id: &str) -> bool {
        // If no sandbox restrictions, allow all
        if self.sandbox_ids.is_empty() {
            return true;
        }
        self.sandbox_ids.iter().any(|id| id == sandbox_id)
    }
}

/// Verify a JWT token and extract claims
pub fn verify_token(token: &str, secret: &str) -> Result<Claims> {
    use hmac::{Hmac, Mac};
    use sha2::Sha256;

    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() != 3 {
        return Err(anyhow!("Invalid JWT format"));
    }

    // Verify HMAC-SHA256 signature
    let signing_input = format!("{}.{}", parts[0], parts[1]);
    let expected_signature = decode_base64url(parts[2])
        .map_err(|e| anyhow!("Failed to decode JWT signature: {}", e))?;

    let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes())
        .map_err(|e| anyhow!("Invalid HMAC key: {}", e))?;
    mac.update(signing_input.as_bytes());
    mac.verify_slice(&expected_signature)
        .map_err(|_| anyhow!("Invalid JWT signature"))?;

    let payload = decode_base64url(parts[1])
        .map_err(|e| anyhow!("Failed to decode JWT payload: {}", e))?;

    let claims: Claims = serde_json::from_slice(&payload)
        .map_err(|e| anyhow!("Failed to parse JWT claims: {}", e))?;

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| anyhow!("Time error: {}", e))?
        .as_secs() as usize;

    if claims.exp < now {
        return Err(anyhow!("Token expired"));
    }

    Ok(claims)
}

fn decode_base64url(input: &str) -> Result<Vec<u8>> {
    use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
    URL_SAFE_NO_PAD.decode(input).map_err(|e| anyhow!("Base64 decode error: {}", e))
}

/// Extract token from Authorization header
pub fn extract_bearer_token(headers: &[(String, String)]) -> Option<String> {
    for (name, value) in headers {
        if name.eq_ignore_ascii_case("authorization") {
            if value.starts_with("Bearer ") {
                return Some(value[7..].to_string());
            }
        }
    }
    None
}