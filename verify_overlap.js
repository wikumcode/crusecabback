
const makeRequest = async (method, url, body) => {
    const opts = {
        method,
        headers: { 'Content-Type': 'application/json' },
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    if (!res.ok && res.status !== 400 && res.status !== 201) {
        const err = await res.text();
        console.error("Request Failed:", res.status, err);
        return { status: res.status, error: err };
    }
    const data = await res.json();
    if (!res.ok) console.log("Response Error:", data); // Log error data for debugging
    return { status: res.status, data };
};

async function run() {
    const baseUrl = 'http://localhost:5000/api';

    // 1. Setup Vehicle
    console.log("Creating Test Vehicle...");
    const vehicles = await makeRequest('GET', `${baseUrl}/vehicles`);
    const modelId = vehicles.data[0].modelId;
    const newVehicleRes = await makeRequest('POST', `${baseUrl}/vehicles`, {
        licensePlate: "TEST-OVERLAP-" + Date.now(),
        modelId: modelId,
        year: 2024,
        color: "Blue",
        fuelType: "Petrol",
        transmission: "Auto",
        status: "AVAILABLE",
        dailyRentalRate: 5000
    });
    const vehicleId = newVehicleRes.data.id;
    console.log("Vehicle Created:", vehicleId);

    // 2. Create Customer
    console.log("Creating Test Customer...");
    const clientRes = await makeRequest('POST', `${baseUrl}/clients`, {
        name: "Test Client",
        email: "test-" + Date.now() + "@example.com",
        phone: "1234567890",
        mobile: "0771234567",
        nicOrPassport: "123456789V",
        address: "Test Address",
        status: "CONFIRMED",
        type: "INDIVIDUAL"
    });
    const customerId = clientRes.data.id;
    console.log("Customer Created:", customerId);

    // 3. Create Contract 1 (Jan 10 - Jan 15)
    console.log("Creating Contract 1 (Jan 10 - Jan 15)...");
    const c1Res = await makeRequest('POST', `${baseUrl}/contracts`, {
        customerId,
        vehicleId,
        pickupDate: "2024-01-10",
        pickupTime: "10:00",
        dropoffDate: "2024-01-15",
        dropoffTime: "10:00",
        securityDeposit: 10000,
        fuelLevel: "FULL",
        startOdometer: 1000,
        allocatedKm: 100,
        extraMileageCharge: 100,
        frontTyres: "100%",
        rearTyres: "100%"
    });
    console.log("Contract 1 Status:", c1Res.status);
    if (c1Res.status !== 201) throw new Error("Failed to create Contract 1");

    // 4. Create Contract 2 (Jan 12 - Jan 18) [OVERLAP]
    console.log("Attempting Contract 2 (Jan 12 - Jan 18) [Should Fail]...");
    const c2Res = await makeRequest('POST', `${baseUrl}/contracts`, {
        customerId,
        vehicleId,
        pickupDate: "2024-01-12",
        pickupTime: "10:00",
        dropoffDate: "2024-01-18",
        dropoffTime: "10:00",
        securityDeposit: 10000,
        fuelLevel: "FULL",
        startOdometer: 1000,
        allocatedKm: 100,
        extraMileageCharge: 100,
        frontTyres: "100%",
        rearTyres: "100%"
    });
    console.log("Contract 2 Status:", c2Res.status, c2Res.data.message);
    if (c2Res.status !== 400) throw new Error("Contract 2 should have failed with 400!");

    // 5. Create Contract 3 (Jan 16 - Jan 20) [NO OVERLAP]
    console.log("Attempting Contract 3 (Jan 16 - Jan 20) [Should Success]...");
    const c3Res = await makeRequest('POST', `${baseUrl}/contracts`, {
        customerId,
        vehicleId,
        pickupDate: "2024-01-16",
        pickupTime: "10:00",
        dropoffDate: "2024-01-20",
        dropoffTime: "10:00",
        securityDeposit: 10000,
        fuelLevel: "FULL",
        startOdometer: 1000,
        allocatedKm: 100,
        extraMileageCharge: 100,
        frontTyres: "100%",
        rearTyres: "100%"
    });
    console.log("Contract 3 Status:", c3Res.status);
    if (c3Res.status !== 201) throw new Error("Contract 3 should have succeeded!");

    console.log("SUCCESS! Overlap protection works.");

    // Cleanup
    await makeRequest('DELETE', `${baseUrl}/contracts/${c1Res.data.id}`);
    await makeRequest('DELETE', `${baseUrl}/contracts/${c3Res.data.id}`);
    await makeRequest('DELETE', `${baseUrl}/vehicles/${vehicleId}`);
}

run().catch(console.error);
