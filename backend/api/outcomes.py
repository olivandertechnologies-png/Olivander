"""Outcome summary API endpoints.

Rolling proof-of-value metrics for owner retention and referrals.
"""
import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request

from auth.deps import get_current_business
from db.supabase import get_outcomes_summary
from rate_limit import limiter

router = APIRouter(prefix="/api/outcomes", tags=["outcomes"])
logger = logging.getLogger("olivander")


@router.get("/summary")
@limiter.limit("60/minute")
async def outcomes_summary(
    request: Request,
    business_id: str = Depends(get_current_business),
) -> dict[str, Any]:
    """Return rolling 30-day outcomes for the authenticated business."""
    try:
        return get_outcomes_summary(business_id)
    except Exception as error:
        logger.error("Outcome summary failed for %s: %s", business_id, error, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to load outcome summary.") from error
