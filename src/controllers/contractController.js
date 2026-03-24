const prisma = require('../lib/prisma');
const { z } = require('zod');

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
    securityDeposit: z.union([z.number(), z.string()]).transform((val) => Number(val) || 0),
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

    batteryCode: z.string().optional(),
    remark: z.string().optional(),

    frontTyres: z.string(), // 100%, 80%, etc.
    rearTyres: z.string(),
    returnFrontTyres: z.string().optional(),
    returnRearTyres: z.string().optional(),

    inspectionImages: z.string().optional() // JSON string of URLs
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

        // Check for Overlapping Bookings
        const start = data.pickupDate;
        const end = data.dropoffDate;

        const overlaps = await prisma.contract.findFirst({
            where: {
                vehicleId: data.vehicleId,
                status: { in: ['UPCOMING', 'IN_PROGRESS'] },
                AND: [
                    { pickupDate: { lte: end } },
                    { dropoffDate: { gte: start } }
                ]
            }
        });

        if (overlaps) {
            return res.status(400).json({
                message: 'Vehicle is already booked for these dates',
                conflict: {
                    start: overlaps.pickupDate,
                    end: overlaps.dropoffDate
                }
            });
        }

        // Calculate Allocated KM
        const days = Math.max(1, Math.ceil((data.dropoffDate - data.pickupDate) / (1000 * 60 * 60 * 24)));
        data.allocatedKm = data.dailyKmLimit * days;

        const now = new Date();
        const key = contractSeqKey(now);

        const contract = await prisma.$transaction(async (tx) => {
            const setting = await tx.systemSetting.findUnique({ where: { key } });
            const current = setting ? Number(setting.value) || 0 : 0;
            const next = current + 1;

            if (setting) {
                await tx.systemSetting.update({ where: { key }, data: { value: String(next) } });
            } else {
                await tx.systemSetting.create({ data: { key, value: String(next) } });
            }

            const contractNo = buildContractNo(next, now);
            return await tx.contract.create({
                data: {
                    ...data,
                    status: 'UPCOMING',
                    contractNo
                }
            });
        });

        res.status(201).json(contract);
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
        const { status } = req.query;
        const where = status ? { status } : {};

        const contracts = await prisma.contract.findMany({
            where,
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
        });
        res.json(contracts);
    } catch (error) {
        console.error("Get Contracts Error:", error);
        res.status(500).json({ message: 'Failed to fetch contracts' });
    }
};

