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

export async function getAllTasks(): Promise<Task[]> {
  const res = await api.get<{ success: boolean; data: Task[] }>('/tasks')
  return res.data.data
}

export async function createTask(payload: CreateTaskPayload): Promise<Task> {
  const res = await api.post<{ success: boolean; data: Task }>('/tasks/create', payload)
  return res.data.data
}

export async function updateTaskStatus(payload: UpdateStatusPayload): Promise<void> {
  await api.post('/admin/task/status', payload)
}

export async function updateTaskProgress(taskId: string, payload: UpdateProgressPayload): Promise<void> {
  await api.patch(`/tasks/${taskId}/progress`, payload)
}
