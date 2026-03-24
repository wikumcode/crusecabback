const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = require('../lib/prisma');

// Get all internal users (Admin, Staff, Super Admin)
exports.getUsers = async (req, res) => {
    try {
        const users = await prisma.user.findMany({
            where: {
                role: { in: ['ADMIN', 'STAFF', 'SUPER_ADMIN'] }
            },
            select: {
                id: true,
                name: true,
                email: true,
                role: true,
                createdAt: true
            }
        });
        res.json(users);
    } catch (error) {
        res.status(500).json({ message: 'Failed to fetch users' });
    }
};

// Create an internal user (Admin/Staff)
exports.createUser = async (req, res) => {
    try {
        const { email, password, name, role } = req.body;

        if (!['ADMIN', 'STAFF'].includes(role)) {
            return res.status(400).json({ message: 'Invalid role for internal user' });
        }

        const existingUser = await prisma.user.findUnique({ where: { email } });
        if (existingUser) return res.status(400).json({ message: 'User already exists' });

        const hashedPassword = await bcrypt.hash(password, 10);

        const user = await prisma.user.create({
            data: {
                email,
                password: hashedPassword,
                name,
                role
            }
        });

        res.status(201).json({ message: 'User created successfully', user });
    } catch (error) {
        res.status(400).json({ message: 'Failed to create user' });
    }
};

// Delete a user
exports.deleteUser = async (req, res) => {
    try {
        const { id } = req.params;
        await prisma.user.delete({ where: { id } });
        res.json({ message: 'User deleted successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Failed to delete user' });
    }
};