exports.updateContract = async (req, res) => {
    try {
        const { id } = req.params;
        const { status, ...rest } = req.body;

        const data = contractSchema.partial().parse(rest);

        // Prisma/Mongo connector may have a max string length constraint for some fields.
        // Protect against "length greater than 50 not supported" by truncating only
        // the free-text otherChargeDescription field (it is user-entered and can grow).
        if (typeof data.otherChargeDescription === 'string' && data.otherChargeDescription.length > 50) {
            data.otherChargeDescription = data.otherChargeDescription.slice(0, 50);
        }

        if (typeof data.remark === 'string' && data.remark.length > 50) {
            data.remark = data.remark.slice(0, 50);
        }
        if (typeof data.batteryCode === 'string' && data.batteryCode.length > 50) {
            data.batteryCode = data.batteryCode.slice(0, 50);
        }

        // Last-resort guard: truncate any remaining long string fields
        // that might still trigger Prisma P2010 length constraints.
        const longStringKeys = Object.entries(data)
            .filter(([, v]) => typeof v === 'string' && v.length > 50)
            .map(([k, v]) => ({ k, length: v.length }));

        if (longStringKeys.length > 0) {
            console.warn('Long string fields detected (<=50 enforced):', longStringKeys);
            for (const { k } of longStringKeys) {
                data[k] = String(data[k]).slice(0, 50);
            }
        }

        const previousContract = await prisma.contract.findUnique({
            where: { id },
            select: { status: true, endOdometer: true }
        });
        const previousStatus = previousContract?.status;

        // Check for Overlapping Bookings (if dates or vehicle changed)
        if (data.pickupDate && data.dropoffDate && data.vehicleId) {
            const start = data.pickupDate;
            const end = data.dropoffDate;

            const overlaps = await prisma.contract.findFirst({
                where: {
                    id: { not: id }, // Exclude self
                    vehicleId: data.vehicleId,
                    status: { in: ['UPCOMING', 'IN_PROGRESS'] },
                    AND: [
                        { pickupDate: { lte: end } },
                        { dropoffDate: { gte: start } }
                    ]
                }
            });

            if (overlaps) {
                return res.status(400).json({
                    message: 'Vehicle is already booked for these dates',
                    conflict: {
                        start: overlaps.pickupDate,
                        end: overlaps.dropoffDate
                    }
                });
            }
        }

        // Recalculate Allocated KM if dates or limit changed
        if (data.pickupDate || data.dropoffDate || data.dailyKmLimit) {
            const currentContract = await prisma.contract.findUnique({ where: { id } });
            const pickup = data.pickupDate || currentContract.pickupDate;
            const dropoff = data.dropoffDate || currentContract.dropoffDate;
            const limit = data.dailyKmLimit || currentContract.dailyKmLimit;

            const days = Math.max(1, Math.ceil((new Date(dropoff) - new Date(pickup)) / (1000 * 60 * 60 * 24)));
            data.allocatedKm = limit * days;
        }

        const contract = await prisma.contract.update({
            where: { id },
            data: {
                ...data,
                status // Allow status update
            }
        });

        // Status Transition Logic
        if (status === 'IN_PROGRESS') {
            await prisma.vehicle.update({
                where: { id: contract.vehicleId },
                data: { status: 'RENTED' }
            });
        } else if (status === 'RETURN' || status === 'COMPLETED' || status === 'CANCELLED') {
            const currentContract = await prisma.contract.findUnique({ where: { id } });

            // Calculate Extra KM Cost
            let extraKmCost = 0;
            let extraDayCharge = 0;
            let extraTimeRemainderCharge = 0;

            // Late return day/time charges + mileage coverage both depend on overtime minutes.
            // We compute overtime first; mileage extra is only possible if endOdometer is provided.
            if (status === 'COMPLETED') {
                const scheduledEnd = combineDateAndTime(currentContract.dropoffDate, currentContract.dropoffTime);
                const actualEnd = combineDateAndTime(
                    data.actualReturnDate || currentContract.actualReturnDate,
                    data.actualReturnTime || currentContract.actualReturnTime
                );

                let overtimeMinutesCeil = 0;
                if (scheduledEnd && actualEnd && actualEnd.getTime() > scheduledEnd.getTime()) {
                    const overtimeMinutes = Math.max(0, minutesDiff(scheduledEnd, actualEnd));
                    // Round up so any late minutes count as billable extra time.
                    overtimeMinutesCeil = Math.ceil(overtimeMinutes);

                    // Late return day/time charges (based on daily rate)
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

                    // Late time also covers extra mileage proportionally
                    // (dailyKmLimit * overtimeMinutes / 1440), rounded to nearest km.
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

            // ONLY if it's not already something else?
            // User requirement: "contract is returned, then vehicle status goes to Available status"
            // Also good to handle Cancelled to free up the vehicle if it was reserved.
            await prisma.vehicle.update({
                where: { id: contract.vehicleId },
                data: {
                    status: 'AVAILABLE',
                    ...(data.endOdometer !== undefined ? { lastOdometer: data.endOdometer } : {})
                }
            });

            // Update contract with extra cost
            await prisma.contract.update({
                where: { id },
                data: { extraKmCost }
            });

            if (
                data.endOdometer !== undefined &&
                (
                    previousContract?.endOdometer !== data.endOdometer ||
                    previousStatus !== status
                )
            ) {
                await prisma.odometer.create({
                    data: {
                        vehicleId: contract.vehicleId,
                        reading: data.endOdometer,
                        source: 'CONTRACT_END'
                    }
                });
            }

            // Settlement: late return extra charges come from security deposit liability
            // and become vehicle INCOME (only on the first transition into COMPLETED).
            if (status === 'COMPLETED' && previousStatus !== 'COMPLETED') {
                const invoice = await prisma.invoice.findUnique({ where: { contractId: id } });
                if (invoice) {
                    const damageCharge = Number(currentContract.damageCharge) || 0;
                    const otherChargeAmount = Number(currentContract.otherChargeAmount) || 0;
                    const lateExtrasTotal =
                        (extraDayCharge || 0) +
                        (extraTimeRemainderCharge || 0) +
                        (extraKmCost || 0) +
                        damageCharge +
                        otherChargeAmount;

                    const collectionChargeAmount = (currentContract.isCollection || Number(currentContract.collectionCharge) > 0)
                        ? (Number(currentContract.collectionCharge) || 0)
                        : 0;
                    // Always apply income for late extras on contract completion.
                    // Invoice "paid" status handling is managed by the invoice payment flow,
                    // but completion must ensure P&L reflects final charges.
                    const extraChargesTotal = lateExtrasTotal + collectionChargeAmount;

                    await prisma.$transaction(async (tx) => {
                        // Clear existing deposit liability for this contract/invoice.
                        const liabAgg = await tx.ledgerEntry.aggregate({
                            where: { contractId: id, invoiceId: invoice.id, type: 'LIABILITY' },
                            _sum: { amount: true }
                        });
                        const currentLiability = Number(liabAgg?._sum?.amount || 0);
                        if (currentLiability !== 0) {
                            await tx.ledgerEntry.create({
                                data: {
                                    type: 'LIABILITY',
                                    amount: -currentLiability,
                                    currency: invoice.currency || 'LKR',
                                    description: `Security deposit settled on return for ${currentContract.contractNo || ''}`.trim(),
                                    invoice: { connect: { id: invoice.id } },
                                    contract: { connect: { id } },
                                    customer: { connect: { id: currentContract.customerId } },
                                    vehicle: { connect: { id: contract.vehicleId } },
                                }
                            });
                        }

                        if (extraChargesTotal > 0) {
                            await tx.ledgerEntry.create({
                                data: {
                                    type: 'INCOME',
                                    amount: extraChargesTotal,
                                    currency: invoice.currency || 'LKR',
                                    description: `Late return extra charges income for ${currentContract.contractNo || ''}`.trim(),
                                    invoice: { connect: { id: invoice.id } },
                                    contract: { connect: { id } },
                                    customer: { connect: { id: currentContract.customerId } },
                                    vehicle: { connect: { id: contract.vehicleId } },
                                }
                            });
                        }
                    });
                }
            }
        }

        res.json(contract);
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

        const result = await prisma.$transaction(async (prisma) => {
            // 1. Create Exchange Record
            const exchange = await prisma.vehicleExchange.create({
                data: {
                    contractId,
                    oldVehicleId,
                    newVehicleId: newVehicleId || null,
                    oldVehicleReturnDate,
                    oldVehicleReturnOdometer,
                    newVehicleStartDate: newVehicleStartDate || oldVehicleReturnDate,
                    newVehicleStartOdometer: newVehicleStartOdometer || 0,
                    newVehicleDailyRate: newVehicleDailyRate || 0
                }
            });

            // 2. Update Old Vehicle Status
            await prisma.vehicle.update({
                where: { id: oldVehicleId },
                data: {
                    status: 'BREAKDOWN', // Logic update: Exchanged vehicles go to BREAKDOWN check
                    lastOdometer: oldVehicleReturnOdometer
                }
            });
            await prisma.odometer.create({
                data: {
                    vehicleId: oldVehicleId,
                    reading: oldVehicleReturnOdometer,
                    source: 'VEHICLE_EXCHANGE_RETURN'
                }
            });

            if (isEndOfContract) {
                // 3a. End the Contract
                await prisma.contract.update({
                    where: { id: contractId },
                    data: {
                        status: 'COMPLETED',
                        actualReturnDate: oldVehicleReturnDate,
                        endOdometer: oldVehicleReturnOdometer,
                    }
                });
            } else if (newVehicleId) {
                // 3b. Update Replacement Vehicle to RENTED
                await prisma.vehicle.update({
                    where: { id: newVehicleId },
                    data: {
                        status: 'RENTED',
                        lastOdometer: newVehicleStartOdometer
                    }
                });
                await prisma.odometer.create({
                    data: {
                        vehicleId: newVehicleId,
                        reading: newVehicleStartOdometer,
                        source: 'VEHICLE_EXCHANGE_START'
                    }
                });
            }

            return exchange;
        });

        res.json(result);
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

