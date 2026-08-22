from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=128)


class UserOut(BaseModel):
    username: str
    full_name: str
    role: str = "tester"


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: UserOut


class Procedure(BaseModel):
    key: str
    code: str | None = None
    label: str
    url: str
    needs_agency_select: bool = Field(default=True, alias="needsAgencySelect")
    auto_confirm: bool = Field(default=True, alias="autoConfirm")

    model_config = {"populate_by_name": True}


class ProcedureListResponse(BaseModel):
    total: int
    items: list[Procedure]
