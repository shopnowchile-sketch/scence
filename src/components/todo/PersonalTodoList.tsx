'use client'

import { FormEvent, useCallback, useEffect, useState } from 'react'
import { Check, ListTodo, Loader2, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

type TodoTask = {
  id: string
  title: string
  completed: boolean
  created_at: string
}

type TodoResponse = {
  data?: TodoTask | TodoTask[]
  error?: string
}

async function readResponse(response: Response): Promise<TodoResponse> {
  const result = await response.json().catch(() => ({})) as TodoResponse
  if (!response.ok) throw new Error(result.error ?? 'No se pudo completar la acción.')
  return result
}

export function PersonalTodoList() {
  const [tasks, setTasks] = useState<TodoTask[]>([])
  const [title, setTitle] = useState('')
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [changingId, setChangingId] = useState<string | null>(null)

  const loadTasks = useCallback(async () => {
    try {
      const result = await readResponse(await fetch('/api/todos', { cache: 'no-store' }))
      setTasks(Array.isArray(result.data) ? result.data : [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudieron cargar tus tareas.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadTasks()
  }, [loadTasks])

  async function addTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const cleanTitle = title.trim()
    if (!cleanTitle || adding) return

    setAdding(true)
    try {
      const result = await readResponse(await fetch('/api/todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: cleanTitle }),
      }))
      const created = Array.isArray(result.data) ? result.data[0] : result.data
      if (created) setTasks(current => [created, ...current])
      else await loadTasks()
      setTitle('')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo agregar la tarea.')
    } finally {
      setAdding(false)
    }
  }

  async function toggleTask(task: TodoTask) {
    if (changingId) return
    setChangingId(task.id)
    try {
      const result = await readResponse(await fetch(`/api/todos/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completed: !task.completed }),
      }))
      const updated = Array.isArray(result.data) ? result.data[0] : result.data
      setTasks(current => current.map(item => item.id === task.id
        ? (updated ?? { ...item, completed: !item.completed })
        : item))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo actualizar la tarea.')
    } finally {
      setChangingId(null)
    }
  }

  async function deleteTask(taskId: string) {
    if (changingId) return
    setChangingId(taskId)
    try {
      await readResponse(await fetch(`/api/todos/${taskId}`, { method: 'DELETE' }))
      setTasks(current => current.filter(task => task.id !== taskId))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo eliminar la tarea.')
    } finally {
      setChangingId(null)
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-5 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-100 text-violet-600">
          <ListTodo className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">To-Do</h1>
          <p className="text-sm text-gray-500">Tus tareas personales.</p>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <form onSubmit={addTask} className="flex gap-2 border-b border-gray-100 p-4">
          <input
            value={title}
            onChange={event => setTitle(event.target.value)}
            maxLength={200}
            placeholder="Agregar una tarea"
            aria-label="Nueva tarea"
            className="min-w-0 flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
          />
          <button
            type="submit"
            disabled={!title.trim() || adding}
            className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Agregar
          </button>
        </form>

        {loading ? (
          <div className="flex items-center justify-center py-14 text-gray-400">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : tasks.length === 0 ? (
          <div className="px-4 py-14 text-center">
            <Check className="mx-auto mb-2 h-7 w-7 text-gray-300" />
            <p className="text-sm font-medium text-gray-600">No tienes tareas pendientes.</p>
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {tasks.map(task => {
              const changing = changingId === task.id
              return (
                <li key={task.id} className="flex items-center gap-3 px-4 py-3">
                  <button
                    type="button"
                    onClick={() => void toggleTask(task)}
                    disabled={changing}
                    aria-label={task.completed ? `Marcar ${task.title} como pendiente` : `Completar ${task.title}`}
                    className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border transition ${task.completed ? 'border-violet-600 bg-violet-600 text-white' : 'border-gray-300 text-transparent hover:border-violet-500'} disabled:opacity-50`}
                  >
                    <Check className="h-3.5 w-3.5" />
                  </button>
                  <span className={`min-w-0 flex-1 break-words text-sm ${task.completed ? 'text-gray-400 line-through' : 'text-gray-800'}`}>
                    {task.title}
                  </span>
                  <button
                    type="button"
                    onClick={() => void deleteTask(task.id)}
                    disabled={changing}
                    aria-label={`Eliminar ${task.title}`}
                    className="rounded-md p-1.5 text-gray-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                  >
                    {changing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
