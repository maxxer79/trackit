import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';

const stores = [
  'Amazon', 'Best Buy', 'Walmart', 'Target', 'GameStop', 'Newegg',
  'Apple', 'Nike', 'Foot Locker', 'Sony', 'Microsoft', 'Nintendo',
  'Samsung', 'Google', 'NVIDIA', 'AMD', 'B&H Photo', 'Costco',
  'Bambu Labs', 'Ubiquiti', 'Home Depot', 'Lowe\'s', 'Valve',
];

const features = [
  {
    emoji: '⚡',
    title: 'Real-Time Alerts',
    desc: 'Get notified the instant a product comes back in stock — before everyone else.',
  },
  {
    emoji: '🏪',
    title: '70+ Retailers',
    desc: 'Track products across Amazon, Best Buy, Target, Walmart, and 70+ more stores.',
  },
  {
    emoji: '📱',
    title: 'Mobile-First PWA',
    desc: 'Install on your phone for a native app experience. Works on iOS and Android.',
  },
  {
    emoji: '🔔',
    title: 'Multi-Channel Notifications',
    desc: 'Push notifications, email, SMS, and Discord webhooks — your choice.',
  },
  {
    emoji: '🛒',
    title: 'AutoBuy',
    desc: 'Automatically add items to your cart the moment they\'re in stock.',
  },
  {
    emoji: '🌙',
    title: 'Dark Mode',
    desc: 'Beautiful Apple-inspired design that\'s easy on the eyes day or night.',
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-black overflow-hidden">
      {/* Nav */}
      <nav className="fixed top-0 inset-x-0 z-40 glass border-b border-dark-separator">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-[10px] bg-apple-blue flex items-center justify-center shadow-glow-blue">
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path d="M9 2L3 6.5v9h3.5v-5h5v5H15v-9L9 2z" fill="white" />
              </svg>
            </div>
            <span className="text-title2 font-bold text-white">TrackIt</span>
          </div>
          <div className="flex items-center gap-3">
            <Link to="/login" className="btn-ghost py-2 px-4 text-subhead">Sign In</Link>
            <Link to="/register" className="btn-primary py-2 px-4 text-subhead">Get Started Free</Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative pt-32 pb-20 px-6 text-center overflow-hidden">
        {/* Background glow */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full bg-apple-blue/10 blur-[120px] pointer-events-none" />
        <div className="absolute top-20 left-1/4 w-[300px] h-[300px] rounded-full bg-apple-purple/10 blur-[80px] pointer-events-none" />

        <div className="relative max-w-4xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-pill bg-apple-blue/15 border border-apple-blue/30 text-apple-blue text-footnote font-semibold mb-6">
              <span className="w-1.5 h-1.5 rounded-full bg-apple-green animate-pulse-slow" />
              Real-time tracking across 70+ stores
            </span>

            <h1 className="text-[52px] sm:text-[72px] font-bold text-white leading-[1.05] tracking-tight mb-6">
              Never miss a
              <br />
              <span className="text-gradient">restock again.</span>
            </h1>

            <p className="text-[20px] text-dark-label2 max-w-2xl mx-auto leading-relaxed mb-10">
              TrackIt monitors product availability across 70+ retailers in real-time
              and sends instant alerts the moment your items come back in stock.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link to="/register" className="btn-primary text-body px-8 py-4 shadow-glow-blue">
                Start Tracking Free
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 8h10M9 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Link>
              <Link to="/browse" className="btn-secondary text-body px-8 py-4">
                Browse Products
              </Link>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Stores marquee */}
      <section className="py-10 overflow-hidden border-y border-dark-separator">
        <p className="text-center text-footnote text-dark-label2 mb-6 font-medium uppercase tracking-widest">
          Tracking products at
        </p>
        <div className="flex gap-6 animate-[marquee_30s_linear_infinite]">
          {[...stores, ...stores].map((store, i) => (
            <span
              key={i}
              className="whitespace-nowrap text-subhead font-medium text-dark-label2 hover:text-white transition-colors px-2"
            >
              {store}
            </span>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="py-24 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-headline font-bold text-white mb-3">Everything you need to win restocks</h2>
            <p className="text-body text-dark-label2">Powerful features, beautifully simple.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {features.map((f, i) => (
              <motion.div
                key={i}
                className="card p-6"
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.08 }}
              >
                <div className="text-3xl mb-4">{f.emoji}</div>
                <h3 className="text-title2 font-semibold text-white mb-2">{f.title}</h3>
                <p className="text-subhead text-dark-label2 leading-relaxed">{f.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24 px-6 text-center">
        <div className="max-w-2xl mx-auto">
          <div className="card p-12 relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-apple-blue/10 to-apple-purple/10" />
            <div className="relative">
              <h2 className="text-headline font-bold text-white mb-4">Ready to start tracking?</h2>
              <p className="text-body text-dark-label2 mb-8">
                Join thousands of users who never miss a restock.
              </p>
              <Link to="/register" className="btn-primary text-body px-10 py-4 shadow-glow-blue">
                Create Your Free Account
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-dark-separator py-8 px-6 text-center">
        <p className="text-footnote text-dark-label3">
          © {new Date().getFullYear()} TrackIt. Track smarter, not harder.
        </p>
      </footer>

      <style>{`
        @keyframes marquee {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }
      `}</style>
    </div>
  );
}
