'use client'

import { useState } from 'react'
import { ArrowDown, ArrowUp, Eye, EyeOff, RotateCcw, SlidersHorizontal, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useLocalStorageState } from '@/hooks/useLocalStorageState'
import {
  DEFAULT_TAB_PREFS,
  PINNED_TAB,
  dropTabBefore,
  moveTab,
  normalizeTabPrefs,
  resolveTabOrder,
  setTabHidden,
  visibleTabIds,
  type TabPrefs,
} from '@/lib/campaign-tab-prefs'

export interface CampaignTabItem { id: string; label: string; icon: React.ReactNode }

/**
 * Barra de pestañas del detalle de campaña, personalizable: se pueden mover (arrastrando o con
 * flechas), ocultar y volver a agregar. La preferencia se guarda por navegador y no cambia
 * qué pestañas existen ni sus permisos: solo cómo se muestran.
 */
export function CampaignTabBar({ tabs, active, onSelect, storageKey = 'scence:campaign-tabs:v1' }: {
  tabs: CampaignTabItem[]
  active: string
  onSelect: (id: string) => void
  storageKey?: string
}) {
  const [stored, setStored] = useLocalStorageState<TabPrefs>(storageKey, DEFAULT_TAB_PREFS)
  const prefs = normalizeTabPrefs(stored)
  const [panelOpen, setPanelOpen] = useState(false)
  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)

  const allIds = tabs.map(t => t.id)
  const byId = new Map(tabs.map(t => [t.id, t]))
  const fullOrder = resolveTabOrder(allIds, prefs)
  const visible = visibleTabIds(allIds, prefs, active).map(id => byId.get(id)!).filter(Boolean)
  const hiddenSet = new Set(prefs.hidden)
  const customized = prefs.hidden.length > 0 || fullOrder.some((id, i) => id !== allIds[i])

  const savePrefs = (next: TabPrefs) => setStored(next)

  return (
    <div className="relative flex items-end border-b border-gray-200">
      <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto" role="tablist" aria-label="Secciones de la campaña">
        {visible.map(t => (
          <button key={t.id} role="tab" aria-selected={active === t.id} onClick={() => onSelect(t.id)}
            draggable
            onDragStart={e => { setDragId(t.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', t.id) }}
            onDragOver={e => { if (dragId && dragId !== t.id) { e.preventDefault(); setOverId(t.id) } }}
            onDragLeave={() => setOverId(current => current === t.id ? null : current)}
            onDrop={e => { e.preventDefault(); if (dragId) savePrefs({ ...prefs, order: dropTabBefore(fullOrder, dragId, t.id) }); setDragId(null); setOverId(null) }}
            onDragEnd={() => { setDragId(null); setOverId(null) }}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border-b-2 transition-all -mb-px whitespace-nowrap',
              active === t.id ? 'border-violet-600 text-violet-700' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300',
              dragId === t.id && 'opacity-40',
              overId === t.id && 'border-l-2 border-l-violet-400',
            )}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      <button type="button" onClick={() => setPanelOpen(open => !open)} aria-label="Personalizar pestañas" title="Personalizar pestañas" aria-expanded={panelOpen}
        className={cn('relative mb-1 ml-2 flex-shrink-0 rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700', customized && 'text-violet-600')}>
        <SlidersHorizontal className="h-4 w-4" aria-hidden />
      </button>

      {panelOpen && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setPanelOpen(false)} aria-hidden />
          <div role="dialog" aria-label="Personalizar pestañas" className="absolute right-0 top-full z-40 mt-1 w-80 rounded-xl border border-gray-200 bg-white p-3 shadow-lg">
            <div className="mb-2 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-gray-900">Pestañas</p>
                <p className="text-xs text-gray-500">Muévelas, ocúltalas o vuelve a agregarlas. También puedes arrastrarlas en la barra.</p>
              </div>
              <button type="button" onClick={() => setPanelOpen(false)} aria-label="Cerrar" className="rounded p-1 text-gray-400 hover:bg-gray-100"><X className="h-4 w-4" aria-hidden /></button>
            </div>
            <ul className="space-y-1">
              {fullOrder.map((id, index) => {
                const t = byId.get(id)
                if (!t) return null
                const hidden = hiddenSet.has(id)
                const pinned = id === PINNED_TAB
                return (
                  <li key={id} className={cn('flex items-center gap-2 rounded-lg border border-gray-100 px-2 py-1.5', hidden && 'bg-gray-50 text-gray-400')}>
                    <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-xs font-medium">{t.icon}<span className="truncate">{t.label}</span></span>
                    <button type="button" disabled={index === 0} onClick={() => savePrefs({ ...prefs, order: moveTab(fullOrder, id, -1) })} aria-label={`Mover ${t.label} antes`} title="Mover antes"
                      className="rounded p-1 text-gray-500 hover:bg-gray-100 disabled:opacity-30"><ArrowUp className="h-3.5 w-3.5" aria-hidden /></button>
                    <button type="button" disabled={index === fullOrder.length - 1} onClick={() => savePrefs({ ...prefs, order: moveTab(fullOrder, id, 1) })} aria-label={`Mover ${t.label} después`} title="Mover después"
                      className="rounded p-1 text-gray-500 hover:bg-gray-100 disabled:opacity-30"><ArrowDown className="h-3.5 w-3.5" aria-hidden /></button>
                    <button type="button" disabled={pinned} onClick={() => savePrefs(setTabHidden(allIds, prefs, id, !hidden))}
                      aria-label={hidden ? `Mostrar ${t.label}` : `Ocultar ${t.label}`} title={pinned ? 'Siempre visible' : hidden ? 'Mostrar' : 'Ocultar'}
                      className={cn('rounded p-1 hover:bg-gray-100 disabled:opacity-30', hidden ? 'text-violet-600' : 'text-gray-500')}>
                      {hidden ? <EyeOff className="h-3.5 w-3.5" aria-hidden /> : <Eye className="h-3.5 w-3.5" aria-hidden />}
                    </button>
                  </li>
                )
              })}
            </ul>
            {customized && (
              <button type="button" onClick={() => savePrefs(DEFAULT_TAB_PREFS)} className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-violet-700 hover:underline">
                <RotateCcw className="h-3 w-3" aria-hidden />Restablecer orden y pestañas
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
