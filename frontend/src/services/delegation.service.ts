/**
 * delegation.service.ts — Core Admin Delegation API
 */
import api from './api'

export interface DelegateUser {
  id:          string
  name:        string
  email:       string
  role:        string
  status:      string
  isDelegated: boolean
}

export interface DelegationResponse {
  users:       DelegateUser[]
  delegateIds: string[]
}

export async function getDelegationList(): Promise<DelegationResponse> {
  const res = await api.get<{ success: boolean; data: DelegationResponse }>('/delegation')
  return res.data.data
}

export async function grantDelegation(userId: string): Promise<void> {
  await api.post(`/delegation/${userId}`)
}

export async function revokeDelegation(userId: string): Promise<void> {
  await api.delete(`/delegation/${userId}`)
}
