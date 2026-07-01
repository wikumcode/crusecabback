const prisma = require('../lib/prisma');
const { z } = require('zod');
const { getNextSequenceValue } = require('../utils/sequence');
const { sendContractCreatedEmail, sendContractThankYouEmail } = require('../utils/email');

/**
 * Mongo Atlas cold-start latency easily blows past Prisma's default 5s
 * interactive transaction timeout (especially for multi-step contract /
 * exchange flows). Mirrors invoice.controller.js / advanceReceipt.controller.js.
 */
const TX_OPTS_CONTRACT = {
    maxWait: 15000,
    timeout: 45000,
};

function pad(num, size) {
    const s = String(num);
    return s.length >= size ? s : '0'.repeat(size - s.length) + s;
}

function contractSeqKey(date = new Date()) {
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = String(date.getFullYear());
    return `contract_sequence_${yyyy}_${mm}`;
}

function buildContractNo(sequence, date = new Date()) {
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = String(date.getFullYear());
    return `CON/${mm}/${yyyy}/${pad(sequence, 5)}`;
}

function parseTimeTo24h(timeStr) {
    if (!timeStr || typeof timeStr !== 'string') return null;
    const t = timeStr.trim().toUpperCase();

    // "HH:MM" (24h)
    const m24 = /^(\d{1,2}):(\d{2})$/.exec(t);
    if (m24) {
        const h = Number(m24[1]);
        const min = Number(m24[2]);
        if (h >= 0 && h <= 23 && min >= 0 && min <= 59) return { h, min };
        return null;
    }

    // "HH:MM AM/PM"
    const m12 = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/.exec(t);
    if (m12) {
        let h = Number(m12[1]);
        const min = Number(m12[2]);
        const ap = m12[3];
        if (h < 1 || h > 12 || min < 0 || min > 59) return null;
        if (ap === 'PM' && h !== 12) h += 12;
        if (ap === 'AM' && h === 12) h = 0;
        return { h, min };
    }

    return null;
}

function combineDateAndTime(dateVal, timeStr) {
    if (!dateVal) return null;
    const d = dateVal instanceof Date ? dateVal : new Date(dateVal);
    if (isNaN(d.getTime())) return null;

    const parsed = parseTimeTo24h(timeStr);
    if (!parsed) return null;

    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), parsed.h, parsed.min, 0, 0);
}

function minutesDiff(a, b) {
    // returns b - a in minutes (can be negative)
    return (b.getTime() - a.getTime()) / (1000 * 60);
}

const MS_PER_RENTAL_DAY = 24 * 60 * 60 * 1000;

function computeRentalDayUnits(pickupDate, pickupTime, dropoffDate, dropoffTime) {
    const start = combineDateAndTime(pickupDate, pickupTime);
    const end = combineDateAndTime(dropoffDate, dropoffTime);
    if (!start || !end) return null;
    const ms = end.getTime() - start.getTime();
    if (!Number.isFinite(ms) || ms <= 0) return null;
    return ms / MS_PER_RENTAL_DAY;
}

