# auth.py takes the supabase access token from Authorization, checks it (jwks / es256 firs),
# and hands back the user id from the token

import os
import ssl
from functools import lru_cache
from uuid import UUID

import certifi
import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWKClient

_bearer = HTTPBearer(auto_error=False)


@lru_cache
def _supabase_url() -> str:
    url = (os.getenv("SUPABASE_URL") or "").rstrip("/")
    if not url:
        raise RuntimeError("SUPABASE_URL is not configured")
    return url


@lru_cache
def _jwks_client() -> PyJWKClient:
    # macOS/system Python often lacks CA certs; certifi fixes JWKS fetch SSL.
    ctx = ssl.create_default_context(cafile=certifi.where())
    return PyJWKClient(
        f"{_supabase_url()}/auth/v1/.well-known/jwks.json",
        ssl_context=ctx,
    )


def _issuer() -> str:
    return f"{_supabase_url()}/auth/v1"


def _decode_token(token: str) -> dict:
    # Require exp/sub; aud/iss checked below (iss formats vary slightly).
    options = {"require": ["exp", "sub"], "verify_aud": True}
    audience = "authenticated"
    issuers = [_issuer(), _supabase_url()]

    # Prefer asymmetric JWKS (modern Supabase signing keys).
    try:
        key = _jwks_client().get_signing_key_from_jwt(token)
        return jwt.decode(
            token,
            key.key,
            algorithms=["ES256", "RS256", "EdDSA"],
            audience=audience,
            issuer=issuers,
            options=options,
        )
    except Exception:
        pass

    # Legacy shared JWT secret (HS256).
    secret = os.getenv("SUPABASE_JWT_SECRET") or ""
    if not secret:
        raise HTTPException(status_code=401, detail="invalid or expired token")

    try:
        return jwt.decode(
            token,
            secret,
            algorithms=["HS256"],
            audience=audience,
            issuer=issuers,
            options=options,
        )
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=401, detail="invalid or expired token") from exc


def get_current_user_id(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> UUID:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=401, detail="missing bearer token")
    claims = _decode_token(credentials.credentials)
    try:
        return UUID(str(claims["sub"]))
    except (KeyError, ValueError) as exc:
        raise HTTPException(status_code=401, detail="invalid token subject") from exc
