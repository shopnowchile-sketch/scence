/** @type {import('next').NextConfig} */
const nextConfig = {
  // @sparticuz/chromium (binario de Chromium para serverless) resuelve rutas
  // relativas a sus propios archivos — si el bundler lo empaqueta, se rompe
  // con "input directory /var/task/bin does not exist". Debe quedar externo.
  // Ver: https://github.com/Sparticuz/chromium#bundler-configuration
  experimental: {
    serverComponentsExternalPackages: ['@sparticuz/chromium', 'playwright-core'],
  },
}

export default nextConfig