const contractSchema = z.object({
    customerId: z.string().min(1, "Customer is required"),
    vehicleId: z.string().min(1, "Vehicle is required"),

    // Dates
    pickupDate: z.string().min(1, "Pickup Date required").transform((str) => new Date(str)),
    pickupTime: z.string().min(1, "Pickup Time required"),
    dropoffDate: z.string().min(1, "Dropoff Date required").transform((str) => new Date(str)),
    dropoffTime: z.string().min(1, "Dropoff Time required"),
    actualReturnDate: z.union([z.string(), z.date(), z.null()]).optional().transform((val) => val ? new Date(val) : undefined), // Added
    actualReturnTime: z.string().optional().nullable(),   // Added

    // Financials
    appliedDailyRate: z.union([z.number(), z.string()]).optional().transform((val) => {
        if (val === null || val === undefined || val === '') return undefined;
        const n = Number(val);
        return Number.isFinite(n) ? n : undefined;
    }),
    baseDailyRate: z.union([z.number(), z.string()]).optional().transform((val) => {
        if (val === null || val === undefined || val === '') return undefined;
        const n = Number(val);
        return Number.isFinite(n) ? n : undefined;
    }),
    discountType: z.enum(['PERCENT', 'AMOUNT']).optional().nullable(),
    discountValue: z.union([z.number(), z.string()]).optional().transform((val) => {
        if (val === null || val === undefined || val === '') return undefined;
        const n = Number(val);
        return Number.isFinite(n) ? n : undefined;
    }),
    securityDeposit: z.union([z.number(), z.string()]).transform((val) => Number(val) || 0),
    advancePaymentAmount: z.union([z.number(), z.string()]).optional().transform((val) => Number(val) || 0),
    advancePaymentDate: z.union([z.string(), z.date(), z.null()]).optional().transform((val) => val ? new Date(val) : undefined),
    deliveryCharge: z.union([z.number(), z.string().optional()]).transform((val) => Number(val) || 0),
    dailyKmLimit: z.union([z.number(), z.string()]).transform((val) => Number(val) || 100),
    allocatedKm: z.union([z.number(), z.string()]).transform((val) => Number(val) || 0),
    extraMileageCharge: z.union([z.number(), z.string()]).transform((val) => Number(val) || 0),
    securityDepositReturned: z.union([z.number(), z.string()]).optional().transform((val) => val ? Number(val) : 0),

    // Extra return charges (consumed from security deposit)
    damageCharge: z.union([z.number(), z.string()]).optional().transform((val) => Number(val) || 0),
    otherChargeAmount: z.union([z.number(), z.string()]).optional().transform((val) => Number(val) || 0),
    otherChargeDescription: z.string().optional(),

    // Delivery
    isDelivery: z.boolean().default(false),
    cityId: z.string().optional().nullable().transform(val => val === '' ? null : val), // Handle empty string
    isCollection: z.boolean().default(false), // Added
    collectionCharge: z.union([z.number(), z.string().optional()]).transform((val) => Number(val) || 0), // Added

    // Vehicle State
    fuelLevel: z.enum(['FULL', 'HALF', 'LOW']),
    startOdometer: z.union([z.number(), z.string()]).transform((val) => Number(val) || 0),
    endOdometer: z.union([z.number(), z.string().optional()]).transform((val) => Number(val) || undefined),

    // Checklist
    license: z.boolean().default(false),
    insurance: z.boolean().default(false),
    carpets: z.boolean().default(false),
    spareWheel: z.boolean().default(false),
    jack: z.boolean().default(false),
    jackHandle: z.boolean().default(false),
    airPump: z.boolean().default(false),
    audioSetup: z.boolean().default(false),
    toolCover: z.boolean().default(false),
    mudCovers: z.boolean().default(false),

    // Return Checklist - Added
    returnLicense: z.boolean().default(false),
    returnInsurance: z.boolean().default(false),
    returnCarpets: z.boolean().default(false),
    returnSpareWheel: z.boolean().default(false),
    returnJack: z.boolean().default(false),
    returnJackHandle: z.boolean().default(false),
    returnAirPump: z.boolean().default(false),
    returnAudioSetup: z.boolean().default(false),
    returnToolCover: z.boolean().default(false),
    returnMudCovers: z.boolean().default(false),

    batteryCode: z.string().optional().nullable(),
    remark: z.string().optional().nullable(),

    frontTyres: z.string().optional().nullable(), // 100%, 80%, etc.
    rearTyres: z.string().optional().nullable(),
    returnFrontTyres: z.string().optional().nullable(),
    returnRearTyres: z.string().optional().nullable(),

    inspectionImages: z.string().optional().nullable(), // JSON string of URLs
    returnInspectionImages: z.string().optional().nullable(),
    returnBatteryCode: z.string().optional().nullable(),
    returnRemark: z.string().optional().nullable()
});

