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


class CreateJobRequest(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    procedure: str = Field(min_length=1, max_length=100)
    # Ma test cua lan chay thu; luu vao lich su de tra lai phien nao la phien nao
    test_code: str | None = Field(default=None, max_length=64, alias="testCode")

    model_config = {"populate_by_name": True}


class SaveUserRequest(BaseModel):
    """Tao moi hoac cap nhat tai khoan. Bo trong password = giu mat khau cu."""

    username: str = Field(min_length=1, max_length=64)
    password: str | None = Field(default=None, max_length=128)
    full_name: str | None = Field(default=None, max_length=120, alias="fullName")
    role: str = Field(default="tester", pattern="^(admin|tester)$")

    model_config = {"populate_by_name": True}


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
