import jwt from 'jsonwebtoken';

// Never ship a known default secret. In production a missing JWT_SECRET is a
// hard failure (otherwise every token would be forgeable with a public string);
// in dev we fall back to an obviously-insecure value with a loud warning.
const DEV_FALLBACK_SECRET = 'trackit-dev-only-insecure-secret';
const JWT_SECRET = process.env.JWT_SECRET || DEV_FALLBACK_SECRET;
if (!process.env.JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET must be set in production — refusing to start with a default secret.');
  }
  // eslint-disable-next-line no-console
  console.warn('⚠️  JWT_SECRET is not set — using an insecure dev-only secret. Do NOT use this in production.');
}

const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

export interface TokenPayload {
  userId: string;
  email: string;
  role: string;
}

export const signToken = (payload: TokenPayload): string => {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN } as jwt.SignOptions);
};

export const verifyToken = (token: string): TokenPayload => {
  return jwt.verify(token, JWT_SECRET) as TokenPayload;
};