// Validation Schema for Vehicle Exchange
const exchangeSchema = z.object({
    newVehicleId: z.string().optional(),
    oldVehicleId: z.string().optional(),

    // Old Vehicle Return Details
    oldVehicleReturnDate: z.string().transform((str) => new Date(str)),
    oldVehicleReturnOdometer: z.union([z.number(), z.string()]).transform((val) => Number(val)),

    // New Vehicle Handover Details
    newVehicleStartDate: z.string().optional().transform((str) => str ? new Date(str) : undefined),
    newVehicleStartOdometer: z.union([z.number(), z.string().optional()]).transform((val) => val ? Number(val) : undefined),
    newVehicleDailyRate: z.union([z.number(), z.string().optional()]).transform((val) => val ? Number(val) : undefined),

    isEndOfContract: z.boolean().optional()
});

exports.createContract = async (req, res) => {
    try {
        const data = contractSchema.parse(req.body);

        // Verify Customer Status
        const customer = await prisma.client.findUnique({
            where: { id: data.customerId }
        });

        if (!customer) {
            return res.status(404).json({ message: 'Customer not found' });
        }

        // Note: User requirement "only confirmed customers list to select" implies UI filtering.
        // Backend could enforce it too:
        if (customer.status !== 'CONFIRMED') {
            return res.status(400).json({ message: 'Customer is not confirmed' });
        }

        // Start odometer must never be below the vehicle's current ("last") reading.
        // Otherwise we'd allow a contract to start at a value that pretends the
        // vehicle hasn't already been driven further by another contract or a
        // manual update — that would silently corrupt mileage / revenue maths
        // when the contract eventually returns.
        const vehicleForStartOdo = await prisma.vehicle.findUnique({
            where: { id: data.vehicleId },
            select: { lastOdometer: true },
        });
        const latestVehicleOdo = Number(vehicleForStartOdo?.lastOdometer) || 0;
        if (Number(data.startOdometer) < latestVehicleOdo) {
            return res.status(400).json({
                message: `Start odometer (${data.startOdometer} km) cannot be below the vehicle's current reading (${latestVehicleOdo} km). Use ${latestVehicleOdo} km or a higher value.`,
            });
        }

        // Check for Overlapping Bookings (Minute-Precision)
        const newStart = combineDateAndTime(data.pickupDate, data.pickupTime);
        const newEnd = combineDateAndTime(data.dropoffDate, data.dropoffTime);

        if (!newStart || !newEnd) {
            return res.status(400).json({ message: 'Invalid pickup or dropoff date/time' });
        }

        const existingContracts = await prisma.contract.findMany({
            where: {
                vehicleId: data.vehicleId,
                status: { in: ['UPCOMING', 'IN_PROGRESS', 'RETURN'] },
                AND: [
                    { pickupDate: { lte: data.dropoffDate } },
                    { dropoffDate: { gte: data.pickupDate } }
                ]
            }
        });

        const overlap = existingContracts.find(c => {
            const cStart = combineDateAndTime(c.pickupDate, c.pickupTime);
            const cEnd = combineDateAndTime(c.dropoffDate, c.dropoffTime);
            if (!cStart || !cEnd) return false;
            // Strict overlap check: (NewStart < ExistingEnd) && (ExistingStart < NewEnd)
            return (newStart < cEnd) && (cStart < newEnd);
        });

        if (overlap) {
            return res.status(400).json({
                message: 'This vehicle already have upcoming booking that date and time range, so please select another vehicle or select another date time range',
                conflict: {
                    start: combineDateAndTime(overlap.pickupDate, overlap.pickupTime),
                    end: combineDateAndTime(overlap.dropoffDate, overlap.dropoffTime)
                }
            });
        }

        const rentalDayUnits = computeRentalDayUnits(
            data.pickupDate,
            data.pickupTime,
            data.dropoffDate,
            data.dropoffTime
        );
        if (rentalDayUnits == null) {
            return res.status(400).json({ message: 'Drop-off must be after pick-up date and time.' });
        }
        data.allocatedKm = Math.round(data.dailyKmLimit * rentalDayUnits);

        const now = new Date();
        const key = contractSeqKey(now);

        const next = await getNextSequenceValue(key);
        const contractNo = buildContractNo(next, now);

        const { advancePaymentAmount, advancePaymentDate, customerId, vehicleId, cityId, ...scalarFields } = data;

        const created = await prisma.contract.create({
            data: {
                ...scalarFields,
                status: 'UPCOMING',
                contractNo,
                advancePaymentAmount: advancePaymentAmount ?? 0,
                advancePaymentDate: advancePaymentDate || null,
                customer: { connect: { id: customerId } },
                vehicle: { connect: { id: vehicleId } },
                ...(cityId ? { city: { connect: { id: cityId } } } : {}),
            },
            include: {
                customer: true,
                vehicle: { include: { vehicleModel: { include: { brand: true } } } },
                city: { include: { district: true } },
            },
        });

        (async () => {
            await sendContractCreatedEmail(created);
        })();

        res.status(201).json(created);
    } catch (error) {
        console.error("Create Contract Error:", error);
        if (error instanceof z.ZodError) {
            console.log("Validation details:", JSON.stringify(error.errors, null, 2));
            return res.status(400).json({ message: 'Validation Error', errors: error.errors });
        }
        res.status(400).json({ message: error.message || 'Failed to create contract' });
    }
};

