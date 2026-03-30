const prisma = require('../lib/prisma');
const { z } = require('zod');
const cloudinary = require('../lib/cloudinary');
const crypto = require('crypto');

function dataUrlToBuffer(dataUrl) {
    const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl || '');
    if (!match) return null;
    const mime = match[1];
    const base64 = match[2];
    return { mime, buffer: Buffer.from(base64, 'base64') };
}

function mimeToExt(mime) {
    switch (mime) {
        case 'image/jpeg': return 'jpg';
        case 'image/jpg': return 'jpg';
        case 'image/png': return 'png';
        case 'image/webp': return 'webp';
        case 'image/gif': return 'gif';
        default: return 'bin';
    }
}

async function persistImageField(value, prefix) {
    if (!value || typeof value !== 'string') return value;
    // Already a URL/path
    if (value.startsWith('/uploads/') || value.startsWith('http://') || value.startsWith('https://')) return value;

    // Convert base64 data URL to an uploaded file on Cloudinary
    if (value.startsWith('data:')) {
        try {
            const result = await cloudinary.uploader.upload(value, {
                folder: 'rentix-vehicles',
                public_id: `${prefix}-${crypto.randomUUID()}`,
                resource_type: 'auto'
            });
            return result.secure_url;
        } catch (error) {
            console.error('Cloudinary Upload Error (Vehicle):', error);
            return null;
        }
    }

    // Very large strings are most likely base64 blobs; drop them for safety.
    if (value.length > 8192) return null;
    return value;
}

async function persistVehicleImages(rest, licensePlate) {
    const prefix = (licensePlate || 'vehicle').toString().replace(/[^a-z0-9]+/gi, '-').toLowerCase();

    const out = { ...rest };
    out.imageUrl = await persistImageField(out.imageUrl, `${prefix}-main`);
    out.licenseFrontUrl = await persistImageField(out.licenseFrontUrl, `${prefix}-license-front`);
    out.licenseBackUrl = await persistImageField(out.licenseBackUrl, `${prefix}-license-back`);
    out.insuranceFrontUrl = await persistImageField(out.insuranceFrontUrl, `${prefix}-insurance-front`);
    out.insuranceBackUrl = await persistImageField(out.insuranceBackUrl, `${prefix}-insurance-back`);

    if (out.additionalImages && typeof out.additionalImages === 'string') {
        try {
            const arr = JSON.parse(out.additionalImages);
            if (Array.isArray(arr)) {
                const persisted = [];
                for (let i = 0; i < arr.length; i++) {
                    persisted.push(await persistImageField(arr[i], `${prefix}-extra-${i + 1}`));
                }
                out.additionalImages = JSON.stringify(persisted.filter(Boolean));
            }
        } catch {
            // ignore invalid JSON; keep as-is (and list endpoint will strip if huge)
        }
    }

    return out;
}

