const prisma = require('../lib/prisma');

const getAllPayments = async (req, res) => {
    try {
        const payments = await prisma.payment.findMany({
            include: {
                booking: {
                    include: {
                        client: {
                            select: {
                                name: true,
                                email: true
                            }
                        },
                        vehicle: {
                            select: {
                                licensePlate: true,
                                // make: true, // Legacy field, might be removed
                                // model: true, // Legacy field, might be removed
                                vehicleModel: {
                                    select: {
                                        name: true,
                                        brand: {
                                            select: {
                                                name: true
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            },
            orderBy: {
                date: 'desc'
            }
        });
        res.json(payments);
    } catch (error) {
        console.error('Error fetching payments:', error);
        res.status(500).json({ error: 'Failed to fetch payments' });
    }
};

const createPayment = async (req, res) => {
    try {
        let { bookingId, vehicleId, userId, clientId, startDate, endDate, amount, method, status, date } = req.body;

        // Frontend sends 'userId' for the Client ID. Ensure we have clientId.
        if (!clientId && userId) {
            clientId = userId;
        }

        // If no bookingId, we must create a new booking (Advance Payment scenario)
        if (!bookingId) {
            if (!vehicleId || !clientId || !startDate || !endDate) {
                return res.status(400).json({ error: 'Missing booking details for advance payment (vehicle, client, dates)' });
            }

            const newBooking = await prisma.booking.create({
                data: {
                    clientId,
                    vehicleId,
                    startDate: new Date(startDate),
                    endDate: new Date(endDate),
                    totalAmount: amount, // Start with payment amount? Or 0? Let's assume total is unknown or at least this paid amount.
                    status: 'CONFIRMED' // Auto-confirm if paying?
                }
            });
            bookingId = newBooking.id;
        }

        // Check if booking exists (verify the one we created or the one passed)
        const booking = await prisma.booking.findUnique({
            where: { id: bookingId }
        });

        if (!booking) {
            return res.status(404).json({ error: 'Booking not found' });
        }

        // Multi-payment support: We allow multiple payments for the same booking
        // Removed existingPayment check

        const payment = await prisma.payment.create({
            data: {
                bookingId,
                amount,
                method,
                status,
                date: date ? new Date(date) : new Date()
            }
        });

        res.status(201).json(payment);
    } catch (error) {
        console.error('Error creating payment:', error);
        // Log to file for debugging
        const fs = require('fs');
        const path = require('path');
        const logPath = path.join(__dirname, '../../server_error.log');
        fs.appendFileSync(logPath, `[${new Date().toISOString()}] Error creating payment: ${error.stack || error.message}\n`);

        res.status(500).json({ error: 'Failed to create payment', details: error.message });
    }
};

const deletePayment = async (req, res) => {
    try {
        const { id } = req.params;
        await prisma.payment.delete({
            where: { id }
        });
        res.json({ message: 'Payment deleted' });
    } catch (error) {
        console.error('Error deleting payment:', error);
        res.status(500).json({ error: 'Failed to delete payment' });
    }
};

// Helper to search vehicles for dropdown
const getVehiclesForPayment = async (req, res) => {
    try {
        const vehicles = await prisma.vehicle.findMany({
            include: {
                vehicleModel: {
                    include: { brand: true }
                },
                bookings: {
                    // We only need bookings related to this user really, or valid ones to show availability
                    // For simplicity, let's fetch active ones to show status
                    where: {
                        status: { not: 'CANCELLED' }
                    },
                    include: {
                        client: { select: { id: true, name: true, email: true } },
                        payments: true
                    }
                }
            },
            orderBy: {
                createdAt: 'desc'
            }
        });
        res.json(vehicles);
    } catch (error) {
        console.error('Error fetching vehicles:', error);
        res.status(500).json({ error: 'Failed to fetch vehicles', details: error.message });
    }
}

module.exports = {
    getAllPayments,
    createPayment,
    deletePayment,
    getVehiclesForPayment
};
