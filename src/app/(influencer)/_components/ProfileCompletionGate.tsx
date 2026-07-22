'use client'

// Un perfil con datos pendientes se guía a completar desde "Mi perfil", pero
// no se redirige ni se bloquea la navegación. El bloqueo anterior podía quedar
// activado por datos legacy y llevaba cada opción del menú de vuelta al perfil.
// La validación del PATCH sigue impidiendo guardar un perfil incompleto.
export function ProfileCompletionGate({ children }: { complete: boolean; children: React.ReactNode }) {
  return <>{children}</>
}