const vehicleBaseSchema = z.object({
    modelId: z.preprocess((val) => (val === '' ? null : val), z.string().nullable().optional()), // Links to VehicleModel
    year: z.number().int().min(1900),
    licensePlate: z.string().min(1),
    vin: z.string().optional(),
    color: z.string().min(1),
    fuelType: z.string(),
    transmission: z.string(),

    // New Fields
    lastOdometer: z.number().int().optional(),
    licenseRenewalDate: z.preprocess((val) => (val === '' ? undefined : val), z.string().optional().transform((str) => str ? new Date(str) : undefined)),
    insuranceRenewalDate: z.preprocess((val) => (val === '' ? undefined : val), z.string().optional().transform((str) => str ? new Date(str) : undefined)),
    financeInstallmentDate: z.preprocess((val) => (val === '' ? undefined : val), z.string().optional().transform((str) => str ? new Date(str) : undefined)),

    status: z.string().optional(),
    imageUrl: z.string().optional(),
    licenseFrontUrl: z.string().optional(),
    licenseBackUrl: z.string().optional(),
    insuranceFrontUrl: z.string().optional(),
    insuranceBackUrl: z.string().optional(),
    additionalImages: z.string().optional(),
    features: z.string().optional(),
    ownership: z.enum(['COMPANY', 'THIRD_PARTY']).optional().default('COMPANY'), // COMPANY, THIRD_PARTY
    rentalType: z.enum(['SHORT_TERM', 'LONG_TERM']).optional().default('SHORT_TERM'),
    vendorId: z.preprocess((val) => (val === '' ? null : val), z.string().nullable().optional()),
    contractStartDate: z.preprocess((val) => (val === '' ? null : val), z.string().optional().nullable().transform((str) => str ? new Date(str) : null)),
    contractEndDate: z.preprocess((val) => (val === '' ? null : val), z.string().optional().nullable().transform((str) => str ? new Date(str) : null)),

    // Financial Config
    dailyRentalRate: z.union([z.number(), z.string()]).transform((val) => Number(val) || 0).optional(),
    foreignDailyRentalRate: z.union([z.number(), z.string()]).transform((val) => Number(val) || 0).optional(),
    bookingFee: z.union([z.number(), z.string()]).transform((val) => Number(val) || 0).optional(),
});

const vehicleSchema = vehicleBaseSchema.refine(data => {
    if (data.ownership === 'THIRD_PARTY' && !data.vendorId) {
        return false;
    }
    return true;
}, {
    message: "Vendor is required for Third Party ownership",
    path: ["vendorId"]
}).refine(data => {
    // Contract dates only required if it's LONG_TERM third party or missing documents
    if (data.ownership === 'THIRD_PARTY' && data.rentalType === 'LONG_TERM' && (!data.contractStartDate || !data.contractEndDate)) {
        return false;
    }
    return true;
}, {
    message: "Contract dates are required for Long Term Third Party vehicles",
    path: ["contractEndDate"]
});

exports.createVehicle = async (req, res) => {
    try {
        const { modelId, vendorId, ...rest } = vehicleSchema.parse(req.body);

        const persistedRest = await persistVehicleImages(rest, rest.licensePlate);
        const data = {
            ...persistedRest,
            ...(modelId && { vehicleModel: { connect: { id: modelId } } }),
            ...(vendorId && { vendor: { connect: { id: vendorId } } })
        };

        const vehicle = await prisma.vehicle.create({ data });

        if (data.lastOdometer) {
            await prisma.odometer.create({
                data: {
                    vehicleId: vehicle.id,
                    reading: data.lastOdometer,
                    source: 'VEHICLE_CREATION'
                }
            });
        }

        res.status(201).json(vehicle);
    } catch (error) {
        if (error instanceof z.ZodError) {
            console.error("Vehicle Validation Error:", JSON.stringify(error.errors, null, 2));
            return res.status(400).json({
                message: "Validation failed",
                errors: error.errors
            });
        }

        // Handle Prisma unique constraint errors
        if (error.code === 'P2002') {
            const field = error.meta?.target?.[0] || 'field';
            return res.status(400).json({ message: `A vehicle with this ${field} already exists.` });
        }

        console.error("Create Vehicle Error:", error);
        res.status(400).json({ message: error.message || 'Failed to create vehicle' });
    }
};

