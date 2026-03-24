const prisma = require('../lib/prisma');

const getPermissionGroups = async (req, res) => {
    try {
        const groups = await prisma.permissionGroup.findMany({
            include: {
                _count: {
                    select: { users: true }
                },
                users: {
                    select: { id: true, name: true, email: true }
                }
            }
        });
        // Parse permissions JSON string back to object/array
        const formattedGroups = groups.map(g => ({
            ...g,
            permissions: JSON.parse(g.permissions || '[]')
        }));
        res.json(formattedGroups);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

const createPermissionGroup = async (req, res) => {
    try {
        const { name, permissions, userIds } = req.body;
        const group = await prisma.permissionGroup.create({
            data: {
                name,
                permissions: JSON.stringify(permissions || []),
                users: userIds && userIds.length > 0 ? {
                    connect: userIds.map(id => ({ id }))
                } : undefined
            }
        });
        res.json(group);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

const updatePermissionGroup = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, permissions, userIds } = req.body;
        const group = await prisma.permissionGroup.update({
            where: { id },
            data: {
                name,
                permissions: JSON.stringify(permissions || []),
                users: userIds ? {
                    set: userIds.map(uid => ({ id: uid }))
                } : undefined
            }
        });
        res.json(group);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

const deletePermissionGroup = async (req, res) => {
    try {
        const { id } = req.params;
        await prisma.permissionGroup.delete({
            where: { id }
        });
        res.json({ message: 'Group deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

module.exports = {
    getPermissionGroups,
    createPermissionGroup,
    updatePermissionGroup,
    deletePermissionGroup
};
