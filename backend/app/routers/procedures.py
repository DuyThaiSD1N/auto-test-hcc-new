from fastapi import APIRouter, Depends, HTTPException, Query, status

from ..deps import get_current_user
from ..schemas import Procedure, ProcedureListResponse, UserOut
from ..store import get_procedure, search_procedures

router = APIRouter(prefix="/api/procedures", tags=["procedures"])


@router.get("", response_model=ProcedureListResponse)
def list_procedures(
    q: str | None = Query(default=None, description="Tim theo ten thu tuc hoac ma thu tuc"),
    _: UserOut = Depends(get_current_user),
) -> ProcedureListResponse:
    items = search_procedures(q)
    return ProcedureListResponse(total=len(items), items=items)


@router.get("/{key}", response_model=Procedure)
def procedure_detail(key: str, _: UserOut = Depends(get_current_user)) -> Procedure:
    item = get_procedure(key)
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Khong tim thay thu tuc")
    return item