exports.getVehicles = async (req, res) => {
    try {
        const { brand, transmission, fuelType, status } = req.query;

        const where = {};

        if (status) {
            where.status = status;
        } else {
            // Default to showing only available vehicles if not specified? 
            // Or maybe valid ones. Let's filter by status if provided, 
            // otherwise maybe show all or just AVAILABLE. 
            // For public listing, usually we want AVAILABLE. 
            // But for admin we want all. 
            // I will leave it open if not provided, or better, handle it in frontend.
            // Actually, the user asked for "show all vehicles". 
            // But usually for public site "unavailable" ones shouldn't show?
            // Let's stick to filters strictly passed.
        }

        if (transmission) {
            const transmissions = Array.isArray(transmission) ? transmission : [transmission];
            where.transmission = {
                in: transmissions
            };
        }

        if (fuelType) {
            const fuelTypes = Array.isArray(fuelType) ? fuelType : [fuelType];
            where.fuelType = {
                in: fuelTypes
            };
        }

        if (brand) {
            const brands = Array.isArray(brand) ? brand : [brand];
            where.vehicleModel = {
                brand: {
                    name: {
                        in: brands
                    }
                }
            };
        }

        const vehicles = await prisma.vehicle.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            include: { vehicleModel: { include: { brand: true } } }
        });

        // IMPORTANT:
        // Some deployments store images as base64 data URLs directly in DB fields (e.g. imageUrl).
        // Returning those in list responses can create multi-megabyte payloads, causing timeouts
        // and making vehicles "disappear" after a page refresh.
        // Keep detailed image fields for single-vehicle fetches, but strip them from list responses.
        const stripLargeField = (value) => {
            if (!value || typeof value !== 'string') return value;
            if (value.startsWith('data:')) return null;
            // Also strip unexpectedly large strings (likely base64 without data: prefix).
            if (value.length > 8192) return null;
            return value;
        };

        const safeVehicles = vehicles.map((v) => ({
            ...v,
            imageUrl: stripLargeField(v.imageUrl),
            licenseFrontUrl: stripLargeField(v.licenseFrontUrl),
            licenseBackUrl: stripLargeField(v.licenseBackUrl),
            insuranceFrontUrl: stripLargeField(v.insuranceFrontUrl),
            insuranceBackUrl: stripLargeField(v.insuranceBackUrl),
            additionalImages: stripLargeField(v.additionalImages),
        }));

        res.json(safeVehicles);
    } catch (error) {
        console.error("Get Vehicles Error:", error);
        res.status(500).json({ message: 'Failed to fetch vehicles' });
    }
};

exports.getVehicle = async (req, res) => {
    try {
        const { id } = req.params;
        const vehicle = await prisma.vehicle.findUnique({
            where: { id },
            include: {
                vehicleModel: {
                    include: { brand: true }
                }
            }
        });
        if (!vehicle) return res.status(404).json({ message: 'Vehicle not found' });
        res.json(vehicle);
    } catch (error) {
        res.status(500).json({ message: 'Failed to fetch vehicle' });
    }
};

exports.updateVehicle = async (req, res) => {
    try {
        const { id } = req.params;
        const rawData = req.body;
        const { modelId, vendorId, ...rest } = vehicleBaseSchema.partial().parse(rawData);

        const persistedRest = await persistVehicleImages(rest, rest.licensePlate);
        const data = {
            ...persistedRest,
            ...(modelId && { vehicleModel: { connect: { id: modelId } } }),
            ...(vendorId && { vendor: { connect: { id: vendorId } } })
        };

        const vehicle = await prisma.vehicle.update({
            where: { id },
            data
        });

        if (data.lastOdometer !== undefined) {
            await prisma.odometer.create({
                data: {
                    vehicleId: id,
                    reading: data.lastOdometer,
                    source: 'VEHICLE_UPDATE'
                }
            });
        }
        res.json(vehicle);
    } catch (error) {
        if (error instanceof z.ZodError) {
            console.error("Vehicle Update Validation Error:", JSON.stringify(error.errors, null, 2));
            return res.status(400).json({
                message: "Validation failed",
                errors: error.errors
            });
        }
        console.error('Error updating vehicle:', error);
        res.status(400).json({
            message: error.message || 'Failed to update vehicle'
        });
    }
};

exports.deleteVehicle = async (req, res) => {
    try {
        const { id } = req.params;
        await prisma.vehicle.delete({ where: { id } });
        res.json({ message: 'Vehicle deleted successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Failed to delete vehicle' });
    }
};
