/** @type {import('next').NextConfig} */
const nextConfig = {
  // @sparticuz/chromium (binario de Chromium para serverless) resuelve rutas
  // relativas a sus propios archivos — si el bundler lo empaqueta, se rompe
  // con "input directory /var/task/bin does not exist". Debe quedar externo.
  // Ver: https://github.com/Sparticuz/chromium#bundler-configuration
  experimental: {
    serverComponentsExternalPackages: ['@sparticuz/chromium', 'playwright-core'],
    // Externalizar el paquete (arriba) evita que webpack lo rompa, pero NO
    // garantiza que Vercel copie el binario al bundle final — su tracer solo
    // agrega archivos que detecta vía import/require/fs, y el binario de
    // Chromium se resuelve por ruta relativa en runtime, no por import. Sin
    // esto, en prod tira "input directory .../bin does not exist" aunque
    // localmente funcione. Patrón recomendado por la doc de Next.js para
    // este caso exacto (node_modules con binarios nativos).
    outputFileTracingIncludes: {
      '/*': ['node_modules/@sparticuz/chromium/**/*'],
    },
  },
}

export default nextConfig
