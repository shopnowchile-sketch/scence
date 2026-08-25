import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { Toaster } from 'sonner'
import { QueryProvider } from '@/components/providers/QueryProvider'
import { LocaleProvider } from '@/components/providers/LocaleProvider'
import { cookies, headers } from 'next/headers'
import { detectLocale, LOCALE_COOKIE } from '@/i18n/config'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })

export const metadata: Metadata = {
  title: { default: 'SCENCE', template: '%s · SCENCE' },
  description: 'Campaign Management Platform para marcas e influencers',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = cookies()
  const headerStore = headers()
  const locale = detectLocale({
    cookieLocale: cookieStore.get(LOCALE_COOKIE)?.value,
    acceptLanguage: headerStore.get('accept-language'),
    country: headerStore.get('x-vercel-ip-country'),
  })

  return (
    <html lang={locale} data-locale={locale} data-locale-ready={locale === 'es' ? 'true' : 'false'} suppressHydrationWarning>
      <body className={`${inter.variable} font-sans antialiased bg-gray-50 text-gray-900`}>
        <LocaleProvider initialLocale={locale}>
          <QueryProvider>
            {children}
          </QueryProvider>
          <Toaster position="top-right" richColors closeButton />
        </LocaleProvider>
      </body>
    </html>
  )
}
