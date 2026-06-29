import type { Metadata } from 'next'
import { Suspense } from 'react'
import { ResetPasswordForm } from './ResetPasswordForm'

export const metadata: Metadata = { title: 'Nueva contraseña' }

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  )
}
