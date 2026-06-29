import { redirect } from 'next/navigation'

// Payroll está integrado en Billing → redirige automáticamente
export default function PayrollPage() {
  redirect('/admin-billing')
}
