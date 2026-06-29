import { Metadata } from 'next'
import { BrandRegisterForm } from './BrandRegisterForm'

export const metadata: Metadata = {
  title: 'Registrar Marca — SCENCE',
}

export default function BrandRegisterPage() {
  return (
    <div className="w-full max-w-md mx-auto">
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-violet-600 text-white font-extrabold text-xl mb-4">S</div>
        <h1 className="text-2xl font-bold text-gray-900">SCENCE</h1>
        <p className="text-sm text-gray-400 mt-1">Portal de Marcas</p>
      </div>
      <BrandRegisterForm />
    </div>
  )
}