exports.getContracts = async (req, res) => {
    try {
        const { status, search, from, to } = req.query;
        const page = parseInt(req.query.page) || 1;
        const requestedLimit = parseInt(req.query.limit) || 20;
        const limit = Math.min(requestedLimit, 100);
        const skip = (page - 1) * limit;

        const where = { AND: [] };

        if (typeof status === 'string' && status.trim()) {
            const list = status
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean);
            if (list.length > 1) {
                where.AND.push({ status: { in: list } });
            } else if (list.length === 1) {
                where.AND.push({ status: list[0] });
            }
        }

        if (from || to) {
            where.AND.push({
                OR: [
                    {
                        AND: [
                            from ? { dropoffDate: { gte: new Date(from) } } : {},
                            to ? { pickupDate: { lte: new Date(to) } } : {}
                        ]
                    }
                ]
            });
        }

        if (search && typeof search === 'string') {
            const s = search.trim();
            where.AND.push({
                OR: [
                    { contractNo: { contains: s, mode: 'insensitive' } },
                    { customer: { name: { contains: s, mode: 'insensitive' } } },
                    { customer: { companyName: { contains: s, mode: 'insensitive' } } },
                    { vehicle: { licensePlate: { contains: s, mode: 'insensitive' } } }
                ]
            });
        }

        const [contracts, totalCount] = await Promise.all([
            prisma.contract.findMany({
                where,
                skip,
                take: limit,
                include: {
                    customer: true,
                    vehicle: {
                        include: {
                            vehicleModel: { include: { brand: true } }
                        }
                    },
                    city: {
                        include: { district: true }
                    },
                    vehicleExchanges: {
                        include: {
                            oldVehicle: { include: { vehicleModel: true } },
                            newVehicle: { include: { vehicleModel: true } }
                        }
                    }
                },
                orderBy: { createdAt: 'desc' }
            }),
            prisma.contract.count({ where })
        ]);

        res.json({
            data: contracts,
            pagination: {
                total: totalCount,
                page,
                limit,
                totalPages: Math.ceil(totalCount / limit)
            }
        });
    } catch (error) {
        console.error("Get Contracts Error:", error);
        res.status(500).json({ message: 'Failed to fetch contracts' });
    }
};

/**
 * Lean version of contract listing for the Dashboard Calendar.
 * Returns only the fields required to render the schedule, minimizing
 * database load and network payload size.
 */
exports.getCalendarContracts = async (req, res) => {
    try {
        const { status, from, to } = req.query;

        const where = { AND: [] };

        if (status) {
            const list = status.split(',').map(s => s.trim()).filter(Boolean);
            where.AND.push({ status: { in: list } });
        }

        if (from || to) {
            where.AND.push({
                AND: [
                    from ? { dropoffDate: { gte: new Date(from) } } : {},
                    to ? { pickupDate: { lte: new Date(to) } } : {}
                ]
            });
        }

        const contracts = await prisma.contract.findMany({
            where,
            select: {
                id: true,
                contractNo: true,
                status: true,
                pickupDate: true,
                pickupTime: true,
                dropoffDate: true,
                dropoffTime: true,
                vehicleId: true,
                customer: {
                    select: {
                        name: true
                    }
                },
                vehicle: {
                    select: {
                        licensePlate: true
                    }
                },
                vehicleExchanges: {
                    select: {
                        id: true,
                        oldVehicleId: true,
                        newVehicleId: true,
                        exchangeDate: true
                    }
                }
            },
            orderBy: { pickupDate: 'asc' },
            take: 1000 // Calendar needs a larger set but the payload is now tiny
        });

        res.json(contracts);
    } catch (error) {
        console.error("Get Calendar Contracts Error:", error);
        res.status(500).json({ message: 'Failed to fetch calendar data' });
    }
};

