// Usuarios con acceso al portal de administración
// Reutiliza el componente TeamMembers (invitar, listar, cambiar rol)
// ya construido en admin-settings/organization/page.tsx, antes no renderizado.
import { TeamMembers } from '@/app/(dashboard)/admin-settings/organization/page'

export default function AdminUsersPage() {
  return <TeamMembers />
}
