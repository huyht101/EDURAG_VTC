from secrets import compare_digest
from typing import Optional

from fastapi import Security, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from core.config import get_settings

security = HTTPBearer(auto_error=False)

def verify_internal_token(
    credentials: Optional[HTTPAuthorizationCredentials] = Security(security),
):
    """
    Verify the Bearer token matches INTERNAL_SECRET.
    Used to secure internal API endpoints from Node.js backend.
    """
    settings = get_settings()
    valid = (
        credentials is not None
        and credentials.scheme.lower() == "bearer"
        and compare_digest(credentials.credentials, settings.INTERNAL_SECRET)
    )
    if not valid:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing internal token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return credentials.credentials
