export interface User {
  username: string
  full_name: string
  role: string
}

export interface LoginResponse {
  access_token: string
  token_type: string
  expires_in: number
  user: User
}

export interface Procedure {
  key: string
  code: string | null
  label: string
  url: string
  needsAgencySelect: boolean
  autoConfirm: boolean
}

export interface ProcedureListResponse {
  total: number
  items: Procedure[]
}
