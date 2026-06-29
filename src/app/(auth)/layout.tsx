export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-violet-50 via-white to-indigo-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2.5 mb-2">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center shadow-lg">
              <span className="text-white font-black text-sm tracking-tighter">SC</span>
            </div>
            <span className="text-2xl font-black text-gray-900 tracking-tight">SCENCE</span>
          </div>
          <p className="text-sm text-gray-400">Campaign management for brands & influencers</p>
        </div>
        {children}
      </div>
    </div>
  )
}
