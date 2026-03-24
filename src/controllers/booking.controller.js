const prisma = require('../lib/prisma');
const bcrypt = require('bcryptjs');

exports.createBooking = async (req, res) => {
    console.log("Create Booking Payload:", JSON.stringify(req.body, null, 2));
    try {
        const {
            vehicleId,
            startDate,
            endDate,
            pickupTime,
            dropoffTime,
            totalAmount,
            paidAmount,
            paymentMethod,
            customerInfo,
            password
        } = req.body;

        const result = await prisma.$transaction(async (tx) => {
            // 1. Create or Update Client
            let client = await tx.client.findUnique({
                where: { email: customerInfo.email }
            });

            if (!client) {
                const count = await tx.client.count();
                const code = `CUS/${String(count + 1).padStart(5, '0')}`;
                client = await tx.client.create({
                    data: {
                        code,
                        type: 'WEBSITE',
                        status: 'CONFIRMED',
                        email: customerInfo.email,
                        name: customerInfo.name,
                        phone: customerInfo.phone || '',
                        mobile: customerInfo.mobile || customerInfo.phone || '',
                        address: customerInfo.address || 'Colombo, Sri Lanka',
                    }
                });
            }

            // 2. Optional: Create User Account
            let user = null;
            if (password) {
                const existingUser = await tx.user.findUnique({
                    where: { email: customerInfo.email }
                });

                if (!existingUser) {
                    const hashedPassword = await bcrypt.hash(password, 10);
                    user = await tx.user.create({
                        data: {
                            email: customerInfo.email,
                            password: hashedPassword,
                            name: customerInfo.name,
                            role: 'CUSTOMER'
                        }
                    });
                }
            }

            // 3. Create Booking
            const booking = await tx.booking.create({
                data: {
                    clientId: client.id,
                    vehicleId,
                    startDate: new Date(startDate),
                    endDate: new Date(endDate),
                    totalAmount: parseFloat(totalAmount),
                    status: 'CONFIRMED'
                }
            });

            // 4. Create Contract
            const contract = await tx.contract.create({
                data: {
                    customerId: client.id,
                    vehicleId,
                    pickupDate: new Date(startDate),
                    pickupTime: pickupTime || '10:00',
                    dropoffDate: new Date(endDate),
                    dropoffTime: dropoffTime || '10:00',
                    status: 'UPCOMING',
                    securityDeposit: 0, // Default for website bookings?
                    fuelLevel: 'FULL',
                    startOdometer: 0, // To be filled on collection
                    frontTyres: '100%',
                    rearTyres: '100%',
                    remark: 'Website Booking Confirmation'
                }
            });

            // 5. Create Payment
            const payment = await tx.payment.create({
                data: {
                    bookingId: booking.id,
                    amount: parseFloat(paidAmount),
                    method: paymentMethod || 'ONLINE',
                    status: paymentMethod === 'TRANSFER' ? 'PENDING' : 'PAID',
                    date: new Date()
                }
            });

            return { client, user, booking, contract, payment };
        });

        res.status(201).json(result);
    } catch (error) {
        console.error('Checkout error:', error);
        res.status(500).json({ error: 'Checkout failed', message: error.message, stack: error.stack });
    }
};

exports.getAllBookings = async (req, res) => {
    try {
        const bookings = await prisma.booking.findMany({
            include: {
                client: true,
                vehicle: {
                    include: {
                        vehicleModel: {
                            include: { brand: true }
                        }
                    }
                },
                payments: true
            },
            orderBy: { createdAt: 'desc' }
        });
        res.json(bookings);
    } catch (error) {
        console.error('Error fetching bookings:', error);
        res.status(500).json({ error: 'Failed to fetch bookings' });
    }
};

exports.getBookingById = async (req, res) => {
    try {
        const { id } = req.params;
        const booking = await prisma.booking.findUnique({
            where: { id },
            include: {
                client: true,
                vehicle: {
                    include: {
                        vehicleModel: {
                            include: { brand: true }
                        }
                    }
                },
                payments: true
            }
        });
        if (!booking) return res.status(404).json({ error: 'Booking not found' });
        res.json(booking);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch booking' });
    }
};
