/**
 * Tasks service — fetch, create, and update tasks.
 */
import api from './api'

export interface Task {
  id: string
  title: string
  assignee?: string
  internId?: string
  status: string
  complexity: number
  deadline?: string
  blocker?: string | null
  progress?: number
  progressPct?: number
  planeTaskId?: string
  skill?: string
  skills?: string[]
  note?: string
  isStale?: boolean
  hasBlocker?: boolean
  blockerType?: string | null
}

export interface CreateTaskPayload {
  title: string
  internId: string
  planeTaskId?: string
  complexity: number
  status: string
}

export interface UpdateStatusPayload {
  taskId: string
  status: string
  progress: number
}

export interface UpdateProgressPayload {
  progressPct: number
  note?: string
  hasBlocker?: boolean
  blockerType?: string | null
}

export interface AdminTaskControlPayload {
  taskId: string
  status: string
  progress?: number
  hasBlocker?: boolean
  blockerType?: string | null
  pauseReason?: string
}

export interface TaskPagination {
  total: number
  page:  number
  limit: number
  pages: number
}

export interface TaskListResponse {
  tasks:      Task[]
  pagination: TaskPagination
}

export async function getAllTasks(params?: { status?: string; page?: number; limit?: number }): Promise<Task[]> {
  const res = await api.get<{ success: boolean; data: TaskListResponse }>('/tasks', { params })
  // Support both old shape (data is array) and new shape (data.tasks is array)
  const data = res.data.data
  if (Array.isArray(data)) return data as unknown as Task[]
  return data.tasks ?? []
}

export async function getTasksPaginated(params?: { status?: string; page?: number; limit?: number }): Promise<TaskListResponse> {
  const res = await api.get<{ success: boolean; data: TaskListResponse }>('/tasks', { params })
  const data = res.data.data
  if (Array.isArray(data)) {
    return { tasks: data as unknown as Task[], pagination: { total: (data as unknown as Task[]).length, page: 1, limit: 20, pages: 1 } }
  }
  return data
}

export async function createTask(payload: CreateTaskPayload): Promise<Task> {
  const res = await api.post<{ success: boolean; data: Task }>('/tasks/create', payload)
  return res.data.data
}

export async function updateTaskStatus(payload: UpdateStatusPayload): Promise<void> {
  await api.post('/admin/task/status', payload)
}

export async function adminControlTask(payload: AdminTaskControlPayload): Promise<void> {
  await api.post('/admin/task/status', payload)
}

export async function updateTaskProgress(taskId: string, payload: UpdateProgressPayload): Promise<void> {
  await api.patch(`/tasks/${taskId}/progress`, payload)
}

export async function deleteTask(taskId: string): Promise<void> {
  const res = await api.delete(`/tasks/${taskId}`)
  if (!res.data.success) throw new Error(res.data.message)
}

export interface TaskReview {
  id:         string
  taskId:     string
  quality:    number
  timeliness: number
  initiative: number
  complexity: number
  pps:        number
  createdAt:  string
}

export async function getReviewForTask(taskId: string): Promise<TaskReview | null> {
  const res = await api.get<{ success: boolean; data: TaskReview | null }>(`/review/task/${taskId}`)
  return res.data.data
}
