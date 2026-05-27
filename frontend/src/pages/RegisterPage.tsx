import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuthStore } from '../store/auth';
import toast from 'react-hot-toast';

export default function RegisterPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const register = useAuthStore((s) => s.register);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }
    setLoading(true);
    try {
      await register(email, password, name);
      toast.success('Welcome to TrackIt!');
      navigate('/browse');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center p-6">
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full bg-apple-blue/8 blur-[100px] pointer-events-none" />

      <motion.div
        className="w-full max-w-sm"
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <div className="flex flex-col items-center mb-10">
          <div className="w-14 h-14 rounded-[18px] bg-apple-blue flex items-center justify-center shadow-glow-blue mb-4">
            <svg width="28" height="28" viewBox="0 0 18 18" fill="none">
              <path d="M9 2L3 6.5v9h3.5v-5h5v5H15v-9L9 2z" fill="white" />
            </svg>
          </div>
          <h1 className="text-headline font-bold text-white">Create Account</h1>
          <p className="text-subhead text-dark-label2 mt-1">Start tracking today — it's free</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-footnote font-semibold text-dark-label2 mb-2">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input"
              placeholder="Your name"
              required
              autoComplete="name"
            />
          </div>

          <div>
            <label className="block text-footnote font-semibold text-dark-label2 mb-2">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input"
              placeholder="you@example.com"
              required
              autoComplete="email"
            />
          </div>

          <div>
            <label className="block text-footnote font-semibold text-dark-label2 mb-2">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input"
              placeholder="At least 8 characters"
              required
              minLength={8}
              autoComplete="new-password"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="btn-primary w-full py-3.5 mt-2"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.37 0 0 5.37 0 12h4z" />
                </svg>
                Creating account…
              </span>
            ) : 'Create Account'}
          </button>
        </form>

        <p className="text-center text-footnote text-dark-label3 mt-4">
          By creating an account, you agree to our Terms of Service.
        </p>

        <p className="text-center text-subhead text-dark-label2 mt-6">
          Already have an account?{' '}
          <Link to="/login" className="text-apple-blue font-semibold hover:underline">
            Sign In
          </Link>
        </p>
      </motion.div>
    </div>
  );
}
