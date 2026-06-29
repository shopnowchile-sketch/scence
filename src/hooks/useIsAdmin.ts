import { useState, useEffect } from 'react'

export type UserRole = 'super_admin' | 'agency_manager' | 'brand_manager' | 'influencer' | 'finance' | null

export function useIsAdmin(): { isAdmin: boolean; role: UserRole; loading: boolean } {
  const [isAdmin, setIsAdmin] = useState(false)
  const [role, setRole] = useState<UserRole>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    fetch('/api/me/role')
      .then(r => r.json())
      .then(j => {
        if (active) {
          setIsAdmin(!!j.isAdmin)
          setRole(j.role ?? null)
        }
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  return { isAdmin, role, loading }
}