exports.updateContract = async (req, res) => {
    try {
        const { id } = req.params;
        const { status, ...rest } = req.body;

        const data = contractSchema.partial().parse(rest);

        const previousContract = await prisma.contract.findUnique({
            where: { id },
            select: { status: true, endOdometer: true, appliedDailyRate: true }
        });
        const previousStatus = previousContract?.status;

        // Business rule: discounted/base daily rate changes are only allowed while contract is UPCOMING.
        if (
            data.appliedDailyRate !== undefined &&
            previousContract &&
            previousContract.status !== 'UPCOMING' &&
            Number(data.appliedDailyRate) !== Number(previousContract.appliedDailyRate || 0)
        ) {
            return res.status(400).json({
                message: 'Daily rate can be changed only when contract status is UPCOMING'
            });
        }

        // Check for Overlapping Bookings (Minute-Precision)
        if (data.vehicleId || data.pickupDate || data.dropoffDate || data.pickupTime || data.dropoffTime) {
            const currentContract = await prisma.contract.findUnique({ where: { id } });
            
            const vId = data.vehicleId || currentContract.vehicleId;
            const pDay = data.pickupDate || currentContract.pickupDate;
            const pTime = data.pickupTime || currentContract.pickupTime;
            const dDay = data.dropoffDate || currentContract.dropoffDate;
            const dTime = data.dropoffTime || currentContract.dropoffTime;

            const newStart = combineDateAndTime(pDay, pTime);
            const newEnd = combineDateAndTime(dDay, dTime);

            if (newStart && newEnd) {
                const existingContracts = await prisma.contract.findMany({
                    where: {
                        id: { not: id }, // Exclude self
                        vehicleId: vId,
                        status: { in: ['UPCOMING', 'IN_PROGRESS', 'RETURN'] },
                        AND: [
                            { pickupDate: { lte: dDay } },
                            { dropoffDate: { gte: pDay } }
                        ]
                    }
                });

                const overlap = existingContracts.find(c => {
                    const cStart = combineDateAndTime(c.pickupDate, c.pickupTime);
                    const cEnd = combineDateAndTime(c.dropoffDate, c.dropoffTime);
                    if (!cStart || !cEnd) return false;
                    return (newStart < cEnd) && (cStart < newEnd);
                });

                if (overlap) {
                    return res.status(400).json({
                        message: 'This vehicle already have upcoming booking that date and time range, so please select another vehicle or select another date time range',
                        conflict: {
                            start: combineDateAndTime(overlap.pickupDate, overlap.pickupTime),
                            end: combineDateAndTime(overlap.dropoffDate, overlap.dropoffTime)
                        }
                    });
                }
            }
        }

        // Recalculate allocated KM from exact rental period (24h day-units)
        if (data.pickupDate || data.dropoffDate || data.pickupTime || data.dropoffTime || data.dailyKmLimit) {
            const currentContract = await prisma.contract.findUnique({ where: { id } });
            const pickup = data.pickupDate || currentContract.pickupDate;
            const dropoff = data.dropoffDate || currentContract.dropoffDate;
            const pickupTime = data.pickupTime || currentContract.pickupTime;
            const dropoffTime = data.dropoffTime || currentContract.dropoffTime;
            const limit = data.dailyKmLimit ?? currentContract.dailyKmLimit;
            const rentalDayUnits = computeRentalDayUnits(pickup, pickupTime, dropoff, dropoffTime);
            if (rentalDayUnits != null) {
                data.allocatedKm = Math.round(limit * rentalDayUnits);
            }
        }

        // Start-odometer integrity for UPCOMING / IN_PROGRESS edits.
        //
        // Why this exists:
        //   When a contract is created with status UPCOMING the start odometer is
        //   pre-filled from the vehicle's then-current reading. By the time the
        //   contract actually starts (often days later) that vehicle may have been
        //   used by another rental or manually updated, so its true reading is now
        //   higher. Saving the contract with the stale lower value would
        //   under-charge mileage on return.
        //
        // Behaviour:
        //   1. If the request explicitly sends a startOdometer lower than the
        //      vehicle's current reading → reject with a clear error so the user
        //      knows to bump it.
        //   2. If the request omits startOdometer (or sends one that is already
        //      >= latest), we still let the post-write IN_PROGRESS sync below
        //      auto-correct any stored stale value.
        //
        // Skipped for terminal statuses (RETURN / COMPLETED / CANCELLED) where
        // startOdometer is no longer editable.
        const targetStatusForOdoCheck = status || previousStatus;
        if (
            data.startOdometer !== undefined &&
            ['UPCOMING', 'IN_PROGRESS'].includes(targetStatusForOdoCheck)
        ) {
            const existingContract = await prisma.contract.findUnique({
                where: { id },
                select: { vehicleId: true },
            });
            const targetVehicleId = data.vehicleId || existingContract?.vehicleId;
            if (targetVehicleId) {
                const veh = await prisma.vehicle.findUnique({
                    where: { id: targetVehicleId },
                    select: { lastOdometer: true },
                });
                const latest = Number(veh?.lastOdometer) || 0;
                if (Number(data.startOdometer) < latest) {
                    return res.status(400).json({
                        message: `Start odometer (${data.startOdometer} km) cannot be below the vehicle's current reading (${latest} km). Use ${latest} km or a higher value.`,
                    });
                }
            }
        }

        const updateData = { ...data, status };
        Object.keys(updateData).forEach((key) => {
            if (updateData[key] === undefined) delete updateData[key];
        });

        await prisma.contract.update({
            where: { id },
            data: updateData,
        });

        const contract = await prisma.contract.findUnique({ where: { id } });
        if (!contract) throw new Error('Contract update failed or not found');

        if (status === 'IN_PROGRESS') {
            const vehicle = await prisma.vehicle.findUnique({ where: { id: contract.vehicleId } });
            const currentStartOdo = Number(data.startOdometer || contract.startOdometer) || 0;
            const latestVehicleOdo = Number(vehicle?.lastOdometer) || 0;

            if (latestVehicleOdo > currentStartOdo) {
                await prisma.contract.update({
                    where: { id: contract.id },
                    data: { startOdometer: latestVehicleOdo },
                });
            }

            await prisma.vehicle.update({
                where: { id: contract.vehicleId },
                data: { status: 'RENTED' },
            });
        } else if (status === 'RETURN' || status === 'COMPLETED' || status === 'CANCELLED') {
            const currentContract = await prisma.contract.findUnique({ where: { id } });

            let extraKmCost = 0;
            let extraDayCharge = 0;
            let extraTimeRemainderCharge = 0;

            if (status === 'COMPLETED') {
                const scheduledEnd = combineDateAndTime(currentContract.dropoffDate, currentContract.dropoffTime);
                const actualEnd = combineDateAndTime(
                    data.actualReturnDate || currentContract.actualReturnDate,
                    data.actualReturnTime || currentContract.actualReturnTime
                );

                let overtimeMinutesCeil = 0;
                if (scheduledEnd && actualEnd && actualEnd.getTime() > scheduledEnd.getTime()) {
                    const overtimeMinutes = Math.max(0, minutesDiff(scheduledEnd, actualEnd));
                    overtimeMinutesCeil = Math.ceil(overtimeMinutes);

                    const dailyRate = Number(currentContract.appliedDailyRate) || 0;
                    const extraDays = Math.floor(overtimeMinutesCeil / 1440);
                    const remMinutes = overtimeMinutesCeil - extraDays * 1440;
                    if (extraDays > 0) extraDayCharge = dailyRate * extraDays;
                    if (remMinutes > 0) extraTimeRemainderCharge = dailyRate * (remMinutes / 1440);
                }

                if (data.endOdometer) {
                    const startOdo = currentContract.startOdometer;
                    const endOdo = data.endOdometer;
                    const allocated = Number(currentContract.allocatedKm) || 0;
                    const rate = currentContract.extraMileageCharge;

                    const usedKm = endOdo - startOdo;
                    let coveredKm = allocated;

                    if (overtimeMinutesCeil > 0) {
                        const dailyKm = Number(currentContract.dailyKmLimit) || 0;
                        const extraCoverageKm = Math.round(dailyKm * (overtimeMinutesCeil / (24 * 60)));
                        if (extraCoverageKm > 0) {
                            coveredKm = allocated + extraCoverageKm;
                        }
                    }

                    if (usedKm > coveredKm) {
                        extraKmCost = (usedKm - coveredKm) * rate;
                    }
                }
            }

            const vehicleData = { status: 'AVAILABLE' };
            if (data.endOdometer !== undefined) vehicleData.lastOdometer = data.endOdometer;

            await prisma.vehicle.update({
                where: { id: contract.vehicleId },
                data: vehicleData,
            });

            await prisma.contract.update({
                where: { id },
                data: { extraKmCost },
            });

            if (
                data.endOdometer !== undefined &&
                (previousContract?.endOdometer !== data.endOdometer || previousStatus !== status)
            ) {
                const finalEndOdo = Number(data.endOdometer) || 0;

                await prisma.odometer.create({
                    data: {
                        vehicleId: contract.vehicleId,
                        reading: finalEndOdo,
                        source: 'CONTRACT_END',
                    },
                });

                const nextContract = await prisma.contract.findFirst({
                    where: {
                        vehicleId: contract.vehicleId,
                        status: 'UPCOMING',
                        pickupDate: { gte: contract.dropoffDate },
                        id: { not: contract.id },
                    },
                    orderBy: { pickupDate: 'asc' },
                });

                if (nextContract) {
                    await prisma.contract.update({
                        where: { id: nextContract.id },
                        data: { startOdometer: finalEndOdo },
                    });
                }
            }

            if (status === 'COMPLETED' && previousStatus !== 'COMPLETED') {
                const invoice = await prisma.invoice.findFirst({
                    where: { contractId: id, type: 'UPFRONT' },
                });
                if (invoice) {
                    const agg = await prisma.ledgerEntry.aggregate({
                        where: {
                            contractId: id,
                            invoiceId: invoice.id,
                            type: 'LIABILITY',
                        },
                        _sum: { amount: true },
                    });
                    const currentLiability = Number(agg._sum.amount || 0);

                    if (currentLiability !== 0) {
                        await prisma.ledgerEntry.create({
                            data: {
                                type: 'LIABILITY',
                                amount: -currentLiability,
                                currency: invoice.currency || 'LKR',
                                description: `Security deposit settled on return for ${currentContract.contractNo || ''}`.trim(),
                                invoice: { connect: { id: invoice.id } },
                                contract: { connect: { id } },
                                customer: { connect: { id: currentContract.customerId } },
                                vehicle: { connect: { id: contract.vehicleId } },
                            },
                        });
                    }

                    // Extra-charge rental income is recognized when the RETURN invoice is marked paid
                    // (applyReturnSettlementInTx). Do not post INCOME here — that duplicated P&L.
                }
            }
        }

        const finalContract = await prisma.contract.findUnique({
            where: { id },
            include: {
                customer: true,
                vehicle: { include: { vehicleModel: { include: { brand: true } } } },
                vehicleExchanges: { include: { newVehicle: true, oldVehicle: true } },
            }
        });

        if (status === 'COMPLETED' && previousStatus !== 'COMPLETED') {
            (async () => {
                await sendContractThankYouEmail(finalContract);
            })();
        }

        res.json(finalContract);
    } catch (error) {
        console.error("Update Contract Error:", error);
        if (error instanceof z.ZodError) {
            console.log("Validation details:", JSON.stringify(error.errors, null, 2));
            return res.status(400).json({ message: 'Validation Error', errors: error.errors });
        }
        return res.status(400).json({
            message: error.message || 'Failed to update contract',
            code: error.code || undefined,
            meta: error.meta || undefined
        });
    }
};

