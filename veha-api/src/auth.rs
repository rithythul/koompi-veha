use axum::{
    extract::{Request, State},
    http::{HeaderMap, StatusCode},
    middleware::Next,
    response::IntoResponse,
};

use crate::AppState;

/// Hash a password using Argon2.
pub fn hash_password(password: &str) -> Result<String, argon2::password_hash::Error> {
    use argon2::{Argon2, PasswordHasher};
    use argon2::password_hash::SaltString;
    use rand::rngs::OsRng;

    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    let hash = argon2.hash_password(password.as_bytes(), &salt)?;
    Ok(hash.to_string())
}

/// Verify a password against an Argon2 hash.
pub fn verify_password(password: &str, hash: &str) -> bool {
    use argon2::{Argon2, PasswordVerifier};
    use argon2::password_hash::PasswordHash;

    let parsed = match PasswordHash::new(hash) {
        Ok(h) => h,
        Err(_) => return false,
    };
    Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .is_ok()
}

/// Middleware that checks for a valid session cookie.
/// Skips auth for: /health, /api/auth/*, /ws/*, and static files (non-/api/ routes).
pub async fn require_auth(
    State(state): State<AppState>,
    headers: HeaderMap,
    request: Request,
    next: Next,
) -> impl IntoResponse {
    let path = request.uri().path();

    // Skip auth for public routes
    if path == "/health"
        || path.starts_with("/api/auth/")
        || path.starts_with("/ws/")
        || !path.starts_with("/api/")
    {
        return next.run(request).await;
    }

    // Extract session token from cookie
    let session_token = extract_session_token(&headers);

    let token = match session_token {
        Some(t) => t,
        None => return (StatusCode::UNAUTHORIZED, "Not authenticated").into_response(),
    };

    // Validate session in DB
    match crate::db::get_valid_session(&state.db, token).await {
        Ok(Some(_user)) => next.run(request).await,
        Ok(None) => (StatusCode::UNAUTHORIZED, "Session expired").into_response(),
        Err(e) => {
            tracing::error!("Session validation error: {e}");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

/// Extract the veha_session cookie value from headers.
pub fn extract_session_token<'a>(headers: &'a HeaderMap) -> Option<&'a str> {
    headers
        .get("cookie")
        .and_then(|v| v.to_str().ok())
        .and_then(|cookies| {
            cookies
                .split(';')
                .find_map(|c| c.trim().strip_prefix("veha_session="))
        })
}
