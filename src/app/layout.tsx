import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { Toaster } from 'sonner'
import { QueryProvider } from '@/components/providers/QueryProvider'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })

export const metadata: Metadata = {
  title: { default: 'SCENCE', template: '%s · SCENCE' },
  description: 'Campaign Management Platform para marcas e influencers',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body className={`${inter.variable} font-sans antialiased bg-gray-50 text-gray-900`}>
        <QueryProvider>
          {children}
        </QueryProvider>
        <Toaster position="top-right" richColors closeButton />
      </body>
    </html>
  )
}