exports.deleteContract = async (req, res) => {
    try {
        const { id } = req.params;
        await prisma.contract.delete({ where: { id } });
        res.json({ message: 'Contract deleted successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Failed to delete contract' });
    }
};

exports.exchangeVehicle = async (req, res) => {
    const { id: contractId } = req.params;
    try {
        const {
            newVehicleId, oldVehicleId: reqOldVehicleId,
            oldVehicleReturnDate, oldVehicleReturnOdometer,
            newVehicleStartDate, newVehicleStartOdometer,
            newVehicleDailyRate,
            isEndOfContract
        } = exchangeSchema.parse(req.body);

        // Fetch current contract
        const contract = await prisma.contract.findUnique({
            where: { id: contractId },
            include: { vehicle: true }
        });

        if (!contract) return res.status(404).json({ message: 'Contract not found' });

        // If NOT end of contract, ensure new vehicle is selected
        if (!isEndOfContract && !newVehicleId) {
            return res.status(400).json({ message: "New Vehicle is required unless ending the contract." });
        }

        const oldVehicleId = reqOldVehicleId || contract.vehicleId;

        const exchange = await prisma.$transaction(
            async (tx) => {
                const ex = await tx.vehicleExchange.create({
                    data: {
                        contract: { connect: { id: contractId } },
                        oldVehicle: { connect: { id: oldVehicleId } },
                        ...(newVehicleId ? { newVehicle: { connect: { id: newVehicleId } } } : {}),
                        oldVehicleReturnDate,
                        oldVehicleReturnOdometer,
                        newVehicleStartDate: newVehicleStartDate || oldVehicleReturnDate,
                        newVehicleStartOdometer: newVehicleStartOdometer || 0,
                        newVehicleDailyRate: newVehicleDailyRate || 0,
                        exchangeDate: new Date(),
                    },
                });

                await tx.vehicle.update({
                    where: { id: oldVehicleId },
                    data: {
                        status: 'BREAKDOWN',
                        lastOdometer: oldVehicleReturnOdometer,
                    },
                });

                await tx.odometer.create({
                    data: {
                        vehicleId: oldVehicleId,
                        reading: oldVehicleReturnOdometer,
                        source: 'VEHICLE_EXCHANGE_RETURN',
                    },
                });

                if (isEndOfContract) {
                    await tx.contract.update({
                        where: { id: contractId },
                        data: {
                            status: 'COMPLETED',
                            actualReturnDate: oldVehicleReturnDate,
                            endOdometer: oldVehicleReturnOdometer,
                        },
                    });
                } else if (newVehicleId) {
                    await tx.vehicle.update({
                        where: { id: newVehicleId },
                        data: { status: 'RENTED' },
                    });
                    await tx.contract.update({
                        where: { id: contractId },
                        data: {
                            vehicleId: newVehicleId,
                            startOdometer: newVehicleStartOdometer || 0,
                            appliedDailyRate: newVehicleDailyRate || 0,
                        },
                    });
                }

                return ex;
            },
            TX_OPTS_CONTRACT,
        );

        res.json(exchange);
    } catch (error) {
        console.error("Exchange Vehicle Error:", error);
        if (error instanceof z.ZodError) {
            return res.status(400).json({ message: 'Validation Error', errors: error.errors });
        }
        res.status(400).json({ message: error.message || 'Failed to exchange vehicle' });
    }
};

exports.updateExchangeChecklist = async (req, res) => {
    try {
        const { exchangeId } = req.params;
        const data = req.body;

        const exchange = await prisma.vehicleExchange.update({
            where: { id: exchangeId },
            data: data
        });

        res.json(exchange);
    } catch (error) {
        console.error("Update Exchange Error:", error);
        res.status(400).json({ message: error.message || 'Failed to update exchange checklist' });
    }
};

