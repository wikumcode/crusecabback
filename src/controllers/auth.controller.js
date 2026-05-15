const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { z } = require('zod');

const prisma = require('../lib/prisma');

const registerSchema = z.object({
    email: z.string().email(),
    password: z.string().min(6),
    name: z.string().min(2),
    role: z.enum(["ADMIN", "STAFF", "DRIVER", "CUSTOMER", "VENDOR"]).optional()
});

const loginSchema = z.object({
    email: z.string().email(),
    password: z.string()
});

exports.register = async (req, res) => {
    try {
        const { email, password, name, role } = registerSchema.parse(req.body);

        const existingUser = await prisma.user.findUnique({ where: { email } });
        if (existingUser) return res.status(400).json({ message: 'User already exists' });

        const hashedPassword = await bcrypt.hash(password, 10);

        const user = await prisma.user.create({
            data: {
                email,
                password: hashedPassword,
                name,
                role: "CUSTOMER" // Force CUSTOMER role for public registration
            }
        });

        res.status(201).json({ message: 'User registered successfully', userId: user.id });
    } catch (error) {
        res.status(400).json({ message: error.message || 'Registration failed' });
    }
};

exports.login = async (req, res) => {
    try {
        const { email, password } = loginSchema.parse(req.body);

        const user = await prisma.user.findUnique({
            where: { email },
            include: { permissionGroup: true }
        });
        if (!user) return res.status(400).json({ message: 'Invalid credentials' });

        if (!user.password) {
            return res.status(400).json({ message: 'This account has no password set. Use password reset or contact an administrator.' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ message: 'Invalid credentials' });

        if (!process.env.JWT_SECRET) {
            console.error('Login error: JWT_SECRET is not set in environment');
            return res.status(500).json({ message: 'Server misconfiguration: JWT_SECRET is missing.' });
        }

        const token = jwt.sign(
            { id: user.id, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: '1d' }
        );

        res.json({
            token,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role,
                permissionGroup: user.permissionGroup ? {
                    id: user.permissionGroup.id,
                    name: user.permissionGroup.name,
                    permissions: JSON.parse(user.permissionGroup.permissions || '[]')
                } : null
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        if (error instanceof z.ZodError) {
            return res.status(400).json({
                message: 'Invalid request: use a valid email address and password.',
                errors: error.flatten(),
            });
        }
        res.status(500).json({ message: error.message || 'Login failed' });
    }
};
exports.verifyPassword = async (req, res) => {
    try {
        const { password } = req.body;
        if (!password) return res.status(400).json({ message: 'Password is required' });

        const user = await prisma.user.findUnique({ where: { id: req.user.id } });
        if (!user) return res.status(404).json({ message: 'User not found' });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(401).json({ message: 'Incorrect password' });

        res.json({ success: true, message: 'Password verified' });
    } catch (error) {
        console.error('Verify Password Error:', error);
        res.status(500).json({ message: 'Verification failed' });
    }
};
