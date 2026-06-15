import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../config/database';
import { signToken } from '../utils/jwt';
import logger from '../utils/logger';

export const register = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password || !name) {
      res.status(400).json({ error: 'Email, password and name are required' });
      return;
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      res.status(409).json({ error: 'Email already registered' });
      return;
    }

    if (password.length < 8) {
      res.status(400).json({ error: 'Password must be at least 8 characters' });
      return;
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: { email, password: hashedPassword, name, trackingLimit: 1 },
      select: { id: true, email: true, name: true, role: true, trackingLimit: true, createdAt: true },
    });

    const token = signToken({ userId: user.id, email: user.email, role: user.role });
    res.status(201).json({ user, token, message: 'Registration successful' });
  } catch (error) {
    logger.error('Register error', error);
    res.status(500).json({ error: 'Registration failed' });
  }
};

export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required' });
      return;
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    if (!user.isActive) {
      res.status(403).json({ error: 'Account is disabled' });
      return;
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const token = signToken({ userId: user.id, email: user.email, role: user.role });
    const { password: _, ...userWithoutPassword } = user;
    res.json({ user: userWithoutPassword, token, message: 'Login successful' });
  } catch (error) {
    logger.error('Login error', error);
    res.status(500).json({ error: 'Login failed' });
  }
};

export const getMe = async (req: Request & { user?: any }, res: Response): Promise<void> => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true, email: true, name: true, role: true,
        trackingLimit: true, emailAlerts: true, pushAlerts: true,
        browserAlerts: true, avatar: true, createdAt: true, lastLoginAt: true,
        _count: { select: { trackings: { where: { isActive: true } } } },
      },
    });
    res.json(user);
  } catch (error) {
    logger.error('GetMe error', error);
    res.status(500).json({ error: 'Failed to get user' });
  }
};

export const updateProfile = async (req: Request & { user?: any }, res: Response): Promise<void> => {
  try {
    const { name, email, emailAlerts, pushAlerts, browserAlerts } = req.body;

    // Only update fields that were actually provided (partial update).
    const data: Record<string, unknown> = {};
    if (name !== undefined) {
      if (!String(name).trim()) { res.status(400).json({ error: 'Name cannot be empty' }); return; }
      data.name = String(name).trim();
    }
    if (emailAlerts !== undefined) data.emailAlerts = emailAlerts;
    if (pushAlerts !== undefined) data.pushAlerts = pushAlerts;
    if (browserAlerts !== undefined) data.browserAlerts = browserAlerts;

    if (email !== undefined) {
      const normalized = String(email).trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
        res.status(400).json({ error: 'Please enter a valid email address' });
        return;
      }
      // Don't let two accounts share an email.
      const existing = await prisma.user.findUnique({ where: { email: normalized } });
      if (existing && existing.id !== req.user.id) {
        res.status(409).json({ error: 'That email address is already in use' });
        return;
      }
      data.email = normalized;
    }

    const user = await prisma.user.update({
      where: { id: req.user.id },
      data,
      select: { id: true, email: true, name: true, role: true, trackingLimit: true, emailAlerts: true, pushAlerts: true, browserAlerts: true },
    });
    res.json(user);
  } catch (error) {
    logger.error('UpdateProfile error', error);
    res.status(500).json({ error: 'Update failed' });
  }
};

export const changePassword = async (req: Request & { user?: any }, res: Response): Promise<void> => {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }

    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) { res.status(401).json({ error: 'Current password is incorrect' }); return; }

    if (newPassword.length < 8) { res.status(400).json({ error: 'New password must be at least 8 characters' }); return; }

    const hashed = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({ where: { id: user.id }, data: { password: hashed } });
    res.json({ message: 'Password updated successfully' });
  } catch (error) {
    logger.error('ChangePassword error', error);
    res.status(500).json({ error: 'Password change failed' });
  }
};
